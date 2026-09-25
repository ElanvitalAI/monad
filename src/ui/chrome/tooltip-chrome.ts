import type { WidgetChromeSpec } from '../declarative/spec.js';

export interface TooltipChromeSpec {
  title: string;
  chromeSpec?: WidgetChromeSpec;
  defaultShowClose?: boolean;
}

export function resolveTooltipChromeSpec(spec: TooltipChromeSpec): WidgetChromeSpec {
  return {
    variant: 'tooltip',
    title: spec.title,
    showClose: spec.defaultShowClose ?? false,
    ...spec.chromeSpec,
  };
}
