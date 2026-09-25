// SE6 dogfood: BuildStatus 를 사람이 읽는 한글 라벨+이모지로 변환하는 순수 함수.
// PWA/CLI 빌드 상태 표시용. 외부 의존성 없음.

const BUILD_STATUS_LABELS: Record<string, string> = {
  disarmed: "🔒 미무장(대기)",
  "no-approved": "⬜ 승인 대기",
  built: "✅ 구현 완료(PR)",
  "gate-failed": "❌ 무결성 실패",
  "impl-failed": "⚠️ 구현 실패",
  "core-violation": "⛔ 불변코어 위반",
};

/**
 * BuildStatus 문자열을 한글 라벨+이모지로 변환한다.
 * 미지의 상태는 "❓ " + status 를 반환한다.
 */
export function formatBuildStatus(status: string): string {
  return BUILD_STATUS_LABELS[status] ?? "❓ " + status;
}
