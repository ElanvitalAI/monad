'use client';

// V2.2-2 (2026-05-12) — hosted chat page entry. Static export friendly
// (the workflow name is carried as a `?workflow=<name>` query param
// rather than a dynamic route segment so Next 15 + `output: 'export'`
// can pre-render this single page at build time). Suspense wrap is
// required because the child reads `useSearchParams()`.

import { Suspense } from 'react';
import { HostedChatPanel } from '@/components/workflows/HostedChatPanel';

export default function HostedChatPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading workflow chat…</div>}>
      <HostedChatPanel />
    </Suspense>
  );
}
