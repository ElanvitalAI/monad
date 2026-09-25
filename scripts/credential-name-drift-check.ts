import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export interface UnreadableCredentialInput {
  path: string;
  reason: string;
}

export interface CredentialNameDriftResult {
  envExampleOnly: string[];
  resourceMapOnly: string[];
  both: string[];
  unreadable: UnreadableCredentialInput[];
}

export interface CredentialNameDriftOptions {
  envExamplePath?: string;
  resourceMapPath?: string;
  readFile?: (path: string) => string;
}

export interface CredentialNameDriftCliOptions extends CredentialNameDriftOptions {
  out?: { log: (line: string) => void };
  setExitCode?: (code: number) => void;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const credentialAssignment = /^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function namesFromEnvExample(contents: string): Set<string> {
  const names = new Set<string>();
  for (const line of contents.split('\n')) {
    const match = line.match(credentialAssignment);
    if (match) names.add(match[1]!);
  }
  return names;
}

function namesFromResourceMap(contents: string): Set<string> {
  const document = parseYaml(contents) as { resources?: unknown } | null;
  const names = new Set<string>();
  if (!Array.isArray(document?.resources)) return names;

  for (const resource of document.resources) {
    if (typeof resource !== 'object' || resource === null) continue;
    const env = (resource as { env?: unknown }).env;
    if (!Array.isArray(env)) continue;
    for (const name of env) {
      if (typeof name === 'string') names.add(name);
    }
  }
  return names;
}

function unreadable(path: string, error: unknown): UnreadableCredentialInput {
  return { path, reason: error instanceof Error && error.message ? error.message : String(error) || 'unknown read failure' };
}

export function checkCredentialNameDrift(options: CredentialNameDriftOptions = {}): CredentialNameDriftResult {
  const envExamplePath = options.envExamplePath ?? join(repositoryRoot, '.env.example');
  const resourceMapPath = options.resourceMapPath ?? join(repositoryRoot, 'catalog/resources.yaml');
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const unreadableInputs: UnreadableCredentialInput[] = [];
  let envNames = new Set<string>();
  let resourceNames = new Set<string>();

  try {
    envNames = namesFromEnvExample(readFile(envExamplePath));
  } catch (error) {
    unreadableInputs.push(unreadable(envExamplePath, error));
  }

  try {
    resourceNames = namesFromResourceMap(readFile(resourceMapPath));
  } catch (error) {
    unreadableInputs.push(unreadable(resourceMapPath, error));
  }

  return {
    envExampleOnly: sorted([...envNames].filter((name) => !resourceNames.has(name))),
    resourceMapOnly: sorted([...resourceNames].filter((name) => !envNames.has(name))),
    both: sorted([...envNames].filter((name) => resourceNames.has(name))),
    unreadable: unreadableInputs,
  };
}

export function credentialNameDriftCliMain(options: CredentialNameDriftCliOptions = {}): CredentialNameDriftResult {
  const result = checkCredentialNameDrift(options);
  const out = options.out ?? console;
  out.log(`envExampleOnly: ${result.envExampleOnly.length}${result.envExampleOnly.length ? ` (${result.envExampleOnly.join(', ')})` : ''}`);
  out.log(`resourceMapOnly: ${result.resourceMapOnly.length}${result.resourceMapOnly.length ? ` (${result.resourceMapOnly.join(', ')})` : ''}`);
  out.log(`both: ${result.both.length}`);
  for (const input of result.unreadable) out.log(`unreadable: ${input.path} (${input.reason})`);

  const failed = result.envExampleOnly.length > 0 || result.resourceMapOnly.length > 0 || result.unreadable.length > 0;
  (options.setExitCode ?? ((code: number) => { process.exitCode = code; }))(failed ? 1 : 0);
  return result;
}

if (import.meta.main) credentialNameDriftCliMain();
