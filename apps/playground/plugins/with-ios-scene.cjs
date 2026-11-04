const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

// Expo 57 ships the scene delegate, but its bundled prebuild template still starts RN
// from AppDelegate. Keep this migration in config so clean prebuilds retain it.
function migrateAppDelegate(source) {
  const declaration = 'class AppDelegate: ExpoAppDelegate';
  if (!source.includes(declaration)) throw new Error('Unsupported Expo AppDelegate template');
  const result = source.replace(
    /class AppDelegate: ExpoAppDelegate(?:, ExpoReactNativeFactoryProvider)?/,
    `${declaration}, ExpoReactNativeFactoryProvider`
  );
  const legacyLaunch =
    /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\([\s\S]*?launchOptions: launchOptions\)\s*#endif/;
  const migrated = result.replace(
    legacyLaunch,
    '    // ExpoAppSceneDelegate owns window creation and React Native startup.'
  );
  if (migrated.includes('factory.startReactNative(') || migrated.includes('UIWindow(frame:')) {
    throw new Error('Unsupported AppDelegate startup: refusing to register two React Native roots');
  }
  if (!migrated.includes('reactNativeFactory = factory')) {
    throw new Error('AppDelegate must initialize the factory before scene connection');
  }
  return migrated;
}

module.exports = function withIosScene(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: 'EXExpoAppSceneDelegate',
          },
        ],
      },
    };
    return config;
  });
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') throw new Error('Swift AppDelegate required');
    config.modResults.contents = migrateAppDelegate(config.modResults.contents);
    return config;
  });
};

module.exports.migrateAppDelegate = migrateAppDelegate;
