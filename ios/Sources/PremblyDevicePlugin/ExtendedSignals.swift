import CallKit
import CoreLocation
import CoreTelephony
import Foundation
import Security
import SystemConfiguration.CaptiveNetwork
import UIKit

/// Extra context about the phone. Every value is best effort: one that iOS will not give is left out,
/// never guessed. Nothing here asks for a permission.
enum ExtendedSignals {
    /// Fields to merge into the `device` section: install source, CPU architecture, free storage,
    /// battery, carrier (where iOS still reports it), wifi name and access point (only when the app has
    /// the wifi entitlement and location permission) and the Apple team ID the app is signed by.
    static func deviceContext() -> [String: Any] {
        var out: [String: Any] = [:]
        out["install_source"] = installSource()
        #if arch(arm64)
        out["cpu_architecture"] = "arm64"
        #elseif arch(x86_64)
        out["cpu_architecture"] = "x86_64"
        #endif
        if let free = storageFreePercent() { out["storage_free_percent"] = free }
        if let level = batteryLevel() { out["battery_level"] = level }
        for (key, value) in carrier() { out[key] = value }
        for (key, value) in wifi() { out[key] = value }
        if let team = teamId() { out["apple_team_id"] = team }
        return out
    }

    /// Whether a phone call is in progress.
    static func onPhoneCall() -> Bool {
        CXCallObserver().calls.contains { !$0.hasEnded }
    }

    /// Where the app came from: "app_store", "testflight", "development" (a provisioning profile is
    /// embedded: development, ad hoc or enterprise) or "simulator".
    private static func installSource() -> String {
        #if targetEnvironment(simulator)
        return "simulator"
        #else
        let bundle = Bundle.main
        if bundle.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" { return "testflight" }
        if bundle.path(forResource: "embedded", ofType: "mobileprovision") != nil { return "development" }
        return "app_store"
        #endif
    }

    private static func storageFreePercent() -> Double? {
        let values = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityKey])
        guard let total = values?.volumeTotalCapacity, let free = values?.volumeAvailableCapacity, total > 0 else {
            return nil
        }
        return min(100, max(0, (Double(free) / Double(total) * 1000).rounded() / 10))
    }

    /// UIKit's battery reading must happen on the main thread. A negative value means iOS cannot tell.
    private static func batteryLevel() -> Int? {
        let read: () -> Int? = {
            let device = UIDevice.current
            let was = device.isBatteryMonitoringEnabled
            device.isBatteryMonitoringEnabled = true
            let value = device.batteryLevel
            device.isBatteryMonitoringEnabled = was
            return value >= 0 ? Int((value * 100).rounded()) : nil
        }
        return Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
    }

    /// iOS 16 and later no longer reveal the carrier and return placeholder values; those are dropped.
    @available(iOS, deprecated: 16.0)
    private static func carrierInfo() -> CTCarrier? {
        let info = CTTelephonyNetworkInfo()
        return info.serviceSubscriberCellularProviders?.values.first
    }

    private static func carrier() -> [String: Any] {
        var out: [String: Any] = [:]
        guard let carrier = carrierInfo(), let mcc = carrier.mobileCountryCode, let mnc = carrier.mobileNetworkCode,
              !mcc.isEmpty, !mnc.isEmpty, mcc != "65535" else { return out }
        out["carrier_mcc"] = mcc
        out["carrier_mnc"] = mnc
        if let name = carrier.carrierName, !name.isEmpty, name != "--" { out["carrier_name"] = name }
        if let country = carrier.isoCountryCode, !country.isEmpty { out["carrier_country"] = country.uppercased() }
        return out
    }

    /// The wifi name and access point. iOS only gives them to an app with the "Access WiFi Information"
    /// entitlement and location permission, so without both nothing is sent.
    private static func wifi() -> [String: Any] {
        var out: [String: Any] = [:]
        let status: CLAuthorizationStatus = CLLocationManager().authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { return out }
        #if !targetEnvironment(simulator)
        for name in (CNCopySupportedInterfaces() as? [String]) ?? [] {
            guard let network = CNCopyCurrentNetworkInfo(name as CFString) as? [String: Any] else { continue }
            if let ssid = network[kCNNetworkInfoKeySSID as String] as? String, !ssid.isEmpty { out["wifi_ssid"] = ssid }
            if let bssid = paddedBssid(network[kCNNetworkInfoKeyBSSID as String] as? String) { out["wifi_bssid"] = bssid }
            if !out.isEmpty { break }
        }
        #endif
        return out
    }

    /// iOS drops leading zeros ("0:1a:2b:..."); the server expects six two-digit pairs.
    static func paddedBssid(_ raw: String?) -> String? {
        guard let parts = raw?.split(separator: ":", omittingEmptySubsequences: false), parts.count == 6 else { return nil }
        var padded: [String] = []
        for part in parts {
            guard !part.isEmpty, part.count <= 2 else { return nil }
            padded.append(part.count == 1 ? "0" + part : String(part))
        }
        return padded.joined(separator: ":")
    }

    /// The Apple team that signed this install. iOS has no call for it, but a keychain item an app
    /// creates is stamped with an access group that starts with the team ID, so we read it from there.
    private static func teamId() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: "prembly.team-id-probe",
            kSecAttrService as String: "prembly.team-id-probe",
            kSecReturnAttributes as String: true
        ]
        var result: CFTypeRef?
        var status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            var add = query
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(add as CFDictionary, &result)
        }
        guard status == errSecSuccess, let attributes = result as? [String: Any],
              let group = attributes[kSecAttrAccessGroup as String] as? String,
              let dot = group.firstIndex(of: "."), dot != group.startIndex,
              group.distance(from: group.startIndex, to: dot) <= 10 else { return nil }
        return String(group[..<dot])
    }
}
