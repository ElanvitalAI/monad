import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { searchMemories } from '../memory.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function memoryRootWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'recall-obs-'));
  dirs.push(root);
  mkdirSync(root, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

function capture<T>(fn: () => T): { result: T; events: Array<{ event: string; data: Record<string, unknown> }> } {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const original = (debug as { log: typeof debug.log }).log;
  (debug as { log: typeof debug.log }).log = ((_c, event, data) => {
    events.push({ event, data: (data ?? {}) as Record<string, unknown> });
  }) as typeof debug.log;
  try { return { result: fn(), events }; } finally { (debug as { log: typeof debug.log }).log = original; }
}

/**
 * ⛔⭐⭐ 종전엔 recall 이 «질의»만 남겼다. 그래서 「불렀는데 0건」과 「불러서 찾았다」를 «못 갈랐다» —
 * 호출 수 1,089 라는 그럴듯한 수가 「기억이 작동하나」에 아무 답도 못 했다(`F42`).
 */
describe('recall 이 「무엇을 얻었나」를 남긴다', () => {
  test('⭐ 찾았을 때 hits 와 candidates 를 «둘 다» 남긴다', () => {
    const root = memoryRootWith({
      'a.md': '---\nname: typescript-pref\ntype: user\ndescription: prefers typescript\n---\n본문 typescript',
      'b.md': '---\nname: other\ntype: user\ndescription: unrelated topic\n---\n본문',
    });
    const { result, events } = capture(() => searchMemories('typescript', {}, root));
    const observed = events.find((e) => e.event === 'recall-result');
    expect(observed).toBeDefined();
    expect(observed!.data.hits).toBe(result.length);
    // ⛔ 「찾을 대상이 몇이었나」 — 0건의 이유를 가르는 분모다
    expect(observed!.data.candidates).toBe(2);
  });

  test('⛔ 0건이어도 «분모»가 남는다 — 「없어서」와 「안 맞아서」가 갈린다', () => {
    const root = memoryRootWith({ 'a.md': '---\nname: x\ntype: user\ndescription: y\n---\n본문' });
    const { events } = capture(() => searchMemories('완전히다른질의어', {}, root));
    const observed = events.find((e) => e.event === 'recall-result');
    expect(observed!.data.hits).toBe(0);
    expect(observed!.data.candidates).toBe(1);
  });

  test('⛔ 질의에서 토큰이 안 나오면 «조기 반환»이라 결과 관측이 없다(계약 명시)', () => {
    const root = memoryRootWith({ 'a.md': '---\nname: x\ntype: user\ndescription: y\n---\n본문' });
    const { result, events } = capture(() => searchMemories('   ', {}, root));
    expect(result).toEqual([]);
    expect(events.find((e) => e.event === 'recall-result')).toBeUndefined();
  });
});
