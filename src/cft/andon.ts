// ── PFC-S3.1: Andon Cord ──
//
// "Stop the line" for LLM cognition. Subagents, tools, or the operator
// declare that something is seriously wrong by emitting an escalation
// signal. CRITICAL severity forces a preamble onto the next turn's
// system prompt so the parent LLM cannot continue normal work until it
// has acknowledged + resolved the issue.
//
// State split:
//   - in-memory Map<agentId, EscalationSignal>  — authoritative "active
//     escalation list" (fast reads, small set).
//   - notification-store mirror (kind 'escalation')  — full history
//     including resolved ones, for the bell modal + audit.
//   - Obsidian incident artifact (best-effort, async)  — CRITICAL only;
//     survives restart + lets humans grep later.
//
// DD-ANDON-5: no auto-TTL. Only explicit resolveEscalation clears the
// state — auto-clearing would defeat the whole point of Andon.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NotificationStore } from '../notifications/store.js';
import type { ObsidianVault } from '../auto-research/obsidian-bridge.js';

export type EscalationSeverity = 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';

export interface EscalationSignal {
  agentId: string;
  severity: EscalationSeverity;
  reason: string;
  context: string;
  ts: number;
  incidentPath?: string;
}

export interface EmitEscalationInput {
  agentId: string;
  severity: EscalationSeverity;
  reason: string;
  context?: string;
}

export interface EmitOpts {
  now?: number;
  notificationStore?: NotificationStore;
  vault?: ObsidianVault;
  /** Test seam — skip Obsidian write entirely. */
  skipObsidian?: boolean;
}

export interface AndonListResult {
  pending: EscalationSignal[];
  criticalCount: number;
  highCount: number;
  medCount: number;
  lowCount: number;
}

type SubscriberKind = 'emit' | 'resolve';
type Subscriber = (signal: EscalationSignal, kind: SubscriberKind) => void;

const state = new Map<string, EscalationSignal>();
const subscribers = new Set<Subscriber>();

// ── Emit ───────────────────────────────────────────────────────────────

export async function emitEscalation(
  input: EmitEscalationInput,
  opts: EmitOpts = {},
): Promise<EscalationSignal> {
  if (!input.agentId || !input.agentId.trim()) {
    throw new Error('emitEscalation: agentId is required');
  }
  if (!isValidSeverity(input.severity)) {
    throw new Error(`emitEscalation: invalid severity '${input.severity}' (LOW|MED|HIGH|CRITICAL)`);
  }
  if (!input.reason || !input.reason.trim()) {
    throw new Error('emitEscalation: reason is required');
  }

  const now = opts.now ?? Date.now();
  const signal: EscalationSignal = {
    agentId: input.agentId,
    severity: input.severity,
    reason: input.reason.trim(),
    context: (input.context ?? '').trim(),
    ts: now,
  };

  // Best-effort Obsidian incident artifact — CRITICAL only.
  if (signal.severity === 'CRITICAL' && opts.vault && !opts.skipObsidian) {
    try {
      const path = writeIncidentArtifact(opts.vault, signal);
      if (path) signal.incidentPath = path;
    } catch {
      // swallow — emit must still succeed
    }
  }

  state.set(input.agentId, signal);

  // Mirror to notification-store for audit + bell modal.
  if (opts.notificationStore) {
    try {
      opts.notificationStore.push({
        sessionId: 'cft-andon',
        kind: 'escalation',
        title: `${severityBadge(signal.severity)} [${signal.agentId}] ${signal.reason}`,
        ...(signal.context ? { body: signal.context } : {}),
        meta: { severity: signal.severity, agentId: signal.agentId },
      });
    } catch {
      // swallow
    }
  }

  for (const sub of subscribers) {
    try { sub(signal, 'emit'); } catch { /* swallow */ }
  }

  return signal;
}

// ── Resolve ────────────────────────────────────────────────────────────

export interface ResolveOpts {
  resolution?: string;
  notificationStore?: NotificationStore;
}

export function resolveEscalation(agentId: string, opts: ResolveOpts = {}): EscalationSignal | null {
  const prev = state.get(agentId);
  if (!prev) return null;
  state.delete(agentId);

  if (opts.notificationStore) {
    try {
      opts.notificationStore.push({
        sessionId: 'cft-andon',
        kind: 'escalation',
        title: `✓ [${agentId}] resolved`,
        ...(opts.resolution ? { body: opts.resolution } : {}),
        meta: { severity: prev.severity, agentId, resolved: true },
      });
    } catch { /* swallow */ }
  }

  for (const sub of subscribers) {
    try { sub(prev, 'resolve'); } catch { /* swallow */ }
  }

  return prev;
}

// ── Query ──────────────────────────────────────────────────────────────

export function listEscalations(filter?: { severity?: EscalationSeverity }): EscalationSignal[] {
  const all = Array.from(state.values()).sort((a, b) => b.ts - a.ts);
  if (filter?.severity) return all.filter(s => s.severity === filter.severity);
  return all;
}

export function hasPendingCritical(): boolean {
  for (const s of state.values()) if (s.severity === 'CRITICAL') return true;
  return false;
}

export function getPendingCriticalSignals(): EscalationSignal[] {
  return listEscalations({ severity: 'CRITICAL' });
}

export function countsBySeverity(): Omit<AndonListResult, 'pending'> {
  const out = { criticalCount: 0, highCount: 0, medCount: 0, lowCount: 0 };
  for (const s of state.values()) {
    switch (s.severity) {
      case 'CRITICAL': out.criticalCount++; break;
      case 'HIGH': out.highCount++; break;
      case 'MED': out.medCount++; break;
      case 'LOW': out.lowCount++; break;
    }
  }
  return out;
}

export function buildAndonListResult(filter?: { severity?: EscalationSeverity }): AndonListResult {
  return {
    pending: listEscalations(filter),
    ...countsBySeverity(),
  };
}

// ── Preamble ───────────────────────────────────────────────────────────

export function buildAndonPreamble(): string | null {
  const critical = getPendingCriticalSignals();
  if (critical.length === 0) return null;
  const lines: string[] = [
    '🔴 ANDON ESCALATION — 다음 turn 에 반드시 처리:',
  ];
  for (const s of critical) {
    const suffix = s.context ? ` — ${s.context}` : '';
    lines.push(`  • [${s.agentId}] ${s.reason}${suffix}`);
  }
  lines.push('');
  lines.push('이 issue 해결 (ResolveEscalation 호출) 전까지 다른 작업 금지.');
  lines.push('A3 Report 작성 권장 (WriteA3 tool — 후속 세션 예정).');
  return lines.join('\n');
}

// ── Subscribe ──────────────────────────────────────────────────────────

export function subscribeAndon(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

// ── Test seam ──────────────────────────────────────────────────────────

export function clearAllEscalationsForTest(): void {
  state.clear();
  subscribers.clear();
}

// ── Helpers ────────────────────────────────────────────────────────────

function isValidSeverity(s: unknown): s is EscalationSeverity {
  return s === 'LOW' || s === 'MED' || s === 'HIGH' || s === 'CRITICAL';
}

function severityBadge(s: EscalationSeverity): string {
  switch (s) {
    case 'CRITICAL': return '🔴 CRITICAL';
    case 'HIGH': return '🟠 HIGH';
    case 'MED': return '🟡 MED';
    case 'LOW': return '🔵 LOW';
  }
}

function writeIncidentArtifact(vault: ObsidianVault, signal: EscalationSignal): string | undefined {
  const dir = join(vault.root, 'Incidents');
  ensureDir(dir);
  const stamp = formatStamp(signal.ts);
  const safeAgent = signal.agentId.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
  const file = join(dir, `${stamp}-${safeAgent}.md`);
  const frontmatter = [
    '---',
    `severity: ${signal.severity}`,
    `agentId: ${signal.agentId}`,
    `ts: ${new Date(signal.ts).toISOString()}`,
    'kind: escalation',
    'resolved: false',
    '---',
    '',
  ].join('\n');
  const body = [
    `# 🔴 Andon — ${signal.agentId}`,
    '',
    `**Severity**: ${signal.severity}`,
    `**Reason**: ${signal.reason}`,
    '',
    '## Context',
    signal.context || '(none)',
    '',
    '## Resolution log',
    '_pending — update via ResolveEscalation tool + A3 report (future)_',
    '',
  ].join('\n');
  writeFileSync(file, frontmatter + body, 'utf-8');
  return file;
}

function ensureDir(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}

function formatStamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
