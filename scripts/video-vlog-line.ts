#!/usr/bin/env bun
/**
 * 🎥 브이로그 라인 «실물 주행» — `vlog-found-footage-pipeline` 선언을 레시피로 «끝까지» 걷는다.
 *   찍힌 소재 → 전사 → 구조 → 원장 → 인점 검증 → 층 → 컷(핸들) → 프레임 관문 → 소리·더킹 → 더킹 관문
 *   → ***DaVinci Resolve 조립 → 되읽기 → 렌더*** → QC → 납품.
 *
 * 돌리는 법:
 *   bun scripts/video-vlog-line.ts --source <영상 폴더> [--music <bgm>] [--shots <shots.json>] [--out <작업디렉토리>]
 *                                  [--whisper-model tiny|small|large-v3-turbo] [--project <리졸브 프로젝트 이름>] [--json]
 *
 * ⚠️ 후반 셋(assemble·readback·render)은 DaVinci Resolve 가 «떠 있어야» 한다(외부 스크립팅 켜짐).
 *    안 떠 있으면 `app-silent` → 종단 `unobserved`(「못 쟀다」 — 실패가 아니다).
 *
 * 종료코드: 0 delivered · 1 그 밖의 종단(needs-human·blocked) · 2 «못 쟀다»(unobserved) · 3 준비 실패
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgv, type FlagKind } from './lib/argv.js';
import { FREE_LINE } from '../src/video-pipeline/recipes/free-line.js';
import { UPSTREAM } from '../src/video-pipeline/recipes/upstream.js';
import { VLOG } from '../src/video-pipeline/recipes/vlog.js';
import type { Recipe } from '../src/video-pipeline/recipes/types.js';
import { exitCodeOf, formatStep, loadWalker, walkLine, type GraphSpecLike } from '../src/video-pipeline/walk-line.js';
import { writeStdoutJson } from '../src/cli/stdout-json.js';

const KNOWN: Record<string, FlagKind> = {
  '--source': 'value', '--music': 'value', '--shots': 'value', '--out': 'value',
  '--whisper-model': 'value', '--project': 'value', '--json': 'bool',
};
const P = parseArgv(process.argv.slice(2), { known: KNOWN, label: 'video-vlog-line' });
if (P.errors.length > 0) { for (const e of P.errors) console.error(`⛔ ${e}`); process.exit(3); }
if (!P.values.source) { console.error('⛔ --source <영상 폴더> 가 필요하다'); process.exit(3); }

// ⛔ 순서가 뜻이다 — 같은 이름이 둘이면 뒤가 이긴다. vlog 레시피가 «이 선언»의 주인이다.
const RECIPES: Readonly<Record<string, Recipe>> = { ...UPSTREAM, ...FREE_LINE, ...VLOG };

const walker = await loadWalker();
if (!walker) { console.error('➖ 워커를 못 찾았다 — 「못 돌렸다」다. GRAPH_WALKER 로 경로를 줘라.'); process.exit(3); }

const DECL = 'graphs/video/vlog-found-footage-pipeline.declaration.yaml';
const { spec, error } = walker.readGraphSpec(DECL);
if (!spec) { console.error(`⛔ 선언을 못 읽었다: ${error}`); process.exit(3); }

const workdir = P.values.out ?? mkdtempSync(join(tmpdir(), 'vlogline-'));
mkdirSync(workdir, { recursive: true });
const state: Record<string, unknown> = {
  source_dir: resolve(P.values.source),
  ...(P.values.music ? { music: resolve(P.values.music) } : {}),
  ...(P.values.shots ? { shots_json: resolve(P.values.shots) } : {}),
  ...(P.values['whisper-model'] ? { whisper_model: P.values['whisper-model'] } : {}),
  project_name: P.values.project ?? `vlog_${new Date().toISOString().slice(0, 10)}`,
};
const quiet = P.flags.has('json');
const log = (event: string, data?: Record<string, unknown>): void => { if (!quiet) console.log(`     · ${event} ${data ? JSON.stringify(data) : ''}`); };

if (!quiet) {
  console.log(`\n🎥 브이로그 라인 — ${spec.graph_id} (노드 ${spec.nodes.length})`);
  console.log(`   소재 ${state.source_dir}${state.music ? ` · 음악 ${state.music}` : ' · 음악 없음'}`);
  console.log(`   작업 디렉토리 ${workdir}\n`);
}
const r = await walkLine({ spec: spec as GraphSpecLike, walker, state, workdir, recipes: RECIPES, maxSteps: 80, onStep: (row) => { if (!quiet) console.log(formatStep(row, 11)); } });
const { unknownRecipe, trace } = r;
const result = {
  terminal: r.terminal, stopReason: r.stopReason, steps: r.steps, path: r.path,
  workdir, project: state.project ?? null, timeline: state.timeline ?? null,
  master: state.master ?? null, deliverables: state.deliverables ?? null, review_sheet: state.review_sheet ?? null,
  unknownRecipe, trace,
};
if (quiet) await writeStdoutJson(JSON.stringify(result, null, 2) + '\n');
else {
  console.log(`\n═══ 종단 ${r.terminal ?? '(없음)'} · stop ${r.stopReason} · 걸음 ${r.steps} ═══`);
  console.log(`   ${result.path}`);
  if (state.project) console.log(`\n🎬 Resolve    «${state.project}» → 타임라인 «${state.timeline}»`);
  if (state.master) console.log(`🎞️  master     ${state.master}`);
  if (state.deliverables) console.log(`📦 납품       ${(state.deliverables as string[]).join(', ')}`);
  if (state.review_sheet) console.log(`📝 검수표     ${state.review_sheet}`);
  if (unknownRecipe) console.log(`\n⛔ 구현이 «없는» 레시피에서 멎었다: ${unknownRecipe}`);
}
process.exit(exitCodeOf(r.terminal));
