import { test, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** barsnap 반증이 낸 구조화 요약. ⛔ 고정 문면("6/6")을 대조하면 반증을 «늘릴 때»
 *  래퍼가 깨진다 — 이중 계약이 된다(리뷰 지적 · #18571). 수는 «동일성»으로 본다. */
interface BarsnapSummary {
  total: number;
  passed: number;
  failed: string[];
  names: string[];
}

// ⛔ scripts/film/barsnap.test.py 는 파이썬 독립 실행 반증이라 bun test 도 pytest 도 안 줍는다.
//    그대로 두면 아무도 안 부르고 썩는다. 이 래퍼가 저장소 테스트 경로에서 그것을 부른다.
test('barsnap python disproof runs and every check passes', () => {
  const script = 'scripts/film/barsnap.test.py';
  expect(existsSync(script)).toBe(true);

  const r = spawnSync('python3', [script], { encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) {
    throw new Error(`barsnap 반증 실패 (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
  }

  // ⛔ exit 0 만 보면 「안 죽었다」밖에 모른다 — 요약을 읽어 «무엇이 돌았는지»를 본다.
  const line = r.stdout.split('\n').find((l) => l.startsWith('BARSNAP_SUMMARY '));
  if (!line) throw new Error(`요약 줄이 없다 — 반증이 실제로 돌았나:\n${r.stdout}`);
  const s = JSON.parse(line.slice('BARSNAP_SUMMARY '.length)) as BarsnapSummary;

  expect(s.failed).toEqual([]);
  expect(s.passed).toBe(s.total);              // ⭐ 동일성 — 항목이 늘어도 안 깨진다
  expect(s.total).toBeGreaterThanOrEqual(4);   // ⛔ 반증을 «지워» 빈 통과가 되는 것은 막는다
  expect(s.names).toContain('from_audio 가 BPM 을 되찾는다'); // dead 였던 축이 살아 있나
});
