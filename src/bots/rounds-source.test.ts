/**
 * 📂 `rounds-source` 반증 — ⛔ 「0건」과 「못 읽었다」가 «갈리는가»가 핵심이다.
 * 🔑 임시 원장을 «손으로 세워» 깨진 자리를 일부러 만든다(실물은 깨져 있지 않으므로).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readBotRounds, readBotRoundsFromQuery, dirNameToUtc, isSafeSegment, isArtifactFile } from './rounds-source.js';

const ROOT = join(tmpdir(), `elanous-rounds-test-${process.pid}`);
const round = (persona: string, dir: string, meta: unknown, files: Record<string, string> = {}) => {
  const d = join(ROOT, 'botlab', persona, dir);
  mkdirSync(d, { recursive: true });
  if (meta !== undefined) writeFileSync(join(d, 'RESULT.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t);
};

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  round('investor', '2026-09-02T22-40-01-268Z',
    { personaId: 'investor', runId: 'R1', finishedAtUtc: '2026-09-02T22:40:06.913Z', ok: true, steps: 3, failed: 0, source: 'cron', delivery: { sent: true, photosSent: 0, chars: 2674 } },
    { 'a.txt': 'AAA', 'chart.png': 'binary-ish' });
  round('investor', '2026-09-01T22-40-01-741Z',
    { personaId: 'investor', runId: 'R0', finishedAtUtc: '2026-09-01T22:40:00.000Z', ok: true, steps: 4, failed: 0, source: 'cron', delivery: { sent: true } },
    { 'b.txt': 'BBB' });
  round('newsbot', '2026-09-03T00-00-00-000Z',
    { personaId: 'newsbot', runId: 'N1', finishedAtUtc: '2026-09-03T00:00:00.000Z', ok: true, source: 'cron' },
    { 'n.txt': 'NNN' });
  // ⛔ 일부러 깨뜨린다 — RESULT.json 이 «망가진» 회차
  round('investor', '2026-08-31T22-40-01-155Z', '{ 이건 JSON 이 아니다', { 'c.txt': 'CCC' });
  // ⛔ RESULT.json 이 «아예 없는» 회차 (⚠️ 「0」이 아니라 「못 읽었다」다)
  round('investor', '2026-08-30T22-40-01-330Z', undefined, { 'd.txt': 'DDD' });
});
afterAll(() => { rmSync(ROOT, { recursive: true, force: true }); });

describe('보조 판정기', () => {
  test('dirNameToUtc — UTC 이름을 ISO 로', () => {
    expect(dirNameToUtc('2026-09-02T22-40-01-268Z')).toBe('2026-09-02T22:40:01.268Z');
  });
  test('⛔ 모양이 다르면 null — 지어내지 않는다', () => {
    expect(dirNameToUtc('오늘')).toBeNull();
    expect(dirNameToUtc('2026-09-02')).toBeNull();
  });
  test('⛔ 경로를 «지어내지» 못하게 한다', () => {
    for (const bad of ['', '.', '..', 'a/b', 'a\\b']) expect(isSafeSegment(bad)).toBe(false);
    expect(isSafeSegment('investor')).toBe(true);
  });
  test('⛔ png 는 산출이 «아니다» — 대표가 차트를 뺐다', () => {
    expect(isArtifactFile('a.txt')).toBe(true);
    expect(isArtifactFile('chart.png')).toBe(false);
    expect(isArtifactFile('RESULT.json')).toBe(false);
  });
});

describe('readBotRounds — 실물 꼴', () => {
  test('persona 하나를 최신순으로', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'investor', limit: 2 });
    expect(r.rounds.map((x) => x.runId)).toEqual(['R1', 'R0']);   // ⭐ UTC 이름이라 사전순 역 = 최신순
    expect(r.rounds[0]!.source).toBe('cron');
    expect(r.rounds[0]!.delivery.sent).toBe(true);
  });
  test('본문을 담고 png 는 «안» 담는다', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'investor', limit: 1 });
    expect(r.rounds[0]!.artifacts.map((a) => a.name)).toEqual(['a.txt']);
    expect(r.rounds[0]!.artifacts[0]!.text).toBe('AAA');
  });
  test('⭐ withText=0 이면 본문이 «없다» — 빈 문자열이 아니다', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'investor', limit: 1, withText: false });
    expect(r.rounds[0]!.artifacts[0]!.text).toBeUndefined();
    expect(r.rounds[0]!.artifacts[0]!.chars).toBeGreaterThan(0);
  });
  test('⛔ 깨진 RESULT.json 을 «세어» 낸다 — 그 회차를 버리지 않는다', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'investor', limit: 10 });
    expect(r.unreadable).toBeGreaterThanOrEqual(2);      // 깨진 것 ⊕ 없는 것
    const broken = r.rounds.find((x) => x.atUtc?.startsWith('2026-08-31'));
    expect(broken).toBeDefined();
    expect(broken!.runId).toBeNull();                     // ⛔ 못 읽었으니 null
    expect(broken!.atUtc).toBe('2026-08-31T22:40:01.155Z'); // ⭐ ***디렉토리 이름이 구해 줬다***
    expect(broken!.artifacts.map((a) => a.name)).toEqual(['c.txt']);
  });
  test('⭐ 여러 봇을 «시각 역순»으로 섞는다 — 봇별 묶음이 아니다', () => {
    const r = readBotRounds({ stateRoot: ROOT, limit: 10 });
    const ids = r.rounds.map((x) => x.runId);
    expect(ids[0]).toBe('N1');            // 09-03 이 가장 최근
    expect(ids.includes('R1')).toBe(true);
  });
  test('⛔ 없는 persona 는 «0건 ⊕ 못 읽었다 1»', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'nope' });
    expect(r.rounds.length).toBe(0);
    expect(r.unreadable).toBe(1);          // 🔑 「없다」가 아니라 「못 읽었다」
  });
  test('⛔ 경로 탈출을 «거부»한다', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: '../../etc' });
    expect(r.rounds.length).toBe(0);
    expect(r.unreadable).toBe(1);
  });
  test('⛔ 뿌리가 «없어도» 던지지 않는다', () => {
    const r = readBotRounds({ stateRoot: join(ROOT, 'nowhere') });
    expect(r.rounds.length).toBe(0);
    expect(r.unreadable).toBe(1);
  });
  test('⭐ 긴 본문은 «자르고» 원래 길이를 chars 로 남긴다', () => {
    const long = 'x'.repeat(5000);
    round('big', '2026-09-03T01-00-00-000Z', { personaId: 'big', source: 'cron' }, { 'l.txt': long });
    const r = readBotRounds({ stateRoot: ROOT, persona: 'big', maxTextChars: 200 });
    expect(r.rounds[0]!.artifacts[0]!.text!.length).toBe(200);
    expect(r.rounds[0]!.artifacts[0]!.chars).toBe(5000);   // 🔑 잘렸음을 «알 수 있다»
  });
});

describe('readBotRoundsFromQuery — 🅣 가 부를 꼴', () => {
  test('persona·limit·withText 를 읽는다', () => {
    const r = readBotRoundsFromQuery(new URLSearchParams('persona=investor&limit=1&withText=0'), ROOT);
    expect(r.rounds.length).toBe(1);
    expect(r.rounds[0]!.artifacts[0]!.text).toBeUndefined();
  });
  test('⛔ 인자가 없어도 «돈다»', () => {
    expect(readBotRoundsFromQuery(new URLSearchParams(''), ROOT).rounds.length).toBeGreaterThan(0);
  });
  test('⛔ limit 이 쓰레기면 «기본»으로 — 던지지 않는다', () => {
    expect(readBotRoundsFromQuery(new URLSearchParams('limit=abc'), ROOT).rounds.length).toBeGreaterThan(0);
  });
});

/**
 * 🩺 ⛔ **「45」라는 수 하나로는 «경보인지 선사시대인지» 못 가른다** — 45차가 그 값을 내고도 안 봤다.
 * 파 보니 전부 `result-missing`(도입 전 옛 회차)이었다. ⇒ 까닭을 «나눠» 낸다.
 */
describe('unreadableBy — 못 읽은 «까닭»을 가른다', () => {
  test('⭐ 「없다」와 「깨졌다」가 «다른 칸»이다', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'investor', limit: 10 });
    expect(r.unreadableBy['result-missing']).toBe(1);   // 일부러 만든 「RESULT.json 없는」 회차
    expect(r.unreadableBy['result-broken']).toBe(1);    // 일부러 만든 「깨진 JSON」 회차
  });
  test('합이 unreadable 과 «같다» — 두 수가 어긋나면 하나는 거짓이다', () => {
    const r = readBotRounds({ stateRoot: ROOT, limit: 50 });
    const sum = Object.values(r.unreadableBy).reduce((a, b) => a + b, 0);
    expect(sum).toBe(r.unreadable);
  });
  test('⛔ 경로 탈출은 «rejected» 로 — dir-unreadable 과 섞지 않는다', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: '../../etc' });
    expect(r.unreadableBy.rejected).toBe(1);
    expect(r.unreadableBy['dir-unreadable']).toBe(0);
  });
  test('⛔ 없는 뿌리는 «dir-unreadable»', () => {
    const r = readBotRounds({ stateRoot: join(ROOT, 'nowhere') });
    expect(r.unreadableBy['dir-unreadable']).toBe(1);
    expect(r.unreadableBy.rejected).toBe(0);
  });
  test('⭐ 깨끗하면 «전부 0»', () => {
    const r = readBotRounds({ stateRoot: ROOT, persona: 'newsbot' });
    expect(r.unreadable).toBe(0);
    expect(Object.values(r.unreadableBy).every((v) => v === 0)).toBe(true);
  });
});
