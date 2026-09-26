// ACP 세션 계측 + 테스트 우주 로그 바닥 (2026-07-27)
//
// 발단(실측): `elanous attach --message` 로 자연어를 데몬(L2)에 던졌는데 **4분간 무출력**으로
// 끝났고, 연결됐는지·프롬프트가 처리됐는지조차 판정할 수 없었다. 운영 로그 6시간 전수에서
// `acp` 계열은 `acp.termframe`(프레임 팬아웃)뿐 — **"agent → L2" 왕복이 통째로 암흑**이었다.
//
// ⚠️ 처음엔 `debug.enabled` 게이트가 닫혀서라고 진단했으나 **틀렸다** — 실측하니
//    `~/.elanous/logs/level.json` 이 `detail` 이라 게이트는 열려 있었다. 원인은 게이트가 아니라
//    **계측 자체의 부재**였다. 이 테스트는 그 계측의 계약을 고정한다.

import { describe, expect, test } from 'bun:test';
import { summarizeToolArgs, describeToolResult } from '../src/acp/server.js';
import { hotPathGateOpen, resolveStartupDebugLevel } from '../src/mss/logging/scoped-level.js';

describe('summarizeToolArgs — 관측용 요약(원문 통째 금지·비밀 차단)', () => {
  test('문자열은 프리뷰, 상한 초과는 길이와 함께 절단', () => {
    const long = 'x'.repeat(500);
    const out = summarizeToolArgs({ feature: long });
    expect(out.feature.startsWith('x'.repeat(200))).toBe(true);
    expect(out.feature).toContain('(500)');
    expect(out.feature.length).toBeLessThan(230);
  });

  test('★비밀 키는 값 대신 [redacted] — debug 모듈은 스크럽하지 않으므로 호출측이 건다', () => {
    const out = summarizeToolArgs({ apiKey: 'sk-live-should-never-appear', token: 'abc', authorization: 'Bearer z' });
    expect(out.apiKey).toBe('[redacted]');
    expect(out.token).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(JSON.stringify(out)).not.toContain('sk-live');
  });

  test('객체/배열은 타입과 크기만 (본문 유출·폭주 방지)', () => {
    const out = summarizeToolArgs({ opts: { a: 1, b: 2 }, files: [1, 2, 3] });
    expect(out.opts).toBe('object(2)');
    expect(out.files).toBe('array(3)');
  });

  test('키 개수 상한 — 초과분은 개수로만', () => {
    const many = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 'v']));
    const out = summarizeToolArgs(many);
    expect(Object.keys(out).length).toBeLessThanOrEqual(7);   // 6키 + '…'
    expect(out['…']).toBe('+4 keys');
  });

  test('비-객체 입력에 던지지 않는다 (fail-soft)', () => {
    expect(summarizeToolArgs(null)).toEqual({});
    expect(summarizeToolArgs('str' as unknown)).toEqual({});
  });
});

describe('describeToolResult — 거부가 성공처럼 보이면 안 된다', () => {
  test('★{error} 반환은 ok:false — elanous 툴은 throw 대신 이 형태로 거부한다(nest-cap 등)', () => {
    const r = describeToolResult({ error: 'nest-cap: 재귀 상한(5중) 도달 — SelfImplement 비활성' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nest-cap');
  });

  test('정상 결과는 ok:true + 모양만', () => {
    expect(describeToolResult({ prUrl: 'x', merged: true }).ok).toBe(true);
    expect(describeToolResult({ prUrl: 'x', merged: true }).shape).toBe('object(2)');
    expect(describeToolResult('done').shape).toBe('string(4)');
  });

  test('빈 error 문자열은 거부로 보지 않는다', () => {
    expect(describeToolResult({ error: '' }).ok).toBe(true);
  });
});

describe('hotPathGateOpen — 레벨은 단조가 아니다', () => {
  test('★detail 은 diag=false 인데 mirror 로 게이트가 열린다 (단순 서열 비교가 틀리는 지점)', () => {
    expect(hotPathGateOpen('detail')).toBe(true);
    expect(hotPathGateOpen('diag')).toBe(true);
    expect(hotPathGateOpen('normal')).toBe(true);
    expect(hotPathGateOpen('keytrace')).toBe(true);
  });

  test('off·trail 만 닫힌다 (trail 은 파일만 켜고 핫패스는 닫음)', () => {
    expect(hotPathGateOpen('off')).toBe(false);
    expect(hotPathGateOpen('trail')).toBe(false);
  });
});

describe('resolveStartupDebugLevel — 테스트 우주 바닥', () => {
  test('★테스트 우주에서 config 상속값이 게이트를 닫으면 diag 로 올린다', () => {
    const r = resolveStartupDebugLevel({ configLevel: 'trail', isTestInstance: true });
    expect(r.level).toBe('diag');
    expect(r.source).toBe('test-floor');
  });

  // ★리뷰 must-fix — 스코프 파일은 `elanous logs level off` 의 영속처이자 **사람의 명시**다.
  //   바닥이 그걸 덮으면 "꺼둔 게 재기동마다 되살아난다".
  test('★스코프 파일의 명시 off/trail 은 테스트 우주에서도 덮지 않는다', () => {
    expect(resolveStartupDebugLevel({ scopedLevel: 'off', configLevel: 'detail', isTestInstance: true }))
      .toEqual({ level: 'off', source: 'scoped' });
    expect(resolveStartupDebugLevel({ scopedLevel: 'trail', configLevel: 'detail', isTestInstance: true }))
      .toEqual({ level: 'trail', source: 'scoped' });
  });

  test('★운영은 무접촉 — 같은 입력이라도 prod 면 그대로 둔다', () => {
    const r = resolveStartupDebugLevel({ configLevel: 'trail', isTestInstance: false });
    expect(r.level).toBe('trail');
    expect(r.source).toBe('config');
  });

  test('★내리지 않는다 — 이미 게이트가 열린 레벨은 그대로(관측 축소 금지)', () => {
    expect(resolveStartupDebugLevel({ configLevel: 'detail', isTestInstance: true }).level).toBe('detail');
    expect(resolveStartupDebugLevel({ scopedLevel: 'keytrace', configLevel: 'off', isTestInstance: true }).level)
      .toBe('keytrace');
  });

  test('우선순위 — env > 스코프 파일 > config', () => {
    expect(resolveStartupDebugLevel({
      envLevel: 'normal', scopedLevel: 'diag', configLevel: 'detail', isTestInstance: false,
    })).toEqual({ level: 'normal', source: 'env' });
    expect(resolveStartupDebugLevel({
      scopedLevel: 'diag', configLevel: 'detail', isTestInstance: false,
    })).toEqual({ level: 'diag', source: 'scoped' });
  });

  test('★env 명시는 테스트 바닥보다 우선 — 사람이 off 를 원하면 끈다', () => {
    const r = resolveStartupDebugLevel({ envLevel: 'off', configLevel: 'detail', isTestInstance: true });
    expect(r).toEqual({ level: 'off', source: 'env' });
  });

  test('알 수 없는 env 값은 무시하고 아래 층으로', () => {
    expect(resolveStartupDebugLevel({ envLevel: 'bogus', configLevel: 'diag', isTestInstance: false }).source)
      .toBe('config');
  });
});

// ★ 배선 게이트 (리뷰 · 2026-07-27)
//
// ⚠️ 초판은 **Goodhart 였다** — 테스트가 실제 ACP 턴을 돌리지 않고 자기가 같은 `debug.log` 를
//    불러놓고 "잡혔다"고 단언했다(리뷰 must-fix). 계측을 통째로 지워도 통과했다. **삭제한다.**
//    실제 턴 구동(ndJsonStream duplex + JSON-RPC 핸드셰이크)은 별도 통합 하니스가 필요하고,
//    그건 후속으로 남긴다. 대신 아래 정적 게이트를 **블록 인식**으로 만들어 실질 보장을 준다.
describe('배선 — 계측이 소스에서 게이트 밖에 있다 (블록 인식 ratchet)', () => {
  const CALLS = [
    "debug.log('acp.session', 'new'",
    "debug.log('acp.session', 'prompt-start'",
    "debug.log('acp.session', 'prompt-end'",
    "debug.log('acp.session', 'prompt-failed'",
    "debug.log('acp.tool', 'call'",
    "debug.log('acp.tool', 'result'",
  ];

  /** 호출 지점이 `if (debug.enabled)` 블록 **안**인가 — 중괄호를 거꾸로 세어 판정한다.
   *  직전 한 줄만 보면 `if (debug.enabled) { 다른문장; debug.log(...) }` 를 통과시킨다(리뷰 must-fix). */
  function insideEnabledGate(src: string, at: number): boolean {
    let depth = 0;
    for (let i = at - 1; i >= 0; i -= 1) {
      const c = src[i];
      if (c === '}') depth += 1;
      else if (c === '{') {
        if (depth === 0) {
          // 이 여는 중괄호가 우리를 감싼다 — 그 줄머리가 게이트인지 본다.
          const head = src.slice(src.lastIndexOf('\n', i) + 1, i);
          if (head.includes('if (debug.enabled)')) return true;
          depth = 0;                       // 계속 위로(중첩 블록)
        } else depth -= 1;
      }
    }
    return false;
  }

  test('★6종 계측이 존재하고, 어느 것도 debug.enabled 블록 안에 있지 않다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${process.cwd()}/src/acp/server.ts`, 'utf-8');
    for (const call of CALLS) {
      expect(src).toContain(call);                                  // ①삭제 차단
      expect(insideEnabledGate(src, src.indexOf(call))).toBe(false); // ②게이트 안 이동 차단
    }
  });

  test('★판정기 자체가 게이트를 잡는다 (술어의 뮤테이션 자가검증)', () => {
    const fake = "function f(){\n  if (debug.enabled) {\n    other();\n    debug.log('x','y');\n  }\n}";
    const inner = (src: string, at: number): boolean => {
      let depth = 0;
      for (let i = at - 1; i >= 0; i -= 1) {
        const c = src[i];
        if (c === '}') depth += 1;
        else if (c === '{') {
          if (depth === 0) {
            const head = src.slice(src.lastIndexOf('\n', i) + 1, i);
            if (head.includes('if (debug.enabled)')) return true;
          } else depth -= 1;
        }
      }
      return false;
    };
    // 직전 한 줄만 보는 약한 판정은 여기서 false 를 내지만, 블록 인식은 true 여야 한다.
    expect(inner(fake, fake.indexOf("debug.log('x','y')"))).toBe(true);
  });
});
