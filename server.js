
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

function newRoom(code) {
  const room = { players: new Map(), monsters: [] };
  for (let i = 0; i < 7; i++) {
    room.monsters.push({
      id: 'm' + i,
      x: (Math.random() - 0.5) * 20,
      z: -25 + Math.random() * 30,
      alive: true
    });
  }
  rooms.set(code, room);
  return room;
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
      id: p.id, name: p.name, x: p.x, z: p.z, rot: p.rot, color: p.color
    })),
    monsters: room.monsters
  };
}

wss.on('connection', ws => {
  const player = {
    id: String(nextId++),
    ws, name: 'Aventureiro', x: 0, z: 3, rot: 0,
    color: [0x72e6ff, 0xe9c477, 0xff8ba7, 0x9cff8a][nextId % 4],
    room: null
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
      if (!room) room = newRoom(code);

      player.room = code;
      player.name = String(msg.name || 'Aventureiro').slice(0, 18);
      player.x = 0;
      player.z = 3;
      room.players.set(player.id, player);

      ws.send(JSON.stringify({ type: 'joined', id: player.id, room: code }));
      broadcast(room, { type: 'notice', text: player.name + ' entrou na sala.' });
      broadcast(room, state(room));
      return;
    }

    const room = player.room && rooms.get(player.room);
    if (!room) return;

    if (msg.type === 'move') {
      player.x = Math.max(-13, Math.min(13, Number(msg.x) || 0));
      player.z = Math.max(-31, Math.min(8, Number(msg.z) || 0));
      player.rot = Number(msg.rot) || 0;
      broadcast(room, state(room));
    } else if (msg.type === 'attack') {
      const target = room.monsters.find(m => m.alive &&
        Math.hypot(m.x - player.x, m.z - player.z) < 3.2);
      if (target) {
        target.alive = false;
        broadcast(room, { type: 'notice', text: player.name + ' derrotou um monstro!' });
      }
      broadcast(room, { type: 'attack', id: player.id });
      broadcast(room, state(room));
    } else if (msg.type === 'leave') {
      room.players.delete(player.id);
      player.room = null;
      broadcast(room, state(room));
    }
  });

  ws.on('close', () => {
    const room = player.room && rooms.get(player.room);
    if (room) {
      room.players.delete(player.id);
      broadcast(room, state(room));
      if (room.players.size === 0) rooms.delete(player.room);
    }
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    const players = [...room.players.values()];

    for (const monster of room.monsters) {
      if (!monster.alive) continue;

      let target = null;
      let nearest = Infinity;

      for (const player of players) {
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
          const speed = 0.45;

          monster.x += (dx / distance) * speed;
          monster.z += (dz / distance) * speed;

          monster.x = Math.max(-13, Math.min(13, monster.x));
          monster.z = Math.max(-31, Math.min(8, monster.z));
        }
      }
    }

    broadcast(room, state(room));
  }
}, 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Masmorra Monocromática online na porta ' + PORT);
});
  
