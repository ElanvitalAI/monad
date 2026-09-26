import * as fs from 'node:fs';
import { elanousStateRoot } from '../autopilot/state-paths.js';
import * as path from 'node:path';
import {
  isIntakeSource,
  isIntakeState,
  canTransitionIntakeState,
  cloneIntakeDecision,
  cloneIntakeDraft,
  cloneIntakeEvent,
  cloneIntakeSession,
  cloneRawIntakeRecord,
  cloneToxProposalDraft,
  type IntakeDecision,
  type IntakeDraft,
  type IntakeEvent,
  type IntakeSession,
  type IntakeState,
  type RawIntakeRecord,
  type ToxProposalDraft,
} from './types.js';

export interface IntakeStoreOpts {
  now?: () => Date;
  archiveDir?: string | null;
  replayOnInit?: boolean;
}

export interface IntakeStore {
  capture(record: RawIntakeRecord): IntakeSession;
  getSession(intakeId: string): IntakeSession | null;
  listSessions(opts?: { state?: IntakeState; source?: RawIntakeRecord['source'] }): IntakeSession[];
  listEvents(opts?: { intakeId?: string; kind?: IntakeEvent['kind'] }): IntakeEvent[];
  setState(
    intakeId: string,
    nextState: IntakeState,
    detail?: Record<string, unknown>,
  ): IntakeSession;
  saveDraft(
    intakeId: string,
    draft: IntakeDraft,
    opts?: { nextState?: 'drafted' | 'clarifying' | 'review-ready' },
  ): IntakeSession;
  saveDecision(
    intakeId: string,
    decision: IntakeDecision,
  ): IntakeSession;
  saveProposal(
    intakeId: string,
    proposal: ToxProposalDraft,
    opts?: { applyToken?: string; nextState?: 'proposed' | 'scheduled' },
  ): IntakeSession;
  archive(intakeId: string): IntakeSession;
  replay(): number;
}

const DEFAULT_ARCHIVE_DIR = path.join(elanousStateRoot(), 'intake');

function defaultNow(): Date {
  return new Date();
}

function isoDate(now: () => Date): string {
  return now().toISOString();
}

function archiveFilename(createdAt: string): string {
  const yyyymmdd = createdAt.slice(0, 10).replace(/-/g, '');
  return `intake-${yyyymmdd}.jsonl`;
}

function snapshotFilename(updatedAt: string): string {
  const yyyymmdd = updatedAt.slice(0, 10).replace(/-/g, '');
  return `intake-snapshots-${yyyymmdd}.jsonl`;
}

function inferDraftState(draft: IntakeDraft): 'clarifying' | 'review-ready' {
  return draft.openQuestions.length > 0 ? 'clarifying' : 'review-ready';
}

function looksLikeSession(value: unknown): value is IntakeSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IntakeSession>;
  const raw = candidate.raw as Partial<RawIntakeRecord> | undefined;
  return typeof candidate.intakeId === 'string'
    && !!raw
    && isIntakeSource(raw.source)
    && typeof raw.rawText === 'string'
    && Array.isArray(raw.attachments)
    && typeof raw.receivedAt === 'string'
    && isIntakeState(candidate.state)
    && typeof candidate.createdAt === 'string'
    && typeof candidate.updatedAt === 'string';
}

export function createIntakeStore(opts: IntakeStoreOpts = {}): IntakeStore {
  const now = opts.now ?? defaultNow;
  const archiveDir = opts.archiveDir === undefined ? DEFAULT_ARCHIVE_DIR : opts.archiveDir;
  const sessions = new Map<string, IntakeSession>();
  const events: IntakeEvent[] = [];

  function persistEvent(event: IntakeEvent): void {
    if (!archiveDir) return;
    try {
      fs.mkdirSync(archiveDir, { recursive: true });
      const file = path.join(archiveDir, archiveFilename(event.createdAt));
      fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
    } catch {
      // Best-effort archive sink; in-memory state stays canonical for M1.
    }
  }

  function persistSnapshot(session: IntakeSession): void {
    if (!archiveDir) return;
    try {
      fs.mkdirSync(archiveDir, { recursive: true });
      const file = path.join(archiveDir, snapshotFilename(session.updatedAt));
      fs.appendFileSync(
        file,
        `${JSON.stringify({
          kind: 'session-snapshot',
          savedAt: session.updatedAt,
          session,
        })}\n`,
        'utf8',
      );
    } catch {
      // Best-effort snapshot sink; in-memory state stays canonical.
    }
  }

  function appendEvent(event: IntakeEvent): void {
    const cloned = cloneIntakeEvent(event);
    events.push(cloned);
    persistEvent(cloned);
  }

  function requireSession(intakeId: string): IntakeSession {
    const found = sessions.get(intakeId);
    if (!found) {
      throw new Error(`Intake session not found: ${intakeId}`);
    }
    return found;
  }

  function updateSession(
    intakeId: string,
    updater: (current: IntakeSession) => IntakeSession,
  ): IntakeSession {
    const current = requireSession(intakeId);
    const next = updater(cloneIntakeSession(current));
    sessions.set(intakeId, next);
    persistSnapshot(next);
    return cloneIntakeSession(next);
  }

  const store: IntakeStore = {
    capture(record) {
      if (!record.intakeId || record.intakeId.trim().length === 0) {
        throw new Error('Intake capture requires a non-empty intakeId');
      }
      if (sessions.has(record.intakeId)) {
        throw new Error(`Intake session already exists: ${record.intakeId}`);
      }
      const stamp = record.receivedAt || isoDate(now);
      const session: IntakeSession = {
        intakeId: record.intakeId,
        raw: cloneRawIntakeRecord({
          ...record,
          receivedAt: stamp,
        }),
        state: 'captured',
        createdAt: stamp,
        updatedAt: stamp,
      };
      sessions.set(session.intakeId, session);
      appendEvent({
        intakeId: session.intakeId,
        kind: 'captured',
        createdAt: stamp,
        state: session.state,
        detail: {
          source: session.raw.source,
          attachmentCount: session.raw.attachments.length,
        },
      });
      persistSnapshot(session);
      return cloneIntakeSession(session);
    },

    getSession(intakeId) {
      const session = sessions.get(intakeId);
      return session ? cloneIntakeSession(session) : null;
    },

    listSessions(opts = {}) {
      const listed = Array.from(sessions.values())
        .filter((session) => (!opts.state || session.state === opts.state))
        .filter((session) => (!opts.source || session.raw.source === opts.source))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return listed.map(cloneIntakeSession);
    },

    listEvents(opts = {}) {
      return events
        .filter((event) => (!opts.intakeId || event.intakeId === opts.intakeId))
        .filter((event) => (!opts.kind || event.kind === opts.kind))
        .map(cloneIntakeEvent);
    },

    setState(intakeId, nextState, detail = {}) {
      return updateSession(intakeId, (current) => {
        if (!canTransitionIntakeState(current.state, nextState)) {
          throw new Error(`Illegal intake state transition: ${current.state} -> ${nextState}`);
        }
        if (current.state === nextState) return current;
        const updatedAt = isoDate(now);
        const next: IntakeSession = {
          ...current,
          state: nextState,
          updatedAt,
        };
        appendEvent({
          intakeId,
          kind: nextState === 'archived' ? 'archived' : 'state-transition',
          createdAt: updatedAt,
          state: nextState,
          detail: {
            from: current.state,
            to: nextState,
            ...detail,
          },
        });
        return next;
      });
    },

    saveDraft(intakeId, draft, opts = {}) {
      const nextState = opts.nextState ?? inferDraftState(draft);
      return updateSession(intakeId, (current) => {
        if (!canTransitionIntakeState(current.state, nextState)) {
          throw new Error(`Illegal intake state transition: ${current.state} -> ${nextState}`);
        }
        const updatedAt = isoDate(now);
        const next: IntakeSession = {
          ...current,
          draft: cloneIntakeDraft(draft),
          state: nextState,
          updatedAt,
        };
        appendEvent({
          intakeId,
          kind: 'draft-saved',
          createdAt: updatedAt,
          state: nextState,
          detail: {
            itemCount: draft.items.length,
            questionCount: draft.openQuestions.length,
            suggestedMode: draft.suggestedMode,
          },
        });
        return next;
      });
    },

    saveDecision(intakeId, decision) {
      return updateSession(intakeId, (current) => {
        const updatedAt = isoDate(now);
        const next: IntakeSession = {
          ...current,
          decision: cloneIntakeDecision(decision),
          updatedAt,
        };
        appendEvent({
          intakeId,
          kind: 'decision-saved',
          createdAt: updatedAt,
          state: next.state,
          detail: {
            mode: decision.mode,
            approvedCount: decision.approvedItemIds.length,
            deferredCount: decision.deferredItemIds.length,
          },
        });
        return next;
      });
    },

    saveProposal(intakeId, proposal, opts = {}) {
      const nextState = opts.nextState ?? 'proposed';
      return updateSession(intakeId, (current) => {
        if (!canTransitionIntakeState(current.state, nextState)) {
          throw new Error(`Illegal intake state transition: ${current.state} -> ${nextState}`);
        }
        const updatedAt = isoDate(now);
        const next: IntakeSession = {
          ...current,
          proposal: cloneToxProposalDraft(proposal),
          applyToken: opts.applyToken ?? current.applyToken,
          state: nextState,
          updatedAt,
        };
        appendEvent({
          intakeId,
          kind: 'proposal-saved',
          createdAt: updatedAt,
          state: nextState,
          detail: {
            hasScheduleText: !!proposal.scheduleText,
            contextNoteCount: proposal.contextNotes.length,
            applyToken: opts.applyToken ?? null,
          },
        });
        return next;
      });
    },

    archive(intakeId) {
      return this.setState(intakeId, 'archived');
    },
    replay() {
      if (!archiveDir) return 0;
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(archiveDir)
          .filter((name) => name.startsWith('intake-snapshots-') && name.endsWith('.jsonl'))
          .sort();
      } catch {
        return 0;
      }
      let restored = 0;
      for (const entry of entries) {
        const file = path.join(archiveDir, entry);
        let text = '';
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        for (const raw of text.split('\n')) {
          if (!raw.trim()) continue;
          try {
            const parsed = JSON.parse(raw) as {
              kind?: string;
              session?: unknown;
            };
            if (parsed.kind !== 'session-snapshot' || !looksLikeSession(parsed.session)) continue;
            const session = cloneIntakeSession(parsed.session);
            sessions.set(session.intakeId, session);
            restored++;
          } catch {
            // Corrupt lines are skipped so one bad write does not poison replay.
          }
        }
      }
      return restored;
    },
  };
  if (opts.replayOnInit) store.replay();
  return store;
}
