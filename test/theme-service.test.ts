import { describe, expect, test } from 'bun:test';
import {
  createThemeService,
  defaultThemeConfigPath,
  isKnownThemeName,
  readThemeConfig,
  writeThemeConfig,
  writeThemeSnapshotToContextKeys,
} from '../src/theme/service.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  MONAD_PASTEL_DEFAULT,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';
import { createContextKeyService } from '../src/input-core/context-keys.js';

/** In-memory FS stub — tests use it to avoid touching $HOME. */
function makeFakeFs(initial: Record<string, string> = {}): {
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, d: string) => Promise<void>;
  removeFile: (p: string) => Promise<void>;
  files: Record<string, string>;
} {
  const files: Record<string, string> = { ...initial };
  return {
    files,
    readFile: async (p) => {
      if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return files[p]!;
    },
    writeFile: async (p, d) => {
      files[p] = d;
    },
    removeFile: async (p) => {
      delete files[p];
    },
  };
}

describe('IDX-6 Phase 3 ThemeService — basics', () => {
  test('defaults to DEFAULT_REGISTRY_THEME when neither initial nor persist', async () => {
    const svc = await createThemeService();
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
    expect(svc.snapshot).toEqual({
      name: CATPPUCCIN_MOCHA.name,
      isDark: true,
      isPastel: false,
    });
  });

  test('honors `initial` override', async () => {
    const svc = await createThemeService({ initial: CATPPUCCIN_LATTE });
    expect(svc.current.name).toBe(CATPPUCCIN_LATTE.name);
    expect(svc.snapshot.isPastel).toBe(true);
    expect(svc.snapshot.isDark).toBe(false);
  });

  test('list() proxies listThemes()', async () => {
    const svc = await createThemeService();
    const names = svc.list().map((t) => t.name);
    expect(names.length).toBe(6);
    expect(names).toContain('catppuccin-mocha');
    expect(names).toContain('rose-pine-dawn');
  });

  test('isKnownThemeName correctly identifies registered names', () => {
    expect(isKnownThemeName('catppuccin-mocha')).toBe(true);
    expect(isKnownThemeName('rose-pine-dawn')).toBe(true);
    expect(isKnownThemeName('does-not-exist')).toBe(false);
  });

  test('defaultThemeConfigPath points at ~/.monad/theme.json', () => {
    const path = defaultThemeConfigPath();
    expect(path).toContain('.monad');
    expect(path.endsWith('theme.json')).toBe(true);
  });
});

describe('IDX-6 Phase 3 ThemeService — switch lifecycle', () => {
  test('switch to a registered name updates current + fires subscribers', async () => {
    const svc = await createThemeService();
    const seen: string[] = [];
    svc.subscribe((t) => seen.push(t.name));
    // prime fires with current theme
    expect(seen).toEqual([CATPPUCCIN_MOCHA.name]);

    const ok = await svc.switch(ROSE_PINE_DAWN.name);
    expect(ok).toBe(true);
    expect(svc.current.name).toBe(ROSE_PINE_DAWN.name);
    expect(seen).toEqual([CATPPUCCIN_MOCHA.name, ROSE_PINE_DAWN.name]);
  });

  test('switch to unknown name returns false and does not fire', async () => {
    const svc = await createThemeService();
    let fires = 0;
    svc.subscribe(() => {
      fires++;
    });
    expect(fires).toBe(1); // prime

    const ok = await svc.switch('does-not-exist');
    expect(ok).toBe(false);
    expect(fires).toBe(1); // no additional fire
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
  });

  test('switch to current theme is an idempotent success, no re-fire', async () => {
    const svc = await createThemeService();
    let fires = 0;
    svc.subscribe(() => {
      fires++;
    });
    expect(fires).toBe(1);

    const ok = await svc.switch(svc.current.name);
    expect(ok).toBe(true);
    expect(fires).toBe(1); // equality no-op
  });

  test('multiple subscribers all receive the switch', async () => {
    const svc = await createThemeService();
    const a: string[] = [];
    const b: string[] = [];
    svc.subscribe((t) => a.push(t.name));
    svc.subscribe((t) => b.push(t.name));
    // both primed
    expect(a).toEqual([CATPPUCCIN_MOCHA.name]);
    expect(b).toEqual([CATPPUCCIN_MOCHA.name]);

    await svc.switch(MONAD_PASTEL_DEFAULT.name);
    expect(a).toEqual([CATPPUCCIN_MOCHA.name, MONAD_PASTEL_DEFAULT.name]);
    expect(b).toEqual([CATPPUCCIN_MOCHA.name, MONAD_PASTEL_DEFAULT.name]);
  });

  test('unsubscribe stops further notifications', async () => {
    const svc = await createThemeService();
    const seen: string[] = [];
    const dispose = svc.subscribe((t) => seen.push(t.name));
    dispose();
    await svc.switch(ROSE_PINE_DAWN.name);
    expect(seen).toEqual([CATPPUCCIN_MOCHA.name]); // only prime
  });

  test('throwing subscriber does not break others', async () => {
    const svc = await createThemeService();
    svc.subscribe(() => {
      throw new Error('boom');
    });
    const seen: string[] = [];
    svc.subscribe((t) => seen.push(t.name));
    await svc.switch(CATPPUCCIN_LATTE.name);
    expect(seen).toEqual([CATPPUCCIN_MOCHA.name, CATPPUCCIN_LATTE.name]);
  });

  test('dispose drops listeners', async () => {
    const svc = await createThemeService();
    const seen: string[] = [];
    svc.subscribe((t) => seen.push(t.name));
    svc.dispose();
    // post-dispose switch should not notify or mutate
    const ok = await svc.switch(ROSE_PINE_DAWN.name);
    expect(ok).toBe(false);
    expect(seen).toEqual([CATPPUCCIN_MOCHA.name]); // only prime
  });
});

describe('IDX-6 Phase 3 ThemeService — persist', () => {
  test('initial = persist file when present and valid', async () => {
    const fs = makeFakeFs({
      '/fake/theme.json': JSON.stringify({ version: 1, name: 'rose-pine-dawn' }),
    });
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      removeFile: fs.removeFile,
    });
    expect(svc.current.name).toBe('rose-pine-dawn');
  });

  test('initial falls back to default when persist file missing', async () => {
    const fs = makeFakeFs();
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
    });
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
  });

  test('initial falls back to default when persist file has unknown name', async () => {
    const fs = makeFakeFs({
      '/fake/theme.json': JSON.stringify({ version: 1, name: 'bogus' }),
    });
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
    });
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
  });

  test('initial falls back to default when persist file is malformed JSON', async () => {
    const fs = makeFakeFs({ '/fake/theme.json': '{ not json' });
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
    });
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
  });

  test('explicit initial overrides persist', async () => {
    const fs = makeFakeFs({
      '/fake/theme.json': JSON.stringify({ version: 1, name: 'nord-light' }),
    });
    const svc = await createThemeService({
      initial: CATPPUCCIN_LATTE,
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
    });
    expect(svc.current.name).toBe(CATPPUCCIN_LATTE.name);
  });

  test('switch writes the persist file', async () => {
    const fs = makeFakeFs();
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      removeFile: fs.removeFile,
    });
    await svc.switch(ROSE_PINE_DAWN.name);
    expect(fs.files['/fake/theme.json']).toBeDefined();
    const parsed = JSON.parse(fs.files['/fake/theme.json']!);
    expect(parsed).toEqual({ version: 1, name: ROSE_PINE_DAWN.name });
  });

  test('unknown-name switch does NOT write persist file', async () => {
    const fs = makeFakeFs();
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      removeFile: fs.removeFile,
    });
    await svc.switch('bogus');
    expect(fs.files['/fake/theme.json']).toBeUndefined();
  });

  test('reset removes the persist file when current differs from default', async () => {
    const fs = makeFakeFs({
      '/fake/theme.json': JSON.stringify({ version: 1, name: 'rose-pine-dawn' }),
    });
    const svc = await createThemeService({
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      removeFile: fs.removeFile,
    });
    expect(svc.current.name).toBe('rose-pine-dawn');
    await svc.reset();
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
    expect(fs.files['/fake/theme.json']).toBeUndefined();
  });

  test('reset with current = default still drops persist file', async () => {
    const fs = makeFakeFs({
      '/fake/theme.json': JSON.stringify({ version: 1, name: CATPPUCCIN_MOCHA.name }),
    });
    const svc = await createThemeService({
      initial: CATPPUCCIN_MOCHA,
      persistPath: '/fake/theme.json',
      readFile: fs.readFile,
      writeFile: fs.writeFile,
      removeFile: fs.removeFile,
    });
    await svc.reset();
    expect(fs.files['/fake/theme.json']).toBeUndefined();
  });

  test('readThemeConfig returns null when file missing', async () => {
    const fs = makeFakeFs();
    const out = await readThemeConfig('/missing.json', fs.readFile);
    expect(out).toBeNull();
  });

  test('writeThemeConfig serializes with pretty JSON', async () => {
    const fs = makeFakeFs();
    await writeThemeConfig(
      '/fake.json',
      { version: 1, name: 'nord-light' },
      fs.writeFile,
    );
    const raw = fs.files['/fake.json']!;
    expect(raw).toContain('"version": 1');
    expect(raw).toContain('"name": "nord-light"');
    expect(raw.endsWith('\n')).toBe(true); // trailing newline
  });
});

describe('IDX-6 Phase 3 ThemeService — context-keys bridge', () => {
  test('context keys are primed on construction', async () => {
    const ctx = createContextKeyService();
    await createThemeService({ contextKeys: ctx, initial: CATPPUCCIN_LATTE });
    expect(ctx.keys.themeName).toBe(CATPPUCCIN_LATTE.name);
    expect(ctx.keys.themeIsDark).toBe(false);
    expect(ctx.keys.themeIsPastel).toBe(true);
  });

  test('switch updates context keys atomically', async () => {
    const ctx = createContextKeyService();
    const svc = await createThemeService({ contextKeys: ctx });
    await svc.switch(ROSE_PINE_DAWN.name);
    expect(ctx.keys.themeName).toBe(ROSE_PINE_DAWN.name);
    expect(ctx.keys.themeIsPastel).toBe(true);
  });

  test('reset restores default context keys', async () => {
    const ctx = createContextKeyService();
    const svc = await createThemeService({
      contextKeys: ctx,
      initial: MONAD_PASTEL_DEFAULT,
    });
    expect(ctx.keys.themeName).toBe(MONAD_PASTEL_DEFAULT.name);
    await svc.reset();
    expect(ctx.keys.themeName).toBe(CATPPUCCIN_MOCHA.name);
    expect(ctx.keys.themeIsPastel).toBe(false);
  });

  test('writeThemeSnapshotToContextKeys can be used independently', () => {
    const ctx = createContextKeyService();
    writeThemeSnapshotToContextKeys(ctx, {
      name: 'catppuccin-latte',
      isDark: false,
      isPastel: true,
    });
    expect(ctx.keys.themeName).toBe('catppuccin-latte');
    expect(ctx.keys.themeIsPastel).toBe(true);
  });
});
