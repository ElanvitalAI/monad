// Ambient declarations for third-party packages that ship without
// their own .d.ts files. Kept separate from source so tsconfig's
// rootDir doesn't complain, and grep-discoverable as "which vendors
// lack types" when upgrading deps.

declare module 'mermaidtui' {
  export interface RenderOptions {
    ascii?: boolean;
  }
  export function renderMermaidToTui(source: string, options?: RenderOptions): string;
}
