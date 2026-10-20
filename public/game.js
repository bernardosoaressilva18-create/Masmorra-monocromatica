
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';

const $ = id => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), loading = $('loading'), menuStatus = $('menuStatus');

let renderer, scene, camera, clock, ws, playerId = null, roomCode = '', myPlayer = null, started = false;
let inLobby = false, lobbyMode = true, dungeonGroup = null, lobbyGroup = null;
let myHeroClass = 'guardiao', mySkin = 'padrao', mySkill = null, playerReady = false, lobbyRosterData = [];
let yaw = 0, pitch = .25, joy = { x: 0, y: 0 }, keys = {}, lastMove = 0, attackCooldown = 0, noticeTimer = 0;
const remotePlayers = new Map(), monsterMeshes = new Map();
const CLASS_NAMES = { punheteiro: 'punheteiro', mago: 'Mago', assassino: 'Assassino' };
const SKIN_NAMES = { padrao: 'Padrão', gelo: 'Gelo', sombra: 'Sombra', ouro: 'Ouro', brasa: 'Brasa' };
const SKILL_INFO = {
  golpe_pesado: { title: 'Golpe pesado', description: 'Seus ataques causam 30 de dano em vez de 20.', icon: '⚔' },
  passos_leves: { title: 'Passos leves', description: 'Sua velocidade aumenta de 5,8 para 7.', icon: '➤' },
  vitalidade: { title: 'Vitalidade', description: 'Aumenta sua vida máxima para 120 e recupera sua vida ao selecionar.', icon: '♥' }
};
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
  canvas.height = 84;
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
  sprite.scale.set(width, 0.42, 1);
  sprite.userData.baseScale = { width, height: 0.42 };
  sprite.renderOrder = 4;
  sprite.userData.healthCanvas = canvas;
  sprite.userData.healthContext = ctx;
  sprite.userData.healthTexture = texture;
  sprite.userData.lastHp = null;
  sprite.userData.lastMaxHp = null;
  sprite.userData.lastName = null;
  parent.add(sprite);
  updateHealthBar(sprite, 100, 100);
  return sprite;
}

function updateHealthBar(sprite, hp, maxHp = 100, name = '') {
  if (!sprite) return;
  const max = Math.max(1, formatHealth(maxHp));
  const current = Math.min(max, formatHealth(hp));
  const displayName = String(name || '').slice(0, 22);
  if (sprite.userData.lastHp === current && sprite.userData.lastMaxHp === max && sprite.userData.lastName === displayName) return;

  const ctx = sprite.userData.healthContext;
  const texture = sprite.userData.healthTexture;
  if (!ctx || !texture) return;

  const ratio = current / max;
  ctx.clearRect(0, 0, 256, 84);
  ctx.fillStyle = 'rgba(5, 9, 14, 0.92)';
  ctx.fillRect(1, 1, 254, 82);
  ctx.strokeStyle = 'rgba(230, 244, 250, 0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, 252, 80);

  ctx.fillStyle = '#252a32';
  ctx.fillRect(8, 30, 240, 42);
  const fillColor = ratio > 0.55 ? '#51e08a' : ratio > 0.28 ? '#f0c84b' : '#ff5364';
  ctx.fillStyle = fillColor;
  ctx.fillRect(8, 30, 240 * ratio, 42);

  ctx.font = 'bold 23px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 19px Arial, sans-serif';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
  ctx.strokeText(displayName, 128, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(displayName, 128, 16);
  ctx.font = 'bold 23px Arial, sans-serif';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.strokeText(current + ' / ' + max, 128, 51);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(current + ' / ' + max, 128, 51);

  texture.needsUpdate = true;
  sprite.userData.lastHp = current;
  sprite.userData.lastMaxHp = max;
  sprite.userData.lastName = displayName;
}


// Barras discretas à distância e mais legíveis quando o personagem está perto.
function updateHealthBarDistance(sprite, owner) {
  if (!sprite || !owner || !camera) return;
  const distance = camera.position.distanceTo(owner.getWorldPosition(new THREE.Vector3()));
  const base = sprite.userData.baseScale || { width: 1.25, height: 0.42 };
  const scale = THREE.MathUtils.clamp(12 / Math.max(distance, 1), 0.68, 1.12);
  sprite.scale.set(base.width * scale, base.height * scale, 1);
  sprite.material.opacity = THREE.MathUtils.clamp(1.15 - distance / 38, 0.38, 1);
}

const healthOcclusionRaycaster = new THREE.Raycaster();
const healthOcclusionTarget = new THREE.Vector3();
const healthOcclusionDirection = new THREE.Vector3();
function updateHealthBarOcclusion(sprite, owner) {
  if (!sprite || !owner || !camera) return;
  if (lobbyMode || !started || !dungeonGroup) { sprite.visible = false; return; }
  const now = performance.now();
  if (now < (sprite.userData.nextOcclusionCheck || 0)) return;
  sprite.userData.nextOcclusionCheck = now + 100;
  sprite.getWorldPosition(healthOcclusionTarget);
  healthOcclusionDirection.subVectors(healthOcclusionTarget, camera.position);
  const distance = healthOcclusionDirection.length();
  if (distance < 0.01) { sprite.visible = true; return; }
  healthOcclusionDirection.normalize();
  healthOcclusionRaycaster.set(camera.position, healthOcclusionDirection);
  healthOcclusionRaycaster.far = Math.max(0, distance - 0.28);
  const hits = healthOcclusionRaycaster.intersectObjects(dungeonGroup.children, true);
  sprite.visible = !(hits.length && hits[0].distance < distance - 0.28);
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
  scene.fog = new THREE.FogExp2(0x090d14, .018);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 120);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('game').appendChild(renderer.domElement);

  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0x9cc9e8, 0x16101c, 2.0));
  const moon = new THREE.DirectionalLight(0xb5d9ff, 1.4);
  moon.position.set(-6, 12, 5);
  scene.add(moon);

  dungeonGroup = new THREE.Group();
  dungeonGroup.name = 'dungeon-world';
  scene.add(dungeonGroup);
  buildDungeon();
  createPlayer();
  buildLobby();
  dungeonGroup.visible = false;
  lobbyGroup.visible = true;
  onResize();
  animate();
}

function mat(color, rough = .9, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  dungeonGroup.add(m);
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
      dungeonGroup.add(orb);

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
  dungeonGroup.add(rune);

  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    const crystalMesh = new THREE.Mesh(new THREE.OctahedronGeometry(.35), crystal);
    crystalMesh.position.set(Math.cos(a) * 2, .4, -16 + Math.sin(a) * 2);
    dungeonGroup.add(crystalMesh);
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
    dungeonGroup.add(rock);
  }
}

function buildLobby() {
  lobbyGroup = new THREE.Group();
  lobbyGroup.name = 'guild-lobby';
  scene.add(lobbyGroup);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x101c27, roughness: .8, metalness: .22 });
  const stageMat = new THREE.MeshStandardMaterial({ color: 0x293b49, roughness: .48, metalness: .42 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe2bd70, roughness: .35, metalness: .58, emissive: 0x573b12, emissiveIntensity: .4 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x62dff2, roughness: .25, metalness: .25, emissive: 0x146a8b, emissiveIntensity: 1.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111923, roughness: .75, metalness: .25 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.34; lobbyGroup.add(floor);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 9, .32, 64), stageMat);
  platform.position.set(0, -.16, 0); lobbyGroup.add(platform);
  for (const [r1,r2,material,y] of [[7.35,7.52,goldMat,.012],[6.45,6.53,glowMat,.018]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r1,r2,64),material);
    ring.rotation.x=-Math.PI/2; ring.position.y=y; lobbyGroup.add(ring);
  }
  for(let i=0;i<4;i++){
    const x=(i-1.5)*3.1;
    const ring=new THREE.Mesh(new THREE.RingGeometry(.72,.79,32),i%2?glowMat:goldMat);
    ring.rotation.x=-Math.PI/2;ring.position.set(x,.025,.1);lobbyGroup.add(ring);
    const sigil=new THREE.Mesh(new THREE.CircleGeometry(.52,32),darkMat);
    sigil.rotation.x=-Math.PI/2;sigil.position.set(x,.014,.1);lobbyGroup.add(sigil);
  }
  const pillarMat=new THREE.MeshStandardMaterial({color:0x364653,roughness:.75,metalness:.3});
  const left=new THREE.Mesh(new THREE.BoxGeometry(.72,4.8,.86),pillarMat);
  left.position.set(-2.65,2.05,-5.15);lobbyGroup.add(left);
  const right=left.clone();right.position.x=2.65;lobbyGroup.add(right);
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(6,.72,1.02),goldMat);
  lintel.position.set(0,4.48,-5.15);lobbyGroup.add(lintel);
  const portal=new THREE.Mesh(new THREE.TorusGeometry(2.2,.16,12,56),glowMat);
  portal.position.set(0,2.56,-5.72);lobbyGroup.add(portal);
  const portalInner=new THREE.Mesh(new THREE.CircleGeometry(2.08,48),new THREE.MeshBasicMaterial({color:0x11617e,transparent:true,opacity:.26,side:THREE.DoubleSide}));
  portalInner.position.set(0,2.56,-5.82);lobbyGroup.add(portalInner);
  for(const side of [-1,1]){
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(.62,.78,.55,8),darkMat);
    plinth.position.set(side*9.3,-.03,-3.2);lobbyGroup.add(plinth);
    const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.7,1),new THREE.MeshStandardMaterial({color:side<0?0x69dff6:0xb9a0ff,emissive:side<0?0x167b9d:0x58358e,emissiveIntensity:1.5,metalness:.25,roughness:.25}));
    crystal.position.set(side*9.3,1,-3.2);crystal.rotation.y=Math.PI/4;lobbyGroup.add(crystal);
  }
  for(let i=0;i<10;i++){
    const a=i*Math.PI*2/10;
    const rune=new THREE.Mesh(new THREE.OctahedronGeometry(.15,0),glowMat);
    rune.position.set(Math.cos(a)*6.9,.25,Math.sin(a)*6.9);lobbyGroup.add(rune);
  }
  const portalLight=new THREE.PointLight(0x55d9ff,2.2,15);portalLight.position.set(0,3.1,-4.7);lobbyGroup.add(portalLight);
  const warmLight=new THREE.PointLight(0xe9be72,1.1,17);warmLight.position.set(0,6,2);lobbyGroup.add(warmLight);
}

function trimMat() {
  return mat(0xc5a46b, .4, .6);
}

function makeHero(color = 0x72e6ff, heroClass = 'guardiao', skin = 'padrao') {
  const g = new THREE.Group();
  const classStyles = {
    guardiao: { armor: 0x72cfe0, dark: 0x1b2a35, metal: 0xb5dce6 },
    mago: { armor: 0x9b87e8, dark: 0x25203d, metal: 0xd5c8ff },
    assassino: { armor: 0x5dc79b, dark: 0x142c28, metal: 0xa8f0d1 }
  };
  const skinStyles = {
    padrao: null,
    gelo: { armor: 0x76c9ed, dark: 0x153246, metal: 0xd2f5ff },
    sombra: { armor: 0x8065c4, dark: 0x1b142c, metal: 0xc4b0ff },
    ouro: { armor: 0xd9aa4f, dark: 0x49321b, metal: 0xffe7a0 },
    brasa: { armor: 0xe46b4f, dark: 0x451e23, metal: 0xffbd86 }
  };
  heroClass = classStyles[heroClass] ? heroClass : 'guardiao';
  skin = Object.prototype.hasOwnProperty.call(skinStyles, skin) ? skin : 'padrao';
  const look = { ...classStyles[heroClass], ...(skinStyles[skin] || {}) };
  const armor = mat(look.armor, .52, .24), dark = mat(look.dark, .8);
  const metal = mat(look.metal, .3, .64);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.38,.55,4,7),armor);
  torso.position.y=1.2;g.add(torso);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.27,12,10),mat(0xe2b99a));
  head.position.y=1.95;g.add(head);
  const hair=new THREE.Mesh(new THREE.SphereGeometry(.28,12,8,0,Math.PI*2,0,Math.PI*.55),dark);
  hair.position.y=2.08;g.add(hair);
  const cape=new THREE.Mesh(new THREE.BoxGeometry(.56,.72,.12),dark);
  cape.position.set(0,1.25,.32);g.add(cape);
  for(const s of [-1,1]){
    const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.12,.43,3,6),armor);
    arm.position.set(s*.48,1.25,0);arm.rotation.z=s*-.13;g.add(arm);
    const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.15,.45,3,6),dark);
    leg.position.set(s*.2,.48,0);g.add(leg);
  }
  const weapon=new THREE.Group();
  if(heroClass==='mago'){
    const staff=new THREE.Mesh(new THREE.CylinderGeometry(.055,.075,1.45,7),dark);staff.position.y=.46;weapon.add(staff);
    const orb=new THREE.Mesh(new THREE.SphereGeometry(.19,12,10),new THREE.MeshStandardMaterial({color:look.metal,emissive:look.armor,emissiveIntensity:1.8,roughness:.2,metalness:.2}));
    orb.position.y=1.2;weapon.add(orb);
  }else if(heroClass==='assassino'){
    for(const side of [-1,1]){
      const dagger=new THREE.Mesh(new THREE.ConeGeometry(.105,.68,5),metal);dagger.position.set(side*.16,.44,0);dagger.rotation.z=Math.PI;weapon.add(dagger);
      const hilt=new THREE.Mesh(new THREE.BoxGeometry(.12,.22,.12),dark);hilt.position.set(side*.16,.05,0);weapon.add(hilt);
    }
  }else{
    const blade=new THREE.Mesh(new THREE.BoxGeometry(.09,.75,.12),metal);blade.position.y=.47;weapon.add(blade);
    const guard=new THREE.Mesh(new THREE.BoxGeometry(.32,.07,.16),trimMat());guard.position.y=.12;weapon.add(guard);
  }
  weapon.position.set(.56,1.02,-.1);weapon.rotation.z=-.25;g.add(weapon);g.userData.sword=weapon;
  const ring=new THREE.Mesh(new THREE.RingGeometry(.43,.49,28),new THREE.MeshBasicMaterial({color:look.armor,transparent:true,opacity:.62,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.025;g.add(ring);
  g.userData.heroClass=heroClass;g.userData.skin=skin;g.userData.serverColor=color;g.userData.selectedSkill=null;
  g.userData.healthBar=makeHealthBar(g,2.58,1.3);
  return g;
}

function replaceHeroModel(oldModel, heroClass, skin, color = undefined) {
  if(!oldModel)return oldModel;
  const previous={...oldModel.userData};
  const savedColor=color??previous.serverColor??0x72e6ff;
  const position=oldModel.position.clone(), rotation=oldModel.rotation.clone();
  const next=makeHero(savedColor,heroClass,skin);
  next.position.copy(position);next.rotation.copy(rotation);
  const visualRefs={sword:next.userData.sword,healthBar:next.userData.healthBar,heroClass:next.userData.heroClass,skin:next.userData.skin,serverColor:savedColor,selectedSkill:previous.selectedSkill??null};
  Object.assign(next.userData,previous,visualRefs);
  scene.add(next);scene.remove(oldModel);
  if(myPlayer===oldModel)myPlayer=next;
  for(const [id,obj] of remotePlayers){if(obj===oldModel){remotePlayers.set(id,next);break;}}
  return next;
}
function applyLocalLook(){
  if(!myPlayer)return;
  if(myPlayer.userData.heroClass!==myHeroClass||myPlayer.userData.skin!==mySkin)myPlayer=replaceHeroModel(myPlayer,myHeroClass,mySkin);
  myPlayer.userData.selectedSkill=mySkill;
  if(myPlayer.userData.healthBar)myPlayer.userData.healthBar.visible=!lobbyMode;
}

function createPlayer() {
  myPlayer = makeHero(0x72e6ff, myHeroClass, mySkin);
  scene.add(myPlayer);
  myPlayer.position.set(0, 0, 3);
  myPlayer.userData.serverX = 0;
  myPlayer.userData.serverZ = 3;
  myPlayer.userData.healthBar.visible = false;
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
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
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
    if (started || inLobby) {
      started=false; inLobby=false; lobbyMode=true;
      hud.classList.add('hidden'); $('lobby').classList.add('hidden');
      $('lobbyModal').classList.add('hidden'); menu.classList.remove('hidden');
      if(dungeonGroup)dungeonGroup.visible=false;
      if(lobbyGroup)lobbyGroup.visible=true;
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
    playerId=m.id; roomCode=m.room; started=false; inLobby=true; lobbyMode=true; playerReady=false;
    menu.classList.add('hidden'); hud.classList.add('hidden');
    $('lobby').classList.remove('hidden'); $('lobbyModal').classList.add('hidden');
    loading.classList.add('hidden'); $('lobbyRoomCode').textContent=roomCode;
    $('lobbyStatus').textContent='Conectado! Escolha sua classe e prepare-se.';
    if(dungeonGroup)dungeonGroup.visible=false; if(lobbyGroup)lobbyGroup.visible=true;
    if(myPlayer){myPlayer.position.set(0,0,.1);myPlayer.rotation.y=Math.PI;myPlayer.userData.healthBar.visible=false;}
    send({type:'heroClass',heroClass:myHeroClass}); send({type:'skin',skin:mySkin});
    if(mySkill)send({type:'selectSkill',skill:mySkill});
    renderLobbyState(lobbyRosterData); playJoinSound(); return;
  }
  if (m.type === 'gameStarted') {
    inLobby=false; lobbyMode=false; started=true;
    menu.classList.add('hidden'); $('lobby').classList.add('hidden'); $('lobbyModal').classList.add('hidden');
    loading.classList.add('hidden'); hud.classList.remove('hidden'); $('roomLabel').textContent=roomCode;
    if(dungeonGroup)dungeonGroup.visible=true; if(lobbyGroup)lobbyGroup.visible=false;
    if(myPlayer){myPlayer.position.set(myPlayer.userData.serverX??0,0,myPlayer.userData.serverZ??3);myPlayer.rotation.y=0;myPlayer.userData.healthBar.visible=true;}
    for(const obj of remotePlayers.values()){
      obj.position.set(obj.userData.serverX??0,0,obj.userData.serverZ??3);
      obj.userData.targetX=obj.userData.serverX??0;obj.userData.targetZ=obj.userData.serverZ??3;obj.userData.targetRot=0;
      if(obj.userData.healthBar)obj.userData.healthBar.visible=true;
    }
    showNotice('A equipe entrou na masmorra!'); return;
  }

  if (m.type === 'notice') {
    if(inLobby)$('lobbyStatus').textContent=m.text; else showNotice(m.text);
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
  const players = Array.isArray(m.players) ? m.players : [];
  lobbyRosterData = players;
  for (let index = 0; index < players.length; index++) {
    const p = players[index];
    incoming.add(p.id);
    const slotX = (index - (players.length - 1) / 2) * 3.1;
    if (p.id === playerId) {
      if (myPlayer && (myPlayer.userData.heroClass !== (p.heroClass || 'guardiao') || myPlayer.userData.skin !== (p.skin || 'padrao'))) {
        myPlayer = replaceHeroModel(myPlayer, p.heroClass || 'guardiao', p.skin || 'padrao', p.color);
      }
      if (myPlayer) {
        myPlayer.userData.serverX = Number(p.x) || 0;
        myPlayer.userData.serverZ = Number(p.z) || 0;
        myPlayer.userData.serverColor = p.color;
        myPlayer.userData.selectedSkill = p.selectedSkill || null;
        if (lobbyMode) { myPlayer.position.set(slotX, 0, .1); myPlayer.rotation.y = Math.PI; }
        if (myPlayer.userData.healthBar) {
          myPlayer.userData.healthBar.visible = !lobbyMode;
          updateHealthBar(myPlayer.userData.healthBar, p.hp ?? 100, p.maxHp ?? 100, p.name || $('playerName').value || 'Você');
        }
      }
      myHeroClass = p.heroClass || myHeroClass;
      mySkin = p.skin || mySkin;
      mySkill = p.selectedSkill || null;
      playerReady = Boolean(p.ready);
      continue;
    }
    let obj = remotePlayers.get(p.id);
    if (!obj) {
      obj = makeHero(p.color, p.heroClass || 'guardiao', p.skin || 'padrao');
      scene.add(obj); remotePlayers.set(p.id, obj);
    } else if (obj.userData.heroClass !== (p.heroClass || 'guardiao') || obj.userData.skin !== (p.skin || 'padrao')) {
      obj = replaceHeroModel(obj, p.heroClass || 'guardiao', p.skin || 'padrao', p.color);
    }
    obj.userData.serverColor = p.color;
    obj.userData.serverX = Number(p.x) || 0;
    obj.userData.serverZ = Number(p.z) || 0;
    obj.userData.selectedSkill = p.selectedSkill || null;
    obj.userData.targetX = lobbyMode ? slotX : p.x;
    obj.userData.targetZ = lobbyMode ? .1 : p.z;
    obj.userData.targetRot = lobbyMode ? Math.PI : p.rot;
    obj.userData.name = p.name;
    if (obj.userData.healthBar) {
      obj.userData.healthBar.visible = !lobbyMode;
      updateHealthBar(obj.userData.healthBar, p.hp ?? 100, p.maxHp ?? 100, p.name || 'Aliado');
    }
  }
  for (const [id,obj] of remotePlayers) {
    if (!incoming.has(id)) { scene.remove(obj); remotePlayers.delete(id); }
  }
  if (lobbyMode) {
    for (const obj of monsterMeshes.values()) obj.visible = false;
    renderLobbyState(players);
    return;
  }
  let alive = 0;
  for (const mtr of m.monsters || []) {
    if (mtr.alive) alive++;
    let obj = monsterMeshes.get(mtr.id);
    if (!obj) { obj = makeMonster(Boolean(mtr.isBoss)); scene.add(obj); monsterMeshes.set(mtr.id,obj); }
    obj.userData.targetX = mtr.x; obj.userData.targetZ = mtr.z;
    obj.userData.alive = mtr.alive; obj.visible = mtr.alive;
    if (obj.userData.healthBar) obj.userData.healthBar.visible = mtr.alive;
  }
  $('monsterText').textContent = alive + ' monstros restantes';
  const mine = players.find(p => p.id === playerId);
  if (mine && mine.hp != null) $('hpText').textContent = formatHealth(mine.hp);
  for (const mtr of m.monsters || []) {
    const obj = monsterMeshes.get(mtr.id);
    if (!obj) continue;
    const fallbackMax = mtr.isBoss ? 180 : 60;
    obj.userData.hp = formatHealth(mtr.hp ?? fallbackMax);
    obj.userData.maxHp = formatHealth(mtr.maxHp ?? fallbackMax);
    updateHealthBar(obj.userData.healthBar,obj.userData.hp,obj.userData.maxHp,mtr.isBoss?'GUARDIÃO':'MONSTRO');
  }
  if (alive > 0) victoryPlayed = false;
  $('progressFill').style.width = ((7-alive)/7*100)+'%';
  $('killText').textContent = 7-alive;
  $('playersList').innerHTML = players.map(p => `<div class="player-chip">● ${escapeHTML(p.name)}${p.id===playerId?' (você)':''}</div>`).join('');
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


function renderLobbyState(players = []) {
  const roster=$('lobbyRoster');
  if(roster){
    const markup=players.length?players.slice(0,4).map(p=>`
      <div class="lobby-player-row ${p.ready?'ready':''}">
        <span class="lobby-player-icon">${p.heroClass==='mago'?'✦':p.heroClass==='assassino'?'⚔':'🛡'}</span>
        <strong>${escapeHTML(p.name||'Aventureiro')}</strong>
        <small>${escapeHTML(CLASS_NAMES[p.heroClass]||'Guardião')} · ${escapeHTML(SKIN_NAMES[p.skin]||'Padrão')}</small>
        <em>${p.ready?'✓ PRONTO':'ESCOLHENDO'}</em>
      </div>`).join(''):'<div class="lobby-empty">Entrando na sala e procurando aventureiros...</div>';
    if(roster.innerHTML!==markup)roster.innerHTML=markup;
  }
  const count=$('lobbyTeamCount');if(count)count.textContent=Math.min(players.length,4)+'/4';
  const code=$('lobbyRoomCode');if(code&&roomCode)code.textContent=roomCode;
  document.querySelectorAll('[data-hero-class]').forEach(b=>b.classList.toggle('is-selected',b.dataset.heroClass===myHeroClass));
  const ready=$('readyBtn');if(ready){ready.textContent=playerReady?'✓ PRONTO — CANCELAR':'✓ MARCAR PRONTO';ready.classList.toggle('is-ready',playerReady);}
  const status=$('lobbyStatus');if(status&&players.length){const n=players.filter(p=>p.ready).length;status.textContent=n+'/'+players.length+' aventureiro(s) pronto(s).';}
}
function openLobbyModal(type){
  const modal=$('lobbyModal'),content=$('lobbyModalContent');if(!modal||!content)return;
  if(type==='skins'){
    const skins=[['padrao','Padrão','#70d0df','Original'],['gelo','Gelo','#76c9ed','Cristalino'],['sombra','Sombra','#8065c4','Sombrio'],['ouro','Ouro','#d9aa4f','Dourado'],['brasa','Brasa','#e46b4f','Flamejante']];
    content.innerHTML=`<div class="lobby-modal-heading"><div class="lobby-panel-kicker">PERSONALIZAÇÃO</div><h3 id="lobbyModalTitle">ESCOLHA SUA SKIN</h3><p>Toque em uma aparência para aplicá-la ao personagem 3D.</p></div><div class="skin-grid">${skins.map(([id,name,color,desc])=>`<button type="button" data-skin="${id}" class="skin-choice ${mySkin===id?'selected':''}"><span class="skin-swatch" style="background:${color};color:${color}"></span><strong>${name}</strong><small>${desc}</small></button>`).join('')}</div>`;
  }else{
    const skills=[['golpe_pesado','⚔','Golpe pesado','Ataque causa 30 de dano, em vez de 20.'],['passos_leves','➤','Passos leves','Movimento aumenta de 5,8 para 7,0.'],['vitalidade','♥','Vitalidade','Vida máxima aumenta para 120 e é recuperada ao selecionar.']];
    content.innerHTML=`<div class="lobby-modal-heading"><div class="lobby-panel-kicker">PROGRESSÃO DO AVENTUREIRO</div><h3 id="lobbyModalTitle">ÁRVORE DE SKILLS</h3><p>Escolha uma habilidade passiva. A seleção sincroniza com o servidor e altera a missão.</p></div><div class="skill-tree">${skills.map(([id,icon,title,desc])=>`<button type="button" data-skill="${id}" class="skill-node ${mySkill===id?'selected':''}"><span class="skill-symbol">${icon}</span><strong>${title}</strong><p>${desc}</p><em>${mySkill===id?'✓ EQUIPADA':'EQUIPAR'}</em></button>`).join('')}</div><p class="skill-footnote">Uma habilidade fica equipada por vez; você pode trocar no lobby.</p>`;
  }
  modal.classList.remove('hidden');
}
function clearReadyAfterLoadoutChange(){if(playerReady){playerReady=false;send({type:'ready',ready:false});}}
document.querySelectorAll('[data-hero-class]').forEach(button=>button.addEventListener('click',()=>{
  const selected=button.dataset.heroClass;if(!CLASS_NAMES[selected])return;
  myHeroClass=selected;clearReadyAfterLoadoutChange();applyLocalLook();
  send({type:'heroClass',heroClass:myHeroClass});renderLobbyState(lobbyRosterData);
}));
$('skinOpenBtn').addEventListener('click',()=>openLobbyModal('skins'));
$('skillOpenBtn').addEventListener('click',()=>openLobbyModal('skills'));
$('lobbyModalClose').addEventListener('click',()=>$('lobbyModal').classList.add('hidden'));
$('lobbyModal').addEventListener('pointerdown',e=>{if(e.target===$('lobbyModal'))$('lobbyModal').classList.add('hidden');});
$('lobbyModalContent').addEventListener('click',e=>{
  const skinButton=e.target.closest('[data-skin]');
  if(skinButton){
    const selected=skinButton.dataset.skin;if(!Object.prototype.hasOwnProperty.call(SKIN_NAMES,selected))return;
    mySkin=selected;clearReadyAfterLoadoutChange();applyLocalLook();send({type:'skin',skin:mySkin});
    renderLobbyState(lobbyRosterData);openLobbyModal('skins');return;
  }
  const skillButton=e.target.closest('[data-skill]');
  if(skillButton){
    const selected=skillButton.dataset.skill;if(!Object.prototype.hasOwnProperty.call(SKILL_INFO,selected))return;
    mySkill=selected;clearReadyAfterLoadoutChange();if(myPlayer)myPlayer.userData.selectedSkill=mySkill;
    send({type:'selectSkill',skill:mySkill});openLobbyModal('skills');
  }
});
$('readyBtn').addEventListener('click',()=>{
  if(!inLobby)return;playerReady=!playerReady;send({type:'ready',ready:playerReady});renderLobbyState(lobbyRosterData);
});
$('startDungeonBtn').addEventListener('click',()=>{
  if(!inLobby)return;$('lobbyStatus').textContent='Abrindo o portal para toda a equipe...';send({type:'startGame'});
});
$('leaveLobbyBtn').addEventListener('click',()=>{
  send({type:'leave'});started=false;inLobby=false;lobbyMode=true;if(ws)ws.close();
  $('lobby').classList.add('hidden');$('lobbyModal').classList.add('hidden');hud.classList.add('hidden');menu.classList.remove('hidden');
  if(dungeonGroup)dungeonGroup.visible=false;if(lobbyGroup)lobbyGroup.visible=true;setStatus('Você saiu do lobby.');
});

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
  send({type:'leave'});started=false;inLobby=false;lobbyMode=true;if(ws)ws.close();
  hud.classList.add('hidden');$('lobby').classList.add('hidden');menu.classList.remove('hidden');
  if(dungeonGroup)dungeonGroup.visible=false;if(lobbyGroup)lobbyGroup.visible=true;setStatus('Você saiu da masmorra.');
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
        myPlayer.position.x + dir.x * dt * (myPlayer.userData.selectedSkill === 'passos_leves' ? 7.0 : 5.8),
        -13, 13
      );

      myPlayer.position.z = THREE.MathUtils.clamp(
        myPlayer.position.z + dir.z * dt * (myPlayer.userData.selectedSkill === 'passos_leves' ? 7.0 : 5.8),
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
    updateHealthBarDistance(obj.userData.healthBar, obj);
    updateHealthBarOcclusion(obj.userData.healthBar, obj);
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
    updateHealthBarDistance(obj.userData.healthBar, obj);
    updateHealthBarOcclusion(obj.userData.healthBar, obj);
    if (started && obj.visible && myPlayer) {
      const distance = Math.hypot(obj.position.x - myPlayer.position.x, obj.position.z - myPlayer.position.z);
      if (distance < 5 && performance.now() - lastGrowlAt > 4200) {
        lastGrowlAt = performance.now();
        playMonsterGrowl();
      }
    }
  }

  // Câmera panorâmica no lobby e terceira pessoa na masmorra.
  if(lobbyMode){
    const halfVerticalFov = camera.fov * Math.PI / 360;
    const tanHalfHorizontalFov = Math.tan(Math.atan(Math.tan(halfVerticalFov) * camera.aspect));
    const viewingDistance = Math.max(10.5, 5.4 / Math.max(tanHalfHorizontalFov, .1));
    const lobbyCameraTarget = new THREE.Vector3(0, camera.aspect < .7 ? 5.8 : 5.2, -1.1 + viewingDistance);
    camera.position.lerp(lobbyCameraTarget,cameraSmooth);
    camera.lookAt(0,1.45,-1.1);
  }else if(myPlayer){
    updateHealthBarDistance(myPlayer.userData.healthBar,myPlayer);
    updateHealthBarOcclusion(myPlayer.userData.healthBar,myPlayer);
    const target=new THREE.Vector3(myPlayer.position.x,1.2,myPlayer.position.z);
    const dist=8.5;
    const cameraTarget=new THREE.Vector3(target.x+Math.sin(yaw)*dist,target.y+3+pitch*2,target.z+Math.cos(yaw)*dist);
    camera.position.lerp(cameraTarget,cameraSmooth);
    camera.lookAt(target.x,target.y+.15,target.z);
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
