// DART 공시 다운로더 (2026-07-07 대표 지시). Covers: list.json 파싱(000/013/
// 오류), 마크업 스트립(style/script·엔티티), seen dedup round-trip, corps 폴백.

import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fetchDisclosures, stripDisclosureMarkup, loadSeen, saveSeen,
  DEFAULT_CORPS, viewerUrl,
} from '../src/domains/dart.js';

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('fetchDisclosures', () => {
  test('status 000 → list · corp/기간 파라미터 전달', async () => {
    let calledUrl = '';
    const fetchImpl = (async (url: unknown) => {
      calledUrl = String(url);
      return jsonRes({ status: '000', list: [{ corp_name: '삼성전자', rcept_no: '1', report_nm: 'X', rcept_dt: '20260707', flr_nm: 'S', stock_code: '005930' }] });
    }) as unknown as typeof fetch;
    const list = await fetchDisclosures('KEY', '00126380', '20260706', '20260707', fetchImpl);
    expect(list.length).toBe(1);
    expect(calledUrl).toContain('corp_code=00126380');
    expect(calledUrl).toContain('bgn_de=20260706');
  });

  test('status 013(결과 없음) → 빈 배열 (오류 아님)', async () => {
    const fetchImpl = (async () => jsonRes({ status: '013', message: '조회된 데이타가 없습니다.' })) as unknown as typeof fetch;
    expect(await fetchDisclosures('K', 'C', 'B', 'E', fetchImpl)).toEqual([]);
  });

  test('그 외 오류 status → throw (호출측 fail-soft)', async () => {
    const fetchImpl = (async () => jsonRes({ status: '020', message: '사용한도 초과' })) as unknown as typeof fetch;
    await expect(fetchDisclosures('K', 'C', 'B', 'E', fetchImpl)).rejects.toThrow(/020/);
  });
});

describe('stripDisclosureMarkup', () => {
  test('style/script 제거 + 태그 스트립 + 엔티티 + 공백 정규화', () => {
    const html = `<html><head><style>.x{font:1px}</style><script>bad()</script></head>
      <body><p>매출액&nbsp;171.00</p><td>영업이익</td><td>89.40</td></body></html>`;
    const t = stripDisclosureMarkup(html);
    expect(t).toBe('매출액 171.00 영업이익 89.40');
    expect(t).not.toContain('font');
    expect(t).not.toContain('bad()');
  });

  test('maxChars 캡', () => {
    expect(stripDisclosureMarkup('a'.repeat(9000), 100).length).toBe(100);
  });
});

describe('seen state', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  test('round-trip + 최근 500 캡', () => {
    dir = mkdtempSync(join(tmpdir(), 'dart-seen-'));
    const p = join(dir, 'seen.json');
    expect(loadSeen(p).size).toBe(0); // 파일 없음 → 빈 set
    const seen = new Set(Array.from({ length: 600 }, (_, i) => `r${i}`));
    saveSeen(seen, p);
    const back = loadSeen(p);
    expect(back.size).toBe(500);
    expect(back.has('r599')).toBe(true); // 최신 유지
    expect(back.has('r0')).toBe(false);  // 오래된 것 탈락
  });
});

describe('중요도 필터 (대표 피드백 07-07)', () => {
  test('룰 프리필터 — 루틴 공시 판별', async () => {
    const { isRoutineDisclosure } = await import('../src/domains/dart.js');
    expect(isRoutineDisclosure('최대주주등소유주식변동신고서              ')).toBe(true); // 오늘 노이즈 실사례
    expect(isRoutineDisclosure('임원ㆍ주요주주특정증권등소유상황보고서')).toBe(true);
    expect(isRoutineDisclosure('기업설명회(IR)개최(안내공시)')).toBe(true);
    // 중요 공시는 통과 — '최대주주 변경'은 '소유주식변동신고서'와 다른 공시
    expect(isRoutineDisclosure('연결재무제표기준영업(잠정)실적(공정공시)')).toBe(false);
    expect(isRoutineDisclosure('[기재정정]주요사항보고서(유상증자결정)')).toBe(false);
    expect(isRoutineDisclosure('최대주주변경')).toBe(false);
  });

  test('parseJudgment — 중요도 줄 파싱·클램프·본문 분리·불가 시 null', async () => {
    const { parseJudgment } = await import('../src/domains/dart.js');
    const j = parseJudgment('중요도: 9\n**핵심**: 영업이익 89.4조\n**함의**: 반도체 강세');
    expect(j.importance).toBe(9);
    expect(j.summary.startsWith('**핵심**')).toBe(true);
    expect(parseJudgment('중요도: 15\nX').importance).toBe(10); // 클램프
    expect(parseJudgment('그냥 요약만 있음').importance).toBe(null);
  });
});

describe('defaults', () => {
  test('기본 감시 대상 = 삼성·하이닉스 (8자리 corp_code)', () => {
    expect(DEFAULT_CORPS.map(c => c.corpCode)).toEqual(['00126380', '00164779']);
  });
  test('viewerUrl', () => {
    expect(viewerUrl('20260707800004')).toBe('https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260707800004');
  });
});
