// IDX-6 Phase 3 — `/theme` slash command handlers.
//
// Registers a single `/theme` command with three subcommands:
//
//   /theme           — alias for `list`
//   /theme list      — print the registered presets (+ metadata)
//   /theme switch X  — activate preset X; persists on success
//   /theme reset     — restore the registry default + drop persist
//
// The module uses structural typing against a minimal host surface
// (register({id, title, …, handler})) so it doesn't couple to the
// concrete CommandRegistry class — tests wire a fake host, and the
// dashboard wires the real one. Output is delivered via an onOutput
// callback the caller supplies — again, no coupling to the chat
// transcript plumbing here.

import type { ThemeService } from './service.js';

/** Minimal shape the host command-registry must expose. Matches
 *  src/command-registry.ts register() signature but without the
 *  CommandRegistry class import so this module stays decoupled. */
export interface ThemeSlashHost {
  register(command: {
    id: string;
    title: string;
    description: string;
    aliases: string[];
    hidden: boolean;
    handler: (args: string[]) => Promise<void> | void;
  }): { dispose(): void };
}

export interface RegisterThemeSlashOptions {
  service: ThemeService;
  /** Line-by-line output sink — the host usually pipes this into
   *  the chat transcript or a status toast. */
  onOutput: (line: string) => void;
  /** Error sink. Defaults to `onOutput` with an `error:` prefix. */
  onError?: (message: string) => void;
}

export interface ThemeSlashDisposable {
  dispose(): void;
}

export function registerThemeSlashCommands(
  host: ThemeSlashHost,
  opts: RegisterThemeSlashOptions,
): ThemeSlashDisposable {
  const { service, onOutput } = opts;
  const onError = opts.onError ?? ((msg) => onOutput(`error: ${msg}`));

  const disposable = host.register({
    id: 'theme',
    title: 'Theme',
    description:
      'Manage the dashboard theme. Subcommands: list, switch <name>, reset.',
    aliases: [],
    hidden: false,
    handler: async (args) => {
      const sub = args[0]?.toLowerCase() ?? 'list';
      if (sub === 'list') {
        runList(service, onOutput);
        return;
      }
      if (sub === 'switch') {
        await runSwitch(service, args.slice(1), onOutput, onError);
        return;
      }
      if (sub === 'reset') {
        await runReset(service, onOutput);
        return;
      }
      onError(
        `unknown subcommand '${args[0]}' — use: /theme list | /theme switch <name> | /theme reset`,
      );
    },
  });

  return { dispose: () => disposable.dispose() };
}

function runList(service: ThemeService, out: (line: string) => void): void {
  const active = service.current.name;
  out(`Available themes (${service.list().length}):`);
  for (const t of service.list()) {
    const marker = t.name === active ? '*' : ' ';
    const tags: string[] = [];
    if (t.isDark) tags.push('dark');
    if (t.isPastel) tags.push('pastel');
    const tagSuffix = tags.length > 0 ? `  [${tags.join(', ')}]` : '';
    out(`  ${marker} ${t.name}${tagSuffix}`);
  }
  out('');
  out("Switch with '/theme switch <name>'.");
}

async function runSwitch(
  service: ThemeService,
  args: string[],
  out: (line: string) => void,
  err: (message: string) => void,
): Promise<void> {
  const name = args[0]?.trim();
  if (!name) {
    err("'/theme switch' requires a theme name. Try '/theme list' to see options.");
    return;
  }
  const ok = await service.switch(name);
  if (!ok) {
    err(`theme '${name}' is not registered. Try '/theme list'.`);
    return;
  }
  out(`Switched theme to '${name}'.`);
}

async function runReset(
  service: ThemeService,
  out: (line: string) => void,
): Promise<void> {
  await service.reset();
  out(`Theme reset to '${service.current.name}' (registry default).`);
}
