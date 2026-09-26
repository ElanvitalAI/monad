// M9 (2026-04-28) — unit tests for the proto sync lint helpers.
//
// Pure logic only — extractMethodsFromGenerated, extractMethodsFromHandWritten,
// computeMethodDiff. We don't drive the real `codex app-server generate-ts`
// here; that's the script's main() responsibility and lives behind
// ELANOUS_CODEX_TIER1_SMOKE-style env gating in a follow-up PR.

import { describe, test, expect } from 'bun:test';
import {
  extractMethodsFromGenerated,
  extractMethodsFromHandWritten,
  computeMethodDiff,
  extractEnumMembersFromGenerated,
  computeDecisionDrift,
} from '../scripts/check-codex-proto-sync.ts';
import {
  buildCodexApprovalResponse,
  CODEX_APPROVAL_DECISION_CONTRACT,
} from '../src/acp/codex-app-server-agent';

describe('M9 · extractMethodsFromGenerated', () => {
  test('pulls every "method" literal from a discriminated union', () => {
    const source = `
      export type ClientRequest =
        { "method": "thread/start", id: RequestId, params: ThreadStartParams } |
        { "method": "fs/readFile", id: RequestId, params: FsReadFileParams } |
        { "method": "turn/start", id: RequestId, params: TurnStartParams };
    `;
    const result = extractMethodsFromGenerated(source);
    expect(result.size).toBe(3);
    expect(result.has('thread/start')).toBe(true);
    expect(result.has('fs/readFile')).toBe(true);
    expect(result.has('turn/start')).toBe(true);
  });

  test('tolerates whitespace around "method": ', () => {
    const source = `
      { "method"   :   "fs/writeFile", ... } |
      { "method":"thread/resume", ... }
    `;
    const result = extractMethodsFromGenerated(source);
    expect(result.has('fs/writeFile')).toBe(true);
    expect(result.has('thread/resume')).toBe(true);
  });

  test('returns empty set when no method literals', () => {
    const source = `
      // No discriminator here — just imports.
      import type { Foo } from './foo';
      export type Bar = Foo;
    `;
    const result = extractMethodsFromGenerated(source);
    expect(result.size).toBe(0);
  });

  test('ignores escape sequences in method names (defensive)', () => {
    // The generator never emits backslash-bearing method names, but the
    // regex's `[^"\\]+` class is the right shape — verify it short-
    // circuits if a hypothetical malformed input slipped through.
    const source = `{ "method": "good/method" }`;
    const result = extractMethodsFromGenerated(source);
    expect(result.has('good/method')).toBe(true);
  });

  test('extracts ClientNotification methods (initialized + others)', () => {
    const source = `
      export type ClientNotification = { "method": "initialized" };
    `;
    const result = extractMethodsFromGenerated(source);
    expect(result.has('initialized')).toBe(true);
  });
});

describe('M9 · extractMethodsFromHandWritten', () => {
  test('pulls client.request<...> method literals', () => {
    const source = `
      await client.request<P, R>('thread/start', params);
      await client.request<unknown>('turn/interrupt', params);
    `;
    const result = extractMethodsFromHandWritten(source);
    expect(result.has('thread/start')).toBe(true);
    expect(result.has('turn/interrupt')).toBe(true);
  });

  test('pulls client.onNotification + setServerRequestHandler', () => {
    const source = `
      client.onNotification('item/started', (params) => {});
      client.setServerRequestHandler('mcpServer/tool/call', async (params) => ({}));
    `;
    const result = extractMethodsFromHandWritten(source);
    expect(result.has('item/started')).toBe(true);
    expect(result.has('mcpServer/tool/call')).toBe(true);
  });

  test('pulls method-list constants like APPROVAL_METHODS', () => {
    const source = `
      const APPROVAL_METHODS = [
        'item/commandExecution/requestApproval',
        'item/fileChange/requestApproval',
        'item/permissions/requestApproval',
      ] as const;
    `;
    const result = extractMethodsFromHandWritten(source);
    expect(result.has('item/commandExecution/requestApproval')).toBe(true);
    expect(result.has('item/fileChange/requestApproval')).toBe(true);
    expect(result.has('item/permissions/requestApproval')).toBe(true);
  });

  test('ignores debug log category strings (no slash → skip)', () => {
    const source = `
      debug.log('acp.cas.thread-index.put', synthId);
    `;
    const result = extractMethodsFromHandWritten(source);
    // The module-prefixed string contains '.' separators not '/', so
    // it's NOT extracted (we filter on the codex method-name shape).
    expect(result.has('acp.cas.thread-index.put')).toBe(false);
  });

  test('returns empty set when no wire-touching shapes', () => {
    const source = `
      const x = 1; const y = 2; const z = x + y;
    `;
    const result = extractMethodsFromHandWritten(source);
    expect(result.size).toBe(0);
  });

  test('extracts fs/* methods from the M2 handler registration', () => {
    const source = `
      client.setServerRequestHandler('fs/readFile', async (params) => {});
      client.setServerRequestHandler('fs/writeFile', async (params) => {});
    `;
    const result = extractMethodsFromHandWritten(source);
    expect(result.has('fs/readFile')).toBe(true);
    expect(result.has('fs/writeFile')).toBe(true);
  });
});

describe('M9 · computeMethodDiff', () => {
  test('all-shared → diff arrays empty', () => {
    const elanous = new Set(['thread/start', 'turn/start']);
    const codex = new Set(['thread/start', 'turn/start']);
    const diff = computeMethodDiff(elanous, codex);
    expect(diff.elanousOnly).toEqual([]);
    expect(diff.codexOnly).toEqual([]);
    expect(diff.shared).toBe(2);
  });

  test('elanous references method missing from codex → elanousOnly populated', () => {
    const elanous = new Set(['thread/start', 'thread/legacyStart']);
    const codex = new Set(['thread/start']);
    const diff = computeMethodDiff(elanous, codex);
    expect(diff.elanousOnly).toEqual(['thread/legacyStart']);
    expect(diff.codexOnly).toEqual([]);
    expect(diff.shared).toBe(1);
  });

  test('codex adds new method → codexOnly populated', () => {
    const elanous = new Set(['thread/start']);
    const codex = new Set(['thread/start', 'thread/newRpc']);
    const diff = computeMethodDiff(elanous, codex);
    expect(diff.elanousOnly).toEqual([]);
    expect(diff.codexOnly).toEqual(['thread/newRpc']);
    expect(diff.shared).toBe(1);
  });

  test('both directions populate independently', () => {
    const elanous = new Set(['a/x', 'b/y']);
    const codex = new Set(['b/y', 'c/z']);
    const diff = computeMethodDiff(elanous, codex);
    expect(diff.elanousOnly).toEqual(['a/x']);
    expect(diff.codexOnly).toEqual(['c/z']);
    expect(diff.shared).toBe(1);
  });

  test('result arrays are sorted', () => {
    const elanous = new Set(['z/late', 'a/early', 'm/mid']);
    const codex = new Set<string>();
    const diff = computeMethodDiff(elanous, codex);
    expect(diff.elanousOnly).toEqual(['a/early', 'm/mid', 'z/late']);
  });
});

// ─── Approval-decision drift guard (the check that would have caught the
//     approve/deny → accept/decline breakage) ─────────────────────────

describe('extractEnumMembersFromGenerated', () => {
  test('extracts string-literal union members, ignoring object variants + keys', () => {
    const src = `export type CommandExecutionApprovalDecision =
      | "accept"
      | "acceptForSession"
      | { "acceptWithExecpolicyAmendment": { execpolicyAmendment: unknown } }
      | "decline"
      | "cancel";`;
    const m = extractEnumMembersFromGenerated(src, 'CommandExecutionApprovalDecision');
    expect([...m].sort()).toEqual(['accept', 'acceptForSession', 'cancel', 'decline']);
    // object-variant KEY is not a bare member
    expect(m.has('acceptWithExecpolicyAmendment')).toBe(false);
  });

  test('returns empty set when the type is absent', () => {
    expect(extractEnumMembersFromGenerated('export type Other = "x";', 'Missing').size).toBe(0);
  });
});

describe('computeDecisionDrift', () => {
  test('flags emitted values missing from codex enum', () => {
    const drift = computeDecisionDrift(
      [{ method: 'm', enumType: 'D', emits: ['accept', 'decline'] }],
      // codex dropped 'decline'
      () => 'export type D = "accept" | "acceptForSession" | "cancel";',
    );
    expect(drift[0]!.enumFound).toBe(true);
    expect(drift[0]!.missing).toEqual(['decline']);
  });

  test('no drift when every emitted value is a member', () => {
    const drift = computeDecisionDrift(
      [{ method: 'm', enumType: 'D', emits: ['accept', 'decline'] }],
      () => 'export type D = "accept" | "decline" | "cancel";',
    );
    expect(drift[0]!.missing).toEqual([]);
  });

  test('enumFound=false when the enum file is not generated', () => {
    const drift = computeDecisionDrift([{ method: 'm', enumType: 'Gone', emits: ['a'] }], () => null);
    expect(drift[0]!.enumFound).toBe(false);
    expect(drift[0]!.missing).toEqual([]);
  });
});

describe('CODEX_APPROVAL_DECISION_CONTRACT ↔ buildCodexApprovalResponse', () => {
  test('contract emits exactly what the response builder produces (manifest stays in sync)', () => {
    for (const entry of CODEX_APPROVAL_DECISION_CONTRACT) {
      const emitted = new Set<string>();
      // Drive every (approved × scope) combo so session-scoped values
      // (acceptForSession) are exercised too.
      const combos: Array<[boolean, 'once' | 'session' | undefined]> = [
        [true, 'once'], [true, 'session'], [true, undefined], [false, undefined],
      ];
      for (const [approved, scope] of combos) {
        const r = buildCodexApprovalResponse(entry.method, approved, scope ? { scope } : undefined) as { decision?: string };
        expect(typeof r.decision).toBe('string');
        emitted.add(r.decision!);
      }
      expect([...emitted].sort()).toEqual([...entry.emits].slice().sort());
    }
  });

  test('contract never contains the stale approve/deny values', () => {
    for (const entry of CODEX_APPROVAL_DECISION_CONTRACT) {
      expect(entry.emits).not.toContain('approve');
      expect(entry.emits).not.toContain('deny');
    }
  });
});
