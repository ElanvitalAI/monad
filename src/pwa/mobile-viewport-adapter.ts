// ── D / H2 (Phase 3 Bundle 2) — PWA mobile-first terminal viewport ──
//
// HANDOFF Phase 3 / ROADMAP §6 D: "PWA mobile-first terminal viewport".
// Pure layout module — given viewport dimensions + content (terminal
// pane + chat) → recommends layout / font-size / touch targets.
//
// 디바이스 카테고리:
//   - phone-portrait    < 600 width (Safari mobile, Chrome Android)
//   - phone-landscape   < 900 wide, < 500 tall
//   - tablet            < 1200 width
//   - desktop          ≥ 1200 width
//
// 모바일 첫 우선순위:
//   - chat 이 위, terminal pane 이 아래 (가독성 우선)
//   - 폰트 자동 scale (터미널 ≥ 14px, chat 필요 시 16px+)
//   - 터치 hit target ≥ 44px (iOS HIG 기준)
//   - 가로 모드 시 chat 좌측 / terminal 우측 split

export type DeviceCategory =
  | 'phone-portrait'
  | 'phone-landscape'
  | 'tablet'
  | 'desktop';

export interface MobileViewportInput {
  /** CSS pixel width / height. */
  readonly width: number;
  readonly height: number;
  /** devicePixelRatio (모바일 retina 등). */
  readonly devicePixelRatio?: number;
  /** Soft keyboard 가 떠 있을 때 visualViewport 줄어듦 — 보정 위해 별도 hint. */
  readonly softKeyboardOpen?: boolean;
}

export interface MobileViewportLayout {
  readonly category: DeviceCategory;
  /** 'stack' = chat 위 / terminal 아래, 'split-h' = 좌우 split, 'split-v' = 위아래 split (desktop). */
  readonly arrangement: 'stack' | 'split-h' | 'split-v';
  /** Chat 영역 px (height for stack/split-v, width for split-h). */
  readonly chatSize: number;
  readonly terminalSize: number;
  /** 권장 font size (CSS px). */
  readonly fontSize: { readonly chat: number; readonly terminal: number };
  /** Touch target minimum (CSS px). */
  readonly touchTargetMin: number;
  /** 화면 회전 / soft keyboard 등으로 layout 변경 권장 시 true. */
  readonly recomputeNeeded: boolean;
}

export function classifyDevice(input: MobileViewportInput): DeviceCategory {
  const { width, height } = input;
  if (width < 600) {
    return 'phone-portrait';
  }
  if (width < 900 && height < 500) {
    return 'phone-landscape';
  }
  if (width < 1200) {
    return 'tablet';
  }
  return 'desktop';
}

export function computeMobileViewportLayout(
  input: MobileViewportInput,
): MobileViewportLayout {
  const category = classifyDevice(input);
  const { width, height, softKeyboardOpen } = input;
  // Soft keyboard 가 열려 있으면 사용 가능 height 감소 — 자동 보정.
  const usableHeight = softKeyboardOpen ? Math.floor(height * 0.5) : height;

  switch (category) {
    case 'phone-portrait': {
      // Stack: chat (40%) 위, terminal (60%) 아래.
      const chatSize = Math.floor(usableHeight * 0.4);
      const terminalSize = usableHeight - chatSize;
      return {
        category,
        arrangement: 'stack',
        chatSize,
        terminalSize,
        fontSize: { chat: 16, terminal: 14 },
        touchTargetMin: 44,
        recomputeNeeded: softKeyboardOpen ?? false,
      };
    }
    case 'phone-landscape': {
      // Split-h: chat 좌측 (40%) / terminal 우측 (60%).
      const chatSize = Math.floor(width * 0.4);
      const terminalSize = width - chatSize;
      return {
        category,
        arrangement: 'split-h',
        chatSize,
        terminalSize,
        fontSize: { chat: 14, terminal: 13 },
        touchTargetMin: 44,
        recomputeNeeded: false,
      };
    }
    case 'tablet': {
      // Split-h: chat (35%) / terminal (65%).
      const chatSize = Math.floor(width * 0.35);
      const terminalSize = width - chatSize;
      return {
        category,
        arrangement: 'split-h',
        chatSize,
        terminalSize,
        fontSize: { chat: 15, terminal: 14 },
        touchTargetMin: 40,
        recomputeNeeded: false,
      };
    }
    case 'desktop': {
      // Split-v: chat 위 (40%), terminal 아래 (60%) — TUI 와 동일.
      const chatSize = Math.floor(usableHeight * 0.4);
      const terminalSize = usableHeight - chatSize;
      return {
        category,
        arrangement: 'split-v',
        chatSize,
        terminalSize,
        fontSize: { chat: 14, terminal: 13 },
        touchTargetMin: 32,  // 데스크탑은 마우스 — 더 작게 가능
        recomputeNeeded: false,
      };
    }
  }
}

/**
 * 화면 회전 / 크기 변경 감지. 이전 / 새 layout 의 category 또는 arrangement
 * 변경 시 true 반환 — host 가 re-render 트리거.
 */
export function shouldRelayout(
  prev: MobileViewportLayout,
  next: MobileViewportLayout,
): boolean {
  return prev.category !== next.category || prev.arrangement !== next.arrangement;
}
