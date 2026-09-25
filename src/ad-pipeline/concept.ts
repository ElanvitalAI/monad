import type { SceneSpec } from './scene-spec.js';
import type { VoiceLine } from './sound-plan.js';
import type { SurveyCandidate, SurveyResult } from './survey.js';

export const CONCEPT_VOICEOVER_BLOCKED = 'voice-id-required' as const;
export const CONCEPT_COPY_REWRITE_UNAVAILABLE = 'copy-rewrite-unavailable' as const;
export const CONCEPT_COPY_REWRITE_VERBATIM = 'copy-rewrite-verbatim' as const;
export const CONCEPT_COPY_REWRITE_TOO_LONG = 'copy-rewrite-too-long' as const;

export type ConceptVoiceover =
  | { readonly lines: readonly VoiceLine[] }
  | { readonly blocked: typeof CONCEPT_VOICEOVER_BLOCKED | typeof CONCEPT_COPY_REWRITE_UNAVAILABLE | typeof CONCEPT_COPY_REWRITE_VERBATIM | typeof CONCEPT_COPY_REWRITE_TOO_LONG };

export interface VoiceoverRewriteInput {
  readonly copyMaterial: { readonly label: string; readonly reason: string; readonly detail: string };
  readonly beatDurations: readonly number[];
  readonly characterLimits: readonly number[];
  readonly forbiddenExpressions: readonly string[];
  readonly overLimitLines?: readonly { readonly lineNumber: number; readonly length: number; readonly limit: number }[];
  readonly verbatimLines?: readonly { readonly lineNumber: number }[];
}

export interface DefaultConceptGeneratorDeps {
  readonly rewriteVoiceover?: (input: VoiceoverRewriteInput) => Promise<readonly string[]>;
}

export interface SkuGrounding {
  readonly specRows: Readonly<Record<string, string>>;
  readonly legalStatus?: string;
}

export interface ConceptRequest {
  readonly survey: SurveyResult;
  readonly selection: string;
  readonly skuGrounding?: SkuGrounding;
  readonly scene?: SceneSpec;
  readonly voiceId?: string;
}

export interface ConceptCandidate {
  readonly hook: string;
  readonly angle: string;
}

export interface CopyProvenance {
  readonly sourceId: string;
  readonly lines: readonly {
    readonly beatIndex: number;
    readonly verbatim: boolean;
    readonly longestSharedRun: number;
  }[];
}

export interface ConceptResult {
  readonly selection: string;
  readonly candidates: readonly ConceptCandidate[];
  readonly categoryForbiddenExpressions: readonly string[];
  readonly tone: string;
  readonly skuGrounding?: SkuGrounding;
  readonly scene?: SceneSpec;
  readonly voiceover?: ConceptVoiceover;
  readonly copyProvenance?: CopyProvenance;
}

export interface ConceptGenerator {
  generate(request: ConceptRequest): Omit<ConceptResult, 'selection' | 'skuGrounding'> | Promise<Omit<ConceptResult, 'selection' | 'skuGrounding'>>;
}

function matchingCandidate(selection: string, candidates: readonly SurveyCandidate[]): SurveyCandidate {
  const matches = candidates.filter((candidate) => candidate.id === selection.trim());
  if (matches.length !== 1) {
    throw new Error('Human selection must exactly match one unique survey candidate id before concept generation.');
  }
  return matches[0];
}

function isCosmeticsCategory(category: string): boolean {
  const normalized = category.trim().toLocaleLowerCase();
  return normalized === 'cosmetics' || normalized === 'skincare' || normalized === '화장품' || normalized === '스킨케어';
}

const CAPTION_LINE_MIN_CHARS = 12;
const CAPTION_LINE_MAX_CHARS = 16;
const VOICEOVER_CHARS_PER_SECOND = 4;

function withoutForbiddenExpressions(value: string, forbidden: readonly string[]): string {
  return forbidden.reduce((text, expression) => text.replaceAll(expression, ''), value)
    .replace(/\s+/g, ' ')
    .trim();
}

function voiceoverCharacterLimit(durationSeconds: number): number {
  return Math.max(CAPTION_LINE_MIN_CHARS, Math.floor(durationSeconds * VOICEOVER_CHARS_PER_SECOND));
}

function truncateAtWordBoundary(source: string, maximum: number): string {
  const text = source.slice(0, maximum).trim();
  if (source.length <= maximum || text.length < maximum || /\s/.test(source[maximum] ?? '')) return text;
  const lastWhitespace = text.lastIndexOf(' ');
  return lastWhitespace > 0 ? text.slice(0, lastWhitespace) : text;
}

function captionSizedVoiceover(source: string, durationSeconds: number): string {
  const maximum = Math.min(CAPTION_LINE_MAX_CHARS * 2, voiceoverCharacterLimit(durationSeconds));
  const text = source.trim();
  if (text.length <= CAPTION_LINE_MAX_CHARS) return text;
  const firstLine = truncateAtWordBoundary(text, CAPTION_LINE_MAX_CHARS);
  const secondLine = truncateAtWordBoundary(text.slice(firstLine.length).trim(), CAPTION_LINE_MAX_CHARS);
  return secondLine ? `${firstLine}\n${secondLine}` : firstLine;
}

const DECORATIVE_QUOTES = '“”"\'「」‘’';
const COMPARISON_EDGE_PUNCTUATION = new RegExp(`^[${DECORATIVE_QUOTES}\\p{P}\\s]+|[${DECORATIVE_QUOTES}\\p{P}\\s]+$`, 'gu');
const QUOTE_PAIRS: Readonly<Record<string, string>> = { '“': '”', '"': '"', "'": "'", '「': '」', '‘': '’' };

function isWordInternalApostrophe(text: string, index: number): boolean {
  return (text[index] === "'" || text[index] === '’')
    && /[\p{L}\p{N}]/u.test(text[index - 1] ?? '')
    && /[\p{L}\p{N}]/u.test(text[index + 1] ?? '');
}

function withoutWrappingQuotes(value: string): string {
  let text = value.trim();
  while (text.length >= 2) {
    const openingQuote = text[0];
    const closingQuote = QUOTE_PAIRS[openingQuote];
    if (!closingQuote) break;

    let contentEnd = text.length;
    while (contentEnd > 1 && /[\p{P}\s]/u.test(text[contentEnd - 1]!) && text[contentEnd - 1] !== closingQuote) {
      contentEnd -= 1;
    }
    if (text[contentEnd - 1] !== closingQuote) break;

    const matchingClosingQuote = openingQuote === closingQuote
      ? (() => {
        const quoteIndexes: number[] = [];
        for (let index = 0; index < text.length; index += 1) {
          if (text[index] === closingQuote && !isWordInternalApostrophe(text, index)) quoteIndexes.push(index);
        }
        return quoteIndexes.length === 2 && quoteIndexes[0] === 0 ? quoteIndexes[1]! : -1;
      })()
      : (() => {
        let depth = 0;
        for (let index = 1; index < contentEnd; index += 1) {
          if (text[index] === openingQuote) depth += 1;
          if (text[index] === closingQuote && !isWordInternalApostrophe(text, index) && depth-- === 0) return index;
        }
        return -1;
      })();
    if (matchingClosingQuote !== contentEnd - 1) break;

    text = `${text.slice(1, contentEnd - 1).trim()}${text.slice(contentEnd)}`.trim();
  }
  return text;
}

function voiceoverComparisonKey(value: string): string {
  const unwrapped = withoutWrappingQuotes(value);
  return unwrapped.replace(COMPARISON_EDGE_PUNCTUATION, '').trim();
}

function readableCopyMaterial(selected: SurveyCandidate): { readonly label: string; readonly reason: string; readonly detail: string } {
  const label = selected.label.trim();
  const reason = selected.reason.trim();
  const detail = selected.evidence[0]?.detail.trim();
  if (!detail || [label, reason, detail].some((value) => value.length < 2)) {
    throw new Error('Concept generation requires label, reason, and evidence detail that are not single-character fragments.');
  }
  return { label, reason, detail };
}

export function longestContiguousSharedRun(source: string, text: string): number {
  let longest = 0;
  let previous = Array.from<number>({ length: text.length + 1 }).fill(0);
  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    const current = Array.from<number>({ length: text.length + 1 }).fill(0);
    for (let textIndex = 1; textIndex <= text.length; textIndex += 1) {
      if (source[sourceIndex - 1] !== text[textIndex - 1]) continue;
      current[textIndex] = previous[textIndex - 1]! + 1;
      longest = Math.max(longest, current[textIndex]!);
    }
    previous = current;
  }
  return longest;
}

export function calculateCopyProvenance(
  selected: SurveyCandidate,
  lines: readonly VoiceLine[],
): CopyProvenance {
  const sourceText = [selected.label, selected.reason, ...selected.evidence.map((evidence) => evidence.detail)]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(' ');
  return {
    sourceId: selected.id,
    lines: lines.map((line) => ({
      beatIndex: line.beatIndex,
      verbatim: sourceText.includes(line.text),
      longestSharedRun: longestContiguousSharedRun(sourceText, line.text),
    })),
  };
}

function rewriteVoiceoverPrompt(input: VoiceoverRewriteInput): string {
  return [
    'Rewrite the source facts as one original voiceover line per beat.',
    'Return only a JSON string array with exactly the requested number of lines, in beat order.',
    'Every line must be a complete phrase at or below its beat character limit.',
    'Do not quote or copy source wording verbatim. Do not invent efficacy claims, measurements, numbers, or facts absent from the source.',
    `Source label: ${input.copyMaterial.label}`,
    `Source reason: ${input.copyMaterial.reason}`,
    `Source detail: ${input.copyMaterial.detail}`,
    `Beat durations in seconds: ${input.beatDurations.join(', ')}`,
    `Beat character limits: ${input.characterLimits.join(', ')}`,
    ...(input.overLimitLines?.length
      ? [`Your previous response exceeded the limits: ${input.overLimitLines.map((line) => `line ${line.lineNumber}: length ${line.length}, limit ${line.limit}`).join('; ')}. Return corrected complete phrases only.`]
      : []),
    ...(input.verbatimLines?.length
      ? [`Your previous response used wording identical to the source on: ${input.verbatimLines.map((line) => `line ${line.lineNumber}`).join(', ')}. Rewrite those lines with new phrasing.`]
      : []),
    `Forbidden expressions: ${input.forbiddenExpressions.join(', ') || '(none)'}`,
  ].join('\n');
}

async function defaultRewriteVoiceover(input: VoiceoverRewriteInput): Promise<readonly string[]> {
  const { streamLLM } = await import('../llm.js');
  const response = await streamLLM([{ role: 'user', content: rewriteVoiceoverPrompt(input) }], () => {}, {});
  const parsed: unknown = JSON.parse(response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(parsed) || parsed.some((line) => typeof line !== 'string')) throw new Error('Voiceover rewrite must return a JSON string array.');
  return parsed;
}

async function voiceoverFor(
  scene: SceneSpec | undefined,
  voiceId: string | undefined,
  selected: SurveyCandidate,
  copy: VoiceoverRewriteInput['copyMaterial'],
  forbidden: readonly string[],
  rewriteVoiceover: (input: VoiceoverRewriteInput) => Promise<readonly string[]>,
): Promise<ConceptVoiceover | undefined> {
  if (!scene) return undefined;
  if (!voiceId?.trim()) return { blocked: CONCEPT_VOICEOVER_BLOCKED };
  const beatDurations = scene.beats.map((beat) => beat.endSec - beat.startSec);
  const characterLimits = beatDurations.map(voiceoverCharacterLimit);
  const rewriteInput = { copyMaterial: copy, beatDurations, characterLimits, forbiddenExpressions: forbidden };
  const sanitized = (lines: readonly string[]) => lines.map((line, beatIndex) => ({
    beatIndex,
    text: withoutForbiddenExpressions(line, forbidden),
    voiceId: voiceId.trim(),
  }));
  const invalidRewrite = (lines: readonly string[]) => lines.length !== scene.beats.length || lines.some((line) => !line.trim());
  let rewritten: readonly string[];
  let sanitizedLines: ReturnType<typeof sanitized>;
  try {
    rewritten = await rewriteVoiceover(rewriteInput);
    if (invalidRewrite(rewritten)) return { blocked: CONCEPT_COPY_REWRITE_UNAVAILABLE };
    sanitizedLines = sanitized(rewritten);
    if (sanitizedLines.some((line) => !line.text.trim())) return { blocked: CONCEPT_COPY_REWRITE_UNAVAILABLE };
    const overLimitLines = rewritten.flatMap((line, index) => {
      const limit = characterLimits[index]!;
      return line.length > limit ? [{ lineNumber: index + 1, length: line.length, limit }] : [];
    });
    const verbatimLines = calculateCopyProvenance(selected, sanitizedLines).lines
      .flatMap((line) => line.verbatim ? [{ lineNumber: line.beatIndex + 1 }] : []);
    if (overLimitLines.length > 0 || verbatimLines.length > 0) {
      rewritten = await rewriteVoiceover({ ...rewriteInput, overLimitLines, verbatimLines });
      if (invalidRewrite(rewritten)) return { blocked: CONCEPT_COPY_REWRITE_UNAVAILABLE };
      sanitizedLines = sanitized(rewritten);
      if (sanitizedLines.some((line) => !line.text.trim())) return { blocked: CONCEPT_COPY_REWRITE_UNAVAILABLE };
      const hasVerbatim = calculateCopyProvenance(selected, sanitizedLines).lines.some((line) => line.verbatim);
      if (hasVerbatim) return { blocked: CONCEPT_COPY_REWRITE_VERBATIM };
      if (rewritten.some((line, index) => line.length > characterLimits[index]!)) {
        return { blocked: CONCEPT_COPY_REWRITE_TOO_LONG };
      }
    }
  } catch {
    return { blocked: CONCEPT_COPY_REWRITE_UNAVAILABLE };
  }
  return {
    lines: sanitizedLines.map((line) => ({
      ...line,
      text: captionSizedVoiceover(line.text, beatDurations[line.beatIndex]!),
    })),
  };
}

export function createDefaultConceptGenerator(deps: DefaultConceptGeneratorDeps = {}): ConceptGenerator {
  const rewriteVoiceover = deps.rewriteVoiceover ?? defaultRewriteVoiceover;
  return {
    generate: async (request) => {
      const selected = matchingCandidate(request.selection.trim(), request.survey.candidates);
      const category = request.survey.request.category?.trim() || 'product';
      const categoryForbiddenExpressions = isCosmeticsCategory(category) ? ['치료', '의약품적'] : ['근거 없는 효능'];
      const copy = readableCopyMaterial(selected);
      const candidates = [
        { hook: `${copy.label}: ${copy.reason}`, angle: copy.detail },
        { hook: `${copy.reason}: ${copy.label}`, angle: `“${copy.detail}”` },
      ];
      const voiceover = await voiceoverFor(request.scene, request.voiceId, selected, copy, categoryForbiddenExpressions, rewriteVoiceover);
      const copyProvenance = voiceover && 'lines' in voiceover
        ? calculateCopyProvenance(selected, voiceover.lines)
        : undefined;
      return {
        candidates,
        categoryForbiddenExpressions,
        tone: `evidence-led ${category}`,
        ...(request.scene ? { scene: request.scene } : {}),
        ...(voiceover ? { voiceover } : {}),
        ...(copyProvenance ? { copyProvenance } : {}),
      };
    },
  };
}

function assertConceptContract(generated: Omit<ConceptResult, 'selection' | 'skuGrounding'>): void {
  if (!Array.isArray(generated.candidates) || generated.candidates.length < 2
    || generated.candidates.some((candidate) => !candidate || typeof candidate.hook !== 'string' || !candidate.hook.trim()
      || typeof candidate.angle !== 'string' || !candidate.angle.trim())) {
    throw new Error('Concept generation requires multiple non-empty hook and angle candidates.');
  }
  if (typeof generated.tone !== 'string' || !generated.tone.trim()) {
    throw new Error('Concept generation requires a non-empty tone.');
  }
  if (!Array.isArray(generated.categoryForbiddenExpressions)
    || generated.categoryForbiddenExpressions.some((expression) => typeof expression !== 'string' || !expression.trim())) {
    throw new Error('Concept category forbidden expressions must be a string array.');
  }
}

export async function createConcept(
  request: ConceptRequest,
  generator: ConceptGenerator,
): Promise<ConceptResult> {
  if (!request.selection.trim()) throw new Error('A non-empty human selection is required before concept generation.');
  if (request.survey.candidates.length === 0) throw new Error('Concept generation requires evidence-backed survey candidates.');
  matchingCandidate(request.selection, request.survey.candidates);
  const generated = await generator.generate(request);
  assertConceptContract(generated);
  return {
    candidates: generated.candidates.map((candidate) => ({ hook: candidate.hook.trim(), angle: candidate.angle.trim() })),
    categoryForbiddenExpressions: generated.categoryForbiddenExpressions.map((expression) => expression.trim()),
    tone: generated.tone.trim(),
    selection: request.selection.trim(),
    ...(request.skuGrounding ? { skuGrounding: request.skuGrounding } : {}),
    ...(generated.scene ?? request.scene ? { scene: generated.scene ?? request.scene } : {}),
    ...(generated.voiceover ? { voiceover: generated.voiceover } : {}),
    ...(generated.copyProvenance ? { copyProvenance: generated.copyProvenance } : {}),
  };
}
