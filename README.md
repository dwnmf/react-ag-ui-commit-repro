# react-ag-ui: one host render per streamed delta since 0.0.66

Minimal reproduction for `@assistant-ui/react-ag-ui`. The app is `useAgUiRuntime` with an in-memory `AbstractAgent` that streams 2000 `TEXT_MESSAGE_CONTENT` deltas (20 per `setTimeout` tick, 1 ms apart). It counts two things. `hostRenders` is the number of renders of the component that calls `useAgUiRuntime`. `commits` is the number of commits of a component that reads `state.thread.messages` through `useAuiState`. There is no server, no markdown and no other subscriber.

## Run

```bash
npm install
npm run dev
```

Open the page, click **Stream**, and wait until `done` is `true`. The stats block shows `deltas`, `hostRenders`, `commits` and `seconds`. Query parameters:

- `deltas`, `burst` and `gapMs` shape the stream (default `?deltas=2000&burst=20&gapMs=1`).
- `stable=1` passes the thread view as a stable element, so it does not re-render together with the host.

To compare with the last version that batched updates:

```bash
npm install @assistant-ui/react-ag-ui@0.0.65 @ag-ui/client@0.0.59
```

## Result

Measured in Chromium on a production build (`npm run build && npm run preview`), one run per row. `cpu` is CDP CPU throttling (`Emulation.setCPUThrottlingRate`).

| `@assistant-ui/react-ag-ui` | query | cpu | host renders | commits | seconds |
|---|---|---|---|---|---|
| 0.0.65 | (default) | 1 | 102 | 204 | 0.7 |
| 0.0.65 | (default) | 6 | 99 | 198 | 9.0 |
| 0.0.65 | `stable=1` | 1 | 102 | 102 | 0.8 |
| 0.0.65 | `burst=1` | 1 | 2002 | 4004 | 15.6 |
| 0.1.5 | (default) | 1 | 2005 | 4010 | 1.1 |
| 0.1.5 | (default) | 6 | 2005 | 4010 | 33.5 |
| 0.1.5 | `stable=1` | 1 | 2005 | 2005 | 0.8 |
| 0.1.5 | `burst=1` | 1 | 2005 | 4010 | 16.1 |

0.0.66 gave the same 4010 commits as 0.1.5 with the default query. Host renders were not counted on 0.0.66.

Expected: deltas that arrive in the same task are batched into one render, as in 0.0.65 (100 tasks, about 100 host renders).

Actual: since 0.0.66 each delta gets its own synchronous render of the host, even when 20 deltas arrive in the same task (2005 host renders for 2000 deltas). When each delta arrives in its own task (`burst=1`), both versions render once per delta.

The two commits per render in the default query come from two-phase propagation, and both versions have it. The host commits first, and the message list sees the old text in that commit. Then `useExternalStoreRuntime` applies the new adapter in its effect, and the list commits again with the new text. With `stable=1` there is one commit per host render.

## Cause

[assistant-ui#9146](https://github.com/assistant-ui/assistant-ui/pull/9146) ("read core state through useSyncExternalStore") replaced `notifyUpdate = () => setVersion(v => v + 1)`, which React batches, with `useSyncExternalStore(core.subscribe, core.getSnapshot, ...)` in `useAgUiRuntime`. React renders a store change seen through `useSyncExternalStore` synchronously. As a result, each `AgUiThreadController.publishUpdate()` gets its own render.

In a separate harness on 0.1.3, we coalesced the listener notification to one per frame in `publishUpdate`: the snapshot was invalidated immediately and the listeners were called from `requestAnimationFrame`. That brought the commit count back to the 0.0.65 level. We have not measured that change with this repro.

Versions: `@assistant-ui/react` 0.15.35, `@assistant-ui/core` 0.3.35, `@ag-ui/client` 1.0.4, React 19.3.1.
