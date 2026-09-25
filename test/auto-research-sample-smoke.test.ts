// ── PFC-S3 P6: sample goal dogfood E2E ──
//
// Verifies the sample-attractiveness fixture loads + builds a
// well-formed loop-prompt snapshot end-to-end. This is the minimum
// proof PFC-S3 composes correctly outside of a driver loop.

import { describe, test, expect } from 'bun:test';
import { mkdirSync, mkdtempSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLoopPromptSnapshot,
  renderLoopPromptInjection,
} from '../src/auto-research/loop-prompt';
import { BudgetMeter } from '../src/auto-research/budget-meter';
import { ExperimentLedger } from '../src/auto-research/experiment-ledger';
import { readNote, parseFrontmatter, type ObsidianVault } from '../src/auto-research/obsidian-bridge';

const SAMPLE_SRC = join(
  __dirname, '..', 'samples', 'research-goals', 'sample-attractiveness',
);

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    const st = statSync(s);
    if (st.isDirectory()) copyDirRecursive(s, d);
    else copyFileSync(s, d);
  }
}

describe('PFC-S3 P6 — sample-attractiveness dogfood', () => {
  test('ACTIVE.md frontmatter + plan + queue skeleton present', () => {
    const vault: ObsidianVault = { root: join(SAMPLE_SRC, '..'), isSimulated: true, label: 't' };
    const active = readNote(vault, 'sample-attractiveness/ACTIVE.md');
    expect(active).toBeTruthy();
    const { frontmatter } = parseFrontmatter(active!);
    expect(frontmatter.goal).toContain('반도체');
    expect(frontmatter.step).toBe(1);
    const plan = readNote(vault, 'sample-attractiveness/plan.md');
    expect(plan).toContain('Spawn 6 expert agents');
    const queue = readNote(vault, 'sample-attractiveness/question-queue.md');
    expect(queue).toContain('- [ ]');
  });

  test('E2E loop-prompt snapshot → render produces valid 6-section markdown', async () => {
    // Copy the sample into a tmp goal directory so the ledger can
    // write NOW.md without touching the checked-in fixture.
    const dir = mkdtempSync(join(tmpdir(), 'sample-smoke-'));
    const goalRoot = join(dir, 'goals', 'sample-attractiveness');
    copyDirRecursive(SAMPLE_SRC, goalRoot);
    const vault: ObsidianVault = { root: dir, isSimulated: true, label: 't' };
    const ledger = new ExperimentLedger(goalRoot);
    ledger.writeNow('sample turn 0 handoff — ready to spawn');
    const budget = new BudgetMeter({ tokens: 1_000_000, usd: 5 });
    budget.add({ tokens: 320_000, usd: 1.10 });
    const snap = await buildLoopPromptSnapshot({
      vault, goalSlug: 'sample-attractiveness', goalRoot,
      budget, ledger,
      termination: {
        kind: 'and',
        rules: [
          { kind: 'all_questions_answered', queuePath: 'question-queue.md' },
          { kind: 'min_sources', n: 2, sourcesPath: 'knowledge/sources.md' },
          { kind: 'summary_written', path: 'executive-summary.md', minChars: 100 },
        ],
      },
    });
    expect(snap.queuePending.length).toBeGreaterThan(0);
    expect(snap.recentWins.length).toBeGreaterThan(0);
    expect(snap.nowNote).toContain('handoff');
    const text = renderLoopPromptInjection(snap);
    for (const section of ['Plan', 'Question Queue', 'Recent Wins', 'Budget', 'Completion Audit', 'NOW handoff']) {
      expect(text).toContain(section);
    }
  });
});
