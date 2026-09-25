import type { SceneSpec } from './scene-spec.js';

/** ElevenLabs /with-timestamps alignment persisted by sound-plan. */
export interface ElevenLabsCharacterAlignment {
  readonly characters: readonly string[];
  readonly character_start_times_seconds: readonly number[];
  readonly character_end_times_seconds: readonly number[];
}

export interface CaptionDialogue {
  readonly beatIndex: number;
  readonly alignment?: ElevenLabsCharacterAlignment;
}

export interface CaptionLine {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface Caption {
  readonly beatIndex: number;
  readonly lines: readonly CaptionLine[];
}

export interface CaptionPlan {
  readonly captions: readonly Caption[];
  readonly blocked: readonly string[];
}

type AlignedWord = { readonly text: string; readonly startSec: number; readonly endSec: number };

// These limits deliberately mirror qc.ts's caption-lines rule.
// The density minimum applies only to the first line; a short trailing line is allowed.
export const CAPTION_LINE_MIN_CHARS = 12;
export const CAPTION_LINE_MAX_CHARS = 16;
export const CAPTION_MAX_LINES = 2;

function usableAlignment(alignment: ElevenLabsCharacterAlignment | undefined): alignment is ElevenLabsCharacterAlignment {
  if (alignment === undefined) return false;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (characters.length === 0 || characters.length !== starts.length || starts.length !== ends.length) return false;
  return characters.every((character, index) => {
    const start = starts[index]!;
    const end = ends[index]!;
    const previousStart = index === 0 ? undefined : starts[index - 1]!;
    const previousEnd = index === 0 ? undefined : ends[index - 1]!;
    return typeof character === 'string'
      && character.length > 0
      && Number.isFinite(start)
      && Number.isFinite(end)
      && start >= 0
      && end >= start
      && (previousStart === undefined || start >= previousStart)
      && (previousEnd === undefined || end >= previousEnd);
  });
}

function alignedWords(alignment: ElevenLabsCharacterAlignment): readonly AlignedWord[] {
  const words: AlignedWord[] = [];
  let text = '';
  let startSec: number | undefined;
  let endSec: number | undefined;
  for (const [index, character] of alignment.characters.entries()) {
    if (/\s/.test(character)) {
      if (text) words.push({ text, startSec: startSec!, endSec: endSec! });
      text = '';
      startSec = undefined;
      endSec = undefined;
      continue;
    }
    text += character;
    startSec ??= alignment.character_start_times_seconds[index]!;
    endSec = alignment.character_end_times_seconds[index]!;
  }
  if (text) words.push({ text, startSec: startSec!, endSec: endSec! });
  return words;
}

function lineLength(words: readonly AlignedWord[]): number {
  return words.reduce((length, word, index) => length + word.text.length + (index === 0 ? 0 : 1), 0);
}

function validLine(words: readonly AlignedWord[], requiresDensityMinimum: boolean): boolean {
  const length = lineLength(words);
  return (!requiresDensityMinimum || length >= CAPTION_LINE_MIN_CHARS)
    && length <= CAPTION_LINE_MAX_CHARS;
}

function splitLines(words: readonly AlignedWord[]): readonly (readonly AlignedWord[])[] | undefined {
  if (validLine(words, true)) return [words];
  if (CAPTION_MAX_LINES < 2) return undefined;

  for (let splitAt = 1; splitAt < words.length; splitAt += 1) {
    const first = words.slice(0, splitAt);
    const second = words.slice(splitAt);
    if (validLine(first, true) && validLine(second, false)) return [first, second];
  }
  return undefined;
}

/**
 * Converts caller-supplied ElevenLabs character alignment into master-timeline caption lines.
 * It is intentionally a pure planner: no media, filesystem, network, transcription, or rendering work occurs here.
 */
export function buildCaptionPlan(scene: SceneSpec, dialogues: readonly CaptionDialogue[]): CaptionPlan {
  const captions: Caption[] = [];
  const blocked: string[] = [];
  for (const dialogue of dialogues) {
    const beat = scene.beats[dialogue.beatIndex];
    if (beat === undefined) {
      blocked.push(`missing-beat:beat-${dialogue.beatIndex + 1}`);
      continue;
    }
    if (!usableAlignment(dialogue.alignment)) {
      blocked.push(`missing-usable-alignment:beat-${dialogue.beatIndex + 1}`);
      continue;
    }
    const words = alignedWords(dialogue.alignment);
    const groupedLines = splitLines(words);
    if (groupedLines === undefined) {
      blocked.push(`caption-line-limits-exceeded:beat-${dialogue.beatIndex + 1}`);
      continue;
    }
    const offsetMs = Math.round(beat.startSec * 1000);
    captions.push({
      beatIndex: dialogue.beatIndex,
      lines: groupedLines.map((line) => ({
        text: line.map((word) => word.text).join(' '),
        startMs: offsetMs + Math.round(line[0]!.startSec * 1000),
        endMs: offsetMs + Math.round(line.at(-1)!.endSec * 1000),
      })),
    });
  }
  return { captions, blocked };
}
