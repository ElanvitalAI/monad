// ── 마이그레이션 shim (RFC-elanous-tiered-tool-exposure §6b · M1) ──
//
// shell-runner boot 는 크로스서피스 장치(shell/PTY 실행은 TUI 만이 아니라 모든
// 서피스가 쓴다)라 표면-중립 home 인 `src/surface/` 로 이전했다(surface/shell-
// runner-wiring.ts 와 co-locate). 기존 import 경로(`dashboard/shell-runner-boot`)
// 는 이 re-export shim 으로 하위호환 유지 — God-object(dashboard/index.ts) 무접촉.
//
// 다음 슬라이스(M2~): caller(index.ts) 를 새 경로로 이관 후 이 shim 삭제.
// 심볼명 `bootDashboardShellRunner` 리네임(→ bootShellRunnerSurface)도 caller
// 이관 시 함께(지금 리네임하면 index.ts 를 건드려 touch-clean 걸림).

export * from '../surface/shell-runner-boot.js';
