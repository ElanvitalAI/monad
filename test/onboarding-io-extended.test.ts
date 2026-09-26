// ── WizardIO Phase 2 extension (PR β) tests ──
//
// Verifies the optional `choose` / `showStep` / `showError` /
// `showHelp` / `showSuccess` surface plus the `*Or` helper fallbacks.
// Two flavours per helper: a host that *does* implement the new method
// (asserts the host's call wins), and a fallback host that doesn't
// (asserts the print/ask shape stays compatible with the legacy box).

import { describe, expect, test } from 'bun:test';
import {
  chooseFrom,
  showErrorOr,
  showHelpOr,
  showStepOr,
  showSuccessOr,
  type ChoiceOption,
  type StepSpec,
} from '../src/onboarding/io-extended';
import { scriptedIO, type WizardIO } from '../src/onboarding';

const opts3: ChoiceOption<string>[] = [
  { key: '1', label: 'apple', value: 'a' },
  { key: '2', label: 'banana', value: 'b' },
  { key: '3', label: 'cherry', value: 'c', description: 'red' },
];

describe('chooseFrom · fallback path (no io.choose)', () => {
  test('renders numbered list + accepts numeric input', async () => {
    const io = scriptedIO(['2']);
    const v = await chooseFrom(io, '  Pick a fruit:', opts3);
    expect(v).toBe('b');
    const log = io.outputs.join('\n');
    expect(log).toContain('1) apple');
    expect(log).toContain('2) banana');
    expect(log).toContain('3) cherry — red');
  });

  test('accepts the option key letter as input', async () => {
    const io = scriptedIO(['3']);
    const v = await chooseFrom(io, '', opts3);
    expect(v).toBe('c');
  });

  test('blank input picks defaultIndex (default 0)', async () => {
    const io = scriptedIO(['']);
    const v = await chooseFrom(io, '', opts3);
    expect(v).toBe('a');
  });

  test('blank input picks the explicit defaultIndex when provided', async () => {
    const io = scriptedIO(['']);
    const v = await chooseFrom(io, '', opts3, { defaultIndex: 2 });
    expect(v).toBe('c');
  });

  test('invalid input retries up to 3x then accepts default', async () => {
    const io = scriptedIO(['9', 'x', '99']);
    const v = await chooseFrom(io, '', opts3, { defaultIndex: 1 });
    expect(v).toBe('b');
    const log = io.outputs.join('\n');
    expect(log).toMatch(/invalid choice "9"/);
    expect(log).toMatch(/invalid choice "x"/);
  });

  test('help line prints above the option list when provided', async () => {
    const io = scriptedIO(['1']);
    await chooseFrom(io, 'Pick:', opts3, { help: 'tip — fruits only' });
    const log = io.outputs.join('\n');
    expect(log).toContain('tip — fruits only');
    const tipIdx = io.outputs.findIndex((s) => s.includes('tip — fruits only'));
    const promptIdx = io.outputs.findIndex((s) => s === 'Pick:');
    expect(tipIdx).toBeLessThan(promptIdx);
  });

  test('throws on empty options array', async () => {
    const io = scriptedIO([]);
    await expect(chooseFrom(io, '', [])).rejects.toThrow();
  });
});

describe('chooseFrom · host implements io.choose', () => {
  test('host method wins; fallback never runs', async () => {
    const calls: string[] = [];
    const customIO: WizardIO = {
      ask: async () => 'should-not-be-called',
      print: () => {},
      close: () => {},
      choose: async (_prompt, options) => {
        calls.push('host-choose');
        return options[1].value;
      },
    };
    const v = await chooseFrom(customIO, '', opts3);
    expect(v).toBe('b');
    expect(calls).toEqual(['host-choose']);
  });

  test('forwards locale-independent identifiers and the exact presented options', async () => {
    const presented: ChoiceOption<string>[] = [
      { key: 'y', label: 'はい', value: 'yes', description: '続ける' },
      { key: 'n', label: 'いいえ', value: 'no' },
    ];
    let receivedPrompt: string | undefined;
    let receivedOptions: readonly unknown[] | undefined;
    let receivedOpts: unknown;
    let receivedStepId: string | undefined;
    let receivedPickerId: string | undefined;
    const io: WizardIO = {
      ask: async () => 'should-not-be-called',
      print: () => { throw new Error('fallback should not print'); },
      close: () => {},
      choose: async (prompt, options, opts, stepId, pickerId) => {
        receivedPrompt = prompt;
        receivedOptions = options;
        receivedOpts = opts;
        receivedStepId = stepId;
        receivedPickerId = pickerId;
        return options[0]!.value;
      },
    };

    const result = await chooseFrom(
      io,
      '保存して完了しますか？',
      presented,
      { defaultIndex: 1 },
      'summary',
      'save-and-finish',
    );

    expect(result).toBe('yes');
    expect(receivedPrompt).toBe('保存して完了しますか？');
    expect(receivedOptions).toBe(presented);
    expect(receivedOptions).toEqual(presented);
    expect(receivedOpts).toEqual({ defaultIndex: 1 });
    expect(receivedStepId).toBe('summary');
    expect(receivedPickerId).toBe('save-and-finish');
  });

  test('omitted identifiers preserve the existing prompt and default arguments', async () => {
    const calls: unknown[][] = [];
    const io: WizardIO = {
      ask: async () => 'should-not-be-called',
      print: () => {},
      close: () => {},
      choose: async (...args) => {
        calls.push(args);
        return args[1][0]!.value;
      },
    };

    await chooseFrom(io, 'Pick:', opts3, { defaultIndex: 1 });

    expect(calls).toEqual([['Pick:', opts3, { defaultIndex: 1 }, undefined, undefined]]);
  });
});

describe('showStepOr', () => {
  test('fallback prints the legacy box header', () => {
    const io = scriptedIO([]);
    const spec: StepSpec = { index: 2, total: 6, title: 'Skill directories' };
    showStepOr(io, spec);
    const log = io.outputs.join('\n');
    expect(log).toContain('Step 2 / 6 — Skill directories');
    // Trailing dashes still pad the header to a stable width.
    expect(log).toMatch(/───+$/m);
  });

  test('fallback excerpt body wraps multi-line text in box prefix', () => {
    const io = scriptedIO([]);
    const spec: StepSpec = {
      index: 4,
      total: 6,
      title: 'Telegram bot',
      excerpt: 'line one\nline two',
    };
    showStepOr(io, spec);
    expect(io.outputs.some((s) => s === '│  line one')).toBe(true);
    expect(io.outputs.some((s) => s === '│  line two')).toBe(true);
  });

  test('host implements showStep — fallback skipped', () => {
    const captured: StepSpec[] = [];
    const io: WizardIO = {
      ask: async () => '',
      print: () => { throw new Error('fallback should not print'); },
      close: () => {},
      showStep: (spec) => { captured.push(spec); },
    };
    showStepOr(io, { index: 1, total: 6, title: 'LLM' });
    expect(captured).toEqual([{ index: 1, total: 6, title: 'LLM' }]);
  });
});

describe('showErrorOr / showHelpOr / showSuccessOr', () => {
  test('error fallback uses `! field: msg` prefix', () => {
    const io = scriptedIO([]);
    showErrorOr(io, 'Bot Token', 'expected digits:chars');
    expect(io.outputs).toContain('  ! Bot Token: expected digits:chars');
  });

  test('help fallback uses `↳ field: msg` prefix', () => {
    const io = scriptedIO([]);
    showHelpOr(io, 'API key', 'press Enter to keep existing');
    expect(io.outputs).toContain('  ↳ API key: press Enter to keep existing');
  });

  test('success fallback uses `✓ msg` prefix', () => {
    const io = scriptedIO([]);
    showSuccessOr(io, 'Connected as @elanoustestbot');
    expect(io.outputs).toContain('  ✓ Connected as @elanoustestbot');
  });

  test('host overrides win — fallbacks skipped', () => {
    const captured: { kind: string; field?: string; message: string }[] = [];
    const io: WizardIO = {
      ask: async () => '',
      print: () => { throw new Error('fallback should not print'); },
      close: () => {},
      showError: (field, message) => captured.push({ kind: 'error', field, message }),
      showHelp: (field, message) => captured.push({ kind: 'help', field, message }),
      showSuccess: (message) => captured.push({ kind: 'success', message }),
    };
    showErrorOr(io, 'f', 'e');
    showHelpOr(io, 'f', 'h');
    showSuccessOr(io, 's');
    expect(captured.map((c) => c.kind)).toEqual(['error', 'help', 'success']);
  });
});
