"""Run from the repository root with python -m simulator."""

import argparse
import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

from .game import COLORS, TARGET_SCORE
from .strategies import EXTENSION, POLICIES, POLICY_ORDER, load_policy
from .tournament import MIN_MATCHES, decision_trees, play_tournament, summarize


def _parser():
    parser = argparse.ArgumentParser(description="Evaluate four Splendor policies on complete local matches.")
    parser.add_argument("--games", type=int, default=MIN_MATCHES, help="matches to schedule (minimum: 100)")
    parser.add_argument("--workers", type=int, default=min(8, getattr(os, "process_cpu_count", os.cpu_count)() or 1))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--max-rounds", type=int, default=100, help="cap per match, with capped games marked unfinished")
    parser.add_argument("--candidate", type=Path, help="JSON with the candidate's name and policy weights")
    parser.add_argument("--replace", choices=POLICY_ORDER, help="strategy to replace with the candidate (default: engine)")
    parser.add_argument("--require-pass", metavar="STRATEGY", help="exit 1 unless this strategy qualifies")
    parser.add_argument("--output", type=Path, default=Path("simulator/reports/latest"), help="new report directory")
    return parser


def _sources():
    root = Path(__file__).resolve().parent.parent
    paths = sorted([*Path(__file__).parent.resolve().glob("*.py"),
                    root / "simulator/extension_bridge.cjs",
                    root / "splendor-reader/advice.js", root / "splendor-reader/forecast.js"])
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def _write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _markdown(summary, matches):
    lines = [
        "# Splendor benchmark", "",
        f"Completed {summary['completed_matches']}/{summary['matches']} matches. "
        f"Rounds per match ranged from {summary['rounds']['minimum']} to {summary['rounds']['maximum']} "
        f"(mean {summary['rounds']['mean']:.2f}).", "",
        "| Strategy | Sole wins | Shared wins | Win rate | Fallback turns | Promotion gate |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for name, stats in summary["strategies"].items():
        safe_name = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "&#124;")
        gate = "Pass" if stats["passed"] else "Fail"
        lines.append(f"| {safe_name} | {stats['wins']} | {stats['shared_wins']} | "
                     f"{stats['win_rate']:.0%} | {stats['adapter_fallback_turns']} | {gate} |")
    lines.extend(["", "| Match | Rounds | Winner(s) |",
                  "| ---: | ---: | --- |"])
    for match in matches:
        winners = ", ".join(match["winners"]) or "Unfinished"
        safe_winners = winners.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "&#124;")
        lines.append(f"| {match['match']} | {match['rounds']} | {safe_winners} |")
    return "\n".join(lines) + "\n"


def _write_reports(output, summary, matches):
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        folder = Path(temporary) / "report"
        folder.mkdir()
        _write_json(folder / "summary.json", summary)
        _write_json(folder / "decision-trees.json", decision_trees(matches))
        (folder / "summary.md").write_text(_markdown(summary, matches), encoding="utf-8")
        with gzip.open(folder / "matches.jsonl.gz", "wt", encoding="utf-8", compresslevel=5) as handle:
            for match in matches:
                handle.write(json.dumps(match, ensure_ascii=False, separators=(",", ":")) + "\n")
        folder.rename(output)


def main():
    parser = _parser()
    args = parser.parse_args()
    if args.games < MIN_MATCHES or args.workers < 1 or args.max_rounds < 1:
        parser.error(f"Use at least {MIN_MATCHES} games and positive workers and max rounds.")
    if args.replace and not args.candidate:
        parser.error("--replace requires --candidate.")
    if args.output.exists() or args.output.is_symlink():
        parser.error(f"Output directory already exists: {args.output}")
    try:
        candidate = load_policy(args.candidate) if args.candidate else None
        replaced = args.replace or "engine"
        lineup = tuple(candidate if candidate and name == replaced else POLICIES.get(name, name)
                       for name in POLICY_ORDER)
        names = [policy if isinstance(policy, str) else policy.name for policy in lineup]
        if args.require_pass is not None and args.require_pass not in names:
            parser.error(f"Unknown gate strategy: {args.require_pass}. Choose from {', '.join(names)}.")
        if EXTENSION in lineup and not shutil.which("node"):
            parser.error("Install Node.js to run the extension strategy.")
        settings = {
            "seed": args.seed, "workers": min(args.workers, args.games), "max_rounds": args.max_rounds,
            "target_score": TARGET_SCORE, "colors": list(COLORS), "card_set": "benchmark-v1",
            "source_sha256": _sources(),
        }
        matches = play_tournament(lineup, args.games, args.workers, args.seed, args.max_rounds)
        summary = summarize(lineup, matches, settings)
        _write_reports(args.output, summary, matches)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"Simulation failed: {error}", file=sys.stderr)
        return 2

    print(f"Completed {summary['completed_matches']}/{summary['matches']} matches.")
    for name, stats in summary["strategies"].items():
        print(f"{name}: {stats['wins']} sole wins ({stats['win_rate']:.2%}), "
              f"{stats['shared_wins']} shared, {'PASS' if stats['passed'] else 'FAIL'}")
    print(f"Reports: {args.output}")
    return int(args.require_pass is not None and not summary["strategies"][args.require_pass]["passed"])


if __name__ == "__main__":
    sys.exit(main())
