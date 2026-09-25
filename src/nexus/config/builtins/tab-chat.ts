// NEXUS · chat-tab built-in switches (Phase N-1 cleanup PR a → g.1)
//
// Two switches drive chat tab behavior:
//
//  1. `global.chat.defaultBackend` — the ACP backend kind that newly
//     opened chat tabs use when no per-tab override is set. PR g.1
//     flipped the default from 'claude-code' to 'none' so silent
//     fail (chat send → backend not authenticated → system error)
//     becomes graceful guidance (placeholder + Quick Setup pointer).
//     Boot-time auto-detection (src/nexus/chat/auto-detect.ts) tries
//     to wire one of the 3 supported providers (codex / claude-code /
//     gemini) automatically when an OAuth token or API key is present.
//
//  2. `tabs.chat:<id>.backend` — per-tab override. Empty string =
//     fall back to global. The resolver walks: per-tab → global →
//     hard default ('none' since PR g.1).
//
// PR g.1 added 'gemini' to the enum so the gemini-cli ACP wrap
// (already present in src/acp/backend-registry.ts as `gemini
// --experimental-acp`) becomes selectable from the NEXUS surface.

import type { SwitchSpec } from '../types.js';

export const CHAT_DEFAULT_BACKEND_SWITCH_ID = 'global.chat.defaultBackend';
export const CHAT_TAB_BACKEND_SWITCH_ID = 'tabs.chat:1.backend';

export type ChatBackendKind = 'claude-code' | 'codex' | 'gemini' | 'none';

const CHAT_BACKEND_VALUES: readonly ChatBackendKind[] = [
  'claude-code',
  'codex',
  'gemini',
  'none',
];

export function isChatBackendKind(v: unknown): v is ChatBackendKind {
  return typeof v === 'string'
    && (CHAT_BACKEND_VALUES as readonly string[]).includes(v);
}

export const CHAT_SWITCHES: SwitchSpec[] = [
  {
    id: CHAT_DEFAULT_BACKEND_SWITCH_ID,
    scope: 'global',
    kind: 'enum',
    label: 'Chat backend (default)',
    description:
      'Newly opened chat tabs use this ACP backend when no per-tab override is set. PR g.1 default = none (boot auto-detection picks claude-code/codex/gemini when an OAuth token or API key is found).',
    default: 'none',
    enumValues: [
      { value: 'none',        label: 'none',        description: '미설정 — 부팅 시 auto-detection · Quick Setup 안내 (PR g.1 default)' },
      { value: 'codex',       label: 'codex',       description: 'OpenAI Codex · ACP bridge (OAuth 또는 OPENAI_API_KEY)' },
      { value: 'claude-code', label: 'claude-code', description: 'Anthropic Claude Code · ACP stdio bridge (claude-code CLI 자체 인증)' },
      { value: 'gemini',      label: 'gemini',      description: 'Google Gemini CLI · --experimental-acp (GEMINI_API_KEY)' },
    ],
    validate: (v) =>
      isChatBackendKind(v) ? null : 'must be one of claude-code|codex|gemini|none',
    hotApplicable: false,
    // Newly created chat tabs pick up the new default; existing tabs
    // keep their per-tab override (or whatever backend they spawned
    // with). No restart needed — the resolver runs at TabSpec creation.
    restartTabs: [],
  },
  {
    id: CHAT_TAB_BACKEND_SWITCH_ID,
    scope: 'tab',
    appliesTo: ['chat'],
    kind: 'enum',
    label: 'Chat backend (이 tab 만)',
    description:
      '비우면 global.chat.defaultBackend 적용. 명시 시 본 chat 인스턴스만 다른 backend.',
    default: '',
    enumValues: [
      { value: '',            label: '(global.chat.defaultBackend 사용)' },
      { value: 'codex',       label: 'codex' },
      { value: 'claude-code', label: 'claude-code' },
      { value: 'gemini',      label: 'gemini' },
      { value: 'none',        label: 'none' },
    ],
    validate: (v) =>
      v === '' || isChatBackendKind(v)
        ? null
        : 'must be empty or one of claude-code|codex|gemini|none',
    hotApplicable: false,
    // Empty string sentinel = no override. Restart the matching chat
    // tab when the override changes so the new backend wires fresh.
    restartTabs: ['chat:1'],
  },
];
