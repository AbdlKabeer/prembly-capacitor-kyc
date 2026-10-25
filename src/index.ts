import { registerPlugin } from '@capacitor/core';

import type { PremblyDevicePlugin } from './definitions';

const PremblyDevice = registerPlugin<PremblyDevicePlugin>('PremblyDevice', {
  web: () => import('./web').then((m) => new m.PremblyDeviceWeb()),
});

export * from './definitions';
export { PremblyDevice };
