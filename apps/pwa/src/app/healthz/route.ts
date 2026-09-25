// PWA · /healthz endpoint (NEXUS PR η — supervisor health probe target)
//
// NEXUS's pwa-host kind sends `GET /healthz` every 5s to decide whether
// the dev/build server is responsive. Returns 200 + `{ ok: true }` so
// the supervisor can flip the tab status to `active` once Next.js has
// finished its first compile.

export const dynamic = 'force-static';

export function GET(): Response {
  return Response.json({ ok: true, ts: Date.now() });
}
