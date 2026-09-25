// P1.4 · Channel file spill — the sink half of the relay overflow seam.
//
// 내부 문서 `PLAN-channel-terminal-relay-2026-07-09` §A (P1.4). The relay
// formatter (agent-event-relay.ts `renderToolUpdate`) already emits an
// `overflow` payload — the FULL untruncated tool body — whenever a tool
// update exceeds the inline char cap. Until now both delegate paths
// (slash `/cc`, NL `delegate_code_agent`) DROPPED that overflow: the
// chat saw a truncated head + "(truncated N chars)" and the rest was
// lost.
//
// THIS is the channel-agnostic sink that spills that full body as a file
// attachment (Telegram sendDocument · Discord attachment) so the operator
// gets the complete diff / stdout without blowing the inline message cap.
// It is deliberately tiny and separate from ConfirmChannel/QuestionChannel
// — a surface can implement file spill without implementing HITL, and vice
// versa. Telegram implements it today (`TelegramBot.fileSinkForChat`);
// other channels adopt it when their PR lands (optional everywhere it's
// consumed, so an absent sink just falls back to the truncated inline).

export interface FileSink {
  /** Spill a large text body as a file attachment into the chat.
   *
   *  Fire-and-forget from the caller's perspective — like a streamer's
   *  `edit`, the implementation schedules the async send and swallows
   *  its own errors (a failed spill must never wedge a running turn).
   *
   *  `ext` picks the extension ('diff' for a patch, 'txt' otherwise) so
   *  the client renders it with the right syntax; `caption` is an
   *  optional 1-line header (e.g. the tool title + size); `name` is an
   *  optional full filename (incl. extension) for identifiability — e.g.
   *  `Edit-src-foo.ts.diff` instead of the generic `tool-output.diff`.
   *  Derive it with `spillFileName(title, ext)`. */
  sendFile(body: string, opts: { ext: string; caption?: string; name?: string }): void;

  /** Spill a binary image (e.g. a rendered PTY screen PNG) as an inline
   *  photo attachment. Optional — surfaces that can't render inline images
   *  omit it, and callers guard with `?.` (an absent sink just means no
   *  image is delivered). Fire-and-forget, same discipline as sendFile:
   *  the implementation schedules the async send and swallows its errors.
   *  Telegram implements it via sendPhoto; other channels adopt as needed. */
  sendImage?(png: Buffer, opts?: { caption?: string }): void;
}

/** Derive an identifying spill filename from a tool title + extension.
 *  "Edit(src/foo.ts)" → "Edit-src-foo.ts.diff"; "Bash: git diff" →
 *  "Bash-git-diff.txt". Any run of non-alphanumeric-dot collapses to a
 *  single dash so the tool + path identity survives. Falls back to
 *  "tool-output" when the title yields nothing usable; caps the base at
 *  60 chars so attachments stay tidy. PURE. */
export function spillFileName(title: string | undefined, ext: string): string {
  const safeExt = ext === 'diff' ? 'diff' : 'txt';
  let base = (title ?? '')
    .replace(/[^A-Za-z0-9.]+/g, '-') // non-alnum-dot runs → single dash (keeps path/tool identity)
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');   // trim leading/trailing dashes & dots
  if (base.length > 60) base = base.slice(0, 60).replace(/[-.]+$/g, '');
  if (!base) base = 'tool-output';
  return `${base}.${safeExt}`;
}
