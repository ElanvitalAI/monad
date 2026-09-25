export function truncatedTurnsSummary(truncatedTurns: number): string | undefined {
  return truncatedTurns > 0 ? `[live] 절단 회차 ${truncatedTurns}` : undefined;
}
