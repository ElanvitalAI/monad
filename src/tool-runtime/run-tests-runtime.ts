// ── run_tests ToolRuntime wrapper (OH8 follow-up · PR-1) ──
//
// Wraps dispatchRunTests (src/skills/tools/run-tests.ts) in the ToolRuntime
// shape. Read-only substrate — spawns `bun test` per filter and reports which
// filters matched no files. No approval gate (mirrors bash/run-shell exposure;
// execution safety is the sandbox's job, not this reporter's).

import {
  buildRunTestsTool,
  dispatchRunTests,
  type RunTestsArgs,
} from '../skills/tools/run-tests.js';
import type { ToolRuntime } from './types.js';

// Out = any (announceCompletionRuntime 동형) — RunTestsResult 는 인터페이스라
// Record<string, unknown> index signature 를 못 만족(ToolRunResult 제약). 실제 반환은
// dispatchRunTests 가 RunTestsResult 로 타입 보장한다.
export const runTestsRuntime: ToolRuntime<RunTestsArgs, any> = {
  id: 'run_tests',
  spec: buildRunTestsTool(),
  async run(req) {
    return dispatchRunTests(req);
  },
};
