// ROADMAP Tier 1 W1 (2026-05-11) — natural-language workflow generator UI.
//
// Slide-down panel that takes a free-text workflow description, asks
// the daemon to materialize it via LLM, and hands the resulting YAML
// back to the parent panel as a "draft new workflow". The parent
// flips into `creatingNew` mode so Save → PUT writes the file.
//
// Why a panel (not a modal): bottom-sheet pattern is the Tier 3 W6
// target; until that lands, an inline collapsible block keeps the
// implementation light and works fine on iPad 11" landscape (where
// the panel still has ~600px center column).

'use client';

import { useState } from 'react';
import { Sparkles, Loader2, X, AlertTriangle, Workflow } from 'lucide-react';
import { useGenerateWorkflow, useSynthesizeWorkflow } from '@/nexus/hooks/use-workflows';
import type { GenerateWorkflowResponse, SynthesizeWorkflowResponse } from '@/nexus/client';
import { WorkflowSynthPreview } from './WorkflowSynthPreview';

interface WorkflowNLPromptProps {
  /** Existing yaml to refine when set; generate-from-scratch when null. */
  currentYaml?: string;
  /** Skill names to feed the LLM as a constrained vocabulary. */
  skills?: string[];
  /** Called with the LLM result on success — parent decides whether to
   *  load it into the editor (creatingNew flow) or refine in place. */
  onGenerated: (result: GenerateWorkflowResponse) => void;
  /** Close the panel. */
  onClose: () => void;
}

export function WorkflowNLPrompt({
  currentYaml,
  skills,
  onGenerated,
  onClose,
}: WorkflowNLPromptProps) {
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<string>('');
  const [synthResult, setSynthResult] = useState<SynthesizeWorkflowResponse | null>(null);
  const generate = useGenerateWorkflow();
  const synth = useSynthesizeWorkflow();
  const isRefinement = Boolean(currentYaml && currentYaml.trim().length > 0);

  const handleSubmit = (): void => {
    if (!prompt.trim() || generate.isPending) return;
    const body: Parameters<typeof generate.mutate>[0] = { prompt: prompt.trim() };
    if (provider) body.provider = provider;
    if (skills && skills.length > 0) body.skills = skills;
    if (isRefinement && currentYaml) body.currentYaml = currentYaml;
    generate.mutate(body, {
      onSuccess: (result) => {
        onGenerated(result);
        // Keep the prompt around — user might want to follow up with a
        // refinement turn. Clear on close instead.
      },
    });
  };

  /** Surface-unification §C2 (2026-05-11) — Synth mode = R3 trigger-aware
   *  synth + preview modal. Distinct from Generate (W1) because the
   *  result includes a trigger summary the user confirms before Apply. */
  const handleSynth = (): void => {
    if (!prompt.trim() || synth.isPending) return;
    const body: Parameters<typeof synth.mutate>[0] = { intent: prompt.trim(), preview: true };
    if (isRefinement && currentYaml) body.context = `current yaml:\n${currentYaml}`;
    synth.mutate(body, {
      onSuccess: (result) => setSynthResult(result),
    });
  };

  const handleSynthApply = (yaml: string, workflowName?: string): void => {
    setSynthResult(null);
    onGenerated({ yaml, warnings: [], raw: yaml, definition: workflowName ? undefined : undefined });
  };

  const errorMsg =
    generate.error instanceof Error
      ? generate.error.message
      : synth.error instanceof Error
        ? synth.error.message
        : generate.isError || synth.isError
          ? 'generation failed'
          : null;

  return (
    <div className="border-b border-border bg-surface-elevated">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <span className="text-xs font-medium">
            {isRefinement ? 'Refine workflow with AI' : 'Generate workflow from text'}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-tertiary hover:bg-surface hover:text-text-primary"
          aria-label="Close NL prompt"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="px-3 pb-3">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isRefinement
              ? 'How should this workflow change? e.g. "add a slack notification at the end"'
              : 'Describe the workflow. e.g. "Research the latest Apple Silicon benchmarks, summarize, and push to my iPhone."'
          }
          rows={3}
          spellCheck={false}
          className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs leading-snug focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-text-secondary focus:border-accent focus:outline-none"
            title="LLM provider (default = your user-config)"
          >
            <option value="">Default provider</option>
            <option value="anthropic">anthropic</option>
            <option value="openai">openai</option>
            <option value="grok">grok</option>
            <option value="gemini">gemini</option>
            <option value="local">local</option>
          </select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleSynth}
              disabled={!prompt.trim() || synth.isPending || generate.isPending}
              className="flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
              title="Trigger-aware synth via R3 native skill (cron · webhook · discord · telegram · manual · chat all supported)"
            >
              {synth.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Synthing…
                </>
              ) : (
                <>
                  <Workflow className="h-3 w-3" />
                  Synth (trigger-aware)
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!prompt.trim() || generate.isPending || synth.isPending}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {generate.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  {isRefinement ? 'Refine' : 'Generate'}
                </>
              )}
            </button>
          </div>
        </div>
        {errorMsg && (
          <div className="mt-2 flex items-start gap-1.5 rounded-md border border-error/40 bg-error/10 px-2 py-1 text-[11px] text-error">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {synthResult && (
          <WorkflowSynthPreview
            result={synthResult}
            onApply={handleSynthApply}
            onRefine={() => setSynthResult(null)}
            onCancel={() => setSynthResult(null)}
          />
        )}
        {generate.data && generate.data.warnings.length > 0 && (
          <ul className="mt-2 max-h-24 overflow-y-auto rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
            {generate.data.warnings.slice(0, 5).map((w, i) => (
              <li key={i} className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
