/**
 * 공개 내보내기 유출 래칫 (E2 · 내부 문서 `RFC-private-source-public-export-2026-09-24`).
 *
 * 왜: 공개본에 갈 파일의 사적 흔적(`scripts/public-export.ts --leak-check`)이 1,600건대다. 한 번에 못 치운다 —
 * 그 사이에 «늘지» 않게 하는 것이 먼저다(같은 날 `plan-doc-link`·`runtime-path-outside-export` 가 늘어난 것을 봤다).
 * 정책은 `ci-isolation-hardcode-gate` 와 같다 — 현 기준선(표지 × 파일별 건수)을 스냅샷하고 «초과»만 실패, 치운 뒤 `--update` 로 내린다.
 *
 * 사용:
 *   bun scripts/ci-public-leak-gate.ts                          # 검사(늘었으면 exit 1)
 *   bun scripts/ci-public-leak-gate.ts --changed-files a b …    # 그 파일들만 검사
 *   bun scripts/ci-public-leak-gate.ts --update                 # 기준선 재스냅샷(치운 뒤)
 *
 * ⛔ 이 게이트는 아직 `pr land` 에 «배선하지 않았다» — 다른 트랙의 주석 관례(대표 표기 기호 등)가 매일 늘어 배선 즉시 착지가 막힌다.
 *    배선은 조율 채널 합의 뒤(2026-09-24 🅢).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadExportConfig, scanLeaks, scanRuntimePaths, selectExportFiles, type LeakHit } from './public-export.js';

const ROOT = resolve(import.meta.dir, '..');
const BASELINE_REL = 'scripts/public-leak-baseline.txt';

/** `marker\tfile` → 건수. */
export function countByMarkerAndFile(hits: readonly LeakHit[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const hit of hits) {
    const key = `${hit.marker}\t${hit.file}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

export function parseBaseline(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [count, marker, ...rest] = line.split('\t');
    const file = rest.join('\t');
    if (marker && file) out.set(`${marker}\t${file}`, Number.parseInt(count ?? '0', 10) || 0);
  }
  return out;
}

export function renderBaseline(counts: ReadonlyMap<string, number>): string {
  const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, n]) => `${n}\t${key}`);
  const total = [...counts.values()].reduce((a, n) => a + n, 0);
  return [
    '# 공개 유출 기준선 (표지 × 파일별 건수) — scripts/ci-public-leak-gate.ts',
    '# 늘면 실패 · 치운 뒤 `bun scripts/ci-public-leak-gate.ts --update` 로 내린다.',
    `# total=${total} · entries=${counts.size}`,
    '',
    ...rows,
    '',
  ].join('\n');
}

export interface LeakGrowth { readonly marker: string; readonly file: string; readonly allowed: number; readonly now: number }

/** 기준선보다 «늘어난» (표지, 파일). `only` 가 있으면 그 파일만 본다. */
export function findGrowth(current: ReadonlyMap<string, number>, baseline: ReadonlyMap<string, number>, only?: ReadonlySet<string>): LeakGrowth[] {
  const out: LeakGrowth[] = [];
  for (const [key, now] of current) {
    const [marker, file] = key.split('\t') as [string, string];
    if (only && !only.has(file)) continue;
    const allowed = baseline.get(key) ?? 0;
    if (now > allowed) out.push({ marker, file, allowed, now });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.marker.localeCompare(b.marker));
}

function scanRoot(root: string): LeakHit[] {
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  const tracked = listed.stdout.split('\0').filter(Boolean);
  const files = selectExportFiles(tracked, loadExportConfig(root));
  return [...scanLeaks(root, files), ...scanRuntimePaths(root, files, tracked)];
}

export interface PublicLeakGateIo {
  readonly args?: readonly string[];
  readonly root?: string;
  readonly scan?: () => LeakHit[];
  readonly log?: (s: string) => void;
  readonly error?: (s: string) => void;
}

export function runPublicLeakGate(io: PublicLeakGateIo = {}): number {
  const args = io.args ?? process.argv.slice(2);
  const root = io.root ?? ROOT;
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const at = args.indexOf('--changed-files');
  const only = at >= 0 ? new Set(args.slice(at + 1).filter((a) => !a.startsWith('--'))) : undefined;
  if (only && args.includes('--update')) { error('[public-leak-gate] FAIL — --changed-files 와 --update 는 같이 못 쓴다.'); return 2; }
  const current = countByMarkerAndFile((io.scan ?? (() => scanRoot(root)))());
  const baselinePath = join(root, BASELINE_REL);
  if (args.includes('--update')) {
    writeFileSync(baselinePath, renderBaseline(current));
    log(`[public-leak-gate] baseline updated — ${[...current.values()].reduce((a, n) => a + n, 0)} hits · ${current.size} entries`);
    return 0;
  }
  if (!existsSync(baselinePath)) { error(`[public-leak-gate] FAIL — 기준선이 없다: ${BASELINE_REL} (--update 로 만든다)`); return 2; }
  const growth = findGrowth(current, parseBaseline(readFileSync(baselinePath, 'utf8')), only);
  const scope = only ? `변경 파일 ${only.size}개` : '전체';
  if (growth.length === 0) { log(`[public-leak-gate] PASS — 유출이 늘지 않았다 (${scope})`); return 0; }
  error(`[public-leak-gate] FAIL — 유출이 늘었다 (${scope} · ${growth.length}곳):`);
  for (const g of growth) error(`  ${g.file}  ${g.marker}  ${g.allowed} → ${g.now}`);
  error('  확인: bun scripts/public-export.ts --leak-check --path <파일> --all');
  return 1;
}

if (import.meta.main) process.exit(runPublicLeakGate());
