import {
  isInputSourceKind,
  type InputSourceRef,
} from '../input/input-source-kind.js';

export const INPUT_SOURCE_META_KEY = 'input_source';

export function writeInputSourceMeta(
  source: InputSourceRef,
): Record<string, unknown> {
  return {
    [INPUT_SOURCE_META_KEY]: source,
  };
}

export function readInputSourceMeta(
  meta: Record<string, unknown> | null | undefined,
): InputSourceRef | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta[INPUT_SOURCE_META_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  if (!isInputSourceKind(source['kind'])) return null;
  return source as InputSourceRef;
}
