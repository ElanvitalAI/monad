import { debug } from '../debug/log.js';
import {
  verifyDeployedPage,
  type DeployUnmeasuredCheck,
  type DeployVerifyDeps,
  type DeployVerifyFinding,
  type DeployVerifyResult,
} from './browser-verify.js';

export type DeliverableObservationTarget = {
  taskId: string;
  target: string;
};

export type DeliverableObservationDeps = {
  verify?: (target: string, deps?: Pick<DeployVerifyDeps, 'backend'>) => Promise<DeployVerifyResult>;
  backend?: DeployVerifyDeps['backend'];
};

export type UnmeasuredDeliverable =
  | {
    taskId: string;
    kind: 'deliverable-unobserved';
    reason: 'no-cdp' | 'verify-exception' | 'legacy-findings';
    error?: unknown;
  }
  | {
    taskId: string;
    kind: 'signal-unmeasured';
    reason: DeployUnmeasuredCheck;
  };

export type DeliverableObservationResult = {
  deployFindings: ReadonlyMap<string, {
    target: string;
    findings?: readonly DeployVerifyFinding[];
  }>;
  unmeasured: readonly UnmeasuredDeliverable[];
};

const observe = (event: string, data: Record<string, unknown>): void => {
  try { debug.log('harness.deliverable-observation', event, data); } catch { /* fail-soft */ }
};

export async function observeDeliverables(
  targets: readonly DeliverableObservationTarget[],
  deps: DeliverableObservationDeps = {},
): Promise<DeliverableObservationResult> {
  const verify = deps.verify ?? verifyDeployedPage;
  const deployFindings = new Map<string, { target: string; findings?: readonly DeployVerifyFinding[] }>();
  const unmeasured: UnmeasuredDeliverable[] = [];

  for (const { taskId, target } of targets) {
    try {
      const result = await verify(target, { backend: deps.backend });
      if (result.skipped === 'no-cdp') {
        unmeasured.push({ taskId, kind: 'deliverable-unobserved', reason: 'no-cdp' });
        observe('unmeasured', { taskId, target, kind: 'deliverable-unobserved', reason: 'no-cdp' });
        continue;
      }
      const legacyFindingsUnmeasured = result.structuredFindings === undefined
        && (!result.ok || result.findings.length > 0);
      if (legacyFindingsUnmeasured) {
        unmeasured.push({ taskId, kind: 'deliverable-unobserved', reason: 'legacy-findings' });
        observe('unmeasured', { taskId, target, kind: 'deliverable-unobserved', reason: 'legacy-findings' });
        continue;
      }
      if (result.unmeasured?.length) {
        for (const reason of result.unmeasured) {
          unmeasured.push({ taskId, kind: 'signal-unmeasured', reason });
        }
        // Conservative: signal-unmeasured targets stay out of repair triage; src/harness/web-executor.test.ts fixes this contract.
        observe('measured', {
          taskId,
          target,
          findings: result.structuredFindings ?? [],
          unmeasured: result.unmeasured,
        });
        continue;
      }
      if (result.structuredFindings?.length) {
        deployFindings.set(taskId, { target, findings: result.structuredFindings });
      } else {
        deployFindings.set(taskId, { target });
      }
      observe('measured', {
        taskId,
        target,
        findings: result.structuredFindings ?? [],
        unmeasured: result.unmeasured ?? [],
      });
    } catch (error) {
      unmeasured.push({ taskId, kind: 'deliverable-unobserved', reason: 'verify-exception', error });
      observe('unmeasured', { taskId, target, kind: 'deliverable-unobserved', reason: 'verify-exception' });
    }
  }

  return { deployFindings, unmeasured };
}
