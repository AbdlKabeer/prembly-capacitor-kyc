import { Capacitor } from '@capacitor/core';

import type { AppInfo, SignalBundle } from './definitions';
import { PremblyDevice } from './plugin';
import { SDK_VERSION } from './version';

/** The only origin the widget hands the device data to, unless a link says otherwise. */
export const WIDGET_ORIGIN = 'https://sdk-live.prembly.com';

/** What the phone knows about itself, handed to the page as `window.__PREMBLY_NATIVE_DEVICE__`. */
export interface NativeDeviceData {
  version: 1;
  source: 'native';
  platform: 'ios' | 'android';
  sdkVersion: string;
  /** The app-scoped random ID: Keychain on iOS (survives a reinstall), a no-backup file on Android. */
  deviceId: string;
  /** Where `deviceId` is kept, so the backend knows how long it lasts. */
  deviceIdSource: 'ios_keychain' | 'android_file';
  /** The ID the OS keeps for this app: `identifierForVendor` on iOS, `ANDROID_ID` on Android. */
  platformDeviceId: string | null;
  app: AppInfo;
  /** The same sections and keys the Transaction Monitoring SDK sends. Location is never included. */
  signals: SignalBundle;
}

const DEFAULT_TIMEOUT_MS = 2500;

/** `ios`, `android`, or null in a browser. */
export function nativePlatform(): 'ios' | 'android' | null {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('device read timed out')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Read the device from the native side. Never throws and never waits longer than `timeoutMs`:
 * `null` means "could not read it", and the page then falls back to what the browser can see. It
 * reads no location and shows no prompt.
 */
export async function collectNativeDevice(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<NativeDeviceData | null> {
  const platform = nativePlatform();
  if (!platform) return null;
  try {
    const [id, collected, app] = await withTimeout(
      Promise.all([
        PremblyDevice.getDeviceId(),
        PremblyDevice.collectSignals({ includeLocation: false }),
        PremblyDevice.getAppInfo(),
      ]),
      timeoutMs,
    );
    if (!id?.deviceId) return null;

    const signals = collected?.signals ?? {};
    const platformId = signals.device?.platform_device_id;

    return {
      version: 1,
      source: 'native',
      platform,
      sdkVersion: SDK_VERSION,
      deviceId: id.deviceId,
      deviceIdSource: platform === 'ios' ? 'ios_keychain' : 'android_file',
      platformDeviceId: typeof platformId === 'string' && platformId.length > 0 ? platformId : null,
      app,
      signals,
    };
  } catch {
    return null;
  }
}

/** JSON that is safe to place inside a script: no `</script>`, no line separators. */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * The script the web view runs before the page loads. It sets the device data only when the page's
 * origin is exactly `origin` (the Prembly widget by default), so a page the widget navigates to
 * never receives it.
 */
export function buildNativeDeviceScript(
  data: NativeDeviceData,
  origin: string = WIDGET_ORIGIN,
): string {
  return `(function () {
  try {
    if (window.location.origin === ${safeJson(origin)}) {
      window.__PREMBLY_NATIVE_DEVICE__ = ${safeJson(data)};
    }
  } catch (e) {}
})();`;
}

/**
 * The script that connects the page to the app. It defines `window.PremblyBridge.postMessage(text)`
 * and passes every `message` event the page raises on itself to the app, as text. The hosted
 * widgets report their progress that way.
 */
export function buildBridgeScript(): string {
  return `(function () {
  try {
    if (window.PremblyBridge) return;
    var ios = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.premblyBridge;
    function send(text) {
      if (ios) ios.postMessage(text);
      else if (window.PremblyNative) window.PremblyNative.postMessage(text);
    }
    window.PremblyBridge = { postMessage: send };
    window.addEventListener('message', function (event) {
      try {
        var data = event.data;
        send(typeof data === 'string' ? data : JSON.stringify(data));
      } catch (e) {}
    }, false);
  } catch (e) {}
})();`;
}
