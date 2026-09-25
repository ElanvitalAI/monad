/** Brain 프롬프트에 넣는 화면 정지 맥락을 사람이 읽을 수 있게 포맷한다. */
export function formatStallContext(o: { sameScreenMs?: number; stallRung?: number }): string {
  const parts: string[] = [];
  if (o.sameScreenMs !== undefined) {
    const seconds = Math.floor(Math.max(0, o.sameScreenMs) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const duration = minutes > 0 ? `${seconds}초(${minutes}분 ${remainingSeconds}초)` : `${seconds}초`;
    parts.push(`화면 무변화: ${duration}`);
  }
  if (o.stallRung !== undefined && o.stallRung >= 0) parts.push(`stall 사다리 ${o.stallRung}단`);
  return parts.join(' · ');
}
