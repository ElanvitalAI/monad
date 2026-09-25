export interface CronFlagContract {
  boolean: readonly string[];
  valued: readonly string[];
}

export function unknownCronFlag(argv: readonly string[], contract: CronFlagContract): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (contract.valued.includes(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('--') && !contract.boolean.includes(token)) return token;
  }
  return undefined;
}
