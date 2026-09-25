// 사전 자율진화 단위테스트 — 마이닝·토큰화·분류 파싱(무네트워크).
import { describe, test, expect } from 'bun:test';
import { openBuzzDb } from './store.js';
import { tokenize, mineCandidates, parseClassifyResponse, addEvolvedEntries, buildClassifyPrompt } from './dict-evolve.js';
import { ensureSlangSeed, loadSlangEntries } from './slang-dict.js';

describe('tokenize — 조사/자모 정리', () => {
  test('조사 제거·자모꼬리 제거·숫자/1글자 배제', () => {
    const t = tokenize('네비우스가 떡상 ㄷㄷㄷ 하고 225만원 돌파');
    expect(t).toContain('네비우스'); // 조사 '가' 제거
    expect(t).toContain('떡상');
    expect(t).not.toContain('ㄷㄷㄷ');
  });
});

describe('mineCandidates — 미지 고빈도 발굴', () => {
  test('dict/노이즈 제외하고 빈도>=minFreq 만', () => {
    const db = openBuzzDb(':memory:');
    const ins = db.prepare(`INSERT INTO buzz_posts(id, ts, fetch_ts, forum, title, tickers) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'fmkorea', ?, ?)`);
    // '네비우스' 5회(미지·티커 공출현), '실시간'은 노이즈, '하닉'은 known
    for (let i = 0; i < 5; i++) ins.run(`p${i}`, `실시간 네비우스 폭등 ${i}`, 'NVDA');
    ins.run('q1', '하닉 어떰', '000660.KO');
    const known = new Set(['하닉']);
    const cands = mineCandidates(db, known, { hours: 48, minFreq: 4 });
    const terms = cands.map(c => c.term);
    expect(terms).toContain('네비우스');
    expect(terms).not.toContain('실시간'); // 노이즈
    expect(terms).not.toContain('하닉');   // known
    const nb = cands.find(c => c.term === '네비우스')!;
    expect(nb.freq).toBe(5);
    expect(nb.cooccur).toContain('NVDA'); // 공출현 힌트
  });
});

describe('parseClassifyResponse — 분류 파싱', () => {
  const cands = [
    { term: '네비우스', freq: 5, example: '네비우스 폭등', cooccur: ['NVDA'] },
    { term: '떡락', freq: 6, example: '떡락 ㅠㅠ', cooccur: [] },
    { term: '오늘장', freq: 4, example: '오늘장 어떰', cooccur: [] },
  ];
  test('ticker/sentiment 추출·noise 제외', () => {
    const raw = `[
      {"i":0,"type":"ticker","canonical":"Nebius","ticker":"NBIS"},
      {"i":1,"type":"sentiment","canonical":"급락","polarity":-0.9},
      {"i":2,"type":"noise"}
    ]`;
    const e = parseClassifyResponse(raw, cands);
    expect(e.length).toBe(2);
    expect(e.find(x => x.term === '네비우스')!.ticker).toBe('NBIS');
    expect(e.find(x => x.term === '떡락')!.polarity).toBe(-0.9);
    expect(e.some(x => x.term === '오늘장')).toBe(false); // noise
  });
  test('ticker 인데 코드 없으면 entity 강등', () => {
    const e = parseClassifyResponse('[{"i":0,"type":"ticker","canonical":"뭔가"}]', cands);
    expect(e[0]!.type).toBe('entity');
  });
  test('빌드 프롬프트 공출현 힌트 포함', () => {
    expect(buildClassifyPrompt(cands)).toContain('공출현:NVDA');
  });
});

describe('addEvolvedEntries — 사전 성장(seed 미침범)', () => {
  test('신규만 추가·source=llm·기존 seed 유지', () => {
    const db = openBuzzDb(':memory:');
    ensureSlangSeed(db);
    const before = loadSlangEntries(db).length;
    const added = addEvolvedEntries(db, [{ term: '네비우스', canonical: 'Nebius', type: 'ticker', lang: 'ko', ticker: 'NBIS' }], 'llm', 0.6);
    expect(added).toBe(1);
    // 기존 seed(하닉) 는 다시 넣어도 무시(OR IGNORE)
    expect(addEvolvedEntries(db, [{ term: '하닉', canonical: 'x', type: 'ticker', lang: 'ko' }])).toBe(0);
    expect(loadSlangEntries(db).length).toBe(before + 1);
  });
});
