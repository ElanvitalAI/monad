// ── PFC-S3.6: Root Cause Analysis trio ──
//
// Three complementary diagnostic methods:
//   - 5-Why chain      (iterative "why?" → root cause)
//   - Ishikawa fishbone (6M category tree)
//   - Pareto (80/20)   (frequency-ranked contribution)
//
// All three are pure / deterministic — no LLM inside. The parent LLM
// generates the *content* (whys, causes, items); these helpers only
// structure + validate + summarize.

// ============================================================================
// 5-Why
// ============================================================================

export interface WhyChain {
  problem: string;
  chain: string[];           // ordered whys, shallowest → deepest
  depth: number;
  rootCause: string;         // deepest why
  notices?: string[];
}

/** Validate and package a 5-Why chain. Accepts 3..8 (DD-RCA-WHYS);
 *  warns if depth < 5 (Toyota canonical depth). */
export function buildWhyChain(problem: string, whys: readonly string[]): WhyChain {
  if (!problem || !problem.trim()) {
    throw new Error('buildWhyChain: problem is required');
  }
  if (!Array.isArray(whys) || whys.length < 3) {
    throw new Error(`buildWhyChain: at least 3 whys required (got ${whys?.length ?? 0})`);
  }
  if (whys.length > 8) {
    throw new Error(`buildWhyChain: at most 8 whys supported (got ${whys.length})`);
  }
  const cleaned = whys.map((w) => w.trim()).filter((w) => w.length > 0);
  if (cleaned.length !== whys.length) {
    throw new Error('buildWhyChain: empty why entries not allowed');
  }
  const notices: string[] = [];
  if (cleaned.length < 5) {
    notices.push(`5-Why canonical depth is 5; only ${cleaned.length} whys provided.`);
  }
  return {
    problem,
    chain: cleaned,
    depth: cleaned.length,
    rootCause: cleaned[cleaned.length - 1],
    ...(notices.length > 0 ? { notices } : {}),
  };
}

/** Render the chain as a stacked "Why?: …" list. */
export function renderWhyChain(chain: WhyChain): string {
  const lines: string[] = [];
  lines.push(`Problem: ${chain.problem}`);
  chain.chain.forEach((w, i) => {
    lines.push(`  Why${i + 1}? ${w}`);
  });
  lines.push(`→ Root cause: ${chain.rootCause}`);
  return lines.join('\n');
}

// ============================================================================
// Ishikawa (Fishbone) — 6M categories
// ============================================================================

export const FISHBONE_CATEGORIES = [
  'manpower',        // 人 — people, training, communication
  'machine',         // 機械 — equipment, tools, infra
  'material',        // 材料 — inputs, data, dependencies
  'method',          // 方法 — process, procedure, design
  'measurement',     // 測定 — metrics, logging, tests
  'environment',     // 環境 — ops, culture, constraints
] as const;

export type FishboneCategory = (typeof FISHBONE_CATEGORIES)[number];

export type FishboneCategories = Record<FishboneCategory, readonly string[]>;

export interface FishboneReport {
  problem: string;
  categories: FishboneCategories;
  totalCauses: number;
  emptyCategories: FishboneCategory[];
  dominantCategory: FishboneCategory | null;   // most-populated
  notices?: string[];
}

const DEFAULT_EMPTY: FishboneCategories = {
  manpower: [],
  machine: [],
  material: [],
  method: [],
  measurement: [],
  environment: [],
};

export function buildFishbone(
  problem: string,
  categories: Partial<FishboneCategories>,
): FishboneReport {
  if (!problem || !problem.trim()) {
    throw new Error('buildFishbone: problem is required');
  }
  const merged: FishboneCategories = { ...DEFAULT_EMPTY };
  for (const cat of FISHBONE_CATEGORIES) {
    const causes = categories[cat];
    if (causes) {
      const cleaned = causes.map((c) => c.trim()).filter((c) => c.length > 0);
      (merged as any)[cat] = cleaned;
    }
  }
  const totalCauses = FISHBONE_CATEGORIES.reduce(
    (sum, cat) => sum + merged[cat].length,
    0,
  );
  if (totalCauses === 0) {
    throw new Error('buildFishbone: at least one cause across all categories required');
  }
  const emptyCategories = FISHBONE_CATEGORIES.filter((c) => merged[c].length === 0);
  let dominantCategory: FishboneCategory | null = null;
  let maxCount = 0;
  for (const cat of FISHBONE_CATEGORIES) {
    if (merged[cat].length > maxCount) {
      maxCount = merged[cat].length;
      dominantCategory = cat;
    }
  }
  const notices: string[] = [];
  if (emptyCategories.length >= 3) {
    notices.push(
      `${emptyCategories.length} categories empty (${emptyCategories.join(', ')}) — consider `
      + 'deeper inspection: fishbone 의 힘은 6M 전부 질문하는 것에 있음.',
    );
  }
  return {
    problem,
    categories: merged,
    totalCauses,
    emptyCategories,
    dominantCategory,
    ...(notices.length > 0 ? { notices } : {}),
  };
}

export function renderFishbone(report: FishboneReport): string {
  const lines: string[] = [];
  lines.push(`Fishbone [${report.problem}] ${report.totalCauses} causes`);
  if (report.dominantCategory) {
    lines.push(`  dominant: ${report.dominantCategory} (${report.categories[report.dominantCategory].length} causes)`);
  }
  for (const cat of FISHBONE_CATEGORIES) {
    const causes = report.categories[cat];
    if (causes.length === 0) continue;
    lines.push(`  ${cat}:`);
    causes.forEach((c) => lines.push(`    - ${c}`));
  }
  if (report.emptyCategories.length > 0) {
    lines.push(`  (empty: ${report.emptyCategories.join(', ')})`);
  }
  return lines.join('\n');
}

// ============================================================================
// Pareto (80/20)
// ============================================================================

export interface ParetoItem {
  label: string;
  count: number;
}

export interface ParetoRankedItem {
  label: string;
  count: number;
  pct: number;          // share of total (0..1)
  cumPct: number;       // cumulative share (0..1)
  inTop: boolean;       // true if this item falls in the top-%threshold band
}

export interface ParetoReport {
  title: string;
  threshold: number;
  total: number;
  ranked: ParetoRankedItem[];
  topN: number;                // count of items inside top band
  tailN: number;               // count of items outside
  topShare: number;            // actual cumPct of the top band (≥ threshold)
}

/** Sort by count desc, accumulate %, mark items up to threshold as topN. */
export function computePareto(
  title: string,
  items: readonly ParetoItem[],
  threshold = 0.8,
): ParetoReport {
  if (!title || !title.trim()) {
    throw new Error('computePareto: title is required');
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('computePareto: items must be non-empty');
  }
  if (threshold <= 0 || threshold >= 1) {
    throw new RangeError(`computePareto: threshold must be in (0, 1), got ${threshold}`);
  }
  for (const item of items) {
    if (!item.label || !item.label.trim()) {
      throw new Error('computePareto: item label required');
    }
    if (typeof item.count !== 'number' || !Number.isFinite(item.count) || item.count < 0) {
      throw new Error(`computePareto: item count must be non-negative finite, got ${item.count} for '${item.label}'`);
    }
  }
  const total = items.reduce((sum, i) => sum + i.count, 0);
  if (total <= 0) {
    throw new Error('computePareto: total count must be > 0');
  }
  const sorted = [...items].sort((a, b) => b.count - a.count);
  let cum = 0;
  let topReached = false;
  let topN = 0;
  let topShare = 0;
  const ranked: ParetoRankedItem[] = sorted.map((i) => {
    const pct = i.count / total;
    cum += pct;
    const inTop = !topReached;
    if (inTop) {
      topN += 1;
      topShare = cum;
      if (cum >= threshold) topReached = true;
    }
    return { label: i.label, count: i.count, pct, cumPct: cum, inTop };
  });
  return {
    title,
    threshold,
    total,
    ranked,
    topN,
    tailN: ranked.length - topN,
    topShare,
  };
}

export function renderPareto(report: ParetoReport): string {
  const lines: string[] = [];
  lines.push(
    `Pareto [${report.title}] total=${report.total} · top ${report.topN}/${report.ranked.length} items = `
    + `${(report.topShare * 100).toFixed(1)}% (threshold ${(report.threshold * 100).toFixed(0)}%)`,
  );
  lines.push('');
  lines.push('  rank | count | pct    | cum    | top? | label');
  lines.push('  -----+-------+--------+--------+------+---------------------------');
  report.ranked.forEach((item, i) => {
    const rank = String(i + 1).padStart(4, ' ');
    const count = String(item.count).padStart(5, ' ');
    const pct = (item.pct * 100).toFixed(1).padStart(5, ' ');
    const cum = (item.cumPct * 100).toFixed(1).padStart(5, ' ');
    const mark = item.inTop ? ' YES ' : '  -  ';
    lines.push(`  ${rank} | ${count} | ${pct}% | ${cum}% |${mark}| ${item.label}`);
  });
  return lines.join('\n');
}
