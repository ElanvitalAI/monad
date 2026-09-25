// Help overlay — printed when the user types `?` at any prompt
// during the wizard. Pulls from a small set of curated markdown
// snippets (`src/onboarding/help/*.md`) so we can update copy
// without recompiling.
//
// β-followup (2026-04-28). The overlay is opt-in: the existing
// step functions need to recognize `?` as a special token and
// route through `showHelp(io, topic)` before re-prompting. This
// module exposes the renderer; the per-step wiring is incremental.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { WizardIO } from '../onboarding.js';

const HERE = (() => {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return '.';
  }
})();

const HELP_DIR = join(HERE, 'help');

export type HelpTopic =
  | 'general'
  | 'llm'
  | 'skills'
  | 'obsidian'
  | 'telegram'
  | 'discord';

const TOPIC_FILE: Record<HelpTopic, string> = {
  general: 'general.md',
  llm: 'llm.md',
  skills: 'skills.md',
  obsidian: 'obsidian.md',
  telegram: 'telegram.md',
  discord: 'discord.md',
};

/** Print the help body for a topic. Falls back to a one-liner when
 *  the help file isn't shipped (defensive — keeps the wizard alive
 *  even on partial install). */
export function showHelp(io: WizardIO, topic: HelpTopic): void {
  const path = join(HELP_DIR, TOPIC_FILE[topic]);
  let body: string;
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    body = inlineFallback(topic);
  }
  io.print('');
  io.print('───────── help ─────────');
  for (const line of body.split('\n')) io.print(line);
  io.print('────────────────────────');
  io.print('');
}

/** True when the input is the help marker (`?` / `help`). */
export function isHelpRequest(input: string): boolean {
  const t = input.trim().toLowerCase();
  return t === '?' || t === 'help' || t === 'h';
}

/** One-line summaries used as a fallback when the markdown file is
 *  missing. Keeps the wizard stable during dev / partial installs. */
function inlineFallback(topic: HelpTopic): string {
  switch (topic) {
    case 'general':
      return 'Type a value and press Enter. Type "?" or "help" at any prompt for context-specific help.';
    case 'llm':
      return 'Pick the LLM provider you want monad to use. Each provider needs an API key (or OAuth for Codex).';
    case 'skills':
      return 'Pick the agent whose skills you mainly use. You can add custom skill directories afterward.';
    case 'obsidian':
      return 'Absolute path to your Obsidian vault root. Used by the vault-save skill.';
    case 'telegram':
      return 'Bot token from @BotFather + numeric user IDs from @userinfobot.';
    case 'discord':
      return 'Bot token from discord.com/developers/applications + numeric user snowflake IDs.';
  }
}
