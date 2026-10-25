import UIKit
import WebKit

/// Where a hosted page's origin is read from, the same rule on every platform: scheme, host and
/// port, nothing else.
enum WebOrigins {
    static func of(_ url: URL?) -> String? {
        guard let url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased() else { return nil }
        let defaultPort = scheme == "https" ? 443 : 80
        if let port = url.port, port != defaultPort { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }
}

/// The full-screen web view for a hosted Prembly page. The page is given the phone's data before it
/// loads, and only on the allowed origin: the script is added to the allowed origin's pages alone,
/// and the bridge ignores messages from any other origin. The web view never leaves that origin; a
/// link to anywhere else opens in the system browser instead.
final class PremblyWebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let bridgeName = "premblyBridge"

    private let startUrl: URL
    private let allowedOrigin: String
    private let documentStartScript: String
    private let screenTitle: String
    private let onMessage: (String) -> Void
    private let onClosed: () -> Void
    private var webView: WKWebView!
    private let spinner = UIActivityIndicatorView(style: .large)
    private var didReportClosed = false

    init(url: URL, allowedOrigin: String, documentStartScript: String, title: String,
         onMessage: @escaping (String) -> Void, onClosed: @escaping () -> Void) {
        self.startUrl = url
        self.allowedOrigin = allowedOrigin
        self.documentStartScript = documentStartScript
        self.screenTitle = title
        self.onMessage = onMessage
        self.onClosed = onClosed
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white
        title = screenTitle
        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .close, target: self, action: #selector(closeTapped))

        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let controller = WKUserContentController()
        if !documentStartScript.isEmpty {
            // Runs before the page does, in the main frame only. The script itself checks the origin
            // too, and the page's own origin is what the phone's data is bound to.
            let guarded = "if (location.origin === \(Self.jsString(allowedOrigin))) {\n\(documentStartScript)\n}"
            controller.addUserScript(WKUserScript(source: guarded, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        controller.add(self, name: Self.bridgeName)
        configuration.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        spinner.color = .gray
        spinner.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        spinner.startAnimating()
        webView.load(URLRequest(url: startUrl))
    }

    deinit {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: Self.bridgeName)
    }

    /// Run a script in the page.
    func runScript(_ script: String) {
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    /// Tell the app once that the screen is gone, however it went (the close button, a swipe down,
    /// the page closing it from the app).
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if isBeingDismissed || navigationController?.isBeingDismissed == true { reportClosed() }
    }

    func reportClosed() {
        guard !didReportClosed else { return }
        didReportClosed = true
        onClosed()
    }

    // MARK: Messages from the page

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              WebOrigins.of(message.frameInfo.request.url) == allowedOrigin,
              let body = message.body as? String else { return }
        onMessage(body)
    }

    // MARK: Navigation stays on the allowed origin

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard navigationAction.targetFrame?.isMainFrame ?? true,
              let target = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        if target.scheme == "about" || WebOrigins.of(target) == allowedOrigin {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if let scheme = target.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            UIApplication.shared.open(target)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spinner.stopAnimating() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { spinner.stopAnimating() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        spinner.stopAnimating()
    }

    // MARK: Camera and microphone, for the allowed origin only

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let scheme = origin.protocol.lowercased()
        let port = origin.port
        let defaultPort = scheme == "https" ? 443 : 80
        let value = (port == 0 || port == defaultPort) ? "\(scheme)://\(origin.host.lowercased())"
            : "\(scheme)://\(origin.host.lowercased()):\(port)"
        decisionHandler(value == allowedOrigin ? .grant : .deny)
    }

    private static func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(text.dropFirst().dropLast())
    }
}
