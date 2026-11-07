// The app and its extensions meet in one shared keychain item per purpose:
// "inbox" (pages saved from the Share menu, emptied by the app) and "widget" (what the widgets show).
import Foundation
import Security

enum SharedStore {
    static let service = "com.daviddaniels.readingroom.shared"

    static var group: String {
        Bundle.main.object(forInfoDictionaryKey: "ReadingRoomKeychainGroup") as? String ?? ""
    }

    private static func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrAccessGroup as String: group]
    }

    static func read(_ account: String) -> Data? {
        var q = base(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func write(_ account: String, _ data: Data) {
        SecItemDelete(base(account) as CFDictionary)
        var q = base(account)
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    struct Saved: Codable { let url: String; let title: String }

    /// Add a page for the app to pick up next time it opens.
    static func addToInbox(url: String, title: String) -> Bool {
        var list = (read("inbox").flatMap { try? JSONDecoder().decode([Saved].self, from: $0) }) ?? []
        if list.contains(where: { $0.url == url }) { return true }
        list.append(Saved(url: url, title: title))
        guard let data = try? JSONEncoder().encode(Array(list.suffix(200))) else { return false }
        write("inbox", data)
        return read("inbox") != nil
    }
}
