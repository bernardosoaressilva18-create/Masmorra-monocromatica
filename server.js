
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const filename = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC, filename);

  if (!filePath.startsWith(PUBLIC + path.sep) && filePath !== path.join(PUBLIC, 'index.html')) {
    res.writeHead(403);
    return res.end('Acesso negado');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Arquivo não encontrado');
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
// Ping periódico ajuda a detectar/evitar conexões WebSocket ociosas.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.ping();
  }
}, 25000);
heartbeat.unref?.();
const rooms = new Map();
let nextId = 1;
const CLASS_STATS = {
  knight: { hp: 130, damage: 2, range: 3.6, attackMs: 520, spellPower: 1, reduction: .18 },
  mage: { hp: 92, damage: 1, range: 3.1, attackMs: 460, spellPower: 1.55, reduction: 0 },
  archer: { hp: 108, damage: 1, range: 4.8, attackMs: 310, spellPower: 1, reduction: .03 }
};
const VALID_SKILLS = new Set(['mighty_blows','swift_hands','executioner','boss_hunter','longshot','vitality','iron_skin','regeneration','second_wind','party_guard','arcane_mastery','ember_core','storm_bond','treasure_luck','swift_step']);
const SKILL_REQUIREMENTS = { swift_hands:'mighty_blows', executioner:'swift_hands', boss_hunter:'executioner', longshot:'boss_hunter', iron_skin:'vitality', regeneration:'iron_skin', second_wind:'regeneration', party_guard:'second_wind', ember_core:'arcane_mastery', storm_bond:'ember_core', treasure_luck:'storm_bond', swift_step:'treasure_luck' };
function hasSkill(player, id) { return !!player.skills && player.skills.includes(id); }
function statsFor(player) { return CLASS_STATS[player.playerClass] || CLASS_STATS.knight; }
function maxHealthFor(player) { return statsFor(player).hp + (hasSkill(player, 'vitality') ? 25 : 0); }
function refreshPlayerStats(player, restoreHealth = false) {
  const oldMax = player.maxHp || 100; player.maxHp = maxHealthFor(player);
  player.baseDamage = statsFor(player).damage + (hasSkill(player, 'mighty_blows') ? 1 : 0) + (player.equipmentDamage || 0);
  if (restoreHealth) player.hp = player.maxHp;
  else player.hp = Math.min(player.maxHp, Math.max(0, (player.hp || 0) + Math.max(0, player.maxHp - oldMax)));
}
function dropChance(player, base) { return Math.min(.9, base + (hasSkill(player, 'treasure_luck') ? .2 : 0)); }
function takeDamage(room, player, amount) {
  let damage = amount * (1 - (statsFor(player).reduction || 0));
  if (hasSkill(player, 'iron_skin')) damage *= .8;
  if (hasSkill(player, 'party_guard') && [...room.players.values()].some(other => other.id !== player.id && other.hp > 0 && Math.hypot(other.x-player.x, other.z-player.z) <= 7)) damage *= .9;
  player.hp = Math.max(0, player.hp - Math.max(1, Math.round(damage)));
  if (player.hp <= 0 && hasSkill(player, 'second_wind') && !player.secondWindUsed) {
    player.secondWindUsed = true; player.hp = Math.max(1, Math.ceil(player.maxHp * .3));
    player.ws.send(JSON.stringify({ type: 'notice', text: '🌟 Segunda chance! Você voltou com 30% da vida.' }));
  }
}

const RARITIES = [
  { name: 'comum', chance: 60, value: 1 },
  { name: 'incomum', chance: 25, value: 2 },
  { name: 'raro', chance: 10, value: 4 },
  { name: 'épico', chance: 4, value: 8 },
  { name: 'lendário', chance: 1, value: 16 }
];
const LOOT_TABLES = {
  monster: [
    { name: 'Fragmento Monocromático', weight: 45 },
    { name: 'Pó de Cristal', weight: 30 },
    { name: 'Moeda Antiga', weight: 20 },
    { name: 'Núcleo Sombrio', weight: 5 }
  ],
  boss: [
    { name: 'Coração do Guardião', weight: 35 },
    { name: 'Relíquia Monocromática', weight: 30 },
    { name: 'Cristal Ancestral', weight: 25 },
    { name: 'Coroa do Abismo', weight: 10 }
  ],
  chest: [
    { name: 'Poção de Vida', weight: 35 },
    { name: 'Fragmento Monocromático', weight: 30 },
    { name: 'Moeda Antiga', weight: 20 },
    { name: 'Equipamento Antigo', weight: 15 }
  ]
};
function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
const RARITY_POWER = { 'comum':1, 'incomum':2, 'raro':3, 'épico':4, 'lendário':5 };
function rarityMultiplier(rarity) { return RARITY_POWER[rarity] || 1; }
const RARITY_EFFECTS = {
  'comum':    { potion:.30, coin:.10, powderHeal:.15, powderDamage:1, powderHits:3, fragmentDamage:1, fragmentHits:4, coreDamage:2, coreHits:4, gearDamage:1, heart:.40, ancientDamage:3, ancientHits:5 },
  'incomum':  { potion:.45, coin:.15, powderHeal:.25, powderDamage:2, powderHits:4, fragmentDamage:2, fragmentHits:5, coreDamage:3, coreHits:5, gearDamage:2, heart:.55, ancientDamage:5, ancientHits:7 },
  'raro':     { potion:.60, coin:.25, powderHeal:.35, powderDamage:3, powderHits:5, fragmentDamage:3, fragmentHits:6, coreDamage:5, coreHits:7, gearDamage:3, heart:.70, ancientDamage:7, ancientHits:9 },
  'épico':    { potion:.80, coin:.35, powderHeal:.50, powderDamage:5, powderHits:7, fragmentDamage:5, fragmentHits:8, coreDamage:7, coreHits:9, gearDamage:5, heart:.85, ancientDamage:10, ancientHits:12 },
  'lendário': { potion:1.00, coin:.50, powderHeal:.70, powderDamage:8, powderHits:10, fragmentDamage:8, fragmentHits:12, coreDamage:10, coreHits:12, gearDamage:8, heart:1.00, ancientDamage:15, ancientHits:16 }
};
function rollLoot(source) {
  const rarityRoll = Math.random() * 100;
  let sum = 0, rarity = RARITIES[0];
  for (const entry of RARITIES) {
    sum += entry.chance;
    if (rarityRoll < sum) { rarity = entry; break; }
  }
  const item = weightedPick(LOOT_TABLES[source] || LOOT_TABLES.monster);
  return { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    name: item.name, rarity: rarity.name, value: rarity.value, power: rarityMultiplier(rarity.name), source };
}
function sendInventory(player) {
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify({ type: 'inventory', inventory: player.inventory, lootDrops: player.lootDrops }));
  }
}
function grantLoot(player, source) {
  const item = rollLoot(source);
  player.lootDrops.push(item);
  player.inventory[item.rarity] = (player.inventory[item.rarity] || 0) + 1;
  sendInventory(player);
  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify({ type: 'loot', item }));
  }
  return item;
}

function createWave(phase) {
  const count = phase === 1 ? 5 : 6 + phase;
  const kindsByPhase = {
    1: ['stalker','stalker','brute','stalker','brute'],
    2: ['wraith','stalker','wraith','brute','wraith','brute'],
    3: ['thorn','thorn','brute','wraith','thorn','brute','wraith'],
    4: ['inferno','brute','inferno','wraith','brute','inferno','wraith','brute'],
    5: ['abyss','abyss','brute','abyss','wraith','abyss','brute','abyss','wraith']
  };
  const kinds = kindsByPhase[phase] || kindsByPhase[5];
  const center = -((phase - 1) * 32 + 14);
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length];
    const base = phase === 1 ? 5 : 7 + phase * 2;
    const hp = (kind === 'brute' ? base * 2 : base) + (phase - 1) * 2;
    return { id: 'p' + phase + 'm' + i, kind, phase,
      x: (Math.random() - 0.5) * 22, z: center + (Math.random() - 0.5) * 8,
      spawned: false, spawnAt: now + i * 1700, alive: true, hp, maxHp: hp, attackAt: 0 };
  });
}
function advancePhase(room) {
  if (room.phase >= 5) return;
  const names = ['', 'Cripta Esquecida', 'Cavernas Mágicas', 'Floresta Amaldiçoada', 'Terras Vulcânicas', 'Abismo Final'];
  room.phase++;
  room.safeZoneUntil = Date.now() + 20000;
  room.nextSafeBroadcast = 0;
  for (const player of room.players.values()) {
    player.talentPoints = (player.talentPoints || 0) + 1;
    const before = player.hp;
    player.hp = Math.min(player.maxHp || 100, player.hp + 15);
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify({ type: 'notice', text: '✦ Zona segura por 20 segundos! +1 ponto de skill e +' + (player.hp - before) + ' de vida. Abra ÁRVORE DE SKILLS.' }));
  }
  room.monsters = createWave(room.phase);
  room.boss = null;
  if (room.phase === 5) {
    room.monsters = [];
    room.boss = { id: 'final-boss', x: 0, z: -150, alive: true, hp: 95, maxHp: 95, lifePhase: 1, attackAt: 0 };
    broadcast(room, { type: 'notice', text: 'FASE 5: ' + names[5] + '! O Guardião Supremo despertou.' });
  } else {
    broadcast(room, { type: 'notice', text: 'MUNDO ' + room.phase + ' / 5: ' + names[room.phase] + '. Nova região descoberta!' });
  }
}
function newRoom(code, hostId) {
  const room = { players: new Map(), hostId, started: false, phase: 1, monsters: createWave(1), boss: null, bossAttackAt: 0, safeZoneUntil: 0, nextSafeBroadcast: 0, emptySince: 0, cursedBoss: null, cursedBossAttackAt: 0,
    chests: [
      { id: 'c0', x: -8, z: -12, openedBy: [] },
      { id: 'c1', x: 8, z: -44, openedBy: [] },
      { id: 'c2', x: -8, z: -76, openedBy: [] },
      { id: 'c3', x: 8, z: -108, openedBy: [] },
      { id: 'c4', x: 8, z: -140, openedBy: [] }
    ] };
  rooms.set(code, room); return room;
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function state(room) {
  return {
    type: 'state',
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot, color: p.color, hp: p.hp, maxHp: p.maxHp, playerClass: p.playerClass, skin: p.skin, skills: p.skills, talentPoints: p.talentPoints, ready: !!p.ready, isHost: p.id === room.hostId
    })),
    phase: room.phase,
    safeZoneUntil: room.safeZoneUntil || 0,
    started: room.started,
    hostId: room.hostId,
    monsters: room.monsters,
    boss: room.boss,
    chests: room.chests.map(chest => ({ id: chest.id, x: chest.x, z: chest.z, opened: chest.openedBy.length > 0 }))
  };
}

wss.on('connection', ws => {
  const player = {
  id: String(nextId++),
  ws, name: 'Aventureiro', x: 0, z: 3, rot: 0,
  color: [0x72e6ff, 0x9ec477, 0xffb8a7, 0x9cf8a8][nextId % 4],
  hp: 130, maxHp: 130, lastGateNotice: 0, baseDamage: 2, damageBuff: 0, damageBuffHits: 0,
  playerClass: 'knight', skin: 'default', skills: [], talentPoints: 5, equipmentDamage: 0, nextAttackAt: 0, nextRegenAt: Date.now() + 3000, secondWindUsed: false,
  room: null,
  ready: false,
  lootDrops: [],
  inventory: {
    comum: 0,
    incomum: 0,
    raro: 0,
    épico: 0,
    lendário: 0
  }
};

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
        || Math.random().toString(36).slice(2, 8).toUpperCase();

      if (player.room) {
        const old = rooms.get(player.room);
        if (old) old.players.delete(player.id);
      }

      let room = rooms.get(code);
      if (!room) room = newRoom(code, player.id);
      // Permite entrar novamente na sala durante uma partida após uma queda de conexão.
      player.room = code;
      player.name = String(msg.name || 'Aventureiro').slice(0, 18);
      player.playerClass = ['knight','mage','archer'].includes(msg.playerClass || msg.class) ? (msg.playerClass || msg.class) : 'knight';
      player.skin = ['default','shadow','ember'].includes(msg.skin) ? msg.skin : 'default';
      player.skills = [];
      player.equipmentDamage = 0;
      const requestedSkills = Array.isArray(msg.skills) ? msg.skills.filter(id => VALID_SKILLS.has(id)) : [];
      for (const id of requestedSkills) {
        const req = SKILL_REQUIREMENTS[id];
        if (!player.skills.includes(id) && (!req || player.skills.includes(req))) player.skills.push(id);
      }
      const requestedPoints = Number(msg.talentPoints);
      player.talentPoints = Number.isFinite(requestedPoints) ? Math.max(0, Math.min(20, Math.floor(requestedPoints))) : Math.max(0, 5 - player.skills.length);
      player.secondWindUsed = false;
      player.x = 0; player.z = room.started ? -((room.phase - 1) * 32 + 1) : 3; player.ready = false;
      room.emptySince = 0;
      player.damageBuff = 0; player.damageBuffHits = 0; player.nextAttackAt = 0;
      refreshPlayerStats(player, true);
      room.players.set(player.id, player);

      ws.send(JSON.stringify({ type: 'joined', id: player.id, room: code }));
      broadcast(room, { type: 'notice', text: player.name + ' entrou na sala.' });
      broadcast(room, state(room));
      sendInventory(player);
      return;
    }

    const room = player.room && rooms.get(player.room);
    if (!room) return;

    if (msg.type === 'ready') {
      if (room.started) return;
      player.ready = !player.ready;
      broadcast(room, state(room));
    } else if (msg.type === 'startMatch') {
      if (room.started) return;
      if (player.id !== room.hostId) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Só o anfitrião pode iniciar a partida.' }));
        return;
      }
      if ([...room.players.values()].some(p => !p.ready)) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Todos os jogadores precisam clicar em PRONTO.' }));
        return;
      }
      room.started = true;
      broadcast(room, { type: 'notice', text: 'A partida começou! Boa sorte, aventureiros.' });
      broadcast(room, state(room));
    } else if (msg.type === 'loadout') {
      const wantedClass = ['knight','mage','archer'].includes(msg.playerClass) ? msg.playerClass : player.playerClass;
      const wantedSkin = ['default','shadow','ember'].includes(msg.skin) ? msg.skin : player.skin;
      if (room.started && (wantedClass !== player.playerClass || wantedSkin !== player.skin)) return;
      const proposed = Array.isArray(msg.skills) ? msg.skills.filter(id => VALID_SKILLS.has(id)) : [];
      for (const id of proposed) {
        if (player.skills.includes(id)) continue;
        const req = SKILL_REQUIREMENTS[id];
        if (req && !player.skills.includes(req)) continue;
        if (player.talentPoints <= 0) break;
        player.skills.push(id); player.talentPoints--;
      }
      player.playerClass = wantedClass; player.skin = wantedSkin;
      refreshPlayerStats(player, !room.started);
      broadcast(room, state(room));
    } else if (msg.type === 'move') {
      if (!room.started || player.hp <= 0) return;
      player.x = Math.max(-13, Math.min(13, Number(msg.x) || 0));
      const requestedZ = Math.max(-174, Math.min(8, Number(msg.z) || 0));
      const gateZ = room.phase < 5 ? -(30 + (room.phase - 1) * 32) : -999;
      const enemiesAlive = room.phase === 5 ? !!(room.boss && room.boss.alive) : room.monsters.some(m => m.alive);
      if (room.phase < 5 && requestedZ < gateZ && enemiesAlive) {
        player.z = gateZ + 0.7;
        if (Date.now() - player.lastGateNotice > 1800) {
          player.lastGateNotice = Date.now();
          player.ws.send(JSON.stringify({ type: 'notice', text: 'O portão está selado! Derrote todos os monstros desta fase.' }));
        }
      } else {
        player.z = requestedZ;
        if (room.phase < 5 && requestedZ < gateZ) advancePhase(room);
      }
      player.rot = Number(msg.rot) || 0;
      // O loop do servidor já envia o estado a cada 100 ms; evitar duplicar
      // um pacote completo a cada movimento reduz tráfego e desconexões.
    } else if (msg.type === 'useItem') {
      if (!room.started || player.hp <= 0) return;
      const itemIndex = player.lootDrops.findIndex(item => item.id === String(msg.id));
      if (itemIndex < 0) { ws.send(JSON.stringify({ type: 'notice', text: 'Esse item não está mais no inventário.' })); return; }
      const item = player.lootDrops[itemIndex];
      const tier = RARITY_EFFECTS[item.rarity] || RARITY_EFFECTS['comum'];
      const maxHp = player.maxHp || 100;
      const heal = fraction => Math.max(1, Math.round(maxHp * fraction));
      let effect = '';
      if (item.name === 'Poção de Vida') {
        if (player.hp >= maxHp) { ws.send(JSON.stringify({ type: 'notice', text: 'Sua vida já está cheia!' })); return; }
        const before = player.hp; player.hp = Math.min(maxHp, player.hp + heal(tier.potion));
        effect = 'Vida +' + (player.hp - before) + ' (' + item.rarity + ' · nível ' + rarityMultiplier(item.rarity) + '/5).';
      } else if (item.name === 'Moeda Antiga') {
        if (player.hp >= maxHp) { ws.send(JSON.stringify({ type: 'notice', text: 'Sua vida já está cheia!' })); return; }
        const before = player.hp; player.hp = Math.min(maxHp, player.hp + heal(tier.coin));
        effect = 'Moeda ' + item.rarity + ': +' + (player.hp - before) + ' de vida.';
      } else if (item.name === 'Pó de Cristal') {
        const before = player.hp; player.hp = Math.min(maxHp, player.hp + heal(tier.powderHeal));
        player.damageBuff = Math.max(player.damageBuff, tier.powderDamage);
        player.damageBuffHits = Math.max(player.damageBuffHits, tier.powderHits);
        effect = 'Pó ' + item.rarity + ': +' + (player.hp - before) + ' vida, +' + tier.powderDamage + ' dano por ' + tier.powderHits + ' golpes.';
      } else if (item.name === 'Fragmento Monocromático') {
        player.damageBuff = Math.max(player.damageBuff, tier.fragmentDamage);
        player.damageBuffHits = Math.max(player.damageBuffHits, tier.fragmentHits);
        effect = 'Fragmento ' + item.rarity + ': +' + tier.fragmentDamage + ' dano por ' + tier.fragmentHits + ' golpes.';
      } else if (item.name === 'Núcleo Sombrio') {
        player.damageBuff = Math.max(player.damageBuff, tier.coreDamage);
        player.damageBuffHits = Math.max(player.damageBuffHits, tier.coreHits);
        effect = 'Núcleo ' + item.rarity + ': +' + tier.coreDamage + ' dano por ' + tier.coreHits + ' golpes.';
      } else if (item.name === 'Equipamento Antigo' || item.name === 'Relíquia Monocromática') {
        player.equipmentDamage = Math.min(18, (player.equipmentDamage || 0) + tier.gearDamage);
        refreshPlayerStats(player, false);
        effect = 'Equipado! +' + tier.gearDamage + ' ataque permanente (' + item.rarity + '). Ataque total: ' + player.baseDamage + '.';
      } else if (item.name === 'Coração do Guardião') {
        const before = player.hp; player.hp = Math.min(maxHp, player.hp + heal(tier.heart));
        effect = 'Coração ' + item.rarity + ': +' + (player.hp - before) + ' de vida.';
      } else if (item.name === 'Cristal Ancestral') {
        player.damageBuff = Math.max(player.damageBuff, tier.ancientDamage);
        player.damageBuffHits = Math.max(player.damageBuffHits, tier.ancientHits);
        effect = 'Cristal ancestral ' + item.rarity + ': +' + tier.ancientDamage + ' dano por ' + tier.ancientHits + ' golpes.';
      } else if (item.name === 'Coroa do Abismo') {
        player.hp = maxHp;
        player.equipmentDamage = Math.min(18, (player.equipmentDamage || 0) + tier.gearDamage);
        refreshPlayerStats(player, false);
        player.hp = maxHp;
        effect = 'Coroa ' + item.rarity + ': vida cheia e +' + tier.gearDamage + ' ataque permanente.';
      } else {
        ws.send(JSON.stringify({ type: 'notice', text: 'Este item ainda não tem um efeito utilizável.' })); return;
      }
      player.lootDrops.splice(itemIndex, 1);
      player.inventory[item.rarity] = Math.max(0, (player.inventory[item.rarity] || 0) - 1);
      sendInventory(player);
      ws.send(JSON.stringify({ type: 'notice', text: item.name + ': ' + effect }));
      broadcast(room, state(room));
    } else if (msg.type === 'spell') {
      if (!room.started || player.hp <= 0) return;
      if (Date.now() < (room.safeZoneUntil || 0)) { ws.send(JSON.stringify({ type: 'notice', text: 'Você está na zona segura. Use esse tempo para melhorar suas habilidades.' })); return; }
      const spell = msg.spell === 'fire' ? 'fire' : msg.spell === 'lightning' ? 'lightning' : null;
      if (!spell) return;

      const candidates = room.phase < 5
        ? room.monsters.filter(m => m.alive && m.spawned && Math.hypot(m.x - player.x, m.z - player.z) < 7)
        : (room.boss && room.boss.alive && Math.hypot(room.boss.x - player.x, room.boss.z - player.z) < 8 ? [room.boss] : []);
      candidates.sort((a, b) => Math.hypot(a.x-player.x, a.z-player.z) - Math.hypot(b.x-player.x, b.z-player.z));
      const target = candidates[0];
      if (!target) {
        player.ws.send(JSON.stringify({ type: 'notice', text: 'Nenhum inimigo ao alcance da magia.' }));
        broadcast(room, { type: 'spell', id: player.id, spell, x: player.x, z: player.z, targets: [] });
        return;
      }

      const hitTargets = [];
      const applyDamage = (enemy, amount) => {
        if (!enemy || !enemy.alive) return;
        const classPower = statsFor(player).spellPower * (hasSkill(player, 'arcane_mastery') ? 1.5 : 1);
        const emberBonus = spell === 'fire' && hasSkill(player, 'ember_core') ? 1 : 0;
        const bossBonus = enemy === room.boss && hasSkill(player, 'boss_hunter') ? 1.5 : 1;
        const executeBonus = enemy.hp / (enemy.maxHp || 1) <= .35 && hasSkill(player, 'executioner') ? 1.5 : 1;
        enemy.hp = Math.max(0, (enemy.hp || 1) - amount * classPower * bossBonus * executeBonus - emberBonus);
        if (spell === 'fire' && enemy.hp > 0) {
          enemy.burnUntil = Date.now() + (hasSkill(player, 'ember_core') ? 5000 : 3000);
          enemy.burnNextAt = Date.now() + 1000;
        }
        hitTargets.push({ x: enemy.x, z: enemy.z });
        if (enemy.hp <= 0) {
          enemy.alive = false;
          if (room.phase < 5 && Math.random() < dropChance(player, .25)) grantLoot(player, 'monster');
          if (room.phase === 5 && enemy === room.boss) {
            const dropped = grantLoot(player, 'boss');
            broadcast(room, { type: 'notice', text: 'CHEFE DERROTADO! Recompensa: ' + dropped.name + ' (' + dropped.rarity + ')' });
          }
        }
      };

      if (spell === 'fire') {
        applyDamage(target, 2);
        player.ws.send(JSON.stringify({ type: 'notice', text: '🔥 Bola de fogo! Queimadura por 3 segundos.' }));
      } else {
        applyDamage(target, 1.5);
        // O raio perde força a cada salto: 0.9 no primeiro e 0.6 no segundo.
        let previous = target;
        const maxHops = hasSkill(player, 'storm_bond') ? 4 : 2;
        for (let hop = 0; hop < maxHops; hop++) {
          const next = room.monsters
            .filter(m => m.alive && m.spawned && m !== previous && !hitTargets.some(t => t.x === m.x && t.z === m.z)
              && Math.hypot(m.x - previous.x, m.z - previous.z) <= 5)
            .sort((a, b) => Math.hypot(a.x-previous.x, a.z-previous.z) - Math.hypot(b.x-previous.x, b.z-previous.z))[0];
          if (!next) break;
          applyDamage(next, hop === 0 ? 0.9 : 0.6);
          previous = next;
        }
        player.ws.send(JSON.stringify({ type: 'notice', text: '⚡ Raio em cadeia! Dano reduzido por salto.' }));
      }
      broadcast(room, { type: 'spell', id: player.id, spell, x: player.x, z: player.z, targets: hitTargets });
      broadcast(room, state(room));
    } else if (msg.type === 'attack') {
      if (!room.started || player.hp <= 0) return;
      if (Date.now() < (room.safeZoneUntil || 0)) { ws.send(JSON.stringify({ type: 'notice', text: 'Zona segura: abra a árvore de skills antes do próximo combate.' })); return; }
      const now = Date.now();
      const attackInterval = Math.max(210, statsFor(player).attackMs - (hasSkill(player, 'swift_hands') ? 90 : 0));
      if (now < (player.nextAttackAt || 0)) return;
      player.nextAttackAt = now + attackInterval;
      if (room.phase < 5) {
        const attackRange = statsFor(player).range + (player.playerClass === 'archer' && hasSkill(player, 'longshot') ? 2 : 0);
        const target = room.monsters.find(m => m.alive && m.spawned && Math.hypot(m.x - player.x, m.z - player.z) < attackRange);
        if (target) {
          let damage = player.baseDamage + (player.damageBuffHits > 0 ? player.damageBuff : 0);
          if (target.hp / (target.maxHp || 1) <= .35 && hasSkill(player, 'executioner')) damage += 2;
          target.hp = Math.max(0, (target.hp || 1) - damage);
          if (player.damageBuffHits > 0) { player.damageBuffHits--; if (player.damageBuffHits === 0) player.damageBuff = 0; }
          if (target.hp <= 0) {
            target.alive = false;
            // Monstros comuns não garantem item: chance de 25%, para loot não inundar o inventário.
            if (Math.random() < dropChance(player, .25)) {
              const dropped = grantLoot(player, 'monster');
              player.ws.send(JSON.stringify({ type: 'notice', text: 'Drop raro do monstro: ' + dropped.name + ' (' + dropped.rarity + ')' }));
            } else {
              player.ws.send(JSON.stringify({ type: 'notice', text: 'Monstro derrotado. Nenhum item desta vez.' }));
            }
            broadcast(room, { type: 'notice', text: player.name + ' derrotou um monstro!' });
          } else {
            player.ws.send(JSON.stringify({ type: 'notice', text: 'Monstro ferido! Vida restante: ' + target.hp }));
          }
        }
      } else if (room.boss && room.boss.alive && Math.hypot(room.boss.x - player.x, room.boss.z - player.z) < 5.2) {
        const boss = room.boss; let damage = player.baseDamage + (player.damageBuffHits > 0 ? player.damageBuff : 0);
        if (hasSkill(player, 'boss_hunter')) damage = Math.round(damage * 1.5);
        if (boss.hp / boss.maxHp <= .35 && hasSkill(player, 'executioner')) damage += 2;
        boss.hp = Math.max(0, boss.hp - damage);
        if (player.damageBuffHits > 0) { player.damageBuffHits--; if (player.damageBuffHits === 0) player.damageBuff = 0; }
        player.ws.send(JSON.stringify({ type: 'notice', text: 'Você causou ' + damage + ' de dano no Guardião!' }));
        const oldLifePhase = boss.lifePhase; boss.lifePhase = boss.hp / boss.maxHp > .66 ? 1 : boss.hp / boss.maxHp > .33 ? 2 : 3;
        if (boss.lifePhase !== oldLifePhase && boss.hp > 0)
          broadcast(room, { type: 'notice', text: 'O Guardião entrou na fase de vida ' + boss.lifePhase + ' / 3!' });
        if (boss.hp <= 0) {
          boss.alive = false; const dropped = grantLoot(player, 'boss');
          broadcast(room, { type: 'notice', text: 'CHEFE DERROTADO! Recompensa: ' + dropped.name + ' (' + dropped.rarity + ')' });
        }
      } else if (room.phase === 5 && room.boss && room.boss.alive) {
        player.ws.send(JSON.stringify({ type: 'notice', text: 'Chegue perto do Guardião para acertar o golpe.' }));
      }
      broadcast(room, { type: 'attack', id: player.id }); broadcast(room, state(room));
    } else if (msg.type === 'openChest') {
      if (!room.started || player.hp <= 0) return;
      const chest = room.chests.find(ch => ch.id === String(msg.id));
      if (!chest) return;
      if (Math.hypot(chest.x - player.x, chest.z - player.z) > 3.0) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Chegue mais perto do baú.' }));
        return;
      }
      if (chest.openedBy.includes(player.id)) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Você já pegou o loot deste baú.' }));
        return;
      }
      chest.openedBy.push(player.id);
      const dropped = grantLoot(player, 'chest');
      ws.send(JSON.stringify({ type: 'notice', text: 'Baú: ' + dropped.name + ' (' + dropped.rarity + ')' }));
      broadcast(room, state(room));
    } else if (msg.type === 'leave') {
      const oldCode = player.room;
      room.players.delete(player.id);
      if (room.hostId === player.id) room.hostId = room.players.keys().next().value || null;
      if (room.players.size === 0) {
        if (room.started) room.emptySince = Date.now();
        else rooms.delete(oldCode);
      }
      player.room = null;
      broadcast(room, state(room));
    }
  });

  ws.on('close', () => {
    const room = player.room && rooms.get(player.room);
    if (room) {
      room.players.delete(player.id);
      if (room.hostId === player.id) room.hostId = room.players.keys().next().value || null;
      broadcast(room, state(room));
      if (room.players.size === 0) {
        if (room.started) room.emptySince = Date.now();
        else rooms.delete(player.room);
      }
    }
  });
});

setInterval(() => {
  for (const [roomCode, room] of rooms.entries()) {
    if (room.started && room.players.size === 0) {
      if (!room.emptySince) room.emptySince = Date.now();
      if (Date.now() - room.emptySince > 120000) { rooms.delete(roomCode); continue; }
    }
    if (!room.started || room.players.size === 0) continue;
    const players = [...room.players.values()];
    const now = Date.now();
    if (room.safeZoneUntil && now >= room.safeZoneUntil) {
      room.safeZoneUntil = 0;
      broadcast(room, { type: 'notice', text: 'A zona segura terminou. Prepare-se para os inimigos!' });
      broadcast(room, state(room));
    }
    if (now < (room.safeZoneUntil || 0)) {
      if (now >= (room.nextSafeBroadcast || 0)) {
        room.nextSafeBroadcast = now + 500;
        broadcast(room, state(room));
      }
      continue;
    }
    for (const p of players) { if (hasSkill(p, 'regeneration') && p.hp > 0 && p.hp < p.maxHp && now >= (p.nextRegenAt || 0)) { p.hp = Math.min(p.maxHp, p.hp + 2); p.nextRegenAt = now + 3000; } }

    for (const monster of room.monsters) {
      if (!monster.alive) continue;
      if (!monster.spawned) {
        if (Date.now() >= monster.spawnAt) {
          monster.spawned = true;
          broadcast(room, { type: 'monsterSpawn', id: monster.id });
          broadcast(room, state(room));
        } else continue;
      }

      let target = null;
      let nearest = Infinity;

      for (const player of players) {
        if (player.hp <= 0) continue;
        const distance = Math.hypot(
          player.x - monster.x,
          player.z - monster.z
        );

        if (distance < nearest) {
          nearest = distance;
          target = player;
        }
      }

      if (target && nearest > 1.8 && nearest < 40) {
        const dx = target.x - monster.x;
        const dz = target.z - monster.z;
        const distance = Math.hypot(dx, dz);

        if (distance > 0) {
          const speed = (monster.kind === 'brute' ? 0.18 : monster.kind === 'wraith' ? 0.24 : 0.21) * (room.phase >= 4 ? 1.08 : 1);

          monster.x += (dx / distance) * speed;
          monster.z += (dz / distance) * speed;

          monster.x = Math.max(-13, Math.min(13, monster.x));
          monster.z = Math.max(-170, Math.min(8, monster.z));
        }
      }
      if (target && nearest <= 2.0 && Date.now() - (monster.attackAt || 0) > 1900) {
        monster.attackAt = Date.now();
        broadcast(room, { type: 'monsterAttack', id: monster.id, targetId: target.id });
        takeDamage(room, target, 4);
        target.ws.send(JSON.stringify({ type: 'notice', text: 'Um monstro acertou você! -4 de vida.' }));
        if (target.hp <= 0) {
          target.hp = 0;
          target.ws.send(JSON.stringify({ type: 'notice', text: 'Você foi derrotado. Não há renascimento automático nesta partida.' }));
        }
      }
    }

    // Dano de queimadura ao longo do tempo, processado pelo servidor.
    for (const enemy of [...room.monsters, ...(room.boss ? [room.boss] : [])]) {
      if (!enemy.alive || !enemy.burnUntil || Date.now() < (enemy.burnNextAt || 0)) continue;
      if (Date.now() > enemy.burnUntil) { enemy.burnUntil = 0; continue; }
      enemy.hp = Math.max(0, (enemy.hp || 1) - 1);
      enemy.burnNextAt = Date.now() + 1000;
      if (enemy.hp <= 0) {
        enemy.alive = false;
        const owner = players[0];
        if (owner) {
          if (enemy === room.boss) {
            const dropped = grantLoot(owner, 'boss');
            broadcast(room, { type: 'notice', text: 'CHEFE DERROTADO PELA QUEIMADURA! Recompensa: ' + dropped.name + ' (' + dropped.rarity + ')' });
          } else if (Math.random() < dropChance(owner, .25)) grantLoot(owner, 'monster');
        }
      }
    }

    if (room.phase === 5 && room.boss && room.boss.alive) {
      const boss = room.boss; let target = null, nearest = Infinity;
      for (const p of players) { if (p.hp <= 0) continue; const d = Math.hypot(p.x - boss.x, p.z - boss.z); if (d < nearest) { nearest = d; target = p; } }
      if (target && nearest > 2.35 && nearest < 24) {
        const dx = target.x - boss.x, dz = target.z - boss.z, distance = Math.hypot(dx, dz) || 1;
        const speed = boss.lifePhase === 1 ? 0.09 : boss.lifePhase === 2 ? 0.12 : 0.16;
        boss.x = Math.max(-12, Math.min(12, boss.x + dx / distance * speed));
        boss.z = Math.max(-156, Math.min(-144, boss.z + dz / distance * speed));
      }
      if (target && nearest <= 2.8 && Date.now() - boss.attackAt > (boss.lifePhase === 3 ? 800 : 1200)) {
        boss.attackAt = Date.now();
        takeDamage(room, target, boss.lifePhase === 3 ? 22 : 14);
        target.ws.send(JSON.stringify({ type: 'notice', text: 'O Guardião acertou você! -' + (boss.lifePhase === 3 ? 22 : 14) + ' de vida.' }));
        if (target.hp <= 0) {
          target.hp = 0;
          target.ws.send(JSON.stringify({ type: 'notice', text: 'Você foi derrotado. Não há renascimento automático nesta partida.' }));
        }
      }
    }
    broadcast(room, state(room));
  }
}, 150);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Masmorra Monocromática online na porta ' + PORT);
});
  
