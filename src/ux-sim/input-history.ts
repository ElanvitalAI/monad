// ── 턴 UX 시뮬레이터 — 입력 이력 ─────────────────────────────────────────────
//
// 입력 이력 축을 실제 저장소 경로와 수명주기로 세운다. ⛔ 저장소를 흉내 내지 않는다.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  openInputHistoryStore,
  resetInputHistoryStoreForTests,
  type InputHistoryEntry,
  type InputHistoryRecordInput,
  type InputHistoryStore,
} from '../input-history.js';

export interface QueuedInputHistoryRecordOptions {
  cwd?: string;
  activeView?: string;
  focusedPane?: string;
  metadata?: Record<string, unknown>;
}

export interface InputHistorySim {
  /** 시뮬레이터가 만든 임시 상태 디렉토리. */
  tempDir: string;
  /** 실제 저장소 파일 경로. */
  path: string;
  /** 실제 저장소 종류. */
  kind: InputHistoryStore['kind'];
  /** 현재 이력을 넣은 순서(oldest → newest)로 읽는다. */
  list(limit?: number): InputHistoryEntry[];
  /** 현재 이력의 줄만 넣은 순서(oldest → newest)로 읽는다. */
  lines(limit?: number): string[];
  /** 이력 줄 하나를 실제 저장소에 기록한다. */
  record(text: string): InputHistoryEntry;
  /** 큐 담기 경로가 남기는 이력 항목 모양으로 줄 하나를 기록한다. */
  recordQueued(text: string, options?: QueuedInputHistoryRecordOptions): InputHistoryEntry;
  /** 저장소와 임시 디렉토리를 정리한다. */
  cleanup(): void;
}

export function simInputHistory(lines: readonly string[] = []): InputHistorySim {
  resetInputHistoryStoreForTests();
  const tempDir = mkdtempSync(join(tmpdir(), 'ux-sim-input-history-'));
  const path = join(tempDir, 'input-history.sqlite');
  let store: InputHistoryStore | null = null;
  let storeClosed = false;
  let tempDirRemoved = false;

  const cleanup = () => {
    if (store && !storeClosed) {
      store.close?.();
      storeClosed = true;
    }
    if (!tempDirRemoved) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDirRemoved = true;
    }
  };

  try {
    store = openInputHistoryStore(path);
    const activeStore = store;

    let recordCount = 0;
    const sim: InputHistorySim = {
      tempDir,
      path,
      kind: activeStore.kind,
      list(limit?: number) {
        return activeStore.list(limit ?? Math.max(recordCount, 1)).slice().reverse();
      },
      lines(limit?: number) {
        return sim.list(limit).map(entry => entry.text);
      },
      record(text: string) {
        const entry = activeStore.record({ text });
        if (!entry) throw new Error('input history simulator received an empty history line');
        recordCount += 1;
        return entry;
      },
      recordQueued(text: string, options: QueuedInputHistoryRecordOptions = {}) {
        const input: InputHistoryRecordInput = {
          text,
          cwd: options.cwd,
          activeView: options.activeView,
          focusedPane: options.focusedPane,
          metadata: {
            ...(options.metadata ?? {}),
            queued: true,
          },
        };
        const entry = activeStore.record(input);
        if (!entry) throw new Error('input history simulator received an empty queued history line');
        recordCount += 1;
        return entry;
      },
      cleanup,
    };

    for (const line of lines) sim.record(line);
    return sim;
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function isInputHistorySimPathInsideTemp(sim: Pick<InputHistorySim, 'path' | 'tempDir'>): boolean {
  const tempRoot = resolve(sim.tempDir);
  const historyPath = resolve(sim.path);
  return historyPath === tempRoot || historyPath.startsWith(`${tempRoot}${sep}`);
}

export function inputHistorySimTempDirExists(sim: Pick<InputHistorySim, 'tempDir'>): boolean {
  return existsSync(sim.tempDir);
}
