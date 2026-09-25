import { describe, expect, it } from 'bun:test';
import type { ReactNode } from 'react';

import {
  COLLAPSE_CHAR_THRESHOLD,
  COLLAPSE_LINE_THRESHOLD,
  PREVIEW_LINE_COUNT,
  extractLanguage,
  extractText,
  makePreview,
  shouldCollapseDefault,
} from './code-block-preview';

describe('shouldCollapseDefault', () => {
  it('does not collapse short content', () => {
    expect(shouldCollapseDefault('one\ntwo\nthree')).toBe(false);
  });

  it('collapses when line count exceeds threshold', () => {
    const text = Array(COLLAPSE_LINE_THRESHOLD + 1).fill('x').join('\n');
    expect(shouldCollapseDefault(text)).toBe(true);
  });

  it('collapses when char count exceeds threshold even on a single line', () => {
    const text = 'x'.repeat(COLLAPSE_CHAR_THRESHOLD + 1);
    expect(shouldCollapseDefault(text)).toBe(true);
  });

  it('treats empty / non-string as not-collapsing', () => {
    expect(shouldCollapseDefault('')).toBe(false);
    // @ts-expect-error — defensive runtime guard
    expect(shouldCollapseDefault(null)).toBe(false);
  });
});

describe('makePreview', () => {
  it('returns the full text when within preview line count', () => {
    const text = 'a\nb\nc';
    expect(makePreview(text)).toBe('a\nb\nc');
  });

  it('truncates to PREVIEW_LINE_COUNT and appends ellipsis line', () => {
    const text = Array(PREVIEW_LINE_COUNT + 4).fill('x').join('\n');
    const preview = makePreview(text);
    expect(preview.split('\n').length).toBe(PREVIEW_LINE_COUNT + 1);
    expect(preview.endsWith('\n…')).toBe(true);
  });
});

describe('extractText', () => {
  it('handles plain strings + numbers', () => {
    expect(extractText('hello')).toBe('hello');
    expect(extractText(42)).toBe('42');
  });

  it('flattens arrays', () => {
    expect(extractText(['a', 'b', 'c'])).toBe('abc');
  });

  it('recurses into a synthetic React element', () => {
    const node = {
      props: {
        children: ['line 1\n', { props: { children: 'line 2' } } as ReactNode],
      },
    } as unknown as ReactNode;
    expect(extractText(node)).toBe('line 1\nline 2');
  });

  it('treats null / boolean / undefined as empty', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
    expect(extractText(true)).toBe('');
    expect(extractText(false)).toBe('');
  });
});

describe('extractLanguage', () => {
  it('reads `language-xxx` off a className', () => {
    const node = {
      props: { className: 'language-bash hljs' },
    } as unknown as ReactNode;
    expect(extractLanguage(node)).toBe('bash');
  });

  it('falls through to nested children', () => {
    const node = {
      props: {
        children: { props: { className: 'language-tsx' } } as ReactNode,
      },
    } as unknown as ReactNode;
    expect(extractLanguage(node)).toBe('tsx');
  });

  it('returns null when no language token exists', () => {
    expect(extractLanguage('plain string')).toBeNull();
    expect(extractLanguage({ props: { className: 'unrelated' } } as unknown as ReactNode)).toBeNull();
  });
});
