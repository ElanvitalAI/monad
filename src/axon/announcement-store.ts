// AXON P5 — AnnouncementStore singleton.
//
// When the LLM calls AnnounceCompletion, we stash the record here so
// any consumer (termination-detector factor 7, loop-prompt renderer,
// session-end banner) can read it without threading props through a
// half-dozen callers. Process-wide because elanous is a single-session
// process today; tests reset via the exposed __clear() helper.

export type CompletionOutcome = 'success' | 'partial' | 'failed';

export interface AnnouncementRecord {
  summary: string;
  outcome: CompletionOutcome;
  nextSteps?: readonly string[];
  announcedAt: number;
  /** Optional scope — lets multi-goal sessions track which slug was
   *  being worked on when AnnounceCompletion fired. */
  goalSlug?: string;
}

export class AnnouncementStore {
  private last: AnnouncementRecord | null = null;

  record(input: Omit<AnnouncementRecord, 'announcedAt'> & { announcedAt?: number }): AnnouncementRecord {
    const rec: AnnouncementRecord = {
      summary: input.summary,
      outcome: input.outcome,
      announcedAt: input.announcedAt ?? Date.now(),
      ...(input.nextSteps !== undefined ? { nextSteps: input.nextSteps } : {}),
      ...(input.goalSlug !== undefined ? { goalSlug: input.goalSlug } : {}),
    };
    this.last = rec;
    return rec;
  }

  /** Most recent announcement. `null` when no call has fired yet
   *  this session (or after `__clear()`). */
  getLast(): AnnouncementRecord | null {
    return this.last;
  }

  /** True when an announcement has been made. Used by the termination
   *  detector as factor 7 without needing the record contents. */
  hasAnnounced(): boolean {
    return this.last !== null;
  }

  __clear(): void { this.last = null; }
}

export const announcementStore = new AnnouncementStore();
