import {
  CdpUnavailable,
  createCdpClient,
  discoverChromeBinary,
  type CdpClient,
  type CdpSpawnOpts,
} from './client.js';

export interface BrowserCdpAvailability {
  readonly available: boolean;
  readonly reason: 'ok' | 'no-chrome-binary';
  readonly note: string;
  readonly binary?: string;
}

export interface UsableBrowserCdpAvailability {
  readonly available: boolean;
  readonly reason: string;
  readonly note: string;
}

export interface UsableBrowserCdpProbeDeps {
  readonly discoverBinary?: () => string | null;
  readonly createClient?: (opts: CdpSpawnOpts) => Promise<Pick<CdpClient, 'close' | 'evaluate'>>;
}

const PROBE_TIMEOUT_MS = 1_000;

export function getBrowserCdpAvailability(): BrowserCdpAvailability {
  const binary = discoverChromeBinary();
  if (!binary) {
    return {
      available: false,
      reason: 'no-chrome-binary',
      note: 'Chrome unavailable. Set MONAD_CHROME_BIN or install Google Chrome / Chromium.',
    };
  }
  return {
    available: true,
    reason: 'ok',
    note: `Chrome available at ${binary}`,
    binary,
  };
}

/** Starts and connects a disposable headless Chrome instance to verify CDP usability. */
export async function probeUsableBrowserCdp(deps: UsableBrowserCdpProbeDeps = {}): Promise<UsableBrowserCdpAvailability> {
  const discoverBinary = deps.discoverBinary ?? discoverChromeBinary;
  const createClient = deps.createClient ?? createCdpClient;
  try {
    const binary = discoverBinary();
    if (!binary) {
      return {
        available: false,
        reason: 'no-chrome-binary',
        note: 'Chrome CDP unavailable: no-chrome-binary',
      };
    }

    const client = await createClient({
      binary,
      headless: true,
      timeoutMs: PROBE_TIMEOUT_MS,
      attachTimeoutMs: PROBE_TIMEOUT_MS,
    });
    try {
      await client.evaluate('true');
      await client.close();
    } catch (error) {
      try { await client.close(); } catch { /* best-effort cleanup */ }
      return unavailable(error);
    }
    return { available: true, reason: 'ok', note: 'Chrome CDP startup, page connection, and cleanup succeeded.' };
  } catch (error) {
    return unavailable(error);
  }
}

function unavailable(error: unknown): UsableBrowserCdpAvailability {
  const reason = error instanceof CdpUnavailable
    ? error.reason
    : `probe-failed: ${error instanceof Error ? error.message : String(error)}`;
  return { available: false, reason, note: `Chrome CDP unavailable: ${reason}` };
}
