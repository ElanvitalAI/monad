// V2.2-2 (2026-05-12) — hosted chat panel.
//
// Mounted at `/app/workflows/chat-ui/?workflow=<name>&token=<bearer>`.
// Self-contained chat UI for external sharing — minimal styling,
// no daemon-coupled chrome, no compaction, no persistence beyond
// component state. The workflow author opts in by adding
// `hostedUi: { enabled: true, bearer: '<token>' }` to their chat
// trigger node.
//
// URL leak = auth leak — the page renders an inline banner so the
// sharer remembers the secret is in the URL (HANDOFF V2.2-2 user
// decision: bearer URL param accepted in exchange for zero-friction
// onboarding).

'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  fetchChatConfig,
  parseSseStream,
  sendChatMessage,
  type HostedChatConfig,
} from '@/lib/hosted-chat-runtime';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  pending?: boolean;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; config: HostedChatConfig }
  | { kind: 'not-found' }
  | { kind: 'error'; reason: string };

export function HostedChatPanel(): ReactElement {
  const search = useSearchParams();
  const workflowName = search.get('workflow') ?? '';
  const token = search.get('token') ?? '';
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(() => `hosted-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (workflowName.length === 0) {
      setLoad({ kind: 'error', reason: 'missing ?workflow= query param' });
      return;
    }
    void fetchChatConfig(workflowName)
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg) setLoad({ kind: 'not-found' });
        else setLoad({ kind: 'ready', config: cfg });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoad({ kind: 'error', reason: msg });
      });
    return () => { cancelled = true; };
  }, [workflowName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async (): Promise<void> => {
    if (load.kind !== 'ready' || sending) return;
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text: trimmed };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', text: '', pending: true }]);
    setInput('');
    setSending(true);
    try {
      const result = await sendChatMessage({
        chatPath: load.config.path,
        message: trimmed,
        sessionId: load.config.sessionMode === 'per-session' ? sessionId : undefined,
        bearer: token.length > 0 ? token : undefined,
        streaming: load.config.streaming,
      });
      if (result.kind === 'buffered') {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, text: result.response, pending: false } : m,
        ));
      } else {
        for await (const frame of result.frames) {
          if (frame.event === 'token') {
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId ? { ...m, text: m.text + frame.data } : m,
            ));
          } else if (frame.event === 'done') {
            let finalText: string | undefined;
            try {
              const parsed = JSON.parse(frame.data) as { response?: string };
              finalText = parsed.response;
            } catch { /* keep accumulated tokens */ }
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? { ...m, text: finalText ?? m.text, pending: false }
                : m,
            ));
          } else if (frame.event === 'error') {
            setMessages((prev) => prev.map((m) =>
              m.id === assistantId
                ? { ...m, text: m.text + `\n[error: ${frame.data}]`, pending: false, role: 'system' }
                : m,
            ));
          }
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, text: `[error: ${reason}]`, pending: false, role: 'system' } : m,
      ));
    } finally {
      setSending(false);
    }
  };

  if (load.kind === 'loading') {
    return <div className="p-6 text-sm text-slate-500">Loading workflow chat…</div>;
  }
  if (load.kind === 'not-found') {
    return (
      <div className="p-6 text-sm">
        <h1 className="text-lg font-medium mb-2">Workflow not found</h1>
        <p className="text-slate-600">
          The workflow <code className="px-1 bg-slate-100 rounded">{workflowName}</code> is not
          available for hosted chat. The workflow author needs to add
          <code className="px-1 bg-slate-100 rounded ml-1">hostedUi: {'{'} enabled: true {'}'}</code>
          to the chat trigger node.
        </p>
      </div>
    );
  }
  if (load.kind === 'error') {
    return (
      <div className="p-6 text-sm">
        <h1 className="text-lg font-medium mb-2 text-red-600">Connection error</h1>
        <p className="text-slate-600">{load.reason}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto px-4">
      <header className="py-3 border-b">
        <h1 className="text-base font-medium">{load.config.workflowName}</h1>
        <p className="text-xs text-slate-500">
          {load.config.streaming ? 'streaming' : 'buffered'} · {load.config.sessionMode}
          {load.config.hostedUi.requiresBearer ? ' · bearer required' : ''}
        </p>
      </header>
      {load.config.hostedUi.requiresBearer && token.length > 0 ? (
        <div className="text-xs px-3 py-2 bg-amber-50 border-b border-amber-200 text-amber-800">
          ⚠ The bearer token is embedded in this URL. Treat this link as a secret — sharing the URL
          gives anyone full access to the workflow.
        </div>
      ) : null}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Type a message to start the conversation.</p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <div className="font-medium text-xs uppercase text-slate-500">
              {m.role}
              {m.pending ? ' · typing…' : null}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-slate-800">{m.text}</pre>
          </div>
        ))}
      </div>
      <div className="py-3 border-t flex gap-2">
        <input
          className="flex-1 px-3 py-2 border rounded text-sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Message…"
          disabled={sending}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || input.trim().length === 0}
          className="px-4 py-2 bg-slate-900 text-white rounded text-sm disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// Re-export the SSE parser so unit tests can import it via the
// component module path without reaching into the lib helper.
export { parseSseStream };
