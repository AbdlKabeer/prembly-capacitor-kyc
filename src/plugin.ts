import { registerPlugin } from '@capacitor/core';

import type { PremblyDevicePlugin } from './definitions';

/**
 * The native plugin. In a browser (for example `ionic serve`) there is no phone to read, so the web
 * version refuses every call and the library reports "not available" instead of failing.
 */
export const PremblyDevice = registerPlugin<PremblyDevicePlugin>('PremblyDevice', {
  web: () => import('./web').then((m) => new m.PremblyDeviceWeb()),
});
