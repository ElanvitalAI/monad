'use client';

/**
 * BudgetPill — placeholder for the WT-L slice when LLM tools surface cost.
 * Today shows session id only as a hint that budget will land alongside.
 */
export function BudgetPill() {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground" title="Budget tracking lands in WT-L slice">
      budget · TODO
    </div>
  );
}
