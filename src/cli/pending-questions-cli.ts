import type { Command } from 'commander';

import {
  addPendingQuestionWaiting,
  formatPendingQuestions,
  readPendingQuestions,
  isAskUserQuestionResult,
  pendingQuestionExpiryStatus,
  removePendingQuestionAnswer,
  writePendingQuestionAnswer,
} from '../ask-user-question/pending-questions.js';

interface PendingQuestionsCliDeps {
  read?: typeof readPendingQuestions;
  writeAnswer?: typeof writePendingQuestionAnswer;
  removeAnswer?: typeof removePendingQuestionAnswer;
  root?: () => string;
  now?: () => number;
  out?: { log: (value: string) => void };
  setExitCode?: (code: number) => void;
}

/** True only for persisted questions whose file answer can be consumed by this CLI now. */
export function isPendingQuestionCliAnswerable(
  question: { surface?: unknown; delivery?: unknown; expiresAt?: unknown },
  now = Date.now(),
): boolean {
  return question.surface === 'file'
    && question.delivery === 'file'
    && (question.expiresAt === undefined || typeof question.expiresAt === 'string')
    && pendingQuestionExpiryStatus(question.expiresAt, now) !== 'expired';
}

function pendingQuestionCliAnswerabilityReason(
  question: { surface?: unknown; delivery?: unknown; expiresAt?: unknown },
  now: number,
): string {
  if (typeof question.expiresAt === 'string' && pendingQuestionExpiryStatus(question.expiresAt, now) === 'expired') {
    return 'expired';
  }
  if (question.surface !== 'file') return `requires-surface:${String(question.surface)}`;
  if (question.delivery !== 'file') return `requires-delivery:${String(question.delivery)}`;
  return 'cli-answerable';
}

function formatPendingQuestionsForCli(result: ReturnType<typeof readPendingQuestions>, observedAt: number): string {
  if (!result.ok || result.questions.length === 0) return formatPendingQuestions(result, observedAt);
  return result.questions.map((question) => {
    const answerable = isPendingQuestionCliAnswerable(question, observedAt);
    const answerableReason = pendingQuestionCliAnswerabilityReason(question, observedAt);
    return `${formatPendingQuestions({ ok: true, questions: [question] }, observedAt)}  answerable=${answerable}  answerableReason=${answerableReason}`;
  }).join('\n');
}

function addPendingQuestionCliAnswerability(result: ReturnType<typeof readPendingQuestions>, observedAt: number) {
  const observed = addPendingQuestionWaiting(result, observedAt);
  if (!observed.ok) return observed;
  return {
    ok: true as const,
    questions: observed.questions.map((question) => ({
      ...question,
      answerable: isPendingQuestionCliAnswerable(question, observedAt),
      answerableReason: pendingQuestionCliAnswerabilityReason(question, observedAt),
    })),
  };
}

/** Register the read-only external observation surface for TUI question waits. */
export function registerPendingQuestionsCommand(program: Command, deps: PendingQuestionsCliDeps = {}): void {
  const read = deps.read ?? (() => readPendingQuestions({ root: deps.root }));
  const writeAnswer = deps.writeAnswer ?? ((answer) => writePendingQuestionAnswer(answer, { root: deps.root }));
  const removeAnswer = deps.removeAnswer ?? ((id) => removePendingQuestionAnswer(id, { root: deps.root }));
  const now = deps.now ?? Date.now;
  const out = deps.out ?? { log: (value: string) => console.log(value) };
  const setExitCode = deps.setExitCode ?? ((code: number) => { process.exitCode = code; });
  const questions = program.command('questions').description('AskUserQuestion 대기를 조회하고 파일 답을 기록한다');
  questions.command('pending')
    .description('대기 중인 질문과 대기 시간을 보여준다 (READ-ONLY)')
    .option('--json', 'JSON 출력')
    .action((options: { json?: boolean }) => {
      const result = read();
      const observedAt = now();
      if (options.json) {
        out.log(JSON.stringify(addPendingQuestionCliAnswerability(result, observedAt)));
        if (!result.ok) setExitCode(1);
        return;
      }
      out.log(formatPendingQuestionsForCli(result, observedAt));
      if (!result.ok) setExitCode(1);
    });
  questions.command('answer <id> <json>')
    .description('대기 질문의 답을 JSON AskUserQuestionResult로 기록한다')
    .action((id: string, json: string) => {
      let result: unknown;
      try {
        result = JSON.parse(json);
      } catch {
        out.log('Answer must be valid JSON.');
        setExitCode(1);
        return;
      }
      if (!isAskUserQuestionResult(result)) {
        out.log('Answer must be a valid AskUserQuestionResult.');
        setExitCode(1);
        return;
      }
      const isActiveFileQuestion = (): { ok: true } | { ok: false; reason: string } => {
        const pending = read();
        if (!pending.ok) return { ok: false, reason: `Unable to read pending questions: ${pending.error}` };
        const question = pending.questions.find((entry) => entry.id === id);
        if (question === undefined) {
          return { ok: false, reason: `No active file question found for ${id}.` };
        }
        const observedAt = now();
        if (!isPendingQuestionCliAnswerable(question, observedAt)) {
          if (pendingQuestionExpiryStatus(question.expiresAt, observedAt) === 'expired') {
            return { ok: false, reason: `Pending question ${id} has expired.` };
          }
          return {
            ok: false,
            reason: `Pending question ${id} exists but cannot be answered through this CLI (surface=${String(question.surface)}, delivery=${String(question.delivery)}).`,
          };
        }
        return { ok: true };
      };
      const before = isActiveFileQuestion();
      if (!before.ok) {
        out.log(before.reason);
        setExitCode(1);
        return;
      }
      try {
        writeAnswer({ id, result });
        const after = isActiveFileQuestion();
        if (!after.ok) {
          removeAnswer(id);
          out.log(after.reason);
          setExitCode(1);
          return;
        }
        out.log(`Recorded answer for ${id}.`);
      } catch (error) {
        try { removeAnswer(id); } catch { /* Preserve the original write or cleanup failure. */ }
        out.log(`Unable to write answer: ${error instanceof Error ? error.message : String(error)}`);
        setExitCode(1);
      }
    });
}
