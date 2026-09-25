import { describe, expect, test } from 'bun:test';

import { createDashboardSkillWidgetRuntime } from '../src/dashboard/skill-widget-runtime.js';
import type { SkillViewState } from '../src/skills/view.js';

describe('createDashboardSkillWidgetRuntime', () => {
  test('projects skill browser and file widgets', () => {
    const runtime = createDashboardSkillWidgetRuntime();
    const browser = { state: {} as Record<string, unknown> };
    runtime.projectBrowser(
      browser,
      [{ name: 'alpha', dir: '/skills/alpha' }],
      '/skills',
      0,
      2,
      true,
      text => `muted:${text}`,
      text => `accent:${text}`,
    );
    expect(browser.state.items).toEqual(['accent:alpha']);
    expect(browser.state.icons).toEqual(['accent:🔧']);
    expect(browser.state.cursor).toBe(0);
    expect(browser.state.offset).toBe(2);
    expect(browser.state.preserveAnsi).toBe(true);
    expect(browser.state.focused).toBe(true);

    const files = { state: {} as Record<string, unknown> };
    const skillView: SkillViewState = {
      skillsRoot: '/skills',
      skills: [{ name: 'alpha', dir: '/skills/alpha' }],
      skillCursor: 0,
      skillOffset: 0,
      files: [
        {
          name: 'SKILL.md',
          absPath: '/skills/alpha/SKILL.md',
          relPath: 'SKILL.md',
          ext: 'md',
          size: 1,
          mtime: 1,
          isManifest: true,
        },
      ],
      fileCursor: 0,
      fileOffset: 1,
      selected: new Set(['/skills/alpha/SKILL.md']),
    };
    runtime.projectFiles(
      files,
      skillView,
      false,
      text => `muted:${text}`,
      file => `label:${file.relPath}`,
      file => `icon:${file.name}`,
    );
    expect(files.state.items).toEqual(['label:SKILL.md']);
    expect(files.state.icons).toEqual(['icon:SKILL.md']);
    expect(files.state.cursor).toBe(0);
    expect(files.state.offset).toBe(1);
    expect(Array.from(files.state.selected as Set<string>)).toEqual(['label:SKILL.md']);
    expect(files.state.focused).toBe(false);
  });
});
