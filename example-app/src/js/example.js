import { PremblyDevice, PremblyWorkflow, PremblyIdentityKyc, PremblyTM } from 'prembly-capacitor-kyc';

// Local settings (keys, local backend) live in local-config.js, which is gitignored.
// Copy local-config.example.js to local-config.js and fill it in.
const modules = import.meta.glob('./local-config.js', { eager: true });
const config = modules['./local-config.js']?.default ?? {};

const out = document.getElementById('out');
const show = (value) => {
  out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};
const guard = (fn) => async () => {
  try {
    show('working...');
    await fn();
  } catch (error) {
    show(`error: ${error?.code ?? ''} ${error?.message ?? error}`);
  }
};

document.getElementById('device').onclick = guard(async () => {
  const [id, app, signals] = await Promise.all([
    PremblyDevice.getDeviceId(),
    PremblyDevice.getAppInfo(),
    PremblyDevice.collectSignals({ includeLocation: false }),
  ]);
  show({ ...id, app, signals: signals.signals });
});

document.getElementById('workflow').onclick = guard(async () => {
  const events = [];
  await PremblyWorkflow.start({
    publishableKey: config.publishableKey,
    workflowId: config.workflowId,
    baseUrl: config.baseUrl,
    hostedUrl: config.hostedUrl,
    customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
    onEvent: (event) => {
      events.push(event.type);
      show({ events });
    },
    callback: (result) => show({ events, result }),
  });
});

document.getElementById('identity').onclick = guard(async () => {
  await PremblyIdentityKyc.open({
    widgetKey: config.widgetKey,
    widgetId: config.widgetId,
    email: 'ada@example.com',
    callback: (response) => show(response),
  });
});

document.getElementById('tm').onclick = guard(async () => {
  PremblyTM.init({ publishableKey: config.publishableKey, baseUrl: config.baseUrl });
  show(await PremblyTM.getDeviceSession());
});
