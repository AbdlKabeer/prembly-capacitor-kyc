import CFNetwork
import CoreLocation
import Foundation
import LocalAuthentication
import MachO
import SystemConfiguration
import UIKit

/// What this phone says about itself, in the shape the Prembly backend reads (the same keys the React
/// Native library sends). A best effort and client-reported: the backend treats it as such.
enum SignalCollector {
    static func collect(includeLocation: Bool) -> [String: Any] {
        var signals: [String: Any] = [
            "device": deviceSection(),
            "integrity": integritySection(),
            "network": networkSection(),
            "scam_signals": scamSection()
        ]
        if includeLocation, let location = locationSection() {
            signals["location"] = location
        }
        return signals
    }

    static func appInfo() -> [String: String] {
        let bundle = Bundle.main
        return [
            "appId": bundle.bundleIdentifier ?? "",
            "appVersion": bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "appBuild": bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        ]
    }

    static func screenCapture() -> [String: Any] {
        [
            "is_screen_shared_or_recorded": isScreenCaptured()
        ]
    }

    /// UIKit must be read on the main thread.
    private static func onMain<T>(_ read: () -> T) -> T {
        Thread.isMainThread ? read() : DispatchQueue.main.sync(execute: read)
    }

    // MARK: Device

    private static func sysctlString(_ name: String) -> String {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return "" }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return "" }
        return String(cString: buffer)
    }

    private static func deviceSection() -> [String: Any] {
        let bundle = Bundle.main
        let info = ProcessInfo.processInfo
        var model = sysctlString("hw.machine")
        #if targetEnvironment(simulator)
        // On the simulator hw.machine is the Mac's architecture; the simulated model is in the environment.
        if let simulated = info.environment["SIMULATOR_MODEL_IDENTIFIER"], !simulated.isEmpty {
            model = simulated
        }
        #endif
        let (idiom, vendorId, version) = onMain {
            (UIDevice.current.userInterfaceIdiom, UIDevice.current.identifierForVendor?.uuidString ?? "", UIDevice.current.systemVersion)
        }
        var section: [String: Any] = [
            "type": idiom == .pad ? "tablet" : "phone",
            "model": model,
            "manufacturer": "Apple",
            "os_name": "ios",
            "os_version": version,
            "app_version": bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "app_build": bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "locale": languageTag(),
            "timezone": TimeZone.current.identifier,
            // The id iOS keeps for this app's vendor on this phone: the same for every app from the
            // vendor, and only changes once all of them are deleted.
            "platform_device_id": vendorId,
            "total_memory_mb": Int(info.physicalMemory / (1024 * 1024)),
            "cpu_cores": info.activeProcessorCount
        ]
        for (key, value) in screenMetrics() { section[key] = value }
        return section
    }

    private static func screenMetrics() -> [String: Any] {
        onMain {
            let screen = UIScreen.main
            return [
                "screen_width": Double(screen.nativeBounds.size.width),
                "screen_height": Double(screen.nativeBounds.size.height),
                "screen_density": Double(screen.nativeScale)
            ]
        }
    }

    /// The preferred language as a BCP 47 tag, for example "en-US". The locale identifier is avoided
    /// because it can carry region overrides such as "en-US@rg=ngzzzz".
    private static func languageTag() -> String {
        if let preferred = Locale.preferredLanguages.first, !preferred.isEmpty { return preferred }
        return Locale.current.identifier.replacingOccurrences(of: "_", with: "-")
    }

    // MARK: Integrity

    private static let isSimulator: Bool = {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }()

    private static func isDebuggerAttached() -> Bool {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return false }
        return (info.kp_proc.p_flag & P_TRACED) != 0
    }

    /// Best effort: a determined attacker can hide a jailbreak. Never run on the simulator, where the
    /// host Mac's files would make every check pass.
    private static func isJailbroken() -> Bool {
        if isSimulator { return false }
        let files = FileManager.default
        let paths = [
            "/Applications/Cydia.app", "/Applications/Sileo.app", "/Applications/Zebra.app",
            "/Library/MobileSubstrate/MobileSubstrate.dylib", "/bin/bash", "/usr/sbin/sshd",
            "/etc/apt", "/private/var/lib/apt/", "/usr/bin/ssh", "/var/jb"
        ]
        if paths.contains(where: { files.fileExists(atPath: $0) }) { return true }

        // A sandboxed app cannot write outside its container.
        let probe = "/private/tmp_tm_probe"
        if (try? "x".write(toFile: probe, atomically: true, encoding: .utf8)) != nil {
            try? files.removeItem(atPath: probe)
            return true
        }

        // Hooking and injection libraries loaded into this process.
        let markers = ["MobileSubstrate", "Substrate", "FridaGadget", "cynject", "libcycript", "SSLKillSwitch"]
        for index in 0..<_dyld_image_count() {
            guard let name = _dyld_get_image_name(index) else { continue }
            let image = String(cString: name)
            if markers.contains(where: { image.range(of: $0, options: .caseInsensitive) != nil }) { return true }
        }
        return false
    }

    private static func hasDeviceLock() -> Bool {
        var error: NSError?
        return LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    private static func integritySection() -> [String: Any] {
        [
            "is_rooted": isJailbroken(),
            "is_emulator": isSimulator,
            "is_debugger_attached": isDebuggerAttached(),
            "is_device_secure": hasDeviceLock()
        ]
    }

    // MARK: Network

    private static func networkType() -> String {
        var zero = sockaddr_in()
        zero.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        zero.sin_family = sa_family_t(AF_INET)
        let reachability = withUnsafePointer(to: &zero) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                SCNetworkReachabilityCreateWithAddress(nil, $0)
            }
        }
        guard let reachability else { return "none" }
        var flags = SCNetworkReachabilityFlags()
        guard SCNetworkReachabilityGetFlags(reachability, &flags), flags.contains(.reachable) else { return "none" }
        return flags.contains(.isWWAN) ? "cellular" : "wifi"
    }

    private static func networkSection() -> [String: Any] {
        var vpn = false
        var proxy = false
        if let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? [String: Any] {
            // The scoped section lists the interfaces traffic is routed through. A VPN shows up as a
            // tunnel interface there (the always-present system utun interfaces do not).
            if let scoped = settings["__SCOPED__"] as? [String: Any] {
                for interface in scoped.keys {
                    for marker in ["tap", "tun", "ppp", "ipsec"]
                    where interface.range(of: marker, options: .caseInsensitive) != nil {
                        vpn = true
                    }
                }
            }
            proxy = (settings["HTTPEnable"] as? NSNumber)?.boolValue == true
                || (settings["HTTPSEnable"] as? NSNumber)?.boolValue == true
        }
        return [
            "type": networkType(),
            "is_vpn_active": vpn,
            "is_proxy_configured": proxy
        ]
    }

    // MARK: Scam signals

    private static func isScreenCaptured() -> Bool {
        onMain {
            UIApplication.shared.connectedScenes.contains { scene in
                (scene as? UIWindowScene)?.screen.isCaptured == true
            }
        }
    }

    private static func scamSection() -> [String: Any] {
        [
            "is_screen_shared_or_recorded": isScreenCaptured(),
            // iOS does not let an app see which other apps are running.
            "remote_access_app_running": false
        ]
    }

    // MARK: Location

    /// The last known location, only when the app already holds the permission. This never prompts.
    private static func locationSection() -> [String: Any]? {
        onMain {
            let manager = CLLocationManager()
            let status = manager.authorizationStatus
            guard status == .authorizedWhenInUse || status == .authorizedAlways,
                  let location = manager.location else { return nil }
            return [
                "lat": location.coordinate.latitude,
                "lng": location.coordinate.longitude,
                "accuracy_m": location.horizontalAccuracy,
                "is_mock": location.sourceInformation?.isSimulatedBySoftware ?? false
            ]
        }
    }
}
