import { PROVIDER_MODEL_SOURCES, type WatchPage } from './model-watch-intake.js';

export interface ModelWatchFetchFailure {
  id: string;
  url: string;
  error: string;
}

export interface ModelWatchFetchResult {
  pages: WatchPage[];
  failures: ModelWatchFetchFailure[];
}

type FetchResponse = { ok: boolean; status: number; text: () => Promise<string> };
type FetchPage = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>;
type ModelWatchSource = { id: string; url: string };

export interface ModelWatchFetchDeps {
  sources?: readonly ModelWatchSource[];
  fetch?: FetchPage;
  /** Per-source deadline. A non-positive value disables the deadline. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Fetch every canonical provider page concurrently. Each source gets an
 * independent deadline, so an unavailable provider cannot block the others. */
export async function fetchProviderModelPages(
  deps: ModelWatchFetchDeps = {},
): Promise<ModelWatchFetchResult> {
  const sources = deps.sources ?? PROVIDER_MODEL_SOURCES;
  const fetchPage: FetchPage = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const settled = await Promise.allSettled(sources.map((source) => fetchSource(source, fetchPage, timeoutMs)));
  const pages: WatchPage[] = [];
  const failures: ModelWatchFetchFailure[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      if ('page' in result.value) pages.push(result.value.page);
      else failures.push(result.value.failure);
    } else {
      // fetchSource catches every expected request failure. Preserve this
      // fallback for an unexpected implementation error without aborting peers.
      failures.push({ id: 'unknown', url: '', error: errorMessage(result.reason) });
    }
  }
  return { pages, failures };
}

async function fetchSource(
  source: ModelWatchSource,
  fetchPage: FetchPage,
  timeoutMs: number,
): Promise<{ page: WatchPage } | { failure: ModelWatchFetchFailure }> {
  const controller = new AbortController();
  try {
    return await withSourceDeadline(controller, timeoutMs, async () => {
      const response = await fetchPage(source.url, { signal: controller.signal });
      if (!response.ok) return { failure: { id: source.id, url: source.url, error: `HTTP ${response.status}` } };
      return { page: { source: source.id, text: await response.text() } };
    });
  } catch (error) {
    return { failure: { id: source.id, url: source.url, error: errorMessage(error) } };
  }
}

/** Keep the deadline alive through both response headers and body consumption. */
function withSourceDeadline<T>(
  controller: AbortController,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    operation().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
