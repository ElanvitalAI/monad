#!/usr/bin/env bun
/**
 * 🎬 영상 제작 라인 «실물 주행» — `film-production-standard` 선언을 레시피로 «끝까지» 걷는다.
 *   준비 점검 → 카드 → 음악 → 마디 격자 → 소재 → 대응 관문 → 마스터 → 길이 관문 → 2패스 라우드니스
 *   → 3창 라우드니스 관문 → 잉크 자 → (전용 합성) → 소셜 3비율 → 접촉 시트 검수.
 *
 *   bun scripts/video-film-line.ts --plan <plan.json> --sources <sources.json> --track <음악> --bpm 128 [--out D] [--json]
 *     sources.json = { "<컷>": "<구운 소재 경로>", … }  ⊕ 선택: --native <native.json>({컷:{비율:경로}})
 *     ⊕ 선택: --hf-projects <json>({ "<컷>": "<HyperFrames 프로젝트 디렉토리>", … }) — --native 와 함께 줄 수 있다
 *
 * 종료코드: 0 delivered · 1 그 밖(master-only·blocked·host-blocked) · 2 «못 쟀다» · 3 준비 실패
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgv, type FlagKind, type ParsedArgv } from './lib/argv.js';
import { FILM } from '../src/video-pipeline/recipes/film.js';
import type { Recipe } from '../src/video-pipeline/recipes/types.js';
import { exitCodeOf, formatStep, loadWalker, walkLine, type GraphSpecLike } from '../src/video-pipeline/walk-line.js';
import { writeStdoutJson } from '../src/cli/stdout-json.js';

const KNOWN: Record<string, FlagKind> = {
  '--plan': 'value', '--sources': 'value', '--native': 'value', '--track': 'value', '--bpm': 'value',
  '--fps': 'value', '--logo-dir': 'value', '--out': 'value', '--target-lufs': 'value',
  '--hf-projects': 'value', '--json': 'bool',
};

/** `--hf-projects` JSON(`{컷: 프로젝트 디렉토리}`)을 읽어 각 경로를 절대경로로 바꾼다. 없거나 JSON 이 아니면 준비 실패. */
export function loadHyperframesProjects(file: string): { ok: true; projects: Record<string, string> } | { ok: false; reason: string } {
  const path = resolve(file);
  if (!existsSync(path)) return { ok: false, reason: `--hf-projects 파일이 없다: ${path}` };
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { ok: false, reason: `--hf-projects JSON 이 아니다: ${path} (${e instanceof Error ? e.message : String(e)})` }; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: `--hf-projects JSON 이 아니다: ${path} (객체 {"<컷>":"<디렉토리>"} 가 아니다)` };
  }
  const projects: Record<string, string> = {};
  for (const [cut, dir] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof dir !== 'string' || dir.trim() === '') {
      return { ok: false, reason: `--hf-projects '${cut}' 값이 디렉토리 경로가 아니다` };
    }
    projects[cut] = isAbsolute(dir) ? resolve(dir) : resolve(dirname(path), dir);
  }
  return { ok: true, projects };
}

/**
 * 기존 argv 조립 — `--plan` · `--sources` · `--native` · `--track` · `--bpm` · `--fps` · `--logo-dir` · `--target-lufs`
 * 와 `--hf-projects` 를 `state` 로만 싣는다. 호출자는 `assembleFilmLineState`.
 */
export function assembleFilmLineState(P: ParsedArgv): { ok: true; state: Record<string, unknown> } | { ok: false; reason: string } {
  if (!P.values.plan || !P.values.sources) return { ok: false, reason: '--plan 과 --sources 가 필요하다' };
  let shot_sources: unknown;
  let native_sources: unknown;
  try { shot_sources = JSON.parse(readFileSync(resolve(P.values.sources), 'utf8')); }
  catch (e) { return { ok: false, reason: `--sources JSON 이 아니다: ${e instanceof Error ? e.message : String(e)}` }; }
  if (P.values.native) {
    try { native_sources = JSON.parse(readFileSync(resolve(P.values.native), 'utf8')); }
    catch (e) { return { ok: false, reason: `--native JSON 이 아니다: ${e instanceof Error ? e.message : String(e)}` }; }
  }
  let hyperframes_projects: Record<string, string> | undefined;
  if (P.values['hf-projects']) {
    const loaded = loadHyperframesProjects(P.values['hf-projects']);
    if (!loaded.ok) return loaded;
    hyperframes_projects = loaded.projects;
  }
  const state: Record<string, unknown> = {
    plan: resolve(P.values.plan),
    shot_sources,
    ...(native_sources !== undefined ? { native_sources } : {}),
    ...(P.values.track ? { track_path: resolve(P.values.track) } : {}),
    ...(P.values.bpm ? { bpm: Number(P.values.bpm) } : {}),
    ...(P.values.fps ? { fps: Number(P.values.fps) } : {}),
    ...(P.values['logo-dir'] ? { logo_dir: resolve(P.values['logo-dir']) } : {}),
    ...(P.values['target-lufs'] ? { target_lufs: Number(P.values['target-lufs']) } : {}),
    ...(hyperframes_projects !== undefined ? { hyperframes_projects } : {}),
  };
  return { ok: true, state };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const P = parseArgv(process.argv.slice(2), { known: KNOWN, label: 'video-film-line' });
  if (P.errors.length > 0) { for (const e of P.errors) console.error(`⛔ ${e}`); process.exit(3); }
  const assembled = assembleFilmLineState(P);
  if (!assembled.ok) { console.error(`⛔ ${assembled.reason}`); process.exit(3); }

  const RECIPES: Readonly<Record<string, Recipe>> = FILM;
  const walker = await loadWalker();
  if (!walker) { console.error(`➖ 워커를 못 찾았다 — 「못 돌렸다」다. GRAPH_WALKER 로 경로를 줘라.`); process.exit(3); }
  const { spec, error } = walker.readGraphSpec('graphs/video/film-production-standard.yaml');
  if (!spec) { console.error(`⛔ 선언을 못 읽었다: ${error}`); process.exit(3); }

  const workdir = P.values.out ?? mkdtempSync(join(tmpdir(), 'filmline-'));
  mkdirSync(workdir, { recursive: true });
  const state = assembled.state;
  const quiet = P.flags.has('json');
  if (!quiet) console.log(`\n🎬 영상 제작 라인 — ${spec.graph_id} (노드 ${spec.nodes.length}) · 작업 ${workdir}\n`);
  const r = await walkLine({ spec: spec as GraphSpecLike, walker, state, workdir, recipes: RECIPES, maxSteps: 80, onStep: (row) => { if (!quiet) console.log(formatStep(row, 14)); } });
  const { unknownRecipe, trace } = r;
  const result = { terminal: r.terminal, stopReason: r.stopReason, steps: r.steps,
    path: r.path,
    workdir, master: state.master_path ?? null, mixed: state.mixed_path ?? null, social: state.social_paths ?? null, sheets: state.sheets ?? null, unknownRecipe, trace };
  if (quiet) await writeStdoutJson(JSON.stringify(result, null, 2) + '\n');
  else {
    console.log(`\n═══ 종단 ${r.terminal ?? '(없음)'} · stop ${r.stopReason} · 걸음 ${r.steps} ═══\n   ${result.path}`);
    if (state.mixed_path) console.log(`\n🎞️  마스터(믹스)  ${state.mixed_path}`);
    if (state.social_paths) console.log(`📱 소셜        ${(state.social_paths as string[]).join('\n               ')}`);
    if (unknownRecipe) console.log(`\n⛔ 구현이 «없는» 레시피에서 멎었다: ${unknownRecipe}`);
  }
  process.exit(exitCodeOf(r.terminal));
}
