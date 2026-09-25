import { describe, expect, test } from 'bun:test';
import { MenuTreeController } from '../../../src/ui/widgets/menu-tree-controller.js';

describe('menu tree controller', () => {
  test('launcher toggle opens parent then dismisses on repeated click', () => {
    const controller = new MenuTreeController({
      launcherCount: 2,
      hasChildMenu: ({ parentIndex }) => parentIndex === 1,
    });
    controller.toggleLauncher(1);
    expect(controller.activeLauncherIndex).toBe(1);
    expect(controller.activeRole).toBe('parent');
    expect(controller.isParentOpen).toBe(true);

    controller.toggleLauncher(1);
    expect(controller.activeRole).toBe('launcher');
    expect(controller.isParentOpen).toBe(false);
  });

  test('parent selection opens child only when current row has submenu', () => {
    const controller = new MenuTreeController({
      launcherCount: 1,
      hasChildMenu: ({ parentIndex }) => parentIndex === 1,
    });
    controller.openParent();
    controller.setParentCursor(0);
    controller.afterParentSelection();
    expect(controller.isChildOpen).toBe(false);
    expect(controller.activeRole).toBe('parent');

    controller.setParentCursor(1);
    controller.afterParentSelection();
    expect(controller.isChildOpen).toBe(true);
    expect(controller.activeRole).toBe('child');
  });

  test('left from child returns to parent while escape is left to the popup surface', () => {
    const controller = new MenuTreeController({
      launcherCount: 1,
      hasChildMenu: () => true,
    });
    controller.openParent();
    controller.openChild();
    expect(controller.handleKey('left')).toBe(true);
    expect(controller.activeRole).toBe('parent');
    expect(controller.isChildOpen).toBe(false);
    expect(controller.handleKey('escape')).toBe(false);
    expect(controller.activeRole).toBe('parent');
    expect(controller.isParentOpen).toBe(true);
  });
});
