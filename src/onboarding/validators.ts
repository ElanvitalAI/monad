// Per-step validators + async retry wrapper for the setup wizard.
//
// β-2 (2026-04-28). The 5 step functions already have inline regex
// checks and post-paste API probes (Telegram /getMe, Discord
// /users/@me). This module pulls those patterns into a small set of
// reusable predicate fns + a uniform `askValidated()` helper so every
// step can opt into the same retry loop and error-message format
// without adding new control flow to the imperative `io.ask()` chain.
//
// Validators return `null` for success or a string error message.
// Async validators return a Promise — `askValidated()` awaits both.
//
// The wrapper lives outside `WizardIO` deliberately — keeps the
// interface minimal so tests + alternate impls don't grow surface
// area, and lets `elanous setup --non-interactive` skip validation
// entirely (CI typically can't reach Telegram's /getMe and would
// trip the live validator).

import { existsSync, statSync } from 'node:fs';
import type { WizardIO } from '../onboarding.js';
import { isHelpRequest, showHelp, type HelpTopic } from './help-overlay.js';

export type ValidatorResult = string | null;
export type Validator = (value: string) => ValidatorResult | Promise<ValidatorResult>;

export interface AskValidatedOptions {
  /** Use askSecret when present + true. */
  secret?: boolean;
  /** Stable answer-map key for this question. */
  field?: string;
  /** Max attempts before giving up + accepting the last value. Default 3. */
  maxAttempts?: number;
  /** Skip retry on non-TTY hosts (CI / piped). Default true. */
  skipOnNonTty?: boolean;
  /** PR-Δ21 (Sprint 16 · 2026-04-30 · F12) — opt-in help overlay
   *  routing. When set, typing `?` / `help` / `h` at the prompt prints
   *  the matching markdown blob and re-prompts WITHOUT consuming the
   *  attempt counter. Mirrors askWithHelp's contract so step
   *  functions can drop topic onto any askValidated callsite (api
   *  key, bot token, etc.) and get the same `?` discoverability they
   *  already have on plain text prompts. */
  topic?: HelpTopic;
  /** PR-Δ22 (Sprint 16 · 2026-04-30 · F2-sub) — opt-in sub-prompt
   *  Back navigation. When true, typing `back` / `b` / `B` (or `←`)
   *  at this prompt throws SubPromptBackError so a calling step's
   *  sub-prompt orchestrator can rewind to the previous sub-prompt
   *  WITHIN the same step (e.g. Telegram bot token → Telegram enable
   *  Y/N). The literal `back` is reserved as a sentinel only when
   *  this opt-in is on; off by default to avoid surprising legacy
   *  callsites that might accept `back` as a real value. */
  allowSubBack?: boolean;
}

/** PR-Δ22 (Sprint 16 · 2026-04-30 · F2-sub) — sub-prompt Back error.
 *
 *  Thrown by askValidated / askWithHelp when `allowSubBack` is on and
 *  the user types the back sentinel. A step function's sub-prompt
 *  orchestrator catches this to rewind to the previous sub-prompt;
 *  if subIdx is already 0, the orchestrator re-throws WizardBackError
 *  to escape the step entirely (matching Δ16's step-level Back).
 *
 *  Decoupled from WizardBackError so the orchestrator can route the
 *  two layers (step Back vs. sub Back) independently. */
export class SubPromptBackError extends Error {
  constructor() {
    super('wizard back to previous sub-prompt');
    this.name = 'SubPromptBackError';
  }
}

/** Recognize the literal back sentinel. Mirrors isHelpRequest's
 *  contract: case-insensitive + accepts `back`, `b`, `←`. */
export function isSubBackRequest(input: string): boolean {
  const t = input.trim().toLowerCase();
  return t === 'back' || t === 'b' || t === '←';
}

/** Ask a prompt, validate the answer, retry on failure. */
export async function askValidated(
  io: WizardIO,
  prompt: string,
  validate: Validator,
  opts: AskValidatedOptions = {},
): Promise<string> {
  const max = Math.max(1, opts.maxAttempts ?? 3);
  const topic = opts.topic;
  const allowSubBack = opts.allowSubBack === true;
  let attempt = 0;
  // Single loop owns sub-back escape, help routing, and validation
  // retry. Order matters:
  //   1. allowSubBack (Δ22) → instant throw, never reaches validate.
  //   2. topic help (Δ21) → re-prompt without spending attempt budget.
  //   3. validate → success returns; failure consumes one attempt.
  // Help inputs and back-sentinel inputs are not stashed in lastValue,
  // so the max-attempts fallback returns the last validation-failing
  // input, not a literal `?` / `back`.
  while (true) {
    const value =
      opts.secret && io.askSecret ? await io.askSecret(prompt, opts.field) : await io.ask(prompt, opts.field);
    if (allowSubBack && isSubBackRequest(value)) throw new SubPromptBackError();
    if (topic && isHelpRequest(value)) {
      showHelp(io, topic);
      continue;
    }
    const err = await Promise.resolve(validate(value));
    if (err === null) return value;
    io.print(`  ! ${err}`);
    attempt += 1;
    if (attempt >= max) {
      io.print('  (max attempts reached — keeping last value; you can re-run `elanous setup` later)');
      return value;
    }
  }
}

// ── Built-in validators ─────────────────────────────────────────────

/** Non-empty + minimum-length check. */
export function validateNonEmpty(label: string, minLen = 1): Validator {
  return (v) => {
    const trimmed = v.trim();
    if (trimmed.length < minLen) {
      return `${label} must be at least ${minLen} character(s).`;
    }
    return null;
  };
}

/** Telegram bot token shape — `<digits>:<chars>{20+}`. */
export function validateTelegramToken(): Validator {
  return (v) => {
    if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(v)) {
      return 'Token doesn\'t match the <digits>:<chars> pattern from @BotFather.';
    }
    return null;
  };
}

/** Discord bot token — permissive shape: long + no whitespace. */
export function validateDiscordToken(): Validator {
  return (v) => {
    if (!/^[\w.-]{20,}$/.test(v) || /\s/.test(v)) {
      return 'Token doesn\'t look right (too short or has whitespace).';
    }
    return null;
  };
}

/** http / https URL. */
export function validateUrl(opts: { allowHttp?: boolean } = {}): Validator {
  return (v) => {
    const trimmed = v.trim();
    if (!trimmed) return 'URL required.';
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        return 'Only http / https URLs accepted.';
      }
      if (u.protocol === 'http:' && !opts.allowHttp) {
        return 'Use https. (Set allowHttp: true if you really need plain http.)';
      }
      return null;
    } catch {
      return 'Not a valid URL.';
    }
  };
}

/** Filesystem path — exists + is-directory. Returns null even if
 *  missing when `requireExists=false` (so users can configure paths
 *  before creating them).
 *
 *  PR-Δ7 (2026-04-28) — `allowEmpty` opt-in lets callers preserve
 *  default-on-blank semantics. The wizard's vault prompt uses this:
 *  blank input means "keep existing default" which the step function
 *  resolves after the validator runs. */
export function validatePath(opts: {
  requireExists?: boolean;
  requireDir?: boolean;
  allowEmpty?: boolean;
} = {}): Validator {
  return (v) => {
    const trimmed = v.trim();
    if (!trimmed) return opts.allowEmpty ? null : 'Path required.';
    if (!existsSync(trimmed)) {
      return opts.requireExists
        ? `"${trimmed}" does not exist.`
        : null;
    }
    if (opts.requireDir) {
      try {
        if (!statSync(trimmed).isDirectory()) return `"${trimmed}" is not a directory.`;
      } catch {
        return `Cannot stat "${trimmed}".`;
      }
    }
    return null;
  };
}

/** API key — non-empty + minimum length. Different providers have
 *  different prefixes; we don't enforce them strictly here so the
 *  legacy step functions keep accepting paste-friendly inputs. */
export function validateApiKey(label: string, minLen = 16): Validator {
  return (v) => {
    const trimmed = v.trim();
    if (trimmed.length === 0) return `${label} required.`;
    if (trimmed.length < minLen) {
      return `${label} looks too short (expected ≥ ${minLen} chars).`;
    }
    if (/\s/.test(trimmed)) return `${label} should not contain whitespace.`;
    return null;
  };
}

/** Comma-separated list of integers. Returns null when at least one
 *  integer is parseable (matching the existing telegram allowedUsers
 *  behaviour where "anything goes" is OK; the wizard then warns
 *  about empty lists separately).
 *
 *  PR-Δ7 (2026-04-28) — `allowMentionWrappers` opt-in strips Discord
 *  mention shapes (`<@123>`, `<@!123>`) before counting integer
 *  tokens, matching the Discord step's paste-friendly contract. */
export function validateIntList(opts: { allowMentionWrappers?: boolean } = {}): Validator {
  return (v) => {
    if (v.trim().length === 0) return null;
    const parts = v.split(/[,\s]+/).filter(Boolean);
    const stripped = opts.allowMentionWrappers
      ? parts.map((p) => p.replace(/^<@!?/, '').replace(/>$/, ''))
      : parts;
    const okCount = stripped.filter((p) => /^-?\d+$/.test(p)).length;
    if (parts.length > 0 && okCount === 0) {
      return 'Expected one or more integer IDs (comma-separated).';
    }
    return null;
  };
}

/** Compose multiple validators — returns the first error, or null
 *  if all pass. */
export function chain(...validators: Validator[]): Validator {
  return async (v) => {
    for (const fn of validators) {
      const err = await Promise.resolve(fn(v));
      if (err !== null) return err;
    }
    return null;
  };
}
