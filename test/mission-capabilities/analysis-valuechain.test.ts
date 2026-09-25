import { describe, expect, spyOn, test } from 'bun:test';
import provider, { createValuechainProvider, probeValuechain } from '../../src/mission-capabilities/analysis/valuechain.js';
import { capabilityProviders, probeCapability } from '../../src/mission-capabilities/registry.js';
import { Database } from 'bun:sqlite';
import { ensureKgTables, upsertNode, addEdge } from '../../src/domains/kg-store.js';
import { collectSemisView } from '../../src/domains/kg-semis.js';

describe('analysis.valuechain capability provider', () => {
  test('reports a repairable failure when the semiconductor knowledge graph has no view', async () => {
    const result = probeValuechain(() => null);

    expect(provider.id).toBe('analysis.valuechain');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a missing knowledge graph view to degrade the provider.');
    expect(result.reason).toContain('knowledge graph');
    expect(result.repairHint.what).toContain('Populate');
    expect(`${result.reason} ${result.repairHint.what}`).not.toMatch(/fault|injection/i);
  });

  test('reports ready when the semiconductor knowledge graph has a view', () => {
    expect(probeValuechain(() => ({ chainName: '반도체' }) as never)).toEqual({ ok: true });
  });

  test('provider delegates to its injected collector and returns its sentinel result', async () => {
    let calls = 0;
    const injectedProvider = createValuechainProvider(() => {
      calls += 1;
      return { chainName: 'sentinel valuechain' } as never;
    });

    expect(await injectedProvider.probe()).toEqual({ ok: true });
    expect(calls).toBe(1);
  });

  // ⛔ 「같은 기본 수집기로 두 번 불러 값이 같다」는 «위임»을 관측하지 못한다(Goodhart).
  //    probeCapability 가 «등록된 그 provider 의 probe» 를 부르는지를 spy 로 «직접» 본다.
  test('probeCapability 가 «등록된 provider 의 probe» 를 실제로 부른다', async () => {
    const registered = capabilityProviders.find(candidate => candidate.id === 'analysis.valuechain');
    if (!registered) throw new Error('레지스트리에 analysis.valuechain 이 «없다».');

    const sentinel = { ok: false, reason: 'sentinel', repairHint: { paths: ['sentinel'], what: 'sentinel' } } as const;
    const spy = spyOn(registered, 'probe').mockResolvedValue(sentinel);
    try {
      const seen = await probeCapability('analysis.valuechain');
      expect(spy).toHaveBeenCalledTimes(1);
      // ⭐ 센티널이 «그대로» 나와야 위임이다 — 다른 경로로 계산했다면 여기서 죽는다.
      expect(seen).toEqual(sentinel);
    } finally {
      spy.mockRestore();
    }
  });

  test('등록되지 않은 id 는 undefined 다 — 「모름」과 「실패」를 섞지 않는다', async () => {
    expect(await probeCapability('analysis.__none__')).toBeUndefined();
  });
});

/**
 * ⛔ 위 describe 는 «수집기를 흉내낸» 갈림이다 — 그것만으로는 「퇴화하지 않았다」를 못 보인다.
 * 이 describe 는 ***진짜 collectSemisView*** 를 «빈 그래프 ↔ 채운 그래프»에 대고 가른다.
 * 🔑 trafficlight(자기 파일 안 상수를 자기가 검사 ⇒ 항상 true)와 «형태가 다르다»는 것이 요지다.
 */
describe('analysis.valuechain — 비퇴화(진짜 수집기 × 실제 그래프)', () => {
  const NOW = '2026-07-10';
  function freshDb(): Database {
    const db = new Database(':memory:');
    ensureKgTables(db);
    return db;
  }
  function seedSemis(db: Database) {
    upsertNode(db, { id: 'chain:반도체', kind: 'chain', name: '반도체', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'subchain:HBM', kind: 'subchain', name: 'HBM', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:005930', kind: 'company', market: 'KR', name: '삼성전자', firstSeen: NOW, lastSeen: NOW });
    upsertNode(db, { id: 'company:000660', kind: 'company', market: 'KR', name: 'SK하이닉스', firstSeen: NOW, lastSeen: NOW });
    addEdge(db, { src: 'subchain:HBM', dst: 'chain:반도체', relation: 'belongs_to', validAt: NOW });
    addEdge(db, { src: 'company:005930', dst: 'subchain:HBM', relation: 'belongs_to', validAt: NOW });
    addEdge(db, { src: 'company:000660', dst: 'subchain:HBM', relation: 'belongs_to', validAt: NOW });
    addEdge(db, { src: 'company:000660', dst: 'company:005930', relation: 'supplies', weight: 1, validAt: NOW });
  }

  test('빈 그래프와 채운 그래프의 ok 가 «서로 다르다»', () => {
    const empty = probeValuechain(() => collectSemisView({ db: freshDb() }));

    const seeded = freshDb();
    seedSemis(seeded);
    const filled = probeValuechain(() => collectSemisView({ db: seeded }));

    expect(empty.ok).toBe(false);
    expect(filled.ok).toBe(true);
    // ⛔ 이 한 줄이 「퇴화 probe」를 막는 자리다 — 항상 true 면 여기서 죽는다.
    expect(filled.ok).not.toBe(empty.ok);
  });

  test('외부 상태가 비면 «고칠 곳»을 경로로 댄다', () => {
    const empty = probeValuechain(() => collectSemisView({ db: freshDb() }));
    if (empty.ok) throw new Error('빈 그래프인데 ok:true 다 — probe 가 외부 상태를 안 보고 있다.');
    expect(empty.repairHint.paths).toContain('src/domains/kg-semis.ts');
  });
});
