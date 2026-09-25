import { join } from 'node:path';
import { debug } from '../debug/log.js';
import { getMonadConfigDirOverride } from '../monad-config-dir.js';
import { getTestStateRoot } from '../nexus/paths.js';
import { findTreeRoot, getAppliedGlobalTestRoot } from '../cli/test-flag.js';
import { observeLeaderAxes } from './leader.js';
import { prodInstanceRoot, resolveInstance, treeDerivedTestEnabled, type InstanceResolution } from './resolve.js';

interface ResolveCurrentInstanceDeps {
  cwd?: () => string;
  stampedStateDir?: () => string | undefined;
  explicitFlagRoot?: () => string | undefined;
  treeDerivedEnabled?: () => boolean;
}

/** 현재 프로세스의 4층 판정 입력을 모아 순수 리졸버에 전달한다. */
export function resolveCurrentInstance(deps: ResolveCurrentInstanceDeps = {}): InstanceResolution {
  const cwd = (deps.cwd ?? (() => process.cwd()))();
  const explicitFlagRoot = (deps.explicitFlagRoot ?? (() =>
    getAppliedGlobalTestRoot() ?? getTestStateRoot() ?? getMonadConfigDirOverride()))();
  const treeRoot = findTreeRoot(cwd);
  const resolution = resolveInstance({
    explicitFlagRoot,
    stampedStateDir: (deps.stampedStateDir ?? (() => process.env.MONAD_STATE_DIR))(),
    treeDerivedEnabled: (deps.treeDerivedEnabled ?? treeDerivedTestEnabled)(),
    axes: observeLeaderAxes(),
    treeTestRoot: treeRoot ? join(treeRoot, '.monad-test') : null,
    prodRoot: prodInstanceRoot(),
  });
  debug.log('instance.current', 'resolved', { layer: resolution.layer, kind: resolution.kind });
  return resolution;
}
