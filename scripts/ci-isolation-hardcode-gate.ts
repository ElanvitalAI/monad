/**
 * 격리 하드코딩 ratchet 게이트 (Instance Identity 수렴 · Phase C · forcing function).
 *
 * 왜: test↔prod 격리 누출이 반복되는 근본은 "인스턴스 경로 정체성이 1급 객체가 아니고,
 * 모든 스토어가 반드시 그걸 거치도록 강제되지 않는다"이다(PLAN §0). resolver(계약)를
 * 아무리 잘 만들어도 강제가 없으면 다음 스토어 작성자가 또 `join(homedir(), '.elanous', …)`
 * 를 하드코딩한다 → 5번째 누출. 이 게이트가 그 "강제(③)" 조각이다.
 *
 * 정책(ci-typecheck-changed 와 동형 "부채 관용·신규 차단"): main 은 이미 다수의
 * homedir+.elanous 하드코딩을 가진다(정당한 resolver 정의 + 미수복 위반 D/E/F 대상).
 * 통짜 금지는 즉시 레드 → 무시되는 가짜 게이트. 그래서 **현 baseline(파일별 count)을
 * 스냅샷**하고 그 초과(신규 드리프트)만 실패시킨다. D/E/F 가 위반을 resolver 로 옮기며
 * `--update` 로 baseline 을 ratchet down 한다. 정당한 resolver 정의는 baseline 에 영구
 * 잔류(= 인가된 단일 통로).
 *
 * 사용:
 *   bun run scripts/ci-isolation-hardcode-gate.ts            # 검사(신규 드리프트 시 exit 1)
 *   bun run scripts/ci-isolation-hardcode-gate.ts --update   # baseline 재스냅샷(수복/이동 후)
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const BASELINE = join(import.meta.dir, 'isolation-hardcode-baseline.txt');
const LINE_PREVIEW_LIMIT = 160;

type HardcodeCandidate = {
  lineNumber: number;
  line: string;
};

type HardcodeScanEntry = {
  count: number;
  candidates: HardcodeCandidate[];
};

/** 드리프트 신호: 같은 줄에 `homedir()` 와 `.elanous` 가 함께 = resolver 우회 후보.
 *  (env 재이중화 ELANOUS_HOME 등은 Phase F 스코프 — 여기선 homedir+.elanous 만.) */
/** `.elanous` 가 «경로 조각»으로 쓰였나 — 앞이 따옴표나 `/` 일 때만(`com.elanous.nexus.plist` 같은 이름 속 `.elanous` 는 아니다 · 2026-09-24 오탐). */
const ELANOUS_PATH_SEGMENT = /['"`/]\.elanous(?:-test)?(?=['"`/]|$)/;

export function isHardcodeLine(line: string): boolean {
  if (isCommentOnlyLine(line)) return false;
  return line.includes('homedir()') && ELANOUS_PATH_SEGMENT.test(line);
}

/** 이 줄이 «온전히 주석»인가.
 *
 *  ⛔⭐ 🩸 2026-09-11 실측(`OBS-T527`): 이 게이트가 ***「그러지 말라」고 적은 주석을 코드로 읽어***
 *  착지를 막았다. 잡힌 줄은 이랬다:
 *  ```
 *  src/nexus/api/media-store.ts:35
 *    *  ⛔⭐ 경로를 «손으로» 짓지 않는다 — `join(homedir(), '.elanous', …)` 는 …
 *  ```
 *  ⇒ 이 저장소는 함정을 «주석에 인용»하는 문화라, 규율을 적을수록 게이트에 걸린다.
 *  ⛔ 그래서 「문면을 바꿔 피한다」는 처방이 «아니다** — 그러면 규율이 흐려진다.
 *
 *  ⚠️ **줄 «전체»가 주석일 때만** 건너뛴다. `const p = join(homedir(), '.elanous'); // 메모` 처럼
 *  ***코드 뒤에 주석이 붙은 줄은 계속 «문다»*** — 그 줄은 실제로 도는 코드다.
 *  ⛔ 이 게이트는 과탐 쪽으로 틀리는 것이 «안전»하므로, 애매하면 주석으로 «안» 본다.
 */
export function isCommentOnlyLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
}

/** 파일별 하드코딩 라인 수와 후보 위치 스캔. */
function scan(root = ROOT): Map<string, HardcodeScanEntry> {
  const files: string[] = [];
  walk(join(root, 'src'), files);
  const entries = new Map<string, HardcodeScanEntry>();
  for (const f of files) {
    const candidates = scanHardcodeCandidates(readFileSync(f, 'utf8'));
    if (candidates.length > 0) entries.set(relative(root, f), { count: candidates.length, candidates });
  }
  return entries;
}

/** `homedir()` 값을 받은 이름들(파일 단위). 🩸 2026-09-24(🅢 T3): 탐지가 «같은 줄에 `homedir()` ⊕ `.elanous`» 뿐이라
 *  `const home = deps.home ?? homedir(); join(home, '.elanous', …)` 처럼 «두 줄로 나눈» 하드코딩을 못 봤다
 *  (표본: `src/config.ts` `resolveDataDir` · `src/domains/schedule-registry.ts` `cronRepoRoot`).
 *  받는 모양: `const|let|var <이름> = …homedir()` · 매개변수 기본값 `<이름>: T = homedir()` / `<이름> = homedir()`. */
export function homedirAliases(source: string): Set<string> {
  const names = new Set<string>();
  for (const line of source.split('\n')) {
    if (isCommentOnlyLine(line) || !line.includes('homedir()')) continue;
    const declared = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*[^;]*\bhomedir\(\)/.exec(line);
    if (declared?.[1]) names.add(declared[1]);
    for (const param of line.matchAll(/([A-Za-z_$][\w$]*)\s*(?::\s*[^=,)]+)?=\s*homedir\(\)/g)) {
      if (param[1] && param[1] !== 'const' && param[1] !== 'let' && param[1] !== 'var') names.add(param[1]);
    }
  }
  return names;
}

export function scanHardcodeCandidates(source: string): HardcodeCandidate[] {
  const aliases = [...homedirAliases(source)];
  const aliasPattern = aliases.length ? new RegExp(`\\b(?:${aliases.map((name) => name.replace(/[$]/g, '\\$')).join('|')})\\b`) : null;
  return source.split('\n').flatMap((line, index) => (
    isHardcodeLine(line) || (aliasPattern !== null && !isCommentOnlyLine(line) && ELANOUS_PATH_SEGMENT.test(line) && aliasPattern.test(line))
      ? [{ lineNumber: index + 1, line }]
      : []
  ));
}

function trimLinePreview(line: string): string {
  const t = line.trim();
  return t.length > LINE_PREVIEW_LIMIT ? `${t.slice(0, LINE_PREVIEW_LIMIT - 1)}…` : t;
}

export function renderIsolationObservation(scannedFileCount: number, hardcodingCount: number): string {
  return `[isolation-gate] scanned ${scannedFileCount} files; ${hardcodingCount} hardcoding observation(s).`;
}

export function renderViolation(file: string, allowed: number, entry: HardcodeScanEntry): string {
  const overBaseline = entry.count - allowed;
  const lines = [`  ${file}: ${allowed} → ${entry.count} (+${overBaseline} 신규 하드코딩 · 후보 ${entry.candidates.length}줄, baseline 초과 ${overBaseline}줄)`];
  for (const candidate of entry.candidates) {
    lines.push(`    - line ${candidate.lineNumber}: ${trimLinePreview(candidate.line)}`);
  }
  return lines.join('\n');
}

function loadBaseline(root = ROOT): Map<string, number> {
  const m = new Map<string, number>();
  const baseline = join(root, 'scripts', 'isolation-hardcode-baseline.txt');
  if (!existsSync(baseline)) return m;
  for (const line of readFileSync(baseline, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [count, ...rest] = t.split('\t');
    const file = rest.join('\t').trim();
    if (file) m.set(file, parseInt(count, 10) || 0);
  }
  return m;
}

function writeBaseline(entries: Map<string, HardcodeScanEntry>): void {
  const lines = [...entries.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([f, entry]) => `${entry.count}\t${f}`);
  const header = [
    '# 격리 하드코딩 baseline (homedir()+.elanous 라인 수 · 파일별) — Phase C ratchet 게이트.',
    '# 신규/증가만 CI 실패. 위반 수복(resolver 이동) 후 `--update` 로 ratchet down.',
    '# 정당한 resolver 정의(memory-db-path·session/index·state-paths·fleet·pty-manifest 등)는 영구 잔류.',
    `# total=${[...entries.values()].reduce((a, entry) => a + entry.count, 0)} · files=${entries.size}`,
    '',
  ].join('\n');
  writeFileSync(BASELINE, header + lines.join('\n') + '\n');
}

type IsolationGateIo = {
  args?: string[];
  cwd?: string;
  scan?: () => Map<string, HardcodeScanEntry>;
  loadBaseline?: () => Map<string, number>;
  writeBaseline?: (entries: Map<string, HardcodeScanEntry>) => void;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function parseChangedFiles(args: readonly string[]): Set<string> | null {
  const changedFilesAt = args.indexOf('--changed-files');
  if (changedFilesAt < 0) return null;
  const files: string[] = [];
  for (const arg of args.slice(changedFilesAt + 1)) {
    if (arg.startsWith('--')) break;
    files.push(arg);
  }
  return new Set(files);
}

export function runIsolationHardcodeGate(io: IsolationGateIo = {}): number {
  const args = io.args ?? process.argv.slice(2);
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const changedFiles = parseChangedFiles(args);
  if (changedFiles !== null && args.includes('--update')) {
    error('[isolation-gate] FAIL — --changed-files 와 --update 를 함께 쓸 수 없습니다.');
    return 1;
  }
  const root = io.cwd ?? ROOT;
  const scanned = io.scan ? io.scan() : scan(root);
  const current = new Map([...scanned.entries()].filter(([file]) => changedFiles === null || changedFiles.has(file)));
  const total = [...current.values()].reduce((a, entry) => a + entry.count, 0);

  log(renderIsolationObservation(current.size, total));

  if (args.includes('--update')) {
    (io.writeBaseline ?? writeBaseline)(current);
    log(`[isolation-gate] baseline 갱신 — ${current.size} 파일 · ${total} 하드코딩.`);
    return 0;
  }

  const loadedBaseline = io.loadBaseline ? io.loadBaseline() : loadBaseline(root);
  const baseline = changedFiles === null
    ? loadedBaseline
    : new Map([...loadedBaseline.entries()].filter(([file]) => changedFiles.has(file)));
  const violations: string[] = [];
  for (const [file, entry] of current) {
    const allowed = baseline.get(file) ?? 0;
    if (entry.count > allowed) violations.push(renderViolation(file, allowed, entry));
  }
  // ratchet 정보(실패 아님): baseline 이 실제보다 큰 = 수복됐으니 --update 권장.
  const ratcheted: string[] = [];
  for (const [file, allowed] of baseline) {
    const n = current.get(file)?.count ?? 0;
    if (n < allowed) ratcheted.push(`  ${file}: ${allowed} → ${n} (--update 로 baseline 낮추세요)`);
  }

  if (violations.length > 0) {
    error('[isolation-gate] FAIL — 신규 homedir+.elanous 하드코딩 감지.');
    error('  격리 누출 근본(PLAN §0): 스토어 경로는 resolver(elanousStateRoot/memoryDbPath/');
    error('  getElanousConfigDir/instanceRoot)를 거쳐야 test↔prod 격리가 성립합니다.');
    error(violations.join('\n'));
    if (ratcheted.length) { error('  (참고 · 수복 반영 필요):'); error(ratcheted.join('\n')); }
    return 1;
  }

  log(`[isolation-gate] PASS — 신규 하드코딩 없음 (baseline ${total} 유지${ratcheted.length ? ` · ${ratcheted.length} 파일 수복됨→--update 권장` : ''}).`);
  if (ratcheted.length) log(ratcheted.join('\n'));
  return 0;
}

if (import.meta.main) process.exit(runIsolationHardcodeGate());
