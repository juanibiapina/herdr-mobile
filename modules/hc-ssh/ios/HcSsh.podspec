Pod::Spec.new do |s|
  s.name           = 'HcSsh'
  s.version        = '0.1.0'
  s.summary        = 'SSH lines to herdr-core for Herdr Mobile'
  s.description    = 'Opens SSH to a machine and runs herdr-core connect, streaming its stdin and stdout.'
  s.license        = 'MIT'
  s.author         = 'herdr-mobile'
  s.homepage       = 'https://github.com/Deeds67/herdr-mobile'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/Deeds67/herdr-mobile.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  spm_dependency(s,
    url: 'https://github.com/apple/swift-nio-ssh.git',
    requirement: { kind: 'upToNextMinorVersion', minimumVersion: '0.9.0' },
    products: ['NIOSSH'])
  spm_dependency(s,
    url: 'https://github.com/apple/swift-nio.git',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '2.65.0' },
    products: ['NIOCore', 'NIOPosix'])
  spm_dependency(s,
    url: 'https://github.com/apple/swift-crypto.git',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '3.0.0' },
    products: ['Crypto'])

  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
