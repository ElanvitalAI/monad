/**
 * `MyelinPriorityBridge` — Phase 2 D6 / RESEARCH §7.
 *
 * Reads the MSS MyelinMetric (D0) and lifts task priority rank for any
 * task whose category has been firing frequently — "cells that fire
 * together wire together" applied to dispatching: workflows the user
 * runs often get to the head of the queue ahead of less-myelinated
 * peers.
 *
 * Contract (E6):
 *   - Boost cap = `MYELIN_BOOST_CAP` (2)
 *   - Rank is *lower-is-better* (matches TOX priority numeric order)
 *   - bridge returns `lift(rank, boost) = max(rank - boost, FLOOR)`
 *   - Co-activation lift: when category A fires, sibling categories
 *     that co-activate with A get a *partial* boost (min(0.5 × peer
 *     boost, 1)) — encodes the Hebbian sibling lift from §7.
 *
 * The bridge does NOT mutate TOX. It returns a new effective rank
 * that the launcher (D5) reads at evaluation time. This keeps the TOX
 * priority field stable (user-visible) while the launcher's queue
 * order absorbs the lift live.
 */
import { MYELIN_BOOST_CAP, type MyelinMetric } from '../mss/myelin.js';

// ──────────────────── Public shapes ────────────────────────────────────

export interface MyelinLiftInput {
  /** TOX priority rank — lower = sooner. */
  rank: number;
  /** Myelin category to score against (typically a task fingerprint:
   *  `intake.decompose` · `omni-crawl.x-news` · etc.). */
  category: string;
}

export interface MyelinLiftResult {
  /** New rank after applying boost. Lower than or equal to input. */
  effectiveRank: number;
  /** Applied boost (0..cap). */
  boostApplied: number;
  /** Set when the category sat in the fast-path threshold. */
  fastPath: boolean;
}

export interface MyelinPriorityBridgeOptions {
  metric: MyelinMetric;
  /** Boost ceiling (defaults to MYELIN_BOOST_CAP=2 per E6). */
  cap?: number;
  /** Lower bound for the effective rank. Default 0. */
  floor?: number;
  /** Co-activation lift weight — sibling boost multiplied by this when
   *  the seed category did *not* itself score a boost. Default 0.5. */
  coActivationWeight?: number;
}

// ──────────────────── Bridge ───────────────────────────────────────────

export class MyelinPriorityBridge {
  private readonly metric: MyelinMetric;
  private readonly cap: number;
  private readonly floor: number;
  private readonly coWeight: number;

  constructor(opts: MyelinPriorityBridgeOptions) {
    this.metric = opts.metric;
    this.cap = Math.min(MYELIN_BOOST_CAP, Math.max(0, opts.cap ?? MYELIN_BOOST_CAP));
    this.floor = opts.floor ?? 0;
    this.coWeight = Math.max(0, Math.min(1, opts.coActivationWeight ?? 0.5));
  }

  /** Single-shot lift — convenience for D5 launcher. */
  lift(input: MyelinLiftInput): MyelinLiftResult {
    const snap = this.metric.snapshot(input.category);
    let boost = Math.min(snap.boost, this.cap);

    // Co-activation lift kicks in only when the seed itself didn't score.
    if (boost === 0) {
      const peers = this.metric.coActivatedWith(input.category, 5);
      let bestPeerBoost = 0;
      for (const { b } of peers) {
        const peerSnap = this.metric.snapshot(b);
        if (peerSnap.boost > bestPeerBoost) bestPeerBoost = peerSnap.boost;
      }
      if (bestPeerBoost > 0) {
        boost = Math.min(this.cap, Math.max(0, Math.floor(bestPeerBoost * this.coWeight)));
      }
    }

    const effective = Math.max(this.floor, input.rank - boost);
    return {
      effectiveRank: effective,
      boostApplied: boost,
      fastPath: snap.fastPath,
    };
  }

  /** Batch — handy for "annotate this whole ready queue at once". */
  liftBatch(inputs: ReadonlyArray<MyelinLiftInput>): MyelinLiftResult[] {
    return inputs.map((i) => this.lift(i));
  }
}
