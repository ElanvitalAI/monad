// Attachment-row metadata map — tracks which chatLines indices render
// attachment-summary rows so the log-pane mouse handler can open the
// attachment popup on click.

import { describe, expect, test } from 'bun:test';
import { createAttachmentRowMap } from '../src/log-pane/attachment-row-map.js';

describe('createAttachmentRowMap', () => {
  test('empty map returns null for any index', () => {
    const m = createAttachmentRowMap();
    expect(m.size()).toBe(0);
    expect(m.lookup(0)).toBeNull();
    expect(m.lookup(42)).toBeNull();
  });

  test('track + lookup round-trips', () => {
    const m = createAttachmentRowMap();
    m.track(10, 3);
    m.track(15, 7);
    expect(m.lookup(10)).toBe(3);
    expect(m.lookup(15)).toBe(7);
    expect(m.lookup(11)).toBeNull();
    expect(m.size()).toBe(2);
  });

  test('track overwrites existing entry for same lineIdx', () => {
    const m = createAttachmentRowMap();
    m.track(5, 1);
    m.track(5, 2);
    expect(m.lookup(5)).toBe(2);
    expect(m.size()).toBe(1);
  });

  test('clear wipes everything', () => {
    const m = createAttachmentRowMap();
    m.track(1, 10);
    m.track(2, 20);
    m.track(3, 30);
    m.clear();
    expect(m.size()).toBe(0);
    expect(m.lookup(1)).toBeNull();
    expect(m.lookup(2)).toBeNull();
  });

  test('forgetById removes every line pointing at that attachment', () => {
    // Same attachment can appear in multiple log rows (e.g.
    // "[Md #3] first paste" + later "[Md #3] (already attached)").
    const m = createAttachmentRowMap();
    m.track(10, 3);
    m.track(12, 7);
    m.track(20, 3);  // re-reference of attachment 3
    m.track(25, 3);
    expect(m.forgetById(3)).toBe(3);
    expect(m.size()).toBe(1);
    expect(m.lookup(12)).toBe(7);
    expect(m.lookup(10)).toBeNull();
    expect(m.lookup(20)).toBeNull();
  });

  test('forgetById returns 0 when nothing matches', () => {
    const m = createAttachmentRowMap();
    m.track(1, 5);
    expect(m.forgetById(999)).toBe(0);
    expect(m.size()).toBe(1);
  });
});
