// W9c Z13-b · /missions/[id] — Mission Deliberation Room route (server shell).
//
// Static-export note (Next 15 + `output: 'export'`): a dynamic route
// must export `generateStaticParams` so the build can decide what to
// prerender, and that export is only valid in a Server Component. The
// real UI lives in `mission-room-client.tsx` (`'use client'`); this
// file is a thin server shell that prerenders a single sentinel slug.
// The daemon's static-app SPA fallback
// (`src/nexus/api/static-app.ts:76-77`) rewrites unknown `/app/*`
// paths to the root `index.html`, and the client component's
// `useParams` resolves the real id at runtime.

import MissionRoomClient from './mission-room-client';

export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: 'placeholder' }];
}

export default function MissionRoomPage(): React.ReactElement {
  return <MissionRoomClient />;
}
