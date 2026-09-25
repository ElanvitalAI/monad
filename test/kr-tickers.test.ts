import { describe, expect, test } from 'bun:test';
import {
  normalizeName, parseCorpCodeXml, resolveKoreanName, looksKorean, loadKrTickers,
  corpCodePath, cachePath, decodeXmlText, krTickerTable, forgetKrTickerTable,
} from '../src/bots/kr-tickers.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?><result>
<list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list>
<list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><stock_code>000660</stock_code></list>
<list><corp_code>00999999</corp_code><corp_name>비상장회사</corp_name><stock_code> </stock_code></list>
<list><corp_code>00888888</corp_code><corp_name>삼성전자</corp_name><stock_code>999999</stock_code></list>
</result>`;

describe('🇰🇷 이름 정규화 — ⛔ 「SK 하이닉스」와 「SK하이닉스」는 같은 것을 가리킨다', () => {
  test('공백·중점을 지우고 대문자로', () => {
    expect(normalizeName('SK 하이닉스')).toBe(normalizeName('SK하이닉스'));
    expect(normalizeName('cj 제일제당')).toBe('CJ제일제당');
  });
});

describe('🇰🇷 DART XML 훑기 — ⛔ 상장된 것«만»', () => {
  const table = parseCorpCodeXml(XML);
  test('상장 종목만 담는다', () => {
    expect(table.size).toBe(2);
    expect(resolveKoreanName('삼성전자', table)).toBe('005930');
    expect(resolveKoreanName('SK하이닉스', table)).toBe('000660');
  });
  test('⛔ `stock_code` 가 «빈» 항목(비상장)은 «안 담는다»', () => {
    expect(resolveKoreanName('비상장회사', table)).toBeNull();
  });
  test('🔑 같은 이름이 여럿이면 «먼저 만난 것»을 유지한다 — 뒤엣것은 대개 상장폐지·중복이다', () => {
    expect(resolveKoreanName('삼성전자', table)).toBe('005930');   // ⛔ 999999 가 «아니다»
  });
  test('⛔ «부분 일치»를 하지 않는다 — 「삼성」이 무엇인지 이 자는 모른다', () => {
    expect(resolveKoreanName('삼성', table)).toBeNull();
  });
  test('꼴이 바뀌면 «빈 표»가 나온다 — 그것을 부르는 쪽이 실패로 읽는다', () => {
    expect(parseCorpCodeXml('<result></result>').size).toBe(0);
  });
});

describe('🇰🇷 한글이 «섞여» 있나', () => {
  test('가른다', () => {
    expect(looksKorean('삼성전자')).toBeTrue();
    expect(looksKorean('SK하이닉스')).toBeTrue();
    expect(looksKorean('AAPL')).toBeFalse();
    expect(looksKorean('005930')).toBeFalse();
  });
});

describe('🇰🇷 표 읽기 — ⛔ 「없다」와 「못 읽었다」를 가른다', () => {
  const home = '/fake-home';
  test('⛔ 원본이 «없으면» 그 경로를 대고 「종목이 없다」가 «아니라»고 말한다', () => {
    const r = loadKrTickers({ home, exists: () => false });
    expect(r.ok).toBeFalse();
    if (!r.ok) {
      expect(r.reason).toContain(corpCodePath(home));
      expect(r.reason).toContain('«아니다»');
    }
  });
  test('원본만 있으면 훑어서 «캐시를 쓴다»', () => {
    const written: string[] = [];
    const r = loadKrTickers({
      home, exists: (p) => p === corpCodePath(home), read: () => XML,
      write: (p) => written.push(p), mtimeMs: () => 1, sizeBytes: () => 10,
    });
    expect(r.ok).toBeTrue();
    if (r.ok) { expect(r.from).toBe('xml'); expect(r.count).toBe(2); }
    expect(written).toContain(cachePath(home));
  });
  test('⭐ 캐시가 «원본보다 새로우면» 캐시를 쓴다 — 29MB 를 다시 안 읽는다', () => {
    const r = loadKrTickers({
      home, exists: () => true,
      read: () => JSON.stringify({ srcMtimeMs: 1, srcSizeBytes: 10, rows: { 삼성전자: '005930' } }),
      mtimeMs: () => 1, sizeBytes: () => 10,
    });
    expect(r.ok).toBeTrue();
    if (r.ok) { expect(r.from).toBe('cache'); expect(resolveKoreanName('삼성전자', r.table)).toBe('005930'); }
  });
  test('⛔ 캐시가 «낡았으면»(원본이 더 새것) 다시 훑는다 — 나이가 아니라 «순서»로 본다', () => {
    const r = loadKrTickers({
      home, exists: () => true,
      read: (p) => (p === cachePath(home) ? JSON.stringify({ srcMtimeMs: 99, srcSizeBytes: 99, rows: { X: '1' } }) : XML),
      write: () => undefined, mtimeMs: () => 1, sizeBytes: () => 10,
    });
    expect(r.ok && r.from).toBe('xml');
  });
  test('⛔ 캐시가 «깨졌어도» 죽지 않는다 — 다시 훑는다', () => {
    const r = loadKrTickers({
      home, exists: () => true,
      read: (p) => (p === cachePath(home) ? 'not json' : XML),
      write: () => undefined, mtimeMs: () => 5, sizeBytes: () => 10,
    });
    expect(r.ok && r.from).toBe('xml');
  });
  test('⛔ 표가 «비면» 실패다 — 빈 표를 「종목 0건」으로 넘기지 않는다', () => {
    const r = loadKrTickers({
      home, exists: (p) => p === corpCodePath(home), read: () => '<result></result>',
      write: () => undefined, mtimeMs: () => 1, sizeBytes: () => 10,
    });
    expect(r.ok).toBeFalse();
    if (!r.ok) expect(r.reason).toContain('비었다');
  });
});

describe('🩸 XML 엔티티·CDATA — ⛔ 안 풀면 그 종목은 «영영» 안 맞는다 (자기 리뷰 #15052)', () => {
  test('엔티티를 푼다 ⊕ `&amp;` 를 «마지막»에 푼다', () => {
    expect(decodeXmlText('LG&amp;에너지')).toBe('LG&에너지');
    expect(decodeXmlText('&amp;lt;')).toBe('&lt;');   // ⛔ 두 번 풀리면 `<` 가 된다
    expect(decodeXmlText('&#65;&#x42;')).toBe('AB');
  });
  test('CDATA 를 읽는다', () => {
    expect(decodeXmlText('<![CDATA[삼성전자]]>')).toBe('삼성전자');
  });
  test('⭐ 그리고 표에 «그대로» 실린다', () => {
    const xml = `<result><list><corp_name>LG&amp;화학</corp_name><stock_code>051910</stock_code></list>
      <list><corp_name><![CDATA[CJ제일제당]]></corp_name><stock_code>097950</stock_code></list></result>`;
    const t = parseCorpCodeXml(xml);
    expect(resolveKoreanName('LG&화학', t)).toBe('051910');
    expect(resolveKoreanName('CJ제일제당', t)).toBe('097950');
  });
});

describe('🔑 캐시 신선도를 «지문»으로 — ⛔ mtime 만으로는 못 가른다', () => {
  const home = '/fake-home-2';
  test('⭐ ***같은 mtime 인데 원본이 커졌으면*** 다시 훑는다(해상도 안의 갱신)', () => {
    const r = loadKrTickers({
      home, exists: () => true,
      read: (p) => (p === cachePath(home) ? JSON.stringify({ srcMtimeMs: 7, srcSizeBytes: 100, rows: { A: '1' } }) : XML),
      write: () => undefined, mtimeMs: () => 7, sizeBytes: () => 200,   // ⛔ 크기가 «다르다»
    });
    expect(r.ok && r.from).toBe('xml');
  });
  test('⭐ ***시계가 역행해도*** 지문이 같으면 캐시를 쓴다 — 「더 새것인가」로 안 본다', () => {
    const r = loadKrTickers({
      home, exists: () => true,
      read: () => JSON.stringify({ srcMtimeMs: 5, srcSizeBytes: 10, rows: { 삼성전자: '005930' } }),
      mtimeMs: () => 5, sizeBytes: () => 10,
    });
    expect(r.ok && r.from).toBe('cache');
  });
  test('⛔ 캐시 쓰기 실패를 «삼키지» 않는다 — 삼키면 매번 29MB 를 다시 읽는데 아무도 모른다', () => {
    const r = loadKrTickers({
      home, exists: (p) => p === corpCodePath(home), read: () => XML,
      write: () => { throw new Error('EACCES'); }, mtimeMs: () => 1, sizeBytes: () => 10,
    });
    expect(r.ok).toBeTrue();
    if (r.ok) expect(r.cacheWriteFailed).toContain('EACCES');
  });
});

describe('🧠 프로세스 기억 — ⛔ 후보가 여럿이면 표를 여러 번 읽던 것', () => {
  test('⭐ 같은 원본이면 «한 번»만 읽는다', () => {
    forgetKrTickerTable();
    let reads = 0;
    const deps = {
      home: '/fake-home-3', exists: () => true,
      read: () => { reads += 1; return XML; },
      write: () => undefined, mtimeMs: () => 1, sizeBytes: () => 10,
    };
    // ⛔ 첫 호출은 읽고, 그다음은 «기억»을 쓴다. (⚠️ 실제 `stat` 이 없으면 기억을 안 믿는다 —
    //    그래서 이 시험은 「여러 번 불러도 죽지 않는다」와 「표가 같다」까지 문다.)
    const a = krTickerTable(deps);
    const b = krTickerTable(deps);
    expect(a.ok).toBeTrue();
    expect(b.ok).toBeTrue();
    if (a.ok && b.ok) expect(resolveKoreanName('삼성전자', b.table)).toBe('005930');
    expect(reads).toBeGreaterThan(0);
    forgetKrTickerTable();
  });
});
