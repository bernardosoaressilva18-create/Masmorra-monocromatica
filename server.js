
const http = require('http');
const crypto = require('crypto');
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

const wss = new WebSocket.Server({ server, maxPayload: 32 * 1024 });
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
  archer: { hp: 108, damage: 1, range: 4.8, attackMs: 310, spellPower: 1, reduction: .03 },
  goblin: { hp: 95, damage: 1, range: 3.2, attackMs: 285, spellPower: .85, reduction: 0 },
  ogre: { hp: 180, damage: 4, range: 3.5, attackMs: 760, spellPower: .7, reduction: .20 },
  healer: { hp: 100, damage: 2, range: 8.2, attackMs: 620, spellPower: 1.1, reduction: .02 },
  necromancer: { hp: 90, damage: 2, range: 7.6, attackMs: 650, spellPower: 1.2, reduction: 0 },
  monk: { hp: 110, damage: 2, range: 2.8, attackMs: 530, spellPower: 1, reduction: .07 }
};
const SKILL_BRANCHES = {
  attack: ['mighty_blows','swift_hands','executioner','boss_hunter','longshot'],
  defense: ['vitality','iron_skin','regeneration','second_wind','party_guard'],
  arcane: ['arcane_mastery','ember_core','storm_bond','treasure_luck','swift_step'],
  mobility: ['dodge_mastery','quick_recovery','hunter_instinct','battle_focus','phantom_step'],
  support: ['healing_aura','loot_sense','mana_surge','team_resolve','final_blessing']
};
const SKILL_BRANCH_BY_ID = Object.fromEntries(Object.entries(SKILL_BRANCHES).flatMap(([branch, ids]) => ids.map(id => [id, branch])));
const VALID_SKILLS = new Set(Object.values(SKILL_BRANCHES).flat());
const SKILL_REQUIREMENTS = {
  swift_hands:'mighty_blows', executioner:'swift_hands', boss_hunter:'executioner', longshot:'boss_hunter',
  iron_skin:'vitality', regeneration:'iron_skin', second_wind:'regeneration', party_guard:'second_wind',
  ember_core:'arcane_mastery', storm_bond:'ember_core', treasure_luck:'storm_bond', swift_step:'treasure_luck',
  quick_recovery:'dodge_mastery', hunter_instinct:'quick_recovery', battle_focus:'hunter_instinct', phantom_step:'battle_focus',
  loot_sense:'healing_aura', mana_surge:'loot_sense', team_resolve:'mana_surge', final_blessing:'team_resolve'
};
function hasSkill(player, id) { return !!player.skills && player.skills.includes(id); }
function canUnlockSkill(player, id) {
  if (!VALID_SKILLS.has(id) || !Array.isArray(player.skills) || player.skills.includes(id) || player.skills.length >= 15) return false;
  const req = SKILL_REQUIREMENTS[id];
  if (req && !player.skills.includes(req)) return false;
  const usedBranches = new Set(player.skills.map(skill => SKILL_BRANCH_BY_ID[skill]).filter(Boolean));
  const branch = SKILL_BRANCH_BY_ID[id];
  return !!branch && (usedBranches.has(branch) || usedBranches.size < 3);
}
function spawnNecromancerSkeleton(room, player, hp = 15, x = player.x, z = player.z, expiresAt = 0, maxOwned = 10, damage = 2, attackMs = 1000) {
  room.summons = room.summons || [];
  const owned = room.summons.filter(s => s.ownerId === player.id && s.summonType === 'skeleton' && s.hp > 0 && (!s.expiresAt || s.expiresAt > Date.now()));
  if (owned.length >= maxOwned) return null;
  const angle = (owned.length % 8) * Math.PI / 4;
  const summon = {
    id: 'skeleton-' + player.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    ownerId: player.id, summonType: 'skeleton', name: 'Esqueleto aliado',
    playerClass: 'skeleton', skin: player.skin || 'shadow', color: 0xe0dccb,
    x: Math.max(-12.5, Math.min(12.5, x + Math.cos(angle) * .75)),
    z: Math.max(-170, Math.min(7.5, z + Math.sin(angle) * .75)),
    rot: player.rot || 0, hp, maxHp: hp, damage, attackMs,
    nextAttackAt: Date.now() + 700, expiresAt: expiresAt || 0
  };
  room.summons.push(summon);
  return summon;
}
function handleSummonDefeat(room, summon, target) {
  if (!target || !target.alive) return;
  target.alive = false;
  const owner = room.players.get(summon.ownerId);
  if (!owner || owner.connected === false) return;
  if (target === room.boss) {
    const dropped = grantLoot(owner, 'boss');
    broadcast(room, { type: 'notice', text: 'CHEFE DERROTADO! Recompensa: ' + dropped.name + ' (' + dropped.rarity + ')' });
    if (room.realm === 1) broadcast(room, { type: 'notice', text: '✦ O portão do Vale Astral despertou no fundo do Abismo!' });
  } else if (target.cursed) {
    const prize = { id: String(Date.now()) + '-curse-summon', name: 'Cristal Ancestral', rarity: 'lendário', value: 16, power: 5, source: 'cursed-chest' };
    owner.lootDrops.push(prize);
    owner.inventory['lendário'] = (owner.inventory['lendário'] || 0) + 1;
    sendInventory(owner);
    if (owner.ws && owner.ws.readyState === WebSocket.OPEN) owner.ws.send(JSON.stringify({ type: 'loot', item: prize }));
    room.cursedBoss = null;
    broadcast(room, { type: 'notice', text: 'MINI-CHEFE DERROTADO! Cristal Ancestral LENDÁRIO recebido!' });
  } else if (Math.random() < dropChance(owner, .2)) grantLoot(owner, 'monster');
}

function statsFor(player) { return CLASS_STATS[player.playerClass] || CLASS_STATS.knight; }
function maxHealthFor(player) { return statsFor(player).hp + (hasSkill(player, 'vitality') ? 25 : 0) + (hasSkill(player, 'final_blessing') ? 15 : 0); }
function refreshPlayerStats(player, restoreHealth = false) {
  const oldMax = player.maxHp || 100; player.maxHp = maxHealthFor(player);
  player.baseDamage = statsFor(player).damage + (hasSkill(player, 'mighty_blows') ? 1 : 0) + (hasSkill(player, 'hunter_instinct') ? 1 : 0) + (player.equipmentDamage || 0);
  if (restoreHealth) player.hp = player.maxHp;
  else player.hp = Math.min(player.maxHp, Math.max(0, (player.hp || 0) + Math.max(0, player.maxHp - oldMax)));
}
function dropChance(player, base) { return Math.min(.9, base + (hasSkill(player, 'treasure_luck') ? .2 : 0) + (hasSkill(player, 'loot_sense') ? .1 : 0)); }
function takeDamage(room, player, amount) {
  // A esquiva é validada pelo servidor e concede uma janela curta contra dano.
  if (Date.now() < (player.dodgeUntil || 0)) return 0;
  let damage = amount * (1 - (statsFor(player).reduction || 0));
  if (hasSkill(player, 'iron_skin')) damage *= .8;
  if (Date.now() < (player.shieldUntil || 0)) damage *= .35;
  const nearbyAlly = [...room.players.values()].some(other => other.connected !== false && other.id !== player.id && other.hp > 0 && Math.hypot(other.x-player.x, other.z-player.z) <= 7);
  if (hasSkill(player, 'party_guard') && nearbyAlly) damage *= .9;
  if (hasSkill(player, 'team_resolve') && nearbyAlly) damage *= .85;
  const hpBefore = player.hp;
  const appliedDamage = Math.max(1, Math.round(damage));
  player.hp = Math.max(0, player.hp - appliedDamage);
  if (player.hp <= 0 && hasSkill(player, 'second_wind') && !player.secondWindUsed) {
    player.secondWindUsed = true; player.hp = Math.max(1, Math.ceil(player.maxHp * .3));
    player.ws.send(JSON.stringify({ type: 'notice', text: '🌟 Segunda chance! Você voltou com 30% da vida.' }));
  }
  if (hpBefore > player.hp) {
    broadcast(room, { type: 'playerDamaged', id: player.id, amount: appliedDamage, hp: player.hp, maxHp: player.maxHp });
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

function createWave(phase,realm=1){
 const original={1:['stalker','stalker','brute','stalker','brute'],2:['wraith','stalker','wraith','brute','wraith','brute'],3:['thorn','thorn','brute','wraith','thorn','brute','wraith'],4:['inferno','brute','inferno','wraith','brute','inferno','wraith','brute'],5:['abyss','abyss','brute','abyss','wraith','abyss','brute','abyss','wraith']};
 const astral={1:['wraith','thorn','stalker','wraith','brute','thorn'],2:['thorn','inferno','wraith','thorn','brute','wraith','inferno'],3:['abyss','thorn','wraith','abyss','brute','thorn','inferno','wraith'],4:['inferno','abyss','brute','wraith','inferno','thorn','abyss','brute','wraith'],5:['abyss','abyss','inferno','brute','abyss','wraith','inferno','abyss','brute']};
 const kindsByPhase=realm===2?astral:original,count=phase===1?(realm===2?6:5):6+phase+(realm===2?1:0),kinds=kindsByPhase[phase]||kindsByPhase[5],center=-((phase-1)*32+14),now=Date.now();
 return Array.from({length:count},(_,i)=>{const kind=kinds[i%kinds.length],base=phase===1?5:7+phase*2,scale=realm===2?1.3:1,hp=Math.round(((kind==='brute'?base*2:base)+(phase-1)*2)*scale);return{id:'r'+realm+'p'+phase+'m'+i,kind,phase,realm,x:(Math.random()-.5)*22,z:center+(Math.random()-.5)*8,spawned:false,spawnAt:now+i*1700,alive:true,hp,maxHp:hp,attackAt:0};});
}
function advancePhase(room) {
  if (room.phase >= 5) return;
  const names=room.realm===2?['','Jardins Estelares','Ponte do Vazio','Bosque de Cristal','Coroa Celeste','Trono Astral']:['','Cripta Esquecida','Cavernas Mágicas','Floresta Amaldiçoada','Terras Vulcânicas','Abismo Final'];
  room.phase++;
  room.safeZoneUntil = Date.now() + 20000;
  room.nextSafeBroadcast = 0;
  for (const player of room.players.values()) {
    player.talentPoints = (player.talentPoints || 0) + 1;
    const before = player.hp;
    player.hp = Math.min(player.maxHp || 100, player.hp + 15);
    if (player.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify({ type: 'notice', text: '✦ Zona segura por 20 segundos! +1 ponto de skill e +' + (player.hp - before) + ' de vida. Abra ÁRVORE DE SKILLS.' }));
  }
  room.monsters = createWave(room.phase, room.realm || 1);
  room.boss = null;
  if (room.phase === 5) {
    room.monsters = [];
    // Chefe final reforçado: a vida é maior e escala com o grupo presente.
    // A vida é autoritativa no servidor; a interface recebe hp/maxHp pelo estado normal.
    const bossPartySize = Math.max(1, [...room.players.values()]
      .filter(p => p.connected !== false && p.hp > 0).length);
    const bossBaseHp = room.realm === 2 ? 700 : 450;
    const bossExtraPlayerHp = room.realm === 2 ? 150 : 100;
    const bossHp = bossBaseHp + (bossPartySize - 1) * bossExtraPlayerHp;
    room.boss={id:'realm-'+(room.realm||1)+'-final-boss',x:0,z:-150,alive:true,hp:bossHp,maxHp:bossHp,lifePhase:1,attackAt:0};
    broadcast(room, { type: 'notice', text: 'FASE 5: ' + names[5] + '! O Guardião Supremo despertou com carapaça reforçada e ' + bossHp + ' de vida!' });
  } else {
    broadcast(room, { type: 'notice', text: 'MUNDO ' + room.phase + ' / 5: ' + names[room.phase] + '. Nova região descoberta!' });
  }
}

function enterAstralRealm(room){
 room.realm=2;room.phase=1;room.monsters=createWave(1,2);room.boss=null;room.cursedBoss=null;room.safeZoneUntil=Date.now()+15000;room.nextSafeBroadcast=0;
 room.chests=[{id:'c0',x:-8,z:-12,openedBy:[]},{id:'c1',x:8,z:-44,openedBy:[]},{id:'c2',x:-8,z:-76,openedBy:[]},{id:'c3',x:8,z:-108,openedBy:[]},{id:'c4',x:8,z:-140,openedBy:[]}];
 for(const p of room.players.values()){p.x=0;p.z=3;p.rot=0;p.talentPoints=Math.min(20,(p.talentPoints||0)+2);p.hp=Math.min(p.maxHp||100,p.hp+20);if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify({type:'notice',text:'✦ PORTÃO ABERTO! Você chegou ao Vale Astral: mapa independente, novos inimigos e +2 pontos de skill.'}));}
 broadcast(room,state(room));
}

function newRoom(code, hostId, isPublic = false) {
  const room = { isPublic, players: new Map(), hostId, started: false, realm: 1, phase: 1, monsters: createWave(1,1), summons: [], boss: null, bossAttackAt: 0, safeZoneUntil: 0, nextSafeBroadcast: 0, emptySince: 0, cursedBoss: null, cursedBossAttackAt: 0,
    chests: [
      { id: 'c0', x: -8, z: -12, openedBy: [] },
      { id: 'c1', x: 8, z: -44, openedBy: [] },
      { id: 'c2', x: -8, z: -76, openedBy: [] },
      { id: 'c3', x: 8, z: -108, openedBy: [] },
      { id: 'c4', x: 8, z: -140, openedBy: [] }
    ] };
  room.code = code; rooms.set(code, room); return room;
}

function broadcast(room, message) {
  const data = JSON.stringify(message);
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}

function ensureRoomHost(room) {
  const currentHost = room.hostId ? room.players.get(room.hostId) : null;
  if (!currentHost || currentHost.connected === false) {
    room.hostId = [...room.players.values()].find(p => p.connected !== false)?.id || null;
  }
}

const STATIC_DUNGEON_COLLIDERS = (() => {
  const list = [];
  for (let z = -30; z <= 8; z += 9) {
    for (const x of [-10, 10]) list.push({ x, z, r: 0.88 });
  }
  for (const z of [-31.8, -63.8, -95.8, -127.8]) {
    for (const x of [-3.4, 3.4]) list.push({ x, z, r: 0.48 });
  }
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    list.push({ x: Math.cos(a) * 2, z: -16 + Math.sin(a) * 2, r: 0.38 });
  }
  return list;
})();
function isServerPositionBlocked(room, x, z) {
  const playerRadius = 0.43;
  // Colisores de pilares são exclusivos do mundo original.
  if ((room.realm || 1) !== 2) {
    for (const obstacle of STATIC_DUNGEON_COLLIDERS) {
      if (Math.hypot(x - obstacle.x, z - obstacle.z) < playerRadius + obstacle.r) return true;
    }
  }
  for (const chest of room.chests || []) {
    if (Math.hypot(x - chest.x, z - chest.z) < playerRadius + 0.62) return true;
  }
  return false;
}
function resolveServerMovement(room, player, nextX, nextZ) {
  let x = Math.max(-13, Math.min(13, nextX));
  let z = Math.max(-174, Math.min(8, nextZ));
  if (isServerPositionBlocked(room, x, player.z)) x = player.x;
  if (isServerPositionBlocked(room, x, z)) z = player.z;
  return { x, z };
}

function state(room) {
  // Evita que uma sala fique sem anfitrião após uma saída ou reconexão.
  ensureRoomHost(room);
  return {
    type: 'state',
    players: [...room.players.values()].filter(p => p.connected !== false).map(p => ({
      id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot, color: p.color, hp: p.hp, maxHp: p.maxHp, playerClass: p.playerClass, skin: p.skin, skills: p.skills, talentPoints: p.talentPoints, ready: !!p.ready, isHost: p.id === room.hostId,
      invisible: Date.now() < (p.invisibleUntil || 0), shielded: Date.now() < (p.shieldUntil || 0), ogreHasteUntil: p.ogreHasteUntil || 0
    })),
    summons: (room.summons || []).filter(s => s.hp > 0 && (!s.expiresAt || s.expiresAt > Date.now())).map(s => ({ id: 'summon:' + s.id, name: s.name || (s.summonType === 'skeleton' ? 'Esqueleto aliado' : 'Goblin aliado'), x: s.x, z: s.z, rot: s.rot || 0, color: s.color || 0x80c86b, hp: s.hp, maxHp: s.maxHp, playerClass: s.playerClass || (s.summonType === 'skeleton' ? 'skeleton' : 'goblin'), skin: s.skin || 'default', summon: true, summonType: s.summonType || 'goblin' })),
    phase: room.phase,
    realm: room.realm || 1,
    safeZoneUntil: room.safeZoneUntil || 0,
    started: room.started,
    hostId: room.hostId,
    monsters: [...room.monsters, ...(room.cursedBoss && room.cursedBoss.alive ? [room.cursedBoss] : [])],
    boss: room.boss,
    chests: room.chests.map(chest => ({ id: chest.id, x: chest.x, z: chest.z, opened: chest.openedBy.length > 0, cursed: !!chest.cursed }))
  };
}

wss.on('connection', ws => {
  let player = {
  id: String(nextId++),
  ws, connected: true, disconnectedAt: 0, resumeToken: crypto.randomBytes(24).toString('hex'),
  rateWindowStartedAt: Date.now(), rateMessageCount: 0, nextDodgeAt: 0, dodgeUntil: 0,
  shieldUntil: 0, invisibleUntil: 0, ogreHasteUntil: 0, abilityCooldowns: {},
  name: 'Aventureiro', x: 0, z: 3, rot: 0,
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
    if (player.ws !== ws) return;
    const rateNow = Date.now();
    if (rateNow - (player.rateWindowStartedAt || 0) >= 1000) {
      player.rateWindowStartedAt = rateNow;
      player.rateMessageCount = 0;
    }
    player.rateMessageCount = (player.rateMessageCount || 0) + 1;
    if (player.rateMessageCount > 90) {
      try { ws.close(1008, 'Too many messages'); } catch {}
      return;
    }
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return;

    if (msg.type === 'ping') {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'pong', sentAt: Number(msg.sentAt) || 0 }));
      return;
    }

    if (msg.type === 'listPublicRooms') {
      const list = [...rooms.values()]
        .filter(r => {
          if (!r.isPublic || r.started || r.players.size >= 4) return false;
          const active = [...r.players.values()].filter(p => p.connected !== false).length;
          return active > 0 && active < 4;
        })
        .map(r => ({ code: r.code, players: [...r.players.values()].filter(p => p.connected !== false).length, maxPlayers: 4 }));
      ws.send(JSON.stringify({ type: 'publicRooms', rooms: list }));
      return;
    }

    if (msg.type === 'joinPublic') {
      let room = [...rooms.values()].find(r =>
        r.isPublic && !r.started && r.players.size < 4 &&
        [...r.players.values()].filter(p => p.connected !== false).length < 4
      );
      if (!room) {
        let code;
        do { code = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(code));
        room = newRoom(code, player.id, true);
        room.code = code;
      }
      msg.code = room.code;
      msg.public = true;
      msg.type = 'join';
    }

    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
        || Math.random().toString(36).slice(2, 8).toUpperCase();

      if (player.room) {
        const oldCode = player.room;
        const old = rooms.get(oldCode);
        if (old) {
          old.players.delete(player.id);
          ensureRoomHost(old);
          if (old.players.size === 0 && !old.started) {
            rooms.delete(oldCode);
          } else {
            broadcast(old, state(old));
          }
        }
        player.room = null;
      }

      let room = rooms.get(code);
      if (!room) room = newRoom(code, player.id, !!msg.public);
      if (msg.public) { room.isPublic = true; room.code = code; }

      // Um token aleatório permite recuperar o mesmo personagem após uma queda breve.
      const requestedToken = typeof msg.resumeToken === 'string' ? msg.resumeToken : '';
      const savedPlayer = requestedToken
        ? [...room.players.values()].find(p => p.resumeToken === requestedToken && p.connected === false)
        : null;
      const resumed = !!savedPlayer;

      if (resumed) {
        player = savedPlayer;
        player.ws = ws;
        player.connected = true;
        player.disconnectedAt = 0;
      } else {
        player.room = code;
        player.connected = true;
        player.disconnectedAt = 0;
        player.name = String(msg.name || 'Aventureiro').slice(0, 18);
        player.playerClass = ['knight','mage','archer','goblin','ogre','healer','necromancer','monk'].includes(msg.playerClass || msg.class) ? (msg.playerClass || msg.class) : 'knight';
        player.skin = ['default','shadow','ember','rune','celestial','bloodmoon'].includes(msg.skin) ? msg.skin : 'default';
        // Habilidades e pontos iniciais são autoritativos no servidor; não confiar no loadout enviado pelo navegador.
        player.skills = [];
        player.equipmentDamage = 0;
        player.talentPoints = room.realm === 2
          ? Math.min(20, 11 + Math.max(0, room.phase - 1))
          : Math.min(20, 5 + Math.max(0, room.phase - 1));
        player.secondWindUsed = false;
        player.x = 0; player.z = room.started ? -((room.phase - 1) * 32 + 1) : 3; player.ready = false;
        player.damageBuff = 0; player.damageBuffHits = 0; player.nextAttackAt = 0;
        player.nextDodgeAt = 0; player.dodgeUntil = 0;
        refreshPlayerStats(player, true);
        room.players.set(player.id, player);
      }

      // Se o anfitrião anterior saiu ou deixou um ID inválido, promover alguém conectado.
      ensureRoomHost(room);
      if (!room.hostId) room.hostId = player.id;
      room.emptySince = 0;
      ws.send(JSON.stringify({ type: 'joined', id: player.id, room: code, resumeToken: player.resumeToken, resumed }));
      broadcast(room, { type: 'notice', text: resumed ? player.name + ' reconectou.' : player.name + ' entrou na sala.' });
      broadcast(room, state(room));
      sendInventory(player);
      return;
    }

    const room = player.room && rooms.get(player.room);
    if (!room) return;

    if (msg.type === 'necromancerDiveTarget') {
      if (player.playerClass !== 'necromancer' || !player.necromancerDivePending || Date.now() > (player.necromancerDiveUntil || 0) || player.hp <= 0) return;
      const oldX = Number(player.necromancerDiveOriginX);
      const oldZ = Number(player.necromancerDiveOriginZ);
      let requestedX = Math.max(-12, Math.min(12, Number(msg.x) || 0));
      let requestedZ = Math.max(-168, Math.min(5, Number(msg.z) || 0));

      // O destino é validado diretamente, pois resolveServerMovement foi feito
      // para passos curtos e pode recuar o ponto de aterrissagem para perto da origem.
      const minDiveDistance = 145;
      const landingDistance = point => Math.hypot(point.x - oldX, point.z - oldZ);
      const clickDistance = Math.hypot(requestedX - oldX, requestedZ - oldZ);
      const angle = clickDistance > 0.001 ? Math.atan2(requestedZ - oldZ, requestedX - oldX) : (player.rot || 0);
      let landing = null;
      if (clickDistance >= minDiveDistance && !isServerPositionBlocked(room, requestedX, requestedZ)) {
        landing = { x: requestedX, z: requestedZ };
      } else {
        // Procura primeiro uma área segura próxima à direção escolhida; nunca
        // aceita silenciosamente um ponto a menos da distância mínima configurada.
        let bestScore = Infinity;
        for (let step = 0; step < 72; step++) {
          const a = angle + (Math.PI * 2 * step) / 72;
          for (let radius = minDiveDistance; radius <= 172; radius += 3) {
            const x = Math.max(-12, Math.min(12, oldX + Math.cos(a) * radius));
            const z = Math.max(-168, Math.min(5, oldZ + Math.sin(a) * radius));
            const candidate = { x, z };
            const distance = landingDistance(candidate);
            if (distance < minDiveDistance - 0.5 || isServerPositionBlocked(room, x, z)) continue;
            const score = Math.hypot(x - requestedX, z - requestedZ) + Math.abs(distance - Math.max(minDiveDistance, clickDistance)) * 0.18;
            if (score < bestScore) {
              bestScore = score;
              landing = candidate;
            }
          }
        }
      }
      if (!landing || landingDistance(landing) < minDiveDistance - 0.5) {
        player.necromancerDivePending = false;
        player.necromancerDiveUntil = 0;
        player.invisibleUntil = 0;
        if (player.ws && player.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify({ type: 'notice', text: 'Não encontrei espaço livre longe o bastante. Tente tocar em outra área.' }));
        return;
      }
      player.x = landing.x; player.z = landing.z;
      player.necromancerDivePending = false;
      player.necromancerDiveUntil = 0;
      player.invisibleUntil = 0;
      spawnNecromancerSkeleton(room, player, 10, Number.isFinite(oldX) ? oldX : player.x, Number.isFinite(oldZ) ? oldZ : player.z, Date.now() + 18000, 10, 3, 900);
      broadcast(room, { type: 'classAbility', id: player.id, ability: 'necromancer_dive_arrive', x: player.x, z: player.z, center: { x: oldX, z: oldZ }, targets: [], text: '🦴 Você emergiu e deixou um esqueleto guardando o local de origem!' });
      broadcast(room, state(room));
      return;
    }

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
      if ([...room.players.values()].some(p => p.connected !== false && !p.ready)) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Todos os jogadores precisam clicar em PRONTO.' }));
        return;
      }
      room.started = true;
      broadcast(room, { type: 'notice', text: 'A partida começou! Boa sorte, aventureiros.' });
      broadcast(room, state(room));
    } else if (msg.type === 'loadout') {
      const wantedClass = ['knight','mage','archer','goblin','ogre','healer','necromancer','monk'].includes(msg.playerClass) ? msg.playerClass : player.playerClass;
      const wantedSkin = ['default','shadow','ember','rune','celestial','bloodmoon'].includes(msg.skin) ? msg.skin : player.skin;
      if (room.started && (wantedClass !== player.playerClass || wantedSkin !== player.skin)) return;
      const proposed = Array.isArray(msg.skills) ? msg.skills.filter(id => VALID_SKILLS.has(id)) : [];
      for (const id of proposed) {
        if (player.skills.includes(id)) continue;
        if (player.talentPoints <= 0) break;
        if (!canUnlockSkill(player, id)) continue;
        player.skills.push(id); player.talentPoints--;
      }
      player.playerClass = wantedClass; player.skin = wantedSkin;
      refreshPlayerStats(player, !room.started);
      broadcast(room, state(room));
    } else if (msg.type === 'move') {
      if (!room.started || player.hp <= 0 || player.necromancerDivePending) return;
      const requestedX = Math.max(-13, Math.min(13, Number(msg.x) || 0));
      const requestedZ = Math.max(-174, Math.min(8, Number(msg.z) || 0));
      const collisionResolved = resolveServerMovement(room, player, requestedX, requestedZ);
      player.x = collisionResolved.x;
      const gateZ=room.phase<5?-(30+(room.phase-1)*32):-163.2;
      const enemiesAlive=room.phase===5?!!(room.boss&&room.boss.alive):room.monsters.some(m=>m.alive);
      if(room.phase===5&&requestedZ<gateZ&&room.boss&&room.boss.alive){
        player.z=gateZ+.9;
        if(Date.now()-player.lastGateNotice>1800){
          player.lastGateNotice=Date.now();
          const gateText=room.realm===1?'O portão do Vale Astral está selado! Derrote o Guardião Supremo.':'O portão final está selado! Derrote o Guardião Astral.';
          player.ws.send(JSON.stringify({type:'notice',text:gateText}));
        }
      }else if(room.realm===1&&room.phase===5&&requestedZ<gateZ&&room.boss&&!room.boss.alive){enterAstralRealm(room);}
      else if(room.phase<5&&requestedZ<gateZ&&enemiesAlive){
        player.z = gateZ + 0.7;
        if (Date.now() - player.lastGateNotice > 1800) {
          player.lastGateNotice = Date.now();
          player.ws.send(JSON.stringify({ type: 'notice', text: 'O portão está selado! Derrote todos os monstros desta fase.' }));
        }
      } else {
        player.z = collisionResolved.z;
        if (room.phase < 5 && requestedZ < gateZ) advancePhase(room);
      }
      player.rot = Number(msg.rot) || 0;
      // O loop do servidor já envia o estado a cada 100 ms; evitar duplicar
      // um pacote completo a cada movimento reduz tráfego e desconexões.
    } else if (msg.type === 'dodge') {
      if (!room.started || player.hp <= 0) return;
      const dodgeNow = Date.now();
      if (dodgeNow < (player.nextDodgeAt || 0)) return;
      const requestedHeading = Number(msg.rot);
      const heading = Number.isFinite(requestedHeading) ? requestedHeading : (Number(player.rot) || 0);
      const dashDistance = 2.2 + (hasSkill(player, 'dodge_mastery') ? .55 : 0) + (hasSkill(player, 'phantom_step') ? .75 : 0);
      const landing = resolveServerMovement(room, player,
        player.x - Math.sin(heading) * dashDistance,
        player.z - Math.cos(heading) * dashDistance
      );
      player.x = landing.x;
      player.z = landing.z;
      player.rot = heading;
      player.dodgeUntil = dodgeNow + 420 + (hasSkill(player, 'dodge_mastery') ? 140 : 0) + (hasSkill(player, 'phantom_step') ? 120 : 0);
      player.nextDodgeAt = dodgeNow + Math.max(1500, 2600 - (hasSkill(player, 'quick_recovery') ? 650 : 0));
      if (player.ws.readyState === WebSocket.OPEN) player.ws.send(JSON.stringify({
        type: 'notice', text: '↗ Esquiva! Proteção ativada por um instante.'
      }));
      broadcast(room, { type: 'dodge', id: player.id, x: player.x, z: player.z, until: player.dodgeUntil });
      broadcast(room, state(room));
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
    } else if (msg.type === 'classAbility') {
      if (!room.started || player.hp <= 0) return;
      if (Date.now() < (room.safeZoneUntil || 0)) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Zona segura: habilidades de combate ficam disponíveis quando a luta começar.' }));
        return;
      }
      const ability = typeof msg.ability === 'string' ? msg.ability : '';
      const abilityClass = {
        knight_shield: 'knight', knight_dash: 'knight',
        arrow_rain: 'archer', incendiary_arrows: 'archer',
        goblin_invis: 'goblin', goblin_summon: 'goblin',
        ogre_slam: 'ogre', ogre_haste: 'ogre',
        healer_cure: 'healer', healer_guardian_spirits: 'healer',
        necromancer_summon: 'necromancer', necromancer_dive: 'necromancer',
        monk_impact_palm: 'monk', monk_winged_steps: 'monk'
      };
      const cooldownMs = {
        knight_shield: 12000, knight_dash: 9000,
        arrow_rain: 8000, incendiary_arrows: 12000,
        goblin_invis: 14000, goblin_summon: 20000,
        ogre_slam: 10000, ogre_haste: 15000,
        healer_cure: 23000, healer_guardian_spirits: 40000,
        necromancer_summon: 30000, necromancer_dive: 15000,
        monk_impact_palm: 18000, monk_winged_steps: 15000
      };
      if (abilityClass[ability] !== player.playerClass) return;
      const now = Date.now();
      player.abilityCooldowns = player.abilityCooldowns || {};
      const remaining = (player.abilityCooldowns[ability] || 0) - now;
      if (remaining > 0) {
        ws.send(JSON.stringify({ type: 'notice', text: 'Habilidade recarregando: ' + Math.ceil(remaining / 1000) + 's.' }));
        return;
      }
      player.abilityCooldowns[ability] = now + cooldownMs[ability];
      const enemies = () => [...room.monsters, ...(room.cursedBoss && room.cursedBoss.alive ? [room.cursedBoss] : []), ...(room.boss && room.boss.alive ? [room.boss] : [])]
        .filter(enemy => enemy && enemy.alive && enemy.spawned !== false);
      const findCenter = (range) => {
        const target = enemies().filter(enemy => Math.hypot(enemy.x - player.x, enemy.z - player.z) <= range)
          .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
        if (target) return { x: target.x, z: target.z };
        const heading = Number(player.rot) || 0;
        return { x: player.x - Math.sin(heading) * 7, z: player.z - Math.cos(heading) * 7 };
      };
      const targets = [];
      const killEnemy = enemy => {
        if (enemy === room.boss) {
          const dropped = grantLoot(player, 'boss');
          broadcast(room, { type: 'notice', text: 'CHEFE DERROTADO! Recompensa: ' + dropped.name + ' (' + dropped.rarity + ')' });
          if (room.realm === 1) broadcast(room, { type: 'notice', text: '✦ O portão do Vale Astral despertou no fundo do Abismo!' });
        } else if (enemy.cursed) {
          const prize = { id: String(Date.now()) + '-curse', name: 'Cristal Ancestral', rarity: 'lendário', value: 16, power: 5, source: 'cursed-chest' };
          player.lootDrops.push(prize);
          player.inventory['lendário'] = (player.inventory['lendário'] || 0) + 1;
          sendInventory(player);
          player.ws.send(JSON.stringify({ type: 'loot', item: prize }));
          room.cursedBoss = null;
          broadcast(room, { type: 'notice', text: 'MINI-CHEFE DERROTADO! Cristal Ancestral LENDÁRIO recebido!' });
        } else if (Math.random() < dropChance(player, .25)) grantLoot(player, 'monster');
      };
      const damageEnemy = (enemy, amount, burnMs = 0, pushFrom = null, pushDistance = 0) => {
        if (!enemy || !enemy.alive) return;
        enemy.hp = Math.max(0, (enemy.hp || 1) - amount);
        if (burnMs > 0 && enemy.hp > 0) {
          enemy.burnUntil = Math.max(enemy.burnUntil || 0, now + burnMs);
          enemy.burnNextAt = Math.min(enemy.burnNextAt || now + 1000, now + 1000);
        }
        if (pushFrom && pushDistance > 0) {
          const dx = enemy.x - pushFrom.x, dz = enemy.z - pushFrom.z, dist = Math.hypot(dx, dz) || 1;
          enemy.x = Math.max(-13, Math.min(13, enemy.x + dx / dist * pushDistance));
          enemy.z = Math.max(-170, Math.min(8, enemy.z + dz / dist * pushDistance));
        }
        targets.push({ x: enemy.x, z: enemy.z, id: enemy.id });
        if (enemy.hp <= 0 && enemy.alive) {
          enemy.alive = false;
          killEnemy(enemy);
        }
      };
      let center = { x: player.x, z: player.z };
      let text = '';
      let until = 0;
      if (ability === 'knight_shield') {
        player.shieldUntil = now + 4200;
        until = player.shieldUntil;
        text = '🛡️ Escudo temporário! Dano recebido reduzido por 4,2 segundos.';
      } else if (ability === 'knight_dash') {
        const heading = Number(player.rot) || 0;
        const landing = resolveServerMovement(room, player,
          player.x - Math.sin(heading) * 4.2,
          player.z - Math.cos(heading) * 4.2);
        player.x = landing.x; player.z = landing.z; player.rot = heading;
        player.dodgeUntil = now + 250;
        center = { x: player.x, z: player.z };
        for (const enemy of enemies()) {
          if (Math.hypot(enemy.x - center.x, enemy.z - center.z) > 5.4) continue;
          damageEnemy(enemy, 5);
          if (enemy.alive) {
            const dx = enemy.x - center.x, dz = enemy.z - center.z, dist = Math.hypot(dx, dz) || 1;
            const pulledDistance = Math.max(.72, dist - 2.0);
            enemy.x = Math.max(-13, Math.min(13, center.x + dx / dist * pulledDistance));
            enemy.z = Math.max(-170, Math.min(8, center.z + dz / dist * pulledDistance));
            const last = targets[targets.length - 1];
            if (last && last.id === enemy.id) { last.x = enemy.x; last.z = enemy.z; }
          }
        }
        text = '⚔️ Avanço do cavaleiro! Você avançou, atraiu inimigos próximos e causou dano.';
      } else if (ability === 'arrow_rain' || ability === 'incendiary_arrows') {
        center = findCenter(14);
        const radius = ability === 'arrow_rain' ? 4.6 : 4.1;
        for (const enemy of enemies()) {
          if (Math.hypot(enemy.x - center.x, enemy.z - center.z) > radius) continue;
          damageEnemy(enemy, ability === 'arrow_rain' ? 5 : 3.5, ability === 'incendiary_arrows' ? 5500 : 0);
        }
        text = ability === 'arrow_rain'
          ? '🏹 Chuva de flechas! Dano em área.'
          : '🔥 Flechas incendiárias! A área queima os inimigos atingidos.';
      } else if (ability === 'goblin_invis') {
        player.invisibleUntil = now + 5000;
        until = player.invisibleUntil;
        text = '👻 Invisibilidade por 5 segundos! Os monstros vão ignorar você.';
      } else if (ability === 'goblin_summon') {
        room.summons = room.summons || [];
        for (let i = 0; i < 2; i++) {
          room.summons.push({
            id: 'goblin-' + player.id + '-' + now + '-' + i,
            ownerId: player.id, x: Math.max(-12.5, Math.min(12.5, player.x + (i === 0 ? -1.1 : 1.1))),
            z: player.z + .5, rot: player.rot || 0, hp: 72, maxHp: 72,
            color: i === 0 ? 0x8be070 : 0x65b95f, expiresAt: now + 12000, nextAttackAt: now + 700
          });
        }
        center = { x: player.x, z: player.z };
        text = '👺 Dois goblins aliados chegaram! Eles lutam por 12 segundos.';
      } else if (ability === 'healer_cure') {
        let healedTargets = 0;
        for (const ally of room.players.values()) {
          if (ally.connected === false || ally.hp <= 0 || ally.hp >= ally.maxHp) continue;
          const before = ally.hp;
          ally.hp = Math.min(ally.maxHp, ally.hp + 50);
          if (ally.hp > before) {
            healedTargets++;
            if (ally.ws && ally.ws.readyState === WebSocket.OPEN) ally.ws.send(JSON.stringify({ type: 'notice', text: '✨ Cura recebida: +' + (ally.hp - before) + ' de vida!' }));
          }
        }
        text = healedTargets ? '✨ Cura! Você e seus aliados recuperam até 50 de vida.' : '✨ Cura lançada, mas todos já estão com a vida cheia.';
      } else if (ability === 'healer_guardian_spirits') {
        player.guardianSpiritsUntil = now + 20000;
        until = player.guardianSpiritsUntil;
        room.summons = room.summons || [];
        for (let i = 0; i < 3; i++) {
          const angle = (Math.PI * 2 * i) / 3;
          room.summons.push({
            id: 'guardian-' + player.id + '-' + now + '-' + i,
            ownerId: player.id, summonType: 'guardian_spirit', name: 'Espírito Guardião',
            playerClass: 'guardian_spirit', skin: player.skin || 'celestial', color: 0x8cffe8,
            x: player.x + Math.cos(angle) * 1.1, z: player.z + Math.sin(angle) * 1.1,
            rot: player.rot || 0, hp: 1, maxHp: 1, damage: 0, attackMs: 5000,
            spiritIndex: i, expiresAt: now + 20000,
            nextHealAt: now + 6000 + i * 500, nextDamageAt: now + 5000 + i * 400
          });
        }
        text = '🪽 Três espíritos guardiões voam por 20 segundos: curam aliados em 5 a cada 6 s ou causam 6 de dano a inimigos a cada 5 s.';
      } else if (ability === 'necromancer_summon') {
        let created = 0;
        for (let i = 0; i < 5; i++) {
          const angle = (Math.PI * 2 * i) / 5;
          const summon = spawnNecromancerSkeleton(room, player, 8,
            player.x + Math.cos(angle) * 1.3, player.z + Math.sin(angle) * 1.3,
            now + 18000, 10, 2, 1100);
          if (summon) created++;
        }
        text = created ? '💀 Horda invocada! ' + created + ' esqueletos lutam por 18 segundos.' : 'Você já controla o limite de esqueletos.';
      } else if (ability === 'necromancer_dive') {
        player.necromancerDivePending = true;
        player.necromancerDiveUntil = now + 5000;
        player.necromancerDiveOriginX = player.x;
        player.necromancerDiveOriginZ = player.z;
        player.invisibleUntil = now + 5000;
        until = player.necromancerDiveUntil;
        text = '🕳️ Mergulho ativado! Toque no chão onde deseja emergir em até 5 segundos.';
      } else if (ability === 'monk_impact_palm') {
        const heading = Number(player.rot) || 0;
        center = { x: player.x - Math.sin(heading) * 1.4, z: player.z - Math.cos(heading) * 1.4 };
        for (const enemy of enemies()) {
          const dx = enemy.x - center.x, dz = enemy.z - center.z;
          if (Math.hypot(dx, dz) > 4.2) continue;
          damageEnemy(enemy, 8, 0, center, 2.7);
          if (enemy.alive) {
            enemy.stunnedUntil = now + 1100;
            enemy.attackWarnAt = 0; enemy.attackTargetId = null;
          }
        }
        text = '👊 Palma de Impacto! Onda de choque causa 8 de dano, empurra e atordoa inimigos próximos.';
      } else if (ability === 'monk_winged_steps') {
        const heading = Number(player.rot) || 0;
        const landing = resolveServerMovement(room, player, player.x - Math.sin(heading) * 3.1, player.z - Math.cos(heading) * 3.1);
        player.x = landing.x; player.z = landing.z;
        player.monkSpeedUntil = now + 5000;
        player.dodgeUntil = now + 900;
        until = player.monkSpeedUntil;
        center = { x: player.x, z: player.z };
        text = '🪽 Passos Alados! Avanço rápido, esquiva breve e velocidade aumentada por 5 segundos.';
      } else if (ability === 'ogre_slam') {
        center = { x: player.x, z: player.z };
        for (const enemy of enemies()) {
          if (Math.hypot(enemy.x - center.x, enemy.z - center.z) > 5.2) continue;
          damageEnemy(enemy, 8, 0, center, 2.4);
        }
        text = '💥 Soco no chão! Dano em área e inimigos repelidos.';
      } else if (ability === 'ogre_haste') {
        player.ogreHasteUntil = now + 5000;
        until = player.ogreHasteUntil;
        text = '💨 Fúria do ogro! Velocidade aumentada por 5 segundos.';
      }
      broadcast(room, { type: 'classAbility', id: player.id, ability, x: player.x, z: player.z, center, targets, until, text });
      broadcast(room, state(room));
    } else if (msg.type === 'spell') {
      if (!room.started || player.hp <= 0 || player.playerClass !== 'mage') return;
      if (Date.now() < (room.safeZoneUntil || 0)) { ws.send(JSON.stringify({ type: 'notice', text: 'Você está na zona segura. Use esse tempo para melhorar suas habilidades.' })); return; }
      const spell = msg.spell === 'fire' ? 'fire' : msg.spell === 'lightning' ? 'lightning' : null;
      if (!spell) return;

      const candidates = [...room.monsters, ...(room.cursedBoss && room.cursedBoss.alive ? [room.cursedBoss] : [])].filter(m => m.alive && m.spawned && Math.hypot(m.x-player.x,m.z-player.z)<7); if(room.phase===5 && room.boss && room.boss.alive && Math.hypot(room.boss.x-player.x,room.boss.z-player.z)<8)candidates.push(room.boss);
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
        const classPower = statsFor(player).spellPower * (hasSkill(player, 'arcane_mastery') ? 1.5 : 1) * (hasSkill(player, 'mana_surge') ? 1.25 : 1);
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
            if(room.realm===1)broadcast(room,{type:'notice',text:'✦ O portão do Vale Astral despertou no fundo do Abismo!'});
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
      const isMonk = player.playerClass === 'monk';
      const monkCombo = isMonk ? ((player.monkComboIndex || 0) % 3) + 1 : 0;
      if (isMonk) player.monkComboIndex = monkCombo;
      const attackInterval = Math.max(180, statsFor(player).attackMs - (hasSkill(player, 'swift_hands') ? 90 : 0) - (hasSkill(player, 'battle_focus') ? 55 : 0));
      if (now < (player.nextAttackAt || 0)) return;
      player.nextAttackAt = now + attackInterval;
      if (room.phase < 5) {
        const attackRange = statsFor(player).range + (player.playerClass === 'archer' && hasSkill(player, 'longshot') ? 2 : 0);
        const target = [...room.monsters, ...(room.cursedBoss && room.cursedBoss.alive ? [room.cursedBoss] : [])].find(m => m.alive && m.spawned && Math.hypot(m.x - player.x, m.z - player.z) < attackRange);
        if (target) {
          let damage = isMonk ? [0, 2, 3, 5][monkCombo] : player.baseDamage + (player.damageBuffHits > 0 ? player.damageBuff : 0);
          if (isMonk && player.damageBuffHits > 0) damage += player.damageBuff;
          if (target.hp / (target.maxHp || 1) <= .35 && hasSkill(player, 'executioner')) damage += 2;
          target.hp = Math.max(0, (target.hp || 1) - damage);
          if (isMonk && target.hp > 0 && monkCombo >= 2) {
            target.stunnedUntil = now + (monkCombo === 2 ? 550 : 950);
            target.attackWarnAt = 0; target.attackTargetId = null;
            if (monkCombo === 3) {
              const dx = target.x - player.x, dz = target.z - player.z, dist = Math.hypot(dx, dz) || 1;
              target.x = Math.max(-13, Math.min(13, target.x + dx / dist * 2.1));
              target.z = Math.max(-170, Math.min(8, target.z + dz / dist * 2.1));
            }
          }
          if (target.hp <= 0 && player.playerClass === 'necromancer') spawnNecromancerSkeleton(room, player, 15, player.x, player.z, 0, 10, 3, 900);
          if (player.damageBuffHits > 0) { player.damageBuffHits--; if (player.damageBuffHits === 0) player.damageBuff = 0; }
          if (target.hp <= 0) {
            target.alive = false;
            if (target.cursed) { const prize={id:String(Date.now())+'-curse',name:'Cristal Ancestral',rarity:'lendário',value:16,power:5,source:'cursed-chest'}; player.lootDrops.push(prize); player.inventory['lendário']=(player.inventory['lendário']||0)+1; sendInventory(player); player.ws.send(JSON.stringify({type:'loot',item:prize})); room.cursedBoss=null; broadcast(room,{type:'notice',text:'MINI-CHEFE DERROTADO! Cristal Ancestral LENDÁRIO recebido!'}); }
            else {
            // Monstros comuns não garantem item: chance de 25%, para loot não inundar o inventário.
            if (Math.random() < dropChance(player, .25)) {
              const dropped = grantLoot(player, 'monster');
              player.ws.send(JSON.stringify({ type: 'notice', text: 'Drop raro do monstro: ' + dropped.name + ' (' + dropped.rarity + ')' }));
            } else {
              player.ws.send(JSON.stringify({ type: 'notice', text: 'Monstro derrotado. Nenhum item desta vez.' }));
            }
            broadcast(room, { type: 'notice', text: player.name + ' derrotou um monstro!' });
            }
          } else {
            player.ws.send(JSON.stringify({ type: 'notice', text: 'Monstro ferido! Vida restante: ' + Math.max(0, Math.ceil(target.hp)) }));
          }
        }
      } else if (room.boss && room.boss.alive && Math.hypot(room.boss.x - player.x, room.boss.z - player.z) < Math.max(5.2, statsFor(player).range)) {
        const boss = room.boss; let damage = player.playerClass === 'monk' ? [0, 2, 3, 5][monkCombo] : player.baseDamage + (player.damageBuffHits > 0 ? player.damageBuff : 0);
        if (player.playerClass === 'monk' && player.damageBuffHits > 0) damage += player.damageBuff;
        if (player.playerClass === 'monk' && boss.hp > 0 && monkCombo >= 2) {
          boss.stunnedUntil = now + (monkCombo === 2 ? 550 : 950);
          boss.attackWarnAt = 0;
          if (monkCombo === 3) {
            const dx = boss.x - player.x, dz = boss.z - player.z, dist = Math.hypot(dx, dz) || 1;
            boss.x = Math.max(-13, Math.min(13, boss.x + dx / dist * 1.7));
            boss.z = Math.max(-170, Math.min(8, boss.z + dz / dist * 1.7));
          }
        }
        if (boss.hp - damage <= 0 && player.playerClass === 'necromancer') spawnNecromancerSkeleton(room, player, 15, player.x, player.z, 0, 10, 3, 900);
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
          if(room.realm===1)broadcast(room,{type:'notice',text:'✦ O portão do Vale Astral despertou no fundo do Abismo!'});
        }
      } else if (room.phase === 5 && room.boss && room.boss.alive) {
        player.ws.send(JSON.stringify({ type: 'notice', text: 'Chegue perto do Guardião para acertar o golpe.' }));
      }
      broadcast(room, { type: 'attack', id: player.id, combo: monkCombo, x: player.x, z: player.z }); broadcast(room, state(room));
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
      if (Math.random() < 0.25) {
        chest.cursed = true;
        room.cursedBoss = { id:'cursed-'+chest.id, kind:'brute', x:chest.x, z:chest.z, hp:30+room.phase*8, maxHp:30+room.phase*8, alive:true, spawned:true, phase:room.phase, cursed:true, attackAt:0 };
        broadcast(room,{type:'notice',text:'☠ BAÚ AMALDIÇOADO! Um mini-chefe apareceu. Derrote-o para ganhar um item lendário!'});
      } else {
        const dropped = grantLoot(player, 'chest');
      ws.send(JSON.stringify({ type: 'notice', text: 'Baú: ' + dropped.name + ' (' + dropped.rarity + ')' }));
      }
      broadcast(room, state(room));
    } else if (msg.type === 'leave') {
      const oldCode = player.room;
      room.players.delete(player.id);
      if (room.hostId === player.id) room.hostId = [...room.players.values()].find(p => p.connected !== false && p.id !== player.id)?.id || null;
      if (room.players.size === 0) {
        if (room.started) room.emptySince = Date.now();
        else rooms.delete(oldCode);
      }
      player.room = null;
      broadcast(room, state(room));
    }
  });

  ws.on('close', () => {
    // Um socket antigo não deve remover a sessão caso o personagem já tenha retomado a conexão.
    if (player.ws !== ws) return;
    const room = player.room && rooms.get(player.room);
    if (room) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      if (room.hostId === player.id) {
        room.hostId = [...room.players.values()].find(p => p.connected !== false && p.id !== player.id)?.id || null;
      }
      const activeCount = [...room.players.values()].filter(p => p.connected !== false).length;
      if (activeCount === 0) room.emptySince = Date.now();
      broadcast(room, state(room));
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [roomCode, room] of rooms.entries()) {
    // Sessões desconectadas ficam recuperáveis por 90 segundos.
    for (const [id, saved] of room.players.entries()) {
      if (saved.connected === false && saved.disconnectedAt && now - saved.disconnectedAt > 90000) {
        room.players.delete(id);
        if (room.hostId === id) room.hostId = [...room.players.values()].find(p => p.connected !== false)?.id || null;
      }
    }
    const players = [...room.players.values()].filter(p => p.connected !== false);
    if (room.started && players.length === 0) {
      if (!room.emptySince) room.emptySince = now;
      if (now - room.emptySince > 120000) { rooms.delete(roomCode); continue; }
    } else if (players.length > 0) {
      room.emptySince = 0;
    }
    // Apaga qualquer sala sem jogadores ativos depois da janela de reconexão.
    if (room.players.size === 0 && (!room.started || !room.emptySince || now - room.emptySince > 120000)) {
      rooms.delete(roomCode);
      continue;
    }
    if (!room.started || players.length === 0) continue;
    if(room.cursedBoss && room.cursedBoss.alive){const e=room.cursedBoss;let t=null,dmin=Infinity;for(const p of players){if(p.hp<=0||now<(p.invisibleUntil||0))continue;const d=Math.hypot(p.x-e.x,p.z-e.z);if(d<dmin){dmin=d;t=p;}}if(t&&dmin>1.8&&dmin<22){const dx=t.x-e.x,dz=t.z-e.z,d=Math.hypot(dx,dz)||1;e.x+=dx/d*.15;e.z+=dz/d*.15;}if(t&&dmin<2.3&&now-(e.attackAt||0)>1100){e.attackAt=now;if(now<(t.dodgeUntil||0)){t.ws.send(JSON.stringify({type:'notice',text:'Esquiva perfeita! Você evitou o golpe.'}));}else{takeDamage(room,t,8);t.ws.send(JSON.stringify({type:'notice',text:'Mini-chefe amaldiçoado: -8 HP!'}));}}}
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
    for (const p of players) {
      if (p.necromancerDivePending && now > (p.necromancerDiveUntil || 0)) {
        p.necromancerDivePending = false; p.necromancerDiveUntil = 0; p.invisibleUntil = 0;
        if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'notice', text: 'O mergulho terminou; você voltou ao ponto inicial.' }));
      }
if (hasSkill(p, 'regeneration') && p.hp > 0 && p.hp < p.maxHp && now >= (p.nextRegenAt || 0)) {
        p.hp = Math.min(p.maxHp, p.hp + 2); p.nextRegenAt = now + 3000;
      }
      if (hasSkill(p, 'healing_aura') && p.hp > 0 && now >= (p.nextAuraAt || 0)) {
        p.nextAuraAt = now + 2200;
        for (const ally of players) {
          if (ally.hp <= 0 || ally.hp >= ally.maxHp || Math.hypot(ally.x-p.x, ally.z-p.z) > 6) continue;
          ally.hp = Math.min(ally.maxHp, ally.hp + 2);
        }
      }
    }

    // Goblins temporários perseguem o inimigo mais próximo durante 12 segundos.
    room.summons = (room.summons || []).filter(summon => summon.hp > 0 && (!summon.expiresAt || summon.expiresAt > now));
    const summonEnemies = [...room.monsters, ...(room.cursedBoss && room.cursedBoss.alive ? [room.cursedBoss] : []), ...(room.boss && room.boss.alive ? [room.boss] : [])]
      .filter(enemy => enemy && enemy.alive && enemy.spawned !== false);
    for (const summon of room.summons) {
      if (summon.summonType === 'guardian_spirit') {
        // Espíritos não entram em combate corpo a corpo como esqueletos/goblins.
        // Buscam primeiro aliados feridos; se nenhum aliado ferido estiver mais perto,
        // perseguem o inimigo mais próximo e alternam seus pulsos de cura/dano.
        const woundedAllies = players.filter(ally => ally.hp > 0 && ally.hp < ally.maxHp)
          .map(ally => ({ entity: ally, distance: Math.hypot(ally.x - summon.x, ally.z - summon.z), isAlly: true }))
          .sort((a, b) => a.distance - b.distance);
        const nearestEnemyEntry = summonEnemies.filter(enemy => enemy.alive)
          .map(enemy => ({ entity: enemy, distance: Math.hypot(enemy.x - summon.x, enemy.z - summon.z), isAlly: false }))
          .sort((a, b) => a.distance - b.distance)[0];
        const nearestAllyEntry = woundedAllies[0];
        const targetEntry = nearestAllyEntry && (!nearestEnemyEntry || nearestAllyEntry.distance <= nearestEnemyEntry.distance)
          ? nearestAllyEntry : nearestEnemyEntry;
        if (!targetEntry) {
          const owner = room.players.get(summon.ownerId);
          if (owner && owner.hp > 0) {
            const orbit = (summon.spiritIndex || 0) * (Math.PI * 2 / 3) + now * 0.0008;
            summon.x += (owner.x + Math.cos(orbit) * 1.65 - summon.x) * 0.08;
            summon.z += (owner.z + Math.sin(orbit) * 1.65 - summon.z) * 0.08;
          }
          continue;
        }
        const target = targetEntry.entity;
        const dx = target.x - summon.x, dz = target.z - summon.z;
        const distance = targetEntry.distance || 0.001;
        if (distance > 1.35) {
          const speed = 0.19;
          summon.x = Math.max(-12.5, Math.min(12.5, summon.x + dx / distance * speed));
          summon.z = Math.max(-169.5, Math.min(6.5, summon.z + dz / distance * speed));
        } else if (targetEntry.isAlly) {
          if (now >= (summon.nextHealAt || 0)) {
            summon.nextHealAt = now + 6000;
            target.hp = Math.min(target.maxHp, target.hp + 5);
          }
        } else if (now >= (summon.nextDamageAt || 0)) {
          summon.nextDamageAt = now + 5000;
          target.hp = Math.max(0, (target.hp || 1) - 6);
          if (target.hp <= 0 && target.alive) handleSummonDefeat(room, summon, target);
        }
        summon.rot = Math.atan2(dx, dz);
        continue;
      }
      const target = summonEnemies.filter(enemy => enemy.alive)
        .sort((a, b) => Math.hypot(a.x - summon.x, a.z - summon.z) - Math.hypot(b.x - summon.x, b.z - summon.z))[0];
      if (!target) continue;
      const dx = target.x - summon.x, dz = target.z - summon.z, distance = Math.hypot(dx, dz) || 1;
      if (distance > 1.65 && distance < 24) {
        summon.x = Math.max(-13, Math.min(13, summon.x + dx / distance * .14));
        summon.z = Math.max(-170, Math.min(8, summon.z + dz / distance * .14));
      } else if (distance <= 2.2 && now >= (summon.nextAttackAt || 0)) {
        summon.nextAttackAt = now + (summon.attackMs || 950);
        target.hp = Math.max(0, (target.hp || 1) - (summon.damage || 2));
        if (target.hp <= 0 && target.alive) handleSummonDefeat(room, summon, target);
      }
    }

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
      let targetPriority = Infinity;

      // Goblins invocados provocam os monstros: recebem uma vantagem de aggro
      // para que os inimigos realmente os persigam em vez de focar sempre o jogador.
      for (const player of players) {
        if (player.hp <= 0 || now < (player.invisibleUntil || 0)) continue;
        const distance = Math.hypot(player.x - monster.x, player.z - monster.z);
        if (distance < targetPriority) {
          targetPriority = distance;
          nearest = distance;
          target = player;
        }
      }
      for (const summon of (room.summons || [])) {
        if (summon.summonType === 'guardian_spirit') continue;
        if (summon.hp <= 0 || (summon.expiresAt && summon.expiresAt <= now)) continue;
        const distance = Math.hypot(summon.x - monster.x, summon.z - monster.z);
        // Goblins/esqueletos recebem aggro pela distância real. Antes havia
        // uma margem fixa de 3 unidades, fazendo monstros ignorarem invocações próximas.
        // Espíritos guardiões são suporte voador e não devem virar alvos de monstros.
        const currentTargetDistance = target
          ? Math.hypot(target.x - monster.x, target.z - monster.z)
          : Infinity;
        const isGoblinClone = summon.summonType === 'goblin_clone';
        const aggroBonus = isGoblinClone ? 2.5 : 0.12;
        const shouldTargetSummon = distance < 34 && distance + aggroBonus < currentTargetDistance;
        if (shouldTargetSummon) {
          targetPriority = distance;
          nearest = distance;
          target = { ...summon, id: 'summon:' + summon.id, isSummon: true, sourceSummon: summon };
        }
      }

      if (target && nearest > 1.8 && nearest < 70) {
        const movementTarget = target.isSummon && target.sourceSummon ? target.sourceSummon : target;
        const dx = movementTarget.x - monster.x;
        const dz = movementTarget.z - monster.z;
        const distance = Math.hypot(dx, dz);

        if (distance > 0) {
          const speed = (monster.kind === 'brute' ? 0.25 : monster.kind === 'wraith' ? 0.32 : 0.29) * (room.phase >= 4 ? 1.08 : 1);

          monster.x += (dx / distance) * speed;
          monster.z += (dz / distance) * speed;

          monster.x = Math.max(-13, Math.min(13, monster.x));
          monster.z = Math.max(-170, Math.min(8, monster.z));
        }
      }
      const monsterNow = Date.now();
      if (target && nearest <= 2.0) {
        if (!monster.attackWarnAt || monster.attackTargetId !== target.id) {
          monster.attackWarnAt = monsterNow;
          monster.attackTargetId = target.id;
          broadcast(room, { type: 'monsterWindup', id: monster.id, targetId: target.id, duration: 460 });
          if (!target.isSummon && target.ws) target.ws.send(JSON.stringify({ type: 'notice', text: '⚠ O monstro prepara um golpe! Esquive agora.' }));
        } else if (monster.attackWarnAt && monsterNow - monster.attackWarnAt >= 460) {
          monster.attackAt = monsterNow;
          monster.attackWarnAt = 0;
          monster.attackTargetId = null;
          broadcast(room, { type: 'monsterAttack', id: monster.id, targetId: target.id });
          if (target.isSummon) {
            const summon = target.sourceSummon;
            summon.hp = Math.max(0, summon.hp - 4);
            if (summon.hp <= 0) broadcast(room, { type: 'notice', text: 'Um monstro derrotou um goblin aliado!' });
          } else if (Date.now() < (target.dodgeUntil || 0)) {
            if (target.ws) target.ws.send(JSON.stringify({ type: 'notice', text: 'Esquiva perfeita! Você evitou o golpe.' }));
          } else {
            takeDamage(room, target, 4);
            if (target.ws) target.ws.send(JSON.stringify({ type: 'notice', text: 'Um monstro acertou você! -4 de vida.' }));
          }
          if (!target.isSummon && target.hp <= 0) {
            target.hp = 0;
            if (target.ws) target.ws.send(JSON.stringify({ type: 'notice', text: 'Você foi derrotado. Não há renascimento automático nesta partida.' }));
          }
        }
      } else if (!target || nearest > 2.5) {
        monster.attackWarnAt = 0;
        monster.attackTargetId = null;
      }
    }

    // Dano de queimadura ao longo do tempo, processado pelo servidor.
    for (const enemy of [...room.monsters, ...(room.cursedBoss && room.cursedBoss.alive ? [room.cursedBoss] : []), ...(room.boss ? [room.boss] : [])]) {
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
            if(room.realm===1)broadcast(room,{type:'notice',text:'✦ O portão do Vale Astral despertou no fundo do Abismo!'});
          } else if (Math.random() < dropChance(owner, .25)) grantLoot(owner, 'monster');
        }
      }
    }

    if (room.phase === 5 && room.boss && room.boss.alive) {
      const boss = room.boss;
      if (now < (boss.stunnedUntil || 0)) { boss.attackWarnAt = 0; }
      else {
      let target = null, nearest = Infinity;
      for (const p of players) { if (p.hp <= 0 || now < (p.invisibleUntil || 0)) continue; const d = Math.hypot(p.x - boss.x, p.z - boss.z); if (d < nearest) { nearest = d; target = p; } }
      if (target && nearest > 2.35 && nearest < 24) {
        const dx = target.x - boss.x, dz = target.z - boss.z, distance = Math.hypot(dx, dz) || 1;
        const speed = boss.lifePhase === 1 ? 0.09 : boss.lifePhase === 2 ? 0.12 : 0.16;
        boss.x = Math.max(-12, Math.min(12, boss.x + dx / distance * speed));
        boss.z = Math.max(-156, Math.min(-144, boss.z + dz / distance * speed));
      }
      const bossNow = Date.now();
      if (target && nearest <= 2.8) {
        const windupDuration = boss.lifePhase === 3 ? 360 : 560;
        const attackInterval = boss.lifePhase === 3 ? 1150 : 1600;
        if (!boss.attackWarnAt && bossNow - (boss.attackAt || 0) > attackInterval) {
          boss.attackWarnAt = bossNow;
          broadcast(room, { type: 'bossWindup', id: boss.id, targetId: target.id, duration: windupDuration, lifePhase: boss.lifePhase });
          target.ws.send(JSON.stringify({ type: 'notice', text: '☠ O GUARDIÃO CARREGA UM GOLPE! ESQUIVE!' }));
        } else if (boss.attackWarnAt && bossNow - boss.attackWarnAt >= windupDuration) {
          boss.attackAt = bossNow;
          boss.attackWarnAt = 0;
          if (Date.now() < (target.dodgeUntil || 0)) {
            target.ws.send(JSON.stringify({ type: 'notice', text: 'Esquiva perfeita! Você escapou do golpe do Guardião.' }));
          } else {
            takeDamage(room, target, boss.lifePhase === 3 ? 22 : 14);
            target.ws.send(JSON.stringify({ type: 'notice', text: 'O Guardião acertou você! -' + (boss.lifePhase === 3 ? 22 : 14) + ' de vida.' }));
          }
          if (target.hp <= 0) {
            target.hp = 0;
            target.ws.send(JSON.stringify({ type: 'notice', text: 'Você foi derrotado. Não há renascimento automático nesta partida.' }));
          }
        }
      } else {
        boss.attackWarnAt = 0;
      }
      }
    }
    broadcast(room, state(room));
  }
}, 150);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Masmorra Monocromática online na porta ' + PORT);
});
  
