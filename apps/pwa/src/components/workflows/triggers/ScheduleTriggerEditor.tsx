// Surface-unification ROADMAP §B1 (2026-05-11) — Schedule trigger
// form. Variant-specific editor invoked by WorkflowNodeEditor when
// the selected node is a scheduleTrigger. Self-contained draft state +
// 500ms debounce upstream — caller only needs to pipe definitions
// through onChange.
//
// Form coverage: cron preset palette → raw cron / interval ms → tz +
// jitter + max_runs + enabled. The schema (src/workflow-runtime/schema
// .ts §scheduleTrigger) gates submit; daemon-side wiring of tz /
// jitter / max_runs is tracked as a follow-up (cron-source migration).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';
import { CRON_PRESETS, previewCron } from './cron-preview';

const AUTO_SAVE_DEBOUNCE_MS = 500;

interface ScheduleTriggerEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

interface SchedulePayload {
  type: 'cron' | 'interval';
  cron?: string;
  interval?: number;
  timezone?: string;
  jitter_seconds?: number;
  max_runs?: number;
  enabled?: boolean;
}

function readPayload(node: Record<string, unknown> | undefined): SchedulePayload {
  const raw = node?.['scheduleTrigger'];
  if (!raw || typeof raw !== 'object') return { type: 'interval', interval: 3600000 };
  const p = raw as Record<string, unknown>;
  const type = p['type'] === 'cron' ? 'cron' : 'interval';
  return {
    type,
    cron: typeof p['cron'] === 'string' ? (p['cron'] as string) : undefined,
    interval: typeof p['interval'] === 'number' ? (p['interval'] as number) : undefined,
    timezone: typeof p['timezone'] === 'string' ? (p['timezone'] as string) : undefined,
    jitter_seconds: typeof p['jitter_seconds'] === 'number' ? (p['jitter_seconds'] as number) : undefined,
    max_runs: typeof p['max_runs'] === 'number' ? (p['max_runs'] as number) : undefined,
    enabled: typeof p['enabled'] === 'boolean' ? (p['enabled'] as boolean) : undefined,
  };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  payload: SchedulePayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = { type: payload.type };
  if (payload.type === 'cron' && payload.cron) compact['cron'] = payload.cron;
  if (payload.type === 'interval' && typeof payload.interval === 'number') {
    compact['interval'] = payload.interval;
  }
  if (payload.timezone) compact['timezone'] = payload.timezone;
  if (typeof payload.jitter_seconds === 'number') compact['jitter_seconds'] = payload.jitter_seconds;
  if (typeof payload.max_runs === 'number') compact['max_runs'] = payload.max_runs;
  if (typeof payload.enabled === 'boolean') compact['enabled'] = payload.enabled;
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, scheduleTrigger: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function ScheduleTriggerEditor({ definition, nodeId, onChange }: ScheduleTriggerEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [type, setType] = useState<'cron' | 'interval'>(initial.type);
  const [cron, setCron] = useState<string>(initial.cron ?? '0 9 * * *');
  const [intervalMs, setIntervalMs] = useState<string>(String(initial.interval ?? 3600000));
  const [timezone, setTimezone] = useState<string>(initial.timezone ?? 'Asia/Seoul');
  const [jitter, setJitter] = useState<string>(String(initial.jitter_seconds ?? ''));
  const [maxRuns, setMaxRuns] = useState<string>(String(initial.max_runs ?? ''));
  const [enabled, setEnabled] = useState<boolean>(initial.enabled !== false);

  // Rehydrate when node changes (e.g. user clicks a different node).
  useEffect(() => {
    const p = readPayload(node);
    setType(p.type);
    if (p.cron) setCron(p.cron);
    if (typeof p.interval === 'number') setIntervalMs(String(p.interval));
    if (p.timezone) setTimezone(p.timezone);
    setJitter(typeof p.jitter_seconds === 'number' ? String(p.jitter_seconds) : '');
    setMaxRuns(typeof p.max_runs === 'number' ? String(p.max_runs) : '');
    setEnabled(p.enabled !== false);
  }, [nodeId, node]);

  const buildPayload = useCallback((): SchedulePayload => {
    const intervalParsed = Number(intervalMs);
    const jitterParsed = jitter === '' ? undefined : Number(jitter);
    const maxRunsParsed = maxRuns === '' ? undefined : Number(maxRuns);
    return {
      type,
      cron: type === 'cron' ? cron.trim() : undefined,
      interval: type === 'interval' && Number.isFinite(intervalParsed) ? intervalParsed : undefined,
      timezone: timezone.trim() || undefined,
      jitter_seconds: Number.isFinite(jitterParsed) ? jitterParsed : undefined,
      max_runs: Number.isFinite(maxRunsParsed) ? maxRunsParsed : undefined,
      enabled,
    };
  }, [type, cron, intervalMs, timezone, jitter, maxRuns, enabled]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!node) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(writePayload(definition, nodeId, buildPayload()));
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [node, nodeId, definition, buildPayload, onChange]);

  const preview = type === 'cron' ? previewCron(cron) : null;
  const intervalSec = Number(intervalMs) / 1000;
  const validationStatus = !enabled
    ? 'warning'
    : type === 'cron' && !preview?.matched
      ? 'warning'
      : 'valid';
  const validationMessage = !enabled
    ? 'disabled'
    : type === 'cron'
      ? preview?.matched
        ? 'cron ok'
        : 'custom cron'
      : Number.isFinite(intervalSec) && intervalSec > 0
        ? `every ${intervalSec}s`
        : 'interval invalid';

  return (
    <TriggerEditorBase
      variantLabel="Schedule"
      validationStatus={validationStatus}
      validationMessage={validationMessage}
    >
      <TriggerField label="type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'cron' | 'interval')}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          <option value="cron">cron</option>
          <option value="interval">interval</option>
        </select>
      </TriggerField>
      <TriggerField label="enabled">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-text-tertiary">{enabled ? 'on' : 'off'}</span>
        </label>
      </TriggerField>
      {type === 'cron' && (
        <>
          <TriggerField label="presets" full>
            <div className="flex flex-wrap gap-1">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCron(p.expression)}
                  data-preset={p.id}
                  className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-text-tertiary hover:bg-surface"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </TriggerField>
          <TriggerField label="cron expression" full hint={preview?.text}>
            <input
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
            />
          </TriggerField>
        </>
      )}
      {type === 'interval' && (
        <TriggerField label="interval (ms)" hint={`= ${intervalSec || '?'}s`}>
          <input
            type="number"
            min={1000}
            value={intervalMs}
            onChange={(e) => setIntervalMs(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
          />
        </TriggerField>
      )}
      <TriggerField label="timezone (IANA)" hint="e.g. Asia/Seoul · UTC · America/Los_Angeles">
        <input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="jitter (seconds · optional)">
        <input
          type="number"
          min={0}
          value={jitter}
          onChange={(e) => setJitter(e.target.value)}
          placeholder="e.g. 30"
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="max runs (optional)">
        <input
          type="number"
          min={1}
          step={1}
          value={maxRuns}
          onChange={(e) => setMaxRuns(e.target.value)}
          placeholder="unlimited"
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
    </TriggerEditorBase>
  );
}
