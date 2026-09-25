import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDashboardVirtualWindowHelpLines,
  createDashboardVirtualWindowHelpRuntime,
  type DashboardVirtualWindowHelpRegistrationState,
} from '../src/dashboard/virtual-window-help-runtime.js';

const lineDeps = {
  keyLabel: (key: string, desc: string) => `${key}:${desc}`,
  sectionLabel: (title: string) => `## ${title}`,
  muted: (text: string) => `..${text}`,
};

const bothOn: DashboardVirtualWindowHelpRegistrationState = {
  supplementalGlobalKeys: true,
  virtualWindowSwitchKeys: true,
};

function linesFor(registrationState: DashboardVirtualWindowHelpRegistrationState): string[] {
  return buildDashboardVirtualWindowHelpLines(lineDeps, registrationState);
}

const activeOptionalLines = [
  '0:Open window picker',
  '1..9:Switch to Nth window (Ctrl+1..9 also works)',
  'n / .  / >:Next window',
  'p / , / <:Previous window',
  'X:Close whole window',
  'Tab:Jump to last focused pane (alt-tab)',
];

const coreLines = [
  'c:New virtual window (terminal)',
  'x:Close focused pane',
  'z:Zoom focused pane (fullscreen within VW, toggle)',
];

describe('buildDashboardVirtualWindowHelpLines', () => {
  test('keeps the three always-registered core controls in every registration state', () => {
    for (const registrationState of [
      { supplementalGlobalKeys: false, virtualWindowSwitchKeys: false },
      { supplementalGlobalKeys: true, virtualWindowSwitchKeys: false },
      { supplementalGlobalKeys: false, virtualWindowSwitchKeys: true },
      bothOn,
    ]) {
      expect(linesFor(registrationState)).toEqual(expect.arrayContaining(coreLines));
    }
  });

  test('preserves current optional wording and ordering when both registrations are enabled', () => {
    const lines = linesFor(bothOn);

    expect(lines).toEqual(expect.arrayContaining(activeOptionalLines));
    expect(lines.indexOf(activeOptionalLines[0]!)).toBeLessThan(lines.indexOf(activeOptionalLines[1]!));
    expect(lines.indexOf(activeOptionalLines[1]!)).toBeLessThan(lines.indexOf(activeOptionalLines[2]!));
    expect(lines.indexOf(activeOptionalLines[2]!)).toBeLessThan(lines.indexOf(activeOptionalLines[3]!));
    expect(lines.indexOf(activeOptionalLines[4]!)).toBeLessThan(lines.indexOf(activeOptionalLines[5]!));
    expect(lines).toContain('..Global fast-switch: Alt+N/P/1..9/0 (no chord needed)');
    expect(lines.some((line) => line.includes('enableVirtualWindowSwitchKeys'))).toBe(false);
    expect(lines.some((line) => line.includes('enableSupplementalGlobalKeys'))).toBe(false);
  });

  test('replaces all disabled optional claims with guidance naming both settings', () => {
    const lines = linesFor({ supplementalGlobalKeys: false, virtualWindowSwitchKeys: false });

    for (const line of activeOptionalLines) expect(lines).not.toContain(line);
    expect(lines).toEqual(expect.arrayContaining([
      'Alt+0:Open window picker',
      expect.stringContaining('dashboard.enableVirtualWindowSwitchKeys'),
      expect.stringContaining('dashboard.enableSupplementalGlobalKeys'),
    ]));
    expect(lines.some((line) => line.includes('Global fast-switch'))).toBe(false);
  });

  test('keeps each partially enabled registration claim while guiding only the disabled setting', () => {
    const supplementalOnly = linesFor({ supplementalGlobalKeys: true, virtualWindowSwitchKeys: false });
    expect(supplementalOnly).toEqual(expect.arrayContaining([
      activeOptionalLines[0]!, activeOptionalLines[4]!, activeOptionalLines[5]!,
      expect.stringContaining('dashboard.enableVirtualWindowSwitchKeys'),
    ]));
    for (const line of activeOptionalLines.slice(1, 4)) expect(supplementalOnly).not.toContain(line);
    expect(supplementalOnly.some((line) => line.includes('enableSupplementalGlobalKeys'))).toBe(false);

    const switchOnly = linesFor({ supplementalGlobalKeys: false, virtualWindowSwitchKeys: true });
    expect(switchOnly).toEqual(expect.arrayContaining([
      'Alt+0:Open window picker',
      ...activeOptionalLines.slice(1, 4),
      expect.stringContaining('dashboard.enableSupplementalGlobalKeys'),
    ]));
    for (const line of [activeOptionalLines[0]!, activeOptionalLines[4]!, activeOptionalLines[5]!]) {
      expect(switchOnly).not.toContain(line);
    }
    expect(switchOnly.some((line) => line.includes('enableVirtualWindowSwitchKeys'))).toBe(false);
  });

});

test('dashboard runtime path supplies registration state to createDashboardVirtualWindowHelpRuntime', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'src/dashboard/index.ts'), 'utf-8');
  const caller = 'const vwHelpRuntime = createDashboardVirtualWindowHelpRuntime({';

  expect(source).toContain(caller);
  expect(source.indexOf('registrationState:', source.indexOf(caller))).toBeGreaterThan(source.indexOf(caller));
  expect(source).toContain('supplementalGlobalKeys: getUserConfig().dashboard.enableSupplementalGlobalKeys');
  expect(source).toContain('virtualWindowSwitchKeys: getUserConfig().dashboard.enableVirtualWindowSwitchKeys');
  expect(source).toContain('onHelp: vwHelpRuntime.onHelp');
});

describe('createDashboardVirtualWindowHelpRuntime', () => {
  test('renders the state-aware help popup payload', () => {
    const calls: Array<{ title: string; lines: string[]; termCols: number; termRows: number; ttlMs: number; group: string }> = [];
    const runtime = createDashboardVirtualWindowHelpRuntime({
      termSize: () => ({ cols: 120, rows: 40 }),
      ...lineDeps,
      registrationState: bothOn,
      showHelpModal: (spec) => { calls.push(spec); },
    });

    runtime.onHelp?.();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      title: 'Virtual-window chord — ^B <key>',
      termCols: 120,
      termRows: 40,
      ttlMs: 8000,
      group: 'vw-chord-help',
    });
    expect(calls[0]?.lines).toEqual(linesFor(bothOn));
  });
});
