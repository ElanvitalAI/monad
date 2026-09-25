import { describe, expect, test } from 'bun:test';
import { assessImplementationArtifactCompleteness } from './implementation-artifact-completeness.js';

describe('implementation artifact completeness', () => {
  test('rejects a completion claim without goal, diff, or test evidence', () => {
    const result = assessImplementationArtifactCompleteness({
      goalDocumentAvailable: false, changedFiles: [], gateExecuted: false, gatePassed: undefined,
    });
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(['goal', 'code', 'test']);
    expect(result.recoveryNote).toContain('missing goal, code, test');
    expect(result.recoveryNote).toContain('Next action:');
  });

  test('identifies a no-diff child success as a code artifact intervention', () => {
    const result = assessImplementationArtifactCompleteness({
      goalDocumentAvailable: true, changedFiles: [], gateExecuted: true, gatePassed: true,
    });
    expect(result).toEqual({
      complete: false,
      missing: ['code'],
      recoveryNote: expect.stringContaining('missing code'),
    });
  });

  test('requires a successful executed gate rather than a completion assertion alone', () => {
    expect(assessImplementationArtifactCompleteness({
      goalDocumentAvailable: true, changedFiles: ['src/x.ts'], gateExecuted: true, gatePassed: false,
    }).missing).toEqual(['test']);
  });

  test('accepts all durable axes', () => {
    expect(assessImplementationArtifactCompleteness({
      goalDocumentAvailable: true, changedFiles: ['src/x.ts'], gateExecuted: true, gatePassed: true,
    })).toEqual({ complete: true, missing: [], recoveryNote: '' });
  });
});
