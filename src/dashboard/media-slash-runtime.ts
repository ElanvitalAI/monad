import type { DashboardAssistantRenderState } from './assistant-render-state-runtime.js';
import { buildDashboardAssistantMediaPreviewPayload } from './assistant-media-preview-runtime.js';
import { buildDashboardMediaSampleText } from './media-sample.js';

export type DashboardMediaSlashAction =
  | { kind: 'none' }
  | { kind: 'open' }
  | { kind: 'clear' }
  | { kind: 'seed-sample'; text: string; sampleKind: 'picture' | 'video' };

export interface DashboardMediaSlashResult {
  lines: string[];
  action: DashboardMediaSlashAction;
}

export function resolveDashboardMediaSlash(
  args: string[],
  state: DashboardAssistantRenderState,
): DashboardMediaSlashResult {
  const sub = (args[0] || 'status').toLowerCase();
  const payload = buildDashboardAssistantMediaPreviewPayload(state);
  if (sub === 'help') {
    return {
      action: { kind: 'none' },
      lines: [
        '  /media status',
        '  /media open',
        '  /media sample image',
        '  /media sample video [url]',
        '  /media clear',
      ],
    };
  }
  if (sub === 'sample') {
    const kind = (args[1] || 'image').toLowerCase();
    if (kind === 'image' || kind === 'picture') {
      return {
        action: {
          kind: 'seed-sample',
          text: buildDashboardMediaSampleText('picture'),
          sampleKind: 'picture',
        },
        lines: ['  seeded picture sample into last assistant output'],
      };
    }
    if (kind === 'video') {
      return {
        action: {
          kind: 'seed-sample',
          text: buildDashboardMediaSampleText('video', args[2]),
          sampleKind: 'video',
        },
        lines: ['  seeded video sample into last assistant output'],
      };
    }
    if (kind === 'clear' || kind === 'reset') {
      return {
        action: { kind: 'clear' },
        lines: ['  cleared last assistant media preview sample'],
      };
    }
    return {
      action: { kind: 'none' },
      lines: [
        `  unknown /media sample kind: ${kind}`,
        '  try /media sample image',
        '  try /media sample video [url]',
      ],
    };
  }
  if (sub === 'clear' || sub === 'reset') {
    return {
      action: { kind: 'clear' },
      lines: ['  cleared last assistant media preview sample'],
    };
  }
  if (sub === 'status') {
    if (!payload) {
      return {
        action: { kind: 'none' },
        lines: ['  no media preview in last assistant output'],
      };
    }
    return {
      action: { kind: 'none' },
      lines: [
        `  kind: ${payload.preview.kind}`,
        `  label: ${payload.preview.label}`,
        `  url: ${payload.preview.url}`,
      ],
    };
  }
  if (sub === 'open') {
    if (!payload) {
      return {
        action: { kind: 'none' },
        lines: ['  no media preview in last assistant output'],
      };
    }
    return {
      action: { kind: 'open' },
      lines: [`  opening ${payload.preview.kind}: ${payload.preview.label}`],
    };
  }
  return {
    action: { kind: 'none' },
    lines: [
      `  unknown /media subcommand: ${sub}`,
      '  try /media help',
    ],
  };
}
