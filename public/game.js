
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';

const $ = id => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), loading = $('loading'), menuStatus = $('menuStatus');

let renderer, scene, camera, clock, ws, playerId = null, roomCode = '', myPlayer = null, started = false;
let yaw = 0, pitch = .25, joy = { x: 0, y: 0 }, keys = {}, lastMove = 0, attackCooldown = 0, noticeTimer = 0;
const remotePlayers = new Map(), monsterMeshes = new Map(), chestMeshes = new Map();
let bossMesh = null, bossData = null;
let latestChests = [], inventoryData = { comum: 0, incomum: 0, raro: 0, 'épico': 0, 'lendário': 0 }, lootDrops = [];
const world = { width: 30, depth: 46 };

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d14);
  scene.fog = new THREE.FogExp2(0x090d14, .027);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 120);
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('game').appendChild(renderer.domElement);

  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0x9cc9e8, 0x16101c, 2.0));

  const moon = new THREE.DirectionalLight(0xb5d9ff, 1.4);
  moon.position.set(-6, 12, 5);
  scene.add(moon);

  buildDungeon();
  createPlayer();
  onResize();
  animate();
}

function mat(color, rough = .9, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}

function buildDungeon() {
  const floor = mat(0x252a31);
const wall = mat(0x414751, 0.95);
const dark = mat(0x171c24, 1);
const trim = mat(0x8a7150, 0.75, 0.25);

const stoneLight = mat(0x515965, 0.95);
const stoneDark = mat(0x303640, 1);
  const crystal = new THREE.MeshStandardMaterial({
    color: 0x70dfff,
    emissive: 0x167ca0,
    emissiveIntensity: 1.8
  });

  box(30, .8, 48, floor, 0, -.5, -11);

  for (let z = -34; z <= 12; z += 4) {
    box(29.8, .05, .06, dark, 0, -.07, z);
  }

  box(.7, 5, 48, wall, -15, 2, -11);
  box(.7, 5, 48, wall, 15, 2, -11);
// Detalhes de pedra nas paredes
for (let z = -30; z <= 8; z += 6) {
  box(0.12, 0.18, 2.2, stoneLight, -14.55, 1.2, z);
  box(0.12, 0.12, 1.5, stoneDark, -14.55, 2.8, z + 2);

  box(0.12, 0.18, 2.2, stoneLight, 14.55, 1.2, z);
  box(0.12, 0.12, 1.5, stoneDark, 14.55, 2.8, z + 2);
}
  box(30, 5, .8, wall, 0, 2, -35);
  box(30, 5, .8, wall, 0, 2, 13);

  for (let z = -32; z <= 9; z += 5) {
    for (const side of [-1, 1]) {
      const x = side * 14.35;
      box(.8, .35, .9, trim, x, 4.25, z);

      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.22), crystal);
      orb.position.set(side * 13.9, 3.7, z);
      scene.add(orb);

// O brilho dos cristais continua, sem luzes dinâmicas extras.
    }
  }

  for (let z = -30; z <= 8; z += 9) {
    for (const x of [-10, 10]) {
      box(1.35, 4.8, 1.35, dark, x, 2, z);
      box(1.65, .25, 1.65, trim, x, 4.45, z);
      box(1.55, .22, 1.55, wall, x, .05, z);
    }
  }

  for (const x of [-3.4, 3.4]) {
    box(.65, 4, .7, trim, x, 2, -31.8);
  }
  box(7.3, .55, .8, trim, 0, 4, -31.8);

  const rune = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 48),
    new THREE.MeshBasicMaterial({
      color: 0x53cde9,
      transparent: true,
      opacity: .48,
      side: THREE.DoubleSide
    })
  );
  rune.rotation.x = -Math.PI / 2;
  rune.position.set(0, .02, -16);
  scene.add(rune);

  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const crystalMesh = new THREE.Mesh(new THREE.OctahedronGeometry(.35), crystal);
    crystalMesh.position.set(Math.cos(a) * 2, .4, -16 + Math.sin(a) * 2);
    scene.add(crystalMesh);
  }

  for (let i = 0; i < 32; i++) {
    const x = (Math.random() - .5) * 25;
    const z = -30 + Math.random() * 39;
    if (Math.abs(x) < 3 && z > 0) continue;

    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(.2 + Math.random() * .35, 0),
      dark
    );
    rock.position.set(x, .02, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.y = .45;
    scene.add(rock);
  }
}

function trimMat() {
  return mat(0xc5a46b, .4, .6);
}

function makeHero(color = 0x72e6ff) {
  const g = new THREE.Group();
  const armor = mat(color, .55, .2);
  const dark = mat(0x1b2430, .8);
  const skin = mat(0xe2b99a);
  const metal = mat(0x8fa6b4, .35, .6);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.38, .55, 4, 7), armor);
  torso.position.y = 1.2;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.27, 10, 8), skin);
  head.position.y = 1.95;
  g.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(.28, 10, 6, 0, Math.PI * 2, 0, Math.PI * .55),
    dark
  );
  hair.position.y = 2.08;
  g.add(hair);

  const cape = new THREE.Mesh(new THREE.BoxGeometry(.56, .72, .12), dark);
  cape.position.set(0, 1.25, .32);
  g.add(cape);

  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .43, 3, 5), armor);
    arm.position.set(s * .48, 1.25, 0);
    arm.rotation.z = s * -.13;
    g.add(arm);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.15, .45, 3, 5), dark);
    leg.position.set(s * .2, .48, 0);
    g.add(leg);
  }

  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.09, .75, .12), metal);
  blade.position.y = .47;
  sword.add(blade);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(.32, .07, .16), trimMat());
  guard.position.y = .12;
  sword.add(guard);

  sword.position.set(.56, 1.02, -.1);
  sword.rotation.z = -.25;
  g.add(sword);
  g.userData.sword = sword;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(.43, .49, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .025;
  g.add(ring);

  return g;
}

function createPlayer() {
  myPlayer = makeHero();
  scene.add(myPlayer);
  myPlayer.position.set(0, 0, 3);
}

function makeBoss() {
  const g = new THREE.Group();
  const armor = mat(0x29202f, .55, .35), dark = mat(0x100e18, .7, .2), bone = mat(0x9c8aa8, .45, .35);
  const eye = new THREE.MeshStandardMaterial({ color: 0xff345d, emissive: 0xff123c, emissiveIntensity: 2.8 });
  const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1), armor); torso.position.y = 1.65; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.68, 12, 10), dark); head.position.y = 2.85; g.add(head);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(.22, .95, 6), bone); horn.position.set(side * .48, 3.55, 0); horn.rotation.z = side * -.38; g.add(horn);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.12, 8, 6), eye); e.position.set(side * .25, 2.9, -.59); g.add(e);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .9, 4, 7), armor); arm.position.set(side * 1.12, 1.6, 0); arm.rotation.z = side * -.22; g.add(arm);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(.18, .55, 5), bone); claw.position.set(side * 1.2, .82, -.05); claw.rotation.z = Math.PI; g.add(claw);
  }
  const rune = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.65, 32), new THREE.MeshBasicMaterial({ color: 0xff315d, transparent: true, opacity: .7, side: THREE.DoubleSide }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = .04; g.add(rune);
  g.userData.eyeMaterial = eye; g.userData.bodyMaterial = armor; return g;
}
function makeChest() {
  const group = new THREE.Group();
  const wood = mat(0x68452c, .8);
  const metal = mat(0xb9944e, .35, .55);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, .65, .8), wood);
  body.position.y = .38; group.add(body);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.2, .2, .85), metal);
  lid.position.y = .76; group.add(lid);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(.16, .22, .08), metal);
  lock.position.set(0, .52, -.44); group.add(lock);
  return group;
}

function renderInventory() {
  const el = $('inventoryList');
  if (!el) return;
  const rarityOrder = ['comum', 'incomum', 'raro', 'épico', 'lendário'];
  el.innerHTML = rarityOrder.map(r => '<div class="loot-row rarity-' + r.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') + '"><span>' + r + '</span><b>' + (inventoryData[r] || 0) + '</b></div>').join('');
  const recent = lootDrops.slice(-4).reverse();
  $('recentLoot').innerHTML = recent.length ? recent.map(item => '<div class="loot-item rarity-' + item.rarity.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') + '">' + escapeHTML(item.name) + ' <small>(' + escapeHTML(item.rarity) + ')</small></div>').join('') : '<small>Nenhum item coletado ainda.</small>';
}

function interactChest() {
  if (!started || !myPlayer) return;
  let nearest = null, distance = Infinity;
  for (const chest of latestChests) {
    const d = Math.hypot(chest.x - myPlayer.position.x, chest.z - myPlayer.position.z);
    if (d < distance) { nearest = chest; distance = d; }
  }
  if (!nearest || distance > 3.0) { showNotice('Chegue perto de um baú.'); return; }
  send({ type: 'openChest', id: nearest.id });
}

function makeMonster() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(.68, 1), mat(0x423c55, .85));
  body.position.y = .85;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.4, 10, 8), mat(0x62536c));
  head.position.y = 1.55;
  g.add(head);

  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff425f });
  for (const x of [-.16, .16]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 6), eyeMat);
    eye.position.set(x, 1.59, -.34);
    g.add(eye);
  }

  for (const x of [-.42, .42]) {
    const claw = new THREE.Mesh(new THREE.ConeGeometry(.12, .48, 5), mat(0x8a7b91));
    claw.position.set(x, .55, -.05);
    claw.rotation.z = x > 0 ? -.4 : .4;
    g.add(claw);
  }

  return g;
}

function onResize() {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
}
addEventListener('resize', onResize);

function setStatus(t) {
  menuStatus.textContent = t;
}

function connect(code = '') {
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendJoin(code);
    return;
  }

  if (!location.host) {
    setStatus('Abra pelo link do servidor online para jogar.');
    return;
  }

  loading.classList.remove('hidden');
  $('loadingText').textContent = 'Conectando ao servidor...';
  setStatus('Conectando...');

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.addEventListener('open', () => sendJoin(code));
  ws.addEventListener('message', e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handleMessage(m);
  });

  ws.addEventListener('error', () => {
    loading.classList.add('hidden');
    setStatus('Não foi possível conectar. Confira se o servidor online está publicado.');
  });

  ws.addEventListener('close', () => {
    if (started) {
      started = false;
      hud.classList.add('hidden');
      menu.classList.remove('hidden');
      setStatus('Conexão perdida. Tente entrar novamente.');
    }
  });
}

function sendJoin(code) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  send({
    type: 'join',
    name: $('playerName').value.trim() || 'Aventureiro',
    code
  });
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function handleMessage(m) {
  if (m.type === 'error') {
    loading.classList.add('hidden');
    setStatus(m.message);
    return;
  }

  if (m.type === 'joined') {
    playerId = m.id;
    roomCode = m.room;
    started = true;
    menu.classList.add('hidden');
    loading.classList.add('hidden');
    hud.classList.remove('hidden');
    $('roomLabel').textContent = roomCode;
    $('loadingText').textContent = '';
    showNotice('Você entrou na masmorra!');
    return;
  }

  if (m.type === 'inventory') {
    inventoryData = m.inventory || inventoryData;
    lootDrops = m.lootDrops || lootDrops;
    renderInventory();
    return;
  }

  if (m.type === 'loot') {
    showNotice('Loot: ' + m.item.name + ' · ' + m.item.rarity);
    renderInventory();
    return;
  }

  if (m.type === 'notice') {
    showNotice(m.text);
    return;
  }

  if (m.type === 'attack') {
    if (m.id !== playerId) {
      const p = remotePlayers.get(m.id);
      if (p && p.userData.sword) {
        p.userData.sword.rotation.x = -1.2;
        setTimeout(() => {
          if (p.userData.sword) p.userData.sword.rotation.x = 0;
        }, 180);
      }
    }
    return;
  }

  if (m.type === 'state') updateState(m);
}

function updateState(m) {
  const incoming = new Set();

  for (const p of m.players) {
    incoming.add(p.id);

    if (p.id === playerId) {
      if (myPlayer) {
        myPlayer.userData.serverX = p.x;
        myPlayer.userData.serverZ = p.z;
      }
      continue;
    }

    let obj = remotePlayers.get(p.id);
    if (!obj) {
      obj = makeHero(p.color);
      scene.add(obj);
      remotePlayers.set(p.id, obj);
    }

    obj.userData.targetX = p.x;
    obj.userData.targetZ = p.z;
    obj.userData.targetRot = p.rot;
    obj.userData.name = p.name;
  }

  for (const [id, obj] of remotePlayers) {
    if (!incoming.has(id)) {
      scene.remove(obj);
      remotePlayers.delete(id);
    }
  }

  const phase = m.phase || 1, phaseLabel = $('phaseLabel');
  if (phaseLabel) phaseLabel.textContent = 'FASE ' + phase + ' / 3';
  const bossPanel = $('bossPanel');
  if (bossPanel) bossPanel.classList.toggle('hidden', phase !== 3 || !m.boss || !m.boss.alive);
  bossData = m.boss || null;
  if (bossData && bossData.alive) {
    if (!bossMesh) { bossMesh = makeBoss(); scene.add(bossMesh); }
    bossMesh.visible = true; bossMesh.userData.targetX = bossData.x; bossMesh.userData.targetZ = bossData.z;
    const lifePhase = bossData.lifePhase || 1; bossMesh.userData.lifePhase = lifePhase;
    bossMesh.userData.bodyMaterial.color.set(lifePhase === 1 ? 0x29202f : lifePhase === 2 ? 0x59202f : 0x8b182a);
    bossMesh.userData.eyeMaterial.color.set(lifePhase === 3 ? 0xffc12e : 0xff345d);
    $('bossHealthFill').style.width = (bossData.hp / bossData.maxHp * 100) + '%';
    $('bossHealthText').textContent = bossData.hp + ' / ' + bossData.maxHp;
    $('bossPhaseText').textContent = 'FASE DE VIDA ' + lifePhase + ' / 3';
  } else if (bossMesh) {
    bossMesh.visible = false;
    if (bossData && !bossData.alive) {
      bossPanel?.classList.remove('hidden'); $('bossPhaseText').textContent = 'GUARDIÃO DERROTADO';
      $('bossHealthFill').style.width = '0%'; $('bossHealthText').textContent = '0 / 15';
    }
  }
  latestChests = m.chests || [];
  for (const chest of latestChests) {
    let obj = chestMeshes.get(chest.id);
    if (!obj) {
      obj = makeChest();
      obj.position.set(chest.x, 0, chest.z);
      scene.add(obj);
      chestMeshes.set(chest.id, obj);
    }
    obj.userData.chestId = chest.id;
  }

  let alive = 0;
  for (const mtr of m.monsters) {
    if (mtr.alive) alive++;

    let obj = monsterMeshes.get(mtr.id);
    if (!obj) {
      obj = makeMonster();
      scene.add(obj);
      monsterMeshes.set(mtr.id, obj);
    }

    obj.userData.targetX = mtr.x;
    obj.userData.targetZ = mtr.z;
    obj.userData.alive = mtr.alive;
    obj.visible = mtr.alive;
  }

  $('monsterText').textContent = phase === 3
    ? (bossData && bossData.alive ? 'Guardião do Abismo' : 'Masmorra concluída')
    : alive + ' monstros restantes';
  const phaseTotal = phase === 1 ? 7 : phase === 2 ? 9 : 15;
  const phaseProgress = phase === 3 && bossData
    ? (phaseTotal - bossData.hp) / phaseTotal * 100
    : (phaseTotal - alive) / phaseTotal * 100;
  $('progressFill').style.width = Math.max(0, Math.min(100, phaseProgress)) + '%';
  $('killText').textContent = phase === 3 && bossData
    ? phaseTotal - bossData.hp
    : phaseTotal - alive;

  $('playersList').innerHTML = m.players.map(p =>
    `<div class="player-chip">● ${escapeHTML(p.name)}${p.id === playerId ? ' (você)' : ''}</div>`
  ).join('');
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function showNotice(t) {
  const n = $('notice');
  n.textContent = t;
  n.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => n.classList.remove('show'), 1900);
}

function moveInput() {
  let x = joy.x, y = joy.y;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) y -= 1;
  if (keys.KeyS || keys.ArrowDown) y += 1;

  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return { x, y };
}

function attack() {
  if (!started || attackCooldown > 0) return;

  attackCooldown = .45;
  send({ type: 'attack' });

  const sword = myPlayer?.userData.sword;
  if (sword) {
    sword.rotation.x = -1.1;
    setTimeout(() => {
      if (sword) sword.rotation.x = 0;
    }, 180);
  }

  const f = $('hitFlash');
  f.style.borderWidth = '5px';
  setTimeout(() => f.style.borderWidth = '0', 100);
}

$('playBtn').addEventListener('click', () => connect(''));

$('joinBtn').addEventListener('click', () => {
  const c = $('roomCode').value.trim().toUpperCase();
  if (c.length < 4) {
    setStatus('Digite o código da sala do seu amigo.');
    return;
  }
  connect(c);
});

$('roomCode').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

$('leaveBtn').addEventListener('click', () => {
  send({ type: 'leave' });
  if (ws) ws.close();
  started = false;
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
});

$('chestBtn').addEventListener('pointerdown', e => { e.preventDefault(); interactChest(); });

$('attackBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  attack();
});

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') {
    e.preventDefault();
    attack();
  }
});
addEventListener('keyup', e => keys[e.code] = false);

// Joystick de toque
const joyEl = $('joystick'), stick = $('stick');
let joyPointer = null;

function setJoy(e) {
  const r = joyEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = r.width * .34, len = Math.hypot(dx, dy);

  if (len > max) {
    dx = dx / len * max;
    dy = dy / len * max;
  }

  joy.x = dx / max;
  joy.y = dy / max;
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
}

joyEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  joyPointer = e.pointerId;
  joyEl.setPointerCapture(e.pointerId);
  setJoy(e);
});

joyEl.addEventListener('pointermove', e => {
  if (e.pointerId === joyPointer) {
    e.preventDefault();
    setJoy(e);
  }
});

function endJoy(e) {
  if (e.pointerId !== joyPointer) return;
  joyPointer = null;
  joy.x = joy.y = 0;
  stick.style.transform = 'translate(0,0)';
}
joyEl.addEventListener('pointerup', endJoy);
joyEl.addEventListener('pointercancel', endJoy);

// Arrastar fora dos controles para girar a câmera
let lookPointer = null, lastX = 0, lastY = 0;

function rendererPointerSetup() {
  const el = $('game');

  el.addEventListener('pointerdown', e => {
    if (!started ||
        (e.clientX < 155 && e.clientY > innerHeight - 190) ||
        (e.clientX > innerWidth - 135 && e.clientY > innerHeight - 155)) return;

    lookPointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  el.addEventListener('pointermove', e => {
    if (e.pointerId !== lookPointer) return;

    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw -= dx * .006;
    pitch = THREE.MathUtils.clamp(pitch + dy * .003, -.1, .8);
  });

  const end = e => {
    if (e.pointerId === lookPointer) lookPointer = null;
  };

  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
rendererPointerSetup();


function animate() {
  requestAnimationFrame(animate);
  if (!renderer) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  const remoteSmooth = 1 - Math.exp(-14 * dt);
  const monsterSmooth = 1 - Math.exp(-5 * dt);
  const cameraSmooth = 1 - Math.exp(-9 * dt);

  attackCooldown = Math.max(0, attackCooldown - dt);

  // Movimento do jogador local
  if (started && myPlayer) {
    const v = moveInput();

    if (Math.hypot(v.x, v.y) > 0.04) {
      const forward = new THREE.Vector3(
  -Math.sin(yaw), 0, -Math.cos(yaw)
);
const right = new THREE.Vector3(
  Math.cos(yaw), 0, -Math.sin(yaw)
);

      const dir = forward
        .multiplyScalar(-v.y)
        .add(right.multiplyScalar(v.x))
        .normalize();

      myPlayer.position.x = THREE.MathUtils.clamp(
        myPlayer.position.x + dir.x * dt * 5.8,
        -13, 13
      );

      myPlayer.position.z = THREE.MathUtils.clamp(
        myPlayer.position.z + dir.z * dt * 5.8,
        -31, 8
      );

      myPlayer.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
    }

    if (performance.now() - lastMove > 70) {
      send({
        type: 'move',
        x: myPlayer.position.x,
        z: myPlayer.position.z,
        rot: myPlayer.rotation.y
      });

      lastMove = performance.now();
    }
  }

  // Movimento suave dos outros jogadores
  for (const obj of remotePlayers.values()) {
    if (obj.userData.targetX === undefined) continue;

    obj.position.x = THREE.MathUtils.lerp(
      obj.position.x, obj.userData.targetX, remoteSmooth
    );

    obj.position.z = THREE.MathUtils.lerp(
      obj.position.z, obj.userData.targetZ, remoteSmooth
    );

    const targetRot = obj.userData.targetRot ?? 0;
    const angleDiff = Math.atan2(
      Math.sin(targetRot - obj.rotation.y),
      Math.cos(targetRot - obj.rotation.y)
    );

    obj.rotation.y += angleDiff * remoteSmooth;
  }

  if (bossMesh && bossMesh.visible && bossMesh.userData.targetX !== undefined) {
    bossMesh.position.x = THREE.MathUtils.lerp(bossMesh.position.x, bossMesh.userData.targetX, monsterSmooth);
    bossMesh.position.z = THREE.MathUtils.lerp(bossMesh.position.z, bossMesh.userData.targetZ, monsterSmooth);
    bossMesh.position.y = .08 + Math.sin(performance.now() * .0015) * .12;
    bossMesh.rotation.y += dt * (bossMesh.userData.lifePhase === 3 ? .65 : .25);
  }
  // Movimento suave dos monstros
  for (const obj of monsterMeshes.values()) {
    if (obj.userData.targetX === undefined) continue;

    obj.position.x = THREE.MathUtils.lerp(
      obj.position.x, obj.userData.targetX, monsterSmooth
    );

    obj.position.z = THREE.MathUtils.lerp(
      obj.position.z, obj.userData.targetZ, monsterSmooth
    );

    obj.position.y =
      0.05 + Math.sin(performance.now() * 0.002 + obj.position.x) * 0.08;

    obj.rotation.y += dt * 0.35;
  }

  // Câmera em terceira pessoa com acompanhamento suave
  if (myPlayer) {
    const target = new THREE.Vector3(
      myPlayer.position.x,
      1.2,
      myPlayer.position.z
    );

    const dist = 8.5;

    const cameraTarget = new THREE.Vector3(
      target.x + Math.sin(yaw) * dist,
      target.y + 3.0 + pitch * 2,
      target.z + Math.cos(yaw) * dist
    );

    camera.position.lerp(cameraTarget, cameraSmooth);

    camera.lookAt(
      target.x,
      target.y + 0.15,
      target.z
    );
  }

  renderer.render(scene, camera);
}

init3D();
