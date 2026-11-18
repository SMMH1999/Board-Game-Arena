"""Four-player rules and public observations for the strategy benchmark."""

from dataclasses import dataclass, field, replace
from itertools import combinations
from random import Random

from .scenarios import CARD_TEMPLATES, NOBLE_TEMPLATES, rotate

COLORS = ("C", "S", "E", "R", "O", "G")
GOLD = 5
TOKEN_LIMIT = 10
TARGET_SCORE = 15
PLAYER_COUNT = 4
TOKEN_SUPPLY = (7, 7, 7, 7, 7, 5)
EMPTY_TOKENS = (0,) * len(COLORS)
EMPTY_BONUSES = (0,) * GOLD


@dataclass(frozen=True)
class Card:
    id: str
    level: int
    bonus: int
    points: int
    cost: tuple[int, ...]


@dataclass(frozen=True)
class Noble:
    id: str
    cost: tuple[int, ...]


@dataclass(frozen=True)
class Action:
    kind: str
    card: str | None = None
    level: int | None = None
    take: tuple[int, ...] = ()
    give_back: tuple[int, ...] = ()
    payment: tuple[int, ...] = ()
    noble: str | None = None


@dataclass
class Player:
    tokens: tuple[int, ...] = EMPTY_TOKENS
    bonuses: tuple[int, ...] = EMPTY_BONUSES
    score: int = 0
    reserved: list[Card] = field(default_factory=list)
    purchased: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class PublicPlayer:
    tokens: tuple[int, ...]
    bonuses: tuple[int, ...]
    score: int
    purchased: int
    reserved_count: int


@dataclass(frozen=True)
class Observation:
    seat: int
    round: int
    bank: tuple[int, ...]
    players: tuple[PublicPlayer, ...]
    market: tuple[Card, ...]
    reserved: tuple[Card, ...]
    nobles: tuple[Noble, ...]
    deck_sizes: tuple[int, ...]
    final_round: bool
    recent: tuple[tuple[int, str, tuple[int, ...]], ...]


def purchasable_cards(view):
    return view.market + view.reserved


def due_cost(card, bonuses):
    return tuple(max(0, cost - bonus) for cost, bonus in zip(card.cost, bonuses))


def deficit(due, tokens):
    return max(0, sum(max(0, need - have) for need, have in zip(due, tokens)) - tokens[GOLD])


def payments(due, tokens):
    color_payment = tuple(min(need, have) for need, have in zip(due, tokens))
    gold = sum(due) - sum(color_payment)
    if gold > tokens[GOLD]:
        return
    yield (*color_payment, gold)
    # Voluntary wild substitution can preserve a useful colored token.
    remaining_gold = tokens[GOLD] - gold
    for count in range(1, remaining_gold + 1):
        for substitutions in token_returns(color_payment, count):
            paid = list(color_payment)
            for color in substitutions:
                paid[color] -= 1
            yield (*paid, gold + count)


def token_returns(tokens, count, start=0):
    if count == 0:
        yield ()
        return
    for color in range(start, len(tokens)):
        if tokens[color]:
            left = list(tokens)
            left[color] -= 1
            for rest in token_returns(left, count - 1, color):
                yield (color, *rest)


def holdings_after(tokens, action):
    updated = list(tokens)
    for color in action.take:
        updated[color] += 1
    for color in action.give_back:
        updated[color] -= 1
    for color, amount in enumerate(action.payment):
        updated[color] -= amount
    return tuple(updated)


def eligible_nobles(nobles, bonuses):
    return tuple(noble.id for noble in nobles
                 if all(have >= need for have, need in zip(bonuses, noble.cost)))


def bonuses_after(bonuses, card):
    updated = list(bonuses)
    updated[card.bonus] += 1
    return tuple(updated)


def legal_actions(view):
    player = view.players[view.seat]
    common_nobles = eligible_nobles(view.nobles, player.bonuses) or (None,)
    actions = []
    for card in purchasable_cards(view):
        next_bonuses = bonuses_after(player.bonuses, card)
        nobles = eligible_nobles(view.nobles, next_bonuses) or (None,)
        for payment in payments(due_cost(card, player.bonuses), player.tokens):
            actions.extend(Action("buy", card=card.id, payment=payment, noble=noble) for noble in nobles)

    available = tuple(color for color in range(GOLD) if view.bank[color])
    draws = [(color, color) for color in available if view.bank[color] >= 4]
    if available:
        draws.extend(combinations(available, min(len(available), 3)))
    for draw in draws:
        actions.extend(_with_returns(Action("take", take=draw), player.tokens, common_nobles))

    if player.reserved_count < 3:
        gold = (GOLD,) if view.bank[GOLD] else ()
        reserves = [Action("reserve", card=card.id, take=gold) for card in view.market]
        reserves.extend(Action("reserve_blind", level=level, take=gold)
                        for level, size in enumerate(view.deck_sizes, start=1) if size)
        for action in reserves:
            actions.extend(_with_returns(action, player.tokens, common_nobles))
    return tuple(actions or [Action("pass", noble=noble) for noble in common_nobles])


def _with_returns(action, tokens, nobles):
    updated = holdings_after(tokens, action)
    excess = max(0, sum(updated) - TOKEN_LIMIT)
    for returned in token_returns(updated, excess):
        for noble in nobles:
            yield replace(action, give_back=returned, noble=noble)


class Game:
    def __init__(self, seed):
        rng = Random(seed)
        self.decks = [
            [
                Card(f"card_{level * 100 + index * GOLD + color}", level, color, points, rotate(cost, color))
                for index, (points, cost) in enumerate(templates) for color in range(GOLD)
            ]
            for level, templates in enumerate(CARD_TEMPLATES, start=1)
        ]
        self.market = []
        for deck in self.decks:
            rng.shuffle(deck)
            self.market.append([deck.pop() for _ in range(4)])
        all_nobles = [
            Noble(f"noble_{index * GOLD + color}", rotate(cost, color))
            for index, cost in enumerate(NOBLE_TEMPLATES) for color in range(GOLD)
        ]
        self.nobles = rng.sample(all_nobles, PLAYER_COUNT + 1)
        self.players = [Player() for _ in range(PLAYER_COUNT)]
        self.bank = TOKEN_SUPPLY
        self.round = 1
        self.seat = 0
        self.completed_rounds = 0
        self.trigger = None
        self.finished = False
        self.recent = []

    def observe(self):
        return Observation(
            self.seat, self.round, self.bank,
            tuple(PublicPlayer(p.tokens, p.bonuses, p.score, len(p.purchased), len(p.reserved))
                  for p in self.players),
            tuple(card for row in self.market for card in row),
            tuple(self.players[self.seat].reserved), tuple(self.nobles),
            tuple(map(len, self.decks)), self.trigger is not None, tuple(self.recent[-36:]),
        )

    def play(self, action):
        if self.finished or action not in legal_actions(self.observe()):
            raise ValueError(f"Illegal action for seat {self.seat}: {action}")
        player = self.players[self.seat]
        next_tokens = holdings_after(player.tokens, action)
        self.bank = tuple(bank + before - after
                          for bank, before, after in zip(self.bank, player.tokens, next_tokens))
        player.tokens = next_tokens
        removed = replacement = None
        if action.card:
            removed, replacement = self._remove_card(player, action.card)
        if action.kind == "buy":
            player.bonuses = bonuses_after(player.bonuses, removed)
            player.purchased.append(removed.id)
            player.score += removed.points
        if action.kind == "reserve":
            player.reserved.append(removed)
        if action.kind == "reserve_blind":
            removed = self.decks[action.level - 1].pop()
            player.reserved.append(removed)
        if action.noble:
            self.nobles = [noble for noble in self.nobles if noble.id != action.noble]
            player.score += 3
        if player.score >= TARGET_SCORE and self.trigger is None:
            self.trigger = {"round": self.round, "seat": self.seat, "score": player.score}
        self.recent.append((self.seat, action.kind, action.take if action.kind == "take" else ()))
        self.seat = (self.seat + 1) % PLAYER_COUNT
        if self.seat == 0:
            self.completed_rounds = self.round
            self.finished = self.trigger is not None
            self.round += 1
        return {
            "card_revealed": replacement.id if replacement else None,
            "card_reserved_blind": removed.id if action.kind == "reserve_blind" else None,
            "scores": [p.score for p in self.players],
        }

    def _remove_card(self, player, card_id):
        for index, card in enumerate(player.reserved):
            if card.id == card_id:
                return player.reserved.pop(index), None
        for row, deck in zip(self.market, self.decks):
            for index, card in enumerate(row):
                if card.id == card_id:
                    row.pop(index)
                    replacement = deck.pop() if deck else None
                    if replacement:
                        row.insert(index, replacement)
                    return card, replacement
        raise RuntimeError(f"Legal card {card_id} disappeared")

    def winners(self):
        if not self.finished:
            return []
        ranks = [(player.score, -len(player.purchased)) for player in self.players]
        best = max(ranks)
        return [seat for seat, rank in enumerate(ranks) if rank == best]
