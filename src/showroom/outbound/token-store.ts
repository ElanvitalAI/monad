// W7 Z11.a-1 · device token store — in-memory by default.
// iOS app · Watch · CarPlay 등이 `POST /v1/devices/tokens` 로 등록.
// Production wire 는 sqlite 또는 keychain 으로 교체 가능 (interface 만 노출).

import type { OutboundChannelName } from './types.js';

export interface DeviceTokenRecord {
  channel: OutboundChannelName;
  /** Caller-supplied stable device id (Apple deviceCheck, vendorId 등). */
  deviceId: string;
  /** Opaque token (APNs / ActivityKit / WatchKit push token). */
  token: string;
  /** UTC ms epoch when last registered. Used for staleness pruning. */
  registeredAt: number;
  /** Optional metadata (model, os version) — channel-specific. */
  meta?: Record<string, unknown>;
}

export interface DeviceTokenStore {
  upsert(record: DeviceTokenRecord): void;
  delete(channel: OutboundChannelName, deviceId: string): boolean;
  list(channel: OutboundChannelName): DeviceTokenRecord[];
  count(channel: OutboundChannelName): number;
  prune(beforeTs: number): number;
}

export class InMemoryDeviceTokenStore implements DeviceTokenStore {
  private rows = new Map<string, DeviceTokenRecord>();

  private key(channel: OutboundChannelName, deviceId: string): string {
    return `${channel}::${deviceId}`;
  }

  upsert(record: DeviceTokenRecord): void {
    this.rows.set(this.key(record.channel, record.deviceId), { ...record });
  }

  delete(channel: OutboundChannelName, deviceId: string): boolean {
    return this.rows.delete(this.key(channel, deviceId));
  }

  list(channel: OutboundChannelName): DeviceTokenRecord[] {
    const out: DeviceTokenRecord[] = [];
    for (const r of this.rows.values()) {
      if (r.channel === channel) out.push({ ...r });
    }
    return out;
  }

  count(channel: OutboundChannelName): number {
    let n = 0;
    for (const r of this.rows.values()) if (r.channel === channel) n += 1;
    return n;
  }

  prune(beforeTs: number): number {
    let pruned = 0;
    for (const [k, r] of this.rows.entries()) {
      if (r.registeredAt < beforeTs) {
        this.rows.delete(k);
        pruned += 1;
      }
    }
    return pruned;
  }
}
