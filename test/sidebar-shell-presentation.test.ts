import { describe, expect, test } from 'bun:test';
import {
  resolveAcpSidebarShellPresentation,
  resolveIulSidebarShellPresentation,
  type SidebarShellPresentation,
} from '../src/ui/chrome/sidebar-shell-presentation.js';

/*
Vocabulary decision for GoalId 314ff24fa706b8d7: branch B.
History checked in this repository:
- ac666c2197 2026-04-30 "Polish sidebar shells for compact widths" created
  src/ui/chrome/sidebar-shell-presentation.ts with IUL experiment chrome and ACP channel chrome.
- f60e037650 2026-04-30 "Share sidebar shell wording templates" added this test file as a whole-string
  snapshot of those shared presentation values, so its original purpose was to keep the two sidebar
  vocabulary families distinct rather than to bless punctuation as UI contract.
- 10de63ecc 2026-05-01 "Add ACP resident shell inventory and resident VW seam" changed the ACP empty
  state from channel-only copy to session/lane/history resident-shell copy while keeping ACP channel chrome.
- 9817e40e6 2026-05-02 "Refactor VW workspace and IUL UX lab foundations" changed IUL chrome from
  Experiments/experiment to Labs/lab/lab lanes and simultaneously rewrote IUL shell tests around
  "IUL UX Lab", "Test Lab", and the new lab foundation.
Decision: keep the intentional current copy families: IUL sidebar chrome is lab/lane vocabulary, and ACP
sidebar chrome remains channel vocabulary while its empty state may describe session/lane/history inventory.
These tests therefore guard lexical families and required presentation fields, not exact whole strings.
Punctuation-only drift in the IUL empty state is allowed by this branch because it does not change the
lab/lane lexical family recorded above.
Wiring: src/iul/sidebar-shell.ts createIulSidebarShellView() calls resolveIulSidebarShellPresentation()
and passes chrome.railTitle/footerHint/compactFooterHint/emptyState into SidebarTabSurface.
*/

const requiredFields = ['railTitle', 'footerHint', 'compactFooterHint', 'emptyState'] as const;

function expectRequiredPresentationFields(spec: SidebarShellPresentation): void {
  for (const field of requiredFields) {
    expect(typeof spec[field]).toBe('string');
    expect(spec[field].length).toBeGreaterThan(0);
  }
}

function expectNoWords(text: string, forbidden: RegExp[]): void {
  for (const word of forbidden) {
    expect(text).not.toMatch(word);
  }
}

describe('sidebar shell presentation vocabulary', () => {
  test('IUL shell uses lab/lane wording', () => {
    const spec = resolveIulSidebarShellPresentation();
    const copy = [spec.railTitle, spec.footerHint, spec.compactFooterHint, spec.emptyState].join(' ');

    expectRequiredPresentationFields(spec);
    expect(spec.railTitle).toBe('Labs');
    expect(spec.railTitle.toLocaleLowerCase('en-US')).toBe('labs');
    expect(spec.footerHint).toContain('switch lab');
    expect(spec.compactFooterHint).toContain('lab');
    expect(spec.emptyState).toMatch(/\bIUL\b/);
    expect(spec.emptyState).toMatch(/\blab lanes\b/);
    expectNoWords(copy, [/\bchannel(s)?\b/i, /\bexperiment(s)?\b/i, /\bsession(s)?\b/i]);
  });

  test('ACP shell uses channel chrome with session/lane inventory wording', () => {
    const spec = resolveAcpSidebarShellPresentation();
    const chromeCopy = [spec.railTitle, spec.footerHint, spec.compactFooterHint].join(' ');

    expectRequiredPresentationFields(spec);
    expect(spec.railTitle).toBe('Channels');
    expect(spec.railTitle.toLocaleLowerCase('en-US')).toBe('channels');
    expect(spec.footerHint).toContain('switch channel');
    expect(spec.footerHint).toContain('Right-click menu');
    expect(spec.compactFooterHint).toContain('channel');
    expect(spec.emptyState).toMatch(/\bACP sessions\b/);
    expect(spec.emptyState).toMatch(/\bACP lanes\b/);
    expect(spec.emptyState).toMatch(/\bsaved history\b/);
    expectNoWords(chromeCopy, [/\blab(s)?\b/i, /\bexperiment(s)?\b/i, /\bsession(s)?\b/i, /\blane(s)?\b/i]);
  });
});
