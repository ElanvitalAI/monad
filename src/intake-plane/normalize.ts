import type { RawIntakeRecord } from './types.js';

export interface IntakeNormalizedChunk {
  text: string;
  links: string[];
}

export interface IntakeNormalizedRecord {
  intakeId: string;
  source: RawIntakeRecord['source'];
  rawText: string;
  chunks: IntakeNormalizedChunk[];
}

const SEPARATOR_RE = /^[-=*_]{3,}$/;
const BULLET_RE = /^\s*(?:[-*+]|•|\d+[.)])\s+/;
const URL_RE = /https?:\/\/[^\s)]+/g;

function cleanLine(line: string): string {
  return line.trimEnd();
}

function normalizeBulletText(text: string): string {
  return text.replace(BULLET_RE, '').trim();
}

export function extractLinks(text: string): string[] {
  return Array.from(new Set(text.match(URL_RE) ?? []));
}

export function normalizeIntakeText(rawText: string): IntakeNormalizedChunk[] {
  const lines = rawText
    .split('\n')
    .map(cleanLine)
    .filter((line) => !SEPARATOR_RE.test(line.trim()));

  const chunks: string[] = [];
  let current: string[] = [];

  function flush(): void {
    const text = current.join(' ').trim();
    if (text) chunks.push(text);
    current = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const isBullet = BULLET_RE.test(trimmed);
    if (isBullet && current.length > 0) flush();
    const normalized = isBullet ? normalizeBulletText(trimmed) : trimmed;
    if (normalized) current.push(normalized);
  }
  flush();

  return chunks.map((text) => ({
    text,
    links: extractLinks(text),
  }));
}

export function normalizeIntakeRecord(record: RawIntakeRecord): IntakeNormalizedRecord {
  return {
    intakeId: record.intakeId,
    source: record.source,
    rawText: record.rawText,
    chunks: normalizeIntakeText(record.rawText),
  };
}
