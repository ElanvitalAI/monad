'use client';

// PR #2 — page-agnostic control panel.
//
// 기존 `/control` page.tsx 의 본문 전체를 컴포넌트로 추출.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignalGrid } from './SignalGrid';
import {
  CONTROL_URGENCIES,
  ControlSignalsApi,
  isControlUrgency,
  type ControlSignalsResponse,
  type ControlUrgency,
  type EmitSignalPayload,
} from '@/lib/control-signals-api';
import { toast } from 'sonner';
import { debugLog } from '@/lib/debug';

export function ControlPanel() {
  const { client } = useDaemon();
  const api = useMemo(() => new ControlSignalsApi(client), [client]);

  const [response, setResponse] = useState<ControlSignalsResponse>({ items: [] });
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState('');
  const [surface, setSurface] = useState('');
  const [minUrgency, setMinUrgency] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [limit, setLimit] = useState('');

  const [emitKind, setEmitKind] = useState('');
  const [emitUrgency, setEmitUrgency] = useState<ControlUrgency>('normal');
  const [emitSource, setEmitSource] = useState('operator');
  const [emitSurface, setEmitSurface] = useState('');
  const [emitChannel, setEmitChannel] = useState('');
  const [emitSession, setEmitSession] = useState('');
  const [emitPayload, setEmitPayload] = useState('');
  const [emitPreempt, setEmitPreempt] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    debugLog('webterm.control.list.refresh', { kind, surface, minUrgency, sessionId, limit });
    setBusy(true);
    try {
      const r = await api.list({
        kind: kind || undefined,
        surface: surface || undefined,
        minUrgency: minUrgency || undefined,
        sessionId: sessionId || undefined,
        limit: limit || undefined,
      });
      setResponse(r);
    } catch (err) {
      toast.error(`signals list failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [api, kind, surface, minUrgency, sessionId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleEmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!emitKind.trim()) {
      toast.error('kind required');
      return;
    }
    let payload: unknown = {};
    if (emitPayload.trim()) {
      try {
        payload = JSON.parse(emitPayload);
      } catch {
        toast.error('payload must be valid JSON');
        return;
      }
    }
    const body: EmitSignalPayload = {
      kind: emitKind.trim(),
      urgency: emitUrgency,
      source: emitSource.trim() || 'operator',
      mayPreempt: emitPreempt,
      payload,
      scope: {
        ...(emitSurface ? { surface: emitSurface } : {}),
        ...(emitChannel ? { channel: emitChannel } : {}),
        ...(emitSession ? { sessionId: emitSession } : {}),
      },
    };
    debugLog('webterm.control.emit', { kind: body.kind, urgency: body.urgency });
    try {
      setBusy(true);
      await api.emit(body);
      toast.success('signal emitted');
      setEmitPayload('');
      await refresh();
    } catch (err) {
      toast.error(`emit failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  const counts = response.countsByKind ?? {};

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Control signals</h1>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-full border border-border px-2 py-0.5">
            total {response.total ?? 0}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5">
            latest {response.latest ?? '-'}
          </span>
          {Object.entries(counts).map(([k, v]) => (
            <span key={k} className="rounded-full border border-border px-2 py-0.5">
              {k} {v}
            </span>
          ))}
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void refresh();
        }}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 shadow-sm"
      >
        <Input value={kind} onChange={(e) => setKind(e.target.value)} placeholder="kind" className="flex-1 min-w-[140px]" />
        <Input value={surface} onChange={(e) => setSurface(e.target.value)} placeholder="surface" className="flex-1 min-w-[140px]" />
        <select
          value={minUrgency}
          onChange={(e) => setMinUrgency(e.target.value)}
          className="h-9 flex-1 min-w-[170px] rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">min urgency (any)</option>
          {CONTROL_URGENCIES.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <Input
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="session id"
          className="flex-1 min-w-[140px]"
        />
        <Input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="limit"
          type="number"
          className="w-[100px]"
        />
        <Button type="submit" size="sm" disabled={busy}>
          Filter
        </Button>
      </form>

      <form
        onSubmit={handleEmit}
        className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-sm"
      >
        <h2 className="text-sm font-semibold">Emit a signal</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={emitKind} onChange={(e) => setEmitKind(e.target.value)} placeholder="kind (required)" className="flex-1 min-w-[140px]" />
          <select
            value={emitUrgency}
            onChange={(e) => {
              const next = e.target.value;
              if (isControlUrgency(next)) setEmitUrgency(next);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {CONTROL_URGENCIES.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <Input value={emitSource} onChange={(e) => setEmitSource(e.target.value)} placeholder="source" className="flex-1 min-w-[120px]" />
          <Input value={emitSurface} onChange={(e) => setEmitSurface(e.target.value)} placeholder="scope.surface" className="flex-1 min-w-[120px]" />
          <Input value={emitChannel} onChange={(e) => setEmitChannel(e.target.value)} placeholder="scope.channel" className="flex-1 min-w-[120px]" />
          <Input value={emitSession} onChange={(e) => setEmitSession(e.target.value)} placeholder="scope.session" className="flex-1 min-w-[120px]" />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={emitPreempt} onChange={(e) => setEmitPreempt(e.target.checked)} />
            mayPreempt
          </label>
        </div>
        <textarea
          value={emitPayload}
          onChange={(e) => setEmitPayload(e.target.value)}
          placeholder='payload JSON (optional, e.g. {"reason":"manual"})'
          rows={3}
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={busy}>
          Emit
        </Button>
      </form>

      <SignalGrid items={response.items ?? []} />
    </div>
  );
}
