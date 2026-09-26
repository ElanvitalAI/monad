import { createHash } from 'node:crypto';
import { s3ElanousKey } from '../storage/s3.js';

export type AssetVendor = 'higgsfield' | 'topview';

export interface RemoteAsset {
  readonly beatIndex: number;
  readonly vendor: AssetVendor;
  readonly url: string;
  readonly createdAt?: string;
}

export interface RetainCommand {
  readonly beatIndex: number;
  readonly download: readonly string[];
  readonly localPath: string;
  readonly s3Key: string;
}

export interface RetainPlan {
  readonly commands: readonly RetainCommand[];
  readonly estimatedExpiry: readonly { readonly beatIndex: number; readonly expiresAtIso: string; readonly basis: string }[];
  readonly expiredEstimatedExpiry: readonly number[];
  readonly unknownExpiry: readonly number[];
  readonly blocked: readonly string[];
  /** Present when S3 was unavailable; the local download still ran. */
  readonly s3Skipped: boolean;
}

export interface BuildRetainPlanOptions {
  readonly workDir: string;
  readonly s3Available: boolean;
  readonly now: string;
  readonly retentionDays?: Readonly<Record<AssetVendor, number>>;
}

const DEFAULT_RETENTION_DAYS: Readonly<Record<AssetVendor, number>> = {
  higgsfield: 30,
  topview: 7,
};

const EXPIRY_BASIS: Readonly<Record<AssetVendor, string>> = {
  higgsfield: 'Higgsfield production CLI playbook: generated assets are deleted after 30 days.',
  topview: 'Topview API storage documentation: produced video and image URLs are valid for 7 days only.',
};

function pathIn(workDir: string, name: string): string {
  return `${workDir.replace(/\/$/, '')}/${name}`;
}

function extensionFrom(url: string): string {
  const pathname = url.split(/[?#]/, 1)[0] ?? '';
  const extension = pathname.match(/\.([A-Za-z0-9]{2,5})$/)?.[1];
  return extension ? `.${extension}` : '.mp4';
}

const ISO_DATE_TIME_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDate(value: string): number | undefined {
  const match = ISO_DATE_TIME_WITH_TIMEZONE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function remoteUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function isoTimestamp(timestamp: number): string | undefined {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function assetIdentity(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

function expiryBasis(vendor: AssetVendor, retentionDays: number, usesDefaultRetention: boolean): string {
  return usesDefaultRetention
    ? `${EXPIRY_BASIS[vendor]} Estimated from createdAt plus ${retentionDays} days.`
    : `User-configured retention estimate: createdAt plus ${retentionDays} days.`;
}

export function buildRetainPlan(
  assets: readonly RemoteAsset[],
  options: BuildRetainPlanOptions,
): RetainPlan {
  const nowTimestamp = validDate(options.now);
  if (nowTimestamp === undefined) {
    return { commands: [], estimatedExpiry: [], expiredEstimatedExpiry: [], unknownExpiry: [], blocked: ['invalid-now'], s3Skipped: !options.s3Available };
  }

  const commands: RetainCommand[] = [];
  const estimatedExpiry: RetainPlan['estimatedExpiry'][number][] = [];
  const expiredEstimatedExpiry: number[] = [];
  const unknownExpiry: number[] = [];
  const blocked: string[] = [];

  for (const asset of assets) {
    const configuredRetentionDays = options.retentionDays?.[asset.vendor];
    const usesDefaultRetention = configuredRetentionDays === undefined;
    const retentionDays = configuredRetentionDays ?? DEFAULT_RETENTION_DAYS[asset.vendor];
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      blocked.push(`invalid-retention-days:${asset.vendor}`);
      continue;
    }

    if (asset.createdAt === undefined) {
      unknownExpiry.push(asset.beatIndex);
    } else {
      const createdAt = validDate(asset.createdAt);
      if (createdAt === undefined) {
        blocked.push(`invalid-created-at:beat-${asset.beatIndex}`);
        continue;
      }
      if (createdAt > nowTimestamp) {
        blocked.push(`created-at-after-now:beat-${asset.beatIndex}`);
        continue;
      }
      const expiresAtIso = isoTimestamp(createdAt + retentionDays * 86_400_000);
      if (!expiresAtIso) {
        blocked.push(`expiry-out-of-range:beat-${asset.beatIndex}`);
        continue;
      }
      estimatedExpiry.push({
        beatIndex: asset.beatIndex,
        expiresAtIso,
        basis: expiryBasis(asset.vendor, retentionDays, usesDefaultRetention),
      });
      if (Date.parse(expiresAtIso) < nowTimestamp) {
        expiredEstimatedExpiry.push(asset.beatIndex);
      }
    }

    const url = remoteUrl(asset.url);
    if (!url) {
      blocked.push(`invalid-remote-url:beat-${asset.beatIndex}`);
      continue;
    }
    const extension = extensionFrom(url.href);
    const identity = assetIdentity(url.href);
    const localPath = pathIn(options.workDir, `beat-${asset.beatIndex}-${asset.vendor}-${identity}${extension}`);
    commands.push({
      beatIndex: asset.beatIndex,
      download: ['curl', '-fsSL', '--globoff', '--create-dirs', '-o', localPath, '--', url.href],
      localPath,
      s3Key: s3ElanousKey('adAssets', asset.vendor, `beat-${asset.beatIndex}-${identity}${extension}`),
    });
  }

  return { commands, estimatedExpiry, expiredEstimatedExpiry, unknownExpiry, blocked, s3Skipped: !options.s3Available };
}
