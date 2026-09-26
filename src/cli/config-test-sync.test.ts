/**
 * config sync-test — 운영→테스트 물질화 동기화 계약 (ISO-1 · 2026-07-13).
 *
 * 전부 temp 디렉토리 — 실 ~/.elanous 미접촉. 핵심 계약:
 *   1. raw 변환이 buildTestSafeDaemonConfig(overlay 정책 원전)와 의미론 동일
 *   2. 미지 필드 보존 (정규화 저장이 필드를 떨어뜨리는 사고 클래스 회피)
 *   3. 부속 복사는 허용 목록만 — 무장류/푸시 자격은 목록에 없어야 한다
 */
import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildPromotedProdConfig,
  buildTestSafeRawConfig,
  isPromotable,
  isTestConfigStale,
  syncTestConfig,
  TEST_SYNC_AUX_FILES,
  TEST_SYNC_EXCLUDED,
} from './config-test-sync.js';

const PROD_RAW = {
  telegram: {
    enabled: true,
    botToken: '8799226199:MAIN',
    allowedUsers: [111],
    homeChannel: 111,
    reportChannel: { chatId: 111, botToken: '8755824181:REPORT' },
    testChannel: { botToken: '8724930076:TEST', allowedUsers: [222] },
    chatIdLegacyUnknownField: 999, // 미지 필드 — 보존돼야 함
  },
  discord: { enabled: true, botToken: 'D' },
  llm: { provider: 'anthropic' },
  customTopLevel: { keep: true }, // 미지 top-level — 보존
};

describe('buildTestSafeRawConfig — overlay 정책의 raw 물질화', () => {
  it('testChannel 있음 → 토큰 스왑 + 운영 아웃바운드 제거 + discord off', () => {
    const out = buildTestSafeRawConfig(structuredClone(PROD_RAW));
    const tg = out.telegram as Record<string, unknown>;
    expect(tg.botToken).toBe('8724930076:TEST');
    expect(tg.allowedUsers).toEqual([222]);
    expect(tg.reportChannel).toBeUndefined();
    expect(tg.homeChannel).toBeUndefined();
    expect((out.discord as Record<string, unknown>).enabled).toBe(false);
  });

  it('testChannel 없음 → telegram off (그래도 아웃바운드 제거)', () => {
    const raw = structuredClone(PROD_RAW) as Record<string, any>;
    delete raw.telegram.testChannel;
    const out = buildTestSafeRawConfig(raw);
    const tg = out.telegram as Record<string, unknown>;
    expect(tg.enabled).toBe(false);
    expect(tg.reportChannel).toBeUndefined();
  });

  it('미지 필드 보존 — telegram 내부·top-level 모두', () => {
    const out = buildTestSafeRawConfig(structuredClone(PROD_RAW));
    expect((out.telegram as Record<string, unknown>).chatIdLegacyUnknownField).toBe(999);
    expect(out.customTopLevel).toEqual({ keep: true });
    expect(out.llm).toEqual({ provider: 'anthropic' });
  });

  it('원본 불변 (순수 함수)', () => {
    const raw = structuredClone(PROD_RAW);
    buildTestSafeRawConfig(raw);
    expect(raw.telegram.botToken).toBe('8799226199:MAIN');
  });
});

describe('syncTestConfig — 파일 물질화 + 부속 복사', () => {
  function setup(): { dir: string; src: string; testDir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'elanous-cfgsync-'));
    const src = join(dir, 'prod');
    const testDir = join(dir, 'repo', '.elanous-test');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'config.json'), JSON.stringify(PROD_RAW));
    writeFileSync(join(src, 'secrets.json'), '{"k":"v"}');
    writeFileSync(join(src, 'apns.p8'), 'PUSH-CRED'); // 제외 대상
    writeFileSync(join(src, 'autopilot.json'), '{"armed":true}'); // 제외 대상
    return { dir, src, testDir };
  }

  it('변환본 저장 + 스탬프 + 허용 부속만 복사 (무장류/푸시 자격 미복사)', () => {
    const { dir, src, testDir } = setup();
    const r = syncTestConfig(testDir, src);
    const saved = JSON.parse(readFileSync(r.testConfigPath, 'utf-8')) as Record<string, any>;
    expect(saved.telegram.botToken).toBe('8724930076:TEST');
    expect(typeof saved._testSyncedAt).toBe('string');
    expect(r.copied).toEqual(['secrets.json']); // 존재하는 허용 파일만
    expect(r.telegramMode).toBe('test-token');
    // 제외 파일은 test dir 에 절대 없음
    expect(() => readFileSync(join(testDir, 'apns.p8'))).toThrow();
    expect(() => readFileSync(join(testDir, 'autopilot.json'))).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  // 🆕 2026-09-24 — 읽기 전용(0444) 대상이 같은 바이트면 건너뛰고, 목록 뒤 파일(auth.json)까지 복사가 이어진다.
  it('an identical read-only destination is skipped and the files after it are still copied', () => {
    const { dir, src, testDir } = setup();
    writeFileSync(join(src, 'llm-fallback.json'), '{"same":true}');
    writeFileSync(join(src, 'auth.json'), '{"a":1}');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'llm-fallback.json'), '{"same":true}');
    chmodSync(join(testDir, 'llm-fallback.json'), 0o444);
    const r = syncTestConfig(testDir, src);
    expect(r.skippedIdentical).toEqual(['llm-fallback.json']);
    expect(r.copied).toContain('auth.json');
    expect(readFileSync(join(testDir, 'auth.json'), 'utf-8')).toBe('{"a":1}');
    chmodSync(join(testDir, 'llm-fallback.json'), 0o644);
    rmSync(dir, { recursive: true, force: true });
  });

  it('허용/제외 목록이 겹치지 않는다 (정책 자기모순 가드)', () => {
    const excluded = new Set(TEST_SYNC_EXCLUDED.map((e) => e.file));
    for (const f of TEST_SYNC_AUX_FILES) expect(excluded.has(f)).toBe(false);
  });

  it('isTestConfigStale — 운영이 sync 후 갱신되면 drift', async () => {
    const { dir, src, testDir } = setup();
    syncTestConfig(testDir, src);
    expect(isTestConfigStale(testDir, src)).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(join(src, 'config.json'), JSON.stringify({ ...PROD_RAW, llm: { provider: 'x' } }));
    expect(isTestConfigStale(testDir, src)).toBe(true);
    // 재sync 로 해소
    syncTestConfig(testDir, src);
    expect(isTestConfigStale(testDir, src)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('테스트 사본 부재 = drift 아님 (최초 sync 는 호출측 소관)', () => {
    const { dir, src, testDir } = setup();
    expect(isTestConfigStale(testDir, src)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('overlay(buildTestSafeDaemonConfig) 파리티 — 정책 원전과 결과 동일', () => {
  it('토큰/아웃바운드/discord 처리 결과가 정규화 경로와 일치', async () => {
    const { buildTestSafeDaemonConfig, getUserConfig } = await import('../user-config.js');
    // 정규화 config 위에 overlay 적용 결과와, raw 변환 후 필드 비교(핵심 필드만 —
    // 정규화는 기본값을 채우므로 전체 동등이 아니라 정책 필드 파리티를 본다).
    const normalized = getUserConfig();
    const viaOverlay = buildTestSafeDaemonConfig({
      ...normalized,
      telegram: {
        ...normalized.telegram,
        enabled: true,
        botToken: '8799226199:MAIN',
        testChannel: { botToken: '8724930076:TEST', allowedUsers: [222] },
        reportChannel: { chatId: 111, botToken: '8755824181:REPORT' },
        homeChannel: 111 as unknown as undefined,
      },
    } as ReturnType<typeof getUserConfig>);
    const viaRaw = buildTestSafeRawConfig(structuredClone(PROD_RAW));
    const rawTg = viaRaw.telegram as Record<string, unknown>;
    expect(viaOverlay.telegram.botToken).toBe(rawTg.botToken as string);
    expect(viaOverlay.telegram.reportChannel).toBeUndefined();
    expect(rawTg.reportChannel).toBeUndefined();
    expect(viaOverlay.discord.enabled).toBe(false);
    expect((viaRaw.discord as Record<string, unknown>).enabled).toBe(false);
  });
});

describe('config promote — 테스트→운영 필드 단위 전파 (ISO-4)', () => {
  it('buildPromotedProdConfig — 지정 필드만 patch·나머지 불변', () => {
    const prod = { llm: { provider: 'anthropic' }, voice: { tts: { voiceId: 'old' } }, telegram: { botToken: 'MAIN' } };
    const test = { llm: { provider: 'anthropic' }, voice: { tts: { voiceId: 'tuned' } }, telegram: { botToken: 'TEST' } };
    const { next, before, after } = buildPromotedProdConfig(prod as any, test as any, 'voice.tts.voiceId');
    expect(before).toBe('old');
    expect(after).toBe('tuned');
    expect((next.voice as any).tts.voiceId).toBe('tuned');
    expect((next.telegram as any).botToken).toBe('MAIN'); // 다른 필드 불변
    expect((prod.voice as any).tts.voiceId).toBe('old'); // 원본 불변
  });

  it('테스트 config 에 없는 경로는 에러', () => {
    expect(() => buildPromotedProdConfig({}, {}, 'nope.x')).toThrow('없음');
  });

  it('denylist — telegram/discord/스탬프는 전파 불가', () => {
    expect(isPromotable('telegram.botToken')).toBe(false);
    expect(isPromotable('discord.enabled')).toBe(false);
    expect(isPromotable('_testSyncedAt')).toBe(false);
    expect(isPromotable('voice.tts.voiceId')).toBe(true);
    expect(isPromotable('logs.retention.maxAgeDays')).toBe(true);
  });
});
