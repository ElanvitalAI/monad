'use client';

import Link from 'next/link';
import { activityAriaLabel, type ShellActivitySnapshot } from './activity-snapshot';

export function TopBarActivityIndicator({
  snapshot,
}: {
  snapshot: ShellActivitySnapshot;
}) {
  if (snapshot.kind === 'quiet' || snapshot.kind === 'loading') return null;

  if (snapshot.kind === 'error') {
    return (
      <span
        role="alert"
        data-elanous-component="topbar-activity"
        data-activity-kind="error"
        title={snapshot.message}
        className="max-w-[9rem] shrink-0 truncate rounded px-1.5 py-0.5 text-[10px] text-rose-500 sm:max-w-[16rem]"
      >
        activity error
      </span>
    );
  }

  const label = activityAriaLabel(snapshot);
  return (
    <Link
      href={snapshot.run.href}
      aria-label={label}
      title={label}
      data-elanous-component="topbar-activity"
      data-activity-kind="active"
      data-run-id={snapshot.run.runId}
      className="flex min-w-0 max-w-[7.5rem] shrink items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:bg-accent sm:max-w-[18rem]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="hidden uppercase tracking-wide sm:inline">LIVE</span>
      <span className="min-w-0 truncate">{snapshot.run.runId}</span>
      {snapshot.run.progressLine && (
        <span className="hidden min-w-0 truncate text-muted-foreground md:inline">
          {snapshot.run.progressLine}
        </span>
      )}
      {snapshot.extraLiveCount > 0 && (
        <span className="shrink-0 text-muted-foreground">+{snapshot.extraLiveCount}</span>
      )}
    </Link>
  );
}
