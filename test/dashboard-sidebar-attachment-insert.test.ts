import { describe, expect, test } from 'bun:test';

import {
  handleDashboardSidebarAttachFile,
  handleDashboardSidebarAttachFolder,
} from '../src/dashboard/sidebar-attachment-insert.js';

describe('dashboard sidebar attachment insert', () => {
  test('inserts direct file tokens into the prompt', async () => {
    const inserted: string[] = [];
    handleDashboardSidebarAttachFile('/tmp/a.pdf', {
      attachFilePathToken: async (absPath) => `[picked:${absPath}] `,
      openFolderAttachModal: () => {},
      insertAtCursor: (token) => { inserted.push(token); },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(inserted).toEqual(['[picked:/tmp/a.pdf] ']);
  });

  test('inserts folder-picked tokens when the modal resolves one', () => {
    const inserted: string[] = [];
    handleDashboardSidebarAttachFolder('/tmp/folder', {
      attachFilePathToken: async () => '[unused] ',
      openFolderAttachModal: (_absPath, onToken) => { onToken('[folder-picked] '); },
      insertAtCursor: (token) => { inserted.push(token); },
    });
    expect(inserted).toEqual(['[folder-picked] ']);
  });
});
