import type { ModalSurface } from '../display/modal-stack.js';
import { attachSurfaceToWorkspace } from '../display/workspace-affinity.js';
import type { ThemeTokens } from '../theme/tokens.js';
import { mountViewAsModalSurface, type ViewSurfaceHandle } from '../ui/modal-adapter.js';
import type { QuestionAnswer } from '../ui/widgets/request-user-input-overlay.js';
import { createSearchModal, type SearchItem, type SearchModalHandle } from '../chat/search/modal.js';
import {
  answerIntakeQuestion,
  applyIntakeSession,
  archiveIntakeSession,
  createIntakeDeclarativeRuntimeArtifact,
  decideIntakeSession,
  proposeIntakeSession,
  type IntakeNextAction,
} from '../intake-plane/index.js';
import type { IntakeSlashResult } from '../intake-plane/slash.js';
import type { IntakeStore } from '../intake-plane/store.js';
import type { IntakeSession } from '../intake-plane/types.js';
import { filterInputMatches } from '../input/query-match.js';
import type {
  DeclarativeRuntimeArtifact,
  DeclarativeRuntimeOptions,
} from '../ui/declarative/index.js';

export interface DashboardIntakeReviewRuntimeDeps {
  store: IntakeStore;
  termSize: () => { cols: number; rows: number };
  getTheme: () => ThemeTokens | undefined;
  pushModalSurface: (surface: ModalSurface) => { dispose: () => void };
  ownerWorkspaceId?: string;
  redraw: () => void;
  onStatus?: (line: string) => void;
  onError?: (message: string) => void;
  createArtifact?: (
    session: IntakeSession,
    options?: DeclarativeRuntimeOptions,
  ) => DeclarativeRuntimeArtifact;
  mountSurface?: (handle: ViewSurfaceHandle) => { dispose: () => void };
  createSearchModal?: typeof createSearchModal;
}

export function shouldOpenDashboardIntakeReviewModal(
  args: string[],
  result: IntakeSlashResult,
): result is IntakeSlashResult & { session: IntakeSession } {
  if (!result.session) return false;
  const sub = (args[0] ?? '').toLowerCase();
  return [
    'capture',
    'draft',
    'show',
    'review',
    'replay',
    'answer',
    'decide',
    'schedule',
    'propose',
    'apply',
  ].includes(sub);
}

export function shouldOpenDashboardIntakeSessionPicker(
  args: string[],
  result: IntakeSlashResult,
): result is IntakeSlashResult & { sessions: IntakeSession[] } {
  if (!result.sessions || result.sessions.length === 0) return false;
  const sub = (args[0] ?? '').toLowerCase();
  return sub === 'list' || sub === 'search';
}

export function applyDashboardIntakeClarifyAnswers(
  store: IntakeStore,
  intakeId: string,
  answers: QuestionAnswer[],
): { output: string; session: IntakeSession } {
  let latest: IntakeSession | null = null;
  const output: string[] = [];
  for (const answer of answers) {
    const text = String(answer.value ?? '').trim();
    if (!text) continue;
    const resolved = answerIntakeQuestion(store, intakeId, answer.questionId, text);
    latest = resolved.session;
    output.push(resolved.output);
  }
  if (!latest) {
    const session = store.getSession(intakeId);
    if (!session) throw new Error(`Intake session not found: ${intakeId}`);
    return { output: `intake ${intakeId} received no clarify answers`, session };
  }
  return { output: output.join('\n'), session: latest };
}

export async function applyDashboardIntakeReviewAction(
  store: IntakeStore,
  actionValue: unknown,
): Promise<{ output: string; session: IntakeSession | null }> {
  if (!actionValue || typeof actionValue !== 'object') {
    return { output: '', session: null };
  }
  const action = actionValue as Partial<IntakeNextAction>;
  if (!action.intakeId || !action.kind) return { output: '', session: null };
  switch (action.kind) {
    case 'decide-apply-now': {
      decideIntakeSession(store, action.intakeId, 'apply-now');
      const applied = await applyIntakeSession(store, action.intakeId);
      return { output: applied.output, session: applied.session };
    }
    case 'decide-backlog-only': {
      const decided = decideIntakeSession(store, action.intakeId, 'backlog-only');
      return { output: decided.output, session: decided.session };
    }
    case 'propose': {
      const proposed = await proposeIntakeSession(store, action.intakeId);
      return { output: proposed.output, session: proposed.session };
    }
    case 'apply': {
      const applied = await applyIntakeSession(store, action.intakeId);
      return { output: applied.output, session: applied.session };
    }
    case 'archive': {
      const archived = archiveIntakeSession(store, action.intakeId);
      return { output: archived.output, session: null };
    }
    case 'review': {
      return { output: '', session: store.getSession(action.intakeId) ?? null };
    }
    default:
      return { output: '', session: null };
  }
}

export async function openDashboardIntakeReviewModal(
  initialSession: IntakeSession,
  deps: DashboardIntakeReviewRuntimeDeps,
): Promise<void> {
  const createArtifact = deps.createArtifact ?? createIntakeDeclarativeRuntimeArtifact;
  const mountSurface = deps.mountSurface ?? ((handle: ViewSurfaceHandle) => deps.pushModalSurface(handle.surface));

  let currentHandle: ViewSurfaceHandle | null = null;
  let currentModal: { dispose: () => void } | null = null;
  let closed = false;

  const closeCurrent = (): void => {
    if (closed) return;
    closed = true;
    currentHandle?.dispose();
    currentModal?.dispose();
    currentHandle = null;
    currentModal = null;
  };

  const reportStatus = (output: string): void => {
    if (!output.trim()) return;
    for (const line of output.split('\n')) deps.onStatus?.(line);
  };

  const reportError = (error: unknown): void => {
    deps.onError?.(error instanceof Error ? error.message : String(error));
  };

  const openForSession = (session: IntakeSession): void => {
    closed = false;
    const theme = deps.getTheme();
    const artifact = createArtifact(session, {
      prefer: 'view',
      viewDeps: {
        onDialogSubmit: (value) => {
          void (async () => {
            closeCurrent();
            const next = await applyDashboardIntakeReviewAction(deps.store, value);
            reportStatus(next.output);
            if (next.session) openForSession(next.session);
            deps.redraw();
          })().catch(reportError);
        },
        onRequestSubmit: (answers) => {
          closeCurrent();
          try {
            const next = applyDashboardIntakeClarifyAnswers(deps.store, session.intakeId, answers);
            reportStatus(next.output);
            openForSession(next.session);
            deps.redraw();
          } catch (error) {
            reportError(error);
          }
        },
        onCancel: () => {
          closeCurrent();
          deps.redraw();
        },
      },
    });
    if (artifact.kind !== 'view') {
      throw new Error(`intake review expected a view artifact, got ${artifact.kind}`);
    }
    const { cols, rows } = deps.termSize();
    const width = Math.min(88, Math.max(54, cols - 8));
    const preferredHeight = session.draft?.openQuestions.length ? 10 : 14;
    currentHandle = mountViewAsModalSurface({
      id: `intake-review:${session.intakeId}`,
      bounds: {
        row: Math.max(1, Math.floor((rows - preferredHeight) / 2)),
        col: Math.max(1, Math.floor((cols - width) / 2)),
        width,
        height: Math.min(preferredHeight, Math.max(8, rows - 4)),
      },
      layout: {
        anchor: { kind: 'overlay-center', paddingRows: 2, paddingCols: 4 },
        preferredWidth: width,
        preferredHeight: Math.min(preferredHeight, Math.max(8, rows - 4)),
        minWidth: 48,
        minHeight: 8,
        maxWidth: Math.max(48, cols - 4),
        maxHeight: Math.max(8, rows - 2),
        opaque: true,
      },
      view: artifact.view,
      tier: 'dialog',
      theme,
      shadow: theme ? { theme } : undefined,
    });
    attachSurfaceToWorkspace(currentHandle.surface, deps.ownerWorkspaceId);
    currentModal = mountSurface(currentHandle);
    deps.redraw();
  };

  openForSession(initialSession);
}

export function openDashboardIntakeSessionPicker(
  sessions: IntakeSession[],
  deps: DashboardIntakeReviewRuntimeDeps,
): void {
  const createSearchModalImpl = deps.createSearchModal ?? createSearchModal;
  const { cols, rows } = deps.termSize();
  const width = Math.min(88, Math.max(56, cols - 8));
  const maxVisible = Math.min(10, Math.max(4, sessions.length));
  const height = maxVisible + 4;
  const bounds = {
    row: Math.max(1, Math.floor((rows - height) / 2)),
    col: Math.max(1, Math.floor((cols - width) / 2)),
    width,
    height,
  };
  let handle: { dispose: () => void } | null = null;
  const itemsForQuery = (query: string): SearchItem[] => {
    const filtered = filterInputMatches(
      sessions,
      query,
      (session) => [
        session.intakeId,
        session.state,
        session.raw.source,
        session.draft?.title ?? '',
        session.draft?.summary ?? '',
        session.raw.rawText,
      ].join('\n'),
      'substring',
    );
    return filtered.map((session) => ({
      label: `${session.intakeId} [${session.state}] ${session.draft?.title ?? session.raw.source}`,
      payload: session.intakeId,
    }));
  };
  const picker: SearchModalHandle = createSearchModalImpl({
    id: 'intake-session-picker',
    bounds,
    title: 'Intake Sessions',
    width,
    maxVisible,
    theme: deps.getTheme(),
    onQuery: itemsForQuery,
    onAccept: (item) => {
      handle?.dispose();
      const session = sessions.find((entry) => entry.intakeId === item.payload);
      if (!session) {
        deps.onError?.(`intake session not found: ${String(item.payload)}`);
        deps.redraw();
        return;
      }
      void openDashboardIntakeReviewModal(session, deps);
      deps.redraw();
    },
    onCancel: () => {
      handle?.dispose();
      deps.redraw();
    },
    primaryActionLabel: 'review',
  });
  attachSurfaceToWorkspace(picker.surface, deps.ownerWorkspaceId);
  handle = deps.pushModalSurface(picker.surface);
  deps.redraw();
}
