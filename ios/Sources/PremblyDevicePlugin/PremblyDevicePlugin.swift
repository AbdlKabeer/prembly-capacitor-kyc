import Capacitor
import Foundation
import UIKit

/// The native half of the library: the phone's own data (real device id, integrity, network, scam
/// signals) and a full-screen web view for the hosted Prembly pages. Nothing leaves the phone from
/// here; the TypeScript layer decides what is sent and to whom.
@objc(PremblyDevicePlugin)
public class PremblyDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PremblyDevicePlugin"
    public let jsName = "PremblyDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAppInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceId", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "collectSignals", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkScreenCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openWebView", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "evaluateScript", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeWebView", returnType: CAPPluginReturnPromise)
    ]

    private weak var webController: PremblyWebViewController?
    private weak var presented: UINavigationController?

    @objc func getAppInfo(_ call: CAPPluginCall) {
        call.resolve(SignalCollector.appInfo())
    }

    @objc func getDeviceId(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .utility).async {
            call.resolve(["deviceId": DeviceIdStore.deviceId()])
        }
    }

    @objc func collectSignals(_ call: CAPPluginCall) {
        let includeLocation = call.getBool("includeLocation") ?? false
        // Off the main thread: the checks touch the file system. The collector hops to the main
        // thread itself for the few UIKit and CoreLocation reads.
        DispatchQueue.global(qos: .utility).async {
            call.resolve(["signals": SignalCollector.collect(includeLocation: includeLocation)])
        }
    }

    @objc func checkScreenCapture(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .utility).async {
            call.resolve(SignalCollector.screenCapture())
        }
    }

    @objc func openWebView(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let allowedOrigin = call.getString("allowedOrigin"),
              !urlString.isEmpty, !allowedOrigin.isEmpty else {
            call.reject("url and allowedOrigin are required.", "invalid_request")
            return
        }
        guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            call.reject("Only http and https addresses can be opened.", "invalid_request")
            return
        }
        guard WebOrigins.of(url) == allowedOrigin else {
            call.reject("The page must be on the allowed origin.", "invalid_request")
            return
        }
        let script = call.getString("documentStartScript") ?? ""
        let title = call.getString("title") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if self.webController != nil {
                call.reject("A Prembly screen is already open.", "already_open")
                return
            }
            guard let host = self.bridge?.viewController else {
                call.reject("The app has no screen to show this on.", "no_activity")
                return
            }
            let controller = PremblyWebViewController(
                url: url, allowedOrigin: allowedOrigin, documentStartScript: script, title: title,
                onMessage: { [weak self] data in self?.notifyListeners("webViewMessage", data: ["data": data]) },
                onClosed: { [weak self] in
                    self?.webController = nil
                    self?.presented = nil
                    self?.notifyListeners("webViewClosed", data: [:])
                })
            let navigation = UINavigationController(rootViewController: controller)
            navigation.modalPresentationStyle = .fullScreen
            self.webController = controller
            self.presented = navigation
            host.present(navigation, animated: true) { call.resolve() }
        }
    }

    @objc func evaluateScript(_ call: CAPPluginCall) {
        guard let script = call.getString("script") else {
            call.reject("script is required.", "invalid_request")
            return
        }
        webController?.runScript(script)
        call.resolve()
    }

    @objc func closeWebView(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let navigation = self.presented else {
                call.resolve()
                return
            }
            navigation.dismiss(animated: true) {
                self.webController?.reportClosed()
                call.resolve()
            }
        }
    }
}
