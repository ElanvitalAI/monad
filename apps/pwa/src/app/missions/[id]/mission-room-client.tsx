'use client';

// W9c Z13-b · /missions/[id] — Mission Deliberation Room client component.
// Split out of page.tsx so the route can also export
// `generateStaticParams` (server-only) for Next 15's `output: 'export'`.

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { MissionRoomPanel } from '@/components/missions';
import { createMissionRoomApi } from '@/lib/mission-room-api';

export default function MissionRoomClient() {
  const params = useParams<{ id: string }>();
  const missionId = decodeURIComponent(params?.id ?? '');
  // SSG prerender runs this on the server where `window` is undefined.
  // Empty baseUrl yields a relative URL — fetch resolves same-origin
  // at runtime.
  const api = useMemo(
    () => createMissionRoomApi({ baseUrl: typeof window !== 'undefined' ? window.location.origin : '' }),
    [],
  );
  if (!missionId) {
    return <div className="p-4 text-sm">Mission id missing in URL.</div>;
  }
  return <MissionRoomPanel missionId={missionId} api={api} />;
}
