#!/usr/bin/env python3
"""Measure whether open draft changes have already been superseded.

This is a measurement tool, not a merge or recovery tool.  Its intentional
standalone execution path is ``__main__ → main → sweep_open_drafts``; this landing
adds no daemon or cron caller. Patch applicability is measured exclusively with
``git apply --check``: ``git apply --3way --check`` is
intentionally not used because it can return zero for a patch that conflicts by
using a three-way fallback.  A non-zero ``git apply --check`` result (including
"already exists in working directory", "No such file or directory", and "does
not match index") means "얹히지 않음"; only failure to start the command is
"판정 불가" for applicability.

Only these added declarations are counted: ``export [async] function|const|class|
interface|type NAME`` in non-test files.  ``export default`` (including named
default functions), let, var, enum, namespace, abstract class, and brace re-exports
are intentionally outside this landing's scope.  The result does not answer whether
the draft is safe to merge, whether equal names have equal contents, whether an
internal-only PR has value, or whether a non-applicable patch could be recovered
with three-way application.

Usage: python3 scripts/superseded-draft-sweep.py   (옵션 없음 · --help 로 확인)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, Sequence

VERDICT_REPLACEMENT_CANDIDATE = "대체 후보"
VERDICT_PARTIAL_REPLACEMENT = "부분 대체"
VERDICT_UNIQUE_DELIVERABLE = "고유 산출"
VERDICT_INDETERMINATE = "판정 불가"
# ⭐ 시험 전용 draft 는 export 선언이 «없어» 위 넷으로는 영영 「판정 불가」다(2026-08-27 실측:
#   24건 중 13건). 그 자리를 「시험 이름」으로 한 번 더 잰다 — 이름은 계약의 «문장»이라
#   같은 이름이 main 에 있으면 그 시험이 이미 서 있다는 뜻이다.
VERDICT_TESTS_ALREADY_PRESENT = "시험 이미 있음"
VERDICT_TESTS_PARTIAL = "시험 부분 존재"
VERDICT_TESTS_UNIQUE = "고유 시험"
APPLIES = "얹힘 가능"
DOES_NOT_APPLY = "얹히지 않음"

EXPORT_DECLARATION = re.compile(
    r"^\+\s*export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)\b"
)
SOURCE_DECLARATION = re.compile(
    r"^\s*export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)\b",
    re.MULTILINE,
)


class CommandResult:
    def __init__(self, started: bool, returncode: int | None, stdout: str, stderr: str) -> None:
        self.started = started
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


CommandRunner = Callable[[Sequence[str], str | None], CommandResult]
# True and False are observed source facts; None preserves a source-read failure.
SymbolLookup = Callable[[str], bool | None]


def is_test_file(path: str) -> bool:
    normalized = path.replace("\\", "/")
    parts = normalized.split("/")
    filename = parts[-1]
    return "test" in parts or "tests" in parts or "__tests__" in parts or ".test." in filename or ".spec." in filename


def extract_export_symbols(diff: str) -> list[str]:
    """Extract only the five deliberately supported added export forms."""
    symbols: list[str] = []
    current_path: str | None = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            candidate = line[4:].strip()
            current_path = None if candidate == "/dev/null" else candidate.removeprefix("b/")
            continue
        if current_path is None or is_test_file(current_path):
            continue
        match = EXPORT_DECLARATION.match(line)
        if match:
            symbols.append(match.group(1))
    return symbols


TEST_DECLARATION = re.compile(
    r"""^\+\s*(?:it|test|describe)\s*\(\s*(['"`])(.+?)\1"""
)


def extract_test_names(diff: str) -> list[str]:
    """Added test/describe titles from test files only, in first-seen order.

    ⛔ Only ``+`` lines of files this sweep calls test files are read; a title that
    merely moved keeps its name and is therefore counted as present, which is the
    intent — the question is whether the contract sentence stands in main, not
    whether the line moved.
    """
    names: list[str] = []
    current_path: str | None = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            candidate = line[4:].strip()
            current_path = None if candidate == "/dev/null" else candidate.removeprefix("b/")
            continue
        if current_path is None or not is_test_file(current_path):
            continue
        match = TEST_DECLARATION.match(line)
        if match:
            name = match.group(2)
            if name not in names:
                names.append(name)
    return names


def classify_test_names(diff: str, test_name_lookup: SymbolLookup) -> dict[str, object]:
    """Second ruler for test-only drafts, kept separate from the symbol verdict.

    ⛔ This does not answer whether the draft is safe to merge, whether equal names
    assert equal things, or whether a missing name is worth keeping. It answers one
    question: does main already carry this contract sentence.
    """
    names = extract_test_names(diff)
    if not names:
        return {"testVerdict": VERDICT_INDETERMINATE, "testNames": 0, "testNamesPresent": 0}
    results = [test_name_lookup(name) for name in names]
    if any(result is None for result in results):
        return {"testVerdict": VERDICT_INDETERMINATE, "testNames": len(names), "testNamesPresent": 0}
    present = sum(result is True for result in results)
    if present == len(names):
        verdict = VERDICT_TESTS_ALREADY_PRESENT
    elif present > 0:
        verdict = VERDICT_TESTS_PARTIAL
    else:
        verdict = VERDICT_TESTS_UNIQUE
    return {"testVerdict": verdict, "testNames": len(names), "testNamesPresent": present}


def classify_symbols(diff: str, source_symbol_lookup: SymbolLookup) -> dict[str, object]:
    """Purely classify extracted names while preserving an unavailable source lookup."""
    symbols = extract_export_symbols(diff)
    if not symbols:
        return {"verdict": VERDICT_INDETERMINATE, "symbols": symbols}

    lookup_results = [source_symbol_lookup(symbol) for symbol in symbols]
    if any(result is None for result in lookup_results):
        verdict = VERDICT_INDETERMINATE
    else:
        existing = sum(result is True for result in lookup_results)
        if existing == len(symbols):
            verdict = VERDICT_REPLACEMENT_CANDIDATE
        elif existing > 0:
            verdict = VERDICT_PARTIAL_REPLACEMENT
        else:
            verdict = VERDICT_UNIQUE_DELIVERABLE
    return {"verdict": verdict, "symbols": symbols}


def classify_applicability(result: CommandResult) -> str:
    """A process that starts but exits non-zero is a definitive non-application."""
    if not result.started:
        return VERDICT_INDETERMINATE
    return APPLIES if result.returncode == 0 else DOES_NOT_APPLY


def assess_draft(
    diff: str,
    source_symbol_lookup: SymbolLookup,
    apply_result: CommandResult,
    test_name_lookup: SymbolLookup | None = None,
) -> dict[str, object]:
    """Pure assessment: command and file I/O outcomes are supplied by the shell.

    ⭐ The test-name verdict is a ***second, separate*** ruler. It is not folded into
    ``verdict`` on purpose: a draft can be "고유 산출" by symbols and "시험 이미 있음"
    by names at the same time, and collapsing them would hide that.
    ⛔ Omitting ``test_name_lookup`` keeps the older two-field shape for callers that
    have not been rewired; the test verdict is then reported as 판정 불가 rather than
    silently absent, so "안 쟀다" and "없다" stay distinguishable.
    """
    if test_name_lookup is None:
        test_fields: dict[str, object] = {"testVerdict": VERDICT_INDETERMINATE, "testNames": 0, "testNamesPresent": 0}
    else:
        test_fields = classify_test_names(diff, test_name_lookup)
    return {
        "applicability": classify_applicability(apply_result),
        **classify_symbols(diff, source_symbol_lookup),
        **test_fields,
    }


def default_runner(args: Sequence[str], input_text: str | None = None) -> CommandResult:
    try:
        completed = subprocess.run(args, input=input_text, text=True, capture_output=True, check=False)
    except OSError as error:
        return CommandResult(False, None, "", str(error))
    return CommandResult(True, completed.returncode, completed.stdout, completed.stderr)


def apply_check_args() -> tuple[str, ...]:
    return ("git", "apply", "--check")


def draft_list_args() -> tuple[str, ...]:
    return ("gh", "pr", "list", "--state", "open", "--draft", "--limit", "1000", "--json", "number,title")


def draft_diff_args(number: int) -> tuple[str, ...]:
    return ("gh", "pr", "diff", str(number), "--patch")


def source_symbol_lookup(symbol: str, root: Path | None = None) -> bool | None:
    """Read current non-test TypeScript sources, preserving unreadable-source uncertainty."""
    source_root = Path.cwd() if root is None else root
    read_failed = False
    for pattern in ("*.ts", "*.tsx"):
        for path in source_root.rglob(pattern):
            if any(part in {".git", "node_modules", ".monad-test"} for part in path.parts) or is_test_file(str(path.relative_to(source_root))):
                continue
            try:
                contents = path.read_text(encoding="utf-8")
            except OSError:
                read_failed = True
                continue
            if symbol in SOURCE_DECLARATION.findall(contents):
                return True
    return None if read_failed else False


# ⛔⭐ 한 번만 읽는다 — 이름마다 전 트리를 훑으면 O(이름 × 파일)이 되어 실물에서 «안 끝난다»
#   (2026-08-27 실측: 캐시 없이 열린 draft 24건이 2분을 넘겼다).
_TEST_CORPUS: dict[str, tuple[str, bool]] = {}


def _load_test_corpus(source_root: Path) -> tuple[str, bool]:
    """Read every test file once. Returns (joined text, whether any read failed)."""
    key = str(source_root)
    cached = _TEST_CORPUS.get(key)
    if cached is not None:
        return cached
    chunks: list[str] = []
    read_failed = False
    for pattern in ("*.ts", "*.tsx"):
        for path in source_root.rglob(pattern):
            if any(part in {".git", "node_modules", ".monad-test"} for part in path.parts):
                continue
            if not is_test_file(str(path.relative_to(source_root))):
                continue
            try:
                chunks.append(path.read_text(encoding="utf-8"))
            except OSError:
                read_failed = True
    value = ("\n".join(chunks), read_failed)
    _TEST_CORPUS[key] = value
    return value


def test_name_lookup(name: str, root: Path | None = None) -> bool | None:
    """Read current test files for a contract sentence, preserving read failures.

    ⛔ A substring match is deliberate: the title may be re-quoted or re-indented and
    it is still the same sentence. The cost is a false "present" when one title is a
    prefix of another; that is accepted because this ruler never closes anything on
    its own — it is one column of evidence a human reads.
    ⛔ A read failure yields None (판정 불가) only when the name is not found, so a
    definite hit is never downgraded by an unrelated unreadable file.
    """
    source_root = Path.cwd() if root is None else root
    corpus, read_failed = _load_test_corpus(source_root)
    if name in corpus:
        return True
    return None if read_failed else False


def _drafts(result: CommandResult) -> list[dict[str, object]] | None:
    if not result.started or result.returncode != 0:
        return None
    try:
        rows = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(rows, list):
        return None
    return [row for row in rows if isinstance(row, dict) and isinstance(row.get("number"), int)]


def sweep_open_drafts(
    run: CommandRunner = default_runner,
    lookup: SymbolLookup = source_symbol_lookup,
    test_lookup: SymbolLookup = test_name_lookup,
) -> list[dict[str, object]] | None:
    """Thin orchestration: gh obtains each patch, git checks it, pure code judges it."""
    drafts = _drafts(run(draft_list_args(), None))
    if drafts is None:
        return None
    assessments: list[dict[str, object]] = []
    for draft in drafts:
        number = int(draft["number"])
        patch = run(draft_diff_args(number), None)
        if not patch.started or patch.returncode != 0:
            assessments.append({
                "number": number, "applicability": VERDICT_INDETERMINATE, "verdict": VERDICT_INDETERMINATE,
                "symbols": [], "testVerdict": VERDICT_INDETERMINATE, "testNames": 0, "testNamesPresent": 0,
            })
            continue
        apply_result = run(apply_check_args(), patch.stdout)
        assessments.append({"number": number, **assess_draft(patch.stdout, lookup, apply_result, test_lookup)})
    return assessments


USAGE = """superseded-draft-sweep — 열린 draft 가 «이미 대체됐나»를 잰다 (측정 전용)

  python3 scripts/superseded-draft-sweep.py

옵션은 «없다». 한 줄에 한 draft 씩 JSON 을 낸다:
  number · applicability(얹힘 가능/얹히지 않음/판정 불가)
  verdict(대체 후보/부분 대체/고유 산출/판정 불가) · symbols
  testVerdict(시험 이미 있음/시험 부분 존재/고유 시험/판정 불가) · testNames · testNamesPresent

⛔ 이 도구는 «혼자서 아무것도 닫지 않는다» — 사람이 읽는 한 칸이다.
"""


def parse_args(argv: Sequence[str]) -> tuple[int | None, str]:
    """Reject unknown flags by name instead of swallowing them.

    ⛔ 2026-08-27 실측(🅕 33차): 이 도구가 ``--존재하지않는플래그`` 를 «거부 없이» 받고
    ***전수 실행***으로 갔다. 다음 사람이 ``--dry-run`` 이나 ``--limit`` 을 「있는 줄 알고」 치면
    그것이 전수 실행이 되고 그 사실이 «어디에도 안 남는다». 그래서 이름을 대고 거부한다.
    Returns (exit_code_or_None, message); None means "proceed".
    """
    for arg in argv:
        if arg in ("-h", "--help"):
            return 0, USAGE
        return 2, f"⛔ 모르는 인자다: {arg}\n이 도구는 옵션을 받지 않는다.\n\n{USAGE}"
    return None, ""


def main(
    run: CommandRunner = default_runner,
    lookup: SymbolLookup = source_symbol_lookup,
    test_lookup: SymbolLookup = test_name_lookup,
    argv: Sequence[str] | None = None,
) -> int:
    code, message = parse_args(sys.argv[1:] if argv is None else argv)
    if code is not None:
        print(message, file=sys.stdout if code == 0 else sys.stderr)
        return code
    assessments = sweep_open_drafts(run, lookup, test_lookup)
    if assessments is None:
        print("⛔ 열린 draft 목록을 못 얻었다 — 「0건」이 아니라 «못 셌음»이다", file=sys.stderr)
        return 2
    for assessment in assessments:
        print(json.dumps(assessment, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
