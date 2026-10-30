import ExpoModulesCore
import Crypto
import Foundation
import NIOCore
import NIOPosix
import NIOSSH
import Security

private struct SshError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

// MARK: - Phone key

private enum PhoneKey {
  static let service = "dev.juanibiapina.herdrmobile.ssh"
  static let account = "ed25519"

  static func load() throws -> Curve25519.Signing.PrivateKey {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
      return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
    }
    let key = Curve25519.Signing.PrivateKey()
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: key.rawRepresentation,
      // Readable while the phone is locked, so background reconnects work; never leaves the device.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else { throw SshError("Could not store the SSH key (Keychain \(status))") }
    return key
  }

  /// The `ssh-ed25519 AAAA… comment` line for authorized_keys.
  static func authorizedKeysLine() throws -> String {
    let raw = try load().publicKey.rawRepresentation
    var blob = Data()
    for part in [Data("ssh-ed25519".utf8), raw] {
      var length = UInt32(part.count).bigEndian
      blob.append(Data(bytes: &length, count: 4))
      blob.append(part)
    }
    return "ssh-ed25519 \(blob.base64EncodedString()) herdr-mobile"
  }
}

// MARK: - SSH plumbing

private final class OneKeyAuth: NIOSSHClientUserAuthenticationDelegate {
  private var offer: NIOSSHUserAuthenticationOffer?
  init(user: String, key: NIOSSHPrivateKey) {
    offer = NIOSSHUserAuthenticationOffer(username: user, serviceName: "ssh-connection", offer: .privateKey(.init(privateKey: key)))
  }

  func nextAuthenticationType(
    availableMethods: NIOSSHAvailableUserAuthenticationMethods,
    nextChallengePromise: EventLoopPromise<NIOSSHUserAuthenticationOffer?>
  ) {
    // Offered once: if the server turns the key down there is nothing else to try.
    guard availableMethods.contains(.publicKey), let o = offer else {
      nextChallengePromise.succeed(nil)
      return
    }
    offer = nil
    nextChallengePromise.succeed(o)
  }
}

/// Trusts the first host key a machine presents and pins it; a different key later is refused.
private final class PinnedHostKey: NIOSSHClientServerAuthenticationDelegate {
  private let known: String?
  private let seen: (String) -> Void
  init(known: String?, seen: @escaping (String) -> Void) {
    self.known = known
    self.seen = seen
  }

  func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
    let presented = String(openSSHPublicKey: hostKey)
    if let known, known != presented {
      validationCompletePromise.fail(SshError("The host key changed. Remove the machine and add it again if that is expected."))
      return
    }
    seen(presented)
    validationCompletePromise.succeed(())
  }
}

private final class ExecHandler: ChannelInboundHandler {
  typealias InboundIn = SSHChannelData

  let ready: EventLoopPromise<Void>
  private let onData: (Data) -> Void
  private let onClose: (String?) -> Void
  private var stderr = Data()
  private var exitStatus: Int?
  private var closed = false

  init(ready: EventLoopPromise<Void>, onData: @escaping (Data) -> Void, onClose: @escaping (String?) -> Void) {
    self.ready = ready
    self.onData = onData
    self.onClose = onClose
  }

  func channelActive(context: ChannelHandlerContext) {
    context.channel.setOption(ChannelOptions.allowRemoteHalfClosure, value: true).whenFailure { _ in }
    context.fireChannelActive()
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    let message = unwrapInboundIn(data)
    guard case .byteBuffer(var buffer) = message.data, let bytes = buffer.readBytes(length: buffer.readableBytes) else { return }
    switch message.type {
    case .channel: onData(Data(bytes))
    case .stdErr: if stderr.count < 4096 { stderr.append(contentsOf: bytes) }
    default: break
    }
  }

  func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
    switch event {
    case is ChannelSuccessEvent: ready.succeed(())
    case is ChannelFailureEvent: ready.fail(SshError("The server refused to run herdr-core"))
    case let status as SSHChannelRequestEvent.ExitStatus: exitStatus = Int(status.exitStatus)
    default: context.fireUserInboundEventTriggered(event)
    }
  }

  func channelInactive(context: ChannelHandlerContext) {
    finish(reason: reasonFromExit())
    context.fireChannelInactive()
  }

  func errorCaught(context: ChannelHandlerContext, error: Error) {
    finish(reason: error.localizedDescription)
    context.close(promise: nil)
  }

  private func reasonFromExit() -> String? {
    let text = String(data: stderr, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !text.isEmpty { return text }
    if let code = exitStatus, code != 0 { return "herdr-core exited with status \(code)" }
    return nil
  }

  private func finish(reason: String?) {
    ready.fail(SshError(reason ?? "The connection closed"))
    guard !closed else { return }
    closed = true
    onClose(reason)
  }
}

private final class Presented {
  private let lock = NSLock()
  private var value = ""
  func set(_ v: String) { lock.lock(); value = v; lock.unlock() }
  func get() -> String { lock.lock(); defer { lock.unlock() }; return value }
}

private final class Line {
  let root: Channel
  var child: Channel?
  init(root: Channel) { self.root = root }
}

// MARK: - Module

public class HcSshModule: Module {
  private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
  private let lock = NSLock()
  private var lines: [String: Line] = [:]

  private func line(_ id: String) -> Line? {
    lock.lock()
    defer { lock.unlock() }
    return lines[id]
  }

  private func setLine(_ id: String, _ line: Line?) {
    lock.lock()
    lines[id] = line
    lock.unlock()
  }

  public func definition() -> ModuleDefinition {
    Name("HcSsh")
    Events("onData", "onClose")

    AsyncFunction("publicKey") { () -> String in
      try PhoneKey.authorizedKeysLine()
    }

    AsyncFunction("open") { (id: String, host: String, port: Int, user: String, command: String, knownHostKey: String?) async throws -> [String: String] in
      let key = NIOSSHPrivateKey(ed25519Key: try PhoneKey.load())
      let presented = Presented()
      let hostCheck = PinnedHostKey(known: knownHostKey) { presented.set($0) }
      let config = SSHClientConfiguration(userAuthDelegate: OneKeyAuth(user: user, key: key), serverAuthDelegate: hostCheck)

      let root = try await ClientBootstrap(group: self.group)
        .connectTimeout(.seconds(15))
        .channelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
        .channelOption(ChannelOptions.socketOption(.tcp_nodelay), value: 1)
        .channelInitializer { channel in
          channel.pipeline.addHandler(
            NIOSSHHandler(role: .client(config), allocator: channel.allocator, inboundChildChannelInitializer: nil))
        }
        .connect(host: host, port: port).get()

      let line = Line(root: root)
      do {
        let ready = root.eventLoop.makePromise(of: Void.self)
        let handler = ExecHandler(
          ready: ready,
          onData: { [weak self] data in
            self?.sendEvent("onData", ["id": id, "data": data.base64EncodedString()])
          },
          onClose: { [weak self] reason in
            self?.setLine(id, nil)
            root.close(promise: nil)
            self?.sendEvent("onClose", ["id": id, "reason": reason as Any])
          })

        let child: Channel = try await root.eventLoop.flatSubmit {
          root.pipeline.handler(type: NIOSSHHandler.self).flatMap { ssh in
            let promise = root.eventLoop.makePromise(of: Channel.self)
            ssh.createChannel(promise) { channel, type in
              guard type == .session else { return channel.eventLoop.makeFailedFuture(SshError("Unexpected channel type")) }
              return channel.pipeline.addHandler(handler)
            }
            return promise.futureResult
          }
        }.get()
        line.child = child
        self.setLine(id, line)

        try await child.triggerUserOutboundEvent(SSHChannelRequestEvent.ExecRequest(command: command, wantReply: true)).get()
        try await ready.futureResult.get()
      } catch {
        self.setLine(id, nil)
        try? await root.close()
        throw error
      }

      return ["hostKey": presented.get()]
    }

    Function("write") { (id: String, base64: String) in
      guard let child = self.line(id)?.child, let data = Data(base64Encoded: base64) else { return }
      var buffer = child.allocator.buffer(capacity: data.count)
      buffer.writeBytes(data)
      child.writeAndFlush(SSHChannelData(type: .channel, data: .byteBuffer(buffer)), promise: nil)
    }

    Function("close") { (id: String) in
      guard let line = self.line(id) else { return }
      self.setLine(id, nil)
      line.root.close(promise: nil)
    }

    // iOS suspends the app's sockets in the background and has no foreground service to prevent it.
    Function("startWatching") { (_: String, _: String) in }
    Function("stopWatching") {}
  }
}
