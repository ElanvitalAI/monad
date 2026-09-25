'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  IntakeAction,
  IntakeDetail as IntakeDetailT,
  IntakeEvent,
  IntakeReviewView,
} from '@/lib/intake-api';
import { toast } from 'sonner';

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface Props {
  detail: IntakeDetailT;
  view: IntakeReviewView['view'];
  events: IntakeEvent[];
  onAnswer: (questionId: string, answer: string) => Promise<void>;
  onAction: (action: IntakeAction) => Promise<void>;
  onReplay: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onBack: () => void;
}

export function IntakeDetail(props: Props) {
  const { detail, view, events, onAnswer, onAction, onReplay, onRefresh, onBack } = props;
  const body = view?.config?.body ?? '';
  const questions = view?.config?.questions ?? [];
  const actions = view?.config?.actions ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← List
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={onReplay}>
          Replay
        </Button>
      </div>

      <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="text-base font-semibold">
          {view?.chrome?.title ?? detail.intakeId}
        </h2>
        <div className="mt-1 font-mono text-[11px] text-muted-foreground">
          {detail.intakeId} · {detail.state} · {detail.source}
        </div>
        {body && (
          <pre className="mt-3 whitespace-pre-wrap break-words text-sm text-foreground/90">
            {body}
          </pre>
        )}
      </article>

      {questions.map((q) => (
        <QuestionForm
          key={q.id}
          questionId={q.id}
          title={q.title}
          placeholder={q.inputType?.placeholder}
          onSubmit={async (answer) => {
            try {
              await onAnswer(q.id, answer);
              toast.success('Answer saved');
            } catch (err) {
              toast.error(`answer failed: ${err instanceof Error ? err.message : err}`);
            }
          }}
        />
      ))}

      {actions.length > 0 && (
        <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-medium">Next actions</h3>
          <div className="flex flex-wrap gap-2">
            {actions.map((a, idx) => (
              <Button
                key={`${a.label}-${idx}`}
                size="sm"
                variant={idx === 0 ? 'default' : 'outline'}
                onClick={async () => {
                  try {
                    await onAction(a);
                  } catch (err) {
                    toast.error(`action failed: ${err instanceof Error ? err.message : err}`);
                  }
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </article>
      )}

      {detail.raw?.text && (
        <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-medium">Raw note</h3>
          <pre className="whitespace-pre-wrap break-words text-sm text-foreground/80">
            {detail.raw.text}
          </pre>
        </article>
      )}

      {(detail.raw?.attachments?.length ?? 0) > 0 && (
        <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-medium">Attachments</h3>
          <ul className="space-y-2">
            {detail.raw!.attachments!.map((a, i) => (
              <li key={i} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
                <div className="font-medium">{a.name ?? '(unnamed attachment)'}</div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  {a.kind}
                  {a.mimeType ? ` · ${a.mimeType}` : ''}
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{a.localPath}</div>
              </li>
            ))}
          </ul>
        </article>
      )}

      <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-medium">Lifecycle</h3>
        {events.length === 0 ? (
          <div className="text-xs text-muted-foreground">No intake events recorded.</div>
        ) : (
          <ul className="space-y-2">
            {events.map((ev, i) => (
              <li
                key={i}
                className="rounded-md border border-border bg-background/60 px-3 py-2"
              >
                <div className="font-mono text-[11px] text-muted-foreground">
                  {ev.kind} · {relTime(ev.createdAt)} · {ev.state}
                </div>
                {ev.detail !== undefined && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(ev.detail, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}

function QuestionForm({
  questionId,
  title,
  placeholder,
  onSubmit,
}: {
  questionId: string;
  title: string;
  placeholder?: string;
  onSubmit: (answer: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState('');
  return (
    <form
      className="space-y-2 rounded-lg border border-border bg-card p-4 shadow-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        await onSubmit(v);
        setValue('');
      }}
    >
      <label htmlFor={`q-${questionId}`} className="block text-sm">
        {title}
      </label>
      <Input
        id={`q-${questionId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? 'Add the missing context'}
      />
      <Button type="submit" size="sm" disabled={!value.trim()}>
        Answer
      </Button>
    </form>
  );
}
