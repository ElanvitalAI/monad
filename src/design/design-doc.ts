export interface DesignDocumentDeclarations {
  declaredRulebooks: readonly string[];
  unavailableRulebooks: readonly string[];
}

const RULEBOOKS_HEADING = '## Craft rulebooks';

/** Reads the bullet items under one `## …` heading.
 *
 *  Extracted so `DESIGN.md` grows new sections WITHOUT growing new parsers —
 *  the craft-rulebook list and the design direction are the same shape, and a
 *  second hand-written loop is how the two would drift apart. `#11810` already
 *  had to delete a fourth hand-maintained copy of the rulebook list; this keeps
 *  the count at one.
 *
 *  Section ends at the next line starting with `#` (any level), so a document
 *  can carry many sections in any order. */
export function readSectionItems(document: string, heading: string): string[] {
  const items: string[] = [];
  let inSection = false;

  for (const line of document.split(/\r?\n/)) {
    if (line === heading) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith('#')) break;
    if (!inSection) continue;
    const declared = /^\s*-\s+(.+?)\s*$/.exec(line)?.[1];
    if (declared) items.push(declared);
  }

  return items;
}

/** Parses the craft rulebook names declared in a DESIGN.md document. */
export function parseDesignDocument(document: string, availableRulebooks: readonly string[]): DesignDocumentDeclarations {
  const declaredRulebooks = readSectionItems(document, RULEBOOKS_HEADING);

  return {
    declaredRulebooks,
    unavailableRulebooks: declaredRulebooks.filter((name) => !availableRulebooks.includes(name)),
  };
}
