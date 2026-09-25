// AskQuestionSheet.tsx — PWA native modal for inbound
// `monad/ask/request` extMethod (M4 of PLAN-ask-user-question-cross-
// surface-2026-05-13).
//
// shadcn `<Dialog>` 위에 single/multi-select option list + "Other" free-
// form input + Submit / Cancel / "Chat about this" 셋. Sheet 결과 wire
// 는 iOS / TUI 와 동일 — `cancelled: true` 가 cancel + "Chat about this"
// 공통 (composer prefill 은 ChatLayout 의 client-side 헬퍼).

'use client';

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ASK_OTHER_LABEL,
  type AskQuestion,
  type AskQuestionOption,
  type AskUserQuestionRequest,
  type AskUserQuestionResult,
  type AnswerValue,
} from '@/lib/monad-ask-extensions';

export interface AskQuestionSheetProps {
  /** Server-pushed request. null while idle (nothing to show). */
  request: AskUserQuestionRequest | null;
  /** Submit handler — result has cancelled:false. */
  onSubmit: (result: AskUserQuestionResult) => void;
  /** Cancel handler — close button / Esc / overlay click. */
  onCancel: () => void;
  /** "Chat about this" handler. Sheet emits cancelled:true via onCancel
   *  AFTER calling this; this hook handles composer focus + prefill. */
  onChatAboutThis: () => void;
}

export function AskQuestionSheet({
  request,
  onSubmit,
  onCancel,
  onChatAboutThis,
}: AskQuestionSheetProps) {
  return (
    <Dialog open={request !== null} onOpenChange={(open: boolean) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        {request ? (
          <AskQuestionSheetBody
            request={request}
            onSubmit={onSubmit}
            onCancel={onCancel}
            onChatAboutThis={onChatAboutThis}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface InternalProps {
  request: AskUserQuestionRequest;
  onSubmit: (result: AskUserQuestionResult) => void;
  onCancel: () => void;
  onChatAboutThis: () => void;
}

function AskQuestionSheetBody({
  request,
  onSubmit,
  onCancel,
  onChatAboutThis,
}: InternalProps) {
  /** question.id → selected labels. multi-select 시 Set 처럼 다중 · single
   *  은 1 원소. Other 선택은 `ASK_OTHER_LABEL` sentinel 로 표현. */
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(request.questions.map((q) => [q.id, new Set<string>()])),
  );
  /** question.id → 자유 입력 텍스트. Other row 가 active 일 때만 의미. */
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  /** multi-select 의 Other toggle (single 은 selections 안에 ASK_OTHER_LABEL 으로 표현). */
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>({});

  const navigationTitle = request.questions.length === 1
    ? request.questions[0]!.header
    : 'Pick options';

  const canSubmit = useMemo(() => {
    for (const q of request.questions) {
      const sel = selections[q.id] ?? new Set();
      const other = isOtherActive(q, selections, otherActive);
      if (sel.size === 0 && !other) return false;
    }
    return true;
  }, [request.questions, selections, otherActive]);

  function isSelected(qId: string, label: string): boolean {
    return selections[qId]?.has(label) ?? false;
  }

  function toggle(q: AskQuestion, label: string): void {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[q.id] ?? []);
      if (q.multiSelect) {
        if (set.has(label)) set.delete(label);
        else set.add(label);
      } else {
        // single-select — replace + deactivate Other
        set.clear();
        set.add(label);
        setOtherActive((p) => ({ ...p, [q.id]: false }));
      }
      next[q.id] = set;
      return next;
    });
  }

  function toggleOther(q: AskQuestion): void {
    if (q.multiSelect) {
      setOtherActive((prev) => ({ ...prev, [q.id]: !(prev[q.id] ?? false) }));
    } else {
      setSelections((prev) => {
        const next = { ...prev };
        next[q.id] = new Set([ASK_OTHER_LABEL]);
        return next;
      });
    }
  }

  function handleSubmit(): void {
    const answers: Record<string, AnswerValue> = {};
    const otherText: Record<string, string> = {};
    for (const q of request.questions) {
      const sel = Array.from(selections[q.id] ?? []);
      const other = isOtherActive(q, selections, otherActive);
      if (other && !sel.includes(ASK_OTHER_LABEL)) sel.push(ASK_OTHER_LABEL);
      if (sel.length === 0) continue;
      if (q.multiSelect) {
        answers[q.id] = sel;
      } else {
        answers[q.id] = sel[0]!;
      }
      if (sel.includes(ASK_OTHER_LABEL)) {
        const text = (otherTexts[q.id] ?? '').trim();
        if (text.length > 0) otherText[q.id] = text;
      }
    }
    const result: AskUserQuestionResult = { answers };
    if (Object.keys(otherText).length > 0) result.otherText = otherText;
    onSubmit(result);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{navigationTitle}</DialogTitle>
        {request.questions.length === 1 ? (
          <DialogDescription>{request.questions[0]!.question}</DialogDescription>
        ) : (
          <DialogDescription>{request.questions.length} questions</DialogDescription>
        )}
      </DialogHeader>

      <ScrollArea className="max-h-[60vh] pr-2">
        <div className="flex flex-col gap-6 py-2">
          {request.questions.map((q) => (
            <QuestionSection
              key={q.id}
              question={q}
              isSelected={(label) => isSelected(q.id, label)}
              onToggle={(label) => toggle(q, label)}
              otherActive={isOtherActive(q, selections, otherActive)}
              onToggleOther={() => toggleOther(q)}
              otherText={otherTexts[q.id] ?? ''}
              onOtherText={(t) => setOtherTexts((prev) => ({ ...prev, [q.id]: t }))}
            />
          ))}
        </div>
      </ScrollArea>

      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button
          variant="ghost"
          onClick={onChatAboutThis}
          aria-label="Chat about this"
        >
          💬 Chat about this
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>Submit</Button>
        </div>
      </DialogFooter>
    </>
  );
}

interface QuestionSectionProps {
  question: AskQuestion;
  isSelected: (label: string) => boolean;
  onToggle: (label: string) => void;
  otherActive: boolean;
  onToggleOther: () => void;
  otherText: string;
  onOtherText: (t: string) => void;
}

function QuestionSection(props: QuestionSectionProps) {
  const { question: q } = props;
  return (
    <section className="flex flex-col gap-2">
      {/* Per-question header — chip + question text. Single-question
          mode 에서는 DialogHeader 의 description 과 중복되지만 multi-
          question wizard 진입 시 visual consistency 를 위해 둠. */}
      {props.question.id !== '' ? (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {q.header}
          </span>
          {q.multiSelect ? (
            <span className="text-xs text-muted-foreground">multi-select</span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {q.options.map((opt) => (
          <OptionRow
            key={opt.label}
            multi={q.multiSelect ?? false}
            option={opt}
            selected={props.isSelected(opt.label)}
            onToggle={() => props.onToggle(opt.label)}
          />
        ))}
        {(q.includeOther ?? true) ? (
          <>
            <OptionRow
              multi={q.multiSelect ?? false}
              option={{ label: 'Other', description: 'Type your own response' }}
              selected={props.otherActive}
              onToggle={props.onToggleOther}
            />
            {props.otherActive ? (
              <Input
                value={props.otherText}
                onChange={(e) => props.onOtherText(e.target.value)}
                placeholder="Type your own response"
                aria-label="Other response"
                className="ml-8"
              />
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

interface OptionRowProps {
  multi: boolean;
  option: AskQuestionOption;
  selected: boolean;
  onToggle: () => void;
}

function OptionRow({ multi, option, selected, onToggle }: OptionRowProps) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      onClick={onToggle}
      className={`
        flex items-start gap-3 rounded-md border p-3 text-left
        transition-colors
        ${selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40'}
      `}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center ${
          multi ? 'rounded' : 'rounded-full'
        } border ${
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40'
        }`}
        aria-hidden="true"
      >
        {selected ? (multi ? '✓' : '●') : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{option.label}</span>
        <span className="text-sm text-muted-foreground">{option.description}</span>
        {option.preview ? (
          <span className="mt-1 rounded bg-muted/40 px-2 py-1 text-xs font-mono text-muted-foreground">
            {option.preview}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function isOtherActive(
  q: AskQuestion,
  selections: Record<string, Set<string>>,
  otherActive: Record<string, boolean>,
): boolean {
  if (q.multiSelect) return otherActive[q.id] ?? false;
  return selections[q.id]?.has(ASK_OTHER_LABEL) ?? false;
}
