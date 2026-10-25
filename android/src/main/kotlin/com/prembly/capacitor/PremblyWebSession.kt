package com.prembly.capacitor

import java.lang.ref.WeakReference
import java.net.URI
import java.util.Locale

/** Origins as a browser writes them: scheme and host in lower case, the port only when not the default. */
internal object WebOrigins {
  fun isWeb(url: String): Boolean =
    runCatching { URI(url).scheme?.lowercase(Locale.ROOT) in setOf("http", "https") }
      .getOrDefault(false)

  fun of(url: String): String =
    runCatching {
        val uri = URI(url)
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return ""
        val host = uri.host?.lowercase(Locale.ROOT) ?: return ""
        val default = if (scheme == "https") 443 else 80
        val port = if (uri.port == -1 || uri.port == default) "" else ":${uri.port}"
        "$scheme://$host$port"
      }
      .getOrDefault("")

  /** An origin the caller wrote ("https://Example.com:443") in the form `of` produces. */
  fun normalise(origin: String): String = of(origin)
}

/**
 * The one open web view and the plugin that opened it. The screen is its own activity, so the two
 * talk through here: the page's messages go to the plugin, and the plugin's script and close
 * requests go to the screen.
 */
internal object PremblyWebSession {

  data class Config(
    val url: String,
    val documentStartScript: String,
    val allowedOrigin: String,
    val title: String,
  )

  interface Listener {
    fun onMessage(data: String)

    fun onClosed()
  }

  @Volatile var config: Config? = null
    private set

  @Volatile private var listener: Listener? = null
  private var screen: WeakReference<PremblyWebActivity>? = null

  val isOpen: Boolean
    get() = config != null

  @Synchronized
  fun begin(config: Config, listener: Listener) {
    this.config = config
    this.listener = listener
  }

  @Synchronized
  fun attach(activity: PremblyWebActivity) {
    screen = WeakReference(activity)
  }

  fun message(data: String) {
    listener?.onMessage(data)
  }

  fun evaluate(script: String) {
    screen?.get()?.runScript(script)
  }

  fun close() {
    screen?.get()?.finish()
  }

  /** The screen is gone. Tell the plugin once and forget it all. */
  @Synchronized
  fun closed() {
    val last = listener
    config = null
    listener = null
    screen = null
    last?.onClosed()
  }
}
