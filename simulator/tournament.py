"""Reproducible parallel matches, decision traces, and promotion checks."""

from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from contextlib import ExitStack
from dataclasses import asdict
from math import ceil
from random import Random
from statistics import mean

from .game import PLAYER_COUNT, Game, legal_actions
from .strategies import EXTENSION, ExtensionPolicy, choose_weighted

MIN_MATCHES = 100
PASS_PERCENT = 75


def _play_match(job, lineup, extension, max_rounds):
    index, seed = job
    offset = index % PLAYER_COUNT
    seats = lineup[offset:] + lineup[:offset]
    names = [policy if isinstance(policy, str) else policy.name for policy in seats]
    game = Game(seed)
    turns = []
    preferred = None
    while game.completed_rounds < max_rounds and not game.finished:
        view = game.observe()
        policy = seats[view.seat]
        actions = legal_actions(view)
        if policy == EXTENSION:
            decision, preferred = extension.choose(view, actions, preferred)
        else:
            decision = choose_weighted(policy, view, actions)
        event = game.play(decision.action)
        turns.append({
            "round": view.round, "seat": view.seat, "strategy": names[view.seat],
            "action": asdict(decision.action), "phase": decision.phase, "reason": decision.reason,
            "adapter_fallback": decision.adapter_fallback, "alternatives": decision.alternatives,
            **event,
        })
    return {
        "match": index + 1, "seed": seed, "seats": names, "rounds": game.completed_rounds,
        "completed": game.finished, "threshold_trigger": game.trigger,
        "winners": [names[seat] for seat in game.winners()],
        "scores": {name: player.score for name, player in zip(names, game.players)},
        "purchased": {name: len(player.purchased) for name, player in zip(names, game.players)},
        "turns": turns,
    }


def _play_batch(batch, lineup, max_rounds):
    with ExitStack() as stack:
        extension = stack.enter_context(ExtensionPolicy()) if EXTENSION in lineup else None
        return [_play_match(job, lineup, extension, max_rounds) for job in batch]


def play_tournament(lineup, games, workers, seed, max_rounds):
    if games < MIN_MATCHES:
        raise ValueError(f"At least {MIN_MATCHES} matches are required.")
    if len(lineup) != PLAYER_COUNT or len({p if isinstance(p, str) else p.name for p in lineup}) != PLAYER_COUNT:
        raise ValueError("Choose four distinct strategies.")
    if workers < 1 or max_rounds < 1:
        raise ValueError("Workers and rounds must be positive.")
    rng = Random(seed)
    jobs = [(match, rng.getrandbits(64)) for match in range(games)]
    workers = min(workers, games)
    size = ceil(games / (workers * 3))
    batches = [jobs[start:start + size] for start in range(0, games, size)]
    if workers == 1:
        return _play_batch(jobs, lineup, max_rounds)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = [pool.submit(_play_batch, batch, lineup, max_rounds) for batch in batches]
        return [match for batch in results for match in batch.result()]


def summarize(lineup, matches, settings):
    names = [policy if isinstance(policy, str) else policy.name for policy in lineup]
    completed = sum(match["completed"] for match in matches)
    wins = Counter(match["winners"][0] for match in matches if len(match["winners"]) == 1)
    shared = Counter(name for match in matches if len(match["winners"]) > 1 for name in match["winners"])
    fallbacks = Counter(
        turn["strategy"] for match in matches for turn in match["turns"] if turn["adapter_fallback"]
    )
    required_wins = (PASS_PERCENT * len(matches) + 99) // 100
    strategies = {}
    for name in names:
        failures = []
        if completed < MIN_MATCHES:
            failures.append("fewer_than_100_completed_matches")
        if wins[name] < required_wins:
            failures.append("win_rate_below_75_percent")
        if fallbacks[name]:
            failures.append("adapter_used_fallback")
        strategies[name] = {
            "wins": wins[name], "shared_wins": shared[name],
            "win_rate": wins[name] / len(matches),
            "adapter_fallback_turns": fallbacks[name],
            "passed": not failures, "reasons": failures,
            "seat_counts": [sum(match["seats"][seat] == name for match in matches) for seat in range(PLAYER_COUNT)],
        }
    return {
        "settings": settings,
        "policies": [policy if isinstance(policy, str) else asdict(policy) for policy in lineup],
        "matches": len(matches), "completed_matches": completed,
        "unfinished_matches": len(matches) - completed, "tied_matches": sum(len(m["winners"]) > 1 for m in matches),
        "gate": {"minimum_completed_matches": MIN_MATCHES, "required_win_rate": PASS_PERCENT / 100,
                 "required_wins": required_wins, "win_rate_denominator": len(matches)},
        "rounds": {
            "minimum": min(m["rounds"] for m in matches), "maximum": max(m["rounds"] for m in matches),
            "mean": mean(m["rounds"] for m in matches),
        },
        "strategies": strategies,
    }


def decision_trees(matches):
    trees = {}

    def visit(node, label, won):
        child = node.setdefault(label, {"decisions": 0, "decisions_in_sole_wins": 0, "children": {}})
        child["decisions"] += 1
        child["decisions_in_sole_wins"] += won
        return child["children"]

    for match in matches:
        for turn in match["turns"]:
            strategy = turn["strategy"]
            won = match["winners"] == [strategy]
            node = visit(trees, strategy, won)
            node = visit(node, turn["phase"], won)
            node = visit(node, turn["reason"], won)
            visit(node, turn["action"]["kind"], won)
    return trees
