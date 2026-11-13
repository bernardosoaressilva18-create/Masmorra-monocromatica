
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';

const $ = id => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), loading = $('loading'), menuStatus = $('menuStatus');

let renderer, scene, camera, clock, ws, playerId = null, roomCode = '', myPlayer = null, started = false;
// Evita gastar CPU em segundo plano e impede loops de animação duplicados.
let webglContextLost = false, animationFrameId = null;
let selectedGameMode = 'coop', activeGameMode = 'coop';
try { selectedGameMode = localStorage.getItem('mmGameMode') === 'pvp_rpg' ? 'pvp_rpg' : 'coop'; } catch {}
const gameModeSelect = $('gameModeSelect');
function syncGameModeChoice() {
  if (gameModeSelect) gameModeSelect.value = selectedGameMode;
  const footnote = $('modeFootnote');
  if (footnote) footnote.textContent = selectedGameMode === 'pvp_rpg'
    ? 'ARENA PvP RPG · CLASSES, MONSTROS E ELIMINAÇÕES'
    : 'MODO COOPERATIVO · ATÉ 4 JOGADORES';
}
gameModeSelect?.addEventListener('change', () => {
  selectedGameMode = gameModeSelect.value === 'pvp_rpg' ? 'pvp_rpg' : 'coop';
  try { localStorage.setItem('mmGameMode', selectedGameMode); } catch {}
  syncGameModeChoice();
});
syncGameModeChoice();
let lobbyPreviewScene = null, lobbyPreviewCamera = null, lobbyPreviewHero = null, lobbyPreviewPlatform = null, lobbyPreviewRing = null, lobbyPreviewParticles = null, lobbyPreviewRunes = null, lobbyPreviewCrystals = null, lobbyPreviewCompanions = null;
let lobbyPreviewExitingHero = null, lobbyPreviewTransitionStartedAt = 0, lobbySelectionBurstStartedAt = 0;
let lobbyPreviewRosterSignature = '';
let dayNightHemisphereLight = null, dayNightSunLight = null, dayNightMoonLight = null;
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
const movementForwardScratch = new THREE.Vector3();
const movementRightScratch = new THREE.Vector3();
let healthBarRefreshAccumulator = 0;
let entityUpdateAccumulator = 0;
let bossMesh = null, bossData = null;
const bossPortalMeshes = new Map();
const bossTelegraphMeshes = new Map();
let currentPhaseVisual = 0, lastSafeZoneTimestamp = 0, appliedInitialServerPosition = false;
const SHARED_PROFILE_KEY='ultimoLegadoSharedProfileV2';
const FREE_LOBBY_SKINS=['default','shadow','ember'];
const CHEST_ONLY_SKINS=['rune','celestial','bloodmoon','frostguard','draconic','voidwalker','verdant'];
let sharedProfileSeed={};try{sharedProfileSeed=JSON.parse(localStorage.getItem(SHARED_PROFILE_KEY)||'{}')||{};}catch{}
const EMPTY_INVENTORY={comum:0,incomum:0,raro:0,'épico':0,'lendário':0};
let latestChests=[],inventoryData=(()=>{const saved=sharedProfileSeed.inventory&&typeof sharedProfileSeed.inventory==='object'?sharedProfileSeed.inventory:{};return Object.fromEntries(Object.keys(EMPTY_INVENTORY).map(k=>[k,Math.max(0,Math.min(9999,Number(saved[k])||0))]));})(),
lootDrops=(Array.isArray(sharedProfileSeed.lootDrops)?sharedProfileSeed.lootDrops:[]).slice(-100),selectedItemId=sharedProfileSeed.selectedItemId?String(sharedProfileSeed.selectedItemId):null;
let equipmentDamage=Math.max(0,Math.min(18,Number(sharedProfileSeed.equipmentDamage)||0));
let sharedProgress={realm:Math.max(1,Math.min(3,Number(sharedProfileSeed.realm)||1)),phase:Math.max(1,Math.min(5,Number(sharedProfileSeed.phase)||1))};
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
  shiftLock: Number(storedGameSettings.cameraControlsVersion) >= 2 && storedGameSettings.shiftLock === true,
  cameraControlsVersion: 3,
  cameraMode: ['first','second','third'].includes(storedGameSettings.cameraMode) ? storedGameSettings.cameraMode : 'third',
  cameraZoom: clampSetting(storedGameSettings.cameraZoom, 6, 14, 9.5),
  graphicsQuality: ['low','balanced','high'].includes(storedGameSettings.graphicsQuality) ? storedGameSettings.graphicsQuality : 'balanced',
  haptics: storedGameSettings.haptics !== false,
  musicVolume: clampSetting(storedGameSettings.musicVolume, 0, 1, 0.32),
  sfxVolume: clampSetting(storedGameSettings.sfxVolume, 0, 1, 0.72),
  musicEnabled: storedGameSettings.musicEnabled !== false
};
let shiftLockEnabled = gameSettings.shiftLock;
let cameraDistance = gameSettings.cameraZoom;
let audioContext = null, musicBus = null, sfxBus = null, backgroundMusic = null;

function saveGameSettings() {
  try { localStorage.setItem('mmGameSettings', JSON.stringify(gameSettings)); } catch {}
}

// Keep the WebGL drawing buffer and the mobile viewport in sync after rotation.
function getEffectiveViewport() {
  const visual = window.visualViewport;
  if (visual && visual.width > 1 && visual.height > 1 && Math.abs((visual.scale || 1) - 1) < 0.08) {
    return { width: visual.width, height: visual.height, left: visual.offsetLeft || 0, top: visual.offsetTop || 0 };
  }
  const root = document.documentElement;
  return { width: root.clientWidth || window.innerWidth, height: root.clientHeight || window.innerHeight, left: 0, top: 0 };
}
function syncRendererSize(width, height) {
  if (!renderer) return;
  const viewport = getEffectiveViewport();
  const w = Math.max(1, Math.round(Number(width) || viewport.width));
  const h = Math.max(1, Math.round(Number(height) || viewport.height));
  renderer.setSize(w, h, false);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, {
    position: 'fixed', left: Math.round(viewport.left) + 'px', top: Math.round(viewport.top) + 'px',
    width: w + 'px', height: h + 'px',
    maxWidth: 'none', maxHeight: 'none',
    transform: 'none', zIndex: '0'
  });
}
function vibrateGame(pattern = 12) {
  if (!gameSettings.haptics || !isMobileDevice || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
}
function getRenderPixelRatioCap(width = window.innerWidth, height = window.innerHeight) {
  const landscapeMobile = isMobileDevice && width > height;
  const quality = gameSettings.graphicsQuality;
  // Celulares não devem renderizar acima de 1:1 por padrão: evita excesso de pixels
  // sem deixar a escala cair para uma imagem muito borrada.
  if (quality === 'low') return isMobileDevice ? (landscapeMobile ? 1.02 : 0.96) : 1.0;
  if (quality === 'high') return isMobileDevice ? (landscapeMobile ? 1.38 : 1.24) : 1.85;
  return isMobileDevice ? (landscapeMobile ? 1.14 : 1.04) : 1.55;
}
function getMinimumRenderPixelRatio(width = window.innerWidth, height = window.innerHeight) {
  // Never upscale beyond the device's own DPR: it costs GPU time without adding detail.
  // Keep the same lower bounds as the adaptive scaler so a resize cannot undo FPS recovery.
  const hardwareDpr = Math.max(0.5, Number(devicePixelRatio) || 1);
  const floor = !isMobileDevice ? 0.65
    : gameSettings.graphicsQuality === 'low' ? 0.82
    : gameSettings.graphicsQuality === 'high' ? 0.94 : 0.88;
  return Math.min(hardwareDpr, floor);
}
function applyGraphicsQuality() {
  const quality = gameSettings.graphicsQuality;
  const viewport = getEffectiveViewport();
  renderPixelRatioCap = getRenderPixelRatioCap(viewport.width, viewport.height);
  adaptivePixelRatio = Math.max(getMinimumRenderPixelRatio(viewport.width, viewport.height), Math.min(devicePixelRatio || 1, renderPixelRatioCap));
  if (quality === 'low') adaptivePixelRatio = Math.min(adaptivePixelRatio, isMobileDevice ? 0.92 : 1.0);
  if (renderer) {
    renderer.setPixelRatio(adaptivePixelRatio);
    renderer.toneMappingExposure = quality === 'high' ? 1.30 : quality === 'low' ? 1.14 : 1.22;
    syncRendererSize();
    renderer.shadowMap.enabled = !isMobileDevice && quality === 'high';
    renderer.shadowMap.needsUpdate = true;
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopGameAnimationLoop();
    // Uma prévia offline não continua recebendo ataques enquanto o app está em segundo plano.
    if (offlineMode && offlineLoop) {
      clearInterval(offlineLoop);
      offlineLoop = null;
    }
    if (backgroundMusic) backgroundMusic.pause();
    if (audioContext && audioContext.state === 'running') audioContext.suspend().catch(() => {});
  } else {
    // Retoma animação e simulação offline apenas quando o app volta ao primeiro plano.
    startGameAnimationLoop();
    if (offlineMode && !offlineLoop) offlineLoop = setInterval(stepOfflineSimulation, 220);
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
      // RandomMind, “Medieval: The Old Tower Inn” (CC0). Música medieval instrumental para ambientação RPG.
      backgroundMusic = new Audio('https://opengameart.org/sites/default/files/The_Old_Tower_Inn.mp3');
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
  return list;
})();
function isDungeonPositionBlocked(x,z){
  const playerRadius=.43;
  if(offlineMode&&offlineState?.started){
    const phase=Math.max(1,Math.min(5,Number(offlineState.phase)||1));
    const gateZ=phase<5?-(30+(phase-1)*32):-168;
    const enemiesAlive=offlineLivingMonsters().length>0||!!offlineState.boss?.alive;
    if(enemiesAlive&&Math.abs(z-gateZ)<.62&&Math.abs(x)<13.2)return true;
  }
  // Os pilares do Mundo Monocromático só existem no primeiro mundo.
  if (currentRealmVisual === 1) {
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
  const x = THREE.MathUtils.clamp(nextX, -13, 13);
  const z = THREE.MathUtils.clamp(nextZ, -174, 8);
  // Resolve each axis independently so a corner collision doesn't trap the player.
  const canMoveX = !isDungeonPositionBlocked(x, fromZ);
  const canMoveZ = !isDungeonPositionBlocked(fromX, z);
  if (canMoveX && canMoveZ) {
    if (!isDungeonPositionBlocked(x, z)) return { x, z };
    // Prefer the axis with more progress when the diagonal is blocked.
    const progressX = Math.abs(x - fromX);
    const progressZ = Math.abs(z - fromZ);
    if (progressX >= progressZ) return { x, z: fromZ };
    return { x: fromX, z };
  }
  if (canMoveX) return { x, z: fromZ };
  if (canMoveZ) return { x: fromX, z };
  return { x: fromX, z: fromZ };
}
let renderPixelRatioCap = getRenderPixelRatioCap();
let adaptivePixelRatio = Math.max(getMinimumRenderPixelRatio(), Math.min(devicePixelRatio || 1, renderPixelRatioCap));
let perfBadge = null, perfFrames = 0, perfWindowStart = performance.now();
let lastFps = 0, measuredPing = null, slowFpsSamples = 0, fastFpsSamples = 0;
let adaptiveDetailTier = 0;

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d14);
  scene.fog = new THREE.FogExp2(0x101a29, isMobileDevice ? .0036 : .0042);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 230);
  renderer = new THREE.WebGLRenderer({
    // MSAA é caro em GPUs móveis; a escala de render adaptativa preserva detalhes sem esse custo.
    antialias: !isMobileDevice,
    powerPreference: isMobileDevice && gameSettings.graphicsQuality === 'low' ? 'low-power' : 'high-performance',
    stencil: false
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  renderer.setPixelRatio(adaptivePixelRatio);
  syncRendererSize();
  // Sombras suaves no PC; no celular ficam desligadas para preservar FPS.
  renderer.shadowMap.enabled = !isMobileDevice && gameSettings.graphicsQuality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (typeof surfaceTexture !== 'undefined') {
    surfaceTexture.anisotropy = Math.min(isMobileDevice ? (gameSettings.graphicsQuality === 'low' ? 2 : 4) : 8, renderer.capabilities.getMaxAnisotropy());
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
  dayNightHemisphereLight = new THREE.HemisphereLight(0xc8e2ff, 0x302339, 2.72);
  scene.add(dayNightHemisphereLight);
  // Luz principal dinâmica: acompanha o ciclo de dia/noite sem criar luzes por frame.
  const fillLight = new THREE.DirectionalLight(0x9dc5ff, 0.92);
  dayNightSunLight = fillLight;
  fillLight.position.set(8, 7, -18);
  scene.add(fillLight);
  const warmRimLight = new THREE.DirectionalLight(0xffd7a1, 0.78);
  warmRimLight.position.set(-3, 6, 10);
  if (!isMobileDevice) scene.add(warmRimLight);
  // Luz ambiente global também no celular: sem ela, áreas sem luz direta ficam quase pretas.
  // AmbientLight é barata e ilumina personagens, chão e cenário sem criar sombras extras.
  const ambientFill = new THREE.AmbientLight(0x9bb8d8, isMobileDevice ? 0.82 : 0.34);
  scene.add(ambientFill);
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
  dayNightMoonLight = moon;
  moon.position.set(-6, 12, 5);
  moon.castShadow = !isMobileDevice;
  moon.shadow.mapSize.set(1024, 1024);
  moon.shadow.camera.left = -22;
  moon.shadow.camera.right = 22;
  moon.shadow.camera.top = 18;
  moon.shadow.camera.bottom = -18;
  moon.shadow.bias = -0.00025;
  if (!isMobileDevice) scene.add(moon);

  buildDungeon();
  buildDungeonVisualPass();
  createPlayer();
  initLobby3DPreview();
  onResize();
  animate();
}

let softContactShadowTexture = null;
function updateDayNightCycle(worldTime) {
  if (!scene || !dayNightHemisphereLight || !dayNightSunLight) return;
  // Um dia completo dura quatro minutos reais; o ciclo começa de dia para facilitar a leitura.
  const phase = ((worldTime / 240) + 0.25) % 1;
  const sunAngle = phase * Math.PI * 2;
  const rawDaylight = (Math.sin(sunAngle) + 0.18) / 1.18;
  const daylight = THREE.MathUtils.smoothstep(rawDaylight, 0, 1);
  const night = 1 - daylight;
  const realmTint = currentRealmVisual === 3 ? 0.12 : currentRealmVisual === 2 ? 0.07 : 0;

  dayNightSunLight.position.set(Math.cos(sunAngle) * 18, Math.max(-3, Math.sin(sunAngle) * 15 + 1), 4);
  dayNightSunLight.intensity = (isMobileDevice ? 0.42 : 0.18) + daylight * (isMobileDevice ? 1.28 : 1.18);
  dayNightSunLight.color.setRGB(
    0.42 + daylight * 0.58,
    0.52 + daylight * 0.42,
    0.78 - daylight * 0.12
  );
  dayNightHemisphereLight.intensity = (isMobileDevice ? 1.28 : 0.62) + daylight * (isMobileDevice ? 1.55 : 1.72);
  dayNightHemisphereLight.color.setRGB(0.16 + daylight * 0.62, 0.22 + daylight * 0.58, 0.48 + daylight * 0.46);
  dayNightHemisphereLight.groundColor.setRGB(0.025 + daylight * 0.15, 0.035 + daylight * 0.13, 0.075 + daylight * 0.10);
  if (dayNightMoonLight) dayNightMoonLight.intensity = isMobileDevice ? 0 : 0.08 + night * 0.82;

  const skyR = (isMobileDevice ? 0.026 : 0.012) + daylight * (0.075 - realmTint * 0.08);
  const skyG = (isMobileDevice ? 0.034 : 0.018) + daylight * (0.135 - realmTint * 0.18);
  const skyB = (isMobileDevice ? 0.062 : 0.038) + daylight * (0.23 + realmTint * 0.24);
  if (scene.background?.isColor) scene.background.setRGB(skyR, skyG, skyB);
  if (scene.fog) scene.fog.color.setRGB(skyR, skyG, skyB);
}

function getSoftContactShadowTexture() {
  if (softContactShadowTexture) return softContactShadowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64,64,4,64,64,62);
  gradient.addColorStop(0,'rgba(0,0,0,0.56)');
  gradient.addColorStop(.35,'rgba(0,0,0,0.30)');
  gradient.addColorStop(.72,'rgba(0,0,0,0.09)');
  gradient.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
  softContactShadowTexture = new THREE.CanvasTexture(canvas);
  softContactShadowTexture.colorSpace = THREE.SRGBColorSpace;
  return softContactShadowTexture;
}
function addSoftContactShadow(group, radius = .58, opacity = .64) {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2.6, radius * 2.6),
    new THREE.MeshBasicMaterial({map:getSoftContactShadowTexture(),transparent:true,opacity,depthWrite:false,toneMapped:false})
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .035;
  shadow.renderOrder = 1;
  group.add(shadow);
  return shadow;
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
  const textureRepeat = gameSettings.graphicsQuality === 'low' ? 3.5 : gameSettings.graphicsQuality === 'high' ? 6 : 5;
  const surfaceBumpScale = gameSettings.graphicsQuality === 'low' ? .007 : gameSettings.graphicsQuality === 'high' ? .016 : .012;
  dungeonTexture.repeat.set(textureRepeat, textureRepeat);
  const floor = mat(0x303744, .82, .08);
  floor.map = dungeonTexture;
  floor.bumpMap = isMobileDevice ? null : dungeonTexture;
  floor.bumpScale = surfaceBumpScale;
  floor.needsUpdate = true;
const wall = mat(0x414751, 0.95);
wall.map = dungeonTexture;
wall.bumpMap = isMobileDevice ? null : dungeonTexture;
wall.bumpScale = surfaceBumpScale * 1.35;
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
    zone.top.bumpMap = isMobileDevice ? null : dungeonTexture;
    zone.top.bumpScale = .012;
    zone.top.needsUpdate = true;
    box(30,.8,zone.depth,floor,0,-.5,zone.z);
    box(29.6,.08,zone.depth-.5,zone.top,0,-.055,zone.z);
    // Paredes separadas por mundo; os portais marcam as passagens entre biomas.
    box(.7,5,zone.depth,wall,-15,2,zone.z);
    box(.7,5,zone.depth,wall,15,2,zone.z);
  }

  // Marcas do piso em instâncias: muitos detalhes com uma única chamada de desenho.
  const tileMat = mat(0x3b4451,.96,.025);
  tileMat.map = dungeonTexture;
  tileMat.needsUpdate = true;
  const tileGeometry = new THREE.BoxGeometry(2.88,.025,2.88);
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
  const groutMat = mat(0x252c36,.98);
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
  // O perímetro de fundo e início foi criado acima; não duplicar as mesmas paredes.

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
    const ring=new THREE.Mesh(new THREE.PlaneGeometry(5.7,3.8),new THREE.MeshBasicMaterial({color:0x23b9ff,transparent:true,opacity:.25,side:THREE.DoubleSide,depthWrite:false}));ring.position.set(0,2.1,0);gate.add(ring);
    const barrierMat=new THREE.MeshBasicMaterial({color:0x35cfff,transparent:true,opacity:.52,side:THREE.DoubleSide,depthWrite:false});
    const barrier=new THREE.Mesh(new THREE.PlaneGeometry(26.2,4.55),barrierMat);barrier.position.set(0,2.28,.12);barrier.renderOrder=12;gate.add(barrier);
    const barrierLines=new THREE.Group();
    const barrierLineMat=new THREE.MeshBasicMaterial({color:0xb8f7ff,transparent:true,opacity:.42,depthWrite:false});
    for(let x=-12;x<=12;x+=3){const runeLine=new THREE.Mesh(new THREE.BoxGeometry(.035,3.85,.025),barrierLineMat);runeLine.position.set(x,0,.035);barrierLines.add(runeLine);}
    for(let y=-1.25;y<=1.26;y+=1.25){const cross=new THREE.Mesh(new THREE.BoxGeometry(25.5,.025,.025),barrierLineMat);cross.position.set(0,y,.04);barrierLines.add(cross);}
    barrierLines.position.y=2.28;barrierLines.position.z=.15;gate.add(barrierLines);
    const bars = new THREE.Group();
    for (let x = -2.5; x <= 2.51; x += 1) { const bar = new THREE.Mesh(new THREE.BoxGeometry(.12, 3.7, .18), runeMat); bar.position.set(x, 1.95, -.05); bars.add(bar); }
    const portalMat = new THREE.MeshBasicMaterial({ color: 0x3edcff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(5.25, 3.55), portalMat);
    portal.position.set(0, 2.05, -.12); gate.add(portal);
    const portalRim = new THREE.Mesh(new THREE.TorusGeometry(1.42,.055,8,48), new THREE.MeshStandardMaterial({color:0x77edff,emissive:0x159dcc,emissiveIntensity:1.8,metalness:.35,roughness:.25}));
    portalRim.position.set(0,2.05,-.2); portalRim.scale.set(1.55,1.25,1); gate.add(portalRim);
    gate.add(bars);gate.position.z=z;gate.userData.bars=bars;gate.userData.ring=ring;gate.userData.portal=portal;gate.userData.portalRim=portalRim;gate.userData.barrier=barrier;gate.userData.open=false;activeEnvironmentGroup.add(gate);gateMeshes.push(gate);
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

  const particleCount = isMobileDevice
    ? (gameSettings.graphicsQuality === 'low' ? 12 : gameSettings.graphicsQuality === 'high' ? 22 : 17)
    : (gameSettings.graphicsQuality === 'high' ? 44 : 28);
  const particlePositions = new Float32Array(particleCount * 3);
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




function addZoneLandmarks(parent,palette){
  if(!parent)return;
  const geometry=new THREE.DodecahedronGeometry(.34,0);
  const material=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffffff,emissiveIntensity:.32,metalness:.28,roughness:.42});
  const count=40,instances=new THREE.InstancedMesh(geometry,material,count),dummy=new THREE.Object3D();
  const centers=[-14,-46,-78,-110,-153];let index=0;
  centers.forEach((z,zone)=>{
    for(const side of [-1,1])for(let n=0;n<4;n++){
      const x=side*(10.5+(n%2)*1.25),offset=-6+n*4;
      dummy.position.set(x,.48+(n%3)*.08,z+offset);
      dummy.rotation.set(.12*(n%2),zone*.5+n*.73,side*.08);
      dummy.scale.set(.72+(n%2)*.18,1.2+(n%3)*.22,.7+(n%2)*.14);
      dummy.updateMatrix();instances.setMatrixAt(index,dummy.matrix);
      instances.setColorAt(index,new THREE.Color(palette[zone%palette.length]));index++;
    }
  });
  instances.count=index;instances.instanceMatrix.needsUpdate=true;
  if(instances.instanceColor)instances.instanceColor.needsUpdate=true;
  instances.name='world-landmark-instanced-set';parent.add(instances);
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
  addZoneLandmarks(detailGroup,[0x75eaff,0xb49aff,0x76f0ad,0xffa45e,0xff77b7]);
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
  // Pequenas pedras rúnicas dão escala ao caminho sem criar luzes dinâmicas extras.
  const runeStoneCount = isMobileDevice ? 8 : 16;
  for(let i=0;i<runeStoneCount;i++){
    const side=i%2===0?-1:1, z=-8-Math.random()*160;
    const stone=new THREE.Mesh(new THREE.DodecahedronGeometry(.22+Math.random()*.16,0),i%3===0?cyanMat:deepStone);
    stone.position.set(side*(10.1+Math.random()*2.1),.16,z); stone.rotation.set(Math.random()*.3,Math.random()*Math.PI,Math.random()*.3);
    stone.scale.set(.8,.65,1.15); activeEnvironmentGroup.add(stone);
    if(i%3===0){const mark=new THREE.Mesh(new THREE.TorusGeometry(.16,.018,5,16),crystalMat);mark.position.set(stone.position.x,.26,z);mark.rotation.x=Math.PI/2;activeEnvironmentGroup.add(mark);}
  }
  for(const z of [-30,-62,-94,-126]){
    const arch=new THREE.Group(),frame=new THREE.MeshStandardMaterial({color:0x68569e,emissive:0x4c35aa,emissiveIntensity:1.15,metalness:.35,roughness:.28});
    for(const x of [-3.15,3.15]){const p=new THREE.Mesh(new THREE.BoxGeometry(.3,4.2,.35),frame);p.position.set(x,2.1,0);arch.add(p);}
    const top=new THREE.Mesh(new THREE.BoxGeometry(6.6,.32,.4),frame);top.position.set(0,4.22,0);arch.add(top);
    const loop=new THREE.Mesh(new THREE.TorusGeometry(1.72,.065,8,48),new THREE.MeshStandardMaterial({color:0x9e83ff,emissive:0x754dff,emissiveIntensity:1.8,roughness:.25,metalness:.2}));loop.position.set(0,2.08,-.1);loop.scale.set(1.45,1.12,1);arch.add(loop);
    const veil=new THREE.Mesh(new THREE.PlaneGeometry(5.15,3.6),new THREE.MeshBasicMaterial({color:0x6639d9,transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}));veil.position.set(0,2.08,-.08);arch.add(veil);
    for(const side of [-1,1]){const lamp=new THREE.Mesh(new THREE.OctahedronGeometry(.16,1),cyanMat);lamp.position.set(side*2.8,.45,-.12);arch.add(lamp);}
    arch.position.z=z;activeEnvironmentGroup.add(arch);
  }
  const starCount = gameSettings.graphicsQuality === 'low' ? (isMobileDevice ? 45 : 70) : gameSettings.graphicsQuality === 'high' ? (isMobileDevice ? 100 : 260) : (isMobileDevice ? 90 : 180);
  const starPositions = new Float32Array(starCount * 3);
  for(let i=0;i<starCount;i++){starPositions[i*3]=(Math.random()-.5)*105;starPositions[i*3+1]=4+Math.random()*34;starPositions[i*3+2]=-184+Math.random()*198;}
  const starGeometry=new THREE.BufferGeometry();starGeometry.setAttribute('position',new THREE.BufferAttribute(starPositions,3));
  astralStarField=new THREE.Points(starGeometry,new THREE.PointsMaterial({color:0xd9d1ff,size:isMobileDevice?0.11:0.16,transparent:true,opacity:.78,depthWrite:false}));activeEnvironmentGroup.add(astralStarField);
  for(let i=0;i<12;i++){const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.28+Math.random()*.28,0),i%3===0?cyanMat:crystalMat);crystal.position.set((Math.random()-.5)*20,1.4+Math.random()*2.3,-5-Math.random()*165);crystal.rotation.set(Math.random()*3,Math.random()*3,Math.random()*3);activeEnvironmentGroup.add(crystal);astralFloaters.push({mesh:crystal,baseY:crystal.position.y,phase:Math.random()*Math.PI*2,speed:.45+Math.random()*.65});}
  if(!isMobileDevice){const l=new THREE.PointLight(0x9168ff,25,62,2);l.position.set(0,5,-78);activeEnvironmentGroup.add(l);const sky=new THREE.PointLight(0x39cfff,17,52,2);sky.position.set(-8,4,-150);activeEnvironmentGroup.add(sky);}
  addZoneLandmarks(astral,[0x9c86ff,0x61eaff,0xa5f0cc,0xffc57b,0xf179ab]);
  environmentGroups.astral=activeEnvironmentGroup;activeEnvironmentGroup.visible=false;activeEnvironmentGroup=null;
  buildEclipseWorld();
}

let eclipsePortal=null;

function buildEclipseWorld(){
  const source=environmentGroups.astral;
  if(!source)return;
  const eclipse=source.clone(true);eclipse.name='environment-eclipse-selvagem';
  const palette=[0x2b4025,0x4d6330,0x304a2a,0x57452a,0x7a3340];
  let index=0;
  eclipse.traverse(node=>{
    if(!node.isMesh)return;
    if(Array.isArray(node.material))node.material=node.material.map(m=>m.clone());
    else if(node.material)node.material=node.material.clone();
    const mats=Array.isArray(node.material)?node.material:[node.material];
    for(const material of mats){
      if(material.color)material.color.setHex(palette[index%palette.length]);
      if(material.emissive){material.emissive.setHex(index%2?0x382018:0x19331b);material.emissiveIntensity=Math.max(.25,material.emissiveIntensity||.3);}
      if('roughness' in material)material.roughness=Math.min(.92,(material.roughness||.5)+.12);
    }
    index++;
  });
  const frame=new THREE.MeshStandardMaterial({color:0x9a3f45,emissive:0x5d1524,emissiveIntensity:1.3,metalness:.5,roughness:.25});
  eclipsePortal=new THREE.Group();
  const arch=new THREE.Mesh(new THREE.TorusGeometry(1.72,.095,10,64),frame);arch.scale.set(1.48,1.17,1);arch.position.set(0,2.08,-.3);eclipsePortal.add(arch);
  const core=new THREE.Mesh(new THREE.CircleGeometry(1.52,40),new THREE.MeshBasicMaterial({color:0x7b2945,transparent:true,opacity:.22,side:THREE.DoubleSide}));core.position.set(0,2.08,-.24);eclipsePortal.add(core);
  const glow=new THREE.PointLight(0xe34d5c,.45,14,2);glow.position.set(0,2.1,0);eclipsePortal.add(glow);
  eclipsePortal.position.set(0,0,-168);eclipsePortal.userData.open=false;source.add(eclipsePortal);
  scene.add(eclipse);eclipse.visible=false;environmentGroups.eclipse=eclipse;
}
function showRealmTransition(realm){
  const overlay=$('phaseTransition');if(!overlay)return;
  $('phaseTransitionTitle').textContent=realm===3?'ECLIPSE SELVAGEM':realm===2?'VALE ASTRAL':'MUNDO MONOCROMÁTICO';
  $('phaseTransitionSub').textContent=realm===3?'MUNDO III · CINCO REGIÕES · O SOBERANO DO ECLIPSE':realm===2?'MUNDO II · CINCO REGIÕES · UM NOVO GUARDIÃO':'MUNDO I · CINCO REGIÕES · SOBREVIVA À MASMORRA';
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
  const size = gameSettings.graphicsQuality === 'low' ? 192
    : gameSettings.graphicsQuality === 'high' ? (isMobileDevice ? 320 : 512) : 256;
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
  for (let i = 0; i < Math.round(420 * (size / 256) ** 2); i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const w = 2 + Math.random() * 23, h = .5 + Math.random() * 2;
    ctx.fillStyle = Math.random() > .5 ? '#edf3fc' : '#1b222e';
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = .2;
  ctx.strokeStyle = '#202632';
  ctx.lineWidth = .8;
  for (let i = 0; i < Math.round(20 * (size / 256) ** 2); i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - .5) * 24, y + 4 + Math.random() * 22);
    ctx.lineTo(x + (Math.random() - .5) * 36, y + 10 + Math.random() * 34);
    if (Math.random() > .45) ctx.lineTo(x + (Math.random() - .5) * 48, y + 18 + Math.random() * 48);
    ctx.stroke();
  }
  ctx.globalAlpha = .12;
  for (let i = 0; i < Math.round(90 * (size / 256) ** 2); i++) {
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
  // Rebuild visual: fewer overlapping decorations, clearer silhouettes and stronger class identity.
  const g = new THREE.Group();
  const contactShadow = addSoftContactShadow(g, heroClass === 'ogre' || heroClass === 'golem' ? .78 : .58, .58);
  contactShadow.position.y = .03;
  const palettes = {
    knight:{armor:0x3269c4,dark:0x17283e,trim:0xf1c75b,glow:0x79e7ff,cloth:0x173b71,skin:0xd2a27f},
    mage:{armor:0x5f59cf,dark:0x271b58,trim:0xe9ca77,glow:0xd18bff,cloth:0x34246e,skin:0xd5a986},
    archer:{armor:0x3f8758,dark:0x263d31,trim:0xd7b66e,glow:0x8af7c4,cloth:0x174d36,skin:0xc99673},
    goblin:{armor:0x77b943,dark:0x293522,trim:0xeec85e,glow:0xffe77a,cloth:0x426528,skin:0x91b94a},
    ogre:{armor:0xa95739,dark:0x4a2b24,trim:0xd6b172,glow:0xffa46b,cloth:0x6b3427,skin:0x987755},
    healer:{armor:0xe6e7dd,dark:0x315b64,trim:0xe7c879,glow:0x83ffe0,cloth:0x2e6471,skin:0xd9b496},
    necromancer:{armor:0x483650,dark:0x17121f,trim:0x9d7ac4,glow:0xd17cff,cloth:0x302035,skin:0xa59aa7},
    monk:{armor:0xc67b3c,dark:0x53332a,trim:0xf0d7a1,glow:0xffe18b,cloth:0x9c3d32,skin:0xc99770},
    golem:{armor:0x737e83,dark:0x384249,trim:0xb3b9b5,glow:0xd8ffab,cloth:0x414c51,skin:0x777f83},
    golem_clone:{armor:0x858d91,dark:0x424b50,trim:0xbfc4be,glow:0xd9e5cb,cloth:0x424b50,skin:0x858d91},
    skeleton:{armor:0xd7d0bd,dark:0x292630,trim:0xb29a69,glow:0xd9bdff,cloth:0x514250,skin:0xe0dccb}
  };
  const base = palettes[heroClass] || palettes.knight;
  const skins = {
    default:{armor:color ?? base.armor,dark:base.dark,trim:base.trim,glow:base.glow,cloth:base.cloth},
    shadow:{armor:0x34394e,dark:0x10131c,trim:0x9d91d4,glow:0xc0aaff,cloth:0x202437},
    ember:{armor:0x9a482c,dark:0x371b18,trim:0xf0aa62,glow:0xff6b43,cloth:0x58271f},
    rune:{armor:0x246b85,dark:0x102b3b,trim:0x6feaf0,glow:0x67fff1,cloth:0x173f55},
    celestial:{armor:0xc8b778,dark:0x29364b,trim:0xfff0bb,glow:0xfff2bd,cloth:0x61748b},
    bloodmoon:{armor:0x8c2948,dark:0x270d20,trim:0xf07a9c,glow:0xff527e,cloth:0x461329},
    frostguard:{armor:0x669eb9,dark:0x203144,trim:0xc9efff,glow:0x91eaff,cloth:0x2b526e},
    draconic:{armor:0x963d33,dark:0x32191c,trim:0xffc56c,glow:0xff654d,cloth:0x572329},
    voidwalker:{armor:0x56417f,dark:0x1d1830,trim:0xb796ff,glow:0xdf9bff,cloth:0x2d234b},
    verdant:{armor:0x477c4a,dark:0x1c3228,trim:0xc4d97a,glow:0x90f28c,cloth:0x2c583e}
  };
  const p = skins[skin] || skins.default;
  const isStoneBody = heroClass === 'golem' || heroClass === 'golem_clone';
  const armorOptions = {color:p.armor,metalness:heroClass==='monk'||heroClass==='ogre'||heroClass==='goblin'?.22:.48,roughness:heroClass==='golem'||heroClass==='golem_clone'?.86:.34,flatShading:isStoneBody};
  const armor = isMobileDevice
    ? new THREE.MeshStandardMaterial(armorOptions)
    : new THREE.MeshPhysicalMaterial({...armorOptions,clearcoat:.18,clearcoatRoughness:.48});
  const dark = new THREE.MeshStandardMaterial({color:p.dark,roughness:.72,metalness:.12});
  const trim = new THREE.MeshStandardMaterial({color:p.trim,roughness:.3,metalness:.62});
  const glow = new THREE.MeshStandardMaterial({color:p.glow,emissive:p.glow,emissiveIntensity:1.45,roughness:.24,metalness:.22});
  const cloth = new THREE.MeshStandardMaterial({color:p.cloth,roughness:.88,metalness:.02});
  const skinMat = new THREE.MeshStandardMaterial({color:base.skin,roughness:.79});
  const steel = new THREE.MeshStandardMaterial({color:heroClass==='golem'?0x69757c:0xbecbd6,roughness:.28,metalness:.72});
  const accent = new THREE.MeshStandardMaterial({color:base.glow,emissive:base.glow,emissiveIntensity:.48,roughness:.3,metalness:.35});
  const add = (geo, material, x,y,z,sx=1,sy=1,sz=1,parent=g) => {
    const m = new THREE.Mesh(geo,material); m.position.set(x,y,z); m.scale.set(sx,sy,sz);
    if(!isMobileDevice){m.castShadow=true;m.receiveShadow=true;} parent.add(m); return m;
  };
  const legs=[], arms=[], decorativeParts=[];
  const headRig = new THREE.Group(); headRig.position.y=1.78; g.add(headRig);
  const addHead = (geo,material,x,y,z,sx=1,sy=1,sz=1) => add(geo,material,x,y-1.78,z,sx,sy,sz,headRig);
  let torso=null, head=null, cape=null, classWeapon=null, classCharm=null, classShield=null, waistSigil=null;
  const clothClasses=['mage','archer','healer','necromancer'];
  const bulky=heroClass==='ogre'||heroClass==='golem'||heroClass==='golem_clone';
  const tiny=heroClass==='goblin';
  // Lower body: separate pivots give the gait a clear, readable stride.
  const legMat=heroClass==='golem'||heroClass==='golem_clone'?armor:dark;
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.position.set(side*(bulky?.29:.19),.64,0);g.add(pivot);
    if(heroClass==='golem'||heroClass==='golem_clone'){
      const shin=add(new THREE.BoxGeometry(.32,.38,.31),armor,0,-.22,0,1,.95,.9,pivot);
      shin.rotation.z=side*.08;
      const boot=add(new THREE.BoxGeometry(.34,.16,.38),dark,0,-.43,-.08,1,1,1,pivot);
      boot.rotation.y=side*.035;
      add(new THREE.BoxGeometry(.11,.035,.04),glow,0,-.25,-.19,1,1,.5,pivot);
    }else{
      const leg=add(new THREE.CylinderGeometry(tiny?.075:.105,tiny?.11:.145,.38,isMobileDevice?7:10),legMat,0,-.20,0,1,1,1,pivot);
      const knee=add(new THREE.DodecahedronGeometry(tiny?.085:.125,0),armor,0,-.08,-.125,1.1,.78,.48,pivot);
      knee.rotation.x=-.10;
      const boot=add(new THREE.BoxGeometry(tiny?.20:.27,.16,.40),steel,0,-.43,-.065,1,.86,1,pivot);
      add(new THREE.BoxGeometry(.20,.04,.045),trim,0,-.36,-.255,1,1,1,pivot);
      legs.push({mesh:pivot,side});
    }
    if(heroClass==='golem'||heroClass==='golem_clone') legs.push({mesh:pivot,side});
  }
  // Core torso: robe silhouettes for casters, hard angular masses for tanks.
  if(heroClass==='golem'||heroClass==='golem_clone'){
    torso=add(new THREE.BoxGeometry(.88,.66,.62),armor,0,1.12,0,1.05,1.08,.98);
    torso.rotation.z=.035;
    torso.rotation.y=.025;
    add(new THREE.BoxGeometry(.54,.42,.20),dark,0,1.12,-.42,1,1,.75);
    waistSigil=add(new THREE.OctahedronGeometry(.17,0),glow,0,1.17,-.61,.8,1.18,.5);
    for(const side of [-1,1]){
      const shoulder=add(new THREE.BoxGeometry(.43,.34,.39),armor,side*.57,1.48,0,1,1,1);
      shoulder.rotation.z=side*-.14; shoulder.rotation.y=side*.08;
      add(new THREE.DodecahedronGeometry(.13,0),trim,side*.68,1.48,-.205,.8,1.05,.6);
      add(new THREE.ConeGeometry(.10,.28,5),dark,side*.63,1.76,.02).rotation.z=side*-.38;
      const hipPlate=add(new THREE.BoxGeometry(.34,.28,.31),armor,side*.53,.98,-.04,1,1,1);
      hipPlate.rotation.z=side*.06;
    }
  }else{
    const torsoGeometry = heroClass === 'ogre'
      ? new THREE.CapsuleGeometry(.34,.39,7,12)
      : new THREE.CylinderGeometry(heroClass === 'monk' ? .31 : .35, heroClass === 'monk' ? .25 : .245, .62, isMobileDevice ? 8 : 12, 1);
    torso=add(torsoGeometry,heroClass==='ogre'?skinMat:armor,0,1.10,0,heroClass==='ogre'?.98:1.0,heroClass==='ogre'?.98:1,heroClass==='ogre'?.92:.9);
    if(heroClass==='ogre'){
      const chestPlate=add(new THREE.BoxGeometry(.56,.32,.10),armor,0,1.21,-.34,1,.9,.7);
      chestPlate.rotation.z=-.035;
      add(new THREE.BoxGeometry(.10,.46,.035),trim,0,1.18,-.415);
      for(const side of [-1,1]){
        const pauldron=add(new THREE.DodecahedronGeometry(.19,0),armor,side*.45,1.43,0,1.15,.92,.95);
        pauldron.rotation.z=side*-.12;
        add(new THREE.BoxGeometry(.16,.055,.04),trim,side*.45,1.44,-.17);
      }
    }
    if(clothClasses.includes(heroClass)){
      add(new THREE.ConeGeometry(heroClass==='healer'?.42:.39,.78,8),cloth,0,.77,.02,1,1,.9);
      add(new THREE.BoxGeometry(.055,.51,.035),trim,0,.91,-.36);
      if(heroClass==='healer') add(new THREE.BoxGeometry(.31,.07,.04),glow,0,1.02,-.39);
    }else{
      add(new THREE.BoxGeometry(.50,.10,.38),dark,0,.89,0);
      add(new THREE.BoxGeometry(.10,.12,.05),trim,0,.89,-.22);
      add(new THREE.OctahedronGeometry(.12,1),accent,0,1.22,-.34,.85,1.15,.5);
      add(new THREE.TorusGeometry(.16,.018,5,18),trim,0,1.22,-.36).rotation.x=Math.PI/2;
    }
  }
  // Neck and collar connect the head to the torso instead of leaving a floating round head.
  if (!isStoneBody) {
    add(new THREE.CylinderGeometry(.085,.11,.18,8),skinMat,0,1.52,-.005);
    const collar = add(new THREE.TorusGeometry(.125,.025,5,16),trim,0,1.58,-.01);
    collar.rotation.x = Math.PI / 2;
  }
  const chestEmblem = add(new THREE.OctahedronGeometry(.085,0),accent,0,1.22,-.365,.9,1.18,.55);
  chestEmblem.rotation.set(.18,.12,.08);
  // Arms use shoulder pivots, tapered forearms, articulated elbows and visible gloves.
  for(const side of [-1,1]){
    const pivot=new THREE.Group();pivot.position.set(side*(bulky?.53:.43),1.40,0);g.add(pivot);
    const armMaterial=heroClass==='ogre'||heroClass==='monk'||heroClass==='goblin'?skinMat:(heroClass==='golem'||heroClass==='golem_clone'?armor:armor);
    if(heroClass==='golem'||heroClass==='golem_clone'){
      const forearm=add(new THREE.BoxGeometry(.29,.34,.30),armMaterial,0,-.18,0,1.0,1.0,1.0,pivot);
      forearm.rotation.z=side*.07;
      const fist=add(new THREE.BoxGeometry(.34,.35,.32),armor,0,-.49,-.03,1.02,.98,1.04,pivot);
      fist.rotation.z=side*.12; fist.rotation.y=side*.05;
      add(new THREE.BoxGeometry(.09,.035,.035),glow,0,-.48,-.23,1,1,.5,pivot);
    }else{
      const upper=add(new THREE.CylinderGeometry(heroClass==='ogre'?.13:.09,heroClass==='ogre'?.17:.125,.34,isMobileDevice?7:10),armMaterial,0,-.15,0,1,1,1,pivot);
      upper.rotation.z=side*-.08;
      const elbow = new THREE.Group(); elbow.position.set(0,-.31,-.02); pivot.add(elbow);
      add(new THREE.DodecahedronGeometry(.075,0),steel,0,0,-.005,1,.92,.9,elbow);
      add(new THREE.CylinderGeometry(.075,.105,.25,isMobileDevice?7:9),heroClass==='monk'?skinMat:dark,0,-.14,0,1,1,1,elbow);
      add(new THREE.BoxGeometry(.17,.13,.15),steel,0,-.29,-.025,1,1,1,elbow);
      add(new THREE.BoxGeometry(.15,.13,.14),dark,0,-.39,-.01,.9,.9,.9,elbow);
      pivot.userData.elbow = elbow;
    }
    arms.push({mesh:pivot,side});
    if (isStoneBody) {
      const shoulderPlate=add(new THREE.BoxGeometry(.36,.29,.32),armor,side*(bulky?.53:.43),1.42,0,1.08,.92,1);
      shoulderPlate.rotation.z=side*-.12;
    } else {
      const shoulderPlate = add(new THREE.DodecahedronGeometry(.17,0),armor,side*(bulky?.53:.43),1.42,0,1.18,.86,.94);
      shoulderPlate.rotation.z = side * -.12;
      add(new THREE.BoxGeometry(.20,.045,.035),trim,side*(bulky?.53:.43),1.42,-.155,1,1,1);
    }
    if(heroClass!=='mage'&&heroClass!=='healer'&&heroClass!=='necromancer') add(new THREE.OctahedronGeometry(.045,0),trim,side*(bulky?.53:.43),1.45,-.14);
  }
  // A headgroup gives each class a distinct silhouette and visible facial focus.
  if(heroClass==='golem'||heroClass==='golem_clone'){
    head=addHead(new THREE.DodecahedronGeometry(.30,0),armor,0,1.92,-.01,1.08,1,.9);
    for(const side of [-1,1]){
      addHead(new THREE.SphereGeometry(.052,10,8),glow,side*.105,1.94,-.27,1,.85,.55);
      addHead(new THREE.ConeGeometry(.09,.18,5),dark,side*.20,2.17,.0).rotation.z=side*-.35;
    }
    addHead(new THREE.BoxGeometry(.27,.045,.045),dark,0,1.82,-.265);
  }else if(heroClass==='knight'){
    head=addHead(new THREE.DodecahedronGeometry(.245,0),steel,0,1.91,0,1,1.08,.94);
    addHead(new THREE.BoxGeometry(.34,.20,.13),armor,0,1.91,-.11);
    addHead(new THREE.BoxGeometry(.24,.045,.035),glow,0,1.94,-.19);
    addHead(new THREE.ConeGeometry(.07,.25,5),trim,0,2.20,.01);
    addHead(new THREE.BoxGeometry(.24,.04,.05),trim,0,1.82,-.19);
  }else if(heroClass==='mage'||heroClass==='archer'||heroClass==='healer'||heroClass==='necromancer'){
    head=addHead(new THREE.SphereGeometry(.225,16,12),skinMat,0,1.88,-.005);
    const hoodColor=heroClass==='healer'?trim:cloth;
    addHead(new THREE.SphereGeometry(.26,14,10,0,Math.PI*2,0,Math.PI*.72),hoodColor,0,2.02,.02,1.08,.92,1);
    if(heroClass==='mage'||heroClass==='archer') addHead(new THREE.ConeGeometry(.22,.35,7),cloth,0,2.25,.03);
    if(heroClass==='necromancer'){
      addHead(new THREE.SphereGeometry(.16,12,10),steel,0,1.88,-.20,1,.8,.45);
      addHead(new THREE.BoxGeometry(.22,.06,.04),dark,0,1.92,-.25);
    }else{
      addHead(new THREE.BoxGeometry(.27,.055,.05),dark,0,1.91,-.21);
      for(const side of [-1,1]) addHead(new THREE.SphereGeometry(.035,10,8),glow,side*.085,1.92,-.24);
    }
  }else if(heroClass==='goblin'){
    head=addHead(new THREE.SphereGeometry(.23,14,10),skinMat,0,1.86,0,1.05,.95,.94);
    for(const side of [-1,1]){
      const ear=addHead(new THREE.ConeGeometry(.095,.36,5),skinMat,side*.27,2.04,.02,1,.9,.65);ear.rotation.z=side*-.75;
      addHead(new THREE.SphereGeometry(.036,10,8),glow,side*.085,1.88,-.21,.8,1,.5);
    }
    addHead(new THREE.BoxGeometry(.20,.075,.06),dark,0,1.77,-.22);
  }else if(heroClass==='ogre'){
    head=addHead(new THREE.SphereGeometry(.31,14,10),skinMat,0,1.91,-.01,1.18,1,.94);
    for(const side of [-1,1]){
      const tusk=addHead(new THREE.ConeGeometry(.06,.19,5),steel,side*.15,1.77,-.22);tusk.rotation.x=Math.PI;
      addHead(new THREE.SphereGeometry(.045,10,8),glow,side*.11,1.94,-.24);
      const horn=addHead(new THREE.ConeGeometry(.11,.26,5),dark,side*.22,2.19,0);horn.rotation.z=side*-.38;
    }
    addHead(new THREE.BoxGeometry(.24,.08,.06),dark,0,1.79,-.23);
  }else if(heroClass==='monk'){
    head=addHead(new THREE.SphereGeometry(.23,16,12),skinMat,0,1.88,0);
    addHead(new THREE.BoxGeometry(.44,.09,.31),cloth,0,2.02,.005);
    addHead(new THREE.BoxGeometry(.28,.035,.025),trim,0,2.01,-.18);
    for(const side of [-1,1]) addHead(new THREE.SphereGeometry(.035,10,8),dark,side*.08,1.90,-.22);
  }else{
    head=addHead(new THREE.SphereGeometry(.22,14,10),skinMat,0,1.88,0);
  }
  // Rosto v3: olhos com íris, sobrancelhas e expressão por classe.
  const faceEyes=[],faceBrows=[];
  const eyeWhite=new THREE.MeshStandardMaterial({color:0xf5efe3,roughness:.38});
  const pupilMat=new THREE.MeshStandardMaterial({color:heroClass==='mage'?0x392b8c:heroClass==='healer'?0x176d62:heroClass==='necromancer'?0x210b35:0x17202c,roughness:.28});
  const faceInk=new THREE.MeshStandardMaterial({color:0x211b1c,roughness:.72});
  const faceGlow=new THREE.MeshStandardMaterial({color:p.glow,emissive:p.glow,emissiveIntensity:1.15,roughness:.24});
  if(heroClass==='golem'||heroClass==='golem_clone'){
    for(const side of [-1,1]){
      const brow=addHead(new THREE.BoxGeometry(.105,.045,.075),dark,side*.105,2.015,-.255,1,.9,1);brow.rotation.z=side*-.16;faceBrows.push(brow);
      const pupil=addHead(new THREE.SphereGeometry(.022,8,6),dark,side*.105,1.94,-.305,.9,1,.6);
      faceEyes.push({mesh:pupil,baseX:pupil.position.x});
    }
    addHead(new THREE.BoxGeometry(.16,.035,.04),dark,0,1.78,-.29,1,.8,.7);
    for(let tooth=-1;tooth<=1;tooth++)addHead(new THREE.BoxGeometry(.025,.045,.025),trim,tooth*.045,1.755,-.316);
  }else if(heroClass==='knight'){
    for(const side of [-1,1]){
      const eye=addHead(new THREE.SphereGeometry(.037,9,7),faceGlow,side*.085,1.945,-.245,1,.72,.42);
      const pupil=addHead(new THREE.SphereGeometry(.014,8,6),dark,side*.085,1.945,-.265,.9,1,.55);
      faceEyes.push({mesh:pupil,baseX:pupil.position.x,eye});
      const brow=addHead(new THREE.BoxGeometry(.105,.024,.04),dark,side*.085,2.005,-.238);brow.rotation.z=side*-.10;faceBrows.push(brow);
    }
  }else if(heroClass==='necromancer'){
    for(const side of [-1,1]){
      const eye=addHead(new THREE.SphereGeometry(.045,9,7),faceGlow,side*.085,1.93,-.265,1,.72,.4);
      const pupil=addHead(new THREE.SphereGeometry(.016,8,6),dark,side*.085,1.93,-.284,.9,1,.5);
      faceEyes.push({mesh:pupil,baseX:pupil.position.x,eye});
      const brow=addHead(new THREE.BoxGeometry(.11,.025,.035),dark,side*.085,1.995,-.25);brow.rotation.z=side*-.12;faceBrows.push(brow);
    }
    for(let tooth=-1;tooth<=1;tooth++)addHead(new THREE.BoxGeometry(.018,.065,.025),trim,tooth*.045,1.82,-.272);
  }else{
    const eyeZ=heroClass==='ogre'?'-.302':heroClass==='goblin'?'-.245':'-.258';
    for(const side of [-1,1]){
      const eye=addHead(new THREE.SphereGeometry(.052,10,8),eyeWhite,side*.087,heroClass==='ogre'?1.95:1.92,Number(eyeZ),1.04,.9,.48);
      const iris=addHead(new THREE.SphereGeometry(.029,9,7),faceGlow,side*.087,heroClass==='ogre'?1.95:1.92,Number(eyeZ)-.021,1,.98,.45);
      const pupil=addHead(new THREE.SphereGeometry(.017,8,6),pupilMat,side*.087,heroClass==='ogre'?1.95:1.92,Number(eyeZ)-.037,1,.95,.4);
      const glint=addHead(new THREE.SphereGeometry(.008,6,5),eyeWhite,side*.078,heroClass==='ogre'?1.965:1.935,Number(eyeZ)-.047);
      faceEyes.push({mesh:pupil,baseX:pupil.position.x,eye,iris,glint});
      const brow=addHead(new THREE.BoxGeometry(.115,.026,.035),heroClass==='goblin'||heroClass==='ogre'?dark:cloth,side*.087,heroClass==='ogre'?2.035:1.995,Number(eyeZ)+.012,1,.9,1);
      brow.rotation.z=side*(heroClass==='healer'?.06:heroClass==='ogre'?.20:-.10);faceBrows.push(brow);
    }
    if(heroClass==='goblin'){
      addHead(new THREE.BoxGeometry(.14,.035,.035),faceInk,0,1.775,-.263);
      for(const side of [-1,1])addHead(new THREE.ConeGeometry(.026,.06,4),eyeWhite,side*.045,1.765,-.283);
    }else{
      const smile=addHead(new THREE.TorusGeometry(.052,.009,4,12,Math.PI),heroClass==='ogre'?faceInk:faceInk,0,1.805,Number(eyeZ)-.005,1,1,.55);
      smile.rotation.z=Math.PI;
      if(heroClass==='ogre'){
        addHead(new THREE.ConeGeometry(.035,.095,5),eyeWhite,-.115,1.79,-.31,1,1,.6).rotation.x=Math.PI;
        addHead(new THREE.ConeGeometry(.035,.095,5),eyeWhite,.115,1.79,-.31,1,1,.6).rotation.x=Math.PI;
      }else if(heroClass==='monk'||heroClass==='healer'){
        addHead(new THREE.BoxGeometry(.10,.018,.02),faceInk,0,1.81,Number(eyeZ)-.01);
      }else{
        addHead(new THREE.SphereGeometry(.022,7,6),skinMat,0,1.87,Number(eyeZ)-.008,.9,1,.55);
      }
    }
  }
  // Simple class gear that reads clearly at gameplay scale.
  if(heroClass==='knight'){
    classWeapon=new THREE.Group();
    add(new THREE.BoxGeometry(.055,.73,.045),steel,.58,1.02,-.12,1,1,1,classWeapon);
    add(new THREE.ConeGeometry(.07,.23,4),steel,.58,1.50,-.12,1,1,1,classWeapon);
    add(new THREE.BoxGeometry(.27,.055,.10),trim,.58,.66,-.12,1,1,1,classWeapon);
    add(new THREE.CylinderGeometry(.035,.04,.19,8),dark,.58,.54,-.12,1,1,1,classWeapon);
    g.add(classWeapon);
    classShield=new THREE.Group();
    add(new THREE.CylinderGeometry(.19,.22,.065,6),armor,-.55,1.04,-.18,1,1,1,classShield).rotation.x=Math.PI/2;
    add(new THREE.TorusGeometry(.19,.022,5,6),trim,-.55,1.04,-.22,1,1,.45,classShield).rotation.x=Math.PI/2;
    add(new THREE.OctahedronGeometry(.075,1),glow,-.55,1.04,-.25,1,1,.55,classShield);
    g.add(classShield);
  }else if(['mage','healer','necromancer'].includes(heroClass)){
    classWeapon=new THREE.Group();
    const staffMat=heroClass==='necromancer'?dark:trim;
    add(new THREE.CylinderGeometry(.035,.052,1.05,8),staffMat,.55,.99,-.03,1,1,1,classWeapon);
    const orb=add(new THREE.IcosahedronGeometry(.14,1),glow,.55,1.56,-.03,1,1,1,classWeapon);
    orb.userData.isOrb=true; classWeapon.userData.orb=orb;
    const halo=add(new THREE.TorusGeometry(.19,.022,6,18),glow,.55,1.56,-.03,1,1,.7,classWeapon);halo.rotation.x=Math.PI/2;classWeapon.userData.halo=halo;
    g.add(classWeapon);
    classCharm=new THREE.Group();add(new THREE.TorusGeometry(.11,.016,5,16),accent,0,0,0,1,1,1,classCharm);add(new THREE.OctahedronGeometry(.065,1),glow,0,.02,-.02);classCharm.position.set(-.35,1.46,-.28);g.add(classCharm);
  }else if(heroClass==='archer'){
    classWeapon=new THREE.Group();
    const bow=add(new THREE.TorusGeometry(.30,.035,5,18,Math.PI*1.3),trim,.57,1.10,-.06,1,1,1,classWeapon);bow.rotation.z=-Math.PI*.63;
    add(new THREE.CylinderGeometry(.008,.008,.54,5),steel,.45,1.10,-.06,1,1,1,classWeapon).rotation.z=.10;
    add(new THREE.CylinderGeometry(.06,.08,.42,7),dark,-.30,1.25,.20).rotation.z=-.25;
    g.add(classWeapon);
  }else if(heroClass==='goblin'){
    classWeapon=new THREE.Group();
    for(const side of [-1,1]){
      const dagger=add(new THREE.ConeGeometry(.055,.38,5),steel,side*.51,.91,-.12,1,1,1,classWeapon);dagger.rotation.z=Math.PI+side*.2;
      add(new THREE.CylinderGeometry(.027,.035,.14,6),trim,side*.51,.68,-.12,1,1,1,classWeapon);
    }g.add(classWeapon);
  }else if(heroClass==='ogre'){
    classWeapon=new THREE.Group();
    add(new THREE.CylinderGeometry(.055,.085,.78,8),dark,.60,.94,-.06,1,1,1,classWeapon).rotation.z=-.22;
    const headClub=add(new THREE.DodecahedronGeometry(.23,1),armor,.75,1.34,-.06,1.2,.9,.9,classWeapon);
    for(const side of [-1,1]) add(new THREE.ConeGeometry(.045,.14,5),trim,.75+side*.16,1.34,-.06,1,1,1,classWeapon);
    g.add(classWeapon);
  }else{
    classWeapon=new THREE.Group();g.add(classWeapon);
  }
  if(heroClass==='mage'||heroClass==='healer'||heroClass==='necromancer'||heroClass==='archer'){
    cape=add(new THREE.ConeGeometry(.31,.68,6),dark,0,.83,.27,1,.95,.35);
    cape.rotation.x=-.08;
  }else cape=null;
  const capeTails=[];
  if(cape){
    for(const side of [-1,1]){
      const tail=add(new THREE.ConeGeometry(.12,.38,5),cloth,side*.14,.50,.30,1,.85,.32);
      tail.rotation.z=side*-.12;capeTails.push(tail);
    }
  }
  // Silhueta v3: placas, rebites e emblema central, mantendo poucas geometrias no mobile.
  const chestEmblemColor=heroClass==='healer'?0x83ffe0:heroClass==='mage'||heroClass==='necromancer'?0xd18bff:heroClass==='goblin'?0xd6f77b:heroClass==='ogre'?0xffa46b:heroClass==='golem'||heroClass==='golem_clone'?0xd8ffab:0x79e7ff;
  const chestEmblemMat=new THREE.MeshStandardMaterial({color:chestEmblemColor,emissive:chestEmblemColor,emissiveIntensity:.62,metalness:.34,roughness:.3});
  if(heroClass!=='ogre'&&heroClass!=='golem'&&heroClass!=='golem_clone'){
    const crest=add(new THREE.OctahedronGeometry(.105,0),chestEmblemMat,0,1.22,-.405,.9,1.15,.48);
    crest.rotation.z=Math.PI/4;
    const belt=add(new THREE.BoxGeometry(.43,.075,.045),dark,0,.91,-.345);
    add(new THREE.BoxGeometry(.095,.105,.055),trim,0,.91,-.38);
  }else{
    const crest=add(new THREE.DodecahedronGeometry(.105,0),chestEmblemMat,0,1.26,-.47,.9,1.05,.5);
    crest.rotation.y=.2;
  }
  for(const side of [-1,1]){
    // Marcas de ombro identificam a classe sem aumentar o volume do personagem.
    const shoulderMark=add(new THREE.OctahedronGeometry(.065,0),chestEmblemMat,side*(bulky?.56:.46),1.47,-.18,.9,1.1,.55);
    shoulderMark.rotation.z=side*.28;
    if(heroClass!=='golem'&&heroClass!=='golem_clone'){
      add(new THREE.BoxGeometry(.11,.19,.035),trim,side*.245,.42,-.145,.82,1,.7);
    }
  }
  const ringColor=heroClass==='healer'?0x74ffd8:heroClass==='mage'||heroClass==='necromancer'?0xb697ff:heroClass==='golem'||heroClass==='golem_clone'?0xc4d0cf:heroClass==='ogre'?0xff9862:heroClass==='goblin'?0xc8f06b:heroClass==='archer'?0x88ffb4:0x75dfff;
  const ring=new THREE.Mesh(new THREE.RingGeometry(.43,.50,36),new THREE.MeshBasicMaterial({color:ringColor,transparent:true,opacity:.62,side:THREE.DoubleSide,depthWrite:false}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.025;g.add(ring);
  waistSigil=waistSigil||add(new THREE.OctahedronGeometry(.07,1),accent,0,.90,-.30,.9,1.1,.6);
  if(heroClass==='golem'||heroClass==='golem_clone'){
    // Cracks and runes are bright enough to read without covering the stone silhouette.
    for(let i=0;i<3;i++){
      const crack=add(new THREE.BoxGeometry(.018,.20,.014),glow,(i-1)*.12,1.12,-.59,1,1,1);
      crack.rotation.z=(i-1)*-.32;decorativeParts.push(crack);
    }
  }
  const scale=heroClass==='goblin'?.82:heroClass==='ogre'?1.14:heroClass==='golem'?1.16:heroClass==='golem_clone'?.78:heroClass==='monk'?.99:1.06;
  g.scale.setScalar(scale);
  g.userData.heroClass=heroClass;g.userData.heroSkin=skin;g.userData.idleSeed=Math.random()*Math.PI*2;
  g.userData.sword=classWeapon;g.userData.weaponRest={x:classWeapon.rotation.x,z:classWeapon.rotation.z,y:classWeapon.position.y};
  g.userData.headRig=headRig;g.userData.head=head;g.userData.torso=torso;g.userData.torsoBaseScaleY=torso?torso.scale.y:1;
  g.userData.legs=legs;g.userData.arms=arms;g.userData.cape=cape;g.userData.capeTails=capeTails;
  g.userData.classCharm=classCharm;g.userData.classShield=classShield;g.userData.decorativeParts=decorativeParts;
  g.userData.baseRing=ring;g.userData.waistSigil=waistSigil;g.userData.walkPhase=Math.random()*Math.PI*2;g.userData.baseY=0;
  g.userData.silhouetteProfile={heroClass};
  g.userData.faceEyes=faceEyes;
  g.userData.faceBrows=faceBrows;
  g.userData.visualModelRevision='humanoid-silhouette-v3';
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
  const head = new THREE.Mesh(new THREE.DodecahedronGeometry(.66, 1), dark); head.position.y = 2.85; head.scale.set(1.02, 1.12, .94); g.add(head);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(.78,.13,.16), bone); brow.position.set(0,3.03,-.53); brow.rotation.z=-.025; g.add(brow);
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(.22, .95, isMobileDevice ? 6 : 9), bone); horn.position.set(side * .48, 3.55, 0); horn.rotation.z = side * -.38; g.add(horn);
    const e = new THREE.Mesh(new THREE.SphereGeometry(.12, isMobileDevice ? 8 : 12, isMobileDevice ? 6 : 10), eye); e.position.set(side * .25, 2.9, -.59); g.add(e);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.22, .9, isMobileDevice ? 4 : 6, isMobileDevice ? 7 : 10), armor); arm.position.set(side * 1.12, 1.6, 0); arm.rotation.z = side * -.22; g.add(arm); bossArms.push({ mesh: arm, side });
    const claw = new THREE.Mesh(new THREE.ConeGeometry(.18, .55, 5), bone); claw.position.set(side * 1.2, .82, -.05); claw.rotation.z = Math.PI; g.add(claw);
  }
  // Armadura adicional e núcleo central: melhora a leitura do chefe a distância.
  // Placas sobrepostas no peito enquadram o núcleo e deixam o chefe mais distinto.
  for(let i=0;i<3;i++){
    const plate=new THREE.Mesh(new THREE.BoxGeometry(.34-i*.035,.16,.11),i===1?bone:armor);
    plate.position.set(0,2.18-i*.19,-.92); plate.rotation.z=(i-1)*.035; g.add(plate);
  }
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(.27,1),eye);
  core.position.set(0,1.78,-1.00); core.scale.set(.9,1.15,.62); g.add(core);
  const coreHalo = new THREE.Mesh(new THREE.TorusGeometry(.37,.04,7,32),
    new THREE.MeshStandardMaterial({color:0xb99aff,emissive:0x793bff,emissiveIntensity:1.25,metalness:.22,roughness:.28}));
  coreHalo.position.set(0,1.78,-.96); g.add(coreHalo);
  for (const side of [-1,1]) {
    const pauldron = new THREE.Mesh(new THREE.DodecahedronGeometry(.38,1),armor);
    pauldron.position.set(side*.91,2.18,-.08); pauldron.scale.set(1.12,.82,.86); g.add(pauldron);
    const shoulderMark=new THREE.Mesh(new THREE.TorusGeometry(.19,.025,6,20),eye);
    shoulderMark.position.set(side*.91,2.2,-.43); shoulderMark.scale.set(1,.78,.55); g.add(shoulderMark);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(.15,.43,6),bone);
    spike.position.set(side*1.02,2.55,-.02); spike.rotation.z=side*-.35; g.add(spike);
  }
  for (let i=0;i<3;i++) {
    const spine = new THREE.Mesh(new THREE.ConeGeometry(.14,.52,6),bone);
    spine.position.set((i-1)*.35,2.05,.60); spine.rotation.x=Math.PI/2; spine.rotation.z=(i-1)*-.12; g.add(spine);
  }
  // Chefe: máscara facial, mandíbula segmentada e marcas de fase.
  const bossFaceMat=new THREE.MeshStandardMaterial({color:0x4b344e,metalness:.35,roughness:.55});
  const bossDark=new THREE.MeshStandardMaterial({color:0x120f1b,roughness:.8});
  const bossGold=new THREE.MeshStandardMaterial({color:0xc49c65,metalness:.62,roughness:.32});
  for(const side of [-1,1]){
    const cheek=new THREE.Mesh(new THREE.DodecahedronGeometry(.20,0),armor);cheek.position.set(side*.40,2.66,-.48);cheek.scale.set(1,.8,.5);g.add(cheek);
    const pupil=new THREE.Mesh(new THREE.SphereGeometry(.052,8,6),bossDark);pupil.position.set(side*.25,2.91,-.705);g.add(pupil);
    const glint=new THREE.Mesh(new THREE.SphereGeometry(.018,6,5),new THREE.MeshBasicMaterial({color:0xffffff}));glint.position.set(side*.23,2.94,-.75);g.add(glint);
    const fang=new THREE.Mesh(new THREE.ConeGeometry(.075,.25,5),bone);fang.position.set(side*.27,2.48,-.57);fang.rotation.x=Math.PI;g.add(fang);
    const runeMark=new THREE.Mesh(new THREE.BoxGeometry(.07,.28,.035),bossGold);runeMark.position.set(side*.74,1.92,-.43);runeMark.rotation.z=side*.22;g.add(runeMark);
  }
  const jaw=new THREE.Mesh(new THREE.BoxGeometry(.44,.16,.18),bossFaceMat);jaw.position.set(0,2.48,-.52);g.add(jaw);
  for(let i=0;i<5;i++){
    const tooth=new THREE.Mesh(new THREE.ConeGeometry(.035,.12,4),bone);tooth.position.set((i-2)*.13,2.43,-.62);tooth.rotation.x=Math.PI;g.add(tooth);
  }
  const foreheadMark=new THREE.Mesh(new THREE.OctahedronGeometry(.13,0),bossGold);foreheadMark.position.set(0,3.22,-.57);foreheadMark.rotation.z=Math.PI/4;g.add(foreheadMark);
  const backSpines=[];
  for(let i=0;i<5;i++){
    const spine=new THREE.Mesh(new THREE.ConeGeometry(.12,.42,5),bone);spine.position.set((i-2)*.30,2.48,.62);spine.rotation.x=Math.PI/2.2;spine.rotation.z=(i-2)*-.10;g.add(spine);backSpines.push(spine);
  }
  g.userData.backSpines=backSpines;
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

function syncBossPortals(portals) {
  const incoming = new Set();
  for (const portalData of (Array.isArray(portals) ? portals : [])) {
    if (!portalData || !portalData.id) continue;
    const id = String(portalData.id);
    incoming.add(id);
    let group = bossPortalMeshes.get(id);
    if (!group) {
      group = new THREE.Group();
      const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffa344, transparent: true, opacity: .48, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, .09, 8, 36), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = .08;
      ring.renderOrder = 900;
      group.add(ring);
      const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xff3c67, transparent: true, opacity: .12, side: THREE.DoubleSide, depthWrite: false });
      const core = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32), coreMaterial);
      core.rotation.x = -Math.PI / 2;
      core.position.y = .045;
      core.renderOrder = 899;
      group.add(core);
      group.userData.portalRing = ring;
      group.userData.portalCore = core;
      scene.add(group);
      bossPortalMeshes.set(id, group);
    }
    group.position.set(Number(portalData.x) || 0, 0, Number(portalData.z) || 0);
    group.userData.portalData = portalData;
    group.visible = true;
  }
  for (const [id, group] of bossPortalMeshes) {
    if (!incoming.has(id)) {
      scene.remove(group);
      disposeObject3D(group);
      bossPortalMeshes.delete(id);
    }
  }
}

function syncBossTelegraphs(telegraphs) {
  const incoming = new Set();
  for (const t of (Array.isArray(telegraphs) ? telegraphs : [])) {
    if (!t || !t.id || !Number.isFinite(Number(t.x)) || !Number.isFinite(Number(t.z))) continue;
    const id = String(t.id); incoming.add(id);
    let mesh = bossTelegraphMeshes.get(id);
    if (!mesh) {
      const radius = Math.max(.5, Math.min(8, Number(t.radius) || 1.5));
      const material = new THREE.MeshBasicMaterial({color:0xff254f,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false});
      mesh = new THREE.Mesh(new THREE.CircleGeometry(radius,32),material);
      mesh.rotation.x = -Math.PI/2; mesh.position.y=.07; mesh.renderOrder=901;
      const edge = new THREE.Mesh(new THREE.RingGeometry(Math.max(.15,radius-.12),radius,32),new THREE.MeshBasicMaterial({color:0xff6b82,transparent:true,opacity:.95,side:THREE.DoubleSide,depthWrite:false}));
      edge.rotation.x=-Math.PI/2; edge.position.y=.075; edge.renderOrder=902; mesh.add(edge);
      scene.add(mesh); bossTelegraphMeshes.set(id,mesh);
    }
    mesh.userData.attackId = String(t.attackId || '');
    mesh.position.x=Number(t.x); mesh.position.z=Number(t.z);
    const remaining=Math.max(0,Number(t.impactAt||0)-Date.now());
    mesh.material.opacity=.18+.18*(1-Math.min(1,remaining/1500));
    mesh.visible=remaining>0;
  }
  for (const [id,mesh] of bossTelegraphMeshes) {
    if (!incoming.has(id)) { scene.remove(mesh); disposeObject3D(mesh); bossTelegraphMeshes.delete(id); }
  }
}

function canUseItemsNow(){
  if(offlineMode){const player=offlineState?.players?.[0];return !!offlineState?.started&&!!player&&Number(player.hp)>0;}
  return !!started&&!!myPlayer&&Number(myPlayer.userData.serverHp??100)>0&&!!ws&&ws.readyState===WebSocket.OPEN;
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
  recent=recent.filter(item=>(lootFilter==='all'||item.rarity===lootFilter)).slice(0,20);
  if (selectedItemId && !recent.some(item => String(item.id) === String(selectedItemId))) selectedItemId = recent.length ? String(recent[0].id) : null;
  if (!selectedItemId && recent.length) selectedItemId = String(recent[0].id);
  $('recentLoot').innerHTML=recent.length?recent.map(item=>'<div class="loot-entry"><button type="button" class="loot-item select-item rarity-'+item.rarity.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')+(String(item.id)===String(selectedItemId)?' selected':'')+'" data-item-id="'+escapeHTML(item.id)+'"><span>'+escapeHTML(item.name)+' <small>('+escapeHTML(item.rarity)+' · Poder '+(item.power||1)+'/5)</small></span><b>'+(String(item.id)===String(selectedItemId)?'✓':'+')+'</b></button><button type="button" class="loot-use-button" data-use-item="'+escapeHTML(item.id)+'" '+(!canUseItemsNow()?'disabled':'')+' aria-label="Usar '+escapeHTML(item.name)+'">USAR</button></div>').join(''):'<small>Nenhum item coletado ainda.</small>';
  $('recentLoot').querySelectorAll('[data-use-item]').forEach(button=>button.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();useItemById(button.dataset.useItem);
  }));
  const chosen = lootDrops.find(item => String(item.id) === String(selectedItemId));
  $('selectedItemLabel').textContent = chosen ? chosen.name + ' · ' + chosen.rarity + ' · PODER ' + (chosen.power || 1) + '/5' : 'Nenhum item selecionado';
  $('useSelectedItemBtn').textContent=chosen&&['Equipamento Antigo','Relíquia Monocromática','Coroa do Abismo'].includes(chosen.name)?'EQUIPAR':'USAR ITEM';
  $('useSelectedItemBtn').disabled=!chosen||!canUseItemsNow();
}
function useItemById(itemId){
  const item=lootDrops.find(entry=>String(entry.id)===String(itemId));
  if(!item){showNotice('Este item não está mais no inventário.');renderInventory();return;}
  selectedItemId=String(item.id);
  if(offlineMode){
    if(!offlineState?.started||!offlineState?.players?.[0]||offlineState.players[0].hp<=0){showNotice('Entre na partida offline e esteja vivo para usar itens.');return;}
    offlineUseItem(item.id);return;
  }
  if(!started||!myPlayer||(myPlayer.userData.serverHp??100)<=0){showNotice('Entre na partida online e esteja vivo para usar itens.');return;}
  if(!ws||ws.readyState!==WebSocket.OPEN){showNotice('Conexão perdida. Aguarde reconectar para usar o item.');return;}
  send({type:'useItem',id:String(item.id)});showNotice('Usando '+item.name+'...');
}
function useSelectedItem(){
  if(!selectedItemId){showNotice('Selecione um item primeiro.');return;}
  useItemById(selectedItemId);
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
  // Distinct monster silhouettes: predator, plant, specter, brute, inferno, abyss and assassin.
  const g=new THREE.Group();
  const contactShadow = addSoftContactShadow(g, kind === 'brute' ? .85 : kind === 'wraith' || kind === 'abyss' ? .50 : .62, .55);
  contactShadow.position.y = .032;
  const eyeColor=kind==='brute'?0xffa342:kind==='wraith'?0x72f4ff:kind==='thorn'?0x9dff69:kind==='inferno'?0xff592d:kind==='abyss'?0xc49bff:kind==='assassin'?0xff5c86:phase===2?0xff5e76:0xff4269;
  const bodyColor=kind==='thorn'?0x3e6a40:kind==='inferno'?0x3a2425:kind==='abyss'?0x251936:kind==='wraith'?0x223c59:kind==='brute'?0x4c5669:kind==='assassin'?0x292d42:phase===2?0x3c5262:0x4c4359;
  const bodyMat=new THREE.MeshStandardMaterial({color:bodyColor,roughness:kind==='wraith'?.4:.78,metalness:kind==='brute'?.28:.08,emissive:kind==='abyss'?0x29143e:0x000000,emissiveIntensity:.35});
  const dark=new THREE.MeshStandardMaterial({color:0x151923,roughness:.84,metalness:.08});
  const bone=new THREE.MeshStandardMaterial({color:0xc5c9d3,roughness:.45,metalness:.24});
  const glow=new THREE.MeshStandardMaterial({color:eyeColor,emissive:eyeColor,emissiveIntensity:2.0,roughness:.22,metalness:.18});
  const leaf=new THREE.MeshStandardMaterial({color:0x72a94b,roughness:.86});
  const rock=new THREE.MeshStandardMaterial({color:bodyColor,roughness:.92,metalness:.05});
  const animatedLimbs=[];
  const add=(geo,material,x,y,z,sx=1,sy=1,sz=1,parent=g)=>{
    const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);
    if(!isMobileDevice){m.castShadow=true;m.receiveShadow=true;}parent.add(m);return m;
  };
  const limb=(geo,material,x,y,z,sx,sy,sz,side)=>{
    const m=add(geo,material,x,y,z,sx,sy,sz);animatedLimbs.push({mesh:m,side,baseRotationZ:m.rotation.z});return m;
  };
  let core=null;
  if(kind==='wraith'){
    const shroud=add(new THREE.ConeGeometry(.52,1.55,9),bodyMat,0,.82,0,1,.95,.82);
    shroud.rotation.x=.04;
    add(new THREE.TorusGeometry(.29,.055,7,24),glow,0,1.48,-.03,1,1,.8).rotation.x=Math.PI/2;
    add(new THREE.SphereGeometry(.30,16,12),dark,0,1.55,-.04,1,1,.95);
    for(const side of [-1,1]){
      add(new THREE.SphereGeometry(.063,12,8),glow,side*.12,1.58,-.31);
      const arm=limb(new THREE.CapsuleGeometry(.085,.43,4,8),bodyMat,side*.43,1.13,0,1,1,1,side);arm.rotation.z=side*.3;
      const wisp=add(new THREE.ConeGeometry(.11,.48,5),glow,side*.40,.66,.04);wisp.rotation.z=side*.3;
      const shard=add(new THREE.OctahedronGeometry(.18,1),glow,side*.5,.78,.08);shard.rotation.z=side*.4;
    }
  }else if(kind==='thorn'){
    add(new THREE.CylinderGeometry(.18,.31,1.05,7),bodyMat,0,.78,0);
    add(new THREE.IcosahedronGeometry(.36,1),leaf,0,1.48,-.03,1,.95,.78);
    add(new THREE.DodecahedronGeometry(.19,0),rock,0,1.42,-.27,1,1,.65);
    for(const side of [-1,1]){
      const branch=limb(new THREE.CapsuleGeometry(.075,.45,3,6),bodyMat,side*.38,1.13,0,1,1,1,side);branch.rotation.z=side*.62;
      add(new THREE.ConeGeometry(.10,.42,5),leaf,side*.55,1.48,.02).rotation.z=side*-.6;
      add(new THREE.SphereGeometry(.052,10,8),glow,side*.12,1.50,-.27);
      const leg=limb(new THREE.CapsuleGeometry(.12,.27,3,6),bodyMat,side*.20,.32,0,1,1,1,side);leg.rotation.z=side*.1;
      add(new THREE.ConeGeometry(.09,.42,5),rock,side*.24,.95,.27).rotation.x=-.55;
    }
    for(let i=0;i<3;i++){const spike=add(new THREE.ConeGeometry(.09,.30,5),(i%2?leaf:bodyMat),(i-1)*.18,1.74,.22);spike.rotation.x=.6;}
  }else if(kind==='brute'){
    const chest=add(new THREE.DodecahedronGeometry(.56,1),bodyMat,0,1.05,0,1.15,1.05,.95);
    chest.rotation.z=.03;
    add(new THREE.DodecahedronGeometry(.32,1),dark,0,1.77,-.02,1.15,1,.9);
    add(new THREE.BoxGeometry(.26,.09,.05),glow,0,1.79,-.33);
    for(const side of [-1,1]){
      const shoulder=add(new THREE.DodecahedronGeometry(.32,1),rock,side*.62,1.40,0,1.25,.95,1);
      shoulder.rotation.z=side*-.16;
      const horn=add(new THREE.ConeGeometry(.12,.39,5),bone,side*.22,2.05,-.02);horn.rotation.z=side*-.38;
      const arm=limb(new THREE.CapsuleGeometry(.18,.48,4,8),bodyMat,side*.66,.98,0,1,1,1,side);arm.rotation.z=side*.15;
      add(new THREE.DodecahedronGeometry(.22,0),rock,side*.70,.62,-.04,1.2,.95,1);
      const leg=limb(new THREE.CapsuleGeometry(.16,.35,4,8),dark,side*.29,.30,0,1,1,1,side);
      add(new THREE.BoxGeometry(.30,.10,.39),dark,side*.29,.12,-.08);
    }
    for(let i=0;i<3;i++){
      const plate=add(new THREE.BoxGeometry(.26,.07,.04),glow,0,1.15+i*.14,-.48);plate.rotation.z=(i-1)*-.08;
    }
  }else if(kind==='inferno'){
    add(new THREE.IcosahedronGeometry(.49,1),rock,0,1.02,0,1.12,1.08,.94);
    add(new THREE.SphereGeometry(.29,12,10),dark,0,1.72,0);
    for(const side of [-1,1]){
      const horn=add(new THREE.ConeGeometry(.10,.36,5),bone,side*.22,2.02,0);horn.rotation.z=side*-.35;
      add(new THREE.SphereGeometry(.052,10,8),glow,side*.12,1.73,-.26);
      const arm=limb(new THREE.CapsuleGeometry(.12,.38,3,7),rock,side*.48,.98,0,1,1,1,side);arm.rotation.z=side*.2;
      add(new THREE.BoxGeometry(.07,.38,.035),glow,side*.15,1.05,-.42).rotation.z=side*.18;
      const leg=limb(new THREE.CapsuleGeometry(.13,.30,3,7),dark,side*.21,.30,0,1,1,1,side);
    }
    for(let i=0;i<4;i++)add(new THREE.ConeGeometry(.11,.24,5),rock,(i-1.5)*.16,1.31,.32);
  }else if(kind==='abyss'){
    const voidBody=new THREE.OctahedronGeometry(.49,1);
    add(voidBody,bodyMat,0,1.10,0,1.0,1.30,.78);
    add(new THREE.SphereGeometry(.22,12,10),dark,0,1.83,-.02);
    for(const side of [-1,1]){
      add(new THREE.SphereGeometry(.06,10,8),glow,side*.10,1.85,-.24);
      const wing=add(new THREE.ConeGeometry(.25,.90,5),bodyMat,side*.58,1.44,.12,1,1.15,.65);wing.rotation.z=side*Math.PI*.38;
      const shard=add(new THREE.OctahedronGeometry(.20,1),glow,side*.45,1.07,-.10);shard.rotation.z=side*.35;
    }
    add(new THREE.TorusGeometry(.62,.035,5,28),glow,0,.05,0,1,1,.8).rotation.x=Math.PI/2;
  }else if(kind==='assassin'){
    add(new THREE.CapsuleGeometry(.25,.62,5,10),bodyMat,0,1.02,0,.88,1.05,.78);
    add(new THREE.SphereGeometry(.22,12,10),dark,0,1.67,-.03);
    add(new THREE.ConeGeometry(.24,.34,6),dark,0,1.84,.04,1,.9,.9);
    add(new THREE.BoxGeometry(.31,.06,.045),glow,0,1.69,-.25);
    for(const side of [-1,1]){
      const arm=limb(new THREE.CapsuleGeometry(.09,.36,4,7),bodyMat,side*.37,1.11,0,1,1,1,side);arm.rotation.z=side*.24;
      const blade=add(new THREE.ConeGeometry(.055,.40,5),bone,side*.49,.82,-.10);blade.rotation.z=Math.PI+side*.12;
      const leg=limb(new THREE.CapsuleGeometry(.10,.34,3,7),dark,side*.16,.36,0,1,1,1,side);
    }
    add(new THREE.ConeGeometry(.16,.38,5),dark,0,.76,.27,1,1,.45);
  }else{
    // Stalker: low, fast four-legged predator with a forward-facing jaw.
    add(new THREE.DodecahedronGeometry(.43,1),bodyMat,0,.84,.05,1.20,.82,1.38);
    add(new THREE.IcosahedronGeometry(.27,1),dark,0,1.18,-.36,1,.9,1.05);
    add(new THREE.ConeGeometry(.16,.37,5),bodyMat,0,1.08,-.58,1,.85,.85).rotation.x=-Math.PI/2;
    for(const side of [-1,1]){
      add(new THREE.SphereGeometry(.052,10,8),glow,side*.12,1.23,-.57);
      const ear=add(new THREE.ConeGeometry(.08,.25,5),bone,side*.19,1.44,-.27);ear.rotation.z=side*-.25;
      for(const z of [-.20,.34]){
        const leg=limb(new THREE.CapsuleGeometry(.09,.30,3,7),bodyMat,side*.29,.48,z,1,1,1,side);leg.rotation.x=z<0?-.20:.20;leg.rotation.z=side*.12;
      }
      add(new THREE.ConeGeometry(.045,.24,5),bone,side*.22,.67,.22).rotation.x=.55;
    }
  }
  // Pacote de identidade visual: rosto, mandíbula, placas e marcas por criatura.
  const faceZ=kind==='wraith'?.27:kind==='abyss'?.22:kind==='brute'?.34:kind==='thorn'?.29:kind==='assassin'?.25:.55;
  const headY=kind==='brute'?1.79:kind==='inferno'?1.72:kind==='abyss'?1.84:kind==='assassin'?1.68:kind==='wraith'?1.55:kind==='thorn'?1.48:1.22;
  const pupilMat=new THREE.MeshStandardMaterial({color:0x10131d,roughness:.3});
  const glintMat=new THREE.MeshBasicMaterial({color:0xffffff});
  const scarMat=new THREE.MeshStandardMaterial({color:kind==='inferno'?0xff7a35:kind==='thorn'?0x9acb59:0x202632,roughness:.86});
  const armorAccent=new THREE.MeshStandardMaterial({color:kind==='brute'?0x9ba6b4:kind==='abyss'?0x694a8c:kind==='assassin'?0x9a4568:kind==='inferno'?0xb84a2e:kind==='thorn'?0x8dba55:0x687d93,metalness:.42,roughness:.5});
  const eyePairs=[];
  for(const side of [-1,1]){
    const eyeX=kind==='brute'?.12:kind==='assassin'?.105:kind==='wraith'?.12:.12;
    const eye=add(new THREE.SphereGeometry(kind==='brute'?.065:.052,8,6),glow,side*eyeX,headY, -faceZ);
    const pupil=add(new THREE.SphereGeometry(.021,7,5),pupilMat,side*eyeX,headY-.003,-faceZ-.042);
    const glint=add(new THREE.SphereGeometry(.009,6,5),glintMat,side*eyeX-.012,headY+.018,-faceZ-.052);
    eyePairs.push({eye,pupil,glint,side});
    const brow=add(new THREE.BoxGeometry(.14,.035,.045),kind==='brute'||kind==='assassin'?dark:armorAccent,side*eyeX,headY+.085,-faceZ+.012);
    brow.rotation.z=side*(kind==='brute'?.20:kind==='assassin'?-.18:.08);
  }
  g.userData.eyePairs=eyePairs;
  // Detalhes de armadura adicionais só no preset alto, sem aumentar o custo no modo móvel equilibrado.
  if(gameSettings.graphicsQuality==='high'){
    const detailMat=new THREE.MeshStandardMaterial({color:kind==='inferno'?0xffb05c:kind==='thorn'?0xbce77b:kind==='wraith'?0x9beeff:kind==='abyss'?0xd3a6ff:0xbac8d6,metalness:.52,roughness:.32,emissive:eyeColor,emissiveIntensity:.16});
    for(const side of [-1,1]){
      const plate=new THREE.Mesh(new THREE.DodecahedronGeometry(.13,0),detailMat);
      plate.position.set(side*(kind==='brute'?.56:.39),kind==='brute'?1.45:1.08,-.08);
      plate.scale.set(1.25,.55,.72);plate.rotation.z=side*.18;g.add(plate);
    }
  }
  // Jaw and teeth are kept low-poly so they remain readable on phones.
  if(kind==='stalker'||kind==='brute'||kind==='inferno'||kind==='assassin'){
    const jaw=add(new THREE.BoxGeometry(kind==='brute'?.30:.22,.09,.12),dark,0,headY-.15,-faceZ+.015,1,.8,1);
    jaw.rotation.x=-.08;
    for(let tooth=-1;tooth<=1;tooth++){
      add(new THREE.ConeGeometry(.025,.075,4),bone,tooth*.065,headY-.18,-faceZ-.045,1,1,.65).rotation.x=Math.PI;
    }
  }else if(kind==='wraith'||kind==='abyss'){
    add(new THREE.TorusGeometry(.095,.018,4,12),glow,0,headY-.13,-faceZ-.02,1,.7,.5).rotation.x=Math.PI;
  }
  // Chest sigil gives each species a readable weak-point identity.
  const sigilColor=kind==='thorn'?0x9dff69:kind==='inferno'?0xff6a2c:kind==='wraith'?0x72f4ff:kind==='abyss'?0xc49bff:kind==='brute'?0xffc078:kind==='assassin'?0xff5c86:eyeColor;
  const sigilMat=new THREE.MeshStandardMaterial({color:sigilColor,emissive:sigilColor,emissiveIntensity:1.05,metalness:.2,roughness:.32});
  const sigil=add(new THREE.OctahedronGeometry(.105,0),sigilMat,0,kind==='brute'?1.12:kind==='wraith'?.98:1.02,-.43,.8,1.2,.5);
  sigil.rotation.z=Math.PI/4;
  for(const side of [-1,1]){
    if(kind==='brute'||kind==='inferno'||kind==='assassin'){
      const pauldron=add(new THREE.DodecahedronGeometry(.19,0),armorAccent,side*(kind==='brute'?.62:.43),kind==='brute'?1.40:1.20,-.02,1.1,.8,.72);
      pauldron.rotation.z=side*-.16;
      for(let spike=0;spike<2;spike++){
        const s=add(new THREE.ConeGeometry(.055,.20,4),bone,side*(kind==='brute'?.68:.48),1.46+spike*.11,.02);
        s.rotation.z=side*-.38;
      }
    }else if(kind==='thorn'){
      const vine=add(new THREE.TorusGeometry(.22,.025,4,12),leaf,side*.32,1.05,-.18,.75,1,.55);
      vine.rotation.z=side*.5;
    }else if(kind==='wraith'||kind==='abyss'){
      const wisp=add(new THREE.OctahedronGeometry(.09,0),glow,side*.36,.94,.02,.8,1.5,.8);
      wisp.rotation.z=side*.6;
    }
  }
  // Species markings: stripes, runes and back spines.
  if(kind==='stalker'||kind==='assassin'){
    for(let stripe=0;stripe<3;stripe++){
      const mark=add(new THREE.BoxGeometry(.045,.22,.025),armorAccent,(stripe-1)*.14,1.02,-.31);
      mark.rotation.z=(stripe-1)*-.12;
    }
  }
  if(kind==='brute'||kind==='inferno'||kind==='abyss'){
    for(let spike=0;spike<3;spike++){
      const backSpike=add(new THREE.ConeGeometry(.095,.32,5),kind==='abyss'?glow:bone,(spike-1)*.22,1.48,.38);
      backSpike.rotation.x=Math.PI/2.6;
      backSpike.rotation.z=(spike-1)*-.12;
    }
  }
  if(kind==='thorn'){
    for(let thorn=0;thorn<4;thorn++){
      const vine=add(new THREE.ConeGeometry(.055,.27,4),(thorn%2)?leaf:rock,(thorn-1.5)*.16,.9,.31);
      vine.rotation.x=.8;vine.rotation.z=(thorn-1.5)*-.15;
    }
  }
  // Wrist and ankle guards improve silhouette separation during movement.
  if(kind!=='wraith'&&kind!=='abyss'&&kind!=='thorn'){
    for(const side of [-1,1]){
      add(new THREE.TorusGeometry(.105,.022,4,12),armorAccent,side*(kind==='brute'?.70:.40),kind==='brute'?.66:.83,-.015,1,1,.8).rotation.x=Math.PI/2;
      add(new THREE.BoxGeometry(.16,.07,.20),dark,side*(kind==='brute'?.29:.20),.18,-.04);
    }
  }
  core=add(new THREE.OctahedronGeometry(kind==='brute'?.16:.12,1),glow,0,1.17,-.42,.9,1.1,.5);
  core.rotation.set(.12,.2,.08);
  const ring=new THREE.Mesh(new THREE.RingGeometry(kind==='brute'?.57:.43,kind==='brute'?.65:.50,32),new THREE.MeshBasicMaterial({color:eyeColor,transparent:true,opacity:.50,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.025;g.add(ring);
  g.userData.kind=kind;g.userData.eyeMaterial=glow;g.userData.coreMesh=core;g.userData.attackRing=ring;g.userData.ringColor=eyeColor;
  g.userData.animatedLimbs=animatedLimbs;g.userData.walkPhase=Math.random()*Math.PI*2;g.userData.eyePulseOffset=Math.random()*Math.PI*2;
  g.userData.lastX=undefined;g.userData.lastZ=undefined;g.userData.walking=false;g.userData.baseY=0;
  attachHealthBar(g);
  return g;
}
let viewportResizeFrame = 0;
function onResize() {
  if (viewportResizeFrame) cancelAnimationFrame(viewportResizeFrame);
  viewportResizeFrame = requestAnimationFrame(() => {
    viewportResizeFrame = 0;
    const viewport = getEffectiveViewport();
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
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
      camera.fov = isMobileDevice ? (width > height ? 58 : 74) : 62;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(adaptivePixelRatio);
      syncRendererSize(width, height);

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
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onResize, { passive: true });
  window.visualViewport.addEventListener('scroll', onResize, { passive: true });
}

function setStatus(t) {
  menuStatus.textContent = t;
}

let connectionRequested = false, reconnectAttempts = 0, reconnectTimer = null, activeConnectCode = '';
let listPublicRoomsOnConnect = false;
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
    if (listPublicRoomsOnConnect) {
      listPublicRoomsOnConnect = false;
      send({ type: 'listPublicRooms', gameMode: selectedGameMode });
    } else {
      sendJoin(activeConnectCode || code);
    }
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
  monk: 'Monge: 110 de vida, combo de três golpes, atordoamento e mobilidade.',
  golem: 'Golem de Pedra: 220 de vida, divisão em três e arremesso de pedras em área.'
};
let savedCharacterChoice={};try{savedCharacterChoice=JSON.parse(localStorage.getItem('mmCharacterChoice')||'{}')||{};}catch{}
let selectedClass=['knight','mage','archer','goblin','ogre','healer','necromancer','monk','golem'].includes(sharedProfileSeed.playerClass||savedCharacterChoice.playerClass)?(sharedProfileSeed.playerClass||savedCharacterChoice.playerClass):'knight';
let unlockedSkins=new Set(['default','shadow','ember',...(Array.isArray(sharedProfileSeed.unlockedSkins)?sharedProfileSeed.unlockedSkins.filter(id=>CHEST_ONLY_SKINS.includes(id)):[])]);
let skinCandidate=sharedProfileSeed.skin||savedCharacterChoice.skin||'default';
let selectedSkin=[...FREE_LOBBY_SKINS,...CHEST_ONLY_SKINS].includes(skinCandidate)&&(FREE_LOBBY_SKINS.includes(skinCandidate)||unlockedSkins.has(skinCandidate))?skinCandidate:'default';
let skillPoints=Math.max(0,Math.min(99,Number(sharedProfileSeed.skillPoints??5)));
const unlockedSkills=new Set(Array.isArray(sharedProfileSeed.skills)?sharedProfileSeed.skills.filter(id=>typeof id==='string').slice(0,15):[]);
let lastSkillSignature = '';
let activeSkillFilter = 'all';
let activeSkillSearch = '';
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
    {id:'second_wind',icon:'🌟',name:'Última resistência',desc:'Recebe 20% menos dano quando está com 30% da vida ou menos.',req:'regeneration'},
    {id:'party_guard',icon:'🤝',name:'Guarda em grupo',desc:'Recebe menos dano perto de aliado.',req:'second_wind'}
  ]},
  { id:'arcane', title:'✦ MELHORIAS EXCLUSIVAS', skills:[] },
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
const CLASS_PERSONAL_SKILLS_UI = {"knight":[{"id":"knight_fortress","icon":"🛡","name":"Coração de fortaleza","desc":"+15 vida e 4% menos dano."},{"id":"knight_aegis","icon":"✨","name":"Égide duradoura","desc":"Escudo +2 s.","req":"knight_fortress"},{"id":"knight_charge","icon":"⚔","name":"Carga destruidora","desc":"Avanço +3 dano.","req":"knight_aegis"},{"id":"knight_vanguard","icon":"💨","name":"Vanguarda","desc":"Ataques mais rápidos.","req":"knight_charge"},{"id":"knight_royal_oath","icon":"👑","name":"Juramento real","desc":"+1 dano base.","req":"knight_vanguard"}],"mage":[{"id":"mage_focus","icon":"🔮","name":"Foco arcano","desc":"+18% poder mágico."},{"id":"mage_ember","icon":"🔥","name":"Brasa persistente","desc":"Fogo e queimadura fortalecidos.","req":"mage_focus"},{"id":"mage_chain","icon":"⚡","name":"Tempestade encadeada","desc":"Raio atinge até 5 alvos.","req":"mage_ember"},{"id":"mage_mana","icon":"💠","name":"Reserva arcana","desc":"+15% poder mágico.","req":"mage_chain"},{"id":"mage_starseer","icon":"🌌","name":"Vidente estelar","desc":"Bola de fogo +1 dano.","req":"mage_mana"}],"archer":[{"id":"archer_hawkeye","icon":"🎯","name":"Olho de falcão","desc":"+1,15 alcance e +5 vida."},{"id":"archer_volley","icon":"🏹","name":"Chuva concentrada","desc":"Chuva maior e +2 dano.","req":"archer_hawkeye"},{"id":"archer_firetip","icon":"🔥","name":"Pontas incendiárias","desc":"Flechas queimam +2 s.","req":"archer_volley"},{"id":"archer_quiver","icon":"🪶","name":"Aljava veloz","desc":"Recarga -1,5 s.","req":"archer_firetip"},{"id":"archer_hunter","icon":"🐺","name":"Caçador de elite","desc":"+1 dano base.","req":"archer_quiver"}],"goblin":[{"id":"goblin_agility","icon":"💨","name":"Reflexos goblins","desc":"+5 vida e ataques rápidos."},{"id":"goblin_shadow","icon":"👻","name":"Manto das sombras","desc":"Invisibilidade +2 s.","req":"goblin_agility"},{"id":"goblin_pack","icon":"👺","name":"Matilha surpresa","desc":"3 goblins por 16 s.","req":"goblin_shadow"},{"id":"goblin_poison","icon":"☠","name":"Lâminas venenosas","desc":"+1 dano base.","req":"goblin_pack"},{"id":"goblin_trickster","icon":"🌀","name":"Mestre da trapaça","desc":"Recargas -2,5 s.","req":"goblin_poison"}],"ogre":[{"id":"ogre_blood","icon":"🩸","name":"Sangue titânico","desc":"+20 vida e resistência."},{"id":"ogre_aftershock","icon":"🌋","name":"Abalo sísmico","desc":"Soco em área maior.","req":"ogre_blood"},{"id":"ogre_berserker","icon":"💥","name":"Fúria esmagadora","desc":"Soco +3 dano.","req":"ogre_aftershock"},{"id":"ogre_longrage","icon":"💨","name":"Fúria prolongada","desc":"Velocidade +2 s.","req":"ogre_berserker"},{"id":"ogre_crusher","icon":"🪨","name":"Esmagador","desc":"+1 dano base.","req":"ogre_longrage"}],"healer":[{"id":"healer_mercy","icon":"🌿","name":"Misericórdia","desc":"+10 vida."},{"id":"healer_blessing","icon":"💚","name":"Bênção maior","desc":"Cura até 70 vida.","req":"healer_mercy"},{"id":"healer_longspirits","icon":"🪽","name":"Espíritos persistentes","desc":"Espíritos +6 s.","req":"healer_blessing"},{"id":"healer_pulse","icon":"✨","name":"Pulso restaurador","desc":"Espíritos mais fortes.","req":"healer_longspirits"},{"id":"healer_sanctuary","icon":"🌟","name":"Santuário vivo","desc":"+1 dano base.","req":"healer_pulse"}],"necromancer":[{"id":"necromancer_soul","icon":"💀","name":"Alma resistente","desc":"+10 vida."},{"id":"necromancer_bone","icon":"🦴","name":"Ossos reforçados","desc":"Esqueletos mais fortes.","req":"necromancer_soul"},{"id":"necromancer_horde","icon":"☠","name":"Horda ampliada","desc":"7 esqueletos por 36 s.","req":"necromancer_bone"},{"id":"necromancer_shadowstep","icon":"🕳️","name":"Passo sombrio","desc":"Mergulho recarrega mais rápido.","req":"necromancer_horde"},{"id":"necromancer_reaper","icon":"⚰️","name":"Ceifador","desc":"+1 dano e +1 esqueleto.","req":"necromancer_shadowstep"}],"monk":[{"id":"monk_focus","icon":"🥋","name":"Postura focada","desc":"Ataques mais rápidos."},{"id":"monk_openpalm","icon":"👊","name":"Palma aberta","desc":"Palma +3 dano.","req":"monk_focus"},{"id":"monk_flow","icon":"🪽","name":"Fluxo contínuo","desc":"Passos Alados +2,5 s.","req":"monk_openpalm"},{"id":"monk_ironbody","icon":"🪨","name":"Corpo de ferro","desc":"+12 vida e resistência.","req":"monk_flow"},{"id":"monk_zen","icon":"☯️","name":"Zen perfeito","desc":"+1 dano e atordoamento.","req":"monk_ironbody"}],"golem":[{"id":"golem_granite","icon":"🪨","name":"Pele de granito","desc":"+20 vida e resistência."},{"id":"golem_shatter","icon":"💠","name":"Fragmentos resistentes","desc":"Golens menores mais fortes.","req":"golem_granite"},{"id":"golem_quake","icon":"🌋","name":"Tremor colossal","desc":"Pedra e estilhaços mais fortes.","req":"golem_shatter"},{"id":"golem_splitheart","icon":"🔱","name":"Coração dividido","desc":"Divisão +4 s e clones mais resistentes.","req":"golem_quake"},{"id":"golem_mountaincore","icon":"⛰️","name":"Núcleo da montanha","desc":"+25 vida, +1 dano, área maior.","req":"golem_splitheart"}]};
const CLASS_NAMES_UI = {knight:'CAVALEIRO',mage:'MAGO',archer:'ARQUEIRO',goblin:'GOBLIN',ogre:'OGRO',healer:'CURANDEIRO',necromancer:'NECROMANTE',monk:'MONGE',golem:'GOLEM DE PEDRA'};
let skillTreeZoom = matchMedia('(pointer: coarse)').matches ? 0.72 : 1;
function setSkillTreeZoom(value) {
  skillTreeZoom = THREE.MathUtils.clamp(Number(value) || 0.72, 0.45, 1.25);
  document.querySelectorAll('.skill-rpg-canvas').forEach(canvas => { canvas.style.zoom = String(skillTreeZoom); });
}
function installSkillTreePinch(root) {
  if (!root || root.dataset.pinchZoomReady === '1') return;
  root.dataset.pinchZoomReady = '1';
  let startDistance = 0, startZoom = skillTreeZoom;
  const distance = touches => Math.hypot(touches[0].clientX-touches[1].clientX, touches[0].clientY-touches[1].clientY);
  root.addEventListener('touchstart', event => {
    if (event.touches.length === 2 && event.target.closest('.skill-rpg-scroll')) {
      startDistance = Math.max(1, distance(event.touches)); startZoom = skillTreeZoom;
    }
  }, {passive:true});
  root.addEventListener('touchmove', event => {
    if (event.touches.length === 2 && startDistance && event.target.closest('.skill-rpg-scroll')) {
      event.preventDefault();
      setSkillTreeZoom(startZoom * distance(event.touches) / startDistance);
    }
  }, {passive:false});
  root.addEventListener('touchend', event => { if (event.touches.length < 2) startDistance = 0; }, {passive:true});
  root.addEventListener('wheel', event => {
    if (event.ctrlKey && event.target.closest('.skill-rpg-scroll')) {
      event.preventDefault(); setSkillTreeZoom(skillTreeZoom * (event.deltaY < 0 ? 1.08 : 0.92));
    }
  }, {passive:false});
}
function renderSkillTrees() {
  const branches = getCurrentSkillBranches();
  const allSkills = branches.flatMap(branch => branch.skills.map((skill,index)=>({...skill,branch:branch.id,branchTitle:branch.title,originalIndex:index})));
  const activeBranches = new Set(allSkills.filter(skill=>unlockedSkills.has(skill.id)).map(skill=>skill.branch));
  const activeCount = unlockedSkills.size;
  const classGlyph = {knight:'⚔',mage:'✧',archer:'➶',goblin:'⟡',ogre:'⚒',healer:'✚',necromancer:'☠',monk:'✊',golem:'⬟'}[selectedClass]||'✦';
  const canUnlock = skill => !unlockedSkills.has(skill.id) && (!skill.req||unlockedSkills.has(skill.req)) &&
    (activeBranches.has(skill.branch)||activeBranches.size<3) && skillPoints>0 && activeCount<15;
  const esc = value => String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const query = activeSkillSearch.trim().toLocaleLowerCase('pt-BR');
  const filterBar = '<div class="skill-tree-tools"><label class="skill-search-label">⌕ <input class="skill-search" data-skill-search type="search" maxlength="40" placeholder="Buscar talento..." aria-label="Buscar talento" value="'+esc(activeSkillSearch)+'"></label>'+
    '<div class="skill-tree-filters" role="group" aria-label="Filtrar talentos">'+
    [['all','TODOS'],['available','DISPONÍVEIS'],['unlocked','DESBLOQUEADOS']].map(([id,label])=>'<button type="button" class="skill-filter '+(activeSkillFilter===id?'active':'')+'" data-skill-filter="'+id+'" aria-pressed="'+(activeSkillFilter===id?'true':'false')+'">'+label+'</button>').join('')+'</div></div>';
  const positions=[12,31,50,69,88], yLevels=[270,360,450,540,630],nodeOffsets=[0,-31,25,-31,0];
  const rootLines=positions.map(x=>'<path class="skill-rpg-root-link" d="M 500 93 C 500 155 '+(x*10)+' 175 '+(x*10)+' 255"></path>').join('');
  let branchLabels='', branchNodes='', branchLinks='';
  branches.forEach((branch,branchIndex)=>{
    const x=positions[branchIndex]*10;
    const skills=branch.skills.map((skill,index)=>({...skill,branch:branch.id,branchTitle:branch.title,originalIndex:index}));
    const unlockedCount=skills.filter(skill=>unlockedSkills.has(skill.id)).length;
    const glyph=branch.icon||({attack:'⚔️',defense:'🛡️',arcane:'✦',mobility:'💨',support:'✚'}[branch.id]||'✦');
    branchLabels+='<div class="skill-rpg-branch-label" style="left:'+positions[branchIndex]+'%;top:174px"><span>'+esc(glyph)+'</span><strong>'+esc(branch.title.replace(/^\S+\s*/,''))+'</strong><small>'+unlockedCount+'/'+skills.length+' · TALENTOS</small></div>';
    for(let level=1;level<skills.length;level++){
      const fromX=x+nodeOffsets[level-1],toX=x+nodeOffsets[level];
      const fromY=yLevels[level-1]+28,toY=yLevels[level]-28,midY=(fromY+toY)/2;
      branchLinks+='<path class="skill-rpg-line" d="M '+fromX+' '+fromY+' C '+fromX+' '+midY+' '+toX+' '+midY+' '+toX+' '+toY+'"></path>';
    }
    skills.forEach((skill,index)=>{
      const unlocked=unlockedSkills.has(skill.id),canBuy=canUnlock(skill);
      const required=skill.req?allSkills.find(item=>item.id===skill.req)?.name:'';
      const matchesFilter=activeSkillFilter==='all'||(activeSkillFilter==='unlocked'&&unlocked)||(activeSkillFilter==='available'&&canBuy);
      const matchesQuery=!query||(skill.name+' '+skill.desc+' '+branch.title).toLocaleLowerCase('pt-BR').includes(query);
      const hidden=!matchesFilter||!matchesQuery;
      const status=unlocked?'DESBLOQUEADA ✓':canBuy?'DISPONÍVEL · 1 PONTO':
        skill.req&&!unlockedSkills.has(skill.req)?'REQUER: '+(required||'talento anterior'):
        activeCount>=15?'LIMITE DE 15 TALENTOS':(!activeBranches.has(branch.id)&&activeBranches.size>=3)?'LIMITE DE 3 RAMOS':
        skillPoints<1?'SEM PONTOS':'BLOQUEADA';
      const stateClass=unlocked?'unlocked':canBuy?'available':'locked';
      const req=skill.req?'Pré-requisito: '+(required||'talento anterior'):'Talento inicial do caminho';
      branchNodes+='<button type="button" class="skill-rpg-node '+stateClass+(hidden?' skill-filtered-out':'')+'" data-skill="'+esc(skill.id)+'" data-branch="'+esc(branch.id)+'" style="left:calc('+positions[branchIndex]+'% + '+nodeOffsets[index]+'px);top:'+yLevels[index]+'px" aria-label="'+esc(skill.name+'. '+skill.desc+'. '+status)+'" '+(canBuy?'':'disabled')+'>'+
        '<span class="skill-rpg-node-icon">'+esc(skill.icon)+'</span><span class="skill-rpg-node-copy"><strong>'+esc(skill.name)+'</strong><small>NÍVEL '+(index+1)+' · 1 PONTO</small><em>'+esc(unlocked?'✓ APRENDIDA':canBuy?'TOQUE PARA APRENDER':status)+'</em></span></button>';
    });
  });
  const overallPct=Math.min(100,Math.round(activeCount/15*100));
  const core='<div class="skill-tree-core skill-tree-core-redesign"><span class="skill-tree-core-icon">'+classGlyph+'</span><span><strong>'+esc(CLASS_NAMES_UI[selectedClass]||'CLASSE')+'</strong><small>ÁRVORE DE HABILIDADES · '+skillPoints+' PONTOS · '+activeCount+'/15 TALENTOS</small><span class="skill-tree-overall-progress" role="progressbar" aria-label="Progresso total de talentos" aria-valuemin="0" aria-valuemax="15" aria-valuenow="'+activeCount+'"><span style="width:'+overallPct+'%"></span></span></span></div>';
  const svg='<svg class="skill-rpg-links" viewBox="0 0 1000 720" preserveAspectRatio="none" aria-hidden="true">'+rootLines+branchLinks+'</svg>';
  const tree='<div class="skill-rpg-scroll"><div class="skill-rpg-canvas">'+svg+
    '<div class="skill-rpg-root" style="left:50%;top:52px"><span>'+classGlyph+'</span><strong>'+esc(CLASS_NAMES_UI[selectedClass]||'CLASSE')+'</strong><small>NÚCLEO DO AVENTUREIRO</small></div>'+
    branchLabels+branchNodes+'</div></div>';
  const catalog='<section class="skill-description-catalog"><h3>📖 GRIMÓRIO DE TALENTOS</h3><p>Leia os efeitos antes de gastar seus pontos. Cada caminho possui cinco níveis; escolha até três caminhos.</p>'+
    branches.map(branch=>'<section class="skill-description-branch"><h4>'+esc(branch.title)+'</h4><div class="skill-description-list">'+
      branch.skills.map(skill=>{
        const unlocked=unlockedSkills.has(skill.id),canBuy=canUnlock({...skill,branch:branch.id});
        const required=skill.req?allSkills.find(item=>item.id===skill.req)?.name:'';
        const state=unlocked?'APRENDIDA ✓':skill.req&&!unlockedSkills.has(skill.req)?'REQUER: '+(required||'talento anterior'):canBuy?'DISPONÍVEL · 1 PONTO':skillPoints<1?'SEM PONTOS':'BLOQUEADA';
        return '<button type="button" class="skill-description-card '+(unlocked?'unlocked':canBuy?'available':'locked')+'" data-skill="'+esc(skill.id)+'" data-branch="'+esc(branch.id)+'" '+(canBuy?'':'disabled')+'><span class="skill-description-icon">'+esc(skill.icon)+'</span><span class="skill-description-copy"><strong>'+esc(skill.name)+'</strong><p>'+esc(skill.desc)+'</p><small>'+esc(state)+'</small></span></button>';
      }).join('')+'</div></section>').join('')+'</section>';
  const html=core+filterBar+'<div class="skill-rpg-heading"><strong>CAMINHOS DE ESPECIALIZAÇÃO</strong><span>O núcleo se divide em cinco trilhas. Desbloqueie cada nível em sequência.</span></div>'+tree+
    '<p class="skill-orbit-help">Nós dourados estão disponíveis. Nós verdes já foram aprendidos. Deslize para os lados para ver todos os caminhos.</p>'+catalog;
  const lobbyTree=$('skillTreeLobby'),hudTree=$('skillTreeHud');
  if(lobbyTree)lobbyTree.innerHTML=html;
  if(hudTree)hudTree.innerHTML=html;
  setSkillTreeZoom(skillTreeZoom);
  installSkillTreePinch(lobbyTree);
  installSkillTreePinch(hudTree);
  if($('skillPoints'))$('skillPoints').textContent=String(skillPoints);
  if($('skillPointsHud'))$('skillPointsHud').textContent=String(skillPoints);
  if($('skillCountLobby'))$('skillCountLobby').textContent=activeCount+'/15';
  if($('skillCountHud'))$('skillCountHud').textContent=activeCount+'/15';
  if($('skillBranchCountLobby'))$('skillBranchCountLobby').textContent=activeBranches.size+'/3';
  if($('skillBranchCountHud'))$('skillBranchCountHud').textContent=activeBranches.size+'/3';
}
function syncLoadoutUI() {
  const signature = selectedClass + '|' + selectedSkin + '|' + skillPoints + '|' + Array.from(unlockedSkills).sort().join(',');
  if (signature === lastSkillSignature) return;
  lastSkillSignature = signature;
  renderSkillTrees();
}

function getSharedProfileData(){return{version:2,playerClass:selectedClass,skin:selectedSkin,unlockedSkins:Array.from(unlockedSkins),skills:Array.from(unlockedSkills).slice(0,15),skillPoints:Math.max(0,Math.min(99,Number(skillPoints)||0)),equipmentDamage:Math.max(0,Math.min(18,Number(equipmentDamage)||0)),inventory:{...inventoryData},lootDrops:lootDrops.slice(-100).map(item=>({...item})),selectedItemId:selectedItemId?String(selectedItemId):null,realm:sharedProgress.realm,phase:sharedProgress.phase};}
function saveSharedProfile(){try{const p=getSharedProfileData();localStorage.setItem(SHARED_PROFILE_KEY,JSON.stringify(p));sharedProfileSeed=p;}catch(error){showNotice('Não foi possível salvar o perfil neste aparelho.');}}
function sendLoadout() {
  saveSharedProfile();
  if (offlineMode && offlineState?.players?.[0]) {
    const player = offlineState.players[0];
    player.playerClass = selectedClass;
    player.skin = selectedSkin;
    player.skills = Array.from(unlockedSkills);
    player.talentPoints = skillPoints;player.equipmentDamage=equipmentDamage;
    return;
  }
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
  if (selectedClass !== className) {
    const personalSkillIds = new Set(Object.values(CLASS_PERSONAL_SKILLS_UI).flat().map(skill => skill.id));
    let refunded = 0;
    for (const id of Array.from(unlockedSkills)) {
      if (personalSkillIds.has(id)) { unlockedSkills.delete(id); refunded++; }
    }
    skillPoints += refunded;
  }
  selectedClass = className;
  lastSkillSignature = '';
  syncLoadoutUI();
  try { localStorage.setItem('mmCharacterChoice', JSON.stringify({ playerClass: selectedClass, skin: selectedSkin })); } catch {}
  document.querySelectorAll('.class-card').forEach(el => el.classList.toggle('selected', el.dataset.class === selectedClass));
  if ($('classDescription')) $('classDescription').textContent = classDescriptions[selectedClass];
  updateClassAbilityButtons();
  updateHeroShowcase();
  refreshLocalHeroAppearance();
  if (offlineMode && offlineState?.players?.[0]) {
    const offlinePlayer = offlineState.players[0];
    offlinePlayer.playerClass = selectedClass;
    offlinePlayer.skin = selectedSkin;
    offlinePlayer.skills = Array.from(unlockedSkills);
    offlinePlayer.talentPoints = skillPoints;
    offlinePlayer.maxHp = Math.max(1, Number(offlinePlayer.maxHp) || 130);
    offlinePlayer.hp = Math.min(offlinePlayer.maxHp, Math.max(1, Number(offlinePlayer.hp) || offlinePlayer.maxHp));
    if (!offlineState.started) updateState(offlineState);
  }
  sendLoadout();
  showNotice('Classe alterada para ' + (CLASS_NAMES_UI[selectedClass] || selectedClass.toUpperCase()) + '. Veja a prévia das habilidades.');
  updateClassAbilityDemo(true);
}
document.querySelectorAll('.class-card').forEach(card => card.addEventListener('click', () => chooseClass(card.dataset.class)));
function chooseSkin(skinName) {
  if (![...FREE_LOBBY_SKINS,...CHEST_ONLY_SKINS].includes(skinName)) return;
  if(!FREE_LOBBY_SKINS.includes(skinName)&&!unlockedSkins.has(skinName)){showNotice('Essa skin secreta só pode ser encontrada em baús!');return;}
  selectedSkin = skinName;
  try { localStorage.setItem('mmCharacterChoice', JSON.stringify({ playerClass: selectedClass, skin: selectedSkin })); } catch {}
  document.querySelectorAll('.skin-pick').forEach(el => el.classList.toggle('selected', el.dataset.skin === selectedSkin));
  updateHeroShowcase();
  refreshLocalHeroAppearance();
  if (offlineMode && offlineState?.players?.[0]) {
    offlineState.players[0].skin = selectedSkin;
    offlineState.players[0].playerClass = selectedClass;
    if (!offlineState.started) updateState(offlineState);
  }
  sendLoadout();saveSharedProfile();
  closeLobbyEditor();
}
document.querySelectorAll('.skin-pick').forEach(card => card.addEventListener('click', () => chooseSkin(card.dataset.skin)));
function refreshSkinPicker(){
  const root=document.querySelector('#lobby [data-lobby-editor-panel="skin"] .skin-picks');if(!root)return;
  root.querySelectorAll('[data-chest-skin="true"]').forEach(node=>node.remove());
  const labels={rune:['Runas','Arcana','rune'],celestial:['Celestial','Lendária','celestial'],bloodmoon:['Lua Sangrenta','Sombria','bloodmoon'],frostguard:['Guarda Glacial','Gelo','frostguard'],draconic:['Dracônica','Dragão','draconic'],voidwalker:['Andarilho do Vazio','Mística','voidwalker'],verdant:['Verdejante','Natureza','verdant']};
  CHEST_ONLY_SKINS.filter(id=>unlockedSkins.has(id)).forEach(id=>{
    const info=labels[id];if(!info)return;
    const button=document.createElement('button');button.type='button';button.className='skin-pick';button.dataset.skin=id;button.dataset.chestSkin='true';
    const swatch=document.createElement('span');swatch.className='skin-swatch '+info[2];
    const title=document.createElement('b');title.textContent=info[0];
    const subtitle=document.createElement('small');subtitle.textContent=info[1]+' · BAÚ';
    button.append(swatch,title,subtitle);button.addEventListener('click',()=>chooseSkin(id));root.appendChild(button);
  });
  root.querySelectorAll('.skin-pick').forEach(node=>node.classList.toggle('selected',node.dataset.skin===selectedSkin));
}
function updateHeroShowcase() {
  const classInfo = {
    knight:{name:'Cavaleiro',glyph:'⚔',desc:'Vida elevada · escudo e espada de aço'},
    mage:{name:'Mago',glyph:'✧',desc:'Energia arcana · cajado e feitiços'},
    archer:{name:'Arqueiro',glyph:'➶',desc:'Precisão · arco longo e mobilidade'},
    goblin:{name:'Goblin',glyph:'⟡',desc:'Agilidade · duas adagas e furtividade'},
    ogre:{name:'Ogro',glyph:'⚒',desc:'Força bruta · clava e armadura pesada'},
    healer:{name:'Curandeiro',glyph:'✚',desc:'Cajado de vida · cura e proteção'},
    necromancer:{name:'Necromante',glyph:'☠',desc:'Magia sombria · runas e esqueletos'},
    monk:{name:'Monge',glyph:'✊',desc:'Disciplina · punhos e golpes em sequência'},
    golem:{name:'Golem de Pedra',glyph:'⬟',desc:'Titã rochoso · defesa e impacto em área'}
  }[selectedClass] || {name:'Cavaleiro',glyph:'🛡️',desc:'Defesa elevada'};
  const skinInfo = {default:{label:'SKIN CLÁSSICA',cls:'skin-default'},shadow:{label:'SKIN SOMBRA',cls:'skin-shadow'},ember:{label:'SKIN BRASA',cls:'skin-ember'},rune:{label:'SKIN RUNAS',cls:'skin-rune'},celestial:{label:'SKIN CELESTIAL',cls:'skin-celestial'},bloodmoon:{label:'SKIN LUA SANGRENTA',cls:'skin-bloodmoon'},frostguard:{label:'GUARDA GLACIAL',cls:'skin-frostguard'},draconic:{label:'SKIN DRACÔNICA',cls:'skin-draconic'},voidwalker:{label:'ANDARILHO DO VAZIO',cls:'skin-voidwalker'},verdant:{label:'SKIN VERDEJANTE',cls:'skin-verdant'}}[selectedSkin] || {label:'SKIN CLÁSSICA',cls:'skin-default'};
  refreshSkinPicker();
  const skinCount=$('unlockedSkinCount');if(skinCount)skinCount.textContent=CHEST_ONLY_SKINS.filter(id=>unlockedSkins.has(id)).length+'/7 DESBLOQUEADAS';
  const avatar=$('heroPreviewAvatar');
  if(avatar){avatar.className='hero-preview-avatar '+skinInfo.cls+' class-'+selectedClass;}
  if($('heroPreviewGlyph')) { $('heroPreviewGlyph').textContent=classInfo.glyph; $('heroPreviewGlyph').setAttribute('aria-hidden','true'); }
  if($('heroPreviewName')) $('heroPreviewName').textContent=classInfo.name;
  if($('heroPreviewDesc')) $('heroPreviewDesc').textContent=classInfo.desc;
  if($('heroPreviewSkin')) $('heroPreviewSkin').textContent=skinInfo.label;
  if($('lobbyClassCurrent')) $('lobbyClassCurrent').textContent=classInfo.name.toUpperCase();
  document.querySelectorAll('.class-card').forEach(el=>el.classList.toggle('selected',el.dataset.class===selectedClass));
  document.querySelectorAll('.skin-pick').forEach(el=>el.classList.toggle('selected',el.dataset.skin===selectedSkin));
  refreshLobby3DPreview();
}

function buildLobbyStageBackdrop() {
  // Palco de apresentação compacto: sem o portal gigante que engolia a silhueta.
  const stone=new THREE.MeshStandardMaterial({color:0x172638,metalness:.38,roughness:.54});
  const trim=new THREE.MeshStandardMaterial({color:0xc5a66b,metalness:.58,roughness:.34});
  const glow=new THREE.MeshStandardMaterial({color:0x70def2,emissive:0x1b9fca,emissiveIntensity:1.05,metalness:.2,roughness:.3});
  const deep=new THREE.MeshStandardMaterial({color:0x0a1521,roughness:.9});
  const back=new THREE.Mesh(new THREE.PlaneGeometry(3.1,3.5),new THREE.MeshBasicMaterial({color:0x081522,transparent:true,opacity:.52,depthWrite:false}));
  back.position.set(0,1.42,-1.42);lobbyPreviewScene.add(back);
  // Duas colunas menores emolduram o personagem sem competir com ele.
  const pillarGeo=new THREE.CylinderGeometry(.10,.15,1.95,8);
  const capGeo=new THREE.CylinderGeometry(.17,.18,.12,8);
  for(const side of [-1,1]){
    const x=side*.98;
    const pillar=new THREE.Mesh(pillarGeo,stone);pillar.position.set(x,.98,-1.08);lobbyPreviewScene.add(pillar);
    const base=new THREE.Mesh(capGeo,trim);base.position.set(x,.09,-1.08);lobbyPreviewScene.add(base);
    const cap=new THREE.Mesh(capGeo,trim);cap.position.set(x,1.98,-1.08);lobbyPreviewScene.add(cap);
    const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.12,0),glow);crystal.position.set(x,2.18,-1.05);crystal.rotation.z=side*.2;lobbyPreviewScene.add(crystal);
    const inset=new THREE.Mesh(new THREE.BoxGeometry(.045,.54,.025),glow);inset.position.set(x,1.02,-.91);lobbyPreviewScene.add(inset);
  }
  const headerBar=new THREE.Mesh(new THREE.BoxGeometry(1.85,.11,.12),trim);headerBar.position.set(0,2.36,-1.08);lobbyPreviewScene.add(headerBar);
  const crest=new THREE.Mesh(new THREE.OctahedronGeometry(.15,0),trim);crest.position.set(0,2.56,-1.05);crest.rotation.z=Math.PI/4;lobbyPreviewScene.add(crest);
  const innerArch=new THREE.Mesh(new THREE.TorusGeometry(.86,.027,6,40),glow);
  innerArch.position.set(0,1.20,-1.22);innerArch.scale.set(.78,1.12,1);lobbyPreviewScene.add(innerArch);
  const crystalGroup=new THREE.Group();
  const crystalMaterials=[
    new THREE.MeshStandardMaterial({color:0x70e8ff,emissive:0x28cfff,emissiveIntensity:.9,metalness:.16,roughness:.3}),
    new THREE.MeshStandardMaterial({color:0xb6a1ff,emissive:0x7958ff,emissiveIntensity:.85,metalness:.16,roughness:.3}),
    new THREE.MeshStandardMaterial({color:0x80ffbd,emissive:0x2dd987,emissiveIntensity:.8,metalness:.16,roughness:.3})
  ];
  for(let i=0;i<4;i++){
    const crystal=new THREE.Mesh(new THREE.OctahedronGeometry(.10,0),crystalMaterials[i%3]);
    const side=i%2===0?-1:1;crystal.userData.phase=i*1.4;
    crystal.userData.baseY=.55+(i%2)*.44;crystal.userData.baseX=side*(.78+(i%2)*.12);
    crystal.userData.baseZ=-.12-(i%2)*.16;crystal.position.set(crystal.userData.baseX,crystal.userData.baseY,crystal.userData.baseZ);
    crystal.rotation.set(.2*i,.5*i,.1*i);crystalGroup.add(crystal);
  }
  lobbyPreviewCrystals=crystalGroup;lobbyPreviewScene.add(lobbyPreviewCrystals);
}


function initLobby3DPreview() {
  if (lobbyPreviewScene || !renderer) return;
  lobbyPreviewScene = new THREE.Scene();
  lobbyPreviewScene.background = null;
  lobbyPreviewCamera = new THREE.PerspectiveCamera(38, 0.62, 0.1, 50);
  lobbyPreviewCamera.position.set(0, 1.52, 5.75);
  lobbyPreviewCamera.lookAt(0, 1.12, 0);
  lobbyPreviewScene.add(new THREE.HemisphereLight(0xe3f6ff, 0x263448, 2.5));
  const keyLight = new THREE.DirectionalLight(0xffe5b0, 3.0);
  keyLight.position.set(-3.8, 6, 4.5); lobbyPreviewScene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x63ccff, 2.2);
  fillLight.position.set(4, 3, 2.5); lobbyPreviewScene.add(fillLight);
  const rimLight = new THREE.PointLight(0x4fcfff, 8, 10, 2);
  rimLight.position.set(0, 2.5, -1.3); lobbyPreviewScene.add(rimLight);
  buildLobbyStageBackdrop();
  const baseMaterial = new THREE.MeshStandardMaterial({color:0x132638,metalness:0.55,roughness:0.35,emissive:0x10384a,emissiveIntensity:0.55});
  // Plataforma mais larga para acomodar o herói central e dois aliados no lobby.
  lobbyPreviewPlatform = new THREE.Mesh(new THREE.CylinderGeometry(1.18,1.28,0.13,44),baseMaterial);
  lobbyPreviewPlatform.position.y = -0.105; lobbyPreviewScene.add(lobbyPreviewPlatform);
  lobbyPreviewRing = new THREE.Mesh(new THREE.TorusGeometry(1.21,0.025,7,56),new THREE.MeshBasicMaterial({color:0x80eaff,transparent:true,opacity:.9}));
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
  const now = performance.now();
  if (lobbyPreviewExitingHero) {
    lobbyPreviewScene.remove(lobbyPreviewExitingHero);
    disposeObject3D(lobbyPreviewExitingHero);
    lobbyPreviewExitingHero = null;
  }
  if (lobbyPreviewHero) {
    lobbyPreviewExitingHero = lobbyPreviewHero;
    lobbyPreviewExitingHero.userData.lobbyExitStartedAt = now;
    lobbyPreviewExitingHero.userData.lobbyExitBaseScale = lobbyPreviewExitingHero.scale.x;
    lobbyPreviewExitingHero.userData.lobbyExitBaseY = lobbyPreviewExitingHero.position.y;
  }
  lobbyPreviewHero = makeHero(null, selectedClass || 'knight', selectedSkin || 'default');
  const baseScale = selectedClass==='ogre'||selectedClass==='golem'?1.02:.98;
  lobbyPreviewHero.userData.lobbyEntryBaseScale = baseScale;
  lobbyPreviewHero.userData.lobbyEntryStartedAt = now;
  lobbyPreviewHero.scale.setScalar(.035);
  lobbyPreviewHero.position.set(0,-.28,0);
  lobbyPreviewHero.rotation.y = Math.PI;
  if (lobbyPreviewHero.userData.healthBar) lobbyPreviewHero.userData.healthBar.visible = false;
  lobbyPreviewScene.add(lobbyPreviewHero);
  lobbyPreviewTransitionStartedAt = now;
  lobbySelectionBurstStartedAt = now;
}
function refreshLobby3DCompanions(players) {
  if (!lobbyPreviewScene) return;
  const companions = (Array.isArray(players) ? players : [])
    .filter(p => String(p.id) !== String(playerId))
    .slice(0, 2);
  const signature = companions.map(p => [p.id,p.playerClass||'knight',p.skin||'default',p.color||0].join(':')).join('|');
  if (signature === lobbyPreviewRosterSignature) return;
  lobbyPreviewRosterSignature = signature;
  if (lobbyPreviewCompanions) {
    lobbyPreviewScene.remove(lobbyPreviewCompanions);
    disposeObject3D(lobbyPreviewCompanions);
    lobbyPreviewCompanions = null;
  }
  if (!companions.length) return;
  lobbyPreviewCompanions = new THREE.Group();
  const slots = [{x:-.92,z:-.10,rot:-.12},{x:.92,z:-.10,rot:.12}];
  companions.forEach((p,index) => {
    const avatar = makeHero(p.color || null, p.playerClass || 'knight', p.skin || 'default');
    avatar.scale.setScalar(.42);
    avatar.position.set(slots[index].x,0,slots[index].z);
    avatar.rotation.y = Math.PI + slots[index].rot;
    if (avatar.userData.healthBar) avatar.userData.healthBar.visible = false;
    avatar.userData.lobbyCompanionIndex = index;
    lobbyPreviewCompanions.add(avatar);
  });
  lobbyPreviewScene.add(lobbyPreviewCompanions);
}
function renderLobby3DPreview() {
  if (!renderer || !lobbyPreviewScene || !lobbyPreviewCamera || !lobbyPreviewHero) return;
  const lobbyVisible = $('lobby') && !$('lobby').classList.contains('hidden');
  if (!lobbyVisible) return;
  const canvasRect = renderer.domElement.getBoundingClientRect();
  const width = renderer.domElement.clientWidth || innerWidth;
  const height = renderer.domElement.clientHeight || innerHeight;
  const showcase = document.querySelector('#lobby .hero-showcase');
  const rect = showcase?.getBoundingClientRect();
  if (!rect || width < 2 || height < 2 || rect.width < 2 || rect.height < 2) return;
  const portrait = innerHeight >= innerWidth;
  // A viewport 3D é alinhada ao cartão real do personagem, sem cobrir o restante do lobby.
  const left = Math.max(0, Math.floor(rect.left - canvasRect.left));
  const bottom = Math.max(0, Math.floor(canvasRect.bottom - rect.bottom));
  const previewWidth = Math.max(1, Math.min(Math.floor(rect.width), width - left));
  const previewHeight = Math.max(1, Math.min(Math.floor(rect.height), height - bottom));
  if (previewWidth < 2 || previewHeight < 2) return;
  const top = height - bottom - previewHeight;
  const time = clock ? clock.elapsedTime : 0;
  lobbyPreviewHero.rotation.y = Math.PI + Math.sin(time*0.32)*0.075;
  if (lobbyPreviewCompanions) lobbyPreviewCompanions.children.forEach((avatar,index) => {
    avatar.rotation.y = Math.PI + (index===0 ? -.12 : .12) + Math.sin(time*.28+index)*.045;
    avatar.position.y = Math.sin(time*1.05+index*2.1)*.018;
  });
  const now = performance.now();
  if (lobbyPreviewExitingHero) {
    const exitProgress = THREE.MathUtils.clamp((now - lobbyPreviewExitingHero.userData.lobbyExitStartedAt) / 360, 0, 1);
    const exitScale = lobbyPreviewExitingHero.userData.lobbyExitBaseScale * (1 - exitProgress);
    lobbyPreviewExitingHero.scale.setScalar(Math.max(.001, exitScale));
    lobbyPreviewExitingHero.position.y = lobbyPreviewExitingHero.userData.lobbyExitBaseY + exitProgress * .34;
    lobbyPreviewExitingHero.rotation.y += .035;
    if (exitProgress >= 1) {
      lobbyPreviewScene.remove(lobbyPreviewExitingHero);
      disposeObject3D(lobbyPreviewExitingHero);
      lobbyPreviewExitingHero = null;
    }
  }
  const entryProgress = THREE.MathUtils.clamp((now - lobbyPreviewHero.userData.lobbyEntryStartedAt) / 560, 0, 1);
  const entryEase = 1 + 1.45 * Math.pow(entryProgress - 1, 3) + .45 * Math.pow(entryProgress - 1, 2);
  const entryScale = entryProgress >= 1 ? 1 : Math.max(.035, entryEase);
  lobbyPreviewHero.scale.setScalar(lobbyPreviewHero.userData.lobbyEntryBaseScale * entryScale);
  lobbyPreviewHero.position.y = (1 - entryProgress) * -.28;
  lobbyPreviewHero.visible = true;
  const heroClass = lobbyPreviewHero.userData.heroClass || selectedClass || 'knight';
  const idle = time * (heroClass === 'mage' ? 1.35 : heroClass === 'archer' ? 1.7 : 1.05);
  const breath = Math.sin(idle) * 0.028;
  lobbyPreviewHero.position.y = Math.sin(time*1.25)*0.012 + breath;
  if(lobbyPreviewHero.userData.headRig){
    lobbyPreviewHero.userData.headRig.rotation.x=Math.sin(idle*.72)*.035;
    lobbyPreviewHero.userData.headRig.rotation.y=Math.sin(idle*.43+.8)*.075;
  }
  for(const eye of lobbyPreviewHero.userData.faceEyes||[]){
    if(eye.mesh)eye.mesh.position.x=eye.baseX+Math.sin(idle*.5)*.012;
  }
  if(lobbyPreviewHero.userData.torso && Number.isFinite(lobbyPreviewHero.userData.torsoBaseScaleY)){
    lobbyPreviewHero.userData.torso.scale.y=lobbyPreviewHero.userData.torsoBaseScaleY*(1+Math.sin(idle)*.012);
  }
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
    const ringBurst = THREE.MathUtils.clamp((now - lobbySelectionBurstStartedAt) / 520, 0, 1);
    const ringPulse = ringBurst < 1 ? 1.18 - ringBurst * .18 : 1 + Math.sin(time*1.5)*.025;
    lobbyPreviewRing.scale.setScalar(ringPulse);
  }
  if (lobbyPreviewRunes) {
    lobbyPreviewRunes.rotation.y = time * (heroClass === 'mage' ? .24 : heroClass === 'archer' ? -.13 : .09);
    lobbyPreviewRunes.children.forEach((rune,index)=>{
      rune.material.color.setHex(effectPalette.glow);
      rune.material.opacity = .2 + (Math.sin(time*1.7+index*1.8)+1)*.1;
    });
  }
  if (lobbyPreviewParticles) {
    const burstProgress = THREE.MathUtils.clamp((now - lobbySelectionBurstStartedAt) / 520, 0, 1);
    lobbyPreviewParticles.children.forEach((particle,index)=>{
      const phase = particle.userData.phase + time*(heroClass === 'mage' ? .7 : heroClass === 'archer' ? -.45 : .32);
      const orbitRadius = particle.userData.radius + Math.sin(time*1.1+index)*.045;
      if (burstProgress < 1) {
        const burstRadius = .16 + burstProgress * (1.15 + (index % 4) * .12);
        particle.position.set(Math.cos(phase)*burstRadius, .18 + particle.userData.height*burstProgress + Math.sin(phase)*.08, Math.sin(phase)*burstRadius*.42);
        particle.material.opacity = .9 * (1 - burstProgress) + .12;
      } else {
        particle.position.set(Math.cos(phase)*orbitRadius,particle.userData.height+Math.sin(phase*1.4)*.12,Math.sin(phase)*orbitRadius*.42);
        particle.material.opacity = .25 + (Math.sin(phase*1.7)+1)*.25;
      }
      particle.material.color.setHex(effectPalette.color);
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
  lobbyPreviewCamera.position.z = portrait ? 5.75 : 5.2;
  lobbyPreviewCamera.updateProjectionMatrix();
  lobbyPreviewCamera.lookAt(0,1.12,0);
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
function getCurrentSkillBranches() {
  return SKILL_BRANCHES.map(branch => branch.id === 'arcane'
    ? {...branch, title:'✦ MELHORIAS EXCLUSIVAS · '+(CLASS_NAMES_UI[selectedClass]||'CLASSE'), skills:CLASS_PERSONAL_SKILLS_UI[selectedClass]||CLASS_PERSONAL_SKILLS_UI.knight}
    : branch);
}
function handleSkillClick(event) {
  const filterButton = event.target.closest('[data-skill-filter]');
  if (filterButton) {
    const nextFilter = filterButton.dataset.skillFilter;
    if (!['all','available','unlocked'].includes(nextFilter)) return;
    activeSkillFilter = nextFilter;
    renderSkillTrees();
    return;
  }
  const button = event.target.closest('[data-skill]');
  if (!button) return;
  const branches = getCurrentSkillBranches();
  const branch = branches.find(item => item.id === button.dataset.branch && item.skills.some(entry => entry.id === button.dataset.skill));
  const skill = branch?.skills.find(item => item.id === button.dataset.skill);
  if (!skill || button.disabled) return;
  const activeBranches = new Set(branches.filter(item => item.skills.some(entry => unlockedSkills.has(entry.id))).map(item => item.id));
  if (unlockedSkills.size >= 15 || unlockedSkills.has(skill.id) || skillPoints < 1 ||
      (skill.req && !unlockedSkills.has(skill.req)) ||
      (!activeBranches.has(branch.id) && activeBranches.size >= 3)) {
    showNotice(unlockedSkills.size >= 15 ? 'Limite de 15 skills atingido.' :
      skillPoints < 1 ? 'Você não tem pontos disponíveis.' :
      skill.req && !unlockedSkills.has(skill.req) ? 'Desbloqueie primeiro o talento anterior.' :
      'Você pode desenvolver no máximo 3 ramos da árvore.');
    return;
  }
  unlockedSkills.add(skill.id);
  skillPoints--;
  lastSkillSignature = '';
  syncLoadoutUI();
  sendLoadout();
  vibrateGame(18);
  showNotice('✦ ' + skill.name + ' desbloqueada!');
  // Keep the selected branch in view on narrow screens after the tree re-renders.
  const matchingNodes = document.querySelectorAll('[data-skill="' + skill.id + '"]');
  matchingNodes.forEach(node => {
    const branchNode = node.closest('.skill-path-branch');
    const board = node.closest('.skill-rpg-scroll');
    if (board && !matchMedia('(pointer:coarse)').matches) board.scrollTo({left:Math.max(0,node.offsetLeft - board.clientWidth/2),behavior:'auto'});
    node.focus({preventScroll:true});
  });
}
$('skillTreeLobby')?.addEventListener('click', handleSkillClick);
$('skillTreeHud')?.addEventListener('click', handleSkillClick);
function handleSkillSearch(event) {
  const input = event.target.closest('[data-skill-search]');
  if (!input) return;
  const selectionStart = input.selectionStart;
  activeSkillSearch = input.value.slice(0,40);
  const focused = document.activeElement;
  renderSkillTrees();
  const replacement = focused?.closest?.('[data-skill-search]') ?
    document.querySelector('#skillTreeLobby [data-skill-search], #skillTreeHud [data-skill-search]') : null;
  if (replacement) { replacement.focus(); try { replacement.setSelectionRange(selectionStart,selectionStart); } catch {} }
}
$('skillTreeLobby')?.addEventListener('input', handleSkillSearch);
$('skillTreeHud')?.addEventListener('input', handleSkillSearch);
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
  saveSharedProfile();
  send({
    type: quickMatchRequested ? 'joinPublic' : 'join',
    resumeToken,
    name: $('playerName').value.trim() || 'Aventureiro',
    class: selectedClass,
    skin: selectedSkin,
    skills: Array.from(unlockedSkills),
    talentPoints: skillPoints,
    code,
    gameMode: selectedGameMode,
    public: joiningPublicRoom,
    profile:getSharedProfileData()
  });
  joiningPublicRoom = false;
  quickMatchRequested = false;
}


let offlineMode = false;
let offlineState = null;
let offlineLoop = null;
let offlineLastHit = 0;
let offlineDefeatNoticeShown = false;
let offlineReturnSnapshot = null;
function createOfflineState() {
  const player = {
    id: 'offline-player',
    name: $('playerName')?.value.trim() || 'Aventureiro',
    x: 0, z: 3, rot: 0, hp: 130, maxHp: 130, mana: 100, maxMana: 100,
    playerClass: selectedClass, skin: selectedSkin,
    skills: Array.from(unlockedSkills), talentPoints: skillPoints, equipmentDamage,
    ready: true, isHost: true, color: 0x72e6ff
  };
  const kinds = ['stalker','stalker','brute','wraith','thorn'];
  const monsters = kinds.map((kind, i) => {
    const hp = kind === 'brute' ? 24 : 14;
    return {
      id: 'offline-monster-' + i, kind, phase: 1, realm: 1,
      x: (i - 2) * 3.2, z: -10 - (i % 2) * 3,
      alive: true, hp, maxHp: hp, spawned: true
    };
  });
  return {
    type: 'state', gameMode: 'coop', players: [player], summons: [],
    phase: 1, realm: 1, safeZoneUntil: 0, started: true, hostId: player.id,
    monsters, boss: null, portalOpen: false,
    chests: [
      {id:'offline-chest-1',x:-8,z:-12,opened:false},
      {id:'offline-chest-2',x:8,z:-44,opened:false}
    ]
  };
}

function startOfflineExploration() {
  saveSharedProfile();
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  connectionRequested = false;
  clearTimeout(reconnectTimer);
  offlineMode = true;
  offlineDefeatNoticeShown = false;
  playerId = 'offline-player';
  roomCode = 'OFFLINE';
  activeGameMode = 'coop';
  selectedGameMode = 'coop';
  if ($('gameModeSelect')) $('gameModeSelect').value = 'coop';
  $('menu').classList.add('hidden');
  $('lobby').classList.add('hidden');
  $('loading').classList.add('hidden');
  // O modo offline usa o mesmo inventário, talentos, equipamentos e skins do online.
  offlineState = createOfflineState();
  // A prévia offline sempre permite retomar a exploração após uma derrota anterior.
  const offlinePlayer = offlineState?.players?.[0];
  if (offlinePlayer) {
    offlinePlayer.playerClass = selectedClass;
    offlinePlayer.skin = selectedSkin;
    offlinePlayer.skills = Array.from(unlockedSkills);
    offlinePlayer.talentPoints = skillPoints;
    offlinePlayer.baseMaxHp = Number.isFinite(Number(offlinePlayer.baseMaxHp))
      ? Number(offlinePlayer.baseMaxHp) : (Number(offlinePlayer.maxHp) > 0 ? Number(offlinePlayer.maxHp) : 130);
    const classHpBonus = (offlineHasSkill('vitality')?25:0)+(offlineHasSkill('final_blessing')?15:0)+
      (offlineHasSkill('knight_fortress')?15:0)+(offlineHasSkill('archer_hawkeye')?5:0)+
      (offlineHasSkill('goblin_agility')?5:0)+(offlineHasSkill('ogre_blood')?20:0)+
      (offlineHasSkill('healer_mercy')?10:0)+(offlineHasSkill('necromancer_soul')?10:0)+
      (offlineHasSkill('monk_ironbody')?12:0)+(offlineHasSkill('golem_granite')?20:0)+
      (offlineHasSkill('golem_mountaincore')?25:0);
    const maxHp = Math.max(1,offlinePlayer.baseMaxHp+classHpBonus);
    const wasDefeated = !Number.isFinite(Number(offlinePlayer.hp)) || Number(offlinePlayer.hp) <= 0;
    offlinePlayer.maxHp = maxHp;
    offlinePlayer.hp = wasDefeated ? maxHp : Math.min(maxHp,Number(offlinePlayer.hp));
    offlinePlayer.maxMana = Number(offlinePlayer.maxMana)||100;
    offlinePlayer.mana = wasDefeated ? offlinePlayer.maxMana : Math.min(offlinePlayer.maxMana,Number(offlinePlayer.mana)||0);
    offlineDefeatNoticeShown = false;
    lastSkillSignature = '';
    syncLoadoutUI();
    updateClassAbilityButtons();
  }
  offlineState.started = false;
  updateState(offlineState);
  renderInventory();
  $('roomLabel').textContent = 'OFFLINE';
  $('lobbyRoomCode').textContent = 'OFFLINE';
  openLobbyEditor('class');
  saveSharedProfile();
  showNotice('Modo offline · perfil compartilhado com o online neste aparelho.');
  if (offlineLoop) clearInterval(offlineLoop);
  offlineLoop = null;
}

function offlineHasSkill(id) {
  const player = offlineState?.players?.[0];
  return unlockedSkills.has(id) || !!player?.skills?.includes(id);
}

function offlineLivingMonsters() {
  return (offlineState?.monsters || []).filter(monster => monster && monster.alive && monster.hp > 0);
}

function offlineDamageMonster(monster, amount, burnMs = 0, pushFrom = null, pushDistance = 0) {
  if (!monster?.alive || !Number.isFinite(amount) || amount <= 0) return false;
  monster.hp = Math.max(0, Number(monster.hp || 0) - amount);
  if (burnMs > 0 && monster.hp > 0) {
    monster.burnUntil = Math.max(monster.burnUntil || 0, Date.now() + burnMs);
    monster.burnNextAt = Math.min(monster.burnNextAt || Date.now() + 1000, Date.now() + 1000);
  }
  if (pushFrom && pushDistance > 0 && monster.hp > 0) {
    const dx = monster.x - pushFrom.x, dz = monster.z - pushFrom.z;
    const distance = Math.hypot(dx, dz) || 1;
    monster.x += dx / distance * pushDistance;
    monster.z += dz / distance * pushDistance;
  }
  if (monster.hp <= 0) {
    monster.alive = false;
    if (Math.random() < (offlineHasSkill('loot_sense') ? .30 : .18)) {
      const roll=Math.random(),rarity=roll>.96?'lendário':roll>.84?'épico':roll>.58?'raro':roll>.28?'incomum':'comum';
      const names={comum:'Moeda Antiga',incomum:'Pó de Cristal',raro:'Fragmento Monocromático',épico:'Núcleo Sombrio',lendário:'Cristal Ancestral'};
      const item={id:'offline-loot-'+Date.now()+'-'+Math.floor(Math.random()*1000),name:names[rarity],rarity,power:{comum:1,incomum:2,raro:3,épico:4,lendário:5}[rarity],source:'monster'};
      lootDrops.unshift(item);
      inventoryData[rarity] = (inventoryData[rarity] || 0) + 1;
      saveSharedProfile();renderInventory();
      showNotice('Loot encontrado: '+item.name+' ('+rarity+').');
    }
  }
  return true;
}

function offlineDamageArea(x, z, radius, damage, burnMs = 0, pushDistance = 0) {
  const targets = [];
  for (const monster of offlineLivingMonsters()) {
    if (Math.hypot(monster.x - x, monster.z - z) > radius) continue;
    offlineDamageMonster(monster, damage, burnMs, {x,z}, pushDistance);
    targets.push({x:monster.x,z:monster.z});
  }
  return targets;
}

function offlineNearestMonster(range = 14) {
  const player = offlineState?.players?.[0];
  if (!player) return null;
  return offlineLivingMonsters()
    .map(monster => ({monster,distance:Math.hypot(monster.x-player.x,monster.z-player.z)}))
    .filter(item => item.distance <= range)
    .sort((a,b)=>a.distance-b.distance)[0]?.monster || null;
}

function offlineCreateSummon(kind, index, total, duration, hp, damage, attackMs) {
  const player = offlineState?.players?.[0];
  if (!player) return null;
  offlineState.summons = Array.isArray(offlineState.summons) ? offlineState.summons : [];
  const count = offlineState.summons.filter(s => s.ownerId === player.id && s.expiresAt > Date.now()).length;
  if (count >= 10) return null;
  const angle = Math.PI * 2 * index / Math.max(1, total);
  const summonType = kind === 'goblin' ? 'goblin' : kind === 'skeleton' ? 'skeleton' : kind === 'golem' ? 'stone_golem_clone' : 'guardian_spirit';
  const isSpirit = kind === 'spirit';
  const summon = {
    id:'offline-summon-'+kind+'-'+Date.now()+'-'+index+'-'+Math.floor(Math.random()*9999),
    ownerId:player.id,
    summonType:isSpirit?'guardian_spirit':summonType,
    name:isSpirit?'Espírito Guardião':kind==='golem'?'Fragmento de Golem':kind==='skeleton'?'Esqueleto aliado':'Goblin aliado',
    playerClass:isSpirit?'guardian_spirit':kind==='golem'?'golem_clone':kind==='skeleton'?'skeleton':'goblin',
    skin:kind==='skeleton'?'shadow':isSpirit?'celestial':'default',
    color:isSpirit?0x8cffe8:kind==='golem'?0x8a9096:kind==='skeleton'?0xe0dccb:0x80c86b,
    x:player.x+Math.cos(angle)*1.35,z:player.z+Math.sin(angle)*1.35,rot:player.rot||0,
    hp:isSpirit?1:hp,maxHp:isSpirit?1:hp,damage:damage||0,attackMs:attackMs||1000,
    expiresAt:Date.now()+duration,nextAttackAt:Date.now()+700,
    nextHealAt:Date.now()+4000,nextDamageAt:Date.now()+5000
  };
  offlineState.summons.push(summon);
  return summon;
}

function offlineMoveForward(distance) {
  const player = offlineState?.players?.[0];
  if (!player) return;
  const heading = Number(player.rot) || 0;
  player.x -= Math.sin(heading) * distance;
  player.z -= Math.cos(heading) * distance;
  if (myPlayer) myPlayer.position.set(player.x,0,player.z);
}

function handleOfflineSpell(spell) {
  const player=offlineState?.players?.[0];
  if(!player||player.hp<=0)return;
  const isMage=player.playerClass==='mage',isNecromancer=player.playerClass==='necromancer',isHealer=player.playerClass==='healer';
  const valid=(isMage&&['fire','lightning','arcane'].includes(spell))||(isNecromancer&&spell==='bone')||(isHealer&&spell==='healing');
  if(!valid)return;
  const costs={fire:20,lightning:15,arcane:18,bone:16,healing:18},manaCost=costs[spell]||16;
  if((Number(player.mana)||0)<manaCost){
    const slot=spell==='fire'?0:spell==='lightning'?1:2;
    if(slot===0)fireCooldown=0;else if(slot===1)lightningCooldown=0;else thirdCooldown=0;
    showNotice('✦ Mana insuficiente! Espere regenerar.');
    return;
  }
  player.mana=Math.max(0,(Number(player.mana)||0)-manaCost);
  if(spell==='healing'){
    const before=player.hp;player.hp=Math.min(player.maxHp,player.hp+28);
    showNotice(player.hp>before?'✚ Orbe da vida! +'+(player.hp-before)+' de vida.':'✚ Orbe da vida! Sua energia vital já está completa.');
    return;
  }
  const target=offlineNearestMonster(spell==='bone'?10:spell==='arcane'?9:7);
  if(!target){showNotice('Nenhum inimigo ao alcance da magia.');return;}
  const power=(offlineHasSkill('mage_focus')?1.18:1)*(offlineHasSkill('mage_mana')?1.15:1)*(offlineHasSkill('mana_surge')?1.25:1);
  const targets=[];
  if(spell==='fire'){
    const damage=Math.max(1,Math.round(10*power)+(offlineHasSkill('mage_ember')?2:0)+(offlineHasSkill('mage_starseer')?1:0));
    const affected=offlineLivingMonsters().filter(m=>Math.hypot(m.x-target.x,m.z-target.z)<=2.6&&Math.hypot(m.x-player.x,m.z-player.z)<=8.5).slice(0,5);
    if(!affected.includes(target))affected.unshift(target);
    affected.slice(0,5).forEach(monster=>{offlineDamageMonster(monster,damage,offlineHasSkill('mage_ember')?6500:3500);targets.push({x:monster.x,z:monster.z});});
    showNotice('🔥 Bola de fogo! '+targets.length+' inimigo(s) atingido(s).');
  }else if(spell==='lightning'){
    let previous=target;const hit=new Set(),maxHops=offlineHasSkill('mage_chain')?5:2;
    for(let hop=0;hop<maxHops;hop++){
      if(!previous||hit.has(previous.id))break;hit.add(previous.id);
      const amount=Math.max(1,Math.round((hop===0?8:hop===1?5:3)*power));
      offlineDamageMonster(previous,amount);targets.push({x:previous.x,z:previous.z});
      previous=offlineLivingMonsters().filter(m=>!hit.has(m.id)&&Math.hypot(m.x-previous.x,m.z-previous.z)<=5)
        .sort((a,b)=>Math.hypot(a.x-previous.x,a.z-previous.z)-Math.hypot(b.x-previous.x,b.z-previous.z))[0];
    }
    showNotice('⚡ Raio em cadeia! '+targets.length+' inimigo(s) atingido(s).');
  }else if(spell==='arcane'){
    const damage=Math.max(1,Math.round(16*power));
    offlineDamageMonster(target,damage);targets.push({x:target.x,z:target.z});
    const splash=offlineLivingMonsters().filter(m=>m!==target&&Math.hypot(m.x-target.x,m.z-target.z)<=1.8).slice(0,2);
    splash.forEach(monster=>{offlineDamageMonster(monster,Math.round(damage*.45));targets.push({x:monster.x,z:monster.z});});
    showNotice('✦ Orbe arcano! '+damage+' de dano mágico.');
  }else{
    const damage=Math.max(1,Math.round(19*power));
    offlineDamageMonster(target,damage);target.stunnedUntil=Date.now()+850;targets.push({x:target.x,z:target.z});
    showNotice('☽ Orbe ósseo! A energia branca atingiu e desacelerou o inimigo.');
  }
  saveSharedProfile();
}

function spawnOfflineWave(phase,realm){
  if(!offlineState)return;
  const kindSets={
    1:['stalker','stalker','brute','wraith','thorn'],
    2:['wraith','thorn','assassin','stalker','brute'],
    3:['assassin','wraith','abyss','thorn','brute'],
    4:['abyss','assassin','brute','inferno','wraith'],
    5:['inferno','abyss','brute','assassin','inferno']
  };
  const kinds=kindSets[phase]||kindSets[5],baseZ=-((phase-1)*32+10);
  const healthScale=1+(phase-1)*.18+(realm-1)*.28;
  const batch=kinds.map((kind,index)=>{
    const base=kind==='brute'?34:kind==='abyss'||kind==='inferno'?27:kind==='thorn'?22:16;
    const hp=Math.round(base*healthScale);
    return{id:'offline-r'+realm+'-p'+phase+'-'+Date.now()+'-'+index,kind,phase,realm,
      x:-8+index*4,z:baseZ-(index%2)*2.4,alive:true,hp,maxHp:hp,spawned:true,moveSpeed:kind==='brute'?.23:kind==='assassin'?.37:.30};
  });
  offlineState.monsters=[...(offlineState.monsters||[]).filter(monster=>monster.alive),...batch];
  offlineState.portalOpen=false;
}
function offlineUseItem(itemId){
  const index=lootDrops.findIndex(entry=>String(entry.id)===String(itemId));
  if(index<0){showNotice('Este item não está mais no inventário.');renderInventory();return;}
  const player=offlineState?.players?.[0];
  if(!player||player.hp<=0){showNotice('Você precisa estar vivo para usar itens.');return;}
  const item=lootDrops[index];
  const effects={
    comum:{potion:.30,coin:.10,powderHeal:.15,powderDamage:1,powderHits:3,fragmentDamage:1,fragmentHits:4,coreDamage:2,coreHits:4,gearDamage:1,heart:.40,ancientDamage:3,ancientHits:5},
    incomum:{potion:.45,coin:.15,powderHeal:.25,powderDamage:2,powderHits:4,fragmentDamage:2,fragmentHits:5,coreDamage:3,coreHits:5,gearDamage:2,heart:.55,ancientDamage:5,ancientHits:7},
    raro:{potion:.60,coin:.25,powderHeal:.35,powderDamage:3,powderHits:5,fragmentDamage:3,fragmentHits:6,coreDamage:5,coreHits:7,gearDamage:3,heart:.70,ancientDamage:7,ancientHits:9},
    épico:{potion:.80,coin:.35,powderHeal:.50,powderDamage:5,powderHits:7,fragmentDamage:5,fragmentHits:8,coreDamage:7,coreHits:9,gearDamage:5,heart:.85,ancientDamage:10,ancientHits:12},
    lendário:{potion:1,coin:.50,powderHeal:.70,powderDamage:8,powderHits:10,fragmentDamage:8,fragmentHits:12,coreDamage:10,coreHits:12,gearDamage:8,heart:1,ancientDamage:15,ancientHits:16}
  };
  const tier=effects[item.rarity]||effects.comum,maxHp=Math.max(1,Number(player.maxHp)||130);
  const heal=fraction=>Math.max(1,Math.round(maxHp*fraction));
  let message='';
  if(['Poção de Vida','Moeda Antiga','Coração do Guardião'].includes(item.name)){
    const key=item.name==='Poção de Vida'?'potion':item.name==='Moeda Antiga'?'coin':'heart';
    if(player.hp>=maxHp){
      if(item.name==='Coração do Guardião'){player.shieldUntil=Date.now()+2500;message='Escudo de emergência por 2,5 segundos.';}
      else if(item.name==='Moeda Antiga'){player.damageBuff=Math.max(player.damageBuff||0,1);player.damageBuffHits=Math.max(player.damageBuffHits||0,2);message='Bônus de dano +1 por 2 golpes.';}
      else{const beforeMana=player.mana||0;player.mana=Math.min(player.maxMana||100,beforeMana+Math.round((player.maxMana||100)*.2));message='Mana +'+(player.mana-beforeMana)+'.';}
    }else{
      const before=player.hp;player.hp=Math.min(maxHp,player.hp+heal(tier[key]));message='Vida +'+(player.hp-before)+'.';
    }
  }else if(item.name==='Pó de Cristal'){
    const before=player.hp;player.hp=Math.min(maxHp,player.hp+heal(tier.powderHeal));
    player.damageBuff=Math.max(player.damageBuff||0,tier.powderDamage);player.damageBuffHits=Math.max(player.damageBuffHits||0,tier.powderHits);
    message='Vida +'+(player.hp-before)+' e dano +'+tier.powderDamage+' por '+tier.powderHits+' golpes.';
  }else if(['Fragmento Monocromático','Núcleo Sombrio','Cristal Ancestral'].includes(item.name)){
    const damage=item.name==='Cristal Ancestral'?tier.ancientDamage:item.name==='Núcleo Sombrio'?tier.coreDamage:tier.fragmentDamage;
    const hits=item.name==='Cristal Ancestral'?tier.ancientHits:item.name==='Núcleo Sombrio'?tier.coreHits:tier.fragmentHits;
    player.damageBuff=Math.max(player.damageBuff||0,damage);player.damageBuffHits=Math.max(player.damageBuffHits||0,hits);
    message='Dano +'+damage+' por '+hits+' golpes.';
  }else if(['Equipamento Antigo','Relíquia Monocromática'].includes(item.name)){
    equipmentDamage=Math.min(18,(equipmentDamage||0)+tier.gearDamage);player.equipmentDamage=equipmentDamage;
    message='Equipado! Ataque permanente +'+tier.gearDamage+'.';
  }else if(item.name==='Coroa do Abismo'){
    player.hp=maxHp;equipmentDamage=Math.min(18,(equipmentDamage||0)+tier.gearDamage);player.equipmentDamage=equipmentDamage;
    message='Vida restaurada e ataque permanente +'+tier.gearDamage+'.';
  }else{showNotice('Este item ainda não possui um efeito utilizável.');return;}
  lootDrops.splice(index,1);inventoryData[item.rarity]=Math.max(0,(inventoryData[item.rarity]||0)-1);
  selectedItemId=null;saveSharedProfile();renderInventory();showNotice(item.name+': '+message);playSfx('loot');
}
function handleOfflineAction(data) {
  if (!offlineState || !data) return;
  const player = offlineState.players[0];
  if(data.type==='move'&&player.hp>0){
    const requestedX=Number.isFinite(Number(data.x))?Number(data.x):player.x;
    const requestedZ=THREE.MathUtils.clamp(Number.isFinite(Number(data.z))?Number(data.z):player.z,-174,8);
    const boundedX=THREE.MathUtils.clamp(requestedX,-13,13);
    const phase=Math.max(1,Math.min(5,Number(offlineState.phase)||1));
    const realm=Math.max(1,Math.min(3,Number(offlineState.realm)||1));
    const gateZ=phase<5?-(30+(phase-1)*32):-168;
    const living=offlineLivingMonsters().length;
    if(requestedZ<gateZ&&living>0){
      const resolved=resolveDungeonMovement(player.x,player.z,boundedX,Math.max(requestedZ,gateZ+.85));
      player.x=resolved.x;player.z=Math.max(resolved.z,gateZ+.85);
      if(Date.now()-(player.lastGateNotice||0)>1800){player.lastGateNotice=Date.now();showNotice('O portão está selado! Derrote os inimigos desta fase.');}
    }else if(requestedZ<gateZ&&phase<5){
      offlineState.phase=phase+1;
      const resolved=resolveDungeonMovement(player.x,player.z,boundedX,gateZ-.8);
      player.x=resolved.x;player.z=Math.min(resolved.z,gateZ-.8);
      spawnOfflineWave(offlineState.phase,realm);
      showNotice('✦ Fase '+offlineState.phase+'/5! Uma nova horda surgiu.');
    }else if(requestedZ<gateZ&&phase===5&&realm<3){
      offlineState.realm=realm+1;offlineState.phase=1;player.x=0;player.z=3;
      spawnOfflineWave(1,offlineState.realm);
      showNotice(offlineState.realm===2?'✦ PORTAL ABERTO! Bem-vindo ao Vale Astral.':'✦ PORTAL ABERTO! Você chegou ao Eclipse Selvagem.');
    }else if(requestedZ<gateZ&&phase===5&&realm===3){
      player.x=boundedX;player.z=gateZ-.85;
      if(!offlineState.completed){offlineState.completed=true;showNotice('✦ VOCÊ CONQUISTOU OS TRÊS MUNDOS!');}
    }else{
      const resolved=resolveDungeonMovement(player.x,player.z,boundedX,boundedX===player.x?requestedZ:requestedZ);
      player.x=resolved.x;player.z=resolved.z;
    }
    offlineState.portalOpen=offlineState.phase===5&&offlineLivingMonsters().length===0;
    if(Number.isFinite(Number(data.rot)))player.rot=Number(data.rot);
  } else if (data.type === 'attack' && player.hp > 0) {
    const now = Date.now();
    if (now - offlineLastHit < (offlineHasSkill('battle_focus') ? 220 : 300)) return;
    offlineLastHit = now;
    const target = offlineState.monsters
      .filter(m => m.alive && Math.hypot(m.x - player.x, m.z - player.z) < 3.2)
      .sort((a,b) => Math.hypot(a.x-player.x,a.z-player.z)-Math.hypot(b.x-player.x,b.z-player.z))[0];
    if (target) {
      const damage=(selectedClass==='ogre'||selectedClass==='golem'?12:selectedClass==='archer'||selectedClass==='goblin'?9:8)+(equipmentDamage||0)+(player.damageBuffHits>0?(player.damageBuff||0):0)+(offlineHasSkill('hunter_instinct')||offlineHasSkill('knight_royal_oath')||offlineHasSkill('goblin_poison')||offlineHasSkill('ogre_crusher')||offlineHasSkill('necromancer_reaper')||offlineHasSkill('monk_zen')?1:0);
      if(player.damageBuffHits>0)player.damageBuffHits--;
      offlineDamageMonster(target,damage);
      showNotice(target.alive ? 'Golpe acertou o monstro!' : 'Monstro derrotado!');
    } else showNotice('Chegue mais perto do inimigo.');
  } else if (data.type === 'openChest' && player.hp > 0) {
    const chest = offlineState.chests.find(item => item.id === data.id && !item.opened);
    if (!chest || Math.hypot(chest.x-player.x,chest.z-player.z) > 3.2) {
      showNotice('Chegue perto de um baú fechado.');
      return;
    }
    chest.opened=true;
    const remainingSkins=CHEST_ONLY_SKINS.filter(skin=>!unlockedSkins.has(skin));
    if(remainingSkins.length&&Math.random()<.22){
      const skin=remainingSkins[Math.floor(Math.random()*remainingSkins.length)];
      unlockedSkins.add(skin);saveSharedProfile();updateHeroShowcase();
      showNotice('✦ Nova skin desbloqueada: '+skin+'!');playSfx('loot');
    }else{
      const roll=Math.random(),rarity=roll>.96?'lendário':roll>.84?'épico':roll>.58?'raro':roll>.28?'incomum':'comum';
      const names={comum:'Poção de Vida',incomum:'Pó de Cristal',raro:'Fragmento Monocromático',épico:'Equipamento Antigo',lendário:'Coração do Guardião'};
      const item={id:'offline-loot-'+Date.now(),name:names[rarity],rarity,power:{comum:1,incomum:2,raro:3,épico:4,lendário:5}[rarity],source:'chest'};
      lootDrops.unshift(item);inventoryData[rarity]=(inventoryData[rarity]||0)+1;
      saveSharedProfile();renderInventory();playSfx('loot');showNotice('Baú aberto · '+item.name+' ('+rarity+')');
    }
  } else if (data.type === 'useItem') {
    offlineUseItem(data.id);
  } else if (data.type === 'classAbility') {
    handleOfflineClassAbility(data);
  } else if (data.type === 'spell') {
    handleOfflineSpell(String(data.spell||'lightning'));
  } else if (data.type === 'necromancerDiveTarget' && player.hp > 0 && player.necromancerDivePending) {
    const oldX=player.necromancerDiveOriginX,oldZ=player.necromancerDiveOriginZ;
    player.x=Number.isFinite(Number(data.x))?Number(data.x):player.x;
    player.z=Number.isFinite(Number(data.z))?Number(data.z):player.z;
    player.necromancerDivePending=false;player.invisibleUntil=0;
    const originSkeleton=offlineCreateSummon('skeleton',0,1,18000,10,3,900);
    if(originSkeleton&&Number.isFinite(oldX)&&Number.isFinite(oldZ)){originSkeleton.x=oldX;originSkeleton.z=oldZ;}
    player.necromancerDiveOriginX=oldX;player.necromancerDiveOriginZ=oldZ;
    if(myPlayer)myPlayer.position.set(player.x,0,player.z);
    handleClassAbilityMessage({type:'classAbility',id:playerId,ability:'necromancer_dive_arrive',x:player.x,z:player.z,center:{x:oldX,z:oldZ},targets:[],text:'🦴 Você emergiu e deixou um esqueleto na origem!'});
  }
}
function stepOfflineSimulation() {
  if (!offlineMode || !offlineState || !started || !myPlayer) return;
  const player = offlineState.players[0];
  const now = Date.now();
  if (player.hp > 0) {
    if (player.mana < (player.maxMana || 100)) player.mana = Math.min(player.maxMana || 100, player.mana + 1.1);
    const invisible = now < (player.invisibleUntil || 0);
    player.invisible = invisible;
    player.shielded = now < (player.shieldUntil || 0);
    if (offlineHasSkill('regeneration') && now >= (player.nextRegenAt || 0)) {
      player.nextRegenAt = now + 3000;
      player.hp = Math.min(player.maxHp, player.hp + 2);
    }
    if (offlineHasSkill('healing_aura') && now >= (player.nextAuraHealAt || 0)) {
      player.nextAuraHealAt = now + 5000;
      player.hp = Math.min(player.maxHp, player.hp + 2);
    }
    // Invocações perseguem o alvo mais próximo, aproximam-se e só então atacam.
    offlineState.summons=(offlineState.summons||[]).filter(s=>s.expiresAt>now&&s.hp>0);
    for(let index=0;index<offlineState.summons.length;index++){
      const summon=offlineState.summons[index];
      if(summon.summonType==='guardian_spirit'){
        const angle=Number(summon.spiritIndex??index)*Math.PI*2/3+now*.00022;
        const followX=player.x+Math.cos(angle)*1.65,followZ=player.z+Math.sin(angle)*1.65;
        const dx=followX-summon.x,dz=followZ-summon.z,distance=Math.hypot(dx,dz);
        if(distance>.25){summon.x+=dx/Math.max(distance,.001)*Math.min(.22,distance);summon.z+=dz/Math.max(distance,.001)*Math.min(.22,distance);}
        summon.rot=Math.atan2(-dx,-dz);
        if(now>=(summon.nextHealAt||0)){summon.nextHealAt=now+4000;player.hp=Math.min(player.maxHp,player.hp+5);}
        if(now>=(summon.nextDamageAt||0)){summon.nextDamageAt=now+5000;const target=offlineNearestMonster(10);if(target)offlineDamageMonster(target,9);}
        continue;
      }
      const target=offlineLivingMonsters().map(monster=>({monster,distance:Math.hypot(monster.x-summon.x,monster.z-summon.z)})).sort((a,b)=>a.distance-b.distance)[0];
      if(!target)continue;
      const dx=target.monster.x-summon.x,dz=target.monster.z-summon.z,distance=target.distance;
      summon.rot=Math.atan2(-dx,-dz);
      if(distance>1.65){
        const speed=summon.summonType==='stone_golem_clone'?.34:summon.summonType==='skeleton'?.48:.56;
        const step=Math.min(speed,distance-1.45);
        const resolved=resolveDungeonMovement(summon.x,summon.z,summon.x+dx/Math.max(distance,.001)*step,summon.z+dz/Math.max(distance,.001)*step);
        summon.x=resolved.x;summon.z=resolved.z;
      }else if(now>=(summon.nextAttackAt||0)){
        summon.nextAttackAt=now+(summon.attackMs||1000);offlineDamageMonster(target.monster,summon.damage||3);
      }
    }
    for (const monster of offlineState.monsters) {
      if (!monster.alive) continue;
      if (monster.burnUntil > now && now >= (monster.burnNextAt || 0)) {
        monster.burnNextAt = now + 1000;
        offlineDamageMonster(monster,2);
      }
      if (!monster.alive) continue;
      if (monster.stunnedUntil > now || invisible) continue;
      const dx = player.x - monster.x, dz = player.z - monster.z;
      const distance = Math.hypot(dx,dz);
      if (distance > 1.35) {
        const speed = (monster.kind === 'brute' ? .22 : .34) * (now < (player.ogreHasteUntil || 0) || now < (player.monkSpeedUntil || 0) ? .78 : 1);
        monster.x += dx / Math.max(distance,.001) * speed;
        monster.z += dz / Math.max(distance,.001) * speed;
      } else if (now - (monster.lastAttack || 0) > 1500) {
        monster.lastAttack = now;
        const incomingDamage = monster.kind === 'brute' ? 8 : 4;
        let damageMultiplier = 1;
        if (offlineHasSkill('iron_skin')) damageMultiplier *= .8;
        if (offlineHasSkill('second_wind') && player.hp <= player.maxHp * .3) damageMultiplier *= .8;
        if (player.shielded) damageMultiplier *= .35;
        player.hp = Math.max(0, player.hp - Math.max(1,Math.round(incomingDamage*damageMultiplier)));
        showNotice(player.shielded ? '🛡️ Seu escudo absorveu parte do dano!' : 'Um monstro acertou você!');
        if (player.hp <= 0 && !offlineDefeatNoticeShown) {
          offlineDefeatNoticeShown = true;
          showNotice('Você foi derrotado. Saia da partida para recomeçar a prévia.');
        }
      }
    }
  }
  offlineState.monsters = offlineState.monsters.filter(m => m.alive);
  offlineState.summons = (offlineState.summons || []).filter(s => s.expiresAt > now && s.hp > 0);
  updateState({...offlineState, players:[{...player}], monsters:offlineState.monsters.map(m=>({...m})), summons:offlineState.summons.map(s=>({...s}))});
}
function send(data) {
  if (offlineMode) {
    handleOfflineAction(data);
    return;
  }
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
    knight_shield:0x79caff,knight_dash:0xe9c477,knight_whirlwind:0xf4d37b,mage_arcane_orb:0x68baff,archer_piercing_shot:0x9ccfff,goblin_shadow_strike:0x9c8cff,ogre_earthquake:0xff9d4a,healer_sanctuary:0x70ffd1,necromancer_bone_bolt:0xf3f5ff,monk_spirit_wave:0xffcc78,golem_stone_guard:0x9aa2a6,arrow_rain: 0x9ccfff,
    incendiary_arrows: 0xff632b, goblin_invis: 0x9c8cff, goblin_summon: 0x7ce36c,
    ogre_slam: 0xff9d4a, ogre_haste: 0xffd86e,
    healer_cure: 0x70ffd1, healer_guardian_spirits: 0x8cffe8,
    necromancer_summon: 0xa77bdb, necromancer_dive: 0xb4a0e8, necromancer_dive_arrive: 0xb4a0e8,
    monk_impact_palm: 0xffcc78, monk_winged_steps: 0xe9c58c,
    golem_split: 0x9aa2a6, golem_rock_toss: 0xd0b98b
  };
  const radii = {
    knight_shield:1.4,knight_dash:3.8,knight_whirlwind:4.6,mage_arcane_orb:1.5,archer_piercing_shot:1.5,goblin_shadow_strike:2.4,ogre_earthquake:5.8,healer_sanctuary:6.5,necromancer_bone_bolt:1.5,monk_spirit_wave:4.5,golem_stone_guard:2.1,arrow_rain: 4.6,
    incendiary_arrows: 4.1, goblin_invis: 1.5, goblin_summon: 2.1,
    ogre_slam: 5.2, ogre_haste: 1.7,
    healer_cure: 3.8, healer_guardian_spirits: 7,
    necromancer_summon: 3.2, necromancer_dive: 1.9, necromancer_dive_arrive: 2.8,
    monk_impact_palm: 4.2, monk_winged_steps: 2.6, golem_split: 3.2, golem_rock_toss: 5.0
  };
  const center = m.center || { x: m.x, z: m.z };
  if (m.rockFall && scene) {
    const points=[{x:m.rockFall.x,z:m.rockFall.z},...(m.rockFall.stones||[])].slice(0,9);
    for (const p of points) { const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.34,1),new THREE.MeshStandardMaterial({color:0x858b8e,roughness:.96,transparent:true,opacity:1})); rock.position.set(p.x,7.5,p.z); scene.add(rock); activeClassEffects.push({mesh:rock,startedAt:performance.now(),duration:720,kind:'fallingRock'}); }
    addClassAbilityRing(m.rockFall.x,m.rockFall.z,m.rockFall.radius||5,0xb8a783);
    for(const p of (m.rockFall.stones||[])) addClassAbilityRing(p.x,p.z,.72,0x9ca4a8);
  }
  addClassAbilityRing(center.x, center.z, radii[m.ability] || 2.5, colors[m.ability] || 0x76e7f2);
  (m.targets || []).slice(0, isMobileDevice ? 3 : 7).forEach(target => {
    if (m.ability === 'arrow_rain' || m.ability === 'incendiary_arrows' || m.ability === 'ogre_slam' || m.ability === 'knight_dash') {
      addClassAbilityRing(target.x, target.z, .85, colors[m.ability] || 0x76e7f2);
    }
  });
  if (m.id === playerId) {
    const spec = Object.values(CLASS_ABILITY_CONFIG).flat().find(item => item.ability === m.ability);
    if (spec) {
      if(spec.spell)return;
      const slot=(CLASS_ABILITY_CONFIG[selectedClass]||[]).findIndex(item=>item.ability===m.ability);
      if(slot===0)fireCooldown=spec.cooldown;else if(slot===1)lightningCooldown=spec.cooldown;else if(slot===2)thirdCooldown=spec.cooldown;
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
    if (String(m.message || '').includes('Esta partida já começou')) {
      connectionRequested = false;
      resumeToken = '';
      reconnectAttempts = 0;
      clearTimeout(reconnectTimer);
      try { sessionStorage.removeItem('masmorraResumeToken'); } catch {}
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      menu.classList.remove('hidden');
      hud.classList.add('hidden');
    }
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
      create.addEventListener('click', () => {
        joiningPublicRoom = true;
        quickMatchRequested = true;
        send({ type: 'joinPublic', resumeToken, name: $('playerName').value.trim() || 'Aventureiro', class: selectedClass, skin: selectedSkin, skills: Array.from(unlockedSkills), talentPoints: skillPoints, gameMode: selectedGameMode });
      });
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

  if(m.type==='skinUnlock'){
    const skin=String(m.skin||'');if(CHEST_ONLY_SKINS.includes(skin))unlockedSkins.add(skin);
    if(Array.isArray(m.unlockedSkins))m.unlockedSkins.filter(id=>CHEST_ONLY_SKINS.includes(id)).forEach(id=>unlockedSkins.add(id));
    saveSharedProfile();updateHeroShowcase();showNotice('✦ Skin secreta desbloqueada: '+skin+'!');return;
  }
  if (m.type === 'inventory') {
    inventoryData = m.inventory || inventoryData;
    lootDrops = m.lootDrops || lootDrops;
    saveSharedProfile();
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
    const isFire=m.spell==='fire',isLightning=m.spell==='lightning',isBone=m.spell==='bone',isArcane=m.spell==='arcane',isHealing=m.spell==='healing';
    const color=isFire?0xff6b24:isLightning?0x69aaff:isBone?0xf3f5ff:isHealing?0x73ffc1:0x68baff;
    const origin = new THREE.Vector3(m.x, 1.35, m.z);
    const reducedVisualLoad = isMobileDevice || (lastFps > 0 && lastFps < 42);
    const targets = (Array.isArray(m.targets) ? m.targets : []).slice(0, reducedVisualLoad ? 2 : 3);
    if (!targets.length) targets.push({ x: m.x - Math.sin(yaw) * 4, z: m.z - Math.cos(yaw) * 4 });
    let from = origin;
    for (const target of targets) {
      const end=new THREE.Vector3(target.x,isFire?.85:1.15,target.z);
      const mid=new THREE.Vector3((from.x+end.x)/2+(isLightning?(Math.random()-.5)*1.2:0),isFire?1.05:1.35,(from.z+end.z)/2);
      const points=isLightning?[from.clone(),mid,end]:[origin.clone(),end];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const beamMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
      const beam = new THREE.Line(geo, beamMat); scene.add(beam);
      const impactGeo=isFire?new THREE.ConeGeometry(.28,.72,6):isBone?new THREE.DodecahedronGeometry(.24,1):isArcane||isHealing?new THREE.IcosahedronGeometry(.24,1):new THREE.SphereGeometry(.2,8,6);
      const impactMat=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.98,wireframe:isBone});
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
  if (m.type === 'bossPatternEnd') { for (const [id,mesh] of bossTelegraphMeshes) { if (mesh.userData.attackId === String(m.id)) { scene.remove(mesh); disposeObject3D(mesh); bossTelegraphMeshes.delete(id); } } return; }
  if (m.type === 'bossPattern') { showNotice('⚠ ' + (m.label || 'Ataque do Guardião') + ' — saia das áreas vermelhas!'); if (m.circles) syncBossTelegraphs(m.circles); return; }
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
  activeGameMode = m.gameMode === 'pvp_rpg' ? 'pvp_rpg' : 'coop';
  const progressRealm=Math.max(1,Math.min(3,Number(m.realm)||1)),progressPhase=Math.max(1,Math.min(5,Number(m.phase)||1));
  if(sharedProgress.realm!==progressRealm||sharedProgress.phase!==progressPhase){sharedProgress={realm:progressRealm,phase:progressPhase};saveSharedProfile();}
  const isPvpRpg = activeGameMode === 'pvp_rpg';
  const pvpSummonControls = $('pvpSummonControls');
  if (pvpSummonControls) pvpSummonControls.classList.toggle('hidden', !isPvpRpg || !m.started);
  $('hud')?.classList.toggle('pvp-rpg-active', isPvpRpg && !!m.started);
  $('progress')?.classList.toggle('hidden', isPvpRpg);
  const objectiveProgress = document.querySelector('.objective .progress');
  if (objectiveProgress) objectiveProgress.classList.toggle('hidden', isPvpRpg);
  const objectiveMonsterText = $('monsterText');
  if (objectiveMonsterText) objectiveMonsterText.classList.toggle('hidden', isPvpRpg);
  const lobbyModeLabel = $('lobbyModeLabel');
  if (lobbyModeLabel) lobbyModeLabel.textContent = offlineMode ? 'EXPLORAÇÃO SOLO' : isPvpRpg ? 'ARENA PvP RPG' : 'SALA COOPERATIVA';
  const stageCapacity=$('lobbyStageCapacity');if(stageCapacity)stageCapacity.textContent=offlineMode?'PROGRESSO LOCAL':'ATÉ 4 JOGADORES';
  const teamTitle=$('lobbyTeamTitle');if(teamTitle)teamTitle.textContent=offlineMode?'SEU AVENTUREIRO':'SEU TIME';
  if (!m.started) {
    started = false;
    $('lobby').classList.remove('hidden');
    hud.classList.add('hidden');
    $('lobbyRoomCode').textContent = roomCode;
    if (pvpSummonControls) pvpSummonControls.classList.add('hidden');
    const self = (m.players || []).find(p => p.id === playerId);
    $('readyBtn').textContent = self && self.ready ? 'CANCELAR PRONTO' : 'ESTOU PRONTO';
    const startButton = $('startMatchBtn');
    startButton.classList.remove('hidden');
    startButton.disabled = !self || !self.isHost || !(m.players || []).length || m.players.some(p => !p.ready);
    startButton.textContent = self && self.isHost ? 'INICIAR PARTIDA' : 'AGUARDANDO ANFITRIÃO';
    $('lobbyHint').textContent = self && self.isHost
      ? (m.players.some(p => !p.ready) ? 'Você é o anfitrião. Espere todos marcarem PRONTO.' : 'Todos prontos! Toque em INICIAR PARTIDA.')
      : (self && self.ready ? 'Você está pronto. O anfitrião iniciará quando todos estiverem prontos.' : 'Marque PRONTO e aguarde o anfitrião iniciar a partida.');
    const lobbyPlayers = m.players || [];
    refreshLobby3DCompanions(lobbyPlayers);
    const onlineCount = lobbyPlayers.length;
    const onlineLabel = $('lobbyOnlineCount');
    if (onlineLabel) onlineLabel.textContent = offlineMode ? 'MODO SOLO · LOCAL' : onlineCount + '/4 CONECTADOS · ' + lobbyPlayers.filter(p => p.ready).length + ' PRONTOS';
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
  const realm=[1,2,3].includes(Number(m.realm))?Number(m.realm):1,realmChanged=realm!==currentRealmVisual;
  if(realmChanged){currentRealmVisual=realm;realmIntroTimer=3.2;for(const [name,group] of Object.entries(environmentGroups))group.visible=(realm===1&&name==='dungeon')||(realm===2&&name==='astral')||(realm===3&&name==='eclipse');document.body.classList.toggle('realm-astral',realm===2);document.body.classList.toggle('realm-eclipse',realm===3);appliedInitialServerPosition=false;yaw=targetYaw=0;pitch=targetPitch=.25;if(realmPortal)realmPortal.visible=realm===1;if(eclipsePortal)eclipsePortal.visible=realm===2;showRealmTransition(realm);playSfx('portal');showNotice(realm===2?'Novo mundo descoberto: Vale Astral!':realm===3?'Novo mundo descoberto: Eclipse Selvagem!':'Você voltou ao mundo da masmorra.');}
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
      const incomingSkills=Array.isArray(p.skills)?p.skills:[];
      const incomingSkins=Array.isArray(p.unlockedSkins)?p.unlockedSkins.filter(id=>CHEST_ONLY_SKINS.includes(id)):[];
      const skinSetChanged=incomingSkins.slice().sort().join(',')!==Array.from(unlockedSkins).filter(id=>CHEST_ONLY_SKINS.includes(id)).sort().join(',');
      const incomingEquipmentDamage=Math.max(0,Math.min(18,Number(p.equipmentDamage)||0));
      const equipmentChanged=incomingEquipmentDamage!==equipmentDamage;
      const changed=selectedClass!==(p.playerClass||'knight')||selectedSkin!==(p.skin||'default')||skillPoints!==(p.talentPoints??5)||incomingSkills.slice().sort().join(',')!==Array.from(unlockedSkills).sort().join(',')||equipmentChanged;
      selectedClass=p.playerClass||selectedClass;selectedSkin=p.skin||selectedSkin;
      unlockedSkins=new Set(['default','shadow','ember',...incomingSkins]);
      equipmentDamage=incomingEquipmentDamage;
      updateClassAbilityButtons();skillPoints=Number.isFinite(p.talentPoints)?p.talentPoints:skillPoints;
      unlockedSkills.clear();incomingSkills.forEach(id=>unlockedSkills.add(id));
      document.querySelectorAll('.class-card').forEach(el => el.classList.toggle('selected', el.dataset.class === selectedClass));
      if ($('classDescription')) $('classDescription').textContent = classDescriptions[selectedClass] || classDescriptions.knight;
      updateHeroShowcase();
      if (changed) { lastSkillSignature = ''; syncLoadoutUI(); }
      if(changed||skinSetChanged)saveSharedProfile();
      if (myPlayer) {
        myPlayer.userData.serverX = p.x;
        myPlayer.userData.serverZ = p.z;
        myPlayer.userData.serverHp = p.hp ?? 100;
        setHealthBar(myPlayer, myPlayer.userData.serverHp, p.maxHp ?? p.maxHP ?? 100);
        setHeroInvisible(myPlayer, !!p.invisible);
        setHeroShielded(myPlayer, !!p.shielded);
        $('hpText').textContent = String(Math.round(myPlayer.userData.serverHp));
        const currentMana=Math.max(0,Number(p.mana??100));
        const maximumMana=Math.max(1,Number(p.maxMana??100));
        myPlayer.userData.serverMana=currentMana;
        myPlayer.userData.serverMaxMana=maximumMana;
        const manaFill = $('manaFill');
        const manaText = $('manaText');
        if (manaFill) { manaFill.style.width = (Math.max(0, Math.min(1, currentMana / maximumMana)) * 100) + '%'; manaFill.classList.toggle('low-mana', currentMana <= maximumMana * .2); }
        if (manaText) manaText.textContent = Math.round(currentMana) + ' / ' + Math.round(maximumMana);
        $('deathScreen').classList.toggle('hidden', isPvpRpg || myPlayer.userData.serverHp > 0);
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
    const summonType = String(summon.summonType || '').toLowerCase().replace(/-/g, '_');
    const summonClassHint = String(summon.playerClass || '').toLowerCase();
    const summonName = String(summon.name || '').toLowerCase();
    const isGuardianSpirit = summonType === 'guardian_spirit' || summonClassHint === 'guardian_spirit' || summonName.includes('espírito guardião');
    const isGolemClone = ['stone_golem_clone','golem_clone','golem_fragment'].includes(summonType) ||
      ['golem_clone','stone_golem_clone'].includes(summonClassHint) ||
      summonName.includes('fragmento de golem') || summonName.includes('golem clone');
    const isSkeleton = summonType === 'skeleton' || summonClassHint === 'skeleton' ||
      summonName.includes('esqueleto') || summonName.includes('skeleton');
    // Never render a known summon as a goblin just because its type alias is unfamiliar.
    const summonClass = isGolemClone ? 'golem_clone' : isSkeleton ? 'skeleton' :
      (['goblin','golem_clone','skeleton'].includes(summonClassHint) ? summonClassHint : 'goblin');
    if (!obj || (!!obj.userData.isGuardianSpirit !== isGuardianSpirit) || (!isGuardianSpirit && obj.userData.playerClass !== summonClass)) {
      if (obj) { scene.remove(obj); disposeObject3D(obj); }
      obj = isGuardianSpirit
        ? makeGuardianSpirit(summon.color || 0x8cffe8)
        : makeHero(summon.color || (isSkeleton ? 0xe0dccb : isGolemClone ? 0x8a9096 : 0x80c86b), summonClass, isSkeleton ? 'shadow' : 'default');
      obj.userData.isGuardianSpirit = isGuardianSpirit;
      obj.userData.playerClass = isGuardianSpirit ? 'guardian_spirit' : summonClass;
      obj.userData.skin = summon.skin || (isSkeleton ? 'shadow' : 'default');
      scene.add(obj); remotePlayers.set(id, obj);
    }
    obj.userData.targetX = summon.x;
    obj.userData.targetZ = summon.z;
    obj.userData.targetRot = summon.rot || 0;
    obj.userData.name = summon.name || (isGuardianSpirit ? 'Espírito Guardião' : isGolemClone ? 'Fragmento de Golem' : isSkeleton ? 'Esqueleto aliado' : 'Goblin aliado');
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
  const safeUntil = isPvpRpg ? 0 : Number(m.safeZoneUntil) || 0;
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
  gateMeshes.forEach((gate,index)=>{const n=index+1;gate.visible=!isPvpRpg;gate.userData.open=phase>n||(phase===n&&aliveMonsters===0);});
  if(realmPortal){realmPortal.visible=!isPvpRpg&&realm===1;realmPortal.userData.open=!isPvpRpg&&realm===1&&(!!m.portalOpen||(phase===5&&!!m.boss&&!m.boss.alive));}
  if(eclipsePortal){eclipsePortal.visible=!isPvpRpg&&realm===2;eclipsePortal.userData.open=!isPvpRpg&&realm===2&&(!!m.portalOpen||(phase===5&&!!m.boss&&!m.boss.alive));}
  const phaseObjective=document.querySelector('.objective strong');
  if(phaseObjective){
    if(offlineMode&&phase===5&&m.portalOpen)phaseObjective.textContent=realm<3?'PORTAL ABERTO! Atravesse para o próximo mundo':'TRÊS MUNDOS CONQUISTADOS! Exploração concluída';
    else if(isPvpRpg) phaseObjective.textContent='PvP RPG · Derrote rivais e invoque monstros aliados';
    else if(phase===5&&m.boss&&!m.boss.alive&&realm===1){const nearGate=myPlayer&&Math.hypot(myPlayer.position.x,myPlayer.position.z+168)<16;phaseObjective.textContent=nearGate?'PORTÃO ABERTO! Atravesse para o Vale Astral':'Siga pelo Abismo até o portão do Vale Astral';}
    else if(phase===5&&m.boss&&!m.boss.alive&&realm===2)phaseObjective.textContent='Guardião Astral derrotado! Vale conquistado';
    else if(phase===5)phaseObjective.textContent=realm===2?'Derrote o Guardião Astral':'Derrote o Guardião Supremo';
    else phaseObjective.textContent=realm===2?'Derrote os inimigos astrais e avance':'Derrote os monstros e atravesse o portão da região';
  }
  if(phaseLabel)phaseLabel.textContent=isPvpRpg?'⚔ ARENA LIVRE · PRIMEIRO A 10 KOs':realm===2?'VALE ASTRAL · FASE '+phase+' / 5':'MUNDO MONOCROMÁTICO · FASE '+phase+' / 5';
  const bossPanel = $('bossPanel');
  if (bossPanel) bossPanel.classList.toggle('hidden', isPvpRpg || phase !== 5 || !m.boss || !m.boss.alive);
  bossData = m.boss || null;
  syncBossPortals(bossData && bossData.alive ? bossData.portals : []);
  syncBossTelegraphs(bossData && bossData.alive ? bossData.telegraphs : []);
  if (bossData && bossData.alive) {
    const bossTitle=document.querySelector('.boss-title');
    if(bossTitle)bossTitle.textContent=realm===2?'GUARDIÃO ASTRAL':'GUARDIÃO DO ABISMO';
    if (!bossMesh) { bossMesh = makeBoss(); scene.add(bossMesh); }
    bossMesh.visible = true; bossMesh.userData.targetX = bossData.x; bossMesh.userData.targetZ = bossData.z;
    bossMesh.userData.serverHp = Number(bossData.hp) || 0;
    bossMesh.userData.serverMaxHp = Number(bossData.maxHp) || 1;
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
  latestChests = isPvpRpg ? [] : (m.chests || []);
  const nearbyChest = latestChests.find(chest => !chest.opened && myPlayer && Math.hypot(chest.x - myPlayer.position.x, chest.z - myPlayer.position.z) <= 3.4);
  const chestButton = $('chestBtn');
  if (chestButton) {
    chestButton.classList.toggle('hidden', !nearbyChest);
    chestButton.dataset.chestId = nearbyChest ? nearbyChest.id : '';
  }
  const visibleChestIds = new Set(latestChests.map(chest => chest.id));
  for (const [id, chestObj] of chestMeshes) if (!visibleChestIds.has(id)) chestObj.visible = false;
  for (const chest of latestChests) {
    let obj = chestMeshes.get(chest.id);
    if (!obj) {
      obj = makeChest(realm);
      obj.position.set(chest.x, 0, chest.z);
      scene.add(obj);
      chestMeshes.set(chest.id, obj);
    }
    obj.userData.chestId = chest.id;
    obj.visible = !chest.opened;
  }

  let alive = 0;
  for (const mtr of m.monsters) {
    if (mtr.alive) alive++;

    let obj = monsterMeshes.get(mtr.id);
    if (!obj) {
      const summonClass = mtr.pvpSummoned && ['goblin','skeleton','golem_clone'].includes(mtr.summonClass) ? mtr.summonClass : null;
      obj = summonClass
        ? makeHero(mtr.color || null, summonClass, mtr.skin || 'default')
        : makeMonster(mtr.kind || 'stalker', mtr.phase || phase);
      if (summonClass) obj.userData.pvpSummonHero = true;
      scene.add(obj);
      monsterMeshes.set(mtr.id, obj);
    }

    obj.userData.targetX = mtr.x;
    obj.userData.targetZ = mtr.z;
    obj.userData.kind = mtr.kind || 'stalker';
    obj.userData.serverHp = mtr.hp ?? 100;
    setHealthBar(obj, mtr.hp ?? 100, mtr.maxHp ?? mtr.maxHP ?? 100);
    // Monstros normais encaram o jogador local; invocações do PvP encaram o rival
    // mais próximo, em vez de parecerem atacar o próprio dono.
    if (myPlayer) {
      let faceX, faceZ;
      if (mtr.pvpSummoned && Array.isArray(m.players)) {
        const rival = m.players.filter(p => p.hp > 0 && String(p.id) !== String(mtr.ownerId))
          .sort((a,b) => Math.hypot(a.x-mtr.x,a.z-mtr.z)-Math.hypot(b.x-mtr.x,b.z-mtr.z))[0];
        faceX = (rival ? rival.x : myPlayer.position.x) - mtr.x;
        faceZ = (rival ? rival.z : myPlayer.position.z) - mtr.z;
      } else {
        faceX = myPlayer.position.x - mtr.x;
        faceZ = myPlayer.position.z - mtr.z;
      }
      if (Math.hypot(faceX, faceZ) > 0.05) obj.userData.targetRot = Math.atan2(faceX, faceZ) + Math.PI;
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

  const selfScore=(m.players||[]).find(p=>p.id===playerId);
  $('monsterText').textContent=isPvpRpg
    ? 'KOs: '+(selfScore?.pvpKills||0)+' / 10 · Monstros invocados: '+(selfScore?.pvpMonsterKills||0)
    : phase===5?(bossData&&bossData.alive?(realm===2?'Guardião Astral':'Guardião Supremo'):(realm===2?'Vale Astral concluído':'Masmorra concluída')):alive+' inimigos restantes';
  const phaseTotal=phase===5&&bossData?Math.max(1,Number(bossData.maxHp)||95):(phase===1?5:phase===2?8:phase===3?9:phase===4?10:95);
  const phaseProgress=isPvpRpg?Math.min(100,((selfScore?.pvpKills||0)/10)*100):phase===5&&bossData?(phaseTotal-bossData.hp)/phaseTotal*100:(phaseTotal-alive)/phaseTotal*100;
  $('progressFill').style.width=Math.max(0,Math.min(100,phaseProgress))+'%';
  const summonHint=$('pvpSummonHint');
  const summonType=$('pvpMonsterType');
  const summonButton=$('pvpSummonBtn');
  if(isPvpRpg&&selfScore){
    const costs={stalker:25,thorn:30,wraith:35,brute:40,assassin:45};
    const cost=costs[summonType?.value||'stalker']||25;
    if(summonHint)summonHint.textContent='Mana '+Math.round(selfScore.mana??100)+'/'+Math.round(selfScore.maxMana??100)+' · Custo '+cost+' · Máx. 3 invocações';
    if(summonButton){summonButton.disabled=(selfScore.mana??100)<cost;summonButton.title=summonButton.disabled?'Mana insuficiente':'Invocar monstro aliado';}
  }
  $('killText').textContent=isPvpRpg?(selfScore?.pvpKills||0):phase===5&&bossData?phaseTotal-bossData.hp:phaseTotal-alive;

  const leaderboardPlayers = isPvpRpg
    ? [...m.players].sort((a,b)=>(b.pvpKills||0)-(a.pvpKills||0)||((b.hp||0)-(a.hp||0)))
    : m.players;
  $('playersList').innerHTML = leaderboardPlayers.map((p,index) =>
    isPvpRpg
      ? `<div class="player-chip pvp-player-chip" data-rank="${index+1}">${index===0?'♛':index===1?'◆':'●'} ${escapeHTML(p.name)} · K ${p.pvpKills||0} · ♥ ${Math.round(p.hp)}/${Math.round(p.maxHp||100)}</div>`
      : `<div class="player-chip">● ${escapeHTML(p.name)}${p.id === playerId ? ' (você)' : ''}</div>`
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
  myPlayer.userData.dodgeAnim = .22;
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

  if (myPlayer) {
    myPlayer.userData.attackAnim = .30;
    myPlayer.rotation.y = yaw;
  }

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
    // Não solicitar tela cheia por código: isso mostra a notificação nativa do Android/Chrome.
    setTimeout(() => { onResize(); updateOrientationToggleLabel(); }, 120);
  }
  $('startScreen').classList.add('hidden');
  menu.classList.remove('hidden');
  setStatus('Digite seu nome e toque em JOGAR ONLINE.');
});

$('playBtn').addEventListener('click', () => connect(''));
$('offlinePlayBtn')?.addEventListener('click', startOfflineExploration);
$('quickMatchBtn')?.addEventListener('click', () => {
  quickMatchRequested = true;
  joiningPublicRoom = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: 'joinPublic', resumeToken, name: $('playerName').value.trim() || 'Aventureiro', class: selectedClass, skin: selectedSkin, skills: Array.from(unlockedSkills), talentPoints: skillPoints, gameMode: selectedGameMode });
    quickMatchRequested = false;
    joiningPublicRoom = false;
  } else {
    connect('');
  }
});
function requestPublicRooms() {
  $('publicRoomsPanel')?.classList.remove('hidden');
  $('publicRoomsList').textContent = 'Buscando salas disponíveis…';
  if (ws && ws.readyState === WebSocket.OPEN) {
    send({ type: 'listPublicRooms', gameMode: selectedGameMode });
    return;
  }
  listPublicRoomsOnConnect = true;
  connect('');
}
$('publicRoomsBtn')?.addEventListener('click', requestPublicRooms);
$('refreshPublicRoomsBtn')?.addEventListener('click', requestPublicRooms);

$('readyBtn').addEventListener('click', () => {
  if (offlineMode && offlineState?.players?.[0]) {
    offlineState.players[0].ready = !offlineState.players[0].ready;
    updateState({ ...offlineState, started: false });
    return;
  }
  send({ type: 'ready' });
});
$('startMatchBtn').addEventListener('click', () => {
  if (offlineMode && offlineState?.players?.[0]) {
    const self = offlineState.players[0];
    if (!self.ready) { showNotice('Marque ESTOU PRONTO antes de começar.'); return; }
    offlineState.started = true;
    // Recupera o estado visual completo ao sair do lobby: a prévia 3D usa scissor
    // no mesmo renderer e não pode deixar a cena principal limitada a um viewport.
    if (renderer) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, renderer.domElement.clientWidth || innerWidth, renderer.domElement.clientHeight || innerHeight);
      renderer.autoClear = true;
    }
    if (environmentGroups?.dungeon) environmentGroups.dungeon.visible = true;
    if (environmentGroups?.astral) environmentGroups.astral.visible = false;
    if (environmentGroups?.eclipse) environmentGroups.eclipse.visible = false;
    scene.background.setHex(0x090d14);
    if (scene.fog) scene.fog.color.setHex(0x090d14);
    currentRealmVisual = 0;
    currentPhaseVisual = 0;
    realmIntroTimer = 0;
    appliedInitialServerPosition = false;
    yaw = targetYaw = 0;
    pitch = targetPitch = 0.25;
    if (myPlayer) {
      myPlayer.position.set(0, 0, 3);
      myPlayer.visible = gameSettings.cameraMode !== 'first';
    }
    if (renderer) syncRendererSize(innerWidth, innerHeight);
    updateState(offlineState);
    if (offlineLoop) clearInterval(offlineLoop);
    offlineLoop = setInterval(stepOfflineSimulation, 220);
    showNotice('Exploração offline iniciada · classe ' + (CLASS_NAMES_UI[selectedClass] || selectedClass) + '.');
    return;
  }
  send({ type: 'startMatch' });
});

const inventoryPanel = document.querySelector('.inventory-panel');
const inventoryToggleBtn = $('inventoryToggleBtn');
let inventoryHidden=true;
try {
  const oldPreference = localStorage.getItem('mmHideInventory');
  const layoutVersion=localStorage.getItem('mmInventoryLayoutV4');
  if(layoutVersion!=='4'){
    inventoryHidden=true;
    localStorage.setItem('mmInventoryLayoutV4','4');
    localStorage.setItem('mmHideInventory','1');
  }else{
    inventoryHidden=oldPreference!=='0';
  }
} catch {}
function applyInventoryVisibility() {
  if (!inventoryPanel || !inventoryToggleBtn) return;
  inventoryPanel.classList.toggle('inventory-hidden', inventoryHidden);
  inventoryToggleBtn.textContent = inventoryHidden ? 'MOSTRAR INVENTÁRIO' : 'OCULTAR INVENTÁRIO';
  inventoryToggleBtn.setAttribute('aria-expanded', String(!inventoryHidden));
}
inventoryToggleBtn?.addEventListener('click', () => {
  inventoryHidden = !inventoryHidden;
  try { localStorage.setItem('mmHideInventory', inventoryHidden ? '1' : '0'); } catch {}
  applyInventoryVisibility();
  playSfx('ui');
});
applyInventoryVisibility();

function leaveRoomToMenu() {
  saveSharedProfile();offlineReturnSnapshot=null;
  if (offlineLoop) clearInterval(offlineLoop);
  offlineLoop = null;
  offlineMode = false;
  offlineState = null;
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
$('pvpSummonBtn')?.addEventListener('click', () => {
  if (activeGameMode !== 'pvp_rpg' || !started) return;
  const kind = $('pvpMonsterType')?.value || 'stalker';
  send({ type: 'spawnMonster', kind });
  playSfx('ui');
});
$('lootFilter')?.addEventListener('change', renderInventory);
$('lootSort')?.addEventListener('change', renderInventory);
$('recentLoot').addEventListener('click',e=>{
  const row=e.target.closest('.select-item');if(!row)return;
  selectedItemId=String(row.dataset.itemId||'');saveSharedProfile();renderInventory();
});
$('useSelectedItemBtn').addEventListener('click', useSelectedItem);

const CLASS_ABILITY_CONFIG = {
  knight: [
    { ability: 'knight_shield', icon: '🛡️', label: 'ESCUDO', description: 'Reduz o dano recebido por 4,2 segundos.', cooldown: 12 },
    { ability: 'knight_dash', icon: '⚔️', label: 'AVANÇO', description: 'Avança, puxa inimigos próximos e causa dano.', cooldown: 9 },
    { ability: 'knight_whirlwind', icon: '✥', label: 'GIRO', description: 'Giro de espada que atinge os inimigos ao redor.', cooldown: 14 }
  ],
  mage: [
    { ability: 'fire', icon: '🔥', label: 'FOGO', description: 'Lança fogo e incendeia o alvo.', cooldown: 4, spell: true },
    { ability: 'lightning', icon: 'ϟ', label: 'RAIO', description: 'Dispara um raio mágico em cadeia.', cooldown: 3.5, spell: true },
    { ability: 'mage_arcane_orb', icon: '✦', label: 'ORBE ARCANO', description: 'Dispara uma esfera arcana azul e dourada.', cooldown: 9, spell: true, spellType: 'arcane' }
  ],
  archer: [
    { ability: 'arrow_rain', icon: '🏹', label: 'CHUVA', description: 'Dispara uma chuva de flechas em área.', cooldown: 8 },
    { ability: 'incendiary_arrows', icon: '🔥', label: 'INCENDIÁRIAS', description: 'Incendeia uma área e causa queimadura.', cooldown: 12 },
    { ability: 'archer_piercing_shot', icon: '➶', label: 'FLECHA PERFURANTE', description: 'Dispara uma flecha rápida que atravessa inimigos alinhados.', cooldown: 9.5 }
  ],
  goblin: [
    { ability: 'goblin_invis', icon: '👻', label: 'INVISÍVEL', description: 'Fica invisível por 5 segundos e os monstros param de perseguir você.', cooldown: 14 },
    { ability: 'goblin_summon', icon: '👺', label: 'INVOCAR 2', description: 'Invoca dois goblins aliados por 12 segundos.', cooldown: 20 },
    { ability: 'goblin_shadow_strike', icon: '⟡', label: 'GOLPE SOMBRIO', description: 'Avança rapidamente e atinge o inimigo mais próximo.', cooldown: 11 }
  ],
  ogre: [
    { ability: 'ogre_slam', icon: '💥', label: 'SOCO NO CHÃO', description: 'Dá um soco no chão, causa dano em área e repele inimigos.', cooldown: 10 },
    { ability: 'ogre_haste', icon: '💨', label: 'VELOCIDADE', description: 'Aumenta a velocidade por 5 segundos.', cooldown: 15 },
    { ability: 'ogre_earthquake', icon: '♨', label: 'TERREMOTO', description: 'Cria uma onda de choque pesada em volta do Ogro.', cooldown: 17 }
  ],
  healer: [
    { ability: 'healer_cure', icon: '💚', label: 'CURA', description: 'Cura você e aliados vivos em até 50 de vida.', cooldown: 23 },
    { ability: 'healer_guardian_spirits', icon: '🪽', label: 'ESPÍRITOS', description: 'Invoca 3 espíritos por 20 s: curam aliados em 5 a cada 4 s ou causam 9 de dano a inimigos a cada 5 s.', cooldown: 40 },
    { ability: 'healer_light_orb', icon: '✚', label: 'ORBE DA VIDA', description: 'Dispara uma esfera verde de energia que cura o aliado mais ferido.', cooldown: 10, spell: true, spellType: 'healing' }
  ],
  necromancer: [
    { ability: 'necromancer_summon', icon: '💀', label: 'HORDA', description: 'Invoca até cinco esqueletos aliados por 18 segundos.', cooldown: 30 },
    { ability: 'necromancer_dive', icon: '🕳️', label: 'MERGULHO', description: 'Desaparece por até 5 s; toque no chão para voltar e deixar um esqueleto na origem.', cooldown: 15 },
    { ability: 'necromancer_bone_bolt', icon: '☽', label: 'ORBE ÓSSEO', description: 'Lança uma esfera branca de energia óssea contra um inimigo.', cooldown: 8.5, spell: true, spellType: 'bone' }
  ],
  monk: [
    { ability: 'monk_impact_palm', icon: '👊', label: 'PALMA', description: 'Onda de choque: 8 de dano, empurra e atordoa inimigos.', cooldown: 18 },
    { ability: 'monk_winged_steps', icon: '🪽', label: 'PASSOS', description: 'Avanço veloz com esquiva breve e velocidade extra.', cooldown: 15 },
    { ability: 'monk_spirit_wave', icon: '☯', label: 'ONDA ESPIRITUAL', description: 'Libera uma onda de energia à frente do Monge.', cooldown: 13 }
  ],
  golem: [
    { ability: 'golem_split', icon: '🪨', label: 'DESMANCHAR', description: 'Divide-se em três golens menores por 12 segundos.', cooldown: 26 },
    { ability: 'golem_rock_toss', icon: '☄️', label: 'PEDRA TITÂNICA', description: 'Toque no chão para escolher o ponto do impacto em área.', cooldown: 14.5, targeted: true },
    { ability: 'golem_stone_guard', icon: '⬟', label: 'GUARDA DE PEDRA', description: 'Endurece a armadura e reduz o dano recebido.', cooldown: 20 }
  ]
};
const CLASS_DEMO_VISUALS = {
  knight:{glyph:'⚔',accent:'#e9c477',tag:'DEFESA E COMBATE'},
  mage:{glyph:'✧',accent:'#a78bfa',tag:'MAGIA ARCANA'},
  archer:{glyph:'➶',accent:'#82e7a7',tag:'PRECISÃO E AGILIDADE'},
  goblin:{glyph:'⟡',accent:'#b6ef70',tag:'FURTIVIDADE'},
  ogre:{glyph:'⚒',accent:'#ffad70',tag:'FORÇA BRUTA'},
  healer:{glyph:'✚',accent:'#70e8c3',tag:'CURA E SUPORTE'},
  necromancer:{glyph:'☠',accent:'#c7a0ff',tag:'INVOCAR E CONTROLAR'},
  monk:{glyph:'✊',accent:'#f4cf85',tag:'MOBILIDADE'},
  golem:{glyph:'⬟',accent:'#aeb9c2',tag:'DEFESA TITÂNICA'}
};
const CLASS_DEMO_STEP_MS = 3200;
let classDemoStartedAt = performance.now();
let classDemoPausedAt = 0;
let classDemoPaused = false;
let classDemoLastSignature = '';
let classDemoLastUiAt = 0;
function updateClassAbilityDemo(reset = false) {
  const root = $('classDemoPreview');
  if (!root || !root.getClientRects().length) return;
  if (reset) {
    classDemoStartedAt = performance.now();
    classDemoLastSignature = '';
  }
  const now = classDemoPaused ? classDemoPausedAt : performance.now();
  const abilities = CLASS_ABILITY_CONFIG[selectedClass] || CLASS_ABILITY_CONFIG.knight;
  const visual = CLASS_DEMO_VISUALS[selectedClass] || CLASS_DEMO_VISUALS.knight;
  const elapsed = Math.max(0, now - classDemoStartedAt);
  const index = Math.floor(elapsed / CLASS_DEMO_STEP_MS) % abilities.length;
  const ability = abilities[index];
  const signature = selectedClass + ':' + index;
  if (signature !== classDemoLastSignature) {
    classDemoLastSignature = signature;
    root.dataset.class = selectedClass;
    root.style.setProperty('--demo-accent', visual.accent);
    const character = $('classDemoCharacter');
    const icon = $('classDemoSkillIcon');
    const name = $('classDemoAbilityName');
    const description = $('classDemoAbilityDescription');
    const classTag = $('classDemoClassTag');
    if (character) character.textContent = visual.glyph;
    if (icon) icon.textContent = ability.icon;
    if (name) name.textContent = ability.label;
    if (description) description.textContent = ability.description;
    if (classTag) classTag.textContent = visual.tag;
    const tabs = $('classDemoAbilityTabs');
    if (tabs) {
      tabs.replaceChildren();
      abilities.forEach((entry, entryIndex) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'class-demo-tab' + (entryIndex === index ? ' active' : '');
        tab.textContent = (entryIndex + 1) + ' · ' + entry.label;
        tab.setAttribute('aria-label', 'Ver prévia de ' + entry.label);
        tab.addEventListener('click', () => {
          classDemoPaused = false;
          classDemoStartedAt = performance.now() - entryIndex * CLASS_DEMO_STEP_MS;
          classDemoLastSignature = '';
          const pauseButton = $('classDemoPauseBtn');
          if (pauseButton) pauseButton.textContent = 'Ⅱ PAUSAR PRÉVIA';
          updateClassAbilityDemo(false);
        });
        tabs.appendChild(tab);
      });
    }
  }
  const progress = $('classDemoProgress');
  if (progress) progress.style.width = (classDemoPaused ? 100 : (elapsed % CLASS_DEMO_STEP_MS) / CLASS_DEMO_STEP_MS * 100) + '%';
  root.classList.toggle('paused', classDemoPaused);
}
$('classDemoPauseBtn')?.addEventListener('click', () => {
  const button = $('classDemoPauseBtn');
  if (!classDemoPaused) {
    classDemoPaused = true;
    classDemoPausedAt = performance.now();
  } else {
    classDemoStartedAt += performance.now() - classDemoPausedAt;
    classDemoPaused = false;
    classDemoPausedAt = 0;
  }
  if (button) button.textContent = classDemoPaused ? '▶ CONTINUAR PRÉVIA' : 'Ⅱ PAUSAR PRÉVIA';
  updateClassAbilityDemo(false);
});
let ogreHasteUntil = 0;
function updateClassAbilityButtons() {
  const abilities = CLASS_ABILITY_CONFIG[selectedClass] || CLASS_ABILITY_CONFIG.knight;
  const first=$('fireBtn'),second=$('lightningBtn'),third=$('ability3Btn');
  [[first,abilities[0],'fireCooldown'],[second,abilities[1],'lightningCooldown'],[third,abilities[2],'ability3Cooldown']].forEach(([button,ability,timerId])=>{
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
let fireCooldown=0,lightningCooldown=0,thirdCooldown=0;
let golemRockTargeting = false, golemRockTargetTimer = null;
updateClassAbilityButtons();
function placeSpellButtons() {
  const fire=$('fireBtn'),lightning=$('lightningBtn'),third=$('ability3Btn');
  if(!fire||!lightning||!third)return;
  const viewport = getEffectiveViewport();
  const landscape = viewport.width > viewport.height;
  const size = landscape ? 44 : 50;
  for (const btn of [fire,lightning,third]) {
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
    // Retrato: três habilidades em coluna, acima do ataque e sem cobrir o joystick.
    fire.style.setProperty('right', '14px', 'important');
    fire.style.setProperty('bottom', '122px', 'important');
    lightning.style.setProperty('right','14px','important');
    lightning.style.setProperty('bottom','180px','important');
    third.style.setProperty('right','14px','important');
    third.style.setProperty('bottom','238px','important');
    third.style.setProperty('width','50px','important');
    third.style.setProperty('height','50px','important');
  } else {
    // Paisagem: pilha compacta à direita, acima dos controles de combate.
    fire.style.setProperty('right', '12px', 'important');
    fire.style.setProperty('bottom', '86px', 'important');
    lightning.style.setProperty('right','12px','important');
    lightning.style.setProperty('bottom','136px','important');
    third.style.setProperty('right','12px','important');
    third.style.setProperty('bottom','186px','important');
    third.style.setProperty('width','44px','important');
    third.style.setProperty('height','44px','important');
  }
  applySavedHudPositions();
}

const HUD_MOVABLE_IDS=['joystick','chestBtn','dodgeBtn','attackBtn','fireBtn','lightningBtn','ability3Btn','inventoryToggleBtn','skillToggleBtn','settingsBtn','orientationToggleBtn','leaveBtn'];
let hudEditMode = false;
let hudDragState = null;
let hudLayout = {};
try {
  const hudLayoutVersion = localStorage.getItem('ultimoLegadoHudLayoutVersion');
  if (hudLayoutVersion !== '4') {
    localStorage.removeItem('ultimoLegadoHudLayout');
    localStorage.setItem('ultimoLegadoHudLayoutVersion', '4');
  }
  hudLayout = JSON.parse(localStorage.getItem('ultimoLegadoHudLayout') || '{}') || {};
  if (!hudLayout || typeof hudLayout !== 'object' || Array.isArray(hudLayout)) hudLayout = {};
} catch { hudLayout = {}; }
function hudOrientationKey() { const viewport=getEffectiveViewport(); return viewport.width > viewport.height ? 'landscape' : 'portrait'; }
function saveHudLayout() {
  try { localStorage.setItem('ultimoLegadoHudLayout', JSON.stringify(hudLayout)); } catch {}
}
function applySavedHudPositions(){
  if(!hud)return;
  const group=hudLayout[hudOrientationKey()]||{};
  for (const id of HUD_MOVABLE_IDS) {
    const el = $(id);
    if (!el) continue;
    const saved = group[id];
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const maxX = Math.max(0, window.innerWidth - el.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - el.offsetHeight);
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', Math.round(Math.max(0, Math.min(1, saved.x)) * maxX) + 'px', 'important');
      el.style.setProperty('top', Math.round(Math.max(0, Math.min(1, saved.y)) * maxY) + 'px', 'important');
      el.style.setProperty('right', 'auto', 'important');
      el.style.setProperty('bottom', 'auto', 'important');
      el.style.setProperty('transform', 'none', 'important');
      el.dataset.hudCustomPosition = 'true';
    } else if (el.dataset.hudCustomPosition === 'true') {
      el.style.removeProperty('left');
      el.style.removeProperty('top');
      el.style.removeProperty('transform');
      el.style.removeProperty('position');
      if (id !== 'fireBtn' && id !== 'lightningBtn') {
        el.style.removeProperty('right');
        el.style.removeProperty('bottom');
      }
      delete el.dataset.hudCustomPosition;
    }
  }
}
function setHudEditMode(enabled) {
  hudEditMode = !!enabled;
  hud.classList.toggle('hud-edit-mode', hudEditMode);
  const btn = $('hudEditBtn');
  const status = $('hudEditStatus');
  if (btn) btn.textContent = hudEditMode ? '✓ CONCLUIR EDIÇÃO' : '✥ MOVER HUD';
  if (status) status.textContent = hudEditMode
    ? 'EDIÇÃO ATIVA: arraste os controles. Toque em Concluir para jogar.'
    : 'Posições salvas neste aparelho.';
  if (hudEditMode) showNotice('Arraste o joystick e os botões para ajustar o HUD.');
}
document.addEventListener('pointerdown', event => {
  if (!hudEditMode) return;
  const el=event.target.closest('#joystick,#chestBtn,#dodgeBtn,#attackBtn,#fireBtn,#lightningBtn,#ability3Btn,#inventoryToggleBtn,#skillToggleBtn,#settingsBtn,#orientationToggleBtn,#leaveBtn');
  if (!el || !hud.contains(el)) return;
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  hudDragState = { el, pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
  el.style.setProperty('position', 'fixed', 'important');
  el.style.setProperty('right', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
  el.style.setProperty('transform', 'none', 'important');
  el.style.setProperty('left', rect.left + 'px', 'important');
  el.style.setProperty('top', rect.top + 'px', 'important');
  el.dataset.hudCustomPosition = 'true';
}, true);
document.addEventListener('pointermove', event => {
  if (!hudDragState || event.pointerId !== hudDragState.pointerId) return;
  event.preventDefault();
  const { el, dx, dy } = hudDragState;
  const x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, event.clientX - dx));
  const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, event.clientY - dy));
  el.style.setProperty('left', Math.round(x) + 'px', 'important');
  el.style.setProperty('top', Math.round(y) + 'px', 'important');
}, true);
function finishHudDrag(event) {
  if (!hudDragState || (event && event.pointerId !== hudDragState.pointerId)) return;
  const { el } = hudDragState;
  const rect = el.getBoundingClientRect();
  const maxX = Math.max(1, window.innerWidth - rect.width);
  const maxY = Math.max(1, window.innerHeight - rect.height);
  const key = hudOrientationKey();
  if (!hudLayout[key]) hudLayout[key] = {};
  hudLayout[key][el.id] = {
    x: Math.max(0, Math.min(1, rect.left / maxX)),
    y: Math.max(0, Math.min(1, rect.top / maxY))
  };
  saveHudLayout();
  hudDragState = null;
}
document.addEventListener('pointerup', finishHudDrag, true);
document.addEventListener('pointercancel', finishHudDrag, true);

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
  $('shiftLockEnabled').checked = gameSettings.shiftLock;
  $('cameraMode').value = gameSettings.cameraMode;
  $('cameraZoom').disabled = gameSettings.cameraMode === 'first';
  $('cameraZoom').value = String(gameSettings.cameraZoom);
  $('cameraZoomValue').textContent = gameSettings.cameraZoom.toFixed(1).replace('.', ',') + ' m';
  $('graphicsQuality').value = gameSettings.graphicsQuality;
  $('hapticsEnabled').checked = gameSettings.haptics;
  $('musicVolume').value = String(gameSettings.musicVolume);
  $('musicVolumeValue').textContent = Math.round(gameSettings.musicVolume * 100) + '%';
  $('musicEnabled').checked = gameSettings.musicEnabled;
  $('sfxVolume').value = String(gameSettings.sfxVolume);
  $('sfxVolumeValue').textContent = Math.round(gameSettings.sfxVolume * 100) + '%';
}

refreshSettingsUI();
$('hudEditBtn')?.addEventListener('click', () => setHudEditMode(!hudEditMode));
$('hudResetBtn')?.addEventListener('click', () => {
  hudLayout = {};
  saveHudLayout();
  for (const id of HUD_MOVABLE_IDS) {
    const el = $(id);
    if (!el) continue;
    el.style.removeProperty('left');
    el.style.removeProperty('top');
    el.style.removeProperty('right');
    el.style.removeProperty('bottom');
    el.style.removeProperty('position');
    el.style.removeProperty('transform');
    delete el.dataset.hudCustomPosition;
  }
  placeSpellButtons();
  if ($('hudEditStatus')) $('hudEditStatus').textContent = 'HUD restaurado ao padrão.';
  showNotice('Controles restaurados à posição padrão.');
});

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
$('shiftLockEnabled').addEventListener('change', e => {
  gameSettings.shiftLock = e.target.checked;
  shiftLockEnabled = gameSettings.shiftLock;
  saveGameSettings();
  showNotice(shiftLockEnabled ? 'Shift Lock ativado · câmera centralizada e strafe lateral.' : 'Shift Lock desativado · personagem acompanha o movimento.');
});
function setCameraMode(mode) {
  if (!['first','second','third'].includes(mode)) return;
  gameSettings.cameraMode = mode;
  saveGameSettings();
  refreshSettingsUI();
  refreshLobbySettingsUI();
  showNotice('Câmera: ' + ({first:'1ª pessoa',second:'2ª pessoa · próxima',third:'3ª pessoa · distante'}[mode]) + '.');
}
$('cameraMode').addEventListener('change', e => setCameraMode(e.target.value));
$('lobbyCameraMode')?.addEventListener('change', e => setCameraMode(e.target.value));
$('cameraZoom').addEventListener('input', e => {
  gameSettings.cameraZoom = clampSetting(e.target.value, 6, 14, 9.5);
  cameraDistance = gameSettings.cameraZoom;
  $('cameraZoomValue').textContent = cameraDistance.toFixed(1).replace('.', ',') + ' m';
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
  $('lobbyShiftLockEnabled').checked = gameSettings.shiftLock;
  $('lobbyCameraMode').value = gameSettings.cameraMode;
  $('lobbyCameraZoom').disabled = gameSettings.cameraMode === 'first';
  $('lobbyCameraZoom').value = String(gameSettings.cameraZoom);
  $('lobbyCameraZoomValue').textContent = gameSettings.cameraZoom.toFixed(1).replace('.', ',') + ' m';
  $('lobbyGraphicsQuality').value = gameSettings.graphicsQuality;
  $('lobbyHapticsEnabled').checked = gameSettings.haptics;
  $('lobbyMusicVolume').value = String(gameSettings.musicVolume);
  $('lobbyMusicVolumeValue').textContent = Math.round(gameSettings.musicVolume * 100) + '%';
  $('lobbyMusicEnabled').checked = gameSettings.musicEnabled;
  $('lobbySfxVolume').value = String(gameSettings.sfxVolume);
  $('lobbySfxVolumeValue').textContent = Math.round(gameSettings.sfxVolume * 100) + '%';
}

let lobbyHudPreviewOrientation='landscape';
let lobbyHudPreviewDrag=null;
const LOBBY_HUD_PREVIEW_DEFAULTS={
  landscape:{
    joystick:{x:.035,y:.66},dodgeBtn:{x:.55,y:.76},chestBtn:{x:.68,y:.79},attackBtn:{x:.88,y:.73},
    fireBtn:{x:.88,y:.47},lightningBtn:{x:.88,y:.23},ability3Btn:{x:.75,y:.47},
    inventoryToggleBtn:{x:.76,y:.04},skillToggleBtn:{x:.64,y:.04},settingsBtn:{x:.88,y:.04},orientationToggleBtn:{x:.93,y:.04},leaveBtn:{x:.96,y:.16}
  },
  portrait:{
    joystick:{x:.035,y:.78},dodgeBtn:{x:.05,y:.60},chestBtn:{x:.70,y:.80},attackBtn:{x:.84,y:.82},
    fireBtn:{x:.82,y:.61},lightningBtn:{x:.82,y:.43},ability3Btn:{x:.65,y:.52},
    inventoryToggleBtn:{x:.05,y:.04},skillToggleBtn:{x:.20,y:.04},settingsBtn:{x:.78,y:.04},orientationToggleBtn:{x:.88,y:.04},leaveBtn:{x:.90,y:.12}
  }
};
function renderLobbyHudPreview(){
  const stage=$('lobbyHudPreview');if(!stage)return;
  stage.dataset.orientation=lobbyHudPreviewOrientation;
  const saved=hudLayout[lobbyHudPreviewOrientation]||{},defaults=LOBBY_HUD_PREVIEW_DEFAULTS[lobbyHudPreviewOrientation];
  stage.querySelectorAll('[data-hud-preview]').forEach(el=>{
    const id=el.dataset.hudPreview,pos=saved[id]||defaults[id]||{x:.8,y:.8};
    const maxX=Math.max(0,stage.clientWidth-el.offsetWidth),maxY=Math.max(0,stage.clientHeight-el.offsetHeight);
    el.style.left=Math.round(Math.max(0,Math.min(1,pos.x))*maxX)+'px';
    el.style.top=Math.round(Math.max(0,Math.min(1,pos.y))*maxY)+'px';
  });
  document.querySelectorAll('[data-hud-preview-orientation]').forEach(btn=>btn.classList.toggle('active',btn.dataset.hudPreviewOrientation===lobbyHudPreviewOrientation));
  const status=$('lobbyHudPreviewStatus');if(status)status.textContent='Layout '+(lobbyHudPreviewOrientation==='landscape'?'paisagem':'retrato')+' · salvo automaticamente.';
}
document.querySelectorAll('[data-hud-preview-orientation]').forEach(btn=>btn.addEventListener('click',()=>{
  lobbyHudPreviewOrientation=btn.dataset.hudPreviewOrientation==='portrait'?'portrait':'landscape';
  renderLobbyHudPreview();
}));
const lobbyHudPreview=$('lobbyHudPreview');
lobbyHudPreview?.addEventListener('pointerdown',event=>{
  const el=event.target.closest('[data-hud-preview]');if(!el)return;
  event.preventDefault();event.stopPropagation();
  const stageRect=lobbyHudPreview.getBoundingClientRect(),rect=el.getBoundingClientRect();
  lobbyHudPreviewDrag={el,pointerId:event.pointerId,dx:event.clientX-rect.left,dy:event.clientY-rect.top,stageRect};
  try{el.setPointerCapture(event.pointerId);}catch{}
});
lobbyHudPreview?.addEventListener('pointermove',event=>{
  if(!lobbyHudPreviewDrag||event.pointerId!==lobbyHudPreviewDrag.pointerId)return;
  event.preventDefault();
  const {el,dx,dy,stageRect}=lobbyHudPreviewDrag;
  const x=Math.max(0,Math.min(lobbyHudPreview.clientWidth-el.offsetWidth,event.clientX-stageRect.left-dx));
  const y=Math.max(0,Math.min(lobbyHudPreview.clientHeight-el.offsetHeight,event.clientY-stageRect.top-dy));
  el.style.left=Math.round(x)+'px';el.style.top=Math.round(y)+'px';
});
function finishLobbyHudPreviewDrag(event){
  if(!lobbyHudPreviewDrag||(event&&event.pointerId!==lobbyHudPreviewDrag.pointerId))return;
  const {el}=lobbyHudPreviewDrag,stageRect=lobbyHudPreview.getBoundingClientRect(),rect=el.getBoundingClientRect();
  const maxX=Math.max(1,lobbyHudPreview.clientWidth-el.offsetWidth),maxY=Math.max(1,lobbyHudPreview.clientHeight-el.offsetHeight);
  if(!hudLayout[lobbyHudPreviewOrientation])hudLayout[lobbyHudPreviewOrientation]={};
  hudLayout[lobbyHudPreviewOrientation][el.dataset.hudPreview]={x:Math.max(0,Math.min(1,(rect.left-stageRect.left)/maxX)),y:Math.max(0,Math.min(1,(rect.top-stageRect.top)/maxY))};
  saveHudLayout();lobbyHudPreviewDrag=null;
  const status=$('lobbyHudPreviewStatus');if(status)status.textContent='Posição salva! O jogo usará este layout.';
}
lobbyHudPreview?.addEventListener('pointerup',finishLobbyHudPreviewDrag);
lobbyHudPreview?.addEventListener('pointercancel',finishLobbyHudPreviewDrag);
$('lobbyHudResetBtn')?.addEventListener('click',()=>{
  delete hudLayout[lobbyHudPreviewOrientation];saveHudLayout();renderLobbyHudPreview();
  const status=$('lobbyHudPreviewStatus');if(status)status.textContent='Layout restaurado para '+(lobbyHudPreviewOrientation==='landscape'?'paisagem':'retrato')+'.';
});
function openLobbyEditor(tab) {
  const allowedTabs=['class','skin','config','skills','hud'];
  if (!allowedTabs.includes(tab)) return;
  const editor = $('lobbyEditor');
  const backdrop = $('lobbyEditorBackdrop');
  if (!editor || !backdrop) return;
  if (!editor.classList.contains('hidden') && editor.dataset.activeTab === tab) {
    closeLobbyEditor();
    return;
  }
  const titles={class:'ESCOLHA SUA CLASSE',skin:'ESCOLHA SUA SKIN',config:'CONFIGURAÇÕES',skills:'ÁRVORE DE SKILLS',hud:'PERSONALIZAR HUD'};
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
  if(tab==='config')refreshLobbySettingsUI();
  if(tab==='skills')renderSkillTrees();
  if(tab==='hud'){lobbyHudPreviewOrientation=hudOrientationKey();renderLobbyHudPreview();}
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
$('lobbyShiftLockEnabled')?.addEventListener('change', e => {
  gameSettings.shiftLock = e.target.checked;
  shiftLockEnabled = gameSettings.shiftLock;
  saveGameSettings(); refreshSettingsUI(); refreshLobbySettingsUI();
});
$('lobbyCameraZoom')?.addEventListener('input', e => {
  gameSettings.cameraZoom = clampSetting(e.target.value, 6, 14, 9.5);
  cameraDistance = gameSettings.cameraZoom;
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
  const spec=Object.values(CLASS_ABILITY_CONFIG).flat().find(item=>(item.spellType||item.ability)===kind||item.ability===kind);
  const slot=(CLASS_ABILITY_CONFIG[selectedClass]||[]).findIndex(item=>(item.spellType||item.ability)===kind||item.ability===kind);
  const manaCost={fire:20,lightning:15,arcane:18,bone:16,healing:18}[kind]||15;
  const currentMana=offlineMode?Number(offlineState?.players?.[0]?.mana??100):Number(myPlayer?.userData.serverMana??100);
  if(currentMana<manaCost){showNotice('✦ Mana insuficiente! Espere regenerar.');return;}
  const cooldown=slot===0?fireCooldown:slot===1?lightningCooldown:thirdCooldown;
  if(cooldown>0)return;
  const value=spec?.cooldown??(kind==='fire'?4:kind==='lightning'?3.5:9);
  if(slot===0)fireCooldown=value;else if(slot===1)lightningCooldown=value;else thirdCooldown=value;
  // O efeito de lançamento aparece na hora; o servidor confirma os alvos e o dano.
  vibrateGame(kind === 'fire' ? 18 : 24);
  playSfx(kind==='fire'?'fire':'lightning');
  const palette={fire:{color:0xff6b24,geo:new THREE.SphereGeometry(.25,9,7)},lightning:{color:0x69aaff,geo:new THREE.OctahedronGeometry(.24,1)},arcane:{color:0x68baff,geo:new THREE.DodecahedronGeometry(.25,1)},bone:{color:0xf3f5ff,geo:new THREE.IcosahedronGeometry(.24,1)},healing:{color:0x73ffc1,geo:new THREE.IcosahedronGeometry(.24,1)}};
  const selected=palette[kind]||palette.lightning,color=selected.color,geo=selected.geo;
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
  send({type:'spell',spell:kind});
  showNotice(kind==='fire'?'🔥 MAGIA DE FOGO!':kind==='lightning'?'⚡ MAGIA DE RAIO!':kind==='bone'?'☽ ORBE ÓSSEO!':'✦ ORBE ARCANO!');
}
function activateClassAbility(slot) {
  if (!started || (myPlayer?.userData.serverHp ?? 100) <= 0) return;
  const abilities = CLASS_ABILITY_CONFIG[selectedClass] || CLASS_ABILITY_CONFIG.knight;
  const spec=abilities[slot];
  if(!spec)return;
  const activeManaCosts={knight_shield:12,knight_dash:16,knight_whirlwind:21,arrow_rain:18,incendiary_arrows:22,archer_piercing_shot:22,goblin_invis:16,goblin_summon:24,goblin_shadow_strike:18,ogre_slam:20,ogre_haste:14,ogre_earthquake:28,healer_cure:18,healer_guardian_spirits:25,healer_sanctuary:24,necromancer_summon:24,necromancer_dive:18,monk_impact_palm:16,monk_winged_steps:18,monk_spirit_wave:22,golem_split:24,golem_rock_toss:20,golem_stone_guard:20};
  const needed=activeManaCosts[spec.ability]||16;
  const available=offlineMode?Number(offlineState?.players?.[0]?.mana??100):Number(myPlayer?.userData.serverMana??100);
  if(!spec.spell&&available<needed){showNotice('✦ Mana insuficiente! Custo: '+needed+'.');return;}
  if(spec.spell){
    castSpell(spec.spellType||spec.ability);
    return;
  }
  const remaining=slot===0?fireCooldown:slot===1?lightningCooldown:thirdCooldown;
  if (remaining > 0) return;
  if (spec.targeted) { golemRockTargeting=true; clearTimeout(golemRockTargetTimer); golemRockTargetTimer=setTimeout(()=>{golemRockTargeting=false;showNotice('Mira da pedra cancelada.');},9000); showNotice('☄ Toque no chão para escolher onde a pedra vai cair.'); return; }
  send({ type: 'classAbility', ability: spec.ability });
}
$('fireBtn').addEventListener('pointerdown', e => { e.preventDefault(); activateClassAbility(0); });
$('lightningBtn').addEventListener('pointerdown',e=>{e.preventDefault();activateClassAbility(1);});
$('ability3Btn')?.addEventListener('pointerdown',e=>{e.preventDefault();activateClassAbility(2);});

$('attackBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  attack();
});
$('dodgeBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  dodge();
});

addEventListener('keydown', e => {
  // Não rouba teclas enquanto o jogador escreve ou altera uma configuração.
  if (e.target && e.target.closest && e.target.closest('input,textarea,select,button[contenteditable="true"]')) return;
  if (e.repeat) return;
  const code = e.code;
  if (['Space','KeyE','KeyR','KeyQ','Digit1','Digit2','Digit3','KeyI','KeyK','KeyG','Escape'].includes(code)) e.preventDefault();
  keys[code] = true;

  // Controles de combate no PC: atalhos acionam as mesmas funções dos botões do HUD.
  if (!started) {
    if (code === 'Escape' && $('lobbyEditor') && !$('lobbyEditor').classList.contains('hidden')) closeLobbyEditor();
    return;
  }
  if (code === 'Space') attack();
  else if (code === 'Digit1' || code === 'Numpad1') activateClassAbility(0);
  else if (code === 'Digit2' || code === 'Numpad2') activateClassAbility(1);
  else if (code === 'Digit3' || code === 'Numpad3') activateClassAbility(2);
  else if (code === 'KeyE') interactChest();
  else if (code === 'KeyR') useSelectedItem();
  else if (code === 'KeyQ') dodge();
  else if (code === 'KeyI') $('inventoryToggleBtn')?.click();
  else if (code === 'KeyK') $('skillToggleBtn')?.click();
  else if (code === 'KeyG') $('settingsBtn')?.click();
  else if (code === 'Escape') {
    if ($('skillPanel') && !$('skillPanel').classList.contains('hidden')) $('skillCloseBtn')?.click();
    else if ($('settingsPanel') && !$('settingsPanel').classList.contains('hidden')) $('settingsCloseBtn')?.click();
    else $('settingsBtn')?.click();
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });

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
  // Câmera em distância fixa: controles de zoom e Shift Lock foram removidos.
  el.addEventListener('pointerdown', e => {
    if (started && golemRockTargeting) { const rect=el.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-rect.left)/Math.max(1,rect.width))*2-1,-((e.clientY-rect.top)/Math.max(1,rect.height))*2+1); const r=new THREE.Raycaster();r.setFromCamera(p,camera);const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),aim=new THREE.Vector3();if(r.ray.intersectPlane(plane,aim)){send({type:'classAbility',ability:'golem_rock_toss',x:aim.x,z:aim.z});golemRockTargeting=false;clearTimeout(golemRockTargetTimer);lookPointer=null;}else showNotice('Toque em uma área visível do chão.');e.preventDefault();e.stopPropagation();return; }
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
    try { el.setPointerCapture(e.pointerId); } catch {}
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  });

  el.addEventListener('pointermove', e => {
    if (e.pointerId !== lookPointer) return;

    e.preventDefault();
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    targetYaw -= dx * .008 * gameSettings.sensitivity;
    targetPitch = THREE.MathUtils.clamp(targetPitch + dy * .0105 * gameSettings.verticalSensitivity, -.82, 1.18);
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
  
  const nextDetailTier = lastFps > 54 ? 0 : lastFps < 28 ? 2 : lastFps < 48 ? 1 : adaptiveDetailTier;
  if (nextDetailTier !== adaptiveDetailTier) {
    adaptiveDetailTier = nextDetailTier;
    if (ambientParticles) ambientParticles.visible = adaptiveDetailTier === 0;
    if (particleMaterial) {
      particleMaterial.opacity = adaptiveDetailTier === 2 ? .22 : adaptiveDetailTier === 1 ? .38 : .6;
      particleMaterial.size = adaptiveDetailTier === 2 ? .032 : adaptiveDetailTier === 1 ? .043 : .055;
    }
    if (astralStarField) astralStarField.visible = adaptiveDetailTier === 0;
    // Em carga alta, reduz partículas e runas do palco 3D do lobby.
    if (lobbyPreviewParticles) lobbyPreviewParticles.visible = adaptiveDetailTier < 2;
    if (lobbyPreviewRunes) lobbyPreviewRunes.visible = adaptiveDetailTier < 2;
  }
  
  if (lastFps < 43) {
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
    // Baixa a resolução dos pixels mais agressivamente sem remover detalhes dos modelos.
    const adaptiveFloor = getMinimumRenderPixelRatio(innerWidth, innerHeight);
    const stepDown = lastFps < 25 ? .12 : lastFps < 34 ? .09 : .06;
    nextRatio = Math.max(adaptiveFloor, adaptivePixelRatio - stepDown);
    slowFpsSamples = 0;
    fastFpsSamples = 0;
  } else if (fastFpsSamples >= 4) {
    nextRatio = Math.min(Math.min(devicePixelRatio, renderPixelRatioCap), adaptivePixelRatio + .05);
    fastFpsSamples = 0;
  }

  if (adaptiveDetailTier > 0) {
    const dynamicCap = isMobileDevice ? (adaptiveDetailTier === 2 ? .88 : .98) : (adaptiveDetailTier === 2 ? .95 : 1.15);
    // A escala adaptativa não pode passar do limite inferior de nitidez definido
    // para cada qualidade; em vez de borrar a imagem, o jogo reduz efeitos visuais.
    nextRatio = Math.max(
      getMinimumRenderPixelRatio(innerWidth, innerHeight),
      Math.min(nextRatio, dynamicCap)
    );
  }
  if (renderer && Math.abs(nextRatio - adaptivePixelRatio) >= .01) {
    adaptivePixelRatio = Math.round(nextRatio * 100) / 100;
    renderer.setPixelRatio(adaptivePixelRatio);
    syncRendererSize();
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

function startGameAnimationLoop() {
  if (animationFrameId !== null || !renderer || document.hidden || webglContextLost) return;
  animationFrameId = requestAnimationFrame(animate);
}
function stopGameAnimationLoop() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
}
function animate() {
  animationFrameId = null;
  // Pausa o loop em segundo plano ou quando o contexto gráfico foi perdido.
  if (!renderer || document.hidden || webglContextLost) return;
  startGameAnimationLoop();

  const dt = Math.min(clock.getDelta(), 0.05), worldTime = clock.elapsedTime;
  updateDayNightCycle(worldTime);
  if (!started && performance.now() - classDemoLastUiAt > 90) {
    classDemoLastUiAt = performance.now();
    updateClassAbilityDemo(false);
  }
  const classFxNow = performance.now();
  for (let i = activeClassEffects.length - 1; i >= 0; i--) {
    const effect = activeClassEffects[i];
    const progress = (classFxNow - effect.startedAt) / effect.duration;
    if (progress >= 1) {
      scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose();
      activeClassEffects.splice(i, 1);
    } else {
      if(effect.kind==='fallingRock'){effect.mesh.position.y=Math.max(.22,(1-progress)*7.5);effect.mesh.rotation.x+=dt*1.8;effect.mesh.rotation.z+=dt*2.1;effect.mesh.scale.setScalar(.75+Math.sin(progress*Math.PI)*.35);if(progress>.78)effect.mesh.material.opacity=Math.max(0,(1-progress)/.22);}else{effect.mesh.scale.setScalar(.72+progress*.55);effect.mesh.material.opacity=.85*(1-progress);}
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
  if(astralStarField&&(environmentGroups.astral?.visible||environmentGroups.eclipse?.visible))astralStarField.rotation.y+=dt*.0016;
  if(eclipsePortal){const open=!!eclipsePortal.userData.open;const arch=eclipsePortal.children[0];if(arch)arch.rotation.z+=dt*(open?.42:.10);const core=eclipsePortal.children[1];if(core)core.material.opacity=open?.32+Math.sin(worldTime*2.5)*.12:.035+Math.sin(worldTime)*.012;const light=eclipsePortal.children[2];if(light)light.intensity=open?8+Math.sin(worldTime*3)*2:.4;}
  for(const f of astralFloaters){f.mesh.position.y=f.baseY+Math.sin(worldTime*f.speed+f.phase)*.24;f.mesh.rotation.y+=dt*f.speed*.32;f.mesh.rotation.x+=dt*f.speed*.12;}
  // Amortece o giro da câmera para o arrasto ficar mais fluido sem reduzir a sensibilidade.
  const cameraInputSmooth = 1 - Math.exp(-18 * dt);
  yaw += (targetYaw - yaw) * cameraInputSmooth;
  pitch += (targetPitch - pitch) * cameraInputSmooth;
  const cameraSmooth = 1 - Math.exp(-9 * dt);

  attackCooldown = Math.max(0, attackCooldown - dt);
  fireCooldown=Math.max(0,fireCooldown-dt);
  lightningCooldown=Math.max(0,lightningCooldown-dt);
  thirdCooldown=Math.max(0,thirdCooldown-dt);
  dodgeTimer = Math.max(0, dodgeTimer - dt);
  const dodgeLabel = $('dodgeCooldown');
  if (dodgeLabel) {
    const dodgeText = dodgeTimer > 0 ? dodgeTimer.toFixed(1) + 's' : 'OK';
    if (dodgeLabel.textContent !== dodgeText) dodgeLabel.textContent = dodgeText;
  }
  const dodgeBtn = $('dodgeBtn');
  if (dodgeBtn) dodgeBtn.classList.toggle('cooling', dodgeTimer > 0);
  const fireLabel=$('fireCooldown'),lightningLabel=$('lightningCooldown'),thirdLabel=$('ability3Cooldown');
  // Evita escritas repetidas no DOM a cada frame; os rótulos só mudam quando o texto muda.
  if (fireLabel) {
    const fireText = fireCooldown > 0 ? fireCooldown.toFixed(1) + 's' : 'OK';
    if (fireLabel.textContent !== fireText) fireLabel.textContent = fireText;
  }
  if(lightningLabel){const lightningText=lightningCooldown>0?lightningCooldown.toFixed(1)+'s':'OK';if(lightningLabel.textContent!==lightningText)lightningLabel.textContent=lightningText;}
  if(thirdLabel){const thirdText=thirdCooldown>0?thirdCooldown.toFixed(1)+'s':'OK';if(thirdLabel.textContent!==thirdText)thirdLabel.textContent=thirdText;}

  // Movimento do jogador local
  if (started && myPlayer && (myPlayer.userData.serverHp ?? 100) > 0) {
    const v = moveInput();

    if (Math.hypot(v.x, v.y) > 0.04) {
      const forward = movementForwardScratch.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = movementRightScratch.set(Math.cos(yaw), 0, -Math.sin(yaw));

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

      if (!shiftLockEnabled) myPlayer.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
    }

    // Shift Lock mantém o herói alinhado à câmera; o movimento lateral vira strafe.
    // Sem Shift Lock, o personagem acompanha a direção em que está caminhando.
    if (shiftLockEnabled) myPlayer.rotation.y = yaw;
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
    const idleSeed = myPlayer.userData.idleSeed || 0;
    const idleWave = Math.sin(phase * .64 + idleSeed);
    const stride = moving ? 1 : .12;
    // Ação do personagem: animação local leve, sem depender de resposta do servidor.
    myPlayer.userData.attackAnim = Math.max(0, (myPlayer.userData.attackAnim || 0) - dt);
    myPlayer.userData.dodgeAnim = Math.max(0, (myPlayer.userData.dodgeAnim || 0) - dt);
    const attackT = myPlayer.userData.attackAnim > 0 ? 1 - myPlayer.userData.attackAnim / .30 : 0;
    const attackWind = myPlayer.userData.attackAnim > 0 ? Math.sin(Math.min(1, attackT / .35) * Math.PI * .5) : 0;
    const attackHit = myPlayer.userData.attackAnim > 0 ? Math.sin(Math.max(0, Math.min(1, (attackT - .24) / .48)) * Math.PI) : 0;
    const dodgeT = myPlayer.userData.dodgeAnim > 0 ? myPlayer.userData.dodgeAnim / .22 : 0;
    const dodgeLean = Math.sin(Math.min(1, dodgeT) * Math.PI) * .28;
    const breath = Math.sin(phase * .8);
    // 1) Respiração subtil do peitoral.
    if (myPlayer.userData.torso) {
      const torsoBaseY = myPlayer.userData.torsoBaseScaleY || 1;
      myPlayer.userData.torso.scale.y = torsoBaseY * (1 + breath * .012 + (moving ? Math.abs(Math.sin(phase*2))*.006 : 0));
      // 2) Inclinação ao atacar e 3) inclinação rápida durante esquiva.
      myPlayer.userData.torso.rotation.z = (moving ? Math.sin(phase) * .01 : Math.sin(phase * .5) * .006) + attackHit * .12 - dodgeLean * .35;
      myPlayer.userData.torso.rotation.x = -attackHit * .10 + dodgeLean * .25;
    }
    // 4) Cabeça acompanha o movimento e aponta para a ação.
    if (myPlayer.userData.head) {
      const head = myPlayer.userData.headRig || myPlayer.userData.head;
      head.rotation.x = (moving ? Math.sin(phase) * .042 : idleWave * .024) - attackHit * .15;
      head.rotation.y = Math.sin(phase * .32 + idleSeed) * (moving ? .035 : .055);
      head.rotation.z = Math.sin(phase * .4 + idleSeed) * .026 + dodgeLean * .18;
    }
    // 5) Passos alternados mais legíveis; 6) pose de esquiva temporária.
    for (const leg of myPlayer.userData.legs || []) {
      const legSwing = Math.sin(phase + (leg.side > 0 ? Math.PI : 0)) * .29 * stride;
      leg.mesh.rotation.x = legSwing + (myPlayer.userData.dodgeAnim > 0 ? (leg.side > 0 ? -.32 : .22) * dodgeLean : 0);
    }
    // 7) Braços fazem um movimento de preparação e golpe em vez de só balançar.
    for (const arm of myPlayer.userData.arms || []) {
      const swing = Math.sin(phase + (arm.side < 0 ? Math.PI : 0));
      const lead = arm.side > 0 ? 1 : .38;
      arm.mesh.rotation.x = swing * .18 * stride - attackWind * .48 * lead + attackHit * .82 * lead + dodgeLean * .12;
      arm.mesh.rotation.y = Math.sin(phase * .5 + arm.side) * .035 * stride;
      arm.mesh.rotation.z = (arm.side > 0 ? -.12 : .12) + Math.sin(phase + arm.side) * .018 * stride + attackHit * (arm.side > 0 ? -.20 : .06);
      if (arm.mesh.userData.elbow) {
        arm.mesh.userData.elbow.rotation.x = Math.max(0, swing) * .32 * stride - attackWind * .18 * lead + attackHit * .30 * lead;
      }
    }
    // 8) O personagem dá um pequeno impulso visual no impacto.
    myPlayer.position.y = (moving ? Math.abs(Math.sin(phase * 2)) * .008 : 0) + attackHit * .045;
    // 9) A capa e as pontas acompanham inércia de corrida e golpe.
    for (const tail of myPlayer.userData.capeTails || []) {
      tail.rotation.x = Math.sin(phase * .85) * .08 * stride + attackHit * .11 - dodgeLean * .12;
      tail.rotation.z = (tail.position.x < 0 ? .10 : -.10) + Math.sin(phase * .55) * .035 * stride;
    }
    if (myPlayer.userData.cape) {
      myPlayer.userData.cape.rotation.x = -.08 + Math.sin(phase) * .035 * stride + attackHit * .08 - dodgeLean * .18;
      myPlayer.userData.cape.rotation.z = Math.sin(phase * .5) * .012 * stride - attackHit * .06;
    }
    // 10) A arma acompanha a animação sem setTimeout concorrente.
    const weapon = myPlayer.userData.sword;
    if (weapon) {
      const rest = myPlayer.userData.weaponRest || {x:0,z:0,y:0};
      weapon.rotation.x = rest.x - attackHit * 1.05 + Math.sin(phase) * .025 * stride;
      weapon.rotation.z = rest.z - attackHit * .42 + Math.sin(phase * .5) * .012;
      weapon.position.y = rest.y + Math.sin(phase) * .018 * stride;
      if (weapon.userData.orb) {
        weapon.userData.orb.rotation.y += dt * 1.8;
        weapon.userData.orb.rotation.x = Math.sin(phase * .8 + idleSeed) * .10;
      }
      if (weapon.userData.halo) weapon.userData.halo.rotation.z += dt * .75;
    }
    if (myPlayer.userData.baseRing) myPlayer.userData.baseRing.rotation.z += dt * (moving ? .38 : .16);
    if (myPlayer.userData.waistSigil) myPlayer.userData.waistSigil.rotation.y += dt * (moving ? 1.2 : .45);
    if (myPlayer.userData.classCharm) {
      myPlayer.userData.classCharm.rotation.y += dt * (moving ? .85 : .42);
      myPlayer.userData.classCharm.rotation.z = Math.sin(phase*.7 + idleSeed) * .08;
      myPlayer.userData.classCharm.position.y = 1.53 + Math.sin(phase*1.15 + idleSeed) * .025;
    }
    if (myPlayer.userData.classShield) {
      myPlayer.userData.classShield.rotation.z = -.12 + attackHit*.10 + Math.sin(phase)*.018*stride;
      myPlayer.userData.classShield.rotation.x = dodgeLean*.12;
    }
    for (const part of myPlayer.userData.decorativeParts || []) part.rotation.y += dt*.12;
    if (myPlayer.userData.classShield) {
      const shieldPulse = 1 + Math.sin(phase * 1.6) * .012;
      myPlayer.userData.classShield.scale.set(shieldPulse, shieldPulse, shieldPulse);
    }
  }

  // Em queda de desempenho no celular, a movimentação dos outros aventureiros e
  // monstros é atualizada a 30 Hz; câmera, controles e jogador local continuam suaves.
  let entityDt = dt;
  let runEntityUpdate = true;
  if (isMobileDevice && adaptiveDetailTier > 0) {
    entityUpdateAccumulator += dt;
    runEntityUpdate = entityUpdateAccumulator >= 1 / 30;
    if (runEntityUpdate) {
      entityDt = Math.min(entityUpdateAccumulator, 0.08);
      entityUpdateAccumulator = 0;
    }
  }
  if (runEntityUpdate) {
    const remoteSmooth = 1 - Math.exp(-14 * entityDt);
    const monsterSmooth = 1 - Math.exp(-10 * entityDt);
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
      if (obj.userData.guardianCore) { obj.userData.guardianCore.rotation.y += entityDt * 1.25; obj.userData.guardianCore.rotation.x = Math.sin(phase * .8) * .12; }
      if (obj.userData.guardianHalo) obj.userData.guardianHalo.rotation.z += entityDt * .8;
      for (const wing of obj.userData.guardianWings || []) {
        wing.mesh.rotation.z = wing.side * (-.24 + Math.sin(phase * 2.3) * .34);
        wing.mesh.rotation.y = Math.sin(phase * 1.4 + wing.side) * .18;
      }
      continue;
    }
    const farRemote = adaptiveDetailTier > 0 && obj.position.distanceToSquared(camera.position) > 625;
    if (farRemote) continue;
    const remoteMoving = Math.hypot((obj.userData.targetX ?? obj.position.x) - obj.position.x, (obj.userData.targetZ ?? obj.position.z) - obj.position.z) > .035;
    obj.userData.walkPhase = (obj.userData.walkPhase || 0) + entityDt * (remoteMoving ? 7.2 : 1.4);
    const rp = obj.userData.walkPhase;
    const remoteIdleSeed = obj.userData.idleSeed || 0;
    const remoteIdleWave = Math.sin(rp*.62 + remoteIdleSeed);
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
      obj.userData.torso.rotation.z = remoteMoving ? Math.sin(rp) * .026 : remoteIdleWave * .009;
      obj.userData.torso.rotation.x = remoteMoving ? Math.sin(rp*2)*.01 : 0;
    }
    if (obj.userData.head) {
      const head = obj.userData.headRig || obj.userData.head;
      head.rotation.x = remoteMoving ? Math.sin(rp) * .034 : remoteIdleWave * .022;
      head.rotation.y = Math.sin(rp*.32 + remoteIdleSeed)*.045;
      head.rotation.z = Math.sin(rp*.4 + remoteIdleSeed)*.022;
    }
    if (obj.userData.capeTails) {
      for (const tail of obj.userData.capeTails) {
        tail.rotation.x = Math.sin(rp * .8 + tail.position.x) * (remoteMoving ? .07 : .012);
        tail.rotation.z = (tail.position.x < 0 ? .10 : -.10) + Math.sin(rp * .5) * (remoteMoving ? .025 : .006);
      }
    }
    if (obj.userData.baseRing) obj.userData.baseRing.rotation.z += entityDt * .3;
    if (obj.userData.waistSigil) obj.userData.waistSigil.rotation.y += entityDt * .5;
    if (obj.userData.classCharm) {
      obj.userData.classCharm.rotation.y += entityDt*.3;
      obj.userData.classCharm.rotation.z = Math.sin(rp*.7 + remoteIdleSeed)*.07;
      obj.userData.classCharm.position.y = 1.53 + Math.sin(rp*1.15 + remoteIdleSeed)*.022;
    }
    if (obj.userData.classShield) obj.userData.classShield.rotation.z = -.12 + Math.sin(rp) * (remoteMoving ? .025 : .01);
    for (const part of obj.userData.decorativeParts || []) part.rotation.y += entityDt*.08;
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
      obj.userData.spawnAnim = Math.max(0, obj.userData.spawnAnim - entityDt);
      const spawnProgress = 1 - obj.userData.spawnAnim / .35;
      obj.scale.setScalar(Math.max(.05, spawnProgress));
    } else {
      obj.scale.setScalar(1);
    }

    const kind = obj.userData.kind || 'stalker';
    const gait = kind === 'brute' ? .72
      : kind === 'wraith' ? 1.34
      : kind === 'stalker' ? 1.16 : .96;
    obj.userData.walkPhase = (obj.userData.walkPhase || 0) + entityDt * (moving ? 7.2 : 1.45);
    const phase = obj.userData.walkPhase;

    if (obj.userData.attackAnim > 0) {
      obj.userData.attackAnim = Math.max(0, obj.userData.attackAnim - entityDt);
    }
    const attackProgress = obj.userData.attackAnim > 0
      ? (1 - obj.userData.attackAnim / .38) : 0;
    const attackT = THREE.MathUtils.clamp(attackProgress, 0, 1);
    // Três fases claras: prepara o golpe, avança no impacto e recua para recuperar.
    const windup = obj.userData.attackAnim > 0 ? Math.sin(Math.min(1, attackT / .30) * Math.PI * .5) : 0;
    const strike = obj.userData.attackAnim > 0 ? Math.sin(Math.max(0, Math.min(1, (attackT - .28) / .42)) * Math.PI) : 0;
    const recovery = obj.userData.attackAnim > 0 ? Math.sin(Math.max(0, (attackT - .68) / .32) * Math.PI * .5) : 0;
    const attackPulse = obj.userData.attackAnim > 0 ? Math.sin(attackT * Math.PI) : 0;

    const idleBob = kind === 'wraith' ? .052
      : kind === 'abyss' ? .035 : moving ? .022 : .009;
    const footfall = moving ? Math.pow(Math.max(0, Math.sin(phase * 2)), 2) : 0;
    const attackLift = attackPulse * (kind === 'brute' ? .12 : .075);
    obj.position.y = Math.abs(Math.sin(phase * (kind === 'wraith' ? 1.15 : 2))) * idleBob
      + footfall * (kind === 'brute' ? .012 : .022) + attackLift;

    // A passada ganha peso e balanço lateral próprio para cada família de criatura.
    const rollAmplitude = kind === 'brute' ? .025 : kind === 'wraith' || kind === 'abyss' ? .035 : .022;
    const rollTarget = moving ? Math.sin(phase) * rollAmplitude : Math.sin(phase * .45) * .006;
    obj.rotation.z = THREE.MathUtils.lerp(obj.rotation.z, rollTarget, 1 - Math.exp(-7.5 * entityDt));

    if (obj.userData.targetRot !== undefined) {
      const angleDiff = Math.atan2(
        Math.sin(obj.userData.targetRot - obj.rotation.y),
        Math.cos(obj.userData.targetRot - obj.rotation.y)
      );
      obj.rotation.y += angleDiff * (1 - Math.exp(-8 * entityDt));
    }

    const attackTilt = strike * (kind === 'brute' ? .42 : kind === 'wraith' ? .24 : .50);
    const windupTilt = windup * (kind === 'brute' ? .16 : .10);
    const recoveryTilt = recovery * .08;
    const walkTilt = kind === 'stalker' && moving ? Math.sin(phase) * .015 : 0;
    const targetTilt = windupTilt - attackTilt + recoveryTilt + walkTilt;
    obj.rotation.x = THREE.MathUtils.lerp(obj.rotation.x, targetTilt, 1 - Math.exp(-12 * entityDt));

    // Mantém movimento e orientação dos monstros distantes, mas evita animar cada membro
    // quando o celular já está em modo de desempenho reduzido.
    const farMonster = adaptiveDetailTier > 0 && obj.position.distanceToSquared(camera.position) > 625;
    if (obj.userData.attackRing) obj.userData.attackRing.visible = !farMonster;
    if (farMonster) continue;

    for (const limb of obj.userData.animatedLimbs || []) {
      const limbPhase = phase * gait + (limb.side > 0 ? Math.PI : 0);
      const swing = Math.sin(limbPhase);
      const walkAmount = moving ? (kind === 'brute' ? .28 : kind === 'wraith' || kind === 'abyss' ? .13 : kind === 'thorn' ? .24 : .22) : .012;
      const attackPower = kind === 'brute' ? 1.02 : kind === 'wraith' || kind === 'abyss' ? .5 : .72;
      const windupPower = kind === 'brute' ? .30 : .20;
      const sideBias = limb.side < 0 ? 1 : .25;
      const limbSwing = swing * walkAmount;
      limb.mesh.rotation.x = limbSwing + windup * windupPower * sideBias - strike * attackPower * sideBias + recovery * .16 * sideBias;
      limb.mesh.rotation.z = limb.baseRotationZ
        + Math.sin(phase * .65 * gait + limb.side) * (moving ? .035 : .012)
        + (kind === 'wraith' || kind === 'abyss' ? Math.sin(phase * .7 + limb.side) * .04 : 0);
    }

    // Os olhos destacam o instante do impacto sem criar luzes dinâmicas adicionais.
    if (obj.userData.eyeMaterial) {
      const baseGlow = kind === 'brute' ? 1.9 : 1.65;
      obj.userData.eyeMaterial.emissiveIntensity = baseGlow + strike * (kind === 'inferno' ? 2.0 : 1.1);
    }
    // O anel no chão pulsa junto ao golpe para comunicar melhor o perigo do ataque.
    const attackRing = obj.userData.attackRing;
    if (attackRing) {
      const ringScale = 1 + windup * .05 + strike * .28 + recovery * .06;
      attackRing.material.opacity = .30 + windup * .22 + strike * .58;
      attackRing.scale.set(ringScale, ringScale, ringScale);
    }
  }

  if (bossMesh && bossMesh.visible && bossMesh.userData.targetX !== undefined) {
    bossMesh.position.x = THREE.MathUtils.lerp(bossMesh.position.x, bossMesh.userData.targetX, monsterSmooth);
    bossMesh.position.z = THREE.MathUtils.lerp(bossMesh.position.z, bossMesh.userData.targetZ, monsterSmooth);
    if (myPlayer) {
      const faceBoss = Math.atan2(myPlayer.position.x - bossMesh.position.x, myPlayer.position.z - bossMesh.position.z);
      const turnBoss = Math.atan2(Math.sin(faceBoss - bossMesh.rotation.y), Math.cos(faceBoss - bossMesh.rotation.y));
      bossMesh.rotation.y += turnBoss * (1 - Math.exp(-5 * entityDt));
    }
    bossMesh.userData.animPhase = (bossMesh.userData.animPhase || 0) + entityDt * (Math.hypot((bossMesh.userData.targetX ?? bossMesh.position.x)-bossMesh.position.x,(bossMesh.userData.targetZ ?? bossMesh.position.z)-bossMesh.position.z) > .04 ? 5.5 : 1.7);
    const bossPhase = bossMesh.userData.animPhase;
    const bossMoving = Math.hypot((bossMesh.userData.targetX ?? bossMesh.position.x)-bossMesh.position.x,(bossMesh.userData.targetZ ?? bossMesh.position.z)-bossMesh.position.z) > .04;
    const bossHealthRatio = bossMesh.userData.serverHp !== undefined && bossMesh.userData.serverMaxHp ? bossMesh.userData.serverHp / bossMesh.userData.serverMaxHp : 1;
    const bossIntensity = bossHealthRatio < .34 ? 1.45 : bossHealthRatio < .67 ? 1.18 : 1;
    bossMesh.position.y = .08 + Math.sin(bossPhase * 1.5) * .06 * bossIntensity;
    if (bossMesh.userData.torso) bossMesh.userData.torso.rotation.z = Math.sin(bossPhase) * (bossMoving ? .055 : .024);
    for (const arm of bossMesh.userData.arms || []) arm.mesh.rotation.x = Math.sin(bossPhase + (arm.side > 0 ? Math.PI : 0)) * (bossMoving ? .25 : .06);
    if (bossMesh.userData.eyeMaterial) bossMesh.userData.eyeMaterial.emissiveIntensity = (2.3 + (Math.sin(bossPhase * 2.1) + 1) * .55) * bossIntensity;
    if (bossMesh.userData.coreHalo) { bossMesh.userData.coreHalo.rotation.z += entityDt * (bossMoving ? .65 : .24); bossMesh.userData.coreHalo.material.emissiveIntensity = 1.0 + (Math.sin(bossPhase * 2.4) + 1) * .45; }
    // O Guardião respira, balança os braços e pulsa os olhos durante a perseguição.
  }
  // Portais do Guardião pulsam enquanto carregam e ficam vermelhos quando vão explodir.
  for (const portal of bossPortalMeshes.values()) {
    const data = portal.userData.portalData || {};
    const warning = Date.now() < (Number(data.spawnAt) || 0);
    const pulse = (Math.sin(worldTime * (warning ? 4.5 : 8.5)) + 1) * .5;
    const ring = portal.userData.portalRing;
    const core = portal.userData.portalCore;
    if (ring) {
      ring.rotation.z += entityDt * (warning ? .35 : 1.15);
      ring.scale.setScalar(warning ? .90 + pulse * .07 : 1 + pulse * .16);
      ring.material.color.setHex(warning ? 0xffa344 : 0xff214e);
      ring.material.opacity = warning ? .48 + pulse * .18 : .78 + pulse * .18;
    }
    if (core) {
      core.material.color.setHex(warning ? 0xffa344 : 0xff214e);
      core.material.opacity = warning ? .08 + pulse * .07 : .23 + pulse * .16;
    }
  }

  // Emissive pulse and slow core rotation make enemies feel alive without extra lights.
  for (const obj of monsterMeshes.values()) {
    if (!obj.visible || obj === bossMesh) continue;
    const offset=obj.userData.eyePulseOffset||0;
    if (obj.userData.eyeMaterial) obj.userData.eyeMaterial.emissiveIntensity=1.1+(Math.sin(worldTime*2.6+offset)+1)*.42;
    // Microanimação dos olhos: brilho e pequenas mudanças de foco sem luzes extras.
    for(const eye of obj.userData.eyePairs||[]){
      const focus=Math.sin(worldTime*.72+offset+eye.side*.35)*.012;
      if(eye.pupil)eye.pupil.position.x=eye.eye.position.x+focus;
      if(eye.glint)eye.glint.material.opacity=.72+Math.sin(worldTime*2.1+offset)*.2;
    }
    if (obj.userData.coreMesh) {
      obj.userData.coreMesh.rotation.y += entityDt * (obj.userData.kind === 'brute' ? .24 : .42);
      obj.userData.coreMesh.rotation.x = Math.sin(worldTime * 1.2 + offset) * .12;
      const pulse = 1 + Math.sin(worldTime * (obj.userData.kind === 'inferno' ? 4.2 : 2.4) + offset) * (obj.userData.kind === 'inferno' ? .12 : .055);
      obj.userData.coreMesh.scale.set(pulse, pulse * (obj.userData.kind === 'wraith' ? 1.12 : 1), pulse);
    }
  }
  if (bossMesh && bossMesh.userData.coreMesh) {
    if(bossMesh.userData.eyeMaterial)bossMesh.userData.eyeMaterial.emissiveIntensity=2.1+(Math.sin(worldTime*2.2)+1)*.55;
    for(const spine of bossMesh.userData.backSpines||[])spine.rotation.z=Math.sin(worldTime*1.25+spine.position.x)*.035;
    bossMesh.userData.coreMesh.rotation.y+=entityDt*.55;
    bossMesh.userData.coreMesh.rotation.x=Math.sin(worldTime*1.5)*.12;
    if (bossMesh.userData.coreHalo) bossMesh.userData.coreHalo.rotation.z+=entityDt*.35;
  }
  // Portão fechado projeta uma parede rúnica de energia; ao liberar, ela sobe e desaparece.
  for(const gate of gateMeshes){
    const open=!!gate.userData.open,targetScale=open?0:1;
    gate.userData.bars.scale.x=THREE.MathUtils.lerp(gate.userData.bars.scale.x,targetScale,1-Math.exp(-5*entityDt));
    gate.userData.bars.visible=gate.userData.bars.scale.x>.04;
    gate.userData.ring.material.opacity=open?.08:.3;
    gate.userData.portal.material.opacity=THREE.MathUtils.lerp(gate.userData.portal.material.opacity,open?.32:0,1-Math.exp(-2.8*entityDt));
    gate.userData.portalRim.rotation.z+=entityDt*(open?.65:.12);
    gate.userData.portalRim.material.emissiveIntensity=open?2.8:1.0;
    if(gate.userData.barrier){
      gate.userData.barrier.position.y=THREE.MathUtils.lerp(gate.userData.barrier.position.y,open?5.25:2.28,1-Math.exp(-3.4*entityDt));
      gate.userData.barrier.material.opacity=THREE.MathUtils.lerp(gate.userData.barrier.material.opacity,open?.045:.34,1-Math.exp(-3.4*entityDt));
      gate.userData.barrier.visible=gate.userData.barrier.material.opacity>.02;
    }
  }
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


  // Barras acompanham a câmera a 30 Hz para reduzir trabalho em cada quadro.
  healthBarRefreshAccumulator += dt;
  if (healthBarRefreshAccumulator >= 1 / 30) {
    healthBarRefreshAccumulator = 0;
    if (myPlayer) orientHealthBar(myPlayer);
    for (const obj of remotePlayers.values()) orientHealthBar(obj);
    for (const obj of monsterMeshes.values()) orientHealthBar(obj);
  }

  // Enquadramento panorâmico do lobby, adaptado à largura da tela.
  if (!started) {
    const halfFov = camera.fov * Math.PI / 360;
    const tanHalfHorizontal = Math.tan(halfFov) * camera.aspect;
    const lineupWidth = 6.6;
    const baseViewDistance = THREE.MathUtils.clamp(lineupWidth / Math.max(2 * tanHalfHorizontal, .12), 8.5, 13.5);
    const viewDistance = THREE.MathUtils.clamp(baseViewDistance + (cameraDistance - 9.5) * 0.7, 7, 16);
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
    if (gameSettings.cameraMode === 'first') {
      // Primeira pessoa: câmera centralizada na altura dos olhos, sem deslocamento lateral.
      cameraPositionScratch.set(target.x + Math.sin(yaw) * 0.06, 1.62, target.z + Math.cos(yaw) * 0.06);
      camera.position.lerp(cameraPositionScratch, 1 - Math.exp(-18 * dt));
      camera.lookAt(target.x - Math.sin(yaw) * 12, 1.62 - pitch * 8, target.z - Math.cos(yaw) * 12);
    } else {
      // Shift Lock mantém a câmera centralizada e permite strafe lateral sem girar a visão.
      const baseDistance = gameSettings.cameraMode === 'second'
        ? THREE.MathUtils.clamp(cameraDistance * 0.52, 3.2, 6.5)
        : cameraDistance;
      const distance = baseDistance + introBlend * 2.8;
      // A câmera percorre um arco real ao redor do herói. O toque vertical
      // altera o ângulo de elevação, em vez de apenas empurrar a câmera para cima.
      const orbitPitch = THREE.MathUtils.clamp(pitch, -0.62, 1.12);
      const horizontalDistance = Math.max(0.35, Math.cos(orbitPitch) * distance);
      const verticalOffset = Math.sin(orbitPitch) * distance;
      const cameraFloor = 0.42;
      cameraPositionScratch.set(
        target.x + Math.sin(yaw) * horizontalDistance,
        Math.max(cameraFloor, target.y + verticalOffset),
        target.z + Math.cos(yaw) * horizontalDistance
      );
      camera.position.lerp(cameraPositionScratch, cameraSmooth);
      const lookUpTargetY = orbitPitch < 0
        ? Math.max(target.y + 0.15, cameraPositionScratch.y + horizontalDistance * Math.tan(-orbitPitch))
        : target.y + 0.15;
      camera.lookAt(target.x, lookUpTargetY, target.z);
    }
  }

  const lobbyVisible = !started && $('lobby') && !$('lobby').classList.contains('hidden');
  if (myPlayer) myPlayer.visible = !lobbyVisible && gameSettings.cameraMode !== 'first';
  for (const obj of remotePlayers.values()) obj.visible = !lobbyVisible;
  updatePerformanceMonitor();
  const lobbyOverlayVisible = !started && $('lobby') && !$('lobby').classList.contains('hidden');
  if (lobbyOverlayVisible) {
    // O lobby precisa apenas limpar o canvas antes de desenhar a prévia 3D.
    // Evita criar arrays e alternar a visibilidade de todos os objetos a cada frame.
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, renderer.domElement.clientWidth || innerWidth, renderer.domElement.clientHeight || innerHeight);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
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
      webglContextLost = true;
      stopGameAnimationLoop();
      const message = 'Os gráficos foram pausados pelo navegador. Tentando recuperar a imagem…';
      if (started) showNotice(message); else setStatus(message);
    });
    gameCanvas.addEventListener('webglcontextrestored', () => {
      webglContextLost = false;
      adaptivePixelRatio = Math.min(devicePixelRatio || 1, renderPixelRatioCap);
      onResize();
      if (started) showNotice('Gráficos recuperados! Pode continuar a aventura.');
      else setStatus('Gráficos recuperados.');
      startGameAnimationLoop();
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
