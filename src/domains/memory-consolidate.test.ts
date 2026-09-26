// M3 consolidation — 에피소드 → 의미 umbrella 압축 단위테스트(mock embed·인메모리).
import { describe, test, expect } from 'bun:test';
import { openSurfaceEventsDb, recordEvent, queryEvents, recordInboundTurn } from './surface-events.js';
import { openKnowledgeDb, pruneKnowledge, ingestText, type EmbedFn } from './knowledge.js';
import { consolidateEpisodes, promoteSessionRecaps } from './memory-consolidate.js';

const mockEmbed: EmbedFn = async (text) => ({ vector: new Float32Array(8).fill(text.length % 5 / 5), model: 'mock' });
const old = (days: number) => new Date(Date.now() - days * 8.64e7).toISOString();

/** warm/cold 에피소드 N건(같은 domain×kind) 준비 — consolidated=0·tier 지정. */
function seedGroup(sdb: ReturnType<typeof openSurfaceEventsDb>, n: number, kind: string, domain: string, tier: 'warm' | 'cold') {
  for (let i = 0; i < n; i++) {
    const id = recordEvent(sdb, { surface: 'x', direction: 'outbound', kind, text: `${domain} ${kind} 발송 ${i}`, summary: `${kind} 요약 ${i}`, importance: 3, domain, ts: old(60 + i) });
    sdb.prepare(`UPDATE events SET tier = ? WHERE id = ?`).run(tier, id);
  }
}

describe('consolidateEpisodes — 흐린 에피소드 → 의미 umbrella', () => {
  test('그룹(≥minGroup) 압축 → knowledge kind=memory 영속 + 원본 consolidated 마킹', async () => {
    const sdb = openSurfaceEventsDb(':memory:');
    const kdb = openKnowledgeDb(':memory:');
    seedGroup(sdb, 6, 'digest', 'finance', 'warm');   // 6건 → 압축 대상
    const r = await consolidateEpisodes(sdb, kdb, { embed: mockEmbed, minGroup: 5 });
    expect(r.groups).toBe(1);
    expect(r.consolidated).toBe(6);
    // knowledge 에 umbrella 1건(kind='memory').
    const docs = kdb.query(`SELECT kind, domain, text FROM docs WHERE kind='memory'`).all() as Array<{ kind: string; domain: string; text: string }>;
    expect(docs.length).toBe(1);
    expect(docs[0]!.domain).toBe('finance');
    expect(docs[0]!.text).toContain('기억 요약');
    expect(docs[0]!.text).toContain('digest 요약');   // bullet 응축
    // 원본 6건 consolidated=1.
    const marked = (sdb.query(`SELECT COUNT(*) c FROM events WHERE consolidated=1`).get() as { c: number }).c;
    expect(marked).toBe(6);
    sdb.close(); kdb.close();
  });

  test('minGroup 미만 그룹은 압축 안 함', async () => {
    const sdb = openSurfaceEventsDb(':memory:');
    const kdb = openKnowledgeDb(':memory:');
    seedGroup(sdb, 3, 'alert', 'finance', 'cold');    // 3건 < 5
    const r = await consolidateEpisodes(sdb, kdb, { embed: mockEmbed, minGroup: 5 });
    expect(r.groups).toBe(0);
    expect((kdb.query(`SELECT COUNT(*) c FROM docs`).get() as { c: number }).c).toBe(0);
    sdb.close(); kdb.close();
  });

  test('hot(신선) 에피소드는 압축 대상 아님', async () => {
    const sdb = openSurfaceEventsDb(':memory:');
    const kdb = openKnowledgeDb(':memory:');
    // tier 기본 hot(신선) 6건 — 압축 제외.
    for (let i = 0; i < 6; i++) recordEvent(sdb, { surface: 'x', direction: 'outbound', kind: 'digest', text: `신선 ${i}`, importance: 3, domain: 'finance' });
    const r = await consolidateEpisodes(sdb, kdb, { embed: mockEmbed, minGroup: 5 });
    expect(r.groups).toBe(0);
    sdb.close(); kdb.close();
  });

  test('opt-in LLM summarize 주입 시 그 요약 사용', async () => {
    const sdb = openSurfaceEventsDb(':memory:');
    const kdb = openKnowledgeDb(':memory:');
    seedGroup(sdb, 5, 'digest', 'elanous', 'warm');
    const r = await consolidateEpisodes(sdb, kdb, { embed: mockEmbed, minGroup: 5, summarize: async () => 'LLM 압축 요약 결과' });
    expect(r.groups).toBe(1);
    const doc = kdb.query(`SELECT text FROM docs WHERE kind='memory'`).get() as { text: string };
    expect(doc.text).toBe('LLM 압축 요약 결과');
    sdb.close(); kdb.close();
  });
});

describe('promoteSessionRecaps — M4 세션 대화 → recap 승격', () => {
  test('세션 qna 턴(≥minTurns·warm) → session-recap 1건 + 원본 마킹', () => {
    const sdb = openSurfaceEventsDb(':memory:');
    // 한 세션의 대화 턴 5건(warm) 준비.
    for (let i = 0; i < 5; i++) {
      const id = recordInboundTurn({ surface: 'telegram', userText: `질문 ${i} 삼성 수급`, responseText: `답변 ${i}`, sessionId: 'sess-abc', db: sdb });
      sdb.prepare(`UPDATE events SET tier='warm' WHERE id=?`).run(id!);
    }
    const r = promoteSessionRecaps(sdb, { minTurns: 4 });
    expect(r.sessions).toBe(1);
    expect(r.promoted).toBe(5);
    // session-recap 에피소드 1건 생성.
    const recaps = queryEvents(sdb, { kind: 'session-recap' });
    expect(recaps.length).toBe(1);
    expect(recaps[0]!.text).toContain('세션 요약');
    expect(recaps[0]!.text).toContain('질문 0 삼성');
    // 원본 qna 5건 consolidated=1.
    expect((sdb.query(`SELECT COUNT(*) c FROM events WHERE kind='qna' AND consolidated=1`).get() as { c: number }).c).toBe(5);
    sdb.close();
  });

  test('minTurns 미만 세션은 승격 안 함', () => {
    const sdb = openSurfaceEventsDb(':memory:');
    for (let i = 0; i < 2; i++) {
      const id = recordInboundTurn({ surface: 'telegram', userText: `q${i}`, sessionId: 's2', db: sdb });
      sdb.prepare(`UPDATE events SET tier='warm' WHERE id=?`).run(id!);
    }
    expect(promoteSessionRecaps(sdb, { minTurns: 4 }).sessions).toBe(0);
    sdb.close();
  });
});

describe('pruneKnowledge — M5 knowledge retention', () => {
  const old = (days: number) => new Date(Date.now() - days * 8.64e7).toISOString();
  test('오래된 signal/outbound 정리·docs/memory/alpha 보존', async () => {
    const kdb = openKnowledgeDb(':memory:');
    await ingestText(kdb, { id: 'signal:old', ts: old(300), kind: 'signal', text: '낡은 신호' }, mockEmbed);
    await ingestText(kdb, { id: 'outbound:old', ts: old(300), kind: 'outbound', text: '낡은 발송' }, mockEmbed);
    await ingestText(kdb, { id: 'docs:keep', ts: old(300), kind: 'docs', text: '구현 문서(보존)', domain: 'elanous' }, mockEmbed);
    await ingestText(kdb, { id: 'memory:keep', ts: old(300), kind: 'memory', text: '의미 umbrella(보존)' }, mockEmbed);
    await ingestText(kdb, { id: 'signal:recent', ts: old(10), kind: 'signal', text: '최근 신호(보존)' }, mockEmbed);

    const n = pruneKnowledge(kdb, { maxAgeDays: 180 });
    expect(n).toBe(2);   // 낡은 signal + outbound
    const kinds = (kdb.query(`SELECT kind FROM docs ORDER BY kind`).all() as Array<{ kind: string }>).map(r => r.kind);
    expect(kinds).toEqual(['docs', 'memory', 'signal']); // docs·memory·최근 signal 보존
    kdb.close();
  });
});
