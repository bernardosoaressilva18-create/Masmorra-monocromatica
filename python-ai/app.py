"""Tactical target-selection service for O Último Legado.

The service is advisory: the Node game server remains authoritative and falls
back to native targeting whenever this service is unavailable.
"""
import math
import os
import time
import unicodedata
import uuid
from collections import Counter, deque
from threading import Lock

from flask import Flask, g, jsonify, request

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024
AI_VERSION = "2.2.0"
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


def _text_key(value, default=""):
    """Normalize labels, including Portuguese accents, for comparisons."""
    text = str(value if value is not None else default).strip().casefold()
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _flag(value, default=False):
    """Parse JSON and legacy boolean representations safely."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return math.isfinite(float(value)) and value != 0
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"", "0", "false", "no", "off", "nao", "não", "null"}:
            return False
        if normalized in {"1", "true", "yes", "on", "sim"}:
            return True
    return default


def _timestamp_ms(value):
    """Accept Unix timestamps in seconds or milliseconds; reject invalid values."""
    stamp = _number(value)
    if stamp is None or stamp <= 0:
        return None
    return stamp * 1000 if stamp < 100_000_000_000 else stamp


def _timestamp_is_future(value, now_ms):
    stamp = _timestamp_ms(value)
    return stamp is not None and stamp > now_ms


def _timestamp_is_past(value, now_ms):
    stamp = _timestamp_ms(value)
    return stamp is not None and stamp <= now_ms


def _percentile(sorted_samples, fraction):
    if not sorted_samples:
        return 0.0
    fraction = _clamp(_number(fraction, 0.95), 0.0, 1.0)
    index = max(0, min(len(sorted_samples) - 1, math.ceil(fraction * len(sorted_samples)) - 1))
    return sorted_samples[index]


def _safe_id(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or len(text) > 100 or any(ord(char) < 32 or ord(char) == 127 for char in text):
        return None
    return text


def _normalize_role(candidate):
    role = _text_key(candidate.get("role") or candidate.get("playerClass") or "")
    aliases = {
        "curandeiro": "healer", "healer": "healer", "heal": "healer", "cura": "healer",
        "support": "support", "suporte": "support", "cavaleiro": "knight",
        "soldado": "knight", "guerreiro": "knight", "knight": "knight",
        "arqueiro": "archer", "archer": "archer", "mago": "mage", "mage": "mage",
        "necromante": "necromancer", "necromancer": "necromancer", "ogro": "ogre",
        "ogre": "ogre", "golem de pedra": "golem", "golem": "golem",
        "stone golem": "golem", "stone_golem": "golem", "monge": "monk",
        "monk": "monk", "goblin": "goblin", "invocacao": "summon",
        "invocacao aliada": "summon", "summon": "summon",
        "fragmento de golem": "golem", "esqueleto": "skeleton",
        "skeleton": "skeleton", "golem_clone": "golem", "brute": "brute", "tank": "tank",
    }
    role = aliases.get(role, role)
    if role in {"healer", "support", "knight", "tank", "brute", "mage", "archer",
                "goblin", "ogre", "necromancer", "monk", "golem", "summon", "skeleton"}:
        return role
    if _flag(candidate.get("isSummon")):
        return "summon"
    return role or "player"


def _candidate_score(monster, candidate, previous_target_id=None, now_ms=None):
    """Return a deterministic tactical ranking record, or None for bad input."""
    candidate_id = _safe_id(candidate.get("id"))
    x = _number(candidate.get("x"))
    z = _number(candidate.get("z"))
    health = _number(candidate.get("health", candidate.get("hp", candidate.get("currentHealth"))), 100.0)
    max_health = _number(candidate.get("maxHealth", candidate.get("maxHp", candidate.get("healthMax"))), 100.0)
    mx = _number(monster.get("x"))
    mz = _number(monster.get("z"))
    if now_ms is None:
        now_ms = time.time() * 1000

    if candidate_id is None or None in (x, z, mx, mz, health, max_health):
        return None
    if any(abs(value) > MAX_COORDINATE for value in (x, z, mx, mz)):
        return None
    if any(_flag(candidate.get(flag)) for flag in ("dead", "isDead", "deathLocked", "eliminated", "expired")):
        return None
    if "alive" in candidate and not _flag(candidate.get("alive"), default=True):
        return None
    if "isAlive" in candidate and not _flag(candidate.get("isAlive"), default=True):
        return None
    if "connected" in candidate and not _flag(candidate.get("connected"), default=True):
        return None
    if "visible" in candidate and not _flag(candidate.get("visible"), default=True):
        return None
    if _flag(candidate.get("invisible")) or _timestamp_is_future(candidate.get("invisibleUntil"), now_ms):
        return None
    if _timestamp_is_past(candidate.get("expiresAt"), now_ms):
        return None
    if health <= 0 or max_health <= 0:
        return None

    distance = math.hypot(x - mx, z - mz)
    health_ratio = _clamp(health / max_health, 0.0, 1.0)
    kind = _text_key(monster.get("kind") or "stalker")
    role = _normalize_role(candidate)
    threat = _clamp(_number(candidate.get("threat", candidate.get("aggroThreat")), 0.0), 0.0, 100.0)
    recent_damage = _clamp(_number(candidate.get("recentDamage", candidate.get("recentAttackerDamage")), 0.0), 0.0, 100.0)
    is_summon = _flag(candidate.get("isSummon")) or role in {"summon", "skeleton"}
    shield_until_active = _timestamp_is_future(candidate.get("shieldUntil"), now_ms)
    guard_until_active = _timestamp_is_future(candidate.get("guardUntil"), now_ms)
    is_shielded = (_flag(candidate.get("shielded")) or _flag(candidate.get("hasShield"))
                   or shield_until_active or guard_until_active)
    attack_range = _clamp(_number(monster.get("attackRange"), 2.5), 0.5, 25.0)
    aggression = _clamp(_number(monster.get("aggression"), 1.0), 0.25, 2.0)

    # Smaller scores are better. Distance stays dominant to avoid implausible long chases.
    score = distance + health_ratio * 1.55
    reasons = ["distance"]
    score += health_ratio * 0.6
    if distance <= attack_range:
        score -= 0.22
        reasons.append("in_attack_range")
    elif distance > attack_range * 3.5:
        score += min(1.25, (distance - attack_range * 3.5) * 0.08)
        reasons.append("far_target")
    if health_ratio <= 0.30:
        score -= 0.35
        reasons.append("low_health")
    if health_ratio <= 0.15:
        score -= 0.25
        reasons.append("critical_health")
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
        score -= 0.10
        reasons.append("summon_distraction")
    if is_shielded:
        score += 0.24
        reasons.append("shielded_target")
    score -= threat * 0.018
    if threat >= 10:
        reasons.append("high_threat")
    score -= recent_damage * 0.012
    if recent_damage >= 8:
        reasons.append("recent_attacker")
    if previous_target_id is not None and candidate_id == str(previous_target_id):
        score -= 0.90
        reasons.append("target_stability")

    # Creature personalities influence priorities without overriding physical distance.
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
    # Aggressive monsters more readily switch toward urgent, threatening targets.
    score -= min(0.35, max(0.0, aggression - 1.0) * 0.35) * min(1.0, threat / 40.0)
    if aggression > 1.25 and threat >= 20:
        reasons.append("aggressive_response")

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
    supplied_request_id = request.headers.get("X-Request-ID", "")
    safe_request_id = "".join(char for char in supplied_request_id if ord(char) >= 32 and ord(char) != 127)[:80]
    g.request_id = safe_request_id or uuid.uuid4().hex[:16]
    g.request_started = time.perf_counter()
    _record("requests_total")


@app.after_request
def _finish_request(response):
    elapsed_ms = max(0.0, (time.perf_counter() - getattr(g, "request_started", time.perf_counter())) * 1000)
    with _stats_lock:
        _latency_samples.append(elapsed_ms)
        _stats[f"status_{response.status_code}"] += 1
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
    return jsonify({
        "service": SERVICE_NAME,
        "version": AI_VERSION,
        "uptimeSeconds": round(time.time() - _service_started_at, 1),
        "counters": counters,
        "latencyMs": {
            "samples": len(samples),
            "p50": round(_percentile(samples, 0.50), 2),
            "p90": round(_percentile(samples, 0.90), 2),
            "p95": round(_percentile(samples, 0.95), 2),
            "min": round(samples[0], 2) if samples else 0.0,
            "max": round(samples[-1], 2) if samples else 0.0,
        },
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
    now_ms = _number(payload.get("nowMs"), time.time() * 1000)
    ranked_by_id = {}
    skipped = 0
    for candidate in candidates:
        if not isinstance(candidate, dict):
            skipped += 1
            continue
        result = _candidate_score(monster, candidate, previous_target_id, now_ms)
        if result is None:
            skipped += 1
            continue
        existing = ranked_by_id.get(result["id"])
        if existing is not None:
            skipped += 1
            if (result["score"], result["distance"]) < (existing["score"], existing["distance"]):
                ranked_by_id[result["id"]] = result
            continue
        ranked_by_id[result["id"]] = result
    ranked = list(ranked_by_id.values())

    _record("candidate_records_seen", len(candidates))
    _record("candidate_records_skipped", skipped)
    if not ranked:
        _record("no_target_decisions")
        return jsonify({
            "targetId": None,
            "reason": "no_valid_candidates",
            "candidateCount": 0,
            "inputCandidateCount": len(candidates),
            "skippedCandidateCount": skipped,
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
        "decisionConfidence": round(_clamp((ranked[1]["score"] - winner["score"]) / max(1.0, abs(winner["score"]) + 1.0), 0.0, 1.0), 3) if len(ranked) > 1 else 1.0,
        "tacticalProfile": _text_key(monster.get("kind") or "stalker"),
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
