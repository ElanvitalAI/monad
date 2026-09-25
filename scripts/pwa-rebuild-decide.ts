#!/usr/bin/env bun

import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative } from 'node:path';

export type PwaRebuildDecision =
  | { action: 'rebuild'; reason: 'source-newer' | 'bundle-missing'; path: string; source?: string }
  | { action: 'not-needed'; reason: 'bundle-current'; path: string }
  | { action: 'unavailable'; reason: 'target-unreadable' | 'bundle-unreadable'; path: string; error: string };

const PWA_ROOT = ['apps', 'pwa'];
const BUNDLE_DIRECTORY = 'out';
const EXCLUDED_SOURCE_DIRECTORIES = new Set(['.next', BUNDLE_DIRECTORY]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function newestFile(directory: string, excludeDirectories: Set<string> = new Set()): Promise<{ path: string; mtimeMs: number } | null> {
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!excludeDirectories.has(entry.name)) {
        const candidate = await newestFile(path, excludeDirectories);
        if (candidate && (!newest || candidate.mtimeMs > newest.mtimeMs)) newest = candidate;
      }
      continue;
    }
    if (entry.isFile()) {
      const candidate = { path, mtimeMs: (await stat(path)).mtimeMs };
      if (!newest || candidate.mtimeMs > newest.mtimeMs) newest = candidate;
    }
  }
  return newest;
}

export async function decidePwaRebuild(target: string): Promise<PwaRebuildDecision> {
  try {
    if (!(await stat(target)).isDirectory()) throw new Error('target is not a directory');
    await access(target, constants.R_OK | constants.X_OK);
  } catch (error) {
    return { action: 'unavailable', reason: 'target-unreadable', path: target, error: `target path ${JSON.stringify(target)} is unreadable: ${errorMessage(error)}` };
  }

  const pwaDirectory = join(target, ...PWA_ROOT);
  const bundleDirectory = join(pwaDirectory, BUNDLE_DIRECTORY);
  try {
    if (!(await stat(bundleDirectory)).isDirectory()) throw new Error('bundle is not a directory');
    await access(bundleDirectory, constants.R_OK | constants.X_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { action: 'rebuild', reason: 'bundle-missing', path: target };
    return { action: 'unavailable', reason: 'bundle-unreadable', path: bundleDirectory, error: `bundle path ${JSON.stringify(bundleDirectory)} is unreadable: ${errorMessage(error)}` };
  }

  try {
    const [source, bundle] = await Promise.all([
      newestFile(pwaDirectory, EXCLUDED_SOURCE_DIRECTORIES),
      newestFile(bundleDirectory),
    ]);
    if (!bundle) return { action: 'rebuild', reason: 'bundle-missing', path: target };
    if (source && source.mtimeMs > bundle.mtimeMs) return { action: 'rebuild', reason: 'source-newer', path: target, source: relative(target, source.path) };
    return { action: 'not-needed', reason: 'bundle-current', path: target };
  } catch (error) {
    return { action: 'unavailable', reason: 'bundle-unreadable', path: pwaDirectory, error: `PWA paths under ${JSON.stringify(pwaDirectory)} are unreadable: ${errorMessage(error)}` };
  }
}

export function formatPwaRebuildDecision(decision: PwaRebuildDecision): string {
  if (decision.action === 'rebuild') return decision.reason === 'source-newer'
    ? `pwa rebuild needed: ${decision.source} is newer than apps/pwa/out`
    : `pwa rebuild needed: apps/pwa/out is missing or empty in ${decision.path}`;
  if (decision.action === 'not-needed') return `pwa rebuild not needed: apps/pwa/out is current in ${decision.path}`;
  return `pwa rebuild unavailable (${decision.reason}): ${decision.error}`;
}

/** Direct CLI invocation is the runtime caller; scheduler integration is intentionally outside this decision-only goal. */
export async function main(target: string | undefined = process.argv[2]): Promise<PwaRebuildDecision> {
  if (!target) throw new Error('target tree path is required; refusing to infer it from process.cwd()');
  const decision = await decidePwaRebuild(target);
  console.log(formatPwaRebuildDecision(decision));
  return decision;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.log(formatPwaRebuildDecision({ action: 'unavailable', reason: 'target-unreadable', path: '<missing-target>', error: errorMessage(error) }));
  }
}
