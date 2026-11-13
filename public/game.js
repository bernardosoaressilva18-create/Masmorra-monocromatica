
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
let currentPhaseVisual = 0, lastSafeZoneTimestamp = 0, appliedInitialServerPosition = false, currentSafeZoneUntil = 0;
const SHARED_PROFILE_KEY='ultimoLegadoSharedProfileV2';
const FREE_LOBBY_SKINS=['default','shadow','ember'];
const CHEST_ONLY_SKINS=['rune','celestial','bloodmoon','frostguard','draconic','voidwalker','verdant'];
let sharedProfileSeed={};try{sharedProfileSeed=JSON.parse(localStorage.getItem(SHARED_PROFILE_KEY)||'{}')||{};}catch{}
const EMPTY_INVENTORY={comum:0,incomum:0,raro:0,'épico':0,'lendário':0};
let latestMapHazards=[],latestChests=[],inventoryData=(()=>{const saved=sharedProfileSeed.inventory&&typeof sharedProfileSeed.inventory==='object'?sharedProfileSeed.inventory:{};return Object.fromEntries(Object.keys(EMPTY_INVENTORY).map(k=>[k,Math.max(0,Math.min(9999,Number(saved[k])||0))]));})(),
lootDrops=(Array.isArray(sharedProfileSeed.lootDrops)?sharedProfileSeed.lootDrops:[]).slice(-100),selectedItemId=sharedProfileSeed.selectedItemId?String(sharedProfileSeed.selectedItemId):null;
let equipmentDamage=Math.max(0,Math.min(18,Number(sharedProfileSeed.equipmentDamage)||0));
let sharedProgress={realm:Math.max(1,Math.min(3,Number(sharedProfileSeed.realm)||1)),phase:Math.max(1,Math.min(5,Number(sharedProfileSeed.phase)||1))};
let levelProgress=(()=>{
 const saved=sharedProfileSeed.levelProgress&&typeof sharedProfileSeed.levelProgress==='object'?sharedProfileSeed.levelProgress:{};
 const upgrades=saved.upgrades&&typeof saved.upgrades==='object'?saved.upgrades:{};
 const level=Math.max(1,Math.min(100,Math.floor(Number(saved.level)||1)));
 const xpNeeded=Math.round(50+Math.max(0,level-1)*16+Math.pow(Math.max(0,level-1),1.16)*2);
 return {level,xp:Math.max(0,Number(saved.xp)||0),xpToNext:xpNeeded,levelPoints:Math.max(0,Math.floor(Number(saved.levelPoints)||0)),upgrades:{...upgrades}};
})();
const LEVEL_UPGRADE_UI=[
 {id:'health',name:'Vida reforçada',desc:'+12 de vida máxima por ponto',max:10},
 {id:'power',name:'Força',desc:'+1 de dano base por ponto',max:10},
 {id:'mana',name:'Reserva de mana',desc:'+15 de mana máxima por ponto',max:10},
 {id:'defense',name:'Defesa',desc:'Reduz 2,5% do dano recebido por ponto',max:8},
 {id:'magic',name:'Magia especial',desc:'+8% de poder mágico por ponto',max:8},
 {id:'attack',name:'Ataque passivo',desc:'+3,5% de velocidade e +0,35 dano por ponto',max:8},
 {id:'recovery',name:'Recuperação',desc:'+1 HP de regeneração a cada 2,5 s por ponto',max:8},
 {id:'item',name:'Item especial',desc:'+10% de cura de itens por ponto',max:8},
 {id:'autoDodge',name:'Esquiva automática',desc:'Desvia para o lado quando um monstro prepara o golpe; recarga de 5,2 s',max:1},
 {id:'xp',name:'Conhecimento',desc:'+5% de XP ganho por ponto',max:8},
 {id:'critical',name:'Acerto crítico',desc:'+2% de chance de crítico por ponto',max:8},
 {id:'movement',name:'Passos velozes',desc:'+3% de velocidade de movimento por ponto',max:6},
 {id:'cooldown',name:'Recarga de habilidade',desc:'Reduz até 20% das recargas especiais',max:8},
 {id:'loot',name:'Sorte do explorador',desc:'+3,5% de chance de encontrar itens por ponto',max:8},
 {id:'manaRegen',name:'Fluxo de mana',desc:'+0,25 mana por segundo por ponto',max:8},
 {id:'range',name:'Alcance aprimorado',desc:'+2,5% de alcance de ataques por ponto',max:8},
 {id:'trapGuard',name:'Resistência a armadilhas',desc:'Reduz 6% do dano de armadilhas por ponto',max:8}
];
let levelUpgradeCardsBuilt=false,lastSavedLevelSignature='';
const world = { width: 36, depth: 190 };

const MAP_ZONE_CENTERS = [-14, -46, -78, -110, -153];
const MAP_ZONE_DEPTHS = [34, 30, 30, 30, 40];
const MAP_ZONE_POLYGONS = [
  [[-2.8,-17],[4.6,-16.4],[9.4,-13.6],[12.8,-8.1],[13.2,-1.8],[11.7,5.4],[7.6,12.1],[2.0,16.7],[-4.6,16.2],[-10.2,11.8],[-13.1,5.4],[-13.4,-2.1],[-10.8,-9.4],[-6.1,-14.7]],
  [[-2.5,-15],[5.0,-14.5],[10.0,-11.0],[13.0,-5.0],[12.3,2.0],[9.8,8.0],[4.8,13.8],[-2.0,15.2],[-8.3,12.0],[-12.7,6.0],[-13.0,-1.0],[-11.0,-8.0],[-6.0,-13.5]],
  [[-3.2,-15],[3.8,-15.2],[9.0,-12.3],[12.6,-7.0],[13.4,-.2],[10.6,6.8],[6.2,12.7],[-.8,15.1],[-7.5,12.4],[-12.0,7.2],[-13.2,.5],[-10.1,-7.8],[-6.3,-13.0]],
  [[-2.1,-15],[4.7,-14.8],[9.5,-11.3],[12.7,-5.7],[11.9,1.5],[12.8,6.4],[7.1,12.8],[.8,15.0],[-6.0,13.7],[-11.6,8.0],[-13.3,1.0],[-11.0,-7.4],[-6.9,-12.9]],
  [[-4.0,-20],[3.5,-19.8],[9.3,-16.2],[13.2,-10.1],[13.8,-2.0],[12.0,6.4],[8.1,13.6],[2.5,19.4],[-4.6,19.5],[-10.3,14.0],[-13.7,6.2],[-14.0,-2.2],[-11.2,-11.0],[-7.0,-17.0]]
];
const MAP_PIT_LAYOUT = MAP_ZONE_CENTERS.map((z, index) => ({
  id: 'pit-' + (index + 1),
  plateX: index % 2 === 0 ? 5.2 : -5.2,
  plateZ: z + 9,
  pitX: index % 2 === 0 ? 5.2 : -5.2,
  pitZ: z + 4
}));
const MAP_PILLAR_COLLIDERS = MAP_ZONE_CENTERS.flatMap((z,index) => {
  const stairX=index%2===0?-8.25:8.25;
  return [
    {x:-10.5,z:z-.7,r:.72},{x:10.5,z:z-.7,r:.72},
    ...[-1,1].flatMap(side=>[-8.1,-10.7].map(offset=>({x:stairX+side*3.05,z:z+offset,r:.34})))
  ];
});
const MAP_SPIKE_HAZARDS = MAP_ZONE_CENTERS.flatMap((z,index) => [
  {id:'spike-'+index+'-L',x:-6.7,z:z-5.5,r:.92,damage:12},
  {id:'spike-'+index+'-R',x:6.7,z:z-5.5,r:.92,damage:12},
  ...[-1,1].map(side=>({id:'pit-spike-'+index+'-'+side,x:(index%2===0?5.2:-5.2)+side*1.36,z:z+4,r:.62,damage:16}))
]);
const UPPER_ROOM_POLYGON=[[-3.6,-7.1],[-3.7,-9.8],[-1.9,-12.0],[.9,-12.5],[3.2,-11.2],[4.35,-8.4],[4.1,-5.8],[2.5,-4.0],[.9,-3.5],[-.9,-3.55],[-2.8,-4.1],[-4.2,-5.7]];
const MAP_WIDTH_SCALE=1.16;
const pressureTrapVisuals = [];
const environmentalHazardVisuals = [];
const mapStairSpecs = [];
const openMapTraps = new Set();
let liveUnderworldPits = [];
const underworldVisuals = new Map();
const dungeonPhaseGroups = [];
function pointInMapPolygon(x, zOffset, polygon, widthScale=1) {
  x /= widthScale;
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const xi=polygon[i][0], yi=polygon[i][1], xj=polygon[j][0], yj=polygon[j][1];
    const intersects=((yi>zOffset)!==(yj>zOffset))&&(x<(xj-xi)*(zOffset-yi)/(yj-yi+1e-9)+xi);
    if(intersects)inside=!inside;
  }
  return inside;
}
function isInsideMapFloor(x,z) {
  for(let i=0;i<MAP_ZONE_CENTERS.length;i++) {
    if(pointInMapPolygon(x,z-MAP_ZONE_CENTERS[i],MAP_ZONE_POLYGONS[i],MAP_WIDTH_SCALE))return true;
  }
  if([-30.5,-62,-94,-130].some((bridgeZ,index)=>Math.abs(z-bridgeZ)<(index===3?4.9:1.65)&&Math.abs(x)<(index===3?4.8:4.65)))return true;
  return mapStairSpecs.some(stair=>pointInMapPolygon(x-stair.x,z-stair.center,UPPER_ROOM_POLYGON))
    ||mapStairSpecs.some(stair=>Math.abs(x-stair.x)<2.1&&z<=stair.startZ&&z>=stair.endZ);
}
function getDungeonFloorHeight(x,z) {
  for(const pit of liveUnderworldPits) {
    if(Math.hypot(x-pit.x,z-pit.z)<4.35)return -6.15;
  }
  for(const pit of MAP_PIT_LAYOUT) {
    if(openMapTraps.has(pit.id)&&Math.hypot(x-pit.pitX,z-pit.pitZ)<1.98)return -2.65;
  }
  for(const stair of mapStairSpecs) {
    if(pointInMapPolygon(x-stair.x,z-stair.center,UPPER_ROOM_POLYGON))return stair.height;
    if(Math.abs(x-stair.x)<1.95&&z<=stair.startZ&&z>=stair.endZ) {
      const progress=THREE.MathUtils.clamp((stair.startZ-z)/(stair.startZ-stair.endZ),0,1);
      return progress*stair.height;
    }
    if(Math.abs(x-stair.x)<2.7&&z>=stair.platformZ-2.2&&z<=stair.platformZ+2.1)return stair.height;
    if(Math.abs(x-stair.x)<3.55&&z<=stair.roomStartZ&&z>=stair.roomEndZ)return stair.height;
  }
  return 0;
}
function syncMapHazardLayout(hazards=[]){
 const list=Array.isArray(hazards)?hazards:[];
 latestMapHazards=list;
 const byId=new Map(list.map(item=>[String(item.id),item]));
 const roots=[['dungeon',environmentGroups.dungeon],['astral',environmentGroups.astral],['eclipse',environmentGroups.eclipse]].filter(([,root])=>!!root);
 for(const hazard of list){
  const id=String(hazard.id),existing=environmentalHazardVisuals.find(v=>v.id===id&&v.realm==='dungeon');
  if(!existing)continue;
  for(const [realm,root] of roots){
   if(realm==='dungeon')continue;
   if(environmentalHazardVisuals.some(v=>v.id===id&&v.realm===realm))continue;
   const clone=existing.group.clone(true);
   clone.name='hazard-'+id+'-'+realm;
   const phaseIndex=MAP_ZONE_CENTERS.reduce((best,center,index)=>Math.abs(center-Number(hazard.z))<Math.abs(MAP_ZONE_CENTERS[best]-Number(hazard.z))?index:best,0);
   const phaseGroup=root.getObjectByName('dungeon-phase-'+(phaseIndex+1))||root;
   phaseGroup.add(clone);
   environmentalHazardVisuals.push({id,type:hazard.type,group:clone,realm});
  }
 }
 for(const visual of environmentalHazardVisuals){
  const live=byId.get(visual.id);if(!live)continue;
  visual.group.position.x=Number(live.x)||0;
  visual.group.position.z=Number(live.z)||0;
  visual.group.position.y=visual.type==='spike'?getDungeonFloorHeight(visual.group.position.x,visual.group.position.z):0;
 }
}
function syncUnderworldVisuals(pits=[]) {
  const open=Array.isArray(pits)?pits.filter(pit=>pit&&pit.open):[];
  liveUnderworldPits=open;
  const keep=new Set();
  for(const pit of open){
    const id=String(pit.id);keep.add(id);
    let group=underworldVisuals.get(id);
    if(!group){
      group=new THREE.Group();group.name='subterranean-chamber-'+id;
      const stone=new THREE.MeshStandardMaterial({color:0x253041,roughness:.94,metalness:.12});
      const trim=new THREE.MeshStandardMaterial({color:0x8a6d4b,roughness:.62,metalness:.32});
      const glow=new THREE.MeshStandardMaterial({color:0x76dfff,emissive:0x1b8fbd,emissiveIntensity:1.15,roughness:.28});
      const floor=new THREE.Mesh(new THREE.BoxGeometry(8.6,.34,8.6),stone);
      floor.position.y=-6.48;group.add(floor);
      const ceiling=new THREE.Mesh(new THREE.BoxGeometry(8.6,.24,8.6),stone);
      ceiling.position.y=-2.05;group.add(ceiling);
      for(const side of [-1,1]){
        const wallX=new THREE.Mesh(new THREE.BoxGeometry(.28,4.2,8.6),stone);
        wallX.position.set(side*4.15,-4.35,0);group.add(wallX);
        const wallZ=new THREE.Mesh(new THREE.BoxGeometry(8.6,4.2,.28),stone);
        wallZ.position.set(0,-4.35,side*4.15);group.add(wallZ);
        const pillar=new THREE.Mesh(new THREE.BoxGeometry(.42,4.1,.42),trim);
        pillar.position.set(side*3.55,-4.35,side*3.55);group.add(pillar);
        const torch=new THREE.Mesh(new THREE.OctahedronGeometry(.22,1),glow);
        torch.position.set(side*3.55,-2.15,side*3.55);group.add(torch);
      }
      const sigil=new THREE.Mesh(new THREE.RingGeometry(1.15,1.28,36),glow);
      sigil.rotation.x=-Math.PI/2;sigil.position.y=-6.27;group.add(sigil);
      const arch=new THREE.Mesh(new THREE.TorusGeometry(1.28,.07,8,36),trim);
      arch.position.set(0,-2.85,-4.18);group.add(arch);
      scene.add(group);underworldVisuals.set(id,group);
    }
    group.position.set(Number(pit.x)||0,0,Number(pit.z)||0);
    group.visible=true;
  }
  for(const [id,group] of underworldVisuals){
    if(!keep.has(id)){scene.remove(group);disposeObject3D(group);underworldVisuals.delete(id);}
  }
}
function syncMapTrapVisuals(openTraps=[]) {
  openMapTraps.clear();
  for(const id of Array.isArray(openTraps)?openTraps:[])openMapTraps.add(String(id));
  for(const item of pressureTrapVisuals) {
    const open=openMapTraps.has(item.id);
    item.cover.visible=!open;
    item.plate.position.y=open?.075:.17;
    item.plate.material.emissiveIntensity=open?.05:.5;
    item.plate.material.color.setHex(open?0x303746:0x8b7954);
  }
}
const isMobileDevice = matchMedia('(pointer: coarse)').matches;

function clampSetting(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
let storedGameSettings = {};
try { storedGameSettings = JSON.parse(localStorage.getItem('mmGameSettings') || '{}') || {}; } catch {}
const previousCameraControlsVersion = Number(storedGameSettings.cameraControlsVersion) || 0;
const gameSettings = {
  sensitivity: clampSetting(storedGameSettings.sensitivity, 0.5, 3, 1.2),
  verticalSensitivity: clampSetting(previousCameraControlsVersion >= 4 ? storedGameSettings.verticalSensitivity : 0.45, 0.25, 1.2, 0.45),
  shiftLock: Number(storedGameSettings.cameraControlsVersion) >= 2 && storedGameSettings.shiftLock === true,
  cameraControlsVersion: 4,
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
const staticDungeonColliders = [
  ...MAP_PILLAR_COLLIDERS,
  ...[-30,-62,-94,-126].flatMap(z=>[{x:-3.15,z,r:.30},{x:3.15,z,r:.30}]),
  ...MAP_ZONE_CENTERS.flatMap((center,index)=>{
    const stairX=index%2===0?-8.25:8.25;
    return [
      ...[-1.78,1.78].flatMap(side=>Array.from({length:8},(_,n)=>({x:stairX+side,z:center+1-n,r:.19}))),
      ...[-3.62,3.62].flatMap(side=>Array.from({length:9},(_,n)=>({x:stairX+side,z:center-9-n*1.18,r:.22}))),
      ...Array.from({length:9},(_,n)=>({x:stairX-3.25+n*.81,z:center-20.5,r:.22}))
    ];
  })
];
function isChestClaimedByLocal(chest){
  return Array.isArray(chest?.openedBy)
    ? chest.openedBy.some(id=>String(id)===String(playerId))
    : !!chest?.opened;
}
function isDungeonPositionBlocked(x,z){
  const playerRadius=.43;
  if(offlineMode&&offlineState?.started){
    const phase=Math.max(1,Math.min(5,Number(offlineState.phase)||1));
    const gateZ=phase<5?-(30+(phase-1)*32):-168;
    const enemiesAlive=offlineLivingMonsters().length>0||!!offlineState.boss?.alive;
    if(enemiesAlive&&Math.abs(z-gateZ)<.62&&Math.abs(x)<13.2)return true;
  }
  // O desenho e as hitboxes dos pilares/portais são iguais nos três reinos.
  for (const obstacle of staticDungeonColliders) {
    if (Math.hypot(x - obstacle.x, z - obstacle.z) < playerRadius + obstacle.r) return true;
  }
  for (const chest of latestChests || []) {
    if (isChestClaimedByLocal(chest)) continue;
    if (Math.hypot(x - chest.x, z - chest.z) < playerRadius + 0.62) return true;
  }
  return false;
}
function resolveDungeonMovement(fromX, fromZ, nextX, nextZ) {
  const x = THREE.MathUtils.clamp(nextX, -15.6, 15.6);
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
  scene.fog = new THREE.FogExp2(0x1b2d3d, isMobileDevice ? .0017 : .00205);

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
  const ambientFill = new THREE.AmbientLight(0xb5cce2, isMobileDevice ? 1.18 : 0.58);
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
  partitionDungeonPhaseGroups(environmentGroups.dungeon);
  partitionDungeonPhaseGroups(environmentGroups.astral);
  partitionDungeonPhaseGroups(environmentGroups.eclipse);
  updateDungeonPhaseVisibility(currentPhaseVisual||1);
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
  dayNightSunLight.intensity = (isMobileDevice ? 0.70 : 0.34) + daylight * (isMobileDevice ? 1.35 : 1.22);
  dayNightSunLight.color.setRGB(
    0.42 + daylight * 0.58,
    0.52 + daylight * 0.42,
    0.78 - daylight * 0.12
  );
  dayNightHemisphereLight.intensity = (isMobileDevice ? 1.78 : 1.02) + daylight * (isMobileDevice ? 1.32 : 1.38);
  dayNightHemisphereLight.color.setRGB(0.34 + daylight * 0.48, 0.39 + daylight * 0.42, 0.54 + daylight * 0.38);
  dayNightHemisphereLight.groundColor.setRGB(0.10 + daylight * 0.14, 0.105 + daylight * 0.13, 0.15 + daylight * 0.10);
  if (dayNightMoonLight) dayNightMoonLight.intensity = isMobileDevice ? 0 : 0.08 + night * 0.82;

  const skyR = (isMobileDevice ? 0.075 : 0.055) + daylight * (0.10 - realmTint * 0.05);
  const skyG = (isMobileDevice ? 0.095 : 0.075) + daylight * (0.16 - realmTint * 0.08);
  const skyB = (isMobileDevice ? 0.15 : 0.12) + daylight * (0.25 + realmTint * 0.14);
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


function addVoidBackdrop(parent,baseColor=0x101827,rockColor=0x39485b){
 const base=new THREE.Mesh(new THREE.PlaneGeometry(118,238),new THREE.MeshStandardMaterial({color:baseColor,roughness:1,metalness:.04,emissive:baseColor,emissiveIntensity:.12,side:THREE.DoubleSide}));
 base.rotation.x=-Math.PI/2;base.position.set(0,-8,-84);base.name='deep-abyss-floor';parent.add(base);
 const count=isMobileDevice?38:76,geometry=new THREE.DodecahedronGeometry(.72,0);
 const material=new THREE.MeshStandardMaterial({color:rockColor,roughness:.97,metalness:.05});
 const rocks=new THREE.InstancedMesh(geometry,material,count),dummy=new THREE.Object3D();
 for(let i=0;i<count;i++){
  const side=i%2===0?-1:1;
  dummy.position.set(side*(15+Math.random()*28),-4.2-Math.random()*3,-180+Math.random()*196);
  dummy.rotation.set(Math.random()*.5,Math.random()*Math.PI,Math.random()*.5);
  const scale=.75+Math.random()*1.7;dummy.scale.set(scale,scale*(.55+Math.random()*.5),scale*(.8+Math.random()*.55));
  dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
 }
 rocks.instanceMatrix.needsUpdate=true;rocks.name='floating-abyss-rocks';parent.add(rocks);
 const mistMaterial=new THREE.MeshBasicMaterial({color:0x7899b7,transparent:true,opacity:.075,depthWrite:false,side:THREE.DoubleSide});
 const mistCount=isMobileDevice?10:18,mist=new THREE.InstancedMesh(new THREE.CircleGeometry(1,10),mistMaterial,mistCount);
 for(let i=0;i<mistCount;i++){
  const side=i%2===0?-1:1;
  dummy.position.set(side*(14+Math.random()*24),-6.4,-180+Math.random()*194);
  dummy.rotation.set(-Math.PI/2,0,Math.random()*Math.PI);
  const scale=2+Math.random()*4;dummy.scale.set(scale,scale*.7,1);dummy.updateMatrix();mist.setMatrixAt(i,dummy.matrix);
 }
 mist.instanceMatrix.needsUpdate=true;mist.name='abyss-mist-clouds';parent.add(mist);
}
function addOrganicZoneFloor(center, index, sideMaterial, topMaterial, height = -.5) {
  const points=MAP_ZONE_POLYGONS[index];
  const shape=new THREE.Shape();
  shape.moveTo(points[0][0]*MAP_WIDTH_SCALE,-points[0][1]);
  for(let i=1;i<points.length;i++)shape.lineTo(points[i][0]*MAP_WIDTH_SCALE,-points[i][1]);
  shape.closePath();
  const pit=MAP_PIT_LAYOUT[index];
  const hole=new THREE.Path();
  const cx=pit.pitX, cy=-(pit.pitZ-center), radius=2.08;
  hole.absellipse(cx,cy,radius,radius,0,Math.PI*2,false,0);
  shape.holes.push(hole);
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.5,bevelEnabled:false,steps:1,curveSegments:12});
  const mesh=new THREE.Mesh(geometry,[sideMaterial,topMaterial]);
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(0,height,center);
  if(!isMobileDevice){mesh.receiveShadow=true;mesh.castShadow=true;}
  activeEnvironmentGroup.add(mesh);
  return mesh;
}
function addCliffEdgeDetails(parent){
 const geometry=new THREE.DodecahedronGeometry(1,0);
 const material=new THREE.MeshStandardMaterial({color:0x343c4c,roughness:.98,metalness:.04});
 const count=isMobileDevice?(gameSettings.graphicsQuality==='low'?70:95):120;
 const cliffs=new THREE.InstancedMesh(geometry,material,count);
 const dummy=new THREE.Object3D();
 let index=0;
 for(let zone=0;zone<MAP_ZONE_CENTERS.length;zone++){
  const center=MAP_ZONE_CENTERS[zone],polygon=MAP_ZONE_POLYGONS[zone];
  for(let point=0;point<polygon.length&&index<count;point++){
   const [x,offset]=polygon[point],next=polygon[(point+1)%polygon.length];
   const midX=(x+next[0])*.5,midZ=(offset+next[1])*.5;
   for(const [px,pz,variant] of [[x,offset,0],[midX,midZ,1]]){
    if(index>=count)break;
    dummy.position.set(px*MAP_WIDTH_SCALE,-.88-(variant*.18),center+pz);
    dummy.rotation.set((zone+variant)*.17,point*.42,(point%3-1)*.18);
    const size=.8+(point%4)*.18;
    dummy.scale.set(1.2*size,.72*size,1.0*size);
    dummy.updateMatrix();cliffs.setMatrixAt(index++,dummy.matrix);
   }
  }
 }
 cliffs.count=index;cliffs.instanceMatrix.needsUpdate=true;
 cliffs.name='organic-cliff-edge-rocks';parent.add(cliffs);
 const crystalMaterial=new THREE.MeshStandardMaterial({color:0x8cd9ee,emissive:0x276c9c,emissiveIntensity:.55,roughness:.3,metalness:.18});
 const crystalCount=isMobileDevice?12:20;
 const crystals=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.25,0),crystalMaterial,crystalCount);
 let crystalIndex=0;
 for(let z=0;z<MAP_ZONE_CENTERS.length&&crystalIndex<crystalCount;z++){
  const center=MAP_ZONE_CENTERS[z],poly=MAP_ZONE_POLYGONS[z];
  for(let n=0;n<poly.length&&crystalIndex<crystalCount;n+=2){
   const p=poly[n],side=p[0]<0?-1:1;
   dummy.position.set(p[0]*.91*MAP_WIDTH_SCALE,-.06,center+p[1]*.91);
   dummy.rotation.set(.2,n*.4,.15*side);
   dummy.scale.set(.45,.9+(n%3)*.25,.45);dummy.updateMatrix();
   crystals.setMatrixAt(crystalIndex++,dummy.matrix);
  }
 }
 crystals.count=crystalIndex;crystals.instanceMatrix.needsUpdate=true;
 crystals.name='edge-crystal-clusters';parent.add(crystals);
}
function addAdventureMapFeatures(parent, accentColors, realmKey, registerHeight=false) {
  const stone=new THREE.MeshStandardMaterial({color:0x555f70,roughness:.91,metalness:.12});
  const stoneDark=new THREE.MeshStandardMaterial({color:0x202b3b,roughness:.98});
  const gold=new THREE.MeshStandardMaterial({color:0xc6a267,metalness:.58,roughness:.34});
  const spikeMat=new THREE.MeshStandardMaterial({color:0xadb7c7,metalness:.62,roughness:.3});
  const hazardGlow=new THREE.MeshStandardMaterial({color:accentColors[0],emissive:accentColors[0],emissiveIntensity:.95,metalness:.28,roughness:.32});
  const plateMat=new THREE.MeshStandardMaterial({color:0x8b7954,metalness:.62,roughness:.34,emissive:accentColors[0],emissiveIntensity:.35});
  const pitWallMat=new THREE.MeshStandardMaterial({color:0x101622,roughness:1});
  for(let i=0;i<MAP_ZONE_CENTERS.length;i++) {
    const center=MAP_ZONE_CENTERS[i], pit=MAP_PIT_LAYOUT[i];
    for(const side of [-1,1]) {
      const x=side*10.5;
      const pillar=new THREE.Group();
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.42,.62,3.45,7),stone);shaft.position.y=1.72;pillar.add(shaft);
      const foot=new THREE.Mesh(new THREE.CylinderGeometry(.72,.76,.3,7),stoneDark);foot.position.y=.16;pillar.add(foot);
      const capital=new THREE.Mesh(new THREE.CylinderGeometry(.68,.48,.34,7),gold);capital.position.y=3.48;pillar.add(capital);
      const rune=new THREE.Mesh(new THREE.BoxGeometry(.08,1.2,.045),hazardGlow);rune.position.set(0,1.8,-.43);pillar.add(rune);
      pillar.position.set(x,0,center-.7);parent.add(pillar);
    }
    // Pedras e espinhos de chão: legíveis de longe e com hitboxes no servidor.
    for(const spike of MAP_SPIKE_HAZARDS.filter(h=>h.id.startsWith('spike-'+i+'-'))) {
      const trapGroup=new THREE.Group();trapGroup.name='hazard-'+spike.id;
      trapGroup.position.set(spike.x,0,spike.z);
      const bed=new THREE.Mesh(new THREE.BoxGeometry(2.25,.16,1.8),stoneDark);bed.position.set(0,.06,0);trapGroup.add(bed);
      for(let k=-1;k<=1;k++) {
        const thorn=new THREE.Mesh(new THREE.ConeGeometry(.22,.82,5),spikeMat);
        thorn.position.set(k*.58,.52,(k%2)*.18);thorn.rotation.z=(k-1)*-.08;trapGroup.add(thorn);
        const base=new THREE.Mesh(new THREE.CylinderGeometry(.29,.34,.12,5),gold);base.position.set(thorn.position.x,.12,thorn.position.z);trapGroup.add(base);
      }
      const warning=new THREE.Mesh(new THREE.RingGeometry(.82,1.0,20),hazardGlow);warning.rotation.x=-Math.PI/2;warning.position.set(0,.16,0);trapGroup.add(warning);
      parent.add(trapGroup);
      environmentalHazardVisuals.push({id:spike.id,type:'spike',group:trapGroup,realm:'dungeon'});
    }
    // Três perigos ambientais extras por região, com avisos visuais claros no chão.
    const environmentalHazards=[
      {id:'miasma-'+i,type:'miasma',x:i%2===0?-8.2:8.2,z:center+2.5,r:1.35,color:0x77d65c},
      {id:'rune-surge-'+i,type:'rune',x:i%2===0?8.2:-8.2,z:center-11,r:1.15,color:accentColors[i%accentColors.length]},
      {id:'crumble-'+i,type:'crumble',x:i%2===0?-5.7:5.7,z:center-13,r:1.25,color:0xe6a65d}
    ];
    for(const field of environmentalHazards){
      const fieldGroup=new THREE.Group();fieldGroup.name='hazard-'+field.id;
      fieldGroup.position.set(field.x,0,field.z);parent.add(fieldGroup);
      environmentalHazardVisuals.push({id:field.id,type:field.type,group:fieldGroup,realm:'dungeon'});
      const disk=new THREE.Mesh(new THREE.CircleGeometry(field.r,20),new THREE.MeshBasicMaterial({color:field.color,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));
      disk.rotation.x=-Math.PI/2;disk.position.y=.035;fieldGroup.add(disk);
      const warning=new THREE.Mesh(new THREE.TorusGeometry(field.r*.88,.055,6,28),new THREE.MeshStandardMaterial({color:field.color,emissive:field.color,emissiveIntensity:.95,transparent:true,opacity:.94,roughness:.32,metalness:.25}));
      warning.rotation.x=Math.PI/2;warning.position.y=.11;fieldGroup.add(warning);
      if(field.type==='miasma'){
        for(let puff=0;puff<3;puff++){
          const mote=new THREE.Mesh(new THREE.IcosahedronGeometry(.14+(puff%3)*.035,0),new THREE.MeshBasicMaterial({color:field.color,transparent:true,opacity:.56}));
          mote.position.set(Math.cos(puff*Math.PI*2/7)*(.45+(puff%2)*.42),.28+(puff%3)*.16,Math.sin(puff*Math.PI*2/7)*(.45+(puff%2)*.42));fieldGroup.add(mote);
        }
        const core=new THREE.Mesh(new THREE.TorusKnotGeometry(.33,.055,36,6,2,3),new THREE.MeshStandardMaterial({color:0xafff81,emissive:0x4f9d39,emissiveIntensity:.8,transparent:true,opacity:.72}));
        core.position.y=.22;fieldGroup.add(core);
      }else if(field.type==='rune'){
        for(let rune=0;rune<3;rune++){const mark=new THREE.Mesh(new THREE.BoxGeometry(.075,.035,.72),gold);mark.position.y=.09;mark.rotation.y=rune*Math.PI/3;fieldGroup.add(mark);}
        const core=new THREE.Mesh(new THREE.OctahedronGeometry(.23,0),new THREE.MeshStandardMaterial({color:field.color,emissive:field.color,emissiveIntensity:1.35}));
        core.position.y=.23;fieldGroup.add(core);
      }else{
        for(let crack=0;crack<3;crack++){const line=new THREE.Mesh(new THREE.BoxGeometry(.07,.035,field.r*1.55),stoneDark);line.position.y=.09;line.rotation.y=crack*Math.PI/5;fieldGroup.add(line);}
        const teeth=new THREE.Mesh(new THREE.ConeGeometry(.24,.54,5),hazardGlow);teeth.position.y=.32;fieldGroup.add(teeth);
      }
    }
    // Boca do poço e fundo. A tampa esconde o buraco até alguém pisar na placa.
    const pitGroup=new THREE.Group();
    const rim=new THREE.Mesh(new THREE.TorusGeometry(2.16,.14,7,28),gold);rim.rotation.x=Math.PI/2;rim.position.y=.02;pitGroup.add(rim);
    const inner=new THREE.Mesh(new THREE.CylinderGeometry(2.02,2.28,3.15,16,1,true),pitWallMat);inner.position.y=-1.52;pitGroup.add(inner);
    const bottom=new THREE.Mesh(new THREE.CircleGeometry(2.04,24),stoneDark);bottom.rotation.x=-Math.PI/2;bottom.position.y=-3.12;pitGroup.add(bottom);
    for(const side of [-1,1]) {
      const thorn=new THREE.Mesh(new THREE.ConeGeometry(.31,.95,5),spikeMat);
      thorn.position.set(side*1.36,-2.58,0);thorn.rotation.z=side*.12;pitGroup.add(thorn);
      const cross=new THREE.Mesh(new THREE.ConeGeometry(.31,.95,5),spikeMat);
      cross.position.set(0,-2.58,side*1.36);cross.rotation.x=Math.PI/2+side*.12;pitGroup.add(cross);
    }
    pitGroup.position.set(pit.pitX,0,pit.pitZ);parent.add(pitGroup);
    const cover=new THREE.Mesh(new THREE.CylinderGeometry(2.02,2.02,.14,16),stone);
    cover.position.set(pit.pitX,.02,pit.pitZ);parent.add(cover);
    const coverRune=new THREE.Mesh(new THREE.TorusGeometry(1.35,.055,6,24),hazardGlow);coverRune.rotation.x=Math.PI/2;coverRune.position.set(pit.pitX,.11,pit.pitZ);parent.add(coverRune);
    const plateBase=new THREE.Mesh(new THREE.BoxGeometry(2.15,.16,1.85),stoneDark);plateBase.position.set(pit.plateX,.04,pit.plateZ);parent.add(plateBase);
    const plate=new THREE.Mesh(new THREE.BoxGeometry(1.72,.13,1.42),plateMat);plate.position.set(pit.plateX,.17,pit.plateZ);parent.add(plate);
    const plateRune=new THREE.Mesh(new THREE.RingGeometry(.38,.49,6),hazardGlow);plateRune.rotation.x=-Math.PI/2;plateRune.position.set(pit.plateX,.245,pit.plateZ);parent.add(plateRune);
    const plateMark=new THREE.Mesh(new THREE.BoxGeometry(.08,.025,1.05),gold);plateMark.position.set(pit.plateX,.25,pit.plateZ);parent.add(plateMark);
    pressureTrapVisuals.push({id:pit.id,cover,plate,realm:realmKey});
    // Escadaria lateral com oito degraus, patamar elevado e corrimãos.
    const stairX=i%2===0?-8.25:8.25;
    const stairStart=center+1.5,stairEnd=center-6.5,height=2.8;
    const stairMat=new THREE.MeshStandardMaterial({color:accentColors[i%accentColors.length],roughness:.76,metalness:.22});
    for(let step=0;step<8;step++) {
      const level=(step+1)*height/8;
      const tread=new THREE.Mesh(new THREE.BoxGeometry(3.35,.24,1.02),stone);
      tread.position.set(stairX,level-.12,stairStart-step*1.0);parent.add(tread);
      const riser=new THREE.Mesh(new THREE.BoxGeometry(3.35,level, .12),stoneDark);
      riser.position.set(stairX,level/2,stairStart-step*1.0-.45);parent.add(riser);
      const edge=new THREE.Mesh(new THREE.BoxGeometry(3.25,.035,.07),gold);
      edge.position.set(stairX,level+.01,stairStart-step*1.0-.48);parent.add(edge);
    }
    const platform=new THREE.Mesh(new THREE.BoxGeometry(4.45,.30,3.6),stoneDark);
    platform.position.set(stairX,height-.15,center-7.6);parent.add(platform);
    // Sala superior pentagonal irregular: piso fechado, entrada pela escada, paredes, teto e relevos.
    const roomShape=new THREE.Shape();
    roomShape.moveTo(UPPER_ROOM_POLYGON[0][0],-UPPER_ROOM_POLYGON[0][1]);
    for(let point=1;point<UPPER_ROOM_POLYGON.length;point++)roomShape.lineTo(UPPER_ROOM_POLYGON[point][0],-UPPER_ROOM_POLYGON[point][1]);
    roomShape.closePath();
    const roomFloorGeo=new THREE.ExtrudeGeometry(roomShape,{depth:.34,bevelEnabled:false,steps:1,curveSegments:8});
    const roomFloor=new THREE.Mesh(roomFloorGeo,stoneDark);
    roomFloor.rotation.x=-Math.PI/2;roomFloor.position.set(stairX,height-.34,center);parent.add(roomFloor);
    const upperWallMat=new THREE.MeshStandardMaterial({color:accentColors[i%accentColors.length],roughness:.84,metalness:.16});
    const wallCapMat=new THREE.MeshStandardMaterial({color:0x9b8054,roughness:.48,metalness:.38});
    for(let edge=0;edge<UPPER_ROOM_POLYGON.length;edge++){
      const a=UPPER_ROOM_POLYGON[edge],b=UPPER_ROOM_POLYGON[(edge+1)%UPPER_ROOM_POLYGON.length];
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      const midX=(a[0]+b[0])*.5,midZ=(a[1]+b[1])*.5;
      if(Math.abs(midX)<1.35&&midZ>-4.5)continue;
      const wall=new THREE.Mesh(new THREE.BoxGeometry(length,2.55,.22),upperWallMat);
      wall.position.set(stairX+midX,height+1.26,center+midZ);
      wall.rotation.y=Math.atan2(-dz,dx);parent.add(wall);
      const cap=new THREE.Mesh(new THREE.BoxGeometry(length,.16,.34),wallCapMat);
      cap.position.set(stairX+midX,height+2.56,center+midZ);
      cap.rotation.y=Math.atan2(-dz,dx);parent.add(cap);
    }
    for(const side of [-1,1]){
      for(const zOffset of [-8.1,-10.7]){
        const column=new THREE.Group();
        const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.25,.34,2.7,7),stone);shaft.position.y=1.35;column.add(shaft);
        const base=new THREE.Mesh(new THREE.CylinderGeometry(.43,.48,.22,7),gold);base.position.y=.12;column.add(base);
        const capital=new THREE.Mesh(new THREE.CylinderGeometry(.40,.28,.22,7),gold);capital.position.y=2.64;column.add(capital);
        column.position.set(stairX+side*3.05,height,center+zOffset);parent.add(column);
      }
    }
    for(let relief=0;relief<3;relief++){
      const slab=new THREE.Mesh(new THREE.DodecahedronGeometry(.52,0),stone);
      slab.position.set(stairX+(relief-1)*1.05,height+.10,center-11.35+(relief%2)*.7);
      slab.scale.set(1.25,.28,.72);slab.rotation.y=relief*.62;parent.add(slab);
    }
    const upperRoof=new THREE.Mesh(new THREE.SphereGeometry(1,22,12,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:0x26394a,roughness:.82,metalness:.10,transparent:true,opacity:.86,side:THREE.BackSide,depthWrite:false}));
    upperRoof.scale.set(4.55,2.85,4.95);upperRoof.position.set(stairX,height+1.15,center-8.1);parent.add(upperRoof);
    const upperRune=new THREE.Mesh(new THREE.RingGeometry(.9,1.05,28),hazardGlow);
    upperRune.rotation.x=-Math.PI/2;upperRune.position.set(stairX,height+.012,center-8.2);parent.add(upperRune);
    for(const side of [-1,1]){
      const torch=new THREE.Mesh(new THREE.IcosahedronGeometry(.17,1),hazardGlow);
      torch.position.set(stairX+side*3.55,height+2.05,center-8.7);parent.add(torch);
    }
    if(registerHeight)mapStairSpecs.push({x:stairX,center,startZ:stairStart,endZ:stairEnd,platformZ:center-7.6,height});
    // Arcos laterais menores diferenciam os cinco trechos do mapa.
    const marker=new THREE.Mesh(new THREE.OctahedronGeometry(.48,0),hazardGlow);
    marker.position.set(stairX,height+.5,center-8.25);marker.scale.set(.75,1.55,.75);parent.add(marker);
  }
}

function addBiomeDetailInstances(parent,palette,realmKey=1){
 // Densidade adaptativa: mais cenário em PC, sem sobrecarregar celulares de entrada.
 const perZone=isMobileDevice
  ?(gameSettings.graphicsQuality==='low'?8:gameSettings.graphicsQuality==='high'?18:12)
  :(gameSettings.graphicsQuality==='low'?24:gameSettings.graphicsQuality==='high'?56:40);
 const capacity=perZone+1;
 const materials=[
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.96,metalness:.06,}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.92,metalness:.08,}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.3,metalness:.22,emissive:0x151a22,emissiveIntensity:.34,}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.7,metalness:.28,transparent:true,opacity:.72,side:THREE.DoubleSide,depthWrite:false}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.96,metalness:.08}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.86,metalness:.22}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.82,metalness:.04,emissive:0x101c10,emissiveIntensity:.22}),
  new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,metalness:.10})
 ];
 const makeBatches=()=>[
  new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.27,0),materials[0],capacity),
  new THREE.InstancedMesh(new THREE.ConeGeometry(.16,.62,5),materials[1],capacity),
  new THREE.InstancedMesh(new THREE.OctahedronGeometry(.21,0),materials[2],capacity),
  new THREE.InstancedMesh(new THREE.TorusGeometry(.17,.018,5,12),materials[3],capacity),
  new THREE.InstancedMesh(new THREE.BoxGeometry(.86,.34,.52),materials[4],capacity),
  new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.48,0),materials[5],capacity),
  new THREE.InstancedMesh(new THREE.ConeGeometry(.23,.82,6),materials[6],capacity),
  new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.30,1),materials[7],capacity)
 ];
 const names=['biome-stone-scatter','biome-root-and-spire-scatter','biome-crystal-scatter','biome-rune-inlays','biome-ruin-slabs','biome-broken-monoliths','biome-glow-flora','biome-fallen-roots'];
 const dummy=new THREE.Object3D();
 let totalInstances=0;
 const zoneBatchCounts=[];
 const fract=value=>value-Math.floor(value);
 for(let zone=0;zone<MAP_ZONE_CENTERS.length;zone++){
  const batches=makeBatches(),counts=[0,0,0,0,0,0,0,0];
  const center=MAP_ZONE_CENTERS[zone],poly=MAP_ZONE_POLYGONS[zone],accent=new THREE.Color(palette[zone%palette.length]);
  for(let n=0;n<perZone;n++){
   let point=null;
   for(let attempt=0;attempt<36&&!point;attempt++){
    const x=(Math.random()*2-1)*14.8;
    const offset=(Math.random()*2-1)*(zone===4?18.7:14.2);
    if(!pointInMapPolygon(x,offset,poly))continue;
    if(Math.abs(x)<4.65)continue;
    const z=center+offset,pit=MAP_PIT_LAYOUT[zone];
    if(Math.hypot(x-pit.pitX,z-pit.pitZ)<3.25||Math.hypot(x-pit.plateX,z-pit.plateZ)<2.5)continue;
    if(Math.abs(Math.abs(x)-10.5)<1.6&&Math.abs(z-(center-.7))<1.7)continue;
    const stairX=zone%2===0?-8.25:8.25;
    if(Math.abs(x-stairX)<2.65&&z<=center+1.8&&z>=center-10.8)continue;
    if(MAP_SPIKE_HAZARDS.some(spike=>Math.hypot(x-spike.x,z-spike.z)<1.75))continue;
    point={x,z,offset};
   }
   if(!point)continue;
   const {x,z}=point;
   const color=accent.clone().multiplyScalar(.62+.28*fract(Math.sin((n+zone*13)*4.13)*93.71));
   // Detritos baixos, colocados fora do corredor de combate para dar escala às plataformas.
   dummy.position.set(x,.07,z);dummy.rotation.set(fract(Math.sin(n*3.1+zone)*9)*.22,fract(Math.sin(n*7.7+zone)*17)*Math.PI,fract(Math.sin(n*5.3+zone)*11)*.16);
   const rockScale=.62+fract(Math.sin(n*12.4+zone)*31)*.95;
   dummy.scale.set(rockScale*1.2,rockScale*(.48+fract(Math.sin(n*6.2+zone)*7)*.42),rockScale);
   dummy.updateMatrix();batches[0].setMatrixAt(counts[0],dummy.matrix);batches[0].setColorAt(counts[0],color);counts[0]++;
   // Raízes, ruínas ou espinhos decorativos baixos; não ocupam a rota nem as hitboxes de combate.
   dummy.position.set(x*.985,.29,z+.22);dummy.rotation.set(.10,fract(Math.sin(n*9.9+zone)*13)*Math.PI,fract(Math.sin(n*2.7+zone)*19)*.24);
   const rootScale=.62+fract(Math.sin(n*8.4+zone)*23)*.78;
   dummy.scale.set(rootScale,rootScale*(.78+zone*.035),rootScale);
   dummy.updateMatrix();batches[1].setMatrixAt(counts[1],dummy.matrix);batches[1].setColorAt(counts[1],color.clone().multiplyScalar(zone===2?1.1:.74));counts[1]++;
   // Cristais pequenos e brilhantes, com variação de altura e cor por bioma.
   dummy.position.set(x*.96,.22+fract(Math.sin(n*2.6+zone)*11)*.36,z-.28);dummy.rotation.set(fract(Math.sin(n*5.1+zone)*9),fract(Math.sin(n*3.4+zone)*15)*Math.PI,fract(Math.sin(n*9.1+zone)*7)*.32);
   const shardScale=.56+fract(Math.sin(n*11.7+zone)*27)*.88;
   dummy.scale.set(shardScale*.72,shardScale*(1.05+zone*.05),shardScale*.68);
   dummy.updateMatrix();batches[2].setMatrixAt(counts[2],dummy.matrix);batches[2].setColorAt(counts[2],accent.clone().multiplyScalar(.86+fract(Math.sin(n*7+zone)*5)*.3));counts[2]++;
   // Runas planas ajudam a ler a superfície sem desenhar símbolos no meio do caminho.
   dummy.position.set(x*.94,.025,z+.55);dummy.rotation.set(-Math.PI/2,0,fract(Math.sin(n*6.3+zone)*21)*Math.PI);
   const runeScale=.72+fract(Math.sin(n*4.7+zone)*37)*.8;
   dummy.scale.set(runeScale,runeScale*.7,1);dummy.updateMatrix();batches[3].setMatrixAt(counts[3],dummy.matrix);batches[3].setColorAt(counts[3],accent);counts[3]++;
   // Lajes quebradas com orientação irregular para quebrar a repetição dos pisos.
   dummy.position.set(x*.99,.18,z-.48);dummy.rotation.set(.02,fract(Math.sin(n*7.1+zone)*13)*Math.PI,fract(Math.sin(n*2.1+zone)*9)*.12);
   const slabScale=.48+fract(Math.sin(n*13.1+zone)*17)*.86;dummy.scale.set(slabScale,slabScale,slabScale);
   dummy.updateMatrix();batches[4].setMatrixAt(counts[4],dummy.matrix);batches[4].setColorAt(counts[4],color.clone().multiplyScalar(.72));counts[4]++;
   // Monólitos partidos nas laterais, sem invadir a faixa de combate central.
   dummy.position.set(x*.985,.78,z+.42);dummy.rotation.set(fract(Math.sin(n*4.2+zone)*7)*.12,fract(Math.sin(n*8.1+zone)*11)*Math.PI,fract(Math.sin(n*3.7+zone)*13)*.08);
   const monolithScale=.48+fract(Math.sin(n*9.3+zone)*19)*.68;dummy.scale.set(monolithScale,monolithScale*(1.1+zone*.04),monolithScale);
   dummy.updateMatrix();batches[5].setMatrixAt(counts[5],dummy.matrix);batches[5].setColorAt(counts[5],accent.clone().multiplyScalar(.62+zone*.06));counts[5]++;
   // Flora luminosa de cada bioma: tons mudam por reino e região.
   dummy.position.set(x*.96,.38,z-.66);dummy.rotation.set(0,fract(Math.sin(n*5.8+zone)*17)*Math.PI,fract(Math.sin(n*6.4+zone)*13)*.1);
   const floraScale=.58+fract(Math.sin(n*10.2+zone)*23)*.9;dummy.scale.set(floraScale,floraScale*(.75+zone*.08),floraScale);
   dummy.updateMatrix();batches[6].setMatrixAt(counts[6],dummy.matrix);batches[6].setColorAt(counts[6],accent.clone().multiplyScalar(1.05));counts[6]++;
   // Raízes e troncos baixos criam silhuetas diferentes sem bloquear o jogador.
   dummy.position.set(x*.94,.16,z+.82);dummy.rotation.set(fract(Math.sin(n*2.9+zone)*11)*.18,fract(Math.sin(n*7.2+zone)*19)*Math.PI,Math.PI/2+fract(Math.sin(n*3.8+zone)*7)*.16);
   const rootLogScale=.52+fract(Math.sin(n*12.8+zone)*29)*.72;dummy.scale.set(rootLogScale,rootLogScale,rootLogScale);
   dummy.updateMatrix();batches[7].setMatrixAt(counts[7],dummy.matrix);batches[7].setColorAt(counts[7],color.clone().multiplyScalar(.82));counts[7]++;
  }
  // Um marco monumental por zona serve como ponto de referência visual e orientação.
  const landmarkX=zone%2===0?-8.55:8.55,landmarkZ=center+11.1;
  dummy.position.set(landmarkX,1.18,landmarkZ);dummy.rotation.set(0,zone*.47,0);dummy.scale.set(1.65,2.75,1.65);
  dummy.updateMatrix();batches[5].setMatrixAt(counts[5],dummy.matrix);batches[5].setColorAt(counts[5],accent.clone().multiplyScalar(.88));counts[5]++;
  dummy.position.set(landmarkX,3.12,landmarkZ);dummy.rotation.set(.12,zone*.7,.08);dummy.scale.set(1.48,1.9,1.48);
  dummy.updateMatrix();batches[2].setMatrixAt(counts[2],dummy.matrix);batches[2].setColorAt(counts[2],accent.clone().multiplyScalar(1.35));counts[2]++;
  dummy.position.set(landmarkX,.035,landmarkZ);dummy.rotation.set(-Math.PI/2,0,zone*.31);dummy.scale.set(2.25,1.8,1);
  dummy.updateMatrix();batches[3].setMatrixAt(counts[3],dummy.matrix);batches[3].setColorAt(counts[3],accent);counts[3]++;
  // Cada bioma fica em seu próprio lote instanciado; as outras salas podem ser ocultadas.
  for(let i=0;i<batches.length;i++){
   const mesh=batches[i];mesh.count=counts[i];mesh.instanceMatrix.needsUpdate=true;
   if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
   mesh.name=names[i]+'-realm-'+realmKey+'-zone-'+(zone+1);
   mesh.userData.phaseIndex=zone;
   parent.add(mesh);
  }
  totalInstances+=counts.reduce((sum,value)=>sum+value,0);
  zoneBatchCounts.push(counts.slice());
 }
 parent.userData.biomeDetailCount=totalInstances;
 parent.userData.biomeDetailBatches=zoneBatchCounts.length*8;
 parent.userData.biomeDetailInstances=zoneBatchCounts;
}

function buildDungeon() {
  const dungeonGroup=new THREE.Group();dungeonGroup.name='environment-monochrome';scene.add(dungeonGroup);activeEnvironmentGroup=dungeonGroup;
  addVoidBackdrop(dungeonGroup,0x0e1725,0x354356);

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
  const worldZones = MAP_ZONE_CENTERS.map((z,index)=>({
    id:index+1,z,depth:MAP_ZONE_DEPTHS[index],top:[
      mat(0x526276,.94),mat(0x5a477b,.90),mat(0x31553e,.86,.10),mat(0x744627,.86,.10),mat(0x57344f,.86,.10)
    ][index]
  }));
  for (const zone of worldZones) {
    zone.top.map = dungeonTexture;
    zone.top.bumpMap = isMobileDevice ? null : dungeonTexture;
    zone.top.bumpScale = .012;
    zone.top.needsUpdate = true;
    const zoneFloor=addOrganicZoneFloor(zone.z,zone.id-1,floor,zone.top,-.5);
    zoneFloor.userData.phaseIndex=zone.id-1;
    // Teto abobadado e paredes perimetrais leves para fechar visualmente a sala.
    const roofGeo=new THREE.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2);
    const roofMat=new THREE.MeshStandardMaterial({color:[0x26384a,0x292b4d,0x244336,0x513025,0x38233c][zone.id-1],roughness:.82,metalness:.12,transparent:true,opacity:.72,side:THREE.BackSide,depthWrite:false});
    const roof=new THREE.Mesh(roofGeo,roofMat);
    roof.name='dungeon-room-roof-'+zone.id;
    roof.scale.set(16.1,5.6,zone.depth*.59);
    roof.position.set(0,2.0,zone.z);
    roof.userData.phaseIndex=zone.id-1;
    activeEnvironmentGroup.add(roof);
    // As bordas recortadas deixam cada região com sua própria silhueta, sem corredor retangular.
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
      for (let x=-14; x<=14; x+=4) {
        if (!pointInMapPolygon(x,z-zone.z,MAP_ZONE_POLYGONS[zone.id-1]) || Math.random() <= .50) continue;
        tileDummy.position.set(x,.008,z);
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
      if(pointInMapPolygon(0,z-zone.z,MAP_ZONE_POLYGONS[zone.id-1]))box(21.8,.012,.06,groutMat,0,-.009,z);
    }
  }
  for (const z of [-30.5,-62,-94,-130]) {
    const bridgeDepth = z === -130 ? 9.5 : 3.1;
    box(9,.06,bridgeDepth,mat(0x283743,.9,.1),0,-.018,z);
  }

  // Portões de fundo, início e limites externos do conjunto.
  box(36,5,.8,wall,0,2,-180);
  box(36,5,.8,wall,0,2,13);

  for (const zone of worldZones) {
    const minZ = zone.z-zone.depth/2+6, maxZ = zone.z+zone.depth/2-6;
    for (let z=minZ; z<=maxZ; z+=5) {
      for (const side of [-1,1]) {
        const x=side*13.6;
        if(!pointInMapPolygon(x,z-zone.z,MAP_ZONE_POLYGONS[zone.id-1]))continue;
        const orb=new THREE.Mesh(new THREE.OctahedronGeometry(.2),crystal);
        orb.position.set(x,.9,z);
        activeEnvironmentGroup.add(orb);
        const foot=new THREE.Mesh(new THREE.CylinderGeometry(.24,.32,.32,6),trim);
        foot.position.set(x,.16,z);activeEnvironmentGroup.add(foot);
      }
    }
  }
  addAdventureMapFeatures(dungeonGroup,[0x75eaff,0xb49aff,0x76f0ad,0xffa45e,0xff77b7],1,true);
  addCliffEdgeDetails(dungeonGroup);
  addBiomeDetailInstances(dungeonGroup,[0x76869b,0x8977b8,0x6b9968,0xc27b50,0x9b688e],1);

  // Pilares agora pertencem à composição de cada região e também têm colisão no servidor.

// Detalhes de pedra nas paredes
for (let z = -30; z <= 8; z += 6) {
  box(0.12, 0.18, 2.2, stoneLight, -17.0, 1.2, z);
  box(0.12, 0.12, 1.5, stoneDark, -17.0, 2.8, z + 2);

  box(0.12, 0.18, 2.2, stoneLight, 17.0, 1.2, z);
  box(0.12, 0.12, 1.5, stoneDark, 17.0, 2.8, z + 2);
}
  // O perímetro de fundo e início foi criado acima; não duplicar as mesmas paredes.

  // As bordas são marcadas pelas estruturas de cada bioma, evitando cristais flutuando no vazio.

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
function partitionDungeonPhaseGroups(root){
 if(!root||root.userData.phasePartitioned)return;
 root.updateMatrixWorld(true);
 const zones=MAP_ZONE_CENTERS.map((center,index)=>{
  const group=new THREE.Group();group.name='dungeon-phase-'+(index+1);group.userData.phaseIndex=index;return group;
 });
 const shared=new THREE.Group();shared.name='dungeon-shared-geometry';

 // Divide instanced geometry that spans the whole dungeon into one batch per
 // room. This keeps one draw call per material per visible room, not all five.
 const instanced=[];
 root.traverse(node=>{if(node.isInstancedMesh&&node.count>1)instanced.push(node);});
 const splitWideInstances=(mesh)=>{
  try{
   mesh.updateWorldMatrix(true,false);
   if(typeof mesh.computeBoundingBox==='function')mesh.computeBoundingBox();
   const bounds=new THREE.Box3().setFromObject(mesh);
   if(bounds.isEmpty()||bounds.getSize(new THREE.Vector3()).z<=41)return false;
   const buckets=MAP_ZONE_CENTERS.map(()=>[]);
   const outside=[];
   const local=new THREE.Matrix4(),worldPosition=new THREE.Vector3(),worldQuaternion=new THREE.Quaternion(),worldScale=new THREE.Vector3(),worldMatrix=new THREE.Matrix4();
   const color=new THREE.Color();
   for(let i=0;i<mesh.count;i++){
    mesh.getMatrixAt(i,local);
    local.decompose(worldPosition,worldQuaternion,worldScale);
    worldPosition.applyMatrix4(mesh.matrixWorld);
    let nearest=0,nearestDistance=Infinity;
    for(let zone=0;zone<MAP_ZONE_CENTERS.length;zone++){
     const distance=Math.abs(worldPosition.z-MAP_ZONE_CENTERS[zone]);
     if(distance<nearestDistance){nearestDistance=distance;nearest=zone;}
    }
    const entry={matrix:local.clone(),color:null};
    if(mesh.instanceColor){mesh.getColorAt(i,color);entry.color=color.clone();}
    if(nearestDistance<=MAP_ZONE_DEPTHS[nearest]*.72)buckets[nearest].push(entry);
    else outside.push(entry);
   }
   const makeBatch=(entries,name,parent,phaseIndex=null)=>{
    if(!entries.length)return;
    const batch=new THREE.InstancedMesh(mesh.geometry,mesh.material,entries.length);
    batch.name=name;batch.count=entries.length;
    batch.matrixAutoUpdate=false;batch.matrix.copy(mesh.matrixWorld);batch.matrixWorldNeedsUpdate=true;
    batch.castShadow=mesh.castShadow;batch.receiveShadow=mesh.receiveShadow;
    batch.frustumCulled=mesh.frustumCulled;batch.renderOrder=mesh.renderOrder;
    batch.userData={...mesh.userData};
    if(phaseIndex!==null)batch.userData.phaseIndex=phaseIndex;
    entries.forEach((entry,index)=>{
     batch.setMatrixAt(index,entry.matrix);
     if(entry.color)batch.setColorAt(index,entry.color);
    });
    batch.instanceMatrix.needsUpdate=true;
    if(batch.instanceColor)batch.instanceColor.needsUpdate=true;
    parent.add(batch);
   };
   buckets.forEach((entries,index)=>makeBatch(entries,mesh.name+'-phase-'+(index+1),zones[index],index));
   makeBatch(outside,mesh.name+'-shared',shared,null);
   mesh.parent?.remove(mesh);
   return true;
  }catch{return false;}
 };
 for(const mesh of instanced)splitWideInstances(mesh);

 root.updateMatrixWorld(true);
 const children=[...root.children];
 for(const child of children){
  if(child===shared||zones.includes(child))continue;
  try{
   child.updateWorldMatrix(true,true);
   const bounds=new THREE.Box3().setFromObject(child);
   if(bounds.isEmpty()){shared.add(child);continue;}
   const size=bounds.getSize(new THREE.Vector3());
   const center=bounds.getCenter(new THREE.Vector3());
   let nearest=0,nearestDistance=Infinity;
   for(let i=0;i<MAP_ZONE_CENTERS.length;i++){
    const distance=Math.abs(center.z-MAP_ZONE_CENTERS[i]);
    if(distance<nearestDistance){nearestDistance=distance;nearest=i;}
   }
   const crossesZones=size.z>41||nearestDistance>MAP_ZONE_DEPTHS[nearest]*.58;
   (crossesZones?shared:zones[nearest]).add(child);
  }catch{shared.add(child);}
 }
 root.add(shared,...zones);
 dungeonPhaseGroups.push(...zones);
 root.userData.phasePartitioned=true;
 root.userData.sharedPhaseGeometry=shared;
}
function updateDungeonPhaseVisibility(phase){
 const current=Math.max(1,Math.min(5,Math.floor(Number(phase)||1)))-1;
 dungeonPhaseGroups.forEach(group=>{
  const phaseIndex=Number(group.userData.phaseIndex);
  group.visible=phaseIndex===current||phaseIndex===Math.min(4,current+1);
 });
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

  // Detalhes periféricos instanciados por bioma: pedras, fragmentos e musgo.
  // Instancing mantém o cenário rico sem criar dezenas de draw calls individuais.
  const rubbleGeometry = new THREE.DodecahedronGeometry(.19,0);
  const rubbleMaterial = new THREE.MeshStandardMaterial({color:0xffffff,roughness:.94,metalness:.025});
  const rubble = new THREE.InstancedMesh(rubbleGeometry,rubbleMaterial,90);
  const mossGeometry = new THREE.CircleGeometry(.34,8);
  const mossMaterial = new THREE.MeshStandardMaterial({color:0x78926d,roughness:1,metalness:0,transparent:true,opacity:.30,depthWrite:false,side:THREE.DoubleSide});
  const moss = new THREE.InstancedMesh(mossGeometry,mossMaterial,60);
  let rubbleIndex=0,mossIndex=0;
  for(let zi=0;zi<zoneData.length;zi++){
    const zone=zoneData[zi];
    for(let n=0;n<18;n++){
      const side=n%2===0?-1:1;
      const x=side*(10.4+(n%3)*.95);
      const z=zone.z-13.5+(n%9)*3.0;
      const scale=.48+(n%4)*.17;
      dummy.position.set(x,.10+(n%3)*.025,z);
      dummy.rotation.set((n%3)*.12,(n*1.71+zi)*.2,(n%4)*.09);
      dummy.scale.set(scale,scale*(.55+(n%3)*.22),scale*.82);
      dummy.updateMatrix();
      rubble.setMatrixAt(rubbleIndex,dummy.matrix);
      const tint=new THREE.Color(zone.color).multiplyScalar(.22+(n%4)*.035);
      rubble.setColorAt(rubbleIndex,tint);
      rubbleIndex++;
      if(n%3===0){
        dummy.position.set(side*(9.8+(n%2)*1.1),.014,zone.z-12+(n%9)*3.1);
        dummy.rotation.set(-Math.PI/2,0,(n*2.1+zi)*.13);
        const patchScale=.55+(n%4)*.16;
        dummy.scale.set(patchScale,patchScale,patchScale);
        dummy.updateMatrix();
        moss.setMatrixAt(mossIndex,dummy.matrix);
        moss.setColorAt(mossIndex,new THREE.Color(zi===2?0x8fc47a:zone.color).multiplyScalar(.42));
        mossIndex++;
      }
    }
  }
  rubble.count=rubbleIndex; rubble.instanceMatrix.needsUpdate=true;
  moss.count=mossIndex; moss.instanceMatrix.needsUpdate=true;
  if(rubble.instanceColor)rubble.instanceColor.needsUpdate=true;
  if(moss.instanceColor)moss.instanceColor.needsUpdate=true;
  detailGroup.add(rubble,moss);
}

function buildAstralWorld(){
  const astral=new THREE.Group();astral.name='environment-vale-astral';scene.add(astral);activeEnvironmentGroup=astral;
  addVoidBackdrop(astral,0x17132d,0x453b68);
  const deepStone=new THREE.MeshStandardMaterial({color:0x17132f,roughness:.82,metalness:.12});
  const islandTop=new THREE.MeshStandardMaterial({color:0x29224b,roughness:.75,metalness:.2,emissive:0x110c2c,emissiveIntensity:.38});
  const islandEdge=new THREE.MeshStandardMaterial({color:0x251b42,roughness:.92,metalness:.08});
  const bridgeMat=new THREE.MeshStandardMaterial({color:0x463c74,roughness:.48,metalness:.35,emissive:0x1c1550,emissiveIntensity:.65});
  const crystalMat=new THREE.MeshStandardMaterial({color:0x8f7aff,emissive:0x6a38ff,emissiveIntensity:1.6,roughness:.24,metalness:.16});
  const cyanMat=new THREE.MeshStandardMaterial({color:0x5ceaff,emissive:0x168cda,emissiveIntensity:1.35,roughness:.28,metalness:.16});
  const zones=MAP_ZONE_CENTERS.map((z,index)=>({z,depth:MAP_ZONE_DEPTHS[index]}));
  zones.forEach((zone,index)=>{
    addOrganicZoneFloor(zone.z,index,islandEdge,islandTop,-.5);
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
  addAdventureMapFeatures(astral,[0x9c86ff,0x61eaff,0xa5f0cc,0xffc57b,0xf179ab],2,false);
  addCliffEdgeDetails(astral);
  addBiomeDetailInstances(astral,[0x9c86ff,0x61eaff,0xa5f0cc,0xffc57b,0xf179ab],2);
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
  // Estruturas suspensas e cristais de ponta para fazer o terceiro mundo parecer de cabeça para baixo.
  const invertedStone=new THREE.MeshStandardMaterial({color:0x34213e,roughness:.88,metalness:.18,emissive:0x260f35,emissiveIntensity:.55});
  const invertedCrystal=new THREE.MeshStandardMaterial({color:0xd14c78,roughness:.24,metalness:.28,emissive:0x9c174f,emissiveIntensity:1.25});
  const hangingGeometry=new THREE.ConeGeometry(.74,2.75,7);
  const hangingTowers=new THREE.InstancedMesh(hangingGeometry,invertedStone,MAP_ZONE_CENTERS.length*2);
  const hangingCrystals=new THREE.InstancedMesh(new THREE.OctahedronGeometry(.34,0),invertedCrystal,MAP_ZONE_CENTERS.length*3);
  const invertedDummy=new THREE.Object3D();
  let hangingIndex=0,crystalIndex=0;
  for(let zone=0;zone<MAP_ZONE_CENTERS.length;zone++){
    const center=MAP_ZONE_CENTERS[zone];
    for(const side of [-1,1]){
      invertedDummy.position.set(side*(7.5+(zone%2)*1.3),5.85,center+(zone%2?3:-3));
      invertedDummy.rotation.set(Math.PI,side*.12,zone*.2);
      invertedDummy.scale.set(1,1+(zone%3)*.12,1);
      invertedDummy.updateMatrix();hangingTowers.setMatrixAt(hangingIndex++,invertedDummy.matrix);
      invertedDummy.position.set(side*(6.4+(zone%2)),4.95,center+(zone%2?-5:5));
      invertedDummy.rotation.set(Math.PI*.72,side*.38,zone*.34);
      invertedDummy.scale.set(.82,1.25,.82);
      invertedDummy.updateMatrix();hangingCrystals.setMatrixAt(crystalIndex++,invertedDummy.matrix);
      invertedDummy.position.set(side*10.2,4.65,center);
      invertedDummy.rotation.set(Math.PI*.85,zone*.6,side*.2);
      invertedDummy.scale.set(.52,.9,.52);
      invertedDummy.updateMatrix();hangingCrystals.setMatrixAt(crystalIndex++,invertedDummy.matrix);
    }
    const invertedRune=new THREE.Mesh(new THREE.TorusGeometry(2.4,.045,6,32),new THREE.MeshBasicMaterial({color:0xff6b96,transparent:true,opacity:.34,side:THREE.DoubleSide}));
    invertedRune.rotation.x=Math.PI/2;invertedRune.position.set(0,4.25,center);invertedRune.scale.set(1.45,1,1);eclipse.add(invertedRune);
  }
  hangingTowers.count=hangingIndex;hangingTowers.instanceMatrix.needsUpdate=true;hangingTowers.name='inverted-hanging-pillars';eclipse.add(hangingTowers);
  hangingCrystals.count=crystalIndex;hangingCrystals.instanceMatrix.needsUpdate=true;hangingCrystals.name='inverted-suspended-crystals';eclipse.add(hangingCrystals);
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
  $('phaseTransitionTitle').textContent=realm===3?'MUNDO INVERTIDO':realm===2?'VALE ASTRAL':'MUNDO MONOCROMÁTICO';
  $('phaseTransitionSub').textContent=realm===3?'MUNDO III · CINCO REGIÕES · O ECLIPSE INVERTIDO':realm===2?'MUNDO II · CINCO REGIÕES · UM NOVO GUARDIÃO':'MUNDO I · CINCO REGIÕES · SOBREVIVA À MASMORRA';
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

let heroDetailTextureCache = null;
function getHeroDetailTextures() {
  if (heroDetailTextureCache) return heroDetailTextureCache;
  const createPattern = (kind, roughness = false) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d', { alpha: false });
    const base = roughness ? (kind === 'stone' ? 218 : kind === 'metal' ? 166 : 205) : 246;
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, 128, 128);
    if (kind === 'fabric') {
      ctx.strokeStyle = roughness ? 'rgba(55,55,55,.12)' : 'rgba(55,65,80,.085)';
      ctx.lineWidth = 1;
      for (let n = -128; n < 256; n += 8) {
        ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n + 128, 128); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(n, 128); ctx.lineTo(n + 128, 0); ctx.stroke();
      }
      ctx.fillStyle = roughness ? 'rgba(30,30,30,.12)' : 'rgba(80,90,105,.09)';
      for (let y = 5; y < 128; y += 16) for (let x = 5; x < 128; x += 16) ctx.fillRect(x, y, 1.2, 1.2);
    } else if (kind === 'armor' || kind === 'metal') {
      ctx.strokeStyle = roughness ? 'rgba(30,30,30,.14)' : 'rgba(60,75,92,.075)';
      ctx.lineWidth = 1;
      for (let y = 3; y < 128; y += 5) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y + (y % 3)); ctx.stroke();
      }
      for (let n = 0; n < 34; n++) {
        const x = (n * 37 + 13) % 128, y = (n * 53 + 19) % 128;
        ctx.fillStyle = roughness ? 'rgba(20,20,20,.16)' : 'rgba(45,60,75,.12)';
        ctx.fillRect(x, y, 1 + (n % 3), 1);
      }
    } else if (kind === 'leather') {
      ctx.fillStyle = roughness ? 'rgba(35,35,35,.12)' : 'rgba(55,45,35,.075)';
      for (let y = 4; y < 128; y += 9) for (let x = 3; x < 128; x += 11) {
        const px = x + ((y * 7) % 5);
        ctx.beginPath(); ctx.ellipse(px, y, 1.2, 1.8, .4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = roughness ? 'rgba(20,20,20,.13)' : 'rgba(65,50,40,.08)';
      ctx.lineWidth = 1;
      for (let y = 16; y < 128; y += 32) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(128,y+4); ctx.stroke(); }
    } else if (kind === 'stone') {
      ctx.strokeStyle = roughness ? 'rgba(15,15,15,.20)' : 'rgba(60,68,76,.11)';
      ctx.lineWidth = 1.1;
      for (let n = 0; n < 18; n++) {
        const x = (n * 29 + 11) % 128, y = (n * 47 + 7) % 128;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+5+(n%4)*3,y+4+(n%3)*4);
        ctx.lineTo(x+2+(n%5)*5,y+11+(n%4)*4); ctx.stroke();
      }
      for (let n = 0; n < 60; n++) {
        ctx.fillStyle = roughness ? 'rgba(10,10,10,.16)' : 'rgba(75,80,88,.10)';
        ctx.fillRect((n*31)%128,(n*59)%128,1.5,1.5);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(kind === 'stone' ? 1.55 : 2.1, kind === 'stone' ? 1.55 : 2.1);
    texture.colorSpace = roughness ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  };
  heroDetailTextureCache = {
    fabric: createPattern('fabric'),
    armor: createPattern('armor'),
    leather: createPattern('leather'),
    stone: createPattern('stone'),
    metal: createPattern('metal'),
    roughness: createPattern('armor', true),
    stoneRoughness: createPattern('stone', true),
    skinRoughness: createPattern('fabric', true)
  };
  return heroDetailTextureCache;
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
  // Mapas compartilhados: dão microtextura a tecido, couro, metal e pedra sem criar uma textura por peça.
  const detailMaps = getHeroDetailTextures();
  armor.map = isStoneBody ? detailMaps.stone : detailMaps.armor;
  armor.roughnessMap = isStoneBody ? detailMaps.stoneRoughness : detailMaps.roughness;
  dark.map = detailMaps.leather; dark.roughnessMap = detailMaps.roughness;
  cloth.map = detailMaps.fabric; cloth.roughnessMap = detailMaps.roughness;
  steel.map = detailMaps.metal; steel.roughnessMap = detailMaps.roughness;
  skinMat.roughnessMap = detailMaps.skinRoughness;
  armor.needsUpdate = dark.needsUpdate = cloth.needsUpdate = steel.needsUpdate = skinMat.needsUpdate = true;
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
      const leg=add(new THREE.CylinderGeometry(tiny?.10:.14,tiny?.145:.185,.40,isMobileDevice?7:10),legMat,0,-.20,0,1.12,1,1.08,pivot);
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
    torso=add(new THREE.BoxGeometry(.72,.66,.50),armor,0,1.12,0,1.0,1.04,.92);
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
    // Tronco mais anatômico e afunilado: evita a silhueta de barriga arredondada.
    const torsoGeometry=heroClass==='ogre'
      ?new THREE.CylinderGeometry(.265,.18,.70,isMobileDevice?8:12,1)
      :new THREE.CylinderGeometry(heroClass==='monk'?.25:.255,heroClass==='monk'?.18:.185,.68,isMobileDevice?8:12,1);
    torso=add(torsoGeometry,heroClass==='ogre'?skinMat:armor,0,1.10,0,heroClass==='ogre'?.94:1.0,1.04,heroClass==='ogre'?.74:.78);
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
  // O tronco usa a própria armadura/roupa, sem esfera abdominal saliente.
  const abdomenBulge=null;
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
      const upper=add(new THREE.CylinderGeometry(heroClass==='ogre'?.16:.115,heroClass==='ogre'?.20:.15,.36,isMobileDevice?7:10),armMaterial,0,-.15,0,1.05,1,1.05,pivot);
      upper.rotation.z=side*-.08;
      const elbow = new THREE.Group(); elbow.position.set(0,-.31,-.02); pivot.add(elbow);
      add(new THREE.DodecahedronGeometry(.075,0),steel,0,0,-.005,1,.92,.9,elbow);
      add(new THREE.CylinderGeometry(.09,.12,.27,isMobileDevice?7:9),heroClass==='monk'?skinMat:dark,0,-.14,0,1.05,1,1.05,elbow);
      add(new THREE.BoxGeometry(.17,.13,.15),steel,0,-.29,-.025,1,1,1,elbow);
      add(new THREE.BoxGeometry(.15,.13,.14),dark,0,-.39,-.01,.9,.9,.9,elbow);
      // Dedos curtos articulados dão leitura de mão em vez de blocos lisos.
      for (let finger = -1; finger <= 1; finger++) {
        const digit = add(new THREE.CapsuleGeometry(.018,.065,2,5), steel, finger*.043, -.475, -.075, 1, 1, .8, elbow);
        digit.rotation.z = finger * -.11;
      }
      add(new THREE.CapsuleGeometry(.022,.055,2,5), dark, side*.085, -.425, -.02, 1, 1, .8, elbow);
      pivot.userData.elbow = elbow;
    }
    arms.push({mesh:pivot,side});
    if (!isStoneBody) {
      const wristGuard = add(new THREE.TorusGeometry(.095,.018,5,14), trim, side*(bulky?.53:.43), 1.00, -.025);
      wristGuard.rotation.x = Math.PI/2;
      wristGuard.scale.set(1,.84,1);
    }
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
    head=addHead(new THREE.DodecahedronGeometry(.265,0),steel,0,1.91,0,1.04,1.08,.96);
    addHead(new THREE.BoxGeometry(.34,.20,.13),armor,0,1.91,-.11);
    addHead(new THREE.BoxGeometry(.24,.045,.035),glow,0,1.94,-.19);
    addHead(new THREE.ConeGeometry(.07,.25,5),trim,0,2.20,.01);
    addHead(new THREE.BoxGeometry(.24,.04,.05),trim,0,1.82,-.19);
  }else if(heroClass==='mage'||heroClass==='archer'||heroClass==='healer'||heroClass==='necromancer'){
    head=addHead(new THREE.CapsuleGeometry(.185,.15,4,isMobileDevice?7:10),skinMat,0,1.88,-.005,1.08,.98,.90);
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
    head=addHead(new THREE.DodecahedronGeometry(.23,1),skinMat,0,1.86,0,1.05,.95,.94);
    for(const side of [-1,1]){
      const ear=addHead(new THREE.ConeGeometry(.095,.36,5),skinMat,side*.27,2.04,.02,1,.9,.65);ear.rotation.z=side*-.75;
      addHead(new THREE.SphereGeometry(.036,10,8),glow,side*.085,1.88,-.21,.8,1,.5);
    }
    addHead(new THREE.BoxGeometry(.20,.075,.06),dark,0,1.77,-.22);
  }else if(heroClass==='ogre'){
    head=addHead(new THREE.CapsuleGeometry(.25,.12,4,isMobileDevice?7:10),skinMat,0,1.91,-.01,1.2,1.02,.94);
    for(const side of [-1,1]){
      const tusk=addHead(new THREE.ConeGeometry(.06,.19,5),steel,side*.15,1.77,-.22);tusk.rotation.x=Math.PI;
      addHead(new THREE.SphereGeometry(.045,10,8),glow,side*.11,1.94,-.24);
      const horn=addHead(new THREE.ConeGeometry(.11,.26,5),dark,side*.22,2.19,0);horn.rotation.z=side*-.38;
    }
    addHead(new THREE.BoxGeometry(.24,.08,.06),dark,0,1.79,-.23);
  }else if(heroClass==='monk'){
    head=addHead(new THREE.CapsuleGeometry(.17,.15,4,isMobileDevice?7:10),skinMat,0,1.88,0,1.08,.96,.88);
    addHead(new THREE.BoxGeometry(.44,.09,.31),cloth,0,2.02,.005);
    addHead(new THREE.BoxGeometry(.28,.035,.025),trim,0,2.01,-.18);
    for(const side of [-1,1]) addHead(new THREE.SphereGeometry(.035,10,8),dark,side*.08,1.90,-.22);
  }else{
    head=addHead(new THREE.CapsuleGeometry(.16,.13,4,isMobileDevice?7:10),skinMat,0,1.88,0,1.08,.98,.88);
  }
  // Orelhas, ponte nasal e pequenas formas faciais reforçam a leitura do rosto em escala de jogo.
  if (['mage','archer','healer','necromancer','monk','goblin','ogre'].includes(heroClass)) {
    for (const side of [-1,1]) {
      const ear = addHead(new THREE.CapsuleGeometry(.035,.085,2,6), skinMat, side*.215, 1.88, -.005, .8, 1.1, .55);
      ear.rotation.z = side*.18;
    }
    if (heroClass !== 'goblin') {
      const nose = addHead(new THREE.SphereGeometry(.032,8,6), skinMat, 0, 1.865, heroClass === 'ogre' ? -.295 : -.275, 1, 1.12, .72);
    }
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
      const eye=addHead(new THREE.SphereGeometry(.030,9,7),faceGlow,side*.085,1.945,-.213,.98,.82,.18);
      const pupil=addHead(new THREE.SphereGeometry(.010,8,6),dark,side*.085,1.945,-.224,.92,.95,.18);
      faceEyes.push({mesh:pupil,baseX:pupil.position.x,eye});
      const brow=addHead(new THREE.BoxGeometry(.105,.024,.04),dark,side*.085,2.005,-.238);brow.rotation.z=side*-.10;faceBrows.push(brow);
    }
  }else if(heroClass==='necromancer'){
    for(const side of [-1,1]){
      const eye=addHead(new THREE.SphereGeometry(.032,9,7),faceGlow,side*.085,1.93,-.226,.98,.82,.18);
      const pupil=addHead(new THREE.SphereGeometry(.010,8,6),dark,side*.085,1.93,-.238,.92,.95,.18);
      faceEyes.push({mesh:pupil,baseX:pupil.position.x,eye});
      const brow=addHead(new THREE.BoxGeometry(.11,.025,.035),dark,side*.085,1.995,-.25);brow.rotation.z=side*-.12;faceBrows.push(brow);
    }
    for(let tooth=-1;tooth<=1;tooth++)addHead(new THREE.BoxGeometry(.018,.065,.025),trim,tooth*.045,1.82,-.272);
  }else{
    const eyeZ=heroClass==='ogre'?'-.278':heroClass==='goblin'?'-.228':'-.242';
    for(const side of [-1,1]){
      const eye=addHead(new THREE.SphereGeometry(.031,10,8),eyeWhite,side*.087,heroClass==='ogre'?1.95:1.92,Number(eyeZ)+.032,.98,.84,.17);
      const iris=addHead(new THREE.SphereGeometry(.017,9,7),faceGlow,side*.087,heroClass==='ogre'?1.95:1.92,Number(eyeZ)+.020,.96,.88,.18);
      const pupil=addHead(new THREE.SphereGeometry(.010,8,6),pupilMat,side*.087,heroClass==='ogre'?1.95:1.92,Number(eyeZ)+.009,.95,.9,.18);
      const glint=addHead(new THREE.SphereGeometry(.004,6,5),eyeWhite,side*.078,heroClass==='ogre'?1.965:1.935,Number(eyeZ)+.003);
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
  // Silhueta ampliada: faixa diagonal, bolsas, joelheiras e reforços no dorso.
  if (!isStoneBody) {
    const chestStrap = add(new THREE.BoxGeometry(.065,.56,.035), dark, .13,1.16,-.385);
    chestStrap.rotation.z = -.23;
    const strapBuckle = add(new THREE.BoxGeometry(.105,.085,.045), trim, .195,.94,-.414);
    strapBuckle.rotation.z = -.23;
    for (const side of [-1,1]) {
      const pouch = add(new THREE.BoxGeometry(.14,.16,.10), dark, side*.29,.82,-.285,1,.92,.85);
      pouch.rotation.z = side*.08;
      add(new THREE.BoxGeometry(.08,.025,.018), trim, side*.29,.865,-.344);
      const kneeGuard = add(new THREE.DodecahedronGeometry(.12,0), armor, side*(tiny?.16:.20),.47,-.135,1.08,.82,.58);
      kneeGuard.rotation.z = side*.08;
      add(new THREE.BoxGeometry(.13,.025,.018), trim, side*(tiny?.16:.20),.45,-.205);
    }
    const backPlate = add(new THREE.BoxGeometry(.42,.48,.09), dark, 0,1.16,.31,1,.96,.65);
    backPlate.rotation.z = -.025;
    for (const side of [-1,1]) {
      const backRidge = add(new THREE.ConeGeometry(.075,.32,5), trim, side*.17,1.42,.35);
      backRidge.rotation.z = side*-.18;
    }
    // Equipamentos traseiros exclusivos ajudam a reconhecer a classe por qualquer ângulo.
    if (heroClass === 'archer') {
      const quiver = add(new THREE.CylinderGeometry(.10,.13,.58,8), dark, .22,1.20,.39,1,1,1);
      quiver.rotation.z = -.12;
      for (let arrow = -1; arrow <= 1; arrow++) {
        const shaft = add(new THREE.CylinderGeometry(.009,.009,.48,5), steel, .22+arrow*.045,1.53,.40,1,1,1);
        shaft.rotation.z = -.12 + arrow*.035;
        const tip = add(new THREE.ConeGeometry(.028,.095,5), trim, .22+arrow*.045,1.81,.40,1,1,1);
        tip.rotation.z = -.12 + arrow*.035;
      }
    } else if (heroClass === 'necromancer') {
      const skullToken = add(new THREE.DodecahedronGeometry(.105,0), glow, 0,.79,.39,.95,1.05,.7);
      skullToken.rotation.set(.18,.25,.12);
      add(new THREE.BoxGeometry(.18,.035,.035), trim, 0,.73,.405);
    } else if (heroClass === 'healer') {
      const backEmblem = add(new THREE.TorusGeometry(.13,.022,5,18), glow, 0,1.32,.39);
      backEmblem.rotation.y = Math.PI/2;
      add(new THREE.OctahedronGeometry(.075,0), trim, 0,1.32,.40);
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
  g.userData.headRig=headRig;g.userData.head=head;g.userData.torso=torso;g.userData.torsoBaseScaleY=torso?torso.scale.y:1;g.userData.abdomen=abdomenBulge;
  g.userData.legs=legs;g.userData.arms=arms;g.userData.cape=cape;g.userData.capeTails=capeTails;
  g.userData.classCharm=classCharm;g.userData.classShield=classShield;g.userData.decorativeParts=decorativeParts;
  g.userData.baseRing=ring;g.userData.waistSigil=waistSigil;g.userData.walkPhase=Math.random()*Math.PI*2;g.userData.baseY=0;
  g.userData.silhouetteProfile={heroClass};
  g.userData.faceEyes=faceEyes;
  g.userData.faceBrows=faceBrows;
  for (const face of faceEyes) {
    for (const mesh of [face.eye,face.iris,face.mesh,face.glint]) {
      if (mesh) mesh.userData.blinkBaseScaleY = mesh.scale.y;
    }
  }
  g.userData.blinkTimer = 2.4 + Math.random()*2.8;
  g.userData.blinkRemaining = 0;
  g.userData.visualModelRevision='humanoid-silhouette-v3';
  // Proporção geral um pouco mais esguia sem reduzir a altura nem a leitura das classes.
  g.scale.set(.94,1,.96);
  attachHealthBar(g);
  return g;
}
function updateHeroFaceAnimation(entity, dt) {
  if (!entity?.userData?.faceEyes?.length) return;
  let timer = Number(entity.userData.blinkTimer ?? 3.5) - dt;
  let remaining = Number(entity.userData.blinkRemaining || 0);
  if (timer <= 0 && remaining <= 0) {
    remaining = .14;
    timer = 2.8 + Math.random()*2.7;
  }
  let blinkScale = 1;
  if (remaining > 0) {
    remaining = Math.max(0, remaining - dt);
    const progress = 1 - remaining/.14;
    blinkScale = progress < .5 ? 1 - (progress/.5)*.88 : .12 + ((progress-.5)/.5)*.88;
  }
  for (const face of entity.userData.faceEyes) {
    for (const mesh of [face.eye,face.iris,face.mesh,face.glint]) {
      if (mesh) mesh.scale.y = (mesh.userData.blinkBaseScaleY ?? mesh.scale.y) * blinkScale;
    }
  }
  entity.userData.blinkTimer = timer;
  entity.userData.blinkRemaining = remaining;
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
  const bossMaps = getHeroDetailTextures();
  armor.map = bossMaps.stone; armor.roughnessMap = bossMaps.stoneRoughness;
  dark.map = bossMaps.leather; bone.map = bossMaps.stone;
  armor.needsUpdate = dark.needsUpdate = bone.needsUpdate = true;
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

function makeStoneFragment(color=0x858d91){
  const g=new THREE.Group();
  const stone=new THREE.MeshStandardMaterial({color,roughness:.94,metalness:.08,flatShading:true});
  const seam=new THREE.MeshStandardMaterial({color:0x53636a,roughness:.88,metalness:.12});
  const glow=new THREE.MeshStandardMaterial({color:0xc9f2ad,emissive:0x506c3d,emissiveIntensity:.7,roughness:.32});
  const shadow=addSoftContactShadow(g,.62,.5);shadow.position.y=.025;
  const pieces=[
    [-.18,.22,0,.28,.27,.30], [.20,.18,.04,.31,.24,.25],
    [0,.42,-.08,.26,.28,.23], [-.23,.12,.21,.17,.16,.20],
    [.22,.11,-.18,.19,.16,.22], [0,.09,-.28,.16,.14,.12]
  ];
  pieces.forEach((p,index)=>{
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1,index%3===0?1:0),index===5?glow:stone);
    rock.position.set(p[0],p[1],p[2]);rock.scale.set(p[3],p[4],p[5]);
    rock.rotation.set(index*.18,index*.47,index*-.13);
    rock.castShadow=!isMobileDevice;rock.receiveShadow=!isMobileDevice;g.add(rock);
  });
  const crack=new THREE.Mesh(new THREE.BoxGeometry(.055,.025,.24),seam);
  crack.position.set(.05,.34,-.17);crack.rotation.z=.42;g.add(crack);
  attachHealthBar(g);
  if(g.userData.healthBar)g.userData.healthBar.position.y=.9;
  g.userData.isStoneFragment=true;
  g.userData.playerClass='golem_clone';
  return g;
}

function makeMonster(kind = 'stalker', phase = 1, variant = {}) {
  // Distinct monster silhouettes: predator, plant, specter, brute, inferno, abyss and assassin.
  const g=new THREE.Group();
  const contactShadow = addSoftContactShadow(g, kind === 'brute' ? .85 : kind === 'wraith' || kind === 'abyss' ? .50 : .62, .55);
  contactShadow.position.y = .032;
  const eyeColor=kind==='brute'?0xffa342:kind==='wraith'?0x72f4ff:kind==='thorn'?0x9dff69:kind==='inferno'?0xff592d:kind==='abyss'?0xc49bff:kind==='assassin'?0xff5c86:phase===2?0xff5e76:0xff4269;
  const bodyColor=kind==='thorn'?0x3e6a40:kind==='inferno'?0x3a2425:kind==='abyss'?0x251936:kind==='wraith'?0x223c59:kind==='brute'?0x4c5669:kind==='assassin'?0x292d42:phase===2?0x3c5262:0x4c4359;
  const bodyMat=new THREE.MeshStandardMaterial({color:bodyColor,roughness:kind==='wraith'?.4:.78,metalness:kind==='brute'?.28:.08,emissive:kind==='abyss'?0x29143e:0x000000,emissiveIntensity:.35});
  const dark=new THREE.MeshStandardMaterial({color:0x151923,roughness:.84,metalness:.08});
  const bone=new THREE.MeshStandardMaterial({color:0xc5c9d3,roughness:.45,metalness:.24});
  const monsterMaps = getHeroDetailTextures();
  bodyMat.map = kind==='thorn' || kind==='brute' ? monsterMaps.stone : kind==='wraith' || kind==='abyss' ? monsterMaps.fabric : monsterMaps.leather;
  bodyMat.roughnessMap = kind==='thorn' || kind==='brute' ? monsterMaps.stoneRoughness : monsterMaps.roughness;
  dark.map = monsterMaps.leather;
  bone.map = monsterMaps.stone;
  bodyMat.needsUpdate = dark.needsUpdate = bone.needsUpdate = true;
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
  if(kind==='training_dummy'){
    const woodMat=new THREE.MeshStandardMaterial({color:0x9b7046,roughness:.94,map:getHeroDetailTextures().leather});
    const darkWood=new THREE.MeshStandardMaterial({color:0x533c2d,roughness:.9,map:getHeroDetailTextures().stone});
    const targetMat=new THREE.MeshStandardMaterial({color:0xc84a43,roughness:.78,emissive:0x42100d,emissiveIntensity:.25,map:getHeroDetailTextures().leather});
    const metalMat=new THREE.MeshStandardMaterial({color:0x737e88,metalness:.58,roughness:.42,map:getHeroDetailTextures().metal});
    add(new THREE.CylinderGeometry(.62,.76,.18,12),darkWood,0,.10,0);
    add(new THREE.CylinderGeometry(.12,.18,1.55,8),metalMat,0,.88,0);
    add(new THREE.CapsuleGeometry(.23,.68,4,8),woodMat,0,1.55,0,1,.95,.8);
    add(new THREE.SphereGeometry(.25,12,10),woodMat,0,2.12,0,1,1,.9);
    add(new THREE.TorusGeometry(.25,.065,7,20),targetMat,0,1.58,-.205,1,1,.8).rotation.x=Math.PI/2;
    for(const side of [-1,1]){
      const arm=limb(new THREE.CapsuleGeometry(.085,.48,3,7),woodMat,side*.37,1.72,0,1,1,1,side);
      arm.rotation.z=side*.72;animatedLimbs[animatedLimbs.length-1].baseRotationZ=arm.rotation.z;
      const leg=add(new THREE.CylinderGeometry(.075,.10,.45,7),darkWood,side*.15,.42,0);
      leg.rotation.z=side*.10;
    }
    add(new THREE.BoxGeometry(.22,.12,.12),targetMat,0,1.58,-.30);
    g.userData.trainingDummy=true;
  } else if(kind==='wraith'){
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
  if(Number(variant.eliteTier)>0){
    const accentByAffix={champion:0xffbd68,armored:0xe8cb83,swift:0x78eaff,mana_leech:0xb99aff,vampiric:0xff7b9d,venomous:0x9df06b};
    const accent=accentByAffix[variant.affix]||0xffc77e;
    const eliteMaterial=new THREE.MeshStandardMaterial({color:accent,emissive:accent,emissiveIntensity:1.05,metalness:.42,roughness:.28});
    const ring=new THREE.Mesh(new THREE.TorusGeometry(Number(variant.eliteTier)>1?.82:.68,.045,5,22),eliteMaterial);
    ring.rotation.x=Math.PI/2;ring.position.y=.075;g.add(ring);
    if(Number(variant.eliteTier)>1){
      const crest=new THREE.Mesh(new THREE.OctahedronGeometry(.22,1),eliteMaterial);
      crest.position.set(0,2.05,0);crest.scale.set(.8,1.25,.8);g.add(crest);
      const leftHorn=new THREE.Mesh(new THREE.ConeGeometry(.11,.42,5),eliteMaterial);
      leftHorn.position.set(-.32,1.84,0);leftHorn.rotation.z=.42;g.add(leftHorn);
      const rightHorn=leftHorn.clone();rightHorn.position.x=.32;rightHorn.rotation.z=-.42;g.add(rightHorn);
    }
    // Etiqueta pequena e legível para identificar o tipo de campeão durante o combate.
    const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=64;
    const labelCtx=labelCanvas.getContext('2d');
    if(labelCtx){
      const affixNames={champion:'GUARDIÃO',armored:'BLINDADO',swift:'VELOZ',mana_leech:'DRENADOR',vampiric:'VAMPÍRICO',venomous:'VENENOSO'};
      labelCtx.fillStyle='rgba(5,10,18,.88)';labelCtx.fillRect(4,8,248,48);
      labelCtx.strokeStyle='#'+accent.toString(16).padStart(6,'0');labelCtx.lineWidth=4;labelCtx.strokeRect(6,10,244,44);
      labelCtx.fillStyle='#fff4dc';labelCtx.font='bold 25px Arial';labelCtx.textAlign='center';labelCtx.textBaseline='middle';
      labelCtx.fillText((Number(variant.eliteTier)>1?'✦ ':'')+(affixNames[variant.affix]||'ELITE'),128,33);
      const labelTexture=new THREE.CanvasTexture(labelCanvas);labelTexture.colorSpace=THREE.SRGBColorSpace;
      const labelMaterial=new THREE.SpriteMaterial({map:labelTexture,transparent:true,depthTest:false,depthWrite:false});
      const labelSprite=new THREE.Sprite(labelMaterial);labelSprite.position.set(0,3.46,0);labelSprite.scale.set(1.35,.34,1);labelSprite.renderOrder=24;g.add(labelSprite);
      g.userData.eliteLabel=labelSprite;
    }
    g.userData.eliteRing=ring;g.userData.eliteAffix=String(variant.affix||'champion');
  }
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
      camera.fov = isMobileDevice ? (width > height ? 66 : 74) : 62;
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
let skillPoints=5;
const unlockedSkills=new Set();
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
const skillTreeScrollMemory = {
  lobby: { top: 0, left: 0 },
  hud: { top: 0, left: 0 }
};
function rememberSkillTreeScroll(event) {
  const board = event.target?.closest?.('.skill-rpg-scroll');
  if (!board) return;
  const root = board.closest('#skillTreeLobby') ? 'lobby' : board.closest('#skillTreeHud') ? 'hud' : null;
  if (!root) return;
  skillTreeScrollMemory[root].top = board.scrollTop;
  skillTreeScrollMemory[root].left = board.scrollLeft;
}
$('skillTreeLobby')?.addEventListener('scroll', rememberSkillTreeScroll, { passive: true, capture: true });
$('skillTreeHud')?.addEventListener('scroll', rememberSkillTreeScroll, { passive: true, capture: true });
function captureSkillTreeScrollChain(root) {
  const saved = [];
  for (let node = root; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
      saved.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
  }
  return saved;
}
function restoreSkillTreeScrollChain(saved) {
  for (const item of saved || []) {
    if (!item.node?.isConnected) continue;
    item.node.scrollTop = item.top;
    item.node.scrollLeft = item.left;
  }
}
function renderSkillTrees() {
  const lobbyEditorScroll = document.querySelector('#lobby .lobby-editor-content');
  const skillPanelScroll = $('skillPanel');
  const lobbyBoardBefore = $('skillTreeLobby')?.querySelector('.skill-rpg-scroll');
  const hudBoardBefore = $('skillTreeHud')?.querySelector('.skill-rpg-scroll');
  const scrollSnapshot = {
    documentTop: document.scrollingElement?.scrollTop ?? window.scrollY ?? 0,
    lobbyChain: captureSkillTreeScrollChain($('skillTreeLobby')),
    hudChain: captureSkillTreeScrollChain($('skillTreeHud')),
    lobbyEditorTop: lobbyEditorScroll?.scrollTop || 0,
    lobbyBoardTop: lobbyBoardBefore?.scrollTop ?? skillTreeScrollMemory.lobby.top,
    lobbyBoardLeft: lobbyBoardBefore?.scrollLeft ?? skillTreeScrollMemory.lobby.left,
    skillPanelTop: skillPanelScroll?.scrollTop || 0,
    hudBoardTop: hudBoardBefore?.scrollTop ?? skillTreeScrollMemory.hud.top,
    hudBoardLeft: hudBoardBefore?.scrollLeft ?? skillTreeScrollMemory.hud.left,
    lobbyCatalogTop: $('skillTreeLobby')?.querySelector('.skill-description-catalog')?.scrollTop || 0,
    hudCatalogTop: $('skillTreeHud')?.querySelector('.skill-description-catalog')?.scrollTop || 0
  };
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
  const branchCards=branches.map(branch=>{
    const skills=branch.skills.map((skill,index)=>({...skill,branch:branch.id,branchTitle:branch.title,originalIndex:index}));
    const unlockedCount=skills.filter(skill=>unlockedSkills.has(skill.id)).length;
    const glyph=branch.icon||({attack:'⚔️',defense:'🛡️',arcane:'✦',mobility:'💨',support:'✚'}[branch.id]||'✦');
    const nodes=skills.map((skill,index)=>{
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
      return '<button type="button" class="skill-rpg-node '+stateClass+(hidden?' skill-filtered-out':'')+'" data-skill="'+esc(skill.id)+'" data-branch="'+esc(branch.id)+'" aria-label="'+esc(skill.name+'. '+skill.desc+'. '+status)+'" '+(canBuy?'':'disabled')+'>'+
        '<span class="skill-rpg-node-icon">'+esc(skill.icon)+'</span><span class="skill-rpg-node-copy"><strong>'+esc(skill.name)+'</strong><small>NÍVEL '+(index+1)+' · 1 PONTO</small><em>'+esc(unlocked?'✓ APRENDIDA':canBuy?'TOQUE PARA APRENDER':status)+'</em><span class="skill-rpg-node-desc">'+esc(skill.desc)+'</span></span><span class="skill-rpg-node-state">'+(unlocked?'✓':index+1)+'</span></button>';
    }).join('');
    return '<section class="skill-rpg-branch-card" data-skill-branch="'+esc(branch.id)+'"><header class="skill-rpg-branch-head"><span>'+esc(glyph)+'</span><div><strong>'+esc(branch.title.replace(/^\S+\s*/,''))+'</strong><small>'+unlockedCount+'/'+skills.length+' talentos aprendidos · sequência de 5 níveis</small></div></header><div class="skill-rpg-branch-nodes">'+nodes+'</div></section>';
  }).join('');
  const overallPct=Math.min(100,Math.round(activeCount/15*100));
  const core='<div class="skill-tree-core skill-tree-core-redesign"><span class="skill-tree-core-icon">'+classGlyph+'</span><span><strong>'+esc(CLASS_NAMES_UI[selectedClass]||'CLASSE')+'</strong><small>ÁRVORE DE HABILIDADES · '+skillPoints+' PONTOS · '+activeCount+'/15 TALENTOS</small><span class="skill-tree-overall-progress" role="progressbar" aria-label="Progresso total de talentos" aria-valuemin="0" aria-valuemax="15" aria-valuenow="'+activeCount+'"><span style="width:'+overallPct+'%"></span></span></span></div>';
  const tree='<div class="skill-rpg-scroll"><div class="skill-rpg-grid">'+branchCards+'</div></div>';
  const catalog='<section class="skill-description-catalog"><h3>📖 GRIMÓRIO DE TALENTOS</h3><p>Leia os efeitos antes de gastar seus pontos. Cada caminho possui cinco níveis; escolha até três caminhos.</p>'+
    branches.map(branch=>'<section class="skill-description-branch"><h4>'+esc(branch.title)+'</h4><div class="skill-description-list">'+
      branch.skills.map(skill=>{
        const unlocked=unlockedSkills.has(skill.id),canBuy=canUnlock({...skill,branch:branch.id});
        const required=skill.req?allSkills.find(item=>item.id===skill.req)?.name:'';
        const state=unlocked?'APRENDIDA ✓':skill.req&&!unlockedSkills.has(skill.req)?'REQUER: '+(required||'talento anterior'):canBuy?'DISPONÍVEL · 1 PONTO':skillPoints<1?'SEM PONTOS':'BLOQUEADA';
        return '<button type="button" class="skill-description-card '+(unlocked?'unlocked':canBuy?'available':'locked')+'" data-skill="'+esc(skill.id)+'" data-branch="'+esc(branch.id)+'" '+(canBuy?'':'disabled')+'><span class="skill-description-icon">'+esc(skill.icon)+'</span><span class="skill-description-copy"><strong>'+esc(skill.name)+'</strong><p>'+esc(skill.desc)+'</p><small>'+esc(state)+'</small></span></button>';
      }).join('')+'</div></section>').join('')+'</section>';
  const html=core+filterBar+'<div class="skill-rpg-heading"><strong>CAMINHOS DE ESPECIALIZAÇÃO</strong><span>O núcleo se divide em cinco trilhas. Desbloqueie cada nível em sequência.</span></div>'+tree+
    '<p class="skill-orbit-help">Nós dourados estão disponíveis. Nós verdes já foram aprendidos. Desça a página para ver todas as trilhas.</p>'+catalog;
  const lobbyTree=$('skillTreeLobby'),hudTree=$('skillTreeHud');
  if(lobbyTree)lobbyTree.innerHTML=html;
  if(hudTree)hudTree.innerHTML=core+filterBar+'<div class="skill-rpg-heading"><strong>CAMINHOS DE ESPECIALIZAÇÃO</strong><span>O núcleo se divide em cinco trilhas. Desbloqueie cada nível em sequência.</span></div>'+tree+'<p class="skill-orbit-help">Nós dourados estão disponíveis. Nós verdes já foram aprendidos. Desça a página para ver todas as trilhas.</p>';
  // Trilhas em fluxo vertical: sem canvas fixo e sem zoom que altere a posição da página.
  const restoreTreePosition = () => {
    if (document.scrollingElement) document.scrollingElement.scrollTop = scrollSnapshot.documentTop;
    restoreSkillTreeScrollChain(scrollSnapshot.lobbyChain);
    restoreSkillTreeScrollChain(scrollSnapshot.hudChain);
    const editor = document.querySelector('#lobby .lobby-editor-content');
    const panel = $('skillPanel');
    const lobbyBoard = $('skillTreeLobby')?.querySelector('.skill-rpg-scroll');
    const hudBoard = $('skillTreeHud')?.querySelector('.skill-rpg-scroll');
    if (editor) editor.scrollTop = scrollSnapshot.lobbyEditorTop;
    if (panel) panel.scrollTop = scrollSnapshot.skillPanelTop;
    if (lobbyBoard) { lobbyBoard.scrollLeft = scrollSnapshot.lobbyBoardLeft; lobbyBoard.scrollTop = scrollSnapshot.lobbyBoardTop; }
    if (hudBoard) { hudBoard.scrollLeft = scrollSnapshot.hudBoardLeft; hudBoard.scrollTop = scrollSnapshot.hudBoardTop; }
    const lobbyCatalog = $('skillTreeLobby')?.querySelector('.skill-description-catalog');
    const hudCatalog = $('skillTreeHud')?.querySelector('.skill-description-catalog');
    if (lobbyCatalog) lobbyCatalog.scrollTop = scrollSnapshot.lobbyCatalogTop;
    if (hudCatalog) hudCatalog.scrollTop = scrollSnapshot.hudCatalogTop;
    if (typeof window.scrollTo === 'function') window.scrollTo(0, scrollSnapshot.documentTop);
  };
  requestAnimationFrame(() => {
    restoreTreePosition();
    requestAnimationFrame(restoreTreePosition);
  });
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

function getSharedProfileData(){return{version:3,playerClass:selectedClass,skin:selectedSkin,unlockedSkins:Array.from(unlockedSkins),skills:[],skillPoints:5,equipmentDamage:Math.max(0,Math.min(18,Number(equipmentDamage)||0)),inventory:{...inventoryData},lootDrops:lootDrops.slice(-100).map(item=>({...item})),selectedItemId:selectedItemId?String(selectedItemId):null,realm:sharedProgress.realm,phase:sharedProgress.phase,levelProgress:{level:levelProgress.level,xp:levelProgress.xp,xpToNext:levelProgress.xpToNext,levelPoints:levelProgress.levelPoints,upgrades:{...levelProgress.upgrades}}};}
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
  lobbyPreviewHero.scale.setScalar(baseScale);
  lobbyPreviewHero.position.set(0,0,0);
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
  // Prévia estável: sem crescer do zero nem quicar ao entrar no lobby.
  lobbyPreviewHero.scale.setScalar(lobbyPreviewHero.userData.lobbyEntryBaseScale || 1);
  lobbyPreviewHero.position.y = 0;
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
  // Guardar TODOS os níveis de rolagem: painel, editor do lobby e as duas árvores.
  // A árvore é reconstruída ao comprar; restaurar só a árvore do HUD fazia o lobby saltar ao topo.
  const scrollChain=[];
  for(let node=button;node&&node!==document.body;node=node.parentElement){
    if(node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1)
      scrollChain.push({node,top:node.scrollTop,left:node.scrollLeft});
  }
  const pageScroll={x:window.scrollX||0,y:window.scrollY||0};
  const scrollState = {
    editor: document.querySelector('#lobby .lobby-editor-content')?.scrollTop || 0,
    panel: $('skillPanel')?.scrollTop || 0,
    lobby: $('skillTreeLobby')?.scrollTop || 0,
    hud: $('skillTreeHud')?.scrollTop || 0,
    lobbyBoard: (() => { const el=$('skillTreeLobby')?.querySelector('.skill-rpg-scroll'); return el?{left:el.scrollLeft,top:el.scrollTop}:null; })(),
    hudBoard: (() => { const el=$('skillTreeHud')?.querySelector('.skill-rpg-scroll'); return el?{left:el.scrollLeft,top:el.scrollTop}:null; })(),
    lobbyCatalogTop: $('skillTreeLobby')?.querySelector('.skill-description-catalog')?.scrollTop || 0,
    hudCatalogTop: $('skillTreeHud')?.querySelector('.skill-description-catalog')?.scrollTop || 0
  };
  event.preventDefault();
  event.stopPropagation();
  // Desfoca o botão ANTES de reconstruir o HTML: desfocar o nó antigo depois
  // da renderização podia provocar um salto de rolagem no navegador móvel.
  button.blur();
  unlockedSkills.add(skill.id);
  skillPoints--;
  lastSkillSignature = '';
  syncLoadoutUI();
  const restoreSkillScroll = () => {
    for(const item of scrollChain){if(item.node?.isConnected){item.node.scrollTop=item.top;item.node.scrollLeft=item.left;}}
    const editor=document.querySelector('#lobby .lobby-editor-content');
    const panel=$('skillPanel');
    const lobby=$('skillTreeLobby');
    const hud=$('skillTreeHud');
    if(editor)editor.scrollTop=scrollState.editor;
    if(panel)panel.scrollTop=scrollState.panel;
    if(lobby)lobby.scrollTop=scrollState.lobby;
    if(hud)hud.scrollTop=scrollState.hud;
    const lb=lobby?.querySelector('.skill-rpg-scroll');
    const hb=hud?.querySelector('.skill-rpg-scroll');
    if(lb&&scrollState.lobbyBoard){lb.scrollLeft=scrollState.lobbyBoard.left;lb.scrollTop=scrollState.lobbyBoard.top;}
    if(hb&&scrollState.hudBoard){hb.scrollLeft=scrollState.hudBoard.left;hb.scrollTop=scrollState.hudBoard.top;}
    const lobbyCatalog=lobby?.querySelector('.skill-description-catalog');
    const hudCatalog=hud?.querySelector('.skill-description-catalog');
    if(lobbyCatalog)lobbyCatalog.scrollTop=scrollState.lobbyCatalogTop;
    if(hudCatalog)hudCatalog.scrollTop=scrollState.hudCatalogTop;
  };
  requestAnimationFrame(()=>{restoreSkillScroll();requestAnimationFrame(()=>{restoreSkillScroll();window.scrollTo(pageScroll.x,pageScroll.y);});});
  sendLoadout();
  vibrateGame(18);
  showNotice('✦ ' + skill.name + ' desbloqueada!');
  // A árvore foi recriada, mas a rolagem anterior é restaurada por renderSkillTrees().
  // Não mover o foco para cópias do nó no grimório ou no painel oculto.
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
function createOfflineMapHazards(){
  const rand=(min,max)=>min+Math.random()*(max-min);
  return MAP_ZONE_CENTERS.flatMap((center,index)=>{
    const side=Math.random()<.5?-1:1,other=-side,stairX=index%2===0?-8.25:8.25;
    return [
      {id:'miasma-'+index,type:'miasma',x:side*rand(10.1,12.7),z:center+rand(-5.8,6.8),r:1.28,damage:5,cooldown:1200},
      {id:'rune-surge-'+index,type:'rune',x:other*rand(9.2,12.1),z:center-rand(5.4,12.8),r:1.18,damage:9,cooldown:1150},
      {id:'crumble-'+index,type:'crumble',x:side*rand(4.8,6.5),z:center-rand(10.8,14.8),r:1.3,damage:6,cooldown:1400},
      {id:'spike-'+index+'-L',type:'spike',x:stairX-rand(.45,1.18),z:center-rand(1.3,6.2),r:.88,damage:13,cooldown:1050},
      {id:'spike-'+index+'-R',type:'spike',x:stairX+rand(.45,1.18),z:center-rand(1.3,6.2),r:.88,damage:13,cooldown:1050}
    ];
  });
}
function createOfflineState() {
  const player = {
    id: 'offline-player',
    name: $('playerName')?.value.trim() || 'Aventureiro',
    x:0,z:3,rot:0,hp:130+(Number(levelProgress.upgrades?.health)||0)*12,maxHp:130+(Number(levelProgress.upgrades?.health)||0)*12,
    mana:100+(Number(levelProgress.upgrades?.mana)||0)*15,maxMana:100+(Number(levelProgress.upgrades?.mana)||0)*15,
    level:levelProgress.level,xp:levelProgress.xp,xpToNext:levelProgress.xpToNext,levelPoints:levelProgress.levelPoints,levelUpgrades:{...levelProgress.upgrades},
    playerClass: selectedClass, skin: selectedSkin,
    skills: Array.from(unlockedSkills), talentPoints: skillPoints, equipmentDamage,
    ready: true, isHost: true, color: 0x72e6ff
  };
  const kinds = ['stalker','stalker','brute','wraith','thorn'];
  const monsters = kinds.map((kind, i) => {
    const hp = kind === 'brute' ? 24 : 14;
    return {
      id: 'offline-monster-' + i, kind, phase: 1, realm: 1,
      x: (Math.random()-.5)*15, z: -14+(Math.random()-.5)*9,
      alive: true, hp, maxHp: hp, spawned: false, spawnAt: 0
    };
  });
  return {
    type: 'state', gameMode: 'coop', players: [player], summons: [],
    phase: 1, realm: 1, safeZoneUntil: 0, started: true, hostId: player.id,
    monsters, boss: null, portalOpen: false, mapHazards:createOfflineMapHazards(),
    chests: MAP_ZONE_CENTERS.flatMap((center,index)=>{
      const side=Math.random()<.5?-1:1,upperSide=Math.random()<.5?-1:1;
      return [
        {id:'offline-chest-'+index+'a',x:side*(5.8+Math.random()*2),z:center+(Math.random()-.5)*7.2,opened:false},
        {id:'offline-chest-'+index+'b',x:upperSide*(5.9+Math.random()*2),z:center-12.6-Math.random()*2.8,opened:false,upperFloor:true}
      ];
    })
  };
}

let trainingMetrics = { totalDamage:0, hits:0, combo:0, bestCombo:0, startedAt:0, lastHitAt:0 };
function ensureTrainingMetricsPanel() {
  let panel = $('trainingMetricsPanel');
  if (panel) return panel;
  panel = document.createElement('section');
  panel.id = 'trainingMetricsPanel';
  panel.className = 'training-metrics-panel hidden';
  panel.setAttribute('aria-label','Estatísticas do campo de treinamento');
  panel.innerHTML = '<header><span>⚔ MEDIDOR DE COMBATE</span><small id="trainingMetricsTime">0:00</small></header>'+
    '<div class="training-metrics-grid">'+
    '<div><small>DANO TOTAL</small><strong id="trainingTotalDamage">0</strong></div>'+
    '<div><small>DPS MÉDIO</small><strong id="trainingDps">0,0</strong></div>'+
    '<div><small>COMBO ATUAL</small><strong id="trainingCombo">0×</strong></div>'+
    '<div><small>MELHOR COMBO</small><strong id="trainingBestCombo">0×</strong></div></div>'+
    '<button id="trainingMetricsReset" type="button">ZERAR MEDIÇÃO</button>';
  document.body.appendChild(panel);
  panel.querySelector('#trainingMetricsReset')?.addEventListener('click', resetTrainingMetrics);
  return panel;
}
function resetTrainingMetrics() {
  trainingMetrics = { totalDamage:0, hits:0, combo:0, bestCombo:0, startedAt:performance.now(), lastHitAt:0 };
  updateTrainingMetricsPanel();
}
function updateTrainingMetricsPanel() {
  const panel = ensureTrainingMetricsPanel();
  const active = !!offlineState?.trainingMode;
  panel.classList.toggle('hidden',!active);
  if (!active) return;
  const elapsedMs = Math.max(1,performance.now()-(trainingMetrics.startedAt||performance.now()));
  const elapsedSeconds = elapsedMs/1000;
  const dps = trainingMetrics.totalDamage/elapsedSeconds;
  const format = n => Math.round(n).toLocaleString('pt-BR');
  const set = (id,value) => { const el=$(id); if(el)el.textContent=value; };
  set('trainingTotalDamage',format(trainingMetrics.totalDamage));
  set('trainingDps',dps.toFixed(1).replace('.',','));
  set('trainingCombo',String(trainingMetrics.combo)+'×');
  set('trainingBestCombo',String(trainingMetrics.bestCombo)+'×');
  const seconds=Math.floor(elapsedSeconds);
  set('trainingMetricsTime',Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'));
}
function recordTrainingDamage(actualDamage) {
  if (!offlineState?.trainingMode || !Number.isFinite(actualDamage) || actualDamage<=0) return;
  const now=performance.now();
  trainingMetrics.totalDamage+=actualDamage;
  trainingMetrics.hits++;
  trainingMetrics.combo = now-(trainingMetrics.lastHitAt||0)<=1800 ? trainingMetrics.combo+1 : 1;
  trainingMetrics.bestCombo=Math.max(trainingMetrics.bestCombo,trainingMetrics.combo);
  trainingMetrics.lastHitAt=now;
  updateTrainingMetricsPanel();
}
function startTrainingRange() {
  if (ws) { try { ws.close(); } catch {} ws = null; }
  connectionRequested = false;
  clearTimeout(reconnectTimer);
  offlineMode = true;
  offlineDefeatNoticeShown = false;
  playerId = 'offline-player';
  roomCode = 'TREINO';
  activeGameMode = 'coop';
  selectedGameMode = 'coop';
  unlockedSkills.clear();
  skillPoints = 5;
  lastSkillSignature = '';
  offlineState = createOfflineState();
  resetTrainingMetrics();
  const player = offlineState.players[0];
  player.playerClass = selectedClass;
  player.skin = selectedSkin;
  player.skills = [];
  player.talentPoints = 5;
  player.x = 0; player.z = 3; player.rot = 0;
  player.hp = player.maxHp = 130;
  player.mana = player.maxMana = 100;
  player.abilityCooldowns = {};
  offlineState.monsters = [
    {id:'training-dummy-center',kind:'training_dummy',name:'Boneco de Treino',trainingDummy:true,homeX:0,homeZ:0,x:0,z:0,phase:1,realm:1,spawned:true,alive:true,hp:80,maxHp:80,respawnDelay:1800},
    {id:'training-dummy-left',kind:'training_dummy',name:'Boneco de Treino',trainingDummy:true,homeX:-3,homeZ:-1,x:-3,z:-1,phase:1,realm:1,spawned:true,alive:true,hp:80,maxHp:80,respawnDelay:1800},
    {id:'training-dummy-right',kind:'training_dummy',name:'Boneco de Treino',trainingDummy:true,homeX:3,homeZ:-1,x:3,z:-1,phase:1,realm:1,spawned:true,alive:true,hp:80,maxHp:80,respawnDelay:1800},
    {id:'training-attacker-left',kind:'training_dummy',name:'Boneco Combatente I',trainingDummy:true,trainingAttacker:true,homeX:-6,homeZ:-3,x:-6,z:-3,phase:1,realm:1,spawned:true,alive:true,hp:110,maxHp:110,respawnDelay:2200,nextAttackAt:Date.now()+1700,attackWarnAt:0,trainingWarningUntil:0,attackAnimAt:0},
    {id:'training-attacker-right',kind:'training_dummy',name:'Boneco Combatente II',trainingDummy:true,trainingAttacker:true,homeX:6,homeZ:-3,x:6,z:-3,phase:1,realm:1,spawned:true,alive:true,hp:110,maxHp:110,respawnDelay:2200,nextAttackAt:Date.now()+3000,attackWarnAt:0,trainingWarningUntil:0,attackAnimAt:0}
  ];
  offlineState.summons = [];
  offlineState.chests = [];
  offlineState.safeZoneUntil = 0;
  offlineState.started = true;
  offlineState.trainingMode = true;
  appliedInitialServerPosition = false;
  $('menu')?.classList.add('hidden');
  $('lobby')?.classList.add('hidden');
  $('loading')?.classList.add('hidden');
  $('roomLabel').textContent = 'TREINO';
  $('lobbyRoomCode').textContent = 'TREINO';
  updateClassAbilityButtons();
  updateState(offlineState);
  if (offlineLoop) clearInterval(offlineLoop);
  offlineLoop = setInterval(stepOfflineSimulation, 220);
  showNotice('CAMPO DE TREINO · Teste os poderes nos três alvos. Dois bonecos combatentes vão perseguir você: observe o anel vermelho e esquive!');
}
$('openTrainingBtn')?.addEventListener('click', startTrainingRange);

function startOfflineExploration() {
  $('trainingMetricsPanel')?.classList.add('hidden');
  unlockedSkills.clear(); skillPoints=5; lastSkillSignature=''; syncLoadoutUI();
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
  // O painel de classes só abre quando o jogador toca no botão correspondente.
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

function awardOfflineExperience(baseAmount){
 const p=offlineState?.players?.[0];if(!p)return;
 p.levelUpgrades=p.levelUpgrades||{};
 const gained=Math.max(1,Math.round(baseAmount*(1+Math.min(.4,(Number(p.levelUpgrades.xp)||0)*.05))));
 p.xp=(p.xp||0)+gained;p.level=p.level||1;p.levelPoints=p.levelPoints||0;
 const need=()=>Math.round(50+Math.max(0,p.level-1)*16+Math.pow(Math.max(0,p.level-1),1.16)*2);
 let levels=0;while(p.level<100&&p.xp>=need()){p.xp-=need();p.level++;p.levelPoints++;levels++;}
 p.xpToNext=need();updateLevelHud(p);
 if(levels)showNotice('✦ SUBIU DE NÍVEL! Nível '+p.level+' · +'+levels+' ponto(s) de melhoria.');
 else showNotice('+'+gained+' XP por derrotar um inimigo.');
}
function offlineDamageMonster(monster, amount, burnMs = 0, pushFrom = null, pushDistance = 0) {
  if (!monster?.alive || !Number.isFinite(amount) || amount <= 0) return false;
  const previousHp = Math.max(0, Number(monster.hp || 0));
  const levelUpgrades=offlineState?.players?.[0]?.levelUpgrades||{};
  const attackBonus=1+(Number(levelUpgrades.power)||0)*.045+(Number(levelUpgrades.attack)||0)*.02;
  const actualAmount=amount*attackBonus*(Math.random()<(Number(levelUpgrades.critical)||0)*.02?1.7:1);
  monster.hp = Math.max(0, previousHp - actualAmount);
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
  const actualTrainingDamage = Math.min(previousHp,actualAmount);
  if (monster.trainingDummy) recordTrainingDamage(actualTrainingDamage);
  if (monster.hp <= 0) {
    monster.alive = false;
    if (monster.trainingDummy) {
      monster.respawnAt = Date.now() + Math.max(900, Number(monster.respawnDelay) || 1800);
      monster.hp = 0;
      return true;
    }
    awardOfflineExperience(monster.cursed?52:16+(monster.phase||1)*3+(offlineState?.realm||1)*3);
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
  if(myPlayer)myPlayer.position.set(player.x,getDungeonFloorHeight(player.x,player.z),player.z);
}

function handleOfflineSpell(spell) {
  const player=offlineState?.players?.[0];
  if(!player||player.hp<=0)return;
  const isMage=player.playerClass==='mage',isNecromancer=player.playerClass==='necromancer',isHealer=player.playerClass==='healer';
  const valid=(isMage&&['fire','lightning','arcane'].includes(spell))||(isNecromancer&&spell==='bone')||(isHealer&&spell==='healing');
  if(!valid)return;
  const costs={fire:26,lightning:22,arcane:30,bone:26,healing:22},manaCost=costs[spell]||22;
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
  const safeUntil=Date.now()+22000;
  offlineState.safeZoneUntil=safeUntil;
  const batch=kinds.map((kind,index)=>{
    const base=kind==='brute'?34:kind==='abyss'||kind==='inferno'?27:kind==='thorn'?22:16;
    const hp=Math.round(base*healthScale);
    return{id:'offline-r'+realm+'-p'+phase+'-'+Date.now()+'-'+index,kind,phase,realm,
      x:(Math.random()-.5)*16,z:baseZ+(Math.random()-.5)*9,alive:true,hp,maxHp:hp,spawned:false,spawnAt:safeUntil+index*3400,moveSpeed:kind==='brute'?.23:kind==='assassin'?.37:.30};
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
function handleOfflineClassAbility(data) {
  const player = offlineState?.players?.[0];
  if (!player || player.hp <= 0) return;
  const ability = String(data?.ability || '');
  const spec = (CLASS_ABILITY_CONFIG[player.playerClass] || []).find(item => item.ability === ability);
  if (!spec || spec.spell) return;
  const classOwner = Object.entries(CLASS_ABILITY_CONFIG).find(([,items]) => items.some(item => item.ability === ability))?.[0];
  if (classOwner !== player.playerClass) return;
  const now = Date.now();
  if (now < Number(offlineState.safeZoneUntil || 0)) { showNotice('Aguarde o fim da zona segura para usar habilidades.'); return; }
  if (spec.targeted && (!Number.isFinite(Number(data.x)) || !Number.isFinite(Number(data.z)))) { showNotice('Toque no chão para escolher o impacto.'); return; }
  const costs = {knight_shield:20,knight_dash:22,knight_whirlwind:28,arrow_rain:26,incendiary_arrows:30,archer_piercing_shot:28,goblin_invis:22,goblin_summon:38,goblin_shadow_strike:28,ogre_slam:26,ogre_haste:20,ogre_earthquake:36,healer_cure:24,healer_guardian_spirits:36,healer_sanctuary:34,necromancer_summon:42,necromancer_dive:24,monk_impact_palm:26,monk_winged_steps:24,monk_spirit_wave:32,golem_split:42,golem_rock_toss:30,golem_stone_guard:26};
  const cooldowns = {knight_shield:12,knight_dash:9,knight_whirlwind:14,arrow_rain:8,incendiary_arrows:12,archer_piercing_shot:9.5,goblin_invis:14,goblin_summon:20,goblin_shadow_strike:11,ogre_slam:10,ogre_haste:15,ogre_earthquake:17,healer_cure:23,healer_guardian_spirits:40,healer_sanctuary:24,necromancer_summon:30,necromancer_dive:15,monk_impact_palm:18,monk_winged_steps:15,monk_spirit_wave:13,golem_split:26,golem_rock_toss:14.5,golem_stone_guard:20};
  player.abilityCooldowns = player.abilityCooldowns || {};
  const remaining = Number(player.abilityCooldowns[ability] || 0) - now;
  if (remaining > 0) { showNotice('Habilidade recarregando: ' + Math.ceil(remaining / 1000) + 's.'); return; }
  const manaCost = costs[ability] || 16;
  if ((Number(player.mana) || 0) < manaCost) { showNotice('✦ Mana insuficiente! Custo: ' + manaCost + '.'); return; }
  player.mana = Math.max(0, (Number(player.mana) || 0) - manaCost);
  player.abilityCooldowns[ability] = now + Math.round((cooldowns[ability] || spec.cooldown || 10) * 1000);
  const living = offlineLivingMonsters();
  const nearest = (range=14) => living.map(monster=>({monster,distance:Math.hypot(monster.x-player.x,monster.z-player.z)}))
    .filter(entry=>entry.distance<=range).sort((a,b)=>a.distance-b.distance)[0]?.monster || null;
  const forwardCenter = distance => ({x:player.x-Math.sin(Number(player.rot)||0)*distance,z:player.z-Math.cos(Number(player.rot)||0)*distance});
  const targets = [];
  const hit = (monster,amount,burnMs=0,pushDistance=0) => {
    if (!monster) return;
    offlineDamageMonster(monster,amount,burnMs,pushDistance?{x:player.x,z:player.z}:null,pushDistance);
    targets.push({x:monster.x,z:monster.z});
  };
  const hitArea = (center,radius,amount,burnMs=0,pushDistance=0) => {
    let total=0;
    for (const monster of offlineLivingMonsters()) {
      if (Math.hypot(monster.x-center.x,monster.z-center.z)>radius) continue;
      hit(monster,amount,burnMs,pushDistance); total++;
    }
    return total;
  };
  let center = {x:player.x,z:player.z}, text = '', until = 0;
  if (ability === 'knight_shield') {
    player.shieldUntil = now + 4200; until=player.shieldUntil; text='🛡️ Escudo ativo: 65% menos dano por 4,2 segundos.';
  } else if (ability === 'knight_dash') {
    offlineMoveForward(4.2); center={x:player.x,z:player.z};
    const count=hitArea(center,5.4,5,0,0); text='⚔️ Avanço! '+count+' alvo(s), 5 de dano base.';
  } else if (ability === 'knight_whirlwind') {
    const count=hitArea(center,4.6,11); text='✥ Giro de aço! '+count+' alvo(s), 11 de dano.';
  } else if (ability === 'arrow_rain' || ability === 'incendiary_arrows') {
    const target=nearest(14); center=target?{x:target.x,z:target.z}:forwardCenter(6);
    const damage=ability==='arrow_rain'?(offlineHasSkill('archer_volley')?7:5):3.5;
    const count=hitArea(center,ability==='arrow_rain'?4.6:4.1,damage,ability==='incendiary_arrows'?5500:0);
    text=(ability==='arrow_rain'?'🏹 Chuva de flechas: ':'🔥 Flechas incendiárias: ')+count+' alvo(s), '+damage+' de dano base.';
  } else if (ability === 'archer_piercing_shot') {
    const target=nearest(14); if(target)hit(target,18); text=target?'➶ Flecha perfurante: 18 de dano.':'Nenhum alvo até 14 m.';
  } else if (ability === 'goblin_invis') {
    player.invisibleUntil=now+(offlineHasSkill('goblin_shadow')?7000:5000); until=player.invisibleUntil;text='👻 Invisibilidade ativada por 5 segundos.';
  } else if (ability === 'goblin_summon') {
    let created=0;for(let n=0;n<2;n++)if(offlineCreateSummon('goblin',n,2,12000,72,3,950))created++;
    text='👺 '+created+' goblin(s) aliados por 12 segundos.';
  } else if (ability === 'goblin_shadow_strike') {
    const target=nearest(9);if(target)hit(target,16);player.invisibleUntil=now+600;text=target?'⟡ Golpe sombrio: 16 de dano.':'Nenhum alvo até 9 m.';
  } else if (ability === 'ogre_slam') {
    const ogreDamage=offlineHasSkill('ogre_berserker')?7:5;const count=hitArea(center,5.2,ogreDamage,0,1.6);text='💥 Soco no chão! '+count+' alvo(s), '+ogreDamage+' de dano.';
  } else if (ability === 'ogre_haste') {
    player.ogreHasteUntil=now+5000;until=player.ogreHasteUntil;text='💨 Velocidade aumentada por 5 segundos.';
  } else if (ability === 'ogre_earthquake') {
    const count=hitArea(center,5.8,8,0,1.5);text='♨ Terremoto! '+count+' alvo(s), 8 de dano.';
  } else if (ability === 'healer_cure') {
    const before=player.hp;player.hp=Math.min(player.maxHp,player.hp+(offlineHasSkill('healer_blessing')?70:50));text='💚 Cura: +'+(player.hp-before)+' HP.';
  } else if (ability === 'healer_guardian_spirits') {
    let created=0;for(let n=0;n<3;n++)if(offlineCreateSummon('spirit',n,3,20000,1,9,5000))created++;
    text='🪽 '+created+' espíritos: +5 HP a cada 4 s e 9 de dano a cada 5 s.';
  } else if (ability === 'necromancer_summon') {
    let created=0;for(let n=0;n<5;n++)if(offlineCreateSummon('skeleton',n,5,30000,8,2,1100))created++;
    text='💀 Horda: '+created+' esqueletos aliados por 30 segundos.';
  } else if (ability === 'necromancer_dive') {
    player.necromancerDivePending=true;player.necromancerDiveUntil=now+5000;
    player.necromancerDiveOriginX=player.x;player.necromancerDiveOriginZ=player.z;
    player.invisibleUntil=now+5000;until=player.necromancerDiveUntil;necromancerDivePendingClient=true;
    clearTimeout(necromancerDiveClientTimer);
    necromancerDiveClientTimer=setTimeout(()=>{necromancerDivePendingClient=false;if(player.necromancerDivePending){player.necromancerDivePending=false;player.invisibleUntil=0;showNotice('Mergulho encerrado; você voltou à origem.');}},5100);
    text='🕳️ Mergulho! Toque no chão para emergir em até 5 segundos.';
  } else if (ability === 'monk_impact_palm') {
    const c=forwardCenter(1.4);center=c;const count=hitArea(c,4.2,12,0,2.7);text='👊 Palma de impacto: '+count+' alvo(s), 12 de dano e empurrão.';
  } else if (ability === 'monk_winged_steps') {
    offlineMoveForward(3.1);center={x:player.x,z:player.z};const count=hitArea(center,4.1,10,0,1.1);player.dodgeUntil=now+900;player.monkSpeedUntil=now+5000;until=player.monkSpeedUntil;text='🪽 Passos alados: avanço, '+count+' alvo(s) atingido(s) e 10 de dano.';
  } else if (ability === 'monk_spirit_wave') {
    center=forwardCenter(1.8);const count=hitArea(center,4.5,16,0,1);text='☯ Onda espiritual: '+count+' alvo(s), 16 de dano.';
  } else if (ability === 'golem_split') {
    let created=0;for(let n=0;n<3;n++)if(offlineCreateSummon('golem',n,3,12000,50,4,1150))created++;
    player.invisibleUntil=now+12000;until=player.invisibleUntil;text='🪨 Golem dividido em '+created+' fragmentos por 12 segundos.';
  } else if (ability === 'golem_rock_toss') {
    center={x:THREE.MathUtils.clamp(Number(data.x),-12,12),z:THREE.MathUtils.clamp(Number(data.z),-170,8)};
    const count=hitArea(center,5,15);text='☄ Pedra titânica: '+count+' alvo(s), 15 de dano e estilhaços.';
  } else if (ability === 'golem_stone_guard') {
    player.shieldUntil=now+6500;until=player.shieldUntil;text='⬟ Guarda de pedra: proteção por 6,5 segundos.';
  } else {
    player.abilityCooldowns[ability]=now;player.mana=Math.min(player.maxMana,player.mana+manaCost);return;
  }
  handleClassAbilityMessage({type:'classAbility',id:player.id,ability,x:player.x,z:player.z,center,targets,until,text});
  showNotice(text);
}
const OFFLINE_CLASS_ATTACK_RANGES = Object.freeze({
  knight: 3.0, mage: 7.2, archer: 8.2, goblin: 2.55, ogre: 2.9,
  healer: 8.0, necromancer: 7.6, monk: 2.35, golem: 2.8
});
function handleOfflineAction(data) {
  if (!offlineState || !data) return;
  const player = offlineState.players[0];
  if(data.type==='move'&&player.hp>0){
    const requestedX=Number.isFinite(Number(data.x))?Number(data.x):player.x;
    const requestedZ=THREE.MathUtils.clamp(Number.isFinite(Number(data.z))?Number(data.z):player.z,-174,8);
    const boundedX=THREE.MathUtils.clamp(requestedX,-15.6,15.6);
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
  } else if(data.type==='dash'&&player.hp>0){
    const dx=Number(data.dx)||0,dz=Number(data.dz)||0,length=Math.hypot(dx,dz)||1;
    const distance=3.0+(offlineHasSkill('dodge_mastery') ? .35 : 0)+(offlineHasSkill('phantom_step') ? .45 : 0);
    const resolved=resolveDungeonMovement(player.x,player.z,player.x+dx/length*distance,player.z+dz/length*distance);
    if(Math.hypot(resolved.x-player.x,resolved.z-player.z)>.35){
      player.x=resolved.x;player.z=resolved.z;player.dodgeUntil=Date.now()+220;
      if(myPlayer){myPlayer.position.set(player.x,getDungeonFloorHeight(player.x,player.z),player.z);myPlayer.userData.dodgeFlashUntil=performance.now()+220;}
    }
  } else if (data.type === 'attack' && player.hp > 0) {
    const now = Date.now();
    if (now - offlineLastHit < (offlineHasSkill('battle_focus') ? 220 : 300)) return;
    offlineLastHit = now;
    const baseAttackRange = OFFLINE_CLASS_ATTACK_RANGES[selectedClass] || 3.0;
    const rangeRank = Math.max(0, Number(player.levelUpgrades?.range) || 0);
    const attackRange = baseAttackRange * (1 + rangeRank * 0.025)
      + (selectedClass === 'archer' && offlineHasSkill('longshot') ? 2 : 0);
    const target = offlineState.monsters
      .filter(m => m.alive && Math.hypot(m.x - player.x, m.z - player.z) <= attackRange)
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
function tryOfflineAutomaticDodge(player,threat,now=Date.now()){
 if(!player||!threat||Number(player.levelUpgrades?.autoDodge)<1||now<(player.nextAutoDodgeAt||0)||now<(player.dodgeUntil||0))return false;
 let dx=player.x-Number(threat.x||0),dz=player.z-Number(threat.z||0),length=Math.hypot(dx,dz);
 if(!Number.isFinite(length)||length<.001){dx=1;dz=0;length=1;}
 dx/=length;dz/=length;
 const sideX=-dz,sideZ=dx;
 let best=null,bestDistance=-Infinity;
 for(const side of [1,-1]){
  const landing=resolveDungeonMovement(player.x,player.z,player.x+sideX*1.75*side,player.z+sideZ*1.75*side);
  const moved=Math.hypot(landing.x-player.x,landing.z-player.z);
  if(moved<.45)continue;
  const separation=Math.hypot(landing.x-threat.x,landing.z-threat.z);
  if(separation>bestDistance){best=landing;bestDistance=separation;}
 }
 if(!best)return false;
 player.x=best.x;player.z=best.z;player.nextAutoDodgeAt=now+5200;player.dodgeUntil=now+820;
 if(myPlayer){myPlayer.position.set(player.x,getDungeonFloorHeight(player.x,player.z),player.z);myPlayer.userData.dodgeFlashUntil=performance.now()+240;}
 showNotice('↔ ESQUIVA LATERAL AUTOMÁTICA!');
 return true;
}
function stepOfflineSimulation() {
  if (!offlineMode || !offlineState || !started || !myPlayer) return;
  const player = offlineState.players[0];
  const now = Date.now();
  if(player.hp>0&&now>=(player.mapTrapDamageAt||0)){
    const hazard=(offlineState.mapHazards||[]).find(item=>Math.hypot(player.x-Number(item.x||0),player.z-Number(item.z||0))<Number(item.r||0));
    if(hazard){
      const baseDamage=Math.max(1,Number(hazard.damage)||5);
      const damage=now<(player.shieldUntil||0)?Math.max(1,Math.round(baseDamage*.35)):baseDamage;
      player.hp=Math.max(0,player.hp-damage);
      player.mapTrapDamageAt=now+(Number(hazard.cooldown)||1100);
      const label=hazard.type==='spike'?'Espinhos da escada':hazard.type==='miasma'?'Névoa tóxica':hazard.type==='rune'?'Surto rúnico':'Piso instável';
      showNotice('✹ '+label+'! -'+damage+' HP.');
    }
  }
  if (player.hp > 0) {
    const previousManaAt=Number(player.manaRegenLastAt);
    const manaElapsed=Number.isFinite(previousManaAt)&&previousManaAt>0?Math.max(0,Math.min(1.5,(now-previousManaAt)/1000)):.22;
    player.manaRegenLastAt=now;
    const manaBonus=Math.max(0,Number(player.levelUpgrades?.manaRegen)||0)*.25;
    if(player.mana<(player.maxMana||100))player.mana=Math.min(player.maxMana||100,player.mana+manaElapsed*(2+manaBonus));
    if (offlineState.trainingMode) updateTrainingMetricsPanel();
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
      if(monster.spawned===false){
        if(now<(Number(monster.spawnAt)||Infinity))continue;
        monster.spawned=true;
      }
      if (monster.trainingDummy && !monster.alive) {
        if (now >= (monster.respawnAt || 0)) {
          monster.alive = true;
          monster.hp = Number(monster.maxHp) || 80;
          monster.respawnAt = 0;
          monster.burnUntil = 0;
          monster.burnNextAt = 0;
          monster.x = Number(monster.homeX ?? monster.x);
          monster.z = Number(monster.homeZ ?? monster.z);
          monster.attackWarnAt = 0;
          monster.trainingWarningUntil = 0;
          monster.nextAttackAt = now + 1600;
        } else {
          continue;
        }
      }
      if (!monster.alive) continue;
      if (monster.trainingDummy && monster.trainingAttacker) {
        const dx = player.x - monster.x, dz = player.z - monster.z;
        const distance = Math.hypot(dx, dz);
        monster.rot = Math.atan2(-dx, -dz);
        if (distance > 1.85) {
          monster.attackWarnAt = 0;
          monster.trainingWarningUntil = 0;
          const step = Math.min(.15, Math.max(0, distance - 1.55));
          if (step > 0.001) {
            const resolved = resolveDungeonMovement(monster.x, monster.z,
              monster.x + dx / Math.max(distance, .001) * step,
              monster.z + dz / Math.max(distance, .001) * step);
            monster.x = resolved.x;
            monster.z = resolved.z;
          }
        } else if (now >= (monster.nextAttackAt || 0)) {
          if (!monster.attackWarnAt) {
            monster.attackWarnAt = now;
            monster.trainingWarningUntil = now + 720;
            tryOfflineAutomaticDodge(player,monster,now);
          } else if (now - monster.attackWarnAt >= 720) {
            monster.attackAnimAt = now;
            monster.attackWarnAt = 0;
            monster.trainingWarningUntil = 0;
            monster.nextAttackAt = now + 2850;
            if (Math.hypot(player.x - monster.x, player.z - monster.z) <= 2.15) {
              if (now < (player.dodgeUntil || 0)) {
                showNotice('Esquiva perfeita! O boneco errou o golpe.');
              } else {
                let damage = 6;
                if (player.shielded) damage = Math.max(1, Math.round(damage * .35));
                const before = player.hp;
                player.hp = Math.max(0, player.hp - damage);
                const dealt = before - player.hp;
                showNotice('O boneco combatente acertou você! -' + dealt + ' HP.');
                if (player.hp <= 0 && !offlineDefeatNoticeShown) {
                  offlineDefeatNoticeShown = true;
                  showNotice('Você foi derrotado. Saia do treino para recomeçar.');
                }
              }
            }
          }
        }
        continue;
      }
      if (monster.trainingDummy) {
        monster.x = Number(monster.homeX ?? monster.x);
        monster.z = Number(monster.homeZ ?? monster.z);
        continue;
      }
      if (monster.burnUntil > now && now >= (monster.burnNextAt || 0)) {
        monster.burnNextAt = now + 1000;
        offlineDamageMonster(monster,2);
      }
      if (!monster.alive) continue;
      if (monster.stunnedUntil > now || invisible) continue;
      const dx = player.x - monster.x, dz = player.z - monster.z;
      const distance = Math.hypot(dx,dz);
      if (distance > 1.35 && !monster.attackWarnAt) {
        const speed = (monster.kind === 'brute' ? .22 : .34) * (now < (player.ogreHasteUntil || 0) || now < (player.monkSpeedUntil || 0) ? .78 : 1);
        monster.x += dx / Math.max(distance,.001) * speed;
        monster.z += dz / Math.max(distance,.001) * speed;
      } else if (!monster.attackWarnAt && now >= (monster.nextAttackAt || 0)) {
        monster.attackWarnAt=now;
        tryOfflineAutomaticDodge(player,monster,now);
        showNotice('⚠ O monstro prepara um golpe!');
      } else if (monster.attackWarnAt && now-monster.attackWarnAt>=460) {
        monster.attackWarnAt=0;monster.nextAttackAt=now+1500;
        if(Math.hypot(player.x-monster.x,player.z-monster.z)<=2.1){
          const incomingDamage = monster.kind === 'brute' ? 8 : 4;
          let damageMultiplier = 1;
          if (offlineHasSkill('iron_skin')) damageMultiplier *= .8;
          if (offlineHasSkill('second_wind') && player.hp <= player.maxHp * .3) damageMultiplier *= .8;
          if (player.shielded) damageMultiplier *= .35;
          if(now>=(player.dodgeUntil||0)){
            player.hp = Math.max(0, player.hp - Math.max(1,Math.round(incomingDamage*damageMultiplier)));
            showNotice(player.shielded ? '🛡️ Seu escudo absorveu parte do dano!' : 'Um monstro acertou você!');
          }else showNotice('Esquiva perfeita! O monstro errou o golpe.');
          if (player.hp <= 0 && !offlineDefeatNoticeShown) {
            offlineDefeatNoticeShown = true;
            showNotice('Você foi derrotado. Saia da partida para recomeçar a prévia.');
          }
        }
      }
    }
  }
  offlineState.monsters = offlineState.monsters.filter(m => m.alive || m.trainingDummy);
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
function addClassAbilitySignature(ability, x, z, color) {
  if (!scene || !Number.isFinite(x) || !Number.isFinite(z)) return;
  let geometry, height=1.05, flat=false, wireframe=false;
  switch(ability){
    case 'knight_shield': case 'golem_stone_guard':
      geometry=new THREE.SphereGeometry(.82,10,8,0,Math.PI*2,0,Math.PI);wireframe=true;height=1.18;break;
    case 'knight_dash': case 'monk_winged_steps':
      geometry=new THREE.RingGeometry(.68,.94,24);flat=true;height=.10;break;
    case 'knight_whirlwind': case 'goblin_shadow_strike': case 'ogre_haste':
      geometry=new THREE.TorusKnotGeometry(.58,.045,32,5,2,3);height=1.0;break;
    case 'arrow_rain': case 'incendiary_arrows':
      geometry=new THREE.ConeGeometry(.21,.8,5);height=3.2;break;
    case 'archer_piercing_shot': case 'golem_rock_toss':
      geometry=new THREE.DodecahedronGeometry(ability==='golem_rock_toss'?.42:.23,1);height=ability==='golem_rock_toss'?6.5:1.3;break;
    case 'goblin_invis':
      geometry=new THREE.SphereGeometry(.9,10,8);wireframe=true;height=1.0;break;
    case 'goblin_summon': case 'healer_guardian_spirits': case 'necromancer_summon':
      geometry=new THREE.TorusGeometry(.78,.06,7,24);flat=ability==='goblin_summon';height=flat?.1:1.0;break;
    case 'ogre_slam': case 'ogre_earthquake': case 'monk_impact_palm':
      geometry=new THREE.RingGeometry(.55,.9,28);flat=true;height=.12;break;
    case 'healer_cure': case 'healer_sanctuary':
      geometry=new THREE.TorusGeometry(.7,.05,7,28);height=1.0;break;
    case 'necromancer_dive':
      geometry=new THREE.RingGeometry(.45,.85,24);flat=true;height=.09;break;
    case 'monk_spirit_wave':
      geometry=new THREE.TorusGeometry(.66,.065,7,28);height=.78;break;
    case 'golem_split':
      geometry=new THREE.IcosahedronGeometry(.58,1);height=1.1;wireframe=true;break;
    default:
      geometry=new THREE.OctahedronGeometry(.45,1);height=1.0;
  }
  const material=new THREE.MeshBasicMaterial({color:color||0x76e7f2,transparent:true,opacity:.86,wireframe,side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.position.set(x,height,z);
  if(flat) mesh.rotation.x=-Math.PI/2;
  scene.add(mesh);
  const limit=isMobileDevice?10:20;
  while(activeClassEffects.length>=limit){
    const old=activeClassEffects.shift();
    scene.remove(old.mesh);old.mesh.geometry?.dispose();old.mesh.material?.dispose();
  }
  activeClassEffects.push({mesh,startedAt:performance.now(),duration:ability==='golem_rock_toss'?1050:920,kind:'signature',ability,baseY:height});
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
  addClassAbilitySignature(m.ability, center.x, center.z, colors[m.ability] || 0x76e7f2);
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

  if(m.type==='experience'){
    levelProgress={level:m.level||1,xp:m.xp||0,xpToNext:m.xpToNext||100,levelPoints:m.levelPoints||0,upgrades:{...levelProgress.upgrades}};
    updateLevelHud();showNotice('+'+Math.max(0,Number(m.amount)||0)+' XP · '+(m.source==='boss'?'Chefe':m.source==='player'?'Jogador rival':m.source==='assist'?'Assistência':'Monstro'));return;
  }
  if(m.type==='autoDodge'){
    if(m.id===playerId&&myPlayer){myPlayer.position.set(m.x,getDungeonFloorHeight(m.x,m.z),m.z);myPlayer.userData.dodgeFlashUntil=performance.now()+240;}
    else{const obj=remotePlayers.get(m.id);if(obj){obj.userData.targetX=m.x;obj.userData.targetZ=m.z;obj.userData.targetY=getDungeonFloorHeight(m.x,m.z);}}
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
      if (myPlayer) { myPlayer.userData.lastDamageAt = performance.now(); myPlayer.userData.lastDamageAmount = Number(m.amount) || 0; }
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
      myPlayer.position.set(m.x, getDungeonFloorHeight(m.x,m.z), m.z);
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
function updateLevelHud(source=null){
 if(source&&typeof source==='object'){
  levelProgress={level:Math.max(1,Math.min(100,Math.floor(Number(source.level)||1))),xp:Math.max(0,Number(source.xp)||0),xpToNext:Math.max(1,Number(source.xpToNext)||100),levelPoints:Math.max(0,Math.floor(Number(source.levelPoints)||0)),upgrades:source.levelUpgrades&&typeof source.levelUpgrades==='object'?{...source.levelUpgrades}:{...levelProgress.upgrades}};
 }else if(offlineState?.players?.[0]){
  const p=offlineState.players[0];
  levelProgress={level:p.level||1,xp:p.xp||0,xpToNext:p.xpToNext||100,levelPoints:p.levelPoints||0,upgrades:{...(p.levelUpgrades||{})}};
 }
 const percent=Math.max(0,Math.min(100,levelProgress.xp/Math.max(1,levelProgress.xpToNext)*100));
 const set=(id,value)=>{const el=$(id);if(el)el.textContent=String(value);};
 set('levelText',levelProgress.level);set('levelPanelNumber',levelProgress.level);
 set('levelPointsBadge',levelProgress.levelPoints+' PONTOS');
 set('levelPointsText',levelProgress.levelPoints+' ponto(s) disponíveis');
 set('xpText',Math.floor(levelProgress.xp)+' / '+levelProgress.xpToNext+' XP');
 const fill=$('xpFill');if(fill)fill.style.width=percent+'%';
 const toggle=$('levelToggleBtn');if(toggle)toggle.setAttribute('aria-expanded',String(!$('levelPanel')?.classList.contains('hidden')));
 const list=$('levelUpgradeList');
 if(list){
  if(!levelUpgradeCardsBuilt){
   list.replaceChildren();
   for(const item of LEVEL_UPGRADE_UI){
    const card=document.createElement('article');card.className='level-upgrade-card';card.dataset.upgrade=item.id;
    const title=document.createElement('strong');title.textContent=item.name;
    const description=document.createElement('small');description.textContent=item.desc;
    const rank=document.createElement('span');rank.className='level-rank';rank.dataset.rank=item.id;
    const button=document.createElement('button');button.type='button';button.textContent='MELHORAR · 1 PONTO';
    button.addEventListener('click',()=>purchaseLevelUpgrade(item.id));
    card.append(title,description,rank,button);list.appendChild(card);
   }
   levelUpgradeCardsBuilt=true;
  }
  for(const item of LEVEL_UPGRADE_UI){
   const card=list.querySelector('[data-upgrade="'+item.id+'"]');if(!card)continue;
   const rank=Math.max(0,Number(levelProgress.upgrades?.[item.id])||0);
   const label=card.querySelector('[data-rank]'),button=card.querySelector('button');
   if(label)label.textContent='NÍVEL '+rank+' / '+item.max;
   if(button){button.disabled=levelProgress.levelPoints<=0||rank>=item.max;button.textContent=rank>=item.max?'NÍVEL MÁXIMO':item.id==='autoDodge'&&rank===0?'DESBLOQUEAR · 1 PONTO':'MELHORAR · 1 PONTO';}
  }
 }
 const signature=JSON.stringify(levelProgress);
 if(signature!==lastSavedLevelSignature){lastSavedLevelSignature=signature;saveSharedProfile();}
}
function purchaseLevelUpgrade(id){
 const item=LEVEL_UPGRADE_UI.find(entry=>entry.id===id);if(!item)return;
 if(levelProgress.levelPoints<=0){showNotice('Suba de nível para receber pontos de melhoria.');return;}
 if((Number(levelProgress.upgrades?.[id])||0)>=item.max){showNotice('Essa melhoria já está no nível máximo.');return;}
 if(offlineMode&&offlineState?.players?.[0]){
  const p=offlineState.players[0];p.levelPoints=Math.max(0,(p.levelPoints||0)-1);
  p.levelUpgrades=p.levelUpgrades||{};p.levelUpgrades[id]=(Number(p.levelUpgrades[id])||0)+1;
  if(id==='health'){p.maxHp=(p.maxHp||100)+12;p.hp=Math.min(p.maxHp,(p.hp||0)+12);}
  if(id==='mana')p.maxMana=(p.maxMana||100)+15;
  if(id==='power')p.levelPower=(p.levelPower||0)+1;
  if(id==='recovery')p.levelRecovery=(p.levelRecovery||0)+1;
  updateLevelHud(p);showNotice('Melhoria aplicada: '+item.name+'.');return;
 }
 if(!ws||ws.readyState!==WebSocket.OPEN){showNotice('Conecte-se à partida para melhorar o personagem.');return;}
 send({type:'levelUpgrade',upgrade:id});
}
$('levelToggleBtn')?.addEventListener('click',()=>{const panel=$('levelPanel');if(!panel)return;panel.classList.toggle('hidden');updateLevelHud();});
$('levelCloseBtn')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();$('levelPanel')?.classList.add('hidden');updateLevelHud();document.activeElement?.blur?.();});

function updateState(m) {
  currentSafeZoneUntil = Math.max(0, Number(m.safeZoneUntil) || 0);
  syncMapTrapVisuals(m.openTraps||[]);
  syncMapHazardLayout(m.mapHazards||[]);
  syncUnderworldVisuals(m.underworldPits||[]);
  activeGameMode = m.gameMode === 'pvp_rpg' ? 'pvp_rpg' : 'coop';
  const localLevelPlayer=(m.players||[]).find(p=>String(p.id)===String(playerId));
  if(localLevelPlayer){
    updateLevelHud(localLevelPlayer);
    const poisonHud=$('poisonHud'),poisonSeconds=Math.max(0,Math.ceil(((Number(localLevelPlayer.poisonUntil)||0)-Date.now())/1000));
    if(poisonHud){poisonHud.classList.toggle('hidden',poisonSeconds<=0);poisonHud.textContent=poisonSeconds>0?'☣ ENVENENADO · '+poisonSeconds+'s':' ';}
    if(myPlayer){
      const guarding=Date.now()<(Number(localLevelPlayer.stoneGuardUntil)||0);
      myPlayer.rotation.x=guarding?-Math.PI/2:0;
      myPlayer.position.y=getDungeonFloorHeight(myPlayer.position.x,myPlayer.position.z)+(guarding?-.38:0);
    }
  }else if(offlineMode)updateLevelHud();
  const progressRealm=Math.max(1,Math.min(3,Number(m.realm)||1)),progressPhase=Math.max(1,Math.min(5,Number(m.phase)||1));
  updateDungeonPhaseVisibility(progressPhase);
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
          myPlayer.position.set(p.x,getDungeonFloorHeight(p.x,p.z),p.z);
          myPlayer.rotation.y = p.rot || 0;
          appliedInitialServerPosition = true;
        } else {
          const dx = p.x - myPlayer.position.x;
          const dz = p.z - myPlayer.position.z;
          if (Math.abs(dx) > 1.6) myPlayer.position.x += dx * 0.12;
          if (Math.abs(dz) > 1.6) myPlayer.position.z += dz * 0.12;
        }
        const localGuarding=Date.now()<(Number(p.stoneGuardUntil)||0);
        myPlayer.rotation.x=localGuarding?-Math.PI/2:0;
        myPlayer.position.y=getDungeonFloorHeight(myPlayer.position.x,myPlayer.position.z)+(localGuarding?-.38:0);
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
    const remoteGuarding=Date.now()<(Number(p.stoneGuardUntil)||0);
    obj.rotation.x=remoteGuarding?-Math.PI/2:0;
    obj.userData.targetY = getDungeonFloorHeight(p.x,p.z)+(remoteGuarding?-.38:0);
    obj.userData.serverHp = p.hp ?? 100;
    setHealthBar(obj, obj.userData.serverHp, p.maxHp ?? p.maxHP ?? 100);
    setHeroInvisible(obj, !!p.invisible);
    setHeroShielded(obj, !!p.shielded);
    if (obj.userData.playerClass !== (p.playerClass || 'knight') || obj.userData.skin !== (p.skin || 'default')) {
      const replacement = makeHero(p.color, p.playerClass || 'knight', p.skin || 'default');
      replacement.userData.targetX = p.x; replacement.userData.targetZ = p.z; replacement.userData.targetRot = p.rot;
      replacement.userData.targetY = getDungeonFloorHeight(p.x,p.z)+(remoteGuarding?-.38:0);
      replacement.rotation.x=remoteGuarding?-Math.PI/2:0;
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
    if (!obj || (!!obj.userData.isGuardianSpirit !== isGuardianSpirit) || (!!obj.userData.isStoneFragment !== isGolemClone) || (!isGuardianSpirit && !isGolemClone && obj.userData.playerClass !== summonClass)) {
      if (obj) { scene.remove(obj); disposeObject3D(obj); }
      obj = isGuardianSpirit
        ? makeGuardianSpirit(summon.color || 0x8cffe8)
        : isGolemClone ? makeStoneFragment(summon.color || 0x858d91)
        : makeHero(summon.color || (isSkeleton ? 0xe0dccb : 0x80c86b), summonClass, isSkeleton ? 'shadow' : 'default');
      obj.userData.isGuardianSpirit = isGuardianSpirit;
      obj.userData.isStoneFragment = isGolemClone;
      obj.userData.playerClass = isGuardianSpirit ? 'guardian_spirit' : summonClass;
      obj.userData.skin = summon.skin || (isSkeleton ? 'shadow' : 'default');
      scene.add(obj); remotePlayers.set(id, obj);
    }
    obj.userData.targetX = summon.x;
    obj.userData.targetZ = summon.z;
    obj.userData.targetY = getDungeonFloorHeight(summon.x,summon.z);
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
  updateDungeonPhaseVisibility(phase);
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
    else if(phase===5&&m.boss&&!m.boss.alive&&realm===2)phaseObjective.textContent='PORTAL DO MUNDO INVERTIDO LIBERADO! Atravesse a passagem';
    else if(phase===5)phaseObjective.textContent=realm===2?'Derrote o Guardião Astral':realm===3?'Derrote o Soberano do Mundo Invertido':'Derrote o Guardião Supremo';
    else phaseObjective.textContent=realm===2?'Derrote os inimigos astrais e avance':realm===3?'MUNDO INVERTIDO · Sobreviva às regiões corrompidas':'Derrote os monstros e atravesse o portão da região';
  }
  if(phaseLabel)phaseLabel.textContent=isPvpRpg?'⚔ ARENA LIVRE · PRIMEIRO A 10 KOs':realm===3?'MUNDO INVERTIDO · FASE '+phase+' / 5':realm===2?'VALE ASTRAL · FASE '+phase+' / 5':'MUNDO MONOCROMÁTICO · FASE '+phase+' / 5';
  const bossPanel = $('bossPanel');
  if (bossPanel) bossPanel.classList.toggle('hidden', isPvpRpg || phase !== 5 || !m.boss || !m.boss.alive);
  bossData = m.boss || null;
  syncBossPortals(bossData && bossData.alive ? bossData.portals : []);
  syncBossTelegraphs(bossData && bossData.alive ? bossData.telegraphs : []);
  if (bossData && bossData.alive) {
    const bossTitle=document.querySelector('.boss-title');
    if(bossTitle)bossTitle.textContent=realm===3?'SOBERANO DO MUNDO INVERTIDO':realm===2?'GUARDIÃO ASTRAL':'GUARDIÃO DO ABISMO';
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
  const nearbyChest = latestChests.find(chest => !isChestClaimedByLocal(chest) && myPlayer && Math.hypot(chest.x - myPlayer.position.x, chest.z - myPlayer.position.z) <= 3.4);
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
      scene.add(obj);
      chestMeshes.set(chest.id, obj);
    }
    obj.userData.chestId = chest.id;
    obj.position.set(chest.x,getDungeonFloorHeight(chest.x,chest.z),chest.z);
    obj.visible = !isChestClaimedByLocal(chest);
  }

  let alive = 0;
  for (const mtr of m.monsters) {
    if (mtr.alive) alive++;
    // Monstros ainda na contagem regressiva não são desenhados antes do spawn.
    if (mtr.spawned === false) {
      const waitingMesh = monsterMeshes.get(mtr.id);
      if (waitingMesh) waitingMesh.visible = false;
      continue;
    }

    let obj = monsterMeshes.get(mtr.id);
    if (!obj) {
      const summonClass = mtr.pvpSummoned && ['goblin','skeleton','golem_clone'].includes(mtr.summonClass) ? mtr.summonClass : null;
      obj = summonClass
        ? makeHero(mtr.color || null, summonClass, mtr.skin || 'default')
        : makeMonster(mtr.kind || 'stalker', mtr.phase || phase, mtr);
      if (summonClass) obj.userData.pvpSummonHero = true;
      scene.add(obj);
      monsterMeshes.set(mtr.id, obj);
    }

    obj.userData.targetX = mtr.x;
    obj.userData.targetZ = mtr.z;
    obj.userData.targetY = mtr.trapId ? -2.55 : getDungeonFloorHeight(mtr.x,mtr.z);
    obj.userData.trapId = mtr.trapId || null;
    obj.userData.kind = mtr.kind || 'stalker';
    obj.userData.name = mtr.name || (mtr.upperElite?'Guardião do Andar Superior':'');
    obj.userData.eliteTier = Number(mtr.eliteTier)||0;
    obj.userData.eliteAffix = String(mtr.affix||'');
    obj.userData.trainingDummy = !!mtr.trainingDummy;
    obj.userData.trainingAttacker = !!mtr.trainingAttacker;
    obj.userData.trainingWarningUntil = Number(mtr.trainingWarningUntil) || 0;
    if (mtr.trainingAttacker && mtr.attackAnimAt && obj.userData.lastTrainingAttackAt !== mtr.attackAnimAt) {
      obj.userData.lastTrainingAttackAt = mtr.attackAnimAt;
      obj.userData.attackAnim = .48;
    }
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

let dashTimer = 0;
function dash() {
  if (!started || dashTimer > 0 || !myPlayer || (myPlayer.userData.serverHp ?? 100) <= 0) return;
  dashTimer = Math.max(1.8, 3.0 - (unlockedSkills.has('quick_recovery') ? .55 : 0));
  const input=moveInput();
  const forwardX=-Math.sin(yaw),forwardZ=-Math.cos(yaw);
  const rightX=Math.cos(yaw),rightZ=-Math.sin(yaw);
  let dx=rightX*input.x-forwardX*input.y;
  let dz=rightZ*input.x-forwardZ*input.y;
  let length=Math.hypot(dx,dz);
  if(length<.08){dx=forwardX;dz=forwardZ;length=1;}
  dx/=length;dz/=length;
  const distance=3.0+(unlockedSkills.has('dodge_mastery') ? .35 : 0)+(unlockedSkills.has('phantom_step') ? .45 : 0);
  const landing=resolveDungeonMovement(myPlayer.position.x,myPlayer.position.z,
    myPlayer.position.x+dx*distance,myPlayer.position.z+dz*distance);
  if(Math.hypot(landing.x-myPlayer.position.x,landing.z-myPlayer.position.z)<.35){
    showNotice('Não há espaço para avançar com o dash.');
    dashTimer=.35;
    return;
  }
  myPlayer.position.x=landing.x;myPlayer.position.z=landing.z;
  myPlayer.userData.dodgeAnim=.24;
  if(offlineMode&&offlineState?.players?.[0])offlineState.players[0].dodgeUntil=Date.now()+250;
  send({type:'dash',dx,dz});
  vibrateGame(24);playSfx('dodge');showNotice('⚡ DASH');
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
    const initialSafeUntil=Date.now()+22000;
    offlineState.safeZoneUntil=initialSafeUntil;
    offlineState.monsters.forEach((monster,index)=>{
      if(monster.trainingDummy)return;
      monster.spawned=false;monster.spawnAt=initialSafeUntil+index*3400;
    });
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
    { ability: 'monk_impact_palm', icon: '👊', label: 'PALMA', description: 'Onda de choque: 12 de dano, empurra e atordoa inimigos.', cooldown: 18 },
    { ability: 'monk_winged_steps', icon: '🪽', label: 'PASSOS', description: 'Avança com uma onda de impacto, causa 10 de dano e ganha velocidade.', cooldown: 15 },
    { ability: 'monk_spirit_wave', icon: '☯', label: 'ONDA ESPIRITUAL', description: 'Libera uma onda espiritual à frente do Monge e causa 16 de dano.', cooldown: 13 }
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
  monk:{glyph:'✊',accent:'#f4cf85',tag:'COMBATE E ENERGIA'},
  golem:{glyph:'⬟',accent:'#aeb9c2',tag:'DEFESA TITÂNICA'}
};
const CLASS_DEMO_STATS = {
  knight_shield:{result:'0 dano · bloqueia 65% do dano',kind:'guard'},
  knight_dash:{result:'5 dano por inimigo',kind:'mobility'},
  knight_whirlwind:{result:'11 dano em área',kind:'area'},
  fire:{result:'2 × poder mágico + queimadura',kind:'projectile'},
  lightning:{result:'1,5 × poder mágico por alvo',kind:'chain'},
  mage_arcane_orb:{result:'3,2 × poder mágico + explosão',kind:'projectile'},
  arrow_rain:{result:'5 dano por inimigo',kind:'area'},
  incendiary_arrows:{result:'3,5 dano + queimadura',kind:'area'},
  archer_piercing_shot:{result:'18 dano',kind:'projectile'},
  goblin_invis:{result:'0 dano · invisível por 5 s',kind:'stealth'},
  goblin_summon:{result:'2 aliados · 3 dano por golpe',kind:'summon'},
  goblin_shadow_strike:{result:'16 dano + invisibilidade breve',kind:'mobility'},
  ogre_slam:{result:'5–7 dano em área',kind:'area'},
  ogre_haste:{result:'0 dano · velocidade por 5 s',kind:'buff'},
  ogre_earthquake:{result:'8 dano em área',kind:'area'},
  healer_cure:{result:'+50 HP',kind:'heal'},
  healer_guardian_spirits:{result:'+5 HP / 4 s · 9 dano / 5 s',kind:'summon'},
  healer_light_orb:{result:'+28 HP',kind:'heal'},
  necromancer_summon:{result:'5 esqueletos · 2 dano por golpe',kind:'summon'},
  necromancer_dive:{result:'0 dano direto · cria 1 esqueleto',kind:'mobility'},
  necromancer_bone_bolt:{result:'1,8 × poder da magia óssea',kind:'projectile'},
  monk_impact_palm:{result:'12 dano + empurrão',kind:'area'},
  monk_winged_steps:{result:'10 dano no avanço + velocidade por 5 s',kind:'mobility'},
  monk_spirit_wave:{result:'16 dano em área',kind:'area'},
  golem_split:{result:'0 dano direto · 3 fragmentos',kind:'summon'},
  golem_rock_toss:{result:'15 dano + estilhaços',kind:'area'},
  golem_stone_guard:{result:'0 dano · armadura por 6,5 s',kind:'guard'}
};
const CLASS_DEMO_STEP_MS = 3600;
const CLASS_DEMO_DAMAGE = {
  knight_shield:0,knight_dash:10,knight_whirlwind:26,
  fire:22,lightning:20,mage_arcane_orb:30,
  arrow_rain:18,incendiary_arrows:16,archer_piercing_shot:34,
  goblin_invis:0,goblin_summon:12,goblin_shadow_strike:25,
  ogre_slam:15,ogre_haste:0,ogre_earthquake:20,
  healer_cure:0,healer_guardian_spirits:18,healer_light_orb:0,
  necromancer_summon:18,necromancer_dive:0,necromancer_bone_bolt:30,
  monk_impact_palm:12,monk_winged_steps:10,monk_spirit_wave:16,
  golem_split:18,golem_rock_toss:34,golem_stone_guard:0
};

function drawClassDemoAbilityEffect(ctx, abilityId, t, heroX, enemyX, ground, accent) {
  const p = Math.max(0, Math.min(1, (t - 260) / 1160));
  const travelX = heroX + 54 + (enemyX - heroX - 100) * p;
  const travelY = ground - 104 - Math.sin(p * Math.PI) * 28;
  const pulse = .55 + Math.sin(t * .018) * .22;
  const color = accent || '#e9c477';
  const line = (points, width, stroke, alpha = 1) => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = stroke; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
    points.forEach((point,index)=>index?ctx.lineTo(point[0],point[1]):ctx.moveTo(point[0],point[1]));
    ctx.stroke(); ctx.restore();
  };
  const orb = (x,y,r,fill,alpha=1) => {
    ctx.save();ctx.globalAlpha=alpha;ctx.shadowBlur=18;ctx.shadowColor=fill;
    const g=ctx.createRadialGradient(x-r*.28,y-r*.32,1,x,y,r);
    g.addColorStop(0,'#ffffff');g.addColorStop(.25,fill);g.addColorStop(1,'#18263a');
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();
  };
  const arrow = (x,y,angle,fill,scale=1) => {
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(scale,scale);
    ctx.strokeStyle=fill;ctx.lineWidth=3;ctx.lineCap='round';ctx.shadowBlur=10;ctx.shadowColor=fill;
    ctx.beginPath();ctx.moveTo(-24,0);ctx.lineTo(19,0);ctx.stroke();
    ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(24,0);ctx.lineTo(12,-7);ctx.lineTo(12,7);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(-19,0);ctx.lineTo(-27,-7);ctx.moveTo(-19,0);ctx.lineTo(-27,7);ctx.stroke();
    ctx.restore();
  };
  const ring = (x,y,r,stroke,width=4,alpha=1) => {
    ctx.save();ctx.globalAlpha=alpha;ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.shadowBlur=12;ctx.shadowColor=stroke;
    ctx.beginPath();ctx.ellipse(x,y,r,r*.38,0,0,Math.PI*2);ctx.stroke();ctx.restore();
  };
  ctx.save();
  ctx.globalCompositeOperation='lighter';
  ctx.shadowBlur=14;ctx.shadowColor=color;
  switch(abilityId) {
    case 'knight_shield':
    case 'golem_stone_guard': {
      const x=heroX+40,y=ground-91;
      ctx.globalAlpha=.55+.3*p;
      ctx.fillStyle=abilityId==='knight_shield'?'#75cfff':'#aeb9c2';
      ctx.strokeStyle=abilityId==='knight_shield'?'#c5f3ff':'#e3e9ed';
      ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x,y-40);ctx.lineTo(x+25,y-28);ctx.lineTo(x+20,y+13);ctx.lineTo(x,y+34);ctx.lineTo(x-20,y+13);ctx.lineTo(x-25,y-28);ctx.closePath();ctx.fill();ctx.stroke();
      ring(heroX+4,ground-42,40+p*14,color,3,.45);
      break;
    }
    case 'knight_dash':
    case 'monk_winged_steps':
    case 'goblin_shadow_strike': {
      const dashColor=abilityId==='goblin_shadow_strike'?'#a78bfa':color;
      for(let i=0;i<5;i++){
        const start=heroX-35-i*13+(p*45);
        line([[start,ground-24-i*9],[start+48+p*46,ground-35-i*10]],2.5,dashColor,.5-i*.055);
      }
      if(abilityId==='monk_winged_steps'){
        for(const side of [-1,1]){
          ctx.save();ctx.globalAlpha=.75;ctx.strokeStyle='#ffe8a4';ctx.lineWidth=3;ctx.beginPath();
          ctx.moveTo(heroX+20,ground-86);ctx.quadraticCurveTo(heroX+side*58,ground-130,heroX+side*50,ground-171);ctx.stroke();ctx.restore();
        }
      }else if(abilityId==='goblin_shadow_strike'){
        line([[heroX+38,ground-90],[heroX+65,ground-108],[heroX+91,ground-88]],4,'#d7c4ff',.9);
      }else{
        ring(enemyX,ground-52,18+p*50,'#ffe5a5',5,.8);
      }
      break;
    }
    case 'knight_whirlwind': {
      for(let i=0;i<3;i++){
        ctx.save();ctx.globalAlpha=.85-i*.2;ctx.strokeStyle=i===1?'#fff0bc':color;ctx.lineWidth=5-i;
        ctx.beginPath();ctx.ellipse(heroX+42,ground-65,38+i*13,23+i*10,(t*.006)+i*.8,-.35,Math.PI*1.55);ctx.stroke();ctx.restore();
      }
      break;
    }
    case 'fire': {
      const flameX=travelX,flameY=travelY;
      for(let i=0;i<5;i++){
        const trailX=flameX-17-i*10,trailY=flameY+Math.sin(t*.03+i)*8;
        orb(trailX,trailY,5+(i%2)*2,'#ff7b28',.65-i*.09);
      }
      orb(flameX,flameY,13+pulse*5,'#ff6a21',.98);
      ctx.strokeStyle='#ffd47b';ctx.lineWidth=3;ctx.beginPath();ctx.arc(flameX,flameY,21+pulse*5,-1.1,1.2);ctx.stroke();
      break;
    }
    case 'lightning': {
      const endX=enemyX-18,endY=ground-110;
      const pts=[[heroX+46,ground-100],[heroX+95,ground-145],[heroX+126,ground-96],[heroX+181,ground-150],[heroX+220,ground-110],[heroX+270,ground-133],[endX,endY]];
      const visible=Math.max(2,Math.floor(2+p*5));
      line(pts.slice(0,visible),5,'#8ed9ff',.9);
      line(pts.slice(0,visible),1.6,'#ffffff',.95);
      if(p>.55) for(let i=0;i<3;i++)line([[enemyX-25,ground-108],[enemyX-48-i*8,ground-135-i*5]],2,'#b6e7ff',.72);
      break;
    }
    case 'mage_arcane_orb': {
      const x=travelX,y=travelY;
      ring(x,y,18+p*12,'#b7c9ff',3,.75);
      ring(x,y,26+p*7,'#e8bbff',2,.65);
      orb(x,y,12,'#7b8dff',1);
      for(let i=0;i<4;i++){const a=t*.008+i*Math.PI/2;orb(x+Math.cos(a)*25,y+Math.sin(a)*12,3,'#c4a7ff',.8);}
      break;
    }
    case 'arrow_rain':
    case 'incendiary_arrows': {
      for(let i=0;i<6;i++){
        const fall=Math.max(0,Math.min(1,p*1.45-i*.12));
        const x=enemyX-50+i*19,y=40+fall*(ground-120);
        if(abilityId==='incendiary_arrows'){
          line([[x-7,y+25],[x,y+8],[x+6,y-2]],3,'#ff7b37',.85);
          orb(x,y,5,'#ff722a',.88);
        }else arrow(x,y,-Math.PI/2,'#bfe6ff',.72);
      }
      break;
    }
    case 'archer_piercing_shot': {
      arrow(travelX,travelY,0,'#c9f1ff',1.35);
      line([[travelX-25,travelY-7],[travelX-60,travelY-13],[travelX-82,travelY-6]],2,'#9edaff',.75);
      break;
    }
    case 'goblin_invis': {
      for(let i=0;i<4;i++){
        const a=t*.004+i*Math.PI/2;
        orb(heroX+Math.cos(a)*32,ground-66+Math.sin(a)*29,5,'#9e83ff',.55);
      }
      ring(heroX+8,ground-55,26+p*30,'#ad8bff',3,.6);
      break;
    }
    case 'goblin_summon':
    case 'necromancer_summon':
    case 'golem_split': {
      const summonColor=abilityId==='goblin_summon'?'#9de86b':abilityId==='necromancer_summon'?'#bb8cff':'#aeb9c2';
      ring(heroX+85,ground-42,22+p*21,summonColor,4,.9);
      for(let i=0;i<3;i++){
        const x=heroX+55+i*29,y=ground-40-Math.sin(p*Math.PI+i*.7)*24;
        ctx.fillStyle=summonColor;ctx.globalAlpha=.35+.6*p;
        ctx.beginPath();ctx.arc(x,y-27,8,0,Math.PI*2);ctx.fill();
        ctx.fillRect(x-8,y-19,16,24);
        ctx.fillRect(x-12,y+2,7,13);ctx.fillRect(x+5,y+2,7,13);
      }
      if(abilityId==='golem_split')for(let i=0;i<5;i++){ctx.save();ctx.translate(heroX+18+i*15,ground-150-Math.sin(t*.01+i)*12);ctx.rotate(t*.003+i);ctx.fillStyle='#b9c1c8';ctx.fillRect(-5,-5,10,10);ctx.restore();}
      break;
    }
    case 'ogre_slam':
    case 'ogre_earthquake': {
      const x=abilityId==='ogre_slam'?heroX+35:enemyX;
      ring(x,ground-12,18+p*115,abilityId==='ogre_slam'?'#ffb06b':'#ff7c45',6,1-p*.45);
      for(let i=0;i<5;i++){
        const crackX=x-54+i*27;
        line([[crackX,ground-9],[crackX+12,ground-22-(i%2)*10],[crackX+24,ground-10]],2.5,'#ffd08a',.8);
      }
      break;
    }
    case 'ogre_haste': {
      for(let i=0;i<6;i++){
        const y=ground-25-i*17;
        line([[heroX-55, y],[heroX-10+p*38,y-7],[heroX+22+p*58,y]],3,'#ffd083',.48);
      }
      ring(heroX+4,ground-12,22+p*22,'#ffbc78',2,.5);
      break;
    }
    case 'healer_cure':
    case 'healer_light_orb': {
      if(abilityId==='healer_light_orb'){
        orb(travelX,travelY,13,'#67f2b8',1);
        ring(travelX,travelY,21,'#b3ffe1',2,.7);
      }else{
        for(let i=0;i<3;i++)ring(heroX+6,ground-73,20+p*33+i*12,'#74f2bd',3,.7-i*.16);
        ctx.fillStyle='#b9ffe3';ctx.font='bold 25px system-ui';ctx.fillText('+HP',heroX-8,ground-130-p*20);
      }
      break;
    }
    case 'healer_guardian_spirits':
    case 'healer_sanctuary': {
      const x=heroX+8,y=ground-88;
      if(abilityId==='healer_sanctuary'){
        ctx.save();ctx.globalAlpha=.45;ctx.strokeStyle='#79f7c4';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y+18,24+p*90,Math.PI,Math.PI*2);ctx.stroke();ctx.restore();
      }
      for(let i=0;i<3;i++){const a=t*.006+i*Math.PI*2/3;orb(x+Math.cos(a)*42,y+Math.sin(a)*20,7,'#81ffcc',.95);}
      break;
    }
    case 'necromancer_dive': {
      const x=heroX+7,y=ground-12;
      ring(x,y,12+p*47,'#ac83ff',5,.8);
      ring(x,y,21+p*28,'#4c347c',3,.6);
      for(let i=0;i<5;i++){const a=t*.01+i*1.25;orb(x+Math.cos(a)*(8+p*25),y+Math.sin(a)*(5+p*14),4,'#9c75ee',.75);}
      break;
    }
    case 'necromancer_bone_bolt': {
      const x=travelX,y=travelY;
      line([[x-31,y+7],[x+25,y-5]],8,'#d8dce8',.95);
      for(let i=0;i<4;i++){const px=x-16+i*12;line([[px,y+5],[px-5,y+15],[px+4,y+17]],3,'#f6f2e5',.9);}
      orb(x+22,y-5,5,'#ffffff',1);
      break;
    }
    case 'monk_impact_palm': {
      const x=heroX+52,y=ground-88;
      for(let i=0;i<3;i++)ring(x+40,y,20+p*65+i*13,'#ffe3a0',5-i,.85-i*.18);
      line([[x-6,y],[x+20,y-14],[x+40,y],[x+20,y+14]],4,'#fff0bd',.95);
      break;
    }
    case 'monk_spirit_wave': {
      for(let i=0;i<4;i++){
        ctx.save();ctx.globalAlpha=.75-i*.13;ctx.strokeStyle=i%2?'#fff1bb':'#f4cf85';ctx.lineWidth=5-i;
        ctx.beginPath();ctx.ellipse(heroX+65+p*105,ground-90,28+i*12,44+i*11,0,Math.PI*1.18,Math.PI*1.82);ctx.stroke();ctx.restore();
      }
      break;
    }
    case 'golem_rock_toss': {
      const x=enemyX-4,y=50+p*(ground-135);
      ctx.save();ctx.translate(x,y);ctx.rotate(p*5);ctx.fillStyle='#8d969e';ctx.beginPath();ctx.moveTo(-18,-7);ctx.lineTo(-8,-24);ctx.lineTo(14,-20);ctx.lineTo(22,1);ctx.lineTo(6,18);ctx.lineTo(-19,13);ctx.closePath();ctx.fill();ctx.strokeStyle='#d7e0e6';ctx.lineWidth=2;ctx.stroke();ctx.restore();
      if(p>.7)ring(enemyX,ground-10,18+(p-.7)*180,'#c9d3db',4,1-p);
      break;
    }
    default: {
      ring(enemyX,ground-65,18+p*46,color,5,.9);
      orb(travelX,travelY,9,color,.9);
    }
  }
  ctx.restore();
}

function drawClassDemoCanvas(canvas, ability, stats, visual, elapsed) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;
  const W = canvas.width || 760, H = canvas.height || 250;
  const t = Math.max(0, elapsed % CLASS_DEMO_STEP_MS);
  const damage = Math.max(0, Number(CLASS_DEMO_DAMAGE[ability.ability]) || 0);
  const impact = Math.max(0, Math.min(1, (t - 980) / 430));
  const easing = impact * impact * (3 - 2 * impact);
  const health = Math.max(0.12, 1 - (damage / 100) * easing);
  const accent = visual.accent || '#e9c477';
  const heroX = 142 + (damage > 0 ? Math.sin(Math.min(1, t / 980) * Math.PI) * 34 : 0);
  const ground = H - 30;
  const enemyX = 552 + (impact > 0 ? impact * 16 : 0);
  ctx.clearRect(0, 0, W, H);

  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#101e31');
  sky.addColorStop(.62, '#1b3040');
  sky.addColorStop(1, '#111a22');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#243445'; ctx.globalAlpha = .72;
  for (let i = 0; i < 5; i++) {
    const x = i * 178 - 22;
    ctx.beginPath(); ctx.moveTo(x, ground); ctx.lineTo(x + 36, 74 + (i % 2) * 25);
    ctx.lineTo(x + 72, ground); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0a111b'; ctx.fillRect(0, ground, W, H - ground);
  ctx.fillStyle = '#75654e'; ctx.fillRect(0, ground, W, 4);
  ctx.fillStyle = '#3f3a35';
  for (let x = 0; x < W; x += 76) {
    ctx.fillRect(x + 5, ground + 10, 46, 2);
    ctx.fillStyle = '#967d5a'; ctx.fillRect(x + 22, ground + 17, 2, 2);
    ctx.fillStyle = '#3f3a35';
  }

  // Backlit columns and small braziers make the scene read as a side-view RPG arena.
  for (const x of [42, 715]) {
    ctx.fillStyle = '#364353'; ctx.fillRect(x, 54, 17, ground - 54);
    ctx.fillStyle = '#697184'; ctx.fillRect(x - 7, 52, 31, 6);
    ctx.fillRect(x - 4, ground - 5, 25, 7);
    ctx.fillStyle = '#e6a95c'; ctx.beginPath(); ctx.arc(x + 8, 43, 5 + Math.sin(t * .012) * 1.5, 0, Math.PI * 2); ctx.fill();
  }

  // The class character is drawn as a small readable 2D adventurer sprite.
  ctx.save(); ctx.translate(heroX, ground);
  const bob = Math.sin(t * .009) * 2;
  ctx.translate(0, bob);
  ctx.fillStyle = '#080d15a8'; ctx.beginPath(); ctx.ellipse(0, -1, 31, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#262b38';
  ctx.fillRect(-17, -39, 12, 31); ctx.fillRect(5, -39, 12, 31);
  ctx.fillStyle = '#b8c2ce'; ctx.fillRect(-20, -11, 17, 8); ctx.fillRect(3, -11, 18, 8);
  ctx.fillStyle = '#182636'; ctx.beginPath(); ctx.moveTo(-25, -82); ctx.lineTo(25, -82); ctx.lineTo(21, -37); ctx.lineTo(-19, -37); ctx.closePath(); ctx.fill();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.moveTo(-23, -80); ctx.lineTo(0, -73); ctx.lineTo(22, -80); ctx.lineTo(16, -48); ctx.lineTo(-17, -48); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8edf2'; ctx.fillRect(-4, -75, 8, 26);
  ctx.fillStyle = '#d3a77b'; ctx.beginPath(); ctx.arc(0, -99, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#202c3d'; ctx.beginPath(); ctx.moveTo(-16, -99); ctx.lineTo(-12, -119); ctx.lineTo(7, -124); ctx.lineTo(17, -104); ctx.lineTo(13, -94); ctx.lineTo(-15, -94); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d9e4ed'; ctx.fillRect(-13, -104, 26, 5);
  ctx.fillStyle = '#18212e'; ctx.fillRect(4, -102, 4, 3);

  const poseProgress = Math.max(0, Math.min(1, (t - 240) / 700));
  const casting = Math.sin(poseProgress * Math.PI);
  const rangedPose = ['fire','lightning','mage_arcane_orb','arrow_rain','incendiary_arrows','archer_piercing_shot','healer_light_orb','necromancer_bone_bolt'].includes(ability.ability);
  const handX = rangedPose ? 37 + casting * 13 : 30 + casting * 19;
  const handY = rangedPose ? -86 : -62 - casting * 16;
  ctx.strokeStyle = '#d3a77b'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(15, -72); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(handX, handY, rangedPose ? 7 : 6, 0, Math.PI * 2); ctx.fill();
  if (rangedPose) {
    ctx.strokeStyle = accent; ctx.lineWidth = selectedClass === 'archer' ? 3 : 5;
    ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(handX + 12, handY - 14); ctx.stroke();
    if (['fire','lightning','mage_arcane_orb','healer_light_orb','necromancer_bone_bolt'].includes(ability.ability)) {
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(handX + 14, handY - 17, 5 + casting * 3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (['knight_whirlwind','knight_dash','goblin_shadow_strike','monk_impact_palm','monk_winged_steps','monk_spirit_wave'].includes(ability.ability)) {
    ctx.strokeStyle = selectedClass === 'monk' ? '#f4cf85' : '#d9e3ec'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(handX, handY); ctx.lineTo(handX + 19 + casting * 7, handY - 20); ctx.stroke();
  }
  ctx.restore();

  // A broad-shouldered training monster with horns, face, arms and feet.
  ctx.save(); ctx.translate(enemyX, ground);
  const recoil = impact > .12 ? Math.sin(impact * Math.PI) * 5 : 0;
  ctx.translate(0, recoil);
  ctx.fillStyle = '#090d14a8'; ctx.beginPath(); ctx.ellipse(0, -1, 47, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#344b45'; ctx.fillRect(-26, -43, 18, 39); ctx.fillRect(8, -43, 18, 39);
  ctx.fillStyle = '#1b2c31'; ctx.fillRect(-31, -9, 23, 8); ctx.fillRect(7, -9, 25, 8);
  ctx.fillStyle = '#496b57'; ctx.beginPath(); ctx.moveTo(-39, -112); ctx.lineTo(-30, -57); ctx.lineTo(-23, -41); ctx.lineTo(25, -41); ctx.lineTo(34, -72); ctx.lineTo(39, -106); ctx.lineTo(23, -125); ctx.lineTo(-22, -125); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#618366'; ctx.beginPath(); ctx.arc(0, -130, 28, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e2d2b0'; ctx.beginPath(); ctx.moveTo(-20, -148); ctx.lineTo(-33, -168); ctx.lineTo(-7, -154); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(18, -148); ctx.lineTo(32, -167); ctx.lineTo(8, -154); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a2229'; ctx.fillRect(-17, -135, 10, 6); ctx.fillRect(7, -135, 10, 6);
  ctx.fillStyle = '#ff665e'; ctx.fillRect(-15, -134, 5, 3); ctx.fillRect(9, -134, 5, 3);
  ctx.strokeStyle = '#496b57'; ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-28, -99); ctx.lineTo(-47, -63); ctx.lineTo(-34, -52); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(28, -99); ctx.lineTo(48, -70); ctx.lineTo(38, -56); ctx.stroke();
  ctx.restore();

  drawClassDemoAbilityEffect(ctx, ability.ability, t, heroX, enemyX, ground, accent);
  if (damage > 0 && t >= 980 && t < 2450) {
    const pop = Math.min(1, (t - 980) / 220);
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1800) / 650);
    ctx.fillStyle = '#fff1bb'; ctx.font = '900 20px system-ui'; ctx.textAlign = 'center';
    ctx.shadowBlur = 12; ctx.shadowColor = accent;
    ctx.fillText('-' + damage + ' HP', enemyX, ground - 184 - pop * 12);
    ctx.restore();
  }

  // Monster health is reduced only by offensive abilities; support abilities keep it intact.
  const barX = 420, barY = 20, barW = 282, barH = 17;
  ctx.fillStyle = '#07101cdd'; ctx.fillRect(barX - 8, barY - 10, barW + 16, 51);
  ctx.fillStyle = '#e0e8ed'; ctx.font = '800 11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('VIDA DO MONSTRO', barX, barY + 1);
  ctx.fillStyle = '#1b2835'; ctx.fillRect(barX, barY + 9, barW, barH);
  const hpFill = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  hpFill.addColorStop(0, health > .55 ? '#5ce28b' : health > .28 ? '#f3bd53' : '#f35b62');
  hpFill.addColorStop(1, '#d6e8a5');
  ctx.fillStyle = hpFill; ctx.fillRect(barX + 2, barY + 11, Math.max(0, (barW - 4) * health), barH - 4);
  ctx.fillStyle = '#eaf1f5'; ctx.textAlign = 'right'; ctx.font = '900 11px system-ui';
  ctx.fillText(Math.round(health * 100) + '%', barX + barW, barY + 40);
  ctx.textAlign = 'left'; ctx.font = '900 10px system-ui'; ctx.fillStyle = accent;
  ctx.fillText(ability.label.toUpperCase(), 19, 23);
  ctx.fillStyle = '#c9d6df'; ctx.font = '10px system-ui';
  ctx.fillText(damage > 0 ? 'GOLPE · IMPACTO · DANO' : (stats.kind === 'heal' ? 'EFEITO DE SUPORTE' : 'HABILIDADE ESPECIAL'), 19, 40);
}

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
    const stage = root.querySelector('.class-demo-stage');
    const stats = CLASS_DEMO_STATS[ability.ability] || {result:'Efeito especial da classe',kind:'area'};
    root.dataset.ability = ability.ability;
    root.dataset.demoKind = stats.kind;
    if (stage) { stage.dataset.ability = ability.ability; stage.classList.remove('demo-replay'); void stage.offsetWidth; stage.classList.add('demo-replay'); }
    if (character) character.textContent = visual.glyph;
    if (icon) icon.textContent = ability.icon;
    if (name) name.textContent = ability.label;
    if (description) description.textContent = ability.description;
    if (classTag) classTag.textContent = visual.tag;
    const monster = $('classDemoMonster');
    const damage = $('classDemoDamage');
    const damageText = $('classDemoDamageText');
    const cooldownText = $('classDemoCooldownText');
    if (monster) monster.textContent = '👹';
    if (damage) damage.textContent = stats.result.startsWith('0 dano') ? 'EFEITO' : stats.result.startsWith('+') ? 'CURA' : '−HP';
    if (damageText) damageText.textContent = stats.result;
    if (cooldownText) cooldownText.textContent = (Number(ability.cooldown) || 0).toLocaleString('pt-BR') + ' s';
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
  const canvas = $('classDemoCanvas');
  if (canvas) drawClassDemoCanvas(canvas, ability, CLASS_DEMO_STATS[ability.ability] || {result:'Efeito especial da classe',kind:'area'}, visual, elapsed);
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
setInterval(() => updateClassAbilityDemo(false), 33);
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
  const size = landscape ? 58 : 54;
  for (const btn of [fire,lightning,third]) {
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.setProperty('position', 'fixed', 'important');
    btn.style.setProperty('visibility', 'visible', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('pointer-events', 'auto', 'important');
    btn.style.setProperty('z-index', '24', 'important');
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
    fire.style.setProperty('bottom', '82px', 'important');
    lightning.style.setProperty('right','12px','important');
    lightning.style.setProperty('bottom','150px','important');
    third.style.setProperty('right','12px','important');
    third.style.setProperty('bottom','218px','important');
    third.style.setProperty('width','58px','important');
    third.style.setProperty('height','58px','important');
  }
  applySavedHudPositions();
}

const HUD_MOVABLE_IDS=['joystick','chestBtn','dodgeBtn','attackBtn','fireBtn','lightningBtn','ability3Btn','inventoryToggleBtn','skillToggleBtn','settingsBtn','orientationToggleBtn','leaveBtn'];
let hudEditMode = false;
let hudDragState = null;
let hudLayout = {};
try {
  const hudLayoutVersion = localStorage.getItem('ultimoLegadoHudLayoutVersion');
  if (hudLayoutVersion !== '5') {
    localStorage.removeItem('ultimoLegadoHudLayout');
    localStorage.setItem('ultimoLegadoHudLayoutVersion', '5');
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
      const viewport=getEffectiveViewport();
      const maxX = Math.max(0, viewport.width - el.offsetWidth);
      const maxY = Math.max(0, viewport.height - el.offsetHeight);
      el.style.setProperty('position', 'fixed', 'important');
      el.style.setProperty('left', Math.round(viewport.left + Math.max(0, Math.min(1, saved.x)) * maxX) + 'px', 'important');
      el.style.setProperty('top', Math.round(viewport.top + Math.max(0, Math.min(1, saved.y)) * maxY) + 'px', 'important');
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
  const viewport=getEffectiveViewport();
  const x = Math.max(viewport.left, Math.min(viewport.left + viewport.width - el.offsetWidth, event.clientX - dx));
  const y = Math.max(viewport.top, Math.min(viewport.top + viewport.height - el.offsetHeight, event.clientY - dy));
  el.style.setProperty('left', Math.round(x) + 'px', 'important');
  el.style.setProperty('top', Math.round(y) + 'px', 'important');
}, true);
function finishHudDrag(event) {
  if (!hudDragState || (event && event.pointerId !== hudDragState.pointerId)) return;
  const { el } = hudDragState;
  const rect = el.getBoundingClientRect();
  const viewport=getEffectiveViewport();
  const maxX = Math.max(1, viewport.width - rect.width);
  const maxY = Math.max(1, viewport.height - rect.height);
  const key = hudOrientationKey();
  if (!hudLayout[key]) hudLayout[key] = {};
  hudLayout[key][el.id] = {
    x: Math.max(0, Math.min(1, (rect.left - viewport.left) / maxX)),
    y: Math.max(0, Math.min(1, (rect.top - viewport.top) / maxY))
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
  gameSettings.verticalSensitivity = clampSetting(e.target.value, 0.25, 1.2, 0.45);
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
  pitch = targetPitch = THREE.MathUtils.clamp(Number(pitch) || .18, -.52, .52);
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
  gameSettings.verticalSensitivity = clampSetting(e.target.value, 0.25, 1.2, 0.45);
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
  if (!offlineMode && (!ws || ws.readyState !== WebSocket.OPEN)) { showNotice('Conexão indisponível. Reconecte antes de lançar magia.'); return; }
  if (activeGameMode !== 'pvp_rpg' && Date.now() < currentSafeZoneUntil) { showNotice('A magia será liberada quando a zona segura terminar.'); return; }
  const spec=Object.values(CLASS_ABILITY_CONFIG).flat().find(item=>(item.spellType||item.ability)===kind||item.ability===kind);
  const slot=(CLASS_ABILITY_CONFIG[selectedClass]||[]).findIndex(item=>(item.spellType||item.ability)===kind||item.ability===kind);
  const manaCost={fire:26,lightning:22,arcane:30,bone:26,healing:22}[kind]||22;
  const currentMana=offlineMode?Number(offlineState?.players?.[0]?.mana??100):Number(myPlayer?.userData.serverMana??100);
  if(currentMana<manaCost){showNotice('✦ Mana insuficiente! Espere regenerar.');return;}
  const cooldown=slot===0?fireCooldown:slot===1?lightningCooldown:thirdCooldown;
  if(cooldown>0)return;
  const value=spec?.cooldown??(kind==='fire'?4:kind==='lightning'?3.5:9);
  if(slot===0)fireCooldown=value;else if(slot===1)lightningCooldown=value;else thirdCooldown=value;
  // O efeito de lançamento aparece na hora; o servidor confirma os alvos e o dano.
  vibrateGame(kind === 'fire' ? 18 : 24);
  playSfx(kind==='fire'?'fire':'lightning');
  const palette={
    fire:{color:0xff6b24,geo:new THREE.SphereGeometry(.24,10,8),duration:680,arc:.85,spin:7},
    lightning:{color:0x69aaff,geo:new THREE.TorusKnotGeometry(.17,.035,32,5,2,3),duration:280,arc:.22,spin:19},
    arcane:{color:0x68baff,geo:new THREE.DodecahedronGeometry(.25,1),duration:620,arc:.65,spin:5},
    bone:{color:0xf3f5ff,geo:new THREE.ConeGeometry(.16,.56,7),duration:540,arc:.36,spin:9},
    healing:{color:0x73ffc1,geo:new THREE.IcosahedronGeometry(.23,1),duration:650,arc:.55,spin:4}
  };
  const selected=palette[kind]||palette.lightning,color=selected.color,geo=selected.geo;
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .98, wireframe:kind==='bone' });
  const projectile = new THREE.Mesh(geo, material);
  const origin = myPlayer ? myPlayer.position.clone() : new THREE.Vector3();
  origin.y += kind==='healing' ? 1.55 : 1.28;
  projectile.position.copy(origin);
  if(kind==='bone') projectile.rotation.x=-Math.PI/2;
  scene.add(projectile);
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
  let destination = origin.clone().add(forward.clone().multiplyScalar(kind==='lightning'?9:kind==='arcane'?11:8));
  let bestDistance=Infinity;
  if(kind==='healing'){
    for(const ally of remotePlayers.values()){
      const hp=Number(ally.userData.serverHp),max=Number(ally.userData.serverMaxHp)||100;
      if(!Number.isFinite(hp)||hp>=max)continue;
      const d=ally.position.distanceTo(myPlayer.position);
      if(d<bestDistance){bestDistance=d;destination=ally.position.clone().add(new THREE.Vector3(0,1.45,0));}
    }
  }else{
    for(const monster of monsterMeshes.values()){
      if(!monster.visible||Number(monster.userData.serverHp)<=0)continue;
      const target=new THREE.Vector3(Number(monster.userData.targetX??monster.position.x),1.1,Number(monster.userData.targetZ??monster.position.z));
      const delta=target.clone().sub(origin),distance=delta.length();
      if(distance<.8||distance>16)continue;
      const facing=delta.normalize().dot(forward);
      if(facing<.18||distance>=bestDistance)continue;
      bestDistance=distance;destination=target;
    }
  }
  const spellLimit = (isMobileDevice || gameSettings.graphicsQuality === 'low' || (lastFps > 0 && lastFps < 42)) ? 5 : gameSettings.graphicsQuality === 'high' ? 18 : 12;
  while (activeSpellEffects.length >= spellLimit) {
    const oldSpell = activeSpellEffects.shift();
    scene.remove(oldSpell.projectile);
    oldSpell.geo.dispose(); oldSpell.material.dispose();
  }
  activeSpellEffects.push({ projectile, geo, material, origin, destination, startedAt: performance.now(), duration: selected.duration, kind, arc:selected.arc, spin:selected.spin });
  send({type:'spell',spell:kind});
  showNotice(kind==='fire'?'🔥 MAGIA DE FOGO!':kind==='lightning'?'⚡ MAGIA DE RAIO!':kind==='bone'?'☽ ORBE ÓSSEO!':'✦ ORBE ARCANO!');
}
function activateClassAbility(slot) {
  if (!started || (myPlayer?.userData.serverHp ?? 100) <= 0) return;
  if (!offlineMode && (!ws || ws.readyState !== WebSocket.OPEN)) { showNotice('Conexão indisponível. Reconecte antes de usar habilidades.'); return; }
  if (activeGameMode !== 'pvp_rpg' && Date.now() < currentSafeZoneUntil) { showNotice('As habilidades ficam disponíveis quando a zona segura terminar.'); return; }
  const abilities = CLASS_ABILITY_CONFIG[selectedClass] || CLASS_ABILITY_CONFIG.knight;
  const spec=abilities[slot];
  if(!spec)return;
  const activeManaCosts={knight_shield:20,knight_dash:22,knight_whirlwind:28,arrow_rain:26,incendiary_arrows:30,archer_piercing_shot:28,goblin_invis:22,goblin_summon:38,goblin_shadow_strike:28,ogre_slam:26,ogre_haste:20,ogre_earthquake:36,healer_cure:24,healer_guardian_spirits:36,healer_sanctuary:34,necromancer_summon:42,necromancer_dive:24,monk_impact_palm:26,monk_winged_steps:24,monk_spirit_wave:32,golem_split:42,golem_rock_toss:30,golem_stone_guard:26};
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
  dash();
});

addEventListener('keydown', e => {
  // Não rouba teclas enquanto o jogador escreve ou altera uma configuração.
  if (e.target && e.target.closest && e.target.closest('input,textarea,select,button[contenteditable="true"]')) return;
  if (e.repeat) return;
  const code = e.code;
  if (['Space','KeyE','KeyR','KeyQ','KeyX','Digit1','Digit2','Digit3','KeyI','KeyK','KeyG','Escape'].includes(code)) e.preventDefault();
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
  else if (code === 'KeyQ' || code === 'KeyX') dash();
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
    targetPitch = THREE.MathUtils.clamp(targetPitch - dy * .0036 * gameSettings.verticalSensitivity, -.52, .52);
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
      if(effect.kind==='fallingRock'){
        effect.mesh.position.y=Math.max(.22,(1-progress)*7.5);effect.mesh.rotation.x+=dt*1.8;effect.mesh.rotation.z+=dt*2.1;effect.mesh.scale.setScalar(.75+Math.sin(progress*Math.PI)*.35);if(progress>.78)effect.mesh.material.opacity=Math.max(0,(1-progress)/.22);
      }else if(effect.kind==='signature'){
        const a=effect.ability;
        if(['knight_whirlwind','goblin_shadow_strike','ogre_haste','monk_spirit_wave','healer_guardian_spirits','necromancer_summon'].includes(a))effect.mesh.rotation.y+=dt*(a==='knight_whirlwind'?8:5);
        else if(['arrow_rain','incendiary_arrows','golem_rock_toss'].includes(a))effect.mesh.rotation.x+=dt*5;
        else effect.mesh.rotation.z+=dt*3.5;
        if(['arrow_rain','incendiary_arrows','golem_rock_toss'].includes(a))effect.mesh.position.y=effect.baseY-progress*(a==='golem_rock_toss'?5.9:2.8);
        if(['ogre_slam','ogre_earthquake','monk_impact_palm','monk_spirit_wave','knight_dash','monk_winged_steps','necromancer_dive'].includes(a))effect.mesh.scale.setScalar(.65+progress*2.0);
        else effect.mesh.scale.setScalar(.72+Math.sin(progress*Math.PI)*.55+progress*.28);
        effect.mesh.material.opacity=.86*(1-progress);
      }else{
        effect.mesh.scale.setScalar(.72+progress*.55);effect.mesh.material.opacity=.85*(1-progress);
      }
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
  dashTimer = Math.max(0, dashTimer - dt);
  const dodgeLabel = $('dodgeCooldown');
  if (dodgeLabel) {
    const dodgeText = dashTimer > 0 ? dashTimer.toFixed(1) + 's' : 'OK';
    if (dodgeLabel.textContent !== dodgeText) dodgeLabel.textContent = dodgeText;
  }
  const dodgeBtn = $('dodgeBtn');
  if (dodgeBtn) dodgeBtn.classList.toggle('cooling', dashTimer > 0);
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
      const levelMoveMultiplier=1+Math.min(.18,(Number(levelProgress.upgrades?.movement)||0)*.03);
      const moveSpeed = 5.8 * classMoveMultiplier * hasteMultiplier * (unlockedSkills.has('swift_step') ? 1.18 : 1) * levelMoveMultiplier;
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
    const heroType = myPlayer.userData.heroClass || selectedClass || 'knight';
    const gaitScale = heroType === 'goblin' ? 1.24 : heroType === 'ogre' || heroType === 'golem' ? .68 : heroType === 'monk' ? .92 : heroType === 'archer' ? 1.08 : 1;
    const bodyBounceScale = heroType === 'goblin' ? 1.3 : heroType === 'ogre' || heroType === 'golem' ? .55 : 1;
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
    updateHeroFaceAnimation(myPlayer, dt);
    updateHeroFaceAnimation(lobbyPreviewHero, dt);
    // 5) Passos alternados mais legíveis; 6) pose de esquiva temporária.
    for (const leg of myPlayer.userData.legs || []) {
      const legSwing = Math.sin(phase + (leg.side > 0 ? Math.PI : 0)) * .29 * gaitScale * stride;
      leg.mesh.rotation.x = legSwing + (myPlayer.userData.dodgeAnim > 0 ? (leg.side > 0 ? -.32 : .22) * dodgeLean : 0);
    }
    // 7) Braços fazem um movimento de preparação e golpe em vez de só balançar.
    for (const arm of myPlayer.userData.arms || []) {
      const swing = Math.sin(phase + (arm.side < 0 ? Math.PI : 0));
      const lead = arm.side > 0 ? 1 : .38;
      arm.mesh.rotation.x = swing * .18 * gaitScale * stride - attackWind * .48 * lead + attackHit * .82 * lead + dodgeLean * .12;
      arm.mesh.rotation.y = Math.sin(phase * .5 + arm.side) * .035 * stride;
      arm.mesh.rotation.z = (arm.side > 0 ? -.12 : .12) + Math.sin(phase + arm.side) * .018 * stride + attackHit * (arm.side > 0 ? -.20 : .06);
      if (arm.mesh.userData.elbow) {
        arm.mesh.userData.elbow.rotation.x = Math.max(0, swing) * .32 * stride - attackWind * .18 * lead + attackHit * .30 * lead;
      }
    }
    // 8) O personagem dá um pequeno impulso visual no impacto.
    myPlayer.position.y = (moving ? Math.abs(Math.sin(phase * 2)) * .008 * bodyBounceScale : 0) + attackHit * .045;
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
    if (myPlayer.userData.waistSigil) {
      myPlayer.userData.waistSigil.rotation.y += dt * (moving ? 1.2 : .45);
      const sigilPulse = 1 + Math.sin(phase*1.55+idleSeed)*.055;
      myPlayer.userData.waistSigil.scale.set(sigilPulse,sigilPulse,sigilPulse);
    }
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
    obj.position.y=THREE.MathUtils.lerp(obj.position.y,Number(obj.userData.targetY)||0,remoteSmooth);

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
    const remoteHeroType = obj.userData.heroClass || 'knight';
    const remoteGaitScale = remoteHeroType === 'goblin' ? 1.22 : remoteHeroType === 'ogre' || remoteHeroType === 'golem' ? .70 : remoteHeroType === 'monk' ? .92 : 1;
    for (const leg of obj.userData.legs || []) {
      leg.mesh.rotation.x = Math.sin(rp + (leg.side > 0 ? Math.PI : 0)) * .34 * remoteGaitScale * remoteStride;
    }
    for (const arm of obj.userData.arms || []) {
      const swing = Math.sin(rp + (arm.side < 0 ? Math.PI : 0));
      arm.mesh.rotation.x = swing * .19 * remoteGaitScale * remoteStride;
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
    updateHeroFaceAnimation(obj, entityDt);
    if (obj.userData.capeTails) {
      for (const tail of obj.userData.capeTails) {
        tail.rotation.x = Math.sin(rp * .8 + tail.position.x) * (remoteMoving ? .07 : .012);
        tail.rotation.z = (tail.position.x < 0 ? .10 : -.10) + Math.sin(rp * .5) * (remoteMoving ? .025 : .006);
      }
    }
    if (obj.userData.baseRing) obj.userData.baseRing.rotation.z += entityDt * .3;
    if (obj.userData.waistSigil) {
      obj.userData.waistSigil.rotation.y += entityDt * .5;
      const sigilPulse = 1 + Math.sin(rp*1.4+remoteIdleSeed)*.045;
      obj.userData.waistSigil.scale.set(sigilPulse,sigilPulse,sigilPulse);
    }
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
    obj.position.y=THREE.MathUtils.lerp(obj.position.y,Number(obj.userData.targetY)||0,monsterSmooth);

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
    const trainingWarningActive = obj.userData.trainingAttacker && obj.userData.trainingWarningUntil > Date.now();
    if (obj.userData.attackRing) obj.userData.attackRing.visible = obj.userData.trainingAttacker ? (trainingWarningActive && !farMonster) : !farMonster;
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
      obj.userData.eyeMaterial.emissiveIntensity = baseGlow + Math.sin(phase*1.7+(obj.userData.eyePulseOffset||0))*.16 + strike * (kind === 'inferno' ? 2.0 : 1.1);
    }
    // O anel no chão pulsa junto ao golpe para comunicar melhor o perigo do ataque.
    const attackRing = obj.userData.attackRing;
    if (attackRing) {
      const ringScale = 1 + windup * .05 + strike * .28 + recovery * .06;
      if (obj.userData.trainingAttacker) {
        const warning = obj.userData.trainingWarningUntil > Date.now();
        attackRing.material.opacity = warning ? .58 + Math.sin(monsterNow * .025) * .16 : 0;
        attackRing.scale.setScalar(warning ? 1.12 + Math.sin(monsterNow * .025) * .08 : 1);
      } else {
        attackRing.material.opacity = .30 + windup * .22 + strike * .58;
        attackRing.scale.set(ringScale, ringScale, ringScale);
      }
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
    effect.projectile.position.y += Math.sin(t * Math.PI) * (effect.arc || .35);
    if(effect.kind==='fire'){
      effect.projectile.rotation.x+=dt*3.8;effect.projectile.rotation.y+=dt*5.4;
      effect.projectile.scale.setScalar(.82+Math.sin(t*Math.PI)*.58);
    }else if(effect.kind==='lightning'){
      effect.projectile.rotation.x+=dt*17;effect.projectile.rotation.y+=dt*22;
      effect.projectile.scale.setScalar(.75+Math.sin(t*18)*.18);
    }else if(effect.kind==='arcane'){
      effect.projectile.rotation.x+=dt*4.5;effect.projectile.rotation.y+=dt*6.5;
      effect.projectile.scale.setScalar(1+Math.sin(t*Math.PI*3)*.16+t*.45);
    }else if(effect.kind==='bone'){
      effect.projectile.rotation.z+=dt*8;
      effect.projectile.scale.setScalar(.9+t*.55);
    }else if(effect.kind==='healing'){
      effect.projectile.rotation.x+=dt*3.1;effect.projectile.rotation.y+=dt*4.2;
      effect.projectile.scale.setScalar(.85+Math.sin(t*Math.PI*2)*.16+t*.35);
    }else{
      effect.projectile.scale.setScalar(1+t*.4);
    }
    effect.material.opacity = 1 - t * .58;
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
    myPlayer.position.y=THREE.MathUtils.lerp(myPlayer.position.y,getDungeonFloorHeight(myPlayer.position.x,myPlayer.position.z),1-Math.exp(-18*dt));
    const target = cameraFocusScratch.set(myPlayer.position.x,myPlayer.position.y+1.2,myPlayer.position.z);
    const introBlend=realmIntroTimer>0?Math.min(1,realmIntroTimer/3.2):0;
    const viewPitch = THREE.MathUtils.clamp(pitch, -.52, .52);
    const viewCos = Math.cos(viewPitch);
    const viewForwardX = -Math.sin(yaw) * viewCos;
    const viewForwardY = Math.sin(viewPitch);
    const viewForwardZ = -Math.cos(yaw) * viewCos;
    if (gameSettings.cameraMode === 'first') {
      // 1ª pessoa: a mira usa o mesmo ângulo de yaw/pitch das outras perspectivas.
      cameraPositionScratch.set(target.x,target.y+.42,target.z);
      camera.position.lerp(cameraPositionScratch,1-Math.exp(-20*dt));
      camera.lookAt(
        target.x + viewForwardX * 12,
        target.y+.42 + viewForwardY * 12,
        target.z + viewForwardZ * 12
      );
    } else {
      // 2ª pessoa usa o mesmo arco da 3ª, mas fica mais próxima sem entrar no corpo.
      const baseDistance = gameSettings.cameraMode === 'second'
        ? THREE.MathUtils.clamp(cameraDistance * 0.34, 2.45, 4.1)
        : cameraDistance;
      const distance = baseDistance + introBlend * (gameSettings.cameraMode === 'second' ? 1.1 : 2.8);
      const horizontalDistance = Math.max(.65, Math.cos(viewPitch) * distance);
      const verticalOffset = Math.sin(viewPitch) * distance;
      cameraPositionScratch.set(
        target.x + Math.sin(yaw) * horizontalDistance,
        Math.max(.45, target.y - verticalOffset),
        target.z + Math.cos(yaw) * horizontalDistance
      );
      camera.position.lerp(cameraPositionScratch, cameraSmooth);
      camera.lookAt(target.x, target.y + .2, target.z);
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
