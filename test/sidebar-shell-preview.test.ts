import { describe, expect, test } from 'bun:test';
import { buildSidebarShellPreviewText } from '../src/ui/chrome/sidebar-shell-detail.js';

describe('sidebar shell preview text', () => {
  test('builds compact preview blocks with title, subtitle, and tail', () => {
    const text = buildSidebarShellPreviewText({
      title: 'Theme',
      subtitle: 'Mode: dark · pastel',
      tail: 'Compare palette vocabulary before wider chrome polish.',
    });
    expect(text).toBe(
      [
        'Theme',
        '',
        'Mode: dark · pastel',
        '',
        'Compare palette vocabulary before wider chrome polish.',
      ].join('\n'),
    );
  });
});
