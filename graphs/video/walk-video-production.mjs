#!/usr/bin/env bun
/** 통합 영상 선언을 «실제로 걷는다» — ⛔ 선언이 아니라 «걸음»으로 확인한다.
 *
 *  돌리는 법:  bun graphs/video/walk-video-production.mjs
 *
 * 🩸 계기(2026-09-22): 이 PR 은 매뉴얼·RFC·본문 «네 곳»에서 「워커가 없다 · 걸음 검증 0회」라고
 *   적었다. ⛔ ***그런데 걷는 것이 «한 디렉토리 옆»에 있었다***(`walk-templates.mjs`).
 *   🅢 트랙이 그것을 찾아 알려 줬고, 그 지적의 이름이 ***「한 파일만 보고 판정」***이었다.
 *   ⇒ 🔑 ***「없다」를 쓰기 전에 그 디렉토리를 «전수»로 본다.***
 *
 * ⛔ 워커 자체는 이 저장소에 «없다» — 외부 프로젝트용을 가리킨다(README 의 「쓰는 법」).
 *    ⇒ 그것이 없는 기계에서는 이 파일이 «건너뛴다». 「못 돌렸다」와 「실패했다」는 다른 값이다.
 */
const WALKER = process.env.GRAPH_WALKER
  ?? `${process.env.HOME}/temp/agentic-consulting/scripts/graph-walk.ts`;

let readGraphSpec, walkGraph;
try { ({ readGraphSpec, walkGraph } = await import(WALKER)); }
catch {
  // ⛔ 「없어서 못 돌렸다」를 «통과»로 읽지 않는다 — 그러나 «실패»로도 읽지 않는다.
  console.log(`➖ 워커를 못 찾았다: ${WALKER}`);
  console.log('   ⇒ 이 관문은 «못 돌렸다»다(실패가 아니다). GRAPH_WALKER 로 경로를 줘라.');
  process.exit(3);
}

/**
 * ⛔⭐⭐ 「행복한 결과」가 노드마다 «다른 낱말»이다 — 이 선언의 어휘는 균일하지 않다.
 *   🩸 1판은 기본을 `'ok'` 로 뒀다가 ***열다섯 시나리오가 전부 `ground→structure` 에서 죽었다***
 *      (`structure` 는 `ok` 를 모른다 — `found|thin|unmeasurable` 뿐이다).
 *   🔑 ***그리고 그것은 「걸어 보기 전까지 «아무도» 몰랐다」*** — 위상 검사도 파싱 관문도
 *      이 불일치를 «원리상» 못 본다(둘 다 «간선이 있나»만 묻는다).
 *   ⇒ 그래서 이 표가 이 파일의 절반이다. ⛔ 노드를 더하면 «여기»도 더해야 한다.
 */
const HAPPY = {
  ground: 'ok', structure: 'found', plan: 'ok', assets: 'ok', assetgate: 'pass',
  audio: 'ok', align: 'pass', compose: 'ok', overlay: 'ok', render: 'ok',
  readback: 'pass', qc: 'pass', deliver: 'ok', shipcheck: 'pass',
};

function stepFrom(script) {
  const used = {};
  return async (node) => {
    const v = script[node.node_id];
    if (v === undefined) {
      const h = HAPPY[node.node_id];
      // ⛔ 「모르는 노드」를 «조용히 ok» 로 넘기지 않는다 — 그러면 새 노드가 시험을 빠져나간다.
      if (h === undefined) throw new Error(`HAPPY 에 '${node.node_id}' 가 없다 — 노드를 더했으면 여기도 더해라`);
      return h;
    }
    if (Array.isArray(v)) { const i = used[node.node_id] ?? 0; used[node.node_id] = i + 1; return v[Math.min(i, v.length - 1)]; }
    return v;
  };
}

/** ⭐ 이 PR 이 파는 값은 «노드»가 아니라 ***되돌아가는 간선***이다 — 그래서 그것부터 건다. */
const CASES = [
  { name: '① 곧은 길 — 아무것도 되돌아가지 않는다', expectTerminal: 'delivered', expectStop: 'terminal',
    script: {} },

  // ⛔⭐⭐ 2026-09-22 신설 — ***납품물을 보는 눈이 「없었다」.***
  //   실물에서 1920×1080 납품물에 자막이 통째로 빠졌는데 종단은 delivered 였다.
  //   ⇒ 「그 결함이 났을 때 그래프가 «되돌아가나»」를 여기서 «걸어» 확인한다.
  { name: '⑯ ship-broken → deliver (납품물이 틀렸으면 «만든 노드»로 되돌린다)',
    expectTerminal: 'delivered', expectStop: 'terminal',
    script: { shipcheck: ['ship-broken', 'pass'] } },

  // ⛔ 「못 쟀다」는 «실패»가 아니라 «다른 종단»이다 — 그것도 걸어서 확인한다.
  { name: '⑰ shipcheck 가 «못 쟀다» ⇒ unobserved',
    expectTerminal: 'unobserved', expectStop: 'terminal',
    script: { shipcheck: 'unmeasurable' } },

  { name: '② blackframe → compose (렌더도 조립도 아니었다)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { qc: ['blackframe', 'pass'] } },

  { name: '③ sheet-mismatch → plan (검수표가 «없는 자막»을 찾게 한다)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { qc: ['sheet-mismatch', 'pass'] } },

  { name: '④ palette-drift → assets (그림이 틀린 것이지 조립이 아니다)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { qc: ['palette-drift', 'pass'] } },

  { name: '⑤ layer-missing → overlay (그 위 층만 다시)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { qc: ['layer-missing', 'pass'] } },

  { name: '⑥ 자막 drift → plan (균등분할이 174ms 어긋났다)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { align: ['drift', 'pass'] } },

  { name: '⑦ 되읽기 gap → compose (exit 0 이라고 길이가 맞는 게 아니다)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { readback: ['gap', 'pass'] } },

  { name: '⑧ 비율/팔레트를 «생성 전»에 잡는다 (assetgate → assets)', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { assetgate: ['ratio', 'palette-drift', 'pass'] } },

  // ⛔ 「못 쟀다」가 «실패»로 접히지 않는가 — 이 PR 의 종단 넷 중 하나가 그것을 위해 있다.
  { name: '⑨ GUI 앱이 «조용히» 멎는다 → unobserved (failed 가 아니다)', expectTerminal: 'unobserved', expectStop: 'terminal',
    script: { compose: 'app-silent' } },

  { name: '⑩ 검수를 «못 쟀다» → unobserved', expectTerminal: 'unobserved', expectStop: 'terminal',
    script: { qc: 'unmeasurable' } },

  // ⛔ 사람을 부르는 자리와 막힌 자리는 «다른 종단»이다.
  { name: '⑪ 소재가 비었다 → needs-human', expectTerminal: 'needs-human', expectStop: 'terminal',
    script: { ground: 'empty' } },

  { name: '⑫ 크레딧이 말랐다 → needs-human (blocked 가 아니다)', expectTerminal: 'needs-human', expectStop: 'terminal',
    script: { assets: 'budget-exhausted' } },

  { name: '⑬ 렌더가 죽었다 → blocked', expectTerminal: 'blocked', expectStop: 'terminal',
    script: { render: 'error' } },

  // ⛔ 예산이 «실제로» 무는가 — max_visits 가 선언에만 있고 안 물면 폐루프가 증폭기가 된다.
  { name: '⑭ qc 가 계속 되돌린다 → 예산 소진 (max_visits 가 «문다»)', expectTerminal: null, expectStop: 'budget-exceeded',
    script: { qc: 'blackframe' } },

  { name: '⑮ assetgate 가 계속 되돌린다 → 예산 소진', expectTerminal: null, expectStop: 'budget-exceeded',
    script: { assetgate: 'ratio' } },
];

const FILE = 'video-production-pipeline.declaration.yaml';
const { spec, error } = readGraphSpec(`${import.meta.dir}/${FILE}`);
if (!spec) { console.log(`✗ ${FILE}: ${error}`); process.exit(1); }

console.log(`\n══ ${spec.graph_id} (노드 ${spec.nodes.length} · 종단 ${spec.terminal_nodes.length}) ══`);
let pass = 0, fail = 0;
const reached = new Set();
const undeclaredNodes = new Set();
for (const c of CASES) {
  const r = await walkGraph(spec, stepFrom(c.script), { unobservedNode: 'unobserved', maxSteps: 60 });
  const ok = r.terminal === c.expectTerminal && r.stopReason === c.expectStop;
  ok ? pass++ : fail++;
  if (r.terminal) reached.add(r.terminal);
  for (const st of r.steps.filter((x) => x.contract === 'undeclared')) undeclaredNodes.add(st.node);
  console.log(`${ok ? '✅' : '❌'} ${c.name}`);
  console.log(`     걸음 ${String(r.steps.length).padStart(2)} · 종단 ${String(r.terminal)} · stop ${r.stopReason}`
    + (ok ? '' : `   ⛔ 기대 ${c.expectTerminal}/${c.expectStop}`));
  console.log(`     ${r.steps.map((s) => s.node + (s.visit > 1 ? `#${s.visit}` : '')).join('→')}`);
}

// ⛔ 종단은 «위상 도달»이 아니라 «걸어서 닿았나»로 센다 — 다른 값이다.
const missed = spec.terminal_nodes.filter((t) => !reached.has(t));
console.log(`\n  ── 종단 «걸어서» 닿은 것: ${reached.size}/${spec.terminal_nodes.length}`
  + (missed.length ? `  ⛔ 못 닿음: ${missed.join(',')}` : '  ✅'));
const nonTerminal = [...undeclaredNodes].filter((n) => !spec.terminal_nodes.includes(n));
console.log(`  ── 계약 undeclared 노드: ${[...undeclaredNodes].join(',') || '없음'}`);
console.log(`     그중 «종단이 아닌» 것: ${nonTerminal.length ? nonTerminal.join(',') + ' ⛔' : '없음 ✅'}`);
console.log(`\n═══ 합계 · 통과 ${pass} · 실패 ${fail} ═══`);
process.exit(fail === 0 && missed.length === 0 && nonTerminal.length === 0 ? 0 : 1);
