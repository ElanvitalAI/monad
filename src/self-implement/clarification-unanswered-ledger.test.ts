import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSelfImplement, clarificationUnansweredOutcomeOf, type GoalExecutionRecord } from './orchestrator.js';
import { seams } from './test-seams.js';

/**
 * ⛔⭐⭐ 종전 결손 — 원장은 `'timeout'` 일 때만 「미답을 두고 진행했다」를 적었다.
 * 그런데 그 값은 ***실패 출력에 「timeout/timed out」이 «글자로» 있을 때만*** 난다.
 * 📏 실측(8일 · 478 escalation): failed 3 · timeout **0** · `no-response` **1**
 * ⇒ 🚨 실제로 「물었는데 답이 안 와서 그냥 진행한」 그 1건이 ***원장에 안 남았다***.
 */
function goalWithDeferredClarifications(root: string): string {
  const goalFile = join(root, 'GOAL.txt');
  writeFileSync(goalFile, [
    'Goal', '- Clarification:', '  - id: delivery_scope', '  - header: Delivery',
    '  - question: Which surface?', '  - options:', '    - label: Telegram',
    '      description: Send there.', '  - answer: DEFERRED-UNTIL: Which surface?', '',
  ].join('\n'));
  return goalFile;
}

/**
 * ⚠️⭐ **이 파일이 «못» 무는 것 — 정직하게 적는다.**
 * `no-response` 는 ***dispatch 심이 «없는»*** 경로(설치된 리졸버가 답을 못 받음)에서만 난다.
 * 그래서 여기서는 ***판정을 순수 함수로*** 물고, ***배선은 `timeout` 경로로*** 문다.
 * ⛔ 즉 「no-response 가 원장까지 간다」는 ***끝에서 끝까지 안 쟀다***. 라이브 표본이 쌓이면 그때 잰다.
 */
describe('미답 clarification 이 원장에 남는다 — 두 상태를 «갈라서»', () => {
  test("⭐ `no-response` 도 「미답」으로 판정된다 — 종전엔 이 상태가 «통째로» 빠졌다", () => {
    expect(clarificationUnansweredOutcomeOf('no-response')).toBe('no-response');
    expect(clarificationUnansweredOutcomeOf('timeout')).toBe('timeout');
  });

  test("⛔ 그 밖의 상태는 «미답이 아니다» — 넓히다 `failed`·`fallback` 까지 삼키지 않는다", () => {
    for (const o of ['skipped', 'delivered', 'fallback', 'failed', '']) {
      expect(clarificationUnansweredOutcomeOf(o)).toBeUndefined();
    }
  });

  test("⛔ 두 상태를 «뭉개지 않는다» — 어느 쪽이었는지가 남는다", async () => {
    const root = mkdtempSync(join(tmpdir(), 'clarification-timeout-'));
    const goalFile = goalWithDeferredClarifications(root);
    const records: GoalExecutionRecord[] = [];
    const progress: Array<{ stage: string; message: string }> = [];
    try {
      await runSelfImplement({
        feature: 'timeout keeps its own label',
        runId: 'run-clarification-timeout-label', goalFile,
        writeGoalExecutionRecord: (_path, record) => { records.push(record); },
        seams: seams({
          onProgress: (event) => { progress.push(event); },
          escalateGoalClarifications: async () => { rmSync(goalFile); return { output: 'timed out' }; },
        }),
      });
      expect(records[0]?.clarificationUnansweredOutcome).toBe('timeout');
      // ⛔ 그리고 기존 진척 문면은 «보존»된다 — 이 변경의 목적이 아닌 계약이다
      expect(progress).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('미답 1개 (delivery_scope)를 두고 진행'),
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
