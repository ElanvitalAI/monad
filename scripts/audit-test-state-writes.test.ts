import { describe, expect, test } from 'bun:test';
import { addedCandidates, auditTestStateWrites, august8Inventory, classifyCandidates, classifyStaticIsolation, renderAudit } from './audit-test-state-writes';

describe('audit-test-state-writes static safety classification', () => {
  test('recognizes only the three approval-safe isolation signals', () => {
    expect(classifyStaticIsolation("process.env.ELANOUS_STATE_DIR; run('--config-dir'); mkdtempSync('/tmp/a')")).toEqual({
      signals: ['ELANOUS_STATE_DIR', '--config-dir', 'mkdtemp'],
      safety: 'isolated',
    });
    expect(classifyStaticIsolation("writeFileSync(join(homedir(), '.elanous', 'unsafe'), 'x')")).toEqual({
      signals: [],
      safety: 'manual-review',
    });
  });

  test('classifies exactly the 62 candidates added since the fixed August 8 inventory without approving a mixed-file HOME writer', () => {
    const report = auditTestStateWrites();
    const window = addedCandidates(report, august8Inventory());
    const classification = classifyCandidates(report, window);
    expect(window.size).toBe(62);
    expect(classification.findings).toHaveLength(62);
    expect(classification.manualReview.length).toBeGreaterThan(0);
    expect(classification.findings.some((finding) => finding.staticSafety === 'manual-review')).toBe(true);
    const rendered = renderAudit(report);
    expect(rendered).toContain('August 8 candidate window: **62 files**');
    expect(rendered).toContain('Candidate classification (files):');
    expect(rendered).toContain('a file is ㉡ whenever any writer call lacks a direct approved signal.');
  });
});
