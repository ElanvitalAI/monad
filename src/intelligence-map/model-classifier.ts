// PLAN-model-intelligence-router-2026-07-10 · Part A / Phase A3 —
// Model classifier.
//
// Turns the text of a changed provider/news page (surfaced by the watcher,
// Part A2) into structured model CANDIDATES: which newly announced models
// exist, their provider/family, an estimated tier, and — per the A0
// decision — any effort/code-name variant linkage. Candidates carry
// `classification.source = 'auto'` and are advisory until a human approves
// them (Part A4), at which point they are promoted to `manual` and merged
// into the catalog.
//
// Provider-agnostic: the caller injects the `LlmRunner` (same abstraction
// as the router / preset suggester). Never throws — a parse/transport
// failure yields an empty candidate list so the watcher mission degrades
// to "nothing new" rather than crashing.

import type { LlmMessage, LlmRunner } from '../model-tier/preset-suggest-llm.js';
import { isModelTier } from '../model-tier/types.js';
import type { ModelEntry, ModelProvider } from './types.js';

const PROVIDERS: readonly ModelProvider[] = [
  'anthropic', 'openai', 'grok', 'gemini', 'kimi', 'qwen', 'glm',
  'nemotron', 'ollama', 'local', 'other',
];

function isProvider(v: unknown): v is ModelProvider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/** A classified model candidate — a partial catalog entry the classifier
 *  could infer from the page. Always carries `classification.source =
 *  'auto'`. Missing numeric fields (pricing / context) are left undefined
 *  for the human/approval step to fill. */
export type ModelCandidate = Partial<ModelEntry> & {
  id: string;
  provider: ModelProvider;
  classification: NonNullable<ModelEntry['classification']>;
};

export function buildClassifyMessages(pageText: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You extract NEWLY ANNOUNCED large language models from the page text below.',
        'Return ONE JSON object: {"models": [ ... ]}. Each element:',
        '  {',
        '    "id": "<canonical model id, e.g. gpt-5.6-luna>",',
        '    "provider": "anthropic|openai|grok|gemini|kimi|qwen|glm|nemotron|ollama|local|other",',
        '    "family": "<family name, e.g. gpt-5.6>",',
        '    "tier": "budget|balanced|better|best|loaded",',
        '    "variantOf": "<parent model id if this is an effort/code-name variant, else omit>",',
        '    "effortAxis": "<variant label e.g. luna/terra/reasoning-high, else omit>",',
        '    "contextWindow": <int or omit>,',
        '    "inputPerMtok": <USD/1M or omit>,',
        '    "outputPerMtok": <USD/1M or omit>,',
        '    "tags": ["fast"|"smart"|"reasoning"|"coding"|"cheap"|...],',
        '    "bestFor": ["<use-case>"],',
        '    "releasedAt": "<ISO date or omit>",',
        '    "confidence": <0..1>',
        '  }',
        'Rules:',
        '  - Only include GENUINE model releases/announcements. If the page has none, return {"models": []}.',
        '  - "tier" is your best estimate of where it sits cheap→powerful.',
        '  - Prefer the CHEAPEST plausible tier; do not inflate.',
        '  - Output ONLY the JSON object. No prose, no fences.',
      ].join('\n'),
    },
    { role: 'user', content: pageText },
  ];
}

function coerceStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function coerceNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Parse the classifier reply into candidates. Tolerates fences / prose.
 *  Drops any element missing a valid id+provider. Returns [] on any
 *  structural failure. `at` stamps the classification time (injected for
 *  determinism in tests). */
export function parseClassifyReply(raw: string, at?: string): ModelCandidate[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const stripped = raw.replace(/```(?:json)?/g, '').trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first < 0 || last <= first) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(stripped.slice(first, last + 1)); }
  catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const models = (parsed as Record<string, unknown>).models;
  if (!Array.isArray(models)) return [];

  const out: ModelCandidate[] = [];
  for (const m of models) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.trim().length === 0) continue;
    if (!isProvider(r.provider)) continue;
    const confidence = coerceNum(r.confidence);
    const candidate: ModelCandidate = {
      id: r.id.trim(),
      provider: r.provider,
      classification: {
        source: 'auto',
        ...(confidence !== undefined ? { confidence: Math.max(0, Math.min(1, confidence)) } : {}),
        ...(at ? { at } : {}),
      },
    };
    if (typeof r.family === 'string') candidate.family = r.family;
    if (isModelTier(r.tier)) candidate.tier = r.tier;
    if (typeof r.variantOf === 'string') candidate.variantOf = r.variantOf;
    if (typeof r.effortAxis === 'string') candidate.effortAxis = r.effortAxis;
    if (typeof r.releasedAt === 'string') candidate.releasedAt = r.releasedAt;
    const ctx = coerceNum(r.contextWindow);
    if (ctx !== undefined) candidate.contextWindow = ctx;
    const inTok = coerceNum(r.inputPerMtok);
    if (inTok !== undefined) candidate.inputPerMtok = inTok;
    const outTok = coerceNum(r.outputPerMtok);
    if (outTok !== undefined) candidate.outputPerMtok = outTok;
    const tags = coerceStrArray(r.tags);
    if (tags.length) candidate.tags = tags;
    const bestFor = coerceStrArray(r.bestFor);
    if (bestFor.length) candidate.bestFor = bestFor;
    out.push(candidate);
  }
  return out;
}

// Retains the former fixed deadline so short pages are never disadvantaged.
export const CLASSIFIER_TIMEOUT_FLOOR_MS = 20_000;
// Bounds one page classification even when a source returns an unexpectedly large body.
export const CLASSIFIER_TIMEOUT_CEILING_MS = 60_000;
// Adds two milliseconds per obtainable character to cover larger inputs and their longer output.
export const CLASSIFIER_TIMEOUT_MS_PER_CHARACTER = 2;

export interface ClassifierTimer {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface ClassifyOpts {
  timeoutMs?: number;
  /** Classification timestamp stamped onto each candidate. */
  at?: string;
  /** Optional timer injection for deterministic deadline verification. */
  timer?: ClassifierTimer;
}

export type ClassifyStatus = 'completed' | 'deadline' | 'error';

/** The candidate result and operational outcome for one page classification. */
export interface DetailedClassifyResult {
  candidates: ModelCandidate[];
  status: ClassifyStatus;
  elapsedMs: number;
  contentLength: number;
  /** The explicit or body-length-derived deadline applied to this classification. */
  timeoutMs?: number;
  error?: string;
}

export function classifierTimeoutMsForContentLength(contentLength: number): number {
  if (!Number.isFinite(contentLength) || contentLength <= 0) return CLASSIFIER_TIMEOUT_FLOOR_MS;
  return Math.min(
    CLASSIFIER_TIMEOUT_CEILING_MS,
    CLASSIFIER_TIMEOUT_FLOOR_MS + Math.ceil(contentLength) * CLASSIFIER_TIMEOUT_MS_PER_CHARACTER,
  );
}

/** Classify a page and retain the outcome as data. Never throws. */
export async function classifyModelsFromTextDetailed(
  pageText: string,
  runLlm: LlmRunner,
  opts: ClassifyOpts = {},
): Promise<DetailedClassifyResult> {
  const startedAt = Date.now();
  const contentLength = typeof pageText === 'string' ? pageText.length : 0;
  const timeoutMs = opts.timeoutMs ?? classifierTimeoutMsForContentLength(contentLength);
  if (typeof pageText !== 'string' || pageText.trim().length === 0) {
    return { candidates: [], status: 'completed', elapsedMs: Date.now() - startedAt, contentLength, timeoutMs };
  }

  try {
    const raw = await withTimeout(runLlm(buildClassifyMessages(pageText)), timeoutMs, opts.timer);
    return {
      candidates: parseClassifyReply(raw, opts.at),
      status: 'completed',
      elapsedMs: Date.now() - startedAt,
      contentLength,
      timeoutMs,
    };
  } catch (error) {
    const deadline = error instanceof ClassifierDeadlineError;
    const message = errorMessage(error);
    return {
      candidates: [],
      status: deadline ? 'deadline' : 'error',
      elapsedMs: Date.now() - startedAt,
      contentLength,
      timeoutMs,
      ...(deadline ? { error: `${message} after ${timeoutMs}ms` } : { error: message }),
    };
  }
}

/** Classify newly announced models from page text. Never throws. */
export async function classifyModelsFromText(
  pageText: string,
  runLlm: LlmRunner,
  opts: ClassifyOpts = {},
): Promise<ModelCandidate[]> {
  return (await classifyModelsFromTextDetailed(pageText, runLlm, opts)).candidates;
}

function errorMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 240);
  } catch {
    return 'classifier error unavailable';
  }
}

class ClassifierDeadlineError extends Error {
  constructor() {
    super('model-classifier deadline');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, timer: ClassifierTimer = globalThis): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const handle = timer.setTimeout(() => reject(new ClassifierDeadlineError()), ms);
    promise.then(
      (v) => { timer.clearTimeout(handle); resolve(v); },
      (e: unknown) => { timer.clearTimeout(handle); reject(e); },
    );
  });
}
