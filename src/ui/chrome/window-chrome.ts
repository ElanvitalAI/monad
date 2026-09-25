import type { WidgetChromeSpec } from '../declarative/spec.js';

export interface WindowChromeSpec {
  title: string;
  chromeSpec?: WidgetChromeSpec;
  defaultTitleAlign?: WidgetChromeSpec['titleAlign'];
  defaultShowClose?: boolean;
}

export function resolveWindowChromeSpec(spec: WindowChromeSpec): WidgetChromeSpec {
  return {
    variant: 'window',
    title: spec.title,
    titleAlign: spec.defaultTitleAlign ?? 'left',
    showClose: spec.defaultShowClose ?? true,
    ...spec.chromeSpec,
  };
}

export function resolveModalWindowChromeSpec(
  title: string,
  chromeSpec?: WidgetChromeSpec,
  titleAlign?: WidgetChromeSpec['titleAlign'],
): WidgetChromeSpec {
  return resolveWindowChromeSpec({
    title,
    chromeSpec,
    ...(titleAlign ? { defaultTitleAlign: titleAlign } : {}),
  });
}

export function resolvePickerWindowChromeSpec(
  title: string,
  chromeSpec?: WidgetChromeSpec,
  titleAlign?: WidgetChromeSpec['titleAlign'],
): WidgetChromeSpec {
  return resolveWindowChromeSpec({
    title,
    defaultShowClose: false,
    chromeSpec,
    ...(titleAlign ? { defaultTitleAlign: titleAlign } : {}),
  });
}
