import math
import os
from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024
AI_VERSION = "1.1.0"
MAX_CANDIDATES = 64
MAX_COORDINATE = 10000.0


def _number(value, default=None):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _clamp(value, low, high):
    return max(low, min(high, value))


def _candidate_score(monster, candidate, previous_target_id=None):
    mx = _number(monster.get("x"), 0.0)
    mz = _number(monster.get("z"), 0.0)
    x = _number(candidate.get("x"))
    z = _number(candidate.get("z"))
    health = _number(candidate.get("health"), 100.0)
    if x is None or z is None or health is None:
        return None
    if abs(x) > MAX_COORDINATE or abs(z) > MAX_COORDINATE:
        return None
    if candidate.get("id") is None:
        return None

    distance = math.hypot(x - mx, z - mz)
    health_ratio = _clamp(health / 100.0, 0.0, 2.0)
    kind = str(monster.get("kind") or "normal").lower()
    role = str(candidate.get("role") or ("summon" if candidate.get("isSummon") else "player")).lower()

    # Base score: distance matters most, but low-health targets become more attractive.
    score = distance + health_ratio * 1.5
    if role in {"healer", "support"}:
        score -= 1.0
    if role in {"tank", "brute"}:
        score += 0.35
    if candidate.get("isSummon"):
        score -= 0.12

    # Different monster archetypes get slightly different tactical preferences.
    if kind in {"brute", "tank"} and role in {"tank", "brute"}:
        score -= 0.2
    elif kind in {"wraith", "assassin"} and role in {"healer", "support"}:
        score -= 0.6

    # Avoid thrashing between equally good targets when the current target is still viable.
    if previous_target_id is not None and str(candidate["id"]) == str(previous_target_id):
        score -= 0.8

    threat = _number(candidate.get("threat"), 0.0)
    score -= _clamp(threat, 0.0, 100.0) * 0.015
    return (score, str(candidate["id"]), distance)


@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "masmorra-tactical-ai", "version": AI_VERSION})


@app.get("/ready")
def ready():
    return jsonify({"ready": True, "version": AI_VERSION})


@app.post("/target")
def choose_target():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "expected a JSON object"}), 400
    monster = payload.get("monster")
    candidates = payload.get("candidates")
    if not isinstance(monster, dict) or not isinstance(candidates, list):
        return jsonify({"error": "monster and candidates are required"}), 400
    if len(candidates) > MAX_CANDIDATES:
        return jsonify({"error": "too many candidates", "limit": MAX_CANDIDATES}), 413

    previous_target_id = payload.get("previousTargetId")
    ranked = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get("alive") is False:
            continue
        result = _candidate_score(monster, candidate, previous_target_id)
        if result is not None:
            ranked.append(result)

    if not ranked:
        return jsonify({"targetId": None, "reason": "no_valid_candidates", "version": AI_VERSION})
    ranked.sort(key=lambda item: (item[0], item[1]))
    score, target_id, distance = ranked[0]
    return jsonify({
        "targetId": target_id,
        "distance": round(distance, 3),
        "score": round(score, 3),
        "reason": "lowest_tactical_score",
        "candidateCount": len(ranked),
        "version": AI_VERSION,
    })


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "request too large"}), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")))
