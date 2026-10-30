package expo.modules.hcssh

import android.util.Base64
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.KeyPair
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.OutputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.concurrent.thread

// SSH for herdr-core: runs one command (hc connect) per connection and carries
// its stdin/stdout as bytes. The phone's own Ed25519 key lives in app storage.
class HcSshModule : Module() {
  private val conns = ConcurrentHashMap<String, Conn>()

  override fun definition() = ModuleDefinition {
    Name("HcSsh")
    Events("onData", "onClose")

    OnCreate { configureJsch() }

    AsyncFunction("publicKey") { promise: Promise ->
      thread {
        try {
          promise.resolve(File(keyDir(), "id_ed25519.pub").also { ensureKey() }.readText().trim())
        } catch (e: Throwable) {
          promise.reject("ERR_KEY", e.message ?: e.toString(), e)
        }
      }
    }

    AsyncFunction("open") { id: String, host: String, port: Int, user: String, command: String, knownHostKey: String?, promise: Promise ->
      thread {
        try {
          promise.resolve(open(id, host, port, user, command, knownHostKey))
        } catch (e: Throwable) {
          promise.reject("ERR_SSH", e.message ?: e.toString(), e)
        }
      }
    }

    Function("write") { id: String, data: String ->
      conns[id]?.write(Base64.decode(data, Base64.NO_WRAP))
    }

    Function("close") { id: String ->
      conns.remove(id)?.close(null)
    }

    Function("startWatching") { title: String, text: String ->
      appContext.reactContext?.let { WatchService.start(it, title, text) }
    }

    Function("stopWatching") {
      appContext.reactContext?.let { WatchService.stop(it) }
    }

    OnDestroy {
      conns.values.forEach { it.close("app closed") }
      conns.clear()
      appContext.reactContext?.let { WatchService.stop(it) }
    }
  }

  private fun configureJsch() {
    // Android has no JDK EdDSA or XDH; use BouncyCastle's.
    JSch.setConfig("keypairgen.eddsa", "com.jcraft.jsch.bc.KeyPairGenEdDSA")
    JSch.setConfig("keypairgen_fromprivate.eddsa", "com.jcraft.jsch.bc.KeyPairGenEdDSA")
    JSch.setConfig("ssh-ed25519", "com.jcraft.jsch.bc.SignatureEd25519")
    JSch.setConfig("xdh", "com.jcraft.jsch.bc.XDH")
  }

  private fun keyDir(): File {
    val ctx = appContext.reactContext ?: throw IllegalStateException("no context")
    return File(ctx.filesDir, "ssh").apply { mkdirs() }
  }

  @Synchronized
  private fun ensureKey() {
    val priv = File(keyDir(), "id_ed25519")
    val pub = File(keyDir(), "id_ed25519.pub")
    if (priv.exists() && pub.exists()) return
    val kp = KeyPair.genKeyPair(JSch(), KeyPair.ED25519)
    kp.writeOpenSSHv1PrivateKey(priv.absolutePath)
    kp.writePublicKey(pub.absolutePath, "herdr-mobile@" + android.os.Build.MODEL.replace(" ", "-"))
    kp.dispose()
  }

  private fun open(id: String, host: String, port: Int, user: String, command: String, knownHostKey: String?): Map<String, String> {
    ensureKey()
    conns.remove(id)?.close(null)
    val jsch = JSch()
    jsch.addIdentity(File(keyDir(), "id_ed25519").absolutePath)
    var seen: String? = null
    jsch.hostKeyRepository = TrustOnFirstUse(knownHostKey) { seen = it }
    val session = jsch.getSession(user, host, port)
    session.setConfig("PreferredAuthentications", "publickey")
    session.setConfig("StrictHostKeyChecking", "yes")
    session.userInfo = Silent
    session.setServerAliveInterval(15_000)
    session.serverAliveCountMax = 3
    try {
      session.connect(15_000)
    } catch (e: Throwable) {
      if (knownHostKey != null && seen != null && seen != knownHostKey) {
        throw IllegalStateException("HOST_KEY_CHANGED: $host now presents a different host key")
      }
      throw e
    }
    val channel = session.openChannel("exec") as ChannelExec
    channel.setCommand(command)
    val stdout = channel.inputStream
    val stderr = channel.errStream
    val stdin = channel.outputStream
    channel.connect(15_000)
    val conn = Conn(id, session, channel, stdin)
    conns[id] = conn
    thread(name = "hc-ssh-err-$id") {
      val buf = ByteArray(4096)
      try {
        while (true) {
          val n = stderr.read(buf)
          if (n < 0) break
          conn.stderr(String(buf, 0, n))
        }
      } catch (_: Throwable) {}
    }
    thread(name = "hc-ssh-read-$id") {
      val buf = ByteArray(64 * 1024)
      var reason: String? = null
      try {
        while (true) {
          val n = stdout.read(buf)
          if (n < 0) break
          sendEvent("onData", mapOf("id" to id, "data" to Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)))
        }
        val code = channel.exitStatus
        if (code > 0) reason = "hc connect exited $code"
      } catch (e: Throwable) {
        reason = e.message ?: e.toString()
      }
      if (conns.remove(id, conn)) conn.close(reason)
    }
    return mapOf("hostKey" to (seen ?: ""))
  }

  private inner class Conn(val id: String, val session: Session, val channel: ChannelExec, val stdin: OutputStream) {
    private val writer = Executors.newSingleThreadExecutor()
    private val err = StringBuilder()
    @Volatile private var closed = false

    fun stderr(s: String) = synchronized(err) {
      err.append(s)
      if (err.length > 2000) err.delete(0, err.length - 2000)
    }

    fun write(bytes: ByteArray) {
      if (closed) return
      writer.execute {
        try {
          stdin.write(bytes)
          stdin.flush()
        } catch (e: Throwable) {
          if (conns.remove(id, this)) close(e.message ?: "write failed")
        }
      }
    }

    fun close(reason: String?) {
      if (closed) return
      closed = true
      writer.shutdownNow()
      try { channel.disconnect() } catch (_: Throwable) {}
      try { session.disconnect() } catch (_: Throwable) {}
      val detail = synchronized(err) { err.toString().trim() }
      val why = listOfNotNull(reason, detail.ifEmpty { null }).joinToString(": ")
      sendEvent("onClose", mapOf("id" to id, "reason" to why.ifEmpty { null }))
    }
  }

  /** Accepts the first host key, then only that one. */
  private class TrustOnFirstUse(val known: String?, val seen: (String) -> Unit) : HostKeyRepository {
    override fun check(host: String?, key: ByteArray?): Int {
      val encoded = Base64.encodeToString(key, Base64.NO_WRAP)
      seen(encoded)
      return if (known == null || known == encoded) HostKeyRepository.OK else HostKeyRepository.CHANGED
    }
    override fun add(hostkey: HostKey?, ui: UserInfo?) {}
    override fun remove(host: String?, type: String?) {}
    override fun remove(host: String?, type: String?, key: ByteArray?) {}
    override fun getKnownHostsRepositoryID(): String = "herdr-mobile"
    override fun getHostKey(): Array<HostKey> = emptyArray()
    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
  }

  private object Silent : UserInfo {
    override fun getPassphrase(): String? = null
    override fun getPassword(): String? = null
    override fun promptPassword(message: String?) = false
    override fun promptPassphrase(message: String?) = false
    override fun promptYesNo(message: String?) = false
    override fun showMessage(message: String?) {}
  }
}
