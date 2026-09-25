import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, getEdges, listNodes, getNode } from './kg-store.js';
import { seedClusters, seedValuechains, seedStructure, VALUECHAIN_ORDER } from './kg-seed.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
const NOW = '2026-07-08';

// 테스트용 미니 체인(KR_CHAINS 부분집합·결정론)
const MINI = {
  '반도체': {
    '메모리/종합': ['005930', '000660'],
    'HBM/후공정': ['042700'],
    '소재': ['005290'],
  },
  '로봇/AI': { '로봇': ['277810', '454910'] },
};
const NAMES = new Map([['005930', '삼성전자'], ['000660', 'SK하이닉스']]);

describe('kg-seed — 클러스터(R1)', () => {
  test('chain/subchain/company 노드 + belongs_to 계층', () => {
    const db = freshDb();
    const c = seedClusters(db, NOW, { chains: MINI, nameMap: NAMES });
    expect(c.chains).toBe(2);        // 반도체·로봇/AI
    expect(c.subchains).toBe(4);     // 메모리/종합·HBM/후공정·소재·로봇
    expect(c.companies).toBe(6);     // 005930·000660·042700·005290·277810·454910 (중복 없음)
  });
  test('company 노드 이름 매핑 + market KR + aliases', () => {
    const db = freshDb();
    seedClusters(db, NOW, { chains: MINI, nameMap: NAMES });
    const s = getNode(db, 'company:005930')!;
    expect(s.name).toBe('삼성전자');
    expect(s.market).toBe('KR');
    expect(s.aliases).toEqual(['005930']);
  });
  test('이름 없으면 code fallback', () => {
    const db = freshDb();
    seedClusters(db, NOW, { chains: MINI, nameMap: NAMES });
    expect(getNode(db, 'company:042700')!.name).toBe('042700');  // NAMES에 없음
  });
  test('belongs_to 방향 — company→subchain, subchain→chain', () => {
    const db = freshDb();
    seedClusters(db, NOW, { chains: MINI, nameMap: NAMES });
    // 삼성 → subchain:반도체·메모리/종합
    const e = getEdges(db, { src: 'company:005930', relation: 'belongs_to' })[0]!;
    expect(e.dst).toBe('subchain:반도체·메모리/종합');
    // subchain → chain:반도체
    const e2 = getEdges(db, { src: 'subchain:반도체·메모리/종합', relation: 'belongs_to' })[0]!;
    expect(e2.dst).toBe('chain:반도체');
  });
});

describe('kg-seed — 밸류체인(R4)', () => {
  test('supplies 상류→하류 연속 stage 연결', () => {
    const db = freshDb();
    seedClusters(db, NOW, { chains: MINI, nameMap: NAMES });
    const n = seedValuechains(db, NOW, { chains: MINI });
    // 반도체 order=[소재,장비,팹리스/파운드리,HBM/후공정,메모리/종합]. MINI엔 소재·HBM/후공정·메모리/종합만.
    // present=[소재,HBM/후공정,메모리/종합] → 2 supplies 엣지.
    expect(n).toBe(2);
    const supplies = getEdges(db, { relation: 'supplies' });
    expect(supplies).toHaveLength(2);
    // 소재 → HBM/후공정 (상류→하류)
    expect(supplies.some(e => e.src === 'subchain:반도체·소재' && e.dst === 'subchain:반도체·HBM/후공정')).toBe(true);
  });
  test('없는 stage 는 스킵(fail-soft)', () => {
    const db = freshDb();
    seedValuechains(db, NOW, { chains: { '반도체': { '메모리/종합': ['005930'] } } });
    // present=[메모리/종합] 하나뿐 → supplies 0
    expect(getEdges(db, { relation: 'supplies' })).toHaveLength(0);
  });
});

describe('kg-seed — seedStructure 통합', () => {
  test('클러스터+밸류체인 한번에', () => {
    const db = freshDb();
    const c = seedStructure(db, NOW, { chains: MINI, nameMap: NAMES });
    expect(c.chains).toBe(2);
    expect(c.supplies).toBe(2);
    expect(listNodes(db, { kind: 'chain' })).toHaveLength(2);
    expect(listNodes(db, { kind: 'company' })).toHaveLength(6);
  });
  test('멱등 — 재실행해도 노드 수 불변', () => {
    const db = freshDb();
    seedStructure(db, NOW, { chains: MINI, nameMap: NAMES });
    seedStructure(db, '2026-07-09', { chains: MINI, nameMap: NAMES });
    expect(listNodes(db, { kind: 'company' })).toHaveLength(6);
    expect(getEdges(db, { relation: 'supplies' })).toHaveLength(2);
  });
});

describe('kg-seed — VALUECHAIN_ORDER 커버리지', () => {
  test('주요 체인 정의 존재', () => {
    expect(VALUECHAIN_ORDER['반도체']).toBeDefined();
    expect(VALUECHAIN_ORDER['2차전지']).toBeDefined();
    expect(VALUECHAIN_ORDER['반도체']![0]).toBe('소재');   // 상류 시작
  });
});
