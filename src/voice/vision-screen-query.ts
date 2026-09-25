// ── X7 (Phase 1 Bundle 3) — voice → screenshot → vision LLM → TTS ──
//
// HANDOFF §5 X7: "'이 화면 무슨 일이야?' 음성 명령 → focused pane 자동
// Screenshot → vision LLM → TTS".
//
// This file orchestrates the four-step flow as a single async
// function. Per substrate G5 (serializable-first) every input is
// JSON-clean; the vision provider receives an opaque
// `ScreenshotPayload` that any host (TUI / Discord / PWA) can mirror.
//
// Wiring: dashboard / Telegram bot / PWA voice channel calls
// `runVisionScreenQuery({...})` after the V4 parser yields a
// `screen-vision-query` intent. The orchestrator handles:
//
//   1. focused pane resolution (host injects a resolver that returns
//      a SurfaceAddress + display label)
//   2. screenshot capture (uses the same `dispatchScreenshot` X4
//      relies on, but called fresh so user-initiated queries see the
//      latest pixels — not a cached PFC capture)
//   3. vision LLM call (provider-agnostic — Gemini / Claude vision /
//      OpenAI vision all conform to a single shape)
//   4. TTS playback via auto-tts controller (so the response goes out
//      the same audio path as V1's PFC voice)
//
// All four steps are budgeted independently — slow vision LLM doesn't
// block screenshot, and a missing pane resolver doesn't keep the
// user waiting for a vision call that has nothing to look at.

export interface ScreenshotPayload {
  readonly bodyBase64: string;
  readonly mimeType: 'image/png';
  readonly bytes: number;
  /** Optional human-readable surface label ("vw:3/runner") for the
   *  vision prompt + telemetry. */
  readonly surfaceLabel?: string;
  /** Phase B (Capture Fabric) — optional posture sidecar text from
   *  Phase A's `posture-sidecar.ts`. When present, vision providers
   *  should prepend this to the prompt as system context so the LLM
   *  knows the substrate state at capture time (interactive vs
   *  observe-only, recent intents, etc.). Provider-agnostic. */
  readonly sidecarText?: string;
  /** Single-line summary form of `sidecarText` — for telemetry / TTS
   *  prefix / status mirror. */
  readonly sidecarSummary?: string;
}

export interface VisionScreenQueryDeps {
  /** Resolves the user's currently focused screenshot-capable surface.
   *  Returns null when nothing capture-able is focused. */
  resolveFocusedSurface: () => null | {
    /** Args for `dispatchScreenshot`. */
    args: Record<string, unknown>;
    /** Display label for the prompt + utterance. */
    surfaceLabel: string;
  };
  /** Screenshot dispatcher. Same signature as
   *  `src/capture/capture-tools.ts#dispatchScreenshot`. */
  dispatchScreenshot: (args: Record<string, unknown>) => Promise<{
    bodyBase64?: string;
    bytes?: number;
  }>;
  /** Phase B (Capture Fabric) — optional posture sidecar resolver.
   *  When supplied, the captured screenshot payload is enriched with
   *  `sidecarText` + `sidecarSummary` *before* visionProvider sees it.
   *  Wires to Phase A's `posture-sidecar.ts` helpers. Returning null
   *  is fine (no posture context — provider sees a bare screenshot). */
  resolveSidecar?: (target: {
    args: Record<string, unknown>;
    surfaceLabel: string;
  }) => null | {
    sidecarText?: string;
    sidecarSummary?: string;
  };
  /** Vision LLM provider — receives the screenshot + the user's
   *  transcript, returns a brief description. Provider error / null
   *  result is reported back as a graceful failure utterance. */
  visionProvider: (input: {
    transcript: string;
    screenshot: ScreenshotPayload;
  }) => Promise<string | null>;
  /** TTS sink — typically `dashboardAutoTts.controller.{pushChunk,
   *  commit}` adapted into a single `speak(sentence)` callable. */
  speak: (sentence: string) => Promise<void>;
  /** Per-step budgets. */
  screenshotBudgetMs?: number;  // default 1500
  visionBudgetMs?: number;      // default 8000
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface VisionScreenQueryInput {
  readonly transcript: string;
}

export interface VisionScreenQueryResult {
  readonly outcome:
    | 'spoken'              // full pipeline finished, user heard analysis
    | 'no-focused-surface'  // resolver returned null
    | 'screenshot-failed'   // capture timed out / produced no bytes
    | 'vision-failed'       // provider returned null / threw / timed out
    | 'tts-failed';         // speak() threw
  readonly utterance?: string;
  readonly screenshotLabel?: string;
}

const DEFAULT_SCREENSHOT_BUDGET_MS = 1500;
const DEFAULT_VISION_BUDGET_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

export async function runVisionScreenQuery(
  input: VisionScreenQueryInput,
  deps: VisionScreenQueryDeps,
): Promise<VisionScreenQueryResult> {
  const target = deps.resolveFocusedSurface();
  if (!target) {
    if (deps.logDebug) {
      deps.logDebug('voice.vision-query.no-target', 'skip');
    }
    const utterance = '지금 분석할 화면을 찾지 못했어요. 먼저 pane 에 포커스를 주세요.';
    try { await deps.speak(utterance); } catch { /* graceful */ }
    return { outcome: 'no-focused-surface', utterance };
  }

  const screenshotBudget = deps.screenshotBudgetMs ?? DEFAULT_SCREENSHOT_BUDGET_MS;
  const captureResult = await withTimeout(
    deps.dispatchScreenshot({ ...target.args, format: 'png' }),
    screenshotBudget,
  );
  if (!captureResult || !captureResult.bodyBase64) {
    if (deps.logDebug) {
      deps.logDebug('voice.vision-query.screenshot-failed', target.surfaceLabel, {
        budgetMs: screenshotBudget,
      });
    }
    const utterance = `화면 캡처에 실패했어요. ${target.surfaceLabel} pane 을 다시 시도해주세요.`;
    try { await deps.speak(utterance); } catch { /* graceful */ }
    return { outcome: 'screenshot-failed', utterance, screenshotLabel: target.surfaceLabel };
  }

  // Phase B — enrich payload with Phase A posture sidecar when wired.
  // Failure to resolve sidecar is non-fatal: vision still proceeds with
  // bare screenshot.
  let sidecarText: string | undefined;
  let sidecarSummary: string | undefined;
  if (deps.resolveSidecar) {
    try {
      const side = deps.resolveSidecar(target);
      if (side) {
        sidecarText = side.sidecarText;
        sidecarSummary = side.sidecarSummary;
      }
    } catch (err) {
      if (deps.logDebug) {
        deps.logDebug('voice.vision-query.sidecar-failed', target.surfaceLabel, {
          error: String(err),
        });
      }
    }
  }

  const screenshot: ScreenshotPayload = {
    bodyBase64: captureResult.bodyBase64,
    mimeType: 'image/png',
    bytes: captureResult.bytes ?? captureResult.bodyBase64.length,
    surfaceLabel: target.surfaceLabel,
    ...(sidecarText !== undefined ? { sidecarText } : {}),
    ...(sidecarSummary !== undefined ? { sidecarSummary } : {}),
  };

  const visionBudget = deps.visionBudgetMs ?? DEFAULT_VISION_BUDGET_MS;
  const description = await withTimeout(
    deps.visionProvider({ transcript: input.transcript, screenshot }),
    visionBudget,
  );
  if (!description) {
    if (deps.logDebug) {
      deps.logDebug('voice.vision-query.vision-failed', target.surfaceLabel);
    }
    const utterance = '비전 분석이 실패했어요. 잠시 후 다시 시도해주세요.';
    try { await deps.speak(utterance); } catch { /* graceful */ }
    return { outcome: 'vision-failed', utterance, screenshotLabel: target.surfaceLabel };
  }

  const utterance = description.trim();
  try {
    await deps.speak(utterance);
  } catch (err) {
    if (deps.logDebug) {
      deps.logDebug('voice.vision-query.tts-failed', target.surfaceLabel, {
        error: String(err),
      });
    }
    return { outcome: 'tts-failed', utterance, screenshotLabel: target.surfaceLabel };
  }

  if (deps.logDebug) {
    deps.logDebug('voice.vision-query.spoken', target.surfaceLabel, {
      utteranceChars: utterance.length,
    });
  }
  return { outcome: 'spoken', utterance, screenshotLabel: target.surfaceLabel };
}
