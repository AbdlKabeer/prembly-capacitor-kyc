# prembly-capacitor-kyc

Prembly for Ionic and Capacitor apps (Angular, React, Vue or plain JS): the Identity KYC widget,
Workflows and Transaction Monitoring, with the **real device id and signals read from the phone**.

It is the Capacitor twin of `prembly-react-native-identity-kyc`: the same options, the same events and
the same data sent to Prembly. The hosted Prembly pages open in a native web view that the plugin
owns, so the phone's data reaches them safely (see [Privacy](#privacy)).

Requires Capacitor 8, iOS 15+, Android 7+ (API 24), and a **publishable** key (`live_pk_` or
`test_pk_`). Never put a secret key in an app.

## Install

```bash
npm install prembly-capacitor-kyc
npx cap sync
```

### iOS

Add to `Info.plist` the reasons shown when a verification step needs the camera or microphone:

```xml
<key>NSCameraUsageDescription</key>
<string>The camera is used to verify your identity.</string>
<key>NSMicrophoneUsageDescription</key>
<string>The microphone is used for the liveness check.</string>
```

### Android

Nothing to add. The library's manifest brings `ACCESS_NETWORK_STATE`, `DETECT_SCREEN_RECORDING`
(normal permissions, no prompt), `CAMERA` and `RECORD_AUDIO` (asked for only when a step needs them),
and a short `<queries>` list of remote-access and root apps it checks by package name. It does not use
`QUERY_ALL_PACKAGES`.

## Usage

### Workflow

```ts
import { PremblyWorkflow } from 'prembly-capacitor-kyc';

const handle = await PremblyWorkflow.start({
  publishableKey: 'test_pk_...',
  workflowId: 'wf_...',
  customer: { firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com' },
  onEvent: (event) => console.log(event.type),
  callback: (result) => console.log(result.status), // completed | rejected | ... | cancelled | failed
});
// handle.close() dismisses the screen.
```

### Identity KYC widget

```ts
import { PremblyIdentityKyc } from 'prembly-capacitor-kyc';

await PremblyIdentityKyc.open({
  widgetKey: '...',
  widgetId: '...',
  email: 'ada@example.com',
  callback: (response) => console.log(response.status), // success | closed | api_error | ...
});
```

### Transaction Monitoring

```ts
import { PremblyTM } from 'prembly-capacitor-kyc';

PremblyTM.init({ publishableKey: 'live_pk_...' });
PremblyTM.identify('customer-123');
const session = await PremblyTM.getDeviceSession(); // send session.deviceSessionId from your backend
```

### Testing against a local or staging environment

`PremblyWorkflow.start` takes `baseUrl` (the API) and `hostedUrl` (the hosted widget). A plain-http
local page works on Android only if your app allows cleartext traffic
(`android:usesCleartextTraffic="true"` or `server.cleartext` in `capacitor.config`); on iOS add an App
Transport Security exception. On the Android emulator, `adb reverse tcp:8000 tcp:8000` makes
`localhost` reach your machine.

## Privacy

- The device data is read on the phone and handed only to the hosted page on **exactly the origin it
  was opened from** (`https://sdk-live.prembly.com` by default). The web view does not leave that
  origin: other links open in the system browser, so a page from another site never gets the bridge.
- It is reported as `client_reported`: a modified app can lie, and Prembly treats it that way.
- Location is never read by the widget flows. Transaction Monitoring reads it only when you enable it
  and the app already holds the permission; the library never prompts for it.

## API

<docgen-index>

* [`getAppInfo()`](#getappinfo)
* [`getDeviceId()`](#getdeviceid)
* [`collectSignals(...)`](#collectsignals)
* [`checkScreenCapture()`](#checkscreencapture)
* [`openWebView(...)`](#openwebview)
* [`evaluateScript(...)`](#evaluatescript)
* [`closeWebView()`](#closewebview)
* [`addListener('webViewMessage', ...)`](#addlistenerwebviewmessage-)
* [`addListener('webViewClosed', ...)`](#addlistenerwebviewclosed-)
* [`removeAllListeners()`](#removealllisteners)
* [Interfaces](#interfaces)
* [Type Aliases](#type-aliases)

</docgen-index>

<docgen-api>
<!--Update the source file JSDoc comments and rerun docgen to update the docs below-->

The native half of the library. It reads the phone, and shows a hosted page in a full-screen web
view. Most apps use `PremblyIdentityKyc`, `PremblyWorkflow` and `PremblyTM` instead of calling it.

### getAppInfo()

```typescript
getAppInfo() => Promise<AppInfo>
```

The host app's identifier, version and build.

**Returns:** <code>Promise&lt;<a href="#appinfo">AppInfo</a>&gt;</code>

--------------------


### getDeviceId()

```typescript
getDeviceId() => Promise<{ deviceId: string; }>
```

The app-scoped device ID. It is created on first use and then kept: in the Keychain on iOS (this
device only) and in a backup-excluded file on Android.

**Returns:** <code>Promise&lt;{ deviceId: string; }&gt;</code>

--------------------


### collectSignals(...)

```typescript
collectSignals(options: { includeLocation: boolean; }) => Promise<{ signals: SignalBundle; }>
```

The signal sections: `device`, `integrity`, `network`, `scam_signals` and, only when
`includeLocation` is true and the app already holds the location permission, `location`. The
library never asks for a permission itself.

| Param         | Type                                       |
| ------------- | ------------------------------------------ |
| **`options`** | <code>{ includeLocation: boolean; }</code> |

**Returns:** <code>Promise&lt;{ signals: <a href="#signalbundle">SignalBundle</a>; }&gt;</code>

--------------------


### checkScreenCapture()

```typescript
checkScreenCapture() => Promise<{ is_screen_shared_or_recorded: boolean; }>
```

Whether the screen is being recorded, cast or mirrored right now. Cheap to call repeatedly.

**Returns:** <code>Promise&lt;{ is_screen_shared_or_recorded: boolean; }&gt;</code>

--------------------


### openWebView(...)

```typescript
openWebView(options: OpenWebViewOptions) => Promise<void>
```

Open a hosted page in a full-screen web view. Rejects if one is already open.

| Param         | Type                                                              |
| ------------- | ----------------------------------------------------------------- |
| **`options`** | <code><a href="#openwebviewoptions">OpenWebViewOptions</a></code> |

--------------------


### evaluateScript(...)

```typescript
evaluateScript(options: { script: string; }) => Promise<void>
```

Run JavaScript in the open web view. Does nothing if none is open.

| Param         | Type                             |
| ------------- | -------------------------------- |
| **`options`** | <code>{ script: string; }</code> |

--------------------


### closeWebView()

```typescript
closeWebView() => Promise<void>
```

Close the open web view. Does nothing if none is open.

--------------------


### addListener('webViewMessage', ...)

```typescript
addListener(eventName: 'webViewMessage', listener: (event: { data: string; }) => void) => Promise<PluginListenerHandle>
```

A message the page sent to the app (`data` is the text it posted).

| Param           | Type                                               |
| --------------- | -------------------------------------------------- |
| **`eventName`** | <code>'webViewMessage'</code>                      |
| **`listener`**  | <code>(event: { data: string; }) =&gt; void</code> |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### addListener('webViewClosed', ...)

```typescript
addListener(eventName: 'webViewClosed', listener: () => void) => Promise<PluginListenerHandle>
```

The web view was closed, by the person or by `closeWebView`.

| Param           | Type                         |
| --------------- | ---------------------------- |
| **`eventName`** | <code>'webViewClosed'</code> |
| **`listener`**  | <code>() =&gt; void</code>   |

**Returns:** <code>Promise&lt;<a href="#pluginlistenerhandle">PluginListenerHandle</a>&gt;</code>

--------------------


### removeAllListeners()

```typescript
removeAllListeners() => Promise<void>
```

--------------------


### Interfaces


#### AppInfo

`{ appId, appVersion, appBuild }` for the host app (bundle ID or package name).

| Prop             | Type                |
| ---------------- | ------------------- |
| **`appId`**      | <code>string</code> |
| **`appVersion`** | <code>string</code> |
| **`appBuild`**   | <code>string</code> |


#### SignalBundle

The signals the native side collects, grouped the way the API expects.

| Prop               | Type                                                             |
| ------------------ | ---------------------------------------------------------------- |
| **`device`**       | <code><a href="#record">Record</a>&lt;string, unknown&gt;</code> |
| **`integrity`**    | <code><a href="#record">Record</a>&lt;string, unknown&gt;</code> |
| **`network`**      | <code><a href="#record">Record</a>&lt;string, unknown&gt;</code> |
| **`location`**     | <code><a href="#record">Record</a>&lt;string, unknown&gt;</code> |
| **`scam_signals`** | <code><a href="#record">Record</a>&lt;string, unknown&gt;</code> |


#### OpenWebViewOptions

| Prop                      | Type                | Description                                                                                                                                                                        |
| ------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`url`**                 | <code>string</code> | The page to open. Only `http` and `https` addresses are accepted.                                                                                                                  |
| **`documentStartScript`** | <code>string</code> | JavaScript the web view runs before the page does, in every page it loads. It hands the page the phone's data and sets up the message bridge.                                      |
| **`allowedOrigin`**       | <code>string</code> | The only origin the web view stays on. A link to anywhere else opens in the system browser and the web view does not follow it, so a page from another site never gets the bridge. |
| **`title`**               | <code>string</code> | The title in the screen's top bar.                                                                                                                                                 |


#### PluginListenerHandle

| Prop         | Type                                      |
| ------------ | ----------------------------------------- |
| **`remove`** | <code>() =&gt; Promise&lt;void&gt;</code> |


### Type Aliases


#### Record

Construct a type with a set of properties K of type T

<code>{ [P in K]: T; }</code>

</docgen-api>
