/**
 * 모델 «이름» 하드코딩 ratchet 게이트.
 *
 * 🩸 왜 (2026-09-25 · 대표 이 «두 번째로» 같은 정정을 했다):
 *   상시 규율은 ***「모델 이름을 박지 않는다 — 사다리에서 파생한다」***인데, 강제가 없어서 되풀이됐다.
 *   근본은 훈계가 아니라 ***분포***였다 — 전수하니 스크립트에 박힌 이름 중 «가장 흔한» 것이
 *   ***낡은 `gpt-5.6-sol`(31곳)***이고 현행 기본 `gpt-6-sol` 은 12곳이었다.
 *   ⇒ ***옆 스크립트를 베끼면 낡은 이름을 물려받는다.*** 내가 그렇게 했고, 판 하나를 낡은 모델로 쐈다.
 *
 * 📏 사다리·설정은 «옳았다» — 그것이 이 게이트가 필요한 이유다:
 *     llm.model = gpt-6-sol · 사다리 best(openai-codex) = gpt-6-sol
 *   설정이 맞는데 스크립트가 그걸 «안 읽어서» 어긋났다. 그런 어긋남은 조용하다.
 *
 * 정책 — `ci-isolation-hardcode-gate` 와 «동형»이다(부채 관용 · 신규 차단):
 *   통짜 금지는 즉시 레드 → 무시되는 가짜 게이트다. 그래서 ***현 baseline(파일별 count)을 스냅샷***하고
 *   그 초과만 실패시킨다. 옮긴 뒤 `--update` 로 ratchet down 한다.
 *
 * 쓰기:
 *   bun run scripts/ci-model-hardcode-gate.ts            # 검사(신규 드리프트 시 exit 1)
 *   bun run scripts/ci-model-hardcode-gate.ts --update   # baseline 재스냅샷
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const BASELINE = join(import.meta.dir, 'model-hardcode-baseline.txt');
const SCAN_DIRS = ['scripts'] as const;

/** ⛔ 이름의 «정본»을 두는 자리는 이 게이트의 대상이 아니다 — 거기엔 박혀 있어야 한다. */
const REGISTRY_FILES = new Set([
  'scripts/ci-model-hardcode-gate.ts',
  'scripts/ci-model-hardcode-gate.test.ts',
  'scripts/check-codex-picker-models.ts',
]);

/** 모델 id 모양. ⛔ 프로바이더별 접두를 «열거»한다 — 넓은 정규식은 파일 이름·경로를 문다. */
const MODEL_ID = /\b(?:gpt-\d+(?:\.\d+)?(?:-[a-z]+)?|grok-\d+(?:\.\d+)?(?:-[a-z-]+)?|claude-(?:opus|sonnet|haiku)-[\w.-]+)\b/g;

/** 주석 줄은 세지 않는다 — 🩸 문서화된 이력(「08-18 이후 grok-4.6 → 4.7 로 늙었다」)이 위반이 되면 규율이 지워진다. */
export function isCommentOnlyLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*');
}

export function modelIdsInLine(line: string): string[] {
  if (isCommentOnlyLine(line)) return [];
  return [...line.matchAll(MODEL_ID)].map((m) => m[0]);
}

export function scanSource(source: string): Array<{ lineNumber: number; line: string; ids: string[] }> {
  const out: Array<{ lineNumber: number; line: string; ids: string[] }> = [];
  source.split('\n').forEach((line, i) => {
    const ids = modelIdsInLine(line);
    if (ids.length > 0) out.push({ lineNumber: i + 1, line: line.trim().slice(0, 160), ids });
  });
  return out;
}

function walk(dir: string, acc: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { walk(p, acc); continue; }
    if (/\.(ts|sh|mjs)$/.test(e.name)) acc.push(p);
  }
}

export function readBaseline(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.lastIndexOf(' ');
    if (i < 0) continue;
    const n = Number(t.slice(i + 1));
    if (Number.isFinite(n)) m.set(t.slice(0, i), n);
  }
  return m;
}

export function renderViolation(file: string, allowed: number, count: number, sample: string): string {
  return `  ${file}: ${allowed} → ${count} (+${count - allowed} 신규 하드코딩)\n`
    + `    - ${sample}\n`
    + '      ⇒ 이름을 박지 말고 «사다리»에서 파생하라: tierModel(<tier>, <provider>) (src/llm/model-defaults.ts)\n'
    + '        또는 설정을 읽어라 — config get llm.model / llm.provider';
}

export type ModelGateIo = {
  args?: readonly string[];
  /** 스캔할 저장소 뿌리 — ⛔ 기본(이 스크립트가 놓인 트리)은 하니스 자식 워크트리가 «아니다».
   *  하니스 게이트(`src/self-implement/gate-cli.ts`)는 자식 워크트리를 `cwd` 로 준다(격리 관문과 같은 계약 · 🅣 2026-09-25). */
  cwd?: string;
  log?: (line: string) => void;
  error?: (line: string) => void;
};

/** `--changed-files <경로…>` — 주면 «그 파일들의» 초과만 판정한다(남의 파일 때문에 막지 않는다 · 격리 관문과 같은 모양). */
export function parseChangedFiles(args: readonly string[]): Set<string> | null {
  const at = args.indexOf('--changed-files');
  if (at < 0) return null;
  const out = new Set<string>();
  for (const a of args.slice(at + 1)) {
    if (a.startsWith('--')) break;
    out.add(a.replace(/^\.\//, ''));
  }
  return out;
}

/** `pr land` 가 부르는 모양 — 다른 게이트들과 «동형»이다(io 주입 · rc 반환). */
export function runModelHardcodeGate(io: ModelGateIo = {}): number {
  const args = io.args ?? process.argv.slice(2);
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  return main({ args, root: io.cwd ?? ROOT, log, error });
}

function main(io: { args: readonly string[]; root: string; log: (l: string) => void; error: (l: string) => void }): number {
  const ROOT = io.root;
  const BASELINE = join(ROOT, 'scripts', 'model-hardcode-baseline.txt');
  const changed = parseChangedFiles(io.args);
  const files: string[] = [];
  for (const d of SCAN_DIRS) { const p = join(ROOT, d); if (existsSync(p) && statSync(p).isDirectory()) walk(p, files); }
  const counts = new Map<string, number>();
  const samples = new Map<string, string>();
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (REGISTRY_FILES.has(rel)) continue;
    const hits = scanSource(readFileSync(f, 'utf8'));
    if (hits.length === 0) continue;
    counts.set(rel, hits.reduce((n, h) => n + h.ids.length, 0));
    samples.set(rel, `line ${hits[0]!.lineNumber}: ${hits[0]!.line}`);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  if (io.args.includes('--update')) {
    const lines = ['# 모델 이름 하드코딩 baseline — 신규/증가만 CI 실패.',
      '# 옮긴 뒤 `--update` 로 ratchet down 한다. 정본 레지스트리는 스캔에서 제외된다.'];
    for (const k of [...counts.keys()].sort()) lines.push(`${k} ${counts.get(k)}`);
    writeFileSync(BASELINE, `${lines.join('\n')}\n`);
    io.log(`[model-gate] baseline 재스냅샷 — 파일 ${counts.size}개 · 이름 ${total}개`);
    return 0;
  }

  const base = existsSync(BASELINE) ? readBaseline(readFileSync(BASELINE, 'utf8')) : new Map<string, number>();
  io.log(`[model-gate] scanned ${files.length} files; ${total} hardcoded model id(s) in ${counts.size} file(s).`);
  const bad: string[] = [];
  for (const [file, count] of counts) {
    if (changed && !changed.has(file)) continue;   // 바뀐 파일만 판정 — 남의 부채로 막지 않는다
    const allowed = base.get(file) ?? 0;
    if (count > allowed) bad.push(renderViolation(file, allowed, count, samples.get(file) ?? ''));
  }
  if (bad.length === 0) { io.log('[model-gate] PASS — 신규 모델 이름 하드코딩 없음.'); return 0; }
  io.error('[model-gate] FAIL — 신규 모델 이름 하드코딩 감지.');
  io.error('  🩸 근본(2026-09-25): 스크립트에 박힌 이름 중 «가장 흔한» 것이 낡은 것이라, 옆 파일을 베끼면 낡은 이름을 물려받는다.');
  for (const b of bad) io.error(b);
  return 1;
}

if (import.meta.main) process.exit(runModelHardcodeGate());
