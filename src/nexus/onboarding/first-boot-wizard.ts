import type { WizardIO } from '../../onboarding.js';
import type { SetupCheckResult } from '../setup-status.js';
import type { TailscaleProbe } from './tailscale-probe.js';

export interface FirstBootWizardDeps {
  io: WizardIO;
  setupStatus: SetupCheckResult;
  runLlmStep: (io: WizardIO) => Promise<void>;
  runTailscaleWizard: (io: WizardIO) => Promise<void>;
  shouldRunTailscale?: boolean;
  forceTty?: boolean;
  out?: { log: (s: string) => void; error: (s: string) => void };
  // Phase 4 (2026-05-19) — PWA `/setup` link 표시용. 모두 optional —
  // 부족하면 banner skip 하고 기존 TUI 흐름만.
  /** Daemon HTTP bind port. Banner 의 PWA URL 에 사용. */
  httpPort?: number;
  /** PWA static export 가 빌드되어 있는지. false 면 banner 미표시. */
  pwaBuilt?: boolean;
  /** Tailscale probe 결과 (alive 시 magicDNS / IP 도 banner 에 노출). */
  tailscale?: TailscaleProbe;
}

export type FirstBootStep = 'llm' | 'tailscale';

export type FirstBootResult =
  | { action: 'completed'; stepsRun: FirstBootStep[] }
  | { action: 'skipped'; reason: 'no-tty' | 'all-set-up' };

function isTty(force?: boolean): boolean {
  if (force === true) return true;
  if (force === false) return false;
  return Boolean(process.stdin.isTTY);
}

/** Build the PWA `/setup` URLs the banner shows.
 *
 *  Order of preference (most-routable first):
 *    1. Tailscale magicDNS host (if probe alive + DNS name present)
 *    2. Tailscale IPv4 (if alive)
 *    3. localhost (always)
 *
 *  Each URL points at `/app/setup/` per PWA's `basePath: '/app'` +
 *  `trailingSlash: true` (apps/pwa/next.config.ts).
 *
 *  Pure — exported for tests so URL composition can be locked
 *  independently of the prompt flow.
 */
export function buildPwaSetupUrls(deps: {
  httpPort: number;
  tailscale?: TailscaleProbe;
}): string[] {
  const urls: string[] = [];
  const port = deps.httpPort;
  const ts = deps.tailscale;
  if (ts?.alive) {
    if (ts.magicDnsHost && ts.magicDnsHost.length > 0) {
      urls.push(`http://${ts.magicDnsHost}:${port}/app/setup/`);
    }
    if (ts.ips && ts.ips.length > 0) {
      // First IPv4 only — IPv6 second; keep banner tight.
      urls.push(`http://${ts.ips[0]}:${port}/app/setup/`);
    }
  }
  urls.push(`http://localhost:${port}/app/setup/`);
  // De-dupe in case magicDNS == localhost on a single-host tailnet.
  return Array.from(new Set(urls));
}

function shouldShowPwaBanner(deps: FirstBootWizardDeps, llmStepNeeded: boolean): boolean {
  if (!llmStepNeeded) return false;
  if (!deps.pwaBuilt) return false;
  if (typeof deps.httpPort !== 'number' || deps.httpPort <= 0) return false;
  return true;
}

function printPwaSetupBanner(deps: FirstBootWizardDeps): void {
  if (typeof deps.httpPort !== 'number') return;
  const urls = buildPwaSetupUrls({
    httpPort: deps.httpPort,
    ...(deps.tailscale ? { tailscale: deps.tailscale } : {}),
  });
  deps.io.print('  ┌── PWA setup ──────────────────────────────────────────');
  deps.io.print('  │ 터미널 prompt 대신 브라우저 / iPhone 에서 셋업하려면:');
  for (const url of urls) {
    deps.io.print(`  │   ${url}`);
  }
  deps.io.print('  │ (LLM provider 선택 + API key 1 화면 · 30초)');
  deps.io.print('  └───────────────────────────────────────────────────────');
  deps.io.print('');
}

export async function runFirstBootWizard(
  deps: FirstBootWizardDeps,
): Promise<FirstBootResult> {
  if (!isTty(deps.forceTty)) {
    return { action: 'skipped', reason: 'no-tty' };
  }

  const stepsToRun: FirstBootStep[] = [];
  const llm = deps.setupStatus.required.find((item) => item.id === 'llm');
  const llmNeeded = !llm?.passed;
  if (llmNeeded) stepsToRun.push('llm');
  if (deps.shouldRunTailscale) stepsToRun.push('tailscale');

  if (stepsToRun.length === 0) {
    return { action: 'skipped', reason: 'all-set-up' };
  }

  const out = deps.out ?? console;
  deps.io.print('');
  deps.io.print('  elanous NEXUS · first-boot setup');
  deps.io.print('  Press Ctrl-C anytime to skip remaining steps.');
  deps.io.print('');

  if (shouldShowPwaBanner(deps, llmNeeded)) {
    printPwaSetupBanner(deps);
  }

  const stepsRun: FirstBootStep[] = [];
  for (const step of stepsToRun) {
    try {
      if (step === 'llm') await deps.runLlmStep(deps.io);
      else await deps.runTailscaleWizard(deps.io);
      stepsRun.push(step);
    } catch (err) {
      out.error(`first-boot wizard: ${step} step failed: ${(err as Error).message}`);
    }
  }

  return { action: 'completed', stepsRun };
}
