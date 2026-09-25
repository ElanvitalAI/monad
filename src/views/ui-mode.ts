// ── Dashboard UI mode — essential(chat-first) vs rich(full dashboard) ──
//
// TUI 부활 아크 T0 (PLAN-tui-revival-essentials-2026-07-12 §3a).
// 단일 config 축 `dashboard.uiMode` 로 두 UI 모드를 스위치한다:
//
//   - 'essential' (기본) — codex/claude-code 패리티. chat 전체화면
//     (기존 chatOnlyMode 레이아웃) + 1줄 status line. HUD pill·dock·
//     VW 는 후속 phase(T1/T3)에서 이 값으로 게이트된다.
//   - 'rich'      — 기존 전체 기능(3-pane grid·VW·widget·마우스) 그대로.
//
// 우선순위: CLI `--rich` > config `dashboard.uiMode` > 레거시
// `dashboard.defaultMode` 매핑('chat'→essential · 'dashboard'→rich) >
// 기본 'essential'. 레거시 defaultMode 는 uiMode 로 흡수 — 명시적으로
// 'dashboard' 를 설정해 둔 사용자의 의도(그리드 부팅)를 rich 로 보존한다.

export type DashboardUiMode = 'essential' | 'rich';

export interface ResolveDashboardUiModeInput {
  /** CLI `--rich` — 이번 실행만 rich 강제 (config 무변). */
  cliRich?: boolean | undefined;
  /** config `dashboard.uiMode` — 명시 설정 시 그대로. */
  configUiMode?: DashboardUiMode | undefined;
  /** 레거시 `dashboard.defaultMode` — uiMode 미설정 시에만 참조. */
  legacyDefaultMode?: 'chat' | 'dashboard' | undefined;
}

export function resolveDashboardUiMode(input: ResolveDashboardUiModeInput): DashboardUiMode {
  if (input.cliRich === true) return 'rich';
  if (input.configUiMode === 'essential' || input.configUiMode === 'rich') {
    return input.configUiMode;
  }
  if (input.legacyDefaultMode === 'dashboard') return 'rich';
  // legacyDefaultMode === 'chat' 도 여기로 — essential 이 곧 chat-first.
  return 'essential';
}

// ── Heavy-feature gate — 「그 모드에서 무엇을 켜도 되나」 ────────────────
//
// `resolveDashboardUiMode` 의 짝. 대시보드 실행 경로에 흩어진
// `dashboardUiMode === 'rich'` 판단(여덟 자리)과 같은 결론을 순수로 낸다.
// 배선은 다음 착지 — 이 모듈은 정책 경계만 소유한다.
//
// 여덟 자리 대응 (src/dashboard/index.ts, 읽기만):
//   1901 setScratchImage          → scratch-image
//   1904 setScratchFile           → scratch-file
//   2112 setScratchImage          → scratch-image
//   2124 showPreviewModal         → clipboard-preview-modal
//   12082 hoverPopupsEnabled      → hover-popups
//   12468 HUD zone                → hud
//   12513 dock zone               → dock
//   12581 foregroundWorkspaceFrame → workspace-frame

export type DashboardHeavyFeature =
  | 'scratch-image'
  | 'scratch-file'
  | 'clipboard-preview-modal'
  | 'hover-popups'
  | 'hud'
  | 'dock'
  | 'workspace-frame';

const DASHBOARD_HEAVY_FEATURES: readonly DashboardHeavyFeature[] = [
  'scratch-image',
  'scratch-file',
  'clipboard-preview-modal',
  'hover-popups',
  'hud',
  'dock',
  'workspace-frame',
];

const DASHBOARD_HEAVY_FEATURE_SET: ReadonlySet<string> = new Set(DASHBOARD_HEAVY_FEATURES);

/** Runtime boundary: unknown names fail closed without widening the typed gate. */
export function isDashboardHeavyFeature(value: string): value is DashboardHeavyFeature {
  return DASHBOARD_HEAVY_FEATURE_SET.has(value);
}

export function isDashboardHeavyFeatureEnabled(
  mode: DashboardUiMode,
  feature: DashboardHeavyFeature,
): boolean {
  return mode === 'rich' && DASHBOARD_HEAVY_FEATURE_SET.has(feature);
}

// ── Scratch-image size — 터미널 크기 → 스크래치 영역 크기 ────────────────
//
// `setScratchImage` 클로저 안의 순수 두 줄과 같은 계산.
// 열: 최소 20 · 최대 60 · 비율 1/4. 행: 최소 8 · 최대 28 · 비율 45%.
// 배선은 다음 착지 — 이 모듈은 크기 정책만 소유한다.

export function scratchImageSize(
  terminalRows: number,
  terminalCols: number,
): { rows: number; cols: number } {
  return {
    cols: Math.max(20, Math.min(60, Math.floor(terminalCols * 0.25))),
    rows: Math.max(8, Math.min(28, Math.floor(terminalRows * 0.45))),
  };
}
