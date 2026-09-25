// Surface-unification ROADMAP §B2 (2026-05-11) — Webhook trigger form.
// Self-contained variant editor (parallels ScheduleTriggerEditor): the
// caller (WorkflowNodeEditor) routes scheduleTrigger/webhookTrigger to
// the matching form. Schema (src/workflow-runtime/schema.ts §webhook
// Trigger) gates submit; daemon-side dynamic route registration is the
// scheduler-retirement R2 webhook-source.ts pipeline.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';

const AUTO_SAVE_DEBOUNCE_MS = 500;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

type AuthKind = 'none' | 'bearer' | 'basic';

interface WebhookPayload {
  method: Method;
  path: string;
  auth: AuthKind;
  token?: string;
  username?: string;
  password?: string;
}

interface WebhookTriggerEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

function readPayload(node: Record<string, unknown> | undefined): WebhookPayload {
  const raw = node?.['webhookTrigger'];
  if (!raw || typeof raw !== 'object') {
    return { method: 'POST', path: '/hooks/example', auth: 'none' };
  }
  const p = raw as Record<string, unknown>;
  const method: Method = METHODS.includes(p['method'] as Method) ? (p['method'] as Method) : 'POST';
  const path = typeof p['path'] === 'string' ? (p['path'] as string) : '/hooks/example';
  const a = p['auth'] && typeof p['auth'] === 'object' ? (p['auth'] as Record<string, unknown>) : null;
  if (a && a['type'] === 'bearer') {
    return { method, path, auth: 'bearer', token: typeof a['token'] === 'string' ? (a['token'] as string) : '' };
  }
  if (a && a['type'] === 'basic') {
    return {
      method,
      path,
      auth: 'basic',
      username: typeof a['username'] === 'string' ? (a['username'] as string) : '',
      password: typeof a['password'] === 'string' ? (a['password'] as string) : '',
    };
  }
  return { method, path, auth: 'none' };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  payload: WebhookPayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = { method: payload.method, path: payload.path };
  if (payload.auth === 'bearer' && payload.token) {
    compact['auth'] = { type: 'bearer', token: payload.token };
  } else if (payload.auth === 'basic' && (payload.username || payload.password)) {
    compact['auth'] = { type: 'basic', username: payload.username ?? '', password: payload.password ?? '' };
  }
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, webhookTrigger: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function validateWebhookPath(path: string): { ok: boolean; message: string } {
  if (!path.trim()) return { ok: false, message: 'path required' };
  if (!path.startsWith('/')) return { ok: false, message: "path must start with '/'" };
  if (/\s/.test(path)) return { ok: false, message: 'no whitespace in path' };
  return { ok: true, message: 'path ok' };
}

export function WebhookTriggerEditor({ definition, nodeId, onChange }: WebhookTriggerEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [method, setMethod] = useState<Method>(initial.method);
  const [path, setPath] = useState<string>(initial.path);
  const [auth, setAuth] = useState<AuthKind>(initial.auth);
  const [token, setToken] = useState<string>(initial.token ?? '');
  const [username, setUsername] = useState<string>(initial.username ?? '');
  const [password, setPassword] = useState<string>(initial.password ?? '');

  useEffect(() => {
    const p = readPayload(node);
    setMethod(p.method);
    setPath(p.path);
    setAuth(p.auth);
    setToken(p.token ?? '');
    setUsername(p.username ?? '');
    setPassword(p.password ?? '');
  }, [nodeId, node]);

  const build = useCallback(
    (): WebhookPayload => ({ method, path, auth, token, username, password }),
    [method, path, auth, token, username, password],
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

  const pathCheck = validateWebhookPath(path);
  const validationStatus = pathCheck.ok ? 'valid' : 'error';
  const url = `${method} ${path}`;

  return (
    <TriggerEditorBase variantLabel="Webhook" validationStatus={validationStatus} validationMessage={pathCheck.message}>
      <TriggerField label="method">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </TriggerField>
      <TriggerField label="path" hint={`URL: ${url}`}>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/hooks/deploy"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="auth" full>
        <div className="flex gap-2 text-xs">
          {(['none', 'bearer', 'basic'] as AuthKind[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input
                type="radio"
                name="webhook-auth"
                checked={auth === k}
                onChange={() => setAuth(k)}
              />
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
      {auth === 'basic' && (
        <>
          <TriggerField label="username">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
            />
          </TriggerField>
          <TriggerField label="password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
            />
          </TriggerField>
        </>
      )}
    </TriggerEditorBase>
  );
}
