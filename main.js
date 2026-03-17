import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvasContainer = document.getElementById('canvas-container');
const statusText      = document.getElementById('status-text');
const crosshair       = document.getElementById('crosshair');
const playHint        = document.getElementById('play-hint');
const propsPanel      = document.getElementById('props-panel');
const propsContent    = document.getElementById('props-content');
const snapSelect      = document.getElementById('snap-select');
const undoBtn         = document.getElementById('btn-undo');
const redoBtn         = document.getElementById('btn-redo');
const loadInput       = document.getElementById('load-input');

const modeButtons = {
  place:  document.getElementById('btn-place'),
  select: document.getElementById('btn-select'),
  delete: document.getElementById('btn-delete'),
};
const transformButtons = {
  translate: document.getElementById('btn-translate'),
  rotate:    document.getElementById('btn-rotate'),
  scale:     document.getElementById('btn-scale'),
};
const transformGroup = document.getElementById('transform-group');

// ─── Editor state ────────────────────────────────────────────────────────────
const state = {
  mode:          'place',      // place | select | delete
  placingType:   'wall',       // wall | floor | target | light
  transformMode: 'translate',  // translate | rotate | scale
  snapSize:      1,
  selectedObject: null,
  isPlaytest:    false,
};

const sceneObjects = [];   // all placed meshes
const undoStack    = [];
const redoStack    = [];

// ─── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
canvasContainer.appendChild(renderer.domElement);

function onResize() {
  const w = canvasContainer.clientWidth;
  const h = canvasContainer.clientHeight;
  renderer.setSize(w, h);
  editorCam.aspect = w / h;
  editorCam.updateProjectionMatrix();
  fpsCam.aspect = w / h;
  fpsCam.updateProjectionMatrix();
}

// ─── Cameras ─────────────────────────────────────────────────────────────────
const editorCam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
editorCam.position.set(8, 10, 16);
editorCam.lookAt(0, 0, 0);

const fpsCam = new THREE.PerspectiveCamera(75, 1, 0.05, 500);

// ─── Scene ───────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1020);
scene.fog = new THREE.FogExp2(0x0a1020, 0.006);

scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const sunLight = new THREE.DirectionalLight(0xfffbe8, 0.9);
sunLight.position.set(12, 22, 8);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { near: 0.5, far: 300, left: -80, right: 80, top: 80, bottom: -80 });
scene.add(sunLight);

// ─── Chunked infinite grid ───────────────────────────────────────────────────
const CHUNK_SIZE  = 20;
const CHUNK_RANGE = 2;   // renders a 5×5 area of chunks
const gridChunks  = new Map();
let lastChunkX = Infinity;
let lastChunkZ = Infinity;

function updateGridChunks(wx, wz) {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  if (cx === lastChunkX && cz === lastChunkZ) return;
  lastChunkX = cx; lastChunkZ = cz;

  const needed = new Set();
  for (let dx = -CHUNK_RANGE; dx <= CHUNK_RANGE; dx++)
    for (let dz = -CHUNK_RANGE; dz <= CHUNK_RANGE; dz++)
      needed.add(`${cx + dx},${cz + dz}`);

  for (const [key, mesh] of gridChunks) {
    if (!needed.has(key)) { scene.remove(mesh); mesh.geometry.dispose(); gridChunks.delete(key); }
  }

  for (const key of needed) {
    if (gridChunks.has(key)) continue;
    const [kx, kz] = key.split(',').map(Number);
    const g = new THREE.GridHelper(CHUNK_SIZE, 20, 0x1e3a5f, 0x0e1f33);
    g.position.set(kx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, kz * CHUNK_SIZE + CHUNK_SIZE / 2);
    scene.add(g);
    gridChunks.set(key, g);
  }
}

// ─── Object definitions ──────────────────────────────────────────────────────
const DEFS = {
  wall: {
    label: 'Wall',
    makeGeo: () => new THREE.BoxGeometry(2, 4, 0.25),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: .9 }),
    placedY: 2,
  },
  floor: {
    label: 'Floor',
    makeGeo: () => new THREE.BoxGeometry(4, 0.2, 4),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 1 }),
    placedY: 0.1,
  },
  target: {
    label: 'Target',
    makeGeo: () => new THREE.SphereGeometry(0.45, 24, 16),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: .5, metalness: .2 }),
    placedY: 0.45,
  },
  light: {
    label: 'Light',
    makeGeo: () => new THREE.SphereGeometry(0.12, 10, 8),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: 0xffdd88, emissiveIntensity: 1.5 }),
    placedY: 3,
  },
};

function createMesh(type, ghost = false) {
  const def = DEFS[type];
  const mat = def.makeMat();
  if (ghost) { mat.transparent = true; mat.opacity = .42; mat.depthWrite = false; }
  const mesh = new THREE.Mesh(def.makeGeo(), mat);
  mesh.castShadow    = !ghost;
  mesh.receiveShadow = !ghost;
  mesh.userData.type = type;
  if (type === 'light' && !ghost) {
    const pl = new THREE.PointLight(0xffdd88, 1.5, 16);
    mesh.add(pl);
    mesh.userData.pointLight = pl;
  }
  return mesh;
}

// ─── Controls ────────────────────────────────────────────────────────────────
const orbitControls = new OrbitControls(editorCam, renderer.domElement);
orbitControls.enableDamping   = true;
orbitControls.dampingFactor   = 0.1;
orbitControls.screenSpacePanning = false;
orbitControls.maxPolarAngle   = Math.PI / 2 - 0.02;

const transformControls = new TransformControls(editorCam, renderer.domElement);
transformControls.setMode('translate');
transformControls.visible = false; // hidden until an object is selected
scene.add(transformControls);

transformControls.addEventListener('dragging-changed', e => {
  orbitControls.enabled = !e.value;
});

let transformBefore = null;
transformControls.addEventListener('mouseDown', () => {
  if (state.selectedObject) transformBefore = captureTRS(state.selectedObject);
});
transformControls.addEventListener('mouseUp', () => {
  if (state.selectedObject && transformBefore) {
    const after = captureTRS(state.selectedObject);
    if (!trsEqual(transformBefore, after))
      pushUndo({ type: 'transform', mesh: state.selectedObject, before: transformBefore, after });
    transformBefore = null;
  }
});
transformControls.addEventListener('objectChange', () => {
  if (state.selectedObject) { selBox.setFromObject(state.selectedObject); refreshProps(); }
});

// ─── Selection helper ────────────────────────────────────────────────────────
const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x4a9eff);
selBox.visible = false;
scene.add(selBox);

function selectObject(obj) {
  if (state.selectedObject) unhighlight(state.selectedObject);
  state.selectedObject = obj;
  if (obj) {
    highlight(obj);
    selBox.setFromObject(obj); selBox.visible = true;
    transformControls.attach(obj); transformControls.visible = true;
    refreshProps();
  } else {
    selBox.visible = false;
    transformControls.detach(); transformControls.visible = false;
    hideProps();
  }
  refreshStatus();
}

function highlight(mesh) {
  if (!mesh.material || mesh.userData._hi) return;
  mesh.userData._hi = { emissive: mesh.material.emissive.getHex(), ei: mesh.material.emissiveIntensity };
  mesh.material.emissive.set(0x2255cc);
  mesh.material.emissiveIntensity = .4;
}
function unhighlight(mesh) {
  if (!mesh.material || !mesh.userData._hi) return;
  mesh.material.emissive.set(mesh.userData._hi.emissive);
  mesh.material.emissiveIntensity = mesh.userData._hi.ei;
  delete mesh.userData._hi;
}

// ─── Transform state helpers ─────────────────────────────────────────────────
function captureTRS(mesh) {
  return { pos: mesh.position.clone(), quat: mesh.quaternion.clone(), sca: mesh.scale.clone() };
}
function applyTRS(mesh, t) {
  mesh.position.copy(t.pos); mesh.quaternion.copy(t.quat); mesh.scale.copy(t.sca);
}
function trsEqual(a, b) {
  return a.pos.equals(b.pos) && a.quat.equals(b.quat) && a.sca.equals(b.sca);
}

// ─── Undo / redo ─────────────────────────────────────────────────────────────
function pushUndo(action) { undoStack.push(action); redoStack.length = 0; syncUndoUI(); }

function addToScene(mesh) { sceneObjects.push(mesh); scene.add(mesh); }
function removeFromScene(mesh) {
  const i = sceneObjects.indexOf(mesh);
  if (i >= 0) sceneObjects.splice(i, 1);
  if (state.selectedObject === mesh) selectObject(null);
  scene.remove(mesh);
}

function applyAction(a) {
  if (a.type === 'add')       { addToScene(a.mesh); }
  else if (a.type === 'delete')    { removeFromScene(a.mesh); }
  else if (a.type === 'transform') {
    applyTRS(a.mesh, a.after);
    if (state.selectedObject === a.mesh) { selBox.setFromObject(a.mesh); transformControls.attach(a.mesh); }
  }
  else if (a.type === 'clear')  { a.meshes.forEach(removeFromScene); }
  else if (a.type === 'import') { a.before.forEach(removeFromScene); a.after.forEach(addToScene); }
}
function applyInverse(a) {
  if (a.type === 'add')       { removeFromScene(a.mesh); }
  else if (a.type === 'delete')    { addToScene(a.mesh); }
  else if (a.type === 'transform') {
    applyTRS(a.mesh, a.before);
    if (state.selectedObject === a.mesh) { selBox.setFromObject(a.mesh); transformControls.attach(a.mesh); }
  }
  else if (a.type === 'clear')  { a.meshes.forEach(addToScene); }
  else if (a.type === 'import') { a.after.forEach(removeFromScene); a.before.forEach(addToScene); }
}

function undo() {
  if (!undoStack.length) return;
  const a = undoStack.pop(); redoStack.push(a); applyInverse(a); syncUndoUI(); refreshStatus();
}
function redo() {
  if (!redoStack.length) return;
  const a = redoStack.pop(); undoStack.push(a); applyAction(a); syncUndoUI(); refreshStatus();
}
function syncUndoUI() {
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
}

// ─── Placement ghost ─────────────────────────────────────────────────────────
let ghost = null;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster   = new THREE.Raycaster();

function ensureGhost(type) {
  if (!ghost || ghost.userData.type !== type) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghost = createMesh(type, true);
    scene.add(ghost);
  }
}
function removeGhost() {
  if (ghost) { scene.remove(ghost); ghost = null; }
}

// ─── Raycasting helpers ──────────────────────────────────────────────────────
function toNDC(e) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - r.left) / r.width)  * 2 - 1,
    -((e.clientY - r.top)  / r.height) * 2 + 1
  );
}
function groundPoint(ndc) {
  raycaster.setFromCamera(ndc, editorCam);
  const t = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, t) ? t : null;
}
function snap(v) {
  const s = state.snapSize;
  if (!s) return v;
  v.x = Math.round(v.x / s) * s;
  v.z = Math.round(v.z / s) * s;
  return v;
}
function hitObject(ndc) {
  raycaster.setFromCamera(ndc, editorCam);
  const hits = raycaster.intersectObjects(sceneObjects, false);
  return hits.length ? hits[0].object : null;
}

// ─── Editor operations ────────────────────────────────────────────────────────
function placeObject(worldPos) {
  const def  = DEFS[state.placingType];
  const mesh = createMesh(state.placingType);
  mesh.position.set(worldPos.x, def.placedY, worldPos.z);
  addToScene(mesh);
  pushUndo({ type: 'add', mesh });
  refreshStatus();
}

function deleteObject(mesh) {
  removeFromScene(mesh);
  pushUndo({ type: 'delete', mesh });
  refreshStatus();
}

function clearAll() {
  if (!sceneObjects.length) return;
  const meshes = [...sceneObjects];
  selectObject(null);
  meshes.forEach(removeFromScene);
  pushUndo({ type: 'clear', meshes });
  refreshStatus();
}

// ─── Save / load ─────────────────────────────────────────────────────────────
function serializeScene() {
  return sceneObjects.map(m => {
    const o = {
      type:       m.userData.type,
      position:   m.position.toArray(),
      quaternion: m.quaternion.toArray(),
      scale:      m.scale.toArray(),
      color:      m.material.color.getHex(),
    };
    if (m.userData.pointLight) {
      o.lightColor     = m.userData.pointLight.color.getHex();
      o.lightIntensity = m.userData.pointLight.intensity;
      o.lightDistance  = m.userData.pointLight.distance;
    }
    return o;
  });
}

function deserializeObject(d) {
  const mesh = createMesh(d.type);
  mesh.position.fromArray(d.position);
  mesh.quaternion.fromArray(d.quaternion);
  mesh.scale.fromArray(d.scale);
  if (d.color !== undefined) mesh.material.color.setHex(d.color);
  if (d.lightColor !== undefined && mesh.userData.pointLight) {
    mesh.userData.pointLight.color.setHex(d.lightColor);
    mesh.userData.pointLight.intensity = d.lightIntensity;
    mesh.userData.pointLight.distance  = d.lightDistance;
  }
  return mesh;
}

function saveLevel() {
  const blob = new Blob([JSON.stringify({ version: 1, objects: serializeScene() }, null, 2)],
                        { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'level.json' });
  a.click();
  URL.revokeObjectURL(url);
}

function loadLevelJSON(json) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { alert('Invalid JSON file.'); return; }

  const before = [...sceneObjects];
  selectObject(null);
  before.forEach(removeFromScene);
  const after = (parsed.objects ?? []).map(deserializeObject);
  after.forEach(addToScene);
  pushUndo({ type: 'import', before, after });
  refreshStatus();
}

// ─── Playtest ─────────────────────────────────────────────────────────────────
let fpsLocked   = false;
let fpsYaw      = 0;
let fpsPitch    = 0;
let fpsHits     = 0;
const FPS_SPEED = 7;
const FPS_SENS  = 0.002;
const fpsKeys   = new Set();
const fpsPos    = new THREE.Vector3();
const savedTargetColors = new Map();
const fpsRay    = new THREE.Raycaster();

function startPlaytest() {
  if (state.isPlaytest) return;
  state.isPlaytest = true;
  fpsHits = 0;

  // save target colors for reset on stop
  savedTargetColors.clear();
  for (const m of sceneObjects)
    if (m.userData.type === 'target') savedTargetColors.set(m, m.material.color.getHex());

  // position FPS player at editor camera
  fpsPos.copy(editorCam.position);
  fpsPos.y = 1.6;
  fpsYaw = 0; fpsPitch = 0;

  selectObject(null);
  orbitControls.enabled = false;

  crosshair.style.display = 'block';
  playHint.style.display  = 'block';
  document.getElementById('btn-stop').style.display     = 'inline-flex';
  document.getElementById('btn-playtest').style.display = 'none';

  renderer.domElement.requestPointerLock();
  refreshStatus();
}

function _cleanupPlaytest() {
  // restore target colors
  for (const [m, hex] of savedTargetColors) m.material.color.setHex(hex);
  savedTargetColors.clear();
  fpsKeys.clear();
  orbitControls.enabled = true;

  crosshair.style.display = 'none';
  playHint.style.display  = 'none';
  document.getElementById('btn-stop').style.display     = 'none';
  document.getElementById('btn-playtest').style.display = 'inline-flex';

  refreshStatus();
}

function stopPlaytest() {
  if (!state.isPlaytest) return;
  state.isPlaytest = false;
  _cleanupPlaytest();
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

document.addEventListener('pointerlockchange', () => {
  fpsLocked = document.pointerLockElement === renderer.domElement;
  // pointer lock released externally (Esc) while still in playtest
  if (!fpsLocked && state.isPlaytest) {
    state.isPlaytest = false;
    _cleanupPlaytest();
  }
});

document.addEventListener('mousemove', e => {
  if (!fpsLocked || !state.isPlaytest) return;
  fpsYaw   -= e.movementX * FPS_SENS;
  fpsPitch -= e.movementY * FPS_SENS;
  fpsPitch  = Math.max(-1.4, Math.min(1.4, fpsPitch));
});

// ─── Canvas pointer events ────────────────────────────────────────────────────
let pDownPos = null;
renderer.domElement.addEventListener('pointerdown', e => {
  pDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!pDownPos) return;
  const dx = e.clientX - pDownPos.x;
  const dy = e.clientY - pDownPos.y;
  pDownPos = null;
  if (Math.hypot(dx, dy) > 5) return;          // drag → not a click
  if (state.isPlaytest) {                       // playtest: lock or shoot
    if (!fpsLocked) renderer.domElement.requestPointerLock();
    else fpsShoot();
    return;
  }
  if (transformControls.dragging) return;
  handleEditorClick(e);
});

function handleEditorClick(e) {
  const ndc = toNDC(e);
  if (state.mode === 'place') {
    const pt = groundPoint(ndc);
    if (pt) { snap(pt); placeObject(pt); }
  } else if (state.mode === 'select') {
    selectObject(hitObject(ndc));
  } else if (state.mode === 'delete') {
    const obj = hitObject(ndc);
    if (obj) deleteObject(obj);
  }
}

renderer.domElement.addEventListener('pointermove', e => {
  if (state.isPlaytest || state.mode !== 'place') { removeGhost(); return; }
  const pt = groundPoint(toNDC(e));
  if (!pt) { if (ghost) ghost.visible = false; return; }
  snap(pt);
  ensureGhost(state.placingType);
  ghost.position.set(pt.x, DEFS[state.placingType].placedY, pt.z);
  ghost.visible = true;
});

renderer.domElement.addEventListener('pointerleave', () => {
  if (ghost) ghost.visible = false;
});

function fpsShoot() {
  fpsRay.set(fpsCam.position, fpsCam.getWorldDirection(new THREE.Vector3()));
  const targets = sceneObjects.filter(m => m.userData.type === 'target');
  const hits    = fpsRay.intersectObjects(targets, false);
  if (!hits.length) return;
  hits[0].object.material.color.set(0x3399ff);
  fpsHits++;
  refreshStatus();
}

// ─── Keyboard ────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (state.isPlaytest) { fpsKeys.add(e.code); return; }

  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }

  if (state.mode === 'select' && !e.ctrlKey && !e.metaKey) {
    if (k === 'w') { setTransformMode('translate'); return; }
    if (k === 'e') { setTransformMode('rotate');    return; }
    if (k === 'r') { setTransformMode('scale');     return; }
  }

  if ((k === 'delete' || k === 'backspace') && state.mode === 'select' && state.selectedObject) {
    deleteObject(state.selectedObject);
    return;
  }
  if (k === 'p') { startPlaytest(); return; }
  if (k === 'escape') { stopPlaytest(); }
});

window.addEventListener('keyup', e => { fpsKeys.delete(e.code); });

// ─── UI wiring ───────────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  Object.entries(modeButtons).forEach(([k, b]) => b.classList.toggle('active', k === mode));
  if (mode !== 'select') selectObject(null);
  transformGroup.style.opacity       = mode === 'select' ? '1'    : '.4';
  transformGroup.style.pointerEvents = mode === 'select' ? ''     : 'none';
  if (mode !== 'place') removeGhost();
  refreshStatus();
}

function setTransformMode(tm) {
  state.transformMode = tm;
  transformControls.setMode(tm);
  Object.entries(transformButtons).forEach(([k, b]) => b.classList.toggle('active', k === tm));
}

function setPlacingType(type) {
  state.placingType = type;
  document.querySelectorAll('.lib-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}

function setSnap(val) {
  state.snapSize = parseFloat(val);
  if (state.snapSize) {
    transformControls.setTranslationSnap(state.snapSize);
    transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
    transformControls.setScaleSnap(0.1);
  } else {
    transformControls.setTranslationSnap(null);
    transformControls.setRotationSnap(null);
    transformControls.setScaleSnap(null);
  }
}

Object.entries(modeButtons).forEach(([k, b]) => b.addEventListener('click', () => setMode(k)));
Object.entries(transformButtons).forEach(([k, b]) => b.addEventListener('click', () => setTransformMode(k)));
document.querySelectorAll('.lib-btn').forEach(b => b.addEventListener('click', () => setPlacingType(b.dataset.type)));

snapSelect.addEventListener('change', () => setSnap(snapSelect.value));
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
document.getElementById('btn-clear').addEventListener('click', clearAll);

document.getElementById('btn-save').addEventListener('click', saveLevel);
document.getElementById('btn-load').addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', () => {
  const file = loadInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => loadLevelJSON(e.target.result);
  reader.readAsText(file);
  loadInput.value = '';
});

document.getElementById('btn-playtest').addEventListener('click', startPlaytest);
document.getElementById('btn-stop').addEventListener('click', stopPlaytest);

// ─── Properties panel ────────────────────────────────────────────────────────
function r3(v, dec = 2) { return typeof v === 'number' ? v.toFixed(dec) : v; }
const R2D = 180 / Math.PI;

function refreshProps() {
  const m = state.selectedObject;
  if (!m) { hideProps(); return; }
  propsPanel.style.display = 'block';
  const p = m.position, q = m.rotation, s = m.scale;
  propsContent.innerHTML = `
    <div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${DEFS[m.userData.type].label}</span></div>
    <div class="prop-row"><span class="prop-key">Pos</span><span class="prop-val">${r3(p.x)}, ${r3(p.y)}, ${r3(p.z)}</span></div>
    <div class="prop-row"><span class="prop-key">Rot°</span><span class="prop-val">${r3(q.x*R2D,1)}, ${r3(q.y*R2D,1)}, ${r3(q.z*R2D,1)}</span></div>
    <div class="prop-row"><span class="prop-key">Scale</span><span class="prop-val">${r3(s.x)}, ${r3(s.y)}, ${r3(s.z)}</span></div>
  `;
}
function hideProps() { propsPanel.style.display = 'none'; }

// ─── Status bar ───────────────────────────────────────────────────────────────
function refreshStatus() {
  if (state.isPlaytest) {
    statusText.innerHTML =
      `<span class="s-play">▶ PLAY</span><span class="s-sep">│</span>` +
      `WASD · Move<span class="s-sep">│</span>LMB · Shoot<span class="s-sep">│</span>` +
      `Esc · Exit<span class="s-sep">│</span><span class="s-hit">Hits: ${fpsHits}</span>`;
    return;
  }
  const modeLabel = state.mode[0].toUpperCase() + state.mode.slice(1);
  let txt = `<span class="s-mode">${modeLabel}</span><span class="s-sep">│</span>Objects: ${sceneObjects.length}`;
  if (state.mode === 'place')
    txt += `<span class="s-sep">│</span>Placing: ${DEFS[state.placingType].label}`;
  if (state.selectedObject) {
    const p = state.selectedObject.position;
    txt += `<span class="s-sep">│</span>Sel: ${DEFS[state.selectedObject.userData.type].label} @ ${r3(p.x)},${r3(p.y)},${r3(p.z)}`;
  }
  statusText.innerHTML = txt;
}

// ─── Animation loop ───────────────────────────────────────────────────────────
const _fwd   = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move  = new THREE.Vector3();
let lastT = 0;

function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;

  if (state.isPlaytest) {
    // FPS movement
    _fwd.set(0, 0, -1).applyEuler(new THREE.Euler(0, fpsYaw, 0));
    _right.set(1, 0, 0).applyEuler(new THREE.Euler(0, fpsYaw, 0));
    _move.set(0, 0, 0);
    if (fpsKeys.has('KeyW') || fpsKeys.has('ArrowUp'))    _move.addScaledVector(_fwd, 1);
    if (fpsKeys.has('KeyS') || fpsKeys.has('ArrowDown'))  _move.addScaledVector(_fwd, -1);
    if (fpsKeys.has('KeyA') || fpsKeys.has('ArrowLeft'))  _move.addScaledVector(_right, -1);
    if (fpsKeys.has('KeyD') || fpsKeys.has('ArrowRight')) _move.addScaledVector(_right, 1);
    if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(FPS_SPEED * dt);
    fpsPos.add(_move);
    fpsPos.y = 1.6;

    fpsCam.position.copy(fpsPos);
    fpsCam.rotation.order = 'YXZ';
    fpsCam.rotation.y = fpsYaw;
    fpsCam.rotation.x = fpsPitch;

    updateGridChunks(fpsPos.x, fpsPos.z);
    renderer.render(scene, fpsCam);
  } else {
    orbitControls.update();
    updateGridChunks(editorCam.position.x, editorCam.position.z);
    renderer.render(scene, editorCam);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
new ResizeObserver(onResize).observe(canvasContainer);
onResize();
setSnap(snapSelect.value);
refreshStatus();
requestAnimationFrame(animate);
