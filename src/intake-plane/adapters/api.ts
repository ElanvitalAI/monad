import { createTextChannelIntakeRecord, type TextChannelIntakeInput } from './text.js';
import type { RawIntakeRecord } from '../types.js';

export interface ApiIntakeInput extends Omit<TextChannelIntakeInput, 'source'> {
  source?: 'api';
}

export function createApiIntakeRecord(input: ApiIntakeInput): RawIntakeRecord {
  return createTextChannelIntakeRecord({
    ...input,
    source: input.source ?? 'api',
  });
}
