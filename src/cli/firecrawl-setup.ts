// RFC #2161 FU A6-real · P5 (2026-05-11) — interactive Firecrawl setup.
//
// Invoked via `elanous nexus setup-firecrawl`. Walks the user through:
//   1. CLI binary detection (`firecrawl --version` probe)
//   2. API key entry (existing value reuse · prompt if absent)
//   3. Persist key to `registry.discovery.firecrawl.apiKey` via
//      patchUserConfig (atomic · file-locked)
//
// Why a dedicated setup helper instead of the catch-all
// `elanous config set` command:
//   • Discovery of the CLI gate (missing-cli vs missing-key) gives
//     users a precise next step (install · register · enter key).
//   • Key entry uses `askValidated` with `secret: true` so the
//     terminal doesn't echo characters — mirrors channel-bot-setup
//     (Telegram/Discord token entry).
//   • Persists to the canonical user-config path automatically;
//     the dotted-path resolver in `elanous config set` doesn't yet
//     know about `registry.discovery.firecrawl.apiKey`.
//
// The wizard is *non-interactive-friendly* — if the user passes the
// key inline (`--api-key <value>`) it skips the prompt entirely.
// This lets CI / scripted setup use the same code path.
//
// Cross-ref:
//   src/cli/channel-bot-setup.ts (Telegram/Discord token entry · same pattern)
//   src/registry/discovery/sources/firecrawl-crawl.ts (consumer)
//   src/nexus/config/user-config.ts (patchUserConfig)

import { isFirecrawlCliAvailable } from '../registry/discovery/sources/firecrawl-crawl.js';
import { askValidated } from '../onboarding/validators.js';
import { defaultIO, type WizardIO } from '../onboarding.js';
import { getFirecrawlConfig } from '../registry/discovery/config.js';
import { getUserConfig, resetUserConfig, saveUserConfig } from '../user-config.js';

export interface FirecrawlSetupDeps {
  io?: WizardIO;
  /** Skip the interactive prompt; persist this key directly. Useful
   *  for CI / scripted runs (`--api-key <value>` flag). When set the
   *  CLI binary check still runs but produces a hint only — the key
   *  is persisted regardless because the user may be pre-loading
   *  config before installing the CLI. */
  apiKeyInline?: string;
  /** Test seam — replace the CLI probe. Production reads
   *  `isFirecrawlCliAvailable()`. */
  cliProbeFn?: () => boolean | Promise<boolean>;
  /** Test seam — replace the patchUserConfig writer. */
  patchFn?: (apiKey: string) => void;
  /** Test seam — replace getFirecrawlConfig reader for the existing-
   *  key reuse hint. */
  readExistingFn?: () => { apiKey: string };
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface FirecrawlSetupResult {
  exitCode: number;
  /** True when the wizard wrote an API key to user-config. */
  keyWritten: boolean;
  /** True when the CLI binary was detected. False = wizard surfaced
   *  the install hint; key may still have been written. */
  cliPresent: boolean;
}

function validateApiKey(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Empty value — paste the key or press Ctrl-C to abort.';
  // Firecrawl keys are typically 30+ characters. Defensive lower
  // bound — catches obvious typos / partial pastes.
  if (trimmed.length < 12) return 'Key looks too short — verify from app.firecrawl.dev → API Keys.';
  return null;
}

const defaultPatchFn = (apiKey: string): void => {
  // Read-modify-write through Path A (saveUserConfig) — it preserves
  // both the typed sections and the NEXUS schema fields (global /
  // tabs / version). We can't use NEXUS's patchUserConfig here
  // because its UserConfig type doesn't carry the `registry` field.
  const cfg = getUserConfig();
  cfg.registry.discovery.firecrawl.apiKey = apiKey;
  saveUserConfig(cfg);
  resetUserConfig(); // force the cache to rebuild on next read
};

export async function runFirecrawlSetup(opts: FirecrawlSetupDeps = {}): Promise<FirecrawlSetupResult> {
  const ownIo = opts.io === undefined;
  const io = opts.io ?? defaultIO();
  const out = opts.out ?? console;
  const cliProbe = opts.cliProbeFn ?? isFirecrawlCliAvailable;
  const patchFn = opts.patchFn ?? defaultPatchFn;
  const readExisting = opts.readExistingFn ?? getFirecrawlConfig;

  try {
    io.print('');
    io.print('  Firecrawl model-discovery setup');
    io.print('');

    // Step 1 — CLI binary detection (informational; doesn't gate the key).
    const cliPresent = await cliProbe();
    if (cliPresent) {
      io.print('  ✓ Firecrawl CLI detected on PATH.');
    } else {
      io.print('  ⚠ Firecrawl CLI not found on PATH.');
      io.print('    Install (after registering at https://www.firecrawl.dev):');
      io.print('      npm install -g firecrawl-cli');
      io.print('    The key will still be saved — discovery activates once');
      io.print('    the CLI binary is on PATH.');
    }
    io.print('');

    // Step 2 — collect / reuse the key.
    let apiKey = (opts.apiKeyInline ?? '').trim();
    if (!apiKey) {
      const existing = readExisting().apiKey;
      if (existing) {
        io.print(`  Found existing key (${existing.slice(0, 4)}…). Press Enter to keep,`);
        io.print('  or paste a new key to replace.');
      } else {
        io.print('  Paste the API key from https://app.firecrawl.dev → API Keys.');
      }
      const prompt = existing ? '  API key (Enter = keep existing): ' : '  API key: ';
      const entered = (await askValidated(
        io,
        prompt,
        (raw: string): string | null => {
          if (raw.trim().length === 0 && existing) return null; // allow keep-existing
          return validateApiKey(raw);
        },
        { secret: true, maxAttempts: 3 },
      )).trim();
      apiKey = entered.length > 0 ? entered : existing;
    }

    if (!apiKey) {
      out.error('firecrawl setup: no key provided.');
      return { exitCode: 1, keyWritten: false, cliPresent };
    }

    // Step 3 — persist.
    patchFn(apiKey);
    out.log(`✓ Firecrawl API key saved (${apiKey.slice(0, 4)}…).`);
    out.log('  Used by: web search (omni_search) · model discovery');
    if (cliPresent) {
      out.log('  Discovery will pick up the new key on the next /v1/registry/discovery call.');
    } else {
      out.log('  Install the firecrawl CLI to activate discovery.');
    }
    return { exitCode: 0, keyWritten: true, cliPresent };
  } catch (err) {
    out.error(`firecrawl setup failed: ${(err as Error).message}`);
    return { exitCode: 1, keyWritten: false, cliPresent: false };
  } finally {
    if (ownIo) io.close();
  }
}
