// AXON — barrel export for the termination / announcement primitives.
//
// Currently scoped to P5 (termination + AnnounceCompletion). Expand
// when more AXON phases land on the `src/axon/` tree.

export {
  evaluateTermination,
  formatTerminationForPrompt,
  HIGH_CONFIDENCE_THRESHOLD,
  MEDIUM_CONFIDENCE_THRESHOLD,
  type FactorId,
  type ShouldTerminateDecision,
  type TerminationConfidence,
  type TerminationFactor,
  type TerminationInput,
} from './termination-detector.js';

export {
  announcementStore,
  AnnouncementStore,
  type CompletionOutcome,
  type AnnouncementRecord,
} from './announcement-store.js';

export {
  buildAxonTerminationSnapshot,
  type BuildAxonTerminationSnapshotInput,
} from './termination-snapshot.js';
