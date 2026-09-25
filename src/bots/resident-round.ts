/**
 * Resident-round is the execution axis: a round runs inside the monad process.
 * It is distinct from `PersonaResidence`, which records the machine (`vm` or
 * `local`) where a persona resides. This pure decision unit neither resolves
 * that machine nor determines whether it is live.
 *
 * The caller supplies an already-resolved universe root. Runtime scheduler or
 * daemon wiring deliberately belongs to a later goal.
 */

/** Dedicated provenance for an unattended round decided inside monad. */
export type ResidentRoundSource = 'monad-resident';

export interface ResidentRoundInput {
  readonly botName: string;
  readonly now: Date;
  readonly scheduledAt: Date;
  /** Already-resolved instance/universe root; this unit must preserve it. */
  readonly universeRoot: string;
}

export interface ResidentRoundDescription {
  readonly botName: string;
  readonly scheduledAt: Date;
  readonly universeRoot: string;
  readonly source: ResidentRoundSource;
  readonly humanInitiated: false;
}

export type ResidentRoundDecision =
  | { readonly due: false }
  | { readonly due: true; readonly round: ResidentRoundDescription };

/**
 * Decides whether the supplied schedule is due without reading clocks, files,
 * process state, or resolving an instance root.
 */
export function decideResidentRound(input: ResidentRoundInput): ResidentRoundDecision {
  if (input.scheduledAt.getTime() > input.now.getTime()) return { due: false };
  return {
    due: true,
    round: {
      botName: input.botName,
      scheduledAt: input.scheduledAt,
      universeRoot: input.universeRoot,
      source: 'monad-resident',
      humanInitiated: false,
    },
  };
}
