import { WebPlugin } from '@capacitor/core';

import type { AppInfo, OpenWebViewOptions, PremblyDevicePlugin, SignalBundle } from './definitions';

const MESSAGE = 'Prembly needs to run inside an iOS or Android app. It is not available in a browser.';

/** What the plugin does in a browser: nothing, and it says so. */
export class PremblyDeviceWeb extends WebPlugin implements PremblyDevicePlugin {
  async getAppInfo(): Promise<AppInfo> {
    throw this.unavailable(MESSAGE);
  }

  async getDeviceId(): Promise<{ deviceId: string }> {
    throw this.unavailable(MESSAGE);
  }

  async collectSignals(_options: { includeLocation: boolean }): Promise<{ signals: SignalBundle }> {
    throw this.unavailable(MESSAGE);
  }

  async checkScreenCapture(): Promise<{ is_screen_shared_or_recorded: boolean }> {
    throw this.unavailable(MESSAGE);
  }

  async openWebView(_options: OpenWebViewOptions): Promise<void> {
    throw this.unavailable(MESSAGE);
  }

  async evaluateScript(_options: { script: string }): Promise<void> {
    throw this.unavailable(MESSAGE);
  }

  async closeWebView(): Promise<void> {
    throw this.unavailable(MESSAGE);
  }
}
