export function moveCursorBy(cursor: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return clampCursor(cursor + delta, count);
}

export function cycleCursor(cursor: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return ((cursor + delta) % count + count) % count;
}

export function moveCursorToEdge(count: number, edge: 'start' | 'end'): number {
  if (count <= 0) return 0;
  return edge === 'start' ? 0 : count - 1;
}

export function moveCursorByPage(
  cursor: number,
  count: number,
  pageSize: number,
  direction: -1 | 1,
): number {
  const page = Math.max(1, pageSize);
  return moveCursorBy(cursor, count, direction * page);
}

function clampCursor(next: number, count: number): number {
  return Math.max(0, Math.min(count - 1, next));
}
