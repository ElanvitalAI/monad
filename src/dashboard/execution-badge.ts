// ── 마이그레이션 shim (RFC-monad-tiered-tool-exposure §6b · M2) ──
//
// execution-badge 는 순수 TUI 챗 완료라인 표현이라 tui/chat/ 으로 이전했다.
// 기존 import 경로(`dashboard/execution-badge`)는 이 re-export shim 으로
// 하위호환. caller(turn-finalize-runtime) 이관 후 이 shim 삭제(M2 후속).

export * from '../tui/chat/execution-badge.js';
