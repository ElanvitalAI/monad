// β-2 + β-followup wiring — askWithHelp helper.
//
// Pins the contract the onboarding step functions rely on:
//   1. `?` / `help` / `h` → showHelp() prints the markdown body, the
//      prompt re-fires, and the help input is NOT counted as the
//      answer.
//   2. Plain answer (no validator) → returns immediately.
//   3. Validator + invalid → askValidated retry loop fires, error
//      printed, retried up to maxAttempts.
//   4. Validator + help-then-valid → help shows first, validator runs
//      against the second input.
//   5. Secret prompts route through `askSecret` when the IO supports it.

import { describe, expect, test } from 'bun:test';
import { askWithHelp } from '../src/onboarding/wire-helpers';
import { scriptedIO } from '../src/onboarding';
import { validateNonEmpty, validateUrl } from '../src/onboarding/validators';

describe('askWithHelp', () => {
  test('plain answer (no validate, no help) → returns first input', async () => {
    const io = scriptedIO(['hello']);
    const value = await askWithHelp(io, 'q: ');
    expect(value).toBe('hello');
  });

  test('? input shows help and re-prompts', async () => {
    const io = scriptedIO(['?', 'real-answer']);
    const value = await askWithHelp(io, 'q: ', { topic: 'general' });
    expect(value).toBe('real-answer');
    // Help body header is the marker we look for.
    expect(io.outputs.some((line) => /help/i.test(line))).toBe(true);
  });

  test('help / h aliases also trigger help routing', async () => {
    const io1 = scriptedIO(['help', 'A']);
    const v1 = await askWithHelp(io1, 'q: ', { topic: 'general' });
    expect(v1).toBe('A');

    const io2 = scriptedIO(['h', 'B']);
    const v2 = await askWithHelp(io2, 'q: ', { topic: 'general' });
    expect(v2).toBe('B');
  });

  test('? without topic configured → returned as the answer', async () => {
    // When a prompt opts out of help routing, `?` is just a literal
    // value. Used by yes/no toggles where `?` would be noise.
    const io = scriptedIO(['?']);
    const value = await askWithHelp(io, 'q: ');
    expect(value).toBe('?');
  });

  test('validator passes on first try → returns value', async () => {
    const io = scriptedIO(['ok']);
    const value = await askWithHelp(io, 'q: ', {
      validate: validateNonEmpty('field'),
    });
    expect(value).toBe('ok');
  });

  test('validator rejects then accepts → retries until valid', async () => {
    const io = scriptedIO(['', 'good']);
    const value = await askWithHelp(io, 'q: ', {
      validate: validateNonEmpty('field'),
    });
    expect(value).toBe('good');
    // Error message is surfaced once.
    expect(io.outputs.some((line) => /must be at least/i.test(line))).toBe(true);
  });

  test('validator + maxAttempts: returns last value after limit', async () => {
    const io = scriptedIO(['', '', '']);
    const value = await askWithHelp(io, 'q: ', {
      validate: validateNonEmpty('field'),
      maxAttempts: 2,
    });
    // 3 inputs · validator rejects each · last attempt returns ''.
    expect(value).toBe('');
  });

  test('help then invalid then valid → help shown, validator runs twice', async () => {
    const io = scriptedIO(['?', 'not-a-url', 'https://ok.dev']);
    const value = await askWithHelp(io, 'q: ', {
      topic: 'general',
      validate: validateUrl(),
    });
    expect(value).toBe('https://ok.dev');
    expect(io.outputs.some((line) => /help/i.test(line))).toBe(true);
    expect(io.outputs.some((line) => /Not a valid URL/.test(line))).toBe(true);
  });

  test('secret prompts route through askSecret when available', async () => {
    let askSecretCalls = 0;
    const io = scriptedIO(['secret-value']);
    // Wrap the scriptedIO to count askSecret invocations.
    const wrapped = {
      ...io,
      askSecret: async (prompt: string) => {
        askSecretCalls += 1;
        return io.ask(prompt);
      },
    };
    const value = await askWithHelp(wrapped, 'token: ', { secret: true });
    expect(value).toBe('secret-value');
    expect(askSecretCalls).toBe(1);
  });

  test('non-secret prompts use plain ask even when askSecret available', async () => {
    let askSecretCalls = 0;
    const io = scriptedIO(['plain']);
    const wrapped = {
      ...io,
      askSecret: async (prompt: string) => {
        askSecretCalls += 1;
        return io.ask(prompt);
      },
    };
    const value = await askWithHelp(wrapped, 'q: ');
    expect(value).toBe('plain');
    expect(askSecretCalls).toBe(0);
  });

  test('multiple ? in a row → keeps re-prompting until non-help', async () => {
    const io = scriptedIO(['?', '?', 'finally']);
    const value = await askWithHelp(io, 'q: ', { topic: 'general' });
    expect(value).toBe('finally');
    // Help body printed twice (one per `?`).
    const helpLines = io.outputs.filter((line) => /───── help ─────/.test(line));
    expect(helpLines.length).toBe(2);
  });

  test('? after validator failure does NOT count toward attempts', async () => {
    const io = scriptedIO(['', '?', 'good']);
    const value = await askWithHelp(io, 'q: ', {
      topic: 'general',
      validate: validateNonEmpty('field'),
      maxAttempts: 2,
    });
    expect(value).toBe('good');
  });
});
