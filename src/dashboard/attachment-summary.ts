// ── 마이그레이션 shim (RFC-monad-tiered-tool-exposure §6b · M2) ──
// attachment-summary 는 순수 TUI 챗 첨부 요약 표현이라 tui/chat/ 으로 이전했다.
// 기존 import 경로(`dashboard/attachment-summary`)는 이 re-export shim 으로
// 하위호환. caller(dashboard/index.ts) 이관 후 이 shim 삭제(M4).

export * from '../tui/chat/attachment-summary.js';
