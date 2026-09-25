#!/usr/bin/env bun
// §5-⑤ controlled dogfood — exercises the REAL auto-compaction path
// (compactSessionHistory + getDefaultCompactProvider → live summarizer)
// end-to-end against an ISOLATED temp session root, so no real session
// is touched. Proves the fire path the continuation wire (Phase B) will
// hit once a long unattended run crosses the token ratio — something the
// existing continuation dogfood can't show (its scratch goal completes
// in ~3 turns, well under threshold).
//
// Run: bun run scripts/continuation-compact-dogfood.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendMessage,
  createSession,
  loadSession,
} from '../src/session/index.js';
import { compactSessionHistory } from '../src/session/compact-session.js';
import { getUserConfig } from '../src/user-config.js';

const root = mkdtempSync(join(tmpdir(), 'compact-dogfood-'));
const cfg = getUserConfig();
const modelId = cfg.llm?.model;

console.log('loop-engineering §5-⑤ auto-compaction dogfood (real summarizer)');
console.log(`  session root : ${root}`);
console.log(`  model        : ${cfg.llm.provider} / ${modelId}`);

// Build a realistic grown transcript: many turns, each with a large
// (repeated) loop-prompt user message + assistant reply — exactly the
// redundancy an autonomous continuation loop accumulates.
const meta = createSession({ source: 'cli' }, root);
const TURNS = 12;
const FILLER = 'The goal is to write an executive summary. '.repeat(120); // ~5KB each
for (let i = 0; i < TURNS; i++) {
  appendMessage(meta.id, {
    role: 'user',
    content: `[continuation turn ${i}] ${FILLER}`,
    ts: new Date().toISOString(),
  }, root);
  appendMessage(meta.id, {
    role: 'assistant',
    content: `Turn ${i}: investigated termination-dsl.ts, still gathering evidence. ${FILLER}`,
    ts: new Date().toISOString(),
  }, root);
}

const before = loadSession(meta.id, root)!;
const beforeChars = before.messages.reduce((n, m) => n + m.content.length, 0);
console.log(`\n  before: ${before.messages.length} messages · ${beforeChars} chars`);

// Force the threshold low so a 12-turn transcript fires against any
// model's window (the real gate uses cfg.chat.autoCompact = 0.85).
const t0 = Date.now();
const r = await compactSessionHistory(meta.id, {
  modelId,
  config: { enabled: true, triggerRatio: 0.001, preserveLastN: 4, preserveFirstN: 0, partial: true, workingBudgetTokens: 256_000 },
  root,
});
const dt = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n── result (${dt}s) ──`);
console.log(`  fired         : ${r.fired}`);
console.log(`  reason        : ${r.reason}`);
console.log(`  layer3 (LLM)  : ${r.layer3Applied}`);
console.log(`  overflowRetry : ${r.overflowRetries}`);
console.log(`  messages      : ${r.before} → ${r.after}`);

const after = loadSession(meta.id, root)!;
const afterChars = after.messages.reduce((n, m) => n + m.content.length, 0);
console.log(`  chars         : ${beforeChars} → ${afterChars} (${((1 - afterChars / beforeChars) * 100).toFixed(0)}% smaller)`);
if (r.fired) {
  console.log(`  head role     : ${after.messages[0]!.role}`);
  console.log(`  summary head  : ${after.messages[0]!.content.replace(/\s+/g, ' ').slice(0, 200)}`);
  console.log(`  tail preserved: last msg from turn ${TURNS - 1} = ${after.messages[after.messages.length - 1]!.content.toLowerCase().includes(`turn ${TURNS - 1}`)}`);
}

rmSync(root, { recursive: true, force: true });
const ok = r.fired && r.after < r.before && afterChars < beforeChars;
console.log(`\n  ${ok ? '✅ PASS' : '❌ FAIL'} — compaction ${ok ? 'shrank the persisted history via the live summarizer' : 'did not fire as expected'}`);
process.exit(ok ? 0 : 1);
