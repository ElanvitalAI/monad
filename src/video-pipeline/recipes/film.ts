/**
 * 🎬 대본 기반 영상 제작 레시피 — `film-production-standard.yaml` 의 «코드» 쪽.
 *
 * ⭐ 출처 — 2026-09-17 DaVinciStack_Kinetic `03_프로젝트/build.py`(마스터·소셜 3비율을 짓던 한 벌)의 «잰» 규칙.
 *   그 파일은 경로·컷 이름이 박혀 있었다 ⇒ 여기서는 ***원장(plan)·소재 표·비율을 `ctx.state` 로만*** 받는다.
 *
 * ⛔ 소재 «생성»(AE·HyperFrames·Blender)은 프로젝트마다 다르다 — 이 레시피들은 ***이미 구운 소재를 받는다***
 *   (`state.shot_sources`). 없으면 «없다»고 말한다(vlog 원장과 같은 규율: 사람이 준 것이 SSOT).
 * ⛔ 음악(Epidemic)은 MCP 로만 받는다 — 이 러너에선 못 부른다. 받아서 `state.track_path` 로 준다.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { ffmpeg, probeDuration, run, type RunResult } from './ffmpeg.js';
import { renderProjectAtSize } from './hyperframes.js';
import { UNOBSERVED, type Recipe } from './types.js';
import { resolvePing } from './vlog.js';
import { measureFocusPeaks, type FocusMeasurement } from './focus.js';

export type PlanRow = readonly [cut: string, start: number, dur: number];
export interface Target { readonly key: string; readonly name: string; readonly w: number; readonly h: number; readonly cy: number }
export interface Ink { L: number; R: number; cx: number; frames?: number; note?: string }

export const DEFAULT_TARGETS: readonly Target[] = [
  { key: '1x1', name: 'linkedin_1x1', w: 1080, h: 1080, cy: 0.5 },
  { key: '9x16', name: 'reels_9x16', w: 1080, h: 1920, cy: 0.44 },
  { key: '4x5', name: 'ig_feed_4x5', w: 1080, h: 1350, cy: 0.48 },
];

const need = (key: string) => ({ outcome: UNOBSERVED, note: `계약 입력 '${key}' 가 state 에 없다 — 앞 노드가 안 채웠다(실패가 «아니다»)` });

export function planOf(state: Readonly<Record<string, unknown>>): PlanRow[] | null {
  const p = state.plan as PlanRow[] | string | undefined;
  if (Array.isArray(p)) return p;
  if (typeof p === 'string' && existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')) as PlanRow[];
  return null;
}

function whd(path: string): { w: number; h: number; d: number } | null {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path]);
  try { const j = JSON.parse(r.out); return { w: j.streams[0].width, h: j.streams[0].height, d: Number(j.format.duration) }; } catch { return null; }
}

// ── preflight · host-and-ruler-preflight ─────────────────────────────────
/** ⛔ 「앱이 안 떴다」는 실패가 아니다(host-blocked). 소재가 구워져 있고 라우드니스 자가 «돌아야» 준비다. */
export const hostAndRulerPreflight: Recipe = async (ctx) => {
  const plan = planOf(ctx.state);
  const src = ctx.state.shot_sources as Record<string, string> | undefined;
  // 라우드니스 자 — 1초 사인파에 ebur128 을 눌러 «값이 나오나». 안 나오면 이 기계에선 못 잰다.
  const probe = run('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'sine=f=1000:d=1', '-af', 'ebur128', '-f', 'null', '-']);
  const loudness_ruler_ok = /I:\s+-?[\d.]+ LUFS/.test(probe.err);
  const missing = plan && src ? plan.filter(([c]) => !src[c] || !existsSync(src[c]!)).map(([c]) => c) : null;
  const asset_plates_baked = missing !== null && missing.length === 0;
  // ⭐ 조립 엔진은 build.py 와 같은 ffmpeg 라 Resolve 가 «없어도» 막지 않는다 — 다만 «잰다»(🩸 종전엔 늘 null 이었다:
  //   선언이 출력으로 약속한 값을 한 번도 안 채웠다). ⛔ ae_can_write 는 여전히 «안 쟀다»(null) — 그렇다고 note 가 말한다.
  const ping = resolvePing();
  const produced = { resolve_attached: ping.attached, resolve_version: ping.version, ae_can_write: null, loudness_ruler_ok, asset_plates_baked };
  const hostNote = ping.attached === true ? `Resolve ${ping.version} 붙음` : ping.attached === false ? `Resolve 안 붙음(${ping.why?.slice(0, 60)})` : 'Resolve «못 물어봤다»';
  if (!loudness_ruler_ok) return { outcome: UNOBSERVED, produced, note: 'ebur128 자가 값을 안 낸다 — 라우드니스를 못 잰다' };
  if (!plan || !src) return { outcome: 'host-down', produced, note: '원장(plan)이나 소재 표(shot_sources)가 없다 — 소재를 굽는 앱(AE·HyperFrames·Blender) 쪽이 먼저다' };
  if (missing!.length > 0) return { outcome: 'host-down', produced, note: `안 구운 소재 ${missing!.length}: ${missing!.join(', ')} — 굽는 앱이 필요하다` };
  return { outcome: 'ready', produced, note: `원장 ${plan.length}컷 · 소재 전부 있음 · 라우드니스 자 OK · ${hostNote} · ⚠️ AE 쓰기는 안 쟀다` };
};

// ── assets · prepare-source-plates ───────────────────────────────────────
/** 로고·아이콘 → 1024 정사각 카드(make_icon_cards 의 일). 폴더가 없으면 «필요 없다»로 통과. */
export const prepareSourcePlates: Recipe = async (ctx) => {
  const dir = ctx.state.logo_dir as string | undefined;
  if (!dir) return { outcome: 'ok', produced: { plate_kinds: [], card_paths: [] }, note: '로고 폴더 없음 — 카드가 필요 없는 원장이다' };
  if (!existsSync(dir)) return { outcome: 'error', note: `logo_dir 이 없다: ${dir}` };
  const out = join(ctx.workdir, 'cards');
  mkdirSync(out, { recursive: true });
  const imgs = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));
  const card_paths: string[] = [];
  for (const f of imgs) {
    const dst = join(out, f.replace(/\.[^.]+$/, '.png'));
    const r = ffmpeg(['-i', join(dir, f), '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba', dst]);
    if (!r.ok) return { outcome: 'error', note: `카드 실패(${f}): ${r.err.slice(-160)}` };
    card_paths.push(dst);
  }
  return { outcome: 'ok', produced: { plate_kinds: [...new Set(imgs.map((f) => f.split('.').pop()!.toLowerCase()))], card_paths }, note: `카드 ${card_paths.length}장(1024)` };
};

// ── music · epidemic-mcp-fetch ────────────────────────────────────────────
/** `(bin, args, timeoutMs, cwd?, env?) => RunResult`. 시험은 이 자리를 가짜로 바꾼다 — 진짜 `npx` 를 안 부른다. */
export type BeatsRunner = (
  bin: string,
  args: readonly string[],
  timeoutMs: number,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
) => RunResult;

const BEATS_MS = 180_000;
/** 렌더와 같다 — 스킬 레지스트리를 묻지 않고 익명 텔레메트리를 보내지 않는다. */
const BEATS_CHILD_ENV: Readonly<Record<string, string>> = {
  HYPERFRAMES_SKIP_SKILLS: '1',
  HYPERFRAMES_NO_TELEMETRY: '1',
};

function beatsRunnerOf(state: Readonly<Record<string, unknown>>): BeatsRunner {
  const injected = state.beats_run;
  if (typeof injected === 'function') return injected as BeatsRunner;
  return (bin, args, timeoutMs, cwd, env) => {
    const r = spawnSync(bin, [...args], { encoding: 'utf8', timeout: timeoutMs, env, ...(cwd ? { cwd } : {}) });
    return { ok: r.status === 0, code: r.status, signal: r.signal ?? null, err: (r.stderr ?? '').trim(), out: (r.stdout ?? '').trim() };
  };
}

/** 양의 유한수만 BPM 이다. 0·음수·NaN·Infinity 는 «못 쟀다» — 추정값을 지어내지 않는다. */
function positiveBpm(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface BeatsMeasure {
  readonly bpm: number | null;
  readonly beats_path: string | null;
  readonly reason: string | null;
}

/**
 * `workdir` 안에 `track_path` 를 `<audio id="bgm">` 로 단 최소 HyperFrames 프로젝트를 만들고
 * `npx hyperframes beats --json` 을 부른다. bpm 이 양의 유한수일 때만 bpm·beats_path 를 돌려준다.
 * ⛔ `epidemicMcpFetch` 만 부른다 — 이 함수가 스스로 그 레시피를 부르지 않는다.
 */
export async function measureBpmWithHyperframesBeats(
  workdir: string,
  trackPath: string,
  runBeats: BeatsRunner,
): Promise<BeatsMeasure> {
  const project = join(workdir, 'beats-project');
  mkdirSync(project, { recursive: true });
  // ⛔ 음악을 프로젝트 «안»으로 복사해 파일 이름으로 단다 — `hyperframes beats` 는 프로젝트 밖 상대경로를 못 찾는다.
  //   🩸 2026-09-23(#20065 착지 직후 실물 · npx v0.8.64): `../../click96.wav` 로 달자 `Audio file not found: click96.wav` · rc 1.
  const src = `bgm${extname(trackPath) || '.wav'}`;
  try {
    copyFileSync(resolve(trackPath), join(project, src));
  } catch (e) {
    return { bpm: null, beats_path: null, reason: `음악을 프로젝트로 못 옮겼다: ${e instanceof Error ? e.message : String(e)}` };
  }
  writeFileSync(join(project, 'index.html'), [
    '<!doctype html>',
    '<html>',
    '<body>',
    `<div data-composition-id="root" data-width="1920" data-height="1080" data-duration="8">`,
    `<audio id="bgm" src="${src}" data-start="0"></audio>`,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n'));
  const env = { ...process.env, ...BEATS_CHILD_ENV };
  let ran: RunResult;
  try {
    ran = runBeats('npx', ['hyperframes', 'beats', '--json'], BEATS_MS, project, env);
  } catch (e) {
    return { bpm: null, beats_path: null, reason: `beats 를 못 불렀다: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (ran.signal !== null || (ran.code === null && !ran.ok)) {
    return { bpm: null, beats_path: null, reason: `beats 를 못 불렀다${ran.signal ? `(${ran.signal})` : ''}` };
  }
  if (!ran.ok) {
    const why = (ran.err || ran.out).split('\n')[0]?.slice(0, 160) || `rc ${ran.code ?? 1}`;
    return { bpm: null, beats_path: null, reason: `beats 실패(rc ${ran.code ?? 1}): ${why}` };
  }
  let parsed: { ok?: unknown; bpm?: unknown; file?: unknown };
  try {
    parsed = JSON.parse(ran.out) as { ok?: unknown; bpm?: unknown; file?: unknown };
  } catch {
    return { bpm: null, beats_path: null, reason: 'beats JSON 을 못 읽었다' };
  }
  if (parsed.ok !== true) return { bpm: null, beats_path: null, reason: 'beats 가 ok 가 아니다' };
  const bpm = positiveBpm(parsed.bpm);
  if (bpm === null) return { bpm: null, beats_path: null, reason: `beats bpm 이 양의 유한수가 아니다(${String(parsed.bpm)})` };
  const file = typeof parsed.file === 'string' && parsed.file.length > 0 ? parsed.file : null;
  return { bpm, beats_path: file, reason: null };
}

export const epidemicMcpFetch: Recipe = async (ctx) => {
  const track = ctx.state.track_path as string | undefined;
  if (!track || !existsSync(track)) {
    return { outcome: 'no-track', note: '음악이 없다 — ⛔ Epidemic 은 MCP 로만 받는다(이 러너는 못 부른다). Claude 세션에서 받아 --track 으로 준다' };
  }
  const given = positiveBpm(ctx.state.bpm);
  if (given !== null) {
    const bar_seconds = (60 / given) * 4;
    return {
      outcome: 'ok',
      produced: { track_path: track, bpm: given, bar_seconds, bpm_source: 'state', beats_path: null },
      note: `음악 ${track.split('/').pop()} · ${given}BPM · 1마디 ${bar_seconds.toFixed(3)}s · bpm_source state`,
    };
  }
  const measured = await measureBpmWithHyperframesBeats(ctx.workdir, track, beatsRunnerOf(ctx.state));
  if (measured.bpm === null) {
    return {
      outcome: 'ok',
      produced: { track_path: track, bpm: null, bar_seconds: null, bpm_source: null, beats_path: null },
      note: `음악 ${track.split('/').pop()} · ⚠️ BPM 모름${measured.reason ? ` — ${measured.reason}` : ''}`,
    };
  }
  const bar_seconds = (60 / measured.bpm) * 4;
  return {
    outcome: 'ok',
    produced: {
      track_path: track,
      bpm: measured.bpm,
      bar_seconds,
      bpm_source: 'hyperframes-beats',
      beats_path: measured.beats_path,
    },
    note: `음악 ${track.split('/').pop()} · ${measured.bpm}BPM · 1마디 ${bar_seconds.toFixed(3)}s · bpm_source hyperframes-beats`,
  };
};

// ── barsnap · bar-grid-gate ───────────────────────────────────────────────
/**
 * ⛔ 컷 길이는 «마디»에 맞아야 한다 — 하나가 어긋나면 그 뒤 전 컷이 음악에서 밀린다(DaVinciStack 실측).
 * ⭐ off-grid 면 «고쳐서» 원장을 다시 낸다 — 선언의 off-grid→barsnap 되돌이가 두 번째 방문에서 snapped 가 되게.
 */
export const barGridGate: Recipe = async (ctx) => {
  const plan = planOf(ctx.state);
  const bpm = ctx.state.bpm as number | null | undefined;
  if (!bpm) return { outcome: 'no-bpm', note: 'BPM 을 모른다 — 마디 격자를 못 그린다' };
  if (!plan) return need('plan');
  const bar = (60 / bpm) * 4;
  const off = plan.filter(([, , d]) => Math.abs(d / bar - Math.round(d / bar)) > 0.02);
  const bars_total = +plan.reduce((a, [, , d]) => a + d / bar, 0).toFixed(3);
  if (off.length === 0) return { outcome: 'snapped', produced: { bars_total, off_grid_cuts: [] }, note: `${plan.length}컷 전부 마디 위 · 총 ${bars_total}마디` };
  let t = 0;
  const snapped: PlanRow[] = plan.map(([c, , d]) => { const nd = Math.max(1, Math.round(d / bar)) * bar; const row: PlanRow = [c, +t.toFixed(4), +nd.toFixed(4)]; t += nd; return row; });
  return { outcome: 'off-grid', produced: { plan: snapped, off_grid_cuts: off.map(([c]) => c), bars_total }, note: `마디 밖 ${off.length}컷(${off.map(([c]) => c).join(', ')}) — 마디에 붙여 원장을 다시 냈다` };
};

// ── generate · produce-shots ──────────────────────────────────────────────
export const produceShots: Recipe = async (ctx) => {
  const plan = planOf(ctx.state);
  const src = ctx.state.shot_sources as Record<string, string> | undefined;
  if (!plan) return need('plan');
  if (!src) return need('shot_sources');
  const shot_paths = plan.map(([c]) => src[c]).filter((p): p is string => Boolean(p) && existsSync(p!));
  const produced = { shot_paths, typo_count: shot_paths.length, cut_count: plan.length };
  if (shot_paths.length === 0) return { outcome: 'error', produced, note: '구운 소재가 0' };
  return { outcome: 'ok', produced, note: `소재 ${shot_paths.length}/${plan.length} — ⚠️ «생성»이 아니라 이미 구운 소재를 받았다(AE·HyperFrames·Blender 쪽이 만든다)` };
};

export const typoCutParityGate: Recipe = async (ctx) => {
  const t = Number(ctx.state.typo_count), c = Number(ctx.state.cut_count);
  if (!Number.isFinite(t) || !Number.isFinite(c)) return need('typo_count');
  const plan = planOf(ctx.state) ?? [];
  const src = (ctx.state.shot_sources as Record<string, string> | undefined) ?? {};
  const missing_cuts = plan.filter(([k]) => !src[k] || !existsSync(src[k]!)).map(([k]) => k);
  return t === c ? { outcome: 'parity', produced: { parity: true, missing_cuts }, note: `소재 ${t} = 컷 ${c}` }
    : { outcome: 'gap', produced: { parity: false, missing_cuts }, note: `소재 ${t} ≠ 컷 ${c} — 빠진 컷 ${missing_cuts.join(', ')}` };
};

/** 소재가 슬롯보다 짧으면 «살짝» 늦춘다 — 느린 궤도 샷이라 7% 는 안 보인다(build.py). */
export const stretchOf = (dSrc: number, dSlot: number, fps: number): number => (dSrc < dSlot - 1 / fps ? dSlot / dSrc : 1.0);

// ── assemble · assemble-master ────────────────────────────────────────────
export const assembleMaster: Recipe = async (ctx) => {
  const plan = planOf(ctx.state);
  const src = ctx.state.shot_sources as Record<string, string> | undefined;
  const track = ctx.state.track_path as string | undefined;
  if (!plan) return need('plan');
  if (!src) return need('shot_sources');
  const FPS = Number(ctx.state.fps ?? 24);
  const ins: string[] = [], parts: string[] = [], labels: string[] = [];
  plan.forEach(([c, , dur], i) => {
    const p = src[c]!; const m = whd(p);
    const d0 = m?.d ?? dur; const sp = stretchOf(d0, dur, FPS);
    ins.push('-i', p);
    parts.push(`[${i}:v]trim=0:${sp > 1 ? d0 : dur},setpts=PTS-STARTPTS${sp > 1 ? `,setpts=${sp.toFixed(6)}*PTS` : ''},fps=${FPS},scale=1920:1080,setsar=1,trim=0:${dur},setpts=PTS-STARTPTS[v${i}]`);
    labels.push(`[v${i}]`);
  });
  parts.push(`${labels.join('')}concat=n=${plan.length}:v=1:a=0[vout]`);
  const out = join(ctx.workdir, 'master');
  mkdirSync(out, { recursive: true });
  const master_path = join(out, 'master_16x9.mp4');
  const args = [...ins, ...(track ? ['-i', track] : []), '-filter_complex', parts.join(';'), '-map', '[vout]', ...(track ? ['-map', `${plan.length}:a`, '-shortest', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-r', String(FPS), '-movflags', '+faststart', master_path];
  const r = ffmpeg(args, 1_200_000);
  if (!r.ok) return { outcome: 'error', note: `마스터 실패: ${r.err.slice(-200)}` };
  return { outcome: 'ok', produced: { master_path, engine: 'ffmpeg', expected_seconds: +plan.reduce((a, [, , d]) => a + d, 0).toFixed(4) }, note: `마스터 1920×1080 · ${plan.length}컷` };
};

// ── assemble-gate · master-span-gate ──────────────────────────────────────
export const masterSpanGate: Recipe = async (ctx) => {
  const m = ctx.state.master_path as string | undefined;
  const expected = Number(ctx.state.expected_seconds);
  if (!m) return need('master_path');
  const p = probeDuration(m);
  if (p.dur === null) return { outcome: 'unreadable', note: `마스터 길이를 못 읽었다: ${p.why ?? ''}` };
  const fps = Number(ctx.state.fps ?? 24);
  const ok = Number.isFinite(expected) && Math.abs(p.dur - expected) <= 1.5 / fps;
  return ok ? { outcome: 'spans', produced: { measured_seconds: +p.dur.toFixed(3), span_ok: true }, note: `실측 ${p.dur.toFixed(3)}s = 원장 ${expected.toFixed(3)}s` }
    : { outcome: 'empty-range', produced: { measured_seconds: +p.dur.toFixed(3), span_ok: false }, note: `실측 ${p.dur.toFixed(3)}s ≠ 원장 ${expected}s` };
};

// ── mix · two-pass-normalize-and-duck ─────────────────────────────────────
/** 라우드니스 «두 번»(측정 → 맞춤). 나레이션이 있으면 음악을 그 밑으로 누른다. 목표는 state.target_lufs(기본 −14). */
export const twoPassNormalizeAndDuck: Recipe = async (ctx) => {
  const m = ctx.state.master_path as string | undefined;
  if (!m) return need('master_path');
  const target = Number(ctx.state.target_lufs ?? -14);
  const vo = (ctx.state.narration_paths as string[] | undefined)?.find(existsSync);
  const out = join(ctx.workdir, 'mix');
  mkdirSync(out, { recursive: true });
  let src = m;
  if (vo) {
    const ducked = join(out, 'ducked.mp4');
    const r = ffmpeg(['-i', m, '-i', vo, '-filter_complex',
      '[0:a][1:a]sidechaincompress=threshold=0.045:ratio=9:attack=8:release=460[mus];[mus][1:a]amix=inputs=2:duration=first:normalize=0[a]',
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', ducked], 900_000);
    if (!r.ok) return { outcome: 'error', note: `더킹 실패: ${r.err.slice(-160)}` };
    src = ducked;
  }
  const p1 = run('ffmpeg', ['-hide_banner', '-i', src, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-'], 900_000);
  const j = /\{[\s\S]*"input_i"[\s\S]*\}/.exec(p1.err);
  if (!j) return { outcome: 'error', note: '라우드니스 1차 측정 실패' };
  const s = JSON.parse(j[0]) as Record<string, string>;
  const mixed_path = join(out, 'mixed.mp4');
  const r2 = ffmpeg(['-i', src, '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:measured_I=${s.input_i}:measured_TP=${s.input_tp}:measured_LRA=${s.input_lra}:measured_thresh=${s.input_thresh}:offset=${s.target_offset}:linear=true`,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', mixed_path], 900_000);
  if (!r2.ok) return { outcome: 'error', note: `라우드니스 맞춤 실패: ${r2.err.slice(-160)}` };
  return { outcome: 'ok', produced: { mixed_path }, note: `${vo ? '나레이션 더킹 ⊕ ' : ''}2패스 ${s.input_i}→${target} LUFS` };
};

export function lufs(path: string, start?: number, dur?: number): number | null {
  const r = run('ffmpeg', ['-hide_banner', ...(start !== undefined ? ['-ss', start.toFixed(2)] : []), ...(dur !== undefined ? ['-t', dur.toFixed(2)] : []), '-i', path, '-af', 'ebur128', '-f', 'null', '-'], 600_000);
  const all = [...r.err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return all.length ? Number(all[all.length - 1]![1]) : null;
}

// ── loudness · loudness-three-window-gate ─────────────────────────────────
export const loudnessThreeWindowGate: Recipe = async (ctx) => {
  const m = ctx.state.mixed_path as string | undefined;
  if (!m) return need('mixed_path');
  const target = Number(ctx.state.target_lufs ?? -14);
  const vw = ctx.state.narration_window as [number, number] | undefined, mw = ctx.state.music_window as [number, number] | undefined;
  const lufs_all = lufs(m);
  const lufs_vo = vw ? lufs(m, vw[0], vw[1] - vw[0]) : null;
  const lufs_music = mw ? lufs(m, mw[0], mw[1] - mw[0]) : null;
  const produced = { lufs_all, lufs_vo, lufs_music };
  if (lufs_all === null) return { outcome: 'unmeasured', produced, note: 'ebur128 이 값을 안 냈다' };
  return Math.abs(lufs_all - target) <= 1
    ? { outcome: 'in-range', produced, note: `전체 ${lufs_all} LUFS (목표 ${target}±1)${lufs_vo !== null ? ` · 나레이션 ${lufs_vo}` : ''}${lufs_music !== null ? ` · 음악 ${lufs_music}` : ''}` }
    : { outcome: 'off', produced, note: `전체 ${lufs_all} LUFS — 목표 ${target}±1 밖` };
};

// ── reframe-decide · ink-ruler ────────────────────────────────────────────
/**
 * 이 클립에서 «밝은 픽셀»이 가로로 어디까지 차지하나(1920 기준).
 * ⛔ build.py 의 함정 둘: ⓐ 흰 플래시 한 장이면 폭 1.00 ⇒ 97% 넘게 밝은 프레임은 뺀다
 *   ⓑ 낮은 해상도·높은 임계면 얇은 자막을 놓친다 ⇒ 480×270 · 임계 42.
 */
export function measureInk(path: string, dur: number, window: [number, number] = [0, 1]): Ink {
  const n = 24, W = 480, H = 270;
  // ⛔ `run()` 은 utf8 로 받아 바이트를 망가뜨린다 — 원 바이트로 받는다.
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-t', String(dur), '-vf', `fps=${(n / dur).toFixed(4)},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 }).stdout as Buffer;
  const frames = Math.floor(raw.length / (W * H));
  const a = Math.floor(frames * window[0]), b = Math.round(frames * window[1]);
  let L = W, R = 0, used = 0;
  for (let f = a; f < b; f++) {
    const off = f * W * H;
    const cols: boolean[] = new Array(W).fill(false);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y += 3) if (raw[off + y * W + x]! > 42) { cols[x] = true; break; }
    const on = cols.reduce((s, v) => s + (v ? 1 : 0), 0);
    if (on > W * 0.97) continue;
    used += 1;
    const first = cols.indexOf(true), last = cols.lastIndexOf(true);
    if (first >= 0) { L = Math.min(L, first); R = Math.max(R, last); }
  }
  if (used === 0 || R <= L) return { L: 0, R: 1920, cx: 960, note: '측정불가-전폭가정' };
  const L4 = L * 4, R4 = (R + 1) * 4;
  return { L: L4, R: R4, cx: Math.floor((L4 + R4) / 2), frames: used };
}

const SAFETY = 0.92;
/** 비율별 최대 안전 줌. ⛔ 1 아래로는 못 내려간다 — z<1 이면 crop 이 입력보다 큰 폭을 요구하고 죽는다(build.py 실측). */
export function zoomFor(ink: Ink, w0: number, h0: number, T: Target): { z: number; band: boolean } {
  const cap = T.h / (T.w * h0 / w0);
  const needW = 2 * Math.max(ink.cx - ink.L, ink.R - ink.cx);
  const z = Math.max(1.0, Math.min(cap, (w0 / Math.max(1, needW)) * SAFETY));
  const w = Math.round((T.w * z) / 2) * 2, h = Math.round((w * h0) / w0 / 2) * 2;
  return { z, band: h < T.h };
}

export const inkRuler: Recipe = async (ctx) => {
  const plan = planOf(ctx.state);
  const src = ctx.state.shot_sources as Record<string, string> | undefined;
  if (!plan) return need('plan');
  if (!src) return need('shot_sources');
  const targets = (ctx.state.targets as Target[] | undefined) ?? DEFAULT_TARGETS;
  const windows = (ctx.state.ink_windows as Record<string, [number, number]> | undefined) ?? {};
  const native = (ctx.state.native_sources as Record<string, Record<string, string>> | undefined) ?? {};
  const ink: Record<string, Ink> = {};
  const dimensions: Record<string, { w: number; h: number }> = {};
  const fallbackCuts: string[] = [];
  for (const [c, , dur] of plan) {
    const m = whd(src[c]!);
    if (!m) return { outcome: 'unmeasured', note: `${c} 를 못 읽었다` };
    dimensions[c] = m;
    ink[c] = measureInk(src[c]!, dur, windows[c] ?? [0, 1]);
    if (ink[c]!.note === '측정불가-전폭가정') fallbackCuts.push(c);
  }
  if (fallbackCuts.length) {
    const measureFaces = typeof ctx.state.focus_measure === 'function'
      ? ctx.state.focus_measure as (paths: readonly string[]) => FocusMeasurement[] | null
      : measureFocusPeaks;
    let faces: FocusMeasurement[] | null = null;
    try { faces = measureFaces(fallbackCuts.map((c) => src[c]!)); } catch { faces = null; }
    if (faces?.length === fallbackCuts.length) {
      fallbackCuts.forEach((cut, index) => {
        const { faceCenterX, faceFrames, frames } = faces![index]!;
        if (faceCenterX === null || !Number.isFinite(faceCenterX) || faceCenterX < 0 || faceCenterX > 1 ||
            !Number.isInteger(faceFrames) || !Number.isInteger(frames) || frames <= 0 || faceFrames > frames || faceFrames < frames / 2) return;
        const width = dimensions[cut]!.w;
        ink[cut] = { L: 0, R: width, cx: Math.round(faceCenterX * width), note: '얼굴-중심' };
        ctx.log('ink.face-center', { cut, faceCenterX, faceFrames, frames });
      });
    }
  }
  const max_zoom_per_cut: Record<string, Record<string, number>> = {};
  const native_needed: { cut: string; ratio: string }[] = [];
  for (const [c] of plan) {
    max_zoom_per_cut[c] = {};
    const m = dimensions[c]!;
    for (const T of targets) {
      const { z, band } = zoomFor(ink[c]!, m.w, m.h, T);
      max_zoom_per_cut[c]![T.key] = +z.toFixed(3);
      // ⭐ 검수가 «검정 띠»로 이 비율을 되돌려 보냈으면(dark_ratios) 자르기로는 안 된다 — 전용 합성으로 간다.
      //   🩸 이 갈래가 없어서 fail → 같은 자르기 → 같은 fail 로 «예산이 다할 때까지» 돌았다(실측).
      const flagged = ((ctx.state.dark_ratios as string[] | undefined) ?? []).includes(T.name);
      if (band && (ctx.state.require_native || flagged) && !native[c]?.[T.key]) native_needed.push({ cut: c, ratio: T.key });
    }
  }
  const produced = { ink, max_zoom_per_cut, native_needed };
  return native_needed.length > 0
    ? { outcome: 'needs-native', produced, note: `전용 합성이 필요한 칸 ${native_needed.length}` }
    : { outcome: 'croppable', produced, note: `${plan.length}컷 × ${targets.length}비율 잘라서 된다(세로가 남으면 흐린 배경 — build.py 규칙)` };
};

// ── native-recut · per-ratio-composition ──────────────────────────────────
type HyperframesRunner = (bin: string, args: readonly string[], timeoutMs: number, cwd?: string) => RunResult;

/** 시험이 `state.hyperframes_run` 으로 가짜 러너를 넣는다. 없으면 hyperframes 기본 러너. */
function hyperframesRunnerOf(state: Readonly<Record<string, unknown>>): HyperframesRunner | undefined {
  const run = state.hyperframes_run;
  return typeof run === 'function' ? run as HyperframesRunner : undefined;
}

export const perRatioComposition: Recipe = async (ctx) => {
  const needd = (ctx.state.native_needed as { cut: string; ratio: string }[] | undefined) ?? [];
  const given = (ctx.state.native_sources as Record<string, Record<string, string>> | undefined) ?? {};
  const projects = (ctx.state.hyperframes_projects as Record<string, string> | undefined) ?? {};
  const targets = (ctx.state.targets as Target[] | undefined) ?? DEFAULT_TARGETS;
  const native: Record<string, Record<string, string>> = {};
  for (const [cut, ratios] of Object.entries(given)) native[cut] = { ...ratios };
  const missing: string[] = [];
  const failed: string[] = [];
  let native_given = 0;
  let native_built = 0;
  for (const { cut, ratio } of needd) {
    const have = native[cut]?.[ratio];
    if (have && existsSync(have)) { native_given += 1; continue; }
    const project = projects[cut];
    const label = `${cut}@${ratio}`;
    if (!project || !existsSync(project)) { missing.push(label); continue; }
    const T = targets.find((t) => t.key === ratio);
    if (!T) { failed.push(`${label}(unknown-ratio)`); continue; }
    const runner = hyperframesRunnerOf(ctx.state);
    const built = await renderProjectAtSize({
      projectDir: project,
      workdir: ctx.workdir,
      width: T.w,
      height: T.h,
      label: `${cut}-${ratio}`,
    }, runner ? { run: runner } : {});
    if (built.outcome === 'ok' && built.path) {
      native[cut] = { ...(native[cut] ?? {}), [ratio]: built.path };
      native_built += 1;
      continue;
    }
    const why = built.outcome === 'check-fail' || built.outcome === 'render-mismatch' || built.outcome === UNOBSERVED
      ? (built.outcome === UNOBSERVED ? '못 부름' : built.outcome)
      : built.outcome;
    const detail = built.note && built.note !== why ? built.note : '';
    failed.push(detail ? `${label}(${why}: ${detail})` : `${label}(${why})`);
  }
  const native_paths = needd.map(({ cut, ratio }) => native[cut]?.[ratio]).filter((p): p is string => !!p && existsSync(p));
  if (missing.length > 0 || failed.length > 0) {
    const parts = [
      missing.length > 0 ? `전용 합성이 없다: ${missing.join(', ')}` : '',
      failed.length > 0 ? `전용 합성을 못 지었다: ${failed.join(', ')}` : '',
    ].filter(Boolean);
    return {
      outcome: 'error',
      produced: { native_sources: native, native_paths, native_built, native_given },
      note: `${parts.join(' · ')} — native_built ${native_built} · native_given ${native_given}`,
    };
  }
  return {
    outcome: 'ok',
    produced: { native_sources: native, native_paths, native_built, native_given },
    note: `전용 합성 ${needd.length}개 — native_built ${native_built} · native_given ${native_given}`,
  };
};

// ── social · reframe-social ───────────────────────────────────────────────
export const reframeSocial: Recipe = async (ctx) => {
  const plan = planOf(ctx.state);
  const src = ctx.state.shot_sources as Record<string, string> | undefined;
  const ink = ctx.state.ink as Record<string, Ink> | undefined;
  const mixed = ctx.state.mixed_path as string | undefined;
  if (!plan) return need('plan');
  if (!src) return need('shot_sources');
  if (!ink) return need('ink');
  const targets = (ctx.state.targets as Target[] | undefined) ?? DEFAULT_TARGETS;
  const native = (ctx.state.native_sources as Record<string, Record<string, string>> | undefined) ?? {};
  const FPS = Number(ctx.state.fps ?? 24);
  const out = join(ctx.workdir, 'social');
  mkdirSync(out, { recursive: true });
  const social_paths: string[] = [];
  for (const T of targets) {
    const ins: string[] = [], parts: string[] = [], labels: string[] = [];
    plan.forEach(([c, , dur], i) => {
      const p = native[c]?.[T.key] && existsSync(native[c]![T.key]!) ? native[c]![T.key]! : src[c]!;
      const m = whd(p)!; const sp = stretchOf(m.d, dur, FPS);
      ins.push('-i', p);
      const pre = `[${i}:v]trim=0:${sp > 1 ? m.d : dur},setpts=PTS-STARTPTS${sp > 1 ? `,setpts=${sp.toFixed(6)}*PTS` : ''},fps=${FPS}`;
      if (m.w === T.w && m.h === T.h) { parts.push(`${pre},setsar=1,trim=0:${dur},setpts=PTS-STARTPTS[v${i}]`); labels.push(`[v${i}]`); return; }
      // ⭐ 비율이 «같고» 크기만 다르면(예: 네이티브 720×1280 → 1080×1920) 크기만 맞춘다 — 자르지 않는다.
      //   🩸 2026-09-23: 16:9 원본에서 잰 잉크 좌표로 9:16 네이티브를 «줌·크롭»하려 했다(좌표계가 다른 판).
      if (Math.abs(m.w / m.h - T.w / T.h) < 0.01) { parts.push(`${pre},scale=${T.w}:${T.h},setsar=1,trim=0:${dur},setpts=PTS-STARTPTS[v${i}]`); labels.push(`[v${i}]`); return; }
      const k = ink[c] ?? { L: 0, R: m.w, cx: m.w / 2 };
      const { z } = zoomFor(k, m.w, m.h, T);
      const w = Math.round((T.w * z) / 2) * 2, h = Math.round((w * m.h) / m.w / 2) * 2;
      const x = Math.max(0, Math.min(w - T.w, Math.round((k.cx * w) / m.w - T.w / 2)));
      if (h >= T.h) parts.push(`${pre},scale=${w}:${h},setsar=1,crop=${T.w}:${T.h}:${x}:${Math.floor((h - T.h) / 2)},trim=0:${dur},setpts=PTS-STARTPTS[v${i}]`);
      else {
        // ⭐ 세로가 남을 때 «검정»으로 메우지 않는다 — 같은 프레임을 흐리고 어둡게 깔고 그 위에 띠(build.py 실측: 검정 68%).
        const yTop = Math.round((T.h - h) * T.cy);
        const sw = Math.max(2, Math.round(T.w / 8 / 2) * 2), sh = Math.max(2, Math.round(T.h / 8 / 2) * 2);
        parts.push(`${pre},split[a${i}][b${i}];[a${i}]scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${sw}:${sh},gblur=sigma=6,scale=${T.w}:${T.h},setsar=1,eq=brightness=-0.18:saturation=0.55[bg${i}];` +
          `[b${i}]scale=${w}:${h},setsar=1,crop=${T.w}:${h}:${x}:0[fg${i}];[bg${i}][fg${i}]overlay=0:${yTop},trim=0:${dur},setpts=PTS-STARTPTS[v${i}]`);
      }
      labels.push(`[v${i}]`);
    });
    parts.push(`${labels.join('')}concat=n=${plan.length}:v=1:a=0[vout]`);
    const dst = join(out, `${T.name}.mp4`);
    const audioIn = mixed ?? (ctx.state.track_path as string | undefined);
    const r = ffmpeg([...ins, ...(audioIn ? ['-i', audioIn] : []), '-filter_complex', parts.join(';'), '-map', '[vout]', ...(audioIn ? ['-map', `${plan.length}:a`, '-shortest', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'medium', '-r', String(FPS), '-movflags', '+faststart', dst], 1_200_000);
    if (!r.ok) return { outcome: 'error', note: `${T.name} 실패: ${r.err.slice(-200)}` };
    social_paths.push(dst);
  }
  return { outcome: 'ok', produced: { social_paths }, note: `소셜 ${social_paths.length}종(${targets.map((t) => t.key).join('·')})` };
};

// ── review · contact-sheet-review ─────────────────────────────────────────
/**
 * 비율마다 접촉 시트를 뽑고 ***「검정 띠」를 잰다*** — 띠면 fail(→ reframe-decide).
 *
 * 🩸 2026-09-23 실물: 처음엔 「평균 밝기 < 20 인 프레임 > 25%」로 쟀다 ⇒ 4:5 가 25.5% 로 fail.
 *   그런데 ***build.py 의 공식 4:5 납품본도 23.5%*** 였다 — 그 자는 build.py 가 «일부러» 어둡게 깐
 *   흐린 배경(brightness −0.18)을 결함으로 읽었다. 잡아야 할 것은 build.py 주석 그대로 «검정 띠»다.
 * ⇒ 프레임마다 «순검정 픽셀 비율»(blackframe · Y<24)의 ***중앙값***. 📏 눌러 본 값:
 *   공식 4:5 21% · 공식 9:16 22% · 내 4:5 25% ↔ 일부러 만든 검정 띠 9:16 ***68%***  ⇒ 문턱 50%.
 * ⛔ 시트를 «만들었다»가 «봤다»가 아니다 — 판정은 실측이다.
 */
export function medianBlackPct(path: string): number | null {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-vf', 'fps=1,blackframe=amount=0:threshold=24', '-f', 'null', '-'], 600_000);
  const v = [...r.err.matchAll(/pblack:(\d+)/g)].map((m) => Number(m[1])).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)]! : null;
}

export const contactSheetReview: Recipe = async (ctx) => {
  const socials = (ctx.state.social_paths as string[] | undefined) ?? [];
  const mixed = ctx.state.mixed_path as string | undefined;
  const all = [...(mixed ? [mixed] : []), ...socials].filter(existsSync);
  if (all.length === 0) return { outcome: 'unviewed', note: '볼 산출이 없다' };
  const out = join(ctx.workdir, 'sheets');
  mkdirSync(out, { recursive: true });
  const sheets: string[] = [], viewed_ratios: string[] = [], dark_ratios: string[] = [], seen: string[] = [];
  for (const p of all) {
    const name = p.split('/').pop()!.replace(/\.[^.]+$/, '');
    const sheet = join(out, `${name}.jpg`);
    const r = ffmpeg(['-i', p, '-vf', 'fps=1/2,scale=240:-2,tile=6x2', '-frames:v', '1', sheet]);
    if (!r.ok) continue;
    sheets.push(sheet); viewed_ratios.push(name);
    const med = medianBlackPct(p);
    if (med === null) return { outcome: 'unviewed', produced: { sheets, viewed_ratios }, note: `${name} 의 검정 비율을 못 쟀다` };
    seen.push(`${name} ${med}%`);
    if (med >= 50) dark_ratios.push(name);
  }
  if (sheets.length < all.length) return { outcome: 'unviewed', produced: { sheets, viewed_ratios }, note: `시트 ${sheets.length}/${all.length}` };
  return dark_ratios.length
    ? { outcome: 'fail', produced: { sheets, viewed_ratios, dark_ratios }, note: `검정 띠: ${dark_ratios.join(', ')} (순검정 중앙값 · ${seen.join(' · ')})` }
    : { outcome: 'pass', produced: { sheets, viewed_ratios, dark_ratios: [] }, note: `시트 ${sheets.length}장 · 검정 띠 없음 (순검정 중앙값 ${seen.join(' · ')})` };
};

export const FILM: Readonly<Record<string, Recipe>> = {
  'host-and-ruler-preflight': hostAndRulerPreflight,
  'prepare-source-plates': prepareSourcePlates,
  'epidemic-mcp-fetch': epidemicMcpFetch,
  'bar-grid-gate': barGridGate,
  'produce-shots': produceShots,
  'typo-cut-parity-gate': typoCutParityGate,
  'assemble-master': assembleMaster,
  'master-span-gate': masterSpanGate,
  'two-pass-normalize-and-duck': twoPassNormalizeAndDuck,
  'loudness-three-window-gate': loudnessThreeWindowGate,
  'ink-ruler': inkRuler,
  'per-ratio-composition': perRatioComposition,
  'reframe-social': reframeSocial,
  'contact-sheet-review': contactSheetReview,
};
