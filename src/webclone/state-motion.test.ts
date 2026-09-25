/**
 * state-motion.test.ts — ⛔ 「상태 규칙이 없다」와 「못 읽었다」를 가르는가.
 * ⭐ 그리고 「기본 상태에 없던 곡선」을 «집어내는가» — 그것이 이 축의 존재 이유다.
 */
import { describe, expect, test } from 'bun:test';

import { buildStateMotionExpression, parseStateMotion, renderStateMotionSection,
  VAR_PATTERN,
} from './state-motion.js';

const raw = (o: unknown) => JSON.stringify(o);

describe('⛔ 「없다」와 「못 읽었다」를 가른다', () => {
  test('교차 출처 시트가 있으면 «부분»이라고 말한다', () => {
    const r = parseStateMotion(raw({ rules: [], sheetsRead: 2, unreadableSheets: 3 }))!;
    expect(r.note).toContain('«못 읽었다»');
    expect(renderStateMotionSection(r).join('\n')).toContain('「없다」로 읽지 마라');
  });

  test('전부 읽었고 규칙이 0 이면 «없다»고 말해도 된다', () => {
    const r = parseStateMotion(raw({ rules: [], sheetsRead: 4, unreadableSheets: 0 }))!;
    expect(r.note).toContain('전부 읽었다');
    expect(renderStateMotionSection(r).join('\n')).toContain('상태 전환 규칙이 **없다**');
  });

  test('파싱 실패는 null — 「상태 전환이 없다」가 아니다', () => {
    expect(parseStateMotion('nope')).toBeNull();
    expect(parseStateMotion(raw({ rules: [] }))).toBeNull();   // sheetsRead 가 없다
    expect(renderStateMotionSection(null).join('\n')).toContain('«아니다»');
  });
});

describe('⭐⭐ 「기본 상태에 없던 곡선」을 집어낸다', () => {
  const report = () => parseStateMotion(
    raw({
      sheetsRead: 3, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 12, durations: ['0.3s'], easings: ['cubic-bezier(0.25, 1, 0.5, 1)'], properties: ['all'] }],
    }),
    ['ease'],   // 기본 상태에서 관측된 곡선
  )!;

  test('기본에 없던 곡선을 «목록»으로 낸다', () => {
    expect(report().easingsOnlyInStates).toEqual(['cubic-bezier(0.25, 1, 0.5, 1)']);
  });

  test('산출이 「기본만 재면 전부 놓친다」고 «말한다»', () => {
    const text = renderStateMotionSection(report()).join('\n');
    expect(text).toContain('기본 상태에 «없던» 가속 곡선');
    expect(text).toContain('«전부 놓친다»');
  });

  test('기본에 «이미 있던» 곡선은 «안 센다» (소음 금지)', () => {
    const r = parseStateMotion(
      raw({ sheetsRead: 1, unreadableSheets: 0, rules: [{ state: 'hover', count: 2, durations: [], easings: ['ease'], properties: [] }] }),
      ['ease'],
    )!;
    expect(r.easingsOnlyInStates).toEqual([]);
    expect(renderStateMotionSection(r).join('\n')).not.toContain('«없던» 가속 곡선');
  });
});

describe('표현식', () => {
  test('네 상태를 «전부» 본다', () => {
    const e = buildStateMotionExpression();
    for (const s of ['hover', 'focus-visible', 'focus', 'active']) expect(e).toContain(s);
  });

  test('⭐ @media·@supports «안»으로 들어간다 — 반응형 안의 상태 규칙을 놓치지 않게', () => {
    expect(buildStateMotionExpression()).toContain('rule.cssRules');
  });

  test('⛔ 교차 출처 시트를 «세고» 넘어간다 — 조용히 건너뛰지 않는다', () => {
    expect(buildStateMotionExpression()).toContain('unreadable += 1');
  });

  test('⭐ cubic-bezier 의 «쉼표»로 안 쪼갠다 (곡선이 넷으로 찢어진다)', () => {
    expect(buildStateMotionExpression()).toContain('/,(?![^(]*\\))/');
  });

  test('JSON 문자열을 반환한다', () => {
    expect(buildStateMotionExpression()).toContain('JSON.stringify');
  });

  // ⛔⭐⭐ 2026-09-10 실측: 템플릿 리터럴 «안»에 정규식을 쓰자 백슬래시가 먹혀
  //    `/var(s*…)/` 라는 «다른 정규식»이 됐고, 문법상 유효해서 «조용한 0» 이 났다.
  //    ⇒ 이 시험은 「고쳤다」가 아니라 ***「그 계급의 사고가 다시 나면 문다」***를 맡는다.
  test('⛔ 정규식을 템플릿 «안»에 두지 않는다 — 밖에서 만들어 넣는다', () => {
    const expr = buildStateMotionExpression();
    expect(expr).toContain('new RegExp(');
    expect(expr).not.toContain('/var\\(');
  });

  test('⭐ 그리고 그 패턴이 «정말 문다» — 이름·폴백·중첩', () => {
    const re = () => new RegExp(VAR_PATTERN, 'g');
    expect(re().exec('transition: var(--t-fast)')?.[1]).toBe('--t-fast');
    const withFallback = re().exec('var(--missing, 400ms ease-in)');
    expect(withFallback?.[1]).toBe('--missing');
    expect(withFallback?.[2]?.trim()).toBe('400ms ease-in');
    // 폴백 «안»에 괄호가 있어도 닫는 괄호를 «제자리»에서 찾는다
    expect(re().exec('var(--m, cubic-bezier(0,0,1,1))')?.[2]?.trim()).toBe('cubic-bezier(0,0,1,1)');
    // ⛔ 음성 대조군 — 변수가 «아닌» 문면은 안 문다
    expect(re().test('transition: color 0.2s ease')).toBe(false);
  });
});

describe('⛔ `transition: var(…)` 는 「곡선이 없다」가 «아니다»', () => {
  // 📏 실측(crates.io): `:hover` 3규칙이 전부 `transition: var(--transition-instant)` 였다.
  //    CSSOM 은 변수를 «안 풀어 준다» ⇒ 길이·곡선을 못 가른다. 그것을 «말해야» 한다.
  test('⭐ 이제 «푼다» — 뿌리에서 풀린 문면이 오면 길이·곡선을 얻는다', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 12, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 3, durations: [], easings: [], properties: [] }],
      resolved: { hover: ['0.1s cubic-bezier(0.25,1,0.5,1)'] },
    }))!;
    expect(r.rules[0]!.durations).toEqual(['0.1s']);
    expect(r.rules[0]!.easings).toEqual(['cubic-bezier(0.25,1,0.5,1)']);
    expect(r.rules[0]!.resolvedVars).toBe(1);
    // ⭐⭐ 판별력 — 「기본에 없던 곡선」에 «풀어서 얻은» 곡선이 «들어와야» 한다.
    //    안 들어오면 그 사이트의 서명(RESULT-17)이 통째로 빠진다.
    expect(r.easingsOnlyInStates).toEqual(['cubic-bezier(0.25,1,0.5,1)']);
    expect(renderStateMotionSection(r).join('\n')).toContain('«풀어서» 잰 것');
  });

  test('⛔ 풀고도 «못 푼» 칸은 수로 낸다 — 조용히 0 이 되지 않는다', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 12, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 3, durations: [], easings: [], properties: [] }],
      resolved: { hover: ['var(--never-declared)'] },
    }))!;
    expect(r.rules[0]!.unresolvedVars).toBe(1);
    expect(r.rules[0]!.resolvedVars).toBe(0);
    const text = renderStateMotionSection(r).join('\n');
    expect(text).toContain('못 갈랐다');
    expect(text).toContain('「곡선이 없다」가 «아니다»');
  });

  // 🩸 2026-09-10 두 번째 판 — 첫 판은 «단축형»만 되짚어, 표준 관행인
  //    `transition-timing-function: var(--ease-1)`(롱핸드) 이 «문자 그대로» 나갔다.
  test('⭐ 롱핸드 `transition-timing-function: var(…)` 도 푼다 — 그 칸에만 넣는다', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 1, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 1, durations: ['0.14s'], easings: [], properties: [] }],
      resolved: { hover: [{ kind: 'easing', text: 'cubic-bezier(0.2, 0, 0, 1)' }] },
    }))!;
    expect(r.rules[0]!.easings).toEqual(['cubic-bezier(0.2, 0, 0, 1)']);
    // ⛔ 곡선이 «길이» 칸으로 새면 안 된다 — 단축형 파서에 넣으면 그렇게 된다.
    expect(r.rules[0]!.durations).toEqual(['0.14s']);
    expect(r.rules[0]!.resolvedVars).toBe(1);
  });

  test('⛔ 롱핸드가 «안 풀렸으면» 그대로 세고 값으로 안 넣는다', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 1, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 1, durations: [], easings: [], properties: [] }],
      resolved: { hover: [{ kind: 'easing', text: 'var(--nope)' }] },
    }))!;
    expect(r.rules[0]!.easings).toEqual([]);
    expect(r.rules[0]!.unresolvedVars).toBe(1);
  });

  test('⛔ 옛 모양(문자열 배열)도 «받는다» — 형식을 바꿨다고 옛 산출을 던지지 않는다', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 1, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 1, durations: [], easings: [], properties: [] }],
      resolved: { hover: ['0.1s ease-out'] },
    }))!;
    expect(r.rules[0]!.durations).toEqual(['0.1s']);
    expect(r.rules[0]!.easings).toEqual(['ease-out']);
  });

  test('⛔⭐ 한 이름에 값이 «둘 이상»이면 「골랐다」고 말하지 않는다', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 12, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 1, durations: [], easings: [], properties: [] }],
      resolved: { hover: ['0.1s ease'] },
      ambiguousVars: ['--transition-instant'],
    }))!;
    expect(r.ambiguousVars).toEqual(['--transition-instant']);
    expect(renderStateMotionSection(r).join('\n')).toContain('한 이름에 값이 둘 이상');
  });

  test('못 푼 것이 «없으면» 그 줄이 안 나온다 (소음 금지)', () => {
    const r = parseStateMotion(JSON.stringify({
      sheetsRead: 1, unreadableSheets: 0,
      rules: [{ state: 'hover', count: 1, durations: ['0.3s'], easings: ['ease'], properties: [] }],
    }))!;
    expect(renderStateMotionSection(r).join('\n')).not.toContain('못 갈랐다');
  });

  test('⭐ 표현식이 «빈 cssRules 를 truthy 로 읽지» 않는다 — 조용한 0 의 자리였다', () => {
    // 🩸 Chrome 의 CSS 중첩 지원 이후 CSSStyleRule 도 cssRules 를 «갖는다»(빈 리스트).
    //    옛 판은 `if (rule.cssRules) { …; continue; }` 라 «모든 규칙»을 건너뛰었다.
    expect(buildStateMotionExpression()).toContain('rule.cssRules.length');
    expect(buildStateMotionExpression()).not.toContain('if (rule.cssRules) { walk');
  });
});
