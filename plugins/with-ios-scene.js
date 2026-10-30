// iOS 27 asserts at launch unless the app adopts the UIScene life cycle, and Expo's prebuild
// template does not yet. This adds the scene manifest and hands window creation to Expo's
// ExpoAppSceneDelegate. Remove it once the template does this itself.
const { withInfoPlist, withAppDelegate, withEntitlementsPlist } = require("expo/config-plugins");

module.exports = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: "Default Configuration", UISceneDelegateClassName: "EXExpoAppSceneDelegate" },
        ],
      },
    };
    return c;
  });

  // Only local notifications are used, so skip the push entitlement: it needs a paid, registered
  // App ID, which stops a plain personal-team build from installing.
  config = withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });

  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes("ExpoReactNativeFactoryProvider")) return c;
    src = src.replace("class AppDelegate: ExpoAppDelegate {", "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {");
    const start = src.replace(/#if os\(iOS\) \|\| os\(tvOS\)\n    window = UIWindow[\s\S]*?#endif\n\n/, "");
    if (start === src) throw new Error("with-ios-scene: AppDelegate template changed; update plugins/with-ios-scene.js");
    c.modResults.contents = start;
    return c;
  });
};
