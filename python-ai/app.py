import math
import os
from flask import Flask, jsonify, request

app = Flask(__name__)

@app.get('/health')
def health():
    return jsonify({'ok': True, 'service': 'masmorra-tactical-ai'})

@app.post('/target')
def choose_target():
    payload = request.get_json(silent=True) or {}
    monster = payload.get('monster') or {}
    candidates = payload.get('candidates') or []
    try:
        mx = float(monster.get('x', 0))
        mz = float(monster.get('z', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'monster x and z must be numeric'}), 400

    ranked = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get('id') is None:
            continue
        try:
            dx = float(candidate.get('x', 0)) - mx
            dz = float(candidate.get('z', 0)) - mz
            distance = math.hypot(dx, dz)
            health = max(0.0, float(candidate.get('health', 100)))
        except (TypeError, ValueError):
            continue
        # Tactical scoring: favor reachable, weaker targets without ignoring distance.
        summon_bonus = 0.12 if candidate.get('isSummon') else 0.0
        score = distance + (health / 100.0) * 1.5 - summon_bonus
        ranked.append((score, str(candidate['id'])))

    if not ranked:
        return jsonify({'targetId': None})
    ranked.sort(key=lambda item: item[0])
    return jsonify({'targetId': ranked[0][1]})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '10000')))
