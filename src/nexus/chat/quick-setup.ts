// NEXUS · chat backend Quick Setup card (N-1 cleanup PR g.2).
//
// Rendered at the top of the Settings tab so a user with no chat
// backend authenticated has a one-screen path to wire one. Three
// providers are surfaced as the chat-compatible set (codex / claude-
// code / gemini). Grok / Anthropic-direct / OpenAI-direct stay out
// because they have no ACP wrap — they live in the daemon tab.
//
// Each entry shows:
//   - a status glyph (✓ if detect found credentials, ◯ otherwise)
//   - the provider label
//   - one or two setup commands (OAuth + env-var paths)
//
// The card itself is just lines (string[]) — keeps rendering pure +
// testable without dragging in a View class.

import { detectChatBackend, type ChatBackendDetection } from './auto-detect.js';
import { loadTokens } from '../../oauth/store.js';

export interface QuickSetupRenderOpts {
  /** Override env-var lookup. Production omits + we read process.env. */
  envSource?: NodeJS.ProcessEnv;
  /** Override OAuth probe. Production omits + delegates to loadTokens. */
  tokenLookup?: (provider: string) => unknown | null;
}

export interface QuickSetupSnapshot {
  /** Resolved detection (same shape as detectChatBackend output) — the
   *  card highlights this entry as the active wire. */
  detection: ChatBackendDetection;
  /** Each provider entry's per-credential availability so the card can
   *  render a ✓ next to the wired path + ◯ next to the others. */
  entries: QuickSetupEntry[];
}

export interface QuickSetupEntry {
  provider: 'codex' | 'claude-code' | 'gemini';
  label: string;
  /** Per-credential rows (OAuth + env-var paths). */
  paths: QuickSetupPath[];
}

export interface QuickSetupPath {
  /** Short tag — 'OAuth' / 'OPENAI_API_KEY' / 'ANTHROPIC_API_KEY' / 'GEMINI_API_KEY'. */
  tag: string;
  /** User-facing setup command / hint. */
  hint: string;
  /** True when this credential is already present in the env / token store. */
  detected: boolean;
}

/** Build the Quick Setup snapshot. Pure — `renderQuickSetupLines`
 *  formats it. Split so tests can pin the data without depending on
 *  the formatting layer. */
export function buildQuickSetupSnapshot(opts: QuickSetupRenderOpts = {}): QuickSetupSnapshot {
  const env = opts.envSource ?? process.env;
  const probe = opts.tokenLookup ?? ((p) => loadTokens(p));
  const detection = detectChatBackend({ envSource: env, tokenLookup: probe });

  const codexOAuth = !!probe('openai-codex');
  const openaiKey = nonEmpty(env['OPENAI_API_KEY']);
  const anthropicKey = nonEmpty(env['ANTHROPIC_API_KEY']);
  const geminiKey = nonEmpty(env['GEMINI_API_KEY']) || nonEmpty(env['GOOGLE_API_KEY']);

  const entries: QuickSetupEntry[] = [
    {
      provider: 'codex',
      label: 'OpenAI · Codex',
      paths: [
        { tag: 'OAuth',           hint: '`monad login codex` (가장 추천 · 30초)',     detected: codexOAuth },
        { tag: 'OPENAI_API_KEY',  hint: '`export OPENAI_API_KEY=sk-...` env 설정',  detected: openaiKey },
      ],
    },
    {
      provider: 'claude-code',
      label: 'Anthropic · Claude',
      paths: [
        { tag: 'ANTHROPIC_API_KEY', hint: '`export ANTHROPIC_API_KEY=sk-ant-...` env 설정', detected: anthropicKey },
      ],
    },
    {
      provider: 'gemini',
      label: 'Google · Gemini',
      paths: [
        { tag: 'GEMINI_API_KEY',    hint: '`export GEMINI_API_KEY=AI...` (또는 GOOGLE_API_KEY)', detected: geminiKey },
      ],
    },
  ];

  return { detection, entries };
}

/** Render the Quick Setup card as a string[] for inclusion in the
 *  Settings tab view. Lines are pure ASCII (no ANSI) so the
 *  SidebarTabSurface paint pass handles them like any other body
 *  content. */
export function renderQuickSetupLines(snap: QuickSetupSnapshot): string[] {
  const lines: string[] = [];
  lines.push('  Quick Setup — chat 백엔드 1개만 셋업하면 됨');
  lines.push('  ──────────────────────────────────────────────');
  if (snap.detection.backend !== 'none') {
    lines.push(`  현재 wired · ${snap.detection.backend} (${snap.detection.source})`);
  } else {
    lines.push('  현재 wired · (없음 — 아래 3 provider 중 1개)');
  }
  lines.push('');
  for (const entry of snap.entries) {
    const wired = snap.detection.backend === entry.provider;
    const arrow = wired ? '▶' : ' ';
    lines.push(`  ${arrow} ${entry.label}`);
    for (const p of entry.paths) {
      const glyph = p.detected ? '✓' : '◯';
      lines.push(`      ${glyph} ${p.tag.padEnd(20)} ${p.hint}`);
    }
  }
  lines.push('');
  lines.push('  Grok · 중국 4종 (kimi/qwen/glm/deepseek) 등은 NEXUS chat');
  lines.push('  우선순위 외 — daemon 탭 또는 `monad`(대시보드)에서 사용.');
  lines.push('');
  lines.push('  [r] env 변경 후 detection 재실행 → 새 chat 탭 / nexus 재시작');
  lines.push('     으로 wire 반영.');
  lines.push('');
  return lines;
}

function nonEmpty(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
