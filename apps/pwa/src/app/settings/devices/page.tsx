'use client';

// W9c Z13-d · /settings/devices — Device fleet + capability matrix.

import { useMemo } from 'react';
import { DeviceFleetTable } from '@/components/devices/DeviceFleetTable';
import { createDevicesApi } from '@/lib/devices-api';

export default function DevicesSettingsPage() {
  // SSG prerender (Next 15 `output: 'export'`) runs this on the server
  // where `window` is undefined. Empty baseUrl is fine — the api
  // helper concatenates baseUrl + path, so a missing origin yields a
  // relative URL and fetch picks up same-origin at runtime.
  const api = useMemo(
    () => createDevicesApi({ baseUrl: typeof window !== 'undefined' ? window.location.origin : '' }),
    [],
  );
  return (
    <section className="flex flex-col gap-4 p-4">
      <header>
        <h1 className="text-lg font-semibold">Device fleet</h1>
        <p className="text-xs opacity-70">
          Detected Apple devices · OMF v1 templates use this to decide which capabilities
          to fire vs gracefully degrade. iPhone-only fleets still get full template value
          via the fallback chain.
        </p>
      </header>
      <DeviceFleetTable api={api} />
    </section>
  );
}
