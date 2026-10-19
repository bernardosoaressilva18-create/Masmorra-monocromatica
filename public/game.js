
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';

const $ = id => document.getElementById(id);
const menu = $('menu'), hud = $('hud'), loading = $('loading'), menuStatus = $('menuStatus');

let renderer, scene, camera, clock, ws, playerId = null, roomCode = '', myPlayer = null, started = false;
let yaw = 0, pitch = .25, joy = { x: 0, y: 0 }, keys = {}, lastMove = 0, attackCooldown = 0, noticeTimer = 0;
const remotePlayers = new Map(), monsterMeshes = new Map(), chestMeshes = new Map();
const gateMeshes = [];
const activeBurnEffects = [];
let ambientParticles = null, particleMaterial = null;
const activeSpellEffects = [];
let bossMesh = null, bossData = null;
let currentPhaseVisual = 0, lastSafeZoneTimestamp = 0, appliedInitialServerPosition = false;
let latestChests = [], inventoryData = { comum: 0, incomum: 0, raro: 0, 'épico': 0, 'lendário': 0 }, lootDrops = [], selectedItemId = null;
const world = { width: 30, depth: 190 };
const isMobileDevice = matchMedia('(pointer: coarse)').matches;
const renderPixelRatioCap = isMobileDevice ? 1.0 : 1.5;
let adaptivePixelRatio = Math.min(devicePixelRatio, renderPixelRatioCap);
let perfBadge = null, perfFrames = 0, perfWindowStart = performance.now();
let lastFps = 0, measuredPing = null, slowFpsSamples = 0, fastFpsSamples = 0;

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d14);
  scene.fog = new THREE.FogExp2(0x090d14, isMobileDevice ? .012 : .009);

  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 230);
  renderer = new THREE.WebGLRenderer({ antialias: !isMobileDevice, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(adaptivePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  // Sombras suaves no PC; no celular ficam desligadas para preservar FPS.
  renderer.shadowMap.enabled = !isMobileDevice;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (typeof surfaceTexture !== 'undefined') {
    surfaceTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    surfaceTexture.needsUpdate = true;
  }
  $('game').appendChild(renderer.domElement);
  perfBadge = document.createElement('div');
  perfBadge.setAttribute('aria-hidden', 'true');
  Object.assign(perfBadge.style, {
    position: 'fixed', top: '68px', left: '50%', transform: 'translateX(-50%)',
    zIndex: '12', padding: '4px 8px', border: '1px solid rgba(115,211,255,.25)',
    borderRadius: '999px', background: 'rgba(7,12,22,.72)', color: '#aeeaff',
    font: '600 11px/1.2 monospace', letterSpacing: '.3px', pointerEvents: 'none',
    whiteSpace: 'nowrap', display: 'none'
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
  // Geometria principal recebe e projeta sombras no PC.
  if (!isMobileDevice) { m.castShadow = true; m.receiveShadow = true; }
  scene.add(m);
  return m;
}

function buildDungeon() {
  // Uma única textura partilhada mantém o detalhe visual sem criar materiais por objeto.
  const dungeonTexture = surfaceTexture.clone();
  dungeonTexture.repeat.set(4, 4);
  const floor = mat(0x292e38, .82, .08);
  floor.map = dungeonTexture;
  floor.bumpMap = dungeonTexture;
  floor.bumpScale = .025;
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
    zone.top.bumpScale = .025;
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
  scene.add(tileInstances);

  // Juntas de pedra e passadiços curtos sobre a transição de cada mundo.
  const groutMat = mat(0x171c24,1);
  for (const zone of worldZones) {
    for (let z=zone.z-zone.depth/2+2; z<=zone.z+zone.depth/2-2; z+=4) {
      box(29.2,.035,.06,groutMat,0,-.006,z);
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
        scene.add(orb);
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
    gate.add(bars); gate.position.z = z; gate.userData.bars = bars; gate.userData.ring = ring; gate.userData.portal = portal; gate.userData.portalRim = portalRim; gate.userData.open = false; scene.add(gate); gateMeshes.push(gate);
  }
  // Cristais, braseiros e fragmentos decorativos para dar profundidade.
  for (const z of [-5, -10, -18, -23, -36, -42, -50, -58, -68, -74, -84, -90, -100, -106, -116, -122, -134, -142, -158, -166]) {
    for (const x of [-12.2, 12.2]) {
      const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(.22, 1), new THREE.MeshStandardMaterial({ color: 0xffa84f, emissive: 0xff5b1f, emissiveIntensity: 2.5 }));
      flame.position.set(x, 2.1, z); scene.add(flame);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(.28, .045, 5, 12), mat(0xb88751, .45, .4)); halo.position.set(x, 1.75, z); scene.add(halo);
    }
  }
  // FASE 1 — Cripta antiga: altar e marcas de pedra azuladas.
  const altarStone = mat(0x5b6470, .9, .12);
  box(2.4, .35, 1.5, altarStone, 0, .16, 1.2);
  box(1.65, .42, 1.05, trim, 0, .52, 1.2);
  const altarRune = new THREE.Mesh(new THREE.RingGeometry(.55, .72, 24), new THREE.MeshBasicMaterial({ color: 0x75dff2, transparent: true, opacity: .65, side: THREE.DoubleSide }));
  altarRune.rotation.x = -Math.PI / 2; altarRune.position.set(0, .75, 1.2); scene.add(altarRune);

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
      scene.add(cluster);
    }
  }
  // Veios luminosos no chão da caverna.
  for (const z of [-47, -51, -55, -58]) {
    for (const side of [-1, 1]) {
      const vein = new THREE.Mesh(new THREE.BoxGeometry(2.2, .025, .07), new THREE.MeshBasicMaterial({ color: 0x7d5cff, transparent: true, opacity: .62 }));
      vein.position.set(side * 7.8, -.045, z); vein.rotation.y = side * .18; scene.add(vein);
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
      tree.position.set(x,0,z); tree.rotation.y=side*.16; scene.add(tree);
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
      crack.rotation.y=side*(Math.random()*.24); scene.add(crack);
      if(Math.random()>.3){
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(.35+Math.random()*.32,0),basalt);
        rock.position.set(side*(10.2+Math.random()*2),.08,z+.6); rock.rotation.set(Math.random(),Math.random(),Math.random()); rock.scale.y=.7; scene.add(rock);
      }
    }
  }
  // MUNDO 5 — anéis maiores e rubros ao redor do Guardião Supremo.
  const finalSigil = new THREE.Mesh(new THREE.RingGeometry(6.1,6.22,64),new THREE.MeshBasicMaterial({color:0xaa3cff,transparent:true,opacity:.55,side:THREE.DoubleSide}));
  finalSigil.rotation.x=-Math.PI/2; finalSigil.position.set(0,-.02,-150); scene.add(finalSigil);

  // FASE 3 — Arena do Abismo: runas rubras e obeliscos ao redor do chefe.
  const abyssStone = mat(0x211821, .78, .25);
  const abyssRune = new THREE.MeshBasicMaterial({ color: 0xff315d, transparent: true, opacity: .62, side: THREE.DoubleSide });
  for (const [x, z] of [[-8.8, -146.2], [8.8, -146.2], [-8.8, -150], [8.8, -150]]) {
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(.28, .5, 3.2, 5), abyssStone);
    obelisk.position.set(x, 1.55, z); obelisk.rotation.z = x < 0 ? .08 : -.08; scene.add(obelisk);
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(.32), new THREE.MeshStandardMaterial({ color: 0xff315d, emissive: 0x9b102c, emissiveIntensity: 1.7 }));
    crown.position.set(x, 3.3, z); scene.add(crown);
  }
  for (const radius of [2.2, 3.6, 5.1]) {
    const circle = new THREE.Mesh(new THREE.RingGeometry(radius, radius + .055, 64), abyssRune);
    circle.rotation.x = -Math.PI / 2; circle.position.set(0, -.025, -150.1); scene.add(circle);
  }
  // Marca visual no chão entre as regiões para mostrar a passagem de fase.
  for (const z of [-29.8, -61.7, -93.7, -125.7]) {
    const threshold = new THREE.Mesh(new THREE.BoxGeometry(27, .035, .18), new THREE.MeshStandardMaterial({ color: 0x43515e, emissive: 0x182a38, emissiveIntensity: .7, metalness: .3 }));
    threshold.position.set(0, -.035, z); scene.add(threshold);
  }

  const particleCount = 28, particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) { particlePositions[i*3] = (Math.random()-.5)*26; particlePositions[i*3+1] = .3+Math.random()*4; particlePositions[i*3+2] = -174+Math.random()*184; }
  const particleGeo = new THREE.BufferGeometry(); particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleMaterial = new THREE.PointsMaterial({ color: 0x8be9ff, size: .055, transparent: true, opacity: .6, depthWrite: false }); ambientParticles = new THREE.Points(particleGeo, particleMaterial); scene.add(ambientParticles);

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
    scene.add(rock);
  }
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

function makeHero(color = null, heroClass = 'knight', skin = 'default') {
  const g = new THREE.Group();
  const classColor = heroClass === 'mage' ? 0x7565df : heroClass === 'archer' ? 0x4b9965 : 0x72e6ff;
  const armorColor = skin === 'shadow' ? 0x343a50 : skin === 'ember' ? 0x9b4a2b : (color ?? classColor);
  const darkColor = skin === 'shadow' ? 0x11131d : skin === 'ember' ? 0x3b1915 : 0x151d2a;
  const armor = new THREE.MeshStandardMaterial({ color: armorColor, map: surfaceTexture, bumpMap: surfaceTexture, bumpScale: .025, metalness: .38, roughness: .48 });
  const dark = new THREE.MeshStandardMaterial({ color: darkColor, metalness: .35, roughness: .55 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xe2b99a, roughness: .82 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc2d7e4, metalness: .82, roughness: .22 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a45d, metalness: .72, roughness: .3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x8beaff, emissive: 0x168fc0, emissiveIntensity: 1.4, metalness: .25, roughness: .25 });
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
    const leg = add(new THREE.CapsuleGeometry(.145,.34,4,8), dark, side*.2,.47,0);
    legs.push({ mesh: leg, side });
    add(new THREE.BoxGeometry(.27,.16,.4), steel, side*.2,.19,-.055);
    add(new THREE.SphereGeometry(.19,12,10), gold, side*.2,.68,0,.94,.62,.9);
    const arm=add(new THREE.CapsuleGeometry(.13,.42,4,8), armor, side*.48,1.23,0);
    arm.rotation.z=side*-.12;
    arms.push({ mesh: arm, side });
    add(new THREE.SphereGeometry(.19,12,10), steel, side*.48,1.49,0,1.08,.65,1.0);
    add(new THREE.CapsuleGeometry(.12,.19,3,6), dark, side*.49,.91,-.015);
    add(new THREE.SphereGeometry(.105,10,8), gold, side*.49,.83,-.02);
  }
  // Peitoral em camadas, gola e cinto
  torsoMesh = add(new THREE.CapsuleGeometry(.36,.5,5,10), armor, 0,1.22,0,1.0,1.0,.82);
  add(new THREE.BoxGeometry(.48,.42,.12), steel, 0,1.25,-.31);
  add(new THREE.BoxGeometry(.19,.23,.05), glow, 0,1.27,-.39);
  add(new THREE.BoxGeometry(.64,.12,.43), dark, 0,.91,0);
  add(new THREE.BoxGeometry(.15,.15,.08), gold, 0,.91,-.23);
  // Capa dividida em painéis para dar silhueta de aventureiro
  const cape=add(new THREE.BoxGeometry(.58,.72,.13), dark,0,1.23,.29);
  cape.rotation.x=-.08;
  add(new THREE.ConeGeometry(.34,.35,5), armor,0,.83,.34,1,.75,.55);
  // Cabeça, cabelo curto, sobrancelhas e olhos luminosos
  headMesh = add(new THREE.SphereGeometry(.255,20,14), skinMaterial,0,1.94,-.015);
  add(new THREE.SphereGeometry(.27,20,12,0,Math.PI*2,0,Math.PI*.48), dark,0,2.075,.005);
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
  } else if (heroClass === 'archer') {
    const bow = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(.34,.045,6,18,Math.PI*1.25), gold); arc.rotation.z=-Math.PI*.62; bow.add(arc);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.66,5), steel); string.position.set(-.12,0,0); string.rotation.z=Math.PI*.1; bow.add(string);
    bow.position.set(.56,1.08,-.08); bow.rotation.z=-.18; g.add(bow); classWeapon = bow;
  }
  g.userData.sword=classWeapon;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.43,.49,32),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.62,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2; ring.position.y=.025; g.add(ring);
  g.userData.heroClass = heroClass;
  g.userData.heroSkin = skin;
  g.userData.cape=cape;
  g.userData.torso = torsoMesh;
  g.userData.head = headMesh;
  g.userData.legs = legs;
  g.userData.arms = arms;
  g.userData.walkPhase = Math.random() * Math.PI * 2;
  g.userData.baseY = 0;
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
  const rune = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.65, 32), new THREE.MeshBasicMaterial({ color: 0xff315d, transparent: true, opacity: .7, side: THREE.DoubleSide }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = .04; g.add(rune);
  g.userData.eyeMaterial = eye; g.userData.bodyMaterial = armor; g.userData.torso = torso; g.userData.arms = bossArms; g.userData.animPhase = Math.random()*Math.PI*2; return g;
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
  const recent = lootDrops.slice(-8).reverse();
  if (selectedItemId && !lootDrops.some(item => String(item.id) === String(selectedItemId))) selectedItemId = null;
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
  // Sombra/anel de identidade fixo no chão, sem pulsação.
  const ringColor = kind === 'brute' ? 0xff9c35 : kind === 'wraith' ? 0x63e9ff : kind === 'thorn' ? 0x8dff74 : kind === 'inferno' ? 0xff692e : kind === 'abyss' ? 0xc08bff : 0xff4269;
  const ring = new THREE.Mesh(new THREE.RingGeometry(.48,.55,24),new THREE.MeshBasicMaterial({color:ringColor,transparent:true,opacity:.55,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2; ring.position.y=.025; g.add(ring);
  g.userData.kind=kind;
  g.userData.animatedLimbs = animatedLimbs;
  g.userData.walkPhase = Math.random() * Math.PI * 2;
  g.userData.lastX = undefined;
  g.userData.lastZ = undefined;
  g.userData.walking = false;
  g.userData.baseY = 0;
  return g;
}

function onResize() {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  // Em pé no celular, campo de visão maior para manter a masmorra legível.
  camera.fov = isMobileDevice && innerHeight > innerWidth ? 76 : 62;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(adaptivePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

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
  knight: 'Cavaleiro: mais vida, defesa natural e golpes corpo a corpo.',
  mage: 'Mago: menos vida, mas magia mais poderosa.',
  archer: 'Arqueiro: ataques rápidos e maior alcance.'
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
  { id:'arcane', title:'✦ MAGIA & UTILIDADE', skills:[
    {id:'arcane_mastery',icon:'🔮',name:'Maestria arcana',desc:'Mago causa mais dano mágico.'},
    {id:'ember_core',icon:'🔥',name:'Núcleo de brasa',desc:'Fogo mais forte e queimadura maior.',req:'arcane_mastery'},
    {id:'storm_bond',icon:'⚡',name:'Vínculo da tempestade',desc:'Raio salta para mais inimigos.',req:'ember_core'},
    {id:'treasure_luck',icon:'💎',name:'Sorte do tesouro',desc:'Maior chance de loot.',req:'storm_bond'},
    {id:'swift_step',icon:'👟',name:'Passo veloz',desc:'Movimento mais rápido.',req:'treasure_luck'}
  ]}
];
function renderSkillTrees() {
  const html = SKILL_BRANCHES.map(branch =>
    '<section class="skill-branch"><div class="skill-branch-title">' + branch.title + '</div><div class="skill-branch-list">' +
    branch.skills.map(skill => {
      const unlocked = unlockedSkills.has(skill.id);
      const available = !skill.req || unlockedSkills.has(skill.req);
      const canBuy = !unlocked && available && skillPoints > 0;
      const state = unlocked ? 'DESBLOQUEADA ✓' : !available ? 'REQUER: ' + SKILL_BRANCHES.flatMap(b=>b.skills).find(s=>s.id===skill.req).name : skillPoints > 0 ? 'DESBLOQUEAR · 1 PONTO' : 'SEM PONTOS';
      return '<button type="button" class="skill-node ' + (unlocked?'unlocked':canBuy?'available':'locked') + '" data-skill="' + skill.id + '"' + (canBuy?'':' disabled') + '><span class="skill-node-top"><span class="skill-node-icon">' + skill.icon + '</span>' + skill.name + '</span><small>' + skill.desc + '</small><span class="skill-node-state">' + state + '</span></button>';
    }).join('') + '</div></section>'
  ).join('');
  const lobbyTree = $('skillTreeLobby'), hudTree = $('skillTreeHud');
  if (lobbyTree) lobbyTree.innerHTML = html;
  if (hudTree) hudTree.innerHTML = html;
  if ($('skillPoints')) $('skillPoints').textContent = String(skillPoints);
  if ($('skillPointsHud')) $('skillPointsHud').textContent = String(skillPoints);
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
}
document.querySelectorAll('.class-card').forEach(card => card.addEventListener('click', () => chooseClass(card.dataset.class)));
function chooseSkin(skinName) {
  if (!['default','shadow','ember'].includes(skinName)) return;
  selectedSkin = skinName;
  document.querySelectorAll('.skin-pick').forEach(el => el.classList.toggle('selected', el.dataset.skin === selectedSkin));
  updateHeroShowcase();
  refreshLocalHeroAppearance();
  sendLoadout();
}
document.querySelectorAll('.skin-pick').forEach(card => card.addEventListener('click', () => chooseSkin(card.dataset.skin)));
function updateHeroShowcase() {
  const classInfo = {
    knight:{name:'Cavaleiro',glyph:'🛡️',desc:'Vida elevada · defesa natural · espada'},
    mage:{name:'Mago',glyph:'🔮',desc:'Magia fortalecida · cajado arcano'},
    archer:{name:'Arqueiro',glyph:'🏹',desc:'Ataque rápido · alcance maior'}
  }[selectedClass] || {name:'Cavaleiro',glyph:'🛡️',desc:'Defesa elevada'};
  const skinInfo = {default:{label:'SKIN CLÁSSICA',cls:'skin-default'},shadow:{label:'SKIN SOMBRA',cls:'skin-shadow'},ember:{label:'SKIN BRASA',cls:'skin-ember'}}[selectedSkin] || {label:'SKIN CLÁSSICA',cls:'skin-default'};
  const avatar=$('heroPreviewAvatar');
  if(avatar){avatar.className='hero-preview-avatar '+skinInfo.cls+' class-'+selectedClass;}
  if($('heroPreviewGlyph')) $('heroPreviewGlyph').textContent=classInfo.glyph;
  if($('heroPreviewName')) $('heroPreviewName').textContent=classInfo.name;
  if($('heroPreviewDesc')) $('heroPreviewDesc').textContent=classInfo.desc;
  if($('heroPreviewSkin')) $('heroPreviewSkin').textContent=skinInfo.label;
  document.querySelectorAll('.skin-pick').forEach(el=>el.classList.toggle('selected',el.dataset.skin===selectedSkin));
}
function handleSkillClick(event) {
  const button = event.target.closest('[data-skill]');
  if (!button || button.disabled) return;
  const skill = SKILL_BRANCHES.flatMap(branch => branch.skills).find(item => item.id === button.dataset.skill);
  if (!skill || unlockedSkills.has(skill.id) || skillPoints < 1 || (skill.req && !unlockedSkills.has(skill.req))) return;
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

function sendJoin(code) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  activeConnectCode = code || activeConnectCode || roomCode || '';
  send({
    type: 'join',
    resumeToken,
    name: $('playerName').value.trim() || 'Aventureiro',
    class: selectedClass,
    skin: selectedSkin,
    skills: Array.from(unlockedSkills),
    talentPoints: skillPoints,
    code
  });
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
    showNotice('Loot: ' + m.item.name + ' · ' + m.item.rarity);
    renderInventory();
    return;
  }

  if (m.type === 'notice') {
    showNotice(m.text);
    if (/acertou você|foi derrotado/i.test(m.text)) {
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
  if (m.type === 'spell') {
    const isFire = m.spell === 'fire';
    const color = isFire ? 0xff6b24 : 0x69aaff;
    const origin = new THREE.Vector3(m.x, 1.35, m.z);
    const targets = (Array.isArray(m.targets) ? m.targets : []).slice(0, 3);
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
      const startedAt = performance.now(), duration = isFire ? 420 : 230;
      const animateImpact = () => {
        const t = (performance.now() - startedAt) / duration;
        if (t >= 1) {
          scene.remove(beam, impact); geo.dispose(); beamMat.dispose(); impactGeo.dispose(); impactMat.dispose();
          return;
        }
        beamMat.opacity = 1 - t;
        impact.scale.setScalar(isFire ? 1 + t * .65 : 1 + Math.sin(t * Math.PI) * .8);
        impactMat.opacity = 1 - t;
        requestAnimationFrame(animateImpact);
      };
      requestAnimationFrame(animateImpact);
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

  if (m.type === 'state') updateState(m);
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
    $('lobbyPlayers').innerHTML = (m.players || []).map(p =>
      '<div class="lobby-player ' + (p.ready ? 'ready' : '') + '"><span class="lobby-name">' + escapeHTML(p.name) + (p.isHost ? ' · ANFITRIÃO' : '') + (p.id === playerId ? ' (você)' : '') + '</span><b class="lobby-state">' + (p.ready ? 'PRONTO' : 'AGUARDANDO') + '</b></div>'
    ).join('') || '<p>Esperando aventureiros...</p>';
    return;
  }
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
        $('hpText').textContent = String(myPlayer.userData.serverHp);
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
    if (previousPhase > 0 && phase > previousPhase) {
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
    const palettes = [
      { bg: 0x090d14, fog: 0x090d14 },
      { bg: 0x100c20, fog: 0x17112a },
      { bg: 0x16070f, fog: 0x210914 },
      { bg: 0x071810, fog: 0x10271a },
      { bg: 0x24100a, fog: 0x35150b },
      { bg: 0x160817, fog: 0x210d28 }
    ];
    const palette = palettes[phase - 1] || palettes[0];
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
  const aliveMonsters = m.monsters.filter(monster => monster.alive).length;
  gateMeshes.forEach((gate, index) => { const gatePhase = index + 1; gate.userData.open = phase > gatePhase || (phase === gatePhase && aliveMonsters === 0); });
  const phaseObjective = document.querySelector('.objective strong');
  if (phaseObjective) phaseObjective.textContent = phase === 5 ? 'Derrote o Guardião Supremo' : 'Derrote os monstros e atravesse o portal para o próximo mundo';
  if (phaseLabel) phaseLabel.textContent = 'MUNDO ' + phase + ' / 5';
  const bossPanel = $('bossPanel');
  if (bossPanel) bossPanel.classList.toggle('hidden', phase !== 5 || !m.boss || !m.boss.alive);
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
      $('bossHealthFill').style.width = '0%'; $('bossHealthText').textContent = '0 / 95';
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
      obj = makeMonster(mtr.kind || 'stalker', mtr.phase || phase);
      scene.add(obj);
      monsterMeshes.set(mtr.id, obj);
    }

    obj.userData.targetX = mtr.x;
    obj.userData.targetZ = mtr.z;
    obj.userData.kind = mtr.kind || 'stalker';
    // Calcula a direção do rosto/corpo para o jogador local.
    if (myPlayer) {
      const faceX = myPlayer.position.x - mtr.x;
      const faceZ = myPlayer.position.z - mtr.z;
      if (Math.hypot(faceX, faceZ) > 0.05) {
        obj.userData.targetRot = Math.atan2(faceX, faceZ);
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

  $('monsterText').textContent = phase === 5
    ? (bossData && bossData.alive ? 'Guardião Supremo' : 'Masmorra concluída')
    : alive + ' monstros restantes';
  const phaseTotal = phase === 1 ? 5 : phase === 2 ? 8 : phase === 3 ? 9 : phase === 4 ? 10 : 95;
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

function attack() {
  if (!started || attackCooldown > 0 || (myPlayer?.userData.serverHp ?? 100) <= 0) return;

  attackCooldown = selectedClass === 'archer' ? .29 : selectedClass === 'mage' ? .4 : .48;
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
  // No celular, tenta usar a tela inteira e manter o jogo em pé.
  // O bloqueio de orientação só é permitido em alguns navegadores após um toque.
  if (isMobileDevice) {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (_) {}
    try {
      if (screen.orientation && screen.orientation.lock) {
        await screen.orientation.lock('portrait');
      }
    } catch (_) {
      // Se o navegador não permitir bloquear a orientação, o jogo continua normalmente.
    }
  }
  $('startScreen').classList.add('hidden');
  menu.classList.remove('hidden');
  setStatus('Digite seu nome e toque em JOGAR ONLINE.');
});

$('playBtn').addEventListener('click', () => connect(''));
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

$('leaveBtn').addEventListener('click', () => {
  send({ type: 'leave' });
  if (ws) ws.close();
  started = false;
  hud.classList.add('hidden');
  menu.classList.remove('hidden');
});

$('chestBtn').addEventListener('pointerdown', e => { e.preventDefault(); if (!$('chestBtn').classList.contains('hidden')) interactChest(); });
$('recentLoot').addEventListener('click', e => {
  const row = e.target.closest('.select-item');
  if (!row) return;
  selectedItemId = row.dataset.itemId;
  renderInventory();
});
$('useSelectedItemBtn').addEventListener('click', useSelectedItem);

let fireCooldown = 0, lightningCooldown = 0;
function placeSpellButtons() {
  const fire = $('fireBtn'), lightning = $('lightningBtn');
  for (const btn of [fire, lightning]) {
    if (!btn) continue;
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.setProperty('position', 'fixed', 'important');
    btn.style.setProperty('visibility', 'visible', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('pointer-events', 'auto', 'important');
    btn.style.setProperty('z-index', '9999', 'important');
    btn.style.setProperty('width', '58px', 'important');
    btn.style.setProperty('height', '58px', 'important');
    btn.style.setProperty('border-radius', '50%', 'important');
    btn.style.setProperty('color', '#fff', 'important');
    btn.style.setProperty('background', 'rgba(12,20,32,.98)', 'important');
    btn.style.setProperty('flex-direction', 'column', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('touch-action', 'none', 'important');
  }
  if (matchMedia('(orientation: portrait)').matches) {
    fire.style.setProperty('right', '88px', 'important');
    fire.style.setProperty('bottom', '86px', 'important');
    lightning.style.setProperty('right', '18px', 'important');
    lightning.style.setProperty('bottom', '96px', 'important');
  } else {
    fire.style.setProperty('right', '130px', 'important');
    fire.style.setProperty('bottom', '16px', 'important');
    lightning.style.setProperty('right', '70px', 'important');
    lightning.style.setProperty('bottom', '84px', 'important');
  }
}
addEventListener('resize', placeSpellButtons);
placeSpellButtons();

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
  activeSpellEffects.push({ projectile, geo, material, origin, destination, startedAt: performance.now(), duration: 300 });
  send({ type: 'spell', spell: kind });
  showNotice(kind === 'fire' ? '🔥 MAGIA DE FOGO!' : '⚡ MAGIA DE RAIO!');
}
$('fireBtn').addEventListener('pointerdown', e => { e.preventDefault(); castSpell('fire'); });
$('lightningBtn').addEventListener('pointerdown', e => { e.preventDefault(); castSpell('lightning'); });

$('attackBtn').addEventListener('pointerdown', e => {
  e.preventDefault();
  attack();
});

addEventListener('keydown', e => {
  if (['Space','KeyE','KeyR'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Space') attack();
  if (e.code === 'KeyE') interactChest();
  if (e.code === 'KeyR') useSelectedItem();
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

  joy.x = dx / max;
  joy.y = dy / max;
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


function updatePerformanceMonitor() {
  perfFrames++;
  const now = performance.now();
  const elapsed = now - perfWindowStart;
  if (elapsed < 1500) return;
  lastFps = perfFrames * 1000 / elapsed;
  perfFrames = 0;
  perfWindowStart = now;

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
  if (slowFpsSamples >= 1) {
    nextRatio = Math.max(isMobileDevice ? .75 : .8, adaptivePixelRatio - .08);
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
    perfBadge.textContent = Math.round(lastFps) + ' FPS · ' + (measuredPing === null ? 'Ping —' : 'Ping ' + measuredPing + ' ms');
    perfBadge.style.display = started ? 'block' : 'none';
  }
}

function animate() {
  requestAnimationFrame(animate);
  if (!renderer) return;

  const dt = Math.min(clock.getDelta(), 0.05);
  const remoteSmooth = 1 - Math.exp(-14 * dt);
  const monsterSmooth = 1 - Math.exp(-10 * dt);
  const cameraSmooth = 1 - Math.exp(-9 * dt);

  attackCooldown = Math.max(0, attackCooldown - dt);
  fireCooldown = Math.max(0, fireCooldown - dt);
  lightningCooldown = Math.max(0, lightningCooldown - dt);
  const fireLabel = $('fireCooldown'), lightningLabel = $('lightningCooldown');
  if (fireLabel) fireLabel.textContent = fireCooldown > 0 ? fireCooldown.toFixed(1) + 's' : 'OK';
  if (lightningLabel) lightningLabel.textContent = lightningCooldown > 0 ? lightningCooldown.toFixed(1) + 's' : 'OK';

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

      const moveSpeed = 5.8 * (selectedClass === 'archer' ? 1.12 : 1) * (unlockedSkills.has('swift_step') ? 1.18 : 1);
      myPlayer.position.x = THREE.MathUtils.clamp(
        myPlayer.position.x + dir.x * dt * moveSpeed,
        -13, 13
      );
      myPlayer.position.z = THREE.MathUtils.clamp(
        myPlayer.position.z + dir.z * dt * moveSpeed,
        -174, 8
      );

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
    myPlayer.userData.walkPhase = (myPlayer.userData.walkPhase || 0) + dt * (moving ? 10.5 : 1.8);
    const phase = myPlayer.userData.walkPhase;
    const stride = moving ? 1 : .12;
    const breath = Math.sin(phase * .8);
    if (myPlayer.userData.torso) { myPlayer.userData.torso.scale.y = 1 + breath * .018; myPlayer.userData.torso.rotation.z = moving ? Math.sin(phase) * .035 : Math.sin(phase * .5) * .012; }
    if (myPlayer.userData.head) { myPlayer.userData.head.rotation.x = moving ? Math.sin(phase) * .035 : Math.sin(phase * .6) * .018; myPlayer.userData.head.rotation.z = Math.sin(phase * .4) * .012; }
    for (const leg of myPlayer.userData.legs || []) {
      leg.mesh.rotation.x = Math.sin(phase + (leg.side > 0 ? Math.PI : 0)) * .58 * stride;
    }
    for (const arm of myPlayer.userData.arms || []) {
      arm.mesh.rotation.x = Math.sin(phase + (arm.side < 0 ? Math.PI : 0)) * .32 * stride;
    }
    myPlayer.position.y = moving ? Math.abs(Math.sin(phase * 2)) * .045 : 0;
    if (myPlayer.userData.cape) {
      myPlayer.userData.cape.rotation.x = -.08 + Math.sin(phase) * .09 * stride;
      myPlayer.userData.cape.rotation.z = Math.sin(phase * .5) * .035 * stride;
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
    const remoteMoving = Math.hypot((obj.userData.targetX ?? obj.position.x) - obj.position.x, (obj.userData.targetZ ?? obj.position.z) - obj.position.z) > .035;
    obj.userData.walkPhase = (obj.userData.walkPhase || 0) + dt * (remoteMoving ? 9.5 : 1.8);
    const rp = obj.userData.walkPhase;
    for (const leg of obj.userData.legs || []) leg.mesh.rotation.x = Math.sin(rp + (leg.side > 0 ? Math.PI : 0)) * (remoteMoving ? .5 : .035);
    for (const arm of obj.userData.arms || []) arm.mesh.rotation.x = Math.sin(rp + (arm.side < 0 ? Math.PI : 0)) * (remoteMoving ? .28 : .025);
    if (obj.userData.cape) obj.userData.cape.rotation.x = -.08 + Math.sin(rp) * (remoteMoving ? .09 : .015);
  }

  // Monstros: suaviza o deslocamento e anima o corpo enquanto perseguem.
  for (const obj of monsterMeshes.values()) {
    if (!obj.visible || obj.userData.targetX === undefined) continue;
    const dx = obj.userData.targetX - obj.position.x;
    const dz = obj.userData.targetZ - obj.position.z;
    const distance = Math.hypot(dx, dz);
    const moving = distance > .035;
    obj.userData.walkPhase = (obj.userData.walkPhase || 0) + dt * (moving ? 9 : 2);
    const phase = obj.userData.walkPhase;
    obj.position.y = moving ? Math.abs(Math.sin(phase * 2)) * (obj.userData.kind === 'wraith' ? .11 : .055) : 0;
    obj.rotation.z = moving ? Math.sin(phase) * .035 : THREE.MathUtils.lerp(obj.rotation.z, 0, 1 - Math.exp(-5 * dt));
    // Gira o monstro para encarar o personagem sem trancos.
    if (obj.userData.targetRot !== undefined) {
      const angleDiff = Math.atan2(
        Math.sin(obj.userData.targetRot - obj.rotation.y),
        Math.cos(obj.userData.targetRot - obj.rotation.y)
      );
      obj.rotation.y += angleDiff * (1 - Math.exp(-8 * dt));
    }
    for (const limb of obj.userData.animatedLimbs || []) {
      limb.mesh.rotation.x = Math.sin(phase + (limb.side > 0 ? Math.PI : 0)) * (moving ? .22 : .035);
      limb.mesh.rotation.z = limb.baseRotationZ + Math.sin(phase * .65 + limb.side) * (moving ? .07 : .018);
    }
    if (obj.userData.kind === 'stalker') {
      obj.rotation.x = moving ? Math.sin(phase) * .045 : THREE.MathUtils.lerp(obj.rotation.x, 0, 1 - Math.exp(-5 * dt));
    }
  }

  if (bossMesh && bossMesh.visible && bossMesh.userData.targetX !== undefined) {
    bossMesh.position.x = THREE.MathUtils.lerp(bossMesh.position.x, bossMesh.userData.targetX, monsterSmooth);
    bossMesh.position.z = THREE.MathUtils.lerp(bossMesh.position.z, bossMesh.userData.targetZ, monsterSmooth);
    bossMesh.userData.animPhase = (bossMesh.userData.animPhase || 0) + dt * (Math.hypot((bossMesh.userData.targetX ?? bossMesh.position.x)-bossMesh.position.x,(bossMesh.userData.targetZ ?? bossMesh.position.z)-bossMesh.position.z) > .04 ? 5.5 : 1.7);
    const bossPhase = bossMesh.userData.animPhase;
    const bossMoving = Math.hypot((bossMesh.userData.targetX ?? bossMesh.position.x)-bossMesh.position.x,(bossMesh.userData.targetZ ?? bossMesh.position.z)-bossMesh.position.z) > .04;
    bossMesh.position.y = .08 + Math.sin(bossPhase * 1.5) * .045;
    if (bossMesh.userData.torso) bossMesh.userData.torso.rotation.z = Math.sin(bossPhase) * (bossMoving ? .06 : .025);
    for (const arm of bossMesh.userData.arms || []) arm.mesh.rotation.x = Math.sin(bossPhase + (arm.side > 0 ? Math.PI : 0)) * (bossMoving ? .28 : .07);
    if (bossMesh.userData.eyeMaterial) bossMesh.userData.eyeMaterial.emissiveIntensity = 2.3 + (Math.sin(bossPhase * 2.1) + 1) * .55;
    // O Guardião respira, balança os braços e pulsa os olhos durante a perseguição.
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
  // Projéteis mágicos animados no loop principal, sem RAF extra por magia.
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
  // Movimento suave dos monstros
  for (const obj of monsterMeshes.values()) {
    if (obj.userData.targetX === undefined) continue;

    obj.position.x = THREE.MathUtils.lerp(
      obj.position.x, obj.userData.targetX, monsterSmooth
    );

    obj.position.z = THREE.MathUtils.lerp(
      obj.position.z, obj.userData.targetZ, monsterSmooth
    );

    if (obj.userData.spawnAnim > 0) {
      obj.userData.spawnAnim = Math.max(0, obj.userData.spawnAnim - dt);
      const t = 1 - obj.userData.spawnAnim / 0.35;
      obj.scale.setScalar(Math.max(0.05, t));
    } else obj.scale.setScalar(1);
    if (obj.userData.attackAnim > 0) {
      obj.userData.attackAnim = Math.max(0, obj.userData.attackAnim - dt);
      obj.rotation.x = -Math.sin((obj.userData.attackAnim / 0.38) * Math.PI) * 0.45;
    } else obj.rotation.x = THREE.MathUtils.lerp(obj.rotation.x, 0, 1 - Math.exp(-12 * dt));
    obj.position.y = obj.userData.attackAnim > 0 ? Math.sin((obj.userData.attackAnim / 0.38) * Math.PI) * 0.22 : 0;

    // Mantém a orientação do monstro; não gira continuamente no próprio eixo.
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

  updatePerformanceMonitor();
  renderer.render(scene, camera);
}

init3D();
