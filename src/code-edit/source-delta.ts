import { C } from '../tui.js';
import type { EditResult, StructuredPatchHunk } from './types.js';

export interface SourceDeltaFile {
  filePath: string;
  hunks: StructuredPatchHunk[];
  isNewFile: boolean;
  linesAdded: number;
  linesRemoved: number;
  editCount: number;
  originalContent: string;
  newContent: string;
}

export interface SourceDeltaTurnStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  edits: number;
}

export interface SourceDeltaTurnSnapshot {
  turnIndex: number;
  promptPreview: string;
  startedAt: string;
  files: SourceDeltaFile[];
  stats: SourceDeltaTurnStats;
}

interface SourceDeltaTurnState {
  turnIndex: number;
  promptPreview: string;
  startedAt: string;
  files: Map<string, SourceDeltaFile>;
}

export interface SourceDeltaEvent {
  turnIndex: number;
  result: EditResult;
  file: SourceDeltaFile;
  turn: SourceDeltaTurnSnapshot;
}

const SOURCE_DELTA_HISTORY_LIMIT = 8;

function copyTurn(turn: SourceDeltaTurnSnapshot): SourceDeltaTurnSnapshot {
  return {
    turnIndex: turn.turnIndex,
    promptPreview: turn.promptPreview,
    startedAt: turn.startedAt,
    stats: { ...turn.stats },
    files: turn.files.map(copyFile),
  };
}
function countHunkLines(hunks: readonly StructuredPatchHunk[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

function copyFile(file: SourceDeltaFile): SourceDeltaFile {
  return {
    filePath: file.filePath,
    hunks: file.hunks.map((hunk) => ({
      ...hunk,
      lines: [...hunk.lines],
    })),
    isNewFile: file.isNewFile,
    linesAdded: file.linesAdded,
    linesRemoved: file.linesRemoved,
    editCount: file.editCount,
    originalContent: file.originalContent,
    newContent: file.newContent,
  };
}

function computeStats(files: readonly SourceDeltaFile[]): SourceDeltaTurnStats {
  return {
    filesChanged: files.length,
    linesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
    linesRemoved: files.reduce((sum, file) => sum + file.linesRemoved, 0),
    edits: files.reduce((sum, file) => sum + file.editCount, 0),
  };
}

export class SourceDeltaManager {
  private current: SourceDeltaTurnState | null = null;
  private lastCompleted: SourceDeltaTurnSnapshot | null = null;
  private recentCompleted: SourceDeltaTurnSnapshot[] = [];

  private nextTurnIndex = 1;

  beginTurn(meta: { promptPreview?: string; startedAt?: string } = {}): void {
    this.current = {
      turnIndex: this.nextTurnIndex++,
      promptPreview: meta.promptPreview ?? '',
      startedAt: meta.startedAt ?? new Date().toISOString(),
      files: new Map(),
    };
  }

  private ensureTurn(): SourceDeltaTurnState {
    if (!this.current) this.beginTurn();
    return this.current!;
  }

  onEditResult(result: EditResult): SourceDeltaEvent {
    const turn = this.ensureTurn();
    const existing = turn.files.get(result.file_path);
    const file: SourceDeltaFile = existing ?? {
      filePath: result.file_path,
      hunks: [],
      isNewFile: result.originalContent === '',
      linesAdded: 0,
      linesRemoved: 0,
      editCount: 0,
      originalContent: result.originalContent,
      newContent: result.newContent,
    };

    const { added, removed } = countHunkLines(result.structuredPatch);
    file.hunks.push(...result.structuredPatch.map((hunk) => ({
      ...hunk,
      lines: [...hunk.lines],
    })));
    file.isNewFile = file.isNewFile || result.originalContent === '';
    file.linesAdded += added;
    file.linesRemoved += removed;
    file.editCount += 1;
    file.newContent = result.newContent;
    if (!existing) turn.files.set(result.file_path, file);

    return {
      turnIndex: turn.turnIndex,
      result,
      file: copyFile(file),
      turn: this.snapshot(),
    };
  }

  snapshot(): SourceDeltaTurnSnapshot {
    const turn = this.ensureTurn();
    const files = [...turn.files.values()]
      .map(copyFile)
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
    return {
      turnIndex: turn.turnIndex,
      promptPreview: turn.promptPreview,
      startedAt: turn.startedAt,
      stats: computeStats(files),
      files,
    };
  }

  size(): number {
    return this.current?.files.size ?? 0;
  }

  latestTurn(): SourceDeltaTurnSnapshot | null {
    if (this.current && this.current.files.size > 0) return this.snapshot();
    if (this.recentCompleted.length > 0) return copyTurn(this.recentCompleted[0]!);
    return this.lastCompleted ? copyTurn(this.lastCompleted) : null;
  }

  recentTurns(limit = SOURCE_DELTA_HISTORY_LIMIT): SourceDeltaTurnSnapshot[] {
    const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : SOURCE_DELTA_HISTORY_LIMIT;
    const turns = [...this.recentCompleted];
    if (this.current && this.current.files.size > 0) {
      const current = this.snapshot();
      if (turns[0]?.turnIndex !== current.turnIndex) turns.unshift(current);
    }
    return turns.slice(0, max).map(copyTurn);
  }

  endTurn(): SourceDeltaTurnSnapshot | null {
    if (!this.current) return null;
    const snapshot = this.snapshot();
    this.lastCompleted = copyTurn(snapshot);
    if (snapshot.files.length > 0) {
      this.recentCompleted.unshift(copyTurn(snapshot));
      if (this.recentCompleted.length > SOURCE_DELTA_HISTORY_LIMIT) {
        this.recentCompleted.length = SOURCE_DELTA_HISTORY_LIMIT;
      }
    }
    this.current = null;
    return snapshot;
  }

  reset(): void {
    this.current = null;
    this.lastCompleted = null;
    this.recentCompleted = [];
    this.nextTurnIndex = 1;
  }
}

let _manager: SourceDeltaManager | null = null;

export function getSourceDeltaManager(): SourceDeltaManager {
  if (!_manager) _manager = new SourceDeltaManager();
  return _manager;
}

export function _setSourceDeltaManagerForTesting(manager: SourceDeltaManager | null): void {
  _manager = manager;
}

export function renderSourceDeltaTurnSummary(turn: SourceDeltaTurnSnapshot | null): string[] {
  if (!turn || turn.files.length === 0) return [];
  const title = `${C.accent('●')}  ${C.bold('Source delta')} — ${turn.stats.filesChanged} file${turn.stats.filesChanged === 1 ? '' : 's'}, +${C.success(String(turn.stats.linesAdded))} / -${C.error(String(turn.stats.linesRemoved))}`;
  const rows = [title];
  for (const file of turn.files) {
    const verb = file.isNewFile ? 'Created' : 'Edited';
    const edits = file.editCount > 1 ? ` · ${file.editCount} edits` : '';
    rows.push(`  ${C.accent(verb)} ${C.muted(file.filePath)} ${C.muted(`(+${file.linesAdded} -${file.linesRemoved})${edits}`)}`);
  }
  return rows;
}
