import { DEFAULT_WIDGET_TOKENS, ansiForPair, resolveWidgetTokens, type ThemeTokens } from '../../theme/tokens.js';
import { resolveModalChromeBoxOptions } from '../chrome/modal-chrome-box.js';
import { BorderSpec } from '../attributes/border.js';
import { BoxDecoration } from '../attributes/box-decoration.js';
import { renderChrome } from '../chrome/renderer.js';
import { DEFAULT_CLOSE_GLYPH } from '../chrome/control-glyphs.js';
import type { BoxViewOptions } from '../view.js';
import type { WidgetChromeSpec, WidgetSpec } from './spec.js';

function padTo(line: string, width: number): string {
  if (line.length >= width) return line.slice(0, width);
  return line + ' '.repeat(width - line.length);
}

function alignLine(line: string, width: number, align: WidgetChromeSpec['titleAlign'] | undefined): string {
  const text = line.slice(0, width);
  if (text.length >= width) return text;
  const gap = width - text.length;
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return text + ' '.repeat(gap);
}

function borderForChrome(variant: WidgetChromeSpec['variant'] | undefined): BorderSpec | null {
  switch (variant) {
    case 'none':
      return null;
    case 'dialog':
      return BorderSpec.all({ color: 'text', style: 'double' });
    case 'window':
      return BorderSpec.all({ color: 'text', style: 'solid' });
    case 'tooltip':
      return BorderSpec.all({ color: 'text.muted', style: 'solid' });
    case 'panel':
    default:
      return BorderSpec.all({ color: 'border', style: 'solid' });
  }
}

function boxBorderVariantForChrome(variant: WidgetChromeSpec['variant'] | undefined): NonNullable<BoxViewOptions['borderVariant']> {
  switch (variant) {
    case 'dialog':
      return 'double';
    case 'window':
      return 'rounded';
    case 'tooltip':
      return 'plain';
    case 'panel':
    default:
      return 'plain';
  }
}

export function resolveWidgetChromeBoxViewOptions(
  theme: ThemeTokens | undefined,
  chrome: WidgetChromeSpec | undefined,
  fallbackTitle: string,
): BoxViewOptions {
  const title = chrome?.title ?? fallbackTitle;
  const titleRight = chrome?.showClose ? DEFAULT_CLOSE_GLYPH : undefined;
  const border = chrome?.showBorder !== false;
  const variant = boxBorderVariantForChrome(chrome?.variant);
  const chromeTokens = theme?.widgetTokens?.modalChrome ?? DEFAULT_WIDGET_TOKENS.modalChrome ?? null;
  if (theme && chromeTokens) {
    const resolved = resolveModalChromeBoxOptions(chromeTokens, {
      title,
      ...(titleRight ? { titleRight } : {}),
    });
    return {
      ...resolved,
      titleAlign: chrome?.titleAlign,
      border,
      borderVariant: variant,
      focusedBorderVariant: variant,
    };
  }
  const modalTokens = theme ? resolveWidgetTokens(theme, 'modal') : null;
  return {
    border,
    title,
    ...(titleRight ? { titleRight } : {}),
    ...(modalTokens ? {
      style: ansiForPair(modalTokens.border),
      focusedStyle: ansiForPair(modalTokens.border),
      titleStyle: ansiForPair(modalTokens.title),
      focusedTitleStyle: ansiForPair(modalTokens.title),
    } : {}),
    titleAlign: chrome?.titleAlign,
    borderVariant: variant,
    focusedBorderVariant: variant,
  };
}

export function resolveWidgetSpecTitle(spec: WidgetSpec): string {
  const explicit = spec.chrome?.title?.trim();
  if (explicit) return explicit;
  const character = spec.character?.trim();
  if (character) return character;
  const id = spec.id?.trim();
  if (id) return id;
  return spec.type;
}

export function resolveWidgetSpecDecoration(spec: WidgetSpec): BoxDecoration {
  const source = spec.style?.decoration ?? spec.decoration ?? null;
  if (source) {
    if (spec.chrome?.showBorder === false) return source.copyWith({ border: null });
    if (!source.border && spec.chrome?.variant && spec.chrome.variant !== 'none') {
      return source.copyWith({ border: borderForChrome(spec.chrome.variant) });
    }
    return source;
  }
  return new BoxDecoration({
    border: borderForChrome(spec.chrome?.showBorder === false ? 'none' : spec.chrome?.variant),
    color: 'surface',
  });
}

export function summarizeWidgetMotion(spec: WidgetSpec): string | null {
  const tags: string[] = [];
  if (spec.motion?.preset) tags.push(spec.motion.preset);
  if (spec.motion?.enter?.preset) tags.push(`enter:${spec.motion.enter.preset}`);
  if (spec.motion?.hover?.preset) tags.push(`hover:${spec.motion.hover.preset}`);
  if (spec.motion?.focus?.preset) tags.push(`focus:${spec.motion.focus.preset}`);
  return tags.length > 0 ? tags.join(' · ') : null;
}

export function renderWidgetSpecPreviewCard(
  spec: WidgetSpec,
  width: number,
  height: number,
  theme: ThemeTokens,
  opts: { motionProgress?: number } = {},
): string[] {
  if (width <= 0 || height <= 0) return [];
  const progress = Math.max(0, Math.min(1, opts.motionProgress ?? 1));
  const decoration = resolveWidgetSpecDecoration(spec);
  const hasBorder = !!decoration.border;
  const title = resolveWidgetSpecTitle(spec);
  const titleSuffix = spec.chrome?.showClose ? ` ${DEFAULT_CLOSE_GLYPH}` : '';
  const subtitle = `${spec.type}${spec.id ? ` · ${spec.id}` : ''}`;
  const configSummary = spec.config ? JSON.stringify(spec.config) : '(no config)';
  const motion = summarizeWidgetMotion(spec);
  const footer = spec.chrome?.footer ?? motion ?? '';
  const chromeBadge = spec.chrome?.variant ? `chrome:${spec.chrome.variant}` : null;
  const interactionBadge = spec.interactions
    ? `events:${Object.keys(spec.interactions).filter(key => (spec.interactions as Record<string, unknown>)[key] !== undefined).join(',')}`
    : null;

  const bodyRows = [
    alignLine(` ${title}${titleSuffix}`, Math.max(0, width - 2), spec.chrome?.titleAlign),
    padTo(` ${subtitle}`, Math.max(0, width - 2)),
    ...(chromeBadge ? [padTo(` ${chromeBadge}`, Math.max(0, width - 2))] : []),
    ...(interactionBadge ? [padTo(` ${interactionBadge}`, Math.max(0, width - 2))] : []),
    padTo(` ${configSummary}`, Math.max(0, width - 2)),
  ];
  const innerHeight = Math.max(0, height - (hasBorder ? 2 : 0));
  const body = footer && innerHeight > 0
    ? [
        ...bodyRows.slice(0, Math.max(0, innerHeight - 1)),
        padTo(` ${footer}`, Math.max(0, width - 2)),
      ].slice(0, innerHeight)
    : bodyRows.slice(0, innerHeight);

  const enterPreset = spec.motion?.enter?.preset ?? spec.motion?.preset ?? 'none';
  const animatedBody = body.map((line, idx) => {
    switch (enterPreset) {
      case 'fade': {
        const reveal = Math.max(0, Math.min(line.length, Math.round(line.length * progress)));
        return padTo(line.slice(0, reveal), Math.max(0, width - 2));
      }
      case 'slide-up': {
        const blankRows = Math.max(0, Math.round((1 - progress) * Math.max(0, innerHeight - 1)));
        return idx < blankRows ? ' '.repeat(Math.max(0, width - 2)) : line;
      }
      case 'slide-down': {
        const visibleRows = Math.max(0, innerHeight - Math.round((1 - progress) * Math.max(0, innerHeight - 1)));
        return idx >= visibleRows ? ' '.repeat(Math.max(0, width - 2)) : line;
      }
      case 'scale-in': {
        const inset = Math.max(0, Math.round((1 - progress) * 4));
        const inner = Math.max(0, width - 2 - inset * 2);
        const trimmed = padTo(line.trim(), inner);
        return padTo(' '.repeat(inset) + trimmed, Math.max(0, width - 2));
      }
      default:
        return line;
    }
  });

  const lines = renderChrome({
    width,
    height,
    decoration,
    theme,
    body: animatedBody,
  });
  return lines.length >= height ? lines.slice(0, height) : [...lines, ...Array.from({ length: height - lines.length }, () => ' '.repeat(width))];
}
