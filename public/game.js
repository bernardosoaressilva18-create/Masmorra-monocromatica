
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';

const $ = id => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), loading = $('loading'), menuStatus = $('menuStatus');

let renderer, scene, camera, clock, ws, playerId = null, roomCode = '', myPlayer = null, started = false;
let yaw = 0, pitch = .25, joy = { x: 0, y: 0 }, keys = {}, lastMove = 0, attackCooldown = 0, noticeTimer = 0;
const remotePlayers = new Map(), monsterMeshes = new Map();
const world = { width: 30, depth: 46 };

// Exibe HP sempre como número inteiro, mesmo que o servidor envie decimais.
function formatHealth(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

// Barra de vida 3D: acompanha a cabeça e vira para a câmera automaticamente.
function makeHealthBar(parent, y, width = 1.25) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 56;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(0, y, 0);
  sprite.scale.set(width, 0.25, 1);
  sprite.renderOrder = 4;
  sprite.userData.healthCanvas = canvas;
  sprite.userData.healthContext = ctx;
  sprite.userData.healthTexture = texture;
  sprite.userData.lastHp = null;
  sprite.userData.lastMaxHp = null;
  parent.add(sprite);
  updateHealthBar(sprite, 100, 100);
  return sprite;
}

function updateHealthBar(sprite, hp, maxHp = 100) {
  if (!sprite) return;
  const max = Math.max(1, formatHealth(maxHp));
  const current = Math.min(max, formatHealth(hp));
  if (sprite.userData.lastHp === current && sprite.userData.lastMaxHp === max) return;

  const ctx = sprite.userData.healthContext;
  const texture = sprite.userData.healthTexture;
  if (!ctx || !texture) return;

  const ratio = current / max;
  ctx.clearRect(0, 0, 256, 56);
  ctx.fillStyle = 'rgba(5, 9, 14, 0.92)';
  ctx.fillRect(1, 1, 254, 54);
  ctx.strokeStyle = 'rgba(230, 244, 250, 0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 252, 52);

  ctx.fillStyle = '#252a32';
  ctx.fillRect(8, 8, 240, 40);
  const fillColor = ratio > 0.55 ? '#51e08a' : ratio > 0.28 ? '#f0c84b' : '#ff5364';
  ctx.fillStyle = fillColor;
  ctx.fillRect(8, 8, 240 * ratio, 40);

  ctx.font = 'bold 23px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.strokeText(current + ' / ' + max, 128, 29);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(current + ' / ' + max, 128, 29);

  texture.needsUpdate = true;
  sprite.userData.lastHp = current;
  sprite.userData.lastMaxHp = max;
}


/* Áudio procedural: funciona sem baixar arquivos externos. */
let audioCtx = null, masterGain = null, musicGain = null, sfxGain = null;
let musicEnabled = true, sfxEnabled = true, musicNodes = [], stepTimer = 0, lastGrowlAt = 0, lastDamageAt = 0, victoryPlayed = false, masterVolume = 0.55;
let lookSensitivity = 0.010, verticalSensitivity = 0.005;

function initAudio() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  if (!audioCtx) {
    audioCtx = new AudioCtor();
    masterGain = audioCtx.createGain();
    musicGain = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    musicGain.gain.value = musicEnabled ? 0.19 : 0;
    sfxGain.gain.value = sfxEnabled ? 0.65 : 0;
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    // Camada ambiente grave e suave para dar clima de masmorra.
    for (const [freq, type, volume] of [[55, 'sine', .34], [82.41, 'triangle', .12], [110, 'sine', .08]]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(musicGain);
      osc.start();
      musicNodes.push({osc, gain});
    }
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 0.09;
    lfoGain.gain.value = 0.025;
    lfo.connect(lfoGain);
    lfoGain.connect(musicGain.gain);
    lfo.start();
    musicNodes.push({osc:lfo, gain:lfoGain});
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  updateAudioButtons();
}

function updateAudioButtons() {
  const musicBtn = $('musicToggle');
  const sfxBtn = $('sfxToggle');
  if (musicBtn) musicBtn.textContent = musicEnabled ? '♫ MÚSICA: LIGADA' : '♫ MÚSICA: DESLIGADA';
  if (sfxBtn) sfxBtn.textContent = sfxEnabled ? '🔊 EFEITOS: LIGADOS' : '🔇 EFEITOS: DESLIGADOS';
}

function toggleMusic() {
  musicEnabled = !musicEnabled;
  if (musicGain && audioCtx) musicGain.gain.setTargetAtTime(musicEnabled ? 0.19 : 0, audioCtx.currentTime, .15);
  if (musicEnabled) initAudio();
  updateAudioButtons();
}

function toggleSfx() {
  sfxEnabled = !sfxEnabled;
  if (sfxGain && audioCtx) sfxGain.gain.setTargetAtTime(sfxEnabled ? 0.65 : 0, audioCtx.currentTime, .03);
  if (sfxEnabled) initAudio();
  updateAudioButtons();
}

function tone(freq, duration, type='sine', volume=.2, endFreq=null) {
  if (!sfxEnabled) return;
  initAudio();
  if (!audioCtx || !sfxGain) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + duration);
  gain.gain.setValueAtTime(.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  osc.connect(gain);
  gain.connect(sfxGain);
  osc.start(now);
  osc.stop(now + duration + .02);
}

function playSwordSound() {
  tone(520, .13, 'sawtooth', .16, 115);
  tone(170, .10, 'triangle', .10, 70);
}
function playJoinSound() {
  tone(440, .14, 'sine', .12, 660);
  setTimeout(() => tone(660, .22, 'sine', .12, 880), 100);
}
function playFootstep() {
  tone(90 + Math.random()*25, .055, 'triangle', .045, 45);
}
function playMonsterGrowl() {
  tone(105, .28, 'sawtooth', .12, 42);
  tone(68, .32, 'triangle', .10, 35);
}
function playDamageSound() {
  tone(190, .20, 'sawtooth', .20, 48);
  tone(75, .16, 'triangle', .15, 38);
}
function playMonsterDefeat() {
  tone(360, .10, 'triangle', .12, 240);
  setTimeout(() => tone(240, .18, 'sine', .10, 120), 80);
}
function playBossDefeat() {
  tone(440, .18, 'sawtooth', .16, 220);
  setTimeout(() => tone(330, .2, 'triangle', .16, 165), 130);
  setTimeout(() => tone(660, .34, 'sine', .14, 880), 280);
}
function playVictory() {
  [440, 554, 659, 880].forEach((freq, i) => setTimeout(() => tone(freq, .24, 'sine', .12, freq * 1.12), i * 135));
}


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

  g.userData.healthBar = makeHealthBar(g, 2.58, 1.3);
  return g;
}

function createPlayer() {
  myPlayer = makeHero();
  scene.add(myPlayer);
  myPlayer.position.set(0, 0, 3);
}

function makeMonster(isBoss = false) {
  const g = new THREE.Group();
  g.userData.isBoss = isBoss;

  const body = new THREE.Mesh(
    new THREE.DodecahedronGeometry(isBoss ? 1.0 : .68, 1),
    mat(isBoss ? 0x72512b : 0x423c55, .85, isBoss ? .28 : 0)
  );
  body.position.y = isBoss ? 1.15 : .85;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(isBoss ? .52 : .4, 10, 8), mat(isBoss ? 0xb47b3c : 0x62536c));
  head.position.y = isBoss ? 2.0 : 1.55;
  g.add(head);

  const eyeMat = new THREE.MeshBasicMaterial({ color: isBoss ? 0xffc44d : 0xff425f });
  for (const x of [-.16, .16]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.065, 8, 6), eyeMat);
    eye.position.set(x * (isBoss ? 1.2 : 1), isBoss ? 2.04 : 1.59, isBoss ? -.45 : -.34);
    g.add(eye);
  }

  for (const x of [-.42, .42]) {
    const claw = new THREE.Mesh(new THREE.ConeGeometry(isBoss ? .16 : .12, isBoss ? .62 : .48, 5), mat(isBoss ? 0xe3b75b : 0x8a7b91));
    claw.position.set(x, .55, -.05);
    claw.rotation.z = x > 0 ? -.4 : .4;
    g.add(claw);
  }

  g.userData.healthBar = makeHealthBar(g, isBoss ? 2.86 : 2.16, isBoss ? 1.55 : 1.25);
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
    playJoinSound();
    return;
  }

  if (m.type === 'notice') {
    showNotice(m.text);
    return;
  }

  if (m.type === 'damage') {
    if (m.id === playerId) {
      lastDamageAt = performance.now();
      playDamageSound();
      $('hpText').textContent = formatHealth(m.hp);
      showNotice(m.hp <= 0 ? 'Você foi derrotado e voltou à entrada!' : 'Você recebeu dano!');
    }
    return;
  }

  if (m.type === 'monsterDefeated') {
    if (m.boss) {
      playBossDefeat();
      showNotice('O guardião da masmorra foi derrotado!');
    } else {
      playMonsterDefeat();
    }
    if (m.remaining === 0 && !victoryPlayed) {
      victoryPlayed = true;
      setTimeout(playVictory, m.boss ? 850 : 350);
      showNotice('Masmorra concluída! Todos os monstros foram derrotados.');
    }
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
        updateHealthBar(myPlayer.userData.healthBar, p.hp ?? 100, p.maxHp ?? 100);
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
    updateHealthBar(obj.userData.healthBar, p.hp ?? 100, p.maxHp ?? 100);
  }

  for (const [id, obj] of remotePlayers) {
    if (!incoming.has(id)) {
      scene.remove(obj);
      remotePlayers.delete(id);
    }
  }

  let alive = 0;
  for (const mtr of m.monsters) {
    if (mtr.alive) alive++;

    let obj = monsterMeshes.get(mtr.id);
    if (!obj) {
      obj = makeMonster(Boolean(mtr.isBoss));
      scene.add(obj);
      monsterMeshes.set(mtr.id, obj);
    }

    obj.userData.targetX = mtr.x;
    obj.userData.targetZ = mtr.z;
    obj.userData.alive = mtr.alive;
    obj.visible = mtr.alive;
  }

  $('monsterText').textContent = alive + ' monstros restantes';
  const mine = m.players.find(p => p.id === playerId);
  if (mine && mine.hp != null) $('hpText').textContent = formatHealth(mine.hp);

  // Atualiza a barra dos monstros e do guardião em todos os clientes.
  for (const mtr of m.monsters) {
    const obj = monsterMeshes.get(mtr.id);
    if (!obj) continue;
    const fallbackMax = mtr.isBoss ? 180 : 60;
    obj.userData.hp = formatHealth(mtr.hp ?? fallbackMax);
    obj.userData.maxHp = formatHealth(mtr.maxHp ?? fallbackMax);
    updateHealthBar(obj.userData.healthBar, obj.userData.hp, obj.userData.maxHp);
  }
  if (alive > 0) victoryPlayed = false;
  $('progressFill').style.width = ((7 - alive) / 7 * 100) + '%';
  $('killText').textContent = 7 - alive;

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
  playSwordSound();
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
    yaw -= dx * lookSensitivity;
    pitch = THREE.MathUtils.clamp(pitch + dy * verticalSensitivity, -.1, .8);
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
      stepTimer -= dt;
      if (stepTimer <= 0) { playFootstep(); stepTimer = 0.38; }
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
    } else {
      stepTimer = 0;
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

    obj.rotation.y += dt * (obj.userData.isBoss ? 0.22 : 0.35);
    if (started && obj.visible && myPlayer) {
      const distance = Math.hypot(obj.position.x - myPlayer.position.x, obj.position.z - myPlayer.position.z);
      if (distance < 5 && performance.now() - lastGrowlAt > 4200) {
        lastGrowlAt = performance.now();
        playMonsterGrowl();
      }
    }
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


$('musicToggle')?.addEventListener('click', () => { initAudio(); toggleMusic(); });
$('sfxToggle')?.addEventListener('click', () => { initAudio(); toggleSfx(); });
$('volume')?.addEventListener('input', e => {
  const value = Number(e.target.value);
  masterVolume = value;
  $('volumeValue').textContent = Math.round(value * 100) + '%';
  if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(value, audioCtx.currentTime, .05);
});
$('sensitivity')?.addEventListener('input', e => {
  lookSensitivity = Number(e.target.value);
  verticalSensitivity = lookSensitivity * 0.5;
  $('sensitivityValue').textContent = Math.round(lookSensitivity * 1000) + '%';
});
$('playBtn').addEventListener('click', initAudio);
$('joinBtn').addEventListener('click', initAudio);
updateAudioButtons();
init3D();
