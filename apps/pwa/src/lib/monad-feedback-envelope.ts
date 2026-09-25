// PWA-local mirror of the daemon-side `monad/feedback/*` transport in
// `src/acp/monad-extensions.ts`. The PWA is a separate build target, so
// this wire codec intentionally depends only on local PWA schema guards.
//
// Wire shape:
//   [monad/feedback/emit] <blockId>
//   <FeedbackEnvelope JSON>
//   <<monad-feedback-end <blockId>>

import {
  isFeedbackEnvelopeWire,
  type FeedbackEnvelopeWire,
} from './feedback-envelope';

export interface MonadFeedbackEnvelope {
  method: 'emit';
  payload: FeedbackEnvelopeWire;
}

export function parseMonadFeedbackEnvelope(text: string): MonadFeedbackEnvelope | null {
  const lines = text.split('\n');
  const first = lines[0];
  if (!first) return null;
  const match = /^\[monad\/feedback\/([a-zA-Z]+)\] (.+)$/.exec(first);
  if (!match || match[1] !== 'emit') return null;

  const bodyLines: string[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^<<monad-feedback-end /.test(line)) break;
    bodyLines.push(line);
  }

  try {
    const payload: unknown = JSON.parse(bodyLines.join('\n'));
    return isFeedbackEnvelopeWire(payload) ? { method: 'emit', payload } : null;
  } catch {
    return null;
  }
}
