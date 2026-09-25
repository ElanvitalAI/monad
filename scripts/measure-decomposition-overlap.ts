#!/usr/bin/env bun
/**
 * 분해 조각들이 «같은 파일»을 겨냥하는지 — 발사 «전»에 센다.
 *
 * ⛔ 왜 있나(2026-09-06 · RUN-T82 ⊕ 🅢 규율):
 *   조각은 «병합된» 형제만 본다(`budgetLandedShardSiblings`). 동시에 달리는 형제의 변경은
 *   구조적으로 «안 보인다». ⇒ 두 조각이 같은 파일을 각자 고치면 ***각자 초록인데 합칠 수 없다.***
 *   실제로 2026-09-06 안드로이드 골(5조각)이 그렇게 죽었다 — draft 셋이 같은 파일 셋을 각자 고쳤다.
 *
 * 🔑 그 겹침은 «PR 이 난 뒤»가 아니라 ***분해 시점에 이미 원장에 있다***:
 *   `decomposition-shadow-goals` 이벤트가 조각별 `hotPaths`와 `feature`(골 문면)를 싣는다.
 *   ⇒ `hotPaths`가 비어 있지 않으면 값을 읽고, 옛 원장처럼 없거나 비었을 때만 산문을 뽑는다.
 *   그래서 이 자는 «발사 전»에 쓸 수 있다. PR 목록으로 세는 자는 그때 이미 늦다.
 *
 * ⚠️ **산문 폴백이 있는 표본에서만 이 자가 못 보는 것:**
 *   ⓐ 다르게 쓴 경로(디렉토리만·심볼명만)는 못 본다 = **미탐**
 *   ⓑ 「참고하라」로 언급된 경로도 대상으로 센다 = **과탐**
 *   ⇒ ⛔ 「0」을 「겹침 없음」으로 읽지 마라. 「1 이상」일 때만 강한 신호다.
 *
 * 사용:
 *   bun scripts/measure-decomposition-overlap.ts
 *   bun scripts/measure-decomposition-overlap.ts --goal <goalId>
 *   bun scripts/measure-decomposition-overlap.ts --limit 500 --json
 * 종료코드: 겹침이 하나라도 있으면 1, 없으면 0, 조회 실패면 2.
 */
import { spawnSync } from 'node:child_process';

const PATH_RE = /[\w./-]+\.(?:ts|tsx|kt|kts|md|json|toml|swift|mjs|cjs|py|yml|yaml)/g;

export interface Piece { id?: string; feature?: string; dependsOn?: readonly string[]; hotPaths?: readonly string[] }
export interface Sample { ts: string; goalId: string; runId: string; round?: number; pieces: Piece[] }
export interface Overlap {
  fileCount: number;
  hotPathPieceCount: number;
  proseFallbackPieceCount: number;
  shared: { file: string; pieces: string[] }[];
}

/** 두 경로가 «같은 파일»을 가리킬 수 있나 — 경로 «성분» 단위 접미 관계로 본다.
 *  `data/NexusClient.kt` 는 `apps/x/data/NexusClient.kt` 의 접미 ⇒ 같다고 본다.
 *  ⛔ `src/a/index.ts` 와 `src/b/index.ts` 는 접미가 아니다 ⇒ «다르다»(파일명만으로 묶으면
 *  이 저장소의 `index.ts` 들이 전부 겹침으로 뜬다 — 그래서 파일명 비교를 쓰지 않는다). */
function samePathCandidate(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = a.split('/').filter((c) => c && c !== '.' && c !== '...');
  const pb = b.split('/').filter((c) => c && c !== '.' && c !== '...');
  const [short, long] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  if (!short.length) return false;
  return short.every((c, i) => long[long.length - short.length + i] === c);
}

/** 조각별 비어 있지 않은 `hotPaths`를 우선 읽고, 없으면 골 문면에서 경로를 뽑는다.
 *  ⛔ 같은 조각이 한 파일을 여러 번 말한 것은 겹침이 아니다. */
export function overlapOf(sample: Pick<Sample, 'pieces'>): Overlap {
  const mentions: { path: string; piece: string }[] = [];
  let hotPathPieceCount = 0;
  let proseFallbackPieceCount = 0;
  for (const p of sample.pieces) {
    const piece = p.id ?? '(무명)';
    const paths = p.hotPaths?.filter((path): path is string => typeof path === 'string' && path.length > 0);
    if (paths?.length) {
      hotPathPieceCount += 1;
      for (const path of paths) mentions.push({ path, piece });
    } else {
      proseFallbackPieceCount += 1;
      for (const m of (p.feature ?? '').matchAll(PATH_RE)) mentions.push({ path: m[0], piece });
    }
  }
  // 접미 관계로 묶는다. 대표는 «가장 긴» 표기(사람이 읽을 때 정보가 많다).
  const groups: { rep: string; paths: Set<string>; owners: Set<string> }[] = [];
  for (const { path, piece } of mentions) {
    const hit = groups.find((g) => [...g.paths].some((q) => samePathCandidate(q, path)));
    if (hit) {
      hit.paths.add(path);
      hit.owners.add(piece);
      if (path.length > hit.rep.length) hit.rep = path;
    } else {
      groups.push({ rep: path, paths: new Set([path]), owners: new Set([piece]) });
    }
  }
  const shared = groups
    .filter((g) => g.owners.size > 1)
    .map((g) => ({ file: g.rep, pieces: [...g.owners].sort() }))
    .sort((a, b) => b.pieces.length - a.pieces.length || a.file.localeCompare(b.file));
  return { fileCount: groups.length, hotPathPieceCount, proseFallbackPieceCount, shared };
}

export function proseFallbackWarning(proseFallbackPieceCount: number): string | undefined {
  return proseFallbackPieceCount > 0
    ? '⚠️ 산문 폴백 경로는 미탐(다르게 쓴 경로)·과탐(참고용 언급)이 있다.'
    : undefined;
}

function readLedger(limit: number): { samples: Sample[]; truncated: boolean } {
  const res = spawnSync('bun', [
    'bin/monad.mjs', 'logs', '--all', '--include-test',
    '--event', 'decomposition-shadow-goals', '--limit', String(limit), '--json',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    process.stderr.write(`⛔ 원장 조회 실패 rc=${res.status}\n${res.stderr ?? ''}\n`);
    process.exit(2);
  }
  const samples: Sample[] = [];
  let truncated = false;
  for (const line of (res.stdout ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let rec: Record<string, unknown>;
    try { rec = JSON.parse(t) as Record<string, unknown>; } catch { continue; }
    // ⛔ `_meta` 행을 «그냥 버리지 않는다» — 절단 경고가 거기 실린다.
    const meta = rec['_meta'] as { type?: string; limitReached?: boolean } | undefined;
    if (meta) {
      if (meta.type === 'log-query-limit' && meta.limitReached === true) truncated = true;
      continue;
    }
    const raw = rec['data'];
    let data: Record<string, unknown>;
    try { data = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as Record<string, unknown>; } catch { continue; }
    const pieces = data['pieces'];
    if (!Array.isArray(pieces) || pieces.length < 2) continue;
    samples.push({
      ts: String(rec['ts'] ?? ''),
      goalId: String(data['goalId'] ?? ''),
      runId: String(data['runId'] ?? ''),
      ...(typeof data['round'] === 'number' ? { round: data['round'] } : {}),
      pieces: pieces as Piece[],
    });
  }
  return { samples, truncated };
}

function main(): void {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const goalArg = argv.includes('--goal') ? argv[argv.indexOf('--goal') + 1] : undefined;
  const limitRaw = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 200;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200;

  const { samples, truncated } = readLedger(limit);
  if (truncated) {
    process.stderr.write('⚠️ 원장 조회가 상한에 닿았다 — 이 표본은 «전수가 아니다». --limit 을 올려 다시 재라.\n');
  }
  const scoped = goalArg ? samples.filter((s) => s.goalId === goalArg) : samples;
  const results = scoped.map((sample) => ({ ...sample, ...overlapOf(sample) }));
  const positive = results.filter((r) => r.shared.length > 0);

  if (wantJson) {
    process.stdout.write(`${JSON.stringify({
      samples: results.length,
      withOverlap: positive.length,
      ledgerTruncated: truncated,
      hotPathPieceCount: results.reduce((count, result) => count + result.hotPathPieceCount, 0),
      proseFallbackPieceCount: results.reduce((count, result) => count + result.proseFallbackPieceCount, 0),
      results: results.map((r) => ({
        ts: r.ts, goalId: r.goalId, runId: r.runId, round: r.round,
        pieceCount: r.pieces.length, fileCount: r.fileCount,
        hotPathPieceCount: r.hotPathPieceCount, proseFallbackPieceCount: r.proseFallbackPieceCount,
        shared: r.shared,
      })),
    }, null, 2)}\n`);
    process.exit(positive.length ? 1 : 0);
  }

  if (!results.length) {
    process.stdout.write('조각 ≥2 인 분해 표본이 «0건»이다.\n');
    process.stdout.write('⛔ 「겹침 없음」이 아니라 「잴 대상이 없음」이다 — --limit 을 올리거나 --goal 을 확인하라.\n');
    process.exit(0);
  }

  const hotPathPieceCount = results.reduce((count, result) => count + result.hotPathPieceCount, 0);
  const proseFallbackPieceCount = results.reduce((count, result) => count + result.proseFallbackPieceCount, 0);
  process.stdout.write(`분해 표본(조각 ≥2) ${results.length}건 · 겹침 있는 것 ${positive.length}건 · 값 경로 조각 ${hotPathPieceCount} · 산문 폴백 조각 ${proseFallbackPieceCount}건\n\n`);
  for (const r of [...results].sort((a, b) => b.ts.localeCompare(a.ts))) {
    process.stdout.write(`${r.shared.length ? '🔴' : '🟢'} ${r.ts} goal=${r.goalId} 조각=${r.pieces.length} 파일=${r.fileCount} 겹침=${r.shared.length} 값=${r.hotPathPieceCount} 산문=${r.proseFallbackPieceCount}\n`);
    for (const s of r.shared) process.stdout.write(`      ${s.file} ← ${s.pieces.join(' · ')}\n`);
    const warning = proseFallbackWarning(r.proseFallbackPieceCount);
    if (warning) process.stdout.write(`      ${warning}\n`);
  }
  process.stdout.write('\n   ⇒ ⛔ 「0」을 「겹침 없음」으로 읽지 마라. 「1 이상」일 때만 강한 신호다.\n');
  process.exit(positive.length ? 1 : 0);
}

if (import.meta.main) main();
