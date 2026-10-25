import { WebPlugin } from '@capacitor/core';

import type { PremblyDevicePlugin } from './definitions';

export class PremblyDeviceWeb extends WebPlugin implements PremblyDevicePlugin {
  async echo(options: { value: string }): Promise<{ value: string }> {
    console.log('ECHO', options);
    return options;
  }
}
