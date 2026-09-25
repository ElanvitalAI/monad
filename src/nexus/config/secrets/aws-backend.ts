// NEXUS · AWS Secrets Manager backend (Phase N-3.5 PR υ)
//
// Wraps `@aws-sdk/client-secrets-manager`. Lazy-imported so the SDK
// is only loaded when this backend is actually selected.
//
// Auth: standard AWS SDK chain (env vars · ~/.aws/credentials · IAM role).
// Region: required either via `global.secrets.aws.region` switch or env
// (AWS_REGION / AWS_DEFAULT_REGION).
//
// Optional `secretPrefix` namespaces NEXUS-managed secrets (default
// "monad/") so the user can scope IAM policies.

import type { SecretBackend, SecretBackendAvailability } from './types.js';

export interface AwsBackendOpts {
  region?: string;
  /** Default 'monad/'. Set to '' to disable prefixing. */
  secretPrefix?: string;
  /** Optional KMS key ARN/alias for at-rest encryption (otherwise AWS-managed). */
  kmsKeyId?: string;
  /** Test seam — replaces the SDK client. */
  clientFactory?: () => AwsSecretsClientLike;
}

export interface AwsSecretsClientLike {
  send(cmd: { name: string; input: Record<string, unknown> }): Promise<unknown>;
}

const DEFAULT_PREFIX = 'monad/';

export function createAwsBackend(opts: AwsBackendOpts = {}): SecretBackend {
  const prefix = opts.secretPrefix ?? DEFAULT_PREFIX;
  const fullId = (id: string) => `${prefix}${id}`;
  const stripPrefix = (name: string) => prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;

  let cachedClient: AwsSecretsClientLike | null = null;
  async function getClient(): Promise<AwsSecretsClientLike> {
    if (cachedClient) return cachedClient;
    if (opts.clientFactory) {
      cachedClient = opts.clientFactory();
      return cachedClient;
    }
    const sdk = await import('@aws-sdk/client-secrets-manager').catch(() => null);
    if (!sdk) throw new Error('@aws-sdk/client-secrets-manager not installed');
    const Sdk = sdk as typeof import('@aws-sdk/client-secrets-manager');
    cachedClient = new Sdk.SecretsManagerClient({
      ...(opts.region ? { region: opts.region } : {}),
    }) as unknown as AwsSecretsClientLike;
    return cachedClient;
  }

  return {
    id: 'aws',
    async isAvailable(): Promise<SecretBackendAvailability> {
      const region = opts.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
      if (!region) return { ok: false, reason: 'AWS region not set (global.secrets.aws.region or AWS_REGION)' };
      try {
        await getClient();
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
      return { ok: true };
    },
    async get(id) {
      const client = await getClient();
      const sdk = await loadSdk();
      try {
        const res = (await client.send(new sdk.GetSecretValueCommand({ SecretId: fullId(id) }) as unknown as { name: string; input: Record<string, unknown> })) as { SecretString?: string };
        return res.SecretString;
      } catch (err) {
        if (isResourceNotFound(err)) return undefined;
        throw err;
      }
    },
    async set(id, value) {
      const client = await getClient();
      const sdk = await loadSdk();
      try {
        await client.send(new sdk.UpdateSecretCommand({
          SecretId: fullId(id),
          SecretString: value,
          ...(opts.kmsKeyId ? { KmsKeyId: opts.kmsKeyId } : {}),
        }) as unknown as { name: string; input: Record<string, unknown> });
        return;
      } catch (err) {
        if (!isResourceNotFound(err)) throw err;
      }
      await client.send(new sdk.CreateSecretCommand({
        Name: fullId(id),
        SecretString: value,
        ...(opts.kmsKeyId ? { KmsKeyId: opts.kmsKeyId } : {}),
      }) as unknown as { name: string; input: Record<string, unknown> });
    },
    async delete(id) {
      const client = await getClient();
      const sdk = await loadSdk();
      try {
        await client.send(new sdk.DeleteSecretCommand({
          SecretId: fullId(id),
          ForceDeleteWithoutRecovery: true,
        }) as unknown as { name: string; input: Record<string, unknown> });
        return true;
      } catch (err) {
        if (isResourceNotFound(err)) return false;
        throw err;
      }
    },
    async list() {
      const client = await getClient();
      const sdk = await loadSdk();
      const out: string[] = [];
      let nextToken: string | undefined;
      while (true) {
        const res = (await client.send(new sdk.ListSecretsCommand({
          MaxResults: 100,
          ...(nextToken ? { NextToken: nextToken } : {}),
        }) as unknown as { name: string; input: Record<string, unknown> })) as {
          SecretList?: Array<{ Name?: string }>;
          NextToken?: string;
        };
        for (const item of res.SecretList ?? []) {
          if (item.Name && (!prefix || item.Name.startsWith(prefix))) {
            out.push(stripPrefix(item.Name));
          }
        }
        nextToken = res.NextToken;
        if (!nextToken) break;
      }
      return out;
    },
  };
}

async function loadSdk(): Promise<typeof import('@aws-sdk/client-secrets-manager')> {
  const sdk = await import('@aws-sdk/client-secrets-manager').catch(() => null);
  if (!sdk) throw new Error('@aws-sdk/client-secrets-manager not installed');
  return sdk as typeof import('@aws-sdk/client-secrets-manager');
}

function isResourceNotFound(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; __type?: string };
  return e.name === 'ResourceNotFoundException' || e.__type === 'ResourceNotFoundException';
}
