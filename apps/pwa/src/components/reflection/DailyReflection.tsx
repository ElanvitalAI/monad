'use client';

// R6.4 — daily reflection view.
//
// Pure presentational; the surrounding panel owns the fetch.
// Splitting keeps the structural test cheap (no DaemonProvider
// mocks needed) and makes the LLM Hansei polish layer (R6 v2) a
// drop-in replacement that wraps the same snapshot.
//
// Cross-ref:
//   src/notes/daily-reflection.ts (DailyReflectionSnapshot)
//   apps/pwa/src/components/reflection/DailyReflectionPanel.tsx
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R6

export interface DailyReflectionData {
  date: string;
  notesSaved: number;
  ocrRuns: number;
  sessionsToday: number;
  topSessions: Array<{
    id: string;
    msgCount: number;
    lastTurnAt: string;
    lastMsgPreview?: string;
  }>;
  generatedAt: string;
}

interface Props {
  snapshot: DailyReflectionData;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function DailyReflection({ snapshot }: Props) {
  const empty =
    snapshot.notesSaved === 0 &&
    snapshot.ocrRuns === 0 &&
    snapshot.sessionsToday === 0;

  return (
    <article
      data-testid="daily-reflection"
      data-date={snapshot.date}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-base font-medium" data-testid="reflection-date">
          {snapshot.date}
        </h2>
        <p className="text-xs text-muted-foreground" data-testid="reflection-generated-at">
          생성 {fmtTime(snapshot.generatedAt)}
        </p>
      </header>

      {empty ? (
        <p
          data-testid="reflection-empty"
          className="rounded-md bg-muted/50 px-3 py-4 text-center text-sm text-muted-foreground"
        >
          오늘 기록된 활동이 없습니다.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md bg-muted/30 px-3 py-2 text-center">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                노트 저장
              </dt>
              <dd className="font-mono text-lg" data-testid="reflection-notes-saved">
                {snapshot.notesSaved}
              </dd>
            </div>
            <div className="rounded-md bg-muted/30 px-3 py-2 text-center">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                OCR 실행
              </dt>
              <dd className="font-mono text-lg" data-testid="reflection-ocr-runs">
                {snapshot.ocrRuns}
              </dd>
            </div>
            <div className="rounded-md bg-muted/30 px-3 py-2 text-center">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                세션
              </dt>
              <dd className="font-mono text-lg" data-testid="reflection-sessions-today">
                {snapshot.sessionsToday}
              </dd>
            </div>
          </dl>

          {snapshot.topSessions.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                활성 세션 Top {snapshot.topSessions.length}
              </h3>
              <ul
                data-testid="reflection-top-sessions"
                className="flex flex-col gap-2 text-xs"
              >
                {snapshot.topSessions.map((s) => (
                  <li
                    key={s.id}
                    data-testid="reflection-session-row"
                    data-session-id={s.id}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="truncate font-mono text-[11px]">{s.id}</code>
                      <span className="shrink-0 text-muted-foreground">
                        msgs {s.msgCount}
                      </span>
                    </div>
                    {s.lastMsgPreview && (
                      <p className="mt-1 line-clamp-2 text-muted-foreground">
                        {s.lastMsgPreview}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}
