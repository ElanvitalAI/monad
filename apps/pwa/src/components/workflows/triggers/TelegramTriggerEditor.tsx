// Surface-unification ROADMAP §B5 (2026-05-11) — Telegram trigger form.
// Schema = src/workflow-runtime/schema.ts §telegramTrigger (kind +
// optional chat/user/command/pattern strings). Mirrors the Discord
// editor pattern; pattern validator imported from DiscordTriggerEditor.
// Daemon-side AXON tap = BACKLOG FU-2.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';
import { validatePattern } from './DiscordTriggerEditor';

const AUTO_SAVE_DEBOUNCE_MS = 500;
const KINDS = ['message', 'command', 'callback_query'] as const;
type Kind = (typeof KINDS)[number];

interface TelegramPayload {
  kind: Kind;
  chat?: string;
  user?: string;
  command?: string;
  pattern?: string;
}

interface TelegramTriggerEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

function readPayload(node: Record<string, unknown> | undefined): TelegramPayload {
  const raw = node?.['telegramTrigger'];
  if (!raw || typeof raw !== 'object') return { kind: 'message' };
  const p = raw as Record<string, unknown>;
  const kind: Kind = KINDS.includes(p['kind'] as Kind) ? (p['kind'] as Kind) : 'message';
  return {
    kind,
    chat: typeof p['chat'] === 'string' ? (p['chat'] as string) : undefined,
    user: typeof p['user'] === 'string' ? (p['user'] as string) : undefined,
    command: typeof p['command'] === 'string' ? (p['command'] as string) : undefined,
    pattern: typeof p['pattern'] === 'string' ? (p['pattern'] as string) : undefined,
  };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  p: TelegramPayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = { kind: p.kind };
  if (p.chat?.trim()) compact['chat'] = p.chat.trim();
  if (p.user?.trim()) compact['user'] = p.user.trim();
  if (p.kind === 'command' && p.command?.trim()) compact['command'] = p.command.trim();
  if (p.pattern?.trim()) compact['pattern'] = p.pattern.trim();
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, telegramTrigger: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function TelegramTriggerEditor({ definition, nodeId, onChange }: TelegramTriggerEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [chat, setChat] = useState<string>(initial.chat ?? '');
  const [user, setUser] = useState<string>(initial.user ?? '');
  const [command, setCommand] = useState<string>(initial.command ?? '');
  const [pattern, setPattern] = useState<string>(initial.pattern ?? '');

  useEffect(() => {
    const p = readPayload(node);
    setKind(p.kind);
    setChat(p.chat ?? '');
    setUser(p.user ?? '');
    setCommand(p.command ?? '');
    setPattern(p.pattern ?? '');
  }, [nodeId, node]);

  const build = useCallback(
    (): TelegramPayload => ({ kind, chat, user, command, pattern }),
    [kind, chat, user, command, pattern],
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
    chat && `@${chat}`,
    user && `from:${user}`,
    kind === 'command' && command && `/${command}`,
    pattern && `/${pattern}/`,
  ]
    .filter(Boolean)
    .join(' · ');
  const validationStatus = patternCheck.ok ? 'valid' : 'error';
  const validationMessage = patternCheck.ok ? (summary || 'no filters') : patternCheck.message;

  return (
    <TriggerEditorBase variantLabel="Telegram" validationStatus={validationStatus} validationMessage={validationMessage}>
      <TriggerField label="kind">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        >
          {KINDS.map((k) => (<option key={k} value={k}>{k}</option>))}
        </select>
      </TriggerField>
      <TriggerField label="chat (id or @group)" hint="e.g. @my_group · -1001234567890">
        <input
          value={chat}
          onChange={(e) => setChat(e.target.value)}
          placeholder="@my_group"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
      {kind === 'command' && (
        <TriggerField label="command" hint="match telegram /command (no slash)" full>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="summary"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
          />
        </TriggerField>
      )}
      <TriggerField label="user (regex · optional)" hint="match by username or id">
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
          placeholder="^summarize"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
        />
      </TriggerField>
    </TriggerEditorBase>
  );
}
