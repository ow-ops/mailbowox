/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'notification-service',
  name: 'PushService',
  bundleIdentifier: '.push',
  deploymentTarget: '16.4',
  entitlements: {
    // The app's default keychain group, where it stores the push keys.
    'keychain-access-groups': [`$(AppIdentifierPrefix)${config.ios.bundleIdentifier}`],
  },
});
