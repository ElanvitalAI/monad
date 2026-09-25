// A4 재현 — 살아있는 PTY 행을 kind 별로 세고, 그 runId 가 «같은 뿌리의» 원장 파일을 갖는지 대조한다.
//   근거: 내부 문서 `REPORT-pty-observability-two-gaps-2026-08-07` §9 ⊕
//        내부 문서 `REPORT-run-ledger-gap-detection-and-daily-check-2026-08-11` (기계 판독 계약·일일 점검)
//
// ⛔⭐ 이 스크립트의 초판은 세 곳에서 «틀렸고», 무인 리뷰가 잡았다. 고친 자리를 남긴다:
//   ① 원장을 두 곳(`~/.monad` ⊕ 현재 checkout)만 색인하면서 manifest 는 «연합 전체»를 셌다
//      ⇒ 다른 뿌리의 원장이 「없음」으로 «오분류»된다. 이 저장소가 온종일 밟은 「한 뿌리만 본다」의 내 판본이었다.
//   ② runId 를 «전역 Set» 으로 합치면 서로 다른 뿌리의 동명 runId 가 거짓 양성이 된다 ⇒ 뿌리별로 짝짓는다.
//   ③ manifest 의 `alive` «컬럼»은 하트비트 기반이라 프로세스 생존과 «다른 자»다(리포트 §2e)
//      ⇒ `isProcessAlive` 로 실제 생존을 확인한다(관측 CLI 표면과 같은 자).
//
// ⛔⭐ 2026-08-12 리뷰 반영 — 넷을 더 고쳤다:
//   ④ `existsSync` 선행 검사를 «없앴다». 그 검사는 「없다」와 「못 봤다」를 부르기 «전에» 뭉갠다
//      (권한이 없는 부모 디렉터리면 `existsSync` 가 그냥 false ⇒ EACCES 가 「부재」로 둔갑).
//      ⇒ 이제 `readdirSync` 의 «예외 코드»만 본다: `ENOENT`=missing · 그 밖(EACCES 등)=unreadable.
//   ⑤ 원장 커버리지를 «파일 이름»이 아니라 «레코드»로 판정한다(`loadRunLedger` 로 열어 runId 대조).
//   ⑥ 기존 텍스트 산출(kind 표·불완전 경고·생산자 확인 힌트)을 «보존»하고 결손 블록을 뒤에 덧붙인다.
//   ⑦ 진입점을 `import.meta.main` 뒤로 옮겨 회귀 테스트가 이 모듈을 «부작용 없이» 부를 수 있게 했다.
//
// ⚠️⭐ 그리고 종전 계약과 «의도적으로 달라진» 두 자리 — ⛔ 「전부 보존했다」로 읽지 마라:
//   ⓐ **exit code**: 종전은 `unreadable` 이 있을 때만 1 이었다(결손 33건이어도 0). 이제 «결손 1건»도 1 이다
//      — 목적이 「사람이 표를 읽는다」에서 「cron 이 실패로 알린다」로 바뀌었기 때문이다.
//   ⓑ **`뿌리별 원장 파일 합계`**: 종전은 `.jsonl` 이면 이름을 안 보고 셌다. 이제 runId 규약 이름만 세고
//      나머지는 `ledgerEvidence.nonRunIdFiles` 로 «옮겼다»(대조 상대가 없는 이름은 분모가 아니다).
//   근거·마이그레이션 = 내부 문서 `REPORT-run-ledger-gap-detection-and-daily-check-2026-08-11` §「종전 계약과 달라진 것」.
import { accessSync, constants, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { debug } from '../../src/debug/log.js';
import { ptyManifestTargets, type PtyManifestTarget } from '../../src/domains/fleet.js';
import { normalizeRunId } from '../../src/harness/harness-space.js';
import { isProcessAlive, listPtyManifestRowsAt, type PtyManifestRow } from '../../src/pty-shell/pty-manifest.js';
import { loadRunLedger, measureRunLedgerGaps, type RunLedgerGapMeasurement, type RunLedgerGapRoot } from '../../src/self-implement/run-ledger.js';

/** `<stateDir>/pty/manifest.db` → `<stateDir>/run-ledger` (핸들러 handleTerminalRunGoal 과 같은 유도). */
export function ledgerDirFor(manifestDbPath: string): string {
  return join(dirname(dirname(manifestDbPath)), 'run-ledger');
}

/** 한 뿌리의 원장 색인 결과. ⛔ 「없다」·「못 봤다」·「이름만 있고 레코드가 없다」를 «다른 값»으로 돌려준다. */
export interface LedgerEvidence {
  /** 레코드로 «증명된» run id 만 담는다 — 이름만 맞는 빈 파일·손상 파일은 들어오지 않는다. */
  readonly ids: Set<string>;
  readonly status: 'read' | 'missing' | 'unreadable';
  /** runId 이름 규약을 만족하는 `.jsonl` 파일 수(레코드 판독 전). */
  readonly filesSeen: number;
  /** 파일은 있으나 유효 레코드가 0인 원장 수. */
  readonly emptyFiles: number;
  /** JSON·스키마·runId 불일치로 레코드를 못 믿는 원장 수. */
  readonly malformedFiles: number;
  /** `.jsonl` 이지만 이름이 runId 규약(`normalizeRunId` 산출 집합)이 아닌 파일 수. */
  readonly nonRunIdFiles: number;
}

export interface LedgerScanDeps {
  /** 디렉터리의 «정규 파일» 이름만. 기본값은 실제 fs. */
  readonly list?: (dir: string) => readonly string[];
  readonly read?: (path: string) => string;
}

function defaultList(dir: string): string[] {
  // ⛔ `.jsonl` «정규 파일»만 — 이름만 맞는 디렉터리도 세면 없는 runId 를 만들어 낸다.
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isFile() ? [entry.name] : []));
}

function errorCode(error: unknown): string | null {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * 한 뿌리의 `run-ledger` 디렉터리를 «읽기 전용»으로 색인한다.
 *
 * ⛔⭐ 선행 `existsSync` 를 두지 않는다(리뷰 지적 1) — 존재 검사와 열람은 «다른 권한»이고, 그 사이에
 *   파일계가 바뀔 수도 있다. 부재 판정은 오직 `ENOENT` 예외로만 내리고, 나머지 I/O 오류(EACCES·EIO…)는
 *   `unreadable` 로 «보존»한다. 「못 봤다」를 「없다」로 접으면 그 뿌리가 결손 0 으로 «보인다».
 * ⭐ 커버리지는 레코드로 증명한다(리뷰 지적 4) — 파일 이름이 아니라 `loadRunLedger` 가 파싱한 레코드의
 *   `runId` 가 파일 이름과 같을 때만 covered 다. 빈 원장·손상 원장은 covered 가 «아니다».
 */
export function ledgerIdsAt(dir: string, deps: LedgerScanDeps = {}): LedgerEvidence {
  const list = deps.list ?? defaultList;
  const read = deps.read ?? ((path: string) => readFileSync(path, 'utf8'));
  const ids = new Set<string>();
  let names: readonly string[];
  try {
    names = list(dir);
  } catch (error) {
    const code = errorCode(error);
    const status = code === 'ENOENT' ? 'missing' : 'unreadable';
    debug.log('self-implement.run-ledger-gaps', 'ledger-dir-unlistable', { dir, code, status });
    return { ids, status, filesSeen: 0, emptyFiles: 0, malformedFiles: 0, nonRunIdFiles: 0 };
  }
  let status: LedgerEvidence['status'] = 'read';
  let filesSeen = 0;
  let emptyFiles = 0;
  let malformedFiles = 0;
  let nonRunIdFiles = 0;
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const runId = name.slice(0, -'.jsonl'.length);
    // ⛔ runId 계약은 `normalizeRunId` 하나다 — 그 산출 집합 밖의 이름은 원장 파일로 «세지 않는다»
    //   (`runLedgerPath` 가 그런 이름을 거부하므로 여기서 세면 대조 상대가 없는 유령이 된다).
    if (!runId || runId !== normalizeRunId(runId)) {
      nonRunIdFiles += 1;
      continue;
    }
    filesSeen += 1;
    let raw: string;
    try {
      raw = read(join(dir, name));
    } catch (error) {
      const code = errorCode(error);
      if (code === 'ENOENT') continue; // 나열과 열람 사이에 지워진 파일 — 부재이지 판독 불가가 아니다.
      status = 'unreadable';
      debug.log('self-implement.run-ledger-gaps', 'ledger-file-unreadable', { dir, runId, code });
      continue;
    }
    try {
      // ⭐ 레코드 계약 재사용 — `loadRunLedger` 가 줄마다 runId 일치까지 검증한다(자기 정규식 금지).
      const entries = loadRunLedger(runId, dir, () => raw) ?? [];
      if (entries.length > 0) ids.add(runId);
      else {
        emptyFiles += 1;
        debug.log('self-implement.run-ledger-gaps', 'ledger-file-empty', { dir, runId });
      }
    } catch (error) {
      malformedFiles += 1;
      debug.log('self-implement.run-ledger-gaps', 'ledger-file-malformed', { dir, runId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ids, status, filesSeen, emptyFiles, malformedFiles, nonRunIdFiles };
}

/** 종전 판(2026-08-07)이 내던 텍스트 산출의 재료 — ⛔ 항목·수식을 그대로 보존한다(리뷰 지적 6). */
export interface PtyLedgerScopeLegacySummary {
  readonly byKind: Record<string, { rows: number; withRunId: number; withLedger: number }>;
  readonly ledgerFilesSeen: number;
  readonly rootsWithoutLedgerDir: number;
  readonly unreadableLedgerRoots: string[];
  readonly unreadableManifestRoots: string[];
}

/** 레코드 기반 커버리지 판정의 관측 요약 — 「이름만 있는 원장」이 몇이었는지를 산출에 남긴다. */
export interface LedgerEvidenceSummary {
  readonly filesSeen: number;
  readonly runIdsEvidenced: number;
  readonly emptyFiles: number;
  readonly malformedFiles: number;
  readonly nonRunIdFiles: number;
}

export interface PtyLedgerScopeScan {
  readonly roots: RunLedgerGapRoot[];
  readonly legacy: PtyLedgerScopeLegacySummary;
  readonly ledgerEvidence: LedgerEvidenceSummary;
}

export interface PtyLedgerScopeDeps {
  readonly listRows?: (dbPath: string) => PtyManifestRow[];
  readonly alive?: (pid: number) => boolean;
  readonly ledger?: (dir: string) => LedgerEvidence;
  /** manifest 판독 가능성 probe. 기본값은 `accessSync(dbPath, R_OK)`. */
  readonly manifestReadable?: (dbPath: string) => void;
}

/**
 * manifest 를 «읽을 수 있는지»를 따로 묻는다.
 *
 * ⛔⭐ `listPtyManifestRowsAt` 은 **fail-soft → `[]`** 다 — 권한 오류든 손상이든 «빈 목록»으로 돌아온다.
 *   그래서 그 호출을 try/catch 로 감싸는 것만으로는 `pty-manifest-root-unreadable` 이 «영영 안 뜬다»
 *   (「0 건」이 「못 읽음」을 삼킨다 — 이 저장소가 반복해 밟은 자리). ⇒ 열기 전에 한 번 «묻는다».
 * ⚠️ 한계: 이 probe 는 «권한/부재»만 가른다. 읽을 수는 있으나 «손상된» db 는 여전히 `read` 로 보이고
 *   행이 0 으로 나온다 — 그 축을 가르려면 리더 자체가 실패를 값으로 돌려줘야 한다(이 도구 범위 밖).
 */
function probeManifestReadable(dbPath: string): void {
  accessSync(dbPath, constants.R_OK);
}

/** 연합 전 뿌리를 읽기 전용으로 훑어 결손 분류기(`measureRunLedgerGaps`)의 입력과 종전 표를 함께 만든다. */
export function scanPtyLedgerScope(targets: readonly PtyManifestTarget[], deps: PtyLedgerScopeDeps = {}): PtyLedgerScopeScan {
  const listRows = deps.listRows ?? listPtyManifestRowsAt;
  const alive = deps.alive ?? isProcessAlive;
  const ledgerAt = deps.ledger ?? ((dir: string) => ledgerIdsAt(dir));
  const manifestReadable = deps.manifestReadable ?? probeManifestReadable;
  const roots: RunLedgerGapRoot[] = [];
  const byKind: Record<string, { rows: number; withRunId: number; withLedger: number }> = {};
  const unreadableLedgerRoots: string[] = [];
  const unreadableManifestRoots: string[] = [];
  let ledgerFilesSeen = 0;
  let rootsWithoutLedgerDir = 0;
  let emptyFiles = 0;
  let malformedFiles = 0;
  let nonRunIdFiles = 0;
  let runIdsEvidenced = 0;

  for (const target of targets) {
    const root = dirname(dirname(target.dbPath));
    let rows: PtyManifestRow[];
    // ⛔ manifest 를 «못 읽은» 뿌리는 조용히 빼지 않는다 — 그러면 「연합 전수」가 거짓말이 된다.
    try {
      manifestReadable(target.dbPath);
      rows = listRows(target.dbPath);
    } catch (error) {
      unreadableManifestRoots.push(target.name);
      debug.log('self-implement.run-ledger-gaps', 'manifest-unreadable', { root, name: target.name, error: error instanceof Error ? error.message : String(error) });
      // ⚠️ 여기 `ledgerStatus` 는 «안 본 값»이다 — manifest 를 못 읽은 뿌리는 분류기가 통째로 빼므로 산출에
      //   영향이 없다(그래서 어휘에 'unknown' 을 새로 만들지 않았다). 이 값을 다른 곳에서 읽지 마라.
      roots.push({ root, manifestStatus: 'unreadable', ledgerStatus: 'missing' });
      continue;
    }
    const ledger = ledgerAt(ledgerDirFor(target.dbPath));
    if (ledger.status === 'missing') rootsWithoutLedgerDir += 1;
    if (ledger.status === 'unreadable') unreadableLedgerRoots.push(target.name);
    ledgerFilesSeen += ledger.filesSeen;
    emptyFiles += ledger.emptyFiles;
    malformedFiles += ledger.malformedFiles;
    nonRunIdFiles += ledger.nonRunIdFiles;
    runIdsEvidenced += ledger.ids.size;

    const livePtys = rows.flatMap((row) => {
      // ③ 하트비트 컬럼이 아니라 «실제 프로세스 생존»으로 거른다(관측 CLI 와 같은 자).
      const pid = row.ptyPid > 0 ? row.ptyPid : row.ownerPid;
      return row.alive && pid > 0 && alive(pid) ? [{ kind: row.kind || '?', runId: row.runId || null }] : [];
    });
    roots.push({ root, manifestStatus: 'read', ledgerStatus: ledger.status, ledgerRunIds: ledger.ids, livePtys });

    // ⛔⭐ 종전 kind 표는 «원장을 못 읽은 뿌리를 제외»했다 — 그 계약을 그대로 둔다(리뷰 지적 6).
    //   새 결손 블록은 그 뿌리에서도 `live-pty-run-id-missing` 을 내지만(리뷰 지적 2), 그것은 «다른 산출»이다.
    if (ledger.status === 'unreadable') continue;
    for (const pty of livePtys) {
      byKind[pty.kind] ??= { rows: 0, withRunId: 0, withLedger: 0 };
      byKind[pty.kind]!.rows += 1;
      if (!pty.runId) continue;
      byKind[pty.kind]!.withRunId += 1;
      if (ledger.ids.has(pty.runId)) byKind[pty.kind]!.withLedger += 1;
    }
  }

  return {
    roots,
    legacy: { byKind, ledgerFilesSeen, rootsWithoutLedgerDir, unreadableLedgerRoots, unreadableManifestRoots },
    ledgerEvidence: { filesSeen: ledgerFilesSeen, runIdsEvidenced, emptyFiles, malformedFiles, nonRunIdFiles },
  };
}

/** `--json` 산출 — 결손 계약(`measureRunLedgerGaps`)에 레코드 증거 요약을 «덧붙인» 형태. */
export function ptyLedgerScopeJson(scan: PtyLedgerScopeScan, measurement: RunLedgerGapMeasurement): RunLedgerGapMeasurement & { ledgerEvidence: LedgerEvidenceSummary } {
  return { ...measurement, ledgerEvidence: scan.ledgerEvidence };
}

/**
 * 기본(비-JSON) 텍스트 산출.
 *
 * ⛔⭐ 앞 블록은 **2026-08-07 판의 항목·형식 그대로**다(리뷰 지적 6) — 이 스크립트를 눈으로 읽던 절차
 *   (`내부 문서 `REPORT-pty-observability-two-gaps-2026-08-07`` §9)가 그 표를 참조하므로 «빼지 않는다».
 *   뒤 블록이 이번 판이 더한 결손 요약이고, 자동화는 그 대신 `--json` 을 읽는다.
 */
export function renderPtyLedgerScope(scan: PtyLedgerScopeScan, measurement: RunLedgerGapMeasurement): string {
  const { legacy } = scan;
  const lines: string[] = [];
  lines.push(`뿌리별 원장 파일 합계: ${legacy.ledgerFilesSeen} · 원장 디렉터리가 «없는» 뿌리: ${legacy.rootsWithoutLedgerDir}`);
  if (legacy.unreadableLedgerRoots.length || legacy.unreadableManifestRoots.length) {
    // ⛔⭐ 「못 봤다」를 «산출에» 낸다. 이것 없이는 아래 수가 「전수」라고 말할 수 없다.
    lines.push(`⚠️ 불완전 — 원장 못 읽음 ${legacy.unreadableLedgerRoots.length}뿌리 · manifest 못 읽음 ${legacy.unreadableManifestRoots.length}뿌리`);
    for (const name of [...legacy.unreadableLedgerRoots, ...legacy.unreadableManifestRoots].slice(0, 5)) lines.push(`   ${name}`);
  }
  lines.push('kind\t전체\trunId\t원장');
  for (const [kind, value] of Object.entries(legacy.byKind)) lines.push(`${kind}\t${value.rows}\t${value.withRunId}\t${value.withLedger}`);
  lines.push('');
  lines.push('⛔ 「원장 없음」은 파일 부재이지 계약이 아니다. 계약은 «생산자»로 확인한다:');
  lines.push("   rg -uu -n 'appendRunLedgerEntry' src/ --glob '!*.test.ts'   ⇒ 호출자는 orchestrator ⊕ harness-membrane 둘뿐");
  lines.push('');
  lines.push(`roots=${measurement.rootsMeasured} livePtys=${measurement.livePtyCount} complete=${measurement.complete}`);
  for (const [kind, count] of Object.entries(measurement.counts)) lines.push(`${kind}=${count}`);
  for (const gap of measurement.gaps) lines.push(`gap kind=${gap.kind} root=${gap.root}${gap.ptyKind ? ` ptyKind=${gap.ptyKind}` : ''}${gap.runId ? ` runId=${gap.runId}` : ''}`);
  lines.push(`ledgerEvidence files=${scan.ledgerEvidence.filesSeen} runIds=${scan.ledgerEvidence.runIdsEvidenced} empty=${scan.ledgerEvidence.emptyFiles} malformed=${scan.ledgerEvidence.malformedFiles} nonRunIdNamed=${scan.ledgerEvidence.nonRunIdFiles}`);
  lines.push(`note: ${measurement.note}`);
  return lines.join('\n');
}

/**
 * 조회 대상 해석. 기본은 연합 전수(`ptyManifestTargets`)이고, 테스트는 env 로 «우주를 못 박는다».
 *
 * ⚠️ 이 심이 필요한 이유: `ptyManifestTargets` 는 prod(`~/.monad`)를 «항상» 포함하므로, 그것만으로는
 *   격리 fixture 만 재는 실물 실행을 만들 수 없다(= 진입점 회귀 테스트가 기계 상태에 흔들린다).
 * ⛔ 값이 깨졌으면 «조용히 전수로 되돌아가지 않는다» — 어느 우주를 쟀는지 모르는 산출이 제일 나쁘다.
 */
export function resolvePtyLedgerScopeTargets(env: NodeJS.ProcessEnv = process.env): PtyManifestTarget[] {
  const raw = env.MONAD_PTY_LEDGER_SCOPE_TARGETS?.trim();
  if (!raw) return ptyManifestTargets({ includeTest: true });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`MONAD_PTY_LEDGER_SCOPE_TARGETS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== 'object' || typeof (entry as PtyManifestTarget).name !== 'string' || typeof (entry as PtyManifestTarget).dbPath !== 'string')) {
    throw new Error('MONAD_PTY_LEDGER_SCOPE_TARGETS must be a JSON array of { name, dbPath }');
  }
  return (parsed as PtyManifestTarget[]).map((entry) => ({ name: entry.name, dbPath: entry.dbPath }));
}

export interface PtyLedgerScopeRun {
  readonly stdout: string;
  readonly exitCode: number;
  readonly measurement: RunLedgerGapMeasurement;
  readonly scan: PtyLedgerScopeScan;
}

/** 진입점 본문 — 산출과 종료 코드를 «값으로» 돌려준다(테스트가 프로세스 없이도 같은 경로를 탄다). */
export function runPtyLedgerScope(argv: readonly string[], targets: readonly PtyManifestTarget[] = resolvePtyLedgerScopeTargets(), deps: PtyLedgerScopeDeps = {}): PtyLedgerScopeRun {
  const scan = scanPtyLedgerScope(targets, deps);
  const measurement = measureRunLedgerGaps(scan.roots);
  const stdout = argv.includes('--json')
    ? JSON.stringify(ptyLedgerScopeJson(scan, measurement))
    : renderPtyLedgerScope(scan, measurement);
  // ⛔ 불완전한 측정도, 결손도 exit 0 으로 「성공」이라 말하지 않는다.
  const exitCode = !measurement.complete || measurement.gaps.length > 0 ? 1 : 0;
  debug.log('self-implement.run-ledger-gaps', 'measured', {
    roots: measurement.rootsMeasured, livePtys: measurement.livePtyCount, complete: measurement.complete,
    gaps: measurement.gaps.length, counts: measurement.counts, exitCode,
  });
  return { stdout, exitCode, measurement, scan };
}

if (import.meta.main) {
  // ⛔⭐⭐ **관측 sink 를 «먼저» 건다** — `debug.log` 만으로는 `logs.db` 에 «안 닿는다».
  //   📏 실측(2026-08-12): 이 줄 없이 돌렸더니 `monad logs --all --include-test --category
  //   self-implement.run-ledger-gaps` 가 «0건»이었다 — 계측은 있는데 sink 가 없던 것(「0 건의 세 뜻」 ⓒ).
  //   ⇒ fail-open: 관측 배선 실패가 «측정 자체»를 막지 않는다(`cli-doc-coverage.ts` 선례와 같은 자).
  try {
    const { registerStandaloneLogSink } = await import('../../src/domains/standalone-log-sink.js');
    await registerStandaloneLogSink('pty-ledger-scope');
  } catch { /* fail-open */ }
  const result = runPtyLedgerScope(process.argv.slice(2));
  console.log(result.stdout);
  if (result.exitCode !== 0) process.exit(result.exitCode);
}
