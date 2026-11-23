// The gateway that watches inboxes for push (crates/gateway). Without it the app offers no notifications.
export const GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL;

export const ANDROID_CHANNEL = 'mail';

// Keep in sync with targets/push/NotificationService.swift.
export const PUSH_KEYCHAIN_SERVICE = 'mailbowox.push';
export const PUSH_KEYS_KEY = 'push-keys';
