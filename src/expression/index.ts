// Public API for the expression framework — re-exports of the
// foundation primitives. Future layers (`renderer/`, `config/`,
// `state/`, `widget/`) ride on top and append their re-exports here.
//
// Consumers should import from `'../expression/index.js'` (or the
// '#expression' alias when one lands) rather than reaching into
// individual files. That keeps refactor-cost low when we re-organize
// internals.

export {
  type AdaptiveColor,
  type ColorProfile,
  detectProfile,
  resolveColor,
  adaptive,
  adaptivePalette,
  paint,
  paintBg,
  hexToRgb,
  rgbToAnsi256,
  rgbToAnsi16,
  wrapAnsi16Fg,
  wrapAnsi16Bg,
} from './color.js';

export { Style } from './style.js';

export {
  type BorderShape,
  type BorderKind,
  BORDER_NORMAL,
  BORDER_ROUNDED,
  BORDER_THICK,
  BORDER_DOUBLE,
  BORDER_DOTTED,
  BORDER_DASHED,
  BORDER_BLOCK,
  BORDER_ASCII,
  BORDER_HIDDEN,
  BORDERS,
  pickBorder,
} from './borders.js';

export {
  type Spec,
  type SpecKind,
  type SpecStyle,
  type ActionSpec,
  type FieldSpec,
  type FieldKind,
  type ColumnSpec,
  type StepSpec,
  type TableSpec,
  type MarkdownSpec,
  type ModalSpec,
  type ProgressSpec,
  type SpinnerSpec,
  type PickerSpec,
  type PickerItemSpec,
  type StatusModuleSpec,
  type InteractiveModalSpec,
  type InteractiveModalStep,
  type ConfirmStepSpec,
  type TextStepSpec,
  type PickerStepSpec,
  isKind,
} from './spec/types.js';

export { type Lifecycle, defineLifecycle } from './lifecycle.js';
export { exprDebug, debugEnabled } from './debug.js';

// Locale + i18n bundles.
export {
  type Locale,
  detectLocale,
  isLocale,
  LOCALES,
} from './locale.js';
export {
  type Messages,
  getMessages,
  format as formatMessage,
  messagesEn,
  messagesKo,
  messagesJa,
  messagesZh,
} from './i18n/index.js';

// Accessibility — screen-reader descriptors.
export {
  type DescribeOpts,
  type DescribableNotificationEvent,
  type DescribeNotificationOpts,
  type NotificationLevel,
  describeForScreenReader,
  describeSpec,
  describeNotificationEvent,
  notificationLevelOf,
  notificationLevelLabel,
} from './a11y.js';

// Picker adapters — bridge expression PickerSpec ↔ monad search-modal
// SearchItem records (one-direction-each pure converters).
export {
  type PickerSearchItem,
  type SearchItemsToPickerOpts,
  searchItemsToPickerSpec,
  pickerSpecToSearchItems,
} from './adapters/picker.js';

// Renderers — pure (spec, profile, opts) → string.
export {
  renderProgress,
  renderSpinner,
  renderTable,
  renderMarkdown,
  renderParsedMarkdownBlocks,
  renderMarkdownInline,
  stripMarkdownInline,
  parseMarkdownBlocks,
  renderPicker,
  filterPickerRanked,
  wrapPickerText,
  renderStatusModule,
  renderModal,
  wrapModalBody,
  frameCount,
  type RenderProgressOpts,
  type RenderSpinnerOpts,
  type RenderTableOpts,
  type RenderMarkdownOpts,
  type ParsedMarkdownBlock,
  type RenderedMarkdownBlock,
  type RenderPickerOpts,
  type RenderStatusModuleOpts,
  type StatusModuleStyle,
  type RenderModalOpts,
} from './renderer/index.js';

// Markdown theme presets — paired with `renderMarkdown`.
export {
  MARKDOWN_THEMES,
  pickMarkdownTheme,
  type MarkdownTheme,
  type MarkdownThemeName,
} from './themes/markdown.js';

// Fuzzy matcher — exported for hosts that want to drive their own
// picker shell while reusing the same scoring rules.
export {
  type FuzzyMatch,
  type FuzzyRanked,
  fuzzyMatch,
  fuzzyRank,
} from './fuzzy.js';

// Bidirectional interaction substrate — Q&A chain widget.
export {
  type ModalSessionState,
  type ModalSessionEvent,
  type ModalSessionSnapshot,
  INITIAL_SNAPSHOT,
  transition as transitionModalState,
  runStateMachine,
  type ModalKey,
  type ModalKeyAction,
  routeInteractiveModalKey,
  type ReadlineEvent,
  type ReadlineListener,
  type ReadlineHost,
  type TestReadlineHost,
  type NodeReadlineHostOptions,
  createTestReadlineHost,
  createNodeReadlineHost,
  type InteractiveModalLifecycle,
  type InteractiveModalProgress,
  type InteractiveModalRunOpts,
  type InteractiveModalResult,
  runInteractiveModalSession,
} from './widget/index.js';
