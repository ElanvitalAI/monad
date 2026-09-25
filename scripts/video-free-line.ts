#!/usr/bin/env bun
/**
 * 🟢 무료 라인 «실물 주행» — ***선언이 몰고, 레시피가 진짜 ffmpeg 를 부르고, 영상 파일이 나온다.***
 *
 * ⛔⭐⭐ 이 스크립트가 답하는 것은 «하나»다:
 *   RFC 의 주장 ***「유료는 «가능/불가능»이 아니라 «품질·속도»를 산다」*** 가 참인가.
 *   ⇒ 참이려면 ***유료 앱이 0개인 기계에서 ground → delivered 가 끝까지 돌아야 한다.***
 *
 * 📏 쓰는 것: ffmpeg · ffprobe 뿐(둘 다 free). ⛔ 생성(metered)·GUI(owned) 은 «한 번도» 안 부른다.
 *
 * 돌리는 법:
 *   bun scripts/video-free-line.ts --source <이미지 디렉토리> [--out <작업디렉토리>]
 *   bun scripts/video-free-line.ts --synth 4        # 소재가 없으면 판을 «만들어» 돈다
 *
 * 종료코드: 0 delivered · 1 그 밖의 종단(needs-human·blocked) · 2 «못 쟀다»(unobserved) · 3 준비 실패
 *   ⛔ 2 와 1 을 섞지 않는다 — 「못 쟀다」는 실패가 «아니다»(이 파이프라인 종단이 넷인 이유).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgv, type FlagKind } from './lib/argv.js';
import { FREE_LINE, synthesizePlates } from '../src/video-pipeline/recipes/free-line.js';
import { UPSTREAM } from '../src/video-pipeline/recipes/upstream.js';
import type { Recipe } from '../src/video-pipeline/recipes/types.js';
import { exitCodeOf, formatStep, loadWalker, walkLine, type GraphSpecLike } from '../src/video-pipeline/walk-line.js';
import { writeStdoutJson } from '../src/cli/stdout-json.js';

const KNOWN: Record<string, FlagKind> = {
  '--source': 'value', '--out': 'value', '--synth': 'value', '--captions': 'value',
  '--specs': 'value', '--voice': 'value', '--pad': 'value', '--no-backdrop': 'bool',
  '--scene': 'value', '--json': 'bool', '--deliver-crop': 'bool',
};
const P = parseArgv(process.argv.slice(2), { known: KNOWN, label: 'video-free-line' });
if (P.errors.length > 0) { for (const e of P.errors) console.error(`⛔ ${e}`); process.exit(3); }

const RECIPES: Readonly<Record<string, Recipe>> = { ...UPSTREAM, ...FREE_LINE };

// ⛔ 「워커가 없어서 못 돌렸다」를 «실패»로도 «통과»로도 읽지 않는다.
const walker = await loadWalker();
if (!walker) { console.error('➖ 워커를 못 찾았다 — 「못 돌렸다」다. GRAPH_WALKER 로 경로를 줘라.'); process.exit(3); }

const DECL = 'graphs/video/video-production-pipeline.declaration.yaml';
const { spec, error } = walker.readGraphSpec(DECL);
if (!spec) { console.error(`⛔ 선언을 못 읽었다: ${error}`); process.exit(3); }

// ── 작업 디렉토리 — ⛔ 모든 쓰기는 여기 «안»이다 ──
const workdir = P.values.out ?? mkdtempSync(join(tmpdir(), 'freeline-'));
mkdirSync(workdir, { recursive: true });

// ⛔⭐ 종합 러너가 낸 `scene.json` 을 «그대로» 받는다.
//   🩸 종전엔 종합 러너가 «명령을 찍어 주고» 사람이 다시 쳤다 — 그 한 단계가 «손»이었다.
//   🔑 ***파이프라인이 「다음에 이걸 치세요」라고 말하면, 그 자리는 아직 안 이어진 것이다.***
interface SceneOut {
  images?: string[]; vo?: string | null; vo_srt?: string | null; music?: string | null;
  captions?: string[]; specs?: string[]; provenance?: Record<string, unknown>;
}
let scene: SceneOut | null = null;
if (P.values.scene !== undefined) {
  if (!existsSync(P.values.scene)) { console.error(`⛔ --scene '${P.values.scene}' 가 없다`); process.exit(3); }
  try { scene = JSON.parse(readFileSync(P.values.scene, 'utf8')) as SceneOut; }
  catch (e) { console.error(`⛔ scene.json 을 못 읽었다: ${(e as Error).message}`); process.exit(3); }
}

// ── 소재 ──
let sourceDir = P.values.source;
let sourceWhy = sourceDir ? `사람이 준 디렉토리: ${sourceDir}` : '';
if (P.values.synth !== undefined) {
  const n = Number(P.values.synth);
  if (!Number.isInteger(n) || n < 2) { console.error('⛔ --synth 는 2 이상의 정수다'); process.exit(3); }
  const dir = join(workdir, 'source');
  const s = synthesizePlates(dir, n);
  if (!s.paths) { console.error(`⛔ ${s.why}`); process.exit(3); }
  sourceDir = dir; sourceWhy = s.why;
}
if (scene?.images?.length) {
  // scene.json 의 소재는 «절대 경로 목록»이다 — 그 부모를 소재 디렉터리로 삼는다.
  sourceDir = join(scene.images[0]!, '..');
  sourceWhy = `종합 러너가 «생성»한 소재 ${scene.images.length}장`;
  // ⛔⭐⭐ ***목록인데 「첫 칸의 부모」만 쓴다*** — 다른 디렉터리의 항목은 «조용히» 사라진다.
  //   🩸 실측 2026-09-22: Affinity 로 만든 엔드카드를 목록 «끝»에 넣었더니 ***그냥 안 들어갔다.***
  //     종단은 delivered 였고 검수도 pass 였다 — ***아무도 「한 장이 빠졌다」고 말하지 않았다.***
  //   🔑 ***「목록을 받는다」와 「목록을 «읽는다»」는 다른 값이다.***
  //   ⇒ 고치는 대신 «말하게» 한다 — 디렉터리 축은 이 축의 설계(소재는 «폴더»로 온다)이고,
  //     여기서 목록을 그대로 쓰면 컷 순서·중복 규칙이 통째로 갈린다(별건이다).
  const strays = scene.images.filter((f) => join(f, '..') !== sourceDir);
  if (strays.length > 0) {
    console.error(`⛔ scene.images 에 «다른 디렉터리» 항목이 ${strays.length}개 있다 —`
      + ` 이 축은 «첫 칸의 부모 폴더»를 읽으므로 그것들은 «안 들어간다».`);
    for (const f of strays.slice(0, 3)) console.error(`   ↳ ${f}`);
    console.error(`   ⇒ 같은 폴더(${sourceDir})로 «옮겨서» 주거나, --source 로 그 폴더를 직접 대라.`);
    process.exit(3);
  }
}
if (!sourceDir || !existsSync(sourceDir)) {
  console.error('⛔ --source <디렉토리> · --synth <개수> · --scene <scene.json> 중 하나가 필요하다');
  process.exit(3);
}

const captions = P.values.captions !== undefined
  ? P.values.captions.split('|').map((s) => s.trim()).filter(Boolean)
  : (scene?.captions ?? []);

// ⛔⭐ 출처 — 「만든 소재」를 「찍은 소재」로 위장하지 않는다(이 저장소의 상시 규율).
const provenance = { source_dir: sourceDir, synthesized: P.values.synth !== undefined, why: sourceWhy };

// ⛔ 납품 규격은 «사람이 정한다» — 기본을 두되 그것이 «기본»임을 산출이 말한다.
const specs = (P.values.specs ?? scene?.specs?.join(',') ?? '1080x1920,1080x1080')
  .split(',').map((s) => s.trim()).filter(Boolean);
const state: Record<string, unknown> = {
  source_dir: sourceDir, captions, seconds_per_cut: Number(P.values['seconds-per-cut'] ?? 2.5), target_specs: specs,
  voice: P.values.voice ?? '', line_pad: Number(P.values.pad ?? 0.45),
  backdrop: !P.flags.has('no-backdrop'),
  // ⭐ 종합 러너가 «이미 만든» 나레이션·음악이 있으면 그것을 쓴다 — 다시 만들지 않는다.
  // ⛔⭐ 「잘라 채우기」는 ***명시해야만*** 켜진다 — 기본은 «맞춰 넣기»다(자막이 안 잘린다).
  //   🩸 이 칸을 만든 판에서 나는 «쓰는 자»를 안 만들었다. 주석은 `--deliver-crop` 이라 적어 놓고
  //      플래그가 «없어서» 그 갈래는 ***원리상 도달 불가***였다.
  //      ⇒ 🔑 오늘 세 번째 같은 모양이다 — 「칸을 만든 것」과 「그 칸에 닿는 길이 있다」는 다른 값.
  deliver_crop: P.flags.has('deliver-crop'),
  pregenerated_vo: scene?.vo ?? null,
  pregenerated_music: scene?.music ?? null,
  vo_srt: scene?.vo_srt ?? null,
};
const log = (event: string, data?: Record<string, unknown>): void => {
  if (!P.flags.has('json')) console.log(`     · ${event} ${data ? JSON.stringify(data) : ''}`);
};

if (!P.flags.has('json')) {
  console.log(`\n🟢 무료 라인 — ${spec.graph_id} (노드 ${spec.nodes.length})`);
  console.log(`   작업 디렉토리 ${workdir}`);
  console.log(`   소재 ${provenance.synthesized ? '⚠️ ' : ''}${provenance.why}`);
  console.log(`   납품 규격 ${specs.join(' · ')}${P.values.specs ? '' : ' (기본값 — --specs 로 바꾼다)'}\n`);
}

// ⛔⭐ 걷는 규칙은 `walk-line.ts` 한 벌이다. 🩸 2026-09-23: 이 파일의 복사본은 「못 쟀다」를 «날것»으로 넘겼고,
//   그것을 받는 간선이 없는 노드 여섯(ground·assets·audio·compose·overlay·render)에서 걷는 자가 `no-edge` 로 죽었다
//   (재현: overlay 가 「한글 폰트 없음」으로 unmeasurable → 종단 없음 · stop no-edge). 이제 `unobserved` 로 간다.
const r = await walkLine({ spec: spec as GraphSpecLike, walker, state, workdir, recipes: RECIPES, maxSteps: 80, log,
  onStep: (row) => { if (!P.flags.has('json')) console.log(formatStep(row, 11)); } });
const { unknownRecipe } = r;

const result = {
  terminal: r.terminal, stopReason: r.stopReason, steps: r.steps,
  path: r.path,
  provenance, target_specs: specs,
  master: state.master ?? null, deliverables: state.deliverables ?? null,
  dur: state.dur ?? null, target_dur: state.target_dur ?? null,
  unknownRecipe,
};
// ⛔⭐⭐ ***`console.log(JSON.stringify(...))` 는 바이트를 «잃을 수 있다».***
//   프로세스가 끝나면서 stdout 이 다 비워지기 «전»에 나갈 수 있고, 그러면
//   ***기계가 읽는 계약이 「잘린 JSON」으로 도착한다*** — 그리고 그것은 「빈 산출」처럼 보인다.
//   ⇒ `writeStdoutJson` 은 «다 쓸 때까지» 기다린다.
// 🩸 2026-09-22: 이 규칙의 게이트(`ci-stdout-json-gate`)가 «있었는데 아무 데도 안 걸려 있었다»
//   (🅢 보고 · #19747). 그래서 내 PR 이 4건을 이고 있었고 ***나는 몰랐다.***
//   🔑 ***「관문이 있다」와 「그 관문이 «불린다»」는 다른 값이다.***
if (P.flags.has('json')) { await writeStdoutJson(JSON.stringify(result, null, 2) + '\n'); }
else {
  console.log(`\n═══ 종단 ${r.terminal ?? '(없음)'} · stop ${r.stopReason} · 걸음 ${r.steps} ═══`);
  console.log(`   ${result.path}`);
  if (state.master) console.log(`\n🎬 master      ${state.master}`);
  if (state.deliverables) console.log(`📦 deliverables ${(state.deliverables as string[]).join('\n                ')}`);
  if (unknownRecipe) console.log(`\n⛔ 구현이 «없는» 레시피에서 멎었다: ${unknownRecipe}`);
}

// ⛔ 「못 쟀다」(2)와 「실패」(1)를 섞지 않는다.
process.exit(exitCodeOf(r.terminal));
