'use client';

// BackendPickerChip — PWA port of the iOS chip (P2-1 · 2026-05-14).
//
// Visual + behavioral parity with `apps/ios/MonadiOS/MonadiOS/Chat/
// AgentCli/BackendPickerChip.swift`:
//   • Tinted capsule (brand fill · white label · optional mission tag
//     stacked below) — primary tap cycles backend.
//   • Pin glyph in front of the label when sticky.
//   • Small chevron button opens a 4-option picker menu with a
//     "Lock backend (sticky)" toggle at the bottom.
//
// The chip does NOT talk to the network — `mission` flows in from
// ChatLayout's predict effect (P1-4 wire), `onChange` / `onStickyToggle`
// bubble up to the parent for persistence (@localStorage like iOS's
// @AppStorage).

import { useEffect, useRef, useState } from 'react';
import { Pin, ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AgentCliBackend =
  | 'monad-builtin'
  | 'codex-app-server'
  | 'claude'
  | 'gemini'
  | 'grok';

/** PLAN-codex-app-server-hermes-parity §5 Phase H2·4 (2026-05-16) —
 *  codex CLI plugin entry rendered as a secondary line under the
 *  Codex menu item. Shape mirrors `src/acp/codex-plugins.ts`
 *  (`CodexPlugin`). */
export interface CodexPlugin {
  name: string;
  marketplace: string;
  enabled: boolean;
}

interface BackendMeta {
  kind: AgentCliBackend;
  label: string;
  emoji: string;
  description: string;
  /** Brand color CSS — Tailwind arbitrary value · matches iOS RGB. */
  tint: string;
}

export const BACKEND_ORDER: ReadonlyArray<AgentCliBackend> = [
  'monad-builtin',
  'codex-app-server',
  'claude',
  'gemini',
  'grok',
];

const BACKEND_META: Record<AgentCliBackend, BackendMeta> = {
  'monad-builtin': {
    kind: 'monad-builtin',
    label: 'monad',
    emoji: '🌀',
    description: 'NEXUS internal LLM rotation (default)',
    tint: 'bg-[rgb(125,87,235)]',
  },
  'codex-app-server': {
    kind: 'codex-app-server',
    label: 'Codex',
    emoji: '🟢',
    description: 'OpenAI Codex CLI · sub-process',
    tint: 'bg-[rgb(51,166,82)]',
  },
  claude: {
    kind: 'claude',
    label: 'Claude Code',
    emoji: '🟣',
    description: 'Anthropic Claude Code CLI · sub-process',
    tint: 'bg-[rgb(232,125,69)]',
  },
  gemini: {
    kind: 'gemini',
    label: 'Gemini',
    emoji: '🔵',
    description: 'Google Gemini CLI · sub-process',
    tint: 'bg-[rgb(69,130,242)]',
  },
  grok: {
    kind: 'grok',
    label: 'Grok',
    emoji: '⚫',
    description: 'xAI Grok Build CLI · ACP sub-process',
    tint: 'bg-[rgb(40,40,40)]',
  },
};

interface Props {
  selection: AgentCliBackend;
  onChange: (next: AgentCliBackend) => void;
  /** Current mission tag from the router · undefined hides the second line. */
  mission?: string;
  /** Sticky mode — when true, auto-routing skips and the chip shows a pin. */
  sticky?: boolean;
  onStickyToggle?: () => void;
  /** Per-backend turn counts for the picker menu ✕N badge. */
  counts?: Partial<Record<AgentCliBackend, number>>;
  disabled?: boolean;
  /** PLAN-codex-app-server-hermes-parity §5 Phase H2·4 (2026-05-16) —
   *  daemon fetch closure for the codex CLI plugin list. The chip
   *  invokes it on mount and whenever the user selects the Codex
   *  backend; daemon's 5-min cache makes refetches cheap. When the
   *  closure is omitted, no plugin sub-line is rendered (call site
   *  not wired). When it resolves to an empty array, the menu still
   *  hides the line — no codex agent attached. */
  getCodexPlugins?: () => Promise<CodexPlugin[]>;
}

export function BackendPickerChip({
  selection,
  onChange,
  mission,
  sticky = false,
  onStickyToggle,
  counts = {},
  disabled = false,
  getCodexPlugins,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** PLAN-codex-app-server-hermes-parity §5 Phase H2·4 — codex plugin
   *  list surfaced inside the menu. Refetched on mount and whenever
   *  the user picks the Codex backend (so newly-installed codex CLI
   *  plugins appear without a page reload). */
  const [codexPlugins, setCodexPlugins] = useState<CodexPlugin[]>([]);

  useEffect(() => {
    if (!getCodexPlugins) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await getCodexPlugins();
        if (!cancelled) setCodexPlugins(next);
      } catch {
        // soft fail — leave the prior list intact so a transient
        // daemon hiccup doesn't blank the menu mid-session.
      }
    })();
    return () => { cancelled = true; };
  }, [getCodexPlugins, selection]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const meta = BACKEND_META[selection];

  function cycleNext() {
    const idx = BACKEND_ORDER.indexOf(selection);
    const next = BACKEND_ORDER[(idx + 1) % BACKEND_ORDER.length]!;
    onChange(next);
  }

  return (
    <div ref={rootRef} className="relative inline-flex items-stretch gap-0.5">
      <button
        type="button"
        onClick={cycleNext}
        disabled={disabled}
        aria-label={`Backend: ${meta.label}${sticky ? ' (sticky)' : ''}. Tap to switch.`}
        className={cn(
          'flex flex-col items-start justify-center rounded-full px-3 text-white shadow-sm transition-all',
          'min-h-[28px] text-[12px] font-semibold leading-none',
          meta.tint,
          disabled && 'opacity-60 cursor-not-allowed',
          !mission && 'py-1.5',
          mission && 'py-1',
        )}
      >
        <span className="inline-flex items-center gap-1">
          {sticky && <Pin className="h-2.5 w-2.5" aria-hidden />}
          <span>{meta.label}</span>
        </span>
        {mission && (
          <span className="text-[9px] font-medium leading-tight text-white/85">
            {mission}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Backend picker menu"
        className={cn(
          'inline-flex items-center justify-center rounded-md px-1 text-muted-foreground hover:text-foreground transition-colors',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        <ChevronsUpDown className="h-3 w-3" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-1 w-[200px] rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        >
          <ul className="py-1">
            {BACKEND_ORDER.map((kind) => {
              const m = BACKEND_META[kind];
              const count = counts[kind] ?? 0;
              const active = kind === selection;
              return (
                <li key={kind}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(kind);
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
                  >
                    <span className="pt-0.5">{m.emoji}</span>
                    <span className="flex-1">
                      <span className="flex items-center gap-1">
                        <span className="font-medium">{m.label}</span>
                        {count > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            ✕{count}
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {m.description}
                      </span>
                      {kind === 'codex-app-server' && codexPlugins.length > 0 && (
                        <span className="block text-[10px] text-muted-foreground/80">
                          {codexPluginsSummary(codexPlugins)}
                        </span>
                      )}
                    </span>
                    {active && <Check className="mt-0.5 h-3 w-3" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
          {onStickyToggle && (
            <>
              <div className="border-t border-border" />
              <button
                type="button"
                onClick={() => {
                  onStickyToggle();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <Pin className={cn('h-3 w-3', sticky && 'rotate-45')} aria-hidden />
                <span>{sticky ? 'Unlock (auto routing)' : 'Lock backend (sticky)'}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** PLAN-codex-app-server-hermes-parity §5 Phase H2·4 (2026-05-16) —
 *  render "Plugins: gmail · google-calendar · google-drive" with a
 *  "+N more" overflow when more than three are installed. */
function codexPluginsSummary(plugins: ReadonlyArray<CodexPlugin>): string {
  const names = plugins.slice(0, 3).map((p) => p.name).join(' · ');
  if (plugins.length > 3) {
    return `Plugins: ${names} · +${plugins.length - 3} more`;
  }
  return `Plugins: ${names}`;
}
