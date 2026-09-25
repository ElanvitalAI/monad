import type { SelectOption } from '../widgets/select-view.js';

export interface PickerPopupSizeSpec {
  minWidth: number;
  maxWidth: number;
  widthPadding: number;
  visibleRows: number;
  shellRows: number;
  minContentWidth?: number;
}

export function widestPickerOptionWidth<T>(options: ReadonlyArray<SelectOption<T>>): number {
  let width = 0;
  for (const option of options) {
    const full = option.label + (option.description ? '  ' + option.description : '');
    if (full.length > width) width = full.length;
  }
  return width;
}

export function resolvePickerPopupSize<T>(
  options: ReadonlyArray<SelectOption<T>>,
  spec: PickerPopupSizeSpec,
): { width: number; height: number } {
  const widest = Math.max(spec.minContentWidth ?? 0, widestPickerOptionWidth(options));
  return {
    width: Math.max(spec.minWidth, Math.min(spec.maxWidth, widest + spec.widthPadding)),
    height: Math.min(options.length, spec.visibleRows) + spec.shellRows,
  };
}
