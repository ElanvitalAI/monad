import type { GoalFileLintResult } from './goal-author.js';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2)
  ? (<Value>() => Value extends Right ? 1 : 2) extends (<Value>() => Value extends Left ? 1 : 2)
    ? true
    : false
  : false;
type Expect<Condition extends true> = Condition;

type KnownOriginTagCountIsOptionalNumber = Expect<Equal<GoalFileLintResult['knownOriginTagCount'], number | undefined>>;

const resultWithoutKnownOriginTagCount: Pick<GoalFileLintResult, 'recognizedInvariantCount' | 'knownOriginTagCount'> = {
  recognizedInvariantCount: 0,
};

void resultWithoutKnownOriginTagCount;
void (null as unknown as KnownOriginTagCountIsOptionalNumber);
