import { collectNativeDevice, nativePlatform } from './nativeDevice';
import { openHostedScreen, type HostedScreen } from './hostedScreen';
import { withSession } from './links';
import type {
  WorkflowCustomer,
  WorkflowErrorCode,
  WorkflowEvent,
  WorkflowResult,
  WorkflowSessionInfo,
} from './types';
import { isEndState, parseWorkflowMessage } from './workflowEvents';
import { createWorkflowSession, PremblyWorkflowError } from './workflowSession';

export interface WorkflowStartOptions {
  /** Your public key: `live_pk_...` or `test_pk_...`. A secret key is refused. */
  publishableKey: string;
  workflowId: string;
  customer: WorkflowCustomer;
  metadata?: Record<string, unknown>;
  redirectUrl?: string;
  /** Override the API base URL (for example for a staging server). */
  baseUrl?: string;
  /**
   * Open the workflow at this hosted app instead of the link the backend returns, as
   * `<hostedUrl>?session=<id>`. For testing a local or staging build of the hosted app.
   */
  hostedUrl?: string;
  /**
   * Read the phone's own device ID and details and give them to the workflow, so its device checks
   * see the real device. On by default. No permission is asked for.
   */
  collectDeviceData?: boolean;
  /** Every event the workflow reports. No personal data. */
  onEvent?: (event: WorkflowEvent) => void;
  /** Called once when the flow ends: an end state, `cancelled`, or `failed` if it could not start. */
  callback: (result: WorkflowResult) => void;
}

export interface WorkflowHandle {
  /** Close the workflow. It reports `cancelled` (or its end state, if it had one). */
  close(): Promise<void>;
}

const NOTHING_TO_CLOSE: WorkflowHandle = { close: async () => undefined };

function failure(code: WorkflowErrorCode, message: string): WorkflowResult {
  return { status: 'failed', error: { code, message } };
}

/**
 * Start one of your workflows with your public key and open it in a full-screen view. The phone's
 * real device ID and details go to the workflow before the page loads, only to the page's own
 * origin. The result comes through `callback`, once; this resolves as soon as the workflow is on
 * screen, or at once if it could not start.
 */
async function start(options: WorkflowStartOptions): Promise<WorkflowHandle> {
  let ended = false;
  let lastEvent: string | undefined;
  let session: WorkflowSessionInfo | null = null;
  let screen: HostedScreen | null = null;

  const finish = (result: WorkflowResult) => {
    if (ended) return;
    ended = true;
    options.callback(result);
  };

  if (!nativePlatform()) {
    finish(
      failure(
        'not_available',
        'The workflow needs to run inside an iOS or Android app. It is not available in a browser.',
      ),
    );
    return NOTHING_TO_CLOSE;
  }

  // Read the phone while the session is created. It never fails and is time-limited.
  const devicePromise =
    options.collectDeviceData === false ? Promise.resolve(null) : collectNativeDevice();

  try {
    const created = await createWorkflowSession({
      publishableKey: options.publishableKey,
      workflowId: options.workflowId,
      customer: options.customer,
      metadata: options.metadata,
      redirectUrl: options.redirectUrl,
      baseUrl: options.baseUrl,
    });
    session = options.hostedUrl
      ? { ...created, link: withSession(options.hostedUrl, created.sessionId) }
      : created;
    const device = await devicePromise;

    screen = await openHostedScreen({
      url: session.link,
      title: 'Verification',
      device,
      onMessage: (raw) => {
        const event = parseWorkflowMessage(raw);
        // Only this session's events count; a message about another session is ignored.
        if (!event || !session || event.sessionId !== session.sessionId) return;
        lastEvent = event.type;
        options.onEvent?.(event);
        if (isEndState(event.type)) {
          finish({ status: event.type, sessionId: session.sessionId });
          void screen?.close();
        }
      },
      onClosed: () => {
        // Closed before an end state is a cancel; `lastEvent` says whether the checks were still
        // running (`processing`).
        finish({
          status: 'cancelled',
          sessionId: session?.sessionId ?? '',
          ...(lastEvent ? { lastEvent } : {}),
        });
      },
    });
  } catch (error) {
    if (error instanceof PremblyWorkflowError) {
      finish(failure(error.code, error.message));
    } else {
      finish(failure('network_error', String((error as Error)?.message ?? error)));
    }
    return NOTHING_TO_CLOSE;
  }

  return { close: () => screen?.close() ?? Promise.resolve() };
}

export const PremblyWorkflow = { start };
