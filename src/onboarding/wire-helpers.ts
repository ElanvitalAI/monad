// β-2 + β-followup wiring (2026-04-28). Glues `validators.askValidated`
// and `help-overlay.isHelpRequest` / `showHelp` into one helper that
// step functions in `onboarding.ts` can drop in over their existing
// `io.ask(prompt)` callsites without growing per-callsite control flow.
//
// Why a single helper instead of two? Because every interactive prompt
// in the wizard wants both behaviors:
//   - Type `?` (or `help` / `h`) → show topic-specific help, re-prompt.
//   - Type something invalid → show inline error, retry up to N times.
// Routing them through one wrapper means the step functions stay flat
// (one line per question) and never have to remember whether the
// help-or-validate ordering is right (help check happens BEFORE
// validation so users can ask for help on a prompt whose default would
// fail validation).
//
// The wrapper deliberately does NOT live inside `WizardIO` — keeping
// it a free function lets `nonInteractiveIO()` skip both behaviors
// (it has no user to prompt; help / retry are TTY-only concepts).

import type { WizardIO } from '../onboarding.js';
import {
  type Validator,
  type AskValidatedOptions,
  SubPromptBackError,
  isSubBackRequest,
} from './validators.js';
import {
  isHelpRequest,
  showHelp,
  type HelpTopic,
} from './help-overlay.js';

export interface AskWithHelpOptions extends AskValidatedOptions {
  /** When set, typing `?` / `help` / `h` at the prompt prints the
   *  matching markdown blob and re-prompts without consuming the
   *  attempt counter. Omit to disable help routing for this prompt
   *  (e.g. yes/no toggles where help would be noise). */
  topic?: HelpTopic;
  /** Optional validator. Same shape as `askValidated`'s `validate`
   *  param. When omitted, no validation is performed (the prompt
   *  returns the first non-help response). */
  validate?: Validator;
}

/** Ask a prompt with help routing + optional validation. Used as a
 *  drop-in replacement for `io.ask(prompt)` in step functions:
 *
 *    const value = await askWithHelp(io, '  Vault path: ', {
 *      topic: 'obsidian',
 *      validate: validatePath({ requireDir: true }),
 *    });
 *
 *  Order of operations per attempt:
 *    1. Read a line (secret-aware via `opts.secret`).
 *    2. If the line is a help marker AND a topic is configured →
 *       print the help body + re-prompt (no attempt cost).
 *    3. If a validator is configured → validate; on failure print the
 *       inline error and retry (counts toward `maxAttempts`).
 *    4. Otherwise return the value as-is. */
export async function askWithHelp(
  io: WizardIO,
  prompt: string,
  opts: AskWithHelpOptions = {},
): Promise<string> {
  const { topic, validate, secret = false, maxAttempts = 3, allowSubBack = false } = opts;
  const max = Math.max(1, maxAttempts);

  // Single loop owns BOTH help routing and validation retry — we don't
  // delegate to `askValidated` because it has no help check, so a `?`
  // typed mid-retry would otherwise be passed straight to the
  // validator instead of opening the help overlay. Help inputs never
  // count toward the attempt budget.
  //
  // PR-Δ22 (Sprint 16 · 2026-04-30 · F2-sub) — when `allowSubBack` is
  // on, the sentinel `back` / `b` / `←` throws SubPromptBackError so
  // a step's sub-prompt orchestrator can rewind. Like help, this is
  // an instant escape that doesn't spend the attempt budget.
  let attempt = 0;
  let lastValue = '';
  while (true) {
    const value = await askOnce(io, prompt, secret, opts.field);
    if (allowSubBack && isSubBackRequest(value)) throw new SubPromptBackError();
    lastValue = value;
    if (topic && isHelpRequest(value)) {
      showHelp(io, topic);
      continue;
    }
    if (!validate) return value;
    const err = await Promise.resolve(validate(value));
    if (err === null) return value;
    io.print(`  ! ${err}`);
    attempt += 1;
    if (attempt >= max) {
      io.print('  (max attempts reached — keeping last value; you can re-run `elanous setup` later)');
      return lastValue;
    }
  }
}

async function askOnce(io: WizardIO, prompt: string, secret: boolean, field?: string): Promise<string> {
  return secret && io.askSecret ? io.askSecret(prompt, field) : io.ask(prompt, field);
}
