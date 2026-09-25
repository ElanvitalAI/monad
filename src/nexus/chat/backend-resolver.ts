// NEXUS · chat backend resolver (Phase N-1 cleanup PR a).
//
// Returns the ACP backend kind a chat tab should use. The resolver
// walks three sources in order:
//
//   1. explicit caller override (e.g., tests · future PR b/c hook)
//   2. per-tab UserConfig switch — `tabs.chat:<id>.backend`
//   3. global UserConfig switch — `global.chat.defaultBackend`
//   4. hard default — `'claude-code'`
//
// Why a resolver (vs reading the switch inline at TabSpec creation):
//   - PR b/c will mount the real conversation surface and need to
//     re-resolve when the user changes the switch (per-tab override
//     restart fires `restartTabs: ['chat:1']`). Centralizing the
//     fall-through here keeps both code paths honest.
//   - Tests can pass a synthetic UserConfig + tabId pair without
//     touching disk.
//   - Validation is single-source: the switch values are validated
//     by SwitchSpec.validate; the resolver just trusts what it reads
//     and falls back when malformed.

import type { UserConfig } from '../config/types.js';
import { readSwitchValue } from '../config/user-config.js';
import {
  CHAT_DEFAULT_BACKEND_SWITCH_ID,
  isChatBackendKind,
  type ChatBackendKind,
} from '../config/builtins/tab-chat.js';

export type { ChatBackendKind } from '../config/builtins/tab-chat.js';

/** Hard default — used when neither switch is set + caller didn't
 *  override. PR g.1 flipped from 'claude-code' to 'none' so a clean-
 *  machine new user never hits a silent backend-auth fail (chat send
 *  → ACP spawn fail → cryptic system note). 'none' renders the chat
 *  placeholder with a Quick Setup pointer instead. The runNexus boot
 *  path runs `detectChatBackend` (auto-detect.ts) BEFORE constructing
 *  per-tab sessions so an env-var / OAuth-token user is auto-wired
 *  without ever touching this hard default. */
export const CHAT_BACKEND_HARD_DEFAULT: ChatBackendKind = 'none';

export interface ResolveChatBackendInput {
  /** Persistent UserConfig snapshot. Pass the live cfg from
   *  `readUserConfig()` (production) or a synthetic shape (tests). */
  cfg: UserConfig;
  /** Tab id (e.g., 'chat:1'). The per-tab switch lookup uses this
   *  literal id; pass the same id you'll persist on the TabSpec. */
  tabId: string;
  /** Caller-supplied override. When present + valid, it wins over
   *  every config layer. PR b/c will use this to test backend swaps
   *  without rewriting UserConfig from inside the test harness. */
  override?: ChatBackendKind;
}

/** Read the effective chat backend for a given tab. Never throws —
 *  every malformed input falls through to the hard default so a
 *  corrupt UserConfig can't keep the chat tab from booting. */
export function resolveChatBackend(input: ResolveChatBackendInput): ChatBackendKind {
  // 1. explicit override
  if (input.override && isChatBackendKind(input.override)) return input.override;

  // 2. per-tab override
  // The switch id pattern is `tabs.<id>.backend` — the schema stores
  // the literal `chat:1` slot but readSwitchValue accepts any tab id
  // (the second segment is the literal). Reuse the same key form.
  const perTabId = `tabs.${input.tabId}.backend`;
  const perTab = readSwitchValue(input.cfg, perTabId);
  if (typeof perTab === 'string' && perTab !== '' && isChatBackendKind(perTab)) {
    return perTab;
  }

  // 3. global default
  const global = readSwitchValue(input.cfg, CHAT_DEFAULT_BACKEND_SWITCH_ID);
  if (isChatBackendKind(global)) return global;

  // 4. hard default
  return CHAT_BACKEND_HARD_DEFAULT;
}

/** Convenience — true when the resolved backend is `'none'` (i.e.,
 *  the user explicitly opted into the placeholder view). PR b/c will
 *  branch on this so the real surface code path stays inert until a
 *  real backend is chosen. */
export function isChatBackendDisabled(backend: ChatBackendKind): boolean {
  return backend === 'none';
}
