// PWA · channel-bot tab detail (Phase N-4 PR π · T2.A setup card mirror)

'use client';

import type { NexusTabState } from '../../types';
import {
  ChannelBotSetupCard,
  type ChannelBotPlatform,
} from '@/components/nexus/ChannelBotSetupCard';

function isChannelBotPlatform(value: unknown): value is ChannelBotPlatform {
  return value === 'telegram' || value === 'discord';
}

export function ChannelBotDetail({ tab }: { tab: NexusTabState }) {
  const meta = tab.spec.meta as { platform?: string; tokenEnvName?: string; disabled?: boolean; lockPath?: string } | undefined;
  const isAuthCrash = tab.status === 'crashed' && /401|403|Unauthorized|Invalid token/.test(tab.lastError ?? '');
  const platform = isChannelBotPlatform(meta?.platform) ? meta.platform : null;
  return (
    <div className="text-sm space-y-2">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">platform</dt>
        <dd>{meta?.platform ?? '—'}</dd>
        <dt className="text-muted-foreground">token env</dt>
        <dd className="font-mono break-all">
          {meta?.tokenEnvName ?? '—'}
          {meta?.disabled ? <span className="ml-2 text-amber-600">(missing — set in env or via secret modal)</span> : null}
        </dd>
        <dt className="text-muted-foreground">lock</dt>
        <dd className="font-mono break-all">{meta?.lockPath ?? '—'}</dd>
      </dl>
      {/* T2.A — rich setup card replaces the prior 1-line warning. */}
      {meta?.disabled && platform && <ChannelBotSetupCard platform={platform} />}
      {meta?.disabled && !platform && (
        <div className="border border-amber-300 bg-amber-50 text-amber-800 rounded p-3 text-xs">
          ⚠ Token missing — restart this tab after setting{' '}
          <code>{meta.tokenEnvName}</code>.
        </div>
      )}
      {isAuthCrash && (
        <div className="border border-rose-300 bg-rose-50 text-rose-800 rounded p-3 text-xs">
          ✕ Auth failed (401/403). Rotate the token and restart this tab.
        </div>
      )}
      {tab.status === 'external' && (
        <div className="border border-purple-300 bg-purple-50 text-purple-800 rounded p-3 text-xs">
          ⚠ Another {meta?.platform ?? 'channel'} bot is already running
          (pid {tab.pid ?? '?'}). Stop it before NEXUS takes over.
        </div>
      )}
    </div>
  );
}
