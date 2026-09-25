/**
 * keyframes.test.ts — ⛔ 이 축의 가장 위험한 수는 ***「정의됐다」를 「쓰인다」로 읽는 것***이다.
 * ⭐ 그래서 시험의 무게가 «안 쓰이는 것을 갈라내는가»에 실려 있다.
 */
import { describe, expect, test } from 'bun:test';

import {
  buildKeyframesExpression, formatStep, parseKeyframes, renderKeyframesSection,
} from './keyframes.js';

const payload = (o: Record<string, unknown>) => JSON.stringify({ sheetsRead: 1, unreadableSheets: 0, ...o });

describe('페이지 표현식', () => {
  test('⛔ 폐기 예정인 `rule.type` 숫자로 가르지 않는다', () => {
    // ⛔ 주석에 그 낱말이 «있다» — 그러니 「쓰는 문면」으로 친다(이름이 아니라 «개념»으로).
    expect(buildKeyframesExpression()).not.toMatch(/rule\.type\s*===/);
  });

  // 🩸 첫 판은 「이름 + 자식 규칙」으로 갈랐고 `@layer global { … }` 을 키프레임으로 «잡았다».
  //    CSSLayerBlockRule 도 name 과 cssRules 를 «둘 다» 갖는다. ⇒ 가르는 값은 «자식의 keyText» 다.
  test('⛔ @layer·@property 와 가르는 값은 «자식의 keyText» 다', () => {
    const expr = buildKeyframesExpression();
    expect(expr).toContain("typeof child.keyText === 'string'");
    // ⛔ 그리고 «레이어 안»을 걸어야 한다 — 안 걸으면 그 안의 animation-name 을 통째로 놓친다
    expect(expr).toContain('walk(children)');
  });

  test('교차 출처 시트를 «세어» 낸다 — 「없다」가 아니다', () => {
    expect(buildKeyframesExpression()).toContain('unreadable += 1');
  });
});

describe('⛔ 「정의됐다」와 「쓰인다」를 가른다 (가장 위험한 축)', () => {
  const report = parseKeyframes(payload({
    animations: [
      { name: 'ghost', steps: [], animatedProperties: ['opacity'], usedBy: 0, usedIn: [] },
      { name: 'pulse', steps: [], animatedProperties: ['transform'], usedBy: 2, usedIn: ['.spinner'] },
    ],
  }))!;

  test('쓰이는 것이 «먼저» 온다', () => {
    expect(report.animations.map((a) => a.name)).toEqual(['pulse', 'ghost']);
  });

  test('안 쓰이는 것은 «따로» 모인다', () => {
    expect(report.definedButUnused).toEqual(['ghost']);
  });

  test('⭐ 절이 쓰이는 것만 본문에 올리고, 안 쓰이는 것은 «경고로» 낸다', () => {
    const text = renderKeyframesSection(report).join('\n');
    expect(text).toContain('`pulse` — 규칙 2개가 쓴다');
    expect(text).not.toContain('`ghost` — 규칙');
    expect(text).toContain('정의만 되고 «안 쓰이는»');
  });

  test('⛔ «전부» 안 쓰이면 「서명이 아니다」라고 말한다 — 목록으로 부풀리지 않는다', () => {
    const only = parseKeyframes(payload({
      animations: [{ name: 'ghost', steps: [], animatedProperties: ['opacity'], usedBy: 0, usedIn: [] }],
    }))!;
    const text = renderKeyframesSection(only).join('\n');
    expect(text).toContain('아무도 «안 쓴다»');
    expect(text).toContain('서명이 아니다');
  });
});

describe('⛔ 단축형에 var() 가 있어 «이름을 못 얻은» 규칙을 잇는다', () => {
  // 🩸 2026-09-10 실측 — `.toast { animation: notification-show 320ms var(--ease-1) both }` 가
  //    「아무도 «안 쓴다»」로 보였다. CSSOM 이 var() 낀 단축형을 longhand 로 «안 펼친다».
  //    ⇒ 그 움직임이 「정의만 됐다」 칸으로 떨어져 conform 이 어긋남을 냈다(참인데 틀린 어긋남).
  test('풀린 단축형에서 이름을 집어 «쓰인다»로 센다', () => {
    const r = parseKeyframes(payload({
      animations: [{ name: 'notification-show', steps: [], animatedProperties: ['opacity'], usedBy: 0, usedIn: [] }],
      resolvedAnimations: [{ text: 'notification-show 320ms cubic-bezier(0.2,0,0,1) both', selector: '.toast' }],
    }))!;
    expect(r.animations[0]!.usedBy).toBe(1);
    expect(r.animations[0]!.usedIn).toEqual(['.toast']);
    expect(r.definedButUnused).toEqual([]);
  });

  test('⛔ 이름이 «안 맞으면» 안 센다 — 다 통과시키지 않는다', () => {
    const r = parseKeyframes(payload({
      animations: [{ name: 'ghost', steps: [], animatedProperties: ['opacity'], usedBy: 0, usedIn: [] }],
      resolvedAnimations: [{ text: 'other 1s ease', selector: '.x' }],
    }))!;
    expect(r.definedButUnused).toEqual(['ghost']);
  });

  test('⛔ 그 칸이 «없는» 옛 산출도 던지지 않는다', () => {
    expect(() => parseKeyframes(payload({
      animations: [{ name: 'a', steps: [], animatedProperties: [], usedBy: 1, usedIn: [] }],
    }))).not.toThrow();
  });
});

describe('⛔ 조용히 고르지 않는다', () => {
  test('같은 이름이 여러 번 정의되면 «이름을 댄다»', () => {
    const r = parseKeyframes(payload({ animations: [], duplicateNames: ['pulse'] }))!;
    const text = renderKeyframesSection(r).join('\n');
    expect(text).toContain('같은 이름이 여러 번 정의됐다');
    expect(text).toContain('어느 시트가 이겼는지는 «안 쟀다»');
  });

  test('⛔ 못 읽은 시트가 있으면 «부분»이라고 말한다', () => {
    const r = parseKeyframes(JSON.stringify({ sheetsRead: 3, unreadableSheets: 2, animations: [] }))!;
    expect(renderKeyframesSection(r).join('\n')).toContain('«부분»이다');
  });

  test('⛔ from/to 정규화는 «우리가» 한 것이 아님을 말한다', () => {
    const r = parseKeyframes(payload({
      animations: [{ name: 'a', steps: [{ offset: '0%', declarations: ['opacity: 0'] }], animatedProperties: ['opacity'], usedBy: 1, usedIn: ['.x'] }],
    }))!;
    expect(renderKeyframesSection(r).join('\n')).toContain('CSSOM 이 이미');
  });
});

describe('⛔ 파싱 실패를 «빈 결과»로 삼키지 않는다', () => {
  test('문자열이 아니면 null', () => expect(parseKeyframes(42)).toBeNull());
  test('JSON 이 아니면 null', () => expect(parseKeyframes('{')).toBeNull());
  test('sheetsRead 가 없으면 null — 「시트 0개」가 «아니다»', () => {
    expect(parseKeyframes(JSON.stringify({ animations: [] }))).toBeNull();
  });
  test('못 쟀으면 절이 «말한다»', () => {
    expect(renderKeyframesSection(null).join('\n')).toContain('「움직임이 없다」가 «아니다»');
  });
});

describe('단계 표기', () => {
  test('선언을 «줄이지» 않는다 — 줄이면 다시 못 짓는다', () => {
    expect(formatStep({ offset: '50%', declarations: ['opacity: 1', 'transform: scale(1.2)'] }))
      .toBe('50%: opacity: 1; transform: scale(1.2)');
  });

  test('⛔ 선언이 «없는» 단계를 「0」으로 접지 않는다', () => {
    expect(formatStep({ offset: '0%', declarations: [] })).toContain('(선언 없음)');
  });
});

describe('⭐⭐ 움직임의 «가속 곡선» — RESULT-29·30 이 둘 다 ⚪ 로 적어 둔 칸', () => {
  // 상태 축은 transition-* 만 보고, 키프레임 축은 «속성 집합»만 봐서
  // ***애니메이션 곡선을 어느 축도 안 셌다***. 그런데 곡선이 디자인 서명이다(RESULT-17).
  test('단계에 걸린 곡선을 «모은다»', () => {
    const r = parseKeyframes(payload({
      animations: [{
        name: 'bounce', steps: [], animatedProperties: ['transform'],
        stepEasings: ['ease-in', 'cubic-bezier(0.3, 0, 0.7, 1)'], usedBy: 1, usedIn: ['.b'],
      }],
    }))!;
    expect(r.easings).toEqual(['cubic-bezier(0.3, 0, 0.7, 1)', 'ease-in']);
  });

  test('«쓰는 자리»에 걸린 곡선도 모은다 — 다른 자리다', () => {
    const r = parseKeyframes(payload({
      animations: [], useEasings: ['linear'],
    }))!;
    expect(r.easings).toEqual(['linear']);
  });

  test('⭐ «풀린» 단축형에서도 곡선을 꺼낸다', () => {
    const r = parseKeyframes(payload({
      animations: [],
      resolvedAnimations: [{ text: 'toast 320ms cubic-bezier(0.2, 0, 0, 1) both', selector: '.t' }],
    }))!;
    expect(r.easings).toEqual(['cubic-bezier(0.2, 0, 0, 1)']);
  });

  test('⛔ «안 풀린» var 에서는 «아무것도» 안 꺼낸다 — 지어내지 않는다', () => {
    const r = parseKeyframes(payload({
      animations: [], resolvedAnimations: [{ text: 'toast 320ms var(--nope) both', selector: '.t' }],
    }))!;
    expect(r.easings).toEqual([]);
  });

  test('⛔ 그 칸들이 «전부 없는» 옛 산출도 던지지 않는다 — 빈 배열이다', () => {
    const r = parseKeyframes(payload({
      animations: [{ name: 'a', steps: [], animatedProperties: [], usedBy: 1, usedIn: [] }],
    }))!;
    expect(r.easings).toEqual([]);
  });
});
