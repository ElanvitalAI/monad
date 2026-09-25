import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debug } from '../src/debug/log.js';
import { activeImplementTemplate } from '../src/self-implement/graph-authority.js';
import { inspectAllTemplates, loadGraphTemplatesFrom, defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { appendRunLedgerEntry } from '../src/self-implement/run-ledger.js';
import { observeFrontNodeEntry } from '../src/self-dev/graph-front-nodes.js';

const PRESERVED_STAGES = ['implement', 'gate', 'review', 'rework', 'main-sync', 'regate', 'open-pr', 'merge'] as const;

function observedPipelineEntries(runId: string): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const originalLog = debug.log;
  debug.log = ((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'self-implement' && event === 'pipeline-node-entry' && data?.runId === runId) entries.push(data);
  }) as typeof debug.log;
  try {
    for (const node of ['author', 'plan', 'decompose'] as const) observeFrontNodeEntry(node, {
      provenance: node === 'author'
        ? 'authoring-start'
        : node === 'plan'
          ? 'authoring-plan'
          : 'authoring-decomposition-start',
      runId,
      goalType: 'implement',
    });
    return entries;
  } finally {
    debug.log = originalLog;
  }
}

async function ledgerEntries(directory: string, runId: string): Promise<Array<Record<string, unknown>>> {
  const text = await Bun.file(join(directory, `${runId}.jsonl`)).text();
  return text.trim().split('\n')
    .map((line) => JSON.parse(line) as { event: string; data: Record<string, unknown> })
    .filter((row) => row.event === 'pipeline-node-entry')
    .map((row) => row.data);
}

describe('active implement graph names actual stages', () => {
  test('YAML declaration, actual front observations grouped by runId, and topology agree', async () => {
    const loaded = loadGraphTemplatesFrom(defaultGraphsDir());
    const template = activeImplementTemplate();
    const declaredNodes = template.nodes.map((node) => node.nodeId);
    const observed = observedPipelineEntries('run-graph-names-actual-stages');

    expect(loaded.source).toBe('yaml');
    expect(template).toEqual(loaded.templates[template.graphId]);
    expect(observed).toHaveLength(3);
    expect(observed.every((entry) => entry.graphId === template.graphId && declaredNodes.includes(entry.node as string))).toBe(true);

    const preservedIndexes = PRESERVED_STAGES.map((stage) => declaredNodes.indexOf(stage));
    expect(preservedIndexes.every((index) => index >= 0)).toBe(true);
    expect(preservedIndexes.every((index, position) => position === 0 || preservedIndexes[position - 1]! < index)).toBe(true);

    const inspection = inspectAllTemplates().find((entry) => entry.graphId === template.graphId);
    expect(inspection?.defects).toEqual([]);

    const ledgerDirectory = mkdtempSync(join(tmpdir(), 'graph-names-actual-stages-'));
    const runId = 'run-graph-names-actual-stages';
    try {
      mkdirSync(ledgerDirectory, { recursive: true });
      for (const data of observed) appendRunLedgerEntry({ runId, event: 'pipeline-node-entry', data }, ledgerDirectory);
      expect(await ledgerEntries(ledgerDirectory, runId)).toEqual(observed);
    } finally {
      rmSync(ledgerDirectory, { recursive: true, force: true });
    }
  });
});

// ── 🩸 저자가 붙인 가드 — 자식의 수리에 «회귀 방어»가 없었다 ──────────────
//   자식은 감독 메모를 받아 `rework-patient.yaml` 의 인덱스를 3 → 6 으로 고쳤다(옳다).
//   ⛔ 그런데 그 수리를 «무는 시험»이 없어서, 인덱스를 3으로 되돌려도 «초록»이었다.
//
// 🩸🆕 그리고 그 «첫 판»도 구멍이 있었다 — 인덱스 경로를 쓰는 오버레이가 «셋»(경로 넷)인데
//   저자가 «하나»만 가드했다. ⇒ 이 판은 «전수»다: 목록에 없는 오버레이가 인덱스를 쓰면 «빨강».
//
// 🔑 지킬 것은 「인덱스가 N 이다」가 «아니라» ***「그 인덱스가 «의도한 노드»를 가리킨다」***다.
//   ⛔ 오버레이 파일은 그 취약함을 «주석»으로 경고하고 있었다 — 시험은 주석을 «안 읽는다».
//      📌 경고는 주석이 아니라 «자»로 써야 한다.

/** 인덱스 패치의 «의도» — ⛔ 여기 없는 오버레이가 인덱스를 쓰면 아래 시험이 실패한다(완전성 강제). */
const INDEX_PATCH_INTENT: ReadonlyArray<{
  readonly overlay: string; readonly graphId: string; readonly index: number; readonly nodeId: string;
}> = [
  { overlay: 'heal-patient',         graphId: 'default-loop',   index: 6, nodeId: 'rework' },
  { overlay: 'heal-patient',         graphId: 'default-loop',   index: 7, nodeId: 'heal' },
  { overlay: 'rework-patient',       graphId: 'self-implement', index: 6, nodeId: 'rework' },
  { overlay: 'research-wide-launch', graphId: 'research-loop',  index: 0, nodeId: 'investigate' },
];

/** 오버레이 파일들이 «실제로» 쓰는 인덱스 경로를 읽는다 — 목록이 아니라 «실물»에서. */
function observedIndexPatches(): Array<{ overlay: string; index: number }> {
  const dir = join(import.meta.dir, '..', 'graphs', 'overlays');
  const found: Array<{ overlay: string; index: number }> = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml')) continue;
    const source = readFileSync(join(dir, file), 'utf8');
    for (const match of source.matchAll(/^\s*path:\s*\/nodes\/(\d+)\//gm)) {
      found.push({ overlay: file.replace(/\.yaml$/, ''), index: Number(match[1]) });
    }
  }
  return found;
}

test('인덱스 패치가 «의도한 노드»를 가리킨다 — 노드가 밀리면 빨강', () => {
  const templates = loadGraphTemplatesFrom(defaultGraphsDir());
  for (const { overlay, graphId, index, nodeId } of INDEX_PATCH_INTENT) {
    const nodes = (templates.templates[graphId]?.nodes ?? []).map((n) => n.nodeId);
    if (nodes.length === 0) throw new Error(`${graphId} 를 못 읽었다 — 이 가드는 «못 쟀다»`);
    expect({ overlay, graphId, at: index, node: nodes[index] })
      .toEqual({ overlay, graphId, at: index, node: nodeId });
  }
});

test('의도 목록이 «전수»다 — 목록에 없는 인덱스 패치가 있으면 빨강', () => {
  const observed = observedIndexPatches();
  expect(observed.length).toBeGreaterThan(0);   // ⛔ 0이면 정규식이 죽은 것이지 「없는」 것이 아니다
  const declared = new Set(INDEX_PATCH_INTENT.map((i) => `${i.overlay}#${i.index}`));
  const undeclared = observed.filter((o) => !declared.has(`${o.overlay}#${o.index}`));
  expect(undeclared).toEqual([]);
  // ⊕ 반대 방향도 — 목록에만 있고 파일엔 없으면 목록이 «늙은» 것이다
  const seen = new Set(observed.map((o) => `${o.overlay}#${o.index}`));
  expect(INDEX_PATCH_INTENT.filter((i) => !seen.has(`${i.overlay}#${i.index}`))).toEqual([]);
});
