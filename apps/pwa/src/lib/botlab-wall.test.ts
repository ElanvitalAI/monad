import { describe, expect, test } from 'bun:test';
import { DEFAULT_WALL_HOST, isValidWallHost, resolveWallHost } from './botlab-wall';

const REMEMBERED = 'cloud-vm.tailnet-example.ts.net';

describe('🖥️ 봇 화면 벽 — 호스트 고르기', () => {
  test('① 안 주면 «설정»에서 고르고, 어디서 왔는지를 «말한다» — 코드엔 누구의 호스트도 없다', () => {
    // 2026-09-25: 기본 호스트는 설정이다(빌드 env) — 시험 환경엔 그 설정이 없다.
    expect(DEFAULT_WALL_HOST).toBe('');
    for (const s of ['', '?', '?other=1']) {
      const r = resolveWallHost(s);
      expect(r).toEqual({ host: '', source: 'unset', rejected: null });
      const m = resolveWallHost(s, REMEMBERED);
      expect(m).toEqual({ host: REMEMBERED, source: 'remembered', rejected: null });
    }
    // ⛔ 기억된 값도 계약 밖이면 안 쓴다.
    expect(resolveWallHost('', 'https://x').source).toBe('unset');
  });

  test('② 주면 그것을 쓰고 「사람이 줬다」로 «갈라» 낸다', () => {
    const r = resolveWallHost('?host=other.ts.net', REMEMBERED);
    expect(r.host).toBe('other.ts.net');
    expect(r.source).toBe('query');
  });

  test('③ ⛔ 호스트도 «주소»에 들어간다 — 스킴·경로·질의를 못 끼운다', () => {
    for (const bad of ['a/b', 'a?b', 'a#b', 'https://x', 'a b', '-lead', 'trail-', '..', 'a..b',
                       'x'.repeat(300), 'a:8080', 'a"b', "a'b", '<script>']) {
      expect(isValidWallHost(bad)).toBe(false);
    }
    for (const ok of ['cloud-vm.tailnet-example.ts.net', 'localhost', 'a', 'a-b.c-d.e']) {
      expect(isValidWallHost(ok)).toBe(true);
    }
  });

  test('④ ⛔⭐ 계약 밖이면 «조용히» 기본값으로 안 떨어진다 — 무시했음을 낸다', () => {
    // 🔑 조용히 기본값을 쓰면 사람이 「왜 내 host 가 안 먹지」로 헤맨다.
    const r = resolveWallHost('?host=https://evil.example', REMEMBERED);
    expect(r.host).toBe(REMEMBERED);
    expect(r.rejected).toBe('https://evil.example');
    expect(resolveWallHost('?host=https://evil.example').source).toBe('unset');
  });
});
