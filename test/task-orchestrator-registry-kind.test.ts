import { describe, expect, test } from 'bun:test';
import {
  parseElementAddress,
  formatElementAddress,
  ensureQualified,
  isQualifiedAddress,
} from '../src/element-registry/address.js';
import {
  KIND_PREFIX,
  ADDR_PREFIX_TO_KIND,
  type ElementKind,
} from '../src/element-registry/types.js';
import { newTaskId, isTaskId } from '../src/task-orchestrator/types.js';

describe('element-registry — task kind integration', () => {
  test('task prefix registered in KIND_PREFIX', () => {
    expect(KIND_PREFIX.task).toBe('task');
  });

  test('reverse lookup resolves task prefix', () => {
    expect(ADDR_PREFIX_TO_KIND.task).toBe('task');
  });

  test('parseElementAddress recognises task:<hex>', () => {
    const parsed = parseElementAddress('task:abc123');
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('task');
    expect(parsed?.id).toBe('abc123');
  });

  test('formatElementAddress for task kind', () => {
    expect(formatElementAddress('task', 'deadbe')).toBe('task:deadbe');
  });

  test('parse accepts @task:<hex> form', () => {
    const parsed = parseElementAddress('@task:aabbcc');
    expect(parsed?.kind).toBe('task');
    expect(parsed?.id).toBe('aabbcc');
  });

  test('isQualifiedAddress narrows to task kind', () => {
    expect(isQualifiedAddress('task:aabb', 'task')).toBe(true);
    expect(isQualifiedAddress('pane:aabb', 'task')).toBe(false);
    expect(isQualifiedAddress('not-an-address', 'task')).toBe(false);
  });

  test('ensureQualified wraps bare id with task:', () => {
    expect(ensureQualified('task', 'aabb')).toBe('task:aabb');
    // idempotent on already-qualified
    expect(ensureQualified('task', 'task:aabb')).toBe('task:aabb');
  });

  test('all 9 kinds have unique prefixes', () => {
    const prefixes = Object.values(KIND_PREFIX);
    const unique = new Set(prefixes);
    expect(unique.size).toBe(prefixes.length);
    expect(prefixes.length).toBe(9);
  });

  test('newTaskId produces element-registry-parseable address', () => {
    const id = newTaskId();
    expect(isTaskId(id)).toBe(true);
    const parsed = parseElementAddress(id);
    expect(parsed?.kind).toBe('task');
  });

  test('ADDR_PREFIX_TO_KIND is inverse of KIND_PREFIX', () => {
    for (const [kind, prefix] of Object.entries(KIND_PREFIX) as Array<[ElementKind, string]>) {
      expect(ADDR_PREFIX_TO_KIND[prefix]).toBe(kind);
    }
  });
});
