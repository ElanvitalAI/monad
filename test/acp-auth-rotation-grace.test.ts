/**
 * `/v1/acp` 인증이 «토큰 회전»을 따라가는가.
 *
 * 🩸 계기(2026-09-01 · 🅣 저작 · 🅢 인수): `monad token rotate`(#14941)가 봉투에 새 `active` 를 쓰고
 *    옛 값을 `prev` + `prevExpiresAt`(유예)로 남기는데, ACP 는 «부팅 때 잡은 문자열 하나»만 비교했다.
 *    ⇒ ⑴ 회전이 «재기동 없이» 안 먹고 ⑵ 옛 토큰을 든 원격이 «유예 없이» 끊긴다.
 *
 * ⛔ 아래 다섯은 🅣 의 골 문서 「판정 신호」를 그대로 옮긴 것이다.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptedAcpTokens, buildNexusWsBridgeAuth } from '../src/nexus/index.js';
import { createAuthVerifier } from '../src/acp/transport/auth.js';

/** ⛔ 이 시험이 만든 임시 봉투를 «전부» 걷는다 — 반복 실행에서 tmpdir 이 쌓이지 않게. */
const created: string[] = [];
afterAll(() => { for (const dir of created) rmSync(dir, { recursive: true, force: true }); });

/** 봉투를 «디스크에» 세운다 — ⛔ 판정 입력이 판정하는 파일 «밖»에 있어야 한다. */
function envelopeAt(active: string, prev?: string, prevExpiresAt?: string): string {
  const configDir = mkdtempSync(join(tmpdir(), 'acp-grace-'));
  created.push(configDir);
  mkdirSync(configDir, { recursive: true });
  const envelope: Record<string, unknown> = { active };
  if (prev !== undefined) envelope.prev = prev;
  if (prevExpiresAt !== undefined) envelope.prevExpiresAt = prevExpiresAt;
  writeFileSync(join(configDir, 'acp-token.json'), JSON.stringify(envelope), 'utf8');
  writeFileSync(join(configDir, 'acp-token'), active, 'utf8');
  return configDir;
}

// ⛔ 「미래」는 «실제 시계» 기준이어야 한다 — 검증기가 부르는 공급자는 주입한 now 가 아니라
//    `Date.now()` 를 쓴다. 고정 시각으로 잡았더니 그 「미래」가 «이미 과거」여서 ⑵ 가 빨강이었다.
//    🔑 집합 생성기만 재던 판은 이 결함을 «못 봤다» — 거기엔 now 를 주입했기 때문이다.
const NOW = Date.now();
const future = new Date(NOW + 3_600_000).toISOString();
const past = new Date(NOW - 3_600_000).toISOString();

describe('/v1/acp accepts the rotated token without a restart', () => {
  // ⛔ ⑴~⑶ 은 «집합 생성기»가 아니라 ***실제 검증 경로(verify)***로 묻는다 —
  //    골 문면이 「붙는다 / 거절된다」이고, 집합만 보면 「그 집합을 verifier 가 쓰는가」를 못 잰다.
  test('⑴ 회전 «뒤»의 새 토큰(B)이 재기동 없이 받아들여진다', () => {
    // 데몬은 부팅 때 A 를 잡았다. 그 뒤 회전이 봉투를 B 로 바꿨다.
    const configDir = envelopeAt('B-new', 'A-old', future);
    const verifier = buildNexusWsBridgeAuth('A-old', { configDir }).wsAuthVerifier;
    expect(verifier?.verify({ kind: 'auth', token: 'B-new' })).toEqual({ ok: true });
  });

  test('⑵ 유예 «안»의 옛 토큰(A)도 계속 받아들여진다', () => {
    const configDir = envelopeAt('B-new', 'A-old', future);
    const verifier = buildNexusWsBridgeAuth('A-old', { configDir }).wsAuthVerifier;
    expect(verifier?.verify({ kind: 'auth', token: 'A-old' })).toEqual({ ok: true });
  });

  test('⑶ 유예가 «지난» 옛 토큰은 «거절»된다', () => {
    const configDir = envelopeAt('B-new', 'A-old', past);
    const verifier = buildNexusWsBridgeAuth('A-old', { configDir }).wsAuthVerifier;
    expect(verifier?.verify({ kind: 'auth', token: 'B-new' })).toEqual({ ok: true });
    expect(verifier?.verify({ kind: 'auth', token: 'A-old' })).toEqual({ ok: false, reason: 'bad-token' });
  });

  test('⊕ 공급자가 «던지면» 거부한다 — 인증은 fail-closed 다', () => {
    const throwing = createAuthVerifier(() => { throw new Error('envelope read blew up'); });
    expect(throwing.verify({ kind: 'auth', token: 'anything' })).toEqual({ ok: false, reason: 'bad-token' });
  });

  test('⑷ 첫 부팅(부팅 토큰 없음)은 검증기를 «안» 넘긴다 — 무인증 도그푸드 보존', () => {
    expect(buildNexusWsBridgeAuth(undefined)).toEqual({});
  });

  test('⑸ 알 수 없는 토큰은 거절된다', () => {
    const configDir = envelopeAt('B-new', 'A-old', future);
    const verifier = buildNexusWsBridgeAuth('A-old', { configDir }).wsAuthVerifier;
    expect(verifier?.verify({ kind: 'auth', token: 'not-a-real-token' })).toEqual({ ok: false, reason: 'bad-token' });
    expect(verifier?.verify({ kind: 'auth', token: 'B-new' })).toEqual({ ok: true });
  });

  test('⊕ 봉투가 «없으면» 부팅 토큰 하나로 오늘과 똑같이 동작한다 (가용성 보존)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'acp-grace-none-'));
    created.push(empty);
    const accepted = acceptedAcpTokens('boot-only', { configDir: empty }, NOW).map(r => r.token);
    expect(accepted).toEqual(['boot-only']);
  });

  test('⊕ 봉투 JSON 이 «손상»되면 loadEnvelope 이 평문 파일로 폴백한다 — 던지지 «않는다»', () => {
    // 🔑 실측(2026-09-01): loadEnvelope 은 손상 JSON 에 예외를 내지 «않고» 평문 `acp-token` 으로
    //    마이그레이션해 { active: <평문값> } 을 낸다. ⇒ 우리 catch 분기는 이 경우에 «안 탄다».
    //    ⚠️ 잔여 위험은 «좁다»: `writeBoth` 가 회전마다 평문 파일도 새 active 로 덮으므로,
    //       회전이 한 번이라도 돌았으면 평문 값은 새 토큰이다. 옛 값이 되살아나려면
    //       「회전이 평문을 못 썼고 ⊕ 봉투 JSON 만 손상」이어야 한다.
    //    ⛔ 그 자리는 `src/auth/token-store.ts` 이고 이 골의 대상 경로 «밖»이다 — 별개 축으로 남긴다.
    const configDir = mkdtempSync(join(tmpdir(), 'acp-grace-corrupt-'));
    created.push(configDir);
    writeFileSync(join(configDir, 'acp-token.json'), '{ this is not json', 'utf8');
    writeFileSync(join(configDir, 'acp-token'), 'B-new', 'utf8');
    const accepted = acceptedAcpTokens('A-old', { configDir }, NOW).map(r => r.token);
    expect(accepted).toEqual(['B-new']);           // 평문값이 active 로 읽힌다
    expect(accepted).not.toContain('A-old');       // ⭐ 부팅 토큰으로 «폴백하지 않는다»
  });

  test('⊕ prevExpiresAt 이 «못 읽는 값»이면 받지 않는다 — 「모른다」는 「만료 안 됨」이 아니다', () => {
    const configDir = envelopeAt('B-new', 'A-old', 'not-a-date');
    const accepted = acceptedAcpTokens('A-old', { configDir }, NOW).map(r => r.token);
    expect(accepted).not.toContain('A-old');
  });

  test('🚨 봉투를 «읽을 수 없어도»(권한 000) loadEnvelope 은 던지지 않고 «평문 파일»로 폴백한다', () => {
    // 🔑 실측(2026-09-01 · 두 방식): 손상 JSON ⊕ chmod 000 «둘 다» 예외가 아니라 폴백이다.
    //    ⇒ `acceptedAcpTokens` 의 catch 분기는 ***오늘 도달 불가***이고, 방어로만 남긴다.
    // 🚨 그래서 «진짜» 잔여 위험은 여기다: 봉투를 못 읽으면 조용히 «평문 토큰»이 active 가 된다.
    //    회전이 평문도 같이 덮으므로(writeBoth) 보통은 새 값이지만, 그 둘이 갈리면 옛 값이 산다.
    //    ⛔ 그 자리는 `src/auth/token-store.ts` 이고 이 골의 대상 경로 «밖»이다 — 별개 축으로 남긴다.
    const configDir = mkdtempSync(join(tmpdir(), 'acp-grace-noperm-'));
    created.push(configDir);
    const envelopePath = join(configDir, 'acp-token.json');
    writeFileSync(envelopePath, JSON.stringify({ active: 'B-new' }), 'utf8');
    writeFileSync(join(configDir, 'acp-token'), 'RAW-token', 'utf8');
    chmodSync(envelopePath, 0o000);
    try {
      // ⛔ root·권한 우회 환경에서는 0o000 이어도 읽힌다 ⇒ 그때 이 단언은 「환경」을 잴 뿐이다.
      //    그래서 «정말 못 읽는지»를 먼저 확인하고, 읽히면 이 시험이 잴 것이 없으므로 건너뛴다.
      let unreadable = false;
      try { readFileSync(envelopePath, 'utf8'); } catch { unreadable = true; }
      if (!unreadable) return;                 // 권한이 안 먹는 환경 — 판정 불가(⚪), 거짓 초록이 아니다
      const accepted = acceptedAcpTokens('A-old', { configDir }, NOW).map(r => r.token);
      expect(accepted).toEqual(['RAW-token']);     // 평문으로 폴백한다
      expect(accepted).not.toContain('A-old');     // ⭐ 부팅 토큰으로는 «안» 돌아간다
      expect(accepted).not.toContain('B-new');     // ⭐ 못 읽은 봉투 값도 «안» 쓴다
    } finally {
      chmodSync(envelopePath, 0o600);
    }
  });

  test('⭐ 공급자는 «매 검증마다» 다시 읽는다 — 배열로 굳지 않는다', () => {
    const configDir = envelopeAt('A-old');
    const verifier = buildNexusWsBridgeAuth('A-old', { configDir }).wsAuthVerifier;
    expect(verifier?.verify({ kind: 'auth', token: 'A-old' })).toEqual({ ok: true });
    // 데몬을 재기동하지 «않고» 봉투만 회전시킨다
    writeFileSync(join(configDir, 'acp-token.json'), JSON.stringify({ active: 'C-newer' }), 'utf8');
    expect(verifier?.verify({ kind: 'auth', token: 'C-newer' })).toEqual({ ok: true });
  });
});
