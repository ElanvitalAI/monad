import { createHash } from 'node:crypto';

interface SearchLoopState {
  key: string;
  kind: 'broad-search';
  startedAt: number;
  consecutive: number;
}

let recent: SearchLoopState | null = null;

const SEARCH_LOOP_WINDOW_MS = 30_000;
const SEARCH_LOOP_BLOCK_THRESHOLD = 4;

function now(): number {
  return Date.now();
}

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);
}

export function noteBroadSearch(parts: readonly string[], coarseParts?: readonly string[]): { blocked: false } | { blocked: true; consecutive: number } {
  const t = now();
  const key = hash(coarseParts ?? parts);
  if (!recent || recent.kind !== 'broad-search' || (t - recent.startedAt) > SEARCH_LOOP_WINDOW_MS) {
    recent = { key, kind: 'broad-search', startedAt: t, consecutive: 1 };
    return { blocked: false };
  }
  if (recent.key === key) {
    recent = { ...recent, consecutive: recent.consecutive + 1 };
  } else {
    recent = { key, kind: 'broad-search', startedAt: recent.startedAt, consecutive: recent.consecutive + 1 };
  }
  if (recent.consecutive >= SEARCH_LOOP_BLOCK_THRESHOLD) {
    return { blocked: true, consecutive: recent.consecutive };
  }
  return { blocked: false };
}

export function noteNarrowingAction(): void {
  recent = null;
}

export function resetSearchLoopGuardForTest(): void {
  recent = null;
}
