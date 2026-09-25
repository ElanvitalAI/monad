export type MenuTreeFocusRole = 'launcher' | 'parent' | 'child';

export interface MenuTreeChildCheck {
  launcherIndex: number;
  parentIndex: number;
}

export interface MenuTreeControllerSpec {
  launcherCount: number;
  hasChildMenu: (state: MenuTreeChildCheck) => boolean;
}

export class MenuTreeController {
  private launcherIndex = 0;
  private focusRole: MenuTreeFocusRole = 'launcher';
  private parentOpen = false;
  private childOpen = false;
  private readonly parentCursor: number[];
  private readonly childCursor: number[];

  constructor(private readonly spec: MenuTreeControllerSpec) {
    this.parentCursor = Array.from({ length: Math.max(1, spec.launcherCount) }, () => 0);
    this.childCursor = Array.from({ length: Math.max(1, spec.launcherCount) }, () => 0);
  }

  get activeLauncherIndex(): number {
    return this.launcherIndex;
  }

  get activeRole(): MenuTreeFocusRole {
    return this.focusRole;
  }

  get isParentOpen(): boolean {
    return this.parentOpen;
  }

  get isChildOpen(): boolean {
    return this.childOpen;
  }

  getParentCursor(index = this.launcherIndex): number {
    return this.parentCursor[index] ?? 0;
  }

  getChildCursor(index = this.launcherIndex): number {
    return this.childCursor[index] ?? 0;
  }

  setParentCursor(index: number, launcherIndex = this.launcherIndex): void {
    this.parentCursor[launcherIndex] = Math.max(0, index);
  }

  setChildCursor(index: number, launcherIndex = this.launcherIndex): void {
    this.childCursor[launcherIndex] = Math.max(0, index);
  }

  toggleLauncher(index: number): void {
    if (this.launcherIndex === index && this.parentOpen) {
      this.dismiss();
      return;
    }
    this.launcherIndex = clampLauncherIndex(index, this.spec.launcherCount);
    this.openParent();
  }

  openParent(index = this.launcherIndex): void {
    this.launcherIndex = clampLauncherIndex(index, this.spec.launcherCount);
    this.parentOpen = true;
    this.childOpen = false;
    this.focusRole = 'parent';
  }

  openChild(): boolean {
    if (!this.canOpenChild()) return false;
    this.parentOpen = true;
    this.childOpen = true;
    this.focusRole = 'child';
    return true;
  }

  closeChild(): void {
    this.childOpen = false;
    this.focusRole = 'parent';
  }

  dismiss(): void {
    this.parentOpen = false;
    this.childOpen = false;
    this.focusRole = 'launcher';
  }

  afterParentSelection(): void {
    if (this.canOpenChild()) {
      this.openChild();
      return;
    }
    this.closeChild();
  }

  handleKey(name: string): boolean {
    if (this.focusRole === 'launcher') {
      if (name === 'enter' || name === 'right' || name === 'l') {
        this.openParent();
        return true;
      }
      return false;
    }
    if (this.focusRole === 'parent') {
      if (name === 'enter' && this.canOpenChild()) return this.openChild();
      if (name === 'right' || name === 'l') return this.openChild();
      if (name === 'left' || name === 'h') {
        this.dismiss();
        return true;
      }
      return false;
    }
    if (name === 'left' || name === 'h') {
      this.closeChild();
      return true;
    }
    return false;
  }

  private canOpenChild(): boolean {
    return this.spec.hasChildMenu({
      launcherIndex: this.launcherIndex,
      parentIndex: this.getParentCursor(),
    });
  }
}

function clampLauncherIndex(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(index, count - 1));
}
