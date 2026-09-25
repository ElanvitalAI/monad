import type { ObservatorySubject } from '@/components/observatory/subject-list';
import { DaemonClient, type DaemonLogEntry } from '@/lib/daemon-client';
import { buildActivitySnapshot, type ShellActivitySnapshot } from './activity-snapshot';

type TerminalsResponse = { subjects?: ObservatorySubject[] };

type ActivityFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ActivityFetchDeps = {
  fetchImpl?: ActivityFetch;
  listProgressFrames?: () => Promise<{ logs?: DaemonLogEntry[] } | null>;
};

const defaultClient = new DaemonClient({ baseUrl: '', token: '', provider: '' });

export async function fetchActivitySnapshot(
  deps: ActivityFetchDeps = {},
): Promise<ShellActivitySnapshot> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const listProgressFrames = deps.listProgressFrames
    ?? (() => defaultClient.listProgressFrames().catch(() => null));
  try {
    const [response, progressResponse] = await Promise.all([
      fetchImpl('/v1/terminals').then(async (terminalResponse) => {
        if (!terminalResponse.ok) {
          throw new Error(`GET /v1/terminals failed (${terminalResponse.status})`);
        }
        return terminalResponse.json() as Promise<TerminalsResponse>;
      }),
      listProgressFrames(),
    ]);
    return buildActivitySnapshot({
      status: 'ready',
      subjects: response.subjects ?? [],
      logs: progressResponse?.logs ?? [],
    });
  } catch (cause: unknown) {
    return buildActivitySnapshot({
      status: 'error',
      message: cause instanceof Error ? cause.message : 'Failed to load activity',
    });
  }
}
