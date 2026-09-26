#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { debug } from '../debug/log.js';
import { PluginHost, BUILTIN_DIR, type PluginEntry } from './core/host.js';
import type { PluginManifestContributes } from './core/manifest.js';
import { WidgetHost } from '../widgets/host.js';

export const PORTABLE_BUCKETS = [
  'agents',
  'skills',
  'tools',
  'mcpServers',
  'hooks',
  'missions',
  'workflows',
  'providers',
] as const;

export const RICH_BUCKETS = [
  'panes',
  'widgets',
  'views',
  'modals',
  'themes',
  'keybindings',
  'routes',
] as const;

export const OBSERVABLE_NONPORTABLE_BUCKETS = ['commands'] as const;

/** 판정과 무관하게 보존한다 — 다른 트랙이 소유하거나 살아 있는 능력을 준다.
 *  ⛔ 이 목록이 «코드에» 있어야 한다. 실행 결과로만 보존되면 그 플러그인이 기여를
 *  잃는 날 조용히 삭제 후보가 된다(2026-09-03 리뷰 must-fix). */
export const PROTECTED_PLUGIN_NAMES = ['agent-team', 'consensus-trader'] as const;

/** 이 저장소 소스가 그 플러그인 파일을 «import» 하면 걷지 않는다.
 *  ⛔ 기여 축과 «다른 축»이다 — 기여가 0이어도 소스가 import 하면 삭제가 빌드를 깬다.
 *  📏 계기(2026-09-03): `iul-presets` 는 기여 0이었지만 `src/playground/lab.ts` 가
 *     `plugins/iul-presets/registry.js` 를 import 하고 있었다. */
export const SOURCE_IMPORT_SCAN_ROOTS = ['src', 'scripts'] as const;

/** 훑을 소스 확장자. ⛔ `.ts` 만 보면 `.tsx`·`.mts` 소비자를 놓친다(2026-09-03 리뷰). */
export const SOURCE_IMPORT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

export type PortableBucket = (typeof PORTABLE_BUCKETS)[number];
export type RichBucket = (typeof RICH_BUCKETS)[number];
export type ObservableBucket = PortableBucket | RichBucket | 'commands';
export type LegacyVerdict = 'A' | 'B' | 'C';

export interface ObservedContribution {
  bucket: ObservableBucket;
  names: string[];
}

export interface LegacyPluginClassification {
  name: string;
  path: string;
  verdict: LegacyVerdict;
  contributions: ObservedContribution[];
  reason: string;
}

export interface ClassifyLegacyPluginsOptions {
  pluginDir?: string;
  userDir?: string;
  host?: PluginHost;
}

function emptyHooks() {
  return {
    log: () => {},
    hudSet: () => {},
    requestRender: () => {},
    focusPane: () => {},
  };
}

function contributionName(item: unknown, index: number): string {
  if (typeof item === 'string' && item.trim()) return item.trim();
  if (item && typeof item === 'object') {
    const rec = item as Record<string, unknown>;
    for (const key of ['name', 'id', 'type', 'key', 'command']) {
      const value = rec[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    const bodyPath = rec.bodyPath;
    if (typeof bodyPath === 'string' && bodyPath.trim()) {
      const base = bodyPath.trim().split(/[\\/]/).pop() ?? '';
      const stem = base.replace(/\.[^.]+$/, '');
      if (stem) return stem;
    }
  }
  return `#${index}`;
}

function namesFrom(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map((item, index) => contributionName(item, index));
}

function mergeNames(existing: string[] | undefined, extra: string[]): string[] {
  const out = [...(existing ?? [])];
  for (const name of extra) {
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

function inspectContributes(contributes: PluginManifestContributes | undefined): Map<ObservableBucket, string[]> {
  const observed = new Map<ObservableBucket, string[]>();
  if (!contributes || typeof contributes !== 'object') return observed;
  const rec = contributes as Record<string, unknown>;
  const buckets: ObservableBucket[] = [
    ...PORTABLE_BUCKETS,
    ...RICH_BUCKETS,
    ...OBSERVABLE_NONPORTABLE_BUCKETS,
  ];
  for (const bucket of buckets) {
    const names = namesFrom(rec[bucket]);
    if (names.length > 0) observed.set(bucket, names);
  }
  return observed;
}

function mergeIntoContributes(
  contributes: Record<string, unknown>,
  bucket: ObservableBucket,
  extra: string[],
): void {
  if (extra.length === 0) return;
  const existing = namesFrom(contributes[bucket]);
  contributes[bucket] = mergeNames(existing, extra).map((name) => ({ name }));
}

function recordRuntimeIntoContributes(entry: PluginEntry): Record<string, unknown> {
  const contributes: Record<string, unknown> = { ...(entry.manifest.contributes ?? {}) };
  const plugin = entry.plugin;
  mergeIntoContributes(contributes, 'commands', namesFrom(plugin.slashCommands));
  mergeIntoContributes(contributes, 'widgets', namesFrom(plugin.widgets));
  mergeIntoContributes(contributes, 'widgets', namesFrom(plugin.requiredWidgets));
  if (typeof plugin.buildLayout === 'function') {
    mergeIntoContributes(contributes, 'widgets', ['buildLayout']);
  }
  mergeIntoContributes(contributes, 'tools', namesFrom(plugin.llmTools));
  mergeIntoContributes(contributes, 'keybindings', namesFrom(plugin.keybindings));
  return contributes;
}

function contributionsFromMap(observed: Map<ObservableBucket, string[]>): ObservedContribution[] {
  const order: ObservableBucket[] = [
    ...PORTABLE_BUCKETS,
    ...OBSERVABLE_NONPORTABLE_BUCKETS,
    ...RICH_BUCKETS,
  ];
  return order
    .filter((bucket) => (observed.get(bucket)?.length ?? 0) > 0)
    .map((bucket) => ({ bucket, names: observed.get(bucket)! }));
}

function formatContributionEvidence(contributions: ObservedContribution[]): string {
  if (contributions.length === 0) return 'none';
  return contributions
    .map((c) => `${c.bucket}[${c.names.join(', ')}]`)
    .join('; ');
}

/** 「그 줄 «전체»가 주석인가」만 판정해 그런 줄을 뺀다.
 *
 *  ⛔⭐ 왜 «지우기»가 아니라 «줄 걸러내기»인가 — 두 오류의 «비용»이 다르다:
 *    과탐(주석을 소비로 셈) ⇒ 플러그인이 «남는다»            ⇒ 손실 = 안 지움
 *    미탐(실제 import 를 놓침) ⇒ 플러그인이 «지워진다»       ⇒ 손실 = 빌드가 깨진다
 *  ⇒ 미탐이 훨씬 비싸므로 «놓치지 않는 쪽»으로 보수적으로 판정한다.
 *
 *  📏 앞선 판은 주석을 «지웠고», 그래서 문자열 안의 `//` 뒤에 오는 «실제 import» 까지
 *     지워 소비 중인 플러그인을 A 로 오판할 수 있었다(2026-09-03 7R 리뷰 must-fix).
 *     줄 «전체»가 주석인 경우만 빼면 그 갈래가 사라진다 — 실제 import 는 줄 앞에 코드가 있다.
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      // 블록이 이 줄에서 닫히면 «닫힌 뒤»의 잔여만 남긴다.
      const close = line.indexOf('*/');
      if (close === -1) continue;              // 여전히 블록 안 — 통째로 뺀다
      inBlock = false;
      const rest = line.slice(close + 2);
      if (rest.trim()) out.push(rest);
      continue;
    }
    if (t.startsWith('//')) continue;          // 줄 전체가 줄 주석
    // 이 줄에서 블록이 «열리고 안 닫히면» 다음 줄부터 블록 안이다.
    const open = line.lastIndexOf('/*');
    if (open !== -1 && line.indexOf('*/', open + 2) === -1) {
      inBlock = true;
      const head = line.slice(0, open);
      if (head.trim()) out.push(head);         // 여는 줄 «앞»의 코드는 남긴다
      continue;
    }
    if (t.startsWith('/*') || t.startsWith('*')) continue;  // 한 줄 블록·관례 이어짐
    out.push(line);
  }
  return out.join('\n');
}

/** 소스 트리가 `plugins/<name>/…` 를 import 하는 자리를 «파일 이름으로» 돌려준다.
 *  ⛔ 낱말 검색이 아니라 import/require 문면만 본다 — 문서·문자열 언급은 삭제를 막지 않는다. */
export function sourceImportersOf(name: string, repoRoot: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // from '…' · import '…'(side-effect) · import('…') · require('…') · require ('…')
  const pattern = new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"\`][^'"\`]*plugins/${escaped}/`,
  );
  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const full = join(dir, e);
      let stat; try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) { walk(full); continue; }
      if (!SOURCE_IMPORT_EXTENSIONS.some((ext) => full.endsWith(ext))) continue;
      if (/\.test\.[cm]?tsx?$/.test(full)) continue;
      try {
        // ⛔ 주석 속 import/require 를 «실제 소비»로 세지 않는다(2026-09-03 리뷰 must-fix).
        //    블록 주석과 줄 주석을 지운 뒤 검사한다. ⚠️ 문자열 안의 `//` 를 지울 수 있으나,
        //    그 방향의 오류는 「덜 세는」 쪽이라 삭제를 «막지» 못할 뿐 잘못 막지는 않는다.
        if (pattern.test(stripComments(readFileSync(full, 'utf8')))) found.push(full);
      } catch { /* fail-soft */ }
    }
  };
  for (const root of SOURCE_IMPORT_SCAN_ROOTS) walk(join(repoRoot, root));
  return found;
}

function verdictFromObserved(
  observed: Map<ObservableBucket, string[]>,
  guards: { name: string; sourceImporters: string[] } = { name: '', sourceImporters: [] },
): { verdict: LegacyVerdict; reason: string } {
  const portable = PORTABLE_BUCKETS.flatMap((bucket) =>
    (observed.get(bucket) ?? []).map((name) => `${bucket}:${name}`),
  );
  const contributions = contributionsFromMap(observed);
  const evidence = formatContributionEvidence(contributions);
  if ((PROTECTED_PLUGIN_NAMES as readonly string[]).includes(guards.name)) {
    return {
      verdict: 'B',
      reason: `protected by name regardless of verdict (observed ${evidence})`,
    };
  }
  if (guards.sourceImporters.length > 0) {
    return {
      verdict: 'B',
      reason: `repository source imports this plugin: ${guards.sourceImporters.join(', ')} (observed ${evidence})`,
    };
  }
  if (portable.length > 0) {
    return {
      verdict: 'B',
      reason: `portable contributions present: ${portable.join(', ')} (observed ${evidence})`,
    };
  }
  return {
    verdict: 'A',
    reason: `zero portable contributions (commands are evidence only; observed ${evidence})`,
  };
}

/** 디렉토리 이름으로 보호를 판정한다. ⛔ manifest.id 와 디렉토리명이 다를 수 있어 «둘 다» 본다. */
export function isProtectedPluginName(name: string): boolean {
  return (PROTECTED_PLUGIN_NAMES as readonly string[]).includes(name);
}

/** `<repo>/plugins/<dir>` 에서 마지막 조각(디렉토리 이름)을 낸다. */
export function directoryNameOf(pluginPath: string): string {
  return pluginPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
}

/** `<repo>/plugins/<name>` 경로에서 저장소 뿌리를 되짚는다. */
function repoRootFor(pluginPath: string): string {
  return join(pluginPath, '..', '..');
}

async function classifyByActivation(
  host: PluginHost,
  entry: PluginEntry,
): Promise<LegacyPluginClassification> {
  const name = entry.manifest.id || entry.plugin.name;
  try {
    await host.activate(name);
    const active = host.active();
    const liveEntry = host.list().find((item) => item.manifest.id === name) ?? entry;
    const contributes = recordRuntimeIntoContributes(liveEntry);
    if (active) {
      mergeIntoContributes(contributes, 'widgets', active.ownedWidgetTypes ?? []);
      mergeIntoContributes(contributes, 'commands', namesFrom(liveEntry.plugin.slashCommands));
    }
    const observed = inspectContributes(contributes as PluginManifestContributes);
    const { verdict, reason } = verdictFromObserved(observed, {
      name,
      // ⛔ 스캔 키는 manifest.id 가 아니라 «디렉토리명»이다 — 소비자는 `plugins/<디렉토리>/…` 를
      //    쓰므로 둘이 다르면 실제 소비를 놓쳐 A 로 오판한다(2026-09-03 6R 리뷰 must-fix).
      sourceImporters: sourceImportersOf(directoryNameOf(entry.path), repoRootFor(entry.path)),
    });
    return {
      name,
      path: entry.path,
      verdict,
      contributions: contributionsFromMap(observed),
      reason,
    };
  } catch (err: any) {
    return {
      name,
      path: entry.path,
      verdict: 'C',
      contributions: [],
      reason: `activation failed: ${err?.message || String(err)}`,
    };
  } finally {
    try {
      if (host.active()) await host.deactivate();
    } catch {
      // Classification must still return a named record.
    }
  }
}

function listPluginDirectories(pluginDir: string): string[] {
  if (!existsSync(pluginDir)) return [];
  return readdirSync(pluginDir)
    .filter((name) => {
      try {
        return statSync(join(pluginDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function classifyUndiscoveredDirectory(pluginDir: string, name: string): LegacyPluginClassification {
  const path = join(pluginDir, name);
  // ⛔ 보호는 «발견 여부와 무관»하다. 이 경로를 빼먹으면 발견 불가인 보호 디렉토리가 C 로 떨어지고,
  //    「보호는 먼저」라는 규칙이 문서에만 남는다(2026-09-03 5R 리뷰 must-fix).
  if (isProtectedPluginName(name)) {
    return { name, path, verdict: 'B', contributions: [], reason: 'protected by name before discovery/activation' };
  }
  const hasLegacyEntry = existsSync(join(path, 'plugin.ts'));
  const hasManifest = existsSync(join(path, 'plugin.json'))
    || existsSync(join(path, '.elanous-plugin', 'plugin.json'));
  const reason = !hasLegacyEntry && !hasManifest
    ? 'undiscoverable: no plugin.ts and no plugin.json (host skips library/category dirs)'
    : 'undiscoverable: host scan skipped this directory';
  return {
    name,
    path,
    verdict: 'C',
    contributions: [],
    reason,
  };
}

export async function classifyLegacyPlugins(
  options: ClassifyLegacyPluginsOptions = {},
): Promise<LegacyPluginClassification[]> {
  const pluginDir = options.pluginDir ?? BUILTIN_DIR;
  const widgetHost = new WidgetHost({ log: () => {}, requestRender: () => {} });
  const host = options.host ?? new PluginHost(emptyHooks(), widgetHost, {
    userDir: options.userDir ?? join(pluginDir, '.legacy-classify-empty-user'),
  });
  if (!options.host) {
    host.setWidgetHost(widgetHost);
    try { await widgetHost.discover(); } catch { /* classification still proceeds */ }
  }

  if (options.pluginDir) {
    await (host as any).scanDir(pluginDir, 'builtin');
  } else {
    await host.discover();
  }

  const discovered = host.list();
  const results: LegacyPluginClassification[] = [];
  for (const entry of discovered) {
    let record: LegacyPluginClassification;
    // ⛔ 보호는 «발견·활성화보다 먼저»다. 활성화 뒤에만 걸면 host 가 그 디렉토리를 건너뛰거나
    //    활성화가 실패하는 판에서 보호가 통째로 우회된다(2026-09-03 리뷰 must-fix).
    //    📏 실물: 어떤 리비전에서 consensus-trader 가 「발견 불가」로 C 가 됐다.
    if (isProtectedPluginName(directoryNameOf(entry.path))
        || isProtectedPluginName(entry.manifest.id || entry.plugin.name)) {
      record = {
        name: entry.manifest.id || entry.plugin.name,
        path: entry.path,
        verdict: 'B',
        contributions: [],
        reason: 'protected by name before discovery/activation',
      };
      results.push(record);
      debug.log('plugin.legacy-classify', 'verdict', {
        name: record.name, verdict: record.verdict, contributions: [], reason: record.reason,
      });
      continue;
    }
    try {
      record = await classifyByActivation(host, entry);
    } catch (err: any) {
      record = {
        name: entry.manifest.id || entry.plugin.name,
        path: entry.path,
        verdict: 'C',
        contributions: [],
        reason: `classification error: ${err?.message || String(err)}`,
      };
    }
    results.push(record);
    debug.log('plugin.legacy-classify', 'verdict', {
      name: record.name,
      verdict: record.verdict,
      contributions: record.contributions,
      reason: record.reason,
    });
  }

  const discoveredNames = new Set(results.map((r) => r.name));
  for (const dirName of listPluginDirectories(pluginDir)) {
    if (dirName.startsWith('.')) continue;
    if (discoveredNames.has(dirName)) continue;
    // ⛔ 디렉토리 «경로»로 중복을 막는다 — manifest.id 와 디렉토리명이 다르면 같은 디렉토리에
    //    두 판정이 생긴다(2026-09-03 5R 리뷰 must-fix).
    if (results.some((r) => directoryNameOf(r.path) === dirName)) continue;
    const record = classifyUndiscoveredDirectory(pluginDir, dirName);
    results.push(record);
    debug.log('plugin.legacy-classify', 'verdict', {
      name: record.name,
      verdict: record.verdict,
      contributions: record.contributions,
      reason: record.reason,
    });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

export function formatClassificationReport(records: LegacyPluginClassification[]): string {
  return records.map((record) => {
    const evidence = formatContributionEvidence(record.contributions);
    return `${record.name}\t${record.verdict}\t${evidence}\t${record.reason}`;
  }).join('\n');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const pluginDir = argv[0] && !argv[0].startsWith('-') ? argv[0] : BUILTIN_DIR;
  try {
    const records = await classifyLegacyPlugins({ pluginDir });
    const dirs = listPluginDirectories(pluginDir).filter((name) => !name.startsWith('.'));
    // ⛔ 완전성 검사도 «디렉토리 경로» 기준이다 — record.name 은 manifest.id 일 수 있어
    //    id≠디렉토리명 인 플러그인이 「unnamed」로 잘못 잡히고 exit 1 이 난다(6R 리뷰 must-fix).
    const named = new Set(records.map((r) => directoryNameOf(r.path)));
    const missing = dirs.filter((name) => !named.has(name));
    process.stdout.write(formatClassificationReport(records) + '\n');
    if (missing.length > 0) {
      process.stderr.write(`legacy-classify: unnamed directories: ${missing.join(', ')}\n`);
      return 1;
    }
    return 0;
  } catch (err: any) {
    process.stderr.write(`legacy-classify failed: ${err?.message || String(err)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
