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


    def test_accented_portuguese_role_aliases(self):
        response = self.post_target([
            {"id": "knight", "x": 4, "z": 0, "role": "CAVALEIRO"},
            {"id": "healer", "x": 4, "z": 0, "role": "Curandeiro"},
        ])
        self.assertEqual(response.get_json()["targetId"], "healer")
        self.assertEqual(response.get_json()["targetRole"], "healer")

    def test_monge_role_is_normalized(self):
        response = self.post_target([{"id": "monk", "x": 1, "z": 0, "playerClass": "Monge"}])
        self.assertEqual(response.get_json()["targetRole"], "monk")

    def test_dead_disconnected_and_eliminated_candidates_are_ignored(self):
        response = self.post_target([
            {"id": "dead", "x": 1, "z": 0, "dead": True},
            {"id": "disconnected", "x": 1, "z": 0, "connected": False},
            {"id": "locked", "x": 1, "z": 0, "deathLocked": True},
            {"id": "eliminated", "x": 1, "z": 0, "eliminated": True},
            {"id": "alive", "x": 4, "z": 0, "alive": True},
        ])
        body = response.get_json()
        self.assertEqual(body["targetId"], "alive")
        self.assertEqual(body["candidateCount"], 1)
        self.assertEqual(body["skippedCandidateCount"], 4)

    def test_string_false_is_not_treated_as_true(self):
        response = self.post_target([{
            "id": "ordinary", "x": 1, "z": 0, "isSummon": "false",
            "shielded": "false", "visible": "true", "alive": "true",
        }])
        body = response.get_json()
        self.assertEqual(body["targetId"], "ordinary")
        self.assertNotIn("summon_distraction", body["reasons"])
        self.assertNotIn("shielded_target", body["reasons"])

    def test_invisible_until_timestamp_is_respected(self):
        now_ms = 1_800_000_000_000
        response = self.client.post("/target", json={
            "monster": self.base_monster,
            "nowMs": now_ms,
            "candidates": [
                {"id": "hidden", "x": 1, "z": 0, "invisibleUntil": now_ms + 5000},
                {"id": "visible", "x": 4, "z": 0},
            ],
        })
        self.assertEqual(response.get_json()["targetId"], "visible")
        self.assertEqual(response.get_json()["skippedCandidateCount"], 1)

    def test_future_expiration_timestamp_is_respected(self):
        now_ms = 1_800_000_000_000
        response = self.client.post("/target", json={
            "monster": self.base_monster,
            "nowMs": now_ms,
            "candidates": [
                {"id": "temporary-expired-later", "x": 1, "z": 0, "expiresAt": now_ms + 5000},
                {"id": "persistent", "x": 3, "z": 0},
            ],
        })
        self.assertEqual(response.get_json()["targetId"], "persistent")

    def test_seconds_timestamps_are_accepted(self):
        now_seconds = 1_800_000_000
        response = self.client.post("/target", json={
            "monster": self.base_monster,
            "nowMs": now_seconds * 1000,
            "candidates": [
                {"id": "invisible", "x": 1, "z": 0, "invisibleUntil": now_seconds + 20},
                {"id": "visible", "x": 3, "z": 0},
            ],
        })
        self.assertEqual(response.get_json()["targetId"], "visible")

    def test_alternate_health_fields_are_supported(self):
        response = self.post_target([{
            "id": "legacy-health", "x": 1, "z": 0,
            "currentHealth": 25, "healthMax": 100,
        }])
        body = response.get_json()
        self.assertEqual(body["targetId"], "legacy-health")
        self.assertEqual(body["targetHealthRatio"], 0.25)

    def test_aggro_threat_alias_affects_target_choice(self):
        response = self.post_target([
            {"id": "quiet", "x": 4, "z": 0, "aggroThreat": 0},
            {"id": "threatening", "x": 4.2, "z": 0, "aggroThreat": 100},
        ])
        self.assertEqual(response.get_json()["targetId"], "threatening")

    def test_recent_attacker_damage_alias_affects_target_choice(self):
        response = self.post_target([
            {"id": "quiet", "x": 3, "z": 0},
            {"id": "attacker", "x": 3.4, "z": 0, "recentAttackerDamage": 40},
        ])
        self.assertEqual(response.get_json()["targetId"], "attacker")
        self.assertIn("recent_attacker", response.get_json()["reasons"])

    def test_active_shield_timestamp_penalizes_but_does_not_invalidate(self):
        now_ms = 1_800_000_000_000
        response = self.client.post("/target", json={
            "monster": self.base_monster,
            "nowMs": now_ms,
            "candidates": [
                {"id": "shielded", "x": 2, "z": 0, "shieldUntil": now_ms + 5000},
                {"id": "open", "x": 2, "z": 0},
            ],
        })
        body = response.get_json()
        self.assertEqual(body["targetId"], "open")
        self.assertEqual(body["candidateCount"], 2)

    def test_critical_health_has_explicit_reason(self):
        response = self.post_target([{
            "id": "critical", "x": 1, "z": 0, "health": 10, "maxHealth": 100,
        }])
        self.assertIn("low_health", response.get_json()["reasons"])
        self.assertIn("critical_health", response.get_json()["reasons"])

    def test_control_characters_in_candidate_id_are_rejected(self):
        response = self.post_target([
            {"id": "bad\nidentifier", "x": 1, "z": 0},
            {"id": "valid", "x": 3, "z": 0},
        ])
        self.assertEqual(response.get_json()["targetId"], "valid")
        self.assertEqual(response.get_json()["skippedCandidateCount"], 1)

    def test_metrics_include_latency_percentiles_and_status_counters(self):
        self.client.get("/health")
        self.client.get("/ready")
        body = self.client.get("/metrics").get_json()
        self.assertEqual(body["version"], AI_VERSION)
        for key in ("p50", "p90", "p95", "min", "max", "samples"):
            self.assertIn(key, body["latencyMs"])
        self.assertGreaterEqual(body["latencyMs"]["samples"], 3)
        self.assertGreaterEqual(body["counters"].get("status_200", 0), 2)

    def test_monster_profile_is_normalized(self):
        response = self.client.post("/target", json={
            "monster": {**self.base_monster, "kind": " STALKER "},
            "candidates": [{"id": "target", "x": 2, "z": 0}],
        })
        self.assertEqual(response.get_json()["tacticalProfile"], "stalker")

if __name__ == "__main__":
    unittest.main()
