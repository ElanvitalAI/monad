// Root `/app` route. Pre-2026-05-09 this did `redirect('/chat')`
// (Phase 2 chat↔voice unification — voice folded into ChatLayout's
// mic toggle so /chat became the natural home). Post-CV-3 dogfood
// the redirect was reverted: first-time tailnet visitors landing
// on `/app` benefit from a basic welcome surface that surfaces the
// other primary routes (showroom · workspace · term · tasks ·
// settings) instead of being thrown into chat with no context.
//
// AppShell sidebar still mounts on every route, so users who
// prefer the old /chat default reach it via the sidebar in one tap.

import { WelcomeHome } from '@/components/welcome/WelcomeHome';

export default function RootPage() {
  return <WelcomeHome />;
}
