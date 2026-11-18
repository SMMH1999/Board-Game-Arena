"""Three Python policies, configurable candidate weights, and an extension adapter."""

import json
import math
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

from .game import (
    COLORS, GOLD, TARGET_SCORE, Action, bonuses_after, deficit, due_cost, holdings_after,
    purchasable_cards,
)

EXTENSION = "extension"
POLICY_ORDER = ("extension", "engine", "points", "nobles")


@dataclass(frozen=True)
class Policy:
    name: str
    points: float
    economy: float
    noble: float
    reserve: float


POLICIES = {
    "engine": Policy("engine", points=1.25, economy=2.35, noble=0.75, reserve=0.7),
    "points": Policy("points", points=2.65, economy=0.65, noble=0.25, reserve=1.0),
    "nobles": Policy("nobles", points=1.25, economy=1.1, noble=3.5, reserve=0.65),
}


@dataclass(frozen=True)
class Decision:
    action: Action
    phase: str
    reason: str
    alternatives: list
    adapter_fallback: bool = False


def load_policy(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    fields = {"points", "economy", "noble", "reserve"}
    if not isinstance(data, dict) or set(data) != {"name", "weights"}:
        raise ValueError("A candidate needs exactly 'name' and 'weights'.")
    name = data["name"]
    weights = data["weights"]
    if (not isinstance(name, str) or not name.isprintable() or not name.strip() or name != name.strip()
            or len(name) > 64 or name in POLICY_ORDER):
        raise ValueError("The candidate needs a unique name of 1–64 characters.")
    if not isinstance(weights, dict) or set(weights) != fields:
        raise ValueError(f"Candidate weights must be {', '.join(sorted(fields))}.")
    if any(type(value) not in (int, float) or not 0 <= value <= 20
           or not math.isfinite(value) for value in weights.values()):
        raise ValueError("Candidate weights must be finite numbers between 0 and 20.")
    return Policy(name, **weights)


def phase_of(view):
    if view.final_round:
        return "final_round"
    if max(player.score for player in view.players) >= 12:
        return "endgame"
    if view.round <= 7:
        return "opening"
    return "midgame"


def _noble_progress(nobles, bonuses):
    distances = sorted(sum(max(0, need - have) for need, have in zip(noble.cost, bonuses))
                       for noble in nobles)
    return sum(weight / (1 + distance) for distance, weight in zip(distances, (1, 0.25)))


def _action_summary(action, score, reason):
    return {"action": asdict(action), "score": round(score, 5), "reason": reason}


def choose_weighted(policy, view, actions):
    player = view.players[view.seat]
    rival_score = max(p.score for seat, p in enumerate(view.players) if seat != view.seat)
    phase = phase_of(view)
    late = phase in ("endgame", "final_round")
    points_weight = policy.points * (1.6 if late else 1)
    economy_weight = policy.economy * (0.3 if late else 1)
    noble_base = _noble_progress(view.nobles, player.bonuses)
    targets = {}
    for card in purchasable_cards(view):
        due = due_cost(card, player.bonuses)
        if sum(due) > 10:
            continue
        bonuses = bonuses_after(player.bonuses, card)
        noble_gain = _noble_progress(view.nobles, bonuses) - noble_base
        economy = economy_weight * (1 + 0.12 * sum(c.cost[card.bonus] > 0 for c in view.market))
        value = 0.5 + points_weight * card.points + economy + policy.noble * noble_gain * 8
        gap = deficit(due, player.tokens)
        targets[card.id] = (card, due, value, gap, economy, noble_gain)
    intentions = sorted(targets.values(), key=lambda t: t[2] / (1 + t[3] * 0.7))[:6]

    def potential(tokens):
        best = second = 0.0
        for _, due, value, _, _, _ in intentions:
            score = value / (1 + deficit(due, tokens) * 0.85)
            if score > best:
                best, second = score, best
            elif score > second:
                second = score
        return best + second * 0.22

    current_potential = potential(player.tokens)
    token_scores = {}

    def token_score(tokens):
        if tokens not in token_scores:
            token_scores[tokens] = (
                potential(tokens) - current_potential
                + (sum(tokens) - sum(player.tokens)) * 0.21
                + (tokens[GOLD] - player.tokens[GOLD]) * 0.32
            )
        return token_scores[tokens]

    ranked = []
    for action in actions:
        tokens = holdings_after(player.tokens, action)
        noble_points = 3 if action.noble else 0
        score, reason = -10.0, "pass"
        if action.kind == "buy":
            card, _, _, _, economy, noble_gain = targets[action.card]
            immediate = card.points + noble_points
            # Buying can beat or secure the target even when several seats are still to play.
            finishes = immediate > 0 and player.score + immediate >= max(TARGET_SCORE, rival_score)
            score = (
                1.5 + immediate * points_weight + economy
                + (policy.noble * noble_gain * 8 if not action.noble else 0)
                + sum(action.payment) * 0.04 + tokens[GOLD] * 0.18
            )
            reason = "reach_victory_threshold" if finishes else (
                "claim_noble" if action.noble else ("score_prestige" if card.points else "build_discounts")
            )
            if finishes:
                score += 100 + immediate
        elif action.kind == "take":
            score = token_score(tokens) - 0.35 * (tokens == player.tokens)
            reason = "fund_purchase" if tokens != player.tokens else "exchange_without_gain"
        elif action.kind == "reserve":
            target = targets.get(action.card)
            score = token_score(tokens) - 1.1 - player.reserved_count * 0.6
            if target is not None:
                _, _, value, gap, _, _ = target
                if gap:
                    score += policy.reserve * value / (1.7 + gap * 0.7)
            reason = "secure_target"
        elif action.kind == "reserve_blind":
            score = token_score(tokens) - 1.6 - player.reserved_count * 0.6
            reason = "draw_hidden_reservation"
        if action.noble and action.kind != "buy":
            score += noble_points * points_weight
            reason = "claim_noble"
        ranked.append((score, action, reason))

    ranked.sort(key=lambda option: option[0], reverse=True)
    _, action, reason = ranked[0]
    return Decision(action, phase, reason,
                    [_action_summary(move, value, why) for value, move, why in ranked[:3]])


def _color_map(values):
    return dict(zip(COLORS, values))


def _snapshot(view):
    players = [
        {"id": str(seat), "score": player.score, "tokens": _color_map(player.tokens),
         "discounts": _color_map(player.bonuses) | {"G": 0}}
        for seat, player in enumerate(view.players)
    ]
    counters = {
        "spl_playerboard_gemcount": f"{sum(view.players[view.seat].tokens)}/10",
        "spl_playerreserve_count": f"{len(view.reserved)}/3",
        **{f"coincounter_{COLORS[i]}": str(total) for i, total in enumerate(view.bank)},
        **{f"drawpile_counter_{i}": str(size) for i, size in enumerate(view.deck_sizes, start=1)},
    }
    return {
        "graphics": [],
        "localPlayerId": str(view.seat),
        "players": players,
        "counters": [{"elementId": key, "text": value} for key, value in counters.items()],
        "rivalOrder": [str((view.seat + offset) % len(players)) for offset in range(1, len(players))],
        "gameState": {
            "players": players,
            "cards": [
                {"id": card.id, "level": card.level, "bonus": COLORS[card.bonus],
                 "points": card.points, "reserved": card in view.reserved,
                 "cost": {color: cost for color, cost in _color_map(card.cost).items() if cost}}
                for card in purchasable_cards(view)
            ],
            "nobles": [{"id": noble.id, "cost": _color_map(noble.cost), "points": 3} for noble in view.nobles],
            "events": [
                {"playerId": str(seat), "action": {"take": "gets", "buy": "buys",
                 "reserve": "reserves", "reserve_blind": "reserves", "pass": "passes"}[kind],
                 "icons": [{"kind": "token", "color": COLORS[color]} for color in taken]}
                for seat, kind, taken in view.recent
            ],
        },
    }


def _token_indices(colors):
    return tuple(sorted(COLORS.index(color) for color in colors))


class ExtensionPolicy:
    def __enter__(self):
        self.process = subprocess.Popen(
            ["node", str(Path(__file__).with_name("extension_bridge.cjs"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8",
        )
        return self

    def __exit__(self, *exc):
        self.process.stdin.close()
        self.process.stdout.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

    def choose(self, view, actions, preferred_target):
        self.process.stdin.write(json.dumps({"snapshot": _snapshot(view), "preferred": preferred_target}) + "\n")
        self.process.stdin.flush()
        response = self.process.stdout.readline()
        if not response:
            raise RuntimeError("The Node.js extension strategy process exited without a response.")
        payload = json.loads(response)
        if "error" in payload:
            raise RuntimeError(f"Extension strategy failed: {payload['error']}")
        advice = payload["advice"] or {}
        primary = advice.get("primary")
        choice = advice.get(primary) or {}
        expected_returns = _token_indices(choice.get("returned", []))
        selected = []
        if primary == "buy":
            selected = [action for action in actions if action.kind == "buy" and action.card == choice["id"]]
        elif primary == "take":
            selected = [
                action for action in actions if action.kind == "take"
                and action.take == _token_indices(choice["tokens"])
                and action.give_back == expected_returns
            ]
        elif primary == "reserve":
            card = choice["id"]
            selected = [
                action for action in actions
                if (action.kind == "reserve" and action.card == card
                    or action.kind == "reserve_blind" and card == f"drawpile{action.level}")
                and action.give_back == expected_returns
            ]

        alternatives = [
            {"kind": kind, "card": option.get("id"), "score": option.get("score"),
             "tokens": option.get("tokens"), "returned": option.get("returned"),
             "paths": option.get("plan", [])}
            for kind in ("buy", "take", "reserve") if (option := advice.get(kind))
        ]
        if selected:
            # The browser recommends the purchase; its scoring assumes minimum gold.
            action = min(selected, key=lambda move: move.payment[GOLD] if move.payment else 0)
            decision = Decision(action, phase_of(view), f"extension_{primary}", alternatives)
        else:
            fallback = choose_weighted(POLICIES["engine"], view, actions)
            decision = Decision(fallback.action, fallback.phase, "extension_fallback",
                                alternatives + fallback.alternatives, adapter_fallback=True)
        paths = advice.get("paths") or []
        return decision, paths[0]["id"] if paths else preferred_target
