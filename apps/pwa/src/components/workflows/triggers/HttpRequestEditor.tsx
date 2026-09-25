// Surface-unification ROADMAP §B3 (2026-05-11) — HTTP request form
// for the `http` node variant (N4.3 schema). Co-located in the triggers/
// folder despite not being a "trigger" — the editor surface is identical
// to the real triggers (method/url/auth shape) so file-disjoint slicing
// keeps them together.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';

const AUTO_SAVE_DEBOUNCE_MS = 500;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
type Method = (typeof METHODS)[number];
type AuthKind = 'none' | 'bearer' | 'basic';

interface HttpHeader {
  key: string;
  value: string;
}

interface HttpPayload {
  method: Method;
  url: string;
  headers: HttpHeader[];
  body: string;
  auth: AuthKind;
  token?: string;
  username?: string;
  password?: string;
  timeoutMs: number;
}

interface HttpRequestEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

function readPayload(node: Record<string, unknown> | undefined): HttpPayload {
  const raw = node?.['http'];
  if (!raw || typeof raw !== 'object') {
    return {
      method: 'GET',
      url: 'https://api.example.com/items',
      headers: [],
      body: '',
      auth: 'none',
      timeoutMs: 30000,
    };
  }
  const p = raw as Record<string, unknown>;
  const method: Method = METHODS.includes(p['method'] as Method) ? (p['method'] as Method) : 'GET';
  const url = typeof p['url'] === 'string' ? (p['url'] as string) : '';
  const headersObj = p['headers'] && typeof p['headers'] === 'object' ? (p['headers'] as Record<string, unknown>) : {};
  const headers: HttpHeader[] = Object.entries(headersObj)
    .filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => ({ key: k, value: v as string }));
  const body = typeof p['body'] === 'string' ? (p['body'] as string) : '';
  const timeoutMs = typeof p['timeout'] === 'number' ? (p['timeout'] as number) : 30000;
  const a = p['auth'] && typeof p['auth'] === 'object' ? (p['auth'] as Record<string, unknown>) : null;
  if (a && a['type'] === 'bearer') {
    return { method, url, headers, body, auth: 'bearer', token: typeof a['token'] === 'string' ? (a['token'] as string) : '', timeoutMs };
  }
  if (a && a['type'] === 'basic') {
    return {
      method,
      url,
      headers,
      body,
      auth: 'basic',
      username: typeof a['username'] === 'string' ? (a['username'] as string) : '',
      password: typeof a['password'] === 'string' ? (a['password'] as string) : '',
      timeoutMs,
    };
  }
  return { method, url, headers, body, auth: 'none', timeoutMs };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  p: HttpPayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = { method: p.method, url: p.url };
  if (p.headers.length > 0) {
    const headers: Record<string, string> = {};
    for (const h of p.headers) {
      if (h.key.trim()) headers[h.key.trim()] = h.value;
    }
    if (Object.keys(headers).length > 0) compact['headers'] = headers;
  }
  if (p.body.trim()) compact['body'] = p.body;
  if (p.auth === 'bearer' && p.token) {
    compact['auth'] = { type: 'bearer', token: p.token };
  } else if (p.auth === 'basic' && (p.username || p.password)) {
    compact['auth'] = { type: 'basic', username: p.username ?? '', password: p.password ?? '' };
  }
  if (p.timeoutMs && p.timeoutMs !== 30000) compact['timeout'] = p.timeoutMs;
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, http: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function validateHttpUrl(url: string): { ok: boolean; message: string } {
  if (!url.trim()) return { ok: false, message: 'url required' };
  try {
    new URL(url);
    return { ok: true, message: 'url ok' };
  } catch {
    return { ok: false, message: 'invalid URL' };
  }
}

export function HttpRequestEditor({ definition, nodeId, onChange }: HttpRequestEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [method, setMethod] = useState<Method>(initial.method);
  const [url, setUrl] = useState<string>(initial.url);
  const [headers, setHeaders] = useState<HttpHeader[]>(initial.headers);
  const [body, setBody] = useState<string>(initial.body);
  const [auth, setAuth] = useState<AuthKind>(initial.auth);
  const [token, setToken] = useState<string>(initial.token ?? '');
  const [username, setUsername] = useState<string>(initial.username ?? '');
  const [password, setPassword] = useState<string>(initial.password ?? '');
  const [timeoutMs, setTimeoutMs] = useState<number>(initial.timeoutMs);

  useEffect(() => {
    const p = readPayload(node);
    setMethod(p.method);
    setUrl(p.url);
    setHeaders(p.headers);
    setBody(p.body);
    setAuth(p.auth);
    setToken(p.token ?? '');
    setUsername(p.username ?? '');
    setPassword(p.password ?? '');
    setTimeoutMs(p.timeoutMs);
  }, [nodeId, node]);

  const build = useCallback(
    (): HttpPayload => ({ method, url, headers, body, auth, token, username, password, timeoutMs }),
    [method, url, headers, body, auth, token, username, password, timeoutMs],
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

  const urlCheck = validateHttpUrl(url);
  const validationStatus = urlCheck.ok ? 'valid' : 'error';

  const updateHeader = (i: number, key: string, value: string) => {
    setHeaders((prev) => prev.map((h, idx) => (idx === i ? { key, value } : h)));
  };
  const addHeader = () => setHeaders((prev) => [...prev, { key: '', value: '' }]);
  const removeHeader = (i: number) => setHeaders((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <TriggerEditorBase variantLabel="HTTP" validationStatus={validationStatus} validationMessage={urlCheck.message}>
      <TriggerField label="method">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
      </TriggerField>
      <TriggerField label="timeout (ms)" hint={`= ${Math.round(timeoutMs / 1000)}s`}>
        <input
          type="number"
          min={1000}
          max={120000}
          step={1000}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(Number(e.target.value))}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="url" full hint="supports $ARGUMENTS variable">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/items"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="headers" full>
        <div className="flex flex-col gap-1">
          {headers.map((h, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={h.key}
                onChange={(e) => updateHeader(i, e.target.value, h.value)}
                placeholder="Accept"
                spellCheck={false}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px]"
              />
              <input
                value={h.value}
                onChange={(e) => updateHeader(i, h.key, e.target.value)}
                placeholder="application/json"
                spellCheck={false}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px]"
              />
              <button
                type="button"
                onClick={() => removeHeader(i)}
                className="rounded px-1.5 text-[11px] text-text-tertiary hover:bg-error/10 hover:text-error"
                aria-label="Remove header"
              >×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={addHeader}
            className="self-start rounded-md border border-border px-2 py-0.5 text-[10px] text-text-tertiary hover:bg-surface"
          >+ header</button>
        </div>
      </TriggerField>
      <TriggerField label="body (string)" full hint={method === 'GET' || method === 'HEAD' ? 'usually empty for GET/HEAD' : 'JSON / raw text'}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          spellCheck={false}
          className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="auth" full>
        <div className="flex gap-2 text-xs">
          {(['none', 'bearer', 'basic'] as AuthKind[]).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="radio" name="http-auth" checked={auth === k} onChange={() => setAuth(k)} />
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
