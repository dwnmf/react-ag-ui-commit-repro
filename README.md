# react-ag-ui: two thread commits per streamed delta since 0.0.66

Minimal reproduction for `@assistant-ui/react-ag-ui`. The app is `useAgUiRuntime` with an in-memory `AbstractAgent` that streams 2000 `TEXT_MESSAGE_CONTENT` deltas (20 per `setTimeout` tick, 1 ms apart), and one component that reads `state.thread.messages` through `useAuiState` and counts its own commits. No server, no markdown, no other subscribers.

## Run

```bash
npm install
npm run dev
```

Open the page, click **Stream**, and wait until `done` is `true`. The stats block shows `commits` (commits of the message list component), `deltas` and `seconds`. You can change the stream with `?deltas=2000&burst=20&gapMs=1`.

To compare with the last version that batched updates:

```bash
npm install @assistant-ui/react-ag-ui@0.0.65 @ag-ui/client@0.0.59
```

## Result

Chromium, production build (`npm run build && npm run preview`), `cpu` is CDP CPU throttling (`Emulation.setCPUThrottlingRate`).

| `@assistant-ui/react-ag-ui` | cpu 1: commits / seconds | cpu 6: commits / seconds |
|---|---|---|
| 0.0.65 | 204 / 0.8 | 194 / 14.5 |
| 0.0.66 | 4010 / 1.1 | |
| 0.1.5 | 4010 / 1.1 | 4010 / 41.1, 47.1 |

Expected: many deltas that arrive in a row are batched into one render, as in 0.0.65.
Actual: from 0.0.66 every delta produces two commits of the thread (4010 for 2000 deltas), and the stream takes about 3 times longer under throttling.

## Cause

[assistant-ui#9146](https://github.com/assistant-ui/assistant-ui/pull/9146) ("read core state through useSyncExternalStore") replaced `notifyUpdate = () => setVersion(v => v + 1)`, which React batches, with `useSyncExternalStore(core.subscribe, core.getSnapshot, ...)` in `useAgUiRuntime`. A store update through `useSyncExternalStore` is always rendered synchronously, so each `AgUiThreadController.publishUpdate()` triggers its own render and commit.

Coalescing the listener notification to one per frame in `publishUpdate` (snapshot invalidated immediately, listeners called from `requestAnimationFrame`) brought the commit count back to the 0.0.65 level in our tests.

Versions: `@assistant-ui/react` 0.15.35, `@assistant-ui/core` 0.3.35, `@ag-ui/client` 1.0.4, React 19.3.1.
