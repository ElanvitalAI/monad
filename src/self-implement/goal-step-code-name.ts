const MINIMUM_SYMBOL_LENGTH = 5;

const SOURCE_PATH_TOKEN = /(?:^|[\s`"'(])(?:\.\.?\/|\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|rb|php|cs|c|cc|cpp|h)\b/;
const CAMEL_OR_PASCAL_SYMBOL = new RegExp(`\\b(?=[A-Za-z]{${MINIMUM_SYMBOL_LENGTH},}\\b)(?:[a-z]+[A-Z][A-Za-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*)\\b`);
const QUOTED_KEBAB_MODULE_NAME = /`[a-z]{3,}(?:-[a-z][a-z0-9]*)+`/;

/** Returns whether a decomposed goal step names a source path, symbol, or explicitly quoted module. */
export function hasGoalStepCodeName(step: string): boolean {
  return SOURCE_PATH_TOKEN.test(step)
    || CAMEL_OR_PASCAL_SYMBOL.test(step)
    || QUOTED_KEBAB_MODULE_NAME.test(step);
}
