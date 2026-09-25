/**
 * TOX tool-runtime bundle. Import once from `src/tool-runtime/index.ts`
 * to register all 8 task orchestrator tools.
 */
import { taskCreateRuntime } from './create.js';
import { taskListRuntime } from './list.js';
import { taskGetRuntime } from './get.js';
import { taskUpdateRuntime } from './update.js';
import {
  taskDecomposeRuntime,
  taskDecomposeApplyRuntime,
} from './decompose.js';
import { taskDispatchRuntime } from './dispatch.js';
import { taskKillRuntime } from './kill.js';

export const ALL_TOX_RUNTIMES = [
  taskCreateRuntime,
  taskListRuntime,
  taskGetRuntime,
  taskUpdateRuntime,
  taskDecomposeRuntime,
  taskDecomposeApplyRuntime,
  taskDispatchRuntime,
  taskKillRuntime,
] as const;

export const TOX_RUNTIME_IDS: readonly string[] = ALL_TOX_RUNTIMES.map((r) => r.id);

export {
  taskCreateRuntime,
  taskListRuntime,
  taskGetRuntime,
  taskUpdateRuntime,
  taskDecomposeRuntime,
  taskDecomposeApplyRuntime,
  taskDispatchRuntime,
  taskKillRuntime,
};

export {
  dispatchTaskCreate,
  buildTaskCreateTool,
  type TaskCreateInput,
  type TaskCreateResult,
} from './create.js';
export {
  dispatchTaskList,
  buildTaskListTool,
  type TaskListInput,
  type TaskListResult,
} from './list.js';
export {
  dispatchTaskGet,
  buildTaskGetTool,
  type TaskGetInput,
  type TaskGetResult,
} from './get.js';
export {
  dispatchTaskUpdate,
  buildTaskUpdateTool,
  type TaskUpdateInput,
  type TaskUpdateResult,
} from './update.js';
export {
  dispatchTaskDecompose,
  buildTaskDecomposeTool,
  dispatchTaskDecomposeApply,
  buildTaskDecomposeApplyTool,
  type TaskDecomposeInput,
  type TaskDecomposeToolResult,
  type TaskDecomposeApplyInput,
  type TaskDecomposeApplyResult,
} from './decompose.js';
export {
  dispatchTaskDispatch,
  buildTaskDispatchTool,
  type TaskDispatchInput,
  type TaskDispatchResult,
} from './dispatch.js';
export {
  dispatchTaskKill,
  buildTaskKillTool,
  type TaskKillInput,
  type TaskKillResult,
} from './kill.js';
