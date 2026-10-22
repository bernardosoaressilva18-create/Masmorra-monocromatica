
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';

const $ = id => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), loading = $('loading'), menuStatus = $('menuStatus');

let renderer, scene, camera, clock, ws, playerId = null, roomCode = '', myPlayer = null, started = false;
let lobbyPreviewScene = null, lobbyPreviewCamera = null, lobbyPreviewHero = null, lobbyPreviewPlatform = null, lobbyPreviewRing = null, lobbyPreviewParticles = null, lobbyPreviewRunes = null, lobbyPreviewCrystals = null;
let activeEnvironmentGroup=null;
const environmentGroups=Object.create(null);
let currentRealmVisual=1,realmPortal=null,realmPortalCore=null,realmPortalRing=null,astralStarField=null;
let realmIntroTimer=0;
const astralFloaters=[];
let yaw = 0, pitch = .25, targetYaw = 0, targetPitch = .25, joy = { x: 0, y: 0 }, keys = {}, lastMove = 0, attackCooldown = 0, noticeTimer = 0;
const remotePlayers = new Map(), monsterMeshes = new Map(), chestMeshes = new Map();
const gateMeshes = [];
const activeBurnEffects = [];
let ambientParticles = null, particleMaterial = null;
const activeSpellEffects = [];
const activeImpactEffects = [];
const activeClassEffects = [];
const healthBarParentQuaternion = new THREE.Quaternion();
const cameraFocusScratch = new THREE.Vector3();
const cameraPositionScratch = new THREE.Vector3();
const lobbyCameraPositionScratch = new THREE.Vector3();
let bossMesh = null, bossData = null;
let currentPhaseVisual = 0, lastSafeZoneTimestamp = 0, appliedInitialServerPosition = false;
let latestChests = [], inventoryData = { comum: 0, incomum: 0, raro: 0, 'épico': 0, 'lendário': 0 }, lootDrops = [], selectedItemId = null;
const world = { width: 30, depth: 190 };
const isMobileDevice = matchMedia('(pointer: coarse)').matches;

function clampSetting(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
let storedGameSettings = {};
try { storedGameSettings = JSON.parse(localStorage.getItem('mmGameSettings') || '{}') || {}; } catch {}
const gameSettings = {
  sensitivity: clampSetting(storedGameSettings.sensitivity, 0.5, 3, 1.2),
  verticalSensitivity: clampSetting(storedGameSettings.verticalSensitivity, 0.5, 3, 0.9),
  graphicsQuality: ['low','balanced','high'].includes(storedGameSettings.graphicsQuality) ? storedGameSettings.graphicsQuality : 'balanced',
  haptics: storedGameSettings.haptics !== false,
  musicVolume: clampSetting(storedGameSettings.musicVolume, 0, 1, 0.32),
  sfxVolume: clampSetting(storedGameSettings.sfxVolume, 0, 1, 0.72),
  musicEnabled: storedGameSettings.musicEnabled !== false
};
let audioContext = null, musicBus = null, sfxBus = null, backgroundMusic = null;

function saveGameSettings() {
  try { localStorage.setItem('mmGameSettings', JSON.stringify(gameSettings)); } catch {}
}
function vibrateGame(pattern = 12) {
  if (!gameSettings.haptics || !isMobileDevice || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
}
function getRenderPixelRatioCap(width = window.innerWidth, height = window.innerHeight) {
  const landscapeMobile = isMobileDevice && width > height;
  const quality = gameSettings.graphicsQuality;
  if (quality === 'low') return isMobileDevice ? (landscapeMobile ? 1.0 : 0.85) : 1.0;
  if (quality === 'high') return isMobileDevice ? (landscapeMobile ? 2.15 : 1.75) : 2.0;
  return isMobileDevice ? (landscapeMobile ? 1.85 : 1.25) : 1.5;
}
function getMinimumRenderPixelRatio(width = window.innerWidth, height = window.innerHeight) {
  if (!isMobileDevice) return 0.8;
  const landscape = width > height;
  if (gameSettings.graphicsQuality === 'low') return landscape ? 0.85 : 0.75;
  if (gameSettings.graphicsQuality === 'high') return landscape ? 1.2 : 0.95;
  return landscape ? 1.0 : 0.8;
}
function applyGraphicsQuality() {
  const quality = gameSettings.graphicsQuality;
  renderPixelRatioCap = getRenderPixelRatioCap();
  adaptivePixelRatio = Math.max(getMinimumRenderPixelRatio(), Math.min(devicePixelRatio || 1, renderPixelRatioCap));
  if (quality === 'low') adaptivePixelRatio = Math.min(adaptivePixelRatio, isMobileDevice ? 0.85 : 1.0);
  if (renderer) {
    renderer.setPixelRatio(adaptivePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = !isMobileDevice && quality === 'high';
    renderer.shadowMap.needsUpdate = true;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (backgroundMusic) backgroundMusic.pause();
    if (audioContext && audioContext.state === 'running') audioContext.suspend().catch(() => {});
  } else {
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    if (backgroundMusic && gameSettings.musicEnabled && gameSettings.musicVolume > 0) {
      backgroundMusic.play().catch(() => {});
    }
  }
});

function updateAudioLevels() {
  if (backgroundMusic) {
    const volume = gameSettings.musicEnabled ? Math.max(0, Math.min(1, gameSettings.musicVolume * 0.78)) : 0;
    backgroundMusic.volume = volume;
    if (!gameSettings.musicEnabled || volume <= 0) {
      backgroundMusic.pause();
    } else if (!document.hidden) {
      backgroundMusic.play().catch(() => {});
    }
  }
  if (!audioContext || !sfxBus) return;
  sfxBus.gain.setTargetAtTime(gameSettings.sfxVolume, audioContext.currentTime, 0.06);
}
function ensureAudio() {
  try {
    if (!backgroundMusic) {
      // RandomMind, “Medieval: Exploration” (CC0). Trilha medieval de exploração.
      backgroundMusic = new Audio('https://opengameart.org/sites/default/files/Exploration.mp3');
      backgroundMusic.loop = true;
      backgroundMusic.preload = 'auto';
      backgroundMusic.volume = gameSettings.musicEnabled ? gameSettings.musicVolume * 0.78 : 0;
      backgroundMusic.addEventListener('error', () => {
        console.warn('[O Último Legado] A faixa externa não pôde ser carregada.');
        if (started) showNotice('A trilha não carregou. Confira a conexão de internet.');
      });
    }
    const AudioConstructor = window.AudioContext || window.webkitAudioContext;
    if (AudioConstructor && !audioContext) {
      audioContext = new AudioConstructor();
      musicBus = audioContext.createGain();
      sfxBus = audioContext.createGain();
      musicBus.connect(audioContext.destination);
      sfxBus.connect(audioContext.destination);
    }
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    updateAudioLevels();
    if (gameSettings.musicEnabled && gameSettings.musicVolume > 0 && !document.hidden) {
      backgroundMusic.play().catch(() => {});
    }
  } catch (error) {
    console.warn('[O Último Legado] Áudio indisponível neste navegador:', error);
  }
}
function playSfx(kind = 'ui') {
  if (gameSettings.sfxVolume <= 0) return;
  ensureAudio();
  if (!audioContext || !sfxBus) return;
  const profiles = {
    ui: [510, 680, 'sine', 0.09], attack: [235, 92, 'sawtooth', 0.16], dodge: [320, 145, 'triangle', 0.12],
    fire: [390, 125, 'sawtooth', 0.24], lightning: [780, 190, 'square', 0.20],
    chest: [420, 760, 'triangle', 0.20], loot: [610, 920, 'sine', 0.24],
    damage: [165, 70, 'sawtooth', 0.22], portal: [240, 880, 'sine', 0.62]
  };
  const [startFrequency, endFrequency, waveform, duration] = profiles[kind] || profiles.ui;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator(); const envelope = audioContext.createGain();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(envelope); envelope.connect(sfxBus);
  oscillator.start(now); oscillator.stop(now + duration + 0.02);
}

// Colisores 2D alinhados aos pilares, suportes dos portões e cristais sólidos.
const staticDungeonColliders = (() => {
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
function isDungeonPositionBlocked(x, z) {
  const playerRadius = 0.43;
  // Obstáculos da masmorra antiga não devem bloquear o movimento no Vale Astral.
  if (currentRealmVisual !== 2) {
    for (const obstacle of staticDungeonColliders) {
      if (Math.hypot(x - obstacle.x, z - obstacle.z) < playerRadius + obstacle.r) return true;
    }
  }
  for (const chest of latestChests || []) {
    if (Math.hypot(x - chest.x, z - chest.z) < playerRadius + 0.62) return true;
  }
  return false;
}
function resolveDungeonMovement(fromX, fromZ, nextX, nextZ) {
  let x = THREE.MathUtils.clamp(nextX, -13, 13);
  let z = THREE.MathUtils.clamp(nextZ, -174, 8);
  if (isDungeonPositionBlocked(x, fromZ)) x = fromX;
  if (isDungeonPositionBlocked(x, z)) z = fromZ;
  return { x, z };
}
let renderPixelRatioCap = getRenderPixelRatioCap();
let adaptivePixelRatio = Math.max(getMinimumRenderPixelRatio(), Math.min(devicePixelRatio || 1, renderPixelRatioCap));
let perfBadge = null, perfFrames = 0, perfWindowStart = performance.now();
let lastFps = 0, measuredPing = null, slowFpsSamples = 0, fastFpsSamples = 0;

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d14);
  scene.fog = new THREE.FogExp2(0x090d14, isMobileDevice ? .007 : .0055);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 230);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(adaptivePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  // Sombras suaves no PC; no celular ficam desligadas para preservar FPS.
  renderer.shadowMap.enabled = !isMobileDevice && gameSettings.graphicsQuality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (typeof surfaceTexture !== 'undefined') {
    surfaceTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    surfaceTexture.needsUpdate = true;
  }
  $('game').appendChild(renderer.domElement);
  perfBadge = document.createElement('div');
  perfBadge.setAttribute('aria-hidden', 'true');
  perfBadge.title = 'FPS, ping, escala de renderização e estimativa do heap JavaScript. A RAM total do aparelho e a memória da GPU não ficam disponíveis em todos os navegadores.';
  Object.assign(perfBadge.style, {
    position: 'fixed', top: '68px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '12', padding: '4px 8px', border: '1px solid rgba(115,211,255,.25)',
    borderRadius: '999px', background: 'rgba(7,12,22,.72)', color: '#aeeaff',
    font: '600 11px/1.2 monospace', letterSpacing: '.3px', pointerEvents: 'none',
    whiteSpace: 'nowrap', maxWidth: 'calc(100vw - 16px)', overflow: 'hidden', textOverflow: 'ellipsis', display: 'none'
  });
  document.body.appendChild(perfBadge);

  clock = new THREE.Clock();
  scene.add(new THREE.HemisphereLight(0xb7d8f5, 0x21152b, 2.45));
  // Luzes de preenchimento para dar mais volume às armaduras e às pedras.
  const fillLight = new THREE.DirectionalLight(0x8daeff, 0.72);
  fillLight.position.set(8, 7, -18);
  scene.add(fillLight);
  const cryptLight = new THREE.PointLight(0x62cfff, 10, 20, 2);
  cryptLight.position.set(-8, 2.6, 1);
  if (!isMobileDevice) scene.add(cryptLight);
  const caveLight = new THREE.PointLight(0x8c63ff, 13, 22, 2);
  caveLight.position.set(8, 2.8, -21);
  if (!isMobileDevice) scene.add(caveLight);
  const abyssLight = new THREE.PointLight(0xff4c79, 12, 24, 2);
  abyssLight.position.set(-7, 2.8, -34);
  if (!isMobileDevice) scene.add(abyssLight);
  const dungeonGlow = new THREE.PointLight(0x4fcfff, 28, 30, 2); dungeonGlow.position.set(0, 3.2, -16); if (!isMobileDevice) scene.add(dungeonGlow);
  const bossGlow = new THREE.PointLight(0xff245b, 32, 20, 2); bossGlow.position.set(0, 3, -29); if (!isMobileDevice) scene.add(bossGlow);

  const moon = new THREE.DirectionalLight(0xb5d9ff, 1.4);
  moon.position.set(-6, 12, 5);
  moon.castShadow = !isMobileDevice;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -22;
  moon.shadow.camera.right = 22;
  moon.shadow.camera.top = 18;
  moon.shadow.camera.bottom = -18;
  moon.shadow.bias = -0.00025;
  scene.add(moon);

  buildDungeon();
  buildDungeonVisualPass();
  createPlayer();
  initLobby3DPreview();
  onResize();
  animate();
}

function mat(color, rough = .9, metal = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  // Geometria principal recebe e projeta sombras no PC.
  if (!isMobileDevice) { m.castShadow = true; m.receiveShadow = true; }
  (activeEnvironmentGroup || scene).add(m);
  return m;
}

function buildDungeon() {
  const dungeonGroup=new THREE.Group();dungeonGroup.name='environment-monochrome';scene.add(dungeonGroup);activeEnvironmentGroup=dungeonGroup;

  // Uma única textura partilhada mantém o detalhe visual sem criar materiais por objeto.
  const dungeonTexture = surfaceTexture.clone();
  dungeonTexture.repeat.set(5, 5);
  const floor = mat(0x292e38, .82, .08);
  floor.map = dungeonTexture;
  floor.bumpMap = dungeonTexture;
  floor.bumpScale = .012;
  floor.needsUpdate = true;
const wall = mat(0x414751, 0.95);
wall.map = dungeonTexture;
wall.bumpMap = dungeonTexture;
wall.bumpScale = .018;
wall.needsUpdate = true;
const dark = mat(0x171c24, 1);
const trim = mat(0x8a7150, 0.75, 0.25);

const stoneLight = mat(0x626c7b, 0.86, .06);
const stoneDark = mat(0x303744, .94, .04);
stoneLight.map = dungeonTexture;
stoneDark.map = dungeonTexture;
stoneLight.needsUpdate = true;
stoneDark.needsUpdate = true;
  const crystal = new THREE.MeshStandardMaterial({
    color: 0x70dfff,
    emissive: 0x167ca0,
    emissiveIntensity: 1.8
  });

  // Cinco zonas independentes: cada mundo tem seu próprio piso e perímetro.
  const worldZones = [
    { id:1, z:-14, depth:34, top:mat(0x303b49,.96) },      // Cripta
    { id:2, z:-46, depth:30, top:mat(0x33284c,.92) },      // Cavernas
    { id:3, z:-78, depth:30, top:mat(0x192a24,.88,.12) }, // Floresta
    { id:4, z:-110, depth:30, top:mat(0x4a2414,.88,.12) },// Vulcão
    { id:5, z:-153, depth:40, top:mat(0x21131f,.88,.12) } // Abismo
  ];
  for (const zone of worldZones) {
    zone.top.map = dungeonTexture;
    zone.top.bumpMap = dungeonTexture;
    zone.top.bumpScale = .012;
    zone.top.needsUpdate = true;
    box(30,.8,zone.depth,floor,0,-.5,zone.z);
    box(29.6,.08,zone.depth-.5,zone.top,0,-.055,zone.z);
    // Paredes separadas por mundo; os portais marcam as passagens entre biomas.
    box(.7,5,zone.depth,wall,-15,2,zone.z);
    box(.7,5,zone.depth,wall,15,2,zone.z);
  }

  // Marcas do piso em instâncias: muitos detalhes com uma única chamada de desenho.
  const tileMat = mat(0x343b45,.98);
  tileMat.map = dungeonTexture;
  tileMat.needsUpdate = true;
  const tileGeometry = new THREE.BoxGeometry(2.72,.025,2.72);
  const tileInstances = new THREE.InstancedMesh(tileGeometry,tileMat,520);
  const tileDummy = new THREE.Object3D();
  let tileIndex = 0;
  for (const zone of worldZones) {
    for (let z = zone.z-zone.depth/2+1.5; z <= zone.z+zone.depth/2-1.5; z += 3) {
      for (let x=-12; x<=12; x+=3) {
        if (Math.random() <= .28) continue;
        tileDummy.position.set(x,.002,z);
        tileDummy.rotation.set(0,Math.random()*.04,0);
        const scale = .94 + Math.random()*.08;
        tileDummy.scale.set(scale,1,scale);
        tileDummy.updateMatrix();
        tileInstances.setMatrixAt(tileIndex++,tileDummy.matrix);
      }
    }
  }
  tileInstances.count = tileIndex;
  tileInstances.instanceMatrix.needsUpdate = true;
  activeEnvironmentGroup.add(tileInstances);

  // Juntas de pedra e passadiços curtos sobre a transição de cada mundo.
  const groutMat = mat(0x171c24,1);
  for (const zone of worldZones) {
    for (let z=zone.z-zone.depth/2+2; z<=zone.z+zone.depth/2-2; z+=4) {
      box(29.2,.012,.06,groutMat,0,-.009,z);
    }
  }
  for (const z of [-30.5,-62,-94,-130]) {
    const bridgeDepth = z === -130 ? 9.5 : 3.1;
    box(9,.06,bridgeDepth,mat(0x283743,.9,.1),0,-.018,z);
  }

  // Portões de fundo, início e limites externos do conjunto.
  box(30,5,.8,wall,0,2,-180);
  box(30,5,.8,wall,0,2,13);

  for (const zone of worldZones) {
    const minZ = zone.z-zone.depth/2+2, maxZ = zone.z+zone.depth/2-2;
    for (let z=minZ; z<=maxZ; z+=5) {
      for (const side of [-1,1]) {
        const x=side*14.35;
        box(.8,.35,.9,trim,x,4.25,z);
        const orb=new THREE.Mesh(new THREE.OctahedronGeometry(.22),crystal);
        orb.position.set(side*13.9,3.7,z);
        activeEnvironmentGroup.add(orb);
      }
    }
  }

  for (let z = -30; z <= 8; z += 9) {
    for (const x of [-10, 10]) {
      box(1.35, 4.8, 1.35, dark, x, 2, z);
      box(1.65, .25, 1.65, trim, x, 4.45, z);
      box(1.55, .22, 1.55, wall, x, .05, z);
    }
  }

// Detalhes de pedra nas paredes
for (let z = -30; z <= 8; z += 6) {
  box(0.12, 0.18, 2.2, stoneLight, -14.55, 1.2, z);
  box(0.12, 0.12, 1.5, stoneDark, -14.55, 2.8, z + 2);

  box(0.12, 0.18, 2.2, stoneLight, 14.55, 1.2, z);
  box(0.12, 0.12, 1.5, stoneDark, 14.55, 2.8, z + 2);
}
  box(30, 5, .8, wall, 0, 2, -180);
  box(30, 5, .8, wall, 0, 2, 13);

  for (let z = -172; z <= 9; z += 5) {
    for (const side of [-1, 1]) {
      const x = side * 14.35;
      box(.8, .35, .9, trim, x, 4.25, z);

      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.22), crystal);
      orb.position.set(side * 13.9, 3.7, z);
      activeEnvironmentGroup.add(orb);

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

  // Removido o círculo mágico e o conjunto de cristais do centro da primeira fase.

  // Portões mágicos entre as três fases.
  for (const z of [-30, -62, -94, -126]) {
    const gate = new THREE.Group();
    const stone = mat(0x656d7b, .72, .25), runeMat = new THREE.MeshStandardMaterial({ color: 0x56e6ff, emissive: 0x1aa5df, emissiveIntensity: 2.2, metalness: .2, roughness: .3 });
    for (const x of [-3.1, 3.1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(.42, 4.4, .55), stone); post.position.set(x, 2.2, 0); gate.add(post); }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.6, .5, .65), stone); lintel.position.y = 4.35; gate.add(lintel);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(5.7, 3.8), new THREE.MeshBasicMaterial({ color: 0x23b9ff, transparent: true, opacity: .25, side: THREE.DoubleSide, depthWrite: false })); ring.position.set(0, 2.1, 0); gate.add(ring);
    const bars = new THREE.Group();
    for (let x = -2.5; x <= 2.51; x += 1) { const bar = new THREE.Mesh(new THREE.BoxGeometry(.12, 3.7, .18), runeMat); bar.position.set(x, 1.95, -.05); bars.add(bar); }
    const portalMat = new THREE.MeshBasicMaterial({ color: 0x3edcff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(5.25, 3.55), portalMat);
    portal.position.set(0, 2.05, -.12); gate.add(portal);
    const portalRim = new THREE.Mesh(new THREE.TorusGeometry(1.42,.055,8,48), new THREE.MeshStandardMaterial({color:0x77edff,emissive:0x159dcc,emissiveIntensity:1.8,metalness:.35,roughness:.25}));
    portalRim.position.set(0,2.05,-.2); portalRim.scale.set(1.55,1.25,1); gate.add(portalRim);
    gate.add(bars); gate.position.z = z; gate.userData.bars = bars; gate.userData.ring = ring; gate.userData.portal = portal; gate.userData.portalRim = portalRim; gate.userData.open = false; activeEnvironmentGroup.add(gate); gateMeshes.push(gate);
  }
  // Cristais, braseiros e fragmentos decorativos para dar profundidade.
  for (const z of [-5, -10, -18, -23, -36, -42, -50, -58, -68, -74, -84, -90, -100, -106, -116, -122, -134, -142, -158, -166]) {
    for (const x of [-12.2, 12.2]) {
      const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(.22, 1), new THREE.MeshStandardMaterial({ color: 0xffa84f, emissive: 0xff5b1f, emissiveIntensity: 2.5 }));
      flame.position.set(x, 2.1, z); activeEnvironmentGroup.add(flame);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.28, .045, 5, 12), mat(0xb88751, .45, .4)); halo.position.set(x, 1.75, z); activeEnvironmentGroup.add(halo);
    }
  }
  // FASE 1 — Cripta antiga: altar e marcas de pedra azuladas.
  const altarStone = mat(0x5b6470, .9, .12);
  box(2.4, .35, 1.5, altarStone, 0, .16, 1.2);
  box(1.65, .42, 1.05, trim, 0, .52, 1.2);
  const altarRune = new THREE.Mesh(new THREE.RingGeometry(.55, .72, 24), new THREE.MeshBasicMaterial({ color: 0x75dff2, transparent: true, opacity: .65, side: THREE.DoubleSide }));
  altarRune.rotation.x = -Math.PI / 2; altarRune.position.set(0, .75, 1.2); activeEnvironmentGroup.add(altarRune);

  // FASE 2 — Caverna mágica: cristais grandes nas laterais, fora da rota central.
  const caveCrystal = new THREE.MeshStandardMaterial({ color: 0x7c63ff, emissive: 0x4b24d8, emissiveIntensity: 1.35, roughness: .28, metalness: .12 });
  const caveCrystalSmall = new THREE.MeshStandardMaterial({ color: 0x5de8ff, emissive: 0x1688bd, emissiveIntensity: 1.1, roughness: .3 });
  for (const z of [-48, -53, -57]) {
    for (const side of [-1, 1]) {
      const cluster = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const h = 1.15 + i * .42;
        const crystalMesh = new THREE.Mesh(new THREE.OctahedronGeometry(.48 + i * .07, 0), i % 2 ? caveCrystalSmall : caveCrystal);
        crystalMesh.scale.set(.8, h, .8);
        crystalMesh.position.set((i - 1) * .48, h * .48, (i % 2) * .35);
        crystalMesh.rotation.z = (i - 1) * .22;
        cluster.add(crystalMesh);
      }
      cluster.position.set(side * (10.8 + (z === -24 ? .7 : 0)), .05, z);
      activeEnvironmentGroup.add(cluster);
    }
  }
  // Veios luminosos no chão da caverna.
  for (const z of [-47, -51, -55, -58]) {
    for (const side of [-1, 1]) {
      const vein = new THREE.Mesh(new THREE.BoxGeometry(2.2, .025, .07), new THREE.MeshBasicMaterial({ color: 0x7d5cff, transparent: true, opacity: .62 }));
      vein.position.set(side * 7.8, -.045, z); vein.rotation.y = side * .18; activeEnvironmentGroup.add(vein);
    }
  }

  // MUNDO 3 — Floresta amaldiçoada: troncos, raízes e copas de baixa poligonagem.
  const bark = mat(0x382b27, .96), barkEdge = mat(0x5b4032, .9);
  const leafDark = new THREE.MeshStandardMaterial({ color: 0x173d2b, roughness: .94, emissive: 0x092416, emissiveIntensity: .22 });
  const leafLight = new THREE.MeshStandardMaterial({ color: 0x2c6542, roughness: .9, emissive: 0x0b2d1a, emissiveIntensity: .18 });
  for (let z = -67; z >= -89; z -= 5.5) {
    for (const side of [-1, 1]) {
      const tree = new THREE.Group();
      const x = side * (9.2 + (Math.abs(Math.floor(z)) % 3) * .65);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.16, .29, 2.9, 7), bark);
      trunk.position.y = 1.42; trunk.rotation.z = side * .06; tree.add(trunk);
      const root = new THREE.Mesh(new THREE.CylinderGeometry(.3,.42,.34,6), barkEdge);
      root.position.set(0,.18,0); tree.add(root);
      for (let tier = 0; tier < 3; tier++) {
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.0-tier*.15,1.35,7),tier===1?leafLight:leafDark);
        crown.position.set(side*(tier===2?.15:0),2.05+tier*.63,0);
        crown.rotation.z=side*(.06+tier*.035); tree.add(crown);
      }
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(.055,.1,.95,5), barkEdge);
      branch.position.set(side*.38,1.9,.02); branch.rotation.z=side*-.9; tree.add(branch);
      tree.position.set(x,0,z); tree.rotation.y=side*.16; activeEnvironmentGroup.add(tree);
    }
  }
  // MUNDO 4 — Vulcão: fissuras luminosas no piso e pedras basálticas nas margens.
  const lava = new THREE.MeshBasicMaterial({ color:0xff652d, transparent:true, opacity:.9 });
  const lavaGold = new THREE.MeshBasicMaterial({ color:0xffc15b, transparent:true, opacity:.76 });
  const basalt = mat(0x30211e,.98,.08);
  for(let z=-99;z>=-123;z-=3.4){
    for(const side of [-1,1]){
      const crack = new THREE.Mesh(new THREE.BoxGeometry(2.1+Math.random()*1.3,.035,.09),Math.random()>.55?lava:lavaGold);
      crack.position.set(side*(3.7+Math.random()*4),-.005,z+(Math.random()-.5)*1.1);
      crack.rotation.y=side*(Math.random()*.24); activeEnvironmentGroup.add(crack);
      if(Math.random()>.3){
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.35+Math.random()*.32,0),basalt);
        rock.position.set(side*(10.2+Math.random()*2),.08,z+.6); rock.rotation.set(Math.random(),Math.random(),Math.random()); rock.scale.y=.7; activeEnvironmentGroup.add(rock);
      }
    }
  }
  // MUNDO 5 — anéis maiores e rubros ao redor do Guardião Supremo.
  const finalSigil = new THREE.Mesh(new THREE.RingGeometry(6.1,6.22,64),new THREE.MeshBasicMaterial({color:0xaa3cff,transparent:true,opacity:.55,side:THREE.DoubleSide}));
  finalSigil.rotation.x=-Math.PI/2; finalSigil.position.set(0,-.02,-150); activeEnvironmentGroup.add(finalSigil);

  // FASE 3 — Arena do Abismo: runas rubras e obeliscos ao redor do chefe.
  const abyssStone = mat(0x211821, .78, .25);
  const abyssRune = new THREE.MeshBasicMaterial({ color: 0xff315d, transparent: true, opacity: .62, side: THREE.DoubleSide });
  for (const [x, z] of [[-8.8, -146.2], [8.8, -146.2], [-8.8, -150], [8.8, -150]]) {
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(.28, .5, 3.2, 5), abyssStone);
    obelisk.position.set(x, 1.55, z); obelisk.rotation.z = x < 0 ? .08 : -.08; activeEnvironmentGroup.add(obelisk);
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(.32), new THREE.MeshStandardMaterial({ color: 0xff315d, emissive: 0x9b102c, emissiveIntensity: 1.7 }));
    crown.position.set(x, 3.3, z); activeEnvironmentGroup.add(crown);
  }
  for (const radius of [2.2, 3.6, 5.1]) {
    const circle = new THREE.Mesh(new THREE.RingGeometry(radius, radius + .055, 64), abyssRune);
    circle.rotation.x = -Math.PI / 2; circle.position.set(0, -.025, -150.1); activeEnvironmentGroup.add(circle);
  }
  // Marca visual no chão entre as regiões para mostrar a passagem de fase.
  for (const z of [-29.8, -61.7, -93.7, -125.7]) {
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(27, .035, .18), new THREE.MeshStandardMaterial({ color: 0x43515e, emissive: 0x182a38, emissiveIntensity: .7, metalness: .3 }));
    threshold.position.set(0, -.035, z); activeEnvironmentGroup.add(threshold);
  }

  const particleCount = 28, particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) { particlePositions[i*3] = (Math.random()-.5)*26; particlePositions[i*3+1] = .3+Math.random()*4; particlePositions[i*3+2] = -174+Math.random()*184; }
  const particleGeo = new THREE.BufferGeometry(); particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleMaterial = new THREE.PointsMaterial({ color: 0x8be9ff, size: .055, transparent: true, opacity: .6, depthWrite: false }); ambientParticles = new THREE.Points(particleGeo, particleMaterial); activeEnvironmentGroup.add(ambientParticles);

  for (let i = 0; i < 18; i++) {
    const x = (Math.random() - .5) * 25;
    const z = -170 + Math.random() * 178;
    if (Math.abs(x) < 3 && z > 0) continue;

    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(.2 + Math.random() * .35, 0),
      dark
    );
    rock.position.set(x, .02, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.y = .45;
    activeEnvironmentGroup.add(rock);
  }
  realmPortal=new THREE.Group();realmPortal.name='gate-to-astral-realm';
  const realmStone=new THREE.MeshStandardMaterial({color:0x34364f,roughness:.55,metalness:.35});
  const realmFrame=new THREE.MeshStandardMaterial({color:0x9874df,emissive:0x5935b6,emissiveIntensity:.7,metalness:.25,roughness:.28});
  for(const x of [-3.05,3.05]){const post=new THREE.Mesh(new THREE.BoxGeometry(.5,4.2,.65),realmStone);post.position.set(x,2.1,0);realmPortal.add(post);const rune=new THREE.Mesh(new THREE.BoxGeometry(.09,3.3,.08),realmFrame);rune.position.set(x*.91,2.15,-.36);realmPortal.add(rune);}
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(6.55,.48,.7),realmStone);lintel.position.set(0,4.28,0);realmPortal.add(lintel);
  realmPortalCore=new THREE.Mesh(new THREE.PlaneGeometry(5.1,3.65),new THREE.MeshBasicMaterial({color:0x9b69ff,transparent:true,opacity:.07,side:THREE.DoubleSide,depthWrite:false}));realmPortalCore.position.set(0,2.08,-.22);realmPortal.add(realmPortalCore);
  const portalGlow=new THREE.PointLight(0x9a64ff,0,13,2);portalGlow.position.set(0,2.15,-.1);realmPortal.add(portalGlow);realmPortal.userData.glow=portalGlow;
  realmPortalRing=new THREE.Mesh(new THREE.TorusGeometry(1.72,.095,10,64),realmFrame);realmPortalRing.position.set(0,2.08,-.3);realmPortalRing.scale.set(1.48,1.17,1);realmPortal.add(realmPortalRing);
  realmPortal.position.set(0,0,-168);realmPortal.userData.open=false;activeEnvironmentGroup.add(realmPortal);
  environmentGroups.dungeon=activeEnvironmentGroup;activeEnvironmentGroup=null;buildAstralWorld();

}



function buildDungeonVisualPass() {
  const parent = environmentGroups.dungeon || scene;
  const detailGroup = new THREE.Group();
  detailGroup.name = 'dungeon-visual-upgrade-pass';
  parent.add(detailGroup);
  const zoneData = [
    { z: -14, color: 0x75eaff }, { z: -46, color: 0xb49aff },
    { z: -78, color: 0x76f0ad }, { z: -110, color: 0xffa45e },
    { z: -153, color: 0xff77b7 }
  ];
  const crystalGeometry = new THREE.OctahedronGeometry(0.25, 1);
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.95,
    metalness: 0.18, roughness: 0.24
  });
  const crystalsPerZone = 8;
  const crystalInstances = new THREE.InstancedMesh(crystalGeometry, crystalMaterial, zoneData.length * crystalsPerZone);
  crystalInstances.name = 'realm-crystal-instanced-decor';
  const dummy = new THREE.Object3D();
  let crystalIndex = 0;
  for (let zi = 0; zi < zoneData.length; zi++) {
    const zone = zoneData[zi];
    // Piso central limpo: sem círculos/runa no meio da fase.
    for (const side of [-1, 1]) {
      for (let j = 0; j < 4; j++) {
        const x = side * (9.5 + (j % 2) * 1.15);
        const z = zone.z - 5.4 + j * 3.6;
        const scale = 0.72 + (j % 3) * 0.18;
        dummy.position.set(x, 0.48 + (j % 3) * 0.48, z);
        dummy.rotation.set(0.15 * (j % 2), j * 0.67 + zi * 0.22, 0.16 * side);
        dummy.scale.set(scale * 0.82, scale * (1.35 + (j % 2) * 0.25), scale * 0.72);
        dummy.updateMatrix();
        crystalInstances.setMatrixAt(crystalIndex, dummy.matrix);
        crystalInstances.setColorAt(crystalIndex, new THREE.Color(zone.color));
        crystalIndex++;
      }
    }
  }
  crystalInstances.count = crystalIndex; crystalInstances.instanceMatrix.needsUpdate = true;
  if (crystalInstances.instanceColor) crystalInstances.instanceColor.needsUpdate = true;
  detailGroup.add(crystalInstances);
  const lanternGeometry = new THREE.SphereGeometry(0.105, 8, 7);
  const lanternMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd28b, emissive: 0xffa63b, emissiveIntensity: 1.6,
    roughness: 0.35, metalness: 0.08
  });
  const bracketGeometry = new THREE.BoxGeometry(0.12, 0.30, 0.18);
  const bracketMaterial = new THREE.MeshStandardMaterial({color:0x67533b, metalness:0.45, roughness:0.62});
  const lanternCount = 20;
  const lanterns = new THREE.InstancedMesh(lanternGeometry, lanternMaterial, lanternCount);
  const brackets = new THREE.InstancedMesh(bracketGeometry, bracketMaterial, lanternCount);
  let lanternIndex = 0;
  for (const zone of zoneData) {
    for (const side of [-1, 1]) {
      for (const offset of [-8, 5]) {
        dummy.position.set(side * 13.7, 2.9, zone.z + offset);
        dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        lanterns.setMatrixAt(lanternIndex, dummy.matrix);
        dummy.position.set(side * 13.83, 2.65, zone.z + offset);
        dummy.rotation.set(0, side < 0 ? 0.15 : -0.15, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        brackets.setMatrixAt(lanternIndex, dummy.matrix);
        lanternIndex++;
      }
    }
  }
  lanterns.instanceMatrix.needsUpdate = true; brackets.instanceMatrix.needsUpdate = true;
  detailGroup.add(brackets, lanterns);
  const gateGeometry = new THREE.TorusGeometry(2.18, 0.038, 6, 48);
  for (let i = 0; i < 4; i++) {
    const haloMat = new THREE.MeshStandardMaterial({
      color: zoneData[i].color, emissive: zoneData[i].color,
      emissiveIntensity: 0.72, metalness: 0.35, roughness: 0.3
    });
    const halo = new THREE.Mesh(gateGeometry, haloMat);
    halo.position.set(0, 2.12, [-30, -62, -94, -126][i] + 0.42);
    halo.scale.set(1.37, 0.92, 1); detailGroup.add(halo);
  }
}

function buildAstralWorld(){
  const astral=new THREE.Group();astral.name='environment-vale-astral';scene.add(astral);activeEnvironmentGroup=astral;
  const deepStone=new THREE.MeshStandardMaterial({color:0x17132f,roughness:.82,metalness:.12});
  const islandTop=new THREE.MeshStandardMaterial({color:0x29224b,roughness:.75,metalness:.2,emissive:0x110c2c,emissiveIntensity:.38});
  const islandEdge=new THREE.MeshStandardMaterial({color:0x251b42,roughness:.92,metalness:.08});
  const bridgeMat=new THREE.MeshStandardMaterial({color:0x463c74,roughness:.48,metalness:.35,emissive:0x1c1550,emissiveIntensity:.65});
  const crystalMat=new THREE.MeshStandardMaterial({color:0x8f7aff,emissive:0x6a38ff,emissiveIntensity:1.6,roughness:.24,metalness:.16});
  const cyanMat=new THREE.MeshStandardMaterial({color:0x5ceaff,emissive:0x168cda,emissiveIntensity:1.35,roughness:.28,metalness:.16});
  const zones=[{z:-14,depth:34},{z:-46,depth:30},{z:-78,depth:30},{z:-110,depth:30},{z:-153,depth:40}];
  zones.forEach((zone,index)=>{
    box(27.5,.78,zone.depth,islandEdge,0,-.47,zone.z);box(27.1,.11,zone.depth-.7,islandTop,0,-.025,zone.z);
    const underside=new THREE.Mesh(new THREE.ConeGeometry(5.6+(index%2)*.5,4.3,7),deepStone);underside.position.set(0,-2.65,zone.z);underside.rotation.y=index*.31;activeEnvironmentGroup.add(underside);
    const seal=new THREE.Mesh(new THREE.RingGeometry(3.15,3.3,48),new THREE.MeshBasicMaterial({color:index%2?0x66e7ff:0xa98cff,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false}));seal.rotation.x=-Math.PI/2;seal.position.set(0,.045,zone.z);activeEnvironmentGroup.add(seal);
    for(const side of [-1,1]){const pylon=new THREE.Mesh(new THREE.OctahedronGeometry(.85+(index%3)*.12,0),side===-1?crystalMat:cyanMat);pylon.scale.set(.72,2.2,.72);pylon.position.set(side*11.2,1.15,zone.z+(index%2?5:-5));activeEnvironmentGroup.add(pylon);}
  });
  for(const z of [-30.5,-62,-94,-130]){box(8.6,.18,z===-130?9.5:3.8,bridgeMat,0,-.025,z);for(const x of [-3.7,3.7]){const c=new THREE.Mesh(new THREE.OctahedronGeometry(.24,0),cyanMat);c.position.set(x,.22,z);activeEnvironmentGroup.add(c);}}
  for(const z of [-30,-62,-94,-126]){
    const arch=new THREE.Group(),frame=new THREE.MeshStandardMaterial({color:0x68569e,emissive:0x4c35aa,emissiveIntensity:1.15,metalness:.35,roughness:.28});
    for(const x of [-3.15,3.15]){const p=new THREE.Mesh(new THREE.BoxGeometry(.3,4.2,.35),frame);p.position.set(x,2.1,0);arch.add(p);}
    const top=new THREE.Mesh(new THREE.BoxGeometry(6.6,.32,.4),frame);top.position.set(0,4.22,0);arch.add(top);
    const loop=new THREE.Mesh(new THREE.TorusGeometry(1.72,.065,8,48),new THREE.MeshStandardMaterial({color:0x9e83ff,emissive:0x754dff,emissiveIntensity:1.8,roughness:.25,metalness:.2}));loop.position.set(0,2.08,-.1);loop.scale.set(1.45,1.12,1);arch.add(loop);
    const veil=new THREE.Mesh(new THREE.PlaneGeometry(5.15,3.6),new THREE.MeshBasicMaterial({color:0x6639d9,transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}));veil.position.set(0,2.08,-.08);arch.add(veil);arch.position.z=z;activeEnvironmentGroup.add(arch);
  }
  const starCount = gameSettings.graphicsQuality === 'low' ? (isMobileDevice ? 45 : 70) : gameSettings.graphicsQuality === 'high' ? (isMobileDevice ? 100 : 260) : (isMobileDevice ? 90 : 180);
  const starPositions = new Float32Array(starCount * 3);
  for(let i=0;i<starCount;i++){starPositions[i*3]=(Math.random()-.5)*105;starPositions[i*3+1]=4+Math.random()*34;starPositions[i*3+2]=-184+Math.random()*198;}
  const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.BufferAttribute(starPositions,3));
  astralStarField=new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xd9d1ff,size:isMobileDevice?0.11:0.16,transparent:true,opacity:.78,depthWrite:false}));activeEnvironmentGroup.add(astralStarField);
  for(let i=0;i<12;i++){const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.28+Math.random()*.28,0),i%3===0?cyanMat:crystalMat);crystal.position.set((Math.random()-.5)*20,1.4+Math.random()*2.3,-5-Math.random()*165);crystal.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);activeEnvironmentGroup.add(crystal);astralFloaters.push({mesh:crystal,baseY:crystal.position.y,phase:Math.random()*Math.PI*2,speed:.45+Math.random()*.65});}
  if(!isMobileDevice){const l=new THREE.PointLight(0x9168ff,25,62,2);l.position.set(0,5,-78);activeEnvironmentGroup.add(l);const sky=new THREE.PointLight(0x39cfff,17,52,2);sky.position.set(-8,4,-150);activeEnvironmentGroup.add(sky);}
  environmentGroups.astral=activeEnvironmentGroup;activeEnvironmentGroup.visible=false;activeEnvironmentGroup=null;
}
function showRealmTransition(realm){
  const overlay=$('phaseTransition');if(!overlay)return;
  $('phaseTransitionTitle').textContent=realm===2?'VALE ASTRAL':'MUNDO MONOCROMÁTICO';
  $('phaseTransitionSub').textContent=realm===2?'UM NOVO MUNDO · CINCO REGIÕES · UM NOVO GUARDIÃO':'A masmorra continua à sua espera';
  overlay.dataset.realm=String(realm);
  overlay.classList.remove('hidden','phase-out');overlay.classList.add('phase-in');
  setTimeout(()=>{overlay.classList.remove('phase-in');overlay.classList.add('phase-out');},2300);
  setTimeout(()=>{overlay.classList.add('hidden');overlay.classList.remove('phase-out');},3000);
}

function trimMat() {
  return mat(0xc5a46b, .4, .6);
}

// Textura procedural em resolução maior, com grão, riscos e fissuras finas.
// É gerada localmente: não acrescenta downloads nem dependências externas.
function makeSurfaceTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const shade = 158 + Math.floor(Math.random() * 78);
    image.data[i] = shade;
    image.data[i + 1] = Math.max(0, shade - 3);
    image.data[i + 2] = Math.max(0, shade - 8);
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  ctx.globalAlpha = .22;
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const w = 2 + Math.random() * 23, h = .5 + Math.random() * 2;
    ctx.fillStyle = Math.random() > .5 ? '#edf3fc' : '#1b222e';
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = .2;
  ctx.strokeStyle = '#202632';
  ctx.lineWidth = .8;
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - .5) * 24, y + 4 + Math.random() * 22);
    ctx.lineTo(x + (Math.random() - .5) * 36, y + 10 + Math.random() * 34);
    if (Math.random() > .45) ctx.lineTo(x + (Math.random() - .5) * 48, y + 18 + Math.random() * 48);
    ctx.stroke();
  }
  ctx.globalAlpha = .12;
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = Math.random() > .5 ? '#cbd5e1' : '#111827';
    ctx.beginPath();
    ctx.arc(x, y, .5 + Math.random() * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const surfaceTexture = makeSurfaceTexture();

function attachHealthBar(entity) {
  const bar = new THREE.Group();
  bar.position.set(0, 3.0, 0);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(1.86, 0.38), new THREE.MeshBasicMaterial({ color: 0x080b10, depthTest: false, depthWrite: false }));
  rim.position.z = -0.025;
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 0.26), new THREE.MeshBasicMaterial({ color: 0x390712, depthTest: false, depthWrite: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.18), new THREE.MeshBasicMaterial({ color: 0x39f078, depthTest: false, depthWrite: false }));
  fill.position.z = 0.018;
  bar.add(rim, bg, fill);
  bar.renderOrder = 20;
  entity.add(bar);
  entity.userData.healthBar = bar;
  entity.userData.healthFill = fill;
}
function setHealthBar(entity, hp, maxHp) {
  if (!entity?.userData?.healthFill) return;
  const max = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 100;
  const current = Number.isFinite(hp) ? Math.max(0, hp) : max;
  const ratio = THREE.MathUtils.clamp(current / max, 0, 1);
  const fill = entity.userData.healthFill;
  fill.scale.x = Math.max(0.001, ratio);
  fill.position.x = -0.79 * (1 - ratio);
  fill.material.color.set(ratio > 0.6 ? 0x39f078 : ratio > 0.3 ? 0xffc533 : 0xff334f);
}
function makeGuardianSpirit(color = 0x8cffe8) {
  const g = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, metalness: .2, roughness: .18, transparent: true, opacity: .96 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xcffff8, emissive: 0x59d9cf, emissiveIntensity: 1.3, transparent: true, opacity: .78, side: THREE.DoubleSide, roughness: .22 });
  const darkEye = new THREE.MeshBasicMaterial({ color: 0x133d4a });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.22, 1), coreMat);
  g.add(core);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.29, .026, 8, 28), new THREE.MeshStandardMaterial({ color: 0xe0fff7, emissive: color, emissiveIntensity: 1.7, roughness: .2 }));
  halo.rotation.x = Math.PI / 2.6;
  halo.position.y = .13;
  g.add(halo);
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.OctahedronGeometry(.15, 1), wingMat);
    wing.position.set(side * .24, .015, .035);
    wing.scale.set(.7, 1.12, .38);
    wing.rotation.z = side * -.24;
    g.add(wing); wings.push({ mesh: wing, side });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(.025, 10, 8), darkEye);
    eye.position.set(side * .075, -.025, -.19);
    g.add(eye);
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x7debdc, emissive: 0x3bd9c8, emissiveIntensity: 1.25, transparent: true, opacity: .7 });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.095, .30, 7), tailMat);
  tail.position.set(0, -.25, .03);
  tail.rotation.x = Math.PI;
  g.add(tail);
  g.userData.guardianCore = core;
  g.userData.guardianHalo = halo;
  g.userData.guardianWings = wings;
  g.userData.isGuardianSpirit = true;
  g.userData.spiritPhase = Math.random() * Math.PI * 2;
  return g;
}

function makeHero(color = null, heroClass = 'knight', skin = 'default') {
  const g = new THREE.Group();
  const classColor = heroClass === 'mage' ? 0x7565df : heroClass === 'archer' ? 0x4b9965 : heroClass === 'goblin' ? 0x63b448 : heroClass === 'ogre' ? 0xb56d3e : heroClass === 'healer' ? 0x66d8ac : heroClass === 'necromancer' ? 0x9764cc : heroClass === 'skeleton' ? 0xd9d1b9 : heroClass === 'monk' ? 0xd7a05b : 0x72e6ff;
  const skinPalette = {
    default: { armor: color ?? classColor, dark: 0x151d2a, trim: 0xc9a45d, glow: 0x8beaff, accent: classColor, cloth: classColor },
    shadow: { armor: 0x343a50, dark: 0x11131d, trim: 0x9187cf, glow: 0xb7a4ff, accent: 0x9a8cff, cloth: 0x25263f },
    ember: { armor: 0x9b4a2b, dark: 0x3b1915, trim: 0xf0a45b, glow: 0xff7546, accent: 0xff694e, cloth: 0x5b241c },
    rune: { armor: 0x276b89, dark: 0x102435, trim: 0x70e9ee, glow: 0x6ef9ee, accent: 0x5ddde2, cloth: 0x183e58 },
    celestial: { armor: 0xd4bd79, dark: 0x33425a, trim: 0xffedb7, glow: 0xfff0b8, accent: 0xffe5a1, cloth: 0x647b91 },
    bloodmoon: { armor: 0x8f2948, dark: 0x260e20, trim: 0xf07a9c, glow: 0xff527e, accent: 0xf85c80, cloth: 0x4a142c }
  };
  const palette = skinPalette[skin] || skinPalette.default;
  const armorColor = palette.armor;
  const darkColor = palette.dark;
  // Acabamento PBR aprimorado compartilhado por todas as classes e skins.
  const armor = new THREE.MeshPhysicalMaterial({ color: armorColor, map: surfaceTexture, bumpMap: surfaceTexture, bumpScale: .034, metalness: .46, roughness: .39, clearcoat: .34, clearcoatRoughness: .32 });
  const dark = new THREE.MeshStandardMaterial({ color: darkColor, map: surfaceTexture, bumpMap: surfaceTexture, bumpScale: .012, metalness: .31, roughness: .58 });
  const skinTone = heroClass === 'goblin' ? 0x83bb56 : heroClass === 'ogre' ? 0x8c7952 : heroClass === 'skeleton' ? 0xe0dccb : 0xe2b99a;
  const skinMaterial = new THREE.MeshStandardMaterial({ color: skinTone, roughness: .77, bumpMap: surfaceTexture, bumpScale: .007 });
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xc2d7e4, metalness: .88, roughness: .2, clearcoat: .28, clearcoatRoughness: .22 });
  const gold = new THREE.MeshPhysicalMaterial({ color: palette.trim, metalness: .76, roughness: .27, clearcoat: .3, clearcoatRoughness: .25 });
  const glow = new THREE.MeshPhysicalMaterial({ color: palette.glow, emissive: palette.glow, emissiveIntensity: 1.22, metalness: .25, roughness: .23, clearcoat: .42 });
  const classAccentMaterial = new THREE.MeshPhysicalMaterial({ color: palette.accent, emissive: palette.accent, emissiveIntensity: .5, metalness: .49, roughness: .27, clearcoat: .5, clearcoatRoughness: .25 });
  const clothMaterial = new THREE.MeshStandardMaterial({ color: palette.cloth, map: surfaceTexture, bumpMap: surfaceTexture, bumpScale: .018, roughness: .83, metalness: .06 });
  const add = (geo, material, x, y, z, sx=1, sy=1, sz=1) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz);
    if (!isMobileDevice) { mesh.castShadow = true; mesh.receiveShadow = true; }
    g.add(mesh); return mesh;
  };
  // Botas, pernas e braços guardados para animação procedural de caminhada.
  const legs = [], arms = [];
  let torsoMesh = null, headMesh = null;
  for (const side of [-1,1]) {
    // Quadril: a perna gira pelo topo em vez do centro da cápsula.
    const legPivot = new THREE.Group();
    legPivot.position.set(side*.2,.68,0);
    g.add(legPivot);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.145,.34,9,20), dark);
    leg.position.set(0,-.21,0);
    if (!isMobileDevice) { leg.castShadow = true; leg.receiveShadow = true; }
    legPivot.add(leg);
    legs.push({ mesh: legPivot, side });
    const boot = new THREE.Mesh(new THREE.BoxGeometry(.27,.16,.4), steel);
    boot.position.set(0,-.49,-.055);
    if (!isMobileDevice) { boot.castShadow = true; boot.receiveShadow = true; }
    legPivot.add(boot);
    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(.19,18,14), gold);
    kneePad.position.set(0,0,0);
    kneePad.scale.set(.94,.62,.9);
    if (!isMobileDevice) { kneePad.castShadow = true; kneePad.receiveShadow = true; }
    legPivot.add(kneePad);
    // Ombro: o braço acompanha uma articulação dedicada.
    const armPivot = new THREE.Group();
    armPivot.position.set(side*.48,1.51,0);
    g.add(armPivot);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.13,.42,9,20), armor);
    arm.position.set(0,-.22,0);
    arm.rotation.z=side*-.12;
    if (!isMobileDevice) { arm.castShadow = true; arm.receiveShadow = true; }
    armPivot.add(arm);
    // Cotovelo e antebraço separados para dar leitura de articulação durante o passo.
    const elbow = new THREE.Group();
    elbow.position.set(0,-.39,0);
    armPivot.add(elbow);
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(.105,.24,8,16), dark);
    forearm.position.set(0,-.13,-.005);
    if (!isMobileDevice) { forearm.castShadow = true; forearm.receiveShadow = true; }
    elbow.add(forearm);
    const wrist = new THREE.Mesh(new THREE.SphereGeometry(.09,12,10), gold);
    wrist.position.set(0,-.27,-.01);
    elbow.add(wrist);
    armPivot.userData.elbow = elbow;
    arms.push({ mesh: armPivot, side });
    add(new THREE.SphereGeometry(.19,20,16), steel, side*.48,1.49,0,1.08,.65,1.0);
    add(new THREE.CapsuleGeometry(.12,.19,3,6), dark, side*.49,.91,-.015);
    add(new THREE.SphereGeometry(.105,10,8), gold, side*.49,.83,-.02);
  }
  // Peitoral em camadas, gola e cinto
  torsoMesh = add(new THREE.CapsuleGeometry(.36,.5,7,16), armor, 0,1.22,0,1.0,1.0,.82);
  add(new THREE.BoxGeometry(.48,.42,.12), steel, 0,1.25,-.31);
  add(new THREE.BoxGeometry(.19,.23,.05), glow, 0,1.27,-.39);
  add(new THREE.BoxGeometry(.64,.12,.43), dark, 0,.91,0);
  add(new THREE.BoxGeometry(.15,.15,.08), gold, 0,.91,-.23);
  // Capa dividida em painéis para dar silhueta de aventureiro
  const cape=add(new THREE.BoxGeometry(.58,.72,.13), dark,0,1.23,.29);
  cape.rotation.x=-.08;
  // Back-facing crest and metal hems make the third-person silhouette readable.
  for (const y of [1.53,1.39,1.25,1.11]) add(new THREE.BoxGeometry(.43,.018,.018), gold,0,y,.371);
  add(new THREE.BoxGeometry(.024,.59,.02), gold,-.245,1.24,.371);
  add(new THREE.BoxGeometry(.024,.59,.02), gold,.245,1.24,.371);
  const capeCrest=add(new THREE.OctahedronGeometry(.105,1),classAccentMaterial,0,1.34,.39,.8,1.1,.42);
  capeCrest.rotation.z=Math.PI/4;
  add(new THREE.ConeGeometry(.34,.35,5), armor,0,.83,.34,1,.75,.55);
  // Cabeça, cabelo curto, sobrancelhas e olhos luminosos
  headMesh = add(new THREE.SphereGeometry(.255,36,28), skinMaterial,0,1.94,-.015,
    heroClass === 'ogre' ? 1.28 : heroClass === 'goblin' ? .93 : 1,
    heroClass === 'ogre' ? 1.12 : heroClass === 'goblin' ? 1.04 : 1,
    heroClass === 'ogre' ? 1.12 : 1);
  add(new THREE.SphereGeometry(.27,20,12,0,Math.PI*2,0,Math.PI*.48), dark,0,2.075,.005);
  if (heroClass === 'goblin') {
    const eyeMat = new THREE.MeshStandardMaterial({color:0xd9d56a,emissive:0x817c24,emissiveIntensity:.35});
    for (const side of [-1,1]) {
      const ear = add(new THREE.ConeGeometry(.095,.34,4), skinMaterial, side*.32,2.00,.005,1,1,.62);
      ear.rotation.z = side * -.88;
      add(new THREE.SphereGeometry(.052,8,6), eyeMat, side*.09,1.96,-.239);
    }
  } else if (heroClass === 'ogre') {
    for (const side of [-1,1]) {
      const tusk = add(new THREE.ConeGeometry(.075,.23,6), new THREE.MeshStandardMaterial({color:0xf1e0b3,roughness:.6}), side*.15,1.79,-.205);
      tusk.rotation.z = Math.PI + side*.18;
      add(new THREE.SphereGeometry(.075,8,6), dark, side*.27,1.91,-.11,1.2,.8,.7);
    }
    add(new THREE.ConeGeometry(.09,.20,5), dark, -.12,2.25,.02,1,1,.8).rotation.z = -.3;
    add(new THREE.ConeGeometry(.09,.20,5), dark, .12,2.25,.02,1,1,.8).rotation.z = .3;
  }
  add(new THREE.BoxGeometry(.32,.09,.2), dark,0,2.04,-.17);
  for (const side of [-1,1]) add(new THREE.SphereGeometry(.035,8,6), glow,side*.09,1.96,-.239);
  // Ombreiras e pequenos rebites metálicos
  for (const side of [-1,1]) {
    const pad=add(new THREE.SphereGeometry(.22,12,8), steel,side*.48,1.51,0,1.15,.7,1.0);
    pad.rotation.z=side*-.2;
    add(new THREE.SphereGeometry(.045,8,6), gold,side*.48,1.53,-.19);
  }
  // Espada com lâmina facetada, guarda dourada e pomo
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.085,.72,.055), steel); blade.position.y=.48; sword.add(blade);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(.018,.68,.06), glow); edge.position.set(.043,.48,-.002); sword.add(edge);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(.31,.065,.12), gold); guard.position.y=.12; sword.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(.045,.05,.2,8), dark); grip.position.y=.015; sword.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(.07,8,6), gold); pommel.position.y=-.09; sword.add(pommel);
  sword.position.set(.57,1.0,-.12); sword.rotation.z=-.25; g.add(sword);
  sword.visible = heroClass === 'knight';
  let classWeapon = sword;
  if (heroClass === 'mage') {
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.045,.06,.95,8), gold); shaft.position.y=.4; staff.add(shaft);
    const orb = new THREE.Mesh(new THREE.OctahedronGeometry(.18,1), glow); orb.position.y=.98; staff.add(orb);
    staff.position.set(.52,.65,-.04); staff.rotation.z=-.12; g.add(staff); classWeapon = staff;
  } else if (heroClass === 'healer') {
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.047,.07,1.12,8), gold); shaft.position.y=.43; staff.add(shaft);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.19,2), new THREE.MeshStandardMaterial({color:0x8ffff0,emissive:0x23bf91,emissiveIntensity:1.7,metalness:.3,roughness:.2})); crystal.position.y=1.03; staff.add(crystal);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.23,.025,6,20), new THREE.MeshStandardMaterial({color:0xc8fff0,emissive:0x3ad7ab,emissiveIntensity:.8})); halo.position.y=1.03; halo.rotation.x=Math.PI/2; staff.add(halo);
    staff.position.set(.52,.58,-.04); staff.rotation.z=-.12; g.add(staff); classWeapon = staff;
  } else if (heroClass === 'necromancer') {
    const staff = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.05,.075,1.18,7), dark); shaft.position.y=.42; staff.add(shaft);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.19,1), new THREE.MeshStandardMaterial({color:0xc6a1ff,emissive:0x6e26b8,emissiveIntensity:1.9,roughness:.22})); orb.position.y=1.04; staff.add(orb);
    const boneRing = new THREE.Mesh(new THREE.TorusGeometry(.23,.027,5,16), steel); boneRing.position.y=1.04; boneRing.rotation.x=Math.PI/2; staff.add(boneRing);
    staff.position.set(.52,.56,-.04); staff.rotation.z=-.14; g.add(staff); classWeapon = staff;
  } else if (heroClass === 'archer') {
    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(.34,.045,6,18,Math.PI*1.25), gold); arc.rotation.z=-Math.PI*.62; bow.add(arc);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.66,5), steel); string.position.set(-.12,0,0); string.rotation.z=Math.PI*.1; bow.add(string);
    bow.position.set(.56,1.08,-.08); bow.rotation.z=-.18; g.add(bow); classWeapon = bow;
  } else if (heroClass === 'goblin') {
    const daggers = new THREE.Group();
    for (const side of [-1,1]) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(.075,.52,5), steel);
      blade.position.set(side*.08,.27,0); blade.rotation.z = Math.PI + side*.18; daggers.add(blade);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.18,6), dark);
      grip.position.set(side*.08,-.06,0); daggers.add(grip);
    }
    daggers.position.set(.55,1.02,-.13); daggers.rotation.z=-.20; g.add(daggers); classWeapon = daggers;
  } else if (heroClass === 'ogre') {
    const club = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(.07,.10,.95,8), dark);
    handle.position.y=.32; handle.rotation.z=-.12; club.add(handle);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.25,1), new THREE.MeshStandardMaterial({color:0x795239,roughness:.88}));
    head.position.set(.04,.83,0); head.scale.set(1.1,1,.92); club.add(head);
    for (const side of [-1,1]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(.055,.18,5), gold);
      spike.position.set(side*.20,.85,0); spike.rotation.z=side*-Math.PI/2; club.add(spike);
    }
    club.position.set(.58,.78,-.12); club.rotation.z=-.30; g.add(club); classWeapon = club;
  } else if (heroClass === 'monk') {
    // O monge combate desarmado, com faixas e punhos reforçados.
    classWeapon = new THREE.Group();
    for (const side of [-1,1]) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(.105,.035,5,12), new THREE.MeshStandardMaterial({color:0xe8d1a5,roughness:.78}));
      wrap.position.set(side*.49,1.04,-.16); wrap.rotation.y=Math.PI/2; g.add(wrap);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(.105,10,8), new THREE.MeshStandardMaterial({color:0xd7a05b,roughness:.8}));
      fist.position.set(side*.5,.92,-.18); fist.scale.set(1.0,.9,1.1); g.add(fist);
    }
  }
  // Detail pass: layered armor, class sigils, trim and distinct silhouettes.
  const collar = add(new THREE.TorusGeometry(.205,.035,6,20), gold, 0,1.56,0);
  collar.rotation.x = Math.PI / 2;
  add(new THREE.OctahedronGeometry(.145,1), classAccentMaterial, 0,1.29,-.405,.78,1.12,.42);
  for (const y of [1.10,1.18,1.26]) add(new THREE.BoxGeometry(.34,.018,.025), gold, 0,y,-.405);
  for (const side of [-1,1]) {
    const vambrace = add(new THREE.BoxGeometry(.15,.24,.075), steel, side*.48,1.12,-.16);
    vambrace.rotation.z = side * -.12;
    const shoulderTrim = add(new THREE.TorusGeometry(.185,.022,5,18), gold, side*.48,1.51,-.135);
    shoulderTrim.scale.set(1.15,.74,1);
    add(new THREE.BoxGeometry(.075,.46,.045), classAccentMaterial, side*.20,1.22,-.382).rotation.z = side*.22;
  }
  add(new THREE.BoxGeometry(.18,.15,.10), dark, -.26,.90,-.245);
  add(new THREE.BoxGeometry(.18,.15,.10), dark, .26,.90,-.245);
  add(new THREE.BoxGeometry(.08,.07,.035), gold, -.26,.90,-.306);
  add(new THREE.BoxGeometry(.08,.07,.035), gold, .26,.90,-.306);
  const capeTailL = add(new THREE.ConeGeometry(.19,.54,5), clothMaterial, -.19,.73,.33,1,.92,.48);
  capeTailL.rotation.z = .10;
  const capeTailR = add(new THREE.ConeGeometry(.19,.54,5), dark, .19,.73,.33,1,.92,.48);
  capeTailR.rotation.z = -.10;
  if (heroClass === 'goblin') {
    g.scale.setScalar(.88);
    cape.visible = false; capeTailL.visible = false; capeTailR.visible = false;
    add(new THREE.BoxGeometry(.22,.09,.16), dark, 0,1.87,-.24);
    add(new THREE.BoxGeometry(.12,.035,.06), gold, 0,1.88,-.29);
  } else if (heroClass === 'ogre') {
    g.scale.setScalar(1.18);
    cape.visible = false; capeTailL.visible = false; capeTailR.visible = false;
    add(new THREE.BoxGeometry(.42,.20,.14), dark, 0,1.54,-.25);
    add(new THREE.BoxGeometry(.24,.06,.05), gold, 0,1.54,-.34);
  } else if (heroClass === 'knight') {
    add(new THREE.BoxGeometry(.38,.075,.095), steel, 0,2.08,-.205);
    add(new THREE.BoxGeometry(.10,.23,.09), steel, -.215,1.91,-.12);
    add(new THREE.BoxGeometry(.10,.23,.09), steel, .215,1.91,-.12);
    add(new THREE.ConeGeometry(.085,.27,5), gold, 0,2.30,.015);
    add(new THREE.BoxGeometry(.22,.035,.045), classAccentMaterial, 0,2.02,-.25);
  } else if (heroClass === 'mage') {
    const hood = add(new THREE.ConeGeometry(.30,.34,8), clothMaterial, 0,2.19,.045);
    hood.rotation.x = -.08;
    add(new THREE.ConeGeometry(.43,.58,8), clothMaterial, 0,.78,.02,1,.86,.72);
    add(new THREE.OctahedronGeometry(.105,1), classAccentMaterial, 0,1.58,-.18,1,1.15,.72);
    const focusHalo = add(new THREE.TorusGeometry(.13,.018,5,18), classAccentMaterial, 0,1.58,-.21);
    focusHalo.rotation.x = Math.PI / 2;
  } else if (heroClass === 'archer') {
    const hood = add(new THREE.ConeGeometry(.285,.36,7), clothMaterial, 0,2.18,.035);
    hood.rotation.x = -.05;
    add(new THREE.ConeGeometry(.29,.36,6), clothMaterial, 0,1.40,.34,1,.86,.44);
    const quiver = add(new THREE.CylinderGeometry(.085,.11,.52,8), dark, -.32,1.23,.34);
    quiver.rotation.z = -.14;
    for (let i=0;i<3;i++) {
      add(new THREE.CylinderGeometry(.009,.013,.44,5), gold, -.39+i*.065,1.49,.34).rotation.z = -.12 + i*.08;
      add(new THREE.ConeGeometry(.026,.09,5), steel, -.39+i*.065,1.75,.34);
    }
    const strap = add(new THREE.BoxGeometry(.075,.60,.035), gold, -.10,1.22,-.385);
    strap.rotation.z = -.27;
  } else if (heroClass === 'healer') {
    add(new THREE.ConeGeometry(.43,.72,8), clothMaterial, 0,.79,.03,1,.9,.8);
    const hood = add(new THREE.ConeGeometry(.30,.38,8), clothMaterial,0,2.17,.03);
    hood.rotation.x=-.08;
    add(new THREE.TorusGeometry(.19,.035,6,18),gold,0,1.57,0).rotation.x=Math.PI/2;
    add(new THREE.OctahedronGeometry(.13,1),new THREE.MeshStandardMaterial({color:0xc4fff0,emissive:0x39dba7,emissiveIntensity:1.1}),0,1.28,-.43,.8,1.2,.55);
    for (const side of [-1,1]) add(new THREE.BoxGeometry(.07,.3,.08),gold,side*.27,1.14,-.35).rotation.z=side*.18;
  } else if (heroClass === 'necromancer') {
    add(new THREE.ConeGeometry(.43,.72,7),clothMaterial,0,.78,.03,1,.9,.8);
    const hood = add(new THREE.ConeGeometry(.32,.42,7),clothMaterial,0,2.15,.04);
    hood.rotation.x=-.12;
    add(new THREE.SphereGeometry(.12,10,8),new THREE.MeshStandardMaterial({color:0xe3d7f2,roughness:.7}),0,1.30,-.44,1,.88,.55);
    add(new THREE.TorusGeometry(.17,.025,5,18),classAccentMaterial,0,1.30,-.45).rotation.x=Math.PI/2;
    for (const side of [-1,1]) add(new THREE.ConeGeometry(.07,.20,5),steel,side*.12,1.31,-.45).rotation.z=Math.PI;
  } else {
    // Monge: roupa curta, faixa na cabeça e silhueta compacta.
    cape.visible=false; capeTailL.visible=false; capeTailR.visible=false;
    g.scale.setScalar(.96);
    add(new THREE.BoxGeometry(.64,.13,.46),clothMaterial,0,.93,0);
    add(new THREE.BoxGeometry(.53,.06,.05),gold,0,.94,-.25);
    add(new THREE.BoxGeometry(.47,.09,.33),clothMaterial,0,2.02,-.02);
    add(new THREE.BoxGeometry(.20,.055,.035),gold,0,2.03,-.20);
    add(new THREE.ConeGeometry(.08,.16,5),gold,-.30,2.02,-.02).rotation.z=.7;
  }
  // Ornamentação adicional por skin: silhueta e emissivos diferentes, sem alterar hitbox.
  if (skin === 'rune') {
    add(new THREE.TorusGeometry(.27,.025,7,24), classAccentMaterial, 0,1.3,-.42).rotation.x=Math.PI/2;
    add(new THREE.OctahedronGeometry(.11,2), glow, 0,2.23,-.04,1,1.2,.7);
    for (const side of [-1,1]) add(new THREE.OctahedronGeometry(.085,1), glow, side*.52,1.48,-.02);
  } else if (skin === 'celestial') {
    const halo = add(new THREE.TorusGeometry(.32,.026,8,30), classAccentMaterial, 0,2.28,.02);
    halo.rotation.x=Math.PI/2.15;
    add(new THREE.OctahedronGeometry(.10,2), glow, 0,1.3,-.43,1,1.25,.65);
    for (const side of [-1,1]) add(new THREE.SphereGeometry(.075,14,10), gold, side*.52,1.52,-.015);
  } else if (skin === 'bloodmoon') {
    for (const side of [-1,1]) {
      const horn = add(new THREE.ConeGeometry(.085,.28,7), classAccentMaterial, side*.18,2.20,.02);
      horn.rotation.z = side * -.24;
      const spike = add(new THREE.ConeGeometry(.07,.22,7), classAccentMaterial, side*.53,1.49,-.015);
      spike.rotation.z = side * -Math.PI/2;
    }
    add(new THREE.OctahedronGeometry(.12,1), glow, 0,1.3,-.44,.8,1.1,.55);
  }
  // Update 2 v11: passe de microdetalhes reutilizado por TODAS as classes e skins.
  // Placas sobrepostas, costuras metálicas e rebites melhoram a leitura sem alterar colisões ou poderes.
  for (let row = 0; row < 3; row++) {
    const y = 1.08 + row * .13;
    const plate = add(new THREE.SphereGeometry(.205,24,16), armor, 0, y, -.365, 1.32, .30, .13);
    plate.rotation.x = -.035;
    add(new THREE.BoxGeometry(.29,.012,.014), gold, 0, y + .045, -.405);
    add(new THREE.SphereGeometry(.018,10,8), classAccentMaterial, 0, y, -.414);
  }
  // Pequenos rebites nos encaixes dos ombros e antebraços, com reflexo físico.
  for (const side of [-1,1]) {
    for (const y of [1.43,1.51,1.59]) {
      const rivet = add(new THREE.SphereGeometry(.026,12,10), gold, side*.48, y, -.19);
      rivet.scale.set(1,.85,.6);
    }
    for (const y of [1.02,1.12,1.22]) {
      add(new THREE.BoxGeometry(.125,.014,.018), classAccentMaterial, side*.48, y, -.215).rotation.z = side * -.10;
    }
    add(new THREE.TorusGeometry(.118,.012,6,20), gold, side*.2,.33,0).rotation.x = Math.PI/2;
    add(new THREE.BoxGeometry(.07,.018,.022), glow, side*.2,.58,-.185);
  }
  const waistSigil = add(new THREE.OctahedronGeometry(.075,2), classAccentMaterial, 0,.91,-.30);
  waistSigil.rotation.z = Math.PI/4;
  add(new THREE.TorusGeometry(.105,.012,6,24), gold,0,.91,-.302).rotation.x = Math.PI/2;

  for (const side of [-1,1]) {
    add(new THREE.SphereGeometry(.032,12,10), classAccentMaterial, side*.092,1.96,-.245);
    add(new THREE.SphereGeometry(.055,14,10), classAccentMaterial, side*.48,1.49,-.21);
  }
  g.userData.sword=classWeapon;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.43,.49,32),new THREE.MeshBasicMaterial({color:classColor,transparent:true,opacity:.72,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2; ring.position.y=.025; g.add(ring);
  g.userData.heroClass = heroClass;
  g.userData.heroSkin = skin;
  g.userData.cape=cape;
  g.userData.capeTails=[capeTailL,capeTailR];
  g.userData.torso = torsoMesh;
  g.userData.head = headMesh;
  g.userData.legs = legs;
  g.userData.arms = arms;
  g.userData.walkPhase = Math.random() * Math.PI * 2;
  g.userData.baseY = 0;
  attachHealthBar(g);
  return g;
}

function disposeObject3D(root) {
  if (!root) return;
  root.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) if (material && material.dispose) material.dispose();
    }
  });
}

function createPlayer() {
  myPlayer = makeHero(null, selectedClass || 'knight', selectedSkin || 'default');
  scene.add(myPlayer);
  myPlayer.position.set(0, 0, 3);
}

function makeBoss() {
  const g = new THREE.Group();
  const armor = mat(0x29202f, .55, .35), dark = mat(0x100e18, .7, .2), bone = mat(0x9c8aa8, .45, .35);
  const eye = new THREE.MeshStandardMaterial({ color: 0xff345d, emissive: 0xff123c, emissiveIntensity: 2.8 });
  const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, isMobileDevice ? 1 : 2), armor); torso.position.y = 1.65; g.add(torso);
  const bossArms = [];
  const head = new THREE.Mesh(new THREE.SphereGeometry(.68, isMobileDevice ? 14 : 22, isMobileDevice ? 12 : 16), dark); head.position.y = 2.85; g.add(head);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(.22, .95, isMobileDevice ? 6 : 9), bone); horn.position.set(side * .48, 3.55, 0); horn.rotation.z = side * -.38; g.add(horn);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.12, isMobileDevice ? 8 : 12, isMobileDevice ? 6 : 10), eye); e.position.set(side * .25, 2.9, -.59); g.add(e);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .9, isMobileDevice ? 4 : 6, isMobileDevice ? 7 : 10), armor); arm.position.set(side * 1.12, 1.6, 0); arm.rotation.z = side * -.22; g.add(arm); bossArms.push({ mesh: arm, side });
    const claw = new THREE.Mesh(new THREE.ConeGeometry(.18, .55, 5), bone); claw.position.set(side * 1.2, .82, -.05); claw.rotation.z = Math.PI; g.add(claw);
  }
  // Armadura adicional e núcleo central: melhora a leitura do chefe a distância.
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.27,1),eye);
  core.position.set(0,1.78,-1.00); core.scale.set(.9,1.15,.62); g.add(core);
  const coreHalo = new THREE.Mesh(new THREE.TorusGeometry(.37,.04,7,32),
    new THREE.MeshStandardMaterial({color:0xb99aff,emissive:0x793bff,emissiveIntensity:1.25,metalness:.22,roughness:.28}));
  coreHalo.position.set(0,1.78,-.96); g.add(coreHalo);
  for (const side of [-1,1]) {
    const pauldron = new THREE.Mesh(new THREE.DodecahedronGeometry(.38,1),armor);
    pauldron.position.set(side*.91,2.18,-.08); pauldron.scale.set(1.12,.82,.86); g.add(pauldron);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(.15,.43,6),bone);
    spike.position.set(side*1.02,2.55,-.02); spike.rotation.z=side*-.35; g.add(spike);
  }
  for (let i=0;i<3;i++) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(.14,.52,6),bone);
    spine.position.set((i-1)*.35,2.05,.60); spine.rotation.x=Math.PI/2; spine.rotation.z=(i-1)*-.12; g.add(spine);
  }
  const rune = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.65, 32), new THREE.MeshBasicMaterial({ color: 0xff315d, transparent: true, opacity: .7, side: THREE.DoubleSide }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = .04; g.add(rune);
  g.userData.eyeMaterial = eye; g.userData.bodyMaterial = armor; g.userData.coreMesh=core; g.userData.coreHalo=coreHalo; g.userData.torso = torso; g.userData.arms = bossArms; g.userData.animPhase = Math.random()*Math.PI*2; return g;
}
function makeChest(realm=currentRealmVisual) {
  const group=new THREE.Group();
  const wood=mat(realm===2?0x292344:0x68452c,.8);
  const metal=mat(realm===2?0x8d7cff:0xb9944e,.35,.55);
  if(realm===2){metal.emissive.setHex(0x4c32bd);metal.emissiveIntensity=.72;}
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
  const lootFilter = $('lootFilter')?.value || 'all';
  const lootSort = $('lootSort')?.value || 'newest';
  let recent = lootDrops.slice();
  if (lootSort === 'power') recent.sort((a,b) => (Number(b.power)||1) - (Number(a.power)||1));
  else if (lootSort === 'rarity') recent.sort((a,b) => rarityOrder.indexOf(b.rarity) - rarityOrder.indexOf(a.rarity));
  else recent.reverse();
  recent = recent.filter(item => (lootFilter === 'all' || item.rarity === lootFilter)).slice(0,8);
  if (selectedItemId && !recent.some(item => String(item.id) === String(selectedItemId))) selectedItemId = recent.length ? String(recent[0].id) : null;
  if (!selectedItemId && recent.length) selectedItemId = String(recent[0].id);
  $('recentLoot').innerHTML = recent.length ? recent.map(item => '<button type="button" class="loot-item select-item rarity-' + item.rarity.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '') + (String(item.id) === String(selectedItemId) ? ' selected' : '') + '" data-item-id="' + escapeHTML(item.id) + '"><span>' + escapeHTML(item.name) + ' <small>(' + escapeHTML(item.rarity) + ' · Poder ' + (item.power || 1) + '/5)</small></span><b>' + (String(item.id) === String(selectedItemId) ? '✓' : '+') + '</b></button>').join('') : '<small>Nenhum item coletado ainda.</small>';
  const chosen = lootDrops.find(item => String(item.id) === String(selectedItemId));
  $('selectedItemLabel').textContent = chosen ? chosen.name + ' · ' + chosen.rarity + ' · PODER ' + (chosen.power || 1) + '/5' : 'Nenhum item selecionado';
  $('useSelectedItemBtn').disabled = !chosen;
}
function useSelectedItem() {
  if (!started || !selectedItemId || (myPlayer?.userData.serverHp ?? 100) <= 0) return;
  const item = lootDrops.find(entry => String(entry.id) === String(selectedItemId));
  if (!item) { showNotice('Selecione um item primeiro.'); return; }
  send({ type: 'useItem', id: item.id });
}

function interactChest() {
  if (!started || !myPlayer) return;
  let nearest = null, distance = Infinity;
  for (const chest of latestChests) {
    const d = Math.hypot(chest.x - myPlayer.position.x, chest.z - myPlayer.position.z);
    if (d < distance) { nearest = chest; distance = d; }
  }
  if (!nearest || distance > 3.0) { showNotice('Chegue perto de um baú.'); return; }
  playSfx('chest');
  send({ type: 'openChest', id: nearest.id });
}

function makeMonster(kind = 'stalker', phase = 1) {
  const g = new THREE.Group();
  const matBody = (color, rough = .72, metal = .12) => mat(color, rough, metal);
  const dark = new THREE.MeshStandardMaterial({ color: 0x11131d, map: surfaceTexture, bumpMap: surfaceTexture, bumpScale: .035, roughness: .84, metalness: .08 });
  const bone = matBody(0xb8c5d3, .48, .25);
  const eyeColor = kind === 'brute' ? 0xff9c35 : kind === 'wraith' ? 0x8ffcff : kind === 'thorn' ? 0x8dff74 : kind === 'inferno' ? 0xff692e : kind === 'abyss' ? 0xc08bff : 0xff3f68;
  const eyeMat = new THREE.MeshStandardMaterial({
    color: eyeColor, emissive: eyeColor, emissiveIntensity: 1.5, roughness: .3
  });
  const animatedLimbs = [];
  const addMesh = (geo, material, x, y, z, sx=1, sy=1, sz=1) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x,y,z); m.scale.set(sx,sy,sz); g.add(m);
    if (Math.abs(x) > .42 && y > .55 && y < 1.7 && (geo.type === 'CapsuleGeometry' || geo.type === 'BoxGeometry')) animatedLimbs.push({ mesh:m, side:Math.sign(x) || 1, baseRotationZ:m.rotation.z });
    return m;
  };

  if (kind === 'brute') {
    // Grande criatura blindada, com ombros largos, placas e chifres.
    const armor = matBody(phase === 2 ? 0x49316b : 0x414957, .48, .35);
    const belly = matBody(0x242a36, .86);
    addMesh(new THREE.CapsuleGeometry(.55,.65,5,8), armor, 0,1.0,0,1.1,1, .9);
    addMesh(new THREE.DodecahedronGeometry(.52,1), belly, 0,1.0,-.03,1,.85,.72);
    addMesh(new THREE.SphereGeometry(.34,16,12), armor, 0,1.85,-.03,1,.9,.9);
    for (const side of [-1,1]) {
      addMesh(new THREE.BoxGeometry(.48,.42,.5), armor, side*.62,1.48,0);
      const horn=addMesh(new THREE.ConeGeometry(.16,.58,7), bone, side*.24,2.2,-.02);
      horn.rotation.z=side*-.38;
      addMesh(new THREE.SphereGeometry(.085,10,8),eyeMat,side*.14,1.91,-.33);
      addMesh(new THREE.CapsuleGeometry(.18,.48,3,6),armor,side*.63,.67,0);
      const claw=addMesh(new THREE.ConeGeometry(.14,.38,6),bone,side*.68,.32,-.13);
      claw.rotation.x=Math.PI;
    }
  } else if (kind === 'wraith') {
    // Espectro cristalino: corpo estreito, capa em pontas e cristais cianos.
    const robe = new THREE.MeshStandardMaterial({color:0x263f62, roughness:.42, metalness:.2, emissive:0x102b55, emissiveIntensity:.65});
    addMesh(new THREE.ConeGeometry(.62,1.25,7),robe,0,.72,0,1,1,.85);
    addMesh(new THREE.SphereGeometry(.32,16,12),matBody(0x182537,.55,.25),0,1.55,0);
    addMesh(new THREE.OctahedronGeometry(.16),eyeMat,-.13,1.59,-.27);
    addMesh(new THREE.OctahedronGeometry(.16),eyeMat,.13,1.59,-.27);
    for(const side of [-1,1]){
      const spike=addMesh(new THREE.ConeGeometry(.13,.72,5),matBody(0x7deaff,.35,.4),side*.38,.98,0);
      spike.rotation.z=side*-.65;
      const shard=addMesh(new THREE.OctahedronGeometry(.2),eyeMat,side*.25,.55,-.15);
      shard.rotation.z=side*.4;
    }
  } else if (kind === 'thorn') {
    // Criatura vegetal da floresta: casca, espinhos e cipós.
    const bark = matBody(0x3c5a3e,.92,.04);
    const leaf = matBody(0x527e46,.82,.02);
    addMesh(new THREE.CapsuleGeometry(.34,.7,4,9),bark,0,.88,0,1.05,1,.85);
    addMesh(new THREE.DodecahedronGeometry(.38,1),leaf,0,1.55,-.05,1,.9,.82);
    for(const side of [-1,1]){
      const horn=addMesh(new THREE.ConeGeometry(.15,.7,6),bark,side*.22,2.05,-.02);
      horn.rotation.z=side*-.35;
      const thorn=addMesh(new THREE.ConeGeometry(.11,.58,5),leaf,side*.36,1.22,.18);
      thorn.rotation.z=side*.72;
      addMesh(new THREE.SphereGeometry(.075,12,8),eyeMat,side*.13,1.63,-.34);
      const vine=addMesh(new THREE.CapsuleGeometry(.07,.42,3,5),leaf,side*.42,.91,-.01);
      vine.rotation.z=side*.55;
      const claw=addMesh(new THREE.ConeGeometry(.09,.32,6),bone,side*.46,.57,-.2);
      claw.rotation.x=Math.PI;
    }
    addMesh(new THREE.ConeGeometry(.25,.55,5),bark,0,.52,.23,1,.8,.75);
  } else if (kind === 'inferno') {
    // Demônio do vulcão com placas de basalto e fissuras laranja.
    const basalt = matBody(0x31201d,.88,.16);
    const magma = new THREE.MeshStandardMaterial({color:0xff6b32,emissive:0xff3210,emissiveIntensity:1.65,roughness:.4});
    addMesh(new THREE.DodecahedronGeometry(.5,1),basalt,0,1.05,0,1.12,1.05,.9);
    addMesh(new THREE.SphereGeometry(.32,18,12),basalt,0,1.75,-.03);
    addMesh(new THREE.BoxGeometry(.32,.42,.05),magma,0,1.18,-.47);
    for(const side of [-1,1]){
      const horn=addMesh(new THREE.ConeGeometry(.16,.65,6),bone,side*.24,2.18,-.02);
      horn.rotation.z=side*-.42;
      addMesh(new THREE.SphereGeometry(.075,12,8),eyeMat,side*.13,1.79,-.32);
      addMesh(new THREE.BoxGeometry(.07,.38,.08),magma,side*.21,1.03,-.47,1,1,.7);
      const arm=addMesh(new THREE.CapsuleGeometry(.15,.4,4,7),basalt,side*.48,1.03,0);
      arm.rotation.z=side*.22;
      const claw=addMesh(new THREE.ConeGeometry(.12,.4,5),bone,side*.57,.64,-.15);
      claw.rotation.x=Math.PI;
    }
  } else if (kind === 'abyss') {
    // Variante do vazio reservada a encontros avançados.
    const voidMat = new THREE.MeshStandardMaterial({color:0x21162f,roughness:.42,metalness:.28,emissive:0x30134d,emissiveIntensity:.55});
    addMesh(new THREE.OctahedronGeometry(.55,1),voidMat,0,1.08,0,1.05,1.35,.8);
    addMesh(new THREE.SphereGeometry(.3,18,12),voidMat,0,1.8,-.06);
    for(const side of [-1,1]){
      const shard=addMesh(new THREE.OctahedronGeometry(.28,1),eyeMat,side*.44,1.25,.02);
      shard.rotation.z=side*.35;
      const wing=addMesh(new THREE.ConeGeometry(.27,1.1,6),voidMat,side*.67,1.5,.16);
      wing.rotation.z=side*(Math.PI*.36);
      addMesh(new THREE.SphereGeometry(.07,12,8),eyeMat,side*.13,1.84,-.31);
    }
  } else {
    // Predador ágil com carapaça, espinhos nas costas e garras.
    const hide = matBody(phase === 2 ? 0x385d66 : 0x51465d, .66, .12);
    addMesh(new THREE.SphereGeometry(.48,16,12),hide,0,.87,0,1.05,.85,1.25);
    addMesh(new THREE.SphereGeometry(.32,16,12),matBody(0x242432),0,1.45,-.2,1,.9,1);
    addMesh(new THREE.BoxGeometry(.12,.13,.24),eyeMat,-.13,1.48,-.48);
    addMesh(new THREE.BoxGeometry(.12,.13,.24),eyeMat,.13,1.48,-.48);
    for(const side of [-1,1]){
      const ear=addMesh(new THREE.ConeGeometry(.13,.48,5),hide,side*.22,1.82,-.08);
      ear.rotation.z=side*-.28;
      const arm=addMesh(new THREE.CapsuleGeometry(.12,.42,3,6),hide,side*.48,.95,-.02);
      arm.rotation.z=side*.42;
      const claw=addMesh(new THREE.ConeGeometry(.075,.3,5),bone,side*.56,.64,-.23);
      claw.rotation.x=Math.PI;
      addMesh(new THREE.ConeGeometry(.11,.38,5),bone,side*.2,1.13,.35);
      addMesh(new THREE.CapsuleGeometry(.13,.36,3,5),dark,side*.22,.35,.03);
    }
  }
  // Núcleo emissivo reforça a silhueta e dá a cada família uma leitura visual própria.
  const core = addMesh(new THREE.OctahedronGeometry(.14,1),eyeMat,0,1.12,-.40,.9,1.15,.65);
  core.rotation.set(.12,.2,.08);
  // Sombra/anel de identidade fixo no chão, sem pulsação.
  const ringColor = kind === 'brute' ? 0xff9c35 : kind === 'wraith' ? 0x63e9ff : kind === 'thorn' ? 0x8dff74 : kind === 'inferno' ? 0xff692e : kind === 'abyss' ? 0xc08bff : 0xff4269;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.48,.55,24),new THREE.MeshBasicMaterial({color:ringColor,transparent:true,opacity:.55,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2; ring.position.y=.025; g.add(ring);
  g.userData.kind=kind;
  g.userData.eyeMaterial=eyeMat;
  g.userData.coreMesh=core;
  g.userData.eyePulseOffset=Math.random()*Math.PI*2;
  g.userData.attackRing = ring;
  g.userData.ringColor = ringColor;
  g.userData.animatedLimbs = animatedLimbs;
  g.userData.walkPhase = Math.random() * Math.PI * 2;
  g.userData.lastX = undefined;
  g.userData.lastZ = undefined;
  g.userData.walking = false;
  g.userData.baseY = 0;
  attachHealthBar(g);
  return g;
}

let viewportResizeFrame = 0;
function onResize() {
  if (viewportResizeFrame) cancelAnimationFrame(viewportResizeFrame);
  viewportResizeFrame = requestAnimationFrame(() => {
    viewportResizeFrame = 0;
    const width = Math.max(1, Math.round(window.visualViewport?.width || window.innerWidth));
    const height = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight));
    if (renderer && camera) {
      const landscapeMobile = isMobileDevice && width > height;
      const previousLandscapeMobile = isMobileDevice && renderer.domElement.height > renderer.domElement.width;
      renderPixelRatioCap = getRenderPixelRatioCap(width, height);
      if (landscapeMobile !== previousLandscapeMobile) {
        adaptivePixelRatio = Math.min(devicePixelRatio || 1, renderPixelRatioCap);
      } else {
        adaptivePixelRatio = Math.max(getMinimumRenderPixelRatio(width, height), Math.min(adaptivePixelRatio, renderPixelRatioCap));
      }
      camera.aspect = width / height;
      camera.fov = isMobileDevice && height > width ? 76 : (isMobileDevice ? 66 : 62);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(adaptivePixelRatio);
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
    }
    placeSpellButtons();
  });
}
addEventListener('resize', onResize, { passive: true });
addEventListener('orientationchange', () => {
  // Android/browser can report the old viewport for a moment after rotation.
  setTimeout(onResize, 100);
  setTimeout(onResize, 320);
  setTimeout(onResize, 650);
}, { passive: true });
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize, { passive: true });

function setStatus(t) {
  menuStatus.textContent = t;
}

let connectionRequested = false, reconnectAttempts = 0, reconnectTimer = null, activeConnectCode = '';
let resumeToken = '';
try { resumeToken = sessionStorage.getItem('masmorraResumeToken') || ''; } catch {}

function connect(code = '', automaticRetry = false) {
  if (!automaticRetry) {
    connectionRequested = true;
    reconnectAttempts = 0;
    activeConnectCode = code || roomCode || '';
  }
  if (ws && ws.readyState === WebSocket.OPEN) { sendJoin(code); return; }
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    setStatus('Conectando ao servidor… aguarde um instante.');
    return;
  }
  if (!location.host) { setStatus('Abra pelo link do servidor online para jogar.'); return; }

  loading.classList.remove('hidden');
  $('loadingText').textContent = automaticRetry ? 'Reconectando à sala…' : 'Conectando ao servidor…';
  setStatus(automaticRetry ? 'A conexão caiu. Tentando voltar à sala…' : 'Conectando…');

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${proto}//${location.host}`);
  ws = socket;

  socket.addEventListener('open', () => {
    if (ws !== socket) return;
    sendJoin(activeConnectCode || code);
  });
  socket.addEventListener('message', e => {
    if (ws !== socket) return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handleMessage(m);
  });
  socket.addEventListener('error', () => {
    if (ws !== socket) return;
    setStatus('Falha de conexão. Vou tentar novamente automaticamente.');
  });
  socket.addEventListener('close', () => {
    if (ws !== socket) return;
    ws = null;
    if (!connectionRequested) { loading.classList.add('hidden'); return; }

    if (started) {
      started = false;
      hud.classList.add('hidden');
    }
    // Continua tentando enquanto o jogador não sair manualmente; o intervalo cresce até 15 s.
    reconnectAttempts++;
    const delay = Math.min(1000 * (2 ** Math.min(reconnectAttempts - 1, 4)), 15000);
    loading.classList.remove('hidden');
    $('loadingText').textContent = 'Reconectando… tentativa ' + reconnectAttempts;
    setStatus('Conexão interrompida. Nova tentativa em ' + Math.ceil(delay / 1000) + ' s.');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      if (connectionRequested) connect(roomCode || activeConnectCode || code, true);
    }, delay);
  });
}

const classDescriptions = {
  knight: 'Cavaleiro: muita vida, boa defesa e golpes confiáveis.',
  mage: 'Mago: pouca vida, mas feitiços poderosos em área.',
  archer: 'Arqueiro: ataque rápido e grande alcance.',
  goblin: 'Goblin: pequeno, veloz e especialista em ataques rápidos.',
  ogre: 'Ogro: enorme, resistente e lento, com golpes devastadores.',
  healer: 'Curandeiro: 100 de vida, cajado à distância, cura e espíritos guardiões.',
  necromancer: 'Necromante: 90 de vida, cajado sombrio e esqueletos aliados.',
  monk: 'Monge: 110 de vida, combo de três golpes, atordoamento e mobilidade.'
};
let selectedClass = 'knight';
let selectedSkin = 'default';
let skillPoints = 5;
const unlockedSkills = new Set();
let lastSkillSignature = '';
const SKILL_BRANCHES = [
  { id:'attack', title:'⚔ ATAQUE', skills:[
    {id:'mighty_blows',icon:'⚔',name:'Golpes poderosos',desc:'+1 dano base.'},
    {id:'swift_hands',icon:'💨',name:'Mãos velozes',desc:'Ataques mais rápidos.',req:'mighty_blows'},
    {id:'executioner',icon:'☠',name:'Executor',desc:'+2 dano contra inimigos fracos.',req:'swift_hands'},
    {id:'boss_hunter',icon:'👑',name:'Caçador de chefes',desc:'+50% dano contra chefes.',req:'executioner'},
    {id:'longshot',icon:'🏹',name:'Mira distante',desc:'Mais alcance no ataque.',req:'boss_hunter'}
  ]},
  { id:'defense', title:'🛡 DEFESA', skills:[
    {id:'vitality',icon:'♥',name:'Vitalidade',desc:'+25 de vida máxima.'},
    {id:'iron_skin',icon:'🛡',name:'Pele de ferro',desc:'Recebe 20% menos dano.',req:'vitality'},
    {id:'regeneration',icon:'✚',name:'Regeneração',desc:'Recupera 2 de vida a cada 3 s.',req:'iron_skin'},
    {id:'second_wind',icon:'🌟',name:'Segunda chance',desc:'Uma vez, sobrevive a um golpe fatal.',req:'regeneration'},
    {id:'party_guard',icon:'🤝',name:'Guarda em grupo',desc:'Recebe menos dano perto de aliado.',req:'second_wind'}
  ]},
  { id:'arcane', title:'✦ MAGIA & TESOUROS', skills:[
    {id:'arcane_mastery',icon:'🔮',name:'Maestria arcana',desc:'+50% de poder mágico.'},
    {id:'ember_core',icon:'🔥',name:'Núcleo de brasa',desc:'Fogo mais forte e queimadura maior.',req:'arcane_mastery'},
    {id:'storm_bond',icon:'⚡',name:'Vínculo da tempestade',desc:'Raio salta para mais inimigos.',req:'ember_core'},
    {id:'treasure_luck',icon:'💎',name:'Sorte do tesouro',desc:'Maior chance de loot.',req:'storm_bond'},
    {id:'swift_step',icon:'👟',name:'Passo veloz',desc:'Movimento mais rápido.',req:'treasure_luck'}
  ]},
  { id:'mobility', title:'💨 MOBILIDADE', skills:[
    {id:'dodge_mastery',icon:'↗',name:'Esquiva treinada',desc:'Esquiva mais longa e segura.'},
    {id:'quick_recovery',icon:'⏱',name:'Recuperação rápida',desc:'Reduz a recarga da esquiva.',req:'dodge_mastery'},
    {id:'hunter_instinct',icon:'🐾',name:'Instinto caçador',desc:'+1 dano base adicional.',req:'quick_recovery'},
    {id:'battle_focus',icon:'🎯',name:'Foco de batalha',desc:'Ataques básicos mais rápidos.',req:'hunter_instinct'},
    {id:'phantom_step',icon:'👻',name:'Passo fantasma',desc:'Avança mais e amplia a proteção.',req:'battle_focus'}
  ]},
  { id:'support', title:'✚ SUPORTE', skills:[
    {id:'healing_aura',icon:'💚',name:'Aura curativa',desc:'Cura aliados próximos com o tempo.'},
    {id:'loot_sense',icon:'🧭',name:'Sentido de loot',desc:'Aumenta a chance de encontrar itens.',req:'healing_aura'},
    {id:'mana_surge',icon:'✨',name:'Surto arcano',desc:'+25% de dano mágico.',req:'loot_sense'},
    {id:'team_resolve',icon:'🤝',name:'União resistente',desc:'Menor dano perto dos aliados.',req:'mana_surge'},
    {id:'final_blessing',icon:'🌠',name:'Bênção final',desc:'+15 de vida máxima.',req:'team_resolve'}
  ]}
];
function renderSkillTrees() {
  const allSkills = SKILL_BRANCHES.flatMap(branch => branch.skills.map(skill => ({...skill, branch:branch.id})));
  const activeBranches = new Set(allSkills.filter(skill => unlockedSkills.has(skill.id)).map(skill => skill.branch));
  const activeCount = unlockedSkills.size;
  const html = SKILL_BRANCHES.map(branch =>
    '<section class="skill-branch"><div class="skill-branch-title">' + branch.title + '</div><div class="skill-branch-list">' +
    branch.skills.map(skill => {
      const unlocked = unlockedSkills.has(skill.id);
      const available = !skill.req || unlockedSkills.has(skill.req);
      const branchAllowed = activeBranches.has(branch.id) || activeBranches.size < 3;
      const canBuy = !unlocked && available && skillPoints > 0 && activeCount < 15 && branchAllowed;
      const required = skill.req ? allSkills.find(item => item.id === skill.req)?.name : '';
      const state = unlocked ? 'DESBLOQUEADA ✓' :
        activeCount >= 15 ? 'LIMITE: 15 SKILLS' :
        !branchAllowed ? 'LIMITE: 3 RAMOS' :
        !available ? 'REQUER: ' + (required || 'talento anterior') :
        skillPoints > 0 ? 'DESBLOQUEAR · 1 PONTO' : 'SEM PONTOS';
      return '<button type="button" class="skill-node ' + (unlocked?'unlocked':canBuy?'available':'locked') + '" data-skill="' + skill.id + '"' + (canBuy?'':' disabled') + '><span class="skill-node-top"><span class="skill-node-icon">' + skill.icon + '</span>' + skill.name + '</span><small>' + skill.desc + '</small><span class="skill-node-state">' + state + '</span></button>';
    }).join('') + '</div></section>'
  ).join('');
  const lobbyTree = $('skillTreeLobby'), hudTree = $('skillTreeHud');
  if (lobbyTree) lobbyTree.innerHTML = html;
  if (hudTree) hudTree.innerHTML = html;
  if ($('skillPoints')) $('skillPoints').textContent = String(skillPoints);
  if ($('skillPointsHud')) $('skillPointsHud').textContent = String(skillPoints);
  if ($('skillCountLobby')) $('skillCountLobby').textContent = activeCount + '/15';
  if ($('skillCountHud')) $('skillCountHud').textContent = activeCount + '/15';
  if ($('skillBranchCountLobby')) $('skillBranchCountLobby').textContent = activeBranches.size + '/3';
  if ($('skillBranchCountHud')) $('skillBranchCountHud').textContent = activeBranches.size + '/3';
}
function syncLoadoutUI() {
  const signature = selectedClass + '|' + selectedSkin + '|' + skillPoints + '|' + Array.from(unlockedSkills).sort().join(',');
  if (signature === lastSkillSignature) return;
  lastSkillSignature = signature;
  renderSkillTrees();
}
function sendLoadout() {
  if (ws && ws.readyState === WebSocket.OPEN && playerId) {
    send({ type:'loadout', playerClass:selectedClass, skin:selectedSkin, skills:Array.from(unlockedSkills) });
  } else if (started && !ws) {
    showNotice('Reconectando: aguarde para sincronizar suas skills.');
  }
}
function refreshLocalHeroAppearance() {
  if (!myPlayer || started) return;
  const position = myPlayer.position.clone();
  const hp = myPlayer.userData.serverHp ?? 100;
  scene.remove(myPlayer);
  disposeObject3D(myPlayer);
  myPlayer = makeHero(null, selectedClass, selectedSkin);
  myPlayer.position.copy(position);
  myPlayer.userData.serverHp = hp;
  scene.add(myPlayer);
}
function chooseClass(className) {
  if (!classDescriptions[className]) return;
  selectedClass = className;
  document.querySelectorAll('.class-card').forEach(el => el.classList.toggle('selected', el.dataset.class === selectedClass));
  if ($('classDescription')) $('classDescription').textContent = classDescriptions[selectedClass];
  updateHeroShowcase();
  refreshLocalHeroAppearance();
  sendLoadout();
  closeLobbyEditor();
}
document.querySelectorAll('.class-card').forEach(card => card.addEventListener('click', () => chooseClass(card.dataset.class)));
function chooseSkin(skinName) {
  if (!['default','shadow','ember','rune','celestial','bloodmoon'].includes(skinName)) return;
  selectedSkin = skinName;
  document.querySelectorAll('.skin-pick').forEach(el => el.classList.toggle('selected', el.dataset.skin === selectedSkin));
  updateHeroShowcase();
  refreshLocalHeroAppearance();
  sendLoadout();
  closeLobbyEditor();
}
document.querySelectorAll('.skin-pick').forEach(card => card.addEventListener('click', () => chooseSkin(card.dataset.skin)));
function updateHeroShowcase() {
  const classInfo = {
    knight:{name:'Cavaleiro',glyph:'🛡️',desc:'Vida elevada · defesa natural · espada'},
    mage:{name:'Mago',glyph:'🔮',desc:'Magia fortalecida · cajado arcano'},
    archer:{name:'Arqueiro',glyph:'🏹',desc:'Ataque rápido · alcance maior'},
    goblin:{name:'Goblin',glyph:'👺',desc:'Ágil · duas adagas · esquiva rápida'},
    ogre:{name:'Ogro',glyph:'👹',desc:'Tanque · clava pesada · dano alto'},
    healer:{name:'Curandeiro',glyph:'🌿',desc:'Cajado à distância · cura e espíritos guardiões'},
    necromancer:{name:'Necromante',glyph:'💀',desc:'Cajado sombrio · horda de esqueletos'},
    monk:{name:'Monge',glyph:'🥋',desc:'Combo de três golpes · impacto e mobilidade'}
  }[selectedClass] || {name:'Cavaleiro',glyph:'🛡️',desc:'Defesa elevada'};
  const skinInfo = {default:{label:'SKIN CLÁSSICA',cls:'skin-default'},shadow:{label:'SKIN SOMBRA',cls:'skin-shadow'},ember:{label:'SKIN BRASA',cls:'skin-ember'},rune:{label:'SKIN RUNAS',cls:'skin-rune'},celestial:{label:'SKIN CELESTIAL',cls:'skin-celestial'},bloodmoon:{label:'SKIN LUA SANGRENTA',cls:'skin-bloodmoon'}}[selectedSkin] || {label:'SKIN CLÁSSICA',cls:'skin-default'};
  const avatar=$('heroPreviewAvatar');
  if(avatar){avatar.className='hero-preview-avatar '+skinInfo.cls+' class-'+selectedClass;}
  if($('heroPreviewGlyph')) $('heroPreviewGlyph').textContent=classInfo.glyph;
  if($('heroPreviewName')) $('heroPreviewName').textContent=classInfo.name;
  if($('heroPreviewDesc')) $('heroPreviewDesc').textContent=classInfo.desc;
  if($('heroPreviewSkin')) $('heroPreviewSkin').textContent=skinInfo.label;
  if($('lobbyClassCurrent')) $('lobbyClassCurrent').textContent=classInfo.name.toUpperCase();
  document.querySelectorAll('.skin-pick').forEach(el=>el.classList.toggle('selected',el.dataset.skin===selectedSkin));
  refreshLobby3DPreview();
}

function buildLobbyStageBackdrop() {
  const stone = new THREE.MeshStandardMaterial({color:0x142536, metalness:.52, roughness:.38});
  const trim = new THREE.MeshStandardMaterial({color:0xd2b16a, metalness:.72, roughness:.28, emissive:0x50380d, emissiveIntensity:.28});
  const glow = new THREE.MeshStandardMaterial({color:0x62ddff, emissive:0x138fc9, emissiveIntensity:1.35, metalness:.28, roughness:.24});
  const column = new THREE.CylinderGeometry(.105,.17,2.75,9);
  const cap = new THREE.CylinderGeometry(.22,.22,.13,10);
  const base = new THREE.CylinderGeometry(.24,.28,.15,10);
  for (const side of [-1,1]) {
    const pillar = new THREE.Mesh(column,stone); pillar.position.set(side*1.25,1.22,-1.02); lobbyPreviewScene.add(pillar);
    const pillarBase = new THREE.Mesh(base,trim); pillarBase.position.set(side*1.25,.10,-1.02); lobbyPreviewScene.add(pillarBase);
    const pillarCap = new THREE.Mesh(cap,trim); pillarCap.position.set(side*1.25,2.62,-1.02); lobbyPreviewScene.add(pillarCap);
    const light = new THREE.Mesh(new THREE.OctahedronGeometry(.105,1),glow); light.position.set(side*1.25,2.82,-.99); lobbyPreviewScene.add(light);
    const sideRune = new THREE.Mesh(new THREE.TorusGeometry(.18,.014,5,20),glow);
    sideRune.position.set(side*1.25,1.82,-.88); sideRune.scale.set(.72,1.35,1); lobbyPreviewScene.add(sideRune);
  }
  const outerPortal = new THREE.Mesh(new THREE.TorusGeometry(1.24,.055,8,56),glow);
  outerPortal.position.set(0,1.34,-1.24); outerPortal.scale.set(.98,1.22,1); lobbyPreviewScene.add(outerPortal);
  const innerPortal = new THREE.Mesh(new THREE.TorusGeometry(1.08,.018,5,48),trim);
  innerPortal.position.set(0,1.34,-1.20); innerPortal.scale.set(.98,1.22,1); lobbyPreviewScene.add(innerPortal);
  const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.38,3.0),
    new THREE.MeshBasicMaterial({color:0x08131f,transparent:true,opacity:.34,depthWrite:false}));
  backPanel.position.set(0,1.38,-1.30); lobbyPreviewScene.add(backPanel);
  const upperCrest = new THREE.Mesh(new THREE.OctahedronGeometry(.18,1),trim);
  upperCrest.position.set(0,2.80,-1.10); upperCrest.rotation.z=Math.PI/4; lobbyPreviewScene.add(upperCrest);
  lobbyPreviewCrystals = new THREE.Group();
  const crystalGeo = new THREE.OctahedronGeometry(.12,1);
  const palettes = [
    new THREE.MeshStandardMaterial({color:0x70e8ff,emissive:0x28cfff,emissiveIntensity:1.25,metalness:.18,roughness:.24}),
    new THREE.MeshStandardMaterial({color:0xb6a1ff,emissive:0x7958ff,emissiveIntensity:1.2,metalness:.18,roughness:.24}),
    new THREE.MeshStandardMaterial({color:0x80ffbd,emissive:0x2dd987,emissiveIntensity:1.1,metalness:.18,roughness:.24})
  ];
  for (let i=0;i<6;i++) {
    const crystal=new THREE.Mesh(crystalGeo,palettes[i%palettes.length]);
    crystal.userData.phase=i*1.17; crystal.userData.baseY=.63+(i%3)*.62;
    crystal.userData.baseX=(i%2===0?-1:1)*(1.04+(i%3)*.09); crystal.userData.baseZ=-.20-(i%3)*.31;
    crystal.position.set(crystal.userData.baseX,crystal.userData.baseY,crystal.userData.baseZ);
    crystal.rotation.set(.25*i,.45*i,.18*i); crystal.scale.set(.7+(i%3)*.15,1.05+(i%2)*.20,.72+(i%3)*.08);
    lobbyPreviewCrystals.add(crystal);
  }
  lobbyPreviewScene.add(lobbyPreviewCrystals);
}

function initLobby3DPreview() {
  if (lobbyPreviewScene || !renderer) return;
  lobbyPreviewScene = new THREE.Scene();
  lobbyPreviewScene.background = null;
  lobbyPreviewCamera = new THREE.PerspectiveCamera(38, 0.62, 0.1, 50);
  lobbyPreviewCamera.position.set(0, 1.56, 5.55);
  lobbyPreviewCamera.lookAt(0, 1.32, 0);
  lobbyPreviewScene.add(new THREE.HemisphereLight(0xe3f6ff, 0x263448, 2.5));
  const keyLight = new THREE.DirectionalLight(0xffe5b0, 3.0);
  keyLight.position.set(-3.8, 6, 4.5); lobbyPreviewScene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x63ccff, 2.2);
  fillLight.position.set(4, 3, 2.5); lobbyPreviewScene.add(fillLight);
  const rimLight = new THREE.PointLight(0x4fcfff, 8, 10, 2);
  rimLight.position.set(0, 2.5, -1.3); lobbyPreviewScene.add(rimLight);
  buildLobbyStageBackdrop();
  const baseMaterial = new THREE.MeshStandardMaterial({color:0x132638,metalness:0.55,roughness:0.35,emissive:0x10384a,emissiveIntensity:0.55});
  lobbyPreviewPlatform = new THREE.Mesh(new THREE.CylinderGeometry(0.78,0.88,0.13,36),baseMaterial);
  lobbyPreviewPlatform.position.y = -0.105; lobbyPreviewScene.add(lobbyPreviewPlatform);
  lobbyPreviewRing = new THREE.Mesh(new THREE.TorusGeometry(0.82,0.025,7,48),new THREE.MeshBasicMaterial({color:0x80eaff,transparent:true,opacity:.9}));
  lobbyPreviewRing.position.y = -0.025; lobbyPreviewScene.add(lobbyPreviewRing);
  // Efeito de classe leve: partículas reaproveitadas e runas orbitais, sem criar objetos por frame.
  lobbyPreviewParticles = new THREE.Group();
  for (let i=0;i<18;i++) {
    const particle = new THREE.Mesh(new THREE.SphereGeometry(i%4===0?.035:.019,6,5),new THREE.MeshBasicMaterial({color:0x75eaff,transparent:true,opacity:.72}));
    particle.userData.phase = i * 0.91;
    particle.userData.radius = .68 + (i%5)*.095;
    particle.userData.height = .22 + (i%6)*.31;
    lobbyPreviewParticles.add(particle);
  }
  lobbyPreviewScene.add(lobbyPreviewParticles);
  lobbyPreviewRunes = new THREE.Group();
  for (let i=0;i<3;i++) {
    const rune = new THREE.Mesh(new THREE.TorusGeometry(.94+i*.13,.009,4,40),new THREE.MeshBasicMaterial({color:0x6de8ff,transparent:true,opacity:.3-i*.055}));
    rune.rotation.x = Math.PI/2 + i*.18;
    rune.position.y = .015 + i*.012;
    lobbyPreviewRunes.add(rune);
  }
  lobbyPreviewScene.add(lobbyPreviewRunes);
  refreshLobby3DPreview();
}
function refreshLobby3DPreview() {
  if (!lobbyPreviewScene) return;
  if (lobbyPreviewHero) { lobbyPreviewScene.remove(lobbyPreviewHero); disposeObject3D(lobbyPreviewHero); lobbyPreviewHero = null; }
  lobbyPreviewHero = makeHero(null, selectedClass || 'knight', selectedSkin || 'default');
  lobbyPreviewHero.scale.setScalar(1.24);
  lobbyPreviewHero.position.set(0,0,0);
  lobbyPreviewHero.rotation.y = Math.PI;
  if (lobbyPreviewHero.userData.healthBar) lobbyPreviewHero.userData.healthBar.visible = false;
  lobbyPreviewScene.add(lobbyPreviewHero);
}
function renderLobby3DPreview() {
  if (!renderer || !lobbyPreviewScene || !lobbyPreviewCamera || !lobbyPreviewHero) return;
  const lobbyVisible = !started && $('lobby') && !$('lobby').classList.contains('hidden');
  if (!lobbyVisible) return;
  const width = renderer.domElement.clientWidth || innerWidth;
  const height = renderer.domElement.clientHeight || innerHeight;
  if (width < 2 || height < 2) return;
  const portrait = height >= width;
  const previewWidth = Math.max(1,Math.floor(portrait ? Math.min(width*0.72,410) : Math.min(width*0.48,640)));
  const previewHeight = Math.max(1,Math.floor(portrait ? Math.min(height*0.48,760) : Math.min(height*0.70,600)));
  // Enquadra o avatar um pouco mais abaixo para abrir espaço visual no topo do lobby.
  const centerTop = Math.floor(height*(portrait ? 0.49 : 0.50));
  const left = Math.floor((width-previewWidth)/2);
  const top = Math.max(0,Math.min(height-previewHeight,centerTop-Math.floor(previewHeight/2)));
  const bottom = height-top-previewHeight;
  const time = clock ? clock.elapsedTime : 0;
  lobbyPreviewHero.rotation.y = Math.PI + Math.sin(time*0.32)*0.12;
  const heroClass = lobbyPreviewHero.userData.heroClass || selectedClass || 'knight';
  const idle = time * (heroClass === 'mage' ? 1.35 : heroClass === 'archer' ? 1.7 : 1.05);
  const breath = Math.sin(idle) * 0.018;
  lobbyPreviewHero.position.y = Math.sin(time*1.25)*0.025 + breath;
  if (lobbyPreviewHero.userData.torso) {
    lobbyPreviewHero.userData.torso.rotation.z = heroClass === 'archer'
      ? Math.sin(idle * 0.55) * 0.012
      : Math.sin(idle * 0.65) * (heroClass === 'mage' ? 0.018 : 0.008);
  }
  if (lobbyPreviewHero.userData.head) {
    lobbyPreviewHero.userData.head.rotation.x = heroClass === 'mage'
      ? Math.sin(idle * 0.7) * 0.035
      : Math.sin(idle * 0.45) * 0.012;
    lobbyPreviewHero.userData.head.rotation.y = heroClass === 'archer'
      ? Math.sin(idle * 0.4) * 0.055
      : Math.sin(idle * 0.3) * 0.018;
  }
  for (const leg of lobbyPreviewHero.userData.legs || []) {
    leg.mesh.rotation.x = Math.sin(idle * 0.7 + (leg.side > 0 ? Math.PI : 0)) * (heroClass === 'archer' ? 0.035 : 0.012);
  }
  for (const arm of lobbyPreviewHero.userData.arms || []) {
    if (heroClass === 'knight') {
      arm.mesh.rotation.x = Math.sin(idle * 0.6 + (arm.side > 0 ? Math.PI : 0)) * 0.025;
      arm.mesh.rotation.z = arm.side > 0 ? -0.12 : 0.12;
    } else if (heroClass === 'mage') {
      arm.mesh.rotation.x = Math.sin(idle * 0.9 + (arm.side > 0 ? Math.PI : 0)) * 0.055;
      arm.mesh.rotation.z = arm.side > 0 ? -0.1 : 0.1;
    } else {
      arm.mesh.rotation.x = Math.sin(idle * 0.75 + (arm.side > 0 ? Math.PI : 0)) * 0.04;
      arm.mesh.rotation.z = arm.side > 0 ? -0.18 : 0.08;
    }
  }
  if (lobbyPreviewHero.userData.sword) {
    const weapon = lobbyPreviewHero.userData.sword;
    if (heroClass === 'mage') {
      weapon.rotation.z = -0.12 + Math.sin(idle * 0.85) * 0.045;
      weapon.rotation.y = Math.sin(idle * 0.5) * 0.06;
    } else if (heroClass === 'archer') {
      weapon.rotation.z = -0.18 + Math.sin(idle * 0.7) * 0.025;
      weapon.rotation.y = Math.sin(idle * 0.45) * 0.035;
    } else {
      weapon.rotation.z = -0.25 + Math.sin(idle * 0.6) * 0.018;
    }
  }
  if (lobbyPreviewHero.userData.cape) {
    lobbyPreviewHero.userData.cape.rotation.x = heroClass === 'mage'
      ? -0.08 + Math.sin(idle * 0.8) * 0.055
      : -0.08 + Math.sin(idle * 0.55) * 0.025;
    lobbyPreviewHero.userData.cape.rotation.z = Math.sin(idle * 0.4) * 0.018;
  }
  if (lobbyPreviewHero.userData.capeTails) {
    const tails=lobbyPreviewHero.userData.capeTails;
    if (tails[0]) tails[0].rotation.z=.10+Math.sin(idle*.7)*.035;
    if (tails[1]) tails[1].rotation.z=-.10+Math.sin(idle*.7+Math.PI)*.035;
  }
  const effectPalette = heroClass === 'mage'
    ? {color:0xb49aff,glow:0x8064ff}
    : heroClass === 'archer'
      ? {color:0x8cffb0,glow:0x42d985}
      : heroClass === 'goblin'
        ? {color:0xc7ff7a,glow:0x63b448}
        : heroClass === 'ogre'
          ? {color:0xffbe7c,glow:0xb56d3e}
          : heroClass === 'healer'
            ? {color:0xa2ffe4,glow:0x37c99a}
            : heroClass === 'necromancer'
              ? {color:0xd4afff,glow:0x8b4fcd}
              : heroClass === 'monk'
                ? {color:0xffd99b,glow:0xd7a05b}
                : {color:0x8beaff,glow:0x3ebee8};
  if (lobbyPreviewRing) {
    lobbyPreviewRing.material.color.setHex(effectPalette.color);
    lobbyPreviewRing.material.opacity = .72 + Math.sin(time*2.2)*.18;
    lobbyPreviewRing.scale.setScalar(1 + Math.sin(time*1.5)*.025);
  }
  if (lobbyPreviewRunes) {
    lobbyPreviewRunes.rotation.y = time * (heroClass === 'mage' ? .24 : heroClass === 'archer' ? -.13 : .09);
    lobbyPreviewRunes.children.forEach((rune,index)=>{
      rune.material.color.setHex(effectPalette.glow);
      rune.material.opacity = .2 + (Math.sin(time*1.7+index*1.8)+1)*.1;
    });
  }
  if (lobbyPreviewParticles) {
    lobbyPreviewParticles.children.forEach((particle,index)=>{
      const phase = particle.userData.phase + time*(heroClass === 'mage' ? .7 : heroClass === 'archer' ? -.45 : .32);
      const radius = particle.userData.radius + Math.sin(time*1.1+index)*.045;
      particle.position.set(Math.cos(phase)*radius,particle.userData.height+Math.sin(phase*1.4)*.12,Math.sin(phase)*radius*.42);
      particle.material.color.setHex(effectPalette.color);
      particle.material.opacity = .25 + (Math.sin(phase*1.7)+1)*.25;
    });
  }
  if (lobbyPreviewCrystals) {
    lobbyPreviewCrystals.children.forEach((crystal,index)=>{
      const phase=crystal.userData.phase;
      crystal.position.y=crystal.userData.baseY+Math.sin(time*1.15+phase)*.09;
      crystal.position.x=crystal.userData.baseX+Math.sin(time*.55+phase)*.035;
      crystal.rotation.y=time*.42+phase;
      crystal.rotation.x=.2+Math.sin(time*.7+phase)*.08;
    });
  }
  lobbyPreviewCamera.aspect = previewWidth/previewHeight;
  lobbyPreviewCamera.position.z = portrait ? 5.55 : 5.8;
  lobbyPreviewCamera.updateProjectionMatrix();
  lobbyPreviewCamera.lookAt(0,1.32,0);
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.setViewport(left,bottom,previewWidth,previewHeight);
  renderer.setScissor(left,bottom,previewWidth,previewHeight);
  renderer.clearDepth();
  renderer.render(lobbyPreviewScene,lobbyPreviewCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0,0,width,height);
  renderer.autoClear = true;
}
function handleSkillClick(event) {
  const button = event.target.closest('[data-skill]');
  if (!button || button.disabled) return;
  const skill = SKILL_BRANCHES.flatMap(branch => branch.skills).find(item => item.id === button.dataset.skill);
  const branch = SKILL_BRANCHES.find(item => item.skills.some(entry => entry.id === skill?.id));
  const activeBranches = new Set(SKILL_BRANCHES.filter(item => item.skills.some(entry => unlockedSkills.has(entry.id))).map(item => item.id));
  if (!skill || !branch || unlockedSkills.size >= 15 || unlockedSkills.has(skill.id) || skillPoints < 1 ||
      (skill.req && !unlockedSkills.has(skill.req)) ||
      (!activeBranches.has(branch.id) && activeBranches.size >= 3)) {
    showNotice(unlockedSkills.size >= 15 ? 'Limite de 15 skills atingido.' : 'Você pode desenvolver no máximo 3 ramos da árvore.');
    return;
  }
  unlockedSkills.add(skill.id);
  skillPoints--;
  lastSkillSignature = '';
  syncLoadoutUI();
  sendLoadout();
}
$('skillTreeLobby')?.addEventListener('click', handleSkillClick);
$('skillTreeHud')?.addEventListener('click', handleSkillClick);
$('skillToggleBtn')?.addEventListener('click', () => {
  const panel = $('skillPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderSkillTrees();
});
$('skillCloseBtn')?.addEventListener('click', () => $('skillPanel')?.classList.add('hidden'));
syncLoadoutUI();
updateHeroShowcase();

let joiningPublicRoom = false;
let quickMatchRequested = false;
function sendJoin(code) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  activeConnectCode = code || activeConnectCode || roomCode || '';
  send({
    type: quickMatchRequested ? 'joinPublic' : 'join',
    resumeToken,
    name: $('playerName').value.trim() || 'Aventureiro',
    class: selectedClass,
    skin: selectedSkin,
    skills: Array.from(unlockedSkills),
    talentPoints: skillPoints,
    code,
    public: joiningPublicRoom
  });
  joiningPublicRoom = false;
  quickMatchRequested = false;
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: 'ping', sentAt: performance.now() });
  }
}, 5000);

function addClassAbilityRing(x, z, radius, color) {
  if (!scene || !Number.isFinite(x) || !Number.isFinite(z)) return;
  const geometry = new THREE.RingGeometry(Math.max(.25, radius - .22), radius, 28);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, .09, z);
  scene.add(ring);
  const limit = isMobileDevice ? 7 : 14;
  while (activeClassEffects.length >= limit) {
    const old = activeClassEffects.shift();
    scene.remove(old.mesh); old.mesh.geometry.dispose(); old.mesh.material.dispose();
  }
  activeClassEffects.push({ mesh: ring, startedAt: performance.now(), duration: 760 });
}
function handleClassAbilityMessage(m) {
  const colors = {
    knight_shield: 0x79caff, knight_dash: 0xe9c477, arrow_rain: 0x9ccfff,
    incendiary_arrows: 0xff632b, goblin_invis: 0x9c8cff, goblin_summon: 0x7ce36c,
    ogre_slam: 0xff9d4a, ogre_haste: 0xffd86e,
    healer_cure: 0x70ffd1, healer_guardian_spirits: 0x8cffe8,
    necromancer_summon: 0xa77bdb, necromancer_dive: 0xb4a0e8, necromancer_dive_arrive: 0xb4a0e8,
    monk_impact_palm: 0xffcc78, monk_winged_steps: 0xe9c58c
  };
  const radii = {
    knight_shield: 1.4, knight_dash: 3.8, arrow_rain: 4.6,
    incendiary_arrows: 4.1, goblin_invis: 1.5, goblin_summon: 2.1,
    ogre_slam: 5.2, ogre_haste: 1.7,
    healer_cure: 3.8, healer_guardian_spirits: 7,
    necromancer_summon: 3.2, necromancer_dive: 1.9, necromancer_dive_arrive: 2.8,
    monk_impact_palm: 4.2, monk_winged_steps: 2.6
  };
  const center = m.center || { x: m.x, z: m.z };
  addClassAbilityRing(center.x, center.z, radii[m.ability] || 2.5, colors[m.ability] || 0x76e7f2);
  (m.targets || []).slice(0, isMobileDevice ? 3 : 7).forEach(target => {
    if (m.ability === 'arrow_rain' || m.ability === 'incendiary_arrows' || m.ability === 'ogre_slam' || m.ability === 'knight_dash') {
      addClassAbilityRing(target.x, target.z, .85, colors[m.ability] || 0x76e7f2);
    }
  });
  if (m.id === playerId) {
    const spec = Object.values(CLASS_ABILITY_CONFIG).flat().find(item => item.ability === m.ability);
    if (spec) {
      if (m.ability === 'fire' || m.ability === 'lightning') return;
      if (CLASS_ABILITY_CONFIG[selectedClass]?.[0]?.ability === m.ability) fireCooldown = spec.cooldown;
      else if (CLASS_ABILITY_CONFIG[selectedClass]?.[1]?.ability === m.ability) lightningCooldown = spec.cooldown;
    }
    if (m.ability === 'ogre_haste') ogreHasteUntil = performance.now() + 5000;
    if (m.ability === 'necromancer_dive') {
      necromancerDivePendingClient = true;
      clearTimeout(necromancerDiveClientTimer);
      necromancerDiveClientTimer = setTimeout(() => {
        necromancerDivePendingClient = false;
        showNotice('O tempo do Mergulho acabou.');
      }, 5000);
    }
    if (m.ability === 'necromancer_dive_arrive') {
      necromancerDivePendingClient = false;
      clearTimeout(necromancerDiveClientTimer);
    }
    if (m.ability === 'knight_shield' && myPlayer) setHeroShielded(myPlayer, true);
    if (m.ability === 'knight_dash' && myPlayer && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      myPlayer.position.set(m.x, 0, m.z);
    }
  }
  showNotice(m.text || 'Habilidade ativada!');
  if (m.ability === 'incendiary_arrows' || m.ability === 'ogre_slam') playSfx('attack');
  else if (m.ability === 'knight_dash') playSfx('dodge');
  else playSfx('fire');
  if (m.ability === 'goblin_invis' && m.id === playerId && myPlayer) setHeroInvisible(myPlayer, true);
}
function handleMessage(m) {
  if (m.type === 'pong') {
    if (Number.isFinite(m.sentAt)) measuredPing = Math.max(0, Math.round(performance.now() - m.sentAt));
    return;
  }
  if (m.type === 'error') {
    loading.classList.add('hidden');
    setStatus(m.message);
    return;
  }

  if (m.type === 'publicRooms') {
    const list = $('publicRoomsList');
    if (!list) return;
    list.replaceChildren();
    if (!m.rooms || !m.rooms.length) {
      const p = document.createElement('p');
      p.textContent = 'Nenhuma sala aberta. Você pode abrir uma agora:';
      list.appendChild(p);
      const create = document.createElement('button');
      create.type = 'button';
      create.textContent = 'CRIAR SALA PÚBLICA';
      create.addEventListener('click', () => send({ type: 'joinPublic' }));
      list.appendChild(create);
    } else {
      for (const room of m.rooms) {
        const row = document.createElement('div');
        row.className = 'public-room-row';
        const info = document.createElement('span');
        info.textContent = 'Sala pública · ' + room.players + '/' + room.maxPlayers;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'ENTRAR';
        btn.addEventListener('click', () => { joiningPublicRoom = true; connect(room.code); });
        row.append(info, btn);
        list.appendChild(row);
      }
    }
    return;
  }

  if (m.type === 'joined') {
    playerId = m.id;
    if (typeof m.resumeToken === 'string' && m.resumeToken) {
      resumeToken = m.resumeToken;
      try { sessionStorage.setItem('masmorraResumeToken', resumeToken); } catch {}
    }
    roomCode = m.room;
    activeConnectCode = m.room;
    appliedInitialServerPosition = false;
    connectionRequested = true;
    reconnectAttempts = 0;
    clearTimeout(reconnectTimer);
    started = false;
    menu.classList.add('hidden');
    loading.classList.add('hidden');
    hud.classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('lobbyRoomCode').textContent = roomCode;
    $('roomLabel').textContent = roomCode;
    $('loadingText').textContent = '';
    showNotice(m.resumed ? 'Conexão recuperada! Você voltou à partida.' : 'Você entrou no lobby!');
    if (!m.resumed) sendLoadout();
    return;
  }

  if (m.type === 'inventory') {
    inventoryData = m.inventory || inventoryData;
    lootDrops = m.lootDrops || lootDrops;
    renderInventory();
    return;
  }

  if (m.type === 'loot') {
    vibrateGame([10,25,10]);
    playSfx('loot');
    showNotice('Loot: ' + m.item.name + ' · ' + m.item.rarity);
    renderInventory();
    return;
  }

  if (m.type === 'notice') {
    showNotice(m.text);
    if (/acertou você|foi derrotado/i.test(m.text)) {
      playSfx('damage');
      const f = $('hitFlash'); f.style.borderWidth = '7px'; f.style.borderColor = '#ff315d';
      setTimeout(() => { f.style.borderWidth = '0'; f.style.borderColor = ''; }, 220);
    }
    return;
  }

  if (m.type === 'monsterSpawn') {
    const obj = monsterMeshes.get(m.id);
    if (obj) { obj.visible = true; obj.scale.setScalar(0.05); obj.userData.spawnAnim = 0.35; }
    return;
  }

  if (m.type === 'monsterAttack') {
    const obj = monsterMeshes.get(m.id);
    if (obj) obj.userData.attackAnim = 0.38;
    return;
  }
  if (m.type === 'classAbility') {
    handleClassAbilityMessage(m);
    return;
  }
  if (m.type === 'spell') {
    const isFire = m.spell === 'fire';
    const color = isFire ? 0xff6b24 : 0x69aaff;
    const origin = new THREE.Vector3(m.x, 1.35, m.z);
    const reducedVisualLoad = isMobileDevice || (lastFps > 0 && lastFps < 42);
    const targets = (Array.isArray(m.targets) ? m.targets : []).slice(0, reducedVisualLoad ? 2 : 3);
    if (!targets.length) targets.push({ x: m.x - Math.sin(yaw) * 4, z: m.z - Math.cos(yaw) * 4 });
    let from = origin;
    for (const target of targets) {
      const end = new THREE.Vector3(target.x, isFire ? .85 : 1.15, target.z);
      const mid = new THREE.Vector3((from.x + end.x) / 2 + (isFire ? 0 : (Math.random() - .5) * 1.2), isFire ? 1.05 : 1.35, (from.z + end.z) / 2);
      const points = isFire ? [origin.clone(), end] : [from.clone(), mid, end];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const beamMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
      const beam = new THREE.Line(geo, beamMat); scene.add(beam);
      const impactGeo = isFire ? new THREE.ConeGeometry(.28, .72, 6) : new THREE.SphereGeometry(.2, 7, 5);
      const impactMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95 });
      const impact = new THREE.Mesh(impactGeo, impactMat);
      impact.position.copy(end); impact.position.y += isFire ? .35 : .15; scene.add(impact);
      const impactLimit = (isMobileDevice || (lastFps > 0 && lastFps < 42)) ? 6 : 12;
      while (activeImpactEffects.length >= impactLimit) disposeImpactEffect(activeImpactEffects.shift());
      activeImpactEffects.push({ beam, impact, geo, beamMat, impactGeo, impactMat, startedAt: performance.now(), duration: isFire ? 420 : 230, isFire });
      if (isFire) {
        const burnGroup = new THREE.Group();
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xff4b16, transparent: true, opacity: .9 });
        for (let i = 0; i < 3; i++) {
          const flame = new THREE.Mesh(new THREE.ConeGeometry(.12 + i * .025, .38 + i * .06, 5), flameMat);
          flame.position.set((i - 1) * .19, .22 + (i % 2) * .08, 0);
          burnGroup.add(flame);
        }
        burnGroup.position.set(target.x, .05, target.z);
        scene.add(burnGroup);
        const burnLimit = (isMobileDevice || (lastFps > 0 && lastFps < 42)) ? 2 : 6;
        while (activeBurnEffects.length >= burnLimit) {
          const oldBurn = activeBurnEffects.shift();
          scene.remove(oldBurn.group);
          oldBurn.group.children.forEach(flame => flame.geometry.dispose());
          oldBurn.material.dispose();
        }
        activeBurnEffects.push({ group: burnGroup, material: flameMat, expires: performance.now() + 3000, seed: Math.random() * 6 });
      }
      from = end;
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

  if (m.type === 'playerDamaged') {
    if (m.id === playerId) {
      const flash = $('hitFlash');
      flash.classList.remove('damage-flash');
      void flash.offsetWidth;
      flash.classList.add('damage-flash');
      vibrateGame(18);
    }
    return;
  }
  if (m.type === 'monsterWindup') {
    const monster = monsterMeshes.get(m.id);
    if (monster && monster.userData.attackRing) {
      const ring = monster.userData.attackRing;
      ring.material.color.set(0xff354f);
      ring.material.opacity = .95;
      setTimeout(() => {
        if (ring.material && monster.userData.ringColor !== undefined) {
          ring.material.color.set(monster.userData.ringColor);
          ring.material.opacity = .55;
        }
      }, Math.max(250, Number(m.duration) || 460));
    }
    if (m.targetId === playerId) showNotice('⚠ Golpe inimigo chegando — ESQUIVE!');
    return;
  }
  if (m.type === 'bossWindup') {
    $('bossPanel').classList.add('warning');
    setTimeout(() => $('bossPanel')?.classList.remove('warning'), Math.max(300, Number(m.duration) || 560));
    if (m.targetId === playerId) {
      showNotice('☠ O GUARDIÃO VAI ATACAR — ESQUIVE!');
      vibrateGame([18,35,18]);
    }
    return;
  }
  if (m.type === 'dodge') {
    if (m.id === playerId && myPlayer && Number.isFinite(m.x) && Number.isFinite(m.z)) {
      myPlayer.position.set(m.x, 0, m.z);
      myPlayer.userData.dodgeFlashUntil = performance.now() + 220;
    } else {
      const dodgingPlayer = remotePlayers.get(m.id);
      if (dodgingPlayer && Number.isFinite(m.x) && Number.isFinite(m.z)) {
        dodgingPlayer.userData.targetX = m.x;
        dodgingPlayer.userData.targetZ = m.z;
        dodgingPlayer.userData.dodgeFlashUntil = performance.now() + 220;
      }
    }
    return;
  }
  if (m.type === 'state') updateState(m);
}

function setHeroInvisible(hero, invisible) {
  if (!hero || hero.userData.invisibilityActive === !!invisible) return;
  hero.traverse(node => {
    if (!node.isMesh || !node.material) return;
    if (invisible) {
      const original = node.material;
      const ghost = Array.isArray(original)
        ? original.map(material => { const copy = material.clone(); copy.transparent = true; copy.opacity = Math.min(copy.opacity === undefined ? 1 : copy.opacity, .22); return copy; })
        : (() => { const copy = original.clone(); copy.transparent = true; copy.opacity = Math.min(copy.opacity === undefined ? 1 : copy.opacity, .22); return copy; })();
      node.userData.invisibilityOriginalMaterial = original;
      node.userData.invisibilityGhostMaterial = ghost;
      node.material = ghost;
    } else if (node.userData.invisibilityOriginalMaterial) {
      const ghost = node.userData.invisibilityGhostMaterial;
      node.material = node.userData.invisibilityOriginalMaterial;
      if (Array.isArray(ghost)) ghost.forEach(material => material.dispose());
      else ghost?.dispose();
      delete node.userData.invisibilityOriginalMaterial;
      delete node.userData.invisibilityGhostMaterial;
    }
  });
  hero.userData.invisibilityActive = !!invisible;
}
function setHeroShielded(hero, shielded) {
  if (!hero) return;
  const existing = hero.userData.shieldVisual;
  if (shielded && !existing) {
    const geometry = new THREE.SphereGeometry(1.02, 14, 10);
    const material = new THREE.MeshBasicMaterial({ color: 0x77d9ff, wireframe: true, transparent: true, opacity: .48, depthWrite: false });
    const shield = new THREE.Mesh(geometry, material);
    shield.position.y = 1.02;
    hero.add(shield);
    hero.userData.shieldVisual = shield;
  } else if (!shielded && existing) {
    hero.remove(existing);
    existing.geometry.dispose();
    existing.material.dispose();
    delete hero.userData.shieldVisual;
  }
}
function updateState(m) {
  if (!m.started) {
    started = false;
    $('lobby').classList.remove('hidden');
    hud.classList.add('hidden');
    $('lobbyRoomCode').textContent = roomCode;
    const self = (m.players || []).find(p => p.id === playerId);
    $('readyBtn').textContent = self && self.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO';
    $('startMatchBtn').classList.toggle('hidden', !self || !self.isHost);
    $('startMatchBtn').disabled = !(m.players || []).length || m.players.some(p => !p.ready);
    $('lobbyHint').textContent = self && self.isHost
      ? (m.players.some(p => !p.ready) ? 'Você é o anfitrião. Espere todos marcarem PRONTO.' : 'Todos prontos! Toque em INICIAR PARTIDA.')
      : 'Marque PRONTO e espere o anfitrião iniciar a partida.';
    const lobbyPlayers = m.players || [];
    const onlineCount = lobbyPlayers.length;
    const onlineLabel = $('lobbyOnlineCount');
    if (onlineLabel) onlineLabel.textContent = onlineCount + '/4 CONECTADOS · ' + lobbyPlayers.filter(p => p.ready).length + ' PRONTOS';
    $('readyBtn').disabled = !!m.started;

    $('lobbyPlayers').innerHTML = lobbyPlayers.map(p =>
      '<div class="lobby-player' + (p.ready ? ' ready' : '') + (p.id === playerId ? ' is-self' : '') + '"><span class="lobby-name">' + escapeHTML(p.name) + (p.isHost ? ' · ANFITRIÃO' : '') + (p.id === playerId ? ' · VOCÊ' : '') + '</span><b class="lobby-state">' + (p.ready ? 'PRONTO' : 'AGUARDANDO') + '</b></div>'
    ).join('') || '<p class="lobby-empty">Esperando aventureiros...</p>';

    // O jogador local fica sempre no centro; os aliados formam uma pequena equipe ao redor dele.
    const present = new Set();
    const teammateSlots = [{x:-2.6,z:0.1},{x:2.6,z:0.1},{x:-3.65,z:-1.9}];
    let teammateSlotIndex = 0;
    lobbyPlayers.forEach(p => {
      const slot = p.id === playerId ? {x:0,z:0} : (teammateSlots[teammateSlotIndex++] || {x:0,z:-3});
      present.add(p.id);
      if (p.id === playerId) {
        if (myPlayer) {
          const playerClass = p.playerClass || selectedClass || 'knight';
          const skin = p.skin || selectedSkin || 'default';
          if (myPlayer.userData.playerClass !== playerClass || myPlayer.userData.skin !== skin) {
            const position = myPlayer.position.clone();
            const replacement = makeHero(p.color, playerClass, skin);
            replacement.position.copy(position);
            scene.remove(myPlayer);
            disposeObject3D(myPlayer);
            myPlayer = replacement;
            scene.add(myPlayer);
          }
          myPlayer.position.set(0, 0, 0);
          myPlayer.rotation.y = Math.PI;
          myPlayer.userData.playerClass = p.playerClass || selectedClass || 'knight';
          myPlayer.userData.skin = p.skin || selectedSkin || 'default';
        }
      } else {
        let obj = remotePlayers.get(p.id);
        const playerClass = p.playerClass || 'knight';
        const skin = p.skin || 'default';
        if (!obj || obj.userData.playerClass !== playerClass || obj.userData.skin !== skin) {
          if (obj) { scene.remove(obj); disposeObject3D(obj); }
          obj = makeHero(p.color, playerClass, skin);
          scene.add(obj);
          remotePlayers.set(p.id, obj);
        }
        obj.userData.playerClass = playerClass;
        obj.userData.skin = skin;
        obj.userData.targetX = slot.x;
        obj.userData.targetZ = slot.z;
        obj.userData.targetRot = Math.PI;
      }
    });
    for (const [id, obj] of remotePlayers) {
      if (!present.has(id)) { scene.remove(obj); disposeObject3D(obj); remotePlayers.delete(id); }
    }
    for (const obj of monsterMeshes.values()) obj.visible = false;
    for (const obj of chestMeshes.values()) obj.visible = false;
    return;
  }
  const realm=Number(m.realm)===2?2:1,realmChanged=realm!==currentRealmVisual;
  if(realmChanged){currentRealmVisual=realm;realmIntroTimer=3.2;for(const [name,group] of Object.entries(environmentGroups))group.visible=(realm===1&&name==='dungeon')||(realm===2&&name==='astral');document.body.classList.toggle('realm-astral',realm===2);appliedInitialServerPosition=false;yaw=targetYaw=0;pitch=targetPitch=.25;if(realmPortal)realmPortal.visible=realm===1;showRealmTransition(realm);playSfx('portal');showNotice(realm===2?'Novo mundo descoberto: Vale Astral!':'Você voltou ao mundo da masmorra.');}
  if (!started) {
    started = true;
    $('lobby').classList.add('hidden');
    hud.classList.remove('hidden');
    placeSpellButtons();
    showNotice('A partida começou!');
  }
  const incoming = new Set();

  for (const p of m.players) {
    incoming.add(p.id);

    if (p.id === playerId) {
      const incomingSkills = Array.isArray(p.skills) ? p.skills : [];
      const changed = selectedClass !== (p.playerClass || 'knight') || selectedSkin !== (p.skin || 'default') || skillPoints !== (p.talentPoints ?? 5) || incomingSkills.slice().sort().join(',') !== Array.from(unlockedSkills).sort().join(',');
      selectedClass = p.playerClass || selectedClass;
      selectedSkin = p.skin || selectedSkin;
      updateClassAbilityButtons();
      skillPoints = Number.isFinite(p.talentPoints) ? p.talentPoints : skillPoints;
      unlockedSkills.clear(); incomingSkills.forEach(id => unlockedSkills.add(id));
      document.querySelectorAll('.class-card').forEach(el => el.classList.toggle('selected', el.dataset.class === selectedClass));
      if ($('classDescription')) $('classDescription').textContent = classDescriptions[selectedClass] || classDescriptions.knight;
      updateHeroShowcase();
      if (changed) { lastSkillSignature = ''; syncLoadoutUI(); }
      if (myPlayer) {
        myPlayer.userData.serverX = p.x;
        myPlayer.userData.serverZ = p.z;
        myPlayer.userData.serverHp = p.hp ?? 100;
        setHealthBar(myPlayer, myPlayer.userData.serverHp, p.maxHp ?? p.maxHP ?? 100);
        setHeroInvisible(myPlayer, !!p.invisible);
        setHeroShielded(myPlayer, !!p.shielded);
        $('hpText').textContent = String(Math.round(myPlayer.userData.serverHp));
        $('deathScreen').classList.toggle('hidden', myPlayer.userData.serverHp > 0);
        // Ao entrar/reconectar, alinhar uma vez com a posição de spawn do servidor.
        // Depois disso, corrigimos só pequenos desvios para evitar teletransportes.
        if (!appliedInitialServerPosition) {
          myPlayer.position.set(p.x, 0, p.z);
          myPlayer.rotation.y = p.rot || 0;
          appliedInitialServerPosition = true;
        } else {
          const dx = p.x - myPlayer.position.x;
          const dz = p.z - myPlayer.position.z;
          if (Math.abs(dx) > 1.6) myPlayer.position.x += dx * 0.12;
          if (Math.abs(dz) > 1.6) myPlayer.position.z += dz * 0.12;
        }
      }
      continue;
    }

    let obj = remotePlayers.get(p.id);
    if (!obj) {
      obj = makeHero(p.color, p.playerClass || 'knight', p.skin || 'default');
      obj.userData.playerClass = p.playerClass || 'knight'; obj.userData.skin = p.skin || 'default';
      scene.add(obj);
      remotePlayers.set(p.id, obj);
    }

    obj.userData.targetX = p.x;
    obj.userData.targetZ = p.z;
    obj.userData.serverHp = p.hp ?? 100;
    setHealthBar(obj, obj.userData.serverHp, p.maxHp ?? p.maxHP ?? 100);
    setHeroInvisible(obj, !!p.invisible);
    setHeroShielded(obj, !!p.shielded);
    if (obj.userData.playerClass !== (p.playerClass || 'knight') || obj.userData.skin !== (p.skin || 'default')) {
      const replacement = makeHero(p.color, p.playerClass || 'knight', p.skin || 'default');
      replacement.userData.targetX = p.x; replacement.userData.targetZ = p.z; replacement.userData.targetRot = p.rot;
      replacement.userData.playerClass = p.playerClass || 'knight'; replacement.userData.skin = p.skin || 'default';
      scene.remove(obj); scene.add(replacement); remotePlayers.set(p.id, replacement); obj = replacement;
    }
    obj.userData.targetRot = p.rot;
    obj.userData.name = p.name;
    const remoteClass = p.playerClass || 'knight', remoteSkin = p.skin || 'default';
    if (obj.userData.heroClass !== remoteClass || obj.userData.heroSkin !== remoteSkin) {
      const pos = obj.position.clone();
      scene.remove(obj); disposeObject3D(obj);
      obj = makeHero(p.color, remoteClass, remoteSkin);
      obj.position.copy(pos); scene.add(obj); remotePlayers.set(p.id, obj);
      obj.userData.targetX = p.x; obj.userData.targetZ = p.z; obj.userData.targetRot = p.rot;
    }
  }

  // Invocações e espíritos são entidades sincronizadas pelo servidor, separadas dos jogadores.
  for (const summon of (m.summons || [])) {
    const id = summon.id;
    incoming.add(id);
    let obj = remotePlayers.get(id);
    const isGuardianSpirit = summon.summonType === 'guardian_spirit';
    const isSkeleton = summon.summonType === 'skeleton' || summon.playerClass === 'skeleton' || String(summon.name || '').toLowerCase().includes('esqueleto');
    if (!obj || (!!obj.userData.isGuardianSpirit !== isGuardianSpirit)) {
      if (obj) { scene.remove(obj); disposeObject3D(obj); }
      obj = isGuardianSpirit
        ? makeGuardianSpirit(summon.color || 0x8cffe8)
        : makeHero(summon.color || (isSkeleton ? 0xe0dccb : 0x80c86b), isSkeleton ? 'skeleton' : 'goblin', isSkeleton ? 'shadow' : 'default');
      obj.userData.isGuardianSpirit = isGuardianSpirit;
      obj.userData.playerClass = isGuardianSpirit ? 'guardian_spirit' : (isSkeleton ? 'skeleton' : 'goblin');
      obj.userData.skin = summon.skin || (isSkeleton ? 'shadow' : 'default');
      scene.add(obj); remotePlayers.set(id, obj);
    }
    obj.userData.targetX = summon.x;
    obj.userData.targetZ = summon.z;
    obj.userData.targetRot = summon.rot || 0;
    obj.userData.name = summon.name || (isGuardianSpirit ? 'Espírito Guardião' : summon.summonType === 'skeleton' ? 'Esqueleto aliado' : 'Goblin aliado');
    obj.userData.serverHp = summon.hp ?? 72;
    if (!isGuardianSpirit) setHealthBar(obj, summon.hp ?? 60, summon.maxHp ?? 72);
  }
  for (const [id, obj] of remotePlayers) {
    if (!incoming.has(id)) {
      scene.remove(obj);
      disposeObject3D(obj);
      remotePlayers.delete(id);
    }
  }

  const phase = m.phase || 1, phaseLabel = $('phaseLabel');
  if (phase !== currentPhaseVisual) {
    const previousPhase = currentPhaseVisual;
    currentPhaseVisual = phase;
    if (!realmChanged && previousPhase > 0 && phase > previousPhase) {
      $('skillPanel')?.classList.remove('hidden');
      showNotice('ZONA SEGURA: habilidades liberadas por 10 segundos!');
      const overlay = $('phaseTransition');
      if (overlay) {
        $('phaseTransitionTitle').textContent = (['','CRIPTA ESQUECIDA','CAVERNAS MÁGICAS','FLORESTA AMALDIÇOADA','TERRAS VULCÂNICAS','ABISMO FINAL'][phase] || 'MUNDO CONCLUÍDO');
        $('phaseTransitionSub').textContent = phase === 5 ? 'O Guardião Supremo despertou...' : 'Nova região descoberta';
        overlay.classList.remove('hidden','phase-out');
        overlay.classList.add('phase-in');
        setTimeout(() => { overlay.classList.remove('phase-in'); overlay.classList.add('phase-out'); }, 1850);
        setTimeout(() => { overlay.classList.add('hidden'); overlay.classList.remove('phase-out'); }, 2550);
      }
    }
    const dungeonPalettes=[{bg:0x090d14,fog:0x090d14},{bg:0x100c20,fog:0x17112a},{bg:0x16070f,fog:0x210914},{bg:0x071810,fog:0x10271a},{bg:0x24100a,fog:0x35150b},{bg:0x160817,fog:0x210d28}];
    const astralPalettes=[{bg:0x08051a,fog:0x130c2b},{bg:0x100826,fog:0x1c1040},{bg:0x07172a,fog:0x0c2541},{bg:0x1b0b36,fog:0x2c1550},{bg:0x0c0c22,fog:0x171238},{bg:0x17062c,fog:0x270d42}];
    const palettes=realm===2?astralPalettes:dungeonPalettes;
    const palette=palettes[phase-1]||palettes[0];
    scene.background.setHex(palette.bg);
    if (scene.fog) scene.fog.color.setHex(palette.fog);
  }
  const safeUntil = Number(m.safeZoneUntil) || 0;
  const safeRemaining = Math.max(0, Math.ceil((safeUntil - Date.now()) / 1000));
  if (safeRemaining > 0 && safeUntil !== lastSafeZoneTimestamp) {
    lastSafeZoneTimestamp = safeUntil;
    $('skillPanel')?.classList.remove('hidden');
  } else if (safeRemaining <= 0) lastSafeZoneTimestamp = 0;
  const safeNotice = $('safeZoneNotice');
  if (safeNotice) {
    safeNotice.classList.toggle('hidden', safeRemaining <= 0);
    safeNotice.textContent = safeRemaining > 0 ? 'ZONA SEGURA · ' + safeRemaining + 's · MELHORE SUAS SKILLS' : '';
  }
  const aliveMonsters=m.monsters.filter(monster=>monster.alive).length;
  gateMeshes.forEach((gate,index)=>{const n=index+1;gate.userData.open=phase>n||(phase===n&&aliveMonsters===0);});
  if(realmPortal){realmPortal.visible=realm===1;realmPortal.userData.open=realm===1&&phase===5&&!!m.boss&&!m.boss.alive;}
  const phaseObjective=document.querySelector('.objective strong');
  if(phaseObjective){
    if(phase===5&&m.boss&&!m.boss.alive&&realm===1){const nearGate=myPlayer&&Math.hypot(myPlayer.position.x, myPlayer.position.z+168)<16;phaseObjective.textContent=nearGate?'PORTÃO ABERTO! Atravesse para o Vale Astral':'Siga pelo Abismo até o portão do Vale Astral';}
    else if(phase===5&&m.boss&&!m.boss.alive&&realm===2)phaseObjective.textContent='Guardião Astral derrotado! Vale conquistado';
    else if(phase===5)phaseObjective.textContent=realm===2?'Derrote o Guardião Astral':'Derrote o Guardião Supremo';
    else phaseObjective.textContent=realm===2?'Derrote os inimigos astrais e avance':'Derrote os monstros e atravesse o portão da região';
  }
  if(phaseLabel)phaseLabel.textContent=realm===2?'VALE ASTRAL · FASE '+phase+' / 5':'MUNDO MONOCROMÁTICO · FASE '+phase+' / 5';
  const bossPanel = $('bossPanel');
  if (bossPanel) bossPanel.classList.toggle('hidden', phase !== 5 || !m.boss || !m.boss.alive);
  bossData = m.boss || null;
  if (bossData && bossData.alive) {
    const bossTitle=document.querySelector('.boss-title');
    if(bossTitle)bossTitle.textContent=realm===2?'GUARDIÃO ASTRAL':'GUARDIÃO DO ABISMO';
    if (!bossMesh) { bossMesh = makeBoss(); scene.add(bossMesh); }
    bossMesh.visible = true; bossMesh.userData.targetX = bossData.x; bossMesh.userData.targetZ = bossData.z;
    const lifePhase = bossData.lifePhase || 1; bossMesh.userData.lifePhase = lifePhase;
    bossMesh.userData.bodyMaterial.color.set(lifePhase === 1 ? 0x29202f : lifePhase === 2 ? 0x59202f : 0x8b182a);
    bossMesh.userData.eyeMaterial.color.set(lifePhase === 3 ? 0xffc12e : 0xff345d);
    $('bossHealthFill').style.width=Math.max(0,Math.min(100,bossData.hp/bossData.maxHp*100))+'%';
    $('bossHealthFill').style.filter=bossData.hp/bossData.maxHp<.25?'brightness(1.35) drop-shadow(0 0 5px #ff416b)':'';
    $('bossHealthText').textContent = bossData.hp + ' / ' + bossData.maxHp;
    $('bossPhaseText').textContent = realm===2?'FASE ASTRAL '+lifePhase+' / 3':'FASE DE VIDA ' + lifePhase + ' / 3';
  } else if (bossMesh) {
    bossMesh.visible = false;
    if (bossData && !bossData.alive) {
      bossPanel?.classList.remove('hidden'); const bossTitle=document.querySelector('.boss-title');if(bossTitle)bossTitle.textContent=realm===2?'GUARDIÃO ASTRAL DERROTADO':'GUARDIÃO DO ABISMO DERROTADO'; $('bossPhaseText').textContent = 'GUARDIÃO DERROTADO';
      $('bossHealthFill').style.width = '0%'; $('bossHealthText').textContent = '0 / ' + (bossData.maxHp || 95);
    }
  }
  latestChests = m.chests || [];
  const nearbyChest = latestChests.find(chest => !chest.opened && myPlayer && Math.hypot(chest.x - myPlayer.position.x, chest.z - myPlayer.position.z) <= 3.4);
  const chestButton = $('chestBtn');
  if (chestButton) {
    chestButton.classList.toggle('hidden', !nearbyChest);
    chestButton.dataset.chestId = nearbyChest ? nearbyChest.id : '';
  }
  for (const chest of latestChests) {
    let obj = chestMeshes.get(chest.id);
    if (!obj) {
      obj = makeChest(realm);
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
      obj = makeMonster(mtr.kind || 'stalker', mtr.phase || phase);
      scene.add(obj);
      monsterMeshes.set(mtr.id, obj);
    }

    obj.userData.targetX = mtr.x;
    obj.userData.targetZ = mtr.z;
    obj.userData.kind = mtr.kind || 'stalker';
    obj.userData.serverHp = mtr.hp ?? 100;
    setHealthBar(obj, mtr.hp ?? 100, mtr.maxHp ?? mtr.maxHP ?? 100);
    // Calcula a direção do rosto/corpo para o jogador local.
    if (myPlayer) {
      const faceX = myPlayer.position.x - mtr.x;
      const faceZ = myPlayer.position.z - mtr.z;
      if (Math.hypot(faceX, faceZ) > 0.05) {
        obj.userData.targetRot = Math.atan2(faceX, faceZ) + Math.PI;
      }
    }
    obj.userData.alive = mtr.alive;
    obj.visible = mtr.alive;
  }
  // Descarta malhas de mundos anteriores após trocar de região; reduz memória e draw calls.
  const currentMonsterIds = new Set(m.monsters.map(monster => monster.id));
  for (const [id, obj] of monsterMeshes) {
    if (!currentMonsterIds.has(id)) {
      scene.remove(obj);
      disposeObject3D(obj);
      monsterMeshes.delete(id);
    }
  }

  $('monsterText').textContent = phase===5
    ? (bossData&&bossData.alive?(realm===2?'Guardião Astral':'Guardião Supremo'):(realm===2?'Vale Astral concluído':'Masmorra concluída'))
    : alive+' inimigos restantes';
  const phaseTotal=phase===5&&bossData?Math.max(1,Number(bossData.maxHp)||95):(phase===1?5:phase===2?8:phase===3?9:phase===4?10:95);
  const phaseProgress = phase === 5 && bossData
    ? (phaseTotal - bossData.hp) / phaseTotal * 100
    : (phaseTotal - alive) / phaseTotal * 100;
  $('progressFill').style.width = Math.max(0, Math.min(100, phaseProgress)) + '%';
  $('killText').textContent = phase === 5 && bossData
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

let dodgeTimer = 0;
function dodge() {
  if (!started || dodgeTimer > 0 || !myPlayer || (myPlayer.userData.serverHp ?? 100) <= 0) return;
  dodgeTimer = Math.max(1.5, 2.6 - (unlockedSkills.has('quick_recovery') ? .65 : 0));
  const distance = 2.2 + (unlockedSkills.has('dodge_mastery') ? .55 : 0) + (unlockedSkills.has('phantom_step') ? .75 : 0);
  const landing = resolveDungeonMovement(myPlayer.position.x, myPlayer.position.z,
    myPlayer.position.x - Math.sin(yaw) * distance,
    myPlayer.position.z - Math.cos(yaw) * distance
  );
  myPlayer.position.x = landing.x;
  myPlayer.position.z = landing.z;
  send({ type: 'dodge', rot: yaw });
  vibrateGame(24);
  playSfx('dodge');
  showNotice('↗ ESQUIVA');
}

function attack() {
  if (!started || attackCooldown > 0 || (myPlayer?.userData.serverHp ?? 100) <= 0) return;

  attackCooldown = selectedClass === 'goblin' ? .25 : selectedClass === 'ogre' ? .72 : selectedClass === 'archer' ? .29 : selectedClass === 'mage' ? .4 : .48;
  vibrateGame(10);
  playSfx('attack');
  send({ type: 'attack' });

  const sword = myPlayer?.userData.sword;
  if (sword) {
    sword.rotation.x = -1.45;
    sword.rotation.z = -0.35;
    setTimeout(() => { if (sword) { sword.rotation.x = 0; sword.rotation.z = 0; } }, 260);
  }
  if (myPlayer) { myPlayer.userData.attackAnim = 0.28; myPlayer.rotation.y = yaw; }

  const f = $('hitFlash');
  f.style.borderWidth = '5px';
  setTimeout(() => f.style.borderWidth = '0', 100);
}

// A tela inicial precisa liberar o menu antes de o jogador entrar na sala.
$('startBtn').addEventListener('click', async () => {
  ensureAudio();
  playSfx('ui');
  // No celular, não force a tela deitada: entrada e lobby devem acompanhar
  // a orientação escolhida pelo jogador. O jogo continua podendo alternar
  // para paisagem pelo botão de orientação durante a partida.
  if (isMobileDevice) {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (_) {}
    setTimeout(() => {
      onResize();
      updateOrientationToggleLabel();
    }, 120);
  }
  $('startScreen').classList.add('hidden');
  menu.classList.remove('hidden');
  setStatus('Digite seu nome e toque em JOGAR ONLINE.');
});

$('playBtn').addEventListener('click', () => connect(''));
$('quickMatchBtn')?.addEventListener('click', () => {
  quickMatchRequested = true;
  joiningPublicRoom = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: 'joinPublic', resumeToken, name: $('playerName').value.trim() || 'Aventureiro', class: selectedClass, skin: selectedSkin, skills: Array.from(unlockedSkills), talentPoints: skillPoints });
    quickMatchRequested = false;
    joiningPublicRoom = false;
  } else {
    connect('');
  }
});
function requestPublicRooms() {
  $('publicRoomsPanel')?.classList.remove('hidden');
  $('publicRoomsList').innerHTML = '<p>Buscando salas disponíveis…</p>';
  send({ type: 'listPublicRooms' });
}
$('publicRoomsBtn')?.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) requestPublicRooms();
  else {
    connect('');
    const wait = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(wait);
        requestPublicRooms();
      }
    }, 200);
    setTimeout(() => clearInterval(wait), 8000);
  }
});
$('refreshPublicRoomsBtn')?.addEventListener('click', requestPublicRooms);

$('readyBtn').addEventListener('click', () => send({ type: 'ready' }));
$('startMatchBtn').addEventListener('click', () => send({ type: 'startMatch' }));

function leaveRoomToMenu() {
  connectionRequested = false;
  resumeToken = '';
  try { sessionStorage.removeItem('masmorraResumeToken'); } catch {}
  clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  send({ type: 'leave' });
  if (ws) ws.close();
  started = false;
  $('deathScreen').classList.add('hidden');
  $('lobby').classList.add('hidden');
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
  setStatus('Você saiu da sala.');
}
$('leaveLobbyBtn').addEventListener('click', leaveRoomToMenu);
$('deathLeaveBtn').addEventListener('click', leaveRoomToMenu);

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

$('leaveBtn').addEventListener('click', leaveRoomToMenu);

$('chestBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (!$('chestBtn').classList.contains('hidden')) interactChest(); });
$('lootFilter')?.addEventListener('change', renderInventory);
$('lootSort')?.addEventListener('change', renderInventory);
$('recentLoot').addEventListener('click', e => {
  const row = e.target.closest('.select-item');
  if (!row) return;
  selectedItemId = row.dataset.itemId;
  renderInventory();
});
$('useSelectedItemBtn').addEventListener('click', useSelectedItem);

const CLASS_ABILITY_CONFIG = {
  knight: [
    { ability: 'knight_shield', icon: '🛡️', label: 'ESCUDO', description: 'Reduz o dano recebido por 4,2 segundos.', cooldown: 12 },
    { ability: 'knight_dash', icon: '⚔️', label: 'AVANÇO', description: 'Avança, puxa inimigos próximos e causa dano.', cooldown: 9 }
  ],
  mage: [
    { ability: 'fire', icon: '🔥', label: 'FOGO', description: 'Lança fogo e incendeia o alvo.', cooldown: 4, spell: true },
    { ability: 'lightning', icon: 'ϟ', label: 'RAIO', description: 'Dispara um raio mágico em cadeia.', cooldown: 3.5, spell: true }
  ],
  archer: [
    { ability: 'arrow_rain', icon: '🏹', label: 'CHUVA', description: 'Dispara uma chuva de flechas em área.', cooldown: 8 },
    { ability: 'incendiary_arrows', icon: '🔥', label: 'INCENDIÁRIAS', description: 'Incendeia uma área e causa queimadura.', cooldown: 12 }
  ],
  goblin: [
    { ability: 'goblin_invis', icon: '👻', label: 'INVISÍVEL', description: 'Fica invisível por 5 segundos e os monstros param de perseguir você.', cooldown: 14 },
    { ability: 'goblin_summon', icon: '👺', label: 'INVOCAR 2', description: 'Invoca dois goblins aliados por 12 segundos.', cooldown: 20 }
  ],
  ogre: [
    { ability: 'ogre_slam', icon: '💥', label: 'SOCO NO CHÃO', description: 'Dá um soco no chão, causa dano em área e repele inimigos.', cooldown: 10 },
    { ability: 'ogre_haste', icon: '💨', label: 'VELOCIDADE', description: 'Aumenta a velocidade por 5 segundos.', cooldown: 15 }
  ],
  healer: [
    { ability: 'healer_cure', icon: '💚', label: 'CURA', description: 'Cura você e aliados vivos em até 50 de vida.', cooldown: 23 },
    { ability: 'healer_guardian_spirits', icon: '🪽', label: 'ESPÍRITOS', description: 'Invoca 3 espíritos voadores por 20 s. Cada um cura aliados em 5 a cada 6 s ou causa 6 de dano a inimigos a cada 5 s.', cooldown: 40 }
  ],
  necromancer: [
    { ability: 'necromancer_summon', icon: '💀', label: 'HORDA', description: 'Invoca até cinco esqueletos aliados por 18 segundos.', cooldown: 30 },
    { ability: 'necromancer_dive', icon: '🕳️', label: 'MERGULHO', description: 'Desaparece por até 5 s; toque no chão para voltar e deixar um esqueleto na origem.', cooldown: 15 }
  ],
  monk: [
    { ability: 'monk_impact_palm', icon: '👊', label: 'PALMA', description: 'Onda de choque: 8 de dano, empurra e atordoa inimigos.', cooldown: 18 },
    { ability: 'monk_winged_steps', icon: '🪽', label: 'PASSOS', description: 'Avanço veloz com esquiva breve e velocidade extra.', cooldown: 15 }
  ]
};
let ogreHasteUntil = 0;
function updateClassAbilityButtons() {
  const abilities = CLASS_ABILITY_CONFIG[selectedClass] || CLASS_ABILITY_CONFIG.knight;
  const first = $('fireBtn'), second = $('lightningBtn');
  [[first, abilities[0], 'fireCooldown'], [second, abilities[1], 'lightningCooldown']].forEach(([button, ability, timerId]) => {
    if (!button || !ability) return;
    if (button.dataset.classAbility === ability.ability) return;
    const icon = button.querySelector('span');
    const small = button.querySelector('small');
    if (icon) icon.textContent = ability.icon;
    if (small) small.innerHTML = ability.label + ' <b id="' + timerId + '">OK</b>';
    button.setAttribute('aria-label', ability.label);
    button.title = ability.description || ability.label;
    button.dataset.classAbility = ability.ability;
  });
}
let fireCooldown = 0, lightningCooldown = 0;
updateClassAbilityButtons();
function placeSpellButtons() {
  const fire = $('fireBtn'), lightning = $('lightningBtn');
  if (!fire || !lightning) return;
  const landscape = window.innerWidth > window.innerHeight;
  const size = landscape ? 48 : 58;
  for (const btn of [fire, lightning]) {
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.setProperty('position', 'fixed', 'important');
    btn.style.setProperty('visibility', 'visible', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('pointer-events', 'auto', 'important');
    btn.style.setProperty('z-index', '5', 'important');
    btn.style.setProperty('width', size + 'px', 'important');
    btn.style.setProperty('height', size + 'px', 'important');
    btn.style.setProperty('border-radius', '50%', 'important');
    btn.style.setProperty('color', '#fff', 'important');
    btn.style.setProperty('background', 'rgba(12,20,32,.96)', 'important');
    btn.style.setProperty('flex-direction', 'column', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('touch-action', 'none', 'important');
  }
  if (!landscape) {
    fire.style.setProperty('right', '88px', 'important');
    fire.style.setProperty('bottom', '86px', 'important');
    lightning.style.setProperty('right', '18px', 'important');
    lightning.style.setProperty('bottom', '96px', 'important');
  } else {
    // Deitados, as habilidades ficam acima do ataque e longe do botão de baú.
    fire.style.setProperty('right', '18px', 'important');
    fire.style.setProperty('bottom', '112px', 'important');
    lightning.style.setProperty('right', '18px', 'important');
    lightning.style.setProperty('bottom', '166px', 'important');
  }
}
function updateOrientationToggleLabel() {
  const button = $('orientationToggleBtn');
  if (!button) return;
  const landscape = window.innerWidth > window.innerHeight;
  button.textContent = landscape ? '↥ FICAR EM PÉ' : '↔ DEITAR';
  button.setAttribute('aria-label', landscape ? 'Virar a tela para vertical' : 'Virar a tela para horizontal');
  button.title = landscape ? 'Voltar para vertical' : 'Girar para horizontal';
}
async function toggleGameOrientation() {
  const target = window.innerWidth <= window.innerHeight ? 'landscape' : 'portrait';
  try {
    if (window.AndroidGame && typeof window.AndroidGame.setOrientation === 'function') {
      window.AndroidGame.setOrientation(target);
      return;
    }
    if (screen.orientation && typeof screen.orientation.lock === 'function' && document.fullscreenElement) {
      await screen.orientation.lock(target);
      return;
    }
  } catch (_) {}
  showNotice('Ative a rotação automática do celular e vire o aparelho.');
}
$('orientationToggleBtn')?.addEventListener('click', toggleGameOrientation);
addEventListener('resize', () => { placeSpellButtons(); updateOrientationToggleLabel(); });
addEventListener('orientationchange', updateOrientationToggleLabel);
placeSpellButtons();
updateOrientationToggleLabel();

function refreshSettingsUI() {
  $('lookSensitivity').value = String(gameSettings.sensitivity);
  $('lookSensitivityValue').textContent = gameSettings.sensitivity.toFixed(1).replace('.', ',') + '×';
  $('lookVerticalSensitivity').value = String(gameSettings.verticalSensitivity);
  $('lookVerticalSensitivityValue').textContent = gameSettings.verticalSensitivity.toFixed(1).replace('.', ',') + '×';
  $('graphicsQuality').value = gameSettings.graphicsQuality;
  $('hapticsEnabled').checked = gameSettings.haptics;
  $('musicVolume').value = String(gameSettings.musicVolume);
  $('musicVolumeValue').textContent = Math.round(gameSettings.musicVolume * 100) + '%';
  $('musicEnabled').checked = gameSettings.musicEnabled;
  $('sfxVolume').value = String(gameSettings.sfxVolume);
  $('sfxVolumeValue').textContent = Math.round(gameSettings.sfxVolume * 100) + '%';
}
refreshSettingsUI();

$('settingsBtn').addEventListener('click', e => {
  e.preventDefault(); e.stopPropagation(); ensureAudio(); playSfx('ui');
  $('settingsPanel').classList.toggle('hidden');
});
$('settingsCloseBtn').addEventListener('click', () => {
  playSfx('ui'); $('settingsPanel').classList.add('hidden');
});
$('lookSensitivity').addEventListener('input', e => {
  gameSettings.sensitivity = clampSetting(e.target.value, 0.5, 3, 1.2);
  $('lookSensitivityValue').textContent = gameSettings.sensitivity.toFixed(1).replace('.', ',') + '×';
  saveGameSettings();
});
$('lookVerticalSensitivity').addEventListener('input', e => {
  gameSettings.verticalSensitivity = clampSetting(e.target.value, 0.5, 3, 0.9);
  $('lookVerticalSensitivityValue').textContent = gameSettings.verticalSensitivity.toFixed(1).replace('.', ',') + '×';
  saveGameSettings();
});
$('graphicsQuality').addEventListener('change', e => {
  gameSettings.graphicsQuality = ['low','balanced','high'].includes(e.target.value) ? e.target.value : 'balanced';
  saveGameSettings(); applyGraphicsQuality();
  showNotice('Qualidade gráfica: ' + ({low:'Baixa',balanced:'Equilibrada',high:'Alta'}[gameSettings.graphicsQuality]));
});
$('hapticsEnabled').addEventListener('change', e => {
  gameSettings.haptics = e.target.checked;
  saveGameSettings();
  if (gameSettings.haptics) vibrateGame(10);
});
$('musicVolume').addEventListener('input', e => {
  gameSettings.musicVolume = clampSetting(e.target.value, 0, 1, 0.32);
  $('musicVolumeValue').textContent = Math.round(gameSettings.musicVolume * 100) + '%';
  saveGameSettings(); updateAudioLevels();
});
$('musicEnabled').addEventListener('change', e => {
  gameSettings.musicEnabled = e.target.checked;
  saveGameSettings(); ensureAudio(); updateAudioLevels();
});
$('sfxVolume').addEventListener('input', e => {
  gameSettings.sfxVolume = clampSetting(e.target.value, 0, 1, 0.72);
  $('sfxVolumeValue').textContent = Math.round(gameSettings.sfxVolume * 100) + '%';
  saveGameSettings(); updateAudioLevels();
});

/* Painéis do lobby: os botões superiores abrem a respectiva ferramenta; o fundo fecha o painel. */
function closeLobbyEditor() {
  const editor = $('lobbyEditor');
  const backdrop = $('lobbyEditorBackdrop');
  if (editor) {
    editor.classList.add('hidden');
    delete editor.dataset.activeTab;
  }
  backdrop?.classList.add('hidden');
  document.querySelectorAll('#lobby .lobby-nav-btn').forEach(btn => btn.classList.remove('active'));
}
function refreshLobbySettingsUI() {
  if (!$('lobbySensitivity')) return;
  $('lobbySensitivity').value = String(gameSettings.sensitivity);
  $('lobbySensitivityValue').textContent = gameSettings.sensitivity.toFixed(1).replace('.', ',') + '×';
  $('lobbyVerticalSensitivity').value = String(gameSettings.verticalSensitivity);
  $('lobbyVerticalSensitivityValue').textContent = gameSettings.verticalSensitivity.toFixed(1).replace('.', ',') + '×';
  $('lobbyGraphicsQuality').value = gameSettings.graphicsQuality;
  $('lobbyHapticsEnabled').checked = gameSettings.haptics;
  $('lobbyMusicVolume').value = String(gameSettings.musicVolume);
  $('lobbyMusicVolumeValue').textContent = Math.round(gameSettings.musicVolume * 100) + '%';
  $('lobbyMusicEnabled').checked = gameSettings.musicEnabled;
  $('lobbySfxVolume').value = String(gameSettings.sfxVolume);
  $('lobbySfxVolumeValue').textContent = Math.round(gameSettings.sfxVolume * 100) + '%';
}
function openLobbyEditor(tab) {
  const allowedTabs = ['class', 'skin', 'config', 'skills'];
  if (!allowedTabs.includes(tab)) return;
  const editor = $('lobbyEditor');
  const backdrop = $('lobbyEditorBackdrop');
  if (!editor || !backdrop) return;
  if (!editor.classList.contains('hidden') && editor.dataset.activeTab === tab) {
    closeLobbyEditor();
    return;
  }
  const titles = {class:'ESCOLHA SUA CLASSE',skin:'ESCOLHA SUA SKIN',config:'CONFIGURAÇÕES',skills:'ÁRVORE DE SKILLS'};
  $('lobbyEditorTitle').textContent = titles[tab];
  document.querySelectorAll('#lobby [data-lobby-editor-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.lobbyEditorPanel !== tab);
  });
  document.querySelectorAll('#lobby .lobby-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lobbyEditor === tab);
  });
  editor.dataset.activeTab = tab;
  editor.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  if (tab === 'config') refreshLobbySettingsUI();
  if (tab === 'skills') renderSkillTrees();
}
document.querySelectorAll('#lobby [data-lobby-editor]').forEach(btn => {
  btn.addEventListener('click', () => {
    ensureAudio(); playSfx('ui');
    openLobbyEditor(btn.dataset.lobbyEditor);
  });
});
$('lobbyClassBtn')?.addEventListener('click', () => {
  ensureAudio(); playSfx('ui');
  openLobbyEditor('class');
});
$('lobbyEditorClose')?.addEventListener('click', closeLobbyEditor);
$('lobbyEditorBackdrop')?.addEventListener('click', closeLobbyEditor);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('lobbyEditor') && !$('lobbyEditor').classList.contains('hidden')) closeLobbyEditor();
});
$('lobbySensitivity')?.addEventListener('input', e => {
  gameSettings.sensitivity = clampSetting(e.target.value, 0.5, 3, 1.2);
  saveGameSettings(); refreshSettingsUI(); refreshLobbySettingsUI();
});
$('lobbyVerticalSensitivity')?.addEventListener('input', e => {
  gameSettings.verticalSensitivity = clampSetting(e.target.value, 0.5, 3, 0.9);
  saveGameSettings(); refreshSettingsUI(); refreshLobbySettingsUI();
});
$('lobbyGraphicsQuality')?.addEventListener('change', e => {
  gameSettings.graphicsQuality = ['low','balanced','high'].includes(e.target.value) ? e.target.value : 'balanced';
  saveGameSettings(); applyGraphicsQuality(); refreshSettingsUI(); refreshLobbySettingsUI();
});
$('lobbyHapticsEnabled')?.addEventListener('change', e => {
  gameSettings.haptics = e.target.checked;
  saveGameSettings(); refreshSettingsUI();
});
$('lobbyMusicVolume')?.addEventListener('input', e => {
  gameSettings.musicVolume = clampSetting(e.target.value, 0, 1, 0.32);
  saveGameSettings(); updateAudioLevels(); refreshSettingsUI(); refreshLobbySettingsUI();
});
$('lobbyMusicEnabled')?.addEventListener('change', e => {
  gameSettings.musicEnabled = e.target.checked;
  saveGameSettings(); ensureAudio(); updateAudioLevels(); refreshSettingsUI(); refreshLobbySettingsUI();
});
$('lobbySfxVolume')?.addEventListener('input', e => {
  gameSettings.sfxVolume = clampSetting(e.target.value, 0, 1, 0.72);
  saveGameSettings(); updateAudioLevels(); refreshSettingsUI(); refreshLobbySettingsUI();
});
refreshLobbySettingsUI();

function castSpell(kind) {
  if (!started || (myPlayer?.userData.serverHp ?? 100) <= 0) return;
  if (kind === 'fire') {
    if (fireCooldown > 0) return;
    fireCooldown = 4;
  } else {
    if (lightningCooldown > 0) return;
    lightningCooldown = 3.5;
  }
  // O efeito de lançamento aparece na hora; o servidor confirma os alvos e o dano.
  vibrateGame(kind === 'fire' ? 18 : 24);
  playSfx(kind);
  const color = kind === 'fire' ? 0xff6b24 : 0x69aaff;
  const geo = kind === 'fire' ? new THREE.SphereGeometry(.25, 7, 5) : new THREE.OctahedronGeometry(.24, 0);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .95 });
  const projectile = new THREE.Mesh(geo, material);
  const origin = myPlayer ? myPlayer.position.clone() : new THREE.Vector3();
  origin.y += 1.25;
  projectile.position.copy(origin);
  scene.add(projectile);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const destination = origin.clone().add(forward.multiplyScalar(5.5));
  const spellLimit = (isMobileDevice || gameSettings.graphicsQuality === 'low' || (lastFps > 0 && lastFps < 42)) ? 5 : gameSettings.graphicsQuality === 'high' ? 18 : 12;
  while (activeSpellEffects.length >= spellLimit) {
    const oldSpell = activeSpellEffects.shift();
    scene.remove(oldSpell.projectile);
    oldSpell.geo.dispose(); oldSpell.material.dispose();
  }
  activeSpellEffects.push({ projectile, geo, material, origin, destination, startedAt: performance.now(), duration: 300 });
  send({ type: 'spell', spell: kind });
  showNotice(kind === 'fire' ? '🔥 MAGIA DE FOGO!' : '⚡ MAGIA DE RAIO!');
}
function activateClassAbility(slot) {
  if (!started || (myPlayer?.userData.serverHp ?? 100) <= 0) return;
  const abilities = CLASS_ABILITY_CONFIG[selectedClass] || CLASS_ABILITY_CONFIG.knight;
  const spec = abilities[slot];
  if (!spec) return;
  if (spec.spell) {
    castSpell(spec.ability);
    return;
  }
  const remaining = slot === 0 ? fireCooldown : lightningCooldown;
  if (remaining > 0) return;
  send({ type: 'classAbility', ability: spec.ability });
}
$('fireBtn').addEventListener('pointerdown', e => { e.preventDefault(); activateClassAbility(0); });
$('lightningBtn').addEventListener('pointerdown', e => { e.preventDefault(); activateClassAbility(1); });

$('attackBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  attack();
});
$('dodgeBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  dodge();
});

addEventListener('keydown', e => {
  if (e.target && e.target.closest && e.target.closest('input,textarea,select') && e.code !== 'Escape') return;
  if (['Space','KeyE','KeyR','KeyQ','ShiftLeft','ShiftRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Space') attack();
  if (e.code === 'KeyE') interactChest();
  if (e.code === 'KeyR') useSelectedItem();
  if (e.code === 'KeyQ' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') dodge();
});
addEventListener('keyup', e => keys[e.code] = false);

// Joystick de toque
const joyEl = $('joystick'), stick = $('stick');
let joyPointer = null;

function setJoy(e) {
  const r = joyEl.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = Math.min(r.width, r.height) * .34, len = Math.hypot(dx, dy);
  if (len > max) {
    dx = dx / len * max;
    dy = dy / len * max;
  }
  const strengthRaw = Math.min(1, Math.hypot(dx, dy) / max);
  // Zona morta + progressão suave impedem deriva e passos involuntários no centro.
  if (strengthRaw < 0.12 || len < 0.001) {
    joy.x = joy.y = 0;
  } else {
    const strength = (strengthRaw - 0.12) / 0.88;
    const actualLength = Math.hypot(dx, dy) || 1;
    joy.x = dx / actualLength * strength;
    joy.y = dy / actualLength * strength;
  }
  stick.style.transform = `translate(${dx}px, ${dy}px)`;
}

joyEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (e.button !== undefined && e.button !== 0) return;
  if (joyPointer !== null) return;
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
joyEl.addEventListener('lostpointercapture', endJoy);

// Arrastar fora dos controles para girar a câmera
let lookPointer = null, lastX = 0, lastY = 0;
let necromancerDivePendingClient = false, necromancerDiveClientTimer = null;

function rendererPointerSetup() {
  // Ouve o canvas 3D diretamente para o toque de destino não ser engolido
  // por elementos HUD/overlay; o retângulo usado no raycast é o do próprio canvas.
  const el = renderer.domElement;
  el.style.touchAction = 'none';

  el.addEventListener('pointerdown', e => {
    if (started && necromancerDivePendingClient) {
      const rect = el.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const landing = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, landing)) {
        send({ type: 'necromancerDiveTarget', x: landing.x, z: landing.z });
        necromancerDivePendingClient = false;
        clearTimeout(necromancerDiveClientTimer);
        lookPointer = null;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      showNotice('Toque numa área visível do chão para escolher onde emergir.');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
    targetYaw -= dx * .008 * gameSettings.sensitivity;
    targetPitch = THREE.MathUtils.clamp(targetPitch + dy * .0045 * gameSettings.verticalSensitivity, -.18, .95);
  });

  const end = e => {
    if (e.pointerId === lookPointer) lookPointer = null;
  };

  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}


function disposeImpactEffect(effect) {
  if (!effect) return;
  scene.remove(effect.beam, effect.impact);
  effect.geo.dispose(); effect.beamMat.dispose(); effect.impactGeo.dispose(); effect.impactMat.dispose();
}

function updatePerformanceMonitor() {
  perfFrames++;
  const now = performance.now();
  const elapsed = now - perfWindowStart;
  if (elapsed < 1500) return;
  lastFps = perfFrames * 1000 / elapsed;
  perfFrames = 0;
  perfWindowStart = now;

  if (lastFps < 34) {
    slowFpsSamples++;
    fastFpsSamples = 0;
  } else if (lastFps > 57) {
    fastFpsSamples++;
    slowFpsSamples = 0;
  } else {
    slowFpsSamples = 0;
    fastFpsSamples = 0;
  }

  let nextRatio = adaptivePixelRatio;
  if (slowFpsSamples >= 2) {
    nextRatio = Math.max(getMinimumRenderPixelRatio(), adaptivePixelRatio - .04);
    slowFpsSamples = 0;
  } else if (fastFpsSamples >= 4) {
    nextRatio = Math.min(Math.min(devicePixelRatio, renderPixelRatioCap), adaptivePixelRatio + .05);
    fastFpsSamples = 0;
  }

  if (renderer && Math.abs(nextRatio - adaptivePixelRatio) >= .01) {
    adaptivePixelRatio = Math.round(nextRatio * 100) / 100;
    renderer.setPixelRatio(adaptivePixelRatio);
    renderer.setSize(innerWidth, innerHeight);
  }
  if (perfBadge) {
    const memoryBytes = performance.memory && Number.isFinite(performance.memory.usedJSHeapSize)
      ? performance.memory.usedJSHeapSize : null;
    const memoryText = memoryBytes === null ? 'JS heap n/d' : 'JS ' + Math.round(memoryBytes / (1024 * 1024)) + ' MB';
    const baseRatio = Math.max(.1, Math.min(devicePixelRatio || 1, renderPixelRatioCap));
    const qualityText = 'Q ' + Math.round(adaptivePixelRatio / baseRatio * 100) + '%';
    const pingText = measuredPing === null ? 'Ping —' : 'Ping ' + measuredPing + ' ms';
    perfBadge.textContent = Math.round(lastFps) + ' FPS · ' + pingText + ' · ' + memoryText + ' · ' + qualityText;
    const highHeap = memoryBytes !== null && memoryBytes > 300 * 1024 * 1024;
    perfBadge.style.color = highHeap || lastFps < 30 ? '#ff7189' : (lastFps < 43 || (measuredPing !== null && measuredPing > 160)) ? '#ffd178' : '#aeeaff';
    perfBadge.title = memoryBytes === null
      ? 'FPS, ping e escala de renderização. Este navegador não expõe o heap JS; RAM total e memória da GPU não podem ser medidas aqui.'
      : 'Heap JS estimado: ' + memoryText + '. Isto não é a RAM total do aparelho nem inclui necessariamente memória da GPU.';
    // O monitor deixa de flutuar sobre a ação; métricas ficam nas configurações.
    perfBadge.style.display = 'none';
  }
  const diagnosticMemoryBytes = performance.memory && Number.isFinite(performance.memory.usedJSHeapSize)
    ? performance.memory.usedJSHeapSize : null;
  const diagnosticValues = {
    fps: lastFps > 0 ? String(Math.round(lastFps)) : 'medindo…',
    ping: measuredPing === null ? '—' : measuredPing + ' ms',
    memory: diagnosticMemoryBytes === null ? 'n/d' : Math.round(diagnosticMemoryBytes / (1024 * 1024)) + ' MB',
    render: Math.round(adaptivePixelRatio / Math.max(0.1, devicePixelRatio) * 100) + '%'
  };
  for (const [metric, value] of Object.entries(diagnosticValues)) {
    document.querySelectorAll('[data-metric="' + metric + '"]').forEach(node => { node.textContent = value; });
  }
  document.querySelectorAll('[data-metric="fps"]').forEach(node => {
    node.style.color = lastFps < 30 && lastFps > 0 ? '#ff7189' : lastFps < 43 ? '#ffd178' : '#aeeaff';
  });
  document.querySelectorAll('[data-metric="ping"]').forEach(node => {
    node.style.color = measuredPing !== null && measuredPing > 160 ? '#ffd178' : '#aeeaff';
  });
}

function orientHealthBar(obj) {
  if (!obj?.userData?.healthBar) return;
  const bar = obj.userData.healthBar;
  obj.updateWorldMatrix(true, false);
  obj.getWorldQuaternion(healthBarParentQuaternion);
  bar.quaternion.copy(healthBarParentQuaternion.invert().multiply(camera.quaternion));
  bar.visible = obj.visible !== false;
  bar.renderOrder = 1000;
  for (const part of bar.children) {
    part.renderOrder = 1000;
    if (part.material) { part.material.depthTest = false; part.material.depthWrite = false; }
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer || document.hidden) return;

  const dt = Math.min(clock.getDelta(), 0.05), worldTime = clock.elapsedTime;
  const classFxNow = performance.now();
  for (let i = activeClassEffects.length - 1; i >= 0; i--) {
    const effect = activeClassEffects[i];
    const progress = (classFxNow - effect.startedAt) / effect.duration;
    if (progress >= 1) {
      scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose();
      activeClassEffects.splice(i, 1);
    } else {
      effect.mesh.scale.setScalar(.72 + progress * .55);
      effect.mesh.material.opacity = .85 * (1 - progress);
    }
  }
  realmIntroTimer=Math.max(0,realmIntroTimer-dt);
  if (realmPortal && realmPortalRing) {
    const open = !!realmPortal.userData.open;
    realmPortalRing.rotation.z += dt * (open ? 0.48 : 0.12);
    realmPortalRing.material.emissiveIntensity = open ? 1.8 + Math.sin(worldTime * 3.2) * 0.7 : 0.35;
    if (realmPortalCore) realmPortalCore.material.opacity=open?.31+Math.sin(worldTime*2.4)*.12:.035+Math.sin(worldTime*1.25)*.018;
    if(realmPortal.userData.glow)realmPortal.userData.glow.intensity=open?8+Math.sin(worldTime*3)*2:.35;
  }
  if(astralStarField&&environmentGroups.astral?.visible)astralStarField.rotation.y+=dt*.0016;
  for(const f of astralFloaters){f.mesh.position.y=f.baseY+Math.sin(worldTime*f.speed+f.phase)*.24;f.mesh.rotation.y+=dt*f.speed*.32;f.mesh.rotation.x+=dt*f.speed*.12;}
  // Amortece o giro da câmera para o arrasto ficar mais fluido sem reduzir a sensibilidade.
  const cameraInputSmooth = 1 - Math.exp(-18 * dt);
  yaw += (targetYaw - yaw) * cameraInputSmooth;
  pitch += (targetPitch - pitch) * cameraInputSmooth;
  const remoteSmooth = 1 - Math.exp(-14 * dt);
  const monsterSmooth = 1 - Math.exp(-10 * dt);
  const cameraSmooth = 1 - Math.exp(-9 * dt);

  attackCooldown = Math.max(0, attackCooldown - dt);
  fireCooldown = Math.max(0, fireCooldown - dt);
  lightningCooldown = Math.max(0, lightningCooldown - dt);
  dodgeTimer = Math.max(0, dodgeTimer - dt);
  const dodgeLabel = $('dodgeCooldown');
  if (dodgeLabel) {
    const dodgeText = dodgeTimer > 0 ? dodgeTimer.toFixed(1) + 's' : 'OK';
    if (dodgeLabel.textContent !== dodgeText) dodgeLabel.textContent = dodgeText;
  }
  const dodgeBtn = $('dodgeBtn');
  if (dodgeBtn) dodgeBtn.classList.toggle('cooling', dodgeTimer > 0);
  const fireLabel = $('fireCooldown'), lightningLabel = $('lightningCooldown');
  // Evita escritas repetidas no DOM a cada frame; os rótulos só mudam quando o texto muda.
  if (fireLabel) {
    const fireText = fireCooldown > 0 ? fireCooldown.toFixed(1) + 's' : 'OK';
    if (fireLabel.textContent !== fireText) fireLabel.textContent = fireText;
  }
  if (lightningLabel) {
    const lightningText = lightningCooldown > 0 ? lightningCooldown.toFixed(1) + 's' : 'OK';
    if (lightningLabel.textContent !== lightningText) lightningLabel.textContent = lightningText;
  }

  // Movimento do jogador local
  if (started && myPlayer && (myPlayer.userData.serverHp ?? 100) > 0) {
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

      const classMoveMultiplier = selectedClass === 'goblin' ? 1.10 : selectedClass === 'ogre' ? .88 : selectedClass === 'archer' ? 1.12 : 1;
      const hasteMultiplier = selectedClass === 'ogre' && performance.now() < ogreHasteUntil ? 1.65 : 1;
      const moveSpeed = 5.8 * classMoveMultiplier * hasteMultiplier * (unlockedSkills.has('swift_step') ? 1.18 : 1);
      const nextPosition = resolveDungeonMovement(
        myPlayer.position.x,
        myPlayer.position.z,
        myPlayer.position.x + dir.x * dt * moveSpeed,
        myPlayer.position.z + dir.z * dt * moveSpeed
      );
      myPlayer.position.x = nextPosition.x;
      myPlayer.position.z = nextPosition.z;

      myPlayer.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
    }

    if (performance.now() - lastMove > 120) {
      send({
        type: 'move',
        x: myPlayer.position.x,
        z: myPlayer.position.z,
        rot: myPlayer.rotation.y
      });

      lastMove = performance.now();
    }
  }

  // Animação de caminhada do personagem local: passos alternados, balanço do tronco e capa.
  if (myPlayer) {
    const v = moveInput();
    const moving = started && Math.hypot(v.x, v.y) > 0.04 && (myPlayer.userData.serverHp ?? 100) > 0;
    myPlayer.userData.walkPhase = (myPlayer.userData.walkPhase || 0) + dt * (moving ? 8.2 : 1.4);
    const phase = myPlayer.userData.walkPhase;
    const stride = moving ? 1 : .12;
    const breath = Math.sin(phase * .8);
    if (myPlayer.userData.torso) { myPlayer.userData.torso.scale.y = 1 + breath * .018; myPlayer.userData.torso.rotation.z = moving ? Math.sin(phase) * .01 : Math.sin(phase * .5) * .006; }
    if (myPlayer.userData.head) { myPlayer.userData.head.rotation.x = moving ? Math.sin(phase) * .012 : Math.sin(phase * .6) * .008; myPlayer.userData.head.rotation.z = Math.sin(phase * .4) * .012; }
    for (const leg of myPlayer.userData.legs || []) {
      leg.mesh.rotation.x = Math.sin(phase + (leg.side > 0 ? Math.PI : 0)) * .29 * stride;
    }
    for (const arm of myPlayer.userData.arms || []) {
      const swing = Math.sin(phase + (arm.side < 0 ? Math.PI : 0));
      arm.mesh.rotation.x = swing * .14 * stride;
      if (arm.mesh.userData.elbow) {
        arm.mesh.userData.elbow.rotation.x = Math.max(0, swing) * .32 * stride;
      }
    }
    myPlayer.position.y = moving ? Math.abs(Math.sin(phase * 2)) * .008 : 0;
    if (myPlayer.userData.cape) {
      myPlayer.userData.cape.rotation.x = -.08 + Math.sin(phase) * .035 * stride;
      myPlayer.userData.cape.rotation.z = Math.sin(phase * .5) * .012 * stride;
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
    if (obj.userData.isGuardianSpirit) {
      const phase = worldTime * 2.8 + (obj.userData.spiritPhase || 0);
      obj.position.y = 1.35 + Math.sin(phase) * .18;
      obj.rotation.z = Math.sin(phase * .65) * .12;
      if (obj.userData.guardianCore) { obj.userData.guardianCore.rotation.y += dt * 1.25; obj.userData.guardianCore.rotation.x = Math.sin(phase * .8) * .12; }
      if (obj.userData.guardianHalo) obj.userData.guardianHalo.rotation.z += dt * .8;
      for (const wing of obj.userData.guardianWings || []) {
        wing.mesh.rotation.z = wing.side * (-.24 + Math.sin(phase * 2.3) * .34);
        wing.mesh.rotation.y = Math.sin(phase * 1.4 + wing.side) * .18;
      }
      continue;
    }
    const remoteMoving = Math.hypot((obj.userData.targetX ?? obj.position.x) - obj.position.x, (obj.userData.targetZ ?? obj.position.z) - obj.position.z) > .035;
    obj.userData.walkPhase = (obj.userData.walkPhase || 0) + dt * (remoteMoving ? 7.2 : 1.4);
    const rp = obj.userData.walkPhase;
    const remoteStride = remoteMoving ? 1 : .08;
    for (const leg of obj.userData.legs || []) {
      leg.mesh.rotation.x = Math.sin(rp + (leg.side > 0 ? Math.PI : 0)) * .34 * remoteStride;
    }
    for (const arm of obj.userData.arms || []) {
      const swing = Math.sin(rp + (arm.side < 0 ? Math.PI : 0));
      arm.mesh.rotation.x = swing * .19 * remoteStride;
      if (arm.mesh.userData.elbow) {
        arm.mesh.userData.elbow.rotation.x = Math.max(0, swing) * .25 * remoteStride;
      }
    }
    if (obj.userData.torso) {
      obj.userData.torso.rotation.z = remoteMoving ? Math.sin(rp) * .022 : Math.sin(rp * .5) * .005;
    }
    if (obj.userData.head) {
      obj.userData.head.rotation.x = remoteMoving ? Math.sin(rp) * .01 : Math.sin(rp * .6) * .005;
      obj.userData.head.rotation.z = Math.sin(rp * .4) * .01;
    }
    obj.position.y = remoteMoving ? Math.abs(Math.sin(rp * 2)) * .012 : Math.sin(rp * .8) * .004;
    if (obj.userData.cape) {
      obj.userData.cape.rotation.x = -.08 + Math.sin(rp) * (remoteMoving ? .045 : .008);
      obj.userData.cape.rotation.z = Math.sin(rp * .5) * (remoteMoving ? .018 : .004);
    }
  }

  // Monstros: uma única atualização de posição evita aceleração e animações que se anulam.
  const monsterNow = performance.now();
  for (const obj of monsterMeshes.values()) {
    if (!obj.visible || obj.userData.targetX === undefined) continue;

    const dx = obj.userData.targetX - obj.position.x;
    const dz = obj.userData.targetZ - obj.position.z;
    const distance = Math.hypot(dx, dz);
    const moving = distance > .045;
    obj.position.x = THREE.MathUtils.lerp(obj.position.x, obj.userData.targetX, monsterSmooth);
    obj.position.z = THREE.MathUtils.lerp(obj.position.z, obj.userData.targetZ, monsterSmooth);

    if (obj.userData.spawnAnim > 0) {
      obj.userData.spawnAnim = Math.max(0, obj.userData.spawnAnim - dt);
      const spawnProgress = 1 - obj.userData.spawnAnim / .35;
      obj.scale.setScalar(Math.max(.05, spawnProgress));
    } else {
      obj.scale.setScalar(1);
    }

    const kind = obj.userData.kind || 'stalker';
    const gait = kind === 'brute' ? .72
      : kind === 'wraith' ? 1.34
      : kind === 'stalker' ? 1.16 : .96;
    obj.userData.walkPhase = (obj.userData.walkPhase || 0) + dt * (moving ? 7.2 : 1.45);
    const phase = obj.userData.walkPhase;

    if (obj.userData.attackAnim > 0) {
      obj.userData.attackAnim = Math.max(0, obj.userData.attackAnim - dt);
    }
    const attackProgress = obj.userData.attackAnim > 0
      ? (1 - obj.userData.attackAnim / .38) : 0;
    const attackPulse = obj.userData.attackAnim > 0
      ? Math.sin(THREE.MathUtils.clamp(attackProgress, 0, 1) * Math.PI) : 0;

    const idleBob = kind === 'wraith' ? .045
      : moving ? .018 : .007;
    obj.position.y = Math.abs(Math.sin(phase * 2)) * idleBob + attackPulse * .09;

    const rollTarget = moving ? Math.sin(phase) * (kind === 'brute' ? .008 : .015) : 0;
    obj.rotation.z = THREE.MathUtils.lerp(obj.rotation.z, rollTarget, 1 - Math.exp(-6 * dt));

    if (obj.userData.targetRot !== undefined) {
      const angleDiff = Math.atan2(
        Math.sin(obj.userData.targetRot - obj.rotation.y),
        Math.cos(obj.userData.targetRot - obj.rotation.y)
      );
      obj.rotation.y += angleDiff * (1 - Math.exp(-8 * dt));
    }

    const attackTilt = attackPulse * (kind === 'brute' ? .30 : kind === 'wraith' ? .20 : .42);
    const walkTilt = kind === 'stalker' && moving ? Math.sin(phase) * .015 : 0;
    const targetTilt = -attackTilt + walkTilt;
    obj.rotation.x = THREE.MathUtils.lerp(obj.rotation.x, targetTilt, 1 - Math.exp(-12 * dt));

    for (const limb of obj.userData.animatedLimbs || []) {
      const limbPhase = phase * gait + (limb.side > 0 ? Math.PI : 0);
      const swing = Math.sin(limbPhase);
      const walkAmount = moving ? (kind === 'brute' ? .17 : kind === 'wraith' ? .075 : .14) : .012;
      const attackPower = kind === 'brute' ? .62 : kind === 'wraith' ? .28 : .42;
      limb.mesh.rotation.x = swing * walkAmount - attackPulse * attackPower * (limb.side < 0 ? 1 : .25);
      limb.mesh.rotation.z = limb.baseRotationZ
        + Math.sin(phase * .65 * gait + limb.side) * (moving ? .022 : .006);
    }

    // O anel no chão pulsa junto ao golpe para comunicar melhor o perigo do ataque.
    const attackRing = obj.userData.attackRing;
    if (attackRing) {
      attackRing.material.opacity = .48 + attackPulse * .42;
      const ringScale = 1 + attackPulse * .18;
      attackRing.scale.set(ringScale, ringScale, ringScale);
    }
  }

  if (bossMesh && bossMesh.visible && bossMesh.userData.targetX !== undefined) {
    bossMesh.position.x = THREE.MathUtils.lerp(bossMesh.position.x, bossMesh.userData.targetX, monsterSmooth);
    bossMesh.position.z = THREE.MathUtils.lerp(bossMesh.position.z, bossMesh.userData.targetZ, monsterSmooth);
    bossMesh.userData.animPhase = (bossMesh.userData.animPhase || 0) + dt * (Math.hypot((bossMesh.userData.targetX ?? bossMesh.position.x)-bossMesh.position.x,(bossMesh.userData.targetZ ?? bossMesh.position.z)-bossMesh.position.z) > .04 ? 5.5 : 1.7);
    const bossPhase = bossMesh.userData.animPhase;
    const bossMoving = Math.hypot((bossMesh.userData.targetX ?? bossMesh.position.x)-bossMesh.position.x,(bossMesh.userData.targetZ ?? bossMesh.position.z)-bossMesh.position.z) > .04;
    bossMesh.position.y = .08 + Math.sin(bossPhase * 1.5) * .045;
    if (bossMesh.userData.torso) bossMesh.userData.torso.rotation.z = Math.sin(bossPhase) * (bossMoving ? .035 : .018);
    for (const arm of bossMesh.userData.arms || []) arm.mesh.rotation.x = Math.sin(bossPhase + (arm.side > 0 ? Math.PI : 0)) * (bossMoving ? .2 : .045);
    if (bossMesh.userData.eyeMaterial) bossMesh.userData.eyeMaterial.emissiveIntensity = 2.3 + (Math.sin(bossPhase * 2.1) + 1) * .55;
    // O Guardião respira, balança os braços e pulsa os olhos durante a perseguição.
  }
  // Emissive pulse and slow core rotation make enemies feel alive without extra lights.
  for (const obj of monsterMeshes.values()) {
    if (!obj.visible || obj === bossMesh) continue;
    const offset=obj.userData.eyePulseOffset||0;
    if (obj.userData.eyeMaterial) obj.userData.eyeMaterial.emissiveIntensity=1.1+(Math.sin(worldTime*2.6+offset)+1)*.42;
    if (obj.userData.coreMesh) {
      obj.userData.coreMesh.rotation.y+=dt*.42;
      obj.userData.coreMesh.rotation.x=Math.sin(worldTime*1.2+offset)*.12;
    }
  }
  if (bossMesh && bossMesh.userData.coreMesh) {
    bossMesh.userData.coreMesh.rotation.y+=dt*.55;
    bossMesh.userData.coreMesh.rotation.x=Math.sin(worldTime*1.5)*.12;
    if (bossMesh.userData.coreHalo) bossMesh.userData.coreHalo.rotation.z+=dt*.35;
  }
  // Anima os portões: as grades somem ao liberar a passagem.
  for (const gate of gateMeshes) {
    const targetScale = gate.userData.open ? 0 : 1;
    gate.userData.bars.scale.x = THREE.MathUtils.lerp(gate.userData.bars.scale.x, targetScale, 1 - Math.exp(-5 * dt));
    gate.userData.bars.visible = gate.userData.bars.scale.x > .04;
    gate.userData.ring.material.opacity = gate.userData.open ? .08 : .3;
    gate.userData.portal.material.opacity = THREE.MathUtils.lerp(gate.userData.portal.material.opacity, gate.userData.open ? .32 : 0, 1 - Math.exp(-2.8 * dt));
    gate.userData.portalRim.rotation.z += dt * (gate.userData.open ? .65 : .12);
    gate.userData.portalRim.material.emissiveIntensity = gate.userData.open ? 2.8 : 1.0;
  }
  // Efeitos de impacto compartilham o loop principal para evitar RAF por efeito.
  const impactNow = performance.now();
  for (let i = activeImpactEffects.length - 1; i >= 0; i--) {
    const effect = activeImpactEffects[i];
    const t = (impactNow - effect.startedAt) / effect.duration;
    if (t >= 1) {
      disposeImpactEffect(effect);
      activeImpactEffects.splice(i, 1);
      continue;
    }
    effect.beamMat.opacity = 1 - t;
    effect.impact.scale.setScalar(effect.isFire ? 1 + t * .65 : 1 + Math.sin(t * Math.PI) * .8);
    effect.impactMat.opacity = 1 - t;
  }

  // Projéteis locais também têm um limite para controlar picos de memória.
  const spellNow = performance.now();
  for (let i = activeSpellEffects.length - 1; i >= 0; i--) {
    const effect = activeSpellEffects[i];
    const t = (spellNow - effect.startedAt) / effect.duration;
    if (t >= 1) {
      scene.remove(effect.projectile);
      effect.geo.dispose(); effect.material.dispose();
      activeSpellEffects.splice(i, 1);
      continue;
    }
    effect.projectile.position.lerpVectors(effect.origin, effect.destination, t);
    effect.projectile.position.y += Math.sin(t * Math.PI) * .35;
    effect.projectile.scale.setScalar(1 + t * 1.3);
    effect.material.opacity = 1 - t * .65;
  }
  // Efeitos de queimadura leves, atualizados no loop principal para evitar RAF extra.
  const burnNow = performance.now();
  for (let i = activeBurnEffects.length - 1; i >= 0; i--) {
    const burn = activeBurnEffects[i];
    if (burnNow >= burn.expires) {
      scene.remove(burn.group);
      burn.group.children.forEach(flame => flame.geometry.dispose());
      burn.material.dispose();
      activeBurnEffects.splice(i, 1);
      continue;
    }
    const age = (burnNow + burn.seed * 100) * .006;
    burn.group.children.forEach((flame, index) => {
      flame.scale.y = .75 + (Math.sin(age + index * 1.7) + 1) * .3;
      flame.rotation.y = age * .6 + index;
    });
  }

  // Partículas ambientais estáticas: sem oscilação que possa parecer pulsação.


  // Barras acompanham a câmera para ficarem legíveis acima de aliados e monstros.
  if (myPlayer) orientHealthBar(myPlayer);
  for (const obj of remotePlayers.values()) orientHealthBar(obj);
  for (const obj of monsterMeshes.values()) orientHealthBar(obj);

  // Enquadramento panorâmico do lobby, adaptado à largura da tela.
  if (!started) {
    const halfFov = camera.fov * Math.PI / 360;
    const tanHalfHorizontal = Math.tan(halfFov) * camera.aspect;
    const lineupWidth = 6.6;
    const viewDistance = THREE.MathUtils.clamp(lineupWidth / Math.max(2 * tanHalfHorizontal, .12), 8.5, 13.5);
    const lobbyTime = clock.elapsedTime;
    const lobbyCameraTarget = lobbyCameraPositionScratch.set(
      Math.sin(lobbyTime * 0.16) * 0.22,
      3.8 + Math.sin(lobbyTime * 0.42) * 0.07,
      viewDistance + 0.8 + Math.sin(lobbyTime * 0.22) * 0.16
    );
    camera.position.lerp(lobbyCameraTarget, 1 - Math.exp(-3.8 * dt));
    camera.lookAt(Math.sin(lobbyTime * 0.16) * 0.12, 1.05, -0.25);
  } else if (myPlayer) {
    const target = cameraFocusScratch.set(myPlayer.position.x, 1.2, myPlayer.position.z);
    const introBlend=realmIntroTimer>0?Math.min(1,realmIntroTimer/3.2):0;
    const dist=8.5+introBlend*2.8;
    const cameraTarget=cameraPositionScratch.set(
      target.x+Math.sin(yaw)*dist,
      target.y+3.0+pitch*2+introBlend*.65,
      target.z + Math.cos(yaw) * dist
    );
    camera.position.lerp(cameraTarget, cameraSmooth);
    camera.lookAt(target.x, target.y + 0.15, target.z);
  }

  const lobbyVisible = !started && $('lobby') && !$('lobby').classList.contains('hidden');
  if (myPlayer) myPlayer.visible = !lobbyVisible;
  for (const obj of remotePlayers.values()) obj.visible = !lobbyVisible;
  updatePerformanceMonitor();
  const lobbyOverlayVisible = !started && $('lobby') && !$('lobby').classList.contains('hidden');
  if (lobbyOverlayVisible) {
    // The lobby uses the same canvas for its independent hero preview. Hide the
    // gameplay scene only for this frame so dungeon geometry/camera cannot bleed
    // through the translucent lobby. Restore each exact previous visibility.
    const priorVisibility = scene.children.map(child => [child, child.visible]);
    try {
      for (const child of scene.children) child.visible = false;
      renderer.render(scene, camera);
    } finally {
      for (const [child, wasVisible] of priorVisibility) child.visible = wasVisible;
    }
  } else {
    renderer.render(scene, camera);
  }
  renderLobby3DPreview();
}

try {
  init3D();
  // The renderer exists now, so its canvas is safe to use for touch controls.
  rendererPointerSetup();
  const gameCanvas = renderer && renderer.domElement;
  if (gameCanvas) {
    gameCanvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      const message = 'Os gráficos foram pausados pelo navegador. Tentando recuperar a imagem…';
      if (started) showNotice(message); else setStatus(message);
    });
    gameCanvas.addEventListener('webglcontextrestored', () => {
      adaptivePixelRatio = Math.min(devicePixelRatio || 1, renderPixelRatioCap);
      onResize();
      if (started) showNotice('Gráficos recuperados! Pode continuar a aventura.');
      else setStatus('Gráficos recuperados.');
    });
  }
} catch (error) {
  console.error('[O Último Legado] Falha ao inicializar os gráficos 3D:', error);
  const bootError = document.createElement('div');
  bootError.setAttribute('role', 'alert');
  bootError.textContent = 'Não foi possível iniciar os gráficos 3D. Recarregue a página e tente novamente.';
  Object.assign(bootError.style, {
    position: 'fixed', inset: '12px', zIndex: '99999', display: 'grid',
    placeItems: 'center', padding: '24px', borderRadius: '14px',
    background: '#080d16', color: '#f0f7ff', textAlign: 'center',
    font: '600 15px/1.55 system-ui, sans-serif'
  });
  document.body.appendChild(bootError);
}
