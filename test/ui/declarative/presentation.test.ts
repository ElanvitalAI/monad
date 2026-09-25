import { describe, expect, test } from 'bun:test';
import { renderWidgetSpecPreviewCard, resolveWidgetChromeBoxViewOptions, resolveWidgetSpecDecoration, resolveWidgetSpecTitle } from '../../../src/ui/declarative/index.js';
import { DEFAULT_THEME_TOKENS } from '../../../src/theme/tokens.js';

describe('declarative presentation helpers', () => {
  test('resolveWidgetSpecTitle prefers chrome title then character', () => {
    expect(resolveWidgetSpecTitle({
      type: 'log',
      character: 'Telemetry',
      chrome: { title: 'System Log' },
    })).toBe('System Log');
    expect(resolveWidgetSpecTitle({
      type: 'log',
      character: 'Telemetry',
    })).toBe('Telemetry');
  });

  test('resolveWidgetSpecDecoration synthesizes border from chrome variant', () => {
    const decoration = resolveWidgetSpecDecoration({
      type: 'log',
      chrome: { variant: 'dialog' },
    });
    expect(decoration.border?.top?.style).toBe('double');
  });

  test('renderWidgetSpecPreviewCard renders framed card with motion/footer hints', () => {
    const theme = DEFAULT_THEME_TOKENS;
    const lines = renderWidgetSpecPreviewCard({
      type: 'log',
      id: 'log-1',
      character: 'Telemetry',
      chrome: { variant: 'window', title: 'System Log', titleAlign: 'center', showClose: true, footer: 'Ctrl+P preview' },
      motion: { preset: 'fade', hover: { preset: 'pulse' } },
      interactions: { click: { action: 'open-log' } },
      config: { lines: ['> hello'] },
    }, 36, 6, theme);

    expect(lines).toHaveLength(6);
    expect(lines.join('\n')).toContain('System Log');
    expect(lines.join('\n')).toContain('✕');
    expect(lines.join('\n')).toContain('chrome:window');
    expect(lines.join('\n')).toContain('Ctrl+P preview');
  });

  test('renderWidgetSpecPreviewCard applies motion progress to body reveal', () => {
    const theme = DEFAULT_THEME_TOKENS;
    const lines = renderWidgetSpecPreviewCard({
      type: 'log',
      character: 'Telemetry',
      chrome: { variant: 'window', title: 'System Log' },
      motion: { preset: 'fade' },
      config: { lines: ['> hello'] },
    }, 36, 6, theme, { motionProgress: 0.2 });

    const plain = lines.join('\n');
    expect(plain).toContain('System');
    expect(plain).not.toContain('chrome:window');
  });

  test('resolveWidgetChromeBoxViewOptions maps declarative chrome to BoxView options', () => {
    const opts = resolveWidgetChromeBoxViewOptions(DEFAULT_THEME_TOKENS, {
      title: 'Spec title',
      variant: 'dialog',
      showClose: true,
      showBorder: true,
    }, 'Fallback');
    expect(opts.title).toBe('Spec title');
    expect(opts.titleRight).toBe('✕');
    expect(opts.border).toBe(true);
    expect(opts.borderVariant).toBe('double');
  });
});
