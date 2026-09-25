// Public surface for `src/expression/renderer/`. Each renderer is a
// pure function `(spec, profile, opts) → string`. Hosts call them
// from their paint loop and never mutate state inside.

export {
  renderProgress,
  type RenderProgressOpts,
} from './progress.js';

export {
  renderSpinner,
  frameCount,
  type RenderSpinnerOpts,
} from './spinner.js';

export {
  renderTable,
  type RenderTableOpts,
} from './table.js';

export {
  renderMarkdown,
  renderParsedBlocks as renderParsedMarkdownBlocks,
  renderInline as renderMarkdownInline,
  stripInline as stripMarkdownInline,
  parseBlocks as parseMarkdownBlocks,
  type ParsedMarkdownBlock,
  type RenderedMarkdownBlock,
  type RenderMarkdownOpts,
} from './markdown.js';

export {
  renderPicker,
  filterRanked as filterPickerRanked,
  wrapText as wrapPickerText,
  type RenderPickerOpts,
} from './picker.js';

export {
  renderStatusModule,
  type StatusModuleStyle,
  type RenderStatusModuleOpts,
} from './status-module.js';

export {
  renderModal,
  wrapBody as wrapModalBody,
  type RenderModalOpts,
} from './modal.js';
