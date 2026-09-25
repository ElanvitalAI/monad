import type { DaemonTerminalSummary } from '@/lib/daemon-client';
import { relativeTime } from '@/lib/sessions-store-api';

interface PtyTerminalRowSummary {
  title: string;
  details: string[];
}

const RUN_ID_DISPLAY_LENGTH = 8;
const DETAIL_VALUE_DISPLAY_LENGTH = 32;

function compactRunId(runId: string): string {
  if (runId.length <= RUN_ID_DISPLAY_LENGTH) return runId;
  return `${runId.slice(0, RUN_ID_DISPLAY_LENGTH)}…`;
}

function compactDetailValue(value: string): string {
  if (value.length <= DETAIL_VALUE_DISPLAY_LENGTH) return value;
  return `…${value.slice(-DETAIL_VALUE_DISPLAY_LENGTH)}`;
}

function compactSessionPath(value: string): string {
  if (value.length <= DETAIL_VALUE_DISPLAY_LENGTH) return value;
  return `${value.slice(0, DETAIL_VALUE_DISPLAY_LENGTH - 1)}…`;
}

function compactLocation(
  treeName: DaemonTerminalSummary['treeName'],
  worktreeName: DaemonTerminalSummary['worktreeName'],
  workdir: DaemonTerminalSummary['workdir'],
): string | undefined {
  const location = [treeName, worktreeName].filter(Boolean).join('/') || workdir;
  if (!location || !treeName || location.length <= DETAIL_VALUE_DISPLAY_LENGTH) return location && compactDetailValue(location);
  if (!worktreeName) return treeName.length <= DETAIL_VALUE_DISPLAY_LENGTH
    ? treeName
    : `…${treeName.slice(-(DETAIL_VALUE_DISPLAY_LENGTH - 1))}`;

  const worktreeTailLength = DETAIL_VALUE_DISPLAY_LENGTH - treeName.length - 2;
  if (worktreeTailLength <= 0) return treeName.length <= DETAIL_VALUE_DISPLAY_LENGTH
    ? treeName
    : `…${treeName.slice(-(DETAIL_VALUE_DISPLAY_LENGTH - 1))}`;
  return `${treeName}/…${worktreeName.slice(-worktreeTailLength)}`;
}

function lifecycleDetail(terminal: DaemonTerminalSummary): string {
  if (terminal.alive) return '생존: 실행 중';
  if (terminal.exitCode === 0) return '종료: 정상 종료 (exit 0)';
  if (typeof terminal.exitCode === 'number') return `종료: 비정상 종료 (exit ${terminal.exitCode})`;
  return '종료: 종료 코드 미상';
}

function accessModeDetail(accessMode: DaemonTerminalSummary['accessMode']): string {
  if (accessMode === 'write') return '접근: 쓰기';
  if (accessMode === 'read') return '접근: 읽기';
  if (accessMode === 'auto') return '접근: 자동';
  return '접근: 이 행에서는 알 수 없음';
}

function terminalOriginDetail(terminal: DaemonTerminalSummary): string {
  if (terminal.terminalOriginCategory === 'direct-human') return '출처: 사람';
  if (terminal.terminalOriginCategory === 'monad') return '출처: monad';
  if (terminal.terminalOriginCategory === 'external-tool') {
    return terminal.externalToolName
      ? `출처: 외부 도구 · ${compactDetailValue(terminal.externalToolName)}`
      : '출처: 외부 도구';
  }
  const reason = terminal.terminalOriginReason ? ` · ${compactDetailValue(terminal.terminalOriginReason)}` : '';
  return `출처: 이 행에서는 알 수 없음${reason}`;
}

function ownerRunUsageDetail(ownerRunUsage: DaemonTerminalSummary['ownerRunUsage']): string {
  if (ownerRunUsage === 'running') return '소유 런: 실행 중';
  if (ownerRunUsage === 'terminated-live-owner') return '소유 런: 종료됐지만 터미널 유지';
  if (ownerRunUsage === 'no-run-id') return '소유 런: 소유 런 정보 없음';
  return '소유 런: 이 행에서는 알 수 없음';
}

/** Formats a past epoch-millisecond start time as the existing Korean elapsed-time vocabulary. */
export function ptyTerminalElapsedTime(startedAt: number | null | undefined, nowMs = Date.now()): string | null {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || !Number.isFinite(nowMs) || startedAt > nowMs) {
    return null;
  }
  const startedAtDate = new Date(startedAt);
  if (!Number.isFinite(startedAtDate.getTime())) return null;
  return relativeTime(startedAtDate.toISOString(), nowMs);
}

function sessionDetail(sourceRoot: DaemonTerminalSummary['sourceRoot']): string | null {
  if (!sourceRoot?.name && !sourceRoot?.dbPath) return null;
  const values = [
    sourceRoot.name && compactDetailValue(sourceRoot.name),
    sourceRoot.dbPath && compactSessionPath(sourceRoot.dbPath),
  ].filter((value): value is string => Boolean(value));
  return `세션: ${values.join(' · ')}`;
}

/** Produces the minimum scanable PTY row text from the daemon list response. */
export function ptyTerminalRowSummary(
  terminal: DaemonTerminalSummary,
  nowMs = Date.now(),
): PtyTerminalRowSummary {
  const title = terminal.name || terminal.id;
  const location = compactLocation(terminal.treeName, terminal.worktreeName, terminal.workdir);
  const session = sessionDetail(terminal.sourceRoot);
  const elapsed = ptyTerminalElapsedTime(terminal.startedAt, nowMs);
  const lastControlElapsed = terminal.lastControlAt === undefined
    ? null
    : ptyTerminalElapsedTime(terminal.lastControlAt, nowMs);
  return {
    title,
    details: [
      ...(title === terminal.id ? [] : [terminal.id]),
      ...(terminal.status ? [`상태: ${terminal.status}`] : []),
      ...(terminal.kind ? [`종류: ${terminal.kind}`] : []),
      ...(terminal.nickname ? [`별명: ${compactDetailValue(terminal.nickname)}`] : []),
      ...(location ? [`위치: ${location}`] : []),
      lifecycleDetail(terminal),
      terminalOriginDetail(terminal),
      ...(terminal.controller ? [`통제: ${compactDetailValue(terminal.controller)}`] : []),
      accessModeDetail(terminal.accessMode),
      ownerRunUsageDetail(terminal.ownerRunUsage),
      ...(terminal.instance ? [`우주: ${compactDetailValue(terminal.instance)}`] : []),
      ...(terminal.runId ? [`런: ${compactRunId(terminal.runId)}`] : []),
      ...(session ? [session] : []),
      ...(elapsed ? [`시작: ${elapsed}`] : []),
      `마지막 제어: ${lastControlElapsed ?? '이 행에서는 알 수 없음'}`,
    ],
  };
}
