import { describe, expect, test } from 'bun:test';
import {
  renderScreen,
  composeFullPaint,
  computeBoxWidth,
  computeBoxLeftPad,
  stripSgr,
  ANSI_CLEAR_HOME,
  type ScreenSpec,
} from '../src/onboarding/screen-renderer.js';

const baseSpec = (overrides: Partial<ScreenSpec> = {}): ScreenSpec => ({
  stepIndex: 1,
  stepTotal: 6,
  title: 'LLM provider',
  body: { kind: 'options', options: [{ numeric: 1, label: 'A' }], selected: 0 },
  cols: 80,
  profile: 'mono',
  ...overrides,
});

describe('screen-renderer · width math', () => {
  test('computeBoxWidth clamps small terminals', () => {
    expect(computeBoxWidth(20)).toBe(40);
    expect(computeBoxWidth(60)).toBe(56);
    expect(computeBoxWidth(120)).toBe(80);
  });

  test('computeBoxWidth handles invalid input', () => {
    expect(computeBoxWidth(0)).toBe(60);
    expect(computeBoxWidth(NaN)).toBe(60);
  });

  test('computeBoxLeftPad centers the box', () => {
    expect(computeBoxLeftPad(80, 60)).toBe(10);
    expect(computeBoxLeftPad(80, 80)).toBe(0);
    expect(computeBoxLeftPad(40, 60)).toBe(0);
  });
});

describe('screen-renderer · header', () => {
  test('header contains step counter + title + dots', () => {
    const out = stripSgr(renderScreen(baseSpec({ title: 'LLM provider' })));
    expect(out).toContain('Step 1 / 6 — LLM provider');
    // ●○○○○○ for step 1 of 6
    expect(out).toContain('●○○○○○');
  });

  test('rounded border is the default', () => {
    const out = stripSgr(renderScreen(baseSpec()));
    expect(out).toContain('╭');
    expect(out).toContain('╮');
    expect(out).toContain('╰');
    expect(out).toContain('╯');
  });

  test('explicit border kind switches glyphs', () => {
    const out = stripSgr(renderScreen(baseSpec({ border: 'normal' })));
    expect(out).toContain('┌');
    expect(out).not.toContain('╭');
  });
});

describe('screen-renderer · body modes', () => {
  test('options body renders cursor on selected index', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'options',
            options: [
              { numeric: 1, label: 'first' },
              { numeric: 2, label: 'second' },
              { numeric: 3, label: 'third' },
            ],
            selected: 1,
          },
        }),
      ),
    );
    // Cursor (▶) should appear once, on the second option line
    const lines = out.split('\n');
    const cursorLines = lines.filter((l) => l.includes('▶'));
    expect(cursorLines).toHaveLength(1);
    expect(cursorLines[0]).toContain('second');
  });

  test('options body renders 1-based numeric labels', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'options',
            options: [
              { numeric: 1, label: 'a' },
              { numeric: 2, label: 'b' },
            ],
            selected: 0,
          },
        }),
      ),
    );
    expect(out).toContain('1) a');
    expect(out).toContain('2) b');
  });

  test('input body renders label + value + help', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'input',
            field: { label: 'Bot Token', value: 'abc123', help: 'from BotFather' },
          },
        }),
      ),
    );
    expect(out).toContain('Bot Token');
    expect(out).toContain('> abc123');
    expect(out).toContain('↳ from BotFather');
  });

  test('input body masks secret value', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'input',
            field: { label: 'API key', value: 'sk-12345', mask: true },
          },
        }),
      ),
    );
    expect(out).toContain('> ********');
    expect(out).not.toContain('sk-12345');
  });

  test('input body shows placeholder when value empty', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'input',
            field: { label: 'Path', value: '', placeholder: '/Users/me/vault' },
          },
        }),
      ),
    );
    expect(out).toContain('/Users/me/vault');
  });

  test('input body shows error in place of help', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'input',
            field: { label: 'Token', value: 'bad', error: 'invalid format', help: 'see docs' },
          },
        }),
      ),
    );
    expect(out).toContain('! invalid format');
    expect(out).not.toContain('see docs');
  });

  test('message body renders each line', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: { kind: 'message', lines: ['line one', 'line two'] },
        }),
      ),
    );
    expect(out).toContain('line one');
    expect(out).toContain('line two');
  });
});

// ── PR-Δ23b (Sprint 18 · 2026-04-30) — fuzzy filter UI surface ──

describe('screen-renderer · fuzzy filter (PR-Δ23b)', () => {
  test('options body without filter renders unchanged (legacy)', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'options',
            options: [
              { numeric: 1, label: 'A' },
              { numeric: 2, label: 'B' },
            ],
            selected: 0,
          },
        }),
      ),
    );
    // Legacy path — no filter line, no matches counter.
    expect(out).not.toContain('filter:');
    expect(out).not.toContain('matches');
  });

  test('options body with filter prop renders filter line + matches counter', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'options',
            options: [
              { numeric: 1, label: 'claude-haiku' },
              { numeric: 2, label: 'claude-sonnet' },
            ],
            selected: 0,
            help: 'pick a model carefully',
            filter: 'claude',
            fullCount: 50,
          },
        }),
      ),
    );
    expect(out).toContain('filter: claude');
    expect(out).toContain('2 / 50 matches');
    // Help line is replaced by the matches counter when filter is active.
    expect(out).not.toContain('pick a model carefully');
  });

  test('empty filter buffer shows placeholder hint', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'options',
            options: [{ numeric: 1, label: 'A' }],
            selected: 0,
            filter: '',
            fullCount: 1,
          },
        }),
      ),
    );
    expect(out).toContain('filter: (type to filter)');
    expect(out).toContain('1 / 1 matches');
  });

  test('empty filtered list shows no-matches placeholder', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          body: {
            kind: 'options',
            options: [],
            selected: 0,
            filter: 'xyz',
            fullCount: 50,
          },
        }),
      ),
    );
    expect(out).toContain('! no matches');
    expect(out).toContain('Backspace edits');
    expect(out).toContain('ESC clears');
    expect(out).toContain('0 / 50 matches');
  });

  test('mono profile keeps filter UI readable (no color, attrs preserved)', () => {
    const out = renderScreen(
      baseSpec({
        profile: 'mono',
        body: {
          kind: 'options',
          options: [{ numeric: 1, label: 'item' }],
          selected: 0,
          filter: 'foo',
          fullCount: 12,
        },
      }),
    );
    // Stripped version still contains the filter UI.
    const plain = stripSgr(out);
    expect(plain).toContain('filter: foo');
    expect(plain).toContain('1 / 12 matches');
    // No color SGR (mono profile).
    expect(out).not.toMatch(/\x1b\[38;[25];/);
  });
});

describe('screen-renderer · excerpt + footer', () => {
  test('excerpt renders above body', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          excerpt: 'Pick the provider that handles chat.',
        }),
      ),
    );
    expect(out).toContain('Pick the provider that handles chat.');
  });

  test('multi-line excerpt is preserved', () => {
    const out = stripSgr(
      renderScreen(baseSpec({ excerpt: 'first\nsecond\nthird' })),
    );
    expect(out).toContain('first');
    expect(out).toContain('second');
    expect(out).toContain('third');
  });

  test('footer hint renders before bottom border', () => {
    const out = stripSgr(renderScreen(baseSpec({ footer: '↑/↓ pick · Enter ↵' })));
    expect(out).toContain('↑/↓ pick · Enter ↵');
  });
});

describe('screen-renderer · severity glyphs', () => {
  test('required severity prefixes the header with ★', () => {
    const out = stripSgr(renderScreen(baseSpec({ severity: 'required' })));
    expect(out).toContain('★ Step 1 / 6');
  });

  test('optional severity prefixes the header with ▽', () => {
    const out = stripSgr(renderScreen(baseSpec({ severity: 'optional' })));
    expect(out).toContain('▽ Step 1 / 6');
  });

  test('advanced severity prefixes the header with ▲', () => {
    const out = stripSgr(renderScreen(baseSpec({ severity: 'advanced' })));
    expect(out).toContain('▲ Step 1 / 6');
  });

  test('no severity → no glyph prefix', () => {
    const out = stripSgr(renderScreen(baseSpec({})));
    expect(out).not.toContain('★ Step 1');
    expect(out).not.toContain('▽ Step 1');
    expect(out).not.toContain('▲ Step 1');
  });
});

describe('screen-renderer · skip behavior', () => {
  test('skipBehavior renders below excerpt with ↳ prefix', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          excerpt: 'Some context.',
          skipBehavior: 'Skip → mobile chat unavailable.',
        }),
      ),
    );
    expect(out).toContain('Some context.');
    expect(out).toContain('↳ Skip → mobile chat unavailable.');
  });

  test('skipBehavior alone (no excerpt) still renders', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({ skipBehavior: 'Skip → X disabled.' }),
      ),
    );
    expect(out).toContain('↳ Skip → X disabled.');
  });
});

describe('screen-renderer · profile fallback', () => {
  // PR-Δ17 (F13 · 2026-04-28) — mono profile keeps attribute SGRs
  // (bold / faint / italic) but strips color SGRs. This preserves
  // visual hierarchy on bare TTYs / NO_COLOR / CI logs where colors
  // are unsafe but emphasis still reads.
  test('mono profile emits attribute SGRs but no color SGRs', () => {
    const out = renderScreen(
      baseSpec({
        profile: 'mono',
        severity: 'required', // ★ accent + bold
        skipBehavior: 'Mono skip behavior — italic + faint.',
      }),
    );
    // Attribute SGRs present (bold = \x1b[1m, faint = \x1b[2m, italic = \x1b[3m).
    expect(out).toMatch(/\x1b\[1m/); // bold from accent header
    expect(out).toMatch(/\x1b\[2m/); // faint from muted/dim
    expect(out).toMatch(/\x1b\[3m/); // italic from skipPaint
    // No color SGRs (38;2;... truecolor or 38;5;... 256-color).
    expect(out).not.toMatch(/\x1b\[38;[25];/);
    // No 16-color foreground (3X / 9X codes) either.
    expect(out).not.toMatch(/\x1b\[3[0-7]m/);
  });

  test('truecolor profile emits color + attribute SGRs', () => {
    const out = renderScreen(baseSpec({ profile: 'truecolor' }));
    expect(out).toMatch(/\x1b\[/);
    // Stripped version still contains the visible glyphs
    expect(stripSgr(out)).toContain('Step 1 / 6');
    // Color SGR present.
    expect(out).toMatch(/\x1b\[38;2;/);
  });

  test('mono profile preserves all visible glyphs (no content loss)', () => {
    const plain = stripSgr(
      renderScreen(
        baseSpec({
          profile: 'mono',
          severity: 'required',
          excerpt: 'Pick a provider.',
          skipBehavior: 'Skip → required step cannot be skipped.',
        }),
      ),
    );
    expect(plain).toContain('★ Step 1 / 6');
    expect(plain).toContain('Pick a provider.');
    expect(plain).toContain('↳ Skip');
  });
});

describe('screen-renderer · composeFullPaint', () => {
  test('prepends ANSI clear-home', () => {
    const out = composeFullPaint(baseSpec());
    expect(out.startsWith(ANSI_CLEAR_HOME)).toBe(true);
  });
});

describe('screen-renderer · stripSgr', () => {
  test('strips simple SGR run', () => {
    expect(stripSgr('\x1b[31mhello\x1b[0m')).toBe('hello');
  });

  test('strips multiple SGR runs', () => {
    expect(stripSgr('\x1b[1m\x1b[34mbold blue\x1b[0m\x1b[0m')).toBe('bold blue');
  });

  test('preserves non-SGR text', () => {
    expect(stripSgr('plain text')).toBe('plain text');
  });
});

// ── Sprint 12 — excerpt wrap (yesno body kind 폐기됨 · PR-Δ18) ──────

// PR-Δ18 (Sprint 15 · 2026-04-28) — Sprint 12 의 yesno body kind 폐기.
// 사용자 피드백 ("YES/NO 위젯 제거") 으로 모든 askYesNo 가 vertical
// numbered list (chooseFrom 일반 path) 로 회귀. 5개 yesno 테스트도 폐기.

describe('screen-renderer · excerpt multi-line wrap (Sprint 12)', () => {
  test('long word inside narrow box is not clipped', () => {
    // PR #993 Sprint 11 fixed the box-edge wrap for the header. Sprint
    // 12's complaint: the Step 6 control-plane excerpt mentioned
    // `lifecycle` and was clipped to `lifecycl` because the box-line
    // truncate fallback chops anything longer than the inner width.
    // The wrap helper must split the line on a word boundary instead.
    const out = stripSgr(
      renderScreen(
        baseSpec({
          cols: 50, // narrow viewport → smaller box
          excerpt:
            'elanous-control is an always-on meta store separate from the daemon lifecycle.',
        }),
      ),
    );
    // The full word 'lifecycle' must survive intact — anywhere in the
    // wrapped excerpt.
    expect(out).toContain('lifecycle');
    // And not appear in its clipped `lifecycl` form (rough check —
    // matches `lifecycl` only when followed by something other than `e`).
    expect(out).not.toMatch(/lifecycl[^e]/);
  });

  test('excerpt with multi-paragraph + skip behavior wraps each independently', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          cols: 60,
          excerpt: 'first paragraph that is longer than the inner box width to force wrap.',
          skipBehavior: 'Skip means the daemon keeps single-process mode without supervisor.',
        }),
      ),
    );
    // The skipBehavior line still gets the ↳ prefix even when wrapped.
    expect(out).toContain('↳ Skip');
    // Long words ('without' etc) survive — wrap respected word boundaries.
    expect(out).toContain('without');
  });
});

// ── PR-Δ18 (Sprint 15 · 2026-04-28) — input prompt multi-line wrap ────

describe('screen-renderer · input body label wrap (PR-Δ18)', () => {
  test('long input prompt wraps across multiple lines (no clip)', () => {
    // Telegram step의 prompt 같은 긴 라벨이 박스 우측에서 잘리지 않고
    // 단어 경계로 wrap. 사용자 피드백 #2: "(optional, bla" 짤림 fix.
    const longLabel =
      'Home channel / chat ID for cron deliveries (optional, blank = same as owner DM)';
    const out = stripSgr(
      renderScreen(
        baseSpec({
          cols: 60,
          body: { kind: 'input', field: { label: longLabel, value: '' } },
        }),
      ),
    );
    // 핵심 단어들이 모두 표시 — clip 없음
    expect(out).toContain('Home channel');
    expect(out).toContain('cron deliveries');
    expect(out).toContain('(optional');
    expect(out).toContain('owner DM)');
  });

  test('input help text also wraps when long', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          cols: 60,
          body: {
            kind: 'input',
            field: {
              label: 'Token',
              value: '',
              help: 'must be at least 16 characters with no whitespace and starting with sk-',
            },
          },
        }),
      ),
    );
    expect(out).toContain('↳ must be at least 16');
    // word 'whitespace' survives wrap (word-boundary preferred)
    expect(out).toContain('whitespace');
  });

  test('input error text also wraps when long', () => {
    const out = stripSgr(
      renderScreen(
        baseSpec({
          cols: 60,
          body: {
            kind: 'input',
            field: {
              label: 'API key',
              value: 'bad',
              error: 'Token does not match the digits:chars pattern from BotFather (try again)',
            },
          },
        }),
      ),
    );
    expect(out).toContain('! Token does not');
    expect(out).toContain('BotFather');
  });
});
