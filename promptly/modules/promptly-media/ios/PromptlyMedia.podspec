Pod::Spec.new do |s|
  s.name           = 'PromptlyMedia'
  s.version        = '0.1.0'
  s.summary        = 'Promptly native media operations'
  s.description    = 'Caption burn-in via AVFoundation for Promptly'
  s.license        = { :type => 'Proprietary' }
  s.author         = 'Promptly'
  s.homepage       = 'https://example.invalid/promptly'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech'
  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
