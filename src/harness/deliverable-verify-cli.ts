import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { Option, type Command } from 'commander';
import { artifactLaunchDeclarationClassification, inspectArtifactLaunchDeclaration, type ArtifactLaunchDeclarationClassification, type ArtifactLaunchDeclarationStopPosition } from '../self-implement/goal-author.js';
import { observeDeliverables, type DeliverableObservationDeps, type DeliverableObservationResult } from './deliverable-observation.js';
import { launchGoalArtifact, type ArtifactLaunchDeps, type ArtifactLaunchResult, type ArtifactPortAttribution } from './artifact-launcher.js';

export type DeliverableVerifyStatus = 'observed' | 'no-launch-declaration' | 'no-port-declaration' | 'invalid-launch-declaration' | 'read-error' | 'launch-failed';

export interface DeliverableVerifyReport {
  readonly status: DeliverableVerifyStatus;
  readonly goalPath: string;
  readonly target?: string;
  readonly observation?: DeliverableObservationResult;
  readonly errors?: readonly string[];
  /** `--launch` 로 «켜서» 봤을 때만 — 포트 응답을 우리 자식에게 귀속시킬 수 있었나. */
  readonly attribution?: ArtifactPortAttribution;
  /** 켜지 못했을 때의 사유(어휘는 기동기가 갖는다). */
  readonly launchFailure?: string;
  /** 기동 선언이 없을 때만, 저작 누락 가능성을 분류한다. */
  readonly artifactLaunchDeclarationClassification?: ArtifactLaunchDeclarationClassification;
  /** 선언 읽기가 첫 산문에서 멈췄을 때 그 위치를 보존한다. */
  readonly declarationStoppedAt?: ArtifactLaunchDeclarationStopPosition;
}

export interface DeliverableVerifyDeps extends DeliverableObservationDeps {
  readGoal?: (path: string) => Promise<string>;
  /**
   * ⭐ `--launch` 의 실행 심. 기본은 `launchGoalArtifact`.
   * ⛔ 이 모듈은 프로세스를 «직접» 띄우지 않는다 — 수명주기는 기동기가 소유한다.
   */
  launch?: (goalPath: string, deps: ArtifactLaunchDeps) => Promise<ArtifactLaunchResult>;
  /** 관측 «계층» 심(테스트용). 기본은 `observeDeliverables`. */
  observe?: typeof observeDeliverables;
  /**
   * ⛔ 기동기에 넘길 저장소 뿌리. 이 모듈은 `process.cwd()` 를 «읽지 않는다» —
   *   맥락은 CLI 경계에서 «한 번» 정해지고 아래로는 인자로만 내려간다(리뷰 must-fix 9차).
   */
  repositoryRoot?: string;
  /** 포트 소유 조회 심. 기본은 `defaultPortOwnerPid`. */
  portOwnerPid?: (port: number) => number | undefined;
}

const taskIdFor = (goalPath: string): string => goalPath;

/**
 * ⭐ 기본 포트 소유 조회 — 그 포트를 «듣고 있는» pid.
 * ⛔ 도구가 없거나 조회가 실패하면 undefined 를 낸다. 「없다」로도 「우리 것」으로도 접지 않는다.
 */
export function defaultPortOwnerPid(port: number): number | undefined {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = out.split('\n').map((line) => line.trim()).find((line) => line !== '');
    if (first === undefined) return undefined;
    const pid = Number.parseInt(first, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;   // ⛔ 못 쟀다
  }
}

/**
 * ⭐ `--launch` 경로 — 산출물을 «켜서» 보고 «반드시» 끈다.
 * ⛔ 정리는 성공·실패·예외 어느 경로에서도 난다(finally).
 */
export async function launchAndVerifyGoalDeliverable(
  goalPath: string,
  repositoryRoot: string,
  deps: DeliverableVerifyDeps = {},
): Promise<DeliverableVerifyReport> {
  const launch = deps.launch ?? launchGoalArtifact;
  // ① 기본 경로에도 «귀속 확인»을 꽂는다 — 안 꽂으면 실제 실행이 언제나 unverified 다(리뷰 must-fix 9차).
  const launched = await launch(goalPath, { repositoryRoot, portOwnerPid: deps.portOwnerPid ?? defaultPortOwnerPid });
  if (launched.ok !== true) {
    return { status: 'launch-failed', goalPath, launchFailure: launched.reason, ...(launched.detail ? { errors: [launched.detail] } : {}) };
  }
  try {
    const observe = deps.observe ?? observeDeliverables;
    const observation = await observe([{ taskId: taskIdFor(goalPath), target: launched.handle.url }], { verify: deps.verify, backend: deps.backend });
    return { status: 'observed', goalPath, target: launched.handle.url, observation, attribution: launched.handle.attribution };
  } finally {
    await launched.handle.stop();
  }
}

export async function verifyGoalDeliverable(goalPath: string, deps: DeliverableVerifyDeps = {}): Promise<DeliverableVerifyReport> {
  const readGoal = deps.readGoal ?? ((path: string) => readFile(path, 'utf8'));
  let document: string;
  try {
    document = await readGoal(goalPath);
  } catch (error) {
    return { status: 'read-error', goalPath, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const inspection = inspectArtifactLaunchDeclaration(document);
  if (inspection.declaration === undefined) {
    return {
      status: 'no-launch-declaration',
      goalPath,
      artifactLaunchDeclarationClassification: artifactLaunchDeclarationClassification(document),
    };
  }
  const { declaration } = inspection;
  const declarationStoppedAt = inspection.stoppedAt;
  if (declaration.errors.length) return { status: 'invalid-launch-declaration', goalPath, errors: declaration.errors, ...(declarationStoppedAt !== undefined && { declarationStoppedAt }) };
  if (declaration.port === undefined) return { status: 'no-port-declaration', goalPath, ...(declarationStoppedAt !== undefined && { declarationStoppedAt }) };

  const target = `http://127.0.0.1:${declaration.port}`;
  const observation = await observeDeliverables([{ taskId: taskIdFor(goalPath), target }], { verify: deps.verify, backend: deps.backend });
  return { status: 'observed', goalPath, target, observation, ...(declarationStoppedAt !== undefined && { declarationStoppedAt }) };
}

export function renderDeliverableVerifyReport(report: DeliverableVerifyReport): string[] {
  const lines = [`[deliverable verify] ${report.goalPath}`];
  if (report.status !== 'observed') {
    lines.push(`status: ${report.status}`);
    if (report.declarationStoppedAt !== undefined) lines.push(`launch-declaration-stopped-at: line ${report.declarationStoppedAt.line}: ${report.declarationStoppedAt.text}`);
    if (report.artifactLaunchDeclarationClassification === 'absent-with-signal') {
      lines.push(`launch-declaration-classification: ${report.artifactLaunchDeclarationClassification}`);
    }
    if (report.launchFailure !== undefined) lines.push(`launch-failure: ${report.launchFailure}`);
    for (const error of report.errors ?? []) lines.push(`error: ${error}`);
    return lines;
  }

  lines.push(`status: observed`, `target: ${report.target}`);
  if (report.declarationStoppedAt !== undefined) lines.push(`launch-declaration-stopped-at: line ${report.declarationStoppedAt.line}: ${report.declarationStoppedAt.text}`);
  if (report.attribution !== undefined) lines.push(`attribution: ${report.attribution}`);
  const taskId = taskIdFor(report.goalPath);
  const measured = report.observation!.deployFindings.get(taskId);
  if (measured) {
    const findings = measured.findings ?? [];
    if (findings.length === 0) lines.push('measurement: clean');
    for (const finding of findings) lines.push(`finding: ${finding.kind} (${finding.certainty}) — ${finding.message}`);
  }
  for (const unmeasured of report.observation!.unmeasured) {
    lines.push(`unmeasured: ${unmeasured.reason}`);
  }
  return lines;
}

export interface InstallDeliverableVerifyCliDeps extends DeliverableVerifyDeps {
  write?: (text: string) => void;
  setExitCode?: (code: number) => void;
}

export function installDeliverableVerifyCliCommand(harnessCmd: Command, deps: InstallDeliverableVerifyCliDeps = {}): Command {
  const write = deps.write ?? ((text: string) => process.stdout.write(text));
  const setExitCode = deps.setExitCode ?? ((code: number) => { process.exitCode = code; });
  return harnessCmd
    .command('deliverable-verify <goal-path>')
    .description('골 문서의 Port 선언 주소를 관측한다. 기본은 이미 도는 것만 본다 — --launch 면 산출물을 켜서 보고 반드시 끈다.')
    .option('--launch', '⭐ 골의 기동 선언대로 산출물을 «켜서» 보고 끝나면 반드시 끈다(기본: 켜지 않는다)')
    .addOption(new Option('--backend <backend>', '관측 백엔드(cdp 또는 aside)').choices(['cdp', 'aside']).default('cdp'))
    .action(async (goalPath: string, options: { launch?: boolean; backend: DeliverableObservationDeps['backend'] }) => {
      // ⭐ 맥락을 «여기서 한 번» 정한다 — 아래 층은 인자로만 받는다.
      const repositoryRoot = deps.repositoryRoot ?? process.cwd();
      const verifyDeps = { ...deps, backend: options.backend };
      const report = options.launch === true
        ? await launchAndVerifyGoalDeliverable(goalPath, repositoryRoot, verifyDeps)
        : await verifyGoalDeliverable(goalPath, verifyDeps);
      write(`${renderDeliverableVerifyReport(report).join('\n')}\n`);
      if (report.status === 'read-error') setExitCode(1);
    });
}
