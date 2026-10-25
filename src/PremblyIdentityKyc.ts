import { collectNativeDevice, nativePlatform, WIDGET_ORIGIN } from './nativeDevice';
import { openHostedScreen, type HostedScreen } from './hostedScreen';

const INITIATE_URL = 'https://api.prembly.com/api/v1/checker-widget/sdk/sessions/initiate/';

export interface IdentityKycOptions {
  /** Your widget key and the widget's ID, from the dashboard. */
  widgetKey: string;
  widgetId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Extra data stored with the session. */
  metadata?: Record<string, unknown>;
  /**
   * Read the phone's own device ID and details and give them to the widget, so the check sees the
   * real device and not a guess from the browser. On by default. If the phone cannot be read the
   * widget carries on with what the web page can see. No permission is asked for.
   */
  collectDeviceData?: boolean;
  /** Override the API address and the widget page (for testing a staging build). */
  apiUrl?: string;
  widgetUrl?: string;
  /**
   * Called with `{ status }`: `closed`, `error`, `success`, `api_error`, `network_error`,
   * `not_available`, or another event the widget sends. `closed`, `error`, `success`, `api_error`
   * and `network_error` end the flow.
   */
  callback: (response: IdentityKycResponse) => void;
}

export interface IdentityKycResponse {
  status: string;
  message?: string;
  data?: unknown;
}

export interface IdentityKycHandle {
  /** Close the widget. It reports `closed`. */
  close(): Promise<void>;
}

const NOTHING_TO_CLOSE: IdentityKycHandle = { close: async () => undefined };

/**
 * Open the Identity KYC widget in a full-screen view and give it the phone's real device data. The
 * outcome comes through `callback`. This resolves as soon as the widget is on screen, or at once if
 * it could not start.
 */
async function open(options: IdentityKycOptions): Promise<IdentityKycHandle> {
  let ended = false;
  let screen: HostedScreen | null = null;

  const report = (response: IdentityKycResponse, final: boolean) => {
    if (ended) return;
    if (final) ended = true;
    options.callback(response);
  };

  if (!nativePlatform()) {
    report(
      {
        status: 'not_available',
        message: 'The widget needs to run inside an iOS or Android app. It is not available in a browser.',
      },
      true,
    );
    return NOTHING_TO_CLOSE;
  }

  // Read the phone while the session is created. It never fails and is time-limited.
  const devicePromise =
    options.collectDeviceData === false ? Promise.resolve(null) : collectNativeDevice();

  let sessionId: string;
  try {
    const response = await fetch(options.apiUrl ?? INITIATE_URL, {
      method: 'POST',
      headers: { Accept: '*/*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: options.firstName ?? '',
        last_name: options.lastName ?? '',
        email: options.email ?? '',
        phone: options.phone ?? '',
        widget_key: options.widgetKey,
        widget_id: options.widgetId,
        metadata: options.metadata ?? {},
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      report(
        {
          status: 'api_error',
          message: `API call failed with status: ${response.status}. Response: ${text}`,
        },
        true,
      );
      return NOTHING_TO_CLOSE;
    }
    const payload = await response.json();
    if (payload?.status !== true || !payload?.data) {
      report(
        { status: 'api_error', message: payload?.detail || 'Failed to get widget ID from API.' },
        true,
      );
      return NOTHING_TO_CLOSE;
    }
    sessionId = payload.data.session?.session_id ?? payload.data.session_id;
    if (!sessionId) {
      report({ status: 'api_error', message: 'Failed to get widget ID from API.' }, true);
      return NOTHING_TO_CLOSE;
    }
  } catch (error) {
    report(
      {
        status: 'network_error',
        message: `Network error or data parsing error: ${(error as Error)?.message ?? error}`,
      },
      true,
    );
    return NOTHING_TO_CLOSE;
  }

  try {
    const device = await devicePromise;
    const base = options.widgetUrl ?? WIDGET_ORIGIN;
    screen = await openHostedScreen({
      url: `${base.replace(/\/+$/, '')}/?session=${encodeURIComponent(sessionId)}`,
      title: 'Identity Verification',
      device,
      onMessage: (raw) => handleMessage(raw),
      onClosed: () => report({ status: 'closed' }, true),
    });
  } catch (error) {
    report({ status: 'error', message: String((error as Error)?.message ?? error) }, true);
    return NOTHING_TO_CLOSE;
  }

  function handleMessage(raw: string) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      report({ status: 'error', message: `Failed to process message from WebView: ${error}` }, true);
      return;
    }
    if (!data || typeof data !== 'object') return;
    // The widget might send the event name in either `event` or `status`.
    const name = (data.event ?? data.status) as string | undefined;
    if (!name) {
      report({ status: 'unknown_payload', data }, false);
      return;
    }
    switch (name) {
      case 'closed':
        report({ status: 'closed' }, true);
        void screen?.close();
        break;
      case 'error':
        report({ status: 'error', message: data.message as string | undefined }, true);
        void screen?.close();
        break;
      case 'verified':
      case 'success':
        report({ status: 'success', data }, true);
        void screen?.close();
        break;
      default:
        // Forward other events so the developer can see them, without ending the flow.
        report({ status: name, data }, false);
    }
  }

  return { close: () => screen?.close() ?? Promise.resolve() };
}

export const PremblyIdentityKyc = { open };
