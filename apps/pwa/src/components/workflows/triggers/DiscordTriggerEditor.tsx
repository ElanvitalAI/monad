// Surface-unification ROADMAP §B4 (2026-05-11) — Discord trigger form.
// Self-contained variant editor (parallels Schedule/Webhook). Schema =
// src/workflow-runtime/schema.ts §discordTrigger (kind + optional
// channel/user/pattern strings). Daemon-side AXON bridge tap is the
// BACKLOG FU-1 follow-up — until then this form just authors the YAML.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';

const AUTO_SAVE_DEBOUNCE_MS = 500;
const KINDS = ['message', 'mention', 'reaction'] as const;
type Kind = (typeof KINDS)[number];

interface DiscordPayload {
  kind: Kind;
  channel?: string;
  user?: string;
  pattern?: string;
}

interface DiscordTriggerEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

function readPayload(node: Record<string, unknown> | undefined): DiscordPayload {
  const raw = node?.['discordTrigger'];
  if (!raw || typeof raw !== 'object') return { kind: 'message' };
  const p = raw as Record<string, unknown>;
  const kind: Kind = KINDS.includes(p['kind'] as Kind) ? (p['kind'] as Kind) : 'message';
  return {
    kind,
    channel: typeof p['channel'] === 'string' ? (p['channel'] as string) : undefined,
    user: typeof p['user'] === 'string' ? (p['user'] as string) : undefined,
    pattern: typeof p['pattern'] === 'string' ? (p['pattern'] as string) : undefined,
  };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  p: DiscordPayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = { kind: p.kind };
  if (p.channel?.trim()) compact['channel'] = p.channel.trim();
  if (p.user?.trim()) compact['user'] = p.user.trim();
  if (p.pattern?.trim()) compact['pattern'] = p.pattern.trim();
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, discordTrigger: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function validatePattern(pattern: string): { ok: boolean; message: string } {
  if (!pattern) return { ok: true, message: 'no filter' };
  try {
    new RegExp(pattern);
    return { ok: true, message: 'pattern ok' };
  } catch {
    return { ok: false, message: 'invalid regex' };
  }
}

export function DiscordTriggerEditor({ definition, nodeId, onChange }: DiscordTriggerEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [channel, setChannel] = useState<string>(initial.channel ?? '');
  const [user, setUser] = useState<string>(initial.user ?? '');
  const [pattern, setPattern] = useState<string>(initial.pattern ?? '');

  useEffect(() => {
    const p = readPayload(node);
    setKind(p.kind);
    setChannel(p.channel ?? '');
    setUser(p.user ?? '');
    setPattern(p.pattern ?? '');
  }, [nodeId, node]);

  const build = useCallback(
    (): DiscordPayload => ({ kind, channel, user, pattern }),
    [kind, channel, user, pattern],
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

  const patternCheck = validatePattern(pattern);
  const summary = [
    channel && `#${channel}`,
    user && `@${user}`,
    pattern && `/${pattern}/`,
  ]
    .filter(Boolean)
    .join(' · ');
  const validationStatus = patternCheck.ok ? 'valid' : 'error';
  const validationMessage = patternCheck.ok ? (summary || 'no filters') : patternCheck.message;

  return (
    <TriggerEditorBase variantLabel="Discord" validationStatus={validationStatus} validationMessage={validationMessage}>
      <TriggerField label="kind">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
        </select>
      </TriggerField>
      <TriggerField label="channel (name or id)" hint="e.g. ops · 1234567890">
        <input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="ops"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="user (regex · optional)" hint="match by username — e.g. .* · admin">
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder=".*"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      <TriggerField label="pattern (regex · optional)" full hint="match message body — e.g. ^배포">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="^deploy"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
    </TriggerEditorBase>
  );
}
