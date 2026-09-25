import { describe, expect, test } from 'bun:test';
import {
  createThemeService,
  type ThemeService,
} from '../src/theme/service.js';
import {
  registerThemeSlashCommands,
  type ThemeSlashHost,
} from '../src/theme/slash-commands.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';

/** Fake host — records registered commands so tests can invoke them
 *  directly. Mirrors CommandRegistry.register's contract without the
 *  real class. */
function makeFakeHost(): {
  host: ThemeSlashHost;
  handlers: Map<string, (args: string[]) => Promise<void> | void>;
  disposed: Set<string>;
} {
  const handlers = new Map<string, (args: string[]) => Promise<void> | void>();
  const disposed = new Set<string>();
  return {
    host: {
      register(cmd) {
        handlers.set(cmd.id, cmd.handler);
        return {
          dispose: () => {
            handlers.delete(cmd.id);
            disposed.add(cmd.id);
          },
        };
      },
    },
    handlers,
    disposed,
  };
}

async function setup(): Promise<{
  svc: ThemeService;
  host: ReturnType<typeof makeFakeHost>;
  out: string[];
  err: string[];
  run: (args: string[]) => Promise<void>;
}> {
  const svc = await createThemeService();
  const host = makeFakeHost();
  const out: string[] = [];
  const err: string[] = [];
  registerThemeSlashCommands(host.host, {
    service: svc,
    onOutput: (line) => out.push(line),
    onError: (msg) => err.push(msg),
  });
  const handler = host.handlers.get('theme')!;
  return {
    svc,
    host,
    out,
    err,
    run: async (args) => {
      await handler(args);
    },
  };
}

describe('IDX-6 Phase 3 /theme slash — registration', () => {
  test('registers a single /theme command', async () => {
    const svc = await createThemeService();
    const host = makeFakeHost();
    registerThemeSlashCommands(host.host, {
      service: svc,
      onOutput: () => {},
    });
    expect(host.handlers.has('theme')).toBe(true);
  });

  test('dispose unregisters the handler', async () => {
    const svc = await createThemeService();
    const host = makeFakeHost();
    const d = registerThemeSlashCommands(host.host, {
      service: svc,
      onOutput: () => {},
    });
    d.dispose();
    expect(host.handlers.has('theme')).toBe(false);
    expect(host.disposed.has('theme')).toBe(true);
  });
});

describe('IDX-6 Phase 3 /theme list', () => {
  test('no-args defaults to list', async () => {
    const { run, out } = await setup();
    await run([]);
    const header = out.find((l) => l.includes('Available themes'));
    expect(header).toBeDefined();
    // All 6 presets show up.
    const joined = out.join('\n');
    for (const name of [
      'catppuccin-mocha',
      'mocha-pastel-accent',
      'catppuccin-latte',
      'rose-pine-dawn',
      'nord-light',
      'monad-pastel-default',
    ]) {
      expect(joined).toContain(name);
    }
  });

  test('explicit "list" produces the same output as no args', async () => {
    const { run, out } = await setup();
    await run(['list']);
    const joined = out.join('\n');
    expect(joined).toContain('catppuccin-mocha');
  });

  test('active theme is marked with *', async () => {
    const { run, out, svc } = await setup();
    await svc.switch(ROSE_PINE_DAWN.name);
    await run(['list']);
    const marker = out.find((l) => l.includes(`* ${ROSE_PINE_DAWN.name}`));
    expect(marker).toBeDefined();
  });

  test('tag suffixes describe dark/pastel metadata', async () => {
    const { run, out } = await setup();
    await run(['list']);
    const joined = out.join('\n');
    expect(joined).toContain('[dark]'); // mocha
    expect(joined).toContain('[pastel]'); // latte
    expect(joined).toContain('[dark, pastel]'); // mocha-pastel-accent
  });
});

describe('IDX-6 Phase 3 /theme switch', () => {
  test('switch to a valid name updates the service', async () => {
    const { run, svc, out } = await setup();
    await run(['switch', CATPPUCCIN_LATTE.name]);
    expect(svc.current.name).toBe(CATPPUCCIN_LATTE.name);
    expect(out.some((l) => l.includes(`Switched theme to '${CATPPUCCIN_LATTE.name}'`))).toBe(
      true,
    );
  });

  test('switch to an unknown name reports an error without changing state', async () => {
    const { run, svc, err } = await setup();
    await run(['switch', 'does-not-exist']);
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
    expect(err.some((m) => m.includes('is not registered'))).toBe(true);
  });

  test('switch without a name reports a usage error', async () => {
    const { run, err } = await setup();
    await run(['switch']);
    expect(err.some((m) => m.includes("requires a theme name"))).toBe(true);
  });
});

describe('IDX-6 Phase 3 /theme reset', () => {
  test('reset returns to the registry default', async () => {
    const { run, svc, out } = await setup();
    await run(['switch', ROSE_PINE_DAWN.name]);
    expect(svc.current.name).toBe(ROSE_PINE_DAWN.name);
    await run(['reset']);
    expect(svc.current.name).toBe(CATPPUCCIN_MOCHA.name);
    expect(out.some((l) => l.includes('Theme reset'))).toBe(true);
  });
});

describe('IDX-6 Phase 3 /theme — error handling', () => {
  test('unknown subcommand reports a usage error', async () => {
    const { run, err } = await setup();
    await run(['salsa']);
    expect(err.some((m) => m.includes("unknown subcommand 'salsa'"))).toBe(true);
  });

  test('onError defaults to onOutput with error prefix when not provided', async () => {
    const svc = await createThemeService();
    const host = makeFakeHost();
    const out: string[] = [];
    registerThemeSlashCommands(host.host, {
      service: svc,
      onOutput: (l) => out.push(l),
    });
    await host.handlers.get('theme')!(['switch', 'bogus']);
    expect(out.some((l) => l.startsWith('error: '))).toBe(true);
  });
});
