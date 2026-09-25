const ATTACHMENT_TOKEN_RE = / ?(\[(?:Image|Text|Md|PDF|Docx|Xlsx) #\d+\])$/;

export interface DeleteAttachmentTokenInput {
  line: string;
  cursor: number;
}

export interface DeleteAttachmentTokenResult {
  deleted: boolean;
  nextLine: string;
  nextCursor: number;
  token?: string;
}

export function deleteAttachmentTokenBeforeCursor(
  input: DeleteAttachmentTokenInput,
): DeleteAttachmentTokenResult {
  const textBefore = input.line.slice(0, input.cursor);
  const tokenMatch = textBefore.match(ATTACHMENT_TOKEN_RE);
  if (!tokenMatch) {
    return {
      deleted: false,
      nextLine: input.line,
      nextCursor: input.cursor,
    };
  }
  const tokenLen = tokenMatch[0]!.length;
  const bareToken = tokenMatch[1]!;
  return {
    deleted: true,
    nextLine: input.line.slice(0, input.cursor - tokenLen) + input.line.slice(input.cursor),
    nextCursor: input.cursor - tokenLen,
    token: bareToken,
  };
}
