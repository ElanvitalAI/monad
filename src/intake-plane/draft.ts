import { normalizeIntakeRecord } from './normalize.js';
import type {
  ClarifyQuestion,
  IntakeDraft,
  IntakeItemDraft,
  IntakeItemKind,
  RawIntakeRecord,
} from './types.js';

function classifyChunk(text: string): IntakeItemKind {
  const lower = text.toLowerCase();
  if (
    lower.includes('bug')
    || lower.includes('fix')
    || lower.includes('error')
    || lower.includes('why')
    || text.includes('안되는')
    || text.includes('이유')
  ) return 'bug';
  if (
    lower.includes('compare')
    || lower.includes('comparison')
    || text.includes('비교')
  ) return 'comparison';
  if (
    lower.includes('absorb')
    || lower.includes('merge capability')
    || text.includes('능력 흡수')
    || text.includes('흡수')
  ) return 'capability-absorb';
  if (
    lower.includes('implement')
    || lower.includes('build')
    || lower.includes('add ')
    || text.includes('구현')
    || text.includes('추가')
    || text.includes('강화')
  ) return 'implementation';
  if (
    lower.includes('polish')
    || lower.includes('cleanup')
    || text.includes('정리')
    || text.includes('polish')
  ) return 'polish';
  if (
    lower.includes('check')
    || lower.includes('investigate')
    || lower.includes('inspect')
    || lower.includes('confirm')
    || text.includes('확인')
    || text.includes('파악')
    || text.includes('조사')
    || text.includes('확인 필요')
  ) return 'research';
  return 'unknown';
}

function suggestedModeForKinds(kinds: Set<IntakeItemKind>): IntakeDraft['suggestedMode'] {
  if (kinds.size === 0) return 'backlog-capture';
  if (kinds.size === 1 && !kinds.has('unknown')) return 'task-creation';
  return 'mixed';
}

function buildTitle(items: IntakeItemDraft[]): string {
  if (items.length === 0) return 'Scratch intake';
  const first = items[0]!.text.replace(/\s+/g, ' ').trim();
  return first.length <= 48 ? first : `${first.slice(0, 45)}...`;
}

function buildQuestions(items: IntakeItemDraft[]): ClarifyQuestion[] {
  if (items.length === 0) {
    return [{
      id: 'q-empty',
      scope: 'bundle',
      question: 'No actionable items were found. Keep this as backlog only?',
      reason: 'chunking produced zero candidate items',
    }];
  }
  const unknowns = items.filter((item) => item.kind === 'unknown');
  if (unknowns.length === items.length) {
    return [{
      id: 'q-unknown',
      scope: 'bundle',
      question: 'This note is still ambiguous. Should it stay as backlog capture for now?',
      reason: 'all candidate items classified as unknown',
    }];
  }
  return [];
}

export function buildIntakeDraftFromRaw(record: RawIntakeRecord): IntakeDraft {
  const normalized = normalizeIntakeRecord(record);
  const items: IntakeItemDraft[] = normalized.chunks.map((chunk, index) => {
    const kind = classifyChunk(chunk.text);
    return {
      id: `item-${index + 1}`,
      kind,
      text: chunk.text,
      links: [...chunk.links],
      needsClarification: kind === 'unknown',
      proposedAction: kind === 'unknown' ? 'ask-user' : 'task-create',
    };
  });
  const kinds = new Set(items.map((item) => item.kind));
  const openQuestions = buildQuestions(items);
  const confidence = items.length === 0
    ? 0.2
    : Math.max(0.35, Math.min(0.95, 0.95 - (openQuestions.length * 0.25) - (items.filter((i) => i.kind === 'unknown').length * 0.08)));
  return {
    intakeId: record.intakeId,
    title: buildTitle(items),
    summary: items.length === 0
      ? 'No actionable chunks extracted from the current note.'
      : `${items.length} intake item(s) extracted from the current note.`,
    items,
    openQuestions,
    suggestedMode: suggestedModeForKinds(kinds),
    confidence,
  };
}

export function formatIntakeDraftSummary(draft: IntakeDraft): string[] {
  const lines = [
    `Intake draft: ${draft.intakeId}`,
    `  title: ${draft.title}`,
    `  summary: ${draft.summary}`,
    `  mode: ${draft.suggestedMode}  confidence: ${draft.confidence.toFixed(2)}`,
  ];
  if (draft.items.length === 0) {
    lines.push('  items: (none)');
  } else {
    lines.push('  items:');
    for (const item of draft.items) {
      lines.push(`    - [${item.kind}] ${item.text}`);
    }
  }
  if (draft.openQuestions.length > 0) {
    lines.push('  questions:');
    for (const question of draft.openQuestions) {
      lines.push(`    - ${question.question}`);
    }
  }
  return lines;
}
