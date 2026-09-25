'use client';

import { useEffect, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import type { DaemonClient } from '@/lib/daemon-client';
import { usePersonas } from '@/lib/showroom/use-personas';
import { InvestorRounds, AssistantRounds, NewsbotRounds } from './BotRounds';

interface BotCommandArgument {
  name: string;
  description: string;
  required: boolean;
}

interface BotCommand {
  name: string;
  description: string;
  arguments: readonly BotCommandArgument[];
}

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; commands: readonly BotCommand[] }
  | { kind: 'error'; reason: string };

function errorReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Unknown error';
}

async function loadBotCatalog(
  client: Pick<DaemonClient, 'fetchJson'>,
): Promise<CatalogState> {
  try {
    const commands = await client.fetchJson<BotCommand[]>('/v1/bots/commands');
    return { kind: 'ready', commands };
  } catch (error) {
    return { kind: 'error', reason: errorReason(error) };
  }
}

export function BotsPanel({ client }: { client: DaemonClient }) {
  const personas = usePersonas(client);
  const [catalog, setCatalog] = useState<CatalogState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    setCatalog({ kind: 'loading' });
    void loadBotCatalog(client).then((next) => {
      if (active) setCatalog(next);
    });
    return () => {
      active = false;
    };
  }, [client]);

  const personaFailure = personas.error;
  const catalogFailure = catalog.kind === 'error' ? catalog.reason : null;
  const hasFailure = personaFailure !== null || catalogFailure !== null;
  const loading = !hasFailure && (personas.loading || catalog.kind === 'loading');
  const commands = catalog.kind === 'ready' ? catalog.commands : [];
  const ready = !loading && !hasFailure;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 sm:px-10" data-testid="bots-panel">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Bot directory</p>
        <h1 className="mt-2 text-3xl font-bold">Bots</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Commands are global: every bot exposes the same catalog.
        </p>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          This surface cannot send commands yet; it only shows what you can ask bots to do.
        </p>
      </header>

      {loading && <p role="status" className="text-sm text-muted-foreground">Loading bot identities and command catalog…</p>}
      {personaFailure && <p role="alert" className="text-sm text-destructive">Unable to load bot identities: {personaFailure}</p>}
      {catalogFailure && <p role="alert" className="text-sm text-destructive">Unable to load bot catalog: {catalogFailure}</p>}
      {ready && personas.personas.length === 0 && <p className="text-sm text-muted-foreground">No bots are configured.</p>}
      {ready && personas.personas.length > 0 && commands.length === 0 && <p className="text-sm text-muted-foreground">No bot commands are available.</p>}

      {/* 📈 봇이 «실제로 낸» 산출 — 명령 카탈로그 «위»에 둔다.

          🔑 44차 실측: 이 화면엔 investor 문면이 «0건»이었다(카탈로그만 그렸다).

          ⛔ 라우트(/v1/bots/rounds)는 🅣 소유라 «없을 수» 있다 — 그때 이 자리가

             «조용히 비지 않고» 「못 받았다」고 말한다(InvestorRounds 가 그 규율을 갖는다). */}

      <InvestorRounds client={client} />
      <AssistantRounds client={client} />
      <NewsbotRounds client={client} />


      {ready && personas.personas.length > 0 && commands.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2" aria-label="Bot identities">
          {personas.personas.map((persona) => (
            <article key={persona.personaId} className="rounded-xl border border-border bg-card p-5" data-testid={`bot-card-${persona.personaId}`}>
              <h2 className="text-lg font-semibold">{persona.displayName}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{persona.description ?? 'No description provided.'}</p>
              <h3 className="mt-5 text-sm font-semibold">Available commands</h3>
              <ul className="mt-3 space-y-3" aria-label="Available bot commands">
                {commands.map((command) => (
                  <li key={command.name} className="rounded-lg border border-border bg-background/60 p-3">
                    <h4 className="font-mono text-sm font-semibold">{command.name}</h4>
                    <p className="mt-1 text-sm text-muted-foreground">{command.description}</p>
                    {command.arguments.length > 0 ? (
                      <ul className="mt-2 space-y-1" aria-label={`${command.name} arguments`}>
                        {command.arguments.map((argument) => (
                          <li key={argument.name} className="text-xs text-muted-foreground">
                            <code className="font-semibold text-foreground">{argument.name}</code>
                            {argument.required ? ' (required)' : ' (optional)'} — {argument.description}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">No arguments.</p>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

export function BotsPageContent() {
  const { client } = useDaemon();
  return <BotsPanel client={client} />;
}
