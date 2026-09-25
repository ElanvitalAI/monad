// ── Presentation P4a · Window Chrome · public barrel ──
//
// First heavy consumer of the P2 attribute classes. Exposes:
//   - renderChrome(input) — draw a decoration into `string[]`
//   - composeAnsi / applyAnsi — wrap TextStyle around text
//   - resolveColorToken — semantic ColorToken → hex

export {
  renderChrome,
  type ChromeRenderInput,
  type BorderGlyphFamily,
} from './renderer.js';

export {
  composeAnsi,
  applyAnsi,
  type AnsiPair,
} from './text-style-to-ansi.js';

export {
  resolveColorToken,
  resolveColorOrText,
} from './resolve-color.js';

export {
  resolveWindowChromeSpec,
  type WindowChromeSpec,
} from './window-chrome.js';
