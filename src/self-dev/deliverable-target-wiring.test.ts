import { describe, expect, test } from 'bun:test';
import { buildDeliverableTargets } from './deliverable-target-wiring.js';
import { observeDeliverables } from '../harness/deliverable-observation.js';

// ⛔ 이 문면은 파서(parseArtifactLaunchDeclaration)가 «실제로» 무는 라벨형이다.
//   외워 쓰지 말고 바뀌면 파서에 물어 고쳐라(MANUAL-goal-authoring-method §1a).
const withDeclaration = (port: string | number) => [
  '# 골',
  '',
  '## 산출물을 어떻게 켜나',
  '',
  '- Entrypoint: apps/demo/server.ts',
  `- Port: ${port}`,
  '- Environment: DEMO_TOKEN',
  '',
].join('\n');

describe('buildDeliverableTargets', () => {
  test('선언이 있으면 조각 «전부»에 같은 타깃을 붙인다', () => {
    const r = buildDeliverableTargets(withDeclaration(31415), ['a', 'b'], 'all', '127.0.0.1');
    expect(r.wired).toBe(true);
    if (!r.wired) return;
    expect(r.port).toBe(31415);
    expect(r.targets).toEqual([
      { taskId: 'a', target: 'http://127.0.0.1:31415/' },
      { taskId: 'b', target: 'http://127.0.0.1:31415/' },
    ]);
  });

  test("attribution='last' 는 «말단 하나»에만 붙인다", () => {
    const r = buildDeliverableTargets(withDeclaration(8080), ['a', 'b', 'c'], 'last', '127.0.0.1');
    expect(r.wired).toBe(true);
    if (!r.wired) return;
    expect(r.targets.map((t) => t.taskId)).toEqual(['c']);
  });

  test('⛔ 귀속에 «숨은 기본값»이 없다 — 두 값이 서로 다른 결과를 낸다', () => {
    const all = buildDeliverableTargets(withDeclaration(8080), ['a', 'b'], 'all', '127.0.0.1');
    const last = buildDeliverableTargets(withDeclaration(8080), ['a', 'b'], 'last', '127.0.0.1');
    expect(all.wired && all.targets.length).toBe(2);
    expect(last.wired && last.targets.length).toBe(1);
  });

  test('선언이 없으면 «이름 있는» 사유로 안 싣는다', () => {
    const r = buildDeliverableTargets('# 골\n\n본문뿐이다.\n', ['a'], 'all', '127.0.0.1');
    expect(r).toEqual({ wired: false, reason: 'no-launch-declaration' });
  });

  test('Port 가 없으면 no-port-declaration', () => {
    const doc = ['# 골', '', '## 산출물을 어떻게 켜나', '', '- Entrypoint: apps/demo/server.ts', ''].join('\n');
    const r = buildDeliverableTargets(doc, ['a'], 'all', '127.0.0.1');
    expect(r).toEqual({ wired: false, reason: 'no-port-declaration' });
  });

  test('조각 id 가 하나도 없으면 no-goal-ids — 빈 문자열은 id 가 아니다', () => {
    expect(buildDeliverableTargets(withDeclaration(31415), [], 'all', '127.0.0.1'))
      .toEqual({ wired: false, reason: 'no-goal-ids' });
    expect(buildDeliverableTargets(withDeclaration(31415), ['', '   '], 'all', '127.0.0.1'))
      .toEqual({ wired: false, reason: 'no-goal-ids' });
  });

  test('공백뿐인 id 는 «걸러지고» 남은 것만 실린다', () => {
    const r = buildDeliverableTargets(withDeclaration(31415), ['', 'b'], 'all', '127.0.0.1');
    expect(r.wired).toBe(true);
    if (!r.wired) return;
    expect(r.targets.map((t) => t.taskId)).toEqual(['b']);
  });

  test('⛔ 범위 밖 포트는 «파서»가 막는다 — 이 층은 그 계약의 «소유자가 아니다»', () => {
    // ⭐ 이 시험이 지키는 것은 「누가 막나」다. 한때 이 층에 같은 검사를 뒀다가 뺐다 —
    //   파서가 1~65535 를 전부 막아서 그 가지가 «영영 안 뜨는» 계약 칸이었기 때문이다.
    //   ⇒ 파서가 그 계약을 놓으면 아래가 «먼저» 빨개져서 알려 준다.
    for (const bad of [0, -1, 70000, 65536]) {
      const r = buildDeliverableTargets(withDeclaration(bad), ['a'], 'all', '127.0.0.1');
      expect({ bad, result: r }).toEqual({ bad, result: { wired: false, reason: 'no-port-declaration' } });
    }
    // ⭐ 경계는 «양쪽»을 문다 — 65535 는 살아야 한다(막는 쪽만 재면 「전부 거부」도 초록이 된다).
    const edge = buildDeliverableTargets(withDeclaration(65535), ['a'], 'all', '127.0.0.1');
    expect(edge.wired && edge.port).toBe(65535);
  });

  test('host 를 주면 그것으로 만든다(격리 관측용)', () => {
    const r = buildDeliverableTargets(withDeclaration(5173), ['a'], 'all', 'localhost');
    expect(r.wired && r.targets[0]!.target).toBe('http://localhost:5173/');
  });

  test('⛔ attribution 이 «모르는 값»이면 묵시적 all 로 흐르지 않고 이름을 댄다', () => {
    // 타입을 안 보는 호출자(JS·설정값·NL)를 흉내낸다 — 이 계약은 «런타임»에서만 깨진다.
    for (const bogus of ['ALL', 'first', '', undefined, null, 0]) {
      const r = buildDeliverableTargets(
        withDeclaration(31415), ['a', 'b'], bogus as never, '127.0.0.1',
      );
      expect({ bogus: String(bogus), r }).toEqual({
        bogus: String(bogus), r: { wired: false, reason: 'invalid-attribution' },
      });
    }
  });

  test('⭐ 만든 타깃이 «소비자»(observeDeliverables)까지 실제로 흐른다', async () => {
    // ⛔ 함수 단위 결과만 재면 「형태는 맞는데 소비자가 못 읽는다」를 못 잡는다 —
    //   이 저장소가 반복해 밟은 그 축이라 이 층은 «심을 건너» 잰다(리뷰 #10550 should-fix).
    const built = buildDeliverableTargets(withDeclaration(31415), ['a', 'b'], 'all', '127.0.0.1');
    expect(built.wired).toBe(true);
    if (!built.wired) return;

    const seen: string[] = [];
    const observed = await observeDeliverables(built.targets, {
      verify: async (target) => {
        seen.push(target);
        return { ok: true, findings: [] } as never;
      },
    });

    expect(seen).toEqual(['http://127.0.0.1:31415/', 'http://127.0.0.1:31415/']);
    expect([...observed.deployFindings.keys()]).toEqual(['a', 'b']);
    expect(observed.deployFindings.get('a')?.target).toBe('http://127.0.0.1:31415/');
    expect(observed.unmeasured).toEqual([]);
  });
});
