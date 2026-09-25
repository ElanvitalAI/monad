import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function text(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('ui foundation · R9.U-5(b) target boundary source truth', () => {
  test('target mount helper locks the supported mount target roster and explicit unsupported reasons', () => {
    const src = text('../src/tool-runtime/scenario-target-mount.ts');
    expect(src).toContain("export const RUN_SCENARIO_MOUNT_TARGET_KINDS = [");
    expect(src).toContain("'window'");
    expect(src).toContain("'pane'");
    expect(src).toContain("'modal'");
    expect(src).toContain("'widget'");
    expect(src).toContain('not a mount container');
    expect(src).toContain('transient and not a scenario mount destination');
  });

  test('dashboard uses the shared target mount helper instead of an ad-hoc target-kind switch', () => {
    // 🪞⭐ 2026-08-26 — 소비자가 ***추출***됐다: src/dashboard/index.ts → src/dashboard/scenario-runtime-boot.ts
    //   그리고 «좋아졌다» — 이제 주입 가능하다(`deps.mountIntoTarget ?? mountScenarioIntoTarget`).
    //   ⇒ 계약(“대시보드는 ad-hoc switch 대신 «공유 헬퍼»를 쓴다”)은 «내내» 지켜지고 있었다.
    //   ⛔ 늙은 것은 ***「어느 파일이 그 소비자인가」***라는 좌표다.
    const src = text('../src/dashboard/scenario-runtime-boot.ts');
    expect(src).toContain("from '../tool-runtime/scenario-target-mount.js'");
    expect(src).toContain('mountScenarioIntoTarget');
    // ⛔⭐ 주입 이음매가 «있어도» 실물 기본이 공유 헬퍼여야 한다 — 그게 이 계약의 요점이다.
    expect(src).toMatch(/\(\s*deps\.mountIntoTarget\s*\?\?\s*mountScenarioIntoTarget\s*\)\s*\(/);
    // ⛔ ad-hoc 분기가 «되살아나지» 않았는지는 ***대시보드 두 파일 모두***에서 문다 —
    //   한 파일만 보면 추출로 «옮겨 간» 분기를 놓친다.
    for (const rel of ['../src/dashboard/scenario-runtime-boot.ts', '../src/dashboard/index.ts']) {
      expect(text(rel)).not.toContain('is not supported by the dashboard mount path yet');
    }
  });

  test('run scenario runtime spec names the supported target kinds explicitly', () => {
    const src = text('../src/tool-runtime/scenario-runtimes.ts');
    expect(src).toContain("import { RUN_SCENARIO_MOUNT_TARGET_KINDS } from './scenario-target-mount.js';");
    expect(src).toContain('Supported mount destinations are ');
    expect(src).toContain('input/popover/inline/bg return explicit unsupported-target errors');
  });
});
