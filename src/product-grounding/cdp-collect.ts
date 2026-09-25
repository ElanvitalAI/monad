import {
  createCdpClientFromEndpoint,
  type CdpClient,
} from '../browser-cdp/client.js';

const READY_STATE_EXPRESSION = 'document.readyState === \'complete\'';
const DEFAULT_READY_STATE_CHECKS = 20;
const DEFAULT_READY_STATE_INTERVAL_MS = 100;

type GroundingCdpClient = Pick<CdpClient, 'navigate' | 'evaluate' | 'close'>;

export interface CdpGroundingCollectorDeps {
  readonly createClient?: () => Promise<GroundingCdpClient>;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly maxReadyStateChecks?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Collects page facts from a dedicated CDP target without owning the browser process. */
export async function collectGroundingFactsViaCdp(
  url: string,
  snippet: string,
  deps: CdpGroundingCollectorDeps = {},
): Promise<unknown> {
  const client = await (deps.createClient ?? (() => createCdpClientFromEndpoint(9222)))();
  const maxReadyStateChecks = deps.maxReadyStateChecks ?? DEFAULT_READY_STATE_CHECKS;
  const wait = deps.sleep ?? sleep;

  try {
    await client.navigate(url);
    for (let attempt = 0; attempt < maxReadyStateChecks; attempt += 1) {
      if (await client.evaluate(READY_STATE_EXPRESSION) === true) break;
      if (attempt + 1 < maxReadyStateChecks) await wait(DEFAULT_READY_STATE_INTERVAL_MS);
    }
    return await client.evaluate(snippet);
  } finally {
    await client.close();
  }
}
