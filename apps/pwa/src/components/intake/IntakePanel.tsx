'use client';

// PR #2 — page-agnostic intake panel.
//
// 기존 `/intake` page.tsx 의 본문 전체를 컴포넌트로 추출.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IntakeList } from './IntakeList';
import { IntakeDetail } from './IntakeDetail';
import { IntakeComposer } from './IntakeComposer';
import {
  IntakeApi,
  type IntakeAction,
  type IntakeDetail as IntakeDetailT,
  type IntakeEvent,
  type IntakeReviewView,
  type IntakeSession,
} from '@/lib/intake-api';
import { toast } from 'sonner';
import { debugLog } from '@/lib/debug';

const STATES = ['', 'captured', 'clarifying', 'review-ready', 'proposed', 'applied', 'scheduled', 'archived'];
const SOURCES = ['', 'scratch', 'telegram', 'discord', 'voice', 'api'];

export function IntakePanel() {
  const { client } = useDaemon();
  const api = useMemo(() => new IntakeApi(client), [client]);

  const [sessions, setSessions] = useState<IntakeSession[]>([]);
  const [q, setQ] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<IntakeDetailT | null>(null);
  const [view, setView] = useState<IntakeReviewView['view'] | null>(null);
  const [events, setEvents] = useState<IntakeEvent[]>([]);

  const refreshList = useCallback(async (): Promise<void> => {
    debugLog('webterm.intake.list.refresh', { q, stateFilter, sourceFilter });
    setBusy(true);
    try {
      const res = await api.list({ q: q || undefined, state: stateFilter || undefined, source: sourceFilter || undefined });
      setSessions(res.sessions ?? []);
    } catch (err) {
      toast.error(`intake list failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [api, q, stateFilter, sourceFilter]);

  const open = useCallback(
    async (id: string): Promise<void> => {
      debugLog('webterm.intake.detail.open', { id });
      setBusy(true);
      try {
        const [d, r, e] = await Promise.all([api.detail(id), api.reviewView(id), api.events(id)]);
        setSelected(d);
        setView(r.view);
        setEvents([...(e.events ?? [])].reverse());
      } catch (err) {
        toast.error(`intake open failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const handleCreate = async (text: string, mode: string, scheduleText?: string): Promise<void> => {
    setBusy(true);
    try {
      const payload: { text: string; mode?: string; scheduleText?: string } = { text };
      if (mode !== 'review') payload.mode = mode;
      if (scheduleText) payload.scheduleText = scheduleText;
      const created = await api.create(payload as Parameters<IntakeApi['create']>[0]);
      toast.success(`captured ${created.intakeId}`);
      await refreshList();
      await open(created.intakeId);
    } catch (err) {
      toast.error(`create failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAnswer = async (qid: string, answer: string): Promise<void> => {
    if (!selected) return;
    await api.mutate(selected.intakeId, 'answer', { questionId: qid, answer });
    await open(selected.intakeId);
  };

  const handleAction = async (action: IntakeAction): Promise<void> => {
    const value = action.value;
    if (!value || !value.intakeId) return;
    debugLog('webterm.intake.action', { kind: value.kind });
    switch (value.kind) {
      case 'decide-apply-now':
        await api.mutate(value.intakeId, 'decide', { mode: 'apply-now' });
        await api.mutate(value.intakeId, 'apply', {});
        break;
      case 'decide-backlog-only':
        await api.mutate(value.intakeId, 'decide', { mode: 'backlog-only' });
        break;
      case 'propose':
        await api.mutate(value.intakeId, 'propose', {});
        break;
      case 'apply':
        await api.mutate(value.intakeId, 'apply', {});
        break;
      case 'archive':
        await api.mutate(value.intakeId, 'archive', {});
        setSelected(null);
        setView(null);
        setEvents([]);
        await refreshList();
        return;
      case 'review':
        await open(value.intakeId);
        return;
    }
    if (selected) await open(selected.intakeId);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Intake</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void refreshList();
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title · summary · raw"
            className="flex-1 min-w-[180px]"
          />
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s || 'All states'}
              </option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s || 'All sources'}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={busy}>
            Search
          </Button>
        </form>
      </header>

      <IntakeComposer onSubmit={handleCreate} busy={busy} />

      {selected && view ? (
        <IntakeDetail
          detail={selected}
          view={view}
          events={events}
          onAnswer={handleAnswer}
          onAction={handleAction}
          onReplay={async () => {
            const replayed = await api.mutate(selected.intakeId, 'replay', {});
            await refreshList();
            await open(replayed.intakeId);
          }}
          onRefresh={() => open(selected.intakeId)}
          onBack={() => {
            setSelected(null);
            setView(null);
            setEvents([]);
          }}
        />
      ) : (
        <IntakeList sessions={sessions} onOpen={open} />
      )}
    </div>
  );
}
