'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DaemonTerminalSummary } from '@/lib/daemon-client';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { termPtySelectionHref } from './pty-selection-url';

const PTY_QUERY_KEY = 'pty';

function TerminalPageContents(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialPtyId = searchParams?.get(PTY_QUERY_KEY) || null;
  const handlePtySelection = useCallback((terminal: DaemonTerminalSummary): void => {
    const href = termPtySelectionHref(window.location.href, terminal.id);
    if (href !== null) router.replace(href);
  }, [router]);

  return <TerminalPanel initialPtyId={initialPtyId} onPtySelection={handlePtySelection} />;
}

export default function TerminalPage(): React.ReactElement {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">loading…</div>}>
      <TerminalPageContents />
    </Suspense>
  );
}
