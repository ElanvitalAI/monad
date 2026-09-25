import { describe, expect, test } from 'bun:test';
import {
  buildConversationPopupWorkspaceMembers,
  createConversationPopupHost,
  projectConversationPopups,
  type ConversationPopupHostEntry,
} from '../src/conv-dash/popup-host.js';

function entry(
  sessionId: string,
  extra: Partial<ConversationPopupHostEntry> = {},
): ConversationPopupHostEntry {
  return {
    sessionId,
    widgetInstanceId: `widget:${sessionId}`,
    title: `Conversation ${sessionId}`,
    state: 'live',
    zIndex: 1,
    ...extra,
  };
}

describe('conversation popup host substrate', () => {
  test('upsert + focus tracks live popup ordering', () => {
    const host = createConversationPopupHost();
    host.upsert({ sessionId: 's1', widgetInstanceId: 'w1', title: 'One' });
    host.upsert({ sessionId: 's2', widgetInstanceId: 'w2', title: 'Two' });
    const snap = host.snapshot();
    expect(snap.focusedSessionId).toBe('s2');
    expect(snap.live.map((candidate) => candidate.sessionId)).toEqual(['s1', 's2']);
  });

  test('minimize and restore move entries between live and minimized buckets', () => {
    const host = createConversationPopupHost();
    host.upsert({ sessionId: 's1', widgetInstanceId: 'w1', title: 'One' });
    host.upsert({ sessionId: 's2', widgetInstanceId: 'w2', title: 'Two' });
    expect(host.minimize('s2')).toBe(true);
    let snap = host.snapshot();
    expect(snap.live.map((candidate) => candidate.sessionId)).toEqual(['s1']);
    expect(snap.minimized.map((candidate) => candidate.sessionId)).toEqual(['s2']);
    expect(host.restore('s2')).toBe(true);
    snap = host.snapshot();
    expect(snap.focusedSessionId).toBe('s2');
    expect(snap.live.map((candidate) => candidate.sessionId)).toEqual(['s1', 's2']);
  });

  test('cycleFocus skips minimized popups', () => {
    const host = createConversationPopupHost();
    host.upsert({ sessionId: 's1', widgetInstanceId: 'w1', title: 'One' });
    host.upsert({ sessionId: 's2', widgetInstanceId: 'w2', title: 'Two' });
    host.upsert({ sessionId: 's3', widgetInstanceId: 'w3', title: 'Three' });
    host.minimize('s2');
    expect(host.cycleFocus()).toBe('s1');
    expect(host.cycleFocus()).toBe('s3');
    expect(host.cycleFocus(-1)).toBe('s1');
  });
});

describe('conversation popup projection', () => {
  test('cascade projection offsets successive popups', () => {
    const frames = projectConversationPopups(
      [entry('s1', { zIndex: 1 }), entry('s2', { zIndex: 2 }), entry('s3', { zIndex: 3 })],
      'cascade',
      120,
      40,
      's3',
    );
    expect(frames).toHaveLength(3);
    expect(frames[1]!.row).toBeGreaterThan(frames[0]!.row);
    expect(frames[1]!.col).toBeGreaterThan(frames[0]!.col);
    expect(frames[2]!.focused).toBe(true);
  });

  test('tile projection splits into a grid', () => {
    const frames = projectConversationPopups(
      [entry('s1'), entry('s2'), entry('s3')],
      'tile',
      120,
      40,
      's2',
    );
    expect(frames).toHaveLength(3);
    expect(frames[0]!.width).toBe(frames[1]!.width);
    expect(frames[2]!.row).toBeGreaterThan(frames[0]!.row);
    expect(frames[1]!.focused).toBe(true);
  });

  test('stack projection fills width and splits height vertically', () => {
    const frames = projectConversationPopups(
      [entry('s1'), entry('s2'), entry('s3')],
      'stack',
      90,
      30,
      's1',
    );
    expect(frames).toHaveLength(3);
    expect(frames[0]!.width).toBe(88);
    expect(frames[1]!.row).toBeGreaterThan(frames[0]!.row);
    expect(frames[0]!.focused).toBe(true);
  });

  test('workspace member projection keeps live and minimized popups restorable', () => {
    const host = createConversationPopupHost();
    host.upsert({ sessionId: 's1', widgetInstanceId: 'w1', modalId: 'conversation-modal:s1', title: 'One' });
    host.upsert({ sessionId: 's2', widgetInstanceId: 'w2', modalId: 'conversation-modal:s2', title: 'Two' });
    host.minimize('s2');

    expect(buildConversationPopupWorkspaceMembers(host.snapshot())).toEqual([
      {
        sessionId: 's1',
        surfaceId: 'conversation-modal:s1',
        label: 'One',
        order: 320,
        minimized: false,
        docked: false,
      },
      {
        sessionId: 's2',
        surfaceId: 'conversation-modal:s2',
        label: 'Two',
        order: 321,
        minimized: true,
        docked: true,
      },
    ]);
  });
});
