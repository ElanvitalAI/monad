import type { WidgetChromeSpec } from '../declarative/spec.js';

export interface PickerChromeSpec {
  title: string;
  primaryAction: string;
  cancelAction?: string;
  browseMode?: boolean;
  filterable?: boolean;
  secondaryAction?: string;
  shortcutHint?: string;
  chromeSpec?: WidgetChromeSpec;
  defaultVariant?: WidgetChromeSpec['variant'];
  defaultTitleAlign?: WidgetChromeSpec['titleAlign'];
  defaultShowClose?: boolean;
  maxWidth?: number;
}

export interface PickerChromePresentation {
  chromeSpec: WidgetChromeSpec;
  footerHint: string;
}

export function buildPickerFooterHint(spec: PickerChromeSpec): string {
  const compact = spec.maxWidth !== undefined && spec.maxWidth < 58;
  const parts: string[] = [];
  parts.push(compact ? '↑↓' : '↑↓ move');
  if (spec.filterable !== false) parts.push(compact ? 'type' : 'type filter');
  if (spec.browseMode !== false) {
    parts.push(compact ? 'Click' : 'Click select');
    parts.push(compact ? `Dbl/↵ ${spec.primaryAction}` : `Double-click/Enter ${spec.primaryAction}`);
  } else {
    parts.push(compact ? `Click/↵ ${spec.primaryAction}` : `Click/Enter ${spec.primaryAction}`);
  }
  if (spec.secondaryAction) parts.push(spec.secondaryAction);
  if (spec.shortcutHint) parts.push(spec.shortcutHint);
  parts.push(compact ? 'Esc' : `Esc ${spec.cancelAction ?? 'cancel'}`);
  return parts.join(' · ');
}

export function resolvePickerChromeSpec(spec: PickerChromeSpec): WidgetChromeSpec {
  const footerHint = buildPickerFooterHint(spec);
  return {
    variant: spec.defaultVariant ?? 'window',
    title: spec.title,
    titleAlign: spec.defaultTitleAlign ?? 'center',
    showClose: spec.defaultShowClose ?? true,
    footer: footerHint,
    ...spec.chromeSpec,
  };
}

export function resolvePickerChromePresentation(spec: PickerChromeSpec): PickerChromePresentation {
  const chromeSpec = resolvePickerChromeSpec(spec);
  return {
    chromeSpec,
    footerHint: chromeSpec.footer ?? buildPickerFooterHint(spec),
  };
}
