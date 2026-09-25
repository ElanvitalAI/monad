import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
// ⛔ 관측을 내는 쪽과 «같은» 상수를 쓴다 — 문자열이 갈리면 이 조회가 조용히 0건을 낸다.
import { BROWSER_ACT_CATEGORY, BROWSER_ACT_EVENT } from './browser-act-step.js';
import { join } from 'node:path';
import { monadStateRoot } from '../autopilot/state-paths.js';
import { LogStore, logsDbPath } from '../mss/logging/log-store.js';
import type { ComputerUseTrajectoryStep } from '../ux-sim/computer-use.js';
import { extractBrowserActStep } from './browser-act-step.js';

export interface BrowserActionObservationRow {
  category: string;
  event: string;
  data: string | null;
}

export interface BrowserActionTrajectoryDiscardCounts {
  otherRunId: number;
  missingCoordinates: number;
  invalidRow: number;
  unrelatedEvent: number;
}

export interface BrowserActionTrajectoryReadResult {
  runId: string;
  status: 'ready' | 'no-observations' | 'no-replayable-steps' | 'read-error';
  /** `read-error`일 때만 스토어를 열거나 조회하지 못한 원인. */
  error?: string;
  /** 모든 `harness.browser-action` / `executed` 후보 행 수. */
  observedRows: number;
  /** 요청한 runId에 실제로 속한 후보 행 수. */
  selectedRows: number;
  trajectory: readonly ComputerUseTrajectoryStep[];
  discarded: BrowserActionTrajectoryDiscardCounts;
}

function coordinatesFrom(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return undefined;
  return { x, y };
}

/**
 * `harness.browser-action` 관측 행을 동일 run의 재생 궤적으로 변환한다.
 * 스토어 접근은 하지 않아 심과 라이브 관측 경계를 분리한다.
 */
export function browserActionRowsToTrajectory(
  rows: readonly BrowserActionObservationRow[],
  runId: string,
): BrowserActionTrajectoryReadResult {
  const trajectory: ComputerUseTrajectoryStep[] = [];
  const discarded: BrowserActionTrajectoryDiscardCounts = {
    otherRunId: 0,
    missingCoordinates: 0,
    invalidRow: 0,
    unrelatedEvent: 0,
  };
  let observedRows = 0;
  let selectedRows = 0;

  for (const row of rows) {
    // ⛔ 이 축의 «정책»은 여기 남는다 — 무엇을 버릴지는 부르는 쪽이 정한다.
    if (row.category !== BROWSER_ACT_CATEGORY || row.event !== BROWSER_ACT_EVENT) {
      discarded.unrelatedEvent += 1;
      continue;
    }
    observedRows += 1;

    // ⭐ «파싱»은 공유한다 — 이 저장소에 같은 변환이 «둘» 있었다(browser-act-step.ts 머리말).
    const extracted = extractBrowserActStep({ category: row.category, event: row.event, data: row.data });
    if (!extracted.ok) {
      // ⛔ 파싱 단계의 실패는 전부 invalidRow 다 — 옛 계약 그대로.
      discarded.invalidRow += 1;
      continue;
    }
    const step = extracted.step;

    if (step.runId !== runId) {
      discarded.otherRunId += 1;
      continue;
    }
    selectedRows += 1;
    if (step.coordinates === null) {
      // ⛔ 「좌표 칸이 «없었다»」와 「있었는데 못 읽었다」를 다른 값으로 — 옛 계약 그대로.
      if (!step.coordinatesPresent) discarded.missingCoordinates += 1;
      else discarded.invalidRow += 1;
      continue;
    }
    // ⛔ 심에 먹이려면 좌표가 «있어야» 한다 — 그것이 이 축의 정책이다.
    trajectory.push({ target: step.target, coordinates: step.coordinates });
  }

  return {
    runId,
    status: selectedRows === 0 ? 'no-observations' : trajectory.length === 0 ? 'no-replayable-steps' : 'ready',
    observedRows,
    selectedRows,
    trajectory,
    discarded,
  };
}

export interface BrowserActionTrajectoryStore {
  queryByDataKeys(query: { exactCategories: readonly string[]; runIds: readonly string[] }): BrowserActionObservationRow[];
  close(): void;
}

export type BrowserActionTrajectoryStoreOpener = () => BrowserActionTrajectoryStore;

const openBrowserActionTrajectoryStore: BrowserActionTrajectoryStoreOpener = () => LogStore.openReadOnly(logsDbPath());

/** Read one run's recorded browser actions from the observation store for replay. */
export function readBrowserActionTrajectory(
  runId: string,
  openStore: BrowserActionTrajectoryStoreOpener = openBrowserActionTrajectoryStore,
): BrowserActionTrajectoryReadResult {
  let store: BrowserActionTrajectoryStore | undefined;
  try {
    store = openStore();
    return browserActionRowsToTrajectory(
      store.queryByDataKeys({ exactCategories: [BROWSER_ACT_CATEGORY], runIds: [runId] }),
      runId,
    );
  } catch (error) {
    return {
      ...browserActionRowsToTrajectory([], runId),
      status: 'read-error',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try { store?.close(); } catch { /* read-only cleanup is fail-soft */ }
  }
}

export interface SavedBrowserActionTrajectory {
  name: string;
  savedAt: string;
  source: { runId: string };
  trajectory: readonly ComputerUseTrajectoryStep[];
}

function trajectoryName(name: string): string {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(`browser trajectory name '${name}' is invalid`);
  }
  return trimmed;
}

/** State-root-scoped location for named, replayable browser trajectories. */
export function browserTrajectoryDirectory(root = monadStateRoot()): string {
  return join(root, 'harness', 'browser-trajectories');
}

function browserTrajectoryPath(name: string, root?: string): string {
  return join(browserTrajectoryDirectory(root), `${trajectoryName(name)}.json`);
}

function isTrajectory(value: unknown): value is readonly ComputerUseTrajectoryStep[] {
  return Array.isArray(value) && value.length > 0 && value.every(step => {
    if (!step || typeof step !== 'object') return false;
    const candidate = step as Record<string, unknown>;
    return typeof candidate.target === 'string' && candidate.target.length > 0 && coordinatesFrom(candidate.coordinates) !== undefined;
  });
}

function savedTrajectoryFrom(value: unknown, name: string): SavedBrowserActionTrajectory {
  if (!value || typeof value !== 'object') throw new Error(`browser trajectory '${name}' is malformed`);
  const candidate = value as Record<string, unknown>;
  const source = candidate.source as Record<string, unknown> | undefined;
  if (candidate.name !== name || typeof candidate.savedAt !== 'string' || !source || typeof source.runId !== 'string' || !isTrajectory(candidate.trajectory)) {
    throw new Error(`browser trajectory '${name}' is malformed`);
  }
  return {
    name,
    savedAt: candidate.savedAt,
    source: { runId: source.runId },
    trajectory: candidate.trajectory.map(step => ({ target: step.target, coordinates: { ...step.coordinates } })),
  };
}

/** Save the ready result under a stable name. Reusing a name deliberately replaces its current revision. */
export function saveBrowserActionTrajectory(
  name: string,
  replay: Pick<BrowserActionTrajectoryReadResult, 'runId' | 'status' | 'trajectory'>,
  root = monadStateRoot(),
): SavedBrowserActionTrajectory {
  const normalizedName = trajectoryName(name);
  if (replay.status !== 'ready') throw new Error(`cannot save browser trajectory '${normalizedName}' from ${replay.status}`);
  if (!isTrajectory(replay.trajectory)) throw new Error(`cannot save browser trajectory '${normalizedName}' with an empty or invalid trajectory`);
  const saved: SavedBrowserActionTrajectory = {
    name: normalizedName,
    savedAt: new Date().toISOString(),
    source: { runId: replay.runId },
    trajectory: replay.trajectory.map(step => ({ target: step.target, coordinates: { ...step.coordinates } })),
  };
  const path = browserTrajectoryPath(normalizedName, root);
  mkdirSync(browserTrajectoryDirectory(root), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(saved, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
  return saved;
}

/** Read one named trajectory. Missing names fail loudly rather than replaying an empty path. */
export function readSavedBrowserActionTrajectory(name: string, root = monadStateRoot()): SavedBrowserActionTrajectory {
  const normalizedName = trajectoryName(name);
  const path = browserTrajectoryPath(normalizedName, root);
  if (!existsSync(path)) throw new Error(`browser trajectory '${normalizedName}' was not found`);
  try {
    return savedTrajectoryFrom(JSON.parse(readFileSync(path, 'utf8')) as unknown, normalizedName);
  } catch (error) {
    if (error instanceof Error && error.message.includes(`browser trajectory '${normalizedName}'`)) throw error;
    throw new Error(`browser trajectory '${normalizedName}' is malformed`);
  }
}

/** List named trajectories with provenance, without exposing page bodies or images. */
export function listSavedBrowserActionTrajectories(root = monadStateRoot()): SavedBrowserActionTrajectory[] {
  const directory = browserTrajectoryDirectory(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(entry => entry.endsWith('.json'))
    .map(entry => readSavedBrowserActionTrajectory(entry.slice(0, -'.json'.length), root));
}
