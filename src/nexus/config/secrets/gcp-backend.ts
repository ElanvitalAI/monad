// NEXUS · GCP Secret Manager backend (Phase N-3.5 PR υ)
//
// Wraps `@google-cloud/secret-manager`. Lazy-imported.
// Auth: Application Default Credentials (gcloud auth application-default
// login · service account key · workload identity).
// Project: required via `global.secrets.gcp.projectId`.

import type { SecretBackend, SecretBackendAvailability } from './types.js';

export interface GcpBackendOpts {
  projectId?: string;
  /** Replication policy for newly-created secrets. Default 'automatic'. */
  replication?: 'automatic' | 'user-managed';
  /** Test seam. */
  clientFactory?: () => GcpSecretClientLike;
}

// Minimal client shape we depend on.
export interface GcpSecretClientLike {
  accessSecretVersion(req: { name: string }): Promise<[{ payload?: { data?: Uint8Array } }]>;
  createSecret(req: { parent: string; secretId: string; secret: { replication: unknown } }): Promise<unknown>;
  addSecretVersion(req: { parent: string; payload: { data: Buffer } }): Promise<unknown>;
  deleteSecret(req: { name: string }): Promise<unknown>;
  listSecrets(req: { parent: string; pageSize?: number }): Promise<[Array<{ name?: string }>]>;
}

export function createGcpBackend(opts: GcpBackendOpts): SecretBackend {
  const projectId = opts.projectId;
  const replicationField = opts.replication === 'user-managed'
    ? { userManaged: { replicas: [] } }
    : { automatic: {} };

  let cachedClient: GcpSecretClientLike | null = null;
  async function getClient(): Promise<GcpSecretClientLike> {
    if (cachedClient) return cachedClient;
    if (opts.clientFactory) {
      cachedClient = opts.clientFactory();
      return cachedClient;
    }
    const sdk = await import('@google-cloud/secret-manager').catch(() => null);
    if (!sdk) throw new Error('@google-cloud/secret-manager not installed');
    cachedClient = new (sdk as typeof import('@google-cloud/secret-manager')).SecretManagerServiceClient() as unknown as GcpSecretClientLike;
    return cachedClient;
  }

  function parent(): string {
    if (!projectId) throw new Error('GCP projectId required (global.secrets.gcp.projectId)');
    return `projects/${projectId}`;
  }
  function secretName(id: string): string { return `${parent()}/secrets/${id}`; }
  function secretVersionName(id: string): string { return `${secretName(id)}/versions/latest`; }

  return {
    id: 'gcp',
    async isAvailable(): Promise<SecretBackendAvailability> {
      if (!projectId) return { ok: false, reason: 'global.secrets.gcp.projectId required' };
      try { await getClient(); }
      catch (err) { return { ok: false, reason: (err as Error).message }; }
      return { ok: true };
    },
    async get(id) {
      const client = await getClient();
      try {
        const [res] = await client.accessSecretVersion({ name: secretVersionName(id) });
        const data = res.payload?.data;
        if (!data) return undefined;
        return Buffer.from(data).toString('utf-8');
      } catch (err) {
        if (isNotFound(err)) return undefined;
        throw err;
      }
    },
    async set(id, value) {
      const client = await getClient();
      // Ensure secret exists, then add a new version.
      try {
        await client.createSecret({
          parent: parent(),
          secretId: id,
          secret: { replication: replicationField },
        });
      } catch (err) {
        if (!isAlreadyExists(err)) throw err;
      }
      await client.addSecretVersion({
        parent: secretName(id),
        payload: { data: Buffer.from(value, 'utf-8') },
      });
    },
    async delete(id) {
      const client = await getClient();
      try {
        await client.deleteSecret({ name: secretName(id) });
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
    async list() {
      const client = await getClient();
      const out: string[] = [];
      const [items] = await client.listSecrets({ parent: parent(), pageSize: 100 });
      for (const item of items) {
        if (!item.name) continue;
        const tail = item.name.split('/').pop();
        if (tail) out.push(tail);
      }
      return out;
    },
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { code?: number };
  return e.code === 5 /* NOT_FOUND */;
}

function isAlreadyExists(err: unknown): boolean {
  const e = err as { code?: number };
  return e.code === 6 /* ALREADY_EXISTS */;
}
