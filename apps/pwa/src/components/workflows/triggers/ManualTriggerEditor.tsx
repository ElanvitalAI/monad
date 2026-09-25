// Surface-unification ROADMAP §B6 (2026-05-11 · n8n ManualTrigger port)
// — Manual trigger form. The simplest variant editor in the family:
// only `description` is author-facing. Card preview rendering + "Run
// now" wiring belongs to B8 / Group D respectively.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDefinitionLike } from '../workflow-graph-layout';
import { TriggerEditorBase, TriggerField } from './TriggerEditorBase';

const AUTO_SAVE_DEBOUNCE_MS = 500;

interface ManualPayload {
  description?: string;
}

interface ManualTriggerEditorProps {
  definition: WorkflowDefinitionLike;
  nodeId: string;
  onChange: (next: WorkflowDefinitionLike) => void;
}

function readPayload(node: Record<string, unknown> | undefined): ManualPayload {
  const raw = node?.['manualTrigger'];
  if (!raw || typeof raw !== 'object') return {};
  const p = raw as Record<string, unknown>;
  return {
    description: typeof p['description'] === 'string' ? (p['description'] as string) : undefined,
  };
}

function writePayload(
  def: WorkflowDefinitionLike,
  nodeId: string,
  payload: ManualPayload,
): WorkflowDefinitionLike {
  const compact: Record<string, unknown> = {};
  if (payload.description?.trim()) compact['description'] = payload.description.trim();
  const nodes = (def.nodes ?? []).map((n) =>
    n.id === nodeId ? ({ ...n, manualTrigger: compact } as typeof n) : n,
  );
  return { ...def, nodes };
}

export function ManualTriggerEditor({ definition, nodeId, onChange }: ManualTriggerEditorProps) {
  const node = (definition.nodes ?? []).find((n) => n.id === nodeId);
  const initial = readPayload(node);
  const [description, setDescription] = useState<string>(initial.description ?? '');

  useEffect(() => {
    const p = readPayload(node);
    setDescription(p.description ?? '');
  }, [nodeId, node]);

  const build = useCallback((): ManualPayload => ({ description }), [description]);

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

  return (
    <TriggerEditorBase
      variantLabel="Manual"
      validationStatus="valid"
      validationMessage="explicit run only"
    >
      <TriggerField label="description (optional)" full hint="rendered on the node card · helps remind future-you why this workflow runs manually">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Build then deploy on demand"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs"
        />
      </TriggerField>
      <TriggerField label="behaviour" full>
        <p className="rounded-md border border-border bg-surface px-2 py-1.5 text-[11px] leading-snug text-text-tertiary">
          The daemon never auto-subscribes to a Manual trigger. Run it via
          <code className="mx-1 rounded bg-surface-elevated px-1 font-mono">monad wf run &lt;name&gt;</code>
          or the PWA <span className="font-semibold">▶ Run now</span> button (Group D dry-run).
        </p>
      </TriggerField>
    </TriggerEditorBase>
  );
}
