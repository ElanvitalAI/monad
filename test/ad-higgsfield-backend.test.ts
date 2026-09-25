import { expect, test } from 'bun:test';
import { createHiggsfieldBackend, type CommandRunner } from '../src/ad-pipeline/higgsfield-backend.js';
import type { ShootCommand } from '../src/ad-pipeline/shoot-run.js';

const command = (args: readonly string[] = ['--prompt', 'light serum', '--resolution', '720p']): ShootCommand => ({
  beatIndex: 0,
  jobType: 'seedance_2_0',
  durationSeconds: 5,
  args,
});

function fakeRunner(response = { stdout: '32dc92c9-3d64-4b55-92c4-c9551f8f5844\n', stderr: '', exitCode: 0 }) {
  const calls: { argv: readonly string[]; timeoutMs?: number }[] = [];
  const runner: CommandRunner = {
    async run(argv, options) {
      calls.push({ argv, timeoutMs: options?.timeoutMs });
      return response;
    },
  };
  return { runner, calls };
}

test('blocks only spending create commands by default while allowing free polling', async () => {
  const { runner, calls } = fakeRunner({ stdout: JSON.stringify({ status: 'queued' }), stderr: '', exitCode: 0 });
  const backend = createHiggsfieldBackend({ runner });

  await expect(backend.submit(command())).rejects.toThrow('Higgsfield spending is disabled; would run: higgsfield generate create seedance_2_0');
  await expect(backend.poll('32dc92c9-3d64-4b55-92c4-c9551f8f5844')).resolves.toEqual({ status: 'queued' });
  expect(calls).toEqual([{
    argv: ['higgsfield', 'generate', 'get', '32dc92c9-3d64-4b55-92c4-c9551f8f5844', '--json'],
    timeoutMs: undefined,
  }]);
});

test.each([
  ['missing', ['--resolution', '720p']],
  ['empty', ['--prompt', '']],
  ['option-like', ['--prompt', '--resolution']],
  ['duplicate', ['--prompt', 'one', '--prompt', 'two']],
])('validates a %s prompt before default spend blocking', async (_kind, args) => {
  const { runner, calls } = fakeRunner();
  const backend = createHiggsfieldBackend({ runner });

  await expect(backend.submit(command(args))).rejects.toThrow('--prompt');
  expect(calls).toHaveLength(0);
});

test('submits only with explicit spending permission using the observed create argv and 20-minute timeout', async () => {
  const { runner, calls } = fakeRunner();
  const backend = createHiggsfieldBackend({ runner, allowSpend: true, cliPath: 'hf' });

  await expect(backend.submit(command())).resolves.toBe('32dc92c9-3d64-4b55-92c4-c9551f8f5844');
  expect(calls).toEqual([{
    argv: ['hf', 'generate', 'create', 'seedance_2_0', '--prompt', 'light serum', '--resolution', '720p', '--duration', '5'],
    timeoutMs: 20 * 60 * 1000,
  }]);
});

test.each([
  ['missing', ['--resolution', '720p']],
  ['empty', ['--prompt', '']],
  ['option-like', ['--prompt', '--resolution']],
  ['duplicate', ['--prompt', 'one', '--prompt', 'two']],
])('rejects a %s prompt before a permitted submission runs', async (_kind, args) => {
  const { runner, calls } = fakeRunner();
  const backend = createHiggsfieldBackend({ runner, allowSpend: true });

  await expect(backend.submit(command(args))).rejects.toThrow('--prompt');
  expect(calls).toHaveLength(0);
});

test('uses an explicitly configured submit timeout', async () => {
  const { runner, calls } = fakeRunner();
  const backend = createHiggsfieldBackend({ runner, allowSpend: true, submitTimeoutMs: 45_000 });

  await expect(backend.submit(command())).resolves.toBe('32dc92c9-3d64-4b55-92c4-c9551f8f5844');
  expect(calls).toEqual([{
    argv: ['higgsfield', 'generate', 'create', 'seedance_2_0', '--prompt', 'light serum', '--resolution', '720p', '--duration', '5'],
    timeoutMs: 45_000,
  }]);
});

test('rejects non-UUID-like create output instead of accepting it as a job id', async () => {
  const { runner, calls } = fakeRunner({ stdout: 'Error: something', stderr: '', exitCode: 0 });
  const backend = createHiggsfieldBackend({ runner, allowSpend: true });

  await expect(backend.submit(command())).rejects.toThrow('invalid job id');
  expect(calls).toHaveLength(1);
});

test('polls with the observed get argv and preserves status and result_url verbatim', async () => {
  const { runner, calls } = fakeRunner({ stdout: JSON.stringify({ status: 'queued', result_url: 'https://video.example/result.mp4' }), stderr: '', exitCode: 0 });
  const backend = createHiggsfieldBackend({ runner, allowSpend: true });

  await expect(backend.poll('32dc92c9-3d64-4b55-92c4-c9551f8f5844')).resolves.toEqual({ status: 'queued', resultUrl: 'https://video.example/result.mp4' });
  expect(calls).toEqual([{ argv: ['higgsfield', 'generate', 'get', '32dc92c9-3d64-4b55-92c4-c9551f8f5844', '--json'], timeoutMs: undefined }]);
});

test.each([
  ['null', { status: 'nsfw', result_url: null }, { status: 'nsfw' }],
  ['missing', { status: 'queued' }, { status: 'queued' }],
])('returns status without a result URL when result_url is %s', async (_kind, response, expected) => {
  const { runner } = fakeRunner({ stdout: JSON.stringify(response), stderr: '', exitCode: 0 });
  const backend = createHiggsfieldBackend({ runner });

  await expect(backend.poll('32dc92c9-3d64-4b55-92c4-c9551f8f5844')).resolves.toEqual(expected);
});

test.each([
  ['number', 1],
  ['object', {}],
  ['array', []],
])('rejects a %s result_url', async (_kind, resultUrl) => {
  const { runner } = fakeRunner({ stdout: JSON.stringify({ status: 'queued', result_url: resultUrl }), stderr: '', exitCode: 0 });
  const backend = createHiggsfieldBackend({ runner });

  await expect(backend.poll('32dc92c9-3d64-4b55-92c4-c9551f8f5844')).rejects.toThrow('invalid result_url');
});

test.each([null, 1, {}, []])('rejects a non-string poll status', async (status) => {
  const { runner } = fakeRunner({ stdout: JSON.stringify({ status }), stderr: '', exitCode: 0 });
  const backend = createHiggsfieldBackend({ runner });

  await expect(backend.poll('32dc92c9-3d64-4b55-92c4-c9551f8f5844')).rejects.toThrow('requires a string status');
});

test('preserves stderr when the injected runner reports a nonzero exit code', async () => {
  const { runner } = fakeRunner({ stdout: '', stderr: 'Session expired', exitCode: 1 });
  const backend = createHiggsfieldBackend({ runner, allowSpend: true });

  await expect(backend.submit(command())).rejects.toThrow('Session expired');
});

test('preserves stderr for failed polling commands', async () => {
  const { runner } = fakeRunner({ stdout: '', stderr: 'Session expired', exitCode: 1 });
  const backend = createHiggsfieldBackend({ runner, allowSpend: true });

  await expect(backend.poll('32dc92c9-3d64-4b55-92c4-c9551f8f5844')).rejects.toThrow('Session expired');
});
