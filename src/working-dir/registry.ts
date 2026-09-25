// Compatibility bridge while callers migrate from the old
// `working-dir` naming to the browser-instance substrate.
export {
  BrowserPaneRegistry as WorkingDirRegistry,
  cloneBrowserPaneModel as cloneWorkingDirState,
} from '../browser-pane/registry.js';
