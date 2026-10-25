package com.prembly.capacitor

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.Toolbar
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * The full-screen web view for a hosted Prembly page. The page is given the phone's data before it
 * loads, and only on the allowed origin: the script is registered to run on that origin alone. The
 * web view never leaves that origin; a link to anywhere else opens in the system browser instead,
 * so a page from another site never gets the bridge.
 */
class PremblyWebActivity : AppCompatActivity() {

  private lateinit var webView: WebView
  private lateinit var progress: ProgressBar
  private var config: PremblyWebSession.Config? = null

  @Volatile private var currentUrl: String = ""
  private var pendingPermission: Pair<PermissionRequest, List<String>>? = null
  private var fileCallback: ValueCallback<Array<Uri>>? = null

  private val permissionLauncher =
    registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { results ->
      val pending = pendingPermission
      pendingPermission = null
      if (pending != null) {
        val (request, resources) = pending
        if (results.values.all { it }) request.grant(resources.toTypedArray()) else request.deny()
      }
    }

  private val fileLauncher =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      fileCallback?.onReceiveValue(
        WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
      )
      fileCallback = null
    }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val session = PremblyWebSession.config
    if (session == null) {
      // The app was restarted with this screen still on top and nothing to show.
      finish()
      return
    }
    config = session
    PremblyWebSession.attach(this)

    val toolbar =
      Toolbar(this).apply {
        title = session.title
        setBackgroundColor(Color.WHITE)
        setTitleTextColor(Color.parseColor("#111827"))
        setNavigationIcon(android.R.drawable.ic_menu_close_clear_cancel)
        navigationContentDescription = "Close"
        setNavigationOnClickListener { finish() }
      }
    progress =
      ProgressBar(this).apply {
        isIndeterminate = true
        layoutParams = FrameLayout.LayoutParams(96, 96, Gravity.CENTER)
      }
    webView = WebView(this)
    val content =
      FrameLayout(this).apply {
        addView(
          webView,
          ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        addView(progress)
      }
    val root =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(Color.WHITE)
        addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
      }
    setContentView(root)
    // The app draws edge to edge on recent Android: keep the screen clear of the bars and the notch.
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
        )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }

    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          if (webView.canGoBack()) webView.goBack() else finish()
        }
      },
    )

    configure(session)
    webView.loadUrl(session.url)
  }

  @SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
  private fun configure(session: PremblyWebSession.Config) {
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = false
      allowContentAccess = false
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      // A local or staging page may be plain http; a live one is https and gets no mixed content.
      mixedContentMode =
        if (session.allowedOrigin.startsWith("http://")) WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        else WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }

    // The script (the phone's data and the message bridge) runs before the page does, on the allowed
    // origin only. Older web views without the feature get it as the page starts instead.
    if (session.documentStartScript.isNotEmpty() &&
      WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    ) {
      WebViewCompat.addDocumentStartJavaScript(webView, session.documentStartScript, setOf(session.allowedOrigin))
    }

    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      // Defined as `window.PremblyNative` on the allowed origin only; main-frame messages only.
      WebViewCompat.addWebMessageListener(
        webView,
        "PremblyNative",
        setOf(session.allowedOrigin),
      ) { _, message: WebMessageCompat, _, isMainFrame, _ ->
        if (isMainFrame) PremblyWebSession.message(message.data ?: "")
      }
    } else {
      webView.addJavascriptInterface(
        object {
          @JavascriptInterface
          fun postMessage(data: String) {
            // Without origin rules, only accept it while the page on screen is the allowed one.
            if (WebOrigins.of(currentUrl) == session.allowedOrigin) PremblyWebSession.message(data)
          }
        },
        "PremblyNative",
      )
    }

    webView.webViewClient =
      object : WebViewClient() {
        private val needsManualInjection =
          !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
          if (!request.isForMainFrame) return false
          val target = request.url.toString()
          if (WebOrigins.of(target) == session.allowedOrigin) return false
          openOutside(target)
          return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
          currentUrl = url
          progress.visibility = android.view.View.VISIBLE
          inject(view, url)
        }

        override fun onPageFinished(view: WebView, url: String) {
          currentUrl = url
          progress.visibility = android.view.View.GONE
          inject(view, url)
        }

        private fun inject(view: WebView, url: String) {
          if (needsManualInjection &&
            session.documentStartScript.isNotEmpty() &&
            WebOrigins.of(url) == session.allowedOrigin
          ) {
            view.evaluateJavascript(session.documentStartScript, null)
          }
        }
      }

    webView.webChromeClient =
      object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
          runOnUiThread { handlePermission(request, session) }
        }

        override fun onShowFileChooser(
          view: WebView,
          callback: ValueCallback<Array<Uri>>,
          params: FileChooserParams,
        ): Boolean {
          fileCallback?.onReceiveValue(null)
          fileCallback = callback
          return try {
            fileLauncher.launch(params.createIntent())
            true
          } catch (error: Exception) {
            fileCallback = null
            false
          }
        }
      }
  }

  /** Camera and microphone for the page, asked for when the page asks, and only for the allowed origin. */
  private fun handlePermission(request: PermissionRequest, session: PremblyWebSession.Config) {
    if (WebOrigins.of(request.origin.toString()) != session.allowedOrigin || pendingPermission != null) {
      request.deny()
      return
    }
    val resources = mutableListOf<String>()
    val needed = mutableListOf<String>()
    for (resource in request.resources) {
      when (resource) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
          resources += resource
          needed += Manifest.permission.CAMERA
        }
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
          resources += resource
          needed += Manifest.permission.RECORD_AUDIO
        }
      }
    }
    if (resources.isEmpty()) {
      request.deny()
      return
    }
    val missing = needed.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isEmpty()) {
      request.grant(resources.toTypedArray())
    } else {
      pendingPermission = request to resources
      permissionLauncher.launch(missing.toTypedArray())
    }
  }

  private fun openOutside(url: String) {
    runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
  }

  /** Run a script in the page. Called from the plugin, on any thread. */
  fun runScript(script: String) {
    runOnUiThread { if (!isFinishing && ::webView.isInitialized) webView.evaluateJavascript(script, null) }
  }

  override fun onDestroy() {
    if (::webView.isInitialized) {
      (webView.parent as? ViewGroup)?.removeView(webView)
      webView.destroy()
    }
    fileCallback?.onReceiveValue(null)
    fileCallback = null
    if (isFinishing || config != null) PremblyWebSession.closed()
    super.onDestroy()
  }
}
