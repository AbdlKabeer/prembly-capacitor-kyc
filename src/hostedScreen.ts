import type { PluginListenerHandle } from '@capacitor/core';

import { originOf } from './links';
import {
  buildBridgeScript,
  buildNativeDeviceScript,
  type NativeDeviceData,
} from './nativeDevice';
import { PremblyDevice } from './plugin';
import { buildScreenUpdateScript, startScreenWatch } from './screenWatch';

export interface HostedScreenOptions {
  /** The page to show. */
  url: string;
  /** The title in the screen's top bar. */
  title?: string;
  /** The phone's data for the page, or null to show the page with only what the browser can see. */
  device: NativeDeviceData | null;
  /** Every message the page sends the app, as text. */
  onMessage: (data: string) => void;
  /** The screen closed, however it closed. Called once. */
  onClosed: () => void;
}

export interface HostedScreen {
  /** Close the screen. `onClosed` follows. */
  close(): Promise<void>;
}

/**
 * Show a hosted page in a full-screen web view that is given the phone's data before it loads, and
 * keep the page told whether the screen is being recorded. The data goes only to the page's own
 * origin. Rejects if the screen cannot be opened (for example in a browser).
 */
export async function openHostedScreen(options: HostedScreenOptions): Promise<HostedScreen> {
  const origin = originOf(options.url);
  if (!origin) {
    throw new Error('The page address must be an http or https link.');
  }

  const handles: PluginListenerHandle[] = [];
  let stopWatch: (() => void) | undefined;
  let finished = false;

  const finish = async () => {
    if (finished) return;
    finished = true;
    stopWatch?.();
    stopWatch = undefined;
    await Promise.all(handles.splice(0).map((handle) => handle.remove().catch(() => undefined)));
    options.onClosed();
  };

  handles.push(
    await PremblyDevice.addListener('webViewMessage', (event) => {
      if (!finished) options.onMessage(event.data);
    }),
    await PremblyDevice.addListener('webViewClosed', () => {
      void finish();
    }),
  );

  const script =
    buildBridgeScript() + (options.device ? buildNativeDeviceScript(options.device, origin) : '');

  try {
    await PremblyDevice.openWebView({
      url: options.url,
      documentStartScript: script,
      allowedOrigin: origin,
      title: options.title,
    });
  } catch (error) {
    // It never opened, so nothing will close it: take the listeners off and say so.
    finished = true;
    await Promise.all(handles.splice(0).map((handle) => handle.remove().catch(() => undefined)));
    throw error;
  }

  // While the screen is open, keep telling the page whether the screen is being recorded or shared,
  // including a recording that started and stopped.
  const device = options.device;
  if (device) {
    const scam = device.signals.scam_signals;
    stopWatch = startScreenWatch(
      (state) => {
        void PremblyDevice.evaluateScript({ script: buildScreenUpdateScript(state, origin) }).catch(
          () => undefined,
        );
      },
      { alreadySeen: scam?.is_screen_shared_or_recorded === true },
    );
  }

  return {
    close: async () => {
      await PremblyDevice.closeWebView().catch(() => undefined);
    },
  };
}
