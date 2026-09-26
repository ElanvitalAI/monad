'use client';

// W9c Z13-d · Device fleet table — renders `GET /v1/devices` result.

import { useEffect, useState, type ReactElement } from 'react';
import type { DevicesApiClient, DeviceFleetSnapshot } from '@/lib/devices-api';
import { DevicesApiError } from '@/lib/devices-api';

export interface DeviceFleetTableProps {
  api: DevicesApiClient;
}

export function DeviceFleetTable({ api }: DeviceFleetTableProps): ReactElement {
  const [snapshot, setSnapshot] = useState<DeviceFleetSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.fleet()
      .then((s) => { if (!cancelled) { setSnapshot(s); setLoading(false); } })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof DevicesApiError ? `(${err.status}) ${err.path}` : String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [api]);

  if (loading) return <div className="text-sm opacity-70">Loading device fleet…</div>;
  if (error) return <div role="alert" className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</div>;
  if (!snapshot) return <div className="text-sm opacity-70">No fleet data.</div>;

  if (snapshot.totalDevices === 0) {
    return (
      <div className="rounded border border-zinc-200 bg-zinc-50 p-4 text-sm">
        <p className="font-medium">No Apple devices detected yet.</p>
        <p className="mt-1 opacity-70">
          The iOS Companion writes <code>~/.elanous/devices.json</code> on iCloud sync.
          Install it on at least one Apple device to populate this list.
        </p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <caption className="text-xs opacity-60 text-left mb-2">
        snapshot @ {new Date(snapshot.snapshotAt).toLocaleString()} · {snapshot.totalDevices} devices
      </caption>
      <thead>
        <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide opacity-70">
          <th className="text-left py-1">kind</th>
          <th className="text-right py-1">count</th>
          <th className="text-left py-1 pl-3">capabilities</th>
        </tr>
      </thead>
      <tbody>
        {snapshot.kinds.map((row) => (
          <tr key={row.kind} className="border-b border-zinc-100 align-top">
            <td className="py-1 font-medium">{row.kind}</td>
            <td className="py-1 text-right tabular-nums">{row.count}</td>
            <td className="py-1 pl-3 text-xs">
              {row.capabilities.length === 0
                ? <span className="opacity-50">(none advertised)</span>
                : row.capabilities.map((c) => (
                    <span key={c} className="mr-1 inline-block rounded bg-zinc-100 px-1.5 py-0.5">{c}</span>
                  ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
