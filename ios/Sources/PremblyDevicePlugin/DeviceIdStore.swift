import Foundation
import Security

/// The id this install keeps for itself. Stored in the Keychain so it survives an app update and a
/// reinstall (it is not synced to other devices). The same service and account as the React Native
/// library, so a phone running both apps reports one id.
enum DeviceIdStore {
    private static let service = "com.prembly.tmsdk.device"
    private static let account = "device_id"
    private static let lock = NSLock()

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private static func readStoredId() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else { return nil }
        return value
    }

    static func deviceId() -> String {
        lock.lock()
        defer { lock.unlock() }
        if let existing = readStoredId() { return existing }
        let fresh = UUID().uuidString.lowercased()
        var attributes = baseQuery
        attributes[kSecValueData as String] = Data(fresh.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        // If the Keychain is unavailable the id is simply not kept: the next call makes a new one.
        SecItemAdd(attributes as CFDictionary, nil)
        return fresh
    }
}
