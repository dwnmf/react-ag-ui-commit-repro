// Minimal repro: useAgUiRuntime + an in-memory AG-UI agent that streams text deltas.
// Counts renders of the component that calls useAgUiRuntime (hostRenders) and commits of a
// component subscribed to the thread messages (commits).
// Query params: ?deltas=2000&burst=20&gapMs=1&stable=1
// stable=1 passes the thread tree as a stable element, so it does not re-render with the host.
import { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Observable } from 'rxjs'
import { AbstractAgent, EventType } from '@ag-ui/client'
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState } from '@assistant-ui/react'
import { useAgUiRuntime } from '@assistant-ui/react-ag-ui'

const params = new URLSearchParams(location.search)
const DELTAS = Number(params.get('deltas') ?? 2000)
const BURST = Number(params.get('burst') ?? 20)
const GAP_MS = Number(params.get('gapMs') ?? 1)

const STABLE = params.get('stable') === '1'

const stats = { deltas: 0, hostRenders: 0, commits: 0, startedAt: 0, seconds: null, done: false, error: null }
window.__stats = stats

// Emits RUN_STARTED, TEXT_MESSAGE_START, DELTAS x TEXT_MESSAGE_CONTENT (BURST at a time,
// GAP_MS apart, each burst in its own task like chunks from a network stream),
// TEXT_MESSAGE_END, RUN_FINISHED.
class FakeStreamingAgent extends AbstractAgent {
  run(input) {
    return new Observable((subscriber) => {
      const { threadId, runId } = input
      const messageId = `assistant-${runId}`
      subscriber.next({ type: EventType.RUN_STARTED, threadId, runId })
      subscriber.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' })
      let sent = 0
      let timer = null
      const tick = () => {
        for (let i = 0; i < BURST && sent < DELTAS; i += 1, sent += 1) {
          stats.deltas += 1
          subscriber.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: `t${sent} ` })
        }
        if (sent < DELTAS) {
          timer = setTimeout(tick, GAP_MS)
          return
        }
        subscriber.next({ type: EventType.TEXT_MESSAGE_END, messageId })
        subscriber.next({ type: EventType.RUN_FINISHED, threadId, runId })
        subscriber.complete()
      }
      timer = setTimeout(tick, GAP_MS)
      return () => clearTimeout(timer)
    })
  }
}

const agent = new FakeStreamingAgent()

// The component whose commits are counted: it reads the thread messages, like any message list does.
function MessageList() {
  const messages = useAuiState((state) => state.thread.messages)
  const isRunning = useAuiState((state) => state.thread.isRunning)
  useLayoutEffect(() => {
    stats.commits += 1
  })
  if (stats.startedAt > 0 && !isRunning && messages.length > 1 && !stats.done) {
    stats.done = true
    stats.seconds = (performance.now() - stats.startedAt) / 1000
  }
  return messages.map((message, index) => (
    <ThreadPrimitive.MessageByIndex key={message.id} index={index} components={MESSAGE_COMPONENTS} />
  ))
}

function Message() {
  return (
    <MessagePrimitive.Root>
      <MessagePrimitive.Parts />
    </MessagePrimitive.Root>
  )
}
const MESSAGE_COMPONENTS = { Message }

function ThreadView() {
  return (
    <ThreadPrimitive.Root>
      <MessageList />
    </ThreadPrimitive.Root>
  )
}
const STABLE_THREAD_VIEW = <ThreadView />

function App() {
  const runtime = useAgUiRuntime({ agent })
  stats.hostRenders += 1
  window.__stream = () => {
    stats.hostRenders = 0
    stats.commits = 0
    stats.startedAt = performance.now()
    runtime.thread.append({ role: 'user', content: [{ type: 'text', text: 'stream' }] })
  }
  return <AssistantRuntimeProvider runtime={runtime}>{STABLE ? STABLE_THREAD_VIEW : <ThreadView />}</AssistantRuntimeProvider>
}

createRoot(document.getElementById('root'), {
  onUncaughtError: (error) => {
    stats.error = String(error?.message ?? error)
  },
}).render(<App />)

document.getElementById('stream').addEventListener('click', () => window.__stream())

// Stats are written to the DOM directly, outside React, so they do not add commits.
setInterval(() => {
  document.getElementById('stats').textContent = JSON.stringify(
    {
      deltas: stats.deltas,
      hostRenders: stats.hostRenders,
      commits: stats.commits,
      seconds: stats.seconds,
      done: stats.done,
      error: stats.error,
    },
    null,
    2,
  )
}, 200)
window.__ready = true
