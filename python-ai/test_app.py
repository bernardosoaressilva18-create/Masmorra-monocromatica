import json
import math
import unittest

from app import AI_VERSION, MAX_CANDIDATES, app


class TacticalAITests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        self.base_monster = {"id": "monster-1", "x": 0, "z": 0, "kind": "stalker"}

    def post_target(self, candidates, **extra):
        payload = {"monster": self.base_monster, "candidates": candidates}
        payload.update(extra)
        return self.client.post("/target", json=payload)

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        self.assertEqual(response.get_json()["version"], AI_VERSION)

    def test_ready_endpoint(self):
        response = self.client.get("/ready")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ready"])

    def test_health_headers_are_no_store_and_versioned(self):
        response = self.client.get("/health")
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(response.headers.get("X-AI-Version"), AI_VERSION)
        self.assertTrue(response.headers.get("X-Request-ID"))

    def test_caller_request_id_is_propagated(self):
        response = self.client.get("/health", headers={"X-Request-ID": "test-trace-123"})
        self.assertEqual(response.headers.get("X-Request-ID"), "test-trace-123")

    def test_nearest_low_health_target(self):
        response = self.post_target([
            {"id": "far", "x": 20, "z": 0, "health": 100},
            {"id": "near", "x": 2, "z": 0, "health": 40},
        ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["targetId"], "near")

    def test_empty_candidates(self):
        response = self.post_target([])
        self.assertIsNone(response.get_json()["targetId"])
        self.assertEqual(response.get_json()["reason"], "no_valid_candidates")

    def test_non_object_json_is_rejected(self):
        response = self.client.post("/target", data='["not","object"]', content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_missing_required_fields_are_rejected(self):
        response = self.client.post("/target", json={"monster": {}})
        self.assertEqual(response.status_code, 400)

    def test_invalid_monster_position_is_rejected(self):
        response = self.client.post("/target", json={
            "monster": {"x": "nan", "z": 0}, "candidates": []
        })
        self.assertEqual(response.status_code, 400)

    def test_extreme_monster_position_is_rejected(self):
        response = self.client.post("/target", json={
            "monster": {"x": 1e30, "z": 0}, "candidates": []
        })
        self.assertEqual(response.status_code, 400)

    def test_invalid_candidate_is_ignored(self):
        response = self.post_target([{"id": "bad", "x": "not-a-number", "z": 0}])
        self.assertIsNone(response.get_json()["targetId"])
        self.assertEqual(response.get_json()["skippedCandidateCount"], 1)

    def test_nan_candidate_is_ignored(self):
        response = self.post_target([{"id": "bad", "x": float("nan"), "z": 0}])
        self.assertIsNone(response.get_json()["targetId"])

    def test_dead_invisible_hidden_and_expired_candidates_are_ignored(self):
        response = self.post_target([
            {"id": "dead", "x": 0, "z": 0, "health": 0},
            {"id": "invisible", "x": 0, "z": 0, "invisible": True},
            {"id": "hidden", "x": 0, "z": 0, "visible": False},
            {"id": "expired", "x": 0, "z": 0, "expired": True},
            {"id": "alive", "x": 5, "z": 0, "health": 100},
        ])
        self.assertEqual(response.get_json()["targetId"], "alive")
        self.assertEqual(response.get_json()["candidateCount"], 1)

    def test_candidate_limit(self):
        response = self.post_target([
            {"id": str(i), "x": i, "z": 0} for i in range(MAX_CANDIDATES + 1)
        ])
        self.assertEqual(response.status_code, 413)

    def test_candidate_coordinates_must_be_bounded(self):
        response = self.post_target([{"id": "wild", "x": 1e20, "z": 0}])
        self.assertIsNone(response.get_json()["targetId"])

    def test_duplicate_ids_keep_the_best_candidate_record(self):
        response = self.post_target([
            {"id": "same", "x": 20, "z": 0, "health": 100},
            {"id": "same", "x": 2, "z": 0, "health": 100},
        ])
        body = response.get_json()
        self.assertEqual(body["targetId"], "same")
        self.assertEqual(body["distance"], 2.0)
        self.assertEqual(body["candidateCount"], 1)
        self.assertEqual(body["skippedCandidateCount"], 1)

    def test_previous_target_stability(self):
        response = self.post_target([
            {"id": "old", "x": 3, "z": 0, "health": 100},
            {"id": "new", "x": 2.5, "z": 0, "health": 100},
        ], previousTargetId="old")
        self.assertEqual(response.get_json()["targetId"], "old")
        self.assertIn("target_stability", response.get_json()["reasons"])

    def test_healers_are_preferred_over_equal_distance_players(self):
        response = self.post_target([
            {"id": "knight", "x": 5, "z": 0, "health": 100, "maxHealth": 100, "role": "knight"},
            {"id": "healer", "x": 5, "z": 0, "health": 100, "maxHealth": 100, "role": "healer"},
        ])
        self.assertEqual(response.get_json()["targetId"], "healer")
        self.assertIn("support_priority", response.get_json()["reasons"])

    def test_player_class_is_used_as_role_fallback(self):
        response = self.post_target([
            {"id": "mage", "x": 5, "z": 0, "playerClass": "mage"},
            {"id": "knight", "x": 5, "z": 0, "playerClass": "knight"},
        ])
        self.assertEqual(response.get_json()["targetId"], "mage")
        self.assertEqual(response.get_json()["targetRole"], "mage")

    def test_threat_affects_score(self):
        response = self.post_target([
            {"id": "quiet", "x": 4, "z": 0, "threat": 0},
            {"id": "threat", "x": 4.2, "z": 0, "threat": 100},
        ])
        self.assertEqual(response.get_json()["targetId"], "threat")
        self.assertIn("high_threat", response.get_json()["reasons"])

    def test_summon_metadata_and_target_type_are_returned(self):
        response = self.post_target([
            {"id": "summon-1", "x": 2, "z": 0, "health": 20, "maxHealth": 100, "isSummon": True},
            {"id": "player-1", "x": 2, "z": 0, "health": 100, "maxHealth": 100},
        ])
        self.assertEqual(response.get_json()["targetId"], "summon-1")
        self.assertIn("summon_distraction", response.get_json()["reasons"])

    def test_wraith_prefers_backline_role(self):
        response = self.client.post("/target", json={
            "monster": {**self.base_monster, "kind": "wraith"},
            "candidates": [
                {"id": "knight", "x": 4, "z": 0, "role": "knight"},
                {"id": "archer", "x": 4, "z": 0, "role": "archer"},
            ],
        })
        self.assertEqual(response.get_json()["targetId"], "archer")
        self.assertIn("flanker_prefers_backline", response.get_json()["reasons"])

    def test_assassin_prefers_healer_backline(self):
        response = self.client.post("/target", json={
            "monster": {**self.base_monster, "kind": "assassin", "aggression": 1.4},
            "candidates": [
                {"id": "knight", "x": 3, "z": 0, "role": "knight"},
                {"id": "healer", "x": 3, "z": 0, "role": "healer"},
            ],
        })
        body = response.get_json()
        self.assertEqual(body["targetId"], "healer")
        self.assertIn("flanker_prefers_backline", body["reasons"])

    def test_recent_damage_decays_but_stays_finite(self):
        response = self.post_target([
            {"id": "attacker", "x": 2, "z": 0, "recentDamage": 24},
        ])
        body = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(math.isfinite(body["score"]))
        self.assertIn("recent_attacker", body["reasons"])

    def test_alternatives_are_limited_to_three(self):
        response = self.post_target([
            {"id": str(i), "x": i + 1, "z": 0} for i in range(7)
        ])
        self.assertEqual(len(response.get_json()["alternatives"]), 3)

    def test_invalid_items_do_not_break_a_valid_batch(self):
        response = self.post_target([
            None, "broken", {}, {"id": "alive", "x": 3, "z": 0}
        ])
        self.assertEqual(response.get_json()["targetId"], "alive")

    def test_metrics_exposes_aggregates_not_player_ids(self):
        self.post_target([{"id": "private-player-id", "x": 1, "z": 0}])
        response = self.client.get("/metrics")
        self.assertEqual(response.status_code, 200)
        body = json.dumps(response.get_json())
        self.assertIn("target_decisions", body)
        self.assertNotIn("private-player-id", body)

    def test_content_type_and_version_headers_for_errors(self):
        response = self.client.post("/target", data="{}", content_type="text/plain")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.headers.get("X-AI-Version"), AI_VERSION)
        self.assertIn("application/json", response.content_type)



    def test_attack_range_and_far_target_reason_are_reported(self):
        response = self.client.post("/target", json={
            "monster": {**self.base_monster, "attackRange": 2},
            "candidates": [
                {"id": "near", "x": 1, "z": 0},
                {"id": "far", "x": 20, "z": 0},
            ],
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["targetId"], "near")
        self.assertIn("in_attack_range", response.get_json()["reasons"])
        self.assertGreaterEqual(response.get_json()["decisionConfidence"], 0)

    def test_recent_attacker_can_be_prioritized(self):
        response = self.client.post("/target", json={
            "monster": self.base_monster,
            "candidates": [
                {"id": "quiet", "x": 3, "z": 0, "threat": 0},
                {"id": "attacker", "x": 3.5, "z": 0, "recentDamage": 30, "threat": 20},
            ],
        })
        self.assertEqual(response.get_json()["targetId"], "attacker")
        self.assertIn("recent_attacker", response.get_json()["reasons"])

    def test_shielded_candidate_is_valid_but_less_preferred(self):
        response = self.client.post("/target", json={
            "monster": self.base_monster,
            "candidates": [
                {"id": "shielded", "x": 2, "z": 0, "shielded": True},
                {"id": "open", "x": 2, "z": 0},
            ],
        })
        self.assertEqual(response.get_json()["targetId"], "open")

    def test_aggression_is_bounded_and_never_returns_non_finite_score(self):
        response = self.client.post("/target", json={
            "monster": {**self.base_monster, "aggression": 999999},
            "candidates": [{"id": "target", "x": 1, "z": 0, "threat": 100}],
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(math.isfinite(response.get_json()["score"]))

if __name__ == "__main__":
    unittest.main()
