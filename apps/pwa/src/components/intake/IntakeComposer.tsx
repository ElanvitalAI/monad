'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { AutopilotApi, EXECUTION_MODEL_META, type TriageResult } from '@/lib/autopilot-api';

const MODES = [
  { value: 'review', label: 'Review first' },
  { value: 'apply-now', label: 'Apply now' },
  { value: 'backlog-only', label: 'Backlog only' },
  { value: 'schedule-followup', label: 'Schedule follow-up' },
] as const;

/** Autopilot triage 미리보기 (Phase B3) — 입력 텍스트를 실행모델로 어떻게 라우팅할지
 *  실시간 칩. intake → autopilot 통합: "이 메모를 던지면 monad 가 어떻게 풀지" 힌트.
 *  600ms 디바운스·fail-soft(미리보기 실패가 캡처를 막지 않음). */
function TriagePreview({ text }: { text: string }) {
  const { client } = useDaemon();
  const api = useMemo(() => new AutopilotApi(client), [client]);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const trimmed = text.trim();

  useEffect(() => {
    if (trimmed.length < 4) { setTriage(null); return; }
    let alive = true;
    const h = setTimeout(() => {
      void api.triagePreview(trimmed).then((r) => { if (alive) setTriage(r.triage); }).catch(() => { if (alive) setTriage(null); });
    }, 600);
    return () => { alive = false; clearTimeout(h); };
  }, [api, trimmed]);

  if (!triage) return null;
  const meta = EXECUTION_MODEL_META[triage.executionModel];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">이렇게 풀릴 예정:</span>
      <span className={['rounded px-2 py-0.5 ring-1', meta.tone].join(' ')}>{meta.label}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground ring-1 ring-border">{triage.tier === 'heavy' ? '무거움' : '가벼움'}</span>
      <span className="text-muted-foreground">{triage.rationale}</span>
      <Link href="/autopilot" className="ml-auto text-primary hover:underline">리뷰 건너뛰고 바로 미션화 →</Link>
    </div>
  );
}

interface Props {
  onSubmit: (text: string, mode: string, scheduleText?: string) => void | Promise<void>;
  busy?: boolean;
}

export function IntakeComposer({ onSubmit, busy }: Props) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<string>('review');
  const [scheduleText, setScheduleText] = useState('');

  const submit = async (): Promise<void> => {
    if (!text.trim()) return;
    await onSubmit(text.trim(), mode, mode === 'schedule-followup' ? scheduleText.trim() : undefined);
    setText('');
    setScheduleText('');
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Capture a new intake note</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'- compare two repos\n- investigate image preview bug\n- later maybe absorb this capability'}
        rows={4}
        className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <TriagePreview text={text} />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <Input
          value={scheduleText}
          onChange={(e) => setScheduleText(e.target.value)}
          placeholder="schedule text (when follow-up)"
          disabled={mode !== 'schedule-followup'}
          className="flex-1 min-w-[200px]"
        />
        <Button onClick={submit} disabled={busy || !text.trim()} size="sm">
          Create intake
        </Button>
      </div>
    </section>
  );
}
