#!/usr/bin/env bun
/**
 * 🧑‍🎨 캐릭터 → 영상 라인 «실물 주행» — `character-video-standard` 를 레시피로 끝까지 걷는다.
 *   핀 → 시트 → 칸 관문 → 뷰 → 등록 → 정체성 관문 → 샷 → 연출 관문 → 잉크 자 → 편집(마스터 ⊕ 소셜).
 *
 * ⛔ 이 러너는 Higgsfield 크레딧을 «안 쓴다» — 시트·뷰·등록·샷은 «이미 생성된 것»을 받는다.
 * ⛔ 눈이 봐야 하는 판정 둘은 `--told` 로 준다(잰 값이 아니라고 산출이 말한다):
 *     --told identity_holds=1,shots_principled=1
 *
 *   bun scripts/video-character-line.ts --pins D --sheet P --views D --element-id ID [--soul-fail R] [--probe P]
 *     --shots <sources.json> --plan <plan.json> --audio <음악> [--shot-ruler <08_shot_ruler.py>] [--told k=v,…]
 */
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgv, type FlagKind } from './lib/argv.js';
import { CHARACTER } from '../src/video-pipeline/recipes/character.js';
import { exitCodeOf, formatStep, loadWalker, walkLine, type GraphSpecLike } from '../src/video-pipeline/walk-line.js';

const KNOWN: Record<string, FlagKind> = {
  '--pins': 'value', '--sheet': 'value', '--views': 'value', '--element-id': 'value', '--soul-fail': 'value', '--probe': 'value',
  '--shots': 'value', '--plan': 'value', '--audio': 'value', '--shot-ruler': 'value', '--told': 'value', '--native': 'value', '--fps': 'value', '--out': 'value',
};
const P = parseArgv(process.argv.slice(2), { known: KNOWN, label: 'video-character-line' });
if (P.errors.length > 0) { for (const e of P.errors) console.error(`⛔ ${e}`); process.exit(3); }
const walker = await loadWalker();
if (!walker) { console.error('➖ 워커를 못 찾았다 — GRAPH_WALKER 로 경로를 줘라.'); process.exit(3); }
const { spec, error } = walker.readGraphSpec('graphs/video/character-video-standard.yaml');
if (!spec) { console.error(`⛔ 선언을 못 읽었다: ${error}`); process.exit(3); }

const told: Record<string, number> = {};
for (const kv of (P.values.told ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
  const [k, v] = kv.split('='); if (!k || v === undefined || !Number.isFinite(Number(v))) { console.error(`⛔ --told 는 key=수 꼴: ${kv}`); process.exit(3); }
  told[k] = Number(v);
}
const workdir = P.values.out ?? mkdtempSync(join(tmpdir(), 'charline-'));
mkdirSync(workdir, { recursive: true });
const r = (k: string) => (P.values[k] ? resolve(P.values[k]!) : undefined);
const state: Record<string, unknown> = {
  pins_dir: r('pins'), sheet_path: r('sheet'), views_dir: r('views'),
  element_id: P.values['element-id'], soul_fail_reason: P.values['soul-fail'], probe_image: r('probe'),
  shot_sources: P.values.shots ? JSON.parse(readFileSync(resolve(P.values.shots), 'utf8')) : undefined,
  // --native <json> = { <샷 이름>: { <비율 키 9x16|4x5|1x1>: <그 비율로 «다시 그린» 파일> } } — 리프레임 자가 이것이 있으면 되돌리지 않는다.
  native_sources: P.values.native ? JSON.parse(readFileSync(resolve(P.values.native), 'utf8')) : undefined,
  plan: r('plan'), audio: r('audio'), shot_ruler: r('shot-ruler'), fps: Number(P.values.fps ?? 24), told,
};
console.log(`\n🧑‍🎨 캐릭터 라인 — ${spec.graph_id} · 작업 ${workdir}${Object.keys(told).length ? ` · 🗣️ 말해 준 사실 ${JSON.stringify(told)}` : ''}\n`);
const w = await walkLine({ spec: spec as GraphSpecLike, walker, state, workdir, recipes: CHARACTER, maxSteps: 60, onStep: (row) => console.log(formatStep(row)) });
console.log(`\n═══ 종단 ${w.terminal ?? '(없음)'} · stop ${w.stopReason} · 걸음 ${w.steps} ═══\n   ${w.path}`);
if (w.unknownRecipe) console.log(`\n⛔ 구현이 «없는» 레시피에서 멎었다: ${w.unknownRecipe}`);
if (state.master) console.log(`\n🎞️  마스터 ${state.master}\n📱 소셜   ${(state.social_paths as string[] | undefined)?.join('\n         ') ?? '-'}`);
process.exit(exitCodeOf(w.terminal));
