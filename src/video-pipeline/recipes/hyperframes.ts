/**
 * HyperFrames 프로젝트 하나를 «점검 → 프레임 자가 검토 → 렌더 → 실물 검증»한다.
 *
 * ⛔ 소재 «생성»(init)은 이 레시피의 일이 아니다 — `state.hyperframes_project` 디렉토리를 받는다.
 * ⛔ 산출은 전부 `ctx.workdir` 안이다. 사람 트리를 건드리지 않는다.
 * ⛔ `npx` 를 못 부르면(spawn 실패·signal) «실패»가 아니라 `UNOBSERVED` 다.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { type RunResult } from './ffmpeg.js';
import { UNOBSERVED, type Recipe, type RecipeCtx, type RecipeResult } from './types.js';

/**
 * `ffmpeg.ts` 의 `run` 과 같은 모양 `(bin, args, timeoutMs) => RunResult`.
 * 넷째 `cwd` 는 선택 — HyperFrames 는 프로젝트 디렉토리에서 돌아야 `data-*` 와 렌더가 맞는다.
 * 시험은 이 자리를 가짜로 바꾼다.
 */
type CommandRunner = (bin: string, args: readonly string[], timeoutMs: number, cwd?: string) => RunResult;

interface HyperframesDeps {
  readonly run?: CommandRunner;
  /** 자식 환경. 기본은 프로세스 env ⊕ 스킬/텔레메트리 차단. */
  readonly env?: NodeJS.ProcessEnv;
  /** 시험이 복사·읽기·쓰기 실패를 고정한다. 없으면 node:fs. */
  readonly files?: {
    readonly copy?: typeof cpSync;
    readonly read?: typeof readFileSync;
    readonly write?: typeof writeFileSync;
  };
}

const CHECK_MS = 120_000;
const SNAPSHOT_MS = 180_000;
const RENDER_MS = 600_000;
const PROBE_MS = 60_000;
const DURATION_TOLERANCE_S = 0.1;

/** 렌더마다 스킬 레지스트리를 GitHub 에 묻지 않고, 익명 텔레메트리를 보내지 않는다. */
const HYPERFRAMES_CHILD_ENV: Readonly<Record<string, string>> = {
  HYPERFRAMES_SKIP_SKILLS: '1',
  HYPERFRAMES_NO_TELEMETRY: '1',
};

function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, ...HYPERFRAMES_CHILD_ENV };
}

/** 기본 러너 — `(bin, args, timeoutMs, cwd?) => RunResult`. 자식 env 에 스킬·텔레메트리를 끈다. */
export function runHyperframes(
  bin: string, args: readonly string[], timeoutMs: number,
  env: NodeJS.ProcessEnv = childEnv(), cwd?: string,
): RunResult {
  const r = spawnSync(bin, [...args], { encoding: 'utf8', timeout: timeoutMs, env, ...(cwd ? { cwd } : {}) });
  return {
    ok: r.status === 0,
    code: r.status,
    signal: r.signal ?? null,
    err: (r.stderr ?? '').trim(),
    out: (r.stdout ?? '').trim(),
  };
}

/** spawn 이 프로세스를 못 띄웠거나 시그널로 죽었다 — «거부»가 아니라 «못 불렀다». */
function unspawned(r: RunResult): boolean {
  return r.signal !== null || (r.code === null && !r.ok);
}

/**
 * `candidate` 가 `root` 이거나 그 하위면 true. 실제 경로(심볼릭 링크 해소)로 비교한다.
 * 둘 중 하나가 아직 없으면 논리 경로로만 비교한다.
 */
function pathInside(root: string, candidate: string): boolean {
  const a = realOrResolve(root);
  const b = realOrResolve(candidate);
  const rel = relative(a, b);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel));
}

/** 아직 없는 파일도 논리 경로가 root 안이면 true. 부재를 «밖»으로 접지 않는다. */
function lexicalInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && !/^[A-Za-z]:/.test(rel));
}

function realOrResolve(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

interface RootAttrs {
  readonly width: number;
  readonly height: number;
  /** 양수 초. 없거나 0·음수·비수면 선언을 못 읽은 것(거부)이다. */
  readonly duration: number;
}

/** 속성 값. 속성이 없으면 null, 있으면 그 문자열(빈 문자열 포함). */
function attrValue(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1]! : null;
}

/**
 * 프로젝트 루트 HTML 의 `data-width` · `data-height` · `data-duration`.
 * 셋 중 하나라도 없거나 0 이하·비수면 null(거부). duration 누락도 거부다.
 */
function readRootAttrs(projectDir: string): RootAttrs | null {
  const index = resolve(projectDir, 'index.html');
  if (!existsSync(index)) return null;
  const html = readFileSync(index, 'utf8');
  const root = /<[^>]*\bdata-composition-id\s*=\s*["'][^"']*["'][^>]*>/i.exec(html)?.[0]
    ?? /<[^>]*\bdata-duration\s*=\s*["'][^"']*["'][^>]*>/i.exec(html)?.[0]
    ?? /<html\b[^>]*>/i.exec(html)?.[0];
  if (!root) return null;
  const widthRaw = attrValue(root, 'data-width');
  const heightRaw = attrValue(root, 'data-height');
  const durationRaw = attrValue(root, 'data-duration');
  const width = widthRaw === null ? NaN : Number(widthRaw);
  const height = heightRaw === null ? NaN : Number(heightRaw);
  const duration = durationRaw === null ? NaN : Number(durationRaw);
  if (![width, height, duration].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { width, height, duration };
}

/**
 * 길이의 내부 중간점. 끝점(0 · duration)은 빼서 프레임이 경계에 붙지 않게 한다.
 * 3초 → 0.75, 1.5, 2.25. 아주 짧으면 한 점(duration/2).
 */
function interiorMidpoints(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const n = duration >= 2 ? 3 : 1;
  const pts: number[] = [];
  for (let i = 1; i <= n; i++) pts.push(Number(((duration * i) / (n + 1)).toFixed(3)));
  return pts;
}

interface CheckSummary {
  readonly ok: boolean;
  readonly lint: number;
  readonly runtime: number;
  readonly layout: number;
}

function errorCountOf(block: unknown): number {
  if (!block || typeof block !== 'object') return 0;
  const n = (block as { errorCount?: unknown }).errorCount;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function parseCheck(out: string): CheckSummary | null {
  try {
    const j = JSON.parse(out) as { ok?: unknown; lint?: unknown; runtime?: unknown; layout?: unknown };
    if (typeof j.ok !== 'boolean') return null;
    return {
      ok: j.ok,
      lint: errorCountOf(j.lint),
      runtime: errorCountOf(j.runtime),
      layout: errorCountOf(j.layout),
    };
  } catch {
    return null;
  }
}

interface ProbeWhd {
  readonly w: number;
  readonly h: number;
  readonly d: number;
}

function probeWhd(run: CommandRunner, path: string, cwd: string): ProbeWhd | null {
  const r = run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', path,
  ], PROBE_MS, cwd);
  if (!r.ok || unspawned(r)) return null;
  try {
    const j = JSON.parse(r.out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const w = j.streams?.[0]?.width;
    const h = j.streams?.[0]?.height;
    const d = Number(j.format?.duration);
    if (typeof w !== 'number' || typeof h !== 'number' || !Number.isFinite(d)) return null;
    return { w, h, d };
  } catch {
    return null;
  }
}

export function hyperframesRender(deps: HyperframesDeps = {}): Recipe {
  const env = childEnv(deps.env);
  const base = deps.run;
  return async (ctx: RecipeCtx): Promise<RecipeResult> => {
    const project = ctx.state.hyperframes_project;
    if (typeof project !== 'string' || project.length === 0) {
      return { outcome: UNOBSERVED, note: "계약 입력 'hyperframes_project' 가 state 에 없다 — 앞 노드가 안 채웠다(실패가 «아니다»)" };
    }
    if (!existsSync(project)) {
      return { outcome: UNOBSERVED, note: `hyperframes_project 가 디렉토리가 아니다: ${project}` };
    }
    const declared = readRootAttrs(project);
    if (!declared) {
      return { outcome: UNOBSERVED, note: '루트 data-width·data-height·data-duration 을 못 읽었다' };
    }
    const run: CommandRunner = base ?? ((bin, args, timeoutMs) => runHyperframes(bin, args, timeoutMs, env, project));

    const check = run('npx', ['hyperframes', 'check', '--json'], CHECK_MS, project);
    if (unspawned(check)) {
      return { outcome: UNOBSERVED, note: `npx hyperframes check 를 못 불렀다(code=${check.code} signal=${check.signal})` };
    }
    const summary = parseCheck(check.out);
    if (!summary) {
      return { outcome: 'check-fail', note: `check --json 을 못 읽었다: ${check.err.slice(0, 160) || check.out.slice(0, 160)}` };
    }
    const hf_check = { lint: summary.lint, runtime: summary.runtime, layout: summary.layout };
    if (!summary.ok) {
      return {
        outcome: 'check-fail',
        produced: { hf_check },
        note: `check ok=false · lint ${summary.lint} · runtime ${summary.runtime} · layout ${summary.layout}`,
      };
    }

    const workRoot = resolve(ctx.workdir);
    const snapDir = resolve(workRoot, 'hf-snapshots');
    if (!snapDir.startsWith(workRoot + '/')) {
      return { outcome: UNOBSERVED, note: '스냅샷 경로가 workdir 밖이다' };
    }
    mkdirSync(snapDir, { recursive: true });
    const ats = interiorMidpoints(declared.duration);
    const snap = run('npx', [
      'hyperframes', 'snapshot', '--at', ats.join(','), '-o', snapDir,
    ], SNAPSHOT_MS, project);
    if (unspawned(snap)) {
      return { outcome: UNOBSERVED, note: `npx hyperframes snapshot 을 못 불렀다(code=${snap.code} signal=${snap.signal})` };
    }
    if (!snap.ok) {
      return { outcome: 'check-fail', produced: { hf_check, hf_snapshot_dir: snapDir }, note: `snapshot 실패: ${snap.err.slice(0, 200)}` };
    }

    const renderPath = resolve(workRoot, 'hf-render.mp4');
    if (!renderPath.startsWith(workRoot + '/')) {
      return { outcome: UNOBSERVED, note: '렌더 경로가 workdir 밖이다' };
    }
    const rendered = run('npx', [
      'hyperframes', 'render', '-o', renderPath,
    ], RENDER_MS, project);
    if (unspawned(rendered)) {
      return { outcome: UNOBSERVED, note: `npx hyperframes render 를 못 불렀다(code=${rendered.code} signal=${rendered.signal})` };
    }
    if (!rendered.ok || !existsSync(renderPath)) {
      return { outcome: 'check-fail', produced: { hf_check, hf_snapshot_dir: snapDir }, note: `render 가 파일을 안 냈다: ${rendered.err.slice(0, 200)}` };
    }

    const got = probeWhd(run, renderPath, project);
    if (!got) {
      return { outcome: 'render-mismatch', produced: { hf_render_path: renderPath, hf_snapshot_dir: snapDir, hf_check }, note: 'ffprobe 로 폭·높이·길이를 못 쟀다' };
    }
    const widthOk = got.w === declared.width;
    const heightOk = got.h === declared.height;
    const durOk = Math.abs(got.d - declared.duration) <= DURATION_TOLERANCE_S;
    if (!widthOk || !heightOk || !durOk) {
      return {
        outcome: 'render-mismatch',
        produced: { hf_render_path: renderPath, hf_snapshot_dir: snapDir, hf_check },
        note: `선언 ${declared.width}x${declared.height} ${declared.duration}s ≠ 실측 ${got.w}x${got.h} ${got.d}s`,
      };
    }
    return {
      outcome: 'ok',
      produced: { hf_render_path: renderPath, hf_snapshot_dir: snapDir, hf_check },
      note: `check ok · snapshot ${ats.join(',')}s · ${got.w}x${got.h} ${got.d.toFixed(3)}s`,
    };
  };
}

// ⛔⭐ 소비자의 파서로 읽는다 — `@hyperframes/core/storyboard` 의 parseStoryboard(CLI 번들 dist/cli.js 에 실린 v0.8.64)와 같은 규칙.
//   🩸 2026-09-23(#20061 착지 직후 실물): 종전 판은 프레임을 «번호»로 묶어 같은 번호가 다시 나오면 뒤 블록이 앞을 덮었다 —
//   앞 블록의 `status: built` · 없는 `src` 가 가려져 ***준비 안 된 프레임을 `approved` 로 통과***시켰다.
//   그리고 번호 없는 제목(`## Frame — Outro`)은 아예 세지 않았다. 업스트림은 둘 다 «등장 순서»의 별개 프레임이다.
const FRAME_HEADING = /^(#{2,3})[ \t]+(?:frame|beat|scene)\b/i;
const HEADING_LEVEL = /^(#{1,6})\s+/;
const META_LINE = /^\s*[-*]\s+([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/;
const KNOWN_NOT_READY = new Set(['outline', 'built']);

export interface StoryboardFrame {
  /** 보고용 번호 — 제목의 번호(업스트림 `number`), 없으면 등장 순서(`index`). ⛔ 프레임의 «정체»는 번호가 아니라 등장 순서다. */
  readonly n: number;
  readonly status: string;
  readonly src?: string;
}

/**
 * `STORYBOARD.md` 본문. H2/H3 `Frame|Beat|Scene …` 제목마다 프레임 하나(번호는 선택),
 * 같은 레벨 이상의 다른 제목이 나오면 그 프레임 절이 닫힌다. 메타는 `- key: value` / `* key: value`.
 * status 가 없으면 `outline`.
 */
export function parseStoryboard(markdown: string): StoryboardFrame[] {
  const frames: { number?: number; status: string; src?: string }[] = [];
  let current: { number?: number; status: string; src?: string } | null = null;
  let level = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const head = FRAME_HEADING.exec(line);
    if (head) {
      const number = /^[\s.:—-]*(\d+)/.exec(line.slice(head[0].length))?.[1];
      current = number !== undefined ? { number: Number(number), status: 'outline' } : { status: 'outline' };
      level = head[1]!.length;
      frames.push(current);
      continue;
    }
    const anyHeading = HEADING_LEVEL.exec(line);
    if (current && anyHeading && anyHeading[1]!.length <= level) {
      current = null;
      continue;
    }
    if (!current) continue;
    const meta = META_LINE.exec(line);
    if (!meta) continue;
    const key = meta[1]!.toLowerCase();
    const value = meta[2]!.trim();
    if (key === 'status') current.status = value.length > 0 ? value : 'outline';
    else if (key === 'src' && value.length > 0) current.src = value;
  }
  return frames.map((slot, i) => ({ n: slot.number ?? i + 1, status: slot.status, ...(slot.src ? { src: slot.src } : {}) }));
}

function countByStatus(frames: readonly StoryboardFrame[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const frame of frames) counts[frame.status] = (counts[frame.status] ?? 0) + 1;
  return counts;
}

/**
 * 렌더 앞 읽기 전용 관문. `state.hyperframes_project/STORYBOARD.md` 만 읽고 쓰지 않는다.
 * 파일이 없으면 `no-storyboard`(승인·실패 둘 다 아님). 모르는 status 는 통과로 세지 않는다.
 * 인식된 프레임이 0개면 확인하지 못한 보드다 — `approved` 로 접지하지 않는다.
 */
export function storyboardGate(): Recipe {
  return async (ctx: RecipeCtx): Promise<RecipeResult> => {
    const project = ctx.state.hyperframes_project;
    if (typeof project !== 'string' || project.length === 0) {
      return { outcome: UNOBSERVED, note: "계약 입력 'hyperframes_project' 가 state 에 없다 — 앞 노드가 안 채웠다(실패가 «아니다»)" };
    }
    const root = resolve(project);
    if (!existsSync(root)) {
      return { outcome: UNOBSERVED, note: `hyperframes_project 가 디렉토리가 아니다: ${project}` };
    }
    const board = resolve(root, 'STORYBOARD.md');
    if (!lexicalInside(root, board)) {
      return { outcome: UNOBSERVED, note: 'STORYBOARD.md 경로가 프로젝트 밖이다' };
    }
    if (!existsSync(board)) {
      return { outcome: 'no-storyboard', note: 'STORYBOARD.md 가 없다 — 승인으로도 실패로도 접지 않는다' };
    }
    let markdown: string;
    try {
      markdown = readFileSync(board, 'utf8');
    } catch (e) {
      return { outcome: UNOBSERVED, note: `STORYBOARD.md 읽기 실패: ${e instanceof Error ? e.message : String(e)}` };
    }
    const frames = parseStoryboard(markdown);
    const counts = countByStatus(frames);
    const missingSrc: number[] = [];
    const notReady: number[] = [];
    for (const frame of frames) {
      if (frame.status !== 'animated') notReady.push(frame.n);
      if (!frame.src) continue;
      const file = resolve(root, frame.src);
      if (!lexicalInside(root, file) || !existsSync(file)) missingSrc.push(frame.n);
    }
    const produced = {
      frames_total: frames.length,
      status_counts: counts,
      ...(notReady.length > 0 ? { not_ready_frames: notReady } : {}),
      ...(missingSrc.length > 0 ? { missing_src_frames: missingSrc } : {}),
    };
    if (notReady.length > 0) {
      const unknown = notReady.filter((n) => {
        const status = frames.find((f) => f.n === n)?.status ?? '';
        return !KNOWN_NOT_READY.has(status);
      });
      const why = unknown.length > 0
        ? `준비 안 된(모르는 status 포함) 프레임: ${notReady.join(', ')}`
        : `animated 가 아닌 프레임: ${notReady.join(', ')}`;
      return { outcome: 'not-ready', produced, note: why };
    }
    if (missingSrc.length > 0) {
      return { outcome: 'missing-src', produced, note: `src 파일이 없는 프레임: ${missingSrc.join(', ')}` };
    }
    if (frames.length === 0) {
      return {
        outcome: 'not-ready',
        produced,
        note: '인식된 프레임이 0개다 — 빈 보드이거나 Frame|Beat|Scene 헤딩이 없다. 확인하지 못한 보드는 렌더를 허용하지 않는다',
      };
    }
    return { outcome: 'approved', produced, note: `프레임 ${frames.length}개 전부 animated · src 실재` };
  };
}

/** 레시피 이름은 `hyperframes-render` 와 읽기 전용 `storyboard-gate`. 기존 맵의 키와 겹치지 않는다. */
export const HYPERFRAMES: Readonly<Record<string, Recipe>> = {
  'hyperframes-render': hyperframesRender(),
  'storyboard-gate': storyboardGate(),
};

export interface RenderAtSize {
  readonly projectDir: string;
  readonly workdir: string;
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

export interface RenderAtSizeResult {
  readonly outcome: 'ok' | 'check-fail' | 'render-mismatch' | typeof UNOBSERVED;
  readonly path?: string;
  readonly note: string;
}

/**
 * 프로젝트를 `workdir` 안으로 복사하고, 루트 `data-composition-id` 의
 * `data-width`·`data-height` 만 바꾼 뒤 기존 점검→렌더→ffprobe 경로로 짓는다.
 * 원본 디렉토리는 읽기만 한다. 레이아웃·CSS 는 건드리지 않는다.
 */
function fileFail(note: string): RenderAtSizeResult {
  return { outcome: UNOBSERVED, note };
}

export async function renderProjectAtSize(
  spec: RenderAtSize,
  deps: HyperframesDeps = {},
): Promise<RenderAtSizeResult> {
  const source = resolve(spec.projectDir);
  if (!existsSync(source)) {
    return { outcome: UNOBSERVED, note: `hyperframes 프로젝트가 없다: ${source}` };
  }
  const workRoot = resolve(spec.workdir);
  try {
    mkdirSync(workRoot, { recursive: true });
  } catch (e) {
    return fileFail(`workdir 를 못 만들었다: ${e instanceof Error ? e.message : String(e)}`);
  }
  const copy = resolve(workRoot, `hf-${spec.label}-${basename(source)}`);
  if (!copy.startsWith(workRoot + '/')) {
    return { outcome: UNOBSERVED, note: '복사 경로가 workdir 밖이다' };
  }
  // 프로젝트가 workdir 자체이거나 그 상위면 복사 목적지가 원본 하위로 들어가 cpSync 가 예외로 죽는다.
  if (pathInside(source, workRoot) || pathInside(source, copy)) {
    return fileFail('프로젝트가 workdir 이거나 그 상위라 원본 하위로 복사하지 않는다');
  }
  const copyFile = deps.files?.copy ?? cpSync;
  const readFile = deps.files?.read ?? readFileSync;
  const writeFile = deps.files?.write ?? writeFileSync;
  try {
    // dereference: 원본 index.html 이 심볼릭 링크여도 복사본은 독립 파일이어야
    // writeFileSync 가 링크 대상을 덮어쓰지 않는다.
    copyFile(source, copy, { recursive: true, dereference: true });
  } catch (e) {
    return fileFail(`프로젝트 복사 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  const index = resolve(copy, 'index.html');
  let html: string;
  try {
    if (!existsSync(index)) {
      return { outcome: UNOBSERVED, note: '복사본 index.html 이 없다' };
    }
    html = readFile(index, 'utf8');
  } catch (e) {
    return fileFail(`복사본 index.html 읽기 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rewritten = rewriteCompositionSize(html, spec.width, spec.height);
  if (!rewritten) {
    return { outcome: UNOBSERVED, note: '루트 data-composition-id 의 data-width·data-height 를 못 바꿨다' };
  }
  try {
    writeFile(index, rewritten);
  } catch (e) {
    return fileFail(`복사본 index.html 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  // ⛔ 렌더 산출은 «칸마다» 다른 디렉토리 — hyperframesRender 는 늘 `<workdir>/hf-render.mp4` 에 쓴다.
  //   🩸 2026-09-23 실물(npx 실렌더): 같은 컷의 9x16·4x5 를 한 workdir 에 지으면 둘 다 같은 파일을 가리키고
  //   그 파일은 «마지막» 비율(1080x1350)이었다 — 9x16 소셜에 4x5 영상이 들어간다.
  const outDir = resolve(workRoot, `hf-out-${spec.label.replace(/[^A-Za-z0-9_-]+/g, '_')}`);
  if (!outDir.startsWith(workRoot + '/')) {
    return { outcome: UNOBSERVED, note: '렌더 산출 경로가 workdir 밖이다' };
  }
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (e) {
    return fileFail(`렌더 산출 디렉토리를 못 만들었다: ${e instanceof Error ? e.message : String(e)}`);
  }
  const built = await hyperframesRender(deps)({
    workdir: outDir,
    state: { hyperframes_project: copy },
    log: () => {},
  });
  if (built.outcome === 'ok') {
    const path = built.produced?.hf_render_path;
    if (typeof path !== 'string' || path.length === 0) {
      return { outcome: 'render-mismatch', note: '렌더는 ok 인데 hf_render_path 가 없다' };
    }
    return { outcome: 'ok', path, note: built.note ?? `${spec.width}x${spec.height}` };
  }
  if (built.outcome === 'check-fail' || built.outcome === 'render-mismatch' || built.outcome === UNOBSERVED) {
    return { outcome: built.outcome, note: built.note ?? built.outcome };
  }
  return { outcome: UNOBSERVED, note: built.note ?? `알 수 없는 결과 ${built.outcome}` };
}

/**
 * 루트 `data-composition-id` 요소의 width·height 두 속성만 바꾼다.
 * 루트가 없으면 null. 이미 요청한 크기면 원문 그대로 반환한다(실패가 아니다 — 그래도 렌더한다).
 */
function rewriteCompositionSize(html: string, width: number, height: number): string | null {
  const open = /<([a-zA-Z][\w:-]*)\b([^>]*\bdata-composition-id\s*=\s*["'][^"']*["'][^>]*)>/i.exec(html);
  if (!open || open.index === undefined) return null;
  const tag = open[0];
  const sized = setAttr(setAttr(tag, 'data-width', String(width)), 'data-height', String(height));
  if (sized === tag) return html;
  return html.slice(0, open.index) + sized + html.slice(open.index + tag.length);
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\b${name}\\s*=\\s*)(["'])([^"']*)(\\2)`, 'i');
  if (re.test(tag)) return tag.replace(re, `$1$2${value}$4`);
  return tag.replace(/>$/, ` ${name}="${value}">`);
}
