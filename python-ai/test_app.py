import unittest
from app import app


class TacticalAITests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])

    def test_nearest_low_health_target(self):
        response = self.client.post("/target", json={
            "monster": {"x": 0, "z": 0, "kind": "normal"},
            "candidates": [
                {"id": "far", "x": 20, "z": 0, "health": 100},
                {"id": "near", "x": 2, "z": 0, "health": 40},
            ],
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["targetId"], "near")

    def test_empty_candidates(self):
        response = self.client.post("/target", json={
            "monster": {"x": 0, "z": 0}, "candidates": []
        })
        self.assertIsNone(response.get_json()["targetId"])

    def test_invalid_candidate_is_ignored(self):
        response = self.client.post("/target", json={
            "monster": {"x": 0, "z": 0},
            "candidates": [{"id": "bad", "x": "not-a-number", "z": 0}],
        })
        self.assertIsNone(response.get_json()["targetId"])

    def test_candidate_limit(self):
        response = self.client.post("/target", json={
            "monster": {"x": 0, "z": 0},
            "candidates": [{"id": str(i), "x": i, "z": 0} for i in range(65)],
        })
        self.assertEqual(response.status_code, 413)

    def test_previous_target_preference(self):
        response = self.client.post("/target", json={
            "monster": {"x": 0, "z": 0},
            "previousTargetId": "old",
            "candidates": [
                {"id": "old", "x": 3, "z": 0, "health": 100},
                {"id": "new", "x": 2.5, "z": 0, "health": 100},
            ],
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["targetId"], "old")


if __name__ == "__main__":
    unittest.main()
