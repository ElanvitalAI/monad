// First-boot wizard tests — Phase 4 PWA banner + step ordering.
//
// 기존에 first-boot-wizard 자체 test 가 없어서 (PWA share wizard 측 test
// 만 있음) 본 PR 에서 banner + step gating 을 lock. Pure — IO 는
// 메모리 buffer 로 capture · runLlmStep 은 spy.

import { describe, expect, test } from 'bun:test';

import type { WizardIO } from '../../onboarding.js';
import type { SetupCheckResult, SetupItem } from '../setup-status.js';
import type { TailscaleProbe } from './tailscale-probe.js';
import {
  buildPwaSetupUrls,
  runFirstBootWizard,
  type FirstBootWizardDeps,
} from './first-boot-wizard.js';

interface CapturedIO {
  io: WizardIO;
  printed: string[];
}

function makeIO(): CapturedIO {
  const printed: string[] = [];
  const io: WizardIO = {
    ask: async () => '',
    print: (s: string) => { printed.push(s); },
    close: () => undefined,
  };
  return { io, printed };
}

function makeStatus(llmPassed: boolean): SetupCheckResult {
  const llm: SetupItem = {
    id: 'llm',
    label: 'LLM provider',
    passed: llmPassed,
    hint: 'run `monad setup llm`',
  };
  return { required: [llm], recommended: [], ok: llmPassed };
}

describe('buildPwaSetupUrls — Phase 4 URL composition', () => {
  test('returns localhost only when no tailscale', () => {
    const urls = buildPwaSetupUrls({ httpPort: 31415 });
    expect(urls).toEqual(['http://localhost:31415/app/setup/']);
  });

  test('prepends magicDNS host when tailscale alive', () => {
    const ts: TailscaleProbe = {
      installed: true,
      alive: true,
      magicDnsHost: 'mbp.tailnet-x.ts.net',
      ips: ['100.112.0.1'],
    };
    const urls = buildPwaSetupUrls({ httpPort: 31420, tailscale: ts });
    expect(urls[0]).toBe('http://mbp.tailnet-x.ts.net:31420/app/setup/');
    expect(urls[1]).toBe('http://100.112.0.1:31420/app/setup/');
    expect(urls[2]).toBe('http://localhost:31420/app/setup/');
  });

  test('omits magicDNS when tailscale installed but not alive', () => {
    const ts: TailscaleProbe = {
      installed: true,
      alive: false,
      magicDnsHost: 'mbp.tailnet-x.ts.net',
      ips: ['100.112.0.1'],
    };
    const urls = buildPwaSetupUrls({ httpPort: 31415, tailscale: ts });
    expect(urls).toEqual(['http://localhost:31415/app/setup/']);
  });

  test('omits IP when alive but no ips reported', () => {
    const ts: TailscaleProbe = { installed: true, alive: true, magicDnsHost: 'h.example' };
    const urls = buildPwaSetupUrls({ httpPort: 31415, tailscale: ts });
    expect(urls).toEqual([
      'http://h.example:31415/app/setup/',
      'http://localhost:31415/app/setup/',
    ]);
  });

  test('de-dupes when localhost == single tailscale IP', () => {
    const ts: TailscaleProbe = { installed: true, alive: true, ips: ['localhost'] };
    const urls = buildPwaSetupUrls({ httpPort: 31415, tailscale: ts });
    // Same URL appears as ips[0] + localhost — uniq.
    expect(urls.length).toBe(1);
  });
});

describe('runFirstBootWizard — Phase 4 banner gating', () => {
  test('no-tty short-circuit', async () => {
    const { io } = makeIO();
    const result = await runFirstBootWizard({
      io,
      setupStatus: makeStatus(false),
      forceTty: false,
      runLlmStep: async () => undefined,
      runTailscaleWizard: async () => undefined,
    });
    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toBe('no-tty');
  });

  test('all-set-up short-circuit', async () => {
    const { io } = makeIO();
    const result = await runFirstBootWizard({
      io,
      setupStatus: makeStatus(true),
      forceTty: true,
      runLlmStep: async () => undefined,
      runTailscaleWizard: async () => undefined,
    });
    expect(result.action).toBe('skipped');
    expect((result as { reason: string }).reason).toBe('all-set-up');
  });

  test('llm step needed + pwaBuilt + httpPort → banner printed', async () => {
    const { io, printed } = makeIO();
    let llmCalled = false;
    const result = await runFirstBootWizard({
      io,
      setupStatus: makeStatus(false),
      forceTty: true,
      httpPort: 31415,
      pwaBuilt: true,
      runLlmStep: async () => { llmCalled = true; },
      runTailscaleWizard: async () => undefined,
    });
    expect(result.action).toBe('completed');
    expect(llmCalled).toBe(true);
    const banner = printed.join('\n');
    expect(banner).toContain('PWA setup');
    expect(banner).toContain('http://localhost:31415/app/setup/');
  });

  test('banner skipped when pwa not built', async () => {
    const { io, printed } = makeIO();
    await runFirstBootWizard({
      io,
      setupStatus: makeStatus(false),
      forceTty: true,
      httpPort: 31415,
      pwaBuilt: false,
      runLlmStep: async () => undefined,
      runTailscaleWizard: async () => undefined,
    });
    expect(printed.join('\n')).not.toContain('PWA setup');
  });

  test('banner skipped when httpPort missing', async () => {
    const { io, printed } = makeIO();
    await runFirstBootWizard({
      io,
      setupStatus: makeStatus(false),
      forceTty: true,
      pwaBuilt: true,
      runLlmStep: async () => undefined,
      runTailscaleWizard: async () => undefined,
    });
    expect(printed.join('\n')).not.toContain('PWA setup');
  });

  test('banner includes tailscale magicDNS when probe alive', async () => {
    const { io, printed } = makeIO();
    const tailscale: TailscaleProbe = {
      installed: true,
      alive: true,
      magicDnsHost: 'mbp.tailnet.ts.net',
      ips: ['100.99.0.42'],
    };
    await runFirstBootWizard({
      io,
      setupStatus: makeStatus(false),
      forceTty: true,
      httpPort: 31425,
      pwaBuilt: true,
      tailscale,
      runLlmStep: async () => undefined,
      runTailscaleWizard: async () => undefined,
    });
    const banner = printed.join('\n');
    expect(banner).toContain('mbp.tailnet.ts.net:31425');
    expect(banner).toContain('100.99.0.42:31425');
    expect(banner).toContain('localhost:31425');
  });

  test('llm step error is captured and does not abort', async () => {
    const { io } = makeIO();
    let tailscaleCalled = false;
    const errors: string[] = [];
    const result = await runFirstBootWizard({
      io,
      setupStatus: makeStatus(false),
      forceTty: true,
      shouldRunTailscale: true,
      out: { log: () => undefined, error: (s) => errors.push(s) },
      runLlmStep: async () => { throw new Error('boom'); },
      runTailscaleWizard: async () => { tailscaleCalled = true; },
    } satisfies FirstBootWizardDeps);
    expect(result.action).toBe('completed');
    expect((result as { stepsRun: string[] }).stepsRun).toEqual(['tailscale']);
    expect(tailscaleCalled).toBe(true);
    expect(errors[0]).toContain('llm step failed: boom');
  });
});
