// ── MSS log barrel export — PLAN §8 ──

export * from './record.js';
export {
  OtelGenAISink,
  createOtelGenAISinkFromFlags,
  type OtelGenAISinkOptions,
} from './sinks/otel-genai-sink.js';
