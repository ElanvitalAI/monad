import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { loadGraphTemplates } from '../src/self-implement/graph-yaml.js';
import { runLedgerDir } from '../src/self-implement/run-ledger.js';

type LedgerVisit = {
  readonly graphId: string;
  readonly node: string;
};

type LedgerVisitParse =
  | { readonly kind: 'visit'; readonly visit: LedgerVisit }
  | { readonly kind: 'not-visit' }
  | { readonly kind: 'legacy-pipeline-node-entry' }
  | { readonly kind: 'invalid-json' }
  | { readonly kind: 'missing-event' };

export interface GraphVisitBudgetRow {
  readonly graphId: string;
  readonly node: string;
  readonly declaredMaxVisits: number;
  readonly observedMaxVisits: number;
  readonly headroom: number;
  readonly supportingRuns: number;
}

export interface MissingGraphVisitBudgetDeclaration {
  readonly graphId: string;
  readonly node: string;
  readonly observedMaxVisits: number;
  readonly supportingRuns: number;
}

export interface GraphVisitBudgetMeasurement {
  readonly ledgerDirectory: string;
  readonly graphsDirectory: string;
  readonly runsMeasured: number;
  readonly evidenceRuns: number;
  readonly legacyPipelineNodeEntriesSkipped: number;
  readonly invalidJsonLines: number;
  readonly missingEventLines: number;
  readonly rows: readonly GraphVisitBudgetRow[];
  readonly missingDeclarations: readonly MissingGraphVisitBudgetDeclaration[];
}

export interface GraphVisitBudgetMeasurementOptions {
  readonly ledgerDirectory?: string;
  readonly graphsDirectory?: string;
  readonly list?: (path: string) => string[];
  readonly read?: (path: string, encoding: 'utf8') => string;
}

function runIdFromLedgerFile(fileName: string): string {
  if (!fileName.endsWith('.jsonl')) throw new Error(`could not read ledger ${fileName}: expected a .jsonl run ledger`);
  return basename(fileName, '.jsonl');
}

function parseLedgerVisit(line: string): LedgerVisitParse {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return { kind: 'invalid-json' };
  }
  if (typeof entry !== 'object' || entry === null || !('event' in entry) || typeof entry.event !== 'string' || !entry.event) {
    return { kind: 'missing-event' };
  }
  if (entry.event !== 'pipeline-node-entry') return { kind: 'not-visit' };
  const data: Record<string, unknown> | undefined = 'data' in entry && typeof entry.data === 'object' && entry.data !== null
    ? entry.data as Record<string, unknown>
    : undefined;
  const graphId = data?.graphId;
  const node = data?.node;
  if (typeof graphId !== 'string' || !graphId || typeof node !== 'string' || !node) return { kind: 'legacy-pipeline-node-entry' };
  return { kind: 'visit', visit: { graphId, node } };
}

/** Recompute per-run visit maxima from read-only JSONL ledgers and compare them to YAML graph declarations. */
export function measureGraphVisitBudgetDrift(options: GraphVisitBudgetMeasurementOptions = {}): GraphVisitBudgetMeasurement {
  const ledgerDirectory = resolve(options.ledgerDirectory ?? runLedgerDir());
  const graphsDirectory = resolve(options.graphsDirectory ?? defaultGraphsDir());
  const list = options.list ?? readdirSync;
  const read = options.read ?? readFileSync;
  let fileNames: string[];
  try {
    fileNames = list(ledgerDirectory);
  } catch (error) {
    throw new Error(`could not read ledger directory ${ledgerDirectory}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const loaded = loadGraphTemplates(graphsDirectory);
  if (loaded.errors.length > 0) throw new Error(`could not read graph declarations in ${graphsDirectory}: ${loaded.errors.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);

  const countsByRun = new Map<string, number>();
  let runsMeasured = 0;
  let legacyPipelineNodeEntriesSkipped = 0;
  let invalidJsonLines = 0;
  let missingEventLines = 0;
  for (const fileName of fileNames.filter((name) => name.endsWith('.jsonl')).sort()) {
    const runId = runIdFromLedgerFile(fileName);
    const path = join(ledgerDirectory, fileName);
    let raw: string;
    try {
      raw = read(path, 'utf8');
    } catch (error) {
      throw new Error(`could not read ledger ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    runsMeasured += 1;
    for (const line of raw.split(/\r?\n/).filter((value) => value.length > 0)) {
      const parsed = parseLedgerVisit(line);
      if (parsed.kind === 'invalid-json') {
        invalidJsonLines += 1;
        continue;
      }
      if (parsed.kind === 'missing-event') {
        missingEventLines += 1;
        continue;
      }
      if (parsed.kind === 'legacy-pipeline-node-entry') {
        legacyPipelineNodeEntriesSkipped += 1;
        continue;
      }
      if (parsed.kind !== 'visit') continue;
      const { visit } = parsed;
      const key = `${runId}\u0000${visit.graphId}\u0000${visit.node}`;
      countsByRun.set(key, (countsByRun.get(key) ?? 0) + 1);
    }
  }
  const maxima = new Map<string, number>();
  const evidenceRunIds = new Set<string>();
  const supportingRunIdsByNode = new Map<string, Set<string>>();
  for (const [key, count] of countsByRun) {
    const [runId, graphId, node] = key.split('\u0000');
    const nodeKey = `${graphId}\u0000${node}`;
    evidenceRunIds.add(runId!);
    const supportingRunIds = supportingRunIdsByNode.get(nodeKey) ?? new Set<string>();
    supportingRunIds.add(runId!);
    supportingRunIdsByNode.set(nodeKey, supportingRunIds);
    maxima.set(nodeKey, Math.max(maxima.get(nodeKey) ?? 0, count));
  }

  const declarations = new Map<string, number>();
  for (const template of Object.values(loaded.templates)) {
    for (const node of template.nodes) declarations.set(`${template.graphId}\u0000${node.nodeId}`, node.maxVisits);
  }
  const rows: GraphVisitBudgetRow[] = [];
  const missingDeclarations: MissingGraphVisitBudgetDeclaration[] = [];
  for (const [key, observedMaxVisits] of maxima) {
    const [graphId, node] = key.split('\u0000');
    const supportingRuns = supportingRunIdsByNode.get(key)?.size ?? 0;
    const declaredMaxVisits = declarations.get(key);
    if (declaredMaxVisits === undefined) missingDeclarations.push({ graphId: graphId!, node: node!, observedMaxVisits, supportingRuns });
    else rows.push({ graphId: graphId!, node: node!, declaredMaxVisits, observedMaxVisits, headroom: declaredMaxVisits - observedMaxVisits, supportingRuns });
  }
  rows.sort((left, right) => left.graphId.localeCompare(right.graphId) || left.node.localeCompare(right.node));
  missingDeclarations.sort((left, right) => left.graphId.localeCompare(right.graphId) || left.node.localeCompare(right.node));
  return {
    ledgerDirectory,
    graphsDirectory,
    runsMeasured,
    evidenceRuns: evidenceRunIds.size,
    legacyPipelineNodeEntriesSkipped,
    invalidJsonLines,
    missingEventLines,
    rows,
    missingDeclarations,
  };
}

export function renderGraphVisitBudgetDrift(measurement: GraphVisitBudgetMeasurement): string {
  const lines = [
    `ledger directory: ${measurement.ledgerDirectory}`,
    `graphs directory: ${measurement.graphsDirectory}`,
    `ledger files scanned: ${measurement.runsMeasured}`,
    `evidence-producing runs: ${measurement.evidenceRuns}`,
    `legacy pipeline-node-entry skipped: ${measurement.legacyPipelineNodeEntriesSkipped}`,
    `invalid JSON lines: ${measurement.invalidJsonLines}`,
    `missing event lines: ${measurement.missingEventLines}`,
    'declared node visits:',
    ...measurement.rows.map((row) => `  graph=${row.graphId} node=${row.node} declared max_visits=${row.declaredMaxVisits} observed maximum=${row.observedMaxVisits} headroom=${row.headroom} supporting runs=${row.supportingRuns}`),
    'missing declaration:',
    ...(measurement.missingDeclarations.length > 0
      ? measurement.missingDeclarations.map((row) => `  graph=${row.graphId} node=${row.node} observed maximum=${row.observedMaxVisits} supporting runs=${row.supportingRuns}`)
      : ['  none']),
  ];
  return lines.join('\n');
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a directory`);
  return value;
}

/** Direct Bun entrypoint: reads ledgers and graph declarations only, then prints current visit-budget headroom. */
export function main(args = process.argv.slice(2)): number {
  try {
    const measurement = measureGraphVisitBudgetDrift({
      ...(optionValue(args, '--ledger-dir') === undefined ? {} : { ledgerDirectory: optionValue(args, '--ledger-dir') }),
      ...(optionValue(args, '--graphs-dir') === undefined ? {} : { graphsDirectory: optionValue(args, '--graphs-dir') }),
    });
    console.log(renderGraphVisitBudgetDrift(measurement));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : `could not read measurement inputs: ${String(error)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main());
