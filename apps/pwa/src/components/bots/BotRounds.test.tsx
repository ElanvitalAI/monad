/**
 * 📈 `InvestorRounds` 반증 — ⛔ ***라우트가 «없는» 채로*** 화면이 옳은지 문다(대표 ⓐ 안).
 * 🔑 이 창의 규율: ***「없다」와 「못 받았다」를 «다르게» 그려야 한다.***
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';
import { createReactHookHarness } from '@/lib/testing/react-hook-harness';
import { BotRounds, InvestorRounds, AssistantRounds, NewsbotRounds, RoundCard, QuoteBlock, FlowBlock, NewsBlock, UnparsedBlock, KeyedBlock, FailureBlock } from './BotRounds';
import { toRoundView } from '@/lib/bot-rounds';
import { readArtifact } from '../../../../../src/bots/investor-round';

const require = createRequire(import.meta.url);
const harness = createReactHookHarness(require('react'));

const FX = join(import.meta.dir, '..', '..', '..', '..', '..', 'test', 'fixtures', 'botlab');
const fx = (n: string) => readFileSync(join(FX, n), 'utf8');

function client(payload: Promise<unknown>) {
  const paths: string[] = [];
  const c = {
    fetchJson: (path: string) => { paths.push(path); return payload; },
  } as unknown as Parameters<typeof InvestorRounds>[0]['client'];
  return { c, paths };
}

const realRound = {
  personaId: 'investor',
  runId: 'botlab-investor-2026-09-02T22-40-01-268Z',
  atUtc: '2026-09-02T22:40:06.913Z',
  ok: true, steps: 3, failed: 0, source: 'cron',
  delivery: { sent: true, photosSent: 0, chars: 2674 },
  artifacts: [
    { name: '미국-지수-S-P500.txt', text: fx('investor-미국-지수-S-P500.txt') },
    { name: 'KR-수급-삼성전자.txt', text: fx('investor-KR-수급-삼성전자.txt') },
  ],
};

afterEach(() => { harness.unmount(); });

describe('BotRounds — 상태 넷', () => {
  it('라우트를 «옳은 질의»로 부른다', async () => {
    const { c, paths } = client(Promise.resolve({ rounds: [realRound] }));
    harness.render(() => BotRounds({ client: c, persona: 'investor', title: '📈 투자 회차', subtitle: '부제' }));
    await harness.settle();
    expect(paths[0] ?? '').toContain('/v1/bots/rounds');
    expect(paths[0] ?? '').toContain('persona=investor');
    expect(paths[0] ?? '').toContain('limit=');
  });

  it('⛔ 라우트가 «없으면» 0건이 아니라 «못 받았다»로 그린다', async () => {
    const { c } = client(Promise.reject(new Error('404 Not Found')));
    harness.render(() => BotRounds({ client: c, persona: 'investor', title: '📈 투자 회차', subtitle: '부제' }));
    await harness.settle();
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'rounds-investor'));
    expect(text).toContain('못 받았다');
    expect(text).toContain('404 Not Found');
    expect(text).toContain('/v1/bots/rounds');  // 🔑 어느 라우트가 없는지 «이름을 댄다»
    expect(text).not.toContain('0건');
  });

  it('⛔ 진짜 0건은 «안내»다 — 오류가 아니다', async () => {
    const { c } = client(Promise.resolve({ rounds: [] }));
    harness.render(() => BotRounds({ client: c, persona: 'investor', title: '📈 투자 회차', subtitle: '부제' }));
    await harness.settle();
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'rounds-investor'));
    expect(text).toContain('0건');
    expect(text).not.toContain('못 받았다');
  });

  it('⚠️ 「지금 깨진 것」이 있으면 «경보»로 말한다', async () => {
    const { c } = client(Promise.resolve({ rounds: [realRound], unreadable: 2, unreadableBy: { 'result-broken': 2 } }));
    harness.render(() => BotRounds({ client: c, persona: 'investor', title: '📈 투자 회차', subtitle: '부제' }));
    await harness.settle();
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'rounds-investor'));
    expect(text).toContain('지금 못 읽는 자리 2곳');
    expect(text).toContain('과소');
  });

  it('⭐ 「옛 회차」뿐이면 «경보하지 않는다» — 양성을 경보처럼 보이게 하지 마라', async () => {
    const { c } = client(Promise.resolve({ rounds: [realRound], unreadable: 45, unreadableBy: { 'result-missing': 45 } }));
    harness.render(() => BotRounds({ client: c, persona: 'investor', title: '📈 투자 회차', subtitle: '부제' }));
    await harness.settle();
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'rounds-investor'));
    expect(text).toContain('옛 회차');
    expect(text).toContain('「지금 깨진 것」은 «없다»');
    expect(text).not.toContain('지금 못 읽는 자리');   // ⛔ 경보 문면이 «없어야» 한다
  });

});

/**
 * ⛔⭐ **카드는 «카드 층»에서 문다** — 해네스의 `textOf` 는 `props.children` 만 훑고
 * ***함수 컴포넌트를 «호출하지 않는다»***. ⇒ 45차가 그걸 모르고 상위에서 물다 세 번 헛짚었다.
 * 🔑 제품 코드를 시험 때문에 «비틀지» 않고 시험을 «층에 맞춘다».
 */
describe('RoundCard', () => {
  const view = toRoundView(realRound);

  it('⭐ 「무인인가 · 폰에 갔나 · 언제」를 «말한다»', () => {
    harness.render(() => RoundCard({ round: view }));
    const text = harness.textOf(harness.find((e) => String(e.props['data-testid'] ?? '').startsWith('round-')));
    expect(text).toContain('무인(cron)');
    expect(text).toContain('폰에 갔다');
    expect(text).toContain('KST');              // ⛔ 시간대를 «붙인다»
    expect(text).toContain('07:40');            // ⭐ UTC 22:40 → KST 07:40
  });

  it('⛔ 본문을 «안 받은» 산출은 수를 대며 남는다', () => {
    const v = toRoundView({ ...realRound, artifacts: [{ name: 'a.txt' }, { name: 'b.txt' }] });
    harness.render(() => RoundCard({ round: v }));
    const text = harness.textOf(harness.find((e) => String(e.props['data-testid'] ?? '').startsWith('round-')));
    expect(text).toContain('본문을 «안 받은» 산출 2건');
    expect(text).toContain('a.txt');
  });

  it('⛔ 차트를 «안» 그린다 — 대표가 뺐다(#15326)', () => {
    harness.render(() => RoundCard({ round: view }));
    const html = JSON.stringify(harness.find((e) => String(e.props['data-testid'] ?? '').startsWith('round-')));
    expect(html).not.toContain('img');
    expect(html).not.toContain('.png');
    expect(html).not.toContain('canvas');
  });

  it('⛔ 「모름」을 «false 로 접지» 않는다', () => {
    const v = toRoundView({ runId: 'x', artifacts: [] });
    harness.render(() => RoundCard({ round: v }));
    const text = harness.textOf(harness.find((e) => String(e.props['data-testid'] ?? '').startsWith('round-')));
    expect(text).toContain('출처 «모름»');
    expect(text).toContain('배달 «모름»');      // ⛔ 「안 갔다」가 «아니다»
    expect(text).toContain('시각 «모름»');
  });
});

/**
 * ⛔ **블록은 «블록 층»에서 문다** — 위 `RoundCard` 주석과 같은 이유(해네스가 함수 컴포넌트를 안 부른다).
 */
describe('블록 — 실물 산출로', () => {
  const quote = readArtifact('미국-지수-S-P500.txt', fx('investor-미국-지수-S-P500.txt'));
  const flow = readArtifact('KR-수급-삼성전자.txt', fx('investor-KR-수급-삼성전자.txt'));

  it('QuoteBlock — 종가·변동·OHLC 를 «수»로', () => {
    if (quote.kind !== 'quote') throw new Error('픽스처가 시세가 «아니다»');
    harness.render(() => QuoteBlock({ a: quote }));
    const text = harness.textOf(harness.find((e) => String(e.props['data-testid'] ?? '').startsWith('quote-')));
    expect(text).toContain('GSPC.INDX');
    expect(text).toContain('7,666.6');
    expect(text).toContain('+35.13');
    expect(text).toContain('(+0.46%)');   // ⭐ 「35.13 (+0.46%)」에서 «둘»을 갈랐다
    expect(text).toContain('7,631.47');   // 전일
  });

  it('FlowBlock — 외국인·기관·개인을 «부호와 함께»', () => {
    if (flow.kind !== 'flow') throw new Error('픽스처가 수급표가 «아니다»');
    harness.render(() => FlowBlock({ a: flow }));
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'flow-block'));
    expect(text).toContain('5일');
    expect(text).toContain('-2,576,734');   // 외국인
    expect(text).toContain('+95,756');      // ⭐ 개인은 «양수» — 부호가 붙는다
  });

  it('NewsBlock — 실제 newsbot의 다섯 기사 title·url·date를 전용 블록으로', () => {
    const news = readArtifact('AI-소식-뉴스-.txt', fx('newsbot-AI-소식-뉴스-.txt'));
    if (news.kind !== 'news') throw new Error('픽스처가 news가 «아니다»');
    harness.render(() => NewsBlock({ a: news }));
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'news-block'));
    expect(text).toContain('AI 최신 소식');
    expect(text).toContain('클라우드 AI 최신 소식');
    expect(text).toContain('4 days ago');
    expect(text).toContain('구글 포 코리아 2026');
  });

  it('UnparsedBlock — ⛔ 못 읽은 것을 «이름과 앞머리»로', () => {
    const a = readArtifact('새-스킬.txt', '━━━\n어떤 새 스킬\n값: 42');
    if (a.kind !== 'unparsed') throw new Error('unparsed 가 «아니다»');
    harness.render(() => UnparsedBlock({ a }));
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'unparsed-block'));
    expect(text).toContain('새-스킬.txt');
    expect(text).toContain('못 읽었다');
    expect(text).toContain('어떤 새 스킬');
  });
});

/** 🗂️ 비서 꼴 — ⛔ 「0」을 «흐리게» 접지 않는다. */
describe('KeyedBlock — 비서 실물', () => {
  const a = readArtifact('메일-일정-요약.txt', fx('assistant-메일-일정-요약.txt'));
  it('제목·라벨·값을 그린다', () => {
    if (a.kind !== 'keyed') throw new Error('keyed 가 «아니다»');
    harness.render(() => KeyedBlock({ a }));
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'keyed-block'));
    expect(text).toContain('비서');
    expect(text).toContain('안 읽은 메일(24h)');
    expect(text).toContain('10');
    expect(text).toContain('앞으로 24시간 일정');
    expect(text).toContain('0');        // ⛔ 진짜 0 이 «보인다»
  });
});

/** ⛔ 절이 «어느 봇이든» 쓰이는지 — 투자 전용이 아니다. */
describe('BotRounds — 일반형', () => {
  it('persona 를 그대로 질의에 싣고 제목을 그린다', async () => {
    const { c, paths } = client(Promise.resolve({ rounds: [] }));
    harness.render(() => BotRounds({ client: c, persona: 'newsbot', title: '📰 뉴스 회차', subtitle: '부제' }));
    await harness.settle();
    expect(paths[0] ?? '').toContain('persona=newsbot');
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'rounds-newsbot'));
    expect(text).toContain('📰 뉴스 회차');
    expect(text).toContain('부제');
  });
});

/**
 * ⛔ **프리셋은 «렌더»가 아니라 «배선»을 문다** — 해네스가 자식 함수 컴포넌트를 안 부르므로
 * 프리셋을 렌더해도 아무것도 안 나온다(㉕). ⇒ ***반환된 element 의 props 를 «직접» 본다.***
 */
describe('프리셋 셋 — 배선', () => {
  const propsOf = (el: unknown) => (el as { props: Record<string, unknown> }).props;
  const c = client(Promise.resolve({ rounds: [] })).c;

  it('InvestorRounds → persona=investor ⊕ 차트 안 그린다고 «말한다»', () => {
    const p = propsOf(InvestorRounds({ client: c }));
    expect(p.persona).toBe('investor');
    expect(String(p.title)).toContain('투자');
    expect(String(p.subtitle)).toContain('차트');   // 대표가 뺐다는 사실을 화면이 말한다
  });
  it('AssistantRounds → persona=assistant ⊕ 「0도 잰 값」을 말한다', () => {
    const p = propsOf(AssistantRounds({ client: c }));
    expect(p.persona).toBe('assistant');
    expect(String(p.subtitle)).toContain('0');
  });
  it('NewsbotRounds → persona=newsbot ⊕ 「꼴이 여럿」을 «미리» 말한다', () => {
    const p = propsOf(NewsbotRounds({ client: c }));
    expect(p.persona).toBe('newsbot');
    expect(String(p.subtitle)).toContain('꼴이 여럿');
  });
});

/** 🚨 ⛔ 「실패」는 «회색 안내»가 아니라 «빨강»이어야 한다 — 그래야 사람이 본다. */
describe('FailureBlock — 실물 실패 산출', () => {
  it('무엇이 «어떻게» 실패했는지 말한다', () => {
    const a = readArtifact('메일-일정-요약.txt', fx('assistant-실패-gmail.txt'));
    if (a.kind !== 'failure') throw new Error('failure 가 «아니다»');
    harness.render(() => FailureBlock({ a }));
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'failure-block'));
    expect(text).toContain('메일-일정-요약.txt');
    expect(text).toContain('이 단계가 «실패»했다');
    expect(text).toContain('Gmail');            // 🔑 «무엇이» 실패했는지
  });
  it('⭐ 「못 읽었다」와 «다른 블록»이다', () => {
    const a = readArtifact('x.txt', fx('investor-실패-traceback.txt'));
    if (a.kind !== 'failure') throw new Error('failure 가 «아니다»');
    harness.render(() => FailureBlock({ a }));
    // ⛔ unparsed-block 이 «아니어야» 한다
    expect(() => harness.find((e) => e.props['data-testid'] === 'unparsed-block')).toThrow();
    const text = harness.textOf(harness.find((e) => e.props['data-testid'] === 'failure-block'));
    expect(text).not.toContain('못 읽었다');
  });
});
