import shutil
import unittest
from dataclasses import replace

from simulator.game import (
    EMPTY_BONUSES, EMPTY_TOKENS, GOLD, TOKEN_SUPPLY, Action, Card, Game, Noble,
    holdings_after, legal_actions, payments,
)
from simulator.strategies import EXTENSION, POLICIES, ExtensionPolicy
from simulator.tournament import play_tournament, summarize


class GameTests(unittest.TestCase):
    def test_final_round_continues_and_later_seat_can_win(self):
        game = Game(42)
        first = Card("first", 2, 0, 1, EMPTY_BONUSES)
        second = Card("second", 2, 1, 3, EMPTY_BONUSES)
        game.players[0].score = game.players[1].score = 14
        game.players[0].reserved.append(first)
        game.players[1].reserved.append(second)

        game.play(Action("buy", card=first.id, payment=EMPTY_TOKENS))
        self.assertTrue(game.observe().final_round)
        self.assertEqual(game.winners(), [])
        self.assertEqual(game.completed_rounds, 0)
        game.play(Action("buy", card=second.id, payment=EMPTY_TOKENS))
        for _ in range(2):
            game.play(next(action for action in legal_actions(game.observe()) if action.kind == "take"))

        self.assertEqual(game.trigger, {"round": 1, "seat": 0, "score": 15})
        self.assertEqual(game.completed_rounds, 1)
        self.assertEqual(game.winners(), [1])

    def test_fewer_developments_wins_tie_and_equal_developments_share_it(self):
        game = Game(1)
        game.finished = True
        game.players[0].score = game.players[1].score = 15
        game.players[1].purchased.append("development")
        self.assertEqual(game.winners(), [0])
        game.players[0].purchased.append("also-a-development")
        self.assertEqual(game.winners(), [0, 1])

    def test_token_limit_draw_rules_and_gold_payment(self):
        game = Game(9)
        game.players[0].tokens = (4, 3, 2, 1, 0, 0)
        game.bank = (3, 4, 5, 6, 7, 5)
        view = game.observe()
        draws = [action for action in legal_actions(view) if action.kind == "take"]
        self.assertFalse(any(action.take == (0, 0) for action in draws))
        self.assertTrue(any(action.take == (1, 1) for action in draws))
        self.assertTrue(all(sum(holdings_after(view.players[0].tokens, action)) == 10 for action in draws))
        game.play(draws[0])
        self.assertEqual(tuple(sum(p.tokens[c] for p in game.players) + game.bank[c] for c in range(6)),
                         TOKEN_SUPPLY)
        self.assertEqual(list(payments((2, 1, 0, 0, 0), (2, 0, 0, 0, 0, 2))),
                         [(2, 0, 0, 0, 0, 1), (1, 0, 0, 0, 0, 2)])

    def test_blind_reservation_and_noble_choice(self):
        game = Game(10)
        game.players[0].bonuses = (4, 4, 4, 0, 0)
        game.nobles = [Noble("a", (4, 4, 0, 0, 0)), Noble("b", (4, 0, 4, 0, 0))]
        level = 1
        view = game.observe()
        actions = [a for a in legal_actions(view) if a.kind == "reserve_blind" and a.level == level]
        self.assertEqual({action.noble for action in actions}, {"a", "b"})
        self.assertTrue(all(action.card is None and action.take == (GOLD,) for action in actions))
        result = game.play(actions[1])
        self.assertEqual(game.players[0].score, 3)
        self.assertEqual(len(game.nobles), 1)
        self.assertEqual(game.observe().players[0].reserved_count, 1)
        self.assertEqual(game.observe().reserved, ())
        self.assertEqual(game.players[0].reserved[0].id, result["card_reserved_blind"])


class TournamentTests(unittest.TestCase):
    lineup = tuple(POLICIES.values()) + (replace(POLICIES["engine"], name="candidate"),)

    def test_parallel_and_serial_schedule_are_identical(self):
        single = play_tournament(self.lineup, 100, 1, 16, 1)
        parallel = play_tournament(self.lineup, 100, 2, 16, 1)
        self.assertEqual(single, parallel)
        stats = summarize(self.lineup, parallel, {})
        self.assertEqual(stats["strategies"]["candidate"]["seat_counts"], [25] * 4)
        self.assertEqual(stats["completed_matches"], 0)
        self.assertFalse(stats["strategies"]["candidate"]["passed"])

    def test_promotion_threshold_and_fallback(self):
        def match(winners, completed=True, turns=()):
            return {"winners": winners, "completed": completed, "rounds": 22,
                    "seats": ["engine", "points", "nobles", "candidate"], "turns": turns}

        self.assertRaises(ValueError, play_tournament, self.lineup, 99, 1, 16, 1)
        matches = [match(["candidate"])] * 74 + [match(["engine"])] * 25
        summary = summarize(self.lineup, matches + [match(["candidate", "engine"])], {})
        self.assertFalse(summary["strategies"]["candidate"]["passed"])
        summary = summarize(self.lineup, matches + [match(["candidate"])], {})
        self.assertTrue(summary["strategies"]["candidate"]["passed"])
        summary = summarize(self.lineup, matches + [match([], completed=False)], {})
        self.assertIn("fewer_than_100_completed_matches", summary["strategies"]["candidate"]["reasons"])
        fallback = {"strategy": "candidate", "adapter_fallback": True}
        summary = summarize(self.lineup, matches + [match(["candidate"], turns=[fallback])], {})
        self.assertIn("adapter_used_fallback", summary["strategies"]["candidate"]["reasons"])

    @unittest.skipUnless(shutil.which("node"), "Node.js required for the browser policy")
    def test_extension_reads_simulated_observation(self):
        view = Game(42).observe()
        actions = legal_actions(view)
        self.assertNotIn(EXTENSION, POLICIES)
        with ExtensionPolicy() as adapter:
            decision, _ = adapter.choose(view, actions, None)
        self.assertIn(decision.action, actions)
        self.assertFalse(decision.adapter_fallback)


if __name__ == "__main__":
    unittest.main()
