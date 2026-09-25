// ── 판정 신호 검사기 시험 — ⛔ 첫 시험은 «내 실패»를 무는 것이다 ──────────────────
//
// 🩸 2026-09-08: 내가 쓴 판정 신호가 「captureScope 필드」를 봤고, 자식이 그 필드만 채워
//    통과했다(실제 캡처는 뷰포트였다). 이 검사기가 «그 문면»을 잡아야 존재 이유가 있다.

import { describe, expect, test } from 'bun:test';

import {
  auditSignals, classifyObservation, parseSignal,
} from './behaviour-signal.js';

const rules = (d: string) => auditSignals(d).findings.map((f) => f.rule);

describe('🩸 내가 실제로 쓴 그 문면을 «잡는가»', () => {
  const MINE = '판정 신호: 조건 = `… --full-page --json` 를 친다; 관측 = 산출 JSON 의 captureScope 필드; 기대 = 그 값이 `full-page` 이다.';

  test('⛔ 「필드」를 보는 관측을 잡는다', () => {
    expect(rules(MINE)).toContain('observation-is-self-reported');
  });

  test('⛔ 존재·지속 기대가 없는 것도 잡는다 — 저작 도구와 같은 축', () => {
    expect(rules(MINE)).toContain('no-presence-expectation');
  });

  test('✅ 고친 문면은 «안» 잡힌다', () => {
    const FIXED = '판정 신호: 조건 = 명령을 친다; 관측 = 저장된 스크린샷의 픽셀 높이; 기대 = 그 값이 1000 보다 크다.';
    expect(rules(FIXED)).toEqual([]);
  });
});

describe('parseSignal', () => {
  test('세 칸을 가른다', () => {
    const p = parseSignal('판정 신호: 조건 = A 를 친다; 관측 = B 의 크기; 기대 = 0 보다 크다.');
    expect(p.condition).toBe('A 를 친다');
    expect(p.observation).toBe('B 의 크기');
    expect(p.expectation).toBe('0 보다 크다.');
  });
  test('영문 라벨도 문다', () => {
    const p = parseSignal('decision signal: condition = run it; observation = file size; expectation = greater than 0');
    expect(p.observation).toBe('file size');
  });
  test('⛔ 없으면 null — 빈 문자열이 아니다', () => {
    expect(parseSignal('판정 신호: 아무 라벨도 없다').observation).toBeNull();
  });
});

describe('classifyObservation', () => {
  test('필드·플래그·반환값은 self-reported', () => {
    for (const o of ['captureScope 필드', '반환값', '그 플래그', 'the returned property']) {
      expect(classifyObservation(o)).toBe('self-reported');
    }
  });
  test('크기·개수·종료 코드·화면은 external-result', () => {
    for (const o of ['픽셀 높이', '파일 바이트', '행 수', '종료 코드', '스크린샷', 'file size']) {
      expect(classifyObservation(o)).toBe('external-result');
    }
  });
  test('⭐ 둘 다 걸리면 «외부 결과» 쪽 — 「스크린샷의 높이 필드」 같은 문면', () => {
    expect(classifyObservation('스크린샷의 높이 필드')).toBe('external-result');
  });
  test('⛔ 못 가르면 unknown — self-reported 로 «몰지» 않는다', () => {
    expect(classifyObservation('그 결과')).toBe('unknown');
    expect(classifyObservation(null)).toBe('unknown');
  });
});

describe('auditSignals — 계약', () => {
  test('판정 신호가 «없으면» 0건 — ⛔ 「통과」가 아니다', () => {
    const a = auditSignals('# 골\n\n대상 경로: a.ts\n');
    expect(a.signals).toBe(0);
    expect(a.findings).toEqual([]);
  });

  test('세 칸을 «못 읽으면» 그것도 지적한다 — 조용히 넘기지 않는다', () => {
    expect(rules('판정 신호: 그냥 잘 되는지 본다')).toContain('signal-unparsed');
  });

  test('여러 신호를 각각 센다 ⊕ 줄 번호가 붙는다', () => {
    const doc = [
      '머리말',
      '판정 신호: 조건 = A; 관측 = 파일 크기; 기대 = 0 보다 크다',
      '사이 문장',
      '판정 신호: 조건 = B; 관측 = 그 필드; 기대 = true',
    ].join('\n');
    const a = auditSignals(doc);
    expect(a.signals).toBe(2);
    const f = a.findings.find((x) => x.rule === 'observation-is-self-reported');
    expect(f?.line).toBe(4);
  });

  test('⛔ 한계를 «값으로» 낸다 — 통과가 「⑤ 를 지났다」가 아니다', () => {
    expect(auditSignals('').limitation).toContain('안 쟀다');
  });
});
