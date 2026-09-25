import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./watch-abort-cycles.py', import.meta.url));
const importProgram = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('watch_abort_cycles', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
payload = json.loads(sys.stdin.read())
contents = payload['contents']
def read_artifact(path):
    value = contents[path]
    if value == '__UNREADABLE__':
        raise OSError('unreadable')
    return value
print(json.dumps(module.classify_ledger_body(payload['ledgerBody'], read_artifact)))
`;

function ledgerBody(entries: Array<{ path: string; reason?: string }>): string {
  return entries.map(({ path, reason }) => JSON.stringify({ data: { childSummaryArtifactPath: path, ...(reason ? { reason } : {}) } })).join('\n');
}

function classify(ledger: string, contents: Record<string, string>): string {
  const result = Bun.spawnSync({
    cmd: ['python3', '-B', '-c', importProgram, scriptPath],
    stdin: new TextEncoder().encode(JSON.stringify({ ledgerBody: ledger, contents })),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

describe('watch-abort-cycles classify_ledger_body', () => {
  test('excludes fixture-only artifacts', () => {
    expect(classify(ledgerBody([{ path: '/fixture-a' }, { path: '/fixture-b' }]), {
      '/fixture-a': 'failed',
      '/fixture-b': 'done',
    })).toBe('');
  });

  test('returns n=2 and retains the last reason for two real artifacts', () => {
    expect(classify(ledgerBody([
      { path: '/real-a', reason: 'first reason' },
      { path: '/real-b', reason: 'last reason' },
    ]), {
      '/real-a': 'actual abort report',
      '/real-b': 'another abort report',
    })).toEqual('{"n": 2, "reason": "last reason"}');
  });

  test('counts unreadable artifacts as real', () => {
    expect(classify(ledgerBody([{ path: '/unreadable' }, { path: '/real' }]), {
      '/unreadable': '__UNREADABLE__',
      '/real': 'actual abort report',
    })).toBe('{"n": 2, "reason": ""}');
  });

  test.each(['https://example.test/artifact', 'https://example.com/artifact'])('excludes a whole run containing %s', (example) => {
    const ledger = `${example}\n${ledgerBody([{ path: '/real-a' }, { path: '/real-b' }])}`;
    expect(classify(ledger, {
      '/real-a': 'actual abort report',
      '/real-b': 'another abort report',
    })).toBe('');
  });
});
