import { describe, it, expect } from 'bun:test';
import type { LlmInventory } from '../../llm/local-manager/types.js';
import {
  pickLocalChatModel, parseSupersedeVerdict, judgeSupersedeRelation, proposeSemanticSupersede,
  buildTopicClusterPairs, buildSemanticSupersedeProposal,
  type SemanticDeps, type DocRef, type ClusterDoc,
} from './semantic-supersede.js';
import type { CurationItem } from './doc-curation.js';

const inv = (over: Partial<LlmInventory> = {}): LlmInventory => ({
  nodes: [
    { id: 'local', label: 'local', isLocal: true, reachable: true, runtimes: ['lmstudio'], lastProbedAt: 1 } as any,
    { id: 'node-b', label: 'node-b', isLocal: false, reachable: true, runtimes: ['lmstudio'], lastProbedAt: 1 } as any,
  ],
  models: [
    { id: 'text-embedding-nomic-embed-text-v1.5', nodeId: 'local', runtime: 'lmstudio', label: 'nomic' } as any,
    { id: 'gemma-4-26b-a4b-it', nodeId: 'local', runtime: 'lmstudio', label: 'gemma-4', loaded: true } as any,
    { id: 'qwen3.5-9b-mlx', nodeId: 'node-b', runtime: 'lmstudio', label: 'qwen' } as any,
  ],
  at: 1, cached: false, warnings: [], ...over,
});

const deps = (chatReturn: string, over: Partial<SemanticDeps> = {}): SemanticDeps => ({
  inventory: async () => inv(),
  resolveUrl: () => 'http://127.0.0.1:1234/v1', // loopback
  chat: async () => chatReturn,
  ...over,
});

const A: DocRef = { path: 'docs/HANDOFF-alpha-2026-07-01.md', title: 'Alpha', excerpt: '세션 패브릭 아크 완주', date: '2026-07-01' };
const B: DocRef = { path: 'docs/RECAP-session-fabric-2026-07-10.md', title: 'Recap', excerpt: '세션 패브릭 아크 완주(갱신)', date: '2026-07-10' };

describe('pickLocalChatModel — 자기 자원 인지', () => {
  it('gemma 우선·임베딩 제외·reachable 만', () => {
    const p = pickLocalChatModel(inv(), () => 'http://127.0.0.1:1234/v1');
    expect(p!.modelId).toBe('gemma-4-26b-a4b-it'); // gemma 최우선(loaded 가점)
    expect(p!.spec).toBe('local-llm:local:gemma-4-26b-a4b-it');
  });
  it('reachable 노드 없으면 null(계층 부재)', () => {
    const noReach = inv({ nodes: [{ id: 'local', label: 'l', isLocal: true, reachable: false, runtimes: [], lastProbedAt: 1 } as any] });
    expect(pickLocalChatModel(noReach)).toBeNull();
  });
  it('임베딩 모델만 있으면 null', () => {
    const embedOnly = inv({ models: [{ id: 'nomic-embed', nodeId: 'local', runtime: 'lmstudio', label: 'n' } as any] });
    expect(pickLocalChatModel(embedOnly)).toBeNull();
  });
});

describe('parseSupersedeVerdict', () => {
  it('5관계 파싱 + direction', () => {
    const v = parseSupersedeVerdict('{"relation":"supersedes","direction":"b_over_a","confidence":0.9,"reason":"B가 최신"}');
    expect(v.relation).toBe('supersedes');
    expect(v.direction).toBe('b_over_a');
    expect(v.confidence).toBe(0.9);
  });
  it('파싱 실패 → no_match(보수적)', () => {
    expect(parseSupersedeVerdict('없음').relation).toBe('no_match');
  });
});

describe('judgeSupersedeRelation', () => {
  it('gemma 판정 결과 반환(주입 chat)', async () => {
    const v = await judgeSupersedeRelation(A, B, deps('{"relation":"duplicate","direction":"b_over_a","confidence":0.85,"reason":"같은 내용"}'));
    expect(v.relation).toBe('duplicate');
  });
  it('로컬 챗 없으면 no_match(계층 부재·규칙 폴백)', async () => {
    const v = await judgeSupersedeRelation(A, B, { inventory: async () => inv({ models: [] }) });
    expect(v.relation).toBe('no_match');
    expect(v.reason).toContain('로컬 챗 모델 없음');
  });
  it('비-loopback URL 이면 fail-soft no_match(클라우드 거부)', async () => {
    const v = await judgeSupersedeRelation(A, B, deps('x', { resolveUrl: () => 'https://api.openai.com/v1' }));
    expect(v.relation).toBe('no_match'); // assertLoopbackModelUrl throw → catch → no_match
  });
});

describe('proposeSemanticSupersede', () => {
  it('supersedes → 구본에 비파괴 supersede-mark(방향 반영)', async () => {
    const items = await proposeSemanticSupersede([{ a: A, b: B }], deps('{"relation":"supersedes","direction":"b_over_a","confidence":0.9,"reason":"B 최신"}'));
    expect(items).toHaveLength(1);
    expect(items[0]!.path).toBe(A.path); // b_over_a → A가 구본
    expect(items[0]!.successor).toBe(B.path);
    expect(items[0]!.diff).toContain('비파괴');
    expect(items[0]!.detectorVersion).toBe('semantic-supersede-gemma4-v1');
  });
  it('related/no_match 는 제안 안 함', async () => {
    const items = await proposeSemanticSupersede([{ a: A, b: B }], deps('{"relation":"related","confidence":0.5,"reason":"관련"}'));
    expect(items).toHaveLength(0);
  });
  it('contradicts → 양쪽 플래그(successor 없음)', async () => {
    const items = await proposeSemanticSupersede([{ a: A, b: B }], deps('{"relation":"contradicts","confidence":0.7,"reason":"상충"}'));
    expect(items[0]!.reason).toContain('semantic:contradicts');
    expect(items[0]!.successor).toBeUndefined();
    expect(items[0]!.diff).toContain('contradiction');
  });
});

describe('buildTopicClusterPairs — bounded 후보(전수 O(n²) 금지)', () => {
  const cd = (topic: string, n = topic): ClusterDoc => ({ path: `docs/${n}.md`, filename: `${n}.md`, topic });
  it('공유 토큰 ≥2 이름 다른 쌍만 후보', () => {
    const docs: ClusterDoc[] = [
      cd('session-fabric-arc-voice', 'a'),    // session·fabric·voice 3공유(이름 다름) → 후보
      cd('session-fabric-voice-parity', 'b'),
      cd('unrelated-alpha-beta', 'c'),         // 공유<2 → 제외
    ];
    const { pairs } = buildTopicClusterPairs(docs, { minSharedTokens: 2 });
    expect(pairs).toHaveLength(1);
    expect([pairs[0]!.a.path, pairs[0]!.b.path].sort()).toEqual(['docs/a.md', 'docs/b.md']);
  });
  it('동일 topic 쌍은 제외(결정론 findSupersedeClusters 소관·중복 방지)', () => {
    const docs: ClusterDoc[] = [cd('session-fabric-arc', 'a'), cd('session-fabric-arc', 'b')];
    expect(buildTopicClusterPairs(docs, { minSharedTokens: 2 }).pairs).toHaveLength(0);
  });
  it('maxPairs 캡 초과 = truncated(다음 사이클)', () => {
    const docs: ClusterDoc[] = Array.from({ length: 6 }, (_, i) => cd(`mission-fabric-variant-${i}`, `d${i}`));
    // 6문서가 mission·fabric·variant 공유(변이 접미만 다름) → C(6,2)=15 쌍, 캡 2.
    const { pairs, truncated } = buildTopicClusterPairs(docs, { minSharedTokens: 2, maxPairs: 2 });
    expect(pairs).toHaveLength(2);
    expect(truncated).toBe(13);
  });
  it('비변별 토큰(버킷 > maxBucket) 배제 — 폭발 방지', () => {
    // 모두 'common' 하나만 공유(버킷 40) · maxBucket 5 → 그 토큰 스킵 → 후보 0.
    const docs: ClusterDoc[] = Array.from({ length: 40 }, (_, i) => cd(`common-uniq${i}`, `c${i}`));
    const { pairs } = buildTopicClusterPairs(docs, { minSharedTokens: 1, maxBucket: 5 });
    expect(pairs).toHaveLength(0);
  });
  it('결정론 — 같은 입력 같은 순서', () => {
    const docs: ClusterDoc[] = [cd('alpha-beta-gamma'), cd('alpha-beta-delta'), cd('alpha-beta-epsilon')];
    const r1 = buildTopicClusterPairs(docs, { minSharedTokens: 2 });
    const r2 = buildTopicClusterPairs(docs, { minSharedTokens: 2 });
    expect(r1.pairs.map((p) => [p.a.path, p.b.path])).toEqual(r2.pairs.map((p) => [p.a.path, p.b.path]));
  });
});

describe('buildSemanticSupersedeProposal — 큐 봉투·판정기반 멱등', () => {
  const item = (path: string, successor?: string): CurationItem => ({
    action: 'update', path, targetDocument: path, filename: path.split('/').pop()!,
    reason: 'r', evidenceQuote: 'e', sourcePath: successor ?? path, diff: 'd',
    confidence: 0.9, detectorVersion: 'semantic-supersede-gemma4-v1',
    ...(successor ? { successor } : {}), inboundRefs: 0,
  });
  it('CurationProposal 봉투(status proposed·model gemma-4)', () => {
    const p = buildSemanticSupersedeProposal([item('docs/a.md', 'docs/b.md')], { nowIso: '2026-07-14T00:00:00Z', scanned: 3 });
    expect(p.status).toBe('proposed');
    expect(p.model).toBe('gemma-4-semantic-supersede');
    expect(p.items).toHaveLength(1);
  });
  it('멱등키 = 판정 결과(path→successor) — 문구 무관·안정', () => {
    const a = buildSemanticSupersedeProposal([item('docs/a.md', 'docs/b.md')], { nowIso: '2026-07-14T00:00:00Z', scanned: 1 });
    const b = buildSemanticSupersedeProposal([{ ...item('docs/a.md', 'docs/b.md'), reason: '다른 문구' }], { nowIso: '2026-07-99T00:00:00Z', scanned: 9 });
    expect(a.idempotencyKey).toBe(b.idempotencyKey); // 같은 판정 → 같은 키(재실행 억제)
  });
});
