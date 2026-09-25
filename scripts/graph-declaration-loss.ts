#!/usr/bin/env bun
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { compileGraphTemplate, defaultGraphsDir } from '../src/self-implement/graph-templates.js';
import { parseGraphOverlayYaml } from '../src/self-implement/graph-overlay-yaml.js';
import { parseGraphTemplateYaml } from '../src/self-implement/graph-yaml.js';

const KNOWN_NODE_KEYS = new Set(['node_id', 'kind', 'recipe', 'max_visits', 'progress', 'phases', 'terminal_stages', 'fan_out', 'contract']);

export interface GraphDeclarationLossOptions {
  readonly graphsDirectory?: string;
  readonly list?: (path: string) => string[];
  readonly read?: (path: string, encoding: 'utf8') => string;
}

export interface GraphDeclarationLossMeasurement {
  readonly scannedFiles: number;
  readonly graphs: number;
  readonly nodes: number;
  readonly discardedFields: number;
  readonly unknownNodeKeys: number;
  readonly unreadableFiles: number;
  readonly discardedFieldsByGraph: Readonly<Record<string, number>>;
  readonly discardedFieldsByField: Readonly<Record<string, number>>;
  readonly unknownNodeKeysByKey: Readonly<Record<string, number>>;
}

function yamlFiles(directory: string, list: (path: string) => string[]): string[] {
  try {
    return list(directory).filter(file => file.endsWith('.yaml') || file.endsWith('.yml')).sort().map(file => join(directory, file));
  } catch {
    return [];
  }
}

function rawUnknownNodeKeys(source: string): readonly string[] {
  const document = parseYaml(source);
  if (document === null || typeof document !== 'object') return [];
  const nodes = (document as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap(node => node !== null && typeof node === 'object'
    ? Object.keys(node as Record<string, unknown>).filter(key => !KNOWN_NODE_KEYS.has(key))
    : []);
}

function increment(counts: Record<string, number>, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

/** Read every root and overlay YAML declaration and separately measure parser-unknown keys and compiler-discarded node fields. */
export function measureGraphDeclarationLoss(options: GraphDeclarationLossOptions = {}): GraphDeclarationLossMeasurement {
  const graphsDirectory = resolve(options.graphsDirectory ?? defaultGraphsDir());
  const list = options.list ?? readdirSync;
  const read = options.read ?? readFileSync;
  const graphFiles = yamlFiles(graphsDirectory, list);
  const overlayFiles = yamlFiles(join(graphsDirectory, 'overlays'), list);
  const files = [...graphFiles, ...overlayFiles];
  const discardedFieldsByGraph: Record<string, number> = {};
  const discardedFieldsByField: Record<string, number> = {};
  const unknownNodeKeysByKey: Record<string, number> = {};
  let graphs = 0;
  let nodes = 0;
  let discardedFields = 0;
  let unknownNodeKeys = 0;
  let unreadableFiles = 0;

  for (const path of files) {
    let source: string;
    try { source = read(path, 'utf8'); }
    catch { unreadableFiles += 1; continue; }
    if (overlayFiles.includes(path)) {
      if (parseGraphOverlayYaml(source, path).errors.length > 0) unreadableFiles += 1;
      continue;
    }
    try {
      for (const key of rawUnknownNodeKeys(source)) {
        unknownNodeKeys += 1;
        increment(unknownNodeKeysByKey, key);
      }
    } catch {
      unreadableFiles += 1;
      continue;
    }
    const parsed = parseGraphTemplateYaml(source, path);
    if (!parsed.template) {
      if (parsed.errors.length > 0) unreadableFiles += 1;
      continue;
    }
    graphs += 1;
    nodes += parsed.template.nodes.length;
    for (const discarded of compileGraphTemplate(parsed.template).discardedNodeFields) {
      for (const field of discarded.fields) {
        discardedFields += 1;
        increment(discardedFieldsByGraph, parsed.template.graphId);
        increment(discardedFieldsByField, field);
      }
    }
  }

  return { scannedFiles: files.length, graphs, nodes, discardedFields, unknownNodeKeys, unreadableFiles, discardedFieldsByGraph, discardedFieldsByField, unknownNodeKeysByKey };
}

function formatCounts(counts: Readonly<Record<string, number>>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, count]) => `${key} ${count}`).join(', ') : '없음';
}

/** A single line so weekly audit extraction can preserve all denominators and both loss channels. */
export function renderGraphDeclarationLoss(measurement: GraphDeclarationLossMeasurement): string {
  return `graph-declaration-loss · scanned files ${measurement.scannedFiles} · graphs ${measurement.graphs} · nodes ${measurement.nodes} · discarded fields ${measurement.discardedFields} · unknown node keys ${measurement.unknownNodeKeys} · unreadable files ${measurement.unreadableFiles} · discarded by graph ${formatCounts(measurement.discardedFieldsByGraph)} · discarded by field ${formatCounts(measurement.discardedFieldsByField)} · unknown by key ${formatCounts(measurement.unknownNodeKeysByKey)}`;
}

export function main(): number {
  const measurement = measureGraphDeclarationLoss();
  console.log(renderGraphDeclarationLoss(measurement));
  return measurement.unreadableFiles > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(main());
