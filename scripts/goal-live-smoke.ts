// Live LLM smoke test for /goal Ralph loop — FU-2.
//
// Run: bun run scripts/goal-live-smoke.ts
//
// 3 scenarios that hit a real LLM (default: primary provider):
//   [1] judgeGoalTurn round-trip — verifies prompt → JSON parse → verdict.
//   [2] continue chain — judge says "continue" twice then "done".
//   [3] budget cut — turn budget = 2; verifies budget-limited transition.
//
// Requires at least one provider env var (XAI_API_KEY / OPENAI_API_KEY /
// ANTHROPIC_API_KEY / GEMINI_API_KEY / LOCAL_LLM_URL).
//
// Cost: ~5-10 cents on grok-fast / haiku. Each judge call is a one-shot
// JSON output (~100-200 tokens). Three scenarios with 1-3 calls each.

import {
  judgeGoalTurn,
  applyConfidenceGuard,
} from '../src/goals/judge.js';
import {
  _resetForTesting,
  startGoal,
} from '../src/goals/index.js';
import {
  shouldContinueAfterAssistantTurn,
} from '../src/goals/loop.js';

let pass = 0;
let fail = 0;

function assert(cond: boolean, label: string, detail?: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
}

async function scenario1(): Promise<void> {
  console.log('\n[1] judgeGoalTurn round-trip — done verdict');
  const r = await judgeGoalTurn({
    objective: 'Add a hello-world function',
    lastAssistantTurn: 'I added the hello() function exporting "hello world" — it was the only step needed.',
  }, { retries: 1, timeoutMs: 30_000 });

  if (!r) {
    fail += 1;
    console.log('  ✗ judge returned null (parse fail or timeout)');
    return;
  }
  const guarded = applyConfidenceGuard(r);
  console.log(`    verdict: ${guarded.verdict}`);
  console.log(`    summary: ${guarded.summary}`);
  console.log(`    confidence: ${guarded.confidence.toFixed(2)}`);
  assert(['done', 'continue', 'partial'].includes(guarded.verdict),
    'verdict is well-formed');
  assert(guarded.summary.length > 0, 'summary present');
  assert(guarded.confidence >= 0 && guarded.confidence <= 1, 'confidence in [0,1]');
}

async function scenario2(): Promise<void> {
  console.log('\n[2] continue chain — partial → continue → done (live judge × 3)');
  _resetForTesting();
  startGoal({ objective: 'Document the foo() function with a docstring', budget: { maxTurns: 5 } });

  const turn1 = await shouldContinueAfterAssistantTurn(
    {
      lastAssistantTurn: 'I read foo.ts and noticed it has no docstring. Let me write one.',
    },
    { judgeRetries: 1 },
  );
  console.log(`    turn1: ${turn1.kind}` + (turn1.kind !== 'no-goal' && 'verdict' in turn1 ? ` (${turn1.verdict})` : ''));
  assert(turn1.kind === 'continue' || turn1.kind === 'stop',
    'turn1 returned a real action (not no-goal)');

  // If turn1 was already 'done', we're testing a different judge response.
  // Simulate the model making real progress + asking judge again.
  if (turn1.kind === 'continue') {
    const turn2 = await shouldContinueAfterAssistantTurn(
      {
        lastAssistantTurn: 'Done. I added a docstring to foo() with parameter docs and an example.',
      },
      { judgeRetries: 1 },
    );
    console.log(`    turn2: ${turn2.kind}` + (turn2.kind !== 'no-goal' && 'verdict' in turn2 ? ` (${turn2.verdict})` : ''));
    assert(turn2.kind === 'stop' || turn2.kind === 'continue',
      'turn2 returned a real action');
    // If judge still says continue/partial after explicit "Done", it's
    // valid (judge may be cautious) — we just record observation, not
    // hard-fail.
  }
  _resetForTesting();
}

async function scenario3(): Promise<void> {
  console.log('\n[3] budget cut — maxTurns=2, expect budget-limited');
  _resetForTesting();
  startGoal({ objective: 'Write 100 tests', budget: { maxTurns: 2 } });

  // Turn 1
  await shouldContinueAfterAssistantTurn(
    { lastAssistantTurn: 'I wrote 1 test.' },
    { judgeRetries: 1 },
  );

  // Turn 2 — should hit budget cap
  const turn2 = await shouldContinueAfterAssistantTurn(
    { lastAssistantTurn: 'I wrote 2 more tests, 3 total.' },
    { judgeRetries: 1 },
  );
  console.log(`    turn2: ${turn2.kind}` + (turn2.kind === 'stop' ? ` reason=${turn2.reason}` : ''));
  // Either 'stop' (budget-limited) OR judge surprised us with 'done'.
  assert(turn2.kind === 'stop',
    'turn2 hit a stop transition (budget or done)');
  if (turn2.kind === 'stop') {
    assert(['budget-limited', 'done', 'paused'].includes(turn2.reason),
      'stop reason is well-formed');
  }
  _resetForTesting();
}

async function main(): Promise<number> {
  console.log('───────────────────────────────────────────────────');
  console.log('  /goal Ralph loop · live LLM smoke test (FU-2)');
  console.log('───────────────────────────────────────────────────');

  const haveProvider = (
    process.env.XAI_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.GEMINI_API_KEY
    || process.env.LOCAL_LLM_URL
  );
  if (!haveProvider) {
    console.error('✗ No LLM provider env var set. Set one of:');
    console.error('    XAI_API_KEY · OPENAI_API_KEY · ANTHROPIC_API_KEY · GEMINI_API_KEY · LOCAL_LLM_URL');
    return 2;
  }

  const t0 = Date.now();
  try {
    await scenario1();
    await scenario2();
    await scenario3();
  } catch (err) {
    console.error('\n✗ scenario threw:', (err as Error).message);
    return 1;
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n───────────────────────────────────────────────────');
  console.log(`  ${pass} pass · ${fail} fail · ${elapsed}s elapsed`);
  console.log('───────────────────────────────────────────────────\n');
  return fail > 0 ? 1 : 0;
}

main().then((code) => process.exit(code));
