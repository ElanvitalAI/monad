// Surface-unification ROADMAP §B7 (2026-05-11 · n8n ChatTrigger v1 port)
// — Chat trigger form. v1 = webhook mode minimal: path + bearer auth +
// session mode + streaming toggle. Daemon-side dynamic HTTP route
// registration (POST /v1/workflows/<name>/chat) + ACP streaming bridge
// are BACKLOG follow-ups — this form authors the YAML that those wires
// will pick up.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';

const AUTO_SAVE_DEBOUNCE_MS = 500;

type SessionMode = 'stateless' | 'per-session';
type AuthKind = 'none' | 'bearer';

interface ChatPayload {
  path: string;
  auth: AuthKind;
  token?: string;
  sessionMode: SessionMode;
  streaming: boolean;
}

interface ChatTriggerEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

function readPayload(node: Record<string, unknown> | undefined): ChatPayload {
  const raw = node?.['chatTrigger'];
  if (!raw || typeof raw !== 'object') {
    return { path: '/chat', auth: 'none', sessionMode: 'stateless', streaming: false };
  }
  const p = raw as Record<string, unknown>;
  const path = typeof p['path'] === 'string' ? (p['path'] as string) : '/chat';
  const a = p['auth'] && typeof p['auth'] === 'object' ? (p['auth'] as Record<string, unknown>) : null;
  const auth: AuthKind = a && a['type'] === 'bearer' ? 'bearer' : 'none';
  const token = a && a['type'] === 'bearer' && typeof a['token'] === 'string' ? (a['token'] as string) : '';
  const sessionMode: SessionMode = p['sessionMode'] === 'per-session' ? 'per-session' : 'stateless';
  const streaming = p['streaming'] === true;
  return { path, auth, token, sessionMode, streaming };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  p: ChatPayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = { path: p.path };
  if (p.auth === 'bearer' && p.token) compact['auth'] = { type: 'bearer', token: p.token };
  if (p.sessionMode !== 'stateless') compact['sessionMode'] = p.sessionMode;
  if (p.streaming) compact['streaming'] = true;
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, chatTrigger: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function validateChatPath(path: string): { ok: boolean; message: string } {
  if (!path.trim()) return { ok: false, message: 'path required' };
  if (!path.startsWith('/')) return { ok: false, message: "path must start with '/'" };
  if (/\s/.test(path)) return { ok: false, message: 'no whitespace in path' };
  return { ok: true, message: 'path ok' };
}

export function ChatTriggerEditor({ definition, nodeId, onChange }: ChatTriggerEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [path, setPath] = useState<string>(initial.path);
  const [auth, setAuth] = useState<AuthKind>(initial.auth);
  const [token, setToken] = useState<string>(initial.token ?? '');
  const [sessionMode, setSessionMode] = useState<SessionMode>(initial.sessionMode);
  const [streaming, setStreaming] = useState<boolean>(initial.streaming);

  useEffect(() => {
    const p = readPayload(node);
    setPath(p.path);
    setAuth(p.auth);
    setToken(p.token ?? '');
    setSessionMode(p.sessionMode);
    setStreaming(p.streaming);
  }, [nodeId, node]);

  const build = useCallback(
    (): ChatPayload => ({ path, auth, token, sessionMode, streaming }),
    [path, auth, token, sessionMode, streaming],
  );

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!node) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(writePayload(definition, nodeId, build()));
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [node, nodeId, definition, build, onChange]);

  const pathCheck = validateChatPath(path);
  const validationStatus = pathCheck.ok ? 'valid' : 'error';

  return (
    <TriggerEditorBase variantLabel="Chat" validationStatus={validationStatus} validationMessage={pathCheck.message}>
      <TriggerField label="path" hint={`POST /v1/workflows/<name>${path}`}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/chat"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="session mode">
        <select
          value={sessionMode}
          onChange={(e) => setSessionMode(e.target.value as SessionMode)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          <option value="stateless">stateless</option>
          <option value="per-session">per-session</option>
        </select>
      </TriggerField>
      <TriggerField label="auth" full>
        <div className="flex gap-2 text-xs">
          {(['none', 'bearer'] as AuthKind[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="radio" name="chat-auth" checked={auth === k} onChange={() => setAuth(k)} />
              <span className="text-text-tertiary">{k}</span>
            </label>
          ))}
        </div>
      </TriggerField>
      {auth === 'bearer' && (
        <TriggerField label="token" full>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="bearer token"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
          />
        </TriggerField>
      )}
      <TriggerField label="streaming response" full>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={streaming}
            onChange={(e) => setStreaming(e.target.checked)}
          />
          <span className="text-text-tertiary">
            stream the last-node output as SSE (v2 daemon wire — flag persisted now)
          </span>
        </label>
      </TriggerField>
      <TriggerField label="v2 follow-ups" full>
        <p className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] leading-snug text-text-tertiary">
          v1 = webhook mode minimal. Hosted chat page · AI memory · file upload · multi-response Chat nodes are deferred to v2 (BACKLOG follow-up · per n8n ChatTrigger 961 LOC reference).
        </p>
      </TriggerField>
    </TriggerEditorBase>
  );
}
