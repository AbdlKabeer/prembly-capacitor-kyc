import type { PluginListenerHandle } from '@capacitor/core';

/** `{ appId, appVersion, appBuild }` for the host app (bundle ID or package name). */
export interface AppInfo {
  appId: string;
  appVersion: string;
  appBuild: string;
}

/** The signals the native side collects, grouped the way the API expects. */
export interface SignalBundle {
  device?: Record<string, unknown>;
  integrity?: Record<string, unknown>;
  network?: Record<string, unknown>;
  location?: Record<string, unknown>;
  scam_signals?: Record<string, unknown>;
}

export interface OpenWebViewOptions {
  /** The page to open. Only `http` and `https` addresses are accepted. */
  url: string;
  /**
   * JavaScript the web view runs before the page does, in every page it loads. It hands the page the
   * phone's data and sets up the message bridge.
   */
  documentStartScript?: string;
  /**
   * The only origin the web view stays on. A link to anywhere else opens in the system browser and
   * the web view does not follow it, so a page from another site never gets the bridge.
   */
  allowedOrigin: string;
  /** The title in the screen's top bar. */
  title?: string;
}

/**
 * The native half of the library. It reads the phone, and shows a hosted page in a full-screen web
 * view. Most apps use `PremblyIdentityKyc`, `PremblyWorkflow` and `PremblyTM` instead of calling it.
 */
export interface PremblyDevicePlugin {
  /** The host app's identifier, version and build. */
  getAppInfo(): Promise<AppInfo>;

  /**
   * The app-scoped device ID. It is created on first use and then kept: in the Keychain on iOS (this
   * device only) and in a backup-excluded file on Android.
   */
  getDeviceId(): Promise<{ deviceId: string }>;

  /**
   * The signal sections: `device`, `integrity`, `network`, `scam_signals` and, only when
   * `includeLocation` is true and the app already holds the location permission, `location`. The
   * library never asks for a permission itself.
   */
  collectSignals(options: { includeLocation: boolean }): Promise<{ signals: SignalBundle }>;

  /** Whether the screen is being recorded, cast or mirrored right now. Cheap to call repeatedly. */
  checkScreenCapture(): Promise<{ is_screen_shared_or_recorded: boolean }>;

  /** Open a hosted page in a full-screen web view. Rejects if one is already open. */
  openWebView(options: OpenWebViewOptions): Promise<void>;

  /** Run JavaScript in the open web view. Does nothing if none is open. */
  evaluateScript(options: { script: string }): Promise<void>;

  /** Close the open web view. Does nothing if none is open. */
  closeWebView(): Promise<void>;

  /** A message the page sent to the app (`data` is the text it posted). */
  addListener(
    eventName: 'webViewMessage',
    listener: (event: { data: string }) => void,
  ): Promise<PluginListenerHandle>;

  /** The web view was closed, by the person or by `closeWebView`. */
  addListener(eventName: 'webViewClosed', listener: () => void): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}
