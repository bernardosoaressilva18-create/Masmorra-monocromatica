
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
const rooms = new Map();
let nextId = 1;

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
function rollLoot(source) {
  const rarityRoll = Math.random() * 100;
  let sum = 0, rarity = RARITIES[0];
  for (const entry of RARITIES) {
    sum += entry.chance;
    if (rarityRoll < sum) { rarity = entry; break; }
  }
  const item = weightedPick(LOOT_TABLES[source] || LOOT_TABLES.monster);
  return { id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
    name: item.name, rarity: rarity.name, value: rarity.value, source };
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
  const count = phase === 1 ? 5 : 6, centerZ = phase === 1 ? -3 : -19;
  const kinds = phase === 1 ? ['stalker', 'stalker', 'brute', 'stalker', 'brute'] : ['wraith', 'stalker', 'wraith', 'brute', 'wraith', 'brute'];
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({ id: 'p' + phase + 'm' + i,
    kind: kinds[i % kinds.length], phase,
    x: (Math.random() - 0.5) * 22, z: (phase === 1 ? -9 : -22) + (Math.random() - 0.5) * 8,
    spawned: false, spawnAt: now + i * 2200,
    alive: true, hp: phase === 1 ? (kinds[i % kinds.length] === 'brute' ? 8 : 5) : (kinds[i % kinds.length] === 'brute' ? 14 : 9), maxHp: phase === 1 ? (kinds[i % kinds.length] === 'brute' ? 8 : 5) : (kinds[i % kinds.length] === 'brute' ? 14 : 9), attackAt: 0 }));
}
function advancePhase(room) {
  if (room.phase === 1) {
    room.phase = 2; room.monsters = createWave(2);
    broadcast(room, { type: 'notice', text: 'PORTÃO ABERTO! FASE 2: As Cavernas Mágicas. Atravesse o próximo portão.' });
  } else if (room.phase === 2) {
    room.phase = 3; room.monsters = [];
    room.boss = { id: 'final-boss', x: 0, z: -29, alive: true, hp: 15, maxHp: 15, lifePhase: 1, attackAt: 0 };
    broadcast(room, { type: 'notice', text: 'PORTÃO ABERTO! FASE 3: O Guardião do Abismo despertou!' });
  }
}
function newRoom(code, hostId) {
  const room = { players: new Map(), hostId, started: false, phase: 1, monsters: createWave(1), boss: null, bossAttackAt: 0,
    chests: [
      { id: 'c0', x: -8, z: -8, openedBy: [] },
      { id: 'c1', x: 8, z: -19, openedBy: [] },
      { id: 'c2', x: 0, z: -29, openedBy: [] }
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
      id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot, color: p.color, hp: p.hp, ready: !!p.ready, isHost: p.id === room.hostId
    })),
    phase: room.phase,
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
  hp: 100, lastGateNotice: 0, baseDamage: 1, damageBuff: 0, damageBuffHits: 0,
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
      if (room.started) {
        ws.send(JSON.stringify({ type: 'error', message: 'Essa partida já começou. Entre em outra sala.' }));
        return;
      }

      player.room = code;
      player.name = String(msg.name || 'Aventureiro').slice(0, 18);
      player.x = 0;
      player.z = 3;
      player.hp = 100;
      player.ready = false;
      player.baseDamage = 1; player.damageBuff = 0; player.damageBuffHits = 0;
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
    } else if (msg.type === 'move') {
      if (!room.started || player.hp <= 0) return;
      player.x = Math.max(-13, Math.min(13, Number(msg.x) || 0));
      const requestedZ = Math.max(-39, Math.min(8, Number(msg.z) || 0));
      const gateZ = room.phase === 1 ? -13 : room.phase === 2 ? -27 : -999;
      const enemiesAlive = room.phase === 3 ? false : room.monsters.some(m => m.alive);
      if (room.phase < 3 && requestedZ < gateZ && enemiesAlive) {
        player.z = gateZ + 0.7;
        if (Date.now() - player.lastGateNotice > 1800) {
          player.lastGateNotice = Date.now();
          player.ws.send(JSON.stringify({ type: 'notice', text: 'O portão está selado! Derrote todos os monstros desta fase.' }));
        }
      } else {
        player.z = requestedZ;
        if (room.phase < 3 && requestedZ < gateZ) advancePhase(room);
      }
      player.rot = Number(msg.rot) || 0;
      broadcast(room, state(room));
    } else if (msg.type === 'useItem') {
      if (!room.started || player.hp <= 0) return;
      const itemIndex = player.lootDrops.findIndex(item => item.id === String(msg.id));
      if (itemIndex < 0) { ws.send(JSON.stringify({ type: 'notice', text: 'Esse item não está mais no inventário.' })); return; }
      const item = player.lootDrops[itemIndex];
      let effect = '';
      if (item.name === 'Poção de Vida') {
        if (player.hp >= 100) { ws.send(JSON.stringify({ type: 'notice', text: 'Sua vida já está cheia!' })); return; }
        const before = player.hp; player.hp = Math.min(100, player.hp + 40); effect = 'Vida restaurada: +' + (player.hp - before) + '.';
      } else if (item.name === 'Moeda Antiga') {
        if (player.hp >= 100) { ws.send(JSON.stringify({ type: 'notice', text: 'A Moeda Antiga só pode ser usada para recuperar vida. Sua vida já está cheia.' })); return; }
        const before = player.hp; player.hp = Math.min(100, player.hp + 15); effect = 'A moeda restaurou +' + (player.hp - before) + ' de vida.';
      } else if (item.name === 'Pó de Cristal') {
        const before = player.hp; player.hp = Math.min(100, player.hp + 20); player.damageBuff = Math.max(player.damageBuff, 1); player.damageBuffHits = Math.max(player.damageBuffHits, 2); effect = 'Cristal usado: +' + (player.hp - before) + ' de vida e +1 dano por 2 golpes.';
      } else if (item.name === 'Fragmento Monocromático') {
        player.damageBuff = Math.max(player.damageBuff, 1); player.damageBuffHits = Math.max(player.damageBuffHits, 3); effect = '+1 de dano nos próximos 3 golpes.';
      } else if (item.name === 'Núcleo Sombrio') {
        player.damageBuff = Math.max(player.damageBuff, 2); player.damageBuffHits = Math.max(player.damageBuffHits, 4); effect = '+2 de dano nos próximos 4 golpes.';
      } else if (item.name === 'Equipamento Antigo' || item.name === 'Relíquia Monocromática') {
        player.baseDamage = Math.min(5, player.baseDamage + 1); effect = 'Equipado! Seu dano permanente aumentou para ' + player.baseDamage + '.';
      } else if (item.name === 'Coração do Guardião') {
        const before = player.hp; player.hp = Math.min(100, player.hp + 50); effect = 'Coração ativado: +' + (player.hp - before) + ' de vida.';
      } else if (item.name === 'Cristal Ancestral') {
        player.damageBuff = Math.max(player.damageBuff, 3); player.damageBuffHits = Math.max(player.damageBuffHits, 5); effect = '+3 de dano nos próximos 5 golpes.';
      } else if (item.name === 'Coroa do Abismo') {
        player.hp = 100; player.baseDamage = Math.min(5, player.baseDamage + 1); effect = 'A Coroa restaurou toda a vida e aumentou seu dano permanente.';
      }
      player.lootDrops.splice(itemIndex, 1);
      player.inventory[item.rarity] = Math.max(0, (player.inventory[item.rarity] || 0) - 1);
      sendInventory(player);
      ws.send(JSON.stringify({ type: 'notice', text: item.name + ': ' + effect }));
      broadcast(room, state(room));
    } else if (msg.type === 'spell') {
      if (!room.started || player.hp <= 0) return;
      const spell = msg.spell === 'fire' ? 'fire' : msg.spell === 'lightning' ? 'lightning' : null;
      if (!spell) return;
      const damage = spell === 'fire' ? 3 : 2;
      let target = null;
      if (room.phase < 3) target = room.monsters.find(m => m.alive && m.spawned && Math.hypot(m.x-player.x,m.z-player.z) < 7);
      else if (room.boss && room.boss.alive && Math.hypot(room.boss.x-player.x,room.boss.z-player.z) < 8) target = room.boss;
      if (target) {
        target.hp = Math.max(0, (target.hp || 1)-damage);
        if (target.hp <= 0) {
          target.alive = false;
          if (room.phase < 3 && Math.random() < .25) grantLoot(player, 'monster');
          if (room.phase === 3 && target === room.boss) {
            const dropped = grantLoot(player, 'boss');
            broadcast(room,{type:'notice',text:'CHEFE DERROTADO! Recompensa: '+dropped.name+' ('+dropped.rarity+')'});
          } else broadcast(room,{type:'notice',text:'Magia '+(spell==='fire'?'de fogo':'de raio')+' derrotou um monstro!'});
        } else player.ws.send(JSON.stringify({type:'notice',text:'Magia acertou! Vida restante: '+target.hp}));
        sendInventory(player);
      } else player.ws.send(JSON.stringify({type:'notice',text:'Nenhum inimigo ao alcance da magia.'}));
      broadcast(room,{type:'spell',id:player.id,spell,x:player.x,z:player.z});
      broadcast(room,state(room));
    } else if (msg.type === 'attack') {
      if (!room.started || player.hp <= 0) return;
      if (room.phase < 3) {
        const target = room.monsters.find(m => m.alive && m.spawned && Math.hypot(m.x - player.x, m.z - player.z) < 3.2);
        if (target) {
          const damage = player.baseDamage + (player.damageBuffHits > 0 ? player.damageBuff : 0);
          target.hp = Math.max(0, (target.hp || 1) - damage);
          if (player.damageBuffHits > 0) { player.damageBuffHits--; if (player.damageBuffHits === 0) player.damageBuff = 0; }
          if (target.hp <= 0) {
            target.alive = false;
            // Monstros comuns não garantem item: chance de 25%, para loot não inundar o inventário.
            if (Math.random() < 0.25) {
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
      } else if (room.boss && room.boss.alive && Math.hypot(room.boss.x - player.x, room.boss.z - player.z) < 4.2) {
        const boss = room.boss; const damage = player.baseDamage + (player.damageBuffHits > 0 ? player.damageBuff : 0); boss.hp = Math.max(0, boss.hp - damage);
        if (player.damageBuffHits > 0) { player.damageBuffHits--; if (player.damageBuffHits === 0) player.damageBuff = 0; }
        player.ws.send(JSON.stringify({ type: 'notice', text: 'Você causou ' + damage + ' de dano no Guardião!' }));
        const oldLifePhase = boss.lifePhase; boss.lifePhase = boss.hp > 10 ? 1 : boss.hp > 5 ? 2 : 3;
        if (boss.lifePhase !== oldLifePhase && boss.hp > 0)
          broadcast(room, { type: 'notice', text: 'O Guardião entrou na fase de vida ' + boss.lifePhase + ' / 3!' });
        if (boss.hp <= 0) {
          boss.alive = false; const dropped = grantLoot(player, 'boss');
          broadcast(room, { type: 'notice', text: 'CHEFE DERROTADO! Recompensa: ' + dropped.name + ' (' + dropped.rarity + ')' });
        }
      } else if (room.phase === 3 && room.boss && room.boss.alive) {
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
      room.players.delete(player.id);
      player.room = null;
      if (room.hostId === player.id) room.hostId = room.players.keys().next().value || null;
      broadcast(room, state(room));
    }
  });

  ws.on('close', () => {
    const room = player.room && rooms.get(player.room);
    if (room) {
      room.players.delete(player.id);
      if (room.hostId === player.id) room.hostId = room.players.keys().next().value || null;
      broadcast(room, state(room));
      if (room.players.size === 0) rooms.delete(player.room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.started) continue;
    const players = [...room.players.values()];

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

      if (target && nearest > 1.8 && nearest < 20) {
        const dx = target.x - monster.x;
        const dz = target.z - monster.z;
        const distance = Math.hypot(dx, dz);

        if (distance > 0) {
          const speed = monster.kind === 'brute' ? 0.055 : monster.kind === 'wraith' ? 0.085 : 0.07;

          monster.x += (dx / distance) * speed;
          monster.z += (dz / distance) * speed;

          monster.x = Math.max(-13, Math.min(13, monster.x));
          monster.z = Math.max(-31, Math.min(8, monster.z));
        }
      }
      if (target && nearest <= 2.0 && Date.now() - (monster.attackAt || 0) > 1900) {
        monster.attackAt = Date.now();
        broadcast(room, { type: 'monsterAttack', id: monster.id, targetId: target.id });
        target.hp = Math.max(0, target.hp - 4);
        target.ws.send(JSON.stringify({ type: 'notice', text: 'Um monstro acertou você! -4 de vida.' }));
        if (target.hp <= 0) {
          target.hp = 0;
          target.ws.send(JSON.stringify({ type: 'notice', text: 'Você foi derrotado. Não há renascimento automático nesta partida.' }));
        }
      }
    }

    if (room.phase === 3 && room.boss && room.boss.alive) {
      const boss = room.boss; let target = null, nearest = Infinity;
      for (const p of players) { if (p.hp <= 0) continue; const d = Math.hypot(p.x - boss.x, p.z - boss.z); if (d < nearest) { nearest = d; target = p; } }
      if (target && nearest > 2.35 && nearest < 24) {
        const dx = target.x - boss.x, dz = target.z - boss.z, distance = Math.hypot(dx, dz) || 1;
        const speed = boss.lifePhase === 1 ? 0.055 : boss.lifePhase === 2 ? 0.075 : 0.105;
        boss.x = Math.max(-12, Math.min(12, boss.x + dx / distance * speed));
        boss.z = Math.max(-31, Math.min(-20, boss.z + dz / distance * speed));
      }
      if (target && nearest <= 2.8 && Date.now() - boss.attackAt > (boss.lifePhase === 3 ? 800 : 1200)) {
        boss.attackAt = Date.now();
        target.hp = Math.max(0, target.hp - (boss.lifePhase === 3 ? 22 : 14));
        target.ws.send(JSON.stringify({ type: 'notice', text: 'O Guardião acertou você! -' + (boss.lifePhase === 3 ? 22 : 14) + ' de vida.' }));
        if (target.hp <= 0) {
          target.hp = 0;
          target.ws.send(JSON.stringify({ type: 'notice', text: 'Você foi derrotado. Não há renascimento automático nesta partida.' }));
        }
      }
    }
    broadcast(room, state(room));
  }
}, 100);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Masmorra Monocromática online na porta ' + PORT);
});
  
