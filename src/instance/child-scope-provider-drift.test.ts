// 자식 우주의 `llm.provider` 가 운영과 어긋나면 «적는다» — 그리고 ⛔ 막지 «않는다».
//
// 🚨 왜 있는가 — 2026-09-23 실물 과금 인시던트:
//   한 트리의 격리 config 사본이 2026-09-10 부터 `openai-codex` 로 얼어 있었고 운영은 grok 으로 옮겨졌다.
//   ***그 우주의 런들은 계속 codex 로 쐈고, 어느 표면도 그 사실을 말하지 않았다.***
//   `isTestConfigStale`(mtime) 은 이 구멍을 못 막는다 — 호출부가 discord·telegram·pwa·`--state-dir` 넷뿐이고
//   ***하니스 발사 경로에 없다***(전수 확인). 그래서 「자식 우주를 정하는 그 한 지점」에 관측을 둔다.
import { describe, expect, it } from 'bun:test';
import { childInstanceScope } from './child-scope.js';

interface Logged { event: string; data: Record<string, unknown>; warn: boolean }

/** 운영 부모 → 파생 격리 자식 경로를 태우고, 그때 난 로그를 전부 모은다. */
function runDerived(providerByRoot: Record<string, string | null>): { logs: Logged[]; scope: { configDir?: string } } {
  const logs: Logged[] = [];
  const scope = childInstanceScope({
    effectiveRoot: () => '/prod',
    prodRoot: () => '/prod',
    derivedRoot: () => '/child',
    cwd: () => '/tree',
    childInstanceMode: () => 'isolated',
    log: (event, data, warn) => { logs.push({ event, data, warn: warn === true }); },
    rawProviderAt: (root) => providerByRoot[root] ?? null,
  });
  return { logs, scope };
}

const drift = (logs: Logged[]): Logged | undefined => logs.find((l) => l.event === 'child-config-provider-drift');

describe('자식 우주 provider 어긋남 — 적되 막지 않는다', () => {
  it('⛔ 어긋나면 «경고로» 적는다 — 어느 쪽이 무엇인지 값으로', () => {
    const { logs } = runDerived({ '/child': 'openai-codex', '/prod': 'grok' });
    const d = drift(logs);
    expect(d).toBeDefined();
    expect(d!.warn).toBe(true);
    expect(d!.data.verdict).toBe('differs');
    // ⭐ 「달랐다」만 적으면 사람이 다시 캐야 한다 — 두 값을 «그 줄에» 담는다.
    expect(d!.data.childProvider).toBe('openai-codex');
    expect(d!.data.prodProvider).toBe('grok');
  });

  it('✅ 같으면 «아무 말도 안 한다» — 소음을 만들지 않는다', () => {
    const { logs } = runDerived({ '/child': 'grok', '/prod': 'grok' });
    expect(drift(logs)).toBeUndefined();
    // 자가 무는지 — 그래도 본래의 child-scope 관측은 났어야 한다(로그 자체가 죽은 게 아니다).
    expect(logs.some((l) => l.event === 'child-scope')).toBe(true);
  });

  it('⛔ «한쪽만» 못 읽으면 `unknown` — ***「같다」로 접지 않는다*** (경고는 아니다)', () => {
    const { logs } = runDerived({ '/child': null, '/prod': 'grok' });
    const d = drift(logs);
    expect(d).toBeDefined();
    expect(d!.data.verdict).toBe('unknown');
    expect(d!.warn).toBe(false);
  });

  it('✅ «둘 다» 못 읽으면 조용하다 — 아직 사본이 없는 새 우주가 매번 시끄러우면 진짜 한 줄이 묻힌다', () => {
    const { logs } = runDerived({});
    expect(drift(logs)).toBeUndefined();
    expect(logs.some((l) => l.event === 'child-scope')).toBe(true);
  });

  it('⛔ 어긋나도 «막지 않는다» — 자식 우주는 그대로 정해진다', () => {
    const differs = runDerived({ '/child': 'openai-codex', '/prod': 'grok' });
    const same = runDerived({ '/child': 'grok', '/prod': 'grok' });
    expect(differs.scope.configDir).toBe('/child');
    expect(differs.scope).toEqual(same.scope);
  });
});
