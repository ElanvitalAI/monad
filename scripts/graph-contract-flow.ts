#!/usr/bin/env bun
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { parseGraphTemplateYaml, type GraphTemplateSpec } from '../src/self-implement/graph-yaml.js';

export interface GraphContractFlowOptions {
  readonly graphsDirectory?: string;
  readonly list?: (path: string) => string[];
  readonly read?: (path: string, encoding: 'utf8') => string;
  /** Maximum entry-to-consumer paths to inspect before classifying the input as unmeasured. */
  readonly pathLimit?: number;
}

export interface GraphContractFlowGap {
  readonly graphId: string;
  readonly nodeId: string;
  readonly input: string;
  readonly kind: 'external-input' | 'disconnected-producer';
}

export interface GraphContractFlowMeasurement {
  readonly scannedFiles: number;
  readonly graphs: number;
  readonly nodes: number;
  readonly contractNodes: number;
  readonly nodesWithoutContract: number;
  readonly emptyToolContracts: number;
  readonly declaredInputs: number;
  readonly declaredOutputs: number;
  readonly satisfiedInputs: number;
  readonly externalInputs: number;
  /** External inputs produced under the identical name by another graph. */
  readonly externalInputsWithExactNameProducer: number;
  /** External inputs produced under a normalized spelling by another graph. */
  readonly externalInputsWithNormalizedNameProducer: number;
  /** External inputs with no producer in any repository graph. */
  readonly externalInputsWithNoProducer: number;
  /** No-producer external inputs declared in their graph's top-level state. */
  readonly externalInputsWithNoProducerDeclaredByGraphState: number;
  /** Graphs that declare a top-level state key, including an empty declaration. */
  readonly graphsWithDeclaredState: number;
  /** No-producer external inputs declared as supplied by the graph runner. */
  readonly externalInputsWithNoProducerDeclaredByRunner: number;
  /** No-producer external inputs not declared as supplied by the graph runner. */
  readonly externalInputsWithNoProducerUndeclaredByRunner: number;
  /** Graphs that declare a top-level runner_inputs key, including an empty declaration. */
  readonly graphsWithDeclaredRunnerInputs: number;
  /** Runner input declarations that collide with outputs produced by the same graph. */
  readonly runnerInputsProducedBySameGraph: number;
  readonly disconnectedProducerInputs: number;
  readonly firstRoundUndefinedInputs: number;
  readonly pathDependentInputs: number;
  readonly unmeasuredInputs: number;
  /** Distinct graph-node consumers whose path analysis exceeded the exploration limit. */
  readonly unmeasuredNodes: number;
  readonly unreadableFiles: number;
  readonly gaps: readonly GraphContractFlowGap[];
  readonly contractNodesByGraph: Readonly<Record<string, number>>;
  readonly gapsByGraph: Readonly<Record<string, number>>;
  readonly gapsByInput: Readonly<Record<string, number>>;
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function yamlFiles(directory: string, list: (path: string) => string[]): string[] {
  return list(directory)
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort()
    .map((file) => join(directory, file));
}

function normalizeArtifactName(name: string): string {
  return name.replace(/[-_]/g, '').toLowerCase();
}

function runnerInputs(source: string): readonly string[] | undefined {
  const value = (parseDocument(source).toJS() as { runner_inputs?: unknown }).runner_inputs;
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.filter((input): input is string => typeof input === 'string') : [];
}

function destinations(template: GraphTemplateSpec): ReadonlyMap<string, readonly string[]> {
  const next = new Map<string, string[]>();
  for (const node of template.nodes) next.set(node.nodeId, []);
  for (const edge of template.edges) {
    const destinations = edge.to === undefined ? Object.values(edge.map ?? {}) : [edge.to];
    for (const destination of destinations) next.get(edge.from)?.push(destination);
  }
  return next;
}

function reaches(from: string, target: string, next: ReadonlyMap<string, readonly string[]>): boolean {
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(next.get(current) ?? []));
  }
  return false;
}

function hasReturningEdge(nodeId: string, next: ReadonlyMap<string, readonly string[]>): boolean {
  return (next.get(nodeId) ?? []).some(destination => reaches(destination, nodeId, next));
}

function isCycleOnlyProducer(
  entryNode: string,
  consumer: string,
  producer: string,
  next: ReadonlyMap<string, readonly string[]>,
): boolean {
  if (producer === consumer) {
    return reaches(entryNode, consumer, next) && hasReturningEdge(consumer, next);
  }
  return reaches(entryNode, producer, next)
    && hasReturningEdge(producer, next)
    && reaches(producer, consumer, next);
}

type PathSupply = 'satisfied' | 'path-dependent' | 'unsupplied' | 'unmeasured' | 'no-static-path';

function classifyPathSupply(
  entryNode: string,
  target: string,
  producers: ReadonlySet<string>,
  next: ReadonlyMap<string, readonly string[]>,
  pathLimit: number,
): PathSupply {
  const pending: string[][] = [[entryNode]];
  let paths = 0;
  let suppliedPaths = 0;
  let expansions = 0;
  while (pending.length > 0) {
    if (expansions >= pathLimit) return 'unmeasured';
    const path = pending.pop()!;
    const current = path.at(-1)!;
    expansions += 1;
    if (current === target) {
      paths += 1;
      if (paths > pathLimit) return 'unmeasured';
      if (path.some((node) => node !== target && producers.has(node))) suppliedPaths += 1;
      continue;
    }
    for (const destination of next.get(current) ?? []) {
      if (!path.includes(destination)) pending.push([...path, destination]);
    }
  }
  if (paths === 0) return 'no-static-path';
  if (suppliedPaths === paths) return 'satisfied';
  return suppliedPaths === 0 ? 'unsupplied' : 'path-dependent';
}

/** Measure whether each declared contract input is supplied by a contract output that can flow to its node. */
export function measureGraphContractFlow(options: GraphContractFlowOptions = {}): GraphContractFlowMeasurement {
  const graphsDirectory = resolve(options.graphsDirectory ?? defaultGraphsDir());
  const list = options.list ?? readdirSync;
  const read = options.read ?? readFileSync;
  const files = yamlFiles(graphsDirectory, list);
  const pathLimit = options.pathLimit ?? 1_000;
  const contractNodesByGraph: Record<string, number> = Object.create(null);
  const gapsByGraph: Record<string, number> = Object.create(null);
  const gapsByInput: Record<string, number> = Object.create(null);
  const gaps: GraphContractFlowGap[] = [];
  const templates: Array<{ template: GraphTemplateSpec; runnerInputs: readonly string[] | undefined }> = [];
  const outputProducerGraphs = new Map<string, Set<string>>();
  const normalizedOutputProducerGraphs = new Map<string, Set<string>>();
  let graphs = 0;
  let nodes = 0;
  let contractNodes = 0;
  let nodesWithoutContract = 0;
  let emptyToolContracts = 0;
  let declaredInputs = 0;
  let declaredOutputs = 0;
  let satisfiedInputs = 0;
  let externalInputs = 0;
  let externalInputsWithExactNameProducer = 0;
  let externalInputsWithNormalizedNameProducer = 0;
  let externalInputsWithNoProducer = 0;
  let externalInputsWithNoProducerDeclaredByGraphState = 0;
  let graphsWithDeclaredState = 0;
  let externalInputsWithNoProducerDeclaredByRunner = 0;
  let externalInputsWithNoProducerUndeclaredByRunner = 0;
  let graphsWithDeclaredRunnerInputs = 0;
  let runnerInputsProducedBySameGraph = 0;
  let disconnectedProducerInputs = 0;
  let firstRoundUndefinedInputs = 0;
  let pathDependentInputs = 0;
  let unmeasuredInputs = 0;
  const unmeasuredNodeKeys = new Set<string>();
  let unreadableFiles = 0;

  for (const path of files) {
    let source: string;
    try {
      source = read(path, 'utf8');
    } catch {
      unreadableFiles += 1;
      continue;
    }
    const parsed = parseGraphTemplateYaml(source, path);
    if (!parsed.template) {
      unreadableFiles += 1;
      continue;
    }
    const template = parsed.template;
    const declaredRunnerInputs = runnerInputs(source);
    templates.push({ template, runnerInputs: declaredRunnerInputs });
    graphs += 1;
    if (template.state !== undefined) graphsWithDeclaredState += 1;
    if (declaredRunnerInputs !== undefined) graphsWithDeclaredRunnerInputs += 1;
    nodes += template.nodes.length;
    for (const node of template.nodes) {
      for (const output of node.contract?.outputs ?? []) {
        const exactProducerGraphs = outputProducerGraphs.get(output) ?? new Set<string>();
        exactProducerGraphs.add(template.graphId);
        outputProducerGraphs.set(output, exactProducerGraphs);
        const normalizedOutput = normalizeArtifactName(output);
        const normalizedProducerGraphs = normalizedOutputProducerGraphs.get(normalizedOutput) ?? new Set<string>();
        normalizedProducerGraphs.add(template.graphId);
        normalizedOutputProducerGraphs.set(normalizedOutput, normalizedProducerGraphs);
      }
    }
  }

  for (const { template, runnerInputs: declaredRunnerInputs } of templates) {
    const declaredRunnerInputSet = new Set(declaredRunnerInputs);
    const graphOutputs = new Set(template.nodes.flatMap((node) => node.contract?.outputs ?? []));
    runnerInputsProducedBySameGraph += [...declaredRunnerInputSet].filter((input) => graphOutputs.has(input)).length;
    const next = destinations(template);
    const outputProducers = new Map<string, string[]>();
    for (const node of template.nodes) {
      if (!node.contract) {
        nodesWithoutContract += 1;
        continue;
      }
      contractNodes += 1;
      increment(contractNodesByGraph, template.graphId);
      declaredInputs += node.contract.inputs.length;
      declaredOutputs += node.contract.outputs.length;
      if (node.contract.tools === '') emptyToolContracts += 1;
      for (const output of node.contract.outputs) {
        const producers = outputProducers.get(output) ?? [];
        producers.push(node.nodeId);
        outputProducers.set(output, producers);
      }
    }
    for (const node of template.nodes) {
      if (!node.contract) continue;
      for (const input of node.contract.inputs) {
        const producers = outputProducers.get(input) ?? [];
        if (producers.length === 0) {
          externalInputs += 1;
          const exactProducerGraphs = outputProducerGraphs.get(input);
          const hasExactNameProducer = [...(exactProducerGraphs ?? [])].some((graphId) => graphId !== template.graphId);
          const normalizedProducerGraphs = normalizedOutputProducerGraphs.get(normalizeArtifactName(input));
          const hasNormalizedNameProducer = [...(normalizedProducerGraphs ?? [])].some((graphId) => graphId !== template.graphId);
          if (hasExactNameProducer) externalInputsWithExactNameProducer += 1;
          else if (hasNormalizedNameProducer) externalInputsWithNormalizedNameProducer += 1;
          else {
            externalInputsWithNoProducer += 1;
            if (template.state?.includes(input)) externalInputsWithNoProducerDeclaredByGraphState += 1;
            if (declaredRunnerInputSet.has(input)) externalInputsWithNoProducerDeclaredByRunner += 1;
            else externalInputsWithNoProducerUndeclaredByRunner += 1;
          }
          gaps.push({ graphId: template.graphId, nodeId: node.nodeId, input, kind: 'external-input' });
          increment(gapsByGraph, template.graphId);
          increment(gapsByInput, input);
          continue;
        }
        const producerSet = new Set(producers.filter((producer) => producer !== node.nodeId));
        const pathSupply = classifyPathSupply(template.entryNode, node.nodeId, producerSet, next, pathLimit);
        if (pathSupply === 'satisfied') {
          satisfiedInputs += 1;
          continue;
        }
        if (pathSupply === 'path-dependent') {
          pathDependentInputs += 1;
          continue;
        }
        if (pathSupply === 'unmeasured') {
          unmeasuredInputs += 1;
          unmeasuredNodeKeys.add(`${template.graphId}\u0000${node.nodeId}`);
          continue;
        }
        const isCycleOnly = producers.some((producer) => (
          isCycleOnlyProducer(template.entryNode, node.nodeId, producer, next)
        ));
        if (isCycleOnly) {
          firstRoundUndefinedInputs += 1;
          continue;
        }
        disconnectedProducerInputs += 1;
        gaps.push({ graphId: template.graphId, nodeId: node.nodeId, input, kind: 'disconnected-producer' });
        increment(gapsByGraph, template.graphId);
        increment(gapsByInput, input);
      }
    }
  }

  gaps.sort((left, right) => left.graphId.localeCompare(right.graphId) || left.nodeId.localeCompare(right.nodeId) || left.input.localeCompare(right.input));
  return {
    scannedFiles: files.length, graphs, nodes, contractNodes, nodesWithoutContract, emptyToolContracts,
    declaredInputs, declaredOutputs, satisfiedInputs, externalInputs,
    externalInputsWithExactNameProducer, externalInputsWithNormalizedNameProducer, externalInputsWithNoProducer,
    externalInputsWithNoProducerDeclaredByGraphState, graphsWithDeclaredState,
    externalInputsWithNoProducerDeclaredByRunner, externalInputsWithNoProducerUndeclaredByRunner,
    graphsWithDeclaredRunnerInputs, runnerInputsProducedBySameGraph,
    disconnectedProducerInputs, firstRoundUndefinedInputs, pathDependentInputs, unmeasuredInputs,
    unmeasuredNodes: unmeasuredNodeKeys.size, unreadableFiles,
    gaps, contractNodesByGraph, gapsByGraph, gapsByInput,
  };
}

function formatCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, count]) => `${key} ${count}`).join(', ') : 'none';
}

/** A single structured-measurement line retaining denominators, gap kinds, and graph/input breakdowns. */
export function renderGraphContractFlow(measurement: GraphContractFlowMeasurement): string {
  return `graph-contract-flow · scanned files ${measurement.scannedFiles} · graphs ${measurement.graphs} · graphs with declared state ${measurement.graphsWithDeclaredState} · graphs with declared runner inputs ${measurement.graphsWithDeclaredRunnerInputs} · nodes ${measurement.nodes} · contract nodes ${measurement.contractNodes} · nodes without contract ${measurement.nodesWithoutContract} · empty tool contracts ${measurement.emptyToolContracts} · declared inputs ${measurement.declaredInputs} · declared outputs ${measurement.declaredOutputs} · satisfied inputs ${measurement.satisfiedInputs} · external inputs ${measurement.externalInputs} · external inputs with exact-name producer ${measurement.externalInputsWithExactNameProducer} · external inputs with normalized-spelling producer ${measurement.externalInputsWithNormalizedNameProducer} · external inputs with no producer ${measurement.externalInputsWithNoProducer} · no-producer external inputs declared by graph state ${measurement.externalInputsWithNoProducerDeclaredByGraphState} · no-producer external inputs declared by runner ${measurement.externalInputsWithNoProducerDeclaredByRunner} · no-producer external inputs undeclared by runner ${measurement.externalInputsWithNoProducerUndeclaredByRunner} · runner inputs produced by same graph ${measurement.runnerInputsProducedBySameGraph} · disconnected producer inputs ${measurement.disconnectedProducerInputs} · first round undefined inputs ${measurement.firstRoundUndefinedInputs} · path dependent inputs ${measurement.pathDependentInputs} · unmeasured inputs ${measurement.unmeasuredInputs} · unmeasured nodes ${measurement.unmeasuredNodes} · unreadable files ${measurement.unreadableFiles} · contract nodes by graph ${formatCounts(measurement.contractNodesByGraph)} · gaps by graph ${formatCounts(measurement.gapsByGraph)} · gaps by input ${formatCounts(measurement.gapsByInput)}`;
}

export function main(): number {
  const measurement = measureGraphContractFlow();
  const report = renderGraphContractFlow(measurement);
  console.log(report);
  return 0;
}

if (import.meta.main) process.exit(main());
