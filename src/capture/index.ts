// ── Capture arc · public API barrel (Phase 0) ──
//
// Phase 0 surface: capture engine + encoders + asciicast recorder.
// Source registry (pane substrate integration) + SVG/PNG pipeline +
// CLI entry land in later phases; this barrel exposes only the types
// and functions that exist today so consumers can start wiring against
// a stable import path.

export {
  asciicastFrame,
  asciicastHeader,
  decodeAsciicast,
  encodeAsciicast,
  type AsciicastFrame,
  type AsciicastHeader,
} from './encoders/asciicast.js';
export { encodeAnsi } from './encoders/ansi.js';
export { encodeText } from './encoders/text.js';
export {
  ansiToCells,
  palette256,
  PALETTE_16,
  type Cell,
  type CellAttr,
  type CellGrid,
} from './encoders/cells.js';
export {
  DEFAULT_SVG_THEME,
  encodeSvg,
  type EncodeSvgOpts,
  type SvgThemeTokens,
} from './encoders/svg.js';
export { svgToPng, type SvgToPngOpts } from './encoders/png.js';
export {
  encodeGif,
  isAnimatedGifBuffer,
  GifEncodeError,
  type EncodeGifOpts,
  type GifFrame,
} from './encoders/gif.js';
export {
  writeAnimatedGif,
  type GifWriteOpts,
  type GifWriteFrame,
} from './encoders/gif-writer.js';
export {
  encodeMp4,
  isMp4Buffer,
  probeFfmpeg,
  Mp4EncodeError,
  Mp4UnavailableError,
  type EncodeMp4Opts,
  type Mp4Frame,
} from './encoders/mp4.js';
export { capture, captureImage, type CaptureImageResult } from './engine.js';
export {
  resolveModalAnsi,
  createModalSource,
  describeModal,
  ModalSourceNotFoundError,
  type ModalSourceOpts,
  type DisplaySurfaceResolver,
  type PaintableModalSurface,
  type ModalDescription,
} from './sources/modal-source.js';
export {
  resolveWidgetAnsi,
  createWidgetSource,
  describeWidget,
  WidgetSourceNotFoundError,
  type WidgetSourceOpts,
  type WidgetRenderHost,
  type WidgetDescription,
} from './sources/widget-source.js';
export {
  resolveSurfaceAnsi,
  resolveScreenAnsi,
  resolvePassthroughAnsi,
  type SurfaceSourceDeps,
} from './sources/surface-source.js';
export {
  createWidgetRecorder,
  parseWidgetTimeline,
  WidgetRecorderStateError,
  WidgetTimelineParseError,
  type WidgetRecorderOpts,
  type WidgetRecorderHandle,
  type WidgetRecorderHost,
  type WidgetRecorderStatus,
  type WidgetTimelineFrame,
  type WidgetTimelineHeader,
  type ParsedWidgetTimeline,
} from './widget-recorder.js';
export { createRecorder } from './recorder.js';
export {
  RecorderStateError,
  type CaptureDimensions,
  type CaptureFormat,
  type CaptureRequest,
  type CaptureResult,
  type CaptureTarget,
  type RecorderHandle,
  type RecorderOpts,
  type RecorderStatus,
  type RecorderStream,
} from './types.js';

// SelfReportFrame — 자기 관측 캡처 버스 규약 (PLAN P0)
export {
  type SelfReportFrame,
  type SelfReportKind,
  type SelfReportMode,
  SELF_REPORT_CHANNEL_PREFIX,
  SELF_REPORT_AGGREGATE_CHANNEL,
  channelForSurface,
  validateSelfReportFrame,
  frameToChannelMessage,
  channelMessageToFrame,
  publishSelfReportFrame,
  subscribeSurfaceFrames,
  subscribeAllFrames,
  snapshotSurfaceFrames,
} from './self-report-frame.js';

// Frame → asciicast recorder + bus adapter (PLAN P4 · §4-2)
export {
  type FrameRecorderHandle,
  type FrameRecorderOpts,
  createFrameRecorder,
  recordSurfaceFromBus,
} from './frame-recorder.js';
