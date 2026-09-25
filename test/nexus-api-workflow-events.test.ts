// D4 · §6.4 SSE — `/v1/workflows/events` handler contract.
//
// Coverage:
//   - hello frame names every present source dir + skipped ones
//   - file-relevance filter (yaml only · `_*` prefix skipped · no
//     bare-extension match)
//   - 401 short-circuit when auth fails (no stream opened)
//
// fs.watch behaviour is environment-dependent (macOS = FSEvents · Linux
// = inotify) so we don't drive a real watch in unit tests; the change-
// event path is exercised via the pure `isWorkflowYamlEvent` helper.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  handleWorkflowsEvents,
  isWorkflowYamlEvent,
} from '../src/nexus/api/workflow-events.js';

let root: string;
let projectDir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'workflow-events-test-'));
  projectDir = join(root, 'workflows');
  mkdirSync(projectDir, { recursive: true });
  // Seed one yaml so the discovery path sees a non-empty source.
  writeFileSync(join(projectDir, 'hello.yaml'), 'name: hello\nnodes: []\n');
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('isWorkflowYamlEvent · filter helper', () => {
  test('accepts .yaml + .yml', () => {
    expect(isWorkflowYamlEvent('a.yaml', 'rename')).toBe(true);
    expect(isWorkflowYamlEvent('a.yml', 'change')).toBe(true);
  });

  test('rejects unrelated extensions', () => {
    expect(isWorkflowYamlEvent('a.txt', 'rename')).toBe(false);
    expect(isWorkflowYamlEvent('a.json', 'change')).toBe(false);
    expect(isWorkflowYamlEvent('a', 'rename')).toBe(false);
  });

  test('rejects reserved `_*` prefix files (same rule as discovery walker)', () => {
    expect(isWorkflowYamlEvent('_partial.yaml', 'rename')).toBe(false);
    expect(isWorkflowYamlEvent('_template.yml', 'change')).toBe(false);
  });

  test('rejects empty filename (some platforms emit fs.watch with null name)', () => {
    expect(isWorkflowYamlEvent('', 'rename')).toBe(false);
  });

  test('case-insensitive extension match', () => {
    expect(isWorkflowYamlEvent('a.YAML', 'change')).toBe(true);
    expect(isWorkflowYamlEvent('a.YML', 'rename')).toBe(true);
  });
});

describe('handleWorkflowsEvents · response shape', () => {
  test('200 + text/event-stream + no-cache headers', () => {
    const res = handleWorkflowsEvents(
      new Request('http://localhost/v1/workflows/events'),
      { workflowDirs: [{ source: 'project', dir: projectDir }] },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(res.headers.get('connection')).toBe('keep-alive');
    void res.body?.cancel();
  });

  test('hello frame names the present source', async () => {
    const res = handleWorkflowsEvents(
      new Request('http://localhost/v1/workflows/events'),
      { workflowDirs: [{ source: 'project', dir: projectDir }] },
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain('event: hello');
    expect(text).toContain('"source":"project"');
    expect(text).toContain(projectDir);
    void reader.cancel();
  });

  test('hello frame lists absent dirs under `skipped`', async () => {
    const absent = join(root, 'definitely-not-here');
    const res = handleWorkflowsEvents(
      new Request('http://localhost/v1/workflows/events'),
      {
        workflowDirs: [
          { source: 'project', dir: projectDir },
          { source: 'global', dir: absent },
        ],
      },
    );
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);
    expect(text).toContain('"skipped"');
    expect(text).toContain('"source":"global"');
    expect(text).toContain('"reason":"absent"');
    void reader.cancel();
  });

  test('checkAuth callback returning false → 401 without opening a stream', () => {
    const res = handleWorkflowsEvents(
      new Request('http://localhost/v1/workflows/events'),
      {
        workflowDirs: [{ source: 'project', dir: projectDir }],
        checkAuth: () => false,
      },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  test('omitted checkAuth → opens stream (test default)', async () => {
    const res = handleWorkflowsEvents(
      new Request('http://localhost/v1/workflows/events'),
      { workflowDirs: [{ source: 'project', dir: projectDir }] },
    );
    expect(res.status).toBe(200);
    void res.body?.cancel();
  });
});
