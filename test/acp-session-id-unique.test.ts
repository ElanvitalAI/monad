// ACP 세션 id 유니크화 회귀 잠금 (2026-07-24)
//
// 고친 버그: 세션 id 접미가 프로세스 로컬 카운터(`elanous-session-1`, `-2`, …)라
// **데몬을 재시작할 때마다 1로 리셋**됐다. 그래서 서로 무관한 대화가 같은 id 를
// 공유했고 — 실측으로 2026-07-09 대화와 2026-07-23 대화가 둘 다
// `elanous-session-1` 이었다 — on-disk 미러(`~/.elanous/sessions/<id>.jsonl`)가
// 두 대화를 한 파일로 합쳤을 것이다. 그 결과 사고 대화를 사후 조회할 수 없었다.
//
// 설계: 내부 문서 `PLAN-self-cognition-observability-surgery-2026-07-24` §3

import { afterEach, describe, expect, test } from 'bun:test';
import {
  acpServerRegisterSession,
  mintAcpSessionToken,
  type AcpServerSession,
} from '../src/acp/server.js';
import {
  DualRoleManager,
  __resetDualRoleManagerForTest,
} from '../src/acp/dual-role-manager.js';

afterEach(() => {
  __resetDualRoleManagerForTest();
});

describe('mintAcpSessionToken', () => {
  test('항상 6자 base36', () => {
    for (let i = 0; i < 200; i += 1) {
      const t = mintAcpSessionToken();
      expect(t).toMatch(/^[0-9a-z]{6}$/);
    }
  });

  test('작은 값도 6자로 패딩 — 길이가 값에 따라 흔들리지 않는다', () => {
    expect(mintAcpSessionToken(() => 0)).toBe('000000');
    expect(mintAcpSessionToken(() => 1)).toBe('000001');
    expect(mintAcpSessionToken(() => 35)).toBe('00000z');
  });

  test('공간 상한에서 wrap — 36^6 을 넘겨도 6자를 유지', () => {
    const SPACE = 36 ** 6;
    expect(mintAcpSessionToken(() => SPACE)).toBe('000000');
    expect(mintAcpSessionToken(() => SPACE - 1)).toBe('zzzzzz');
    expect(mintAcpSessionToken(() => 2 ** 48 - 1)).toMatch(/^[0-9a-z]{6}$/);
  });

  test('주입된 rand 로 결정론적 — 테스트가 id 를 고정할 수 있다', () => {
    let n = 0;
    const next = () => n++;
    expect(mintAcpSessionToken(next)).toBe('000000');
    expect(mintAcpSessionToken(next)).toBe('000001');
  });

  test('★ 회귀 잠금 — 독립 발급이 서로 충돌하지 않는다 (종전엔 재시작마다 전부 "1")', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(mintAcpSessionToken());
    // 36^6 ≈ 2.18e9 공간에서 5000개 → 기대 충돌 ≈ 0.006개.
    // 종전 카운터 구현이었다면 "재시작 5000회" = 전부 '1' 이라 size 가 1 이 된다.
    expect(seen.size).toBeGreaterThan(4990);
  });
});

describe('acpServerRegisterSession — id 발급', () => {
  test('elanous-session- 접두를 유지한다 (접두 판정 소비자 무영향)', () => {
    const sessions = new Map<string, AcpServerSession>();
    const rec = acpServerRegisterSession(
      sessions, new DualRoleManager(), () => 'abc123', '/w',
    );
    expect(rec.id).toBe('elanous-session-abc123');
    expect(rec.id.startsWith('elanous-session')).toBe(true);
  });

  test('살아있는 세션과 충돌하면 재발급한다 (두 대화가 한 스트림을 공유하지 않게)', () => {
    const sessions = new Map<string, AcpServerSession>();
    const manager = new DualRoleManager();
    const tokens = ['dup000', 'dup000', 'fresh1'];
    let i = 0;
    const next = () => tokens[Math.min(i++, tokens.length - 1)]!;

    const first = acpServerRegisterSession(sessions, manager, next, '/a');
    expect(first.id).toBe('elanous-session-dup000');

    // 두 번째는 같은 토큰을 먼저 뱉지만 이미 점유돼 있으므로 재발급되어야 한다.
    const second = acpServerRegisterSession(sessions, manager, next, '/b');
    expect(second.id).toBe('elanous-session-fresh1');
    expect(second.id).not.toBe(first.id);
    expect(sessions.size).toBe(2);
  });

  test('★ 재발급 예산 소진 시에도 기존 세션을 덮어쓰지 않는다 (조용한 소실 방지)', () => {
    const sessions = new Map<string, AcpServerSession>();
    const manager = new DualRoleManager();
    // 항상 같은 토큰만 뱉는 병적 생성기 — 재발급 8회가 전부 실패한다.
    const stuck = () => 'stuck0';

    const first = acpServerRegisterSession(sessions, manager, stuck, '/a');
    expect(first.id).toBe('elanous-session-stuck0');

    // 예산 소진 후에도 throw/hang 하지 않고, **다른 id** 로 착지해야 한다.
    // 같은 키로 덮어쓰면 살아있는 대화의 레코드가 소실된다 — 이 변경이
    // 막으려는 사고와 정확히 같은 종류다.
    const second = acpServerRegisterSession(sessions, manager, stuck, '/b');
    expect(second.id).not.toBe(first.id);
    expect(second.id.startsWith('elanous-session-stuck0-')).toBe(true);
    expect(sessions.size).toBe(2);
    // 첫 세션 레코드가 그대로 살아 있어야 한다.
    expect(sessions.get(first.id)?.cwd).toBe('/a');
    expect(sessions.get(second.id)?.cwd).toBe('/b');
  });
});
