// Grok chat variant — family work style, not the exploration-discipline addendum.
// Grok already has a separate addendum for search-limit rhythm. Other families
// get a short provider-variant block (gpt / anthropic / local); without this
// file grok falls through to the GPT default. These bullets match that layer:
// compact execution posture, distinct from GPT_CHAT_VARIANT so coverage can
// see a dedicated chat prompt.

export const GROK_CHAT_VARIANT = `## Provider variant: grok

- Start from the smallest candidate set that can answer the request; read those before widening the search.
- Lead with the concrete result or next action. Do not restage the search path as the answer.
- Prefer native web tools for live lookup. A blocked or duplicate tool result is a stop, not a retry of the same call.
- Batch independent tool work, then write when the evidence is enough.
`;
