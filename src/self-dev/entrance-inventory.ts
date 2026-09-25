interface CommandEntranceOption {
  flags: string;
  description: string;
}

interface CommandEntrance {
  path: readonly string[];
  name: string;
  description: string;
  aliases: readonly string[];
  options: readonly CommandEntranceOption[];
}

interface CommandTree {
  name(): string;
  description(): string;
  aliases?(): string[];
  commands?: readonly CommandTree[];
  options?: readonly { flags: string; description: string }[];
}

/**
 * Collects currently registered CLI commands from a Commander tree.
 *
 * Each command appears once at its primary-name path; aliases are metadata rather
 * than separate entrances. Hidden commands remain included because registration,
 * not help visibility, is the source of truth. Options are scoped to the command
 * that declares them. Repeated command objects are visited once, and paths sort
 * lexicographically for deterministic output.
 */
export function collectCommandEntrances(root: CommandTree): CommandEntrance[] {
  const entrances: CommandEntrance[] = [];
  const visited = new Set<CommandTree>();

  const visit = (command: CommandTree, parentPath: readonly string[]): void => {
    if (visited.has(command)) return;
    visited.add(command);

    for (const child of command.commands ?? []) {
      const path = [...parentPath, child.name()];
      entrances.push({
        path,
        name: child.name(),
        description: child.description(),
        aliases: child.aliases?.() ?? [],
        options: (child.options ?? []).map(({ flags, description }) => ({ flags, description })),
      });
      visit(child, path);
    }
  };

  visit(root, []);
  return entrances.sort((left, right) => left.path.join(' ').localeCompare(right.path.join(' ')));
}

export function renderCommandEntrances(entrances: readonly CommandEntrance[], rootCommandCount: number): string {
  const lines = [
    `root commands: ${rootCommandCount}`,
    `registered entrances: ${entrances.length}`,
  ];
  for (const entrance of entrances) {
    const aliases = entrance.aliases.length === 0 ? '' : ` [aliases: ${entrance.aliases.join(', ')}]`;
    const options = entrance.options.length === 0
      ? ''
      : ` [options: ${entrance.options.map((option) => option.flags).join(', ')}]`;
    lines.push(`${entrance.path.join(' ')}${aliases}${options}${entrance.description ? ` — ${entrance.description}` : ''}`);
  }
  return lines.join('\n');
}
