package com.prembly.capacitor

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

/**
 * Reads the phone and shows a hosted page in a full-screen web view. Nothing here asks the person
 * for a permission except the camera and microphone, and only when the page itself asks for them.
 */
@CapacitorPlugin(name = "PremblyDevice")
class PremblyDevicePlugin : Plugin() {

  // The checks touch the file system and system services, so keep them off the main thread.
  private val worker = Executors.newSingleThreadExecutor()

  private val collector by lazy { SignalCollector(context) }

  @PluginMethod
  fun getAppInfo(call: PluginCall) {
    call.resolve(JSObject(collector.appInfo().toString()))
  }

  @PluginMethod
  fun getDeviceId(call: PluginCall) {
    worker.execute {
      try {
        call.resolve(JSObject().put("deviceId", DeviceIdStore.deviceId(context)))
      } catch (error: Throwable) {
        call.reject(error.message ?: "The device ID could not be read.", "device_id_failed")
      }
    }
  }

  @PluginMethod
  fun collectSignals(call: PluginCall) {
    val includeLocation = call.getBoolean("includeLocation", false) ?: false
    worker.execute {
      try {
        val signals = JSObject(collector.collect(includeLocation).toString())
        call.resolve(JSObject().put("signals", signals))
      } catch (error: Throwable) {
        call.reject(error.message ?: "The signals could not be read.", "collect_failed")
      }
    }
  }

  @PluginMethod
  fun checkScreenCapture(call: PluginCall) {
    worker.execute {
      try {
        call.resolve(JSObject(collector.screenCapture().toString()))
      } catch (error: Throwable) {
        call.reject(error.message ?: "The screen could not be checked.", "screen_capture_failed")
      }
    }
  }

  // ---- The web view -----------------------------------------------------------------------

  @PluginMethod
  fun openWebView(call: PluginCall) {
    val url = call.getString("url")
    val allowedOrigin = call.getString("allowedOrigin")
    if (url.isNullOrBlank() || allowedOrigin.isNullOrBlank()) {
      call.reject("url and allowedOrigin are required.", "invalid_request")
      return
    }
    if (!WebOrigins.isWeb(url)) {
      call.reject("Only http and https addresses can be opened.", "invalid_request")
      return
    }
    if (WebOrigins.of(url) != WebOrigins.normalise(allowedOrigin)) {
      call.reject("The page must be on the allowed origin.", "invalid_request")
      return
    }
    if (PremblyWebSession.isOpen) {
      call.reject("A Prembly screen is already open.", "already_open")
      return
    }
    val host = activity
    if (host == null) {
      call.reject("The app has no screen to show this on.", "no_activity")
      return
    }

    PremblyWebSession.begin(
      PremblyWebSession.Config(
        url = url,
        documentStartScript = call.getString("documentStartScript") ?: "",
        allowedOrigin = WebOrigins.normalise(allowedOrigin),
        title = call.getString("title") ?: "",
      ),
      object : PremblyWebSession.Listener {
        override fun onMessage(data: String) {
          notifyListeners("webViewMessage", JSObject().put("data", data))
        }

        override fun onClosed() {
          notifyListeners("webViewClosed", JSObject())
        }
      },
    )
    host.startActivity(Intent(host, PremblyWebActivity::class.java))
    call.resolve()
  }

  @PluginMethod
  fun evaluateScript(call: PluginCall) {
    val script = call.getString("script")
    if (!script.isNullOrEmpty()) PremblyWebSession.evaluate(script)
    call.resolve()
  }

  @PluginMethod
  fun closeWebView(call: PluginCall) {
    PremblyWebSession.close()
    call.resolve()
  }

  override fun handleOnDestroy() {
    worker.shutdown()
    PremblyWebSession.close()
    super.handleOnDestroy()
  }
}
