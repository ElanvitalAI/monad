// Discord Native Poll builder.
//
// PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.3 (M3.3)
//
// Discord native poll (released 2024) — a first-class poll attached
// to a message. Slash command /poll lets the user create one without
// leaving Discord. Each option can have an emoji.
//
// REST: included as `poll: {...}` in the body of `POST
// /channels/{id}/messages` or webhook execute. See:
// https://discord.com/developers/docs/resources/poll

import type { ReactionEmoji } from './reaction-handler.js';

/** Discord poll layout types. */
export const POLL_LAYOUT_DEFAULT = 1;
export type PollLayoutType = typeof POLL_LAYOUT_DEFAULT;

/** Allowed durations (Discord docs): 1 to 768 hours (32 days). */
export type PollDurationHours = number;
export const POLL_DURATION_MIN_HOURS = 1;
export const POLL_DURATION_MAX_HOURS = 768;
export const POLL_DURATION_DEFAULT_HOURS = 24;

/** Caller-friendly answer spec. */
export interface PollAnswerSpec {
  readonly text: string;
  readonly emoji?: ReactionEmoji;
}

export interface PollSpec {
  readonly question: string;
  readonly answers: readonly PollAnswerSpec[];
  /** Default 24. Clamped to [1, 768]. */
  readonly durationHours?: PollDurationHours;
  readonly allowMultiselect?: boolean;
  readonly layoutType?: PollLayoutType;
}

/** Build the Discord poll body — to be merged into a message body
 *  as `poll: <result>`. Pure. */
export function buildPoll(spec: PollSpec): Record<string, unknown> {
  if (!spec.question.trim()) throw new Error('poll: question required');
  if (spec.answers.length < 1) throw new Error('poll: at least 1 answer');
  if (spec.answers.length > 10) throw new Error('poll: at most 10 answers');

  const duration = clamp(
    spec.durationHours ?? POLL_DURATION_DEFAULT_HOURS,
    POLL_DURATION_MIN_HOURS, POLL_DURATION_MAX_HOURS,
  );

  return {
    question: { text: spec.question },
    answers: spec.answers.map((a, i) => {
      const media: Record<string, unknown> = { text: a.text };
      if (a.emoji) media['emoji'] = toDiscordEmoji(a.emoji);
      return { answer_id: i + 1, poll_media: media };
    }),
    duration,
    allow_multiselect: spec.allowMultiselect === true,
    layout_type: spec.layoutType ?? POLL_LAYOUT_DEFAULT,
  };
}

/** Parse a freeform answers string like 'A | B | C' or 'yes,no' into
 *  PollAnswerSpec[]. Splits on '|' first (preferred), then ',' if
 *  no '|' present. Strips whitespace, drops empties. */
export function parseAnswersString(raw: string): PollAnswerSpec[] {
  if (!raw) return [];
  const sep = raw.includes('|') ? '|' : ',';
  return raw.split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((text) => ({ text }));
}

function toDiscordEmoji(e: ReactionEmoji): { name: string; id?: string } {
  const out: { name: string; id?: string } = { name: e.name };
  if (e.id) out.id = e.id;
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
