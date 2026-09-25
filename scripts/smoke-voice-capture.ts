// Smoke test for PR-S1V.1 audio capture.
// Run: bun run scripts/smoke-voice-capture.ts
//
// Records ~2s of raw PCM in push-to-talk mode (no silence detection)
// and verifies byte count is in the expected range for 16 kHz · 16-bit
// · mono. First run on macOS will trigger the TCC permission dialog —
// answer "Allow" to your terminal.

import {
  checkRecordingAvailability,
  startRecording,
  stopRecording,
  RECORDING_SAMPLE_RATE,
  RECORDING_CHANNELS,
} from '../src/voice/audio-capture.js';

async function main(): Promise<number> {
  const avail = await checkRecordingAvailability();
  console.log('[1] checkRecordingAvailability:', avail);
  if (!avail.available) {
    console.log('   → backend unavailable, smoke test cannot run.');
    return 2;
  }

  const RECORD_MS = 2000;
  const BYTES_PER_SAMPLE = 2; // 16-bit
  const expectedBytes =
    (RECORDING_SAMPLE_RATE * BYTES_PER_SAMPLE * RECORDING_CHANNELS * RECORD_MS) / 1000;

  console.log(`[2] starting ${RECORD_MS}ms record (push-to-talk mode)...`);
  let bytes = 0;
  let chunks = 0;
  let endedFlag = false;

  const started = await startRecording(
    chunk => {
      bytes += chunk.length;
      chunks++;
    },
    () => {
      endedFlag = true;
      console.log('   → onEnd fired');
    },
    { silenceDetection: false },
  );
  console.log('   startRecording returned:', started);
  if (!started) return 3;

  await new Promise(r => setTimeout(r, RECORD_MS));
  console.log('[3] stopping recorder...');
  stopRecording();
  // Give close handler a moment to fire.
  await new Promise(r => setTimeout(r, 250));

  const lower = expectedBytes * 0.5;
  const upper = expectedBytes * 2.0;
  const inRange = bytes >= lower && bytes <= upper;
  console.log(
    `[4] captured: ${bytes} bytes in ${chunks} chunks (expected ~${expectedBytes} for ${RECORD_MS}ms · tolerance ${lower.toFixed(0)}–${upper.toFixed(0)})`,
  );
  console.log('    onEnd fired:', endedFlag);
  console.log(inRange ? '\n✅ smoke OK — audio capture is producing PCM bytes' : '\n⚠️ unexpected byte count — check sox spawn / mic permission');
  return inRange ? 0 : 1;
}

main().then(code => process.exit(code));
