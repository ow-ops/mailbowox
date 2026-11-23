import Foundation
import Security
import UserNotifications

// Keychain names must match src/push/config.ts.
final class NotificationService: UNNotificationServiceExtension {
  private static let keychainService = "mailbowox.push:no-auth"  // expo-secure-store appends ":no-auth"
  private static let keysAccount = "push-keys"

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let content = (request.content.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
    self.content = content

    if let message = request.content.userInfo["m"] as? String,
      let body = WebPush.fromBase64(message),
      let keys = Self.loadKeys(),
      let json = try? WebPush.decrypt(body, keys: keys),
      let push = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any]
    {
      if let title = push["title"] as? String, !title.isEmpty { content.title = title }
      if let subtitle = push["subtitle"] as? String { content.subtitle = subtitle }
      if let text = push["body"] as? String, !text.isEmpty { content.body = text }
    }
    contentHandler(content)
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let content { contentHandler(content) }
  }

  private static func loadKeys() -> WebPush.Keys? {
    let account = Data(keysAccount.utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrGeneric as String: account,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let stored = try? JSONSerialization.jsonObject(with: data) as? [String: String],
      let privateKey = stored["privateKey"].flatMap(WebPush.fromBase64),
      let publicKey = stored["publicKey"].flatMap(WebPush.fromBase64),
      let auth = stored["auth"].flatMap(WebPush.fromBase64)
    else { return nil }
    return WebPush.Keys(privateKey: privateKey, publicKey: publicKey, auth: auth)
  }
}
