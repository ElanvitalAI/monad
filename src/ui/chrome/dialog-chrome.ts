import type { WidgetChromeSpec } from '../declarative/spec.js';

export interface DialogChromeSpec {
  title: string;
  chromeSpec?: WidgetChromeSpec;
  defaultVariant?: WidgetChromeSpec['variant'];
  defaultTitleAlign?: WidgetChromeSpec['titleAlign'];
  defaultShowClose?: boolean;
}

export function resolveDialogChromeSpec(spec: DialogChromeSpec): WidgetChromeSpec {
  return {
    variant: spec.defaultVariant ?? 'dialog',
    title: spec.title,
    titleAlign: spec.defaultTitleAlign ?? 'left',
    showClose: spec.defaultShowClose ?? true,
    ...spec.chromeSpec,
  };
}

export function resolveModalDialogChromeSpec(
  title: string,
  chromeSpec?: WidgetChromeSpec,
  titleAlign?: WidgetChromeSpec['titleAlign'],
): WidgetChromeSpec {
  return resolveDialogChromeSpec({
    title,
    chromeSpec,
    ...(titleAlign ? { defaultTitleAlign: titleAlign } : {}),
  });
}

export function resolveEmbeddedDialogChromeSpec(
  title: string,
  chromeSpec?: WidgetChromeSpec,
  titleAlign?: WidgetChromeSpec['titleAlign'],
): WidgetChromeSpec {
  return resolveDialogChromeSpec({
    title,
    defaultShowClose: false,
    chromeSpec,
    ...(titleAlign ? { defaultTitleAlign: titleAlign } : {}),
  });
}
