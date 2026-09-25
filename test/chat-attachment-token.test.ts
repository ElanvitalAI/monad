import { describe, expect, test } from 'bun:test';

import { deleteAttachmentTokenBeforeCursor } from '../src/chat/attachment-token.js';

describe('deleteAttachmentTokenBeforeCursor', () => {
  test('deletes a bare attachment token atomically', () => {
    expect(deleteAttachmentTokenBeforeCursor({
      line: '[Md #1] tail',
      cursor: '[Md #1]'.length,
    })).toEqual({
      deleted: true,
      nextLine: ' tail',
      nextCursor: 0,
      token: '[Md #1]',
    });
  });

  test('deletes an attachment token with its leading gap', () => {
    expect(deleteAttachmentTokenBeforeCursor({
      line: 'see [PDF #2] more',
      cursor: 'see [PDF #2]'.length,
    })).toEqual({
      deleted: true,
      nextLine: 'see more',
      nextCursor: 3,
      token: '[PDF #2]',
    });
  });

  test('returns unchanged state when cursor is not after an attachment token', () => {
    expect(deleteAttachmentTokenBeforeCursor({
      line: 'plain text',
      cursor: 5,
    })).toEqual({
      deleted: false,
      nextLine: 'plain text',
      nextCursor: 5,
    });
  });
});
