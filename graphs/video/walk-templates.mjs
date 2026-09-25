#!/usr/bin/env bun
/** 표준 그래프 둘을 «실제로 걷는다» — 선언이 아니라 «걸음»으로 확인한다.
 *
 *  돌리는 법:  bun graphs/video/walk-templates.mjs
 *  ⛔ 워커가 필요하다(이 저장소에 없다) — README 의 「쓰는 법」 참조. — 선언이 아니라 걸음으로 확인한다.
 *
 * ⛔ 무엇을 확인하나 (이것이 없으면 「선언만 섰다」로 남는다):
 *   ⓐ 종단이 «전부» 걸어서 닿나 (위상 도달과 «다른 값»이다)
 *   ⓑ 폐루프가 «소진»되나 (max_visits 가 실제로 무나)
 *   ⓒ 「못 쟀다」가 unobserved 로 가나 (no-edge 와 접히지 않나)
 *   ⓓ 계약 판정이 «전부 선언»돼 있나 (undeclared 가 0인가)
 */
// ⛔ 워커는 이 저장소에 «없다» — 외부 프로젝트용 워커를 가리킨다(graphs/video/README.md).
//    경로는 GRAPH_WALKER 로 덮을 수 있다.
import { fileURLToPath } from 'node:url';

const WALKER = process.env.GRAPH_WALKER
  ?? `${process.env.HOME}/temp/agentic-consulting/scripts/graph-walk.ts`;
const { readGraphSpec, walkGraph } = await import(WALKER);

// ⛔ `import.meta.dir` 은 «bun 전용»이다 — node 로 이 .mjs 를 집으면 undefined 가 되어
//    `undefined/<파일>.yaml` 로 ENOENT 가 나고, 읽는 사람은 「워커가 고장났다」로 읽는다(2026-09-22 실측).
//    ⇒ 두 런타임에서 «같은» 값을 주는 형태로 푼다.
const HERE = fileURLToPath(new URL('.', import.meta.url));


function stepFrom(script) {
  const used = {};
  return async (node) => {
    const v = script[node.node_id];
    if (v === undefined) return 'ok';                    // 기본 통과
    if (Array.isArray(v)) { const i = used[node.node_id] ?? 0; used[node.node_id] = i + 1; return v[Math.min(i, v.length - 1)]; }
    return v;
  };
}


const FILM = [
  { name: '① 정상 — 마스터 ⊕ 소셜 ⊕ 검수', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: 'ok',
              'typo-parity': 'parity', 'assemble-gate': 'spans', loudness: 'in-range',
              'reframe-decide': 'croppable', social: 'ok', review: 'pass' } },
  { name: '② 소셜이 못 났다 — 실패가 «아니다»', expectTerminal: 'master-only', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: 'ok',
              'typo-parity': 'parity', 'assemble-gate': 'spans', loudness: 'in-range',
              'reframe-decide': 'croppable', social: 'error' } },
  { name: '③ 앱이 안 떠 있다 (preflight)', expectTerminal: 'host-blocked', expectStop: 'terminal',
    script: { preflight: 'host-down' } },
  { name: '③b AE 모달창 (함정 ⓟ) — 생성 중에 막힌다', expectTerminal: 'host-blocked', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: 'host-modal' } },
  { name: '④ 음악을 못 받았다', expectTerminal: 'blocked', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'no-track' } },
  { name: '⑤ 산출은 났는데 «안 봤다»', expectTerminal: 'unobserved', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: 'ok',
              'typo-parity': 'parity', 'assemble-gate': 'spans', loudness: 'in-range',
              'reframe-decide': 'croppable', social: 'ok', review: 'unviewed' } },
  { name: '⑥ 폐루프 — 마디가 계속 어긋난다 (max_visits 2)', expectTerminal: null, expectStop: 'budget-exceeded',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'off-grid' } },
  // ⚠️ 기대를 «고쳤다» — 워커는 unobserved «노드»를 밟고 그 다음 걸음에서 stopReason 을 terminal 로 덮는다.
  //    ⇒ 원인은 terminal 칸에 남고 stopReason 칸에는 «안 남는다»(발견 ②).
  { name: '⑦ 「못 쟀다」 — 노드가 결과를 못 낸다', expectTerminal: 'unobserved', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: null } },
  { name: '⑧ 조립이 «성공을 반환»했는데 범위가 비었다 (함정 ⓢ)', expectTerminal: null, expectStop: 'budget-exceeded',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: 'ok',
              'typo-parity': 'parity', 'assemble-gate': 'empty-range' } },
  { name: '⑨ 전용 합성으로 갔다가 돌아온다', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { preflight: 'ready', assets: 'ok', music: 'ok', barsnap: 'snapped', generate: 'ok',
              'typo-parity': 'parity', 'assemble-gate': 'spans', loudness: 'in-range',
              'reframe-decide': 'needs-native', 'native-recut': 'ok', social: 'ok', review: 'pass' } },
];

const CHAR = [
  { name: '① 정상 — 등록·연출·편집까지', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'pass', views: 'ok', register: 'both',
              'register-gate': 'holds', shots: 'ok', 'shot-gate': 'principled',
              'reframe-decide': 'croppable', edit: 'ok' } },
  { name: '② Soul 이 face_not_found — «갈림»이지 실패가 아니다', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'pass', views: 'ok', register: 'element-only',
              'register-gate': 'holds', shots: 'ok', 'shot-gate': 'principled',
              'reframe-decide': 'croppable', edit: 'ok' } },
  { name: '③ 컷은 났는데 편집이 못 돌았다', expectTerminal: 'rendered-unedited', expectStop: 'terminal',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'pass', views: 'ok', register: 'both',
              'register-gate': 'holds', shots: 'ok', 'shot-gate': 'principled',
              'reframe-decide': 'croppable', edit: 'no-plan' } },
  { name: '④ 브라우저가 못 떴다', expectTerminal: 'blocked', expectStop: 'terminal',
    script: { reference: 'error' } },
  { name: '⑤ 산출을 «안 봤다»', expectTerminal: 'unobserved', expectStop: 'terminal',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'pass', views: 'ok', register: 'both',
              'register-gate': 'holds', shots: 'ok', 'shot-gate': 'unviewed' } },
  { name: '⑥ 폐루프 — 판형이 계속 얇다 (sheet max_visits 4)', expectTerminal: null, expectStop: 'budget-exceeded',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'thin' } },
  { name: '⑦ 풀블리드 — 비율로 다시 렌더하고 돌아온다', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'pass', views: 'ok', register: 'both',
              'register-gate': 'holds', shots: 'ok', 'shot-gate': 'principled',
              'reframe-decide': ['fullbleed', 'croppable'], edit: 'ok' } },
  { name: '⑧ 정체성이 «안 유지된다» — 뷰로 되돌아간다', expectTerminal: 'delivered', expectStop: 'terminal',
    script: { reference: 'ok', sheet: 'ok', 'sheet-gate': 'pass', views: 'ok', register: 'both',
              'register-gate': ['drifts', 'holds'], shots: 'ok', 'shot-gate': 'principled',
              'reframe-decide': 'croppable', edit: 'ok' } },
  { name: '⑨ 핀이 0건 — 쿼리를 늘려 다시 (reference max_visits 3)', expectTerminal: null, expectStop: 'budget-exceeded',
    script: { reference: 'empty' } },
];

async function run(file, cases) {
  const { spec, error } = readGraphSpec(`${HERE}${file}`);
  if (!spec) { console.log(`✗ ${file}: ${error}`); return { pass: 0, fail: 1, undeclared: 0 }; }
  console.log(`\n══ ${spec.graph_id} (노드 ${spec.nodes.length} · 종단 ${spec.terminal_nodes.length}) ══`);
  let pass = 0, fail = 0, undeclared = 0;
  const undeclaredNodes = new Set();
  const reachedTerminals = new Set();
  for (const c of cases) {
    const r = await walkGraph(spec, stepFrom(c.script), { unobservedNode: 'unobserved', maxSteps: 60 });
    const ok = r.terminal === c.expectTerminal && r.stopReason === c.expectStop;
    ok ? pass++ : fail++;
    if (r.terminal) reachedTerminals.add(r.terminal);
    for (const st of r.steps.filter((x) => x.contract === 'undeclared')) undeclaredNodes.add(st.node);
    undeclared += r.steps.filter((st2) => st2.contract === 'undeclared').length;
    const path = r.steps.map((s2) => s2.node + (s2.visit > 1 ? `#${s2.visit}` : '')).join('→');
    console.log(`${ok ? '✅' : '❌'} ${c.name}`);
    console.log(`     걸음 ${String(r.steps.length).padStart(2)} · 종단 ${String(r.terminal)} · stop ${r.stopReason}` +
                (ok ? '' : `   ⛔ 기대 ${c.expectTerminal}/${c.expectStop}`));
    console.log(`     ${path}`);
  }
  const missed = spec.terminal_nodes.filter((t) => !reachedTerminals.has(t));
  console.log(`\n  ── 종단 «걸어서» 닿은 것: ${reachedTerminals.size}/${spec.terminal_nodes.length}` +
              (missed.length ? `  ⛔ 못 닿음: ${missed.join(',')}` : '  ✅'));
  // ⛔ 「계약 없음」이 «어느 노드»인가를 본다 — 종단(judge)은 하는 일이 없어 계약이 «없는 게 맞다».
  const nonTerminal = [...undeclaredNodes].filter((n) => !spec.terminal_nodes.includes(n));
  console.log(`  ── 계약 undeclared 노드: ${[...undeclaredNodes].join(',')}`);
  console.log(`     그중 «종단이 아닌» 것: ${nonTerminal.length ? nonTerminal.join(',') + ' ⛔' : '없음 ✅'}`);
  return { pass, fail, undeclared, missed };
}

const a = await run('film-production-standard.yaml', FILM);
const b = await run('character-video-standard.yaml', CHAR);
console.log(`\n═══ 합계 · 통과 ${a.pass + b.pass} · 실패 ${a.fail + b.fail} ═══`);
process.exit(a.fail + b.fail === 0 ? 0 : 1);
