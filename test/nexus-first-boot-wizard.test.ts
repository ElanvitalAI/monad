import { describe, expect, test } from 'bun:test';

import type { WizardIO } from '../src/onboarding.js';
import {
  runFirstBootWizard,
  type FirstBootStep,
} from '../src/nexus/onboarding/first-boot-wizard.js';
import type { SetupCheckResult } from '../src/nexus/setup-status.js';

function makeIo(logs: string[]): WizardIO {
  return {
    ask: async () => '',
    print: (text) => { logs.push(text); },
    close: () => {},
  };
}

function setupStatus(llmPassed: boolean): SetupCheckResult {
  return {
    ok: llmPassed,
    required: [
      { id: 'llm', label: 'LLM provider', passed: llmPassed, hint: 'run `monad setup llm`' },
      { id: 'pwa-build', label: 'PWA build', passed: true, hint: 'run `monad nexus pwa build`' },
    ],
    recommended: [],
  };
}

describe('Q.3 · runFirstBootWizard', () => {
  test('non-TTY (forceTty=false) → skipped (no-tty)', async () => {
    const logs: string[] = [];
    const result = await runFirstBootWizard({
      io: makeIo(logs),
      setupStatus: setupStatus(false),
      forceTty: false,
      runLlmStep: async () => {},
      runTailscaleWizard: async () => {},
    });
    expect(result).toEqual({ action: 'skipped', reason: 'no-tty' });
  });

  test('LLM passed + Tailscale switch !== ask → skipped (all-set-up)', async () => {
    const logs: string[] = [];
    const result = await runFirstBootWizard({
      io: makeIo(logs),
      setupStatus: setupStatus(true),
      forceTty: true,
      shouldRunTailscale: false,
      runLlmStep: async () => {},
      runTailscaleWizard: async () => {},
    });
    expect(result).toEqual({ action: 'skipped', reason: 'all-set-up' });
  });

  test('LLM 미설정 → llm step 실행', async () => {
    const steps: FirstBootStep[] = [];
    const result = await runFirstBootWizard({
      io: makeIo([]),
      setupStatus: setupStatus(false),
      forceTty: true,
      shouldRunTailscale: false,
      runLlmStep: async () => { steps.push('llm'); },
      runTailscaleWizard: async () => {},
    });
    expect(result).toEqual({ action: 'completed', stepsRun: ['llm'] });
    expect(steps).toEqual(['llm']);
  });

  test('LLM 미설정 + switch === ask → 둘 다 실행', async () => {
    const steps: FirstBootStep[] = [];
    const result = await runFirstBootWizard({
      io: makeIo([]),
      setupStatus: setupStatus(false),
      forceTty: true,
      shouldRunTailscale: true,
      runLlmStep: async () => { steps.push('llm'); },
      runTailscaleWizard: async () => { steps.push('tailscale'); },
    });
    expect(result).toEqual({ action: 'completed', stepsRun: ['llm', 'tailscale'] });
    expect(steps).toEqual(['llm', 'tailscale']);
  });

  test('LLM passed + switch === ask → tailscale 만 실행', async () => {
    const steps: FirstBootStep[] = [];
    const result = await runFirstBootWizard({
      io: makeIo([]),
      setupStatus: setupStatus(true),
      forceTty: true,
      shouldRunTailscale: true,
      runLlmStep: async () => { steps.push('llm'); },
      runTailscaleWizard: async () => { steps.push('tailscale'); },
    });
    expect(result).toEqual({ action: 'completed', stepsRun: ['tailscale'] });
    expect(steps).toEqual(['tailscale']);
  });

  test('runLlmStep 에서 throw → wizard 가 swallow + 다음 step 진행', async () => {
    const errors: string[] = [];
    const steps: FirstBootStep[] = [];
    const result = await runFirstBootWizard({
      io: makeIo([]),
      setupStatus: setupStatus(false),
      forceTty: true,
      shouldRunTailscale: true,
      out: { log: () => {}, error: (text) => { errors.push(text); } },
      runLlmStep: async () => {
        throw new Error('boom');
      },
      runTailscaleWizard: async () => { steps.push('tailscale'); },
    });
    expect(result).toEqual({ action: 'completed', stepsRun: ['tailscale'] });
    expect(errors.join('\n')).toContain('llm step failed');
    expect(steps).toEqual(['tailscale']);
  });

  test('Banner ("monad NEXUS · first-boot setup") 출력', async () => {
    const logs: string[] = [];
    await runFirstBootWizard({
      io: makeIo(logs),
      setupStatus: setupStatus(false),
      forceTty: true,
      shouldRunTailscale: false,
      runLlmStep: async () => {},
      runTailscaleWizard: async () => {},
    });
    expect(logs.join('\n')).toContain('monad NEXUS · first-boot setup');
  });

  test('stepsToRun=[] 이면 banner 도 안 띔', async () => {
    const logs: string[] = [];
    await runFirstBootWizard({
      io: makeIo(logs),
      setupStatus: setupStatus(true),
      forceTty: true,
      shouldRunTailscale: false,
      runLlmStep: async () => {},
      runTailscaleWizard: async () => {},
    });
    expect(logs).toEqual([]);
  });
});
