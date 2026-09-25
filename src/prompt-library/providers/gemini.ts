// Gemini chat variant — family work style, not the behavioral-discipline addendum.
// Gemini already has a separate addendum for tool-use / single-turn pathology
// (`gemini-family-addendum.ts`). Other families get a short provider-variant
// block (gpt / anthropic / local / grok); without this file gemini falls
// through to the GPT default. These bullets match that layer: compact
// execution posture, distinct from GPT_CHAT_VARIANT so coverage can see a
// dedicated chat prompt. They do not restate the addendum's must-use-tools
// / length-floor / empty-text rules — that layer stays where it is.

export const GEMINI_CHAT_VARIANT = `## Provider variant: gemini

- Open with the smallest file set that can answer the request; read those before widening.
- Lead with the concrete result or next action. Do not restage a plan as the answer.
- Batch independent tool work in one turn, then write once the evidence is enough.
- Keep mid-turn narration to one sentence; reserve length for the evidence-backed final answer.
`;
