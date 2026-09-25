// M4-2 (2026-05-12 · Phase 4 N5-2) — pre-create validation framework.
//
// Workflow 가 schema-valid 라도 사용자가 의도하지 않은 비용 / 동작 /
// 누락을 일으킬 수 있는 패턴을 deterministic 으로 catch + actionable
// suggestion 제공. R3 NL synth 가 합성 retry 시 LLM 에 hint 로 전달
// 가능 (V2.2-9 dogfood gate 80% 도달 도움).
//
// F2 default (ROADMAP §2 · 2026-05-12) — **deterministic only**.
// LLM-driven warnings 는 v2 옵션. v1 은 비용 0 · latency 0.
//
// Rules (v1 · 7종):
//   1. cron-too-frequent      (high)   — cron expression 이 매 분 미만
//   2. interval-too-small     (high)   — schedule interval < 60s
//   3. missing-upstream-output (medium) — $<id>.output 참조 미존재 id
//   4. excessive-llm-nodes    (low)    — prompt+classify+extract ≥ 5
//   5. no-trigger-node        (medium) — trigger 노드 0건 (manual 포함)
//   6. hosted-chat-no-auth    (high)   — hostedUi.enabled + bearer/auth 둘 다 없음
//   7. chat-streaming-no-llm  (low)    — streaming=true 인데 LLM 노드 0건

import type {
  WorkflowDefinition,
  DagNode,
  ChatTriggerNode,
  ScheduleTriggerNode,
} from './types.js';

export type ValidationWarningSeverity = 'high' | 'medium' | 'low';

export interface ValidationWarning {
  /** Stable identifier — UI / R3 hint 매핑 용. */
  code: string;
  severity: ValidationWarningSeverity;
  /** 1-line human-readable issue. */
  message: string;
  /** Optional pointer for editor highlight. */
  nodeId?: string;
  /** Optional YAML path (e.g. `nodes[2].scheduleTrigger.interval`). */
  path?: string;
  /** Human-readable suggestion (1-2 sentences) — what the author should do. */
  suggestion?: string;
}

/** Build deterministic warnings for an already-validated workflow.
 *  Caller passes a `WorkflowDefinition` (schema-valid) — for raw
 *  YAML, call `validateWorkflow` first and only build warnings on
 *  `ok=true`. */
export function buildWarnings(workflow: WorkflowDefinition): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Rule 1+2 — schedule trigger frequency.
  for (const node of workflow.nodes) {
    const schedule = (node as ScheduleTriggerNode).scheduleTrigger;
    if (!schedule) continue;
    if (schedule.type === 'cron' && schedule.cron && isCronTooFrequent(schedule.cron)) {
      warnings.push({
        code: 'cron-too-frequent',
        severity: 'high',
        message: `cron '${schedule.cron}' fires every minute or more often — high LLM/cost risk`,
        nodeId: node.id,
        path: `nodes.${node.id}.scheduleTrigger.cron`,
        suggestion: "use at least 'every 5 minutes' (e.g. '*/5 * * * *') unless intentional",
      });
    }
    if (schedule.type === 'interval' && typeof schedule.interval === 'number' && schedule.interval < 60_000) {
      warnings.push({
        code: 'interval-too-small',
        severity: 'high',
        message: `interval=${schedule.interval}ms fires more than once per minute — high LLM/cost risk`,
        nodeId: node.id,
        path: `nodes.${node.id}.scheduleTrigger.interval`,
        suggestion: 'set interval ≥ 60000 (1 minute) unless intentional',
      });
    }
  }

  // Rule 3 — `$<id>.output` references must resolve to a node id.
  const knownIds = new Set(workflow.nodes.map(n => n.id));
  for (const node of workflow.nodes) {
    const refs = collectOutputRefs(node);
    for (const ref of refs) {
      if (!knownIds.has(ref.targetId)) {
        warnings.push({
          code: 'missing-upstream-output',
          severity: 'medium',
          message: `'$${ref.targetId}.${ref.field}' in node '${node.id}' references unknown node '${ref.targetId}'`,
          nodeId: node.id,
          path: `nodes.${node.id}.${ref.fieldPath}`,
          suggestion: `add a node with id '${ref.targetId}' upstream, or fix the reference`,
        });
      }
    }
  }

  // Rule 4 — too many LLM nodes (prompt + classify + extract).
  const llmCount = workflow.nodes.filter(n => {
    const r = n as unknown as Record<string, unknown>;
    return r['prompt'] !== undefined
      || r['classify'] !== undefined
      || r['extract'] !== undefined;
  }).length;
  if (llmCount >= 5) {
    warnings.push({
      code: 'excessive-llm-nodes',
      severity: 'low',
      message: `${llmCount} LLM nodes (prompt/classify/extract) — consider consolidating to reduce cost`,
      suggestion: 'one combined prompt with $ARGUMENTS + output_format often replaces 3-4 LLM nodes',
    });
  }

  // Rule 5 — no trigger node at all (manualTrigger counts).
  const triggerCount = workflow.nodes.filter(isAnyTrigger).length;
  if (triggerCount === 0) {
    warnings.push({
      code: 'no-trigger-node',
      severity: 'medium',
      message: 'workflow has no trigger node — it cannot run on its own',
      suggestion: 'add a schedule/webhook/chat/discord/telegram/manual trigger node',
    });
  }

  // Rule 6 — hosted chat without auth.
  for (const node of workflow.nodes) {
    const chat = (node as ChatTriggerNode).chatTrigger;
    if (!chat) continue;
    const hostedEnabled = chat.hostedUi?.enabled === true;
    const hasBearer = (chat.auth?.type === 'bearer' && chat.auth.token.length > 0)
      || (typeof chat.hostedUi?.bearer === 'string' && chat.hostedUi.bearer.length > 0);
    if (hostedEnabled && !hasBearer) {
      warnings.push({
        code: 'hosted-chat-no-auth',
        severity: 'high',
        message: `hosted chat UI is enabled on node '${node.id}' but no bearer is configured — chat is publicly callable`,
        nodeId: node.id,
        path: `nodes.${node.id}.chatTrigger.hostedUi`,
        suggestion: "set chatTrigger.hostedUi.bearer or chatTrigger.auth.token to a non-empty secret",
      });
    }

    // Rule 7 — chat streaming without any LLM node.
    if (chat.streaming === true && llmCount === 0) {
      warnings.push({
        code: 'chat-streaming-no-llm',
        severity: 'low',
        message: `chat trigger '${node.id}' opts into streaming but the workflow has no LLM node — token frames will be empty`,
        nodeId: node.id,
        path: `nodes.${node.id}.chatTrigger.streaming`,
        suggestion: "add a prompt/classify/extract node, or set streaming: false",
      });
    }
  }

  return warnings;
}

// ── helpers ────────────────────────────────────────────────────────

/** Cron expression fires "every minute" when the minute field is
 *  unrestricted (plain `* * * * *` or any cron with minute=`*`).
 *  Tightened later if false positives surface — downgrade to medium
 *  severity if too noisy. */
function isCronTooFrequent(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  // Standard 5-field cron; 6-field (with seconds) also caught when minute=*
  // and seconds=*.
  if (parts.length < 5 || parts.length > 6) return false;
  const minuteField = parts.length === 5 ? parts[0] : parts[1];
  if (minuteField === '*') return true;
  // `*/1` and explicit `0-59` cover the same span.
  if (minuteField === '*/1' || minuteField === '0-59') return true;
  return false;
}

function isAnyTrigger(node: DagNode): boolean {
  const n = node as unknown as Record<string, unknown>;
  return n['scheduleTrigger'] !== undefined
    || n['webhookTrigger'] !== undefined
    || n['chatTrigger'] !== undefined
    || n['discordTrigger'] !== undefined
    || n['telegramTrigger'] !== undefined
    || n['manualTrigger'] !== undefined;
}

interface OutputRef {
  targetId: string;
  field: string;
  /** Subfield-tail of the YAML path for editor highlight. */
  fieldPath: string;
}

/** Walk a node's interpolation-bearing string fields and collect
 *  `$<id>.output` / `$<id>.output.field` references. Conservative: we
 *  only inspect the well-known string fields each variant exposes
 *  (`prompt` · `bash` · `template.template` · `iteration.items/body`
 *  etc) — adding new variants only widens the scan surface, never
 *  changes existing behavior. */
function collectOutputRefs(node: DagNode): OutputRef[] {
  const out: OutputRef[] = [];
  const n = node as unknown as Record<string, unknown>;
  const scan = (source: string | undefined, fieldPath: string): void => {
    if (typeof source !== 'string') return;
    // Two interpolation surfaces in the runtime:
    //   • `$<id>.output[.<field>]` — used by prompt/bash/when/if/etc.
    //   • `{{ <id>.output[.<field>] }}` — Handlebars-lite template node.
    // Scan both so a Template-node reference to a missing upstream id
    // also surfaces a warning.
    const dollarRe = /\$([A-Za-z][A-Za-z0-9_-]*)\.output(?:\.([A-Za-z_][A-Za-z0-9_]*))?/g;
    const mustacheRe = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\.output(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*\}\}/g;
    for (const re of [dollarRe, mustacheRe]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const targetId = m[1]!;
        // ARGUMENTS / ARTIFACTS_DIR are well-known runtime tokens, not
        // node ids — skip so we don't surface spurious warnings.
        if (targetId === 'ARGUMENTS' || targetId === 'ARTIFACTS_DIR') continue;
        out.push({
          targetId,
          field: m[2] ?? 'output',
          fieldPath,
        });
      }
    }
  };

  if (typeof n['prompt'] === 'string') scan(n['prompt'] as string, 'prompt');
  if (typeof n['bash'] === 'string') scan(n['bash'] as string, 'bash');
  const template = n['template'] as Record<string, unknown> | undefined;
  if (template && typeof template['template'] === 'string') scan(template['template'] as string, 'template.template');
  const iteration = n['iteration'] as Record<string, unknown> | undefined;
  if (iteration) {
    if (typeof iteration['items'] === 'string') scan(iteration['items'] as string, 'iteration.items');
    if (typeof iteration['body'] === 'string') scan(iteration['body'] as string, 'iteration.body');
  }
  const filter = n['filter'] as Record<string, unknown> | undefined;
  if (filter) {
    if (typeof filter['items'] === 'string') scan(filter['items'] as string, 'filter.items');
    if (typeof filter['condition'] === 'string') scan(filter['condition'] as string, 'filter.condition');
  }
  const classify = n['classify'] as Record<string, unknown> | undefined;
  if (classify && typeof classify['input'] === 'string') scan(classify['input'] as string, 'classify.input');
  const extract = n['extract'] as Record<string, unknown> | undefined;
  if (extract && typeof extract['input'] === 'string') scan(extract['input'] as string, 'extract.input');
  const switchNode = n['switch'] as Record<string, unknown> | undefined;
  if (switchNode && typeof switchNode['value'] === 'string') scan(switchNode['value'] as string, 'switch.value');
  const ifNode = n['if'] as Record<string, unknown> | undefined;
  if (ifNode && typeof ifNode['condition'] === 'string') scan(ifNode['condition'] as string, 'if.condition');
  const set = n['set'] as Record<string, unknown> | undefined;
  if (set) {
    const fields = set['fields'] as Record<string, unknown> | undefined;
    if (fields) {
      for (const [key, val] of Object.entries(fields)) {
        if (typeof val === 'string') scan(val, `set.fields.${key}`);
      }
    }
  }
  // when clause — works on any node variant.
  if (typeof n['when'] === 'string') scan(n['when'] as string, 'when');

  return out;
}
