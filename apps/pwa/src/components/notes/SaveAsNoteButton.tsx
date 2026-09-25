'use client';

// R-OCR.2.1 (2026-05-09) — entry point for the camera → note flow.
//
// Sits next to CameraAttachButton in ChatInput. The semantics differ:
//   CameraAttachButton  → photo becomes an attachment id, referenced by
//                         the next chat turn (assistant sees the image).
//   SaveAsNoteButton    → photo becomes a markdown note saved to the
//                         vault, NEVER attached to a turn (intent is
//                         offline knowledge capture, not conversation).
//
// Implementation: hidden file input with `capture="environment"` for
// iOS Safari camera UI; on selection we open NoteFromImageModal which
// handles the full OCR → review → save flow.

import { useRef, useState } from 'react';
import { FileText } from 'lucide-react';

import { NoteFromImageModal } from './NoteFromImageModal';

export function SaveAsNoteButton() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<Blob | null>(null);
  const [filename, setFilename] = useState<string>('photo.jpg');

  function onPick(ev: React.ChangeEvent<HTMLInputElement>): void {
    const file = ev.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    ev.target.value = '';
    if (!file) return;
    setImage(file);
    setFilename(file.name);
    setOpen(true);
  }

  function onClose(): void {
    setOpen(false);
    // Drop the blob reference once the modal closes — the modal's
    // own state-reset useEffect handles its internals.
    setImage(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label="save photo as note"
        title="사진 → 마크다운 노트로 저장"
        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <FileText className="h-3.5 w-3.5" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <NoteFromImageModal
        open={open}
        image={image}
        filename={filename}
        onClose={onClose}
      />
    </>
  );
}
