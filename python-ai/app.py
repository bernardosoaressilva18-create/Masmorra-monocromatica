"""Tactical target-selection service for O Último Legado.

The service is advisory: the Node game server remains authoritative and falls
back to native targeting whenever this service is unavailable.
"""
import math
import os
import time
import uuid
from collections import Counter, deque
from threading import Lock

from flask import Flask, g, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024
AI_VERSION = "2.0.0"
SERVICE_NAME = "masmorra-tactical-ai"
MAX_COORDINATE = 10000.0
try:
    MAX_CANDIDATES = max(1, min(128, int(os.environ.get("TACTICAL_MAX_CANDIDATES", "64"))))
except ValueError:
    MAX_CANDIDATES = 64

_stats_lock = Lock()
_stats = Counter()
_latency_samples = deque(maxlen=200)
_service_started_at = time.time()


def _number(value, default=None):
    """Return a finite float, rejecting booleans and non-numeric input."""
    if isinstance(value, bool) or value is None:
        return default
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError, OverflowError):
        return default


def _clamp(value, low, high):
    return max(low, min(high, value))


def _safe_id(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or len(text) > 100:
        return None
    return text


def _normalize_role(candidate):
    role = str(candidate.get("role") or candidate.get("playerClass") or "").strip().lower()
    aliases = {
        "curandeiro": "healer", "heal": "healer", "support": "support",
        "cavaleiro": "knight", "soldado": "knight", "guerreiro": "knight",
        "arqueiro": "archer", "mago": "mage", "necromante": "necromancer",
        "ogro": "ogre", "golem de pedra": "golem",
    }
    role = aliases.get(role, role)
    if role in {"healer", "support", "knight", "tank", "brute", "mage", "archer",
                "goblin", "ogre", "necromancer", "monk", "golem", "summon"}:
        return role
    if candidate.get("isSummon"):
        return "summon"
    return role or "player"


def _candidate_score(monster, candidate, previous_target_id=None):
    """Return a deterministic tactical ranking record, or None for bad input."""
    candidate_id = _safe_id(candidate.get("id"))
    x = _number(candidate.get("x"))
    z = _number(candidate.get("z"))
    health = _number(candidate.get("health", candidate.get("hp")), 100.0)
    max_health = _number(candidate.get("maxHealth", candidate.get("maxHp")), 100.0)
    mx = _number(monster.get("x"))
    mz = _number(monster.get("z"))

    if candidate_id is None or None in (x, z, mx, mz, health, max_health):
        return None
    if any(abs(value) > MAX_COORDINATE for value in (x, z, mx, mz)):
        return None
    if candidate.get("alive") is False or candidate.get("visible") is False:
        return None
    if candidate.get("invisible") is True or candidate.get("expired") is True:
        return None
    if health <= 0 or max_health <= 0:
        return None

    distance = math.hypot(x - mx, z - mz)
    health_ratio = _clamp(health / max_health, 0.0, 1.0)
    kind = str(monster.get("kind") or "stalker").strip().lower()
    role = _normalize_role(candidate)
    threat = _clamp(_number(candidate.get("threat"), 0.0), 0.0, 100.0)
    is_summon = bool(candidate.get("isSummon")) or role == "summon"

    # Smaller scores are better. Distance is the main factor to avoid silly chases.
    score = distance + health_ratio * 1.55
    reasons = ["distance"]

    # Low-health targets can be finished off, but this never overrides a huge distance.
    score += health_ratio * 0.6
    if health_ratio <= 0.30:
        score -= 0.35
        reasons.append("low_health")
    if role in {"healer", "support"}:
        score -= 1.05
        reasons.append("support_priority")
    elif role in {"tank", "knight", "golem"}:
        score += 0.30
        reasons.append("durable_target")
    elif role in {"mage", "archer", "necromancer"}:
        score -= 0.12
        reasons.append("ranged_target")

    if is_summon:
        # Summons can distract enemies, but never become more attractive than a nearby player solely due to their type.
        score -= 0.10
        reasons.append("summon_distraction")

    score -= threat * 0.018
    if threat >= 10:
        reasons.append("high_threat")

    if previous_target_id is not None and candidate_id == str(previous_target_id):
        score -= 0.72
        reasons.append("target_stability")

    # Creature personalities: each archetype gets a modest, bounded preference.
    if kind in {"wraith", "assassin"} and role in {"healer", "support", "mage", "archer"}:
        score -= 0.55
        reasons.append("flanker_prefers_backline")
    elif kind in {"brute", "ogre", "tank"} and role in {"tank", "knight", "golem"}:
        score -= 0.12
        reasons.append("brute_engages_frontline")
    elif kind in {"thorn", "stalker"} and health_ratio <= 0.45:
        score -= 0.15
        reasons.append("predator_exploits_weakness")
    elif kind in {"inferno", "abyss"} and role in {"healer", "support"}:
        score -= 0.32
        reasons.append("elite_targets_support")

    # Keep the score in sane bounds, and return only simple JSON-safe values.
    score = _clamp(score, -1000.0, 20000.0)
    return {
        "id": candidate_id,
        "score": score,
        "distance": distance,
        "healthRatio": health_ratio,
        "role": role,
        "isSummon": is_summon,
        "reasons": reasons,
    }


def _record(name, amount=1):
    with _stats_lock:
        _stats[name] += amount


@app.before_request
def _start_request():
    g.request_id = request.headers.get("X-Request-ID", "")[:80] or uuid.uuid4().hex[:16]
    g.request_started = time.perf_counter()
    _record("requests_total")


@app.after_request
def _finish_request(response):
    elapsed_ms = max(0.0, (time.perf_counter() - getattr(g, "request_started", time.perf_counter())) * 1000)
    with _stats_lock:
        _latency_samples.append(elapsed_ms)
        if response.status_code >= 400:
            _stats["responses_4xx_5xx"] += 1
    response.headers["X-Request-ID"] = getattr(g, "request_id", "")
    response.headers["X-AI-Version"] = AI_VERSION
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "service": SERVICE_NAME,
        "version": AI_VERSION,
        "uptimeSeconds": round(time.time() - _service_started_at, 1),
    })


@app.get("/ready")
def ready():
    return jsonify({"ready": True, "service": SERVICE_NAME, "version": AI_VERSION})


@app.get("/metrics")
def metrics():
    # Aggregate, process-local diagnostics only; never includes player names or IDs.
    with _stats_lock:
        counters = dict(_stats)
        samples = sorted(_latency_samples)
    p95 = samples[min(len(samples) - 1, int(len(samples) * 0.95))] if samples else 0.0
    return jsonify({
        "service": SERVICE_NAME,
        "version": AI_VERSION,
        "uptimeSeconds": round(time.time() - _service_started_at, 1),
        "counters": counters,
        "latencyMs": {"samples": len(samples), "p95": round(p95, 2)},
    })


@app.post("/target")
def choose_target():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        _record("invalid_json")
        return jsonify({"error": "expected a JSON object", "requestId": g.request_id}), 400

    monster = payload.get("monster")
    candidates = payload.get("candidates")
    if not isinstance(monster, dict) or not isinstance(candidates, list):
        _record("invalid_payload")
        return jsonify({"error": "monster and candidates are required", "requestId": g.request_id}), 400
    if len(candidates) > MAX_CANDIDATES:
        _record("candidate_limit_rejections")
        return jsonify({"error": "too many candidates", "limit": MAX_CANDIDATES, "requestId": g.request_id}), 413

    mx, mz = _number(monster.get("x")), _number(monster.get("z"))
    if mx is None or mz is None or abs(mx) > MAX_COORDINATE or abs(mz) > MAX_COORDINATE:
        _record("invalid_monster_position")
        return jsonify({"error": "monster position must contain finite x/z coordinates", "requestId": g.request_id}), 400

    previous_target_id = _safe_id(payload.get("previousTargetId"))
    ranked = []
    seen_ids = set()
    skipped = 0
    for candidate in candidates:
        if not isinstance(candidate, dict):
            skipped += 1
            continue
        result = _candidate_score(monster, candidate, previous_target_id)
        if result is None or result["id"] in seen_ids:
            skipped += 1
            continue
        seen_ids.add(result["id"])
        ranked.append(result)

    _record("candidate_records_seen", len(candidates))
    _record("candidate_records_skipped", skipped)
    if not ranked:
        _record("no_target_decisions")
        return jsonify({
            "targetId": None,
            "reason": "no_valid_candidates",
            "candidateCount": 0,
            "inputCandidateCount": len(candidates),
            "version": AI_VERSION,
            "requestId": g.request_id,
        })

    ranked.sort(key=lambda item: (item["score"], item["distance"], item["id"]))
    winner = ranked[0]
    _record("target_decisions")
    alternatives = [{
        "targetId": item["id"],
        "score": round(item["score"], 3),
        "distance": round(item["distance"], 3),
        "role": item["role"],
    } for item in ranked[1:4]]

    return jsonify({
        "targetId": winner["id"],
        "distance": round(winner["distance"], 3),
        "score": round(winner["score"], 3),
        "reason": "lowest_tactical_score",
        "reasons": winner["reasons"],
        "targetRole": winner["role"],
        "targetHealthRatio": round(winner["healthRatio"], 3),
        "candidateCount": len(ranked),
        "inputCandidateCount": len(candidates),
        "skippedCandidateCount": skipped,
        "alternatives": alternatives,
        "version": AI_VERSION,
        "requestId": g.request_id,
    })


@app.errorhandler(413)
def request_too_large(_error):
    _record("oversized_requests")
    return jsonify({"error": "request too large", "requestId": getattr(g, "request_id", None)}), 413


@app.errorhandler(400)
def bad_request(_error):
    return jsonify({"error": "bad request", "requestId": getattr(g, "request_id", None)}), 400


@app.errorhandler(500)
def internal_error(_error):
    _record("internal_errors")
    return jsonify({"error": "internal server error", "requestId": getattr(g, "request_id", None)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")))
