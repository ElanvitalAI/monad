// ── Prompt-bank seed fragments for AU7 ──
//
// Three fragments inserted into the prompt-bank store on boot. Each
// targets one of the intent tags from intent-classifier.ts and
// gets injected into the system slot when the classifier fires.
//
// Seeding is idempotent — the fragment's id is stable, so the
// seeder updates content + version in place rather than creating
// duplicates on each boot.

import type { PromptBankStore, CreatePromptFragmentInput, PromptFragment } from './types.js';

const AMBIGUOUS_FRAGMENT: CreatePromptFragmentInput = {
  id: 'elanous-au7-ambiguous-intent',
  name: 'AU7: ambiguous intent',
  scope: 'global',
  owner: 'elanous',
  kind: 'instruction',
  targetSlot: 'system',
  priority: 70,
  enabled: true,
  description: 'Suggest AskUserQuestion when the user gives a vague directive (refactor / clean up / improve / "update it").',
  tags: ['au7', 'ask-user-question', 'ambiguous'],
  triggers: { intent: ['ambiguous'] },
  constraints: { maxTokens: 180 },
  content: `## Ambiguous intent detected

The user's message uses a vague directive ("refactor", "clean up",
"improve", "update it") without specifying WHICH code, which files,
or which approach. Before editing, either:

  (a) Answer the ambiguity via Read/Grep if the code itself makes
      the intent unambiguous (e.g., "refactor auth.ts" — clearly
      that file), OR
  (b) Call AskUserQuestion with 2-4 options covering the likely
      interpretations (scope, approach, style).

One clarifying question saves a rollback.`,
  metadata: { source: 'au7-seed' },
};

const DESTRUCTIVE_FRAGMENT: CreatePromptFragmentInput = {
  id: 'elanous-au7-destructive-intent',
  name: 'AU7: destructive intent',
  scope: 'global',
  owner: 'elanous',
  kind: 'instruction',
  targetSlot: 'system',
  priority: 60,  // slightly stronger than ambiguous
  enabled: true,
  description: 'Force confirmation when the user phrases a destructive action (delete / drop / rm / force-push).',
  tags: ['au7', 'ask-user-question', 'destructive'],
  triggers: { intent: ['destructive'] },
  constraints: { maxTokens: 200 },
  content: `## Destructive intent detected

The user's message contains a destructive verb (delete, drop, rm,
wipe, force-push, reset --hard, etc.). Before emitting commands:

1. Confirm the EXACT target. If there's any room for misinterpretation
   (which table? which files? which branch?), call AskUserQuestion
   with the candidate targets as options.
2. Prefer a dry-run or list-mode first when the tool supports it
   (e.g., "git clean -nfd" before "git clean -fd") so the user can
   see the scope.
3. Guardian will also force an approval modal on matching argv — but
   asking up front is friendlier than being blocked mid-stream.`,
  metadata: { source: 'au7-seed' },
};

const MULTI_FILE_FRAGMENT: CreatePromptFragmentInput = {
  id: 'elanous-au7-multi-file-intent',
  name: 'AU7: multi-file scope',
  scope: 'global',
  owner: 'elanous',
  kind: 'instruction',
  targetSlot: 'system',
  priority: 80,
  enabled: true,
  description: 'Suggest AskUserQuestion when the user implies a codebase-wide change ("everywhere", "all files", "모든 모듈").',
  tags: ['au7', 'ask-user-question', 'multi-file'],
  triggers: { intent: ['multi-file'] },
  constraints: { maxTokens: 160 },
  content: `## Multi-file scope detected

The user asked for a change that could touch many files ("across
the codebase", "everywhere", "every module", "모든 파일"). Before
fanning out:

1. Use Glob / Grep to list the actual candidate files.
2. If the list is ≥ 5 files OR crosses unrelated modules, call
   AskUserQuestion to confirm the scope. Options like "just <list
   top 3>", "include tests", "whole codebase", "abort".
3. On a confirmed big scope, state your plan before the first Edit
   so the user can Esc if the interpretation was wrong.`,
  metadata: { source: 'au7-seed' },
};

const SEEDS: CreatePromptFragmentInput[] = [
  AMBIGUOUS_FRAGMENT,
  DESTRUCTIVE_FRAGMENT,
  MULTI_FILE_FRAGMENT,
];

export interface SeedResult {
  created: number;
  updated: number;
  unchanged: number;
}

/** Seed the store with the AU7 fragments. Idempotent: on re-boot,
 *  fragments with the same id get their content / version refreshed
 *  in place (so future AU7 patches update existing installs). */
export function seedAu7Fragments(store: PromptBankStore): SeedResult {
  const result: SeedResult = { created: 0, updated: 0, unchanged: 0 };
  for (const seed of SEEDS) {
    const existing: PromptFragment | null = seed.id ? store.get(seed.id) : null;
    if (!existing) {
      store.create(seed);
      result.created += 1;
      continue;
    }
    if (existing.content === seed.content
        && existing.priority === (seed.priority ?? 100)
        && existing.enabled === (seed.enabled ?? true)) {
      result.unchanged += 1;
      continue;
    }
    store.update(existing.id, {
      name: seed.name,
      content: seed.content,
      priority: seed.priority,
      description: seed.description,
      tags: seed.tags,
      triggers: seed.triggers,
      constraints: seed.constraints,
      metadata: seed.metadata,
    });
    result.updated += 1;
  }
  return result;
}

export const AU7_SEED_IDS: readonly string[] = SEEDS.map(s => s.id!).filter(Boolean);
