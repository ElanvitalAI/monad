import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveDynamicSessionNativeToolSpecs,
  shouldExposeDevHarnessSessionTool,
} from '../src/session-runtime/index.js';
import { resetMonadConfigDir, setMonadConfigDir } from '../src/monad-config-dir.js';
import { resetUserConfig } from '../src/user-config.js';

let configDir: string;
const input = { userText: '하니스로 구현해줘', surfaceId: 'coding/agent' as const };

function writeConfig(modelSurface?: boolean): void {
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify(modelSurface === undefined ? {} : { tools: { runDevHarness: { modelSurface } } }),
  );
  resetUserConfig();
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'session-runtime-dev-harness-'));
  setMonadConfigDir(configDir);
  resetUserConfig();
});

afterEach(() => {
  resetUserConfig();
  resetMonadConfigDir();
  rmSync(configDir, { recursive: true, force: true });
});

describe('session RunDevHarness model surface', () => {
  test('does not match or select RunDevHarness by default and restores both with explicit opt-in', () => {
    writeConfig();
    expect(shouldExposeDevHarnessSessionTool(input.userText)).toBe(false);
    expect(resolveDynamicSessionNativeToolSpecs(input).map(spec => spec.name)).not.toContain('RunDevHarness');

    writeConfig(true);
    expect(shouldExposeDevHarnessSessionTool(input.userText)).toBe(true);
    expect(resolveDynamicSessionNativeToolSpecs(input).map(spec => spec.name)).toContain('RunDevHarness');
  });

  test('exposes every documented tool-description form and preserves the existing seven forms when opted in', () => {
    writeConfig(true);
    const documentedForms = [
      '하니스로 개발',
      '하니스:',
      '하니스로 구현해줘',
      '하니스 구현',
      'use the harness to',
      'self dev',
    ];
    const existingForms = [
      '개발 하니스로',
      '하니스로 구현',
      '하니스로 골 제출',
      'develop with the harness',
      'implement with the harness',
      'submit a goal with the harness',
    ];

    for (const userText of [...documentedForms, ...existingForms]) {
      expect(shouldExposeDevHarnessSessionTool(`Please ${userText} now`)).toBe(true);
      expect(resolveDynamicSessionNativeToolSpecs({ userText, surfaceId: 'coding/agent' }).map(spec => spec.name))
        .toContain('RunDevHarness');
    }
  });

  // ⛔⭐ 「따르는 수」가 아니라 «어기는 수»를 센다 — 영어가 «구»가 아니라 «낱말»이면
  //   이 다섯이 전부 통과하고(2026-09-11 실측 5/5 오탐) 그 툴이 조용히 열린다.
  test('does not expose the tool for incidental mentions of the English word', () => {
    writeConfig(true);
    const incidental = [
      'the test harness failed',
      'a wiring harness for the car',
      'harness',
      'I fixed the test harness yesterday',
      'cable harness assembly',
    ];

    for (const userText of incidental) {
      expect(shouldExposeDevHarnessSessionTool(userText)).toBe(false);
      expect(resolveDynamicSessionNativeToolSpecs({ userText, surfaceId: 'coding/agent' }).map(spec => spec.name))
        .not.toContain('RunDevHarness');
    }
  });
});
