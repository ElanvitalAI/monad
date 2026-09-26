/**
 * 📈 `investor-round` 반증 — ⛔ ***실물 픽스처***로 문다(지어낸 문자열이 아니라).
 * 🔑 픽스처 출처 = `~/.elanous/botlab/investor/<UTC>/` 의 진짜 회차(2026-09-02T22:40Z · mailbox 본문만 제거).
 */
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNum, parseQuote, parseFlow, parseFlowJson, parseKeyed, parseOmniCrawlNews, detectFailure, readArtifact } from './investor-round.js';

const FX = join(import.meta.dir, '..', '..', 'test', 'fixtures', 'botlab');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');

describe('parseNum — ⛔ 「못 읽었다」와 「0」을 가른다', () => {
  test('쉼표·퍼센트·부호를 읽는다', () => {
    expect(parseNum('7,666.6')).toBe(7666.6);
    expect(parseNum('-2,576,734')).toBe(-2576734);
    expect(parseNum('+0.46%')).toBe(0.46);
  });
  test('⛔ 못 읽으면 «null» — 0 이 아니다', () => {
    for (const v of [undefined, null, '', '-', 'N/A', '없음']) expect(parseNum(v)).toBeNull();
  });
  test('⭐ 진짜 0 은 «0» 이다 — null 로 접지 않는다', () => {
    expect(parseNum('0')).toBe(0);
  });
});

describe('parseQuote — 실물 S&P500 산출', () => {
  const q = parseQuote(fx('investor-미국-지수-S-P500.txt'));
  test('읽힌다', () => { expect(q).not.toBeNull(); });
  test('심볼·종가·변동을 «수»로 낸다', () => {
    expect(q!.symbol).toBe('GSPC.INDX');
    expect(q!.close).toBe(7666.6);
    expect(q!.change).toBe(35.13);
    expect(q!.changePct).toBe(0.46);        // ⭐ 「35.13 (+0.46%)」 한 줄에서 «둘»을 가른다
  });
  test('OHLC·거래량·전일종가', () => {
    expect(q!.open).toBe(7634.58);
    expect(q!.high).toBe(7681.19);
    expect(q!.low).toBe(7633.62);
    expect(q!.volume).toBe(2720039000);
    expect(q!.prevClose).toBe(7631.47);
  });
  test('⛔ 시세가 «아닌» 글은 null — 빈 시세를 지어내지 않는다', () => {
    expect(parseQuote('안녕하세요')).toBeNull();
    expect(parseQuote('대상: FOO')).toBeNull();   // 심볼만 있고 «수가 없다»
  });
});

describe('parseFlow — 실물 수급표 둘', () => {
  test('기간별(삼성전자)', () => {
    const f = parseFlow(fx('investor-KR-수급-삼성전자.txt'));
    expect(f).not.toBeNull();
    expect(f!.rows.length).toBeGreaterThanOrEqual(3);
    const five = f!.rows.find((r) => r.key === '5일');
    expect(five).toBeDefined();
    expect(five!.foreign).toBe(-2576734);
    expect(five!.institution).toBe(-7417457);
    expect(five!.individual).toBe(95756);
  });
  test('날짜별(시장 흐름) — ⭐ 같은 모양으로 읽힌다', () => {
    const f = parseFlow(fx('investor-KR-시장-흐름.txt'));
    expect(f).not.toBeNull();
    const d = f!.rows.find((r) => r.key === '2026-09-02');
    expect(d!.foreign).toBe(-1917255);
    expect(d!.individual).toBe(2302860);
  });
  test('⭐ 「0 인 날」이 «0» 으로 남는다 — null 로 접히면 그래프가 거짓말한다', () => {
    const f = parseFlow(fx('investor-KR-시장-흐름.txt'));
    const zero = f!.rows.find((r) => r.key === '2026-09-03');
    expect(zero).toBeDefined();
    expect(zero!.foreign).toBe(0);
  });
  test('⛔ 열 «순서»에 기대지 않는다 — 머리글 이름으로 찾는다', () => {
    const swapped = ['## X', '| 기간 | 개인 | 기관 | 외국인 |', '| --- | --- | --- | --- |', '| 5일 | 1 | 2 | 3 |'].join('\n');
    const f = parseFlow(swapped);
    expect(f!.rows[0]!.individual).toBe(1);
    expect(f!.rows[0]!.foreign).toBe(3);     // ⭐ 순서가 바뀌어도 «이름»으로 맞다
  });
  test('⛔ 표가 없으면 null', () => { expect(parseFlow('그냥 글')).toBeNull(); });
});

describe('readArtifact — ⛔ 못 읽은 것을 «버리지 않는다»', () => {
  test('셋을 각각 옳게 판정한다', () => {
    expect(readArtifact('a', fx('investor-미국-지수-S-P500.txt')).kind).toBe('quote');
    expect(readArtifact('b', fx('investor-KR-수급-삼성전자.txt')).kind).toBe('flow');
    expect(readArtifact('c', fx('investor-KR-시장-흐름.txt')).kind).toBe('flow');
  });
  test('⭐ 모르는 산출은 «unparsed» 로 이름과 앞머리를 남긴다', () => {
    const a = readArtifact('새-스킬.txt', '━━━\n어떤 새 스킬\n값: 42');
    expect(a.kind).toBe('unparsed');
    if (a.kind === 'unparsed') {
      expect(a.name).toBe('새-스킬.txt');
      expect(a.head).toContain('어떤 새 스킬');   // 🔑 화면이 「비었다」가 아니라 «무엇인지» 말할 수 있다
    }
  });
});

describe('parseKeyed — 「제목 ⊕ 라벨:값」 (비서 실물)', () => {
  const k = parseKeyed(fx('assistant-메일-일정-요약.txt'));
  test('제목과 항목을 읽는다', () => {
    expect(k).not.toBeNull();
    expect(k!.title).toContain('비서');
    expect(k!.entries.map((e) => e.label)).toEqual(['안 읽은 메일(24h)', '앞으로 24시간 일정']);
  });
  test('⭐ 숫자를 «수»로도 낸다 — 그리고 진짜 0 은 0 이다', () => {
    expect(k!.entries[0]!.num).toBe(10);
    expect(k!.entries[1]!.num).toBe(0);      // ⛔ null 로 접히면 「일정 모름」이 된다
  });
  test('⛔ URL 을 «안» 문다 — 아무 콜론이나 물면 쓰레기 카드가 된다', () => {
    expect(parseKeyed('제목\n  https://news.ycombinator.com')).toBeNull();
  });
  test('⛔ 시각(12:34)을 «안» 문다 — 콜론 앞뒤 공백을 요구한다', () => {
    expect(parseKeyed('제목\n  회의 12:34 시작')).toBeNull();
  });
  test('⛔ 한 줄짜리는 null — 제목만으로는 요약이 «아니다»', () => {
    expect(parseKeyed('제목뿐')).toBeNull();
  });
});

describe('parseOmniCrawlNews — 실제 newsbot Omni crawl 산출', () => {
  const text = fx('newsbot-AI-소식-뉴스-.txt');

  test('정확한 두 울타리 사이에서만 다섯 title·url·date를 이름으로 읽는다', () => {
    const parsed = parseOmniCrawlNews(text);
    expect(parsed.fenced).toBe(true);
    expect(parsed.why).toBeNull();
    expect(parsed.news?.query).toBe('AI 최신 소식');
    expect(parsed.news?.items).toHaveLength(5);
    expect(parsed.news?.items[0]).toEqual({
      title: '클라우드 AI 최신 소식 - AI, 기업 혁신과 성장의 핵심으로 부상',
      url: 'https://simplywall.st/ko/stocks/us/software/nasdaq-msft/microsoft/news/b74e5390aa93bea6',
      date: '4 days ago',
    });
    expect(parsed.news?.items[4]).toEqual({
      title: 'AI 전문가들 ‘구글 포 코리아 2026’ 모여 구글의 AI 성과 및 비전 공유',
      url: 'https://blog.google/intl/ko-kr/company-news/inside-google/google-for-korea-2026-kr/',
      date: 'Apr 29, 2026',
    });
  });

  test('정상 빈 items는 news이며 unparsed가 아니다', () => {
    const parsed = parseOmniCrawlNews('---BEGIN_OMNI_CRAWL_JSON---\n{"query":"x","results":[{"items":[]}]}\n---END_OMNI_CRAWL_JSON---');
    expect(parsed.news).toEqual({ query: 'x', items: [] });
  });

  test('울타리가 없거나 바뀌면 못 읽은 값이다', () => {
    expect(parseOmniCrawlNews(text.replace('---BEGIN_OMNI_CRAWL_JSON---', '---BEGIN_OTHER_JSON---')).fenced).toBe(false);
    expect(readArtifact('news.txt', text.replace('---BEGIN_OMNI_CRAWL_JSON---', '---BEGIN_OTHER_JSON---')).kind).toBe('unparsed');
  });

  test('깨진 fenced JSON과 최상위 null은 까닭을 든 unparsed이며 keyed로 새지 않는다', () => {
    for (const raw of [
      '🔎 쿼리: ...\n---BEGIN_OMNI_CRAWL_JSON---\n{bad\n---END_OMNI_CRAWL_JSON---',
      '🔎 쿼리: ...\n---BEGIN_OMNI_CRAWL_JSON---\nnull\n---END_OMNI_CRAWL_JSON---',
    ]) {
      const a = readArtifact('news.txt', raw);
      expect(a.kind).toBe('unparsed');
      if (a.kind === 'unparsed') expect(a.why).toContain('Omni crawl');
    }
  });

  test('Traceback 실패가 Omni payload보다 먼저 이긴다', () => {
    const a = readArtifact('news.txt', `Traceback (most recent call last):\n${text}`);
    expect(a.kind).toBe('failure');
  });
});

describe('readArtifact — 🆕 세 봇의 «서로 다른» 산출', () => {
  test('비서 요약은 keyed 다', () => {
    expect(readArtifact('a', fx('assistant-메일-일정-요약.txt')).kind).toBe('keyed');
  });
  test('⭐ 뉴스봇 «감시 리포트»는 아는 꼴이 아니다 — unparsed 로 «이름을 대고» 남는다', () => {
    const a = readArtifact('감시.txt', fx('newsbot-감시.txt'));
    expect(a.kind).toBe('unparsed');
    if (a.kind === 'unparsed') {
      expect(a.head.length).toBeGreaterThan(0);   // 🔑 화면이 «무엇인지» 말할 수 있다
      expect(a.why).toContain('아는 꼴이 «아니다»');
    }
  });
});

/**
 * 🔁 ⛔ **같은 파일 이름인데 형식이 «바뀌었다»** — 45차가 «수»로 찾았다(102회차 중 19회 unparsed).
 */
describe('parseFlowJson — 옛 회차의 JSON 판 (실물)', () => {
  const f = parseFlowJson(fx('investor-KR-수급-json.txt'));
  test('마크다운 판과 «같은 FlowTable» 로 낸다', () => {
    expect(f).not.toBeNull();
    expect(f!.rows.length).toBeGreaterThan(0);
    expect(f!.title).toContain('005930');
  });
  test('⭐ 「기간별」을 먼저 쓴다 — 마크다운 판의 5일/10일/20일 과 같은 축', () => {
    const five = f!.rows.find((r) => r.key === '5d');
    expect(five).toBeDefined();
    expect(five!.foreign).toBe(-9912739);
    expect(five!.institution).toBe(-7312094);
    expect(five!.individual).toBe(7413226);
  });
  test('⛔ JSON 이 «아니면» null — 마크다운을 여기서 먹지 않는다', () => {
    expect(parseFlowJson(fx('investor-KR-수급-삼성전자.txt'))).toBeNull();
    expect(parseFlowJson('그냥 글')).toBeNull();
  });
  test('⛔ 모양이 맞아도 «행이 없으면» null', () => {
    expect(parseFlowJson('{"ticker":"005930","rows":[]}')).toBeNull();
    expect(parseFlowJson('{"ticker":"005930"}')).toBeNull();
  });
  test('⭐ 기간별이 없으면 «날짜별»로 떨어진다', () => {
    const g = parseFlowJson('{"ticker":"X","rows":[{"date":"2026-07-16","frgn_net_shares":-1,"inst_net_shares":-2,"prsn_net_shares":3}]}');
    expect(g!.rows[0]!.key).toBe('2026-07-16');
    expect(g!.rows[0]!.individual).toBe(3);
  });
  test('⭐ readArtifact 가 이제 «flow» 로 판정한다 — 전엔 unparsed 였다', () => {
    expect(readArtifact('KR-수급-삼성전자.txt', fx('investor-KR-수급-json.txt')).kind).toBe('flow');
  });
});

/**
 * 🚨 ⛔ **「실패한 단계」와 「모르는 꼴」은 «다른 값»이다** — 45차가 실물에서 찾았다.
 * Traceback 을 「못 읽었다」로 그리면 ***봇이 실패한 사실을 «숨긴다»***.
 */
describe('detectFailure — 실물 실패 산출', () => {
  test('파이썬 Traceback 을 «실패»로', () => {
    const a = readArtifact('KR-수급-삼성전자.txt', fx('investor-실패-traceback.txt'));
    expect(a.kind).toBe('failure');
    if (a.kind === 'failure') expect(a.kindOf).toContain('Traceback');
  });
  test('스킬이 스스로 「실패」라 말한 것도', () => {
    const a = readArtifact('메일-일정-요약.txt', fx('assistant-실패-gmail.txt'));
    expect(a.kind).toBe('failure');
    if (a.kind === 'failure') {
      expect(a.kindOf).toContain('실패');
      expect(a.head).toContain('Gmail');    // 🔑 «무엇이» 실패했는지 보인다
    }
  });
  test('⛔ 본문 «속»의 낱말은 «안» 문다 — 맨 앞 몇 줄에서만 찾는다', () => {
    expect(detectFailure('뉴스 본문인데 Traceback 이라는 낱말이 나온다')).toBeNull();
    expect(detectFailure('제목\n내용\n또 내용\nTraceback (most recent call last):')).toBeNull();
  });
  test('⛔ 정상 산출을 «실패»로 읽지 않는다', () => {
    expect(detectFailure(fx('investor-미국-지수-S-P500.txt'))).toBeNull();
    expect(detectFailure(fx('assistant-메일-일정-요약.txt'))).toBeNull();
  });
  test('⭐ 실패를 «먼저» 본다 — 실패 글이 우연히 파서에 물리면 «거짓 데이터»가 된다', () => {
    // 「⛔ 실패」인데 아래에 `라벨 : 값` 이 있는 꼴 — keyed 로 읽히면 «거짓»이다
    const a = readArtifact('x.txt', '⛔ Gmail 호출 실패:\n  안 읽은 메일 : 0\n  일정 : 0');
    expect(a.kind).toBe('failure');
  });
});
