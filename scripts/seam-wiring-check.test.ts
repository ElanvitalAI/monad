import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSeamWiring, main } from './seam-wiring-check.js';

function withRepository(run: (root: string, target: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'seam-wiring-check-test-'));
  const target = join(root, 'src', 'model.ts');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'tsconfig.gate.json'), '{}');
  writeFileSync(target, 'export interface Model {\n  stable: string;\n  required: boolean;\n}\n');
  try {
    run(root, target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const unwiredRunner = () => ({
  ran: true,
  out: [
    "test/model.test.ts(3,1): error TS2353: Object literal may only specify known properties, and 'required' does not exist.",
    "src/model.ts(4,1): error TS2339: Property 'required' does not exist on type 'Model'.",
  ].join('\n'),
});

const wiredRunner = () => ({
  ran: true,
  out: "src/factory.ts(3,1): error TS2353: Object literal may only specify known properties, and 'required' does not exist.\n",
});

describe('seam wiring driver', () => {
  test('classifies test-only injection diagnostics as unwired with a nonzero exit code', () => {
    withRepository((root) => {
      const result = checkSeamWiring({ file: 'src/model.ts', field: 'required' }, { cwd: root, runTsc: unwiredRunner });
      expect(result).toMatchObject({
        status: 'unwired',
        exitCode: 1,
        classification: {
          injectionSites: { test: 1, nonTest: 0 },
          readSites: { test: 0, nonTest: 1 },
        },
      });
    });
  });

  test('classifies a non-test injection with no non-test read as unread with a nonzero exit code', () => {
    withRepository((root) => {
      const result = checkSeamWiring({ file: 'src/model.ts', field: 'required' }, { cwd: root, runTsc: wiredRunner });
      expect(result).toMatchObject({
        status: 'unread',
        exitCode: 1,
        classification: {
          injectionSites: { test: 0, nonTest: 1 },
          readSites: { test: 0, nonTest: 0 },
        },
      });
    });
  });

  test('classifies non-test injection and read diagnostics as wired with exit code zero', () => {
    withRepository((root) => {
      const result = checkSeamWiring({
        file: 'src/model.ts',
        field: 'required',
      }, {
        cwd: root,
        runTsc: () => ({
          ran: true,
          out: [
            "src/factory.ts(3,1): error TS2353: Object literal may only specify known properties, and 'required' does not exist.",
            "src/consumer.ts(4,1): error TS2339: Property 'required' does not exist on type 'Model'.",
          ].join('\n'),
        }),
      });
      expect(result).toMatchObject({
        status: 'wired',
        exitCode: 0,
        classification: {
          injectionSites: { test: 0, nonTest: 1 },
          readSites: { test: 0, nonTest: 1 },
        },
      });
    });
  });

  test('unions conditional-spread-only never diagnostics with deletion reads as wired', () => {
    withRepository((root) => {
      let runCount = 0;
      const result = checkSeamWiring({ file: 'src/model.ts', field: 'required' }, {
        cwd: root,
        runTsc: () => {
          runCount += 1;
          return {
            ran: true,
            out: runCount === 1
              ? "src/consumer.ts(4,1): error TS2339: Property 'required' does not exist on type 'Model'.\n"
              : "src/factory.ts(3,1): error TS2345: Argument of type '{ required: boolean; }' is not assignable to parameter of type '{ required?: never; }'.\n",
          };
        },
      });
      expect(runCount).toBe(2);
      expect(result).toMatchObject({
        status: 'wired',
        exitCode: 0,
        classification: {
          injectionSites: { test: 0, nonTest: 1 },
          readSites: { test: 0, nonTest: 1 },
        },
      });
    });
  });

  test('typechecks one copy with the field deleted and another with its type substituted by never', () => {
    withRepository((root) => {
      const seen: string[] = [];
      checkSeamWiring({ file: 'src/model.ts', field: 'required' }, {
        cwd: root,
        runTsc: (repository: string) => {
          seen.push(readFileSync(join(repository, 'src', 'model.ts'), 'utf8'));
          return { ran: true, out: '' };
        },
      });
      expect(seen).toHaveLength(2);
      const [deletionCopy, neverCopy] = seen as [string, string];
      expect(deletionCopy).not.toContain('required');
      expect(neverCopy).toContain('required: never');
      expect(neverCopy).not.toContain('required: boolean');
    });
  });

  test('removes only the copied field and preserves the original byte-for-byte when the injected tsc runner fails', () => {
    withRepository((root, target) => {
      const before = readFileSync(target);
      let copiedRoot = '';
      const result = checkSeamWiring(
        { file: 'src/model.ts', field: 'required' },
        {
          cwd: root,
          runTsc: (copy) => {
            copiedRoot = copy;
            expect(copy).not.toBe(root);
            expect(readFileSync(join(copy, 'src', 'model.ts'), 'utf8')).toBe('export interface Model {\n  stable: string;\n  \n}\n');
            throw new Error('injected compiler failure');
          },
        },
      );
      expect(result).toEqual({
        target: { file: 'src/model.ts', field: 'required' },
        status: 'indeterminate',
        exitCode: 2,
        reason: 'injected compiler failure',
      });
      expect(readFileSync(target)).toEqual(before);
      expect(existsSync(copiedRoot)).toBeFalse();
    });
  });

  test('rejects a target outside the repository before invoking the tsc runner', () => {
    withRepository((root) => {
      let called = false;
      const result = checkSeamWiring(
        { file: '../outside.ts', field: 'required' },
        { cwd: root, runTsc: () => { called = true; return unwiredRunner(); } },
      );
      expect(result).toMatchObject({ status: 'indeterminate', exitCode: 2 });
      expect(result.reason).toContain('inside the repository');
      expect(called).toBeFalse();
    });
  });

});

describe('seam wiring CLI wrapper', () => {
  test('emits one human-readable line and structured unwired output', () => {
    withRepository((root) => {
      const output: string[] = [];
      const exitCode = main(['--file', 'src/model.ts', '--field', 'required'], {
        cwd: root,
        runTsc: unwiredRunner,
        log: (line) => output.push(line),
      });
      expect(exitCode).toBe(1);
      expect(output[0]).toContain('UNWIRED src/model.ts#required');
      expect(output[0]).toContain('no non-test injection site');
      expect(JSON.parse(output[1]!)).toMatchObject({ status: 'unwired', exitCode: 1 });
    });
  });

  test('emits unread diagnostics and a nonzero exit code for injection-only wiring', () => {
    withRepository((root) => {
      const output: string[] = [];
      const exitCode = main(['--file', 'src/model.ts', '--field', 'required'], {
        cwd: root,
        runTsc: wiredRunner,
        log: (line) => output.push(line),
      });
      expect(exitCode).toBe(1);
      expect(output[0]).toContain('UNREAD src/model.ts#required');
      expect(output[0]).toContain('no non-test read site');
      expect(JSON.parse(output[1]!)).toMatchObject({ status: 'unread', exitCode: 1 });
    });
  });

  test('prints usage including the two-run cost and documented detection boundaries', () => {
    const output: string[] = [];
    expect(main(['--help'], { log: (line) => output.push(line) })).toBe(0);
    expect(output.join('\n')).toContain('about 80 seconds total, up from about 40 seconds');
    expect(output.join('\n')).toContain('Object.assign wiring, or computed-key wiring');
  });
});
