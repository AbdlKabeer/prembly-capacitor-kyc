import { PremblyWorkflow } from '../PremblyWorkflow';
import { openHostedScreen } from '../hostedScreen';

jest.mock('../nativeDevice', () => ({
  nativePlatform: () => 'ios',
  collectNativeDevice: async () => null,
}));
jest.mock('../workflowSession', () => ({
  createWorkflowSession: async () => ({ sessionId: 'wf_session_1', link: 'https://hosted.example/?session=wf_session_1' }),
  PremblyWorkflowError: class extends Error {},
}));
jest.mock('../hostedScreen', () => ({ openHostedScreen: jest.fn() }));

const options = {
  publishableKey: 'test_pk_abc',
  workflowId: 'wf_1',
  customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
};
const message = (type: string, session = 'wf_session_1') =>
  JSON.stringify({ source: 'prembly-workflow-sdk', type, session_id: session });

// A hosted screen the test can send messages to; closing it reports `onClosed`, like the real one.
function fakeScreen() {
  let handlers!: { onMessage: (raw: string) => void; onClosed: () => void };
  (openHostedScreen as jest.Mock).mockImplementation(async (args) => {
    handlers = args;
    return { close: jest.fn(async () => args.onClosed()) };
  });
  return { send: (raw: string) => handlers.onMessage(raw) };
}

describe("the widget's own Cancel", () => {
  it('closes the flow and reports cancelled with the event before it', async () => {
    const screen = fakeScreen();
    const callback = jest.fn();
    const onEvent = jest.fn();
    await PremblyWorkflow.start({ ...options, callback, onEvent });

    screen.send(message('processing'));
    screen.send(message('cancelled'));

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      status: 'cancelled',
      sessionId: 'wf_session_1',
      lastEvent: 'processing',
    });
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual(['processing', 'cancelled']);
  });

  it('is ignored when it is about another session', async () => {
    const screen = fakeScreen();
    const callback = jest.fn();
    await PremblyWorkflow.start({ ...options, callback });

    screen.send(message('cancelled', 'someone_else'));

    expect(callback).not.toHaveBeenCalled();
  });
});
