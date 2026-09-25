// ── X5 (Phase 4 Bundle 1) — Region-select capture (drag rect × Screenshot) ──
//
// HANDOFF Phase 4 / ROADMAP §7 X5: "Region-select capture (drag rect ×
// Screenshot)". 사용자가 화면 일부 영역을 drag rect 으로 지정하면 그
// 영역만 PNG 캡처. 기존 X4 screenshot 이 전체 surface 캡처 였다면 X5 는
// region 한정.
//
// 의존:
//   - X1 range-select consumer (이미 land) — drag start/end 좌표 받음
//   - X4 dispatchScreenshot (이미 land) — base capture
//   - 본 모듈 — full PNG 받아서 region crop + return base64
//
// Pure orchestrator — 실제 image crop 은 PNG decoder 주입 (Sharp / pngjs).
// 본 코드는 region geometry + crop call 흐름만.

export interface RegionRect {
  /** 0-based pixel coordinates. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RegionFromCells {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
}

/**
 * Convert a cell-based range (from X1 range-select) into a pixel rect
 * suitable for image cropping. Normalizes reversed ranges.
 */
export function cellRangeToRect(spec: RegionFromCells): RegionRect {
  const startKey = spec.startRow * 1_000_000 + spec.startCol;
  const endKey = spec.endRow * 1_000_000 + spec.endCol;
  const lo = startKey <= endKey ? spec : {
    startRow: spec.endRow,
    startCol: spec.endCol,
    endRow: spec.startRow,
    endCol: spec.startCol,
    cellWidth: spec.cellWidth,
    cellHeight: spec.cellHeight,
  };
  const x = lo.startCol * lo.cellWidth;
  const y = lo.startRow * lo.cellHeight;
  // +1 because end-cell is inclusive
  const width = (lo.endCol - lo.startCol + 1) * lo.cellWidth;
  const height = (lo.endRow - lo.startRow + 1) * lo.cellHeight;
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

export interface RegionCaptureInput {
  /** Args passed to base dispatchScreenshot (full surface). */
  readonly captureArgs: Record<string, unknown>;
  /** Region within the captured image (pixel coordinates). */
  readonly region: RegionRect;
}

export interface RegionCaptureResult {
  readonly bodyBase64: string;
  readonly bytes: number;
  readonly region: RegionRect;
  /** Wall-clock at compose. */
  readonly capturedAt: number;
  /** When true, region was clamped to image bounds. */
  readonly clamped: boolean;
}

export interface RegionCaptureDeps {
  /** Base screenshot dispatcher — typically `dispatchScreenshot` from
   *  `src/capture/capture-tools.ts`. Returns full surface PNG. */
  dispatchScreenshot: (args: Record<string, unknown>) => Promise<{
    bodyBase64?: string;
    bytes?: number;
  }>;
  /** PNG cropper — host injects (Sharp, pngjs, canvas). Receives
   *  full PNG base64 + rect → cropped PNG base64. Throwing → null. */
  cropPng: (input: { sourceBase64: string; rect: RegionRect }) => Promise<{
    bodyBase64: string;
    bytes: number;
    /** Whether the rect was clamped to image bounds. */
    clamped?: boolean;
  } | null>;
  /** Per-step budgets. */
  captureBudgetMs?: number;  // default 2000
  cropBudgetMs?: number;      // default 1000
  logDebug?: (category: string, event: string, data?: unknown) => void;
  now?: () => number;
}

const DEFAULT_CAPTURE_BUDGET = 2000;
const DEFAULT_CROP_BUDGET = 1000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(null);
    });
  });
}

export interface RegionScreenshot {
  capture(input: RegionCaptureInput): Promise<RegionCaptureResult | null>;
}

export function createRegionScreenshot(deps: RegionCaptureDeps): RegionScreenshot {
  const captureBudget = deps.captureBudgetMs ?? DEFAULT_CAPTURE_BUDGET;
  const cropBudget = deps.cropBudgetMs ?? DEFAULT_CROP_BUDGET;
  const now = deps.now ?? Date.now;
  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  return {
    async capture(input) {
      const captureResult = await withTimeout(
        deps.dispatchScreenshot({ ...input.captureArgs, format: 'png' }),
        captureBudget,
      );
      if (!captureResult || !captureResult.bodyBase64) {
        log('region-screenshot.capture-failed', '');
        return null;
      }
      const cropped = await withTimeout(
        deps.cropPng({
          sourceBase64: captureResult.bodyBase64,
          rect: input.region,
        }),
        cropBudget,
      );
      if (!cropped) {
        log('region-screenshot.crop-failed', '');
        return null;
      }
      log('region-screenshot.ok', '', {
        region: input.region,
        bytes: cropped.bytes,
        clamped: cropped.clamped ?? false,
      });
      return {
        bodyBase64: cropped.bodyBase64,
        bytes: cropped.bytes,
        region: input.region,
        capturedAt: now(),
        clamped: cropped.clamped ?? false,
      };
    },
  };
}
