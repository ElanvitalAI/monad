import { buildSidebarShellPreviewText } from '../ui/chrome/sidebar-shell-detail.js';
import { SelectView, type SelectOption } from '../ui/widgets/select-view.js';
import type { View } from '../ui/view.js';

export interface IulLaneOptionEntry {
  id: string;
  label: string;
  description: string;
  goal?: string;
  observe?: string;
  nextStep?: string;
}

export function createIulOptionLaneView(opts: {
  title: string;
  footerHint: string;
  previewTail: string;
  entries: readonly IulLaneOptionEntry[];
}): View {
  let lastPickedLabel: string | null = null;
  const searchable = opts.entries.length > 6;
  const footerHint = opts.entries.length > 4 ? opts.footerHint : '';
  const byId = new Map(opts.entries.map((entry) => [entry.id, entry] as const));
  const options = opts.entries.map<SelectOption<string>>((entry) => ({
    value: entry.id,
    label: entry.label,
    description: entry.description,
  }));
  return new SelectView<string>({
    title: opts.title,
    searchable,
    browseMode: true,
    footerHint,
    options,
    preview: (focused) => buildSidebarShellPreviewText({
      title: focused.label,
      subtitle: focused.description ?? '',
      tail: buildIulOptionPreviewTail(byId.get(String(focused.value)), opts.previewTail, lastPickedLabel),
    }),
    onSubmit: (picked) => {
      const key = Array.isArray(picked) ? picked[0] : picked;
      const entry = byId.get(String(key));
      lastPickedLabel = entry?.label ?? String(key);
    },
    onCancel: () => {},
  });
}

export function buildIulOptionPreviewTail(
  entry: IulLaneOptionEntry | undefined,
  previewTail: string,
  lastPickedLabel: string | null,
): string {
  const blocks = [
    entry?.goal ? `Goal: ${entry.goal}` : null,
    entry?.observe ? `Observe: ${entry.observe}` : null,
    entry?.nextStep ? `Next: ${entry.nextStep}` : null,
    previewTail,
    lastPickedLabel ? `Last picked: ${lastPickedLabel}` : null,
  ].filter((value): value is string => Boolean(value));
  return blocks.join('\n\n');
}
