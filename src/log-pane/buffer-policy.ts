export const CHAT_LOG_BUFFER_SOFT_LIMIT = 20_000;
export const DEBUG_LOG_BUFFER_SOFT_LIMIT = 20_000;

export function trimLogBuffer(lines: string[], limit: number): number {
  if (lines.length <= limit) return 0;
  const dropCount = lines.length - limit;
  lines.splice(0, dropCount);
  return dropCount;
}
