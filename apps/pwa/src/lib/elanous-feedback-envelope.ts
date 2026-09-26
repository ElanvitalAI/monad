// PWA-local mirror of the daemon-side `elanous/feedback/*` transport in
// `src/acp/elanous-extensions.ts`. The PWA is a separate build target, so
// this wire codec intentionally depends only on local PWA schema guards.
//
// Wire shape:
//   [elanous/feedback/emit] <blockId>
//   <FeedbackEnvelope JSON>
//   <<elanous-feedback-end <blockId>>

import {
  isFeedbackEnvelopeWire,
  type FeedbackEnvelopeWire,
} from './feedback-envelope';

export interface ElanousFeedbackEnvelope {
  method: 'emit';
  payload: FeedbackEnvelopeWire;
}

export function parseElanousFeedbackEnvelope(text: string): ElanousFeedbackEnvelope | null {
  const lines = text.split('\n');
  const first = lines[0];
  if (!first) return null;
  const match = /^\[elanous\/feedback\/([a-zA-Z]+)\] (.+)$/.exec(first);
  if (!match || match[1] !== 'emit') return null;

  const bodyLines: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^<<elanous-feedback-end /.test(line)) break;
    bodyLines.push(line);
  }

  try {
    const payload: unknown = JSON.parse(bodyLines.join('\n'));
    return isFeedbackEnvelopeWire(payload) ? { method: 'emit', payload } : null;
  } catch {
    return null;
  }
}
