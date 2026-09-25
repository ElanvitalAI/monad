import type { SkillFileEntry, SkillInfo, SkillViewState } from '../skills/view.js';

export interface DashboardSkillWidgetLike {
  state: Record<string, unknown>;
}

export interface DashboardSkillWidgetRuntime {
  projectBrowser(
    widget: DashboardSkillWidgetLike | null | undefined,
    skills: readonly SkillInfo[],
    skillsRoot: string,
    skillCursor: number,
    skillOffset: number,
    focused: boolean,
    renderMuted: (text: string) => string,
    renderAccent: (text: string) => string,
  ): void;
  projectFiles(
    widget: DashboardSkillWidgetLike | null | undefined,
    skillView: SkillViewState,
    focused: boolean,
    renderMuted: (text: string) => string,
    renderLabel: (file: SkillFileEntry) => string,
    renderIcon: (file: SkillFileEntry) => string,
  ): void;
}

export function createDashboardSkillWidgetRuntime(): DashboardSkillWidgetRuntime {
  return {
    projectBrowser(widget, skills, skillsRoot, skillCursor, skillOffset, focused, renderMuted, renderAccent) {
      if (!widget) return;
      if (skills.length === 0) {
        widget.state.items = [renderMuted('(no skills found)'), renderMuted(skillsRoot)];
        widget.state.icons = ['', ''];
        widget.state.cursor = 0;
      } else {
        widget.state.items = skills.map(skill => renderAccent(skill.name));
        widget.state.icons = skills.map(() => renderAccent('🔧'));
        widget.state.cursor = skillCursor;
      }
      widget.state.offset = skillOffset;
      widget.state.preserveAnsi = true;
      widget.state.selected = new Set<string>();
      widget.state.focused = focused;
    },
    projectFiles(widget, skillView, focused, renderMuted, renderLabel, renderIcon) {
      if (!widget) return;
      if (skillView.files.length === 0) {
        const hint = skillView.skills.length === 0 ? '(no skills)' : '(no matching files)';
        widget.state.items = [renderMuted(hint)];
        widget.state.icons = [''];
        widget.state.cursor = 0;
      } else {
        widget.state.items = skillView.files.map(renderLabel);
        widget.state.icons = skillView.files.map(renderIcon);
        widget.state.cursor = skillView.fileCursor;
      }
      widget.state.offset = skillView.fileOffset;
      widget.state.preserveAnsi = true;
      const selected = new Set<string>();
      for (const file of skillView.files) {
        if (skillView.selected.has(file.absPath)) selected.add(renderLabel(file));
      }
      widget.state.selected = selected;
      widget.state.focused = focused;
    },
  };
}
