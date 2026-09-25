import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { buildSidebarShellDetailText } from '../src/ui/chrome/sidebar-shell-detail.js';

describe('sidebar shell detail presentation', () => {
  test('builds aligned fields and section blocks', () => {
    const raw = buildSidebarShellDetailText({
      title: 'Background · codex',
      subtitle: 'Quick preview',
      fields: [
        { label: 'state', value: 'running' },
        { label: 'origin', value: 'sidebar-test' },
      ],
      sections: [
        { title: 'Preview', body: 'partial output' },
      ],
    });
    const text = stripAnsi(raw);
    expect(text).toContain('Background · codex');
    expect(text).toContain('Quick preview');
    expect(text).toContain('state   running');
    expect(text).toContain('origin  sidebar-test');
    expect(text).toContain('── Preview ──');
    expect(text).toContain('partial output');
  });
});
