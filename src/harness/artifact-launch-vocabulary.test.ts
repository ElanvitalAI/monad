import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SHARED_ARTIFACT_LAUNCH_REASONS,
  sharedReasonDrift,
} from './artifact-launch-vocabulary.js';

/** ⛔ 층의 «소스»에서 사유 이름을 읽는다 — 타입을 import 하면 런타임에 값이 없다(유니온은 지워진다).
 *  ⚠️ 이 방식의 한계를 «알고» 쓴다: 문자열 리터럴을 세므로 주석 속 이름도 걸린다.
 *  ⇒ 그래서 판정은 「겹치는 다섯이 갈렸나」에만 쓰고, 「이 층이 무엇을 쓰나」의 정본으로는 안 쓴다. */
function reasonLiteralsIn(relativePath: string): string[] {
  const source = readFileSync(join(import.meta.dir, '..', '..', relativePath), 'utf8');
  return [...new Set([...source.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)].map((m) => m[1]!))];
}

const LAYERS = [
  { name: '저작기', path: 'src/self-implement/goal-author.ts' },
  { name: '런처', path: 'src/harness/artifact-launcher.ts' },
  { name: '검증 CLI', path: 'src/harness/deliverable-verify-cli.ts' },
  { name: '배선', path: 'src/self-dev/deliverable-target-wiring.ts' },
] as const;

describe('산출물 켜기 «공유 어휘» — 접지 않고 «갈리면 빨개지게»', () => {
  test('⛔ 공유 목록에 «중복»이 없다', () => {
    expect(new Set(SHARED_ARTIFACT_LAUNCH_REASONS).size).toBe(SHARED_ARTIFACT_LAUNCH_REASONS.length);
  });

  test('⭐⭐⭐ 공유 이름이 «어느 층에» 있는지를 «못 박는다» — 한 곳만 갈려도 여기서 빨개진다', () => {
    // ⛔⭐ 앞 판은 「두 층 이상이 쓴다」만 물어서 ***한 층이 갈려도 초록이었다***
    //   (반증 실측 2026-08-20: no-port-declaration 을 한 층에서 갈았는데 5 pass — 가드가 «안 물었다»).
    //   ⇒ 🔑 그래서 「몇 층인가」가 아니라 ***「정확히 어느 층인가」***를 못 박는다.
    // 📌 층이 «정당하게» 바뀌면 이 시험이 빨개진다 — 그때 이 표를 «고쳐서» 바뀐 사실을 남긴다.
    //   ⛔ 벽이 아니라 래칫인 이유: 바뀜을 «막지» 않고 «보이게» 한다.
    const usage: Record<string, string[]> = {};
    for (const layer of LAYERS) {
      for (const name of reasonLiteralsIn(layer.path)) {
        if (!(SHARED_ARTIFACT_LAUNCH_REASONS as readonly string[]).includes(name)) continue;
        usage[name] = [...(usage[name] ?? []), layer.name];
      }
    }
    expect(usage).toEqual({
      'ambiguous-command-source': ['저작기', '런처'],
      'invalid-launch-declaration': ['런처', '검증 CLI'],
      'no-command-source': ['저작기', '런처'],
      'no-launch-declaration': ['저작기', '런처', '검증 CLI', '배선'],
      'no-port-declaration': ['런처', '검증 CLI', '배선'],
    });
  });

  test('⛔ 공유 이름은 «두 층 이상»이 쓴다 — 하나뿐이면 그것은 공유가 아니다', () => {
    const count = (name: string): number =>
      LAYERS.filter((l) => reasonLiteralsIn(l.path).includes(name)).length;
    expect(SHARED_ARTIFACT_LAUNCH_REASONS.filter((n) => count(n) < 2)).toEqual([]);
  });

  test('sharedReasonDrift 가 «무엇이 어긋났는지»를 낸다 — 「같다/다르다」로 접지 않는다', () => {
    const drift = sharedReasonDrift(['no-port-declaration', 'layer-only-thing']);
    expect(drift.layerOnly).toEqual(['layer-only-thing']);
    expect(drift.absent).toContain('no-launch-declaration');
    expect(drift.absent).not.toContain('no-port-declaration');
  });

  test('⛔ 「이 층이 그 이름을 원래 안 쓴다」와 「철자가 갈렸다」는 «다른 값»이다', () => {
    const neverUses = sharedReasonDrift([]);
    const misspelled = sharedReasonDrift(['no-port-declaraton']);   // 오타
    expect(neverUses.layerOnly).toEqual([]);
    expect(misspelled.layerOnly).toEqual(['no-port-declaraton']);   // ← 오타가 «드러난다»
    // 둘 다 absent 는 같지만 layerOnly 가 갈린다 — 그래서 두 값을 «따로» 낸다.
    expect(neverUses.absent).toEqual(misspelled.absent);
  });
});
