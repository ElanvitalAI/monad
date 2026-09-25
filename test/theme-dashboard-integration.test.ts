import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  __resetDashboardThemeServiceForTests,
  createButtonStatePainter,
  createModalBorderPainter,
  createPaneTitlePainter,
  createPillPainter,
  getDashboardThemeService,
  subscribeThemeReRender,
} from '../src/theme/dashboard-integration.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  MONAD_PASTEL_DEFAULT,
  NORD_LIGHT,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';
import { createThemeService } from '../src/theme/service.js';
import { createContextKeyService } from '../src/input-core/context-keys.js';
import { resolveWidgetTokens } from '../src/theme/tokens.js';

const ORIG_CHALK_LEVEL = chalk.level;

function hexTriple(hex: string): string {
  const body = hex.replace('#', '');
  return `${parseInt(body.slice(0, 2), 16)};${parseInt(
    body.slice(2, 4),
    16,
  )};${parseInt(body.slice(4, 6), 16)}`;
}

function makeFakeFs(initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    readFile: async (p: string) => {
      if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[p]!;
    },
    writeFile: async (p: string, d: string) => {
      files[p] = d;
    },
    removeFile: async (p: string) => {
      delete files[p];
    },
  };
}

describe('IDX-6 Phase 4/5 dashboard singleton', () => {
  afterEach(() => {
    __resetDashboardThemeServiceForTests();
  });

  test('first call constructs a ThemeService', async () => {
    const svc = await getDashboardThemeService({ persistPath: '/tmp/bogus-never-read' });
    expect(svc).toBeDefined();
    expect(svc.current).toBeDefined();
  });

  test('subsequent calls return the same instance', async () => {
    const a = await getDashboardThemeService({ persistPath: '/tmp/a' });
    const b = await getDashboardThemeService({ persistPath: '/tmp/b' });
    expect(a).toBe(b);
  });

  test('reset clears the singleton so a new call constructs afresh', async () => {
    const a = await getDashboardThemeService({ persistPath: '/tmp/a' });
    __resetDashboardThemeServiceForTests();
    const b = await getDashboardThemeService({ persistPath: '/tmp/a' });
    expect(a).not.toBe(b);
  });
});

describe('IDX-6 Phase 4/5 createPillPainter', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('idle state uses statusBar.pill color', () => {
    const paint = createPillPainter(ROSE_PINE_DAWN);
    const out = paint('status');
    const tokens = resolveWidgetTokens(ROSE_PINE_DAWN, 'statusBar');
    expect(out).toContain(hexTriple(tokens.pill.fg));
    expect(out).toContain('status');
  });

  test('active state uses statusBar.pillActive color', () => {
    const paint = createPillPainter(CATPPUCCIN_MOCHA);
    const out = paint('model', 'active');
    const tokens = resolveWidgetTokens(CATPPUCCIN_MOCHA, 'statusBar');
    expect(out).toContain(hexTriple(tokens.pillActive.fg));
  });

  test('hovered state falls back to pill when theme lacks pillHovered', () => {
    // Mutate a shallow clone to drop pillHovered.
    const theme = {
      ...MONAD_PASTEL_DEFAULT,
      widgetTokens: {
        ...MONAD_PASTEL_DEFAULT.widgetTokens!,
        statusBar: {
          ...MONAD_PASTEL_DEFAULT.widgetTokens!.statusBar,
          pillHovered: undefined,
        },
      },
    };
    const paint = createPillPainter(theme);
    const out = paint('hover', 'hovered');
    expect(out).toContain(
      hexTriple(MONAD_PASTEL_DEFAULT.widgetTokens!.statusBar.pill.fg),
    );
  });

  test('default state when argument omitted = idle', () => {
    const paint = createPillPainter(NORD_LIGHT);
    const out = paint('x');
    const tokens = resolveWidgetTokens(NORD_LIGHT, 'statusBar');
    expect(out).toContain(hexTriple(tokens.pill.fg));
  });
});

describe('IDX-6 Phase 4/5 createPaneTitlePainter', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('active pane title uses paneTitle.active fg + bold', () => {
    const paint = createPaneTitlePainter(CATPPUCCIN_LATTE);
    const out = paint('Sidebar', 'active');
    const tokens = resolveWidgetTokens(CATPPUCCIN_LATTE, 'paneTitle');
    expect(out).toContain(hexTriple(tokens.active.fg));
    expect(out).toContain('\x1b[1m');
  });

  test('inactive pane title uses paneTitle.inactive fg', () => {
    const paint = createPaneTitlePainter(CATPPUCCIN_MOCHA);
    const out = paint('Background', 'inactive');
    const tokens = resolveWidgetTokens(CATPPUCCIN_MOCHA, 'paneTitle');
    expect(out).toContain(hexTriple(tokens.inactive.fg));
  });

  test('hovered pane title uses paneTitle.hovered when present', () => {
    const paint = createPaneTitlePainter(ROSE_PINE_DAWN);
    const out = paint('Hover me', 'hovered');
    const tokens = resolveWidgetTokens(ROSE_PINE_DAWN, 'paneTitle');
    const hoverFg = tokens.hovered?.fg ?? tokens.active.fg;
    expect(out).toContain(hexTriple(hoverFg));
  });

  test('default state (no arg) is inactive', () => {
    const paint = createPaneTitlePainter(NORD_LIGHT);
    const out = paint('Plain');
    const tokens = resolveWidgetTokens(NORD_LIGHT, 'paneTitle');
    expect(out).toContain(hexTriple(tokens.inactive.fg));
  });
});

describe('IDX-6 Phase 4/5 createModalBorderPainter + createButtonStatePainter', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('modal border painter uses modal.border color', () => {
    const paint = createModalBorderPainter(MONAD_PASTEL_DEFAULT);
    const out = paint('┌───┐');
    const tokens = resolveWidgetTokens(MONAD_PASTEL_DEFAULT, 'modal');
    expect(out).toContain(hexTriple(tokens.border.fg));
  });

  test('button-state painter resolves requested state', () => {
    const paint = createButtonStatePainter(CATPPUCCIN_MOCHA, 'pressed');
    const out = paint('Pressed');
    const tokens = resolveWidgetTokens(CATPPUCCIN_MOCHA, 'button');
    const pressedFg = tokens.pressed?.fg ?? tokens.normal.fg;
    expect(out).toContain(hexTriple(pressedFg));
  });

  test('button-state painter falls back to normal for absent state', () => {
    const bare = {
      ...CATPPUCCIN_MOCHA,
      widgetTokens: {
        ...CATPPUCCIN_MOCHA.widgetTokens!,
        button: {
          normal: CATPPUCCIN_MOCHA.widgetTokens!.button.normal,
          // focused/hovered/etc absent
        },
      },
    };
    const paint = createButtonStatePainter(bare, 'focused');
    const out = paint('x');
    // Falls back to normal.fg
    expect(out).toContain(hexTriple(bare.widgetTokens!.button.normal.fg));
  });
});

describe('IDX-6 Phase 4/5 subscribeThemeReRender + singleton + persist', () => {
  afterEach(() => {
    __resetDashboardThemeServiceForTests();
  });

  test('subscribeThemeReRender fires on each switch (not on no-op)', async () => {
    const svc = await createThemeService();
    const seen: string[] = [];
    subscribeThemeReRender(svc, (t) => seen.push(t.name));
    // primed once
    expect(seen.length).toBe(1);

    await svc.switch(ROSE_PINE_DAWN.name);
    await svc.switch(ROSE_PINE_DAWN.name); // no-op
    await svc.switch(NORD_LIGHT.name);
    expect(seen).toEqual([
      CATPPUCCIN_MOCHA.name,
      ROSE_PINE_DAWN.name,
      NORD_LIGHT.name,
    ]);
  });

  test('singleton picks up persist file', async () => {
    const fs = makeFakeFs({
      '/fake/theme.json': JSON.stringify({ version: 1, name: 'nord-light' }),
    });
    // Manually wire because getDashboardThemeService uses its own
    // defaults; use createThemeService directly for this check.
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      removeFile: fs.removeFile,
    });
    expect(svc.current.name).toBe('nord-light');
  });

  test('subscription + context keys stays consistent across switch', async () => {
    const ctx = createContextKeyService();
    const svc = await createThemeService({ contextKeys: ctx });
    const painterRefs: string[] = [];
    subscribeThemeReRender(svc, (t) => {
      painterRefs.push(t.name);
      // Verify context keys match the theme being rendered.
      expect(ctx.keys.themeName).toBe(t.name);
    });
    await svc.switch(ROSE_PINE_DAWN.name);
    expect(painterRefs).toContain(ROSE_PINE_DAWN.name);
  });
});

describe('IDX-6 Phase 4/5 — end-to-end: theme switch re-renders painters', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('rebuilding painters after a switch produces different output', async () => {
    const svc = await createThemeService();
    let paint = createPillPainter(svc.current);
    const out1 = paint('status', 'active');
    subscribeThemeReRender(svc, (theme) => {
      paint = createPillPainter(theme);
    });
    await svc.switch(ROSE_PINE_DAWN.name);
    const out2 = paint('status', 'active');

    expect(out1).toContain('status');
    expect(out2).toContain('status');
    expect(out1).not.toBe(out2);
  });
});
