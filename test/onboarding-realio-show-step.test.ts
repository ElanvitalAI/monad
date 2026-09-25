// ── realIO().showStep — Phase 3 single-screen renderer (PR γ) ──
//
// Real-IO mode wires `showStep` through the expression step-renderer
// + progress dots. The test captures stdout writes (rather than
// touching a real TTY) and verifies:
//   1. The localized title is present in the output.
//   2. The step counter ("Step N / total") is preserved.
//   3. The progress dot row (●●●○○) is appended next to the title.
//   4. Excerpt body lines render inside the box prefix.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { realIO } from '../src/onboarding';

let writes: string[] = [];
let originalWrite: typeof process.stdout.write;
let originalHasColors: typeof process.stdout.hasColors | undefined;

beforeEach(() => {
  writes = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  originalHasColors = process.stdout.hasColors;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    if (typeof chunk === 'string') writes.push(chunk);
    else writes.push(Buffer.from(chunk).toString('utf-8'));
    return true;
  }) as typeof process.stdout.write;
  // Force mono so we can assert the visible payload without escape
  // code noise.
  (process.stdout as any).hasColors = () => false;
});

afterEach(() => {
  process.stdout.write = originalWrite;
  if (originalHasColors) (process.stdout as any).hasColors = originalHasColors;
});

describe('realIO().showStep', () => {
  test('renders localized title + counter + progress dots', () => {
    const io = realIO();
    io.showStep!({ index: 3, total: 6, title: 'Obsidian vault' });
    io.close();
    const out = writes.join('');
    expect(out).toContain('Step 3 / 6');
    expect(out).toContain('Obsidian vault');
    // Mono mode → bare unicode dots, no SGR
    expect(out).toContain('●●●○○○');
  });

  test('renders excerpt body lines under the header', () => {
    const io = realIO();
    io.showStep!({
      index: 1,
      total: 6,
      title: 'LLM provider',
      excerpt: 'first line\nsecond line',
    });
    io.close();
    const out = writes.join('');
    // step-renderer's renderStepBlock prefixes body lines with the
    // border-left character. Mono mode keeps content visible.
    expect(out).toContain('first line');
    expect(out).toContain('second line');
  });

  test('progress dot count tracks (current/total)', () => {
    const io = realIO();
    io.showStep!({ index: 1, total: 6, title: 'Step 1' });
    io.showStep!({ index: 6, total: 6, title: 'Step 6' });
    io.close();
    const out = writes.join('');
    expect(out).toContain('●○○○○○');   // 1/6 — one filled, five empty
    expect(out).toContain('●●●●●●');   // 6/6 — all filled
  });
});

describe('realIO() — Phase 3 inline status helpers', () => {
  test('showError emits red SGR escape around field/message', () => {
    const io = realIO();
    io.showError!('Bot Token', 'expected digits:chars');
    io.close();
    const out = writes.join('');
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('Bot Token');
    expect(out).toContain('expected digits:chars');
  });

  test('showHelp uses dim SGR (gray-ish)', () => {
    const io = realIO();
    io.showHelp!('API key', 'press Enter to keep');
    io.close();
    const out = writes.join('');
    expect(out).toContain('\x1b[2m');
    expect(out).toContain('↳ API key');
  });

  test('showSuccess uses green SGR with check mark', () => {
    const io = realIO();
    io.showSuccess!('Connected as @bot');
    io.close();
    const out = writes.join('');
    expect(out).toContain('\x1b[32m');
    expect(out).toContain('✓ Connected as @bot');
  });
});
