import { Glob } from 'bun';

export const PROMISED_FORMS = [
  '하니스로 개발',
  '하니스:',
  '하니스로 구현해줘',
  '하니스 구현',
  'harness',
  'self dev',
] as const;

export const SAFE_PHRASE_FORMS = [
  '하니스:',
  '하니스 구현',
  'develop with the harness',
  'implement with the harness',
  'submit a goal with the harness',
  'use the harness',
  'self dev',
] as const;

const ENGLISH_SAFE_PHRASE_FORMS = SAFE_PHRASE_FORMS.filter((term) => term.includes('harness'));
const ENGLISH_SAFE_PHRASE_SET = new Set<string>(ENGLISH_SAFE_PHRASE_FORMS);
const HARNESS_WORD = /\bharness\b/gi;

type MatchRange = { start: number; end: number };

function englishPhraseMatcher(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
}

function englishPhraseRanges(record: string, phrase: string): MatchRange[] {
  return [...record.matchAll(englishPhraseMatcher(phrase))]
    .map((match) => ({ start: match.index!, end: match.index! + match[0].length }));
}

export type UsageMeasurement = {
  records: number;
  promised: Record<(typeof PROMISED_FORMS)[number], number>;
  safePhrases: Record<(typeof SAFE_PHRASE_FORMS)[number], number>;
  standaloneHarness: number;
  safeEnglishPhraseFiles: number;
  safeEnglishAndStandaloneHarnessFiles: number;
};

function hasHarnessWord(record: string): boolean {
  return new RegExp(HARNESS_WORD.source, HARNESS_WORD.flags).test(record);
}

function countRecords(records: readonly string[], term: string): number {
  return records.filter((record) => term === 'harness'
    ? hasHarnessWord(record)
    : ENGLISH_SAFE_PHRASE_SET.has(term)
      ? englishPhraseRanges(record, term).length > 0
      : record.toLocaleLowerCase().includes(term.toLocaleLowerCase())).length;
}

function safeEnglishPhraseRanges(record: string): MatchRange[] {
  return ENGLISH_SAFE_PHRASE_FORMS.flatMap((phrase) => englishPhraseRanges(record, phrase));
}

function hasStandaloneHarnessOutsideSafePhrase(record: string): boolean {
  const safeRanges = safeEnglishPhraseRanges(record);
  return [...record.matchAll(new RegExp(HARNESS_WORD.source, HARNESS_WORD.flags))]
    .some((match) => !safeRanges.some((range) => match.index! >= range.start && match.index! + match[0].length <= range.end));
}

/** Counts ASK records, not raw occurrences: one request contributes at most one hit per form. */
export function measureDevHarnessUsage(records: readonly string[]): UsageMeasurement {
  const safeEnglishPhraseFiles = records.filter((record) => safeEnglishPhraseRanges(record).length > 0);
  const standaloneHarnessFiles = records.filter(hasStandaloneHarnessOutsideSafePhrase);
  return {
    records: records.length,
    promised: Object.fromEntries(PROMISED_FORMS.map((term) => [term, countRecords(records, term)])) as UsageMeasurement['promised'],
    safePhrases: Object.fromEntries(SAFE_PHRASE_FORMS.map((term) => [term, countRecords(records, term)])) as UsageMeasurement['safePhrases'],
    standaloneHarness: standaloneHarnessFiles.length,
    safeEnglishPhraseFiles: safeEnglishPhraseFiles.length,
    safeEnglishAndStandaloneHarnessFiles: safeEnglishPhraseFiles.filter(hasStandaloneHarnessOutsideSafePhrase).length,
  };
}

async function askRecordContents(): Promise<string[]> {
  const files = [...new Glob('docs/goals/ASK-*').scanSync()].sort();
  return await Promise.all(files.map((file) => Bun.file(file).text()));
}

if (import.meta.main) {
  console.log(JSON.stringify(measureDevHarnessUsage(await askRecordContents()), null, 2));
}
