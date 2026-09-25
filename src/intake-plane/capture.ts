import { buildIntakeDraftFromRaw } from './draft.js';
import type { IntakeStore } from './store.js';
import type { IntakeSession, RawIntakeRecord } from './types.js';

export function captureAndDraftIntakeRecord(
  store: IntakeStore,
  raw: RawIntakeRecord,
  opts: { normalizedDetailSource?: string } = {},
): IntakeSession {
  store.capture(raw);
  store.setState(raw.intakeId, 'normalized', {
    source: opts.normalizedDetailSource ?? `intake:${raw.source}`,
  });
  const draft = buildIntakeDraftFromRaw(raw);
  return store.saveDraft(raw.intakeId, draft);
}
