// V2.2-2 (2026-05-12) — hosted chat trigger: schema · bearer
// constant-time · `chatConfig` daemon surface.
//
// Server-side coverage. The PWA hosted page (apps/pwa/src/app/
// workflows/chat-ui/page.tsx + components/workflows/HostedChatPanel
// .tsx) is exercised via the SSE parser test in the lib helper +
// future browser smoke.

import { describe, expect, it } from 'bun:test';
import {
  buildChatRouter,
  constantTimeEqual,
  type ChatRegistryEntry,
} from '../src/workflow-runtime/triggers/chat-router';
import { validateWorkflow } from '../src/workflow-runtime/schema';
import { createWorkflowRuntimeDaemon } from '../src/workflow-runtime/daemon';
import type { WorkflowDeps, WorkflowEntry } from '../src/workflow-runtime/types';

function wf(name: string, nodes: Array<Record<string, unknown>>): WorkflowEntry {
  return ({
    source: { kind: 'project', source: `${name}.yaml`, path: `${name}.yaml` },
    definition: { name, description: name, nodes },
  } as unknown) as WorkflowEntry;
}

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });
  it('returns false for unequal same-length strings', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('123', '321')).toBe(false);
  });
  it('returns false for different-length strings (length is not a secret)', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });
});

describe('chat router · V2.2-2 bearer gate', () => {
  it('accepts hostedUi.bearer in addition to auth.token', async () => {
    const entry: ChatRegistryEntry = {
      workflowName: 'wf',
      nodeId: 'in',
      trigger: {
        path: '/chat',
        hostedUi: { enabled: true, bearer: 'hosted-secret' },
      },
    };
    const dispatch = buildChatRouter({
      registry: [entry],
      runWorkflow: async () => ({ ok: true as const, output: 'ok', runId: 'r' }),
    });
    const res = await dispatch({
      path: '/chat',
      authorization: 'Bearer hosted-secret',
      body: { message: 'hi' },
    });
    expect(res.status).toBe(200);
  });

  it('still accepts auth.token when both are configured', async () => {
    const entry: ChatRegistryEntry = {
      workflowName: 'wf',
      nodeId: 'in',
      trigger: {
        path: '/chat',
        auth: { type: 'bearer', token: 'auth-secret' },
        hostedUi: { enabled: true, bearer: 'hosted-secret' },
      },
    };
    const dispatch = buildChatRouter({
      registry: [entry],
      runWorkflow: async () => ({ ok: true as const, output: 'ok', runId: 'r' }),
    });
    const res = await dispatch({
      path: '/chat',
      authorization: 'Bearer auth-secret',
      body: { message: 'hi' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when the bearer does not match either token', async () => {
    const entry: ChatRegistryEntry = {
      workflowName: 'wf',
      nodeId: 'in',
      trigger: {
        path: '/chat',
        auth: { type: 'bearer', token: 'auth-secret' },
        hostedUi: { enabled: true, bearer: 'hosted-secret' },
      },
    };
    const dispatch = buildChatRouter({
      registry: [entry],
      runWorkflow: async () => ({ ok: true as const, output: 'never', runId: 'r' }),
    });
    const res = await dispatch({
      path: '/chat',
      authorization: 'Bearer wrong',
      body: { message: 'hi' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when no authorization header is supplied', async () => {
    const entry: ChatRegistryEntry = {
      workflowName: 'wf',
      nodeId: 'in',
      trigger: { path: '/chat', hostedUi: { enabled: true, bearer: 'x' } },
    };
    const dispatch = buildChatRouter({
      registry: [entry],
      runWorkflow: async () => ({ ok: true as const, output: 'never', runId: 'r' }),
    });
    const res = await dispatch({ path: '/chat', body: { message: 'hi' } });
    expect(res.status).toBe(401);
  });

  it('skips the gate when neither token is configured (open chat)', async () => {
    const entry: ChatRegistryEntry = {
      workflowName: 'wf',
      nodeId: 'in',
      trigger: { path: '/open', hostedUi: { enabled: true } },
    };
    const dispatch = buildChatRouter({
      registry: [entry],
      runWorkflow: async () => ({ ok: true as const, output: 'ok', runId: 'r' }),
    });
    const res = await dispatch({ path: '/open', body: { message: 'hi' } });
    expect(res.status).toBe(200);
  });
});

describe('chatTrigger schema · hostedUi validation', () => {
  it('accepts { enabled: true } without bearer', () => {
    const wfDef = wf('hosted', [
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: true } } },
    ]);
    const res = validateWorkflow(wfDef.definition);
    expect(res.ok).toBe(true);
  });

  it('accepts { enabled: true, bearer: <string> }', () => {
    const wfDef = wf('hosted', [
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: true, bearer: 'tok' } } },
    ]);
    const res = validateWorkflow(wfDef.definition);
    expect(res.ok).toBe(true);
  });

  it('rejects non-boolean enabled', () => {
    const wfDef = wf('hosted', [
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: 'yes' } } },
    ]);
    const res = validateWorkflow(wfDef.definition);
    expect(res.ok).toBe(false);
    expect(res.issues.some((e: { path: string }) => e.path.includes('hostedUi.enabled'))).toBe(true);
  });

  it('rejects non-string bearer', () => {
    const wfDef = wf('hosted', [
      { id: 'in', chatTrigger: { path: '/c', hostedUi: { enabled: true, bearer: 123 } } },
    ]);
    const res = validateWorkflow(wfDef.definition);
    expect(res.ok).toBe(false);
    expect(res.issues.some((e: { path: string }) => e.path.includes('hostedUi.bearer'))).toBe(true);
  });
});

describe('workflow-runtime daemon · chatConfig surface', () => {
  const deps = {} as WorkflowDeps;

  it('returns the chat trigger config when hostedUi is enabled', async () => {
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [
        wf('hosted-stream', [
          {
            id: 'in',
            chatTrigger: {
              path: '/c',
              streaming: true,
              sessionMode: 'per-session',
              hostedUi: { enabled: true, bearer: 't' },
              auth: { type: 'bearer', token: 'a' },
            },
          },
          { id: 'reply', prompt: 'unused', depends_on: ['in'] },
        ]),
      ],
      deps,
    });
    const cfg = daemon.chatConfig('hosted-stream');
    expect(cfg).not.toBeNull();
    expect(cfg).toMatchObject({
      workflowName: 'hosted-stream',
      nodeId: 'in',
      path: '/c',
      streaming: true,
      sessionMode: 'per-session',
      hostedUi: { enabled: true, requiresBearer: true },
    });
  });

  it('returns null when hostedUi is omitted or disabled', () => {
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [
        wf('plain', [
          { id: 'in', chatTrigger: { path: '/p' } },
          { id: 'reply', prompt: 'unused', depends_on: ['in'] },
        ]),
        wf('disabled', [
          { id: 'in', chatTrigger: { path: '/d', hostedUi: { enabled: false } } },
          { id: 'reply', prompt: 'unused', depends_on: ['in'] },
        ]),
      ],
      deps,
    });
    expect(daemon.chatConfig('plain')).toBeNull();
    expect(daemon.chatConfig('disabled')).toBeNull();
  });

  it('returns null for unknown workflow names', () => {
    const daemon = createWorkflowRuntimeDaemon({ workflows: [], deps });
    expect(daemon.chatConfig('does-not-exist')).toBeNull();
  });

  it('falls back to fresh disk discovery when workflow was not in the boot entry list', () => {
    // Drop a chat trigger YAML into a project dir after daemon construction.
    // Simulates: user creates `.monad/workflows/late.yaml` while NEXUS is
    // already running. Without the fallback, chatConfig would say
    // 'not_found' even though /v1/workflows lists it via fresh discoverWorkflows.
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');
    const tmp = mkdtempSync(join(tmpdir(), 'chat-cfg-fallback-'));
    mkdirSync(join(tmp, '.monad', 'workflows'), { recursive: true });
    writeFileSync(
      join(tmp, '.monad', 'workflows', 'late.yaml'),
      `name: late\ndescription: dropped after boot\nnodes:\n  - id: in\n    chatTrigger:\n      path: /late\n      hostedUi: { enabled: true, bearer: tok }\n  - id: reply\n    depends_on: [in]\n    prompt: x\n`,
      'utf-8',
    );
    const prevCwd = process.cwd();
    process.chdir(tmp);
    try {
      const daemon = createWorkflowRuntimeDaemon({ workflows: [], deps });
      const cfg = daemon.chatConfig('late');
      expect(cfg).not.toBeNull();
      expect(cfg?.path).toBe('/late');
      expect(cfg?.hostedUi.enabled).toBe(true);
    } finally {
      process.chdir(prevCwd);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('reports requiresBearer=false when no token is configured', () => {
    const daemon = createWorkflowRuntimeDaemon({
      workflows: [
        wf('open', [
          { id: 'in', chatTrigger: { path: '/o', hostedUi: { enabled: true } } },
          { id: 'reply', prompt: 'unused', depends_on: ['in'] },
        ]),
      ],
      deps,
    });
    const cfg = daemon.chatConfig('open');
    expect(cfg?.hostedUi.requiresBearer).toBe(false);
  });
});
