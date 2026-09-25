import { createHash } from 'node:crypto';

export const REVIEW_FINDING_KEY_VERSION = 'reviewFindingKey-v1';
export const MAX_CITED_REVIEW_SYMBOL_CHARS = 256;
const CITED_REVIEW_SYMBOL_HASH_CHARS = 16;

export interface CitedReviewSymbol {
  hash: string;
  symbol: string;
}

export interface ReviewFindingKeyOverlap {
  comparable: boolean;
  sharedSymbolCount: number;
  leftSymbolCount: number;
  rightSymbolCount: number;
  /** Shared comparison identities divided by the smaller normalized symbol set; undefined when either finding has no citations. */
  overlapRatio: number | undefined;
}

interface ReviewFindingKey {
  key: string;
  source: 'symbol' | 'prose';
}

export function normalizeReviewFindingKey(finding: string): string {
  return finding
    .toLowerCase()
    .replace(/`[^`]*`/g, '')
    .replace(/\d/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCitedReviewSymbolForComparison(symbol: string): string {
  const comparisonSymbol = symbol.replace(/\.id$/, 'Id');
  return createHash('sha256').update(comparisonSymbol).digest('hex').slice(0, CITED_REVIEW_SYMBOL_HASH_CHARS);
}

function fullCitedReviewSymbols(finding: string): string[] {
  const symbols = new Map<string, string>();
  for (const match of finding.matchAll(/`([^`]*)`/g)) {
    const symbol = match[1]!.trim();
    if (!symbol) continue;
    const hash = createHash('sha256').update(symbol).digest('hex').slice(0, CITED_REVIEW_SYMBOL_HASH_CHARS);
    symbols.set(hash, symbol);
  }
  return [...symbols.values()];
}

export function citedReviewSymbols(finding: string): CitedReviewSymbol[] {
  return fullCitedReviewSymbols(finding).map((symbol) => ({
    hash: createHash('sha256').update(symbol).digest('hex').slice(0, CITED_REVIEW_SYMBOL_HASH_CHARS),
    symbol: symbol.slice(0, MAX_CITED_REVIEW_SYMBOL_CHARS),
  }));
}

export function measureReviewFindingKeyOverlap(leftFinding: string, rightFinding: string): ReviewFindingKeyOverlap {
  const leftSymbols = fullCitedReviewSymbols(leftFinding);
  const rightSymbols = fullCitedReviewSymbols(rightFinding);
  if (leftSymbols.length === 0 || rightSymbols.length === 0) {
    return {
      comparable: false,
      sharedSymbolCount: 0,
      leftSymbolCount: leftSymbols.length,
      rightSymbolCount: rightSymbols.length,
      overlapRatio: undefined,
    };
  }

  const leftComparisonHashes = new Set(leftSymbols.map(normalizeCitedReviewSymbolForComparison));
  const rightComparisonHashes = new Set(rightSymbols.map(normalizeCitedReviewSymbolForComparison));
  const sharedSymbolCount = [...leftComparisonHashes].filter((hash) => rightComparisonHashes.has(hash)).length;
  return {
    comparable: true,
    sharedSymbolCount,
    leftSymbolCount: leftSymbols.length,
    rightSymbolCount: rightSymbols.length,
    overlapRatio: sharedSymbolCount / Math.min(leftComparisonHashes.size, rightComparisonHashes.size),
  };
}

export function reviewFindingKey(finding: string): ReviewFindingKey {
  const symbols = citedReviewSymbols(finding);
  if (symbols.length > 0) {
    const symbolSet = [...new Set(symbols.map(({ symbol }) => symbol.trim()))].sort();
    return { key: `symbol:${JSON.stringify(symbolSet)}`, source: 'symbol' };
  }
  return { key: normalizeReviewFindingKey(finding), source: 'prose' };
}

export function shortNormalizedReviewFindingHash(normalizedFinding: string): string {
  return createHash('sha256').update(normalizedFinding).digest('hex').slice(0, 8);
}
