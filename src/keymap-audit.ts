import { KEYBINDINGS, CONTEXT_LABELS, type KeyBinding, type KeyContext } from './keybindings.js';

export type KeymapSeverity = 'info' | 'warning' | 'error';

export interface KeymapIssue {
  severity: KeymapSeverity;
  key: string;
  contexts: KeyContext[];
  actions: string[];
  message: string;
}

export interface KeymapAuditResult {
  bindingCount: number;
  contextCount: number;
  duplicateCount: number;
  issues: KeymapIssue[];
}

const GLOBAL_CONTEXTS = new Set<KeyContext>(['global']);
const EXCLUSIVE_CONTEXTS = new Set<KeyContext>([
  'input',
  'log',
  'browser',
  'preview',
  'select',
  'memo',
  'clipboard',
  'widget-list',
  'widget-md',
]);

export function normalizeKeyLabel(key: string): string {
  const parts = key
    .split('+')
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  const base = parts.pop()!;
  const mods = new Set(parts.map(normalizeModifier));
  const ordered = ['Ctrl', 'Alt', 'Shift', 'Meta'].filter(m => mods.has(m));
  return [...ordered, normalizeBaseKey(base)].join('+');
}

function normalizeModifier(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'c' || lower === 'ctrl' || lower === 'control') return 'Ctrl';
  if (lower === 'a' || lower === 'alt' || lower === 'option') return 'Alt';
  if (lower === 's' || lower === 'shift') return 'Shift';
  if (lower === 'm' || lower === 'meta' || lower === 'cmd' || lower === 'super') return 'Meta';
  return value;
}

function normalizeBaseKey(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'space' || value === ' ') return 'Space';
  if (lower === 'esc') return 'Esc';
  if (lower === 'return') return 'Enter';
  if (lower === 'pgup') return 'PageUp';
  if (lower === 'pgdn') return 'PageDown';
  if (lower === 'up') return '↑';
  if (lower === 'down') return '↓';
  if (lower === 'left') return '←';
  if (lower === 'right') return '→';
  if (value.length === 1) return value;
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function auditKeybindings(bindings: KeyBinding[] = KEYBINDINGS): KeymapAuditResult {
  const byKey = new Map<string, KeyBinding[]>();
  for (const binding of bindings) {
    for (const key of binding.keys) {
      const normalized = normalizeKeyLabel(key);
      if (!normalized) continue;
      const list = byKey.get(normalized) ?? [];
      list.push(binding);
      byKey.set(normalized, list);
    }
  }

  const issues: KeymapIssue[] = [];
  for (const [key, hits] of byKey) {
    if (hits.length < 2) continue;
    const contexts = [...new Set(hits.map(h => h.context))];
    const actions = [...new Set(hits.map(h => h.action))];
    if (actions.length < 2) continue;
    const severity = classifyDuplicate(contexts);
    issues.push({
      severity,
      key,
      contexts,
      actions,
      message: issueMessage(severity, key, contexts),
    });
  }

  issues.sort((a, b) =>
    severityRank(b.severity) - severityRank(a.severity)
    || a.key.localeCompare(b.key)
    || a.contexts.join(',').localeCompare(b.contexts.join(',')));

  return {
    bindingCount: bindings.length,
    contextCount: Object.keys(CONTEXT_LABELS).length,
    duplicateCount: issues.length,
    issues,
  };
}

function classifyDuplicate(contexts: KeyContext[]): KeymapSeverity {
  if (contexts.every(c => EXCLUSIVE_CONTEXTS.has(c)) && !contexts.some(c => GLOBAL_CONTEXTS.has(c))) {
    return 'info';
  }
  if (contexts.some(c => GLOBAL_CONTEXTS.has(c)) && contexts.length > 1) return 'warning';
  return 'warning';
}

function issueMessage(severity: KeymapSeverity, key: string, contexts: KeyContext[]): string {
  const label = contexts.map(c => CONTEXT_LABELS[c]).join(' / ');
  if (severity === 'info') return `${key} is reused across exclusive contexts: ${label}`;
  if (severity === 'warning') return `${key} needs explicit routing priority across: ${label}`;
  return `${key} conflicts in the same routing layer: ${label}`;
}

function severityRank(severity: KeymapSeverity): number {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

export function renderKeymapAudit(result: KeymapAuditResult = auditKeybindings()): string {
  const lines: string[] = [
    `keybindings: ${result.bindingCount}`,
    `contexts: ${result.contextCount}`,
    `duplicates needing review: ${result.duplicateCount}`,
  ];
  if (result.issues.length === 0) {
    lines.push('no duplicate key issues found');
    return lines.join('\n');
  }
  lines.push('');
  for (const issue of result.issues) {
    lines.push(`[${issue.severity}] ${issue.message}`);
    lines.push(`  actions: ${issue.actions.join(' | ')}`);
  }
  return lines.join('\n');
}

