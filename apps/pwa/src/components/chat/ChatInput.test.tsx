// ChatInput voice-intake wire — pins the R2 mount so a refactor
// can't silently strip the import.
//
// Pattern mirror: `test/nexus-multi-llm-wire-smoke.test.ts` —
// source-level grep is the right tool for "did this stay imported?"
// guards. Render-level tests would need to spin up the full
// DaemonProvider tree which is overkill for a single-button mount.
//
// The component itself (ShowroomVoiceIntake — historical name; the
// PR-2 cleanup of the rename can fold here without touching this
// guard) is exercised in
// `showroom/ShowroomVoiceIntake.test.tsx`.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAT_INPUT_SRC = readFileSync(join(HERE, 'ChatInput.tsx'), 'utf8');

describe('ChatInput · R2 voice-intake wire', () => {
  test('imports ShowroomVoiceIntake from the showroom surface', () => {
    expect(CHAT_INPUT_SRC).toMatch(
      /import\s*\{\s*ShowroomVoiceIntake\s*\}\s*from\s*['"]@\/components\/showroom\/ShowroomVoiceIntake['"]/,
    );
  });

  test('mounts <ShowroomVoiceIntake /> inside the attach button row', () => {
    // Look for the mount in the attach-button cluster (next to
    // CameraAttachButton + FileAttachButton). The exact JSX is
    // self-closing without props.
    expect(CHAT_INPUT_SRC).toMatch(/<ShowroomVoiceIntake\s*\/>/);
  });

  test('voice-intake mount is co-located with camera/file attach buttons', () => {
    // Order: Camera, File, then voice intake — co-location guarantees
    // the intake mic shares the attach-affordance affordance group.
    const camIdx = CHAT_INPUT_SRC.indexOf('<CameraAttachButton');
    const fileIdx = CHAT_INPUT_SRC.indexOf('<FileAttachButton');
    const voiceIdx = CHAT_INPUT_SRC.indexOf('<ShowroomVoiceIntake');
    expect(camIdx).toBeGreaterThan(0);
    expect(fileIdx).toBeGreaterThan(camIdx);
    expect(voiceIdx).toBeGreaterThan(fileIdx);
  });
});

describe('ChatInput · R-OCR.2.1 SaveAsNoteButton wire', () => {
  test('imports SaveAsNoteButton from the notes surface', () => {
    expect(CHAT_INPUT_SRC).toMatch(
      /import\s*\{\s*SaveAsNoteButton\s*\}\s*from\s*['"]@\/components\/notes\/SaveAsNoteButton['"]/,
    );
  });

  test('mounts <SaveAsNoteButton /> inside the attach button row', () => {
    expect(CHAT_INPUT_SRC).toMatch(/<SaveAsNoteButton\s*\/>/);
  });

  test('SaveAsNoteButton is co-located with camera/file/voice cluster', () => {
    // Sits between the file attach button and the voice intake mic so
    // the four affordances form one visual cluster.
    const fileIdx = CHAT_INPUT_SRC.indexOf('<FileAttachButton');
    const noteIdx = CHAT_INPUT_SRC.indexOf('<SaveAsNoteButton');
    const voiceIdx = CHAT_INPUT_SRC.indexOf('<ShowroomVoiceIntake');
    expect(fileIdx).toBeGreaterThan(0);
    expect(noteIdx).toBeGreaterThan(fileIdx);
    expect(voiceIdx).toBeGreaterThan(noteIdx);
  });
});
