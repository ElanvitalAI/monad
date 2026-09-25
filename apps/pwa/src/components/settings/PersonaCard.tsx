'use client';

// PWA `/settings` Phase 3 (2026-05-19) — Persona list + description edit card.
//
// SETUP_LINKS `personas` anchor 의 도착지 — `/settings#personas` 진입 시
// 본 카드가 우선 노출. v2 단순화 핵심: orchestrator routing / describer 등
// 복잡 기능은 [`RESEARCH-hermes-pr27572-...-deferred-2026-05-19.md`](../../../../내부 문서 `RESEARCH-hermes-pr27572-triage-orchestrator-deferred-2026-05-19`)
// 채택 시 활성화. 본 카드는 list + description text 편집만.

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { PersonaWireEntry } from '@/nexus/client';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { cn } from '@/lib/utils';

const MAX_DESCRIPTION_LENGTH = 280; // mirror of src/persona/write-description.ts

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; personas: PersonaWireEntry[] }
  | { status: 'error'; message: string };

interface EditState {
  personaId: string;
  draft: string;
  /** dirty = textarea 의 값이 server 의 마지막 값과 다름. Save button 활성화 기준. */
  dirty: boolean;
  saving: boolean;
  /** Inline error from server PATCH (e.g. 400 description-too-long). */
  error?: string;
}

export function PersonaCard() {
  const client = useOptionalNexusClient();
  const [mounted, setMounted] = useState(false);
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });
  const [edits, setEdits] = useState<Record<string, EditState>>({});

  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    setLoad({ status: 'loading' });
    try {
      const res = await client.getPersonas();
      setLoad({ status: 'ok', personas: res.personas });
      // Reset edits so cleared / unsaved drafts don't shadow fresh
      // server values after reload.
      setEdits({});
    } catch (err) {
      setLoad({ status: 'error', message: (err as Error).message });
    }
  }, [client]);

  useEffect(() => {
    if (mounted && client) void refresh();
  }, [mounted, client, refresh]);

  const handleDraftChange = useCallback(
    (personaId: string, original: string, draft: string) => {
      setEdits((prev) => ({
        ...prev,
        [personaId]: {
          personaId,
          draft,
          dirty: draft !== (original ?? ''),
          saving: false,
          ...(prev[personaId]?.error ? { error: undefined } : {}),
        },
      }));
    },
    [],
  );

  const handleSave = useCallback(
    async (personaId: string) => {
      if (!client) return;
      const edit = edits[personaId];
      if (!edit) return;
      setEdits((prev) => ({
        ...prev,
        [personaId]: { ...edit, saving: true, error: undefined },
      }));
      try {
        const res = await client.patchPersonaDescription(personaId, edit.draft);
        // Patch local state with server response so UI doesn't lag behind.
        setLoad((prev) => {
          if (prev.status !== 'ok') return prev;
          return {
            status: 'ok',
            personas: prev.personas.map((p) =>
              p.personaId === personaId ? res.persona : p,
            ),
          };
        });
        setEdits((prev) => {
          const { [personaId]: _, ...rest } = prev;
          return rest;
        });
      } catch (err) {
        setEdits((prev) => ({
          ...prev,
          [personaId]: {
            ...edit,
            saving: false,
            error: (err as Error).message,
          },
        }));
      }
    },
    [client, edits],
  );

  if (!mounted || !client) return null;

  return (
    <section
      id="personas"
      data-testid="persona-card"
      className="space-y-3 rounded border border-border bg-card p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Personas</h2>
          <p className="text-xs text-muted-foreground">
            4 인격 yaml file 의 description 편집. 빈 string 으로 저장하면 clear.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={load.status === 'loading'}
        >
          Refresh
        </Button>
      </header>

      {load.status === 'idle' || load.status === 'loading' ? (
        <p className="text-xs text-muted-foreground">Loading personas…</p>
      ) : null}

      {load.status === 'error' ? (
        <p className="text-xs text-destructive">
          persona 로드 실패: {load.message}
        </p>
      ) : null}

      {load.status === 'ok' && load.personas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          ~/.monad/personas/ 에 yaml file 이 없음. yaml seed:{' '}
          <span className="font-mono">personas/*.yaml</span> 복사 후 refresh.
        </p>
      ) : null}

      {load.status === 'ok' && load.personas.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {load.personas.map((persona) => (
            <PersonaRow
              key={persona.personaId}
              persona={persona}
              edit={edits[persona.personaId]}
              onDraftChange={handleDraftChange}
              onSave={handleSave}
            />
          ))}
        </ul>
      ) : null}

      <p className="text-[10px] text-muted-foreground">
        Note: ⚗ Auto describer 와 orchestrator routing 은{' '}
        <a
          href="https://github.com/ElanvitalAI/monad/blob/main/내부 문서 `RESEARCH-hermes-pr27572-triage-orchestrator-deferred-2026-05-19`"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Hermes PR #27572 research
        </a>{' '}
        채택 시 활성화 예정.
      </p>
    </section>
  );
}

interface PersonaRowProps {
  persona: PersonaWireEntry;
  edit?: EditState;
  onDraftChange: (personaId: string, original: string, draft: string) => void;
  onSave: (personaId: string) => void;
}

function PersonaRow({ persona, edit, onDraftChange, onSave }: PersonaRowProps) {
  const original = persona.description ?? '';
  const draft = edit?.draft ?? original;
  const dirty = edit?.dirty ?? false;
  const saving = edit?.saving ?? false;
  const remaining = MAX_DESCRIPTION_LENGTH - draft.length;
  const overLimit = remaining < 0;

  return (
    <li
      className="flex flex-col gap-2 rounded border border-border bg-background p-3"
      data-testid={`persona-row-${persona.personaId}`}
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {persona.brandColor ? (
            <span
              className="inline-block h-3 w-3 rounded"
              style={{ backgroundColor: persona.brandColor }}
              aria-hidden
            />
          ) : null}
          <span className="text-sm font-medium">{persona.displayName}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {persona.personaId}
          </span>
        </div>
        {persona.primaryModel ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {persona.primaryModel}
          </span>
        ) : null}
      </header>

      <textarea
        value={draft}
        onChange={(e) => onDraftChange(persona.personaId, original, e.target.value)}
        rows={2}
        maxLength={MAX_DESCRIPTION_LENGTH * 2 /* allow overflow so error message fires */ }
        placeholder="이 persona 가 무엇을 잘 하는지 1-2 문장으로 적어주세요."
        disabled={saving}
        data-testid={`persona-description-${persona.personaId}`}
        className={cn(
          'w-full resize-none rounded border border-input bg-transparent px-2.5 py-1.5 text-xs',
          'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          overLimit && 'border-destructive',
        )}
      />

      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'font-mono text-[10px]',
            overLimit ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {draft.length} / {MAX_DESCRIPTION_LENGTH}
        </span>
        <div className="flex items-center gap-2">
          {edit?.error ? (
            <span className="text-[10px] text-destructive">{edit.error}</span>
          ) : null}
          <Button
            size="sm"
            onClick={() => onSave(persona.personaId)}
            disabled={!dirty || saving || overLimit}
            data-testid={`persona-save-${persona.personaId}`}
          >
            {saving ? '저장중…' : '저장'}
          </Button>
        </div>
      </div>
    </li>
  );
}
