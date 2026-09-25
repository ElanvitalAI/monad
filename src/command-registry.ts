import type { PluginContext, SlashCommand } from './plugins/core/types.js';
import type { PluginManifest } from './plugins/core/manifest.js';

export interface CommandMetadata {
  id: string;
  title: string;
  description: string;
  aliases: string[];
  hidden: boolean;
  pluginId?: string;
}

export interface RegisteredCommand extends CommandMetadata {
  handler?: (args: string[]) => Promise<void> | void;
}

export interface CommandDisposable {
  dispose(): void;
}

export type SlashOutputClassification = 'visible-output' | 'hidden-only' | 'indeterminate';

export interface SlashOutputObservation {
  visibleOutput: boolean;
  hiddenOutput: boolean;
}

export interface SlashOutputCensusEntry extends SlashOutputObservation {
  name: string;
  classification: SlashOutputClassification;
}

export interface SlashOutputCensus {
  registeredTotal: number;
  visibleOutput: number;
  hiddenOnly: number;
  indeterminate: number;
  commands: SlashOutputCensusEntry[];
}

export interface DispatchableSlashRegistry<Ctx, R = unknown> {
  names(): readonly string[];
  dispatch(name: string, args: string[], context: Ctx): Promise<R>;
}

/**
 * Dispatches every registered slash command and classifies its response by
 * whether it reached the visible chat surface or only the hidden debug buffer.
 */
export async function censusRegisteredSlashOutputs<Ctx, R>(opts: {
  registry: DispatchableSlashRegistry<Ctx, R>;
  createContext(name: string): { context: Ctx; observe(): SlashOutputObservation };
}): Promise<SlashOutputCensus> {
  const commands: SlashOutputCensusEntry[] = [];

  for (const name of opts.registry.names()) {
    const probe = opts.createContext(name);
    let dispatchCompleted = false;
    try {
      await opts.registry.dispatch(name, [], probe.context);
      dispatchCompleted = true;
    } catch {
      // A command that cannot run under the probe context remains indeterminate.
    }
    const observation = probe.observe();
    const classification: SlashOutputClassification = !dispatchCompleted
      ? 'indeterminate'
      : observation.visibleOutput
        ? 'visible-output'
        : observation.hiddenOutput
          ? 'hidden-only'
          : 'indeterminate';
    commands.push({ name, ...observation, classification });
  }

  return {
    registeredTotal: commands.length,
    visibleOutput: commands.filter(command => command.classification === 'visible-output').length,
    hiddenOnly: commands.filter(command => command.classification === 'hidden-only').length,
    indeterminate: commands.filter(command => command.classification === 'indeterminate').length,
    commands,
  };
}

export class CommandRegistry {
  private commands = new Map<string, RegisteredCommand>();
  private aliases = new Map<string, string>();

  register(command: RegisteredCommand): CommandDisposable {
    const normalized = normalizeCommand(command);
    const previous = this.commands.get(normalized.id);
    this.unregister(normalized.id);
    this.commands.set(normalized.id, normalized);
    for (const alias of normalized.aliases) this.aliases.set(alias, normalized.id);
    return {
      dispose: () => {
        const current = this.commands.get(normalized.id);
        if (current !== normalized) return;
        this.unregister(normalized.id);
        if (previous) this.register(previous);
      },
    };
  }

  registerPluginCommands(opts: {
    pluginId: string;
    manifest: PluginManifest;
    slashCommands: SlashCommand[];
    context: () => PluginContext;
  }): CommandDisposable {
    const manifestByName = new Map((opts.manifest.contributes.commands ?? []).map(c => [c.name, c]));
    const disposables: CommandDisposable[] = [];
    const seen = new Set<string>();

    for (const slash of opts.slashCommands) {
      const manifest = manifestByName.get(slash.name);
      seen.add(slash.name);
      disposables.push(this.register({
        id: slash.name,
        title: manifest?.description || slash.description || slash.name,
        description: manifest?.description ?? slash.description ?? '',
        aliases: manifest?.aliases ?? slash.aliases ?? [],
        hidden: manifest?.hidden ?? slash.hidden ?? false,
        pluginId: opts.pluginId,
        handler: (args) => slash.handler(args, opts.context()),
      }));
    }

    for (const manifest of opts.manifest.contributes.commands ?? []) {
      if (seen.has(manifest.name)) continue;
      disposables.push(this.register({
        id: manifest.name,
        title: manifest.description || manifest.name,
        description: manifest.description,
        aliases: manifest.aliases ?? [],
        hidden: manifest.hidden ?? false,
        pluginId: opts.pluginId,
      }));
    }

    return {
      dispose: () => {
        for (const d of [...disposables].reverse()) d.dispose();
      },
    };
  }

  list(opts: { includeHidden?: boolean; pluginId?: string } = {}): RegisteredCommand[] {
    return [...this.commands.values()]
      .filter(c => opts.includeHidden || !c.hidden)
      .filter(c => !opts.pluginId || c.pluginId === opts.pluginId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  get(idOrAlias: string): RegisteredCommand | undefined {
    const id = this.aliases.get(idOrAlias) ?? idOrAlias;
    return this.commands.get(id);
  }

  has(idOrAlias: string): boolean {
    return this.get(idOrAlias) !== undefined;
  }

  async dispatch(idOrAlias: string, args: string[]): Promise<boolean> {
    const command = this.get(idOrAlias);
    if (!command?.handler) return false;
    await command.handler(args);
    return true;
  }

  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }

  unregister(id: string): void {
    const command = this.commands.get(id);
    if (!command) return;
    this.commands.delete(id);
    for (const alias of command.aliases) {
      if (this.aliases.get(alias) === id) this.aliases.delete(alias);
    }
  }
}

function normalizeCommand(command: RegisteredCommand): RegisteredCommand {
  const id = command.id.trim();
  if (!id) throw new Error('command id must be non-empty');
  const aliases = [...new Set((command.aliases ?? []).map(a => a.trim()).filter(Boolean))];
  return {
    ...command,
    id,
    title: command.title || command.description || id,
    description: command.description ?? '',
    aliases,
    hidden: command.hidden ?? false,
  };
}
