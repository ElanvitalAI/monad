import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

type ArtifactLaunchCommandSourceKind = 'package-json' | 'makefile' | 'procfile' | 'monad-cli';
type ArtifactLaunchCommandSourceStatus = 'scanned' | 'read-error' | 'parse-error';
type ArtifactLaunchCommandReason = 'missing-entrypoint' | 'invalid-target-path' | 'invalid-repository-root' | 'no-command-source' | 'ambiguous-command-source';

interface ArtifactLaunchCommandSource {
  readonly path: string;
  readonly kind: ArtifactLaunchCommandSourceKind;
  readonly status: ArtifactLaunchCommandSourceStatus;
}

interface ArtifactLaunchCommandCandidate {
  readonly sourcePath: string;
  readonly sourceKind: ArtifactLaunchCommandSourceKind;
  readonly key: string;
  readonly command: string;
  readonly location: string;
}

interface ArtifactLaunchCommandResult {
  readonly sources: readonly ArtifactLaunchCommandSource[];
  readonly candidates: readonly ArtifactLaunchCommandCandidate[];
  readonly command?: string;
  readonly reason?: ArtifactLaunchCommandReason;
}

interface ArtifactLaunchCommandInput {
  readonly entrypoint?: string;
  readonly targetPath: string;
  readonly repositoryRoot: string;
  readonly runHelpProbe?: (argv: readonly string[]) => ArtifactLaunchCommandProbeResult | Promise<ArtifactLaunchCommandProbeResult>;
}

interface ArtifactLaunchCommandProbeResult {
  readonly status: number | null;
  readonly stderr: string;
}

interface CommandDefinition {
  readonly key: string;
  readonly command: string;
}

function source(path: string, kind: ArtifactLaunchCommandSourceKind, status: ArtifactLaunchCommandSourceStatus): ArtifactLaunchCommandSource {
  return { path, kind, status };
}

function candidate(sourcePath: string, sourceKind: ArtifactLaunchCommandSourceKind, definition: CommandDefinition): ArtifactLaunchCommandCandidate {
  return {
    sourcePath,
    sourceKind,
    key: definition.key,
    command: definition.command,
    location: `${sourcePath}:${definition.key}`,
  };
}

function readSource(path: string, kind: ArtifactLaunchCommandSourceKind): { readonly source: ArtifactLaunchCommandSource; readonly text?: string } | null {
  if (!existsSync(path)) return null;
  try {
    return { source: source(path, kind, 'scanned'), text: readFileSync(path, 'utf8') };
  } catch {
    return { source: source(path, kind, 'read-error') };
  }
}

function packageDefinitions(text: string): CommandDefinition[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return [];
    return Object.entries(scripts)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, command]) => ({ key, command }));
  } catch {
    return null;
  }
}

function makefileDefinitions(text: string): CommandDefinition[] {
  const definitions: CommandDefinition[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s|^#/.test(line)) continue;
    const match = /^([^:=#\s][^:=#]*?):(?:[^=].*)?$/.exec(line);
    if (!match) continue;
    for (const key of match[1].trim().split(/\s+/)) {
      definitions.push({ key, command: `make ${key}` });
    }
  }
  return definitions;
}

function procfileDefinitions(text: string): CommandDefinition[] {
  const definitions: CommandDefinition[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^:\s]+)\s*:\s*(\S.*)\s*$/.exec(line);
    if (match) definitions.push({ key: match[1], command: match[2] });
  }
  return definitions;
}

function matchesEntrypoint(definition: CommandDefinition, entrypoint: string): boolean {
  return definition.key === entrypoint || definition.command.split(/\s+/).includes(entrypoint);
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function canonicalExistingPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function ancestorDirectories(targetPath: string, repositoryRoot: string): string[] | null {
  const root = canonicalExistingPath(repositoryRoot);
  const target = canonicalExistingPath(targetPath);
  if (!root || !isDirectory(root) || !target) return null;
  let current = isDirectory(target) ? target : dirname(target);
  const directories: string[] = [];
  for (;;) {
    directories.push(current);
    if (current === root) return directories;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function addDefinitions(
  definitions: readonly CommandDefinition[],
  entrypoint: string,
  sourcePath: string,
  sourceKind: ArtifactLaunchCommandSourceKind,
  candidates: ArtifactLaunchCommandCandidate[],
): void {
  for (const definition of definitions) {
    if (matchesEntrypoint(definition, entrypoint)) candidates.push(candidate(sourcePath, sourceKind, definition));
  }
}

function isMonadRepository(repositoryRoot: string): boolean {
  const packagePath = join(repositoryRoot, 'package.json');
  const launcherPath = join(repositoryRoot, 'bin', 'monad.mjs');
  if (!existsSync(launcherPath)) return false;
  const packageSource = readSource(packagePath, 'package-json');
  if (!packageSource?.text) return false;
  try {
    const parsed: unknown = JSON.parse(packageSource.text);
    const bin = parsed && typeof parsed === 'object' ? (parsed as { bin?: unknown }).bin : undefined;
    return !!bin && typeof bin === 'object' && !Array.isArray(bin) && (bin as Record<string, unknown>).monad === './bin/monad.mjs';
  } catch {
    return false;
  }
}

/**
 * Resolves an artifact launch name only from exact, repository-bounded source matches.
 * It never executes a chosen command; a clean help probe merely proves a monad subcommand exists.
 */
export async function resolveArtifactLaunchCommand(input: ArtifactLaunchCommandInput): Promise<ArtifactLaunchCommandResult> {
  const entrypoint = input.entrypoint;
  if (entrypoint === undefined || entrypoint === '') return { sources: [], candidates: [], reason: 'missing-entrypoint' };

  const directories = ancestorDirectories(input.targetPath, input.repositoryRoot);
  if (!directories) {
    const root = canonicalExistingPath(input.repositoryRoot);
    return {
      sources: [],
      candidates: [],
      reason: root && isDirectory(root) ? 'invalid-target-path' : 'invalid-repository-root',
    };
  }

  const sources: ArtifactLaunchCommandSource[] = [];
  const candidates: ArtifactLaunchCommandCandidate[] = [];
  for (const directory of directories) {
    for (const [filename, kind, parse] of [
      ['package.json', 'package-json', packageDefinitions],
      ['Makefile', 'makefile', makefileDefinitions],
      ['Procfile', 'procfile', procfileDefinitions],
    ] as const) {
      const path = join(directory, filename);
      const scanned = readSource(path, kind);
      if (!scanned) continue;
      if (scanned.text === undefined) {
        sources.push(scanned.source);
        continue;
      }
      const definitions = parse(scanned.text);
      if (definitions === null) {
        sources.push(source(path, kind, 'parse-error'));
        continue;
      }
      sources.push(scanned.source);
      addDefinitions(definitions, entrypoint, path, kind, candidates);
    }
  }

  const root = directories[directories.length - 1];
  if (input.runHelpProbe && isMonadRepository(root)) {
    const monadPath = join(root, 'bin', 'monad.mjs');
    try {
      const probe = await input.runHelpProbe(['bun', 'bin/monad.mjs', entrypoint, '--help']);
      sources.push(source(monadPath, 'monad-cli', 'scanned'));
      if (probe.status === 0) candidates.push(candidate(monadPath, 'monad-cli', { key: entrypoint, command: `bun bin/monad.mjs ${entrypoint}` }));
    } catch {
      sources.push(source(monadPath, 'monad-cli', 'read-error'));
    }
  }

  if (candidates.length === 1) return { sources, candidates, command: candidates[0].command };
  return {
    sources,
    candidates,
    reason: candidates.length === 0 ? 'no-command-source' : 'ambiguous-command-source',
  };
}
