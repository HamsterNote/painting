require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'PaintingPencilkit'
  s.version        = package['version']
  s.summary        = package['description']
  s.author         = 'HamsterNote'
  s.homepage       = 'https://github.com/HamsterNote/painting'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/HamsterNote/painting.git' }
  s.static_framework = true

  s.frameworks = 'PencilKit'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
