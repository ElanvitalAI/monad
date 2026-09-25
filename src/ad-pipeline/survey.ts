import { dispatchOmniSearch, type OmniSearchResult } from '../skills/tools/omni-search.js';

export interface SurveyRequest {
  readonly category?: string;
  readonly brand?: string;
  readonly competitors?: readonly string[];
  readonly season?: string;
}

export interface SurveyEvidence {
  readonly source: string;
  readonly detail: string;
}

export interface SurveyCandidate {
  /** Stable identifier presented to the human and required for concept selection. */
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly evidence: readonly SurveyEvidence[];
}

export interface OmniCrawlSurveyCollector {
  collect(request: SurveyRequest): readonly SurveyCandidate[] | Promise<readonly SurveyCandidate[]>;
}

export interface SurveyResult {
  readonly request: SurveyRequest;
  readonly candidates: readonly SurveyCandidate[];
}

export type OmniSearchDispatcher = (args: Record<string, unknown>) => Promise<OmniSearchResult>;

export function createOmniCrawlSurveyCollector(dispatch: OmniSearchDispatcher = dispatchOmniSearch): OmniCrawlSurveyCollector {
  return {
    async collect(request) {
      const query = [request.category, request.brand, ...(request.competitors ?? []), request.season]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ');
      if (!query) throw new Error('Survey collection requires at least one non-empty category, brand, competitor, or season input.');
      const result = await dispatch({ query, limit: 5, merge: 'interleave' });
      return parseOmniSearchCandidates(result.output);
    },
  };
}

function parseOmniSearchCandidates(output: string): SurveyCandidate[] {
  const candidates: SurveyCandidate[] = [];
  const matches = output.matchAll(/- \[([^\]]+)\]\(([^)]+)\)(?:\n\s+([^\n]+))?/g);
  for (const match of matches) {
    const label = match[1].trim();
    const source = match[2].trim();
    const detail = match[3] === undefined
      ? label
      : match[3].replace(/^(?:out of stock|in stock)[\s\p{P}]*/iu, '').trim();
    if (label && !/^https?:\/\//i.test(label) && source && detail) candidates.push({ id: source, label, reason: detail, evidence: [{ source, detail }] });
  }
  return candidates;
}

export async function surveyMarket(request: SurveyRequest, collector: OmniCrawlSurveyCollector): Promise<SurveyResult> {
  const candidates = (await collector.collect(request)).map((candidate) => {
    if (!candidate.id.trim() || !candidate.label.trim() || !candidate.reason.trim() || candidate.evidence.length === 0 || candidate.evidence.some((evidence) => !evidence.source.trim() || !evidence.detail.trim())) {
      throw new Error('Survey candidates require an id, label, reason, and non-empty source evidence.');
    }
    return {
      id: candidate.id.trim(),
      label: candidate.label,
      reason: candidate.reason,
      evidence: candidate.evidence.map((evidence) => ({ source: evidence.source, detail: evidence.detail })),
    };
  });
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) {
    throw new Error('Survey candidates require unique ids for unambiguous human selection.');
  }
  if (candidates.length === 0) throw new Error('Survey collection returned no evidence-backed candidates.');
  return { request, candidates };
}
