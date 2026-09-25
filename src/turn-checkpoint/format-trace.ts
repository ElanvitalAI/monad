// PLAN §4.3 · Phase 1.3 — `/debug trace` formatter.
//
// Render a `TurnCheckpoint` as a human-readable multi-line dump
// covering the four core loop states (execution / verification /
// finalization / signal), each annotated with a one-line
// interpretation comment so a user (or LLM) can read the trace
// without consulting llm.ts.
//
// The formatter is pure: it takes a checkpoint snapshot in,
// returns string[] out. Display is the caller's job (chat pane
// mirror, modal popup, log file, etc.).

import type { TurnCheckpoint } from './types.js';

const SUFFIX_LEN = 12;

function shortTurn(turnUri: string): string {
  return turnUri.length > SUFFIX_LEN ? turnUri.slice(-SUFFIX_LEN) : turnUri;
}

function annotate(label: string, value: unknown, hint?: string): string {
  const v = value === null || value === undefined
    ? 'null'
    : typeof value === 'string'
      ? JSON.stringify(value)
      : String(value);
  return hint ? `  ${label}: ${v}  ${hint}` : `  ${label}: ${v}`;
}

function interpretSignal(sig?: TurnCheckpoint['loop']['signal']): string {
  if (!sig) return '(no signal captured)';
  const fields: string[] = [];
  if (sig.primarySourceFile) fields.push(`source=${sig.primarySourceFile}`);
  if (sig.primaryTestFile) fields.push(`test=${sig.primaryTestFile}`);
  if (sig.interestingLine) fields.push(`hint="${sig.interestingLine.slice(0, 60)}"`);
  return fields.length ? fields.join(' · ') : '(empty signal — no source/test/hint detected)';
}

function interpretFinalization(fin?: TurnCheckpoint['loop']['finalization']): string {
  if (!fin) return '(no finalization snapshot)';
  if (!fin.verificationStillCurrent) {
    return '⚠ verificationStillCurrent=false → stale verify · 재검증 필요';
  }
  if (fin.forceFinalAnswer) {
    return '✓ forceFinalAnswer=true → verification PASS · ready to close turn';
  }
  return 'verification fresh, but no force-final yet';
}

function interpretVerification(ver?: TurnCheckpoint['loop']['verification']): string {
  if (!ver) return '(no verification snapshot)';
  if (ver.needsRefresh) return '⚠ needsRefresh=true → edit happened, verify pending';
  if (ver.unknownSinceShellCommand) return '⚠ verification freshness unknown → non-verification shell command ran after verify';
  if (ver.historyLen === 0) return 'no verify run yet this turn';
  return `${ver.historyLen} verify call${ver.historyLen === 1 ? '' : 's'} recorded`;
}

function interpretExecution(exe?: TurnCheckpoint['loop']['execution']): string {
  if (!exe) return '(no execution snapshot)';
  if (!exe.lastCommand) return 'no Bash/RunShell run yet';
  return `last: ${exe.lastCommand.slice(0, 60)}`;
}

/** Render a checkpoint into a copy-pasteable trace dump.
 *  Returns plain strings (no ANSI) — the caller wraps for color. */
export function formatDebugTrace(cp: TurnCheckpoint | null): string[] {
  if (!cp) {
    return [
      '/debug trace: no checkpoint on disk yet.',
      '  Trigger a decision-boundary tool (Edit/Write/Bash/RunShell/Agent)',
      '  or invoke /pause mid-turn to capture one.',
    ];
  }

  const out: string[] = [];
  out.push(`/debug trace · turn ${shortTurn(cp.turnUri)} · checkpoint #${cp.toolIndex} · ${cp.decision.kind}`);
  out.push(`  captured: ${cp.timestamp}`);
  out.push(`  decision: ${cp.decision.preview}`);
  out.push(`  message count: ${cp.messageCount}`);
  out.push('');

  out.push('── ExecutionLoopState ──');
  out.push(`  ${interpretExecution(cp.loop.execution)}`);
  if (cp.loop.execution) {
    out.push(annotate('lastCommand', cp.loop.execution.lastCommand));
    out.push(annotate('lastSummary', cp.loop.execution.lastSummary));
    out.push(annotate('primarySourceFile', cp.loop.execution.primarySourceFile));
    out.push(annotate('interestingLine', cp.loop.execution.interestingLine));
  }
  out.push('');

  out.push('── VerificationLoopState ──');
  out.push(`  ${interpretVerification(cp.loop.verification)}`);
  if (cp.loop.verification) {
    out.push(annotate('lastCommand', cp.loop.verification.lastCommand));
    out.push(annotate('lastSummary', cp.loop.verification.lastSummary));
    out.push(annotate('historyLen', cp.loop.verification.historyLen));
    out.push(annotate('needsRefresh', cp.loop.verification.needsRefresh));
    out.push(annotate('unknownSinceShellCommand', cp.loop.verification.unknownSinceShellCommand));
  }
  out.push('');

  out.push('── FinalizationPolicySnapshot ──');
  out.push(`  ${interpretFinalization(cp.loop.finalization)}`);
  if (cp.loop.finalization) {
    out.push(annotate('verificationStillCurrent', cp.loop.finalization.verificationStillCurrent));
    out.push(annotate('forceFinalAnswer', cp.loop.finalization.forceFinalAnswer));
  }
  out.push('');

  out.push('── LoopSignalSnapshot ──');
  out.push(`  ${interpretSignal(cp.loop.signal)}`);
  if (cp.loop.signal) {
    out.push(annotate('primarySourceFile', cp.loop.signal.primarySourceFile));
    out.push(annotate('primaryTestFile', cp.loop.signal.primaryTestFile));
    out.push(annotate('interestingLine', cp.loop.signal.interestingLine));
  }

  if (cp.recentText) {
    out.push('');
    out.push('── recent assistant text ──');
    const snippet = cp.recentText.replace(/\s+/g, ' ').trim();
    out.push(`  ${snippet.slice(0, 200)}${snippet.length > 200 ? '…' : ''}`);
  }

  if (cp.recentMessages && cp.recentMessages.length > 0) {
    out.push('');
    out.push(`── recent ${cp.recentMessages.length} message(s) ──`);
    for (const msg of cp.recentMessages) {
      const text = msg.text.replace(/\s+/g, ' ').trim();
      out.push(`  [${msg.role}] ${text.slice(0, 120)}${text.length > 120 ? '…' : ''}`);
    }
  }

  return out;
}
