import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Sky }              from 'three/addons/objects/Sky.js';
import { CSG }              from 'https://esm.sh/three-csg-ts@3.2.0?external=three';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvasContainer = document.getElementById('canvas-container');
const statusText      = document.getElementById('status-text');
const crosshair       = document.getElementById('crosshair');
const playHint        = document.getElementById('play-hint');
const propsPanel      = document.getElementById('props-panel');
const propsContent    = document.getElementById('props-content');
const topMenuSelect   = document.getElementById('top-menu-select');
const topPanels       = Array.from(document.querySelectorAll('.top-panel'));
const snapSelect      = document.getElementById('snap-select');
const lightIntensityInput = document.getElementById('light-intensity');
const sunIntensityInput   = document.getElementById('sun-intensity');
const sunTimeInput        = document.getElementById('sun-time');
const sunNorthInput       = document.getElementById('sun-north');
const sunTurbidityInput   = document.getElementById('sun-turbidity');
const sunShadowRangeInput = document.getElementById('sun-shadow-range');
const sunDayDurationInput = document.getElementById('sun-day-duration');
const sunDayCycleEnabledInput = document.getElementById('sun-day-cycle-enabled');
const chunkRangeSelect = document.getElementById('chunk-range-select');
const undoBtn         = document.getElementById('btn-undo');
const redoBtn         = document.getElementById('btn-redo');
const loadInput       = document.getElementById('load-input');
const topbarEl        = document.getElementById('topbar');
const workspaceEl     = document.getElementById('workspace');
const sidebarEl       = document.getElementById('sidebar');
const sidebarResizerEl = document.getElementById('sidebar-resizer');
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
const functionsResizerEl = document.getElementById('functions-resizer');
const functionsToggleBtn = document.getElementById('functions-toggle');
const shapeSidesInput  = document.getElementById('shape-sides');
const shapeDepthInput  = document.getElementById('shape-depth');
const placeOpacityInput = document.getElementById('place-opacity');
const paintColorInput  = document.getElementById('paint-color');
const pickColorBtn     = document.getElementById('btn-pick-color');
const eraserShapeInput = document.getElementById('eraser-shape');
const eraserSizeInput  = document.getElementById('eraser-size');
const libraryPaneButtons = Array.from(document.querySelectorAll('[data-lib-pane]'));
const libraryPaneObjectsEl = document.getElementById('library-pane-objects');
const libraryPaneAudioEl = document.getElementById('library-pane-audio');
const audioImportBtn = document.getElementById('btn-audio-import');
const audioImportInput = document.getElementById('audio-import-input');
const audioLibListEl = document.getElementById('audio-lib-list');

// Main menu / project library
const mainMenuEl          = document.getElementById('main-menu');
const mainMenuProjectList = document.getElementById('mm-project-list');
const mmNewBtn            = document.getElementById('mm-new');
const mmImportBtn         = document.getElementById('mm-import');
const mmImportInput       = document.getElementById('mm-import-input');
const btnSaveProject      = document.getElementById('btn-save-project');
const btnBackMenu         = document.getElementById('btn-back-menu');
const btnExportGame       = document.getElementById('btn-export-game');
const btnExportLoader     = document.getElementById('btn-export-loader');
const btnResetCheckpoints = document.getElementById('btn-reset-checkpoints');
const btnResetValues      = document.getElementById('btn-reset-values');

// Player gamerule inputs
const grJumpInput    = document.getElementById('gr-jump');
const grGravityInput = document.getElementById('gr-gravity');
const grGravityEnabledInput = document.getElementById('gr-gravity-enabled');
const grHeightInput  = document.getElementById('gr-height');
const grSprintInput  = document.getElementById('gr-sprint');
const grMaxHpInput   = document.getElementById('gr-maxhp');
const grFallDmgInput = document.getElementById('gr-falldmg');
const healthHud      = document.getElementById('health-hud');
const healthBarFill  = document.getElementById('health-bar-fill');
const healthText     = document.getElementById('health-text');

// Grid floor fill
const gridFillColorInput   = document.getElementById('grid-fill-color');
const gridFillEnabledInput = document.getElementById('grid-fill-enabled');

// Quality settings
const qualityRenderDistInput = document.getElementById('quality-render-dist');
const qualityShadowsSelect   = document.getElementById('quality-shadows');
const qualityLightDistInput  = document.getElementById('quality-light-dist');

// Fall damage & spawn protection inputs
const grFallDmgMinHtInput  = document.getElementById('gr-falldmg-minht');
const grFallDmgMultInput   = document.getElementById('gr-falldmg-mult');
const grSpawnProtTimeInput = document.getElementById('gr-spawnprot-time');
const grSpawnProtCondInput = document.getElementById('gr-spawnprot-cond');

// Conditional triggers
const condTriggersListEl    = document.getElementById('cond-triggers-list');
const btnAddCondTrigger     = document.getElementById('btn-add-cond-trigger');
const playerNameInput       = document.getElementById('player-name');
const playerGroupsInput     = document.getElementById('player-groups');
const playerGroupsOptionsEl = document.getElementById('player-groups-options');
const varsListEl            = document.getElementById('vars-list');
const boolsListEl           = document.getElementById('bools-list');
const btnAddVar             = document.getElementById('btn-add-var');
const btnAddBool            = document.getElementById('btn-add-bool');

const functionsPanelEl      = document.getElementById('functions-panel');
const controlFunctionsListEl = document.getElementById('control-functions-list');
const btnAddControlFn       = document.getElementById('btn-add-control-fn');
const controlFnSearchInput  = document.getElementById('control-fn-search');
const controlFnNewGroupInput = document.getElementById('control-fn-new-group');
const btnAddControlGroup    = document.getElementById('btn-add-control-group');

const modeButtons = {
  place:  document.getElementById('btn-place'),
  select: document.getElementById('btn-select'),
  delete: document.getElementById('btn-delete'),
  paint:  document.getElementById('btn-paint'),
  erase:  document.getElementById('btn-erase'),
};
const transformButtons = {
  translate: document.getElementById('btn-translate'),
  rotate:    document.getElementById('btn-rotate'),
  scale:     document.getElementById('btn-scale'),
};
const transformGroup = document.getElementById('transform-group');
const scaleSideXSelect = document.getElementById('scale-side-x');
const scaleSideYSelect = document.getElementById('scale-side-y');
const scaleSideZSelect = document.getElementById('scale-side-z');

// ─── Editor state ────────────────────────────────────────────────────────────
const state = {
  mode:          'place',      // place | select | delete | paint | erase
  placingType:   'wall',       // wall | floor | target | light
  transformMode: 'translate',  // translate | rotate | scale
  snapSize:      1,
  defaultLightIntensity: 3,
  chunkRenderRadius: 2,
  selectedObject: null,
  extraSelected:  [],
  isPlaytest:    false,
  cloneScale:    null,
  cloneShapeParams: null,
  placeSides: 12,
  place2DDepth: 0.2,
  placeOpacity: 1,
  brushColor: 0x4a5568,
  colorPickArmed: false,
  eraserShape: 'box',
  eraserSize: 1,
  scaleSides: {
    x: 'pos',
    y: 'pos',
    z: 'pos',
  },
};

const sceneObjects = [];   // all placed meshes
const undoStack    = [];
const redoStack    = [];
let _nextEditorGroupId = 1;
let currentProjectId = null;
let currentProjectName = '';

const PROJECTS_STORAGE_KEY    = 'flame3d_projects_v1';
const EDITOR_SETTINGS_KEY     = 'flame3d_editor_settings_v1';
const SIDEBAR_MIN_WIDTH       = 160;
const SIDEBAR_MAX_WIDTH       = 420;
const FUNCTIONS_PANEL_MIN_WIDTH = 220;
const FUNCTIONS_PANEL_MAX_WIDTH = 560;

const runtimeMode = !!globalThis.__FLAME3D_RUNTIME_MODE__;
const runtimeLoaderMode = !!globalThis.__FLAME3D_RUNTIME_LOADER__;
const runtimeAutostart = globalThis.__FLAME3D_RUNTIME_AUTOSTART__ !== undefined
  ? !!globalThis.__FLAME3D_RUNTIME_AUTOSTART__
  : runtimeMode;
const runtimeEmbeddedLevelRaw = globalThis.__FLAME3D_EMBEDDED_LEVEL__;
const RUNTIME_LIBRARY_STORAGE_KEY = 'flame3d_runtime_library_v1';
const RUNTIME_OPTIMIZER_CHECK_INTERVAL_MS = 5000;
const RUNTIME_OPTIMIZER_COOLDOWN_MS = 8000;
const RUNTIME_QUALITY_PROFILES = [
  { label: 'Performance', shadows: 'off', renderDist: 80, lightDist: 35 },
  { label: 'Balanced', shadows: 'low', renderDist: 130, lightDist: 55 },
  { label: 'Quality', shadows: 'medium', renderDist: 185, lightDist: 85 },
  { label: 'Ultra', shadows: 'high', renderDist: 250, lightDist: 120 },
];
let runtimeLoaderOverlayEl = null;
let runtimeHudEl = null;
let runtimeSettingsPanelEl = null;
let runtimePauseOverlayEl = null;
let runtimePauseActive = false;
let runtimeActiveLibraryEntryId = null;
let runtimeActiveLibraryEntryName = '';
const runtimeOptimizer = {
  autoPerformance: true,
  autoVisual: true,
  emaFps: 60,
  lowFpsStreak: 0,
  highFpsStreak: 0,
  lastCheckMs: 0,
  lastSwapMs: 0,
};

const sidebarState = {
  width: 200,
  collapsed: false,
  resizing: false,
};

const functionsPanelState = {
  width: 340,
  collapsed: false,
  resizing: false,
};

const audioLibrary = [];
let activeLibraryPane = 'objects';
let libraryPreviewAudio = null;
let libraryPreviewAudioId = null;

const CUSTOM_SKIN_GRID_DEFAULT = Object.freeze({ x: 8, y: 6, z: 8 });
const CUSTOM_SKIN_GRID_LIMITS = Object.freeze({
  x: { min: 1, max: 32 },
  y: { min: 1, max: 24 },
  z: { min: 1, max: 32 },
});
const CUSTOM_SKIN_MAX_VOXELS = 2048;
const customBlockSkins = {};
let libraryContextMenuEl = null;
let keypadContextMenuEl = null;
let skinEditorOverlayEl = null;
let skinEditorDragActive = false;
let suppressPointerUnlockStop = false;
let activeKeypadConfigMesh = null;
const skinEditorState = {
  type: 'wall',
  layer: 0,
  eraseMode: false,
  brushColor: 0x7f8ea0,
  gridSize: { ...CUSTOM_SKIN_GRID_DEFAULT },
  voxelMap: new Map(),
  undoStack: [],
  redoStack: [],
};
let skin3DState = null; // { renderer, scene, camera, controls, voxelGroup, floorMesh, sharedGeo, animId, roSub }
const _skinTempVec = new THREE.Vector3();
const _skinTempVecB = new THREE.Vector3();
const _skinTempMatrix = new THREE.Matrix4();
const _keypadPickNdc = new THREE.Vector2();
const _hitboxLocalCenter = new THREE.Vector3();
const _hitboxLocalSize = new THREE.Vector3();
const _hitboxCorner = new THREE.Vector3();
const _hitboxWorldPoint = new THREE.Vector3();
const _runtimeNumericOverrides = new Map();
let runtimeKeypadOverlayEl = null;
let activeRuntimeKeypadMesh = null;

// ─── Quality settings ────────────────────────────────────────────────────────
const quality = {
  renderDist:  150,   // block visibility distance
  shadows:     'medium', // off | low | medium | high
  lightDist:   60,    // point-light render distance
};
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();

// ─── Renderer ────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type         = THREE.PCFSoftShadowMap;
renderer.toneMapping            = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure    = 0.5;
canvasContainer.appendChild(renderer.domElement);
renderer.domElement.tabIndex = 0;

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
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0015);

const ambientLight = new THREE.HemisphereLight(0x87ceeb, 0x362e1e, 0.35);
scene.add(ambientLight);

const LIGHT_BLOCK_DISTANCE = 24;
const LIGHT_BLOCK_DECAY = 1.4;
const LIGHT_BLOCK_SHADOW_MAP = 512;
const LIGHT_BLOCK_SHADOW_BIAS = -0.0008;

// ─── Sun / Sky defaults ──────────────────────────────────────────────────────
const SUN_INTENSITY_DEFAULT  = 20;
const SUN_TIME_DEFAULT       = 14;     // 2 PM — nice afternoon
const SUN_NORTH_DEFAULT      = 0;      // north offset degrees
const SUN_TURBIDITY_DEFAULT  = 2;      // haze (2=clear, 10=hazy)
const SUN_SHADOW_RANGE_DEFAULT = 100;
const SUN_DAY_DURATION_DEFAULT = 120;  // seconds for a full 24h cycle
const SUN_DAY_CYCLE_ENABLED_DEFAULT = false;
const SUN_DISTANCE = 200;

// ─── Sky dome ────────────────────────────────────────────────────────────────
const sky = new Sky();
sky.scale.setScalar(450000);
sky.material.fog = false;
scene.add(sky);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value        = SUN_TURBIDITY_DEFAULT;
skyUniforms['rayleigh'].value         = 2;
skyUniforms['mieCoefficient'].value   = 0.005;
skyUniforms['mieDirectionalG'].value  = 0.8;

// ─── Sun light ───────────────────────────────────────────────────────────────
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);

const sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY_DEFAULT);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.bias       = -0.00015;
sunLight.shadow.normalBias = 0.015;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far  = SUN_DISTANCE * 2;
sunLight.target = sunTarget;
scene.add(sunLight);

// ─── Sun helpers ─────────────────────────────────────────────────────────────
function clampSunIntensity(v)    { return THREE.MathUtils.clamp(Number.isFinite(v) ? v : SUN_INTENSITY_DEFAULT, 0, 100); }
function clampSunTime(v)         { return THREE.MathUtils.clamp(Number.isFinite(v) ? v : SUN_TIME_DEFAULT, 0.000, 24.000); }
function clampSunNorth(v)        { return Number.isFinite(v) ? ((v % 360) + 360) % 360 : SUN_NORTH_DEFAULT; }
function clampSunTurbidity(v)    { return THREE.MathUtils.clamp(Number.isFinite(v) ? v : SUN_TURBIDITY_DEFAULT, 1, 20); }
function clampSunShadowRange(v)  { return THREE.MathUtils.clamp(Number.isFinite(v) ? v : SUN_SHADOW_RANGE_DEFAULT, 20, 500); }
function clampSunDayDuration(v)  { return THREE.MathUtils.clamp(Number.isFinite(v) ? v : SUN_DAY_DURATION_DEFAULT, 1, 3600); }

/** Convert time-of-day (0-24) + north offset → sun direction vector (unit). */
function sunPositionFromTime(time, northDeg) {
  // Sun arc: rises at ~6, peaks at 12, sets at ~18.
  // phi = polar angle from zenith (0 = directly overhead, π/2 = horizon)
  // theta = azimuth around Y axis
  const dayProgress = THREE.MathUtils.clamp((time - 6) / 12, 0, 1); // 0 at 6h, 1 at 18h
  const phi = Math.PI * 0.5 - Math.sin(dayProgress * Math.PI) * Math.PI * 0.48; // 0.48 so peak is near-vertical
  // Before sunrise / after sunset: push below horizon
  let elevation = Math.PI * 0.5 - phi;
  if (time < 5 || time > 19) elevation = THREE.MathUtils.degToRad(-12);
  else if (time < 6) elevation = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-12, 0, (time - 5)));
  else if (time > 18) elevation = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(0, -12, (time - 18)));

  const azimuth = THREE.MathUtils.degToRad((dayProgress - 0.5) * 180 + northDeg); // east → south → west
  const cosEl = Math.cos(elevation);
  return new THREE.Vector3(
    -Math.sin(azimuth) * cosEl,
    Math.sin(elevation),
    -Math.cos(azimuth) * cosEl,
  ).normalize();
}

/** Compute atmospheric light color tint based on sun elevation. */
function sunColorFromElevation(elevDeg) {
  // Noon = white-ish.  Low sun = warm orange.  Below horizon = deep blue.
  const t = THREE.MathUtils.clamp(elevDeg / 90, -0.15, 1);
  const color = new THREE.Color();
  if (t > 0.2) {
    // daylight: lerp from warm noon white to very slightly warm
    color.setRGB(1.0, 0.98, 0.92);
  } else if (t > 0.01) {
    // golden hour / sunset
    const f = THREE.MathUtils.mapLinear(t, 0.01, 0.2, 0, 1);
    color.setRGB(
      THREE.MathUtils.lerp(1.0, 1.0, f),
      THREE.MathUtils.lerp(0.55, 0.98, f),
      THREE.MathUtils.lerp(0.2, 0.92, f),
    );
  } else {
    // twilight / night
    const f = THREE.MathUtils.mapLinear(t, -0.15, 0.01, 0, 1);
    color.setRGB(
      THREE.MathUtils.lerp(0.05, 1.0, f),
      THREE.MathUtils.lerp(0.05, 0.55, f),
      THREE.MathUtils.lerp(0.15, 0.2, f),
    );
  }
  return color;
}

function updateSunSky() {
  const time        = clampSunTime(parseFloat(sunTimeInput.value));
  const northOffset = clampSunNorth(parseFloat(sunNorthInput.value));
  const turbidity   = clampSunTurbidity(parseFloat(sunTurbidityInput.value));
  const shadowRange = clampSunShadowRange(parseFloat(sunShadowRangeInput.value));
  const intensity   = clampSunIntensity(parseFloat(sunIntensityInput.value));
  const dayDuration = clampSunDayDuration(parseFloat(sunDayDurationInput.value));

  // Sync inputs
  sunTimeInput.value        = time.toFixed(3);
  sunNorthInput.value       = Math.round(northOffset);
  sunTurbidityInput.value   = turbidity.toFixed(1);
  sunShadowRangeInput.value = Math.round(shadowRange);
  sunIntensityInput.value   = intensity.toFixed(1);
  sunDayDurationInput.value = Math.round(dayDuration);

  // Compute sun direction
  const sunDir = sunPositionFromTime(time, northOffset);
  const elevDeg = THREE.MathUtils.radToDeg(Math.asin(sunDir.y));

  // Update sky dome
  skyUniforms['turbidity'].value = turbidity;
  skyUniforms['sunPosition'].value.copy(sunDir);

  // Update directional light — position the light opposite to the sun direction
  sunLight.intensity = intensity;
  sunLight.color.copy(sunColorFromElevation(elevDeg));
  sunLight.position.copy(sunDir.clone().multiplyScalar(SUN_DISTANCE));
  sunTarget.position.set(0, 0, 0);

  // Shadow frustum
  sunLight.shadow.camera.left   = -shadowRange;
  sunLight.shadow.camera.right  =  shadowRange;
  sunLight.shadow.camera.top    =  shadowRange;
  sunLight.shadow.camera.bottom = -shadowRange;
  sunLight.shadow.camera.far    =  shadowRange * 4;
  const biasScale = Math.sqrt(shadowRange / 100);
  sunLight.shadow.bias       = -0.0003 * biasScale;
  sunLight.shadow.normalBias =  0.02   * biasScale;
  sunLight.shadow.camera.updateProjectionMatrix();

  // Update ambient / hemisphere
  const dayFactor = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -5, 20, 0, 1), 0, 1);
  ambientLight.intensity = THREE.MathUtils.lerp(0.18, 0.6, dayFactor);
  const skyColor = sunColorFromElevation(elevDeg);
  // Night: blue-ish moonlight tint
  if (dayFactor < 0.3) {
    const moonFactor = THREE.MathUtils.mapLinear(dayFactor, 0, 0.3, 1, 0);
    ambientLight.color.setRGB(
      THREE.MathUtils.lerp(skyColor.r, 0.15, moonFactor),
      THREE.MathUtils.lerp(skyColor.g, 0.18, moonFactor),
      THREE.MathUtils.lerp(skyColor.b, 0.35, moonFactor),
    );
  } else {
    ambientLight.color.copy(skyColor);
  }
  ambientLight.groundColor.setRGB(
    THREE.MathUtils.lerp(0.04, 0.15, dayFactor),
    THREE.MathUtils.lerp(0.04, 0.12, dayFactor),
    THREE.MathUtils.lerp(0.08, 0.08, dayFactor),
  );

  // Make light-emitting blocks less affected by darkness
  for (const m of sceneObjects) {
    if (m.userData.pointLight && m.material) {
      // Even at night, keep emissive blocks visible
      const nightBoost = THREE.MathUtils.lerp(1.5, 1.0, dayFactor);
      m.material.emissiveIntensity = nightBoost;
    }
  }

  // Fog matches sky horizon
  const fogBrightness = THREE.MathUtils.lerp(0.01, 0.6, dayFactor);
  scene.fog.color.copy(skyColor).multiplyScalar(fogBrightness);
}

/** Keep shadow camera centered on active camera so shadows work everywhere. */
function updateSunShadowCenter(pos) {
  const time = clampSunTime(parseFloat(sunTimeInput.value));
  const north = clampSunNorth(parseFloat(sunNorthInput.value));
  const sunDir = sunPositionFromTime(time, north);
  sunTarget.position.set(pos.x, 0, pos.z);
  sunLight.position.copy(sunTarget.position).addScaledVector(sunDir, SUN_DISTANCE);
  sunLight.shadow.camera.updateProjectionMatrix();
}

const EDIT_SPEED = 12;
const EDIT_VERTICAL_SPEED = 9;
const editKeys = new Set();

const PLAYER_RADIUS = 0.35;
const STEP_HEIGHT = 0.55;
const COLLISION_SUBSTEP = 0.05;

const gameRules = {
  jumpHeight: 8.5,
  gravity: 24,
  gravityEnabled: true,
  height: 1.75,
  eyeHeight: 1.6,
  fallDamage: false,
  fallDamageMinHeight: 4,
  fallDamageMultiplier: 1,
  sprintSpeed: 12,
  maxHealth: 100,
  spawnProtectTime: 0,
  spawnProtectCondition: 'all',
};
const playerProfile = {
  name: 'Player',
  groups: ['default'],
};
const BASE_FPS_SPEED = 7;

// ─── Chunked infinite grid ───────────────────────────────────────────────────
const CHUNK_SIZE  = 20;
const gridChunks  = new Map();
const gridFillPlanes = new Map();
let gridFillColor   = 0x1a2636;
let gridFillEnabled = false;
let lastChunkX = Infinity;
let lastChunkZ = Infinity;
let lastChunkRange = Infinity;

function updateGridChunks(wx, wz) {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const range = state.chunkRenderRadius;
  if (cx === lastChunkX && cz === lastChunkZ && range === lastChunkRange) return;
  lastChunkX = cx; lastChunkZ = cz;
  lastChunkRange = range;

  const needed = new Set();
  for (let dx = -range; dx <= range; dx++)
    for (let dz = -range; dz <= range; dz++)
      needed.add(`${cx + dx},${cz + dz}`);

  for (const [key, mesh] of gridChunks) {
    if (!needed.has(key)) { scene.remove(mesh); mesh.geometry.dispose(); gridChunks.delete(key); }
  }
  for (const [key, mesh] of gridFillPlanes) {
    if (!needed.has(key)) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); gridFillPlanes.delete(key); }
  }

  for (const key of needed) {
    if (!gridChunks.has(key)) {
      const [kx, kz] = key.split(',').map(Number);
      const g = new THREE.GridHelper(CHUNK_SIZE, 20, 0x1e3a5f, 0x0e1f33);
      g.position.set(kx * CHUNK_SIZE + CHUNK_SIZE / 2, 0, kz * CHUNK_SIZE + CHUNK_SIZE / 2);
      scene.add(g);
      gridChunks.set(key, g);
    }
    // Fill planes
    if (gridFillEnabled && !gridFillPlanes.has(key)) {
      const [kx, kz] = key.split(',').map(Number);
      const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
      const mat = new THREE.MeshBasicMaterial({ color: gridFillColor, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(geo, mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(kx * CHUNK_SIZE + CHUNK_SIZE / 2, -0.01, kz * CHUNK_SIZE + CHUNK_SIZE / 2);
      scene.add(plane);
      gridFillPlanes.set(key, plane);
    }
  }
  // Remove fill planes if fill got disabled
  if (!gridFillEnabled && gridFillPlanes.size > 0) {
    for (const [key, mesh] of gridFillPlanes) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    gridFillPlanes.clear();
  }
}

// ─── Object definitions ──────────────────────────────────────────────────────
function clampShapeSides(value) {
  return THREE.MathUtils.clamp(parseInt(value, 10) || 12, 3, 64);
}

function clampShapeDepth(value) {
  return THREE.MathUtils.clamp(parseFloat(value) || 0.2, 0.05, 8);
}

function makeRegularShape2D(sides, radius = 1) {
  const count = clampShapeSides(sides);
  const shape = new THREE.Shape();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI * 0.5;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function makeExtrudedShapeGeometry(sides, depth, radius = 1) {
  const shape = makeRegularShape2D(sides, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: clampShapeDepth(depth),
    bevelEnabled: false,
    curveSegments: Math.max(6, clampShapeSides(sides)),
  });
  geo.center();
  return geo;
}

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
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xffdd88, emissive: 0xffdd88, emissiveIntensity: 1.85 }),
    placedY: 3,
  },
  spawn: {
    label: 'Spawn',
    makeGeo: () => new THREE.CylinderGeometry(0.25, 0.35, 1.75, 8),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x30d050, emissive: 0x30d050, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 }),
    placedY: 0.875,
  },
  checkpoint: {
    label: 'Checkpoint',
    makeGeo: () => new THREE.CylinderGeometry(0.4, 0.4, 1.2, 18),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x3cb8ff, emissive: 0x3cb8ff, emissiveIntensity: 0.55, transparent: true, opacity: 0.75 }),
    placedY: 0.6,
  },
  trigger: {
    label: 'Control',
    makeGeo: () => new THREE.BoxGeometry(2, 2, 2),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xf0a020, emissive: 0xf0a020, emissiveIntensity: 0.3, transparent: true, opacity: 0.35 }),
    placedY: 1,
  },
  keypad: {
    label: 'Keypad',
    makeGeo: () => new THREE.BoxGeometry(1.6, 2.2, 0.45),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x8ca4b8, roughness: 0.45, metalness: 0.25, emissive: 0x0f141b, emissiveIntensity: 0.45 }),
    placedY: 1.1,
  },
  cube: {
    label: 'Cube',
    makeGeo: () => new THREE.BoxGeometry(1.6, 1.6, 1.6),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x607d9c, roughness: 0.7, metalness: 0.1 }),
    placedY: 0.8,
  },
  sphere: {
    label: 'Sphere',
    usesSides: true,
    defaultSides: 12,
    makeGeo: params => {
      const sides = clampShapeSides(params?.sides ?? 12);
      return new THREE.SphereGeometry(0.9, sides, Math.max(3, Math.round(sides * 0.75)));
    },
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x5c91c7, roughness: 0.6, metalness: 0.1 }),
  },
  cylinder: {
    label: 'Cylinder',
    usesSides: true,
    defaultSides: 16,
    makeGeo: params => new THREE.CylinderGeometry(0.75, 0.75, 1.6, clampShapeSides(params?.sides ?? 16)),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x5f8a92, roughness: 0.7 }),
  },
  cone: {
    label: 'Cone',
    usesSides: true,
    defaultSides: 12,
    makeGeo: params => new THREE.ConeGeometry(0.85, 1.7, clampShapeSides(params?.sides ?? 12)),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x8b6b53, roughness: 0.8 }),
  },
  pyramid: {
    label: 'Pyramid',
    usesSides: true,
    defaultSides: 4,
    makeGeo: params => new THREE.CylinderGeometry(0, 0.95, 1.8, clampShapeSides(params?.sides ?? 4), 1),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xa27d52, roughness: 0.82 }),
  },
  prism: {
    label: 'Prism',
    usesSides: true,
    defaultSides: 6,
    makeGeo: params => new THREE.CylinderGeometry(0.82, 0.82, 1.55, clampShapeSides(params?.sides ?? 6), 1),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x6a8f75, roughness: 0.75 }),
  },
  torus: {
    label: 'Torus',
    usesSides: true,
    defaultSides: 16,
    makeGeo: params => {
      const sides = clampShapeSides(params?.sides ?? 16);
      return new THREE.TorusGeometry(0.85, 0.24, Math.max(6, Math.floor(sides * 0.75)), sides);
    },
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x8673b8, roughness: 0.55, metalness: 0.2 }),
  },
  plane2d: {
    label: 'Square 2D',
    is2D: true,
    makeGeo: params => {
      const d = clampShapeDepth(params?.depth ?? 0.2);
      return new THREE.BoxGeometry(1.8, 1.8, d);
    },
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x4e8b7a, roughness: 0.85, side: THREE.DoubleSide }),
  },
  triangle2d: {
    label: 'Triangle 2D',
    is2D: true,
    makeGeo: params => makeExtrudedShapeGeometry(3, params?.depth ?? 0.2, 1),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x3f7b9f, roughness: 0.86, side: THREE.DoubleSide }),
  },
  circle2d: {
    label: 'Circle 2D',
    is2D: true,
    usesSides: true,
    defaultSides: 20,
    makeGeo: params => makeExtrudedShapeGeometry(Math.max(8, clampShapeSides(params?.sides ?? 20)), params?.depth ?? 0.2, 1),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x657b45, roughness: 0.85, side: THREE.DoubleSide }),
  },
  polygon2d: {
    label: 'Polygon 2D',
    is2D: true,
    usesSides: true,
    defaultSides: 6,
    makeGeo: params => makeExtrudedShapeGeometry(clampShapeSides(params?.sides ?? 6), params?.depth ?? 0.2, 1),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x7a5f8f, roughness: 0.85, side: THREE.DoubleSide }),
  },
};

function normalizeSkinGridSize(gridSize = {}) {
  return {
    x: THREE.MathUtils.clamp(parseInt(gridSize.x, 10) || CUSTOM_SKIN_GRID_DEFAULT.x, CUSTOM_SKIN_GRID_LIMITS.x.min, CUSTOM_SKIN_GRID_LIMITS.x.max),
    y: THREE.MathUtils.clamp(parseInt(gridSize.y, 10) || CUSTOM_SKIN_GRID_DEFAULT.y, CUSTOM_SKIN_GRID_LIMITS.y.min, CUSTOM_SKIN_GRID_LIMITS.y.max),
    z: THREE.MathUtils.clamp(parseInt(gridSize.z, 10) || CUSTOM_SKIN_GRID_DEFAULT.z, CUSTOM_SKIN_GRID_LIMITS.z.min, CUSTOM_SKIN_GRID_LIMITS.z.max),
  };
}

function normalizeCustomBlockSkin(def = {}) {
  const gridSize = normalizeSkinGridSize(def.gridSize || CUSTOM_SKIN_GRID_DEFAULT);
  const voxelsIn = Array.isArray(def.voxels) ? def.voxels : [];
  const voxels = [];
  const seen = new Set();
  for (const raw of voxelsIn) {
    const x = THREE.MathUtils.clamp(parseInt(raw?.x, 10) || 0, 0, gridSize.x - 1);
    const y = THREE.MathUtils.clamp(parseInt(raw?.y, 10) || 0, 0, gridSize.y - 1);
    const z = THREE.MathUtils.clamp(parseInt(raw?.z, 10) || 0, 0, gridSize.z - 1);
    const key = `${x}|${y}|${z}`;
    if (seen.has(key)) continue;
    const rawColor = typeof raw?.color === 'string'
      ? Number.parseInt(raw.color.replace('#', ''), 16)
      : Number(raw?.color);
    const color = THREE.MathUtils.clamp(Number.isFinite(rawColor) ? rawColor : 0x7f8ea0, 0, 0xffffff);
    seen.add(key);
    voxels.push({ x, y, z, color: Math.round(color) });
    if (voxels.length >= CUSTOM_SKIN_MAX_VOXELS) break;
  }
  return {
    version: 1,
    gridSize,
    voxels,
  };
}

function buildSkinLayout(mesh, skin) {
  if (!mesh?.geometry) return null;
  mesh.geometry.computeBoundingBox();
  const bbox = mesh.geometry.boundingBox;
  if (!bbox) return null;

  const hostSize = bbox.getSize(_skinTempVec).clone();
  hostSize.x = Math.max(hostSize.x, 0.15);
  hostSize.y = Math.max(hostSize.y, 0.15);
  hostSize.z = Math.max(hostSize.z, 0.15);

  const grid = normalizeSkinGridSize(skin?.gridSize);
  const cellSize = Math.max(0.02, Math.min(hostSize.x / grid.x, hostSize.y / grid.y, hostSize.z / grid.z) * 0.92);
  return {
    grid,
    cellSize,
    xStart: -((grid.x - 1) * cellSize) * 0.5,
    yStart: -((grid.y - 1) * cellSize) * 0.5,
    zStart: -((grid.z - 1) * cellSize) * 0.5,
  };
}

function createDefaultHitboxConfig() {
  return {
    mode: 'auto',
    offset: [0, 0, 0],
    size: [1, 1, 1],
  };
}

function normalizeHitboxConfig(config = {}) {
  const base = createDefaultHitboxConfig();
  const offsetIn = Array.isArray(config.offset) ? config.offset : base.offset;
  const sizeIn = Array.isArray(config.size) ? config.size : base.size;
  return {
    mode: config.mode === 'manual' ? 'manual' : 'auto',
    offset: [0, 1, 2].map(index => {
      const value = Number.parseFloat(offsetIn[index]);
      return Number.isFinite(value) ? THREE.MathUtils.clamp(value, -128, 128) : base.offset[index];
    }),
    size: [0, 1, 2].map(index => {
      const value = Number.parseFloat(sizeIn[index]);
      return Number.isFinite(value) ? THREE.MathUtils.clamp(Math.abs(value), 0.05, 256) : base.size[index];
    }),
  };
}

function getMeshHitboxConfig(mesh) {
  const config = normalizeHitboxConfig(mesh?.userData?.hitboxConfig);
  if (mesh?.userData) mesh.userData.hitboxConfig = config;
  return config;
}

function createDefaultKeypadConfig() {
  return {
    title: 'Keypad',
    maxDigits: 6,
    offsetX: 0,
    offsetY: 0,
  };
}

function normalizeKeypadConfig(config = {}) {
  const base = createDefaultKeypadConfig();
  const title = String(config.title ?? base.title).trim() || base.title;
  const maxDigits = THREE.MathUtils.clamp(parseInt(config.maxDigits, 10) || base.maxDigits, 1, 12);
  const offsetX = THREE.MathUtils.clamp(parseFloat(config.offsetX) || 0, -600, 600);
  const offsetY = THREE.MathUtils.clamp(parseFloat(config.offsetY) || 0, -400, 400);
  return { title, maxDigits, offsetX, offsetY };
}

function getMeshKeypadConfig(mesh) {
  const config = normalizeKeypadConfig(mesh?.userData?.keypadConfig);
  if (mesh?.userData) mesh.userData.keypadConfig = config;
  return config;
}

function serializeCustomBlockSkins() {
  const out = {};
  for (const [type, skinRaw] of Object.entries(customBlockSkins)) {
    if (!DEFS[type]) continue;
    const skin = normalizeCustomBlockSkin(skinRaw);
    if (!skin.voxels.length) continue;
    out[type] = skin;
  }
  return out;
}

function setCustomBlockSkinsMap(map = {}) {
  for (const key of Object.keys(customBlockSkins)) delete customBlockSkins[key];
  if (map && typeof map === 'object') {
    for (const [type, skinRaw] of Object.entries(map)) {
      if (!DEFS[type]) continue;
      const skin = normalizeCustomBlockSkin(skinRaw);
      if (!skin.voxels.length) continue;
      customBlockSkins[type] = skin;
    }
  }
  refreshCustomSkinsOnScene();
}

function hasCustomSkinForType(type) {
  return !!customBlockSkins[type]?.voxels?.length;
}

function shouldHideMeshDisplay(mesh) {
  return !!(state.isPlaytest && mesh?.userData?._playtestHidden && !fpsDevView);
}

function disposeObjectTree(root) {
  if (!root) return;
  root.traverse(obj => {
    if (obj.geometry?.dispose) obj.geometry.dispose();
    if (Array.isArray(obj.material)) {
      for (const mat of obj.material) {
        if (mat?.dispose) mat.dispose();
      }
    } else if (obj.material?.dispose) {
      obj.material.dispose();
    }
  });
}

function clearCustomSkinVisual(mesh) {
  if (!mesh?.userData) return;
  const prev = mesh.userData.customSkinGroup;
  if (prev) {
    mesh.remove(prev);
    disposeObjectTree(prev);
  }
  delete mesh.userData.customSkinGroup;
}

function buildCustomSkinVisual(mesh, skin) {
  if (!mesh?.geometry || !skin?.voxels?.length) return null;
  const layout = buildSkinLayout(mesh, skin);
  if (!layout) return null;

  const byColor = new Map();
  for (const voxel of skin.voxels) {
    const color = Math.round(THREE.MathUtils.clamp(voxel.color, 0, 0xffffff));
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(voxel);
  }

  const group = new THREE.Group();
  group.name = 'customSkinVisual';
  group.userData.customSkinVisual = true;

  for (const [color, voxels] of byColor.entries()) {
    const geom = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.08,
    });
    const inst = new THREE.InstancedMesh(geom, mat, voxels.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    for (let i = 0; i < voxels.length; i++) {
      const voxel = voxels[i];
      _skinTempVecB.set(
        layout.xStart + voxel.x * layout.cellSize,
        layout.yStart + voxel.y * layout.cellSize,
        layout.zStart + voxel.z * layout.cellSize,
      );
      _skinTempMatrix.makeTranslation(_skinTempVecB.x, _skinTempVecB.y, _skinTempVecB.z);
      inst.setMatrixAt(i, _skinTempMatrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  return group;
}

function computeAutoHitboxBox(mesh, outCenter = _hitboxLocalCenter, outSize = _hitboxLocalSize) {
  const skinRaw = customBlockSkins[mesh?.userData?.type];
  const skin = skinRaw ? normalizeCustomBlockSkin(skinRaw) : null;
  if (skin?.voxels?.length) {
    const layout = buildSkinLayout(mesh, skin);
    if (layout) {
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (const voxel of skin.voxels) {
        minX = Math.min(minX, voxel.x);
        minY = Math.min(minY, voxel.y);
        minZ = Math.min(minZ, voxel.z);
        maxX = Math.max(maxX, voxel.x);
        maxY = Math.max(maxY, voxel.y);
        maxZ = Math.max(maxZ, voxel.z);
      }
      const half = layout.cellSize * 0.5;
      const min = new THREE.Vector3(
        layout.xStart + minX * layout.cellSize - half,
        layout.yStart + minY * layout.cellSize - half,
        layout.zStart + minZ * layout.cellSize - half,
      );
      const max = new THREE.Vector3(
        layout.xStart + maxX * layout.cellSize + half,
        layout.yStart + maxY * layout.cellSize + half,
        layout.zStart + maxZ * layout.cellSize + half,
      );
      outCenter.copy(min).add(max).multiplyScalar(0.5);
      outSize.copy(max).sub(min);
      return { center: outCenter, size: outSize };
    }
  }

  mesh.geometry.computeBoundingBox();
  const bbox = mesh.geometry.boundingBox;
  if (!bbox) {
    outCenter.set(0, 0, 0);
    outSize.set(1, 1, 1);
    return { center: outCenter, size: outSize };
  }
  bbox.getCenter(outCenter);
  bbox.getSize(outSize);
  outSize.set(Math.max(outSize.x, 0.05), Math.max(outSize.y, 0.05), Math.max(outSize.z, 0.05));
  return { center: outCenter, size: outSize };
}

function getMeshLocalHitboxBox(mesh, outCenter = _hitboxLocalCenter, outSize = _hitboxLocalSize) {
  const cfg = getMeshHitboxConfig(mesh);
  if (cfg.mode === 'manual') {
    outCenter.fromArray(cfg.offset);
    outSize.fromArray(cfg.size);
    return { center: outCenter, size: outSize };
  }
  return computeAutoHitboxBox(mesh, outCenter, outSize);
}

function computeMeshCollisionAABB(mesh, out) {
  if (getMeshCollisionMode(mesh) === 'geometry') {
    return out.setFromObject(mesh);
  }

  const { center, size } = getMeshLocalHitboxBox(mesh);
  out.makeEmpty();
  const hx = size.x * 0.5;
  const hy = size.y * 0.5;
  const hz = size.z * 0.5;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        _hitboxCorner.set(center.x + sx * hx, center.y + sy * hy, center.z + sz * hz);
        _hitboxWorldPoint.copy(_hitboxCorner).applyMatrix4(mesh.matrixWorld);
        out.expandByPoint(_hitboxWorldPoint);
      }
    }
  }
  return out;
}

function applyCustomSkinToMesh(mesh) {
  if (!mesh?.userData) return;
  clearCustomSkinVisual(mesh);

  const skinRaw = customBlockSkins[mesh.userData.type];
  if (!skinRaw?.voxels?.length) {
    mesh.userData._customSkinActive = false;
    if (mesh.material) mesh.material.visible = !shouldHideMeshDisplay(mesh);
    return;
  }

  const skin = normalizeCustomBlockSkin(skinRaw);
  if (!skin.voxels.length) {
    mesh.userData._customSkinActive = false;
    if (mesh.material) mesh.material.visible = !shouldHideMeshDisplay(mesh);
    return;
  }

  const visual = buildCustomSkinVisual(mesh, skin);
  if (!visual) {
    mesh.userData._customSkinActive = false;
    if (mesh.material) mesh.material.visible = !shouldHideMeshDisplay(mesh);
    return;
  }

  mesh.add(visual);
  mesh.userData.customSkinGroup = visual;
  mesh.userData._customSkinActive = true;
  visual.visible = !shouldHideMeshDisplay(mesh);
  if (mesh.material) mesh.material.visible = false;
}

function refreshCustomSkinsOnScene() {
  for (const mesh of sceneObjects) applyCustomSkinToMesh(mesh);
  if (state.selectedObject) refreshProps();
  refreshStatus();
}

function clampFloatingPanelPosition(el, x, y, pad = 8) {
  const rect = el.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - pad;
  const maxY = window.innerHeight - rect.height - pad;
  el.style.left = `${THREE.MathUtils.clamp(x, pad, Math.max(pad, maxX))}px`;
  el.style.top = `${THREE.MathUtils.clamp(y, pad, Math.max(pad, maxY))}px`;
}

function closeLibraryContextMenu() {
  if (!libraryContextMenuEl) return;
  libraryContextMenuEl.remove();
  libraryContextMenuEl = null;
}

function closeKeypadContextMenu() {
  if (!keypadContextMenuEl) return;
  keypadContextMenuEl.remove();
  keypadContextMenuEl = null;
  activeKeypadConfigMesh = null;
}

function disposeSkin3DScene() {
  if (!skin3DState) return;
  cancelAnimationFrame(skin3DState.animId);
  skin3DState.controls.dispose();
  skin3DState.sharedGeo.dispose();
  skin3DState.renderer.dispose();
  skin3DState = null;
}

function closeSkinEditorOverlay() {
  if (!skinEditorOverlayEl) return;
  skinEditorOverlayEl.remove();
  skinEditorOverlayEl = null;
  skinEditorDragActive = false;
  disposeSkin3DScene();
}

function closeTransientMenus() {
  closeLibraryContextMenu();
  closeKeypadContextMenu();
  closeRuntimeKeypadOverlay();
}

function skinEditorCellKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

function buildSkinEditorHtml() {
  return '';
}

function saveSkinEditorToType() {
  const voxels = [];
  for (const [key, color] of skinEditorState.voxelMap.entries()) {
    const [x, y, z] = key.split('|').map(v => parseInt(v, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    voxels.push({ x, y, z, color: Math.round(THREE.MathUtils.clamp(color, 0, 0xffffff)) });
  }
  const normalized = normalizeCustomBlockSkin({ voxels });
  if (normalized.voxels.length) customBlockSkins[skinEditorState.type] = normalized;
  else delete customBlockSkins[skinEditorState.type];
  refreshCustomSkinsOnScene();
  removeGhost();
}

function captureSkinEditorSnapshot() {
  const voxels = [];
  for (const [key, color] of skinEditorState.voxelMap.entries()) {
    const [x, y, z] = key.split('|').map(v => parseInt(v, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    voxels.push({ x, y, z, color: Math.round(THREE.MathUtils.clamp(color, 0, 0xffffff)) });
  }
  voxels.sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.z - b.z) || (a.color - b.color));
  return {
    gridSize: normalizeSkinGridSize(skinEditorState.gridSize),
    layer: THREE.MathUtils.clamp(parseInt(skinEditorState.layer, 10) || 0, 0, Math.max(0, skinEditorState.gridSize.y - 1)),
    voxels,
  };
}

function skinEditorSnapshotSignature(snapshot) {
  if (!snapshot) return '';
  const grid = normalizeSkinGridSize(snapshot.gridSize || {});
  const layer = THREE.MathUtils.clamp(parseInt(snapshot.layer, 10) || 0, 0, Math.max(0, grid.y - 1));
  const voxels = Array.isArray(snapshot.voxels) ? snapshot.voxels : [];
  const parts = voxels.map(v => `${v.x}|${v.y}|${v.z}|${Math.round(v.color)}`);
  return `${grid.x}x${grid.y}x${grid.z}@${layer};${parts.join(';')}`;
}

function restoreSkinEditorSnapshot(snapshot) {
  if (!snapshot) return;
  const gridSize = normalizeSkinGridSize(snapshot.gridSize || {});
  skinEditorState.gridSize = { ...gridSize };
  skinEditorState.layer = THREE.MathUtils.clamp(parseInt(snapshot.layer, 10) || 0, 0, Math.max(0, gridSize.y - 1));
  skinEditorState.voxelMap = new Map();
  const voxels = Array.isArray(snapshot.voxels) ? snapshot.voxels : [];
  for (const voxel of voxels) {
    const x = parseInt(voxel?.x, 10);
    const y = parseInt(voxel?.y, 10);
    const z = parseInt(voxel?.z, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < 0 || x >= gridSize.x || y < 0 || y >= gridSize.y || z < 0 || z >= gridSize.z) continue;
    const color = Math.round(THREE.MathUtils.clamp(Number(voxel?.color), 0, 0xffffff));
    skinEditorState.voxelMap.set(skinEditorCellKey(x, y, z), Number.isFinite(color) ? color : skinEditorState.brushColor);
  }
  skin3DState?.syncFromState?.();
  syncSkinEditorHistoryUi();
}

function syncSkinEditorHistoryUi() {
  if (!skinEditorOverlayEl) return;
  const undoBtn = skinEditorOverlayEl.querySelector('#skin-undo');
  const redoBtn = skinEditorOverlayEl.querySelector('#skin-redo');
  if (undoBtn) undoBtn.disabled = skinEditorState.undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = skinEditorState.redoStack.length === 0;
}

function commitSkinEditorChange(beforeSnapshot) {
  if (!beforeSnapshot) return;
  const afterSnapshot = captureSkinEditorSnapshot();
  if (skinEditorSnapshotSignature(beforeSnapshot) === skinEditorSnapshotSignature(afterSnapshot)) return;
  skinEditorState.undoStack.push(beforeSnapshot);
  if (skinEditorState.undoStack.length > 80) skinEditorState.undoStack.shift();
  skinEditorState.redoStack.length = 0;
  syncSkinEditorHistoryUi();
}

function undoSkinEditorChange() {
  if (!skinEditorState.undoStack.length) return;
  const current = captureSkinEditorSnapshot();
  const snapshot = skinEditorState.undoStack.pop();
  skinEditorState.redoStack.push(current);
  restoreSkinEditorSnapshot(snapshot);
}

function redoSkinEditorChange() {
  if (!skinEditorState.redoStack.length) return;
  const current = captureSkinEditorSnapshot();
  const snapshot = skinEditorState.redoStack.pop();
  skinEditorState.undoStack.push(current);
  restoreSkinEditorSnapshot(snapshot);
}

function resizeSkinEditorGrid(nextGridLike = {}) {
  const before = captureSkinEditorSnapshot();
  const nextGrid = normalizeSkinGridSize(nextGridLike);
  const prev = normalizeSkinGridSize(skinEditorState.gridSize);
  if (nextGrid.x === prev.x && nextGrid.y === prev.y && nextGrid.z === prev.z) {
    skin3DState?.syncFromState?.();
    syncSkinEditorHistoryUi();
    return;
  }

  const nextMap = new Map();
  for (const [key, color] of skinEditorState.voxelMap.entries()) {
    const [x, y, z] = key.split('|').map(v => parseInt(v, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < 0 || x >= nextGrid.x || y < 0 || y >= nextGrid.y || z < 0 || z >= nextGrid.z) continue;
    nextMap.set(key, color);
  }

  skinEditorState.gridSize = { ...nextGrid };
  skinEditorState.layer = THREE.MathUtils.clamp(parseInt(skinEditorState.layer, 10) || 0, 0, Math.max(0, nextGrid.y - 1));
  skinEditorState.voxelMap = nextMap;
  skin3DState?.syncFromState?.();
  commitSkinEditorChange(before);
}

function openSkinEditorForType(type) {
  if (!DEFS[type]) return;
  closeTransientMenus();
  closeSkinEditorOverlay();

  skinEditorState.type = type;
  skinEditorState.layer = 0;
  skinEditorState.eraseMode = false;
  skinEditorState.brushColor = 0x7f8ea0;
  skinEditorState.gridSize = { ...CUSTOM_SKIN_GRID_DEFAULT };
  skinEditorState.voxelMap = new Map();
  skinEditorState.undoStack = [];
  skinEditorState.redoStack = [];

  const existing = normalizeCustomBlockSkin(customBlockSkins[type] || {});
  skinEditorState.gridSize = { ...existing.gridSize };
  for (const voxel of existing.voxels) {
    skinEditorState.voxelMap.set(skinEditorCellKey(voxel.x, voxel.y, voxel.z), voxel.color);
    skinEditorState.brushColor = voxel.color;
  }

  const overlay = document.createElement('div');
  overlay.id = 'skin-editor-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20010;display:flex;background:#080c10';
  overlay.innerHTML = `
    <div id="skin-3d-sidebar" style="width:260px;min-width:220px;display:flex;flex-direction:column;gap:10px;padding:16px;background:#0b1118;border-right:1px solid #1d2430;overflow-y:auto;box-sizing:border-box">
      <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8b949e">Custom Block Skin</div>
      <div id="skin-editor-title" style="font-size:20px;font-weight:700;color:#e6edf3">Edit Skin</div>
      <div style="display:flex;gap:6px">
        <button id="skin-undo" type="button" style="flex:1;font-size:11px;padding:5px 8px" disabled>Undo</button>
        <button id="skin-redo" type="button" style="flex:1;font-size:11px;padding:5px 8px" disabled>Redo</button>
      </div>
      <div style="display:flex;gap:6px">
        <button id="skin-mode-paint" type="button" style="flex:1;font-size:11px;padding:5px 8px;background:#1e3a24;border-color:#2f7a3f;color:#8be9a8">Paint</button>
        <button id="skin-mode-view" type="button" style="flex:1;font-size:11px;padding:5px 8px">View</button>
      </div>
      <div style="font-size:10px;color:#444d56;line-height:1.5">Paint: left-click place, right-click erase.<br>View: drag to orbit, scroll to zoom.</div>
      <div style="display:flex;flex-direction:column;gap:6px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em">BRUSH COLOR</label>
        <input id="skin-color-input" type="color" value="#7f8ea0" style="width:100%;height:32px;cursor:pointer"/>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em">PAINT PLANE Y = <span id="skin-layer-val">0</span></label>
        <input id="skin-layer-input" type="range" min="0" max="${skinEditorState.gridSize.y - 1}" step="1" value="0" style="width:100%"/>
        <div style="font-size:10px;color:#444d56">Slide to pick height for placing on empty space</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em">MODELING AREA</label>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:10px;color:#8b949e">X</span>
          <input id="skin-grid-x" type="number" min="${CUSTOM_SKIN_GRID_LIMITS.x.min}" max="${CUSTOM_SKIN_GRID_LIMITS.x.max}" step="1" value="${skinEditorState.gridSize.x}" style="width:56px"/>
          <span style="font-size:10px;color:#8b949e">Y</span>
          <input id="skin-grid-y" type="number" min="${CUSTOM_SKIN_GRID_LIMITS.y.min}" max="${CUSTOM_SKIN_GRID_LIMITS.y.max}" step="1" value="${skinEditorState.gridSize.y}" style="width:56px"/>
          <span style="font-size:10px;color:#8b949e">Z</span>
          <input id="skin-grid-z" type="number" min="${CUSTOM_SKIN_GRID_LIMITS.z.min}" max="${CUSTOM_SKIN_GRID_LIMITS.z.max}" step="1" value="${skinEditorState.gridSize.z}" style="width:56px"/>
        </div>
        <div style="font-size:10px;color:#444d56">Expand or crop the voxel work area per block type.</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <span style="font-size:10px;color:#8b949e;flex:1;letter-spacing:.06em">VOXELS</span>
        <span id="skin-voxel-count" style="font-size:12px;font-weight:600;color:#e6edf3">0</span>
        <span style="font-size:10px;color:#444d56">/ ${CUSTOM_SKIN_MAX_VOXELS}</span>
      </div>
      <button id="skin-clear-all" type="button" style="font-size:11px;padding:6px 10px">Clear All</button>
      <div id="skin-grid-summary" style="font-size:10px;color:#444d56;line-height:1.5">Grid: ${skinEditorState.gridSize.x}x${skinEditorState.gridSize.y}x${skinEditorState.gridSize.z}<br>Skin applies to all "${typeLabel(type)}" blocks.</div>
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:8px">
        <button id="skin-save" type="button" style="font-size:12px;padding:8px 12px;background:#1e3a24;border-color:#2f7a3f;color:#8be9a8">Save Skin</button>
        <button id="skin-reset" type="button" style="font-size:12px;padding:8px 12px">Reset To Default</button>
        <button id="skin-cancel" type="button" style="font-size:12px;padding:8px 12px">Close</button>
      </div>
    </div>
    <canvas id="skin-3d-canvas" style="flex:1;display:block;outline:none;cursor:crosshair"></canvas>
  `;
  document.body.appendChild(overlay);
  skinEditorOverlayEl = overlay;

  const titleEl = overlay.querySelector('#skin-editor-title');
  if (titleEl) titleEl.textContent = `Edit ${typeLabel(type)} Skin`;

  const canvas3d = overlay.querySelector('#skin-3d-canvas');
  const w0 = Math.max(canvas3d.clientWidth || 0, window.innerWidth - 260);
  const h0 = Math.max(canvas3d.clientHeight || 0, window.innerHeight);

  const r3d = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
  r3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r3d.setSize(w0, h0, false);
  r3d.shadowMap.enabled = true;
  r3d.shadowMap.type = THREE.PCFSoftShadowMap;
  r3d.setClearColor(0x080c10);

  const s3d = new THREE.Scene();
  const gridSize0 = normalizeSkinGridSize(skinEditorState.gridSize);
  const gx2 = gridSize0.x / 2;
  const gy2 = gridSize0.y / 2;
  const gz2 = gridSize0.z / 2;

  const cam3d = new THREE.PerspectiveCamera(55, w0 / h0, 0.1, 200);
  cam3d.position.set(gx2 + 10, gy2 + 9, gz2 + 13);
  cam3d.lookAt(gx2, gy2, gz2);

  s3d.add(new THREE.AmbientLight(0xd0e8ff, 0.75));
  const sun3d = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun3d.position.set(14, 22, 10);
  sun3d.castShadow = true;
  sun3d.shadow.mapSize.set(1024, 1024);
  s3d.add(sun3d);
  const fill3d = new THREE.DirectionalLight(0xc0d8ff, 0.4);
  fill3d.position.set(-8, 6, -6);
  s3d.add(fill3d);

  let gridH = null;
  let bboxLine = null;
  const bboxLineMat = new THREE.LineBasicMaterial({ color: 0x2d3f50, transparent: true, opacity: 0.6 });
  const ppMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  let ppMesh = null;
  const ppEdgesMat = new THREE.LineBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.5 });
  let ppEdges = null;
  const floorMesh3d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
  floorMesh3d.userData.isFloor = true;
  s3d.add(floorMesh3d);

  const ghostCubeMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.35, depthWrite: false });
  const ghostCube = new THREE.Mesh(new THREE.BoxGeometry(1.04, 1.04, 1.04), ghostCubeMat);
  ghostCube.visible = false;
  s3d.add(ghostCube);

  const ghostEdgesLine = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)),
    new THREE.LineBasicMaterial({ color: 0x79c0ff })
  );
  ghostEdgesLine.visible = false;
  s3d.add(ghostEdgesLine);

  const voxelGroup3d = new THREE.Group();
  s3d.add(voxelGroup3d);
  const sharedGeo3d = new THREE.BoxGeometry(1, 1, 1);

  const oc3d = new OrbitControls(cam3d, canvas3d);
  oc3d.target.set(gx2, gy2, gz2);
  oc3d.enableDamping = true;
  oc3d.dampingFactor = 0.1;
  oc3d.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  oc3d.enabled = false;
  oc3d.update();

  function syncBounds3D() {
    const gridSize = normalizeSkinGridSize(skinEditorState.gridSize);
    const cx = gridSize.x / 2;
    const cy = gridSize.y / 2;
    const cz = gridSize.z / 2;
    const nextTarget = new THREE.Vector3(cx, cy, cz);
    const delta = nextTarget.clone().sub(oc3d.target);
    cam3d.position.add(delta);
    oc3d.target.copy(nextTarget);

    if (gridH) {
      s3d.remove(gridH);
      disposeObjectTree(gridH);
    }
    const gridSpan = Math.max(gridSize.x, gridSize.z, 12) + 12;
    gridH = new THREE.GridHelper(gridSpan, gridSpan, 0x1a2230, 0x1a2230);
    gridH.position.set(cx, 0, cz);
    s3d.add(gridH);

    if (bboxLine) {
      s3d.remove(bboxLine);
      disposeObjectTree(bboxLine);
    }
    bboxLine = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(gridSize.x, gridSize.y, gridSize.z)), bboxLineMat);
    bboxLine.position.set(cx, cy, cz);
    s3d.add(bboxLine);

    if (ppMesh) {
      s3d.remove(ppMesh);
      disposeObjectTree(ppMesh);
    }
    const planeGeo = new THREE.PlaneGeometry(gridSize.x, gridSize.z);
    planeGeo.rotateX(-Math.PI / 2);
    ppMesh = new THREE.Mesh(planeGeo, ppMat);
    ppMesh.position.set(cx, skinEditorState.layer + 0.01, cz);
    s3d.add(ppMesh);

    if (ppEdges) {
      s3d.remove(ppEdges);
      disposeObjectTree(ppEdges);
    }
    ppEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(gridSize.x, gridSize.z)), ppEdgesMat);
    ppEdges.rotation.x = -Math.PI / 2;
    ppEdges.position.set(cx, skinEditorState.layer + 0.01, cz);
    s3d.add(ppEdges);

    const floorGeo = new THREE.PlaneGeometry(gridSize.x, gridSize.z);
    floorGeo.rotateX(-Math.PI / 2);
    floorMesh3d.geometry.dispose();
    floorMesh3d.geometry = floorGeo;
    floorMesh3d.position.set(cx, skinEditorState.layer, cz);

    const layerInputEl = overlay.querySelector('#skin-layer-input');
    const layerValEl = overlay.querySelector('#skin-layer-val');
    if (layerInputEl) {
      layerInputEl.max = String(gridSize.y - 1);
      layerInputEl.value = String(skinEditorState.layer);
    }
    if (layerValEl) layerValEl.textContent = String(skinEditorState.layer);
    const summaryEl = overlay.querySelector('#skin-grid-summary');
    if (summaryEl) summaryEl.innerHTML = `Grid: ${gridSize.x}x${gridSize.y}x${gridSize.z}<br>Skin applies to all "${typeLabel(type)}" blocks.`;
  }

  function syncVoxels3D() {
    while (voxelGroup3d.children.length) {
      const child = voxelGroup3d.children[0];
      child.material.dispose();
      voxelGroup3d.remove(child);
    }
    for (const [key, color] of skinEditorState.voxelMap.entries()) {
      const [vx, vy, vz] = key.split('|').map(Number);
      const vm = new THREE.Mesh(sharedGeo3d, new THREE.MeshLambertMaterial({ color }));
      vm.castShadow = true;
      vm.receiveShadow = true;
      vm.position.set(vx + 0.5, vy + 0.5, vz + 0.5);
      vm.userData.gx = vx;
      vm.userData.gy = vy;
      vm.userData.gz = vz;
      voxelGroup3d.add(vm);
    }
  }

  function syncAllFromState() {
    syncBounds3D();
    syncVoxels3D();
    const countElInner = overlay.querySelector('#skin-voxel-count');
    if (countElInner) countElInner.textContent = String(skinEditorState.voxelMap.size);
    const gridX = overlay.querySelector('#skin-grid-x');
    const gridY = overlay.querySelector('#skin-grid-y');
    const gridZ = overlay.querySelector('#skin-grid-z');
    if (gridX) gridX.value = String(skinEditorState.gridSize.x);
    if (gridY) gridY.value = String(skinEditorState.gridSize.y);
    if (gridZ) gridZ.value = String(skinEditorState.gridSize.z);
  }

  skin3DState = {
    renderer: r3d,
    scene: s3d,
    camera: cam3d,
    controls: oc3d,
    voxelGroup: voxelGroup3d,
    floorMesh: floorMesh3d,
    ghostCube,
    ghostEdgesLine,
    sharedGeo: sharedGeo3d,
    ppMesh,
    ppEdges,
    animId: null,
    isPainting: false,
    lastPaintKey: null,
    paintSnapshot: null,
    syncFromState: syncAllFromState,
  };
  syncAllFromState();

  function animLoop3D() {
    if (!skin3DState) return;
    skin3DState.animId = requestAnimationFrame(animLoop3D);
    oc3d.update();
    const cw = canvas3d.clientWidth;
    const ch = canvas3d.clientHeight;
    if (cw > 0 && ch > 0 && (r3d.domElement.width !== cw * r3d.getPixelRatio() || r3d.domElement.height !== ch * r3d.getPixelRatio())) {
      r3d.setSize(cw, ch, false);
      cam3d.aspect = cw / ch;
      cam3d.updateProjectionMatrix();
    }
    r3d.render(s3d, cam3d);
  }
  animLoop3D();

  const rc3d = new THREE.Raycaster();
  const rcNdc = new THREE.Vector2();
  function getHitTarget3D(e, eraseOnly) {
    const rect = canvas3d.getBoundingClientRect();
    rcNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    rc3d.setFromCamera(rcNdc, cam3d);
    const targets = eraseOnly ? voxelGroup3d.children : [...voxelGroup3d.children, floorMesh3d];
    const hits = rc3d.intersectObjects(targets, false);
    if (!hits.length) return null;

    const hit = hits[0];
    if (hit.object.userData.isFloor) {
      const px = THREE.MathUtils.clamp(Math.floor(hit.point.x), 0, skinEditorState.gridSize.x - 1);
      const pz = THREE.MathUtils.clamp(Math.floor(hit.point.z), 0, skinEditorState.gridSize.z - 1);
      return { mode: 'place', gx: px, gy: skinEditorState.layer, gz: pz };
    }

    const { gx: hx, gy: hy, gz: hz } = hit.object.userData;
    if (eraseOnly) return { mode: 'erase', gx: hx, gy: hy, gz: hz };
    const n = hit.face.normal;
    const nx = hx + Math.round(n.x);
    const ny = hy + Math.round(n.y);
    const nz = hz + Math.round(n.z);
    if (nx < 0 || nx >= skinEditorState.gridSize.x || ny < 0 || ny >= skinEditorState.gridSize.y || nz < 0 || nz >= skinEditorState.gridSize.z) return null;
    return { mode: 'place', gx: nx, gy: ny, gz: nz };
  }

  function updateGhost3D(target) {
    if (!target) {
      ghostCube.visible = false;
      ghostEdgesLine.visible = false;
      return;
    }
    const isErase = target.mode === 'erase';
    const pos = new THREE.Vector3(target.gx + 0.5, target.gy + 0.5, target.gz + 0.5);
    ghostCube.position.copy(pos);
    ghostEdgesLine.position.copy(pos);
    ghostCubeMat.color.setHex(isErase ? 0xff4c4c : 0x58a6ff);
    ghostEdgesLine.material.color.setHex(isErase ? 0xff8080 : 0x79c0ff);
    ghostCube.visible = true;
    ghostEdgesLine.visible = true;
  }

  function applyPaint3D(target) {
    if (!target) return;
    const key = skinEditorCellKey(target.gx, target.gy, target.gz);
    if (skin3DState.lastPaintKey === key) return;
    skin3DState.lastPaintKey = key;
    if (target.mode === 'erase') {
      skinEditorState.voxelMap.delete(key);
    } else {
      if (!skinEditorState.voxelMap.has(key) && skinEditorState.voxelMap.size >= CUSTOM_SKIN_MAX_VOXELS) return;
      skinEditorState.voxelMap.set(key, skinEditorState.brushColor);
    }
    skin3DState.syncFromState();
  }

  canvas3d.addEventListener('pointerdown', e => {
    if (oc3d.enabled) return;
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    skin3DState.paintSnapshot = captureSkinEditorSnapshot();
    skin3DState.isPainting = true;
    skin3DState.lastPaintKey = null;
    canvas3d.setPointerCapture(e.pointerId);
    const target = getHitTarget3D(e, e.button === 2);
    applyPaint3D(target);
    updateGhost3D(target);
  }, true);

  canvas3d.addEventListener('pointermove', e => {
    if (!skin3DState.isPainting) {
      if (!oc3d.enabled) updateGhost3D(getHitTarget3D(e, false));
      return;
    }
    const target = getHitTarget3D(e, e.buttons === 2);
    applyPaint3D(target);
    updateGhost3D(target);
  });

  canvas3d.addEventListener('pointerup', () => {
    skin3DState.isPainting = false;
    skin3DState.lastPaintKey = null;
    if (skin3DState.paintSnapshot) {
      commitSkinEditorChange(skin3DState.paintSnapshot);
      skin3DState.paintSnapshot = null;
    }
  });

  canvas3d.addEventListener('pointerleave', () => {
    skin3DState.isPainting = false;
    if (skin3DState.paintSnapshot) {
      commitSkinEditorChange(skin3DState.paintSnapshot);
      skin3DState.paintSnapshot = null;
    }
    ghostCube.visible = false;
    ghostEdgesLine.visible = false;
  });

  canvas3d.addEventListener('contextmenu', e => e.preventDefault());

  const btnPaint = overlay.querySelector('#skin-mode-paint');
  const btnView = overlay.querySelector('#skin-mode-view');
  function setPaintMode(paint) {
    oc3d.enabled = !paint;
    canvas3d.style.cursor = paint ? 'crosshair' : 'grab';
    btnPaint.style.background = paint ? '#1e3a24' : '';
    btnPaint.style.borderColor = paint ? '#2f7a3f' : '';
    btnPaint.style.color = paint ? '#8be9a8' : '';
    btnView.style.background = paint ? '' : '#1e2a3a';
    btnView.style.borderColor = paint ? '' : '#2f5a7a';
    btnView.style.color = paint ? '' : '#79c0ff';
  }
  btnPaint.addEventListener('click', () => setPaintMode(true));
  btnView.addEventListener('click', () => setPaintMode(false));
  overlay.querySelector('#skin-undo')?.addEventListener('click', () => undoSkinEditorChange());
  overlay.querySelector('#skin-redo')?.addEventListener('click', () => redoSkinEditorChange());

  const layerInput = overlay.querySelector('#skin-layer-input');
  const layerValEl = overlay.querySelector('#skin-layer-val');
  layerInput.addEventListener('input', () => {
    skinEditorState.layer = parseInt(layerInput.value, 10);
    if (layerValEl) layerValEl.textContent = String(skinEditorState.layer);
    if (skin3DState?.floorMesh) skin3DState.floorMesh.position.y = skinEditorState.layer;
    if (skin3DState?.ppMesh) skin3DState.ppMesh.position.y = skinEditorState.layer + 0.01;
    if (skin3DState?.ppEdges) skin3DState.ppEdges.position.y = skinEditorState.layer + 0.01;
  });

  ['x', 'y', 'z'].forEach(axis => {
    overlay.querySelector(`#skin-grid-${axis}`)?.addEventListener('change', () => {
      resizeSkinEditorGrid({
        x: overlay.querySelector('#skin-grid-x')?.value,
        y: overlay.querySelector('#skin-grid-y')?.value,
        z: overlay.querySelector('#skin-grid-z')?.value,
      });
    });
  });

  const colorInput = overlay.querySelector('#skin-color-input');
  if (colorInput) {
    colorInput.value = colorHexToCss(skinEditorState.brushColor);
    colorInput.addEventListener('input', () => {
      skinEditorState.brushColor = parseCssColor(colorInput.value, skinEditorState.brushColor);
    });
  }

  overlay.querySelector('#skin-clear-all')?.addEventListener('click', () => {
    const before = captureSkinEditorSnapshot();
    skinEditorState.voxelMap.clear();
    skin3DState?.syncFromState?.();
    commitSkinEditorChange(before);
  });

  overlay.querySelector('#skin-save')?.addEventListener('click', () => {
    saveSkinEditorToType();
    closeSkinEditorOverlay();
    saveEditorSettings();
  });

  overlay.querySelector('#skin-reset')?.addEventListener('click', () => {
    delete customBlockSkins[skinEditorState.type];
    refreshCustomSkinsOnScene();
    removeGhost();
    closeSkinEditorOverlay();
    saveEditorSettings();
  });

  overlay.querySelector('#skin-cancel')?.addEventListener('click', () => {
    closeSkinEditorOverlay();
  });

  overlay.addEventListener('keydown', e => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z') {
      e.preventDefault();
      undoSkinEditorChange();
      return;
    }
    if (((e.ctrlKey || e.metaKey) && key === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'z')) {
      e.preventDefault();
      redoSkinEditorChange();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSkinEditorOverlay();
    }
    if (key === 'v') setPaintMode(false);
    if (key === 'p') setPaintMode(true);
  });
  overlay.tabIndex = 0;
  overlay.focus();
  syncSkinEditorHistoryUi();
}

function showLibraryContextMenu(type, x, y) {
  if (!DEFS[type]) return;
  closeLibraryContextMenu();
  closeKeypadContextMenu();

  const menu = document.createElement('div');
  menu.style.position = 'fixed';
  menu.style.zIndex = '20020';
  menu.style.minWidth = '190px';
  menu.style.padding = '8px';
  menu.style.borderRadius = '8px';
  menu.style.border = '1px solid var(--border)';
  menu.style.background = 'rgba(15,20,27,0.97)';
  menu.style.boxShadow = '0 10px 28px rgba(0,0,0,0.4)';
  menu.innerHTML = `
    <div style="font-size:10px;color:var(--muted);padding:2px 4px 8px 4px;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(typeLabel(type))}</div>
    <button type="button" data-skin-edit="1" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px">Edit Block Skin</button>
    <button type="button" data-skin-reset="1" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px;margin-top:4px" ${hasCustomSkinForType(type) ? '' : 'disabled'}>Reset To Default</button>
  `;

  document.body.appendChild(menu);
  clampFloatingPanelPosition(menu, x + 4, y + 4);

  menu.querySelector('[data-skin-edit]')?.addEventListener('click', () => {
    closeLibraryContextMenu();
    openSkinEditorForType(type);
  });

  menu.querySelector('[data-skin-reset]')?.addEventListener('click', () => {
    delete customBlockSkins[type];
    refreshCustomSkinsOnScene();
    removeGhost();
    closeLibraryContextMenu();
    saveEditorSettings();
  });

  menu.addEventListener('pointerdown', e => e.stopPropagation());
  libraryContextMenuEl = menu;
}

function pickKeypadMeshFromPointerEvent(e) {
  if (!state.isPlaytest) return null;
  if (fpsLocked) {
    _keypadPickNdc.set(0, 0);
  } else {
    _keypadPickNdc.copy(toNDC(e));
  }
  raycaster.setFromCamera(_keypadPickNdc, fpsCam);
  const hits = raycaster.intersectObjects(sceneObjects, false);
  for (const hit of hits) {
    if (hit.object?.userData?.type === 'keypad') return hit.object;
  }
  return null;
}

function closeRuntimeKeypadOverlay(options = {}) {
  if (!runtimeKeypadOverlayEl) return;
  runtimeKeypadOverlayEl.remove();
  runtimeKeypadOverlayEl = null;
  activeRuntimeKeypadMesh = null;
  if (options.restorePointerLock && state.isPlaytest && !runtimePauseActive && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
}

function openRuntimeKeypadOverlay(mesh) {
  if (!mesh || !state.isPlaytest) return false;
  closeRuntimeKeypadOverlay();
  closeKeypadContextMenu();

  const keypadConfig = getMeshKeypadConfig(mesh);
  const switchConfig = getMeshSwitchConfig(mesh);
  activeRuntimeKeypadMesh = mesh;

  const overlay = document.createElement('div');
  overlay.id = 'runtime-keypad-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20040;background:rgba(6,10,14,0.42);backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div id="runtime-keypad-panel" style="position:absolute;left:calc(50% + ${keypadConfig.offsetX}px);top:calc(50% + ${keypadConfig.offsetY}px);transform:translate(-50%,-50%);width:min(320px,calc(100vw - 28px));padding:16px;border-radius:18px;border:1px solid rgba(143,180,215,0.22);background:linear-gradient(180deg,rgba(10,16,22,0.98),rgba(13,20,28,0.96));box-shadow:0 24px 70px rgba(0,0,0,0.45);display:flex;flex-direction:column;gap:12px;color:#e6edf3">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#89a1b5">Keypad</div>
          <div style="font-size:20px;font-weight:700">${escapeHtml(keypadConfig.title)}</div>
        </div>
        <button id="runtime-keypad-close" type="button" style="font-size:12px;padding:6px 10px">Close</button>
      </div>
      <div id="runtime-keypad-display" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:28px;letter-spacing:.14em;padding:14px 16px;border-radius:12px;border:1px solid rgba(143,180,215,0.16);background:rgba(3,8,12,0.9);text-align:right;min-height:32px">0</div>
      <div style="font-size:10px;color:#89a1b5;line-height:1.5">Variable: ${escapeHtml(switchConfig.varKey)}<br>Accepts when value is between ${r3(Math.min(switchConfig.min, switchConfig.max), 1)} and ${r3(Math.max(switchConfig.min, switchConfig.max), 1)}.</div>
      <div id="runtime-keypad-status" style="font-size:11px;color:#89a1b5;min-height:16px"></div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        ${['1','2','3','4','5','6','7','8','9','C','0','<-'].map(value => `<button type="button" data-keypad-key="${value}" style="font-size:18px;padding:12px 0;border-radius:12px;background:#162130;border:1px solid rgba(143,180,215,0.12);color:#e6edf3">${value}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button id="runtime-keypad-enter" type="button" style="flex:1;font-size:14px;padding:10px 12px;border-radius:12px;background:#1d4d36;border:1px solid #2a7b57;color:#d4ffe8">Enter</button>
      </div>
    </div>
  `;

  const panel = overlay.querySelector('#runtime-keypad-panel');
  const display = overlay.querySelector('#runtime-keypad-display');
  const status = overlay.querySelector('#runtime-keypad-status');
  let value = '';

  const syncDisplay = () => {
    display.textContent = value || '0';
  };

  const setStatus = (text, color = '#89a1b5') => {
    status.textContent = text;
    status.style.color = color;
  };

  const submitValue = () => {
    if (!switchConfig.varKey) {
      setStatus('Assign a variable in Properties first.', '#ffb86b');
      return;
    }
    const nextValue = Math.trunc(Number.parseInt(value || '0', 10) || 0);
    setGameVar(switchConfig.varKey, nextValue);
    const accepted = pressSwitch(mesh);
    setStatus(accepted ? `Accepted ${nextValue}` : `Stored ${nextValue}`, accepted ? '#8be9a8' : '#ffb86b');
    if (accepted) {
      window.setTimeout(() => {
        if (activeRuntimeKeypadMesh === mesh) closeRuntimeKeypadOverlay({ restorePointerLock: true });
      }, 120);
    }
  };

  overlay.querySelectorAll('[data-keypad-key]').forEach(button => {
    button.addEventListener('click', () => {
      const key = button.dataset.keypadKey;
      if (key === 'C') {
        value = '';
      } else if (key === '<-') {
        value = value.slice(0, -1);
      } else if (value.length < keypadConfig.maxDigits) {
        value += key;
      }
      syncDisplay();
      setStatus('');
    });
  });

  overlay.querySelector('#runtime-keypad-enter')?.addEventListener('click', submitValue);
  overlay.querySelector('#runtime-keypad-close')?.addEventListener('click', () => closeRuntimeKeypadOverlay({ restorePointerLock: true }));
  overlay.addEventListener('pointerdown', e => {
    if (!panel.contains(e.target)) closeRuntimeKeypadOverlay({ restorePointerLock: true });
  });
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRuntimeKeypadOverlay({ restorePointerLock: true });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      submitValue();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      value = value.slice(0, -1);
      syncDisplay();
      return;
    }
    if (/^[0-9]$/.test(e.key) && value.length < keypadConfig.maxDigits) {
      e.preventDefault();
      value += e.key;
      syncDisplay();
    }
  });

  document.body.appendChild(overlay);
  runtimeKeypadOverlayEl = overlay;
  syncDisplay();
  overlay.tabIndex = 0;
  overlay.focus();
  return true;
}

function tryOpenRuntimeKeypadFromPointerEvent(e) {
  if (!state.isPlaytest) return false;
  const keypadMesh = pickKeypadMeshFromPointerEvent(e);
  if (!keypadMesh) return false;
  e?.preventDefault?.();
  if (document.pointerLockElement === renderer.domElement) {
    suppressPointerUnlockStop = true;
    document.exitPointerLock();
  }
  return openRuntimeKeypadOverlay(keypadMesh);
}

function showKeypadContextMenu(mesh, x, y) {
  if (!mesh) return;
  closeKeypadContextMenu();
  closeLibraryContextMenu();

  const config = getMeshSwitchConfig(mesh);
  activeKeypadConfigMesh = mesh;

  const menu = document.createElement('div');
  menu.style.position = 'fixed';
  menu.style.zIndex = '20030';
  menu.style.minWidth = '230px';
  menu.style.padding = '10px';
  menu.style.borderRadius = '10px';
  menu.style.border = '1px solid var(--border)';
  menu.style.background = 'rgba(15,20,27,0.98)';
  menu.style.boxShadow = '0 12px 30px rgba(0,0,0,0.45)';
  menu.innerHTML = `
    <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Keypad Setup</div>
    <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:10px;color:var(--muted)">
      Var
      <select id="keypad-var" style="font-size:11px;padding:2px 4px;min-width:130px">${SWITCH_VAR_KEYS.map(key => `<option value="${key}" ${config.varKey === key ? 'selected' : ''}>${key}</option>`).join('')}</select>
    </label>
    <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:10px;color:var(--muted)">
      Min
      <input id="keypad-min" type="number" step="0.1" value="${config.min}" style="width:130px;font-size:11px;padding:2px 4px"/>
    </label>
    <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:10px;color:var(--muted)">
      Max
      <input id="keypad-max" type="number" step="0.1" value="${config.max}" style="width:130px;font-size:11px;padding:2px 4px"/>
    </label>
    <div style="display:flex;gap:6px;justify-content:flex-end">
      <button type="button" id="keypad-apply" style="font-size:11px;padding:4px 8px">Apply</button>
      <button type="button" id="keypad-close" style="font-size:11px;padding:4px 8px">Close</button>
    </div>
  `;

  document.body.appendChild(menu);
  clampFloatingPanelPosition(menu, x + 6, y + 6);

  menu.querySelector('#keypad-apply')?.addEventListener('click', () => {
    if (!activeKeypadConfigMesh) return;
    const cfg = getMeshSwitchConfig(activeKeypadConfigMesh);
    const varSelect = menu.querySelector('#keypad-var');
    const minInput = menu.querySelector('#keypad-min');
    const maxInput = menu.querySelector('#keypad-max');
    cfg.enabled = true;
    cfg.varKey = SWITCH_VAR_KEYS.includes(varSelect?.value) ? varSelect.value : cfg.varKey;
    const nextMin = parseFloat(minInput?.value);
    const nextMax = parseFloat(maxInput?.value);
    if (Number.isFinite(nextMin)) cfg.min = nextMin;
    if (Number.isFinite(nextMax)) cfg.max = nextMax;
    activeKeypadConfigMesh.userData.switchConfig = normalizeSwitchConfig(cfg);
    if (state.selectedObject === activeKeypadConfigMesh) refreshProps();
    refreshStatus();
    closeKeypadContextMenu();
  });

  menu.querySelector('#keypad-close')?.addEventListener('click', () => {
    closeKeypadContextMenu();
  });

  menu.addEventListener('pointerdown', e => e.stopPropagation());
  keypadContextMenuEl = menu;
}

function normalizeShapeParams(type, params = {}) {
  const def = DEFS[type] || {};
  const next = {};
  if (def.usesSides) next.sides = clampShapeSides(params.sides ?? def.defaultSides ?? state.placeSides);
  if (def.is2D) next.depth = clampShapeDepth(params.depth ?? state.place2DDepth);
  return next;
}

function buildTypeGeometry(type, shapeParams = {}) {
  const def = DEFS[type];
  return def.makeGeo(normalizeShapeParams(type, shapeParams));
}

const CONTROL_ACTION_TYPES = ['move', 'rotate', 'light', 'audio', 'path', 'functionControl', 'playerGroup', 'setVar', 'setBool'];
const CONTROL_LIGHT_OPS = ['toggle', 'enable', 'disable', 'intensity', 'distance'];
const CONTROL_PLAYER_GROUP_MODES = ['set', 'add', 'remove', 'random'];
const AUDIO_PLAY_MODES = ['global', 'proximity'];
const AUDIO_UNTIL_EVENTS = ['deactivate', 'audioDone', 'functionDone', 'manual'];
const PATH_CONTROL_COMMANDS = ['start', 'pause', 'resume', 'stop', 'reset'];
const FUNCTION_CONTROL_COMMANDS = ['pause', 'resume', 'stop', 'reset', 'restart'];
const CONDITION_TYPES = ['none', 'fnDone', 'touching', 'touchingPlayer', 'position', 'distance', 'timer', 'key', 'grounded', 'varCmp', 'bool'];
const CONDITION_OPS = ['=', '!=', '>', '<', '>=', '<='];
const CONDITION_POS_AXES = ['x', 'y', 'z'];
const CONDITION_KEY_CODES = ['Space', 'KeyE', 'KeyF', 'KeyQ', 'KeyR', 'ShiftLeft', 'ControlLeft', 'Digit1', 'Digit2', 'Digit3'];
const SWITCH_VAR_KEYS = [
  'hits',
  'health',
  'posX',
  'posY',
  'posZ',
  'grounded',
  'spawnLanded',
  'jumpHeight',
  'gravity',
  'height',
  'sprintSpeed',
  'maxHealth',
  'fallDamage',
  'fallDamageMinHeight',
  'fallDamageMultiplier',
];
const SWITCH_RUN_MODES = ['oneShot', 'repeat'];
const _controlFunctionStates = new Map();

const CONTROL_FUNCTION_STOP_MODES = ['none', 'momentary', 'permanent'];
const CHECKPOINT_INTERACTIONS = ['touch', 'shoot', 'switch'];

// ─── Global control functions (project-level) ────────────────────────────────
const controlFunctions = [];
const controlFunctionGroups = [];
let _nextControlFunctionGroupId = 1;
const _activeTriggerCalls = new Map(); // meshUuid -> [{functionName, condition, started, activatedAt}]
const _momentaryFunctionStopCounts = new Map();
const _permanentFunctionStops = new Set();

function normalizeFunctionNameList(value) {
  const source = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  const names = [];
  for (const raw of source) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = normalizeControlFunctionKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function createDefaultCheckpointConfig() {
  return {
    interaction: 'touch',
  };
}

function createDefaultMovementPathConfig() {
  return {
    enabled: false,
    speed: 2,
    loop: true,
    checkpoints: [],
  };
}

function normalizeMovementPathCheckpoint(checkpoint = {}) {
  const pos = Array.isArray(checkpoint.pos) ? checkpoint.pos : [0, 0, 0];
  return {
    pos: [0, 1, 2].map(i => Number.isFinite(parseFloat(pos[i])) ? parseFloat(pos[i]) : 0),
    functionName: String(checkpoint.functionName ?? '').trim(),
  };
}

function normalizeMovementPathConfig(config = {}) {
  const base = createDefaultMovementPathConfig();
  const checkpoints = Array.isArray(config.checkpoints)
    ? config.checkpoints.map(normalizeMovementPathCheckpoint)
    : [];
  return {
    enabled: config.enabled === true,
    speed: Math.max(0.01, Number.isFinite(parseFloat(config.speed)) ? parseFloat(config.speed) : base.speed),
    loop: config.loop !== false,
    checkpoints,
  };
}

function getMeshMovementPathConfig(mesh) {
  const cfg = normalizeMovementPathConfig(mesh?.userData?.movementPath);
  if (mesh?.userData) mesh.userData.movementPath = cfg;
  return cfg;
}

function normalizeCheckpointConfig(config = {}) {
  const base = createDefaultCheckpointConfig();
  return {
    interaction: CHECKPOINT_INTERACTIONS.includes(config.interaction) ? config.interaction : base.interaction,
  };
}

function getMeshCheckpointConfig(mesh) {
  const config = normalizeCheckpointConfig(mesh?.userData?.checkpointConfig);
  if (mesh?.userData) mesh.userData.checkpointConfig = config;
  return config;
}

function createDefaultTriggerStopConfig() {
  return {
    mode: 'none',
    functionNames: [],
  };
}

function normalizeTriggerStopConfig(config = {}) {
  const base = createDefaultTriggerStopConfig();
  const mode = CONTROL_FUNCTION_STOP_MODES.includes(config.mode) ? config.mode : base.mode;
  const functionNames = normalizeFunctionNameList(config.functionNames ?? config.functions ?? base.functionNames);
  return { mode, functionNames };
}

function getMeshTriggerStopConfig(mesh) {
  const config = normalizeTriggerStopConfig(mesh?.userData?.triggerStopConfig);
  if (mesh?.userData) mesh.userData.triggerStopConfig = config;
  return config;
}

function createDefaultSwitchConfig() {
  return {
    enabled: false,
    varKey: 'hits',
    min: 0,
    max: 999999,
    runMode: 'oneShot',
  };
}

function normalizeSwitchConfig(config = {}) {
  const base = createDefaultSwitchConfig();
  const rawVarKey = String(config.varKey ?? '').trim();
  const varKey = rawVarKey || base.varKey;
  const min = Number.isFinite(parseFloat(config.min)) ? parseFloat(config.min) : base.min;
  const max = Number.isFinite(parseFloat(config.max)) ? parseFloat(config.max) : base.max;
  const runMode = SWITCH_RUN_MODES.includes(config.runMode) ? config.runMode : base.runMode;
  return {
    enabled: !!config.enabled,
    varKey,
    min,
    max,
    runMode,
  };
}

function getMeshSwitchConfig(mesh) {
  const config = normalizeSwitchConfig(mesh?.userData?.switchConfig);
  if (mesh?.userData) mesh.userData.switchConfig = config;
  return config;
}

function normalizeControlFunctionKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function isControlFunctionMet(name) {
  const key = normalizeControlFunctionKey(name);
  if (!key) return false;
  return !!_controlFunctionStates.get(key)?.met;
}

function markControlFunctionMet(name, mesh = null) {
  const key = normalizeControlFunctionKey(name);
  if (!key) return;
  const prev = _controlFunctionStates.get(key);
  _controlFunctionStates.set(key, {
    key,
    label: String(name).trim(),
    met: true,
    count: (prev?.count ?? 0) + 1,
    lastMeshUuid: mesh?.uuid ?? prev?.lastMeshUuid ?? null,
    lastAt: performance.now() / 1000,
  });
}

function getControlFunctionState(name) {
  const key = normalizeControlFunctionKey(name);
  if (!key) return null;
  return _controlFunctionStates.get(key) || null;
}

function hasFunctionRunCompletedForCaller(functionName, callerUuid, runStartedAt) {
  const fnKey = normalizeControlFunctionKey(functionName);
  if (!fnKey) return false;

  let foundTransformState = false;
  for (const stateMap of [_triggerMoveStates, _triggerRotateStates]) {
    for (const [, st] of stateMap) {
      if ((st.callerUuid ?? null) !== (callerUuid ?? null)) continue;
      if (normalizeControlFunctionKey(st.functionName) !== fnKey) continue;
      if (Number.isFinite(runStartedAt) && Number.isFinite(st.startedAt) && st.startedAt + 0.0001 < runStartedAt) continue;
      foundTransformState = true;
      if (!st.functionMarked) return false;
    }
  }
  if (foundTransformState) return true;

  // Light-only or no-move function: completion is tracked in function state.
  const fnState = getControlFunctionState(functionName);
  return !!fnState?.met && Number.isFinite(fnState?.lastAt) && (!Number.isFinite(runStartedAt) || fnState.lastAt >= runStartedAt);
}

function clearConflictingMoveStates(stateKey, targets, options = {}) {
  if (!Array.isArray(targets) || !targets.length) return;
  const stateMap = options.stateMap instanceof Map ? options.stateMap : _triggerMoveStates;
  const includeSim = options.includeSim === true;
  const targetUuids = new Set(targets.map(m => m?.uuid).filter(Boolean));
  if (!targetUuids.size) return;

  for (const [key, st] of [...stateMap]) {
    if (key === stateKey) continue;
    if (!includeSim && key.startsWith('sim:')) continue;
    const stTargets = Array.isArray(st?.targets) ? st.targets : [];
    if (!stTargets.length) continue;
    const intersects = stTargets.some(m => targetUuids.has(m?.uuid));
    if (intersects) stateMap.delete(key);
  }
}

function getKnownControlFunctionNames(extraValues = []) {
  const seen = new Set();
  const values = [];

  const addValue = value => {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(raw);
  };

  for (const fn of controlFunctions) addValue(fn.name);
  for (const mesh of sceneObjects) {
    const calls = normalizeTriggerCalls(mesh.userData.triggerCalls);
    for (const call of calls) {
      addValue(call.functionName);
      if (call.condition?.type === 'fnDone') addValue(call.condition.ref);
    }
  }
  for (const value of extraValues) addValue(value);

  return values.sort((a, b) => a.localeCompare(b));
}

function clampAudioDistance(value) {
  return THREE.MathUtils.clamp(Number.isFinite(parseFloat(value)) ? parseFloat(value) : 22, 1, 800);
}

function normalizeAudioEntry(entry = {}) {
  const id = String(entry.id ?? makeProjectId()).trim() || makeProjectId();
  const name = String(entry.name ?? '').trim();
  const mime = String(entry.mime ?? '').trim() || 'audio/mpeg';
  const dataUrl = String(entry.dataUrl ?? '').trim();
  if (!name || !dataUrl.startsWith('data:audio')) return null;
  return { id, name, mime, dataUrl };
}

function getKnownAudioNames(extraValues = []) {
  const seen = new Set();
  const values = [];

  const addValue = value => {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(raw);
  };

  for (const item of audioLibrary) addValue(item.name);
  for (const value of extraValues) addValue(value);
  return values.sort((a, b) => a.localeCompare(b));
}

function getAudioLibraryEntryByName(name) {
  const needle = String(name ?? '').trim().toLowerCase();
  if (!needle) return null;
  return audioLibrary.find(item => String(item.name).trim().toLowerCase() === needle) || null;
}

function makeUniqueAudioName(baseName) {
  const base = String(baseName ?? '').trim() || 'audio';
  const existing = new Set(audioLibrary.map(item => item.name.toLowerCase()));
  if (!existing.has(base.toLowerCase())) return base;
  let idx = 2;
  while (existing.has(`${base} ${idx}`.toLowerCase())) idx++;
  return `${base} ${idx}`;
}

function refreshAudioLibraryUI() {
  if (!audioLibListEl) return;
  if (!audioLibrary.length) {
    stopLibraryPreviewAudio();
    audioLibListEl.innerHTML = '<div style="font-size:10px;color:var(--muted)">No audio imported yet.</div>';
    return;
  }

  audioLibListEl.innerHTML = audioLibrary.map(item => `
    <div class="audio-lib-item" data-audio-id="${escapeHtml(item.id)}">
      <span class="audio-lib-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
      <button type="button" data-audio-preview="${escapeHtml(item.id)}" style="padding:1px 6px;font-size:10px">▶</button>
      <button type="button" data-audio-preview-pause="${escapeHtml(item.id)}" style="padding:1px 6px;font-size:10px">⏸</button>
      <button type="button" data-audio-preview-stop="${escapeHtml(item.id)}" style="padding:1px 6px;font-size:10px">⏹</button>
      <button type="button" data-audio-remove="${escapeHtml(item.id)}" class="ct-del" style="padding:0 4px">✕</button>
    </div>
  `).join('');

  audioLibListEl.querySelectorAll('[data-audio-preview]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.audioPreview;
      const entry = audioLibrary.find(a => a.id === id);
      if (!entry) return;
      playLibraryPreviewAudio(entry);
    });
  });

  audioLibListEl.querySelectorAll('[data-audio-preview-pause]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.audioPreviewPause !== libraryPreviewAudioId) return;
      pauseLibraryPreviewAudio();
    });
  });

  audioLibListEl.querySelectorAll('[data-audio-preview-stop]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.audioPreviewStop !== libraryPreviewAudioId) return;
      stopLibraryPreviewAudio();
    });
  });

  audioLibListEl.querySelectorAll('[data-audio-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.audioRemove;
      const idx = audioLibrary.findIndex(a => a.id === id);
      if (idx < 0) return;
      if (libraryPreviewAudioId === id) stopLibraryPreviewAudio();
      audioLibrary.splice(idx, 1);
      refreshAudioLibraryUI();
      refreshControlFunctionsUI();
      refreshProps();
    });
  });
}

function stopLibraryPreviewAudio() {
  if (!libraryPreviewAudio) {
    libraryPreviewAudioId = null;
    return;
  }
  try {
    libraryPreviewAudio.pause();
    libraryPreviewAudio.currentTime = 0;
  } catch {
    // ignore preview media cleanup errors
  }
  libraryPreviewAudio = null;
  libraryPreviewAudioId = null;
}

function pauseLibraryPreviewAudio() {
  if (!libraryPreviewAudio) return;
  try {
    libraryPreviewAudio.pause();
  } catch {
    // ignore preview pause errors
  }
}

function playLibraryPreviewAudio(entry) {
  if (!entry) return;

  if (libraryPreviewAudio && libraryPreviewAudioId === entry.id) {
    if (libraryPreviewAudio.paused) {
      libraryPreviewAudio.play().catch(() => {});
    }
    return;
  }

  stopLibraryPreviewAudio();

  const audio = new Audio(entry.dataUrl);
  audio.volume = 0.9;
  audio.preload = 'auto';
  audio.addEventListener('ended', () => {
    if (libraryPreviewAudio === audio) stopLibraryPreviewAudio();
  });
  libraryPreviewAudio = audio;
  libraryPreviewAudioId = entry.id;
  audio.play().catch(() => {});
}

async function importAudioFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const readDataUrl = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  for (const file of list) {
    if (!String(file.type || '').startsWith('audio/')) continue;
    let dataUrl = '';
    try {
      dataUrl = await readDataUrl(file);
    } catch {
      continue;
    }
    const baseName = String(file.name || 'audio').replace(/\.[^.]+$/, '').trim() || 'audio';
    const normalized = normalizeAudioEntry({
      id: makeProjectId(),
      name: makeUniqueAudioName(baseName),
      mime: file.type,
      dataUrl,
    });
    if (normalized) audioLibrary.push(normalized);
  }

  refreshAudioLibraryUI();
  refreshControlFunctionsUI();
  refreshProps();
}

function setLibraryPane(name) {
  const pane = name === 'audio' ? 'audio' : 'objects';
  activeLibraryPane = pane;
  if (libraryPaneObjectsEl) libraryPaneObjectsEl.classList.toggle('active', pane === 'objects');
  if (libraryPaneAudioEl) libraryPaneAudioEl.classList.toggle('active', pane === 'audio');
  for (const btn of libraryPaneButtons) {
    btn.classList.toggle('active', btn.dataset.libPane === pane);
  }
}

function clampLightIntensity(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : state.defaultLightIntensity, 0, 100);
}

function getLightVisualIntensity(intensity) {
  return THREE.MathUtils.clamp(0.9 + intensity * 0.35, 0.9, 30);
}

function getMeshLightIntensity(mesh) {
  return mesh.userData.pointLight ? mesh.userData.pointLight.intensity : state.defaultLightIntensity;
}

function setMeshLightIntensity(mesh, intensity) {
  if (!mesh.userData.pointLight) return;
  const safeIntensity = clampLightIntensity(intensity);
  mesh.userData.pointLight.intensity = safeIntensity;
  mesh.userData.lightIntensity = safeIntensity;
  if (mesh.userData.type === 'light') {
    const visualIntensity = getLightVisualIntensity(safeIntensity);
    mesh.userData.baseEmissiveIntensity = visualIntensity;
    if (mesh.userData._hi) mesh.userData._hi.ei = visualIntensity;
    else mesh.material.emissiveIntensity = visualIntensity;
  } else if (mesh.material) {
    // Update emissive glow on non-light-type emitting blocks
    const ei = 0.4 + safeIntensity * 0.08;
    if (mesh.userData._hi) mesh.userData._hi.ei = ei;
    else mesh.material.emissiveIntensity = ei;
  }
}

function addLightToMesh(mesh, intensity, distance) {
  if (mesh.userData.pointLight) return;
  const i = clampLightIntensity(intensity ?? state.defaultLightIntensity);
  const d = THREE.MathUtils.clamp(distance ?? LIGHT_BLOCK_DISTANCE, 1, 500);
  const pl = new THREE.PointLight(0xffdd88, i, d, LIGHT_BLOCK_DECAY);
  pl.castShadow = true;
  pl.shadow.mapSize.set(LIGHT_BLOCK_SHADOW_MAP, LIGHT_BLOCK_SHADOW_MAP);
  pl.shadow.bias = LIGHT_BLOCK_SHADOW_BIAS;
  mesh.add(pl);
  mesh.userData.pointLight = pl;
  mesh.userData.lightIntensity = i;
  mesh.userData.lightDistance = d;
  // Make the block itself glow
  if (mesh.material) {
    mesh.userData._prevEmissive = mesh.material.emissive.getHex();
    mesh.userData._prevEmissiveIntensity = mesh.material.emissiveIntensity;
    mesh.material.emissive.set(0xffdd88);
    mesh.material.emissiveIntensity = 0.4 + i * 0.08;
  }
}

function removeLightFromMesh(mesh) {
  if (!mesh.userData.pointLight) return;
  mesh.remove(mesh.userData.pointLight);
  mesh.userData.pointLight.dispose();
  delete mesh.userData.pointLight;
  delete mesh.userData.lightIntensity;
  delete mesh.userData.lightDistance;
  delete mesh.userData.baseEmissiveIntensity;
  // Restore original emissive
  if (mesh.material && mesh.userData._prevEmissive !== undefined) {
    mesh.material.emissive.setHex(mesh.userData._prevEmissive);
    mesh.material.emissiveIntensity = mesh.userData._prevEmissiveIntensity;
    delete mesh.userData._prevEmissive;
    delete mesh.userData._prevEmissiveIntensity;
  }
}

function setMeshLightDistance(mesh, distance) {
  if (!mesh.userData.pointLight) return;
  const d = THREE.MathUtils.clamp(Number.isFinite(distance) ? distance : LIGHT_BLOCK_DISTANCE, 1, 500);
  mesh.userData.pointLight.distance = d;
  mesh.userData.lightDistance = d;
}

function clampMeshOpacity(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0.02, 1);
}

function clampMeshSolidness(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0, 1);
}

function isDefaultSolidType(type) {
  return !['light', 'spawn', 'checkpoint', 'trigger', 'target'].includes(type);
}

function getPlacementShapeParams(type) {
  if (state.cloneShapeParams && state.placingType === type) {
    return normalizeShapeParams(type, state.cloneShapeParams);
  }
  return normalizeShapeParams(type, {
    sides: state.placeSides,
    depth: state.place2DDepth,
  });
}

function setMeshOpacity(mesh, value) {
  if (!mesh?.material) return;
  const opacity = clampMeshOpacity(value);
  const baseTransparent = mesh.userData._baseMaterialTransparent === true;
  mesh.material.opacity = opacity;
  mesh.material.transparent = baseTransparent || opacity < 0.999;
  mesh.material.needsUpdate = true;
  mesh.userData.opacity = opacity;
}

function createMesh(type, ghost = false, options = {}) {
  const def = DEFS[type];
  const mat = def.makeMat();
  const shapeParams = normalizeShapeParams(type, options.shapeParams ?? getPlacementShapeParams(type));
  const defaultOpacity = clampMeshOpacity(Number.isFinite(options.opacity) ? options.opacity : (mat.opacity ?? 1));
  if (ghost) { mat.transparent = true; mat.opacity = .42; mat.depthWrite = false; }
  const mesh = new THREE.Mesh(buildTypeGeometry(type, shapeParams), mat);
  mesh.castShadow    = !ghost;
  mesh.receiveShadow = !ghost;
  mesh.userData.type = type;
  mesh.userData.shapeParams = shapeParams;
  mesh.userData.solid = isDefaultSolidType(type);
  mesh.userData.collisionMode = 'aabb';
  mesh.userData.hitboxConfig = createDefaultHitboxConfig();
  mesh.userData.solidness = 1;
  mesh.userData._baseMaterialTransparent = !!mat.transparent;
  mesh.userData.opacity = defaultOpacity;
  mesh.userData.traction = false;
  mesh.userData.groups = ['default'];
  mesh.userData.group = 'default';
  mesh.userData.movementPath = createDefaultMovementPathConfig();
  mesh.userData.switchConfig = createDefaultSwitchConfig();
  if (type === 'keypad') {
    const keypadSwitch = createDefaultSwitchConfig();
    keypadSwitch.enabled = true;
    mesh.userData.switchConfig = keypadSwitch;
    mesh.userData.keypadConfig = createDefaultKeypadConfig();
  }
  if (type === 'checkpoint') {
    mesh.userData.checkpointConfig = createDefaultCheckpointConfig();
  }
  if (!ghost) setMeshOpacity(mesh, defaultOpacity);
  if (type === 'trigger') {
    mesh.userData.triggerRules = {};
    mesh.userData.triggerMoveActions = [];
    mesh.userData.triggerCalls = [];
    mesh.userData.triggerStopConfig = createDefaultTriggerStopConfig();
  }
  if (type === 'target') mesh.userData.targetMaxHealth = 0;
  if (type === 'light' && !ghost) {
    const pl = new THREE.PointLight(0xffdd88, clampLightIntensity(options.lightIntensity), LIGHT_BLOCK_DISTANCE, LIGHT_BLOCK_DECAY);
    pl.castShadow = true;
    pl.shadow.mapSize.set(LIGHT_BLOCK_SHADOW_MAP, LIGHT_BLOCK_SHADOW_MAP);
    pl.shadow.bias = LIGHT_BLOCK_SHADOW_BIAS;
    mesh.add(pl);
    mesh.userData.pointLight = pl;
    mesh.userData.lightDistance = pl.distance;
    setMeshLightIntensity(mesh, options.lightIntensity);
  }
  if (!ghost) applyCustomSkinToMesh(mesh);
  return mesh;
}

// ─── Controls ────────────────────────────────────────────────────────────────
const orbitControls = new OrbitControls(editorCam, renderer.domElement);
orbitControls.enableDamping   = true;
orbitControls.dampingFactor   = 0.1;
orbitControls.screenSpacePanning = false;
orbitControls.maxPolarAngle   = Math.PI - 0.02;

const transformControls = new TransformControls(editorCam, renderer.domElement);
transformControls.setMode('translate');
transformControls.visible = false; // hidden until an object is selected
scene.add(transformControls);

transformControls.addEventListener('dragging-changed', e => {
  orbitControls.enabled = !e.value;
});

let transformBefore = null;
let extraTransformBefore = [];
let _pivotBefore = new THREE.Vector3();
let _groupPivotBefore = new THREE.Vector3();
let _groupBoundsBefore = new THREE.Box3();
let _primaryQuatBefore = new THREE.Quaternion();
let _primaryScaleBefore = new THREE.Vector3();
let _primaryOffsetBefore = new THREE.Vector3();
let _extraOffsetsBefore = [];

function syncScaleSideUI() {
  if (scaleSideXSelect) scaleSideXSelect.value = state.scaleSides.x;
  if (scaleSideYSelect) scaleSideYSelect.value = state.scaleSides.y;
  if (scaleSideZSelect) scaleSideZSelect.value = state.scaleSides.z;
}

function toggleScaleSide(axisKey) {
  const k = axisKey.toLowerCase();
  if (!['x', 'y', 'z'].includes(k)) return;
  state.scaleSides[k] = state.scaleSides[k] === 'pos' ? 'neg' : 'pos';
  syncScaleSideUI();
  refreshStatus();
}

transformControls.addEventListener('mouseDown', () => {
  if (state.selectedObject) {
    transformBefore = captureTRS(state.selectedObject);
    _pivotBefore.copy(state.selectedObject.position);
    _primaryQuatBefore.copy(state.selectedObject.quaternion);
    _primaryScaleBefore.copy(state.selectedObject.scale);
    extraTransformBefore = state.extraSelected.map(m => captureTRS(m));

    // Group pivot for rigid multi-object rotate/scale behavior
    const all = [state.selectedObject, ...state.extraSelected];
    _groupPivotBefore.set(0, 0, 0);
    for (const m of all) _groupPivotBefore.add(m.position);
    if (all.length) _groupPivotBefore.multiplyScalar(1 / all.length);
    _groupBoundsBefore.makeEmpty();
    for (const m of all) _groupBoundsBefore.union(new THREE.Box3().setFromObject(m));
    _primaryOffsetBefore.copy(transformBefore.pos).sub(_groupPivotBefore);
    _extraOffsetsBefore = state.extraSelected.map(m => m.position.clone().sub(_groupPivotBefore));
  }
});
transformControls.addEventListener('mouseUp', () => {
  if (state.selectedObject && transformBefore) {
    const after = captureTRS(state.selectedObject);
    if (!trsEqual(transformBefore, after))
      pushUndo({ type: 'transform', mesh: state.selectedObject, before: transformBefore, after });
    // Commit extra selected undos
    for (let i = 0; i < state.extraSelected.length; i++) {
      const m = state.extraSelected[i];
      const a = captureTRS(m);
      if (extraTransformBefore[i] && !trsEqual(extraTransformBefore[i], a))
        pushUndo({ type: 'transform', mesh: m, before: extraTransformBefore[i], after: a });
    }
    transformBefore = null;
    extraTransformBefore = [];
    _extraOffsetsBefore = [];
  }
});
transformControls.addEventListener('objectChange', () => {
  if (!state.selectedObject) return;

  // Per-axis side scaling (+/- per axis)
  if (state.transformMode === 'scale' && transformBefore && state.extraSelected.length === 0) {
    const m = state.selectedObject;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const axis = transformControls.axis; // 'X','Y','Z','XY','XZ','YZ','XYZ' etc.
    if (axis) {
      const center = bb.getCenter(new THREE.Vector3());
      const localAnchor = center.clone();
      if (axis.includes('X')) localAnchor.x = state.scaleSides.x === 'pos' ? bb.min.x : bb.max.x;
      if (axis.includes('Y')) localAnchor.y = state.scaleSides.y === 'pos' ? bb.min.y : bb.max.y;
      if (axis.includes('Z')) localAnchor.z = state.scaleSides.z === 'pos' ? bb.min.z : bb.max.z;

      const beforeM = new THREE.Matrix4().compose(transformBefore.pos, transformBefore.quat, transformBefore.sca);
      const afterM = new THREE.Matrix4().compose(m.position, m.quaternion, m.scale);
      const worldBefore = localAnchor.clone().applyMatrix4(beforeM);
      const worldAfter = localAnchor.clone().applyMatrix4(afterM);
      m.position.add(worldBefore.sub(worldAfter));
    }
  }

  selBox.setFromObject(state.selectedObject);

  // Apply delta to extra selected objects
  if (state.extraSelected.length > 0 && transformBefore) {
    if (state.transformMode === 'rotate') {
      // Rotate the whole selection as one rigid block around group pivot.
      const deltaQ = state.selectedObject.quaternion.clone().multiply(_primaryQuatBefore.clone().invert());

      // Primary follows the same rigid transform around pivot.
      state.selectedObject.position.copy(_primaryOffsetBefore).applyQuaternion(deltaQ).add(_groupPivotBefore);
      state.selectedObject.quaternion.copy(deltaQ).multiply(_primaryQuatBefore);

      for (let i = 0; i < state.extraSelected.length; i++) {
        const m = state.extraSelected[i];
        const bef = extraTransformBefore[i];
        const off = _extraOffsetsBefore[i];
        if (!bef || !off) continue;
        m.position.copy(off).applyQuaternion(deltaQ).add(_groupPivotBefore);
        m.quaternion.copy(deltaQ).multiply(bef.quat);
      }
    } else if (state.transformMode === 'scale') {
      // Scale the whole selection like one block using the rendered bounds.
      const sx = _primaryScaleBefore.x !== 0 ? (state.selectedObject.scale.x / _primaryScaleBefore.x) : 1;
      const sy = _primaryScaleBefore.y !== 0 ? (state.selectedObject.scale.y / _primaryScaleBefore.y) : 1;
      const sz = _primaryScaleBefore.z !== 0 ? (state.selectedObject.scale.z / _primaryScaleBefore.z) : 1;
      const axis = transformControls.axis || 'XYZ';
      const pivot = _groupBoundsBefore.getCenter(new THREE.Vector3());
      if (axis.includes('X')) pivot.x = state.scaleSides.x === 'pos' ? _groupBoundsBefore.min.x : _groupBoundsBefore.max.x;
      if (axis.includes('Y')) pivot.y = state.scaleSides.y === 'pos' ? _groupBoundsBefore.min.y : _groupBoundsBefore.max.y;
      if (axis.includes('Z')) pivot.z = state.scaleSides.z === 'pos' ? _groupBoundsBefore.min.z : _groupBoundsBefore.max.z;

      const scaleSelectedFromPivot = (mesh, before) => {
        if (!before) return;
        mesh.position.set(
          pivot.x + (before.pos.x - pivot.x) * sx,
          pivot.y + (before.pos.y - pivot.y) * sy,
          pivot.z + (before.pos.z - pivot.z) * sz,
        );
        mesh.scale.set(before.sca.x * sx, before.sca.y * sy, before.sca.z * sz);
      };

      scaleSelectedFromPivot(state.selectedObject, transformBefore);
      for (let i = 0; i < state.extraSelected.length; i++) {
        scaleSelectedFromPivot(state.extraSelected[i], extraTransformBefore[i]);
      }
    } else {
      const delta = new THREE.Vector3().subVectors(state.selectedObject.position, _pivotBefore);
      for (let i = 0; i < state.extraSelected.length; i++) {
        const m = state.extraSelected[i];
        const bef = extraTransformBefore[i];
        if (!bef) continue;
        m.position.copy(bef.pos).add(delta);
      }
    }
    rebuildExtraBoxes();
  }

  refreshProps();
  refreshStatus();
});

// ─── Selection helper ────────────────────────────────────────────────────────
const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x4a9eff);
selBox.visible = false;
scene.add(selBox);

const extraSelBoxes = [];

function clearPathCheckpointViewportPick() {
  _pendingPathCheckpointPick = null;
}

function armPathCheckpointViewportPick(meshes, index) {
  const meshUuids = meshes
    .filter(m => m && sceneObjects.includes(m))
    .map(m => m.uuid);
  if (!meshUuids.length || !Number.isFinite(index) || index < 0) {
    clearPathCheckpointViewportPick();
    return;
  }
  _pendingPathCheckpointPick = { meshUuids, index };
}

function tryApplyPathCheckpointViewportPick(ndc) {
  if (!_pendingPathCheckpointPick) return false;
  const selected = state.selectedObject;
  if (!selected || !_pendingPathCheckpointPick.meshUuids.includes(selected.uuid)) {
    clearPathCheckpointViewportPick();
    return false;
  }

  const hit = surfaceHit(ndc);
  const pt = hit?.point ?? groundPoint(ndc);
  if (!pt) return true;

  const index = _pendingPathCheckpointPick.index;
  const targets = getPropertyTargets(selected).filter(m => !['spawn', 'checkpoint', 'trigger'].includes(m.userData.type));
  for (const target of targets) {
    const cfg = getMeshMovementPathConfig(target);
    while (cfg.checkpoints.length <= index) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: target.position.toArray() }));
    cfg.checkpoints[index] = normalizeMovementPathCheckpoint({
      ...cfg.checkpoints[index],
      pos: [pt.x, pt.y, pt.z],
    });
    target.userData.movementPath = normalizeMovementPathConfig(cfg);
  }

  clearPathCheckpointViewportPick();
  refreshProps();
  refreshSelectedPathPreview();
  return true;
}

function clearSelectedPathPreview() {
  if (_selectedPathPreviewLine) {
    scene.remove(_selectedPathPreviewLine);
    _selectedPathPreviewLine.geometry?.dispose?.();
    _selectedPathPreviewLine.material?.dispose?.();
    _selectedPathPreviewLine = null;
  }
  while (_selectedPathPreviewMarkers.length) {
    const marker = _selectedPathPreviewMarkers.pop();
    scene.remove(marker);
    marker.geometry?.dispose?.();
    marker.material?.dispose?.();
  }
}

function refreshSelectedPathPreview() {
  clearSelectedPathPreview();

  const mesh = state.selectedObject;
  if (!mesh || !sceneObjects.includes(mesh)) {
    clearPathCheckpointViewportPick();
    return;
  }
  if (['spawn', 'checkpoint', 'trigger'].includes(mesh.userData.type)) {
    clearPathCheckpointViewportPick();
    return;
  }

  const cfg = getMeshMovementPathConfig(mesh);
  if (!cfg.checkpoints.length) {
    clearPathCheckpointViewportPick();
    return;
  }

  if (_pendingPathCheckpointPick && !_pendingPathCheckpointPick.meshUuids.includes(mesh.uuid)) {
    clearPathCheckpointViewportPick();
  }

  const points = [mesh.position.clone()];
  for (const cp of cfg.checkpoints) {
    const ncp = normalizeMovementPathCheckpoint(cp);
    points.push(new THREE.Vector3(ncp.pos[0], ncp.pos[1], ncp.pos[2]));
  }

  const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x3f9bff,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  _selectedPathPreviewLine = new THREE.Line(lineGeo, lineMat);
  _selectedPathPreviewLine.renderOrder = 40;
  scene.add(_selectedPathPreviewLine);

  for (let i = 0; i < cfg.checkpoints.length; i++) {
    const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[i]);
    const armed = !!(_pendingPathCheckpointPick && _pendingPathCheckpointPick.index === i);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 12),
      new THREE.MeshBasicMaterial({
        color: armed ? 0xffc857 : 0x65d46e,
        transparent: true,
        opacity: armed ? 1 : 0.9,
        depthTest: false,
      })
    );
    marker.position.set(cp.pos[0], cp.pos[1], cp.pos[2]);
    marker.renderOrder = 41;
    _selectedPathPreviewMarkers.push(marker);
    scene.add(marker);
  }
}

function selectObject(obj) {
  // Clear all extras
  for (const h of state.extraSelected) unhighlight(h);
  state.extraSelected.length = 0;
  extraSelBoxes.forEach(b => { b.visible = false; });

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
    clearPathCheckpointViewportPick();
    hideProps();
  }
  refreshSelectedPathPreview();
  refreshStatus();
}

function selectObjects(meshes) {
  const unique = [];
  for (const mesh of meshes) {
    if (!mesh || !sceneObjects.includes(mesh) || unique.includes(mesh)) continue;
    unique.push(mesh);
  }

  const [primary, ...extras] = unique;
  selectObject(primary ?? null);
  if (!primary) return;

  for (const mesh of extras) {
    state.extraSelected.push(mesh);
    highlight(mesh);
  }

  rebuildExtraBoxes();
  refreshProps();
  refreshStatus();
}

function selectAllObjects() {
  if (!sceneObjects.length) return;
  if (state.mode !== 'select') setMode('select');
  selectObjects(sceneObjects);
}

function toggleMultiSelect(obj) {
  if (!obj) return;
  // If it's the primary selection, deselect everything
  if (obj === state.selectedObject) { selectObject(null); return; }
  // If already in extras, remove it
  const idx = state.extraSelected.indexOf(obj);
  if (idx >= 0) {
    unhighlight(obj);
    state.extraSelected.splice(idx, 1);
    if (extraSelBoxes[idx]) extraSelBoxes[idx].visible = false;
    // Rebuild extra box visuals
    rebuildExtraBoxes();
    refreshProps();
    refreshStatus();
    return;
  }
  // If nothing selected yet, make it primary
  if (!state.selectedObject) { selectObject(obj); return; }
  // Add to extras
  state.extraSelected.push(obj);
  highlight(obj);
  rebuildExtraBoxes();
  refreshProps();
  refreshStatus();
}

function rebuildExtraBoxes() {
  // Ensure enough box helpers
  while (extraSelBoxes.length < state.extraSelected.length) {
    const b = new THREE.BoxHelper(new THREE.Object3D(), 0x4a9eff);
    b.visible = false;
    scene.add(b);
    extraSelBoxes.push(b);
  }
  for (let i = 0; i < extraSelBoxes.length; i++) {
    if (i < state.extraSelected.length) {
      extraSelBoxes[i].setFromObject(state.extraSelected[i]);
      extraSelBoxes[i].visible = true;
    } else {
      extraSelBoxes[i].visible = false;
    }
  }
}

function getAllSelected() {
  const arr = [];
  if (state.selectedObject) arr.push(state.selectedObject);
  arr.push(...state.extraSelected);
  return arr;
}

function getEditorGroupMembers(mesh) {
  const gid = mesh?.userData.editorGroupId;
  if (!gid) return [];
  return sceneObjects.filter(m => m.userData.editorGroupId === gid);
}

function getPropertyTargets(mesh) {
  if (!mesh) return [];
  const gid = mesh.userData.editorGroupId;
  if (!gid) return [mesh];
  const members = getEditorGroupMembers(mesh);
  return members.length ? members : [mesh];
}

function selectEditorGroup(obj) {
  // Select all members of the clicked object's editor group
  const members = getEditorGroupMembers(obj);
  if (members.length <= 1) return; // not grouped
  // Make `obj` the primary, rest are extras
  for (const m of members) {
    if (m === obj) continue;
    if (m === state.selectedObject || state.extraSelected.includes(m)) continue;
    state.extraSelected.push(m);
    highlight(m);
  }
  rebuildExtraBoxes();
}

function groupSelected() {
  const all = getAllSelected();
  if (all.length < 2) return;
  const gid = 'eg_' + (_nextEditorGroupId++);
  const befores = all.map(m => ({ mesh: m, before: m.userData.editorGroupId || null }));
  for (const m of all) m.userData.editorGroupId = gid;
  pushUndo({ type: 'editor-group', entries: befores.map(b => ({ mesh: b.mesh, before: b.before, after: gid })) });
  refreshProps();
}

function ungroupSelected() {
  const all = getAllSelected();
  const entries = all.filter(m => m.userData.editorGroupId).map(m => ({ mesh: m, before: m.userData.editorGroupId, after: null }));
  if (!entries.length) return;
  for (const e of entries) delete e.mesh.userData.editorGroupId;
  pushUndo({ type: 'editor-group', entries });
  refreshProps();
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

function setMeshColor(mesh, colorHex) {
  if (mesh.material?.color) mesh.material.color.setHex(colorHex);
}

function colorHexToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function parseCssColor(value, fallback) {
  const parsed = Number.parseInt(String(value).replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function refreshSelectionHelpers(mesh) {
  if (state.selectedObject === mesh) {
    selBox.setFromObject(mesh);
    transformControls.attach(mesh);
  }
}

function addToScene(mesh) { sceneObjects.push(mesh); scene.add(mesh); }
function removeFromScene(mesh) {
  const i = sceneObjects.indexOf(mesh);
  if (i >= 0) sceneObjects.splice(i, 1);
  if (state.selectedObject === mesh) selectObject(null);
  scene.remove(mesh);
}

function setMeshGeometry(mesh, geometry) {
  if (!mesh || !geometry) return;
  mesh.geometry = geometry;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  applyCustomSkinToMesh(mesh);
  refreshSelectionHelpers(mesh);
}

function applyAction(a) {
  if (a.type === 'add')       { addToScene(a.mesh); }
  else if (a.type === 'delete')    { removeFromScene(a.mesh); }
  else if (a.type === 'transform') {
    applyTRS(a.mesh, a.after);
    if (state.selectedObject === a.mesh) { selBox.setFromObject(a.mesh); transformControls.attach(a.mesh); }
  }
  else if (a.type === 'light-intensity') {
    setMeshLightIntensity(a.mesh, a.after);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'color') {
    setMeshColor(a.mesh, a.after);
    refreshSelectionHelpers(a.mesh);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'add-light') {
    addLightToMesh(a.mesh, a.intensity, a.distance);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'remove-light') {
    removeLightFromMesh(a.mesh);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'light-distance') {
    setMeshLightDistance(a.mesh, a.after);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'solid') {
    a.mesh.userData.solid = a.after;
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'solidness') {
    a.mesh.userData.solidness = clampMeshSolidness(a.after);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'opacity') {
    setMeshOpacity(a.mesh, a.after);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'geometry') {
    setMeshGeometry(a.mesh, a.after.clone());
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'shape') {
    a.mesh.userData.shapeParams = normalizeShapeParams(a.mesh.userData.type, a.afterParams);
    setMeshGeometry(a.mesh, a.afterGeo.clone());
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'traction') {
    a.mesh.userData.traction = a.after;
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'editor-group') {
    for (const e of a.entries) { if (e.after) e.mesh.userData.editorGroupId = e.after; else delete e.mesh.userData.editorGroupId; }
    refreshProps();
  }
  else if (a.type === 'clear')  { a.meshes.forEach(removeFromScene); }
  else if (a.type === 'import') {
    a.before.forEach(removeFromScene);
    a.after.forEach(addToScene);
    applySceneSettings(a.settingsAfter);
  }
}
function applyInverse(a) {
  if (a.type === 'add')       { removeFromScene(a.mesh); }
  else if (a.type === 'delete')    { addToScene(a.mesh); }
  else if (a.type === 'transform') {
    applyTRS(a.mesh, a.before);
    if (state.selectedObject === a.mesh) { selBox.setFromObject(a.mesh); transformControls.attach(a.mesh); }
  }
  else if (a.type === 'light-intensity') {
    setMeshLightIntensity(a.mesh, a.before);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'color') {
    setMeshColor(a.mesh, a.before);
    refreshSelectionHelpers(a.mesh);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'add-light') {
    removeLightFromMesh(a.mesh);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'remove-light') {
    addLightToMesh(a.mesh, a.intensity, a.distance);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'light-distance') {
    setMeshLightDistance(a.mesh, a.before);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'solid') {
    a.mesh.userData.solid = a.before;
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'solidness') {
    a.mesh.userData.solidness = clampMeshSolidness(a.before);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'opacity') {
    setMeshOpacity(a.mesh, a.before);
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'geometry') {
    setMeshGeometry(a.mesh, a.before.clone());
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'shape') {
    a.mesh.userData.shapeParams = normalizeShapeParams(a.mesh.userData.type, a.beforeParams);
    setMeshGeometry(a.mesh, a.beforeGeo.clone());
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'traction') {
    a.mesh.userData.traction = a.before;
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'editor-group') {
    for (const e of a.entries) { if (e.before) e.mesh.userData.editorGroupId = e.before; else delete e.mesh.userData.editorGroupId; }
    refreshProps();
  }
  else if (a.type === 'clear')  { a.meshes.forEach(addToScene); }
  else if (a.type === 'import') {
    a.after.forEach(removeFromScene);
    a.before.forEach(addToScene);
    applySceneSettings(a.settingsBefore);
  }
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

function buildEraserGeometry() {
  const size = THREE.MathUtils.clamp(parseFloat(state.eraserSize) || 1, 0.1, 12);
  const sides = clampShapeSides(state.placeSides);
  switch (state.eraserShape) {
    case 'sphere':
      return new THREE.SphereGeometry(size * 0.5, Math.max(8, sides), Math.max(6, Math.round(sides * 0.75)));
    case 'cylinder':
      return new THREE.CylinderGeometry(size * 0.45, size * 0.45, size, Math.max(6, sides));
    case 'prism':
      return new THREE.CylinderGeometry(size * 0.5, size * 0.5, size, Math.max(3, sides), 1);
    case 'square2d':
      return new THREE.BoxGeometry(size, size, Math.max(0.08, size * 0.2));
    case 'triangle2d':
      return makeExtrudedShapeGeometry(3, Math.max(0.08, size * 0.2), size * 0.6);
    case 'circle2d':
      return makeExtrudedShapeGeometry(Math.max(8, sides), Math.max(0.08, size * 0.2), size * 0.6);
    case 'polygon2d':
      return makeExtrudedShapeGeometry(Math.max(3, sides), Math.max(0.08, size * 0.2), size * 0.6);
    case 'box':
    default:
      return new THREE.BoxGeometry(size, size, size);
  }
}

function ensureEraserGhost() {
  const expectedType = `eraser:${state.eraserShape}`;
  if (!ghost || ghost.userData.type !== expectedType) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff6a4a,
      emissive: 0xff3300,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    ghost = new THREE.Mesh(buildEraserGeometry(), mat);
    ghost.userData.type = expectedType;
    scene.add(ghost);
  } else {
    const nextGeo = buildEraserGeometry();
    ghost.geometry.dispose();
    ghost.geometry = nextGeo;
  }
  ghost.scale.set(1, 1, 1);
}

function ensureGhost(type) {
  if (state.mode === 'erase') {
    ensureEraserGhost();
    return;
  }
  if (!ghost || ghost.userData.type !== type) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghost = createMesh(type, true, { shapeParams: getPlacementShapeParams(type), opacity: state.placeOpacity });
    scene.add(ghost);
  }
  if (state.cloneScale) ghost.scale.copy(state.cloneScale);
  else ghost.scale.set(1, 1, 1);
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

// ─── Surface-snap helpers ────────────────────────────────────────────────────
let lastPlaceNDC = new THREE.Vector2();

const _geoSizeCache = {};
function shapeParamCacheKey(type, shapeParams = {}) {
  const norm = normalizeShapeParams(type, shapeParams);
  return `${type}:${norm.sides ?? '-'}:${norm.depth ?? '-'}`;
}
function getGeoSize(type, shapeParams = {}) {
  const key = shapeParamCacheKey(type, shapeParams);
  if (!_geoSizeCache[key]) {
    const geo = buildTypeGeometry(type, shapeParams);
    geo.computeBoundingBox();
    _geoSizeCache[key] = geo.boundingBox.getSize(new THREE.Vector3());
    geo.dispose();
  }
  return _geoSizeCache[key];
}

function getPlacedY(type, shapeParams = {}, scale = null) {
  const def = DEFS[type];
  if (Number.isFinite(def?.placedY)) {
    if (!scale) return def.placedY;
    return def.placedY * scale.y;
  }
  const size = getGeoSize(type, shapeParams).clone();
  if (scale) size.multiply(scale);
  return size.y * 0.5;
}

function surfaceHit(ndc) {
  raycaster.setFromCamera(ndc, editorCam);
  const hits = raycaster.intersectObjects(sceneObjects, false);
  if (!hits.length || !hits[0].face) return null;
  const hit = hits[0];
  const normal = hit.face.normal.clone()
    .transformDirection(hit.object.matrixWorld)
    .normalize();
  return { point: hit.point, normal, object: hit.object };
}

function computeSurfacePlacement(hitPoint, normal, ghostType, scale, shapeParams = {}) {
  const size = getGeoSize(ghostType, shapeParams).clone();
  if (scale) size.multiply(scale);
  const offset = Math.abs(normal.x) * size.x / 2 +
                 Math.abs(normal.y) * size.y / 2 +
                 Math.abs(normal.z) * size.z / 2;
  return hitPoint.clone().addScaledVector(normal, offset);
}

function snapSurface(pos, normal) {
  const s = state.snapSize;
  if (!s) return pos;
  if (Math.abs(normal.x) < 0.5) pos.x = Math.round(pos.x / s) * s;
  if (Math.abs(normal.y) < 0.5) pos.y = Math.round(pos.y / s) * s;
  if (Math.abs(normal.z) < 0.5) pos.z = Math.round(pos.z / s) * s;
  return pos;
}

// ─── Editor operations ────────────────────────────────────────────────────────
function placeObject(pos) {
  const shapeParams = getPlacementShapeParams(state.placingType);
  const mesh = createMesh(state.placingType, false, {
    lightIntensity: state.defaultLightIntensity,
    shapeParams,
    opacity: state.placeOpacity,
  });
  mesh.position.copy(pos);
  if (state.cloneScale) mesh.scale.copy(state.cloneScale);
  addToScene(mesh);
  pushUndo({ type: 'add', mesh });
  refreshStatus();
}

function paintMesh(mesh, colorHex) {
  if (!mesh?.material?.color) return;
  const before = mesh.material.color.getHex();
  const after = colorHex;
  if (before === after) return;
  setMeshColor(mesh, after);
  pushUndo({ type: 'color', mesh, before, after });
}

function makeEraserCutterMesh(position, normal, depth) {
  const geo = buildEraserGeometry();
  const mat = new THREE.MeshBasicMaterial();
  const cutter = new THREE.Mesh(geo, mat);

  geo.computeBoundingBox();
  const baseDepth = Math.max(0.001, geo.boundingBox.max.z - geo.boundingBox.min.z);
  const cutDepth = Math.max(0.1, Number.isFinite(depth) ? depth : state.eraserSize);

  cutter.position.copy(position);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
  cutter.quaternion.copy(q);
  cutter.scale.set(1, 1, cutDepth / baseDepth);
  cutter.updateMatrix();
  cutter.updateMatrixWorld(true);
  return cutter;
}

function eraseHoleAtHit(hit) {
  const target = hit?.object;
  if (!target || !target.geometry || !sceneObjects.includes(target)) return;
  if (['light', 'spawn', 'checkpoint', 'trigger'].includes(target.userData.type)) return;

  const targetBounds = new THREE.Box3().setFromObject(target);
  const targetSize = targetBounds.getSize(new THREE.Vector3());
  const throughDepth = Math.max(
    state.eraserSize * 2,
    Math.max(targetSize.x, targetSize.y, targetSize.z) * 2.4
  );

  const cutterPos = hit.point.clone();
  const cutter = makeEraserCutterMesh(cutterPos, hit.normal, throughDepth);

  target.updateMatrixWorld(true);
  cutter.updateMatrixWorld(true);

  try {
    const result = CSG.subtract(target, cutter);
    if (!result?.geometry) return;
    const beforeGeo = target.geometry.clone();
    const afterGeo = result.geometry.clone();
    target.userData.collisionMode = 'geometry';
    setMeshGeometry(target, result.geometry);
    pushUndo({ type: 'geometry', mesh: target, before: beforeGeo, after: afterGeo });
    if (state.selectedObject === target) selBox.setFromObject(target);
  } catch (err) {
    console.warn('Eraser cut failed:', err);
  } finally {
    cutter.geometry.dispose();
    cutter.material.dispose();
  }
}

function deleteObject(mesh) {
  if (!sceneObjects.includes(mesh)) return;
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
function serializeSettings() {
  return {
    sun: {
      intensity:   parseFloat(sunIntensityInput.value),
      time:        parseFloat(sunTimeInput.value),
      north:       parseFloat(sunNorthInput.value),
      turbidity:   parseFloat(sunTurbidityInput.value),
      shadowRange: parseFloat(sunShadowRangeInput.value),
      dayDuration: parseFloat(sunDayDurationInput.value),
      dayCycleEnabled: !!(sunDayCycleEnabledInput && sunDayCycleEnabledInput.checked),
    },
    gameRules: { ...gameRules },
    gridFill: { enabled: gridFillEnabled, color: gridFillColor },
    conditionalTriggers: conditionalTriggers.map(ct => ({
      conditionType: ct.conditionType,
      condSense: ct.condSense ?? 'is',
      condOp: ct.condOp ?? ((ct.op === '==' || ct.op === '=') ? '=' : (ct.op || '<')),
      op: ct.op,
      value: ct.value,
      valueType: ct.valueType ?? 'digits',
      valueVarName: ct.valueVarName ?? '',
      touchRefType: ct.touchRefType ?? 'group',
      touchRefValue: ct.touchRefValue ?? '',
      varCondName: ct.varCondName ?? '',
      boolCondName: ct.boolCondName ?? '',
      ruleKey: ct.ruleKey,
      actionBase: ct.actionBase ?? 'none',
      actionOp: ct.actionOp ?? '+',
      actionValue: ct.actionValue ?? (ct.ruleValue ?? 0),
      actionValueType: ct.actionValueType ?? 'digits',
      actionValueVar: ct.actionValueVar ?? '',
      ruleValue: ct.ruleValue,
      ruleValueExpr: ct.ruleValueExpr ?? String(ct.ruleValue),
      elseRuleKey: ct.elseRuleKey || '', elseRuleValue: ct.elseRuleValue ?? 0, elseValueExpr: ct.elseValueExpr ?? String(ct.elseRuleValue ?? 0),
      priority: ct.priority ?? 0, mode: ct.mode || 'if', repeatInterval: ct.repeatInterval ?? 1,
    })),
    gameVars: gameVars.map(normalizeGameVarEntry),
    gameBools: gameBools.map(normalizeGameBoolEntry),
    playerProfile: normalizePlayerProfile(playerProfile),
    audioLibrary: audioLibrary.map(item => ({ ...item })),
    controlFunctionGroups: controlFunctionGroups.map(normalizeControlFunctionGroup),
    controlFunctions: controlFunctions.map(normalizeControlFunction),
    customBlockSkins: serializeCustomBlockSkins(),
  };
}

function syncSunInputs() {
  if (!sunTimeInput.value)        sunTimeInput.value        = SUN_TIME_DEFAULT;
  if (!sunNorthInput.value)       sunNorthInput.value       = SUN_NORTH_DEFAULT;
  if (!sunTurbidityInput.value)   sunTurbidityInput.value   = SUN_TURBIDITY_DEFAULT;
  if (!sunShadowRangeInput.value) sunShadowRangeInput.value = SUN_SHADOW_RANGE_DEFAULT;
  if (!sunIntensityInput.value)   sunIntensityInput.value   = SUN_INTENSITY_DEFAULT;
  if (!sunDayDurationInput.value) sunDayDurationInput.value = SUN_DAY_DURATION_DEFAULT;
}

function applySunUI() {
  syncSunInputs();
  updateSunSky();
  refreshStatus();
}

function applySceneSettings(settings = {}) {
  const d = settings.sun ?? settings.mainLight;
  if (d) {
    if (d.intensity   !== undefined) sunIntensityInput.value   = d.intensity;
    if (d.time        !== undefined) sunTimeInput.value        = d.time;
    if (d.north       !== undefined) sunNorthInput.value       = d.north;
    if (d.turbidity   !== undefined) sunTurbidityInput.value   = d.turbidity;
    if (d.shadowRange !== undefined) sunShadowRangeInput.value = d.shadowRange;
    if (d.dayDuration !== undefined) sunDayDurationInput.value = d.dayDuration;
    if (sunDayCycleEnabledInput) {
      if (d.dayCycleEnabled !== undefined) {
        sunDayCycleEnabledInput.checked = !!d.dayCycleEnabled;
      } else if (d.dayDuration !== undefined) {
        // Backward compatibility: old saves had duration only.
        sunDayCycleEnabledInput.checked = Number(d.dayDuration) > 0;
      } else {
        sunDayCycleEnabledInput.checked = SUN_DAY_CYCLE_ENABLED_DEFAULT;
      }
    }
    // backward compat: old azimuth/elevation -> approximate time
    if (d.time === undefined && d.elevation !== undefined) {
      const elev = THREE.MathUtils.clamp(d.elevation, -10, 89);
      sunTimeInput.value = (12 + elev / 90 * 7).toFixed(1);
    }
    if (d.time === undefined && d.azimuth !== undefined) {
      sunNorthInput.value = Math.round(d.azimuth);
    }
  }
  updateSunSky();
  syncSunInputs();
  // Restore game rules
  if (settings.gameRules) {
    Object.assign(gameRules, settings.gameRules);
    syncGameruleUI();
  }
  // Restore grid fill
  if (settings.gridFill) {
    gridFillEnabled = !!settings.gridFill.enabled;
    gridFillColor = settings.gridFill.color ?? 0x1a2636;
    gridFillEnabledInput.checked = gridFillEnabled;
    gridFillColorInput.value = '#' + gridFillColor.toString(16).padStart(6, '0');
    setGridFill(gridFillEnabled, gridFillColor);
  }
  // Restore conditional triggers
  if (settings.conditionalTriggers) {
    conditionalTriggers.length = 0;
    for (const ct of settings.conditionalTriggers) {
      conditionalTriggers.push({ id: _nextCtId++, ...ct, _fired: false, _lastFireTime: null, _nextFireTime: null });
    }
    refreshCondTriggerUI();
  }
  gameVars.length = 0;
  if (Array.isArray(settings.gameVars)) {
    for (const entry of settings.gameVars) gameVars.push(normalizeGameVarEntry(entry));
  }
  gameBools.length = 0;
  if (Array.isArray(settings.gameBools)) {
    for (const entry of settings.gameBools) gameBools.push(normalizeGameBoolEntry(entry));
  }
  if (settings.playerProfile) {
    const nextProfile = normalizePlayerProfile(settings.playerProfile);
    playerProfile.name = nextProfile.name;
    playerProfile.groups = nextProfile.groups;
  } else {
    const nextProfile = normalizePlayerProfile({});
    playerProfile.name = nextProfile.name;
    playerProfile.groups = nextProfile.groups;
  }
  stopLibraryPreviewAudio();
  audioLibrary.length = 0;
  if (Array.isArray(settings.audioLibrary)) {
    for (const entry of settings.audioLibrary) {
      const normalized = normalizeAudioEntry(entry);
      if (normalized) audioLibrary.push(normalized);
    }
  }
  refreshAudioLibraryUI();
  if (settings.controlFunctionGroups) {
    controlFunctionGroups.length = 0;
    for (const group of settings.controlFunctionGroups) {
      controlFunctionGroups.push(normalizeControlFunctionGroup(group));
    }
  } else {
    controlFunctionGroups.length = 0;
  }
  // Restore control functions
  if (settings.controlFunctions) {
    controlFunctions.length = 0;
    for (const fn of settings.controlFunctions) {
      controlFunctions.push(normalizeControlFunction(fn));
    }
  }
  setCustomBlockSkinsMap(settings.customBlockSkins || {});
  ensureControlFunctionGroups();
  refreshVarPanel();
  refreshBoolPanel();
  refreshPlayerProfileUI();
  refreshControlFunctionsUI();
}

function serializeScene() {
  return sceneObjects.map(m => {
    const o = {
      type:       m.userData.type,
      position:   m.position.toArray(),
      quaternion: m.quaternion.toArray(),
      scale:      m.scale.toArray(),
      color:      m.material.color.getHex(),
      solid:      !!m.userData.solid,
      solidness:  clampMeshSolidness(m.userData.solidness ?? 1),
      opacity:    clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1),
    };
    if (m.userData.collisionMode === 'geometry') o.collisionMode = 'geometry';
    const hitboxConfig = normalizeHitboxConfig(m.userData.hitboxConfig);
    if (hitboxConfig.mode !== 'auto' || hitboxConfig.offset.some(v => Math.abs(v) > 0.0001) || hitboxConfig.size.some((v, i) => Math.abs(v - createDefaultHitboxConfig().size[i]) > 0.0001)) {
      o.hitboxConfig = hitboxConfig;
    }
    if (m.userData.shapeParams && Object.keys(m.userData.shapeParams).length) {
      o.shapeParams = { ...m.userData.shapeParams };
    }
    if (m.userData.pointLight) {
      o.lightColor     = m.userData.pointLight.color.getHex();
      o.lightIntensity = m.userData.pointLight.intensity;
      o.lightDistance  = m.userData.pointLight.distance;
    }
    if (m.userData.label) o.label = m.userData.label;
    if (m.userData.traction) o.traction = true;
    if (Array.isArray(m.userData.groups) && m.userData.groups.length) o.groups = [...m.userData.groups];
    if (m.userData.group !== undefined) o.group = m.userData.group;
    if (m.userData.editorGroupId) o.editorGroupId = m.userData.editorGroupId;
    if (m.userData.triggerRules) o.triggerRules = { ...m.userData.triggerRules };
    const movementPath = normalizeMovementPathConfig(m.userData.movementPath);
    if (movementPath.enabled || movementPath.checkpoints.length) {
      o.movementPath = movementPath;
    }
    if (m.userData.checkpointConfig) {
      o.checkpointConfig = normalizeCheckpointConfig(m.userData.checkpointConfig);
    }
    if (m.userData.triggerStopConfig) {
      const stopConfig = normalizeTriggerStopConfig(m.userData.triggerStopConfig);
      if (stopConfig.mode !== 'none' || stopConfig.functionNames.length) o.triggerStopConfig = stopConfig;
    }
    if (Array.isArray(m.userData.triggerCalls) && m.userData.triggerCalls.length) {
      o.triggerCalls = normalizeTriggerCalls(m.userData.triggerCalls);
    }
    // Legacy: still save old format for backward compat
    if (Array.isArray(m.userData.triggerMoveActions) && m.userData.triggerMoveActions.length) {
      o.triggerMoveActions = normalizeTriggerMoveActions(m.userData.triggerMoveActions);
    }
    if (m.userData.triggerMove) o.triggerMove = normalizeTriggerMoveConfig(m.userData.triggerMove);
    if (m.userData.targetMaxHealth !== undefined) o.targetMaxHealth = m.userData.targetMaxHealth;
    const switchConfig = normalizeSwitchConfig(m.userData.switchConfig);
    if (switchConfig.enabled) o.switchConfig = switchConfig;
    if (m.userData.type === 'keypad') {
      o.keypadConfig = normalizeKeypadConfig(m.userData.keypadConfig);
    }
    return o;
  });
}

function deserializeObject(d) {
  const mesh = createMesh(d.type, false, {
    lightIntensity: d.lightIntensity,
    shapeParams: d.shapeParams,
    opacity: d.opacity,
  });
  mesh.position.fromArray(d.position);
  mesh.quaternion.fromArray(d.quaternion);
  mesh.scale.fromArray(d.scale);
  if (d.color !== undefined) mesh.material.color.setHex(d.color);
  if (d.solid !== undefined) mesh.userData.solid = d.solid;
  if (d.collisionMode === 'geometry') mesh.userData.collisionMode = 'geometry';
  if (d.hitboxConfig) mesh.userData.hitboxConfig = normalizeHitboxConfig(d.hitboxConfig);
  if (d.solidness !== undefined) mesh.userData.solidness = clampMeshSolidness(parseFloat(d.solidness));
  if (d.opacity !== undefined) setMeshOpacity(mesh, parseFloat(d.opacity));
  if (d.traction !== undefined) mesh.userData.traction = !!d.traction;
  if (d.label) mesh.userData.label = d.label;
  if (d.groups !== undefined || d.group !== undefined) {
    setMeshGroups(mesh, d.groups ?? d.group);
  }
  if (d.editorGroupId) mesh.userData.editorGroupId = d.editorGroupId;
  if (d.triggerRules) mesh.userData.triggerRules = { ...d.triggerRules };
  if (d.movementPath) mesh.userData.movementPath = normalizeMovementPathConfig(d.movementPath);
  if (d.checkpointConfig) mesh.userData.checkpointConfig = normalizeCheckpointConfig(d.checkpointConfig);
  if (d.triggerStopConfig) mesh.userData.triggerStopConfig = normalizeTriggerStopConfig(d.triggerStopConfig);
  if (d.triggerCalls) mesh.userData.triggerCalls = normalizeTriggerCalls(d.triggerCalls);
  // Keep legacy data for migration
  if (d.triggerMoveActions) mesh.userData.triggerMoveActions = normalizeTriggerMoveActions(d.triggerMoveActions);
  if (d.triggerMove) {
    mesh.userData.triggerMove = normalizeTriggerMoveConfig(d.triggerMove);
    if (!mesh.userData.triggerMoveActions || !mesh.userData.triggerMoveActions.length) {
      mesh.userData.triggerMoveActions = [normalizeTriggerMoveConfig(d.triggerMove)];
    }
  }
  if (d.targetMaxHealth !== undefined) mesh.userData.targetMaxHealth = d.targetMaxHealth;
  if (d.switchConfig) mesh.userData.switchConfig = normalizeSwitchConfig(d.switchConfig);
  if (d.keypadConfig && d.type === 'keypad') mesh.userData.keypadConfig = normalizeKeypadConfig(d.keypadConfig);
  if (d.lightColor !== undefined && mesh.userData.pointLight) {
    mesh.userData.pointLight.color.setHex(d.lightColor);
    mesh.userData.pointLight.distance  = d.lightDistance ?? mesh.userData.pointLight.distance;
    mesh.userData.lightDistance = mesh.userData.pointLight.distance;
    setMeshLightIntensity(mesh, d.lightIntensity);
  }
  if (d.lightIntensity !== undefined && d.type !== 'light' && !mesh.userData.pointLight) {
    addLightToMesh(mesh, d.lightIntensity, d.lightDistance ?? LIGHT_BLOCK_DISTANCE);
    if (d.lightColor !== undefined) mesh.userData.pointLight.color.setHex(d.lightColor);
  }
  return mesh;
}

function saveLevel() {
  const blob = new Blob([JSON.stringify({ version: 2, settings: serializeSettings(), objects: serializeScene() }, null, 2)],
                        { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'level.json' });
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTextFile(fileName, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  URL.revokeObjectURL(url);
}

function safeJsonForInlineScript(value) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

function safeModuleSourceForInlineScript(source) {
  return String(source || '').replace(/<\/script/gi, '<\\/script');
}

function isLevelPayload(value) {
  return !!value && typeof value === 'object' && Array.isArray(value.objects);
}

function coerceRuntimeLevelPayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return isLevelPayload(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && isLevelPayload(raw)) return raw;
  return null;
}

async function buildStandaloneGameHtml(payload, options = {}) {
  const loaderMode = !!options.loaderMode;
  const [indexSource, mainSource] = await Promise.all([
    fetch('./index.html').then(r => {
      if (!r.ok) throw new Error('Failed to read index.html');
      return r.text();
    }),
    fetch('./main.js').then(r => {
      if (!r.ok) throw new Error('Failed to read main.js');
      return r.text();
    }),
  ]);

  const runtimeFlagsScript = [
    '<script>',
    'window.__FLAME3D_RUNTIME_MODE__ = true;',
    `window.__FLAME3D_RUNTIME_LOADER__ = ${loaderMode ? 'true' : 'false'};`,
    `window.__FLAME3D_RUNTIME_AUTOSTART__ = ${loaderMode ? 'false' : 'true'};`,
    payload && !loaderMode ? `window.__FLAME3D_EMBEDDED_LEVEL__ = ${safeJsonForInlineScript(payload)};` : '',
    '</script>',
  ].filter(Boolean).join('\n');
  const runtimeBootStyle = [
    '<style id="flame3d-runtime-boot">',
    '#main-menu,#topbar,#sidebar,#sidebar-resizer,#functions-panel,#functions-resizer,#props-panel{display:none!important;}',
    '#workspace{display:flex!important;}',
    '</style>',
  ].join('\n');
  const runtimeMainScriptTag = [
    '<script type="module">',
    safeModuleSourceForInlineScript(mainSource),
    '</script>',
  ].join('\n');

  const scriptTagRe = /<script\s+type=["']module["']\s+src=["']\.\/main\.js(?:\?[^"']*)?["']\s*><\/script>/i;

  let html = indexSource.replace(scriptTagRe, '').trim();
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${loaderMode ? 'Flame3D Game Loader' : 'Flame3D Game'}</title>`);
  if (!/<\/head>/i.test(html)) throw new Error('Invalid HTML template: missing </head>');
  html = html.replace(/<\/head>/i, `${runtimeBootStyle}\n</head>`);
  if (!/<\/body>/i.test(html)) throw new Error('Invalid HTML template: missing </body>');
  html = html.replace(/<\/body>/i, `${runtimeFlagsScript}\n${runtimeMainScriptTag}\n</body>`);
  return html.endsWith('\n') ? html : `${html}\n`;
}

async function exportStandaloneGameHtml() {
  const payload = buildLevelPayload();
  const html = await buildStandaloneGameHtml(payload, { loaderMode: false });
  downloadTextFile('flame3d-game.html', html, 'text/html;charset=utf-8');
}

async function exportRuntimeLoaderHtml() {
  const html = await buildStandaloneGameHtml(null, { loaderMode: true });
  downloadTextFile('flame3d-game-loader.html', html, 'text/html;charset=utf-8');
}

function loadLevelJSON(json, options = {}) {
  const pushHistory = options.pushHistory !== false;
  let parsed;
  try { parsed = JSON.parse(json); } catch { alert('Invalid JSON file.'); return; }

  const before = [...sceneObjects];
  const settingsBefore = serializeSettings();
  selectObject(null);
  before.forEach(removeFromScene);
  const after = (parsed.objects ?? []).map(deserializeObject);
  after.forEach(addToScene);
  // Update editor group ID counter to avoid collisions
  for (const m of after) {
    const gid = m.userData.editorGroupId;
    if (gid) { const n = parseInt(String(gid).replace('eg_', ''), 10); if (n >= _nextEditorGroupId) _nextEditorGroupId = n + 1; }
  }
  applySceneSettings(parsed.settings);
  // Migrate old triggerMoveActions → controlFunctions + triggerCalls
  if (!parsed.settings?.controlFunctions) {
    migrateOldActionsToFunctions();
    refreshControlFunctionsUI();
  }
  if (pushHistory) {
    pushUndo({ type: 'import', before, after, settingsBefore, settingsAfter: serializeSettings() });
  } else {
    undoStack.length = 0;
    redoStack.length = 0;
    syncUndoUI();
  }
  refreshStatus();
}

function getStoredProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setStoredProjects(projects) {
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
}

function saveEditorSettings() {
  localStorage.setItem(EDITOR_SETTINGS_KEY, JSON.stringify({
    renderDist: quality.renderDist,
    shadows:    quality.shadows,
    lightDist:  quality.lightDist,
    snapSize:   state.snapSize,
    placeSides: state.placeSides,
    place2DDepth: state.place2DDepth,
    placeOpacity: state.placeOpacity,
    brushColor: state.brushColor,
    eraserShape: state.eraserShape,
    eraserSize: state.eraserSize,
    sidebarWidth: sidebarState.width,
    sidebarCollapsed: sidebarState.collapsed,
    functionsPanelWidth: functionsPanelState.width,
    functionsPanelCollapsed: functionsPanelState.collapsed,
    activeLibraryPane,
    customBlockSkins: serializeCustomBlockSkins(),
  }));
}

function loadEditorSettings() {
  try {
    const raw = localStorage.getItem(EDITOR_SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.renderDist != null) {
      quality.renderDist = THREE.MathUtils.clamp(parseFloat(s.renderDist) || 150, 20, 500);
      qualityRenderDistInput.value = quality.renderDist;
    }
    if (s.shadows) {
      applyShadowQuality(s.shadows);
      qualityShadowsSelect.value = s.shadows;
    }
    if (s.lightDist != null) {
      quality.lightDist = THREE.MathUtils.clamp(parseFloat(s.lightDist) || 60, 10, 200);
      qualityLightDistInput.value = quality.lightDist;
    }
    if (s.snapSize != null) {
      setSnap(s.snapSize);
      snapSelect.value = String(s.snapSize);
    }
    if (s.placeSides != null) state.placeSides = clampShapeSides(parseInt(s.placeSides, 10));
    if (s.place2DDepth != null) state.place2DDepth = clampShapeDepth(parseFloat(s.place2DDepth));
    if (s.placeOpacity != null) state.placeOpacity = clampMeshOpacity(parseFloat(s.placeOpacity));
    if (s.brushColor != null) state.brushColor = parseInt(s.brushColor, 10) || state.brushColor;
    if (s.eraserShape) state.eraserShape = String(s.eraserShape);
    if (s.eraserSize != null) state.eraserSize = THREE.MathUtils.clamp(parseFloat(s.eraserSize) || 1, 0.1, 12);
    if (s.sidebarWidth != null) sidebarState.width = parseFloat(s.sidebarWidth) || sidebarState.width;
    if (s.sidebarCollapsed != null) sidebarState.collapsed = !!s.sidebarCollapsed;
    if (s.functionsPanelWidth != null) functionsPanelState.width = parseFloat(s.functionsPanelWidth) || functionsPanelState.width;
    if (s.functionsPanelCollapsed != null) functionsPanelState.collapsed = !!s.functionsPanelCollapsed;
    if (s.activeLibraryPane) activeLibraryPane = s.activeLibraryPane === 'audio' ? 'audio' : 'objects';
    if (s.customBlockSkins && typeof s.customBlockSkins === 'object') {
      setCustomBlockSkinsMap(s.customBlockSkins);
    }
  } catch { /* corrupt data: ignore */ }
}

function clampSidebarWidth(value) {
  const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 220));
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, parseFloat(value) || sidebarState.width || 200));
}

function clampFunctionsPanelWidth(value) {
  const maxWidth = Math.max(FUNCTIONS_PANEL_MIN_WIDTH, Math.min(FUNCTIONS_PANEL_MAX_WIDTH, window.innerWidth - 260));
  return Math.max(FUNCTIONS_PANEL_MIN_WIDTH, Math.min(maxWidth, parseFloat(value) || functionsPanelState.width || 340));
}

function applySidebarState(options = {}) {
  const save = options.save !== false;
  const reflow = options.reflow !== false;

  sidebarState.width = clampSidebarWidth(sidebarState.width);
  document.documentElement.style.setProperty('--sideW', `${sidebarState.width}px`);
  if (workspaceEl) workspaceEl.classList.toggle('sidebar-collapsed', sidebarState.collapsed);

  if (sidebarEl) sidebarEl.setAttribute('aria-hidden', sidebarState.collapsed ? 'true' : 'false');
  if (sidebarToggleBtn) {
    const collapsed = sidebarState.collapsed;
    sidebarToggleBtn.textContent = collapsed ? '❯' : '❮';
    sidebarToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    sidebarToggleBtn.setAttribute('aria-label', sidebarToggleBtn.title);
    sidebarToggleBtn.setAttribute('aria-pressed', String(collapsed));
  }

  if (save) saveEditorSettings();
  if (reflow) onResize();
}

function applyFunctionsPanelState(options = {}) {
  const save = options.save !== false;
  const reflow = options.reflow !== false;

  functionsPanelState.width = clampFunctionsPanelWidth(functionsPanelState.width);
  document.documentElement.style.setProperty('--fnW', `${functionsPanelState.width}px`);
  if (workspaceEl) workspaceEl.classList.toggle('functions-collapsed', functionsPanelState.collapsed);

  if (functionsPanelEl) functionsPanelEl.setAttribute('aria-hidden', functionsPanelState.collapsed ? 'true' : 'false');
  if (functionsToggleBtn) {
    const collapsed = functionsPanelState.collapsed;
    functionsToggleBtn.textContent = collapsed ? '❮' : '❯';
    functionsToggleBtn.title = collapsed ? 'Expand functions panel' : 'Collapse functions panel';
    functionsToggleBtn.setAttribute('aria-label', functionsToggleBtn.title);
    functionsToggleBtn.setAttribute('aria-pressed', String(collapsed));
  }

  if (save) saveEditorSettings();
  if (reflow) onResize();
}

function stopSidebarResize() {
  if (!sidebarState.resizing) return;
  sidebarState.resizing = false;
  if (workspaceEl) workspaceEl.classList.remove('sidebar-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  applySidebarState({ save: true, reflow: true });
}

function stopFunctionsPanelResize() {
  if (!functionsPanelState.resizing) return;
  functionsPanelState.resizing = false;
  if (workspaceEl) workspaceEl.classList.remove('functions-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  applyFunctionsPanelState({ save: true, reflow: true });
}

function buildLevelPayload() {
  return { version: 2, settings: serializeSettings(), objects: serializeScene() };
}

function makeProjectId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatProjectDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleString();
}

function normalizePlayerProfile(profile = {}) {
  const name = String(profile.name ?? '').trim() || 'Player';
  const groups = normalizeGroupListValue(profile.groups ?? profile.group ?? 'default');
  return { name, groups };
}

function refreshPlayerProfileUI() {
  if (playerNameInput) playerNameInput.value = playerProfile.name;
  if (playerGroupsInput) playerGroupsInput.value = playerProfile.groups.join(', ');
  if (playerGroupsOptionsEl) {
    playerGroupsOptionsEl.innerHTML = renderDatalistOptions(getKnownGroups(playerProfile.groups));
  }
}

function getKnownLabels(extraValues = []) {
  const seen = new Set();
  const values = [];

  const addValue = value => {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(raw);
  };

  for (const mesh of sceneObjects) addValue(mesh.userData.label);
  for (const value of extraValues) addValue(value);

  return values.sort((a, b) => a.localeCompare(b));
}

function getKnownGroups(extraValues = []) {
  const seen = new Set();
  const values = [];

  const addValue = value => {
    const raw = String(value ?? '').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(raw);
  };

  addValue('default');
  for (const group of normalizeGroupListValue(playerProfile.groups)) addValue(group);
  for (const mesh of sceneObjects) {
    for (const group of getMeshGroups(mesh)) addValue(group);
  }
  for (const value of extraValues) {
    for (const group of normalizeGroupListValue(value)) addValue(group);
  }

  return values.sort((a, b) => a.localeCompare(b));
}

function normalizeGroupListValue(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  const seen = new Set();
  const groups = [];
  for (const rawValue of source) {
    const group = String(rawValue ?? '').trim();
    if (!group) continue;
    const key = group.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(group);
  }
  if (!groups.length) groups.push('default');
  return groups;
}

function parseRawGroupListValue(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  const seen = new Set();
  const groups = [];
  for (const rawValue of source) {
    const group = String(rawValue ?? '').trim();
    if (!group) continue;
    const key = group.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push(group);
  }
  return groups;
}

function getMeshGroups(mesh) {
  if (!mesh) return ['default'];
  if (Array.isArray(mesh.userData.groups) && mesh.userData.groups.length) {
    return normalizeGroupListValue(mesh.userData.groups);
  }
  return normalizeGroupListValue(mesh.userData.group ?? 'default');
}

function setMeshGroups(mesh, groupsValue) {
  const groups = normalizeGroupListValue(groupsValue);
  mesh.userData.groups = groups;
  mesh.userData.group = groups[0] || 'default';
}

function meshHasGroup(mesh, refValue) {
  const needle = normalizeTouchRef(refValue);
  if (!needle) return false;
  return getMeshGroups(mesh).some(group => normalizeTouchRef(group) === needle);
}

function createDefaultControlFunctionGroup(name = 'General') {
  const trimmed = String(name ?? '').trim() || 'General';
  const id = `cfg_${_nextControlFunctionGroupId++}`;
  return { id, name: trimmed, collapsed: false };
}

function normalizeControlFunctionGroup(group = {}) {
  const fallback = createDefaultControlFunctionGroup();
  const rawId = String(group.id ?? '').trim();
  const id = rawId || fallback.id;
  const match = id.match(/^cfg_(\d+)$/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= _nextControlFunctionGroupId) _nextControlFunctionGroupId = n + 1;
  }
  const name = String(group.name ?? '').trim() || `Group ${id.replace('cfg_', '')}`;
  return {
    id,
    name,
    collapsed: group.collapsed === true,
  };
}

function ensureControlFunctionGroups() {
  if (!controlFunctionGroups.length) {
    controlFunctionGroups.push(createDefaultControlFunctionGroup('General'));
  }

  const normalized = [];
  const seenIds = new Set();
  for (const group of controlFunctionGroups) {
    const next = normalizeControlFunctionGroup(group);
    if (seenIds.has(next.id)) continue;
    seenIds.add(next.id);
    normalized.push(next);
  }

  controlFunctionGroups.length = 0;
  controlFunctionGroups.push(...normalized);

  const fallbackGroupId = controlFunctionGroups[0].id;
  const validGroupIds = new Set(controlFunctionGroups.map(g => g.id));
  for (const fn of controlFunctions) {
    if (!validGroupIds.has(fn.groupId)) fn.groupId = fallbackGroupId;
  }
}

function createDefaultFunctionAction() {
  return {
    actionType: 'move',
    refType: 'group',
    refValue: '',
    startOffset: [0, 0, 0],
    offset: [0, 0, 0],
    style: 'glide',
    duration: 1,
    returnOnDeactivate: true,
    rotateStartOffset: [0, 0, 0],
    rotateOffset: [0, 0, 0],
    rotateRepeat: false,
    rotateRpm: [0, 0, 0],
    rotateGroupMode: 'separate',
    lightOp: 'toggle',
    lightValue: 3,
    audioName: '',
    audioMode: 'global',
    audioDistance: 22,
    audioLoop: false,
    audioUntil: 'deactivate',
    audioUntilFunction: '',
    functionControlTarget: '',
    functionControlCommand: 'stop',
    playerGroupMode: 'set',
    playerGroupValue: 'default',
    setVarName: '',
    setVarOp: '=',
    setVarValueType: 'digits',
    setVarValue: 0,
    setVarValueVar: '',
    setBoolName: '',
    setBoolValue: true,
  };
}

function normalizeFunctionAction(config = {}) {
  const normalizeVec = values => {
    const arr = Array.isArray(values) ? values : [0, 0, 0];
    return [0, 1, 2].map(i => Number.isFinite(parseFloat(arr[i])) ? parseFloat(arr[i]) : 0);
  };
  const base = createDefaultFunctionAction();
  return {
    actionType: CONTROL_ACTION_TYPES.includes(config.actionType) ? config.actionType : base.actionType,
    refType: config.refType === 'name' ? 'name' : 'group',
    refValue: String(config.refValue ?? '').trim(),
    startOffset: normalizeVec(config.startOffset ?? base.startOffset),
    // Keep for backward compatibility, but default to true so start is explicit.
    useStartOffset: config.useStartOffset !== false,
    offset: normalizeVec(config.offset ?? base.offset),
    style: ['glide', 'strict', 'snap'].includes(config.style) ? config.style : base.style,
    duration: Math.max(0, parseFloat(config.duration) || base.duration),
    returnOnDeactivate: config.returnOnDeactivate !== false,
    rotateStartOffset: normalizeVec(config.rotateStartOffset ?? config.startRotation ?? base.rotateStartOffset),
    rotateOffset: normalizeVec(config.rotateOffset ?? config.rotation ?? base.rotateOffset),
    rotateRepeat: config.rotateRepeat === true,
    rotateRpm: normalizeVec(config.rotateRpm ?? config.spinRpm ?? base.rotateRpm),
    rotateGroupMode: config.rotateGroupMode === 'together' || config.groupRotateMode === 'together' ? 'together' : 'separate',
    lightOp: CONTROL_LIGHT_OPS.includes(config.lightOp) ? config.lightOp : base.lightOp,
    lightValue: Number.isFinite(parseFloat(config.lightValue)) ? parseFloat(config.lightValue) : base.lightValue,
    audioName: String(config.audioName ?? '').trim(),
    audioMode: AUDIO_PLAY_MODES.includes(config.audioMode) ? config.audioMode : base.audioMode,
    audioDistance: clampAudioDistance(config.audioDistance),
    audioLoop: config.audioLoop === true,
    audioUntil: AUDIO_UNTIL_EVENTS.includes(config.audioUntil) ? config.audioUntil : base.audioUntil,
    audioUntilFunction: String(config.audioUntilFunction ?? '').trim(),
    functionControlTarget: String(config.functionControlTarget ?? '').trim(),
    functionControlCommand: FUNCTION_CONTROL_COMMANDS.includes(config.functionControlCommand) ? config.functionControlCommand : base.functionControlCommand,
    playerGroupMode: CONTROL_PLAYER_GROUP_MODES.includes(config.playerGroupMode) ? config.playerGroupMode : base.playerGroupMode,
    playerGroupValue: String(config.playerGroupValue ?? '').trim() || base.playerGroupValue,
    setVarName: String(config.setVarName ?? '').trim(),
    setVarOp: ['=', '+', '-', '*', '/'].includes(config.setVarOp) ? config.setVarOp : '=',
    setVarValueType: config.setVarValueType === 'var' ? 'var' : 'digits',
    setVarValue: Number.isFinite(parseFloat(config.setVarValue)) ? parseFloat(config.setVarValue) : 0,
    setVarValueVar: String(config.setVarValueVar ?? '').trim(),
    setBoolName: String(config.setBoolName ?? '').trim(),
    setBoolValue: config.setBoolValue === 'toggle' ? 'toggle' : !!config.setBoolValue,
  };
}

function createDefaultControlFunction(groupId = '') {
  return {
    name: '',
    groupId: String(groupId ?? '').trim(),
    actions: [createDefaultFunctionAction()],
  };
}

function normalizeControlFunction(fn = {}) {
  const actions = Array.isArray(fn.actions) ? fn.actions.map(normalizeFunctionAction) : [];
  return {
    name: String(fn.name ?? '').trim(),
    groupId: String(fn.groupId ?? '').trim(),
    actions: actions.length ? actions : [createDefaultFunctionAction()],
  };
}

function getControlFunctionByName(name) {
  const key = normalizeControlFunctionKey(name);
  if (!key) return null;
  return controlFunctions.find(f => normalizeControlFunctionKey(f.name) === key) || null;
}

function createDefaultCondition() {
  return { type: 'none' };
}

function normalizeCondition(cond = {}) {
  const type = CONDITION_TYPES.includes(cond.type) ? cond.type : 'none';
  return {
    type,
    ref: String(cond.ref ?? '').trim(),
    touchRefType: cond.touchRefType === 'name' ? 'name' : 'group',
    touchRef: String(cond.touchRef ?? '').trim(),
    posSubject: String(cond.posSubject ?? 'player').trim(),
    posAxis: CONDITION_POS_AXES.includes(cond.posAxis) ? cond.posAxis : 'y',
    posOp: CONDITION_OPS.includes(cond.posOp) ? cond.posOp : '>',
    posValue: Number.isFinite(parseFloat(cond.posValue)) ? parseFloat(cond.posValue) : 0,
    posValueType: cond.posValueType === 'var' ? 'var' : 'digits',
    posValueVar: String(cond.posValueVar ?? '').trim(),
    distTarget: String(cond.distTarget ?? '').trim(),
    distOp: CONDITION_OPS.includes(cond.distOp) ? cond.distOp : '<',
    distValue: Math.max(0, Number.isFinite(parseFloat(cond.distValue)) ? parseFloat(cond.distValue) : 5),
    distValueType: cond.distValueType === 'var' ? 'var' : 'digits',
    distValueVar: String(cond.distValueVar ?? '').trim(),
    timerSeconds: Math.max(0, Number.isFinite(parseFloat(cond.timerSeconds)) ? parseFloat(cond.timerSeconds) : 1),
    timerType: cond.timerType === 'var' ? 'var' : 'digits',
    timerVar: String(cond.timerVar ?? '').trim(),
    keyCode: String(cond.keyCode ?? 'Space').trim(),
    varCmpName: String(cond.varCmpName ?? '').trim(),
    varCmpOp: CONDITION_OPS.includes(cond.varCmpOp) ? cond.varCmpOp : '=',
    varCmpValue: Number.isFinite(parseFloat(cond.varCmpValue)) ? parseFloat(cond.varCmpValue) : 0,
    varCmpValueType: cond.varCmpValueType === 'var' ? 'var' : 'digits',
    varCmpValueVar: String(cond.varCmpValueVar ?? '').trim(),
    boolName: String(cond.boolName ?? '').trim(),
    negate: !!cond.negate,
  };
}

function createDefaultTriggerCall() {
  return { functionName: '', conditions: [createDefaultCondition()], conditionLogic: 'and' };
}

function normalizeTriggerCall(call = {}) {
  let conditions;
  if (Array.isArray(call.conditions) && call.conditions.length) {
    conditions = call.conditions.map(c => normalizeCondition(c));
  } else if (call.condition && typeof call.condition === 'object') {
    conditions = [normalizeCondition(call.condition)];
  } else if (call.ifFunction && String(call.ifFunction).trim()) {
    conditions = [normalizeCondition({ type: 'fnDone', ref: String(call.ifFunction).trim() })];
  } else {
    conditions = [normalizeCondition({})];
  }
  const logic = call.conditionLogic === 'or' ? 'or' : 'and';
  return {
    functionName: String(call.functionName ?? '').trim(),
    conditions,
    conditionLogic: logic,
  };
}

function normalizeTriggerCalls(value) {
  if (Array.isArray(value)) return value.map(normalizeTriggerCall);
  return [];
}

function ensureTriggerCalls(mesh) {
  const calls = normalizeTriggerCalls(mesh.userData.triggerCalls);
  mesh.userData.triggerCalls = calls;
  return calls;
}

// ─── Legacy migration ────────────────────────────────────────────────────────
function createDefaultTriggerMoveAction() {
  return {
    functionName: '',
    ifFunction: '',
    actionType: 'move',
    refType: 'group',
    refValue: '',
    offset: [0, 0, 0],
    elseEnabled: false,
    elseOffset: [0, 0, 0],
    style: 'glide',
    duration: 1,
    returnOnDeactivate: true,
    lightOp: 'toggle',
    lightValue: 3,
    elseLightOp: 'disable',
    elseLightValue: 0,
  };
}

function normalizeTriggerMoveConfig(config = {}) {
  const normalizeVec = values => {
    const arr = Array.isArray(values) ? values : [0, 0, 0];
    return [0, 1, 2].map(i => Number.isFinite(parseFloat(arr[i])) ? parseFloat(arr[i]) : 0);
  };
  const base = createDefaultTriggerMoveAction();
  return {
    functionName: String(config.functionName ?? '').trim(),
    ifFunction: String(config.ifFunction ?? '').trim(),
    actionType: CONTROL_ACTION_TYPES.includes(config.actionType) ? config.actionType : base.actionType,
    refType: config.refType === 'name' ? 'name' : 'group',
    refValue: String(config.refValue ?? '').trim(),
    offset: normalizeVec(config.offset ?? base.offset),
    elseEnabled: !!config.elseEnabled,
    elseOffset: normalizeVec(config.elseOffset ?? base.elseOffset),
    style: ['glide', 'strict', 'snap'].includes(config.style) ? config.style : base.style,
    duration: Math.max(0, parseFloat(config.duration) || base.duration),
    returnOnDeactivate: config.returnOnDeactivate !== false,
    lightOp: CONTROL_LIGHT_OPS.includes(config.lightOp) ? config.lightOp : base.lightOp,
    lightValue: Number.isFinite(parseFloat(config.lightValue)) ? parseFloat(config.lightValue) : base.lightValue,
    elseLightOp: CONTROL_LIGHT_OPS.includes(config.elseLightOp) ? config.elseLightOp : base.elseLightOp,
    elseLightValue: Number.isFinite(parseFloat(config.elseLightValue)) ? parseFloat(config.elseLightValue) : base.elseLightValue,
  };
}

function normalizeTriggerMoveActions(value) {
  if (Array.isArray(value)) return value.map(normalizeTriggerMoveConfig);
  if (value && typeof value === 'object') return [normalizeTriggerMoveConfig(value)];
  return [];
}

function migrateOldActionsToFunctions() {
  const functionMap = new Map();
  for (const mesh of sceneObjects) {
    const oldActions = normalizeTriggerMoveActions(mesh.userData.triggerMoveActions ?? mesh.userData.triggerMove);
    if (!oldActions.length) continue;
    const calls = [];
    for (const action of oldActions) {
      const fnName = action.functionName || `fn_${functionMap.size + 1}`;
      if (!functionMap.has(normalizeControlFunctionKey(fnName))) {
        functionMap.set(normalizeControlFunctionKey(fnName), {
          name: fnName,
          actions: [{
            actionType: action.actionType,
            refType: action.refType,
            refValue: action.refValue,
            offset: [...action.offset],
            style: action.style,
            duration: action.duration,
            returnOnDeactivate: action.returnOnDeactivate,
            lightOp: action.lightOp,
            lightValue: action.lightValue,
          }]
        });
      }
      calls.push({ functionName: fnName, condition: action.ifFunction ? normalizeCondition({ type: 'fnDone', ref: action.ifFunction }) : createDefaultCondition() });
    }
    mesh.userData.triggerCalls = calls;
    delete mesh.userData.triggerMoveActions;
    delete mesh.userData.triggerMove;
  }
  controlFunctions.length = 0;
  for (const [, func] of functionMap) controlFunctions.push(normalizeControlFunction(func));
}

function triggerMoveTargets(refType, refValue, triggerMesh = null) {
  const needle = normalizeTouchRef(refValue);
  if (!needle) return [];
  return sceneObjects.filter(mesh => {
    if (refType === 'name') return normalizeTouchRef(mesh.userData.label) === needle;
    return meshHasGroup(mesh, needle);
  });
}

function renderDatalistOptions(values) {
  return values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
}

function getMoveTargetOptions(refType, currentValue = '') {
  return refType === 'name'
    ? renderDatalistOptions(getKnownLabels([currentValue]))
    : renderDatalistOptions(getKnownGroups([currentValue || 'default']));
}

function renderProjectLibrary() {
  if (!mainMenuProjectList) return;
  const projects = getStoredProjects().sort((a, b) =>
    (new Date(b.updatedAt || 0).getTime() || 0) - (new Date(a.updatedAt || 0).getTime() || 0)
  );
  if (!projects.length) {
    mainMenuProjectList.innerHTML = '<div class="mm-empty">No saved projects yet. Open Studio and use Save.</div>';
    return;
  }
  mainMenuProjectList.innerHTML = projects.map(p => {
    const payload = p.payload || p.data;
    const objCount = payload?.objects?.length ?? 0;
    return `
      <div class="mm-project" data-project-id="${escapeHtml(p.id)}" title="Open project">
        <div class="mm-project-icon">📁</div>
        <div class="mm-project-info">
          <div class="mm-project-name">${escapeHtml(p.name || 'Untitled')}</div>
          <div class="mm-project-date">${escapeHtml(formatProjectDate(p.updatedAt || p.createdAt))}</div>
        </div>
        <div class="mm-project-objs">${objCount} objs</div>
        <div class="mm-project-actions">
          <button class="mm-project-del" data-project-del="${escapeHtml(p.id)}" title="Delete project">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function normalizeRuntimeLibraryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const payload = coerceRuntimeLevelPayload(entry.payload);
  if (!payload) return null;
  const createdAt = entry.createdAt || new Date().toISOString();
  const updatedAt = entry.updatedAt || createdAt;
  return {
    id: String(entry.id || makeProjectId()),
    name: String(entry.name || 'Untitled'),
    payload,
    runtimeSave: entry.runtimeSave && typeof entry.runtimeSave === 'object' ? entry.runtimeSave : null,
    createdAt,
    updatedAt,
  };
}

function getRuntimeLibrary() {
  if (!runtimeLoaderMode) return [];
  try {
    const raw = localStorage.getItem(RUNTIME_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRuntimeLibraryEntry)
      .filter(Boolean)
      .sort((a, b) => (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0));
  } catch {
    return [];
  }
}

function setRuntimeLibrary(entries) {
  try {
    const normalized = Array.isArray(entries)
      ? entries.map(normalizeRuntimeLibraryEntry).filter(Boolean)
      : [];
    localStorage.setItem(RUNTIME_LIBRARY_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch (err) {
    console.error(err);
    alert('Unable to save runtime game library. Browser storage may be full.');
    return false;
  }
}

function hideRuntimeLoaderOverlay() {
  if (!runtimeLoaderOverlayEl) return;
  runtimeLoaderOverlayEl.remove();
  runtimeLoaderOverlayEl = null;
}

function setRuntimeShadowQuality(level) {
  applyShadowQuality(level);
  if (qualityShadowsSelect) qualityShadowsSelect.value = quality.shadows;
  syncRuntimeSettingsPanel();
}

function setRuntimeRenderDistance(value) {
  quality.renderDist = THREE.MathUtils.clamp(parseFloat(value) || quality.renderDist, 20, 500);
  if (qualityRenderDistInput) qualityRenderDistInput.value = quality.renderDist;
  syncRuntimeSettingsPanel();
}

function setRuntimeLightDistance(value) {
  quality.lightDist = THREE.MathUtils.clamp(parseFloat(value) || quality.lightDist, 10, 200);
  if (qualityLightDistInput) qualityLightDistInput.value = quality.lightDist;
  syncRuntimeSettingsPanel();
}

function setRuntimeAutoPerformance(enabled) {
  runtimeOptimizer.autoPerformance = !!enabled;
  if (!runtimeOptimizer.autoPerformance) runtimeOptimizer.lowFpsStreak = 0;
  syncRuntimeSettingsPanel();
}

function setRuntimeAutoVisual(enabled) {
  runtimeOptimizer.autoVisual = !!enabled;
  if (!runtimeOptimizer.autoVisual) runtimeOptimizer.highFpsStreak = 0;
  syncRuntimeSettingsPanel();
}

function buildRuntimeProgressSnapshot() {
  if (!runtimeMode || !state.isPlaytest) return null;
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    payload: buildLevelPayload(),
    player: {
      pos: fpsPos.toArray(),
      yaw: fpsYaw,
      pitch: fpsPitch,
      velY: fpsVelY,
      grounded: fpsGrounded,
      health: fpsHealth,
      hits: fpsHits,
      spawnPos: fpsSpawnPos.toArray(),
      spawnYaw: fpsSpawnYaw,
      spawnPitch: fpsSpawnPitch,
      spawnProtectTimer: fpsSpawnProtectTimer,
      spawnLanded: fpsSpawnLanded,
      devView: fpsDevView,
    },
    targets: sceneObjects
      .map((mesh, index) => {
        if (mesh.userData.type !== 'target') return null;
        return {
          index,
          dead: !!mesh.userData._dead,
          health: Number.isFinite(mesh.userData._health)
            ? mesh.userData._health
            : (mesh.userData.targetMaxHealth || 0),
        };
      })
      .filter(Boolean),
    optimizer: {
      autoPerformance: !!runtimeOptimizer.autoPerformance,
      autoVisual: !!runtimeOptimizer.autoVisual,
    },
  };
}

function applyRuntimeProgressSnapshot(snapshot) {
  if (!snapshot || !state.isPlaytest) return;
  const player = snapshot.player || {};

  if (Array.isArray(player.pos) && player.pos.length >= 3) fpsPos.fromArray(player.pos);
  if (Number.isFinite(player.yaw)) fpsYaw = player.yaw;
  if (Number.isFinite(player.pitch)) fpsPitch = player.pitch;
  if (Number.isFinite(player.velY)) fpsVelY = player.velY;
  fpsGrounded = !!player.grounded;
  if (Number.isFinite(player.health)) fpsHealth = THREE.MathUtils.clamp(player.health, 0, gameRules.maxHealth);
  if (Number.isFinite(player.hits)) fpsHits = Math.max(0, Math.round(player.hits));
  if (Array.isArray(player.spawnPos) && player.spawnPos.length >= 3) fpsSpawnPos.fromArray(player.spawnPos);
  if (Number.isFinite(player.spawnYaw)) fpsSpawnYaw = player.spawnYaw;
  if (Number.isFinite(player.spawnPitch)) fpsSpawnPitch = player.spawnPitch;
  if (Number.isFinite(player.spawnProtectTimer)) fpsSpawnProtectTimer = Math.max(0, player.spawnProtectTimer);
  fpsSpawnLanded = !!player.spawnLanded;

  if (snapshot.optimizer && typeof snapshot.optimizer === 'object') {
    setRuntimeAutoPerformance(snapshot.optimizer.autoPerformance !== false);
    setRuntimeAutoVisual(snapshot.optimizer.autoVisual !== false);
  }

  const targetStates = Array.isArray(snapshot.targets) ? snapshot.targets : [];
  for (const targetState of targetStates) {
    if (!Number.isInteger(targetState?.index)) continue;
    const mesh = sceneObjects[targetState.index];
    if (!mesh || mesh.userData.type !== 'target') continue;
    mesh.userData._dead = !!targetState.dead;
    if (Number.isFinite(targetState.health)) mesh.userData._health = targetState.health;
    mesh.visible = !mesh.userData._dead;
  }

  setPlaytestDevView(!!player.devView);
  updateHealthHud();
  syncFpsCamera();
  syncRuntimeSettingsPanel();
  refreshStatus();
}

function saveRuntimeProgressToLibrary(options = {}) {
  const showFeedback = options.showFeedback !== false;
  if (!runtimeMode || !runtimeLoaderMode || !state.isPlaytest) return false;

  const snapshot = buildRuntimeProgressSnapshot();
  if (!snapshot) return false;

  const now = new Date().toISOString();
  const entries = getRuntimeLibrary();
  let idx = entries.findIndex(entry => entry.id === runtimeActiveLibraryEntryId);

  if (idx < 0) {
    runtimeActiveLibraryEntryId = makeProjectId();
    runtimeActiveLibraryEntryName = runtimeActiveLibraryEntryName || `Saved Run ${new Date().toLocaleString()}`;
    entries.push({
      id: runtimeActiveLibraryEntryId,
      name: runtimeActiveLibraryEntryName,
      payload: snapshot.payload,
      runtimeSave: snapshot,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    entries[idx] = {
      ...entries[idx],
      name: runtimeActiveLibraryEntryName || entries[idx].name || 'Untitled',
      payload: snapshot.payload,
      runtimeSave: snapshot,
      updatedAt: now,
      createdAt: entries[idx].createdAt || now,
    };
  }

  const ok = setRuntimeLibrary(entries);
  if (ok && showFeedback) alert('Progress saved to launcher library.');
  return ok;
}

function hideRuntimePauseMenu() {
  if (!runtimePauseOverlayEl) return;
  runtimePauseOverlayEl.remove();
  runtimePauseOverlayEl = null;
}

function pauseRuntimeGame() {
  if (!runtimeMode || !state.isPlaytest) return;
  runtimePauseActive = true;
  if (runtimeSettingsPanelEl) runtimeSettingsPanelEl.style.display = 'none';
  fpsKeys.clear();
  fpsSprinting = false;
  if (!runtimePauseOverlayEl) showRuntimePauseMenu();
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  refreshStatus();
}

function resumeRuntimeGame() {
  if (!runtimeMode || !state.isPlaytest) return;
  runtimePauseActive = false;
  hideRuntimePauseMenu();
  fpsKeys.clear();
  fpsSprinting = false;
  if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock();
  refreshStatus();
}

function toggleRuntimePauseGame() {
  if (!runtimeMode || !state.isPlaytest) return;
  if (runtimePauseActive) resumeRuntimeGame();
  else pauseRuntimeGame();
}

function showRuntimePauseMenu() {
  if (!runtimeMode || !state.isPlaytest || runtimePauseOverlayEl) return;
  const canSave = runtimeLoaderMode;
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '13000';
  overlay.style.overflowY = 'auto';
  overlay.style.background = 'radial-gradient(circle at 50% 0%, rgba(31,43,62,0.88), rgba(13,17,23,0.96))';
  overlay.innerHTML = `
    <div style="min-height:100%;display:flex;flex-direction:column;align-items:center;padding:32px 16px 36px">
      <div class="mm-header" style="padding:24px 20px 14px">
        <div class="mm-logo" style="font-size:42px">⏸ Paused</div>
        <div class="mm-sub">Runtime controls, settings, and save options</div>
      </div>
      <div class="mm-actions" style="margin:8px 0 14px">
        <button class="mm-btn mm-btn-primary" id="rp-resume">▶ Resume (P)</button>
        <button class="mm-btn mm-btn-import" id="rp-save" ${canSave ? '' : 'disabled'}>💾 Save</button>
        <button class="mm-btn mm-btn-import" id="rp-save-quit" ${canSave ? '' : 'disabled'}>↩ Save And Quit</button>
        <button class="mm-btn mm-btn-import" id="rp-quit">⏹ Quit To Launcher</button>
      </div>
      <div class="mm-projects" style="max-width:700px;padding-bottom:10px">
        <div class="mm-projects-hdr">Runtime Settings</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;padding-top:8px">
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Shadows</span><select id="rp-quality-shadows" style="font-size:11px;padding:3px 5px"><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Render Distance</span><input id="rp-quality-render" type="number" min="20" max="500" step="10" style="width:90px;font-size:11px;padding:3px 5px"/></label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Light Distance</span><input id="rp-quality-light" type="number" min="10" max="200" step="5" style="width:90px;font-size:11px;padding:3px 5px"/></label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Day Cycle</span><input id="rp-day-cycle" type="checkbox"/></label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Day Duration (s)</span><input id="rp-day-duration" type="number" min="1" max="3600" step="1" style="width:90px;font-size:11px;padding:3px 5px"/></label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Auto Performance</span><input id="rp-auto-perf" type="checkbox"/></label>
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Auto Visual</span><input id="rp-auto-visual" type="checkbox"/></label>
        </div>
        <div style="display:flex;justify-content:center;margin-top:10px;gap:8px">
          <button class="mm-btn mm-btn-import" id="rp-restart">↻ Restart Run</button>
        </div>
        ${canSave ? '' : '<div style="font-size:11px;color:var(--muted);text-align:center;margin-top:10px">Save to launcher is available in Loader HTML mode.</div>'}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  runtimePauseOverlayEl = overlay;
  runtimePauseActive = true;

  overlay.querySelector('#rp-resume')?.addEventListener('click', () => resumeRuntimeGame());
  overlay.querySelector('#rp-save')?.addEventListener('click', () => saveRuntimeProgressToLibrary({ showFeedback: true }));
  overlay.querySelector('#rp-save-quit')?.addEventListener('click', () => {
    if (!saveRuntimeProgressToLibrary({ showFeedback: false })) return;
    stopPlaytest({ returnToLibrary: true });
  });
  overlay.querySelector('#rp-quit')?.addEventListener('click', () => stopPlaytest({ returnToLibrary: true }));
  overlay.querySelector('#rp-restart')?.addEventListener('click', () => {
    stopPlaytest({ returnToLibrary: false });
    startPlaytest();
  });

  overlay.querySelector('#rp-quality-shadows')?.addEventListener('change', e => setRuntimeShadowQuality(e.target.value));
  overlay.querySelector('#rp-quality-render')?.addEventListener('change', e => setRuntimeRenderDistance(e.target.value));
  overlay.querySelector('#rp-quality-light')?.addEventListener('change', e => setRuntimeLightDistance(e.target.value));
  overlay.querySelector('#rp-day-cycle')?.addEventListener('change', e => {
    if (sunDayCycleEnabledInput) sunDayCycleEnabledInput.checked = !!e.target.checked;
    updateSunSky();
    syncRuntimeSettingsPanel();
  });
  overlay.querySelector('#rp-day-duration')?.addEventListener('change', e => {
    const val = clampSunDayDuration(parseFloat(e.target.value));
    if (sunDayDurationInput) sunDayDurationInput.value = String(val);
    e.target.value = val;
    updateSunSky();
    syncRuntimeSettingsPanel();
  });
  overlay.querySelector('#rp-auto-perf')?.addEventListener('change', e => setRuntimeAutoPerformance(!!e.target.checked));
  overlay.querySelector('#rp-auto-visual')?.addEventListener('change', e => setRuntimeAutoVisual(!!e.target.checked));

  syncRuntimeSettingsPanel();
}

function syncRuntimeSettingsPanel() {
  if (runtimeSettingsPanelEl) {
    const shadowSelect = runtimeSettingsPanelEl.querySelector('#rt-quality-shadows');
    const renderInput = runtimeSettingsPanelEl.querySelector('#rt-quality-render');
    const lightInput = runtimeSettingsPanelEl.querySelector('#rt-quality-light');
    const cycleInput = runtimeSettingsPanelEl.querySelector('#rt-day-cycle');
    const dayDurInput = runtimeSettingsPanelEl.querySelector('#rt-day-duration');
    const autoPerfInput = runtimeSettingsPanelEl.querySelector('#rt-auto-perf');
    const autoVisualInput = runtimeSettingsPanelEl.querySelector('#rt-auto-visual');

    if (shadowSelect) shadowSelect.value = quality.shadows;
    if (renderInput) renderInput.value = quality.renderDist;
    if (lightInput) lightInput.value = quality.lightDist;
    if (cycleInput && sunDayCycleEnabledInput) cycleInput.checked = !!sunDayCycleEnabledInput.checked;
    if (dayDurInput && sunDayDurationInput) dayDurInput.value = clampSunDayDuration(parseFloat(sunDayDurationInput.value));
    if (autoPerfInput) autoPerfInput.checked = !!runtimeOptimizer.autoPerformance;
    if (autoVisualInput) autoVisualInput.checked = !!runtimeOptimizer.autoVisual;
  }

  if (runtimePauseOverlayEl) {
    const shadowSelect = runtimePauseOverlayEl.querySelector('#rp-quality-shadows');
    const renderInput = runtimePauseOverlayEl.querySelector('#rp-quality-render');
    const lightInput = runtimePauseOverlayEl.querySelector('#rp-quality-light');
    const cycleInput = runtimePauseOverlayEl.querySelector('#rp-day-cycle');
    const dayDurInput = runtimePauseOverlayEl.querySelector('#rp-day-duration');
    const autoPerfInput = runtimePauseOverlayEl.querySelector('#rp-auto-perf');
    const autoVisualInput = runtimePauseOverlayEl.querySelector('#rp-auto-visual');

    if (shadowSelect) shadowSelect.value = quality.shadows;
    if (renderInput) renderInput.value = quality.renderDist;
    if (lightInput) lightInput.value = quality.lightDist;
    if (cycleInput && sunDayCycleEnabledInput) cycleInput.checked = !!sunDayCycleEnabledInput.checked;
    if (dayDurInput && sunDayDurationInput) dayDurInput.value = clampSunDayDuration(parseFloat(sunDayDurationInput.value));
    if (autoPerfInput) autoPerfInput.checked = !!runtimeOptimizer.autoPerformance;
    if (autoVisualInput) autoVisualInput.checked = !!runtimeOptimizer.autoVisual;
  }
}

function ensureRuntimeHud() {
  if (!runtimeMode || runtimeHudEl) return;

  const hud = document.createElement('div');
  hud.style.position = 'fixed';
  hud.style.top = '10px';
  hud.style.right = '10px';
  hud.style.zIndex = '11000';
  hud.style.display = 'flex';
  hud.style.gap = '6px';

  const pauseBtn = document.createElement('button');
  pauseBtn.textContent = '⏸ Pause';
  pauseBtn.style.padding = '4px 8px';
  pauseBtn.style.fontSize = '11px';
  pauseBtn.style.background = 'rgba(22,27,34,0.92)';
  pauseBtn.style.border = '1px solid var(--border)';
  pauseBtn.style.borderRadius = '6px';
  pauseBtn.style.color = 'var(--text)';
  pauseBtn.style.cursor = 'pointer';
  pauseBtn.addEventListener('click', () => pauseRuntimeGame());

  const settingsBtn = document.createElement('button');
  settingsBtn.textContent = '⚙ Runtime';
  settingsBtn.style.padding = '4px 8px';
  settingsBtn.style.fontSize = '11px';
  settingsBtn.style.background = 'rgba(22,27,34,0.92)';
  settingsBtn.style.border = '1px solid var(--border)';
  settingsBtn.style.borderRadius = '6px';
  settingsBtn.style.color = 'var(--text)';
  settingsBtn.style.cursor = 'pointer';

  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.top = '42px';
  panel.style.right = '10px';
  panel.style.zIndex = '11000';
  panel.style.width = '240px';
  panel.style.padding = '10px';
  panel.style.borderRadius = '8px';
  panel.style.border = '1px solid var(--border)';
  panel.style.background = 'rgba(22,27,34,0.97)';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:.04em;margin-bottom:6px">Runtime Settings</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Shadows</span><select id="rt-quality-shadows" style="font-size:11px;padding:2px 4px"><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Render Dist</span><input id="rt-quality-render" type="number" min="20" max="500" step="10" style="width:84px;font-size:11px;padding:2px 4px"/></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Light Dist</span><input id="rt-quality-light" type="number" min="10" max="200" step="5" style="width:84px;font-size:11px;padding:2px 4px"/></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Day Cycle</span><input id="rt-day-cycle" type="checkbox"/></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Day (s)</span><input id="rt-day-duration" type="number" min="1" max="3600" step="1" style="width:84px;font-size:11px;padding:2px 4px"/></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Auto Perf</span><input id="rt-auto-perf" type="checkbox"/></div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px"><span style="font-size:10px;color:var(--muted)">Auto Visual</span><input id="rt-auto-visual" type="checkbox"/></div>
    <div style="display:flex;gap:6px"><button id="rt-open-pause" style="flex:1;font-size:10px;padding:3px 6px">Pause Menu</button><button id="rt-close" style="flex:1;font-size:10px;padding:3px 6px">Close</button></div>
  `;

  settingsBtn.addEventListener('click', () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    if (!open) syncRuntimeSettingsPanel();
  });

  panel.querySelector('#rt-close')?.addEventListener('click', () => { panel.style.display = 'none'; });
  panel.querySelector('#rt-open-pause')?.addEventListener('click', () => pauseRuntimeGame());
  panel.querySelector('#rt-quality-shadows')?.addEventListener('change', e => setRuntimeShadowQuality(e.target.value));
  panel.querySelector('#rt-quality-render')?.addEventListener('change', e => setRuntimeRenderDistance(e.target.value));
  panel.querySelector('#rt-quality-light')?.addEventListener('change', e => setRuntimeLightDistance(e.target.value));
  panel.querySelector('#rt-day-cycle')?.addEventListener('change', e => {
    if (sunDayCycleEnabledInput) sunDayCycleEnabledInput.checked = !!e.target.checked;
    updateSunSky();
    syncRuntimeSettingsPanel();
  });
  panel.querySelector('#rt-day-duration')?.addEventListener('change', e => {
    const val = clampSunDayDuration(parseFloat(e.target.value));
    if (sunDayDurationInput) sunDayDurationInput.value = String(val);
    e.target.value = val;
    updateSunSky();
    syncRuntimeSettingsPanel();
  });
  panel.querySelector('#rt-auto-perf')?.addEventListener('change', e => {
    setRuntimeAutoPerformance(!!e.target.checked);
    syncRuntimeSettingsPanel();
  });
  panel.querySelector('#rt-auto-visual')?.addEventListener('change', e => {
    setRuntimeAutoVisual(!!e.target.checked);
    syncRuntimeSettingsPanel();
  });

  if (runtimeLoaderMode) {
    const libraryBtn = document.createElement('button');
    libraryBtn.textContent = '📚 Library';
    libraryBtn.style.padding = '4px 8px';
    libraryBtn.style.fontSize = '11px';
    libraryBtn.style.background = 'rgba(22,27,34,0.92)';
    libraryBtn.style.border = '1px solid var(--border)';
    libraryBtn.style.borderRadius = '6px';
    libraryBtn.style.color = 'var(--text)';
    libraryBtn.style.cursor = 'pointer';
    libraryBtn.addEventListener('click', () => showRuntimeLoaderOverlay());
    hud.appendChild(libraryBtn);
  }

  hud.appendChild(pauseBtn);
  hud.appendChild(settingsBtn);
  document.body.appendChild(hud);
  document.body.appendChild(panel);
  runtimeHudEl = hud;
  runtimeSettingsPanelEl = panel;
  syncRuntimeSettingsPanel();
}

function applyRuntimeChrome() {
  if (!runtimeMode) return;
  document.body.classList.add('runtime-mode');
  if (mainMenuEl) mainMenuEl.classList.add('hidden');
  if (topbarEl) {
    topbarEl.classList.add('studio-hidden');
    topbarEl.style.display = 'none';
  }
  if (sidebarEl) sidebarEl.style.display = 'none';
  if (sidebarResizerEl) sidebarResizerEl.style.display = 'none';
  if (functionsResizerEl) functionsResizerEl.style.display = 'none';
  if (functionsPanelEl) functionsPanelEl.style.display = 'none';
  if (workspaceEl) workspaceEl.classList.remove('studio-hidden');
  hideProps();
  ensureRuntimeHud();
  onResize();
}

function formatRuntimeEntryMeta(entry) {
  const parts = [];
  parts.push(`${entry.payload?.objects?.length ?? 0} objects`);
  if (entry.runtimeSave) parts.push('Saved progress');
  if (entry.updatedAt) parts.push(`Updated ${formatProjectDate(entry.updatedAt)}`);
  return parts.join(' • ');
}

function showRuntimeLoaderOverlay() {
  if (!runtimeMode || !runtimeLoaderMode || runtimeLoaderOverlayEl) return;

  hideRuntimePauseMenu();

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '12000';
  overlay.style.overflowY = 'auto';
  overlay.style.background = 'radial-gradient(circle at 50% 0%, rgba(31,43,62,0.85), rgba(13,17,23,0.98))';

  overlay.innerHTML = `
    <div style="min-height:100%;display:flex;flex-direction:column;align-items:center;padding:24px 0 36px">
      <div class="mm-header" style="padding-top:40px">
        <div class="mm-logo">🔥 Flame3D</div>
        <div class="mm-sub">Game Launcher</div>
      </div>
      <div class="mm-actions" style="margin-top:8px">
        <button class="mm-btn mm-btn-primary" id="runtime-add-json">📂 Add Game JSON Files</button>
        <button class="mm-btn mm-btn-import" id="runtime-close-loader" ${state.isPlaytest ? '' : 'style="display:none"'}>Close</button>
        <input id="runtime-add-json-input" type="file" accept=".json,application/json" multiple style="display:none"/>
      </div>
      <div class="mm-projects" style="max-width:720px">
        <div class="mm-projects-hdr">Game Library</div>
        <div id="runtime-library-list"></div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  runtimeLoaderOverlayEl = overlay;

  const listEl = overlay.querySelector('#runtime-library-list');
  const addBtn = overlay.querySelector('#runtime-add-json');
  const closeBtn = overlay.querySelector('#runtime-close-loader');
  const addInput = overlay.querySelector('#runtime-add-json-input');

  const renderLibrary = () => {
    const entries = getRuntimeLibrary();
    if (!entries.length) {
      listEl.innerHTML = '<div class="mm-empty">No games imported yet.</div>';
      return;
    }

    listEl.innerHTML = entries.map(entry => {
      const hasSave = !!entry.runtimeSave;
      return `
        <div class="mm-project" style="cursor:default;align-items:flex-start">
          <div class="mm-project-icon">🎮</div>
          <div class="mm-project-info">
            <div class="mm-project-name">${escapeHtml(entry.name || 'Untitled')}</div>
            <div class="mm-project-date">${escapeHtml(formatRuntimeEntryMeta(entry))}</div>
          </div>
          <div class="mm-project-actions" style="gap:6px">
            <button data-runtime-play="${escapeHtml(entry.id)}" style="font-size:10px;padding:4px 8px">${hasSave ? 'Continue' : 'Play'}</button>
            <button data-runtime-del="${escapeHtml(entry.id)}" style="font-size:10px;padding:4px 8px">Remove</button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-runtime-play]').forEach(btn => {
      btn.addEventListener('click', () => {
        const entriesNow = getRuntimeLibrary();
        const found = entriesNow.find(e => e.id === btn.dataset.runtimePlay);
        if (!found?.payload) return;
        startRuntimeGame(found.payload, {
          entryId: found.id,
          entryName: found.name,
          runtimeSave: found.runtimeSave,
        });
      });
    });

    listEl.querySelectorAll('[data-runtime-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const deletingId = btn.dataset.runtimeDel;
        const next = getRuntimeLibrary().filter(e => e.id !== deletingId);
        if (!setRuntimeLibrary(next)) return;
        if (runtimeActiveLibraryEntryId === deletingId) {
          runtimeActiveLibraryEntryId = null;
          runtimeActiveLibraryEntryName = '';
        }
        renderLibrary();
      });
    });
  };

  addBtn?.addEventListener('click', () => addInput?.click());
  closeBtn?.addEventListener('click', () => hideRuntimeLoaderOverlay());

  addInput?.addEventListener('change', async () => {
    const files = Array.from(addInput.files || []);
    addInput.value = '';
    if (!files.length) return;

    const validEntries = [];
    const rejected = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const payload = coerceRuntimeLevelPayload(text);
        if (!payload) throw new Error('Invalid Flame3D level payload');
        const now = new Date().toISOString();
        validEntries.push({
          id: makeProjectId(),
          name: file.name.replace(/\.json$/i, ''),
          payload,
          runtimeSave: null,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        rejected.push(file.name);
      }
    }

    if (validEntries.length) {
      const next = [...getRuntimeLibrary(), ...validEntries];
      if (setRuntimeLibrary(next)) renderLibrary();
    }

    if (rejected.length) {
      alert(`Some files were skipped because they are not valid Flame3D game JSON:\n${rejected.join('\n')}`);
    }
  });

  renderLibrary();
}

function startRuntimeGame(payload = null, options = {}) {
  if (!runtimeMode) return;

  runtimeActiveLibraryEntryId = options.entryId || null;
  runtimeActiveLibraryEntryName = options.entryName || runtimeActiveLibraryEntryName || 'Untitled';

  if (state.isPlaytest) stopPlaytest({ returnToLibrary: false });
  if (payload) loadLevelJSON(JSON.stringify(payload), { pushHistory: false });
  hideRuntimeLoaderOverlay();
  hideRuntimePauseMenu();
  runtimePauseActive = false;
  applyRuntimeChrome();
  showStudio();
  if (runtimeSettingsPanelEl) runtimeSettingsPanelEl.style.display = 'none';
  if (!state.isPlaytest) startPlaytest();
  if (options.runtimeSave && typeof options.runtimeSave === 'object') {
    applyRuntimeProgressSnapshot(options.runtimeSave);
  }
}

function showMainMenu() {
  closeTransientMenus();
  if (runtimeMode) {
    applyRuntimeChrome();
    showStudio();
    return;
  }
  if (state.isPlaytest) stopPlaytest();
  renderProjectLibrary();
  if (mainMenuEl) mainMenuEl.classList.remove('hidden');
  if (topbarEl) topbarEl.classList.add('studio-hidden');
  if (workspaceEl) workspaceEl.classList.add('studio-hidden');
}

function showStudio() {
  closeTransientMenus();
  if (mainMenuEl) mainMenuEl.classList.add('hidden');
  if (topbarEl) {
    topbarEl.classList.remove('studio-hidden');
    if (!runtimeMode) topbarEl.style.display = '';
  }
  if (workspaceEl) workspaceEl.classList.remove('studio-hidden');
  if (functionsPanelEl) functionsPanelEl.style.display = runtimeMode ? 'none' : '';
  if (functionsResizerEl) functionsResizerEl.style.display = runtimeMode ? 'none' : '';
  if (runtimeMode) applyRuntimeChrome();
  onResize();
  refreshStatus();
}

function resetSceneForNewProject() {
  if (state.isPlaytest) stopPlaytest();
  selectObject(null);
  const toRemove = [...sceneObjects];
  toRemove.forEach(removeFromScene);
  undoStack.length = 0;
  redoStack.length = 0;
  syncUndoUI();
  refreshStatus();
}

function startNewProject() {
  currentProjectId = null;
  currentProjectName = '';
  resetSceneForNewProject();
  showStudio();
}

function openProjectById(projectId) {
  const project = getStoredProjects().find(p => p.id === projectId);
  if (!project) return;
  const payload = project.payload || project.data;
  if (!payload) return;
  loadLevelJSON(JSON.stringify(payload), { pushHistory: false });
  currentProjectId = project.id;
  currentProjectName = project.name || '';
  showStudio();
}

function deleteProjectById(projectId) {
  const projects = getStoredProjects();
  const idx = projects.findIndex(p => p.id === projectId);
  if (idx < 0) return;
  const name = projects[idx].name || 'Untitled';
  if (!confirm(`Delete project "${name}"?`)) return;
  projects.splice(idx, 1);
  setStoredProjects(projects);
  if (currentProjectId === projectId) {
    currentProjectId = null;
    currentProjectName = '';
  }
  renderProjectLibrary();
}

function saveProjectToLibrary() {
  const fallbackName = `Project ${new Date().toLocaleString()}`;
  const proposed = currentProjectName || fallbackName;
  const entered = prompt('Project name:', proposed);
  if (entered === null) return;
  const name = entered.trim() || fallbackName;

  const projects = getStoredProjects();
  const now = new Date().toISOString();
  const payload = buildLevelPayload();
  const id = currentProjectId || makeProjectId();
  const existingIdx = projects.findIndex(p => p.id === id);

  if (existingIdx >= 0) {
    projects[existingIdx] = {
      ...projects[existingIdx],
      name,
      updatedAt: now,
      payload,
    };
  } else {
    projects.push({
      id,
      name,
      createdAt: now,
      updatedAt: now,
      payload,
    });
  }

  setStoredProjects(projects);
  currentProjectId = id;
  currentProjectName = name;
  renderProjectLibrary();
}

// ─── Playtest ─────────────────────────────────────────────────────────────────
let fpsLocked   = false;
let fpsYaw      = 0;
let fpsPitch    = 0;
let fpsHits     = 0;
let fpsVelY     = 0;
let fpsGrounded = false;
let fpsSprinting = false;
let fpsHealth      = 100;
let fpsFallStartY  = null;
let fpsSpawnPos    = new THREE.Vector3();
let fpsSpawnYaw    = 0;
let fpsSpawnPitch  = 0;
let fpsSpawnProtectTimer = 0;
let fpsSpawnLanded = true;
const FPS_SENS  = 0.002;
const fpsKeys   = new Set();
const fpsPos    = new THREE.Vector3();
const savedTargetColors = new Map();
const fpsRay    = new THREE.Raycaster();
const _spawnAABB = new THREE.Box3();
const _checkpointAABB = new THREE.Box3();
const _playtestBasePositions = new Map();
const _playtestBaseRotations = new Map();
const _playtestPrevPositions = new Map();
const _playtestPrevRotations = new Map();
const _playtestPrevAABBs = new Map();
const _triggerMoveStates = new Map();
const _triggerRotateStates = new Map();
const _triggerMoveTemp = new THREE.Vector3();
const _triggerRotateEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _triggerRotateQuat = new THREE.Quaternion();
const _triggerAnimPivot = new THREE.Vector3();
const _triggerAnimOffset = new THREE.Vector3();

// ─── Editor simulation (preview without playtest) ────────────────────────────
const _simBasePositions = new Map(); // mesh -> original Vector3
const _simBaseRotations = new Map(); // mesh -> original Quaternion
const _simLightStates = new Map();   // mesh -> { had, intensity, distance }
let _simActive = false;

function ensureSimBasePositions(meshes) {
  for (const mesh of meshes) {
    if (!_simBasePositions.has(mesh)) {
      _simBasePositions.set(mesh, mesh.position.clone());
    }
  }
}

function ensureSimBaseRotations(meshes) {
  for (const mesh of meshes) {
    if (!_simBaseRotations.has(mesh)) {
      _simBaseRotations.set(mesh, mesh.quaternion.clone());
    }
  }
}

function getActionAnimationProgress(st, nowSeconds) {
  const rawT = st.duration <= 0 ? 1 : THREE.MathUtils.clamp((nowSeconds - st.startedAt) / st.duration, 0, 1);
  let easedT = rawT;
  if (st.style === 'glide') easedT = rawT * rawT * (3 - 2 * rawT);
  else if (st.style === 'snap') easedT = rawT >= 1 ? 1 : 0;
  return { rawT, easedT };
}

function applyRotateVectorToQuaternion(rotVecDegrees, outQuat) {
  _triggerRotateEuler.set(
    rotVecDegrees.x * Math.PI / 180,
    rotVecDegrees.y * Math.PI / 180,
    rotVecDegrees.z * Math.PI / 180,
    'XYZ'
  );
  outQuat.setFromEuler(_triggerRotateEuler);
  return outQuat;
}

function updateMoveStateProgress(stateMap, nowSeconds, offsetsByMesh, options = {}) {
  let anyFunctionJustCompleted = false;
  const keyFilter = typeof options.keyFilter === 'function' ? options.keyFilter : null;

  for (const [key, st] of [...stateMap]) {
    if (keyFilter && !keyFilter(key, st)) continue;
    const paused = isFunctionPaused(st.functionName);

    if (paused) {
      if (!Number.isFinite(st.pausedAt)) st.pausedAt = nowSeconds;
      for (const mesh of st.targets) {
        if (!offsetsByMesh.has(mesh)) offsetsByMesh.set(mesh, new THREE.Vector3());
        offsetsByMesh.get(mesh).add(st.currentOffset);
      }
      continue;
    }

    if (Number.isFinite(st.pausedAt)) {
      st.startedAt += Math.max(0, nowSeconds - st.pausedAt);
      st.pausedAt = null;
    }

    const { rawT, easedT } = getActionAnimationProgress(st, nowSeconds);

    st.currentOffset.copy(st.fromOffset).lerp(st.toOffset, easedT);

    for (const mesh of st.targets) {
      if (!offsetsByMesh.has(mesh)) offsetsByMesh.set(mesh, new THREE.Vector3());
      offsetsByMesh.get(mesh).add(st.currentOffset);
    }

    if (rawT >= 1 && st.toOffset.lengthSq() === 0) {
      stateMap.delete(key);
    }

    if (rawT >= 1 && st.functionName && !st.functionMarked) {
      markControlFunctionMet(st.functionName, st.callerUuid ? sceneObjects.find(m => m.uuid === st.callerUuid) ?? null : null);
      st.functionMarked = true;
      anyFunctionJustCompleted = true;
    }
  }

  return anyFunctionJustCompleted;
}

function applyAnimatedTransforms(basePositions, baseRotations, moveStateMap, rotateStateMap, nowSeconds, options = {}) {
  const offsetsByMesh = new Map();
  let anyFunctionJustCompleted = updateMoveStateProgress(moveStateMap, nowSeconds, offsetsByMesh, options);
  const keyFilter = typeof options.keyFilter === 'function' ? options.keyFilter : null;

  for (const [mesh, basePos] of basePositions) {
    const offset = offsetsByMesh.get(mesh);
    if (offset) _triggerMoveTemp.copy(basePos).add(offset);
    else _triggerMoveTemp.copy(basePos);
    mesh.position.copy(_triggerMoveTemp);

    const baseQuat = baseRotations.get(mesh);
    if (baseQuat) mesh.quaternion.copy(baseQuat);
  }

  for (const [key, st] of [...rotateStateMap]) {
    if (keyFilter && !keyFilter(key, st)) continue;
    const paused = isFunctionPaused(st.functionName);

    if (paused) {
      if (!Number.isFinite(st.pausedAt)) st.pausedAt = nowSeconds;
      applyRotateVectorToQuaternion(st.currentRotation, _triggerRotateQuat);
      const rotateTogetherPaused = st.groupMode === 'together' && st.targets.length > 1;
      if (rotateTogetherPaused) {
        _triggerAnimPivot.set(0, 0, 0);
        let targetCount = 0;
        for (const mesh of st.targets) {
          if (!basePositions.has(mesh)) continue;
          _triggerAnimPivot.add(mesh.position);
          targetCount++;
        }
        if (targetCount > 0) _triggerAnimPivot.multiplyScalar(1 / targetCount);
        for (const mesh of st.targets) {
          if (!basePositions.has(mesh)) continue;
          _triggerAnimOffset.copy(mesh.position).sub(_triggerAnimPivot).applyQuaternion(_triggerRotateQuat);
          mesh.position.copy(_triggerAnimPivot).add(_triggerAnimOffset);
          mesh.quaternion.premultiply(_triggerRotateQuat);
        }
      } else {
        for (const mesh of st.targets) {
          if (!basePositions.has(mesh)) continue;
          mesh.quaternion.multiply(_triggerRotateQuat);
        }
      }
      continue;
    }

    if (Number.isFinite(st.pausedAt)) {
      st.startedAt += Math.max(0, nowSeconds - st.pausedAt);
      st.pausedAt = null;
    }

    const { rawT, easedT } = getActionAnimationProgress(st, nowSeconds);
    st.currentRotation.copy(st.fromRotation).lerp(st.toRotation, easedT);

    if (st.repeat) {
      const elapsed = Math.max(0, nowSeconds - st.startedAt);
      st.currentRotation.x += st.rpm.x * 6 * elapsed;
      st.currentRotation.y += st.rpm.y * 6 * elapsed;
      st.currentRotation.z += st.rpm.z * 6 * elapsed;
    }

    applyRotateVectorToQuaternion(st.currentRotation, _triggerRotateQuat);
    const rotateTogether = st.groupMode === 'together' && st.targets.length > 1;

    if (rotateTogether) {
      _triggerAnimPivot.set(0, 0, 0);
      let targetCount = 0;
      for (const mesh of st.targets) {
        if (!basePositions.has(mesh)) continue;
        _triggerAnimPivot.add(mesh.position);
        targetCount++;
      }
      if (targetCount > 0) _triggerAnimPivot.multiplyScalar(1 / targetCount);

      for (const mesh of st.targets) {
        if (!basePositions.has(mesh)) continue;
        _triggerAnimOffset.copy(mesh.position).sub(_triggerAnimPivot).applyQuaternion(_triggerRotateQuat);
        mesh.position.copy(_triggerAnimPivot).add(_triggerAnimOffset);
        mesh.quaternion.premultiply(_triggerRotateQuat);
      }
    } else {
      for (const mesh of st.targets) {
        if (!basePositions.has(mesh)) continue;
        mesh.quaternion.multiply(_triggerRotateQuat);
      }
    }

    if (rawT >= 1 && !st.repeat && st.toRotation.lengthSq() === 0) {
      rotateStateMap.delete(key);
    }

    if (rawT >= 1 && st.functionName && !st.functionMarked) {
      markControlFunctionMet(st.functionName, st.callerUuid ? sceneObjects.find(m => m.uuid === st.callerUuid) ?? null : null);
      st.functionMarked = true;
      anyFunctionJustCompleted = true;
    }
  }

  return anyFunctionJustCompleted;
}

function ensureSimLightState(mesh) {
  if (!_simLightStates.has(mesh)) {
    _simLightStates.set(mesh, {
      had: !!mesh.userData.pointLight,
      intensity: mesh.userData.pointLight?.intensity ?? null,
      distance: mesh.userData.pointLight?.distance ?? null,
    });
  }
}

function simulateFunction(fnIdx) {
  const fn = controlFunctions[fnIdx];
  if (!fn || !fn.name) return;
  _simActive = true;
  const nowSeconds = performance.now() / 1000;

  for (let i = 0; i < fn.actions.length; i++) {
    const action = normalizeFunctionAction(fn.actions[i]);
    if (!action.refValue) continue;
    const targets = triggerMoveTargets(action.refType, action.refValue);

    if (action.actionType === 'move') {
      ensureSimBasePositions(targets);
      const stateKey = `sim:${fn.name}:${i}`;
      clearConflictingMoveStates(stateKey, targets, { includeSim: true });
      const fromOffset = new THREE.Vector3(action.startOffset[0], action.startOffset[1], action.startOffset[2]);
      _triggerMoveStates.set(stateKey, {
        callerUuid: null,
        targets,
        fromOffset,
        toOffset: new THREE.Vector3(action.offset[0], action.offset[1], action.offset[2]),
        currentOffset: fromOffset.clone(),
        startedAt: nowSeconds,
        duration: action.duration,
        style: action.style,
        functionName: fn.name,
        functionMarked: false,
      });
    } else if (action.actionType === 'rotate') {
      ensureSimBasePositions(targets);
      ensureSimBaseRotations(targets);
      const stateKey = `sim:${fn.name}:${i}`;
      clearConflictingMoveStates(stateKey, targets, { includeSim: true, stateMap: _triggerRotateStates });
      _triggerRotateStates.set(stateKey, {
        callerUuid: null,
        targets,
        fromRotation: new THREE.Vector3(action.rotateStartOffset[0], action.rotateStartOffset[1], action.rotateStartOffset[2]),
        toRotation: new THREE.Vector3(action.rotateOffset[0], action.rotateOffset[1], action.rotateOffset[2]),
        currentRotation: new THREE.Vector3(action.rotateStartOffset[0], action.rotateStartOffset[1], action.rotateStartOffset[2]),
        rpm: new THREE.Vector3(action.rotateRpm[0], action.rotateRpm[1], action.rotateRpm[2]),
        repeat: action.rotateRepeat,
        groupMode: action.rotateGroupMode,
        startedAt: nowSeconds,
        duration: action.duration,
        style: action.style,
        functionName: fn.name,
        functionMarked: false,
      });
    } else if (action.actionType === 'light') {
      for (const target of targets) {
        ensureSimLightState(target);
        applyLightActionToMesh(target, action.lightOp, action.lightValue);
      }
    } else if (action.actionType === 'playerGroup') {
      applyPlayerGroupAction(action);
    }
  }
  refreshControlFunctionsUI();
}

function resetSimulation() {
  // Restore positions
  for (const [mesh, basePos] of _simBasePositions) {
    mesh.position.copy(basePos);
  }
  _simBasePositions.clear();

  // Restore rotations
  for (const [mesh, baseQuat] of _simBaseRotations) {
    mesh.quaternion.copy(baseQuat);
  }
  _simBaseRotations.clear();

  // Restore light states
  for (const [mesh, saved] of _simLightStates) {
    if (saved.had) {
      if (!mesh.userData.pointLight) addLightToMesh(mesh, saved.intensity, saved.distance);
      else {
        setMeshLightIntensity(mesh, saved.intensity);
        setMeshLightDistance(mesh, saved.distance);
      }
    } else {
      if (mesh.userData.pointLight) removeLightFromMesh(mesh);
    }
  }
  _simLightStates.clear();

  // Clear sim-related move states
  for (const [key] of [..._triggerMoveStates]) {
    if (key.startsWith('sim:')) _triggerMoveStates.delete(key);
  }
  for (const [key] of [..._triggerRotateStates]) {
    if (key.startsWith('sim:')) _triggerRotateStates.delete(key);
  }
  _simActive = false;
  refreshControlFunctionsUI();
}

function updateSimAnimations(nowSeconds) {
  applyAnimatedTransforms(
    _simBasePositions,
    _simBaseRotations,
    _triggerMoveStates,
    _triggerRotateStates,
    nowSeconds,
    { keyFilter: key => key.startsWith('sim:') }
  );

  // Update position readouts in UI
  if (controlFunctionsListEl) {
    controlFunctionsListEl.querySelectorAll('.cfn-pos-readout').forEach(el => {
      const fnIdx = parseInt(el.dataset.fn, 10);
      const actIdx = parseInt(el.dataset.act, 10);
      const fn = controlFunctions[fnIdx];
      if (!fn) return;
      const action = normalizeFunctionAction(fn.actions[actIdx]);
      if (!action.refValue || action.actionType !== 'move') { el.textContent = ''; return; }
      const targets = triggerMoveTargets(action.refType, action.refValue);
      if (!targets.length) { el.textContent = ''; return; }
      const posStrs = targets.slice(0, 3).map(m => {
        const p = m.position;
        return `${r3(p.x)}, ${r3(p.y)}, ${r3(p.z)}`;
      });
      el.textContent = '\u2192 ' + posStrs.join(' | ') + (targets.length > 3 ? ` +${targets.length - 3}` : '');
    });
  }

  // Auto-stop when all sim animations are done
  let anySimRunning = false;
  for (const stateMap of [_triggerMoveStates, _triggerRotateStates]) {
    for (const [key] of stateMap) {
      if (key.startsWith('sim:')) { anySimRunning = true; break; }
    }
    if (anySimRunning) break;
  }
  if (!anySimRunning && _simLightStates.size === 0) {
    // Keep positions as-is (final state) but mark inactive
    _simActive = false;
  }
}
const _tractionCarry = new THREE.Vector3();
const _tractionLocalPoint = new THREE.Vector3();
const _tractionWorldPoint = new THREE.Vector3();
const _tractionPrevQuat = new THREE.Quaternion();
let fpsDevView = false;
let activeCheckpointMeshUuid = null;
const _activeTouchCheckpoints = new Set();
const _movementPathStates = new Map();
let _pendingPathCheckpointPick = null;
let _selectedPathPreviewLine = null;
const _selectedPathPreviewMarkers = [];
const _activeAudioInstances = new Map();
const _audioHandlesByAction = new Map();
const _pausedFunctionKeys = new Set();
let _nextAudioInstanceId = 1;
const _pathPreviewTarget = new THREE.Vector3();
const _pathPreviewDelta = new THREE.Vector3();

function getPlayHintBaseHtml() {
  if (runtimeMode) {
    return 'WASD · Move &nbsp;│&nbsp; R · Sprint &nbsp;│&nbsp; Space · Jump &nbsp;│&nbsp; Mouse · Look &nbsp;│&nbsp; LMB · Shoot &nbsp;│&nbsp; P · Pause';
  }
  return 'WASD · Move &nbsp;│&nbsp; R · Sprint &nbsp;│&nbsp; Space · Jump &nbsp;│&nbsp; Mouse · Look &nbsp;│&nbsp; LMB · Shoot &nbsp;│&nbsp; Esc · Exit';
}

function updatePlayHint() {
  if (!playHint) return;
  if (runtimeMode) {
    playHint.innerHTML = getPlayHintBaseHtml();
    return;
  }
  playHint.innerHTML = `${getPlayHintBaseHtml()} &nbsp;│&nbsp; V · Dev View (${fpsDevView ? 'ON' : 'OFF'})`;
}

function setPlaytestDevView(enabled) {
  fpsDevView = !!enabled;
  for (const m of sceneObjects) {
    if (!m.userData._playtestHidden) continue;
    if (m.userData._customSkinActive) {
      if (m.material) m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = fpsDevView;
    } else if (m.material) {
      m.material.visible = fpsDevView;
    }
  }
  updatePlayHint();
  refreshStatus();
}

// ─── Physics helpers ─────────────────────────────────────────────────────────
// Each entry is one gameplay collider. Grouped solids share one collider,
// ungrouped solids each get their own collider.
let _solidColliders = [];
const _physRay      = new THREE.Raycaster();
const _downDir      = new THREE.Vector3(0, -1, 0);
const _upDir        = new THREE.Vector3(0, 1, 0);
const _physOrigin   = new THREE.Vector3();
const _solidAABB    = new THREE.Box3();
const _tmpAABB      = new THREE.Box3();
const _playerAABB   = new THREE.Box3();
const _stepMove     = new THREE.Vector3();
const _stepDelta    = new THREE.Vector3();
const _bodyDirs      = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0.7071, 0, 0.7071),
  new THREE.Vector3(-0.7071, 0, 0.7071),
  new THREE.Vector3(0.7071, 0, -0.7071),
  new THREE.Vector3(-0.7071, 0, -0.7071),
];
const _bodyRayDir = new THREE.Vector3();

function setPlayerAABB(out, pos, playerHeight = gameRules.height) {
  out.min.set(pos.x - PLAYER_RADIUS, pos.y, pos.z - PLAYER_RADIUS);
  out.max.set(pos.x + PLAYER_RADIUS, pos.y + playerHeight, pos.z + PLAYER_RADIUS);
  return out;
}

function colliderIgnored(collider, ignoreMeshes = null) {
  if (!ignoreMeshes?.size) return false;
  return collider.members.every(mesh => ignoreMeshes.has(mesh));
}

function buildCollisionIgnoreSet(mesh) {
  const ignore = new Set();
  if (!mesh) return ignore;
  const gid = mesh.userData.editorGroupId;
  if (gid) {
    for (const member of sceneObjects) {
      if (member.userData.editorGroupId === gid) ignore.add(member);
    }
    return ignore;
  }
  ignore.add(mesh);
  return ignore;
}

function isSolidMesh(mesh) {
  return Boolean(mesh.userData.solid) &&
    clampMeshSolidness(mesh.userData.solidness ?? 1) > 0.01 &&
    clampMeshOpacity(mesh.userData.opacity ?? 1) > 0.03;
}

function getMeshCollisionMode(mesh) {
  return mesh?.userData?.collisionMode === 'geometry' ? 'geometry' : 'aabb';
}

function refreshSolids() {
  _solidColliders.length = 0;
  for (const m of sceneObjects) {
    if (!isSolidMesh(m)) continue;
    computeMeshCollisionAABB(m, _solidAABB);
    _solidColliders.push({ members: [m], aabb: _solidAABB.clone() });
  }
}

function colliderIntersectsBody(collider, pos, bodyBottom, bodyTop) {
  const heights = [
    bodyBottom + 0.05,
    (bodyBottom + bodyTop) * 0.5,
    bodyTop - 0.05,
  ];
  const rayDist = PLAYER_RADIUS + 0.08;

  for (const y of heights) {
    for (const dir of _bodyDirs) {
      _physOrigin.set(
        pos.x + dir.x * rayDist,
        y,
        pos.z + dir.z * rayDist,
      );
      _bodyRayDir.copy(dir).multiplyScalar(-1);
      _physRay.set(_physOrigin, _bodyRayDir);
      _physRay.near = 0;
      _physRay.far = rayDist;
      const hits = _physRay.intersectObjects(collider.members, false);
      if (hits.length > 0) return true;
    }
  }

  return false;
}

function colliderIntersectsPlayerGeometry(collider, pos, bodyBottom, bodyTop) {
  if (colliderIntersectsBody(collider, pos, bodyBottom, bodyTop)) return true;

  const sampleXZ = [
    [0, 0],
    [ PLAYER_RADIUS * 0.7, 0],
    [-PLAYER_RADIUS * 0.7, 0],
    [0,  PLAYER_RADIUS * 0.7],
    [0, -PLAYER_RADIUS * 0.7],
  ];
  const rayHeight = Math.max(0.05, bodyTop - bodyBottom + 0.04);

  for (const [ox, oz] of sampleXZ) {
    _physOrigin.set(pos.x + ox, bodyBottom + 0.02, pos.z + oz);
    _physRay.set(_physOrigin, _upDir);
    _physRay.near = 0;
    _physRay.far = rayHeight;
    if (_physRay.intersectObjects(collider.members, false).length > 0) return true;

    _physOrigin.set(pos.x + ox, bodyTop - 0.02, pos.z + oz);
    _physRay.set(_physOrigin, _downDir);
    _physRay.near = 0;
    _physRay.far = rayHeight;
    if (_physRay.intersectObjects(collider.members, false).length > 0) return true;
  }

  return false;
}

/**
 * Simple full-body AABB collision.
 * Player box: feet at pos.y, head at pos.y + playerHeight.
 * Returns true if player box overlaps any solid mesh's world AABB.
 */
function collidesAt(pos, playerHeight, ignoreMeshes = null) {
  const pH = playerHeight ?? gameRules.height;
  for (const c of _solidColliders) {
    if (colliderIgnored(c, ignoreMeshes)) continue;
    const aabb = c.aabb;
    // Check all 3 axes overlap
    if (pos.x + PLAYER_RADIUS <= aabb.min.x) continue;
    if (pos.x - PLAYER_RADIUS >= aabb.max.x) continue;
    if (pos.z + PLAYER_RADIUS <= aabb.min.z) continue;
    if (pos.z - PLAYER_RADIUS >= aabb.max.z) continue;
    if (pos.y + pH <= aabb.min.y) continue;  // player entirely below block
    if (pos.y >= aabb.max.y) continue;       // player entirely above block

    if (getMeshCollisionMode(c.members[0]) !== 'geometry') return true;
    if (colliderIntersectsPlayerGeometry(c, pos, pos.y, pos.y + pH)) return true;
  }
  return false;
}

/**
 * Check only horizontal + body-above-step collision (for walk movement).
 * Ignores the bottom STEP_HEIGHT of the player so small ledges don't block.
 */
function collidesWalk(pos, ignoreMeshes = null) {
  const bodyBot = pos.y + (fpsGrounded ? STEP_HEIGHT : 0.02);
  const bodyTop = pos.y + gameRules.height;
  for (const c of _solidColliders) {
    if (colliderIgnored(c, ignoreMeshes)) continue;
    const aabb = c.aabb;
    if (pos.x + PLAYER_RADIUS <= aabb.min.x) continue;
    if (pos.x - PLAYER_RADIUS >= aabb.max.x) continue;
    if (pos.z + PLAYER_RADIUS <= aabb.min.z) continue;
    if (pos.z - PLAYER_RADIUS >= aabb.max.z) continue;
    if (bodyTop <= aabb.min.y) continue;
    if (bodyBot >= aabb.max.y) continue;

    if (getMeshCollisionMode(c.members[0]) !== 'geometry') return true;
    if (colliderIntersectsPlayerGeometry(c, pos, bodyBot, bodyTop)) return true;
  }
  return false;
}

/** Raycast-based ground detection — works with rotated meshes / slopes. */
function findGroundHeight(pos) {
  let ground = 0;
  if (!_solidColliders.length) return ground;
  const offsets = [[0,0],[PLAYER_RADIUS*.7,0],[-PLAYER_RADIUS*.7,0],[0,PLAYER_RADIUS*.7],[0,-PLAYER_RADIUS*.7]];
  for (const [ox, oz] of offsets) {
    _physOrigin.set(pos.x + ox, pos.y + STEP_HEIGHT + 1, pos.z + oz);
    _physRay.set(_physOrigin, _downDir);
    _physRay.far  = Infinity;
    _physRay.near = 0;

    for (const c of _solidColliders) {
      const aabb = c.aabb;
      if (_physOrigin.x < aabb.min.x - PLAYER_RADIUS || _physOrigin.x > aabb.max.x + PLAYER_RADIUS) continue;
      if (_physOrigin.z < aabb.min.z - PLAYER_RADIUS || _physOrigin.z > aabb.max.z + PLAYER_RADIUS) continue;
      if (_physOrigin.y < aabb.min.y) continue;

      if (getMeshCollisionMode(c.members[0]) !== 'geometry') {
        if (_physOrigin.x >= aabb.min.x && _physOrigin.x <= aabb.max.x &&
            _physOrigin.z >= aabb.min.z && _physOrigin.z <= aabb.max.z &&
            aabb.max.y <= pos.y + STEP_HEIGHT + 0.01) {
          ground = Math.max(ground, aabb.max.y);
        }
        continue;
      }

      const hits = _physRay.intersectObjects(c.members, false);
      for (const h of hits) {
        if (h.point.y <= pos.y + STEP_HEIGHT + 0.01) {
          ground = Math.max(ground, h.point.y);
          break;
        }
      }
    }
  }
  return ground;
}

function movePlayerHorizontal(delta, ignoreMeshes = null) {
  if (delta.lengthSq() <= 1e-10) return;

  const distance = delta.length();
  const steps = Math.max(1, Math.ceil(distance / COLLISION_SUBSTEP));
  _stepDelta.copy(delta).multiplyScalar(1 / steps);

  for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
    _stepMove.copy(fpsPos);
    _stepMove.x += _stepDelta.x;
    _stepMove.z += _stepDelta.z;
    if (fpsGrounded) {
      const g = findGroundHeight(_stepMove);
      if (g > _stepMove.y && g <= _stepMove.y + STEP_HEIGHT) _stepMove.y = g;
    }
    if (!collidesWalk(_stepMove, ignoreMeshes)) {
      if (fpsGrounded && _stepMove.y > fpsPos.y) fpsVelY = 0;
      fpsPos.copy(_stepMove);
      continue;
    }

    if (_stepDelta.x !== 0) {
      _stepMove.copy(fpsPos);
      _stepMove.x += _stepDelta.x;
      if (fpsGrounded) {
        const g = findGroundHeight(_stepMove);
        if (g > _stepMove.y && g <= _stepMove.y + STEP_HEIGHT) _stepMove.y = g;
      }
      if (!collidesWalk(_stepMove, ignoreMeshes)) {
        if (fpsGrounded && _stepMove.y > fpsPos.y) fpsVelY = 0;
        fpsPos.copy(_stepMove);
      }
    }

    if (_stepDelta.z !== 0) {
      _stepMove.copy(fpsPos);
      _stepMove.z += _stepDelta.z;
      if (fpsGrounded) {
        const g = findGroundHeight(_stepMove);
        if (g > _stepMove.y && g <= _stepMove.y + STEP_HEIGHT) _stepMove.y = g;
      }
      if (!collidesWalk(_stepMove, ignoreMeshes)) {
        if (fpsGrounded && _stepMove.y > fpsPos.y) fpsVelY = 0;
        fpsPos.copy(_stepMove);
      }
    }
  }
}

function movePlayerVertical(deltaY, ignoreMeshes = null) {
  if (Math.abs(deltaY) <= 1e-10) return;
  const steps = Math.max(1, Math.ceil(Math.abs(deltaY) / COLLISION_SUBSTEP));
  const stepY = deltaY / steps;

  for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
    _stepMove.copy(fpsPos);
    _stepMove.y = Math.max(0, _stepMove.y + stepY);
    if (!collidesAt(_stepMove, gameRules.height, ignoreMeshes)) {
      fpsPos.copy(_stepMove);
    } else {
      break;
    }
  }
}

function resolveMovingSolidPushes() {
  const supportMeshes = new Set();
  const supportGroupIds = new Set();
  const currentSupport = getTractionSupportMesh();
  const previousSupport = getTractionSupportMeshFromPreviousFrame();
  if (currentSupport) {
    supportMeshes.add(currentSupport);
    if (currentSupport.userData.editorGroupId) supportGroupIds.add(currentSupport.userData.editorGroupId);
  }
  if (previousSupport) {
    supportMeshes.add(previousSupport);
    if (previousSupport.userData.editorGroupId) supportGroupIds.add(previousSupport.userData.editorGroupId);
  }

  for (const mesh of sceneObjects) {
    if (!isSolidMesh(mesh)) continue;
    if (mesh.userData._playtestHidden || !mesh.visible) continue;
    if (supportMeshes.has(mesh)) continue;
    if (mesh.userData.editorGroupId && supportGroupIds.has(mesh.userData.editorGroupId)) continue;

    const prevPos = _playtestPrevPositions.get(mesh);
    const prevAABB = _playtestPrevAABBs.get(mesh);
    if (!prevPos || !prevAABB) continue;

    _stepDelta.subVectors(mesh.position, prevPos);
    if (_stepDelta.lengthSq() <= 1e-10) continue;

    const ignoreMeshes = buildCollisionIgnoreSet(mesh);
    const steps = Math.max(1, Math.ceil(_stepDelta.length() / COLLISION_SUBSTEP));
    const stepVec = _stepDelta.clone().multiplyScalar(1 / steps);
    const steppedAABB = prevAABB.clone();

    for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
      steppedAABB.translate(stepVec);
      setPlayerAABB(_playerAABB, fpsPos);
      if (!_playerAABB.intersectsBox(steppedAABB)) continue;

      movePlayerHorizontal(new THREE.Vector3(stepVec.x, 0, stepVec.z), ignoreMeshes);
      movePlayerVertical(stepVec.y, ignoreMeshes);

      setPlayerAABB(_playerAABB, fpsPos);
      if (_playerAABB.intersectsBox(steppedAABB)) {
        const escape = new THREE.Vector3();
        if (stepVec.x !== 0) escape.x = stepVec.x > 0 ? (steppedAABB.max.x - _playerAABB.min.x) : (steppedAABB.min.x - _playerAABB.max.x);
        if (stepVec.z !== 0) escape.z = stepVec.z > 0 ? (steppedAABB.max.z - _playerAABB.min.z) : (steppedAABB.min.z - _playerAABB.max.z);
        if (stepVec.y !== 0) escape.y = stepVec.y > 0 ? (steppedAABB.max.y - _playerAABB.min.y) : (steppedAABB.min.y - _playerAABB.max.y);
        movePlayerHorizontal(new THREE.Vector3(escape.x, 0, escape.z), ignoreMeshes);
        movePlayerVertical(escape.y, ignoreMeshes);
      }
    }
  }
}

function getTractionSupportMesh() {
  if (!fpsGrounded) return null;

  const offsets = [[0,0],[PLAYER_RADIUS*.7,0],[-PLAYER_RADIUS*.7,0],[0,PLAYER_RADIUS*.7],[0,-PLAYER_RADIUS*.7]];
  let bestMesh = null;
  let bestY = -Infinity;
  const maxDrop = Math.max(0.2, STEP_HEIGHT + 0.12);

  for (const [ox, oz] of offsets) {
    _physOrigin.set(fpsPos.x + ox, fpsPos.y + STEP_HEIGHT + 1, fpsPos.z + oz);
    _physRay.set(_physOrigin, _downDir);
    _physRay.far = gameRules.height + STEP_HEIGHT + 2;
    _physRay.near = 0;

    const hits = _physRay.intersectObjects(sceneObjects, false);
    for (const hit of hits) {
      const mesh = hit.object;
      if (!mesh.userData.solid || !mesh.userData.traction || mesh.userData._playtestHidden || !mesh.visible) continue;
      if (getMeshCollisionMode(mesh) !== 'geometry') continue;
      if (hit.point.y > fpsPos.y + 0.05) continue;
      if (fpsPos.y - hit.point.y > maxDrop) continue;
      if (hit.point.y > bestY) {
        bestY = hit.point.y;
        bestMesh = mesh;
      }
    }

    for (const mesh of sceneObjects) {
      if (!mesh.userData.solid || !mesh.userData.traction || mesh.userData._playtestHidden || !mesh.visible) continue;
      if (getMeshCollisionMode(mesh) === 'geometry') continue;
      _tmpAABB.setFromObject(mesh);
      if (_physOrigin.x < _tmpAABB.min.x || _physOrigin.x > _tmpAABB.max.x) continue;
      if (_physOrigin.z < _tmpAABB.min.z || _physOrigin.z > _tmpAABB.max.z) continue;
      if (_physOrigin.y < _tmpAABB.max.y) continue;
      if (_tmpAABB.max.y > fpsPos.y + 0.05) continue;
      if (fpsPos.y - _tmpAABB.max.y > maxDrop) continue;
      if (_tmpAABB.max.y > bestY) {
        bestY = _tmpAABB.max.y;
        bestMesh = mesh;
      }
    }
  }

  return bestMesh;
}

function getTractionSupportMeshFromPreviousFrame() {
  if (!fpsGrounded) return null;

  let bestMesh = null;
  let bestY = -Infinity;
  const maxDrop = Math.max(0.25, STEP_HEIGHT + 0.16);

  for (const mesh of sceneObjects) {
    if (!mesh.userData.solid || !mesh.userData.traction || mesh.userData._playtestHidden || !mesh.visible) continue;
    const prevAabb = _playtestPrevAABBs.get(mesh);
    if (!prevAabb) continue;

    const topY = prevAabb.max.y;
    if (fpsPos.y + 0.05 < topY) continue;
    if (fpsPos.y - topY > maxDrop) continue;
    if (fpsPos.x + PLAYER_RADIUS <= prevAabb.min.x) continue;
    if (fpsPos.x - PLAYER_RADIUS >= prevAabb.max.x) continue;
    if (fpsPos.z + PLAYER_RADIUS <= prevAabb.min.z) continue;
    if (fpsPos.z - PLAYER_RADIUS >= prevAabb.max.z) continue;

    if (topY > bestY) {
      bestY = topY;
      bestMesh = mesh;
    }
  }

  return bestMesh;
}

function applyTractionCarry() {
  const supportMesh = getTractionSupportMesh() || getTractionSupportMeshFromPreviousFrame();
  if (!supportMesh) return;

  const prevPos = _playtestPrevPositions.get(supportMesh);
  const prevQuat = _playtestPrevRotations.get(supportMesh);
  if (!prevPos) return;

  if (prevQuat) {
    _tractionPrevQuat.copy(prevQuat).invert();
    _tractionLocalPoint.copy(fpsPos).sub(prevPos).applyQuaternion(_tractionPrevQuat);
    _tractionWorldPoint.copy(_tractionLocalPoint).applyQuaternion(supportMesh.quaternion).add(supportMesh.position);
    _tractionCarry.subVectors(_tractionWorldPoint, fpsPos);
  } else {
    _tractionCarry.set(
      supportMesh.position.x - prevPos.x,
      0,
      supportMesh.position.z - prevPos.z,
    );
  }

  _tractionCarry.y = 0;
  if (_tractionCarry.lengthSq() <= 1e-8) return;

  _next.copy(fpsPos).add(_tractionCarry);
  if (fpsGrounded) {
    const g = findGroundHeight(_next);
    if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
  }
  if (!collidesWalk(_next)) {
    if (fpsGrounded && _next.y > fpsPos.y) fpsVelY = 0;
    fpsPos.copy(_next);
    return;
  }

  if (_tractionCarry.x !== 0) {
    _next.copy(fpsPos);
    _next.x += _tractionCarry.x;
    if (fpsGrounded) {
      const g = findGroundHeight(_next);
      if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
    }
    if (!collidesWalk(_next)) {
      if (fpsGrounded && _next.y > fpsPos.y) fpsVelY = 0;
      fpsPos.copy(_next);
    }
  }
  if (_tractionCarry.z !== 0) {
    _next.copy(fpsPos);
    _next.z += _tractionCarry.z;
    if (fpsGrounded) {
      const g = findGroundHeight(_next);
      if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
    }
    if (!collidesWalk(_next)) {
      if (fpsGrounded && _next.y > fpsPos.y) fpsVelY = 0;
      fpsPos.copy(_next);
    }
  }
}

function syncFpsCamera() {
  fpsCam.position.set(fpsPos.x, fpsPos.y + gameRules.eyeHeight, fpsPos.z);
  fpsCam.rotation.order = 'YXZ';
  fpsCam.rotation.y = fpsYaw;
  fpsCam.rotation.x = fpsPitch;
}

function startJump() {
  if (!gameRules.gravityEnabled) return;
  if (!fpsGrounded) return;
  fpsVelY = gameRules.jumpHeight;
  fpsGrounded = false;
}

function updateHealthHud() {
  const pct = Math.max(0, fpsHealth / gameRules.maxHealth * 100);
  healthBarFill.style.width = pct + '%';
  healthText.textContent = Math.ceil(fpsHealth);
  // Color shift: green at full, yellow midway, red at low
  if (pct > 60) healthBarFill.style.background = 'linear-gradient(90deg,#40c040,#60e060)';
  else if (pct > 25) healthBarFill.style.background = 'linear-gradient(90deg,#c0a030,#e0c040)';
  else healthBarFill.style.background = 'linear-gradient(90deg,#e04040,#f06060)';
}

function getSpawnBlockState() {
  const allSpawns = sceneObjects.filter(m => m.userData.type === 'spawn');
  if (!allSpawns.length) return null;

  const matchingSpawns = allSpawns.filter(meshMatchesPlayerGroups);
  const spawn = matchingSpawns[0] || allSpawns[0];
  if (!spawn) return null;

  _spawnAABB.setFromObject(spawn);
  const center = spawn.getWorldPosition(new THREE.Vector3());
  const basePos = new THREE.Vector3(center.x, _spawnAABB.max.y + 0.05, center.z);
  const ignoreMeshes = buildCollisionIgnoreSet(spawn);
  const spawnPos = resolveSpawnPosition(basePos, ignoreMeshes);
  return {
    pos: spawnPos,
    yaw: spawn.rotation.y,
    pitch: 0,
  };
}

function resolveSpawnPosition(startPos, ignoreMeshes = null) {
  const pos = startPos.clone();
  pos.y = Math.max(0, pos.y);
  if (!collidesAt(pos, gameRules.height, ignoreMeshes)) return pos;

  // Step upward to keep the feet position outside solid geometry.
  const maxSteps = 200;
  const stepSize = 0.1;
  for (let i = 0; i < maxSteps; i++) {
    pos.y += stepSize;
    if (!collidesAt(pos, gameRules.height, ignoreMeshes)) return pos;
  }

  return pos;
}

function getFallbackSpawnState() {
  const viewDir = editorCam.getWorldDirection(new THREE.Vector3());
  const pos = editorCam.position.clone();
  pos.y = Math.max(0, editorCam.position.y - gameRules.eyeHeight);
  return {
    pos,
    yaw: Math.atan2(-viewDir.x, -viewDir.z),
    pitch: Math.asin(THREE.MathUtils.clamp(viewDir.y, -1, 1)),
  };
}

function applySpawnState(spawnState) {
  fpsPos.copy(spawnState.pos);
  fpsYaw = spawnState.yaw;
  fpsPitch = spawnState.pitch;
}

function getCheckpointSpawnState(mesh) {
  if (!mesh || mesh.userData.type !== 'checkpoint') return null;
  _checkpointAABB.setFromObject(mesh);
  const center = mesh.getWorldPosition(new THREE.Vector3());
  const basePos = new THREE.Vector3(center.x, _checkpointAABB.max.y + 0.05, center.z);
  const ignoreMeshes = buildCollisionIgnoreSet(mesh);
  const spawnPos = resolveSpawnPosition(basePos, ignoreMeshes);
  return {
    pos: spawnPos,
    yaw: mesh.rotation.y,
    pitch: 0,
  };
}

function getActiveCheckpointMesh() {
  if (!activeCheckpointMeshUuid) return null;
  const mesh = sceneObjects.find(m => m.uuid === activeCheckpointMeshUuid) || null;
  if (!mesh || mesh.userData.type !== 'checkpoint') return null;
  return mesh;
}

function resetActiveCheckpointToWorldSpawn(options = {}) {
  activeCheckpointMeshUuid = null;
  _activeTouchCheckpoints.clear();

  const spawnState = getSpawnBlockState() ?? getFallbackSpawnState();
  fpsSpawnPos.copy(spawnState.pos);
  fpsSpawnYaw = spawnState.yaw;
  fpsSpawnPitch = spawnState.pitch;

  if (options.respawnNow && state.isPlaytest) {
    respawnPlayer();
  }

  refreshStatus();
  return spawnState;
}

function getPlayerGroupSet() {
  const set = new Set();
  for (const group of normalizeGroupListValue(playerProfile.groups)) {
    const key = normalizeTouchRef(group);
    if (key) set.add(key);
  }
  if (!set.size) set.add('default');
  return set;
}

function meshMatchesPlayerGroups(mesh) {
  if (!mesh) return false;
  const playerGroups = getPlayerGroupSet();
  for (const group of getMeshGroups(mesh)) {
    const key = normalizeTouchRef(group);
    if (key && playerGroups.has(key)) return true;
  }
  return false;
}

function activateCheckpoint(mesh) {
  if (!mesh || mesh.userData.type !== 'checkpoint') return false;
  if (!meshMatchesPlayerGroups(mesh)) return false;

  const spawnState = getCheckpointSpawnState(mesh);
  if (!spawnState) return false;

  activeCheckpointMeshUuid = mesh.uuid;
  fpsSpawnPos.copy(spawnState.pos);
  fpsSpawnYaw = spawnState.yaw;
  fpsSpawnPitch = spawnState.pitch;
  return true;
}

function ensureCheckpointIndicator(mesh) {
  if (!mesh || mesh.userData.type !== 'checkpoint') return null;
  if (mesh.userData.checkpointIndicator) return mesh.userData.checkpointIndicator;

  const indicator = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.04, 8, 24),
    new THREE.MeshBasicMaterial({
      color: 0x3cb8ff,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
    })
  );
  indicator.rotation.x = Math.PI / 2;
  indicator.position.set(0, 0.74, 0);
  indicator.renderOrder = 30;
  indicator.visible = false;
  mesh.add(indicator);
  mesh.userData.checkpointIndicator = indicator;
  return indicator;
}

function updateCheckpointIndicators(nowSeconds) {
  const pulse = 0.5 + 0.5 * Math.sin(nowSeconds * 5.2);
  for (const mesh of sceneObjects) {
    if (mesh.userData.type !== 'checkpoint') continue;
    const indicator = ensureCheckpointIndicator(mesh);
    if (!indicator) continue;

    if (!state.isPlaytest) {
      indicator.visible = false;
      continue;
    }

    const isActive = mesh.uuid === activeCheckpointMeshUuid;
    const isTouching = _activeTouchCheckpoints.has(mesh);
    indicator.visible = true;

    if (isActive) {
      indicator.material.color.setHex(0x4ce06d);
      indicator.material.opacity = 0.95;
      const s = 1.05 + pulse * 0.2;
      indicator.scale.set(s, s, s);
    } else if (isTouching) {
      indicator.material.color.setHex(0xffd166);
      indicator.material.opacity = 0.8;
      const s = 0.96 + pulse * 0.1;
      indicator.scale.set(s, s, s);
    } else {
      indicator.material.color.setHex(0x3cb8ff);
      indicator.material.opacity = 0.35;
      indicator.scale.set(0.92, 0.92, 0.92);
    }
  }
}

function setControlMoveActionState(stateKey, functionName, action, targetOffset, callerMesh, isActivation) {
  if (!targetOffset) {
    _triggerMoveStates.delete(stateKey);
    return;
  }

  const prev = _triggerMoveStates.get(stateKey);
  const targets = triggerMoveTargets(action.refType, action.refValue);
  if (isActivation) clearConflictingMoveStates(stateKey, targets);
  const fromOffset = isActivation
    ? new THREE.Vector3(action.startOffset[0], action.startOffset[1], action.startOffset[2])
    : (prev ? prev.currentOffset.clone() : new THREE.Vector3());
  _triggerMoveStates.set(stateKey, {
    callerUuid: callerMesh?.uuid ?? null,
    targets,
    fromOffset,
    toOffset: new THREE.Vector3(targetOffset[0], targetOffset[1], targetOffset[2]),
    currentOffset: fromOffset.clone(),
    startedAt: performance.now() / 1000,
    duration: action.duration,
    style: action.style,
    functionName: String(functionName ?? '').trim(),
    functionMarked: false,
  });
}

function setControlRotateActionState(stateKey, functionName, action, targetRotation, callerMesh, isActivation) {
  if (!targetRotation) {
    _triggerRotateStates.delete(stateKey);
    return;
  }

  const prev = _triggerRotateStates.get(stateKey);
  const targets = triggerMoveTargets(action.refType, action.refValue);
  if (isActivation) clearConflictingMoveStates(stateKey, targets, { stateMap: _triggerRotateStates });
  const fromRotation = isActivation
    ? new THREE.Vector3(action.rotateStartOffset[0], action.rotateStartOffset[1], action.rotateStartOffset[2])
    : (prev ? prev.currentRotation.clone() : new THREE.Vector3());
  _triggerRotateStates.set(stateKey, {
    callerUuid: callerMesh?.uuid ?? null,
    targets,
    fromRotation,
    toRotation: new THREE.Vector3(targetRotation[0], targetRotation[1], targetRotation[2]),
    currentRotation: fromRotation.clone(),
    rpm: isActivation
      ? new THREE.Vector3(action.rotateRpm[0], action.rotateRpm[1], action.rotateRpm[2])
      : new THREE.Vector3(),
    repeat: isActivation && action.rotateRepeat === true,
    groupMode: action.rotateGroupMode === 'together' ? 'together' : 'separate',
    startedAt: performance.now() / 1000,
    duration: action.duration,
    style: action.style,
    functionName: String(functionName ?? '').trim(),
    functionMarked: false,
  });
}

function applyLightActionToMesh(mesh, lightOp, lightValue) {
  const op = CONTROL_LIGHT_OPS.includes(lightOp) ? lightOp : 'toggle';
  const safeValue = Number.isFinite(lightValue) ? lightValue : state.defaultLightIntensity;

  if (op === 'toggle') {
    if (mesh.userData.pointLight) removeLightFromMesh(mesh);
    else addLightToMesh(mesh, safeValue, mesh.userData.lightDistance ?? LIGHT_BLOCK_DISTANCE);
    return;
  }

  if (op === 'enable') {
    if (!mesh.userData.pointLight) addLightToMesh(mesh, safeValue, mesh.userData.lightDistance ?? LIGHT_BLOCK_DISTANCE);
    else setMeshLightIntensity(mesh, safeValue);
    return;
  }

  if (op === 'disable') {
    if (mesh.userData.pointLight) removeLightFromMesh(mesh);
    return;
  }

  if (!mesh.userData.pointLight) {
    addLightToMesh(mesh, state.defaultLightIntensity, mesh.userData.lightDistance ?? LIGHT_BLOCK_DISTANCE);
  }

  if (op === 'intensity') {
    setMeshLightIntensity(mesh, safeValue);
    return;
  }

  if (op === 'distance') {
    setMeshLightDistance(mesh, safeValue);
  }
}

function isControlFunctionStopped(functionName) {
  const key = normalizeControlFunctionKey(functionName);
  if (!key) return false;
  return _permanentFunctionStops.has(key) || (_momentaryFunctionStopCounts.get(key) ?? 0) > 0;
}

function clearFunctionRuntimeStates(functionName) {
  const fnKey = normalizeControlFunctionKey(functionName);
  if (!fnKey) return;

  for (const [key, state] of [..._triggerMoveStates]) {
    if (normalizeControlFunctionKey(state?.functionName) === fnKey) _triggerMoveStates.delete(key);
  }
  for (const [key, state] of [..._triggerRotateStates]) {
    if (normalizeControlFunctionKey(state?.functionName) === fnKey) _triggerRotateStates.delete(key);
  }
  for (const [, calls] of _activeTriggerCalls) {
    for (const call of calls) {
      if (normalizeControlFunctionKey(call?.functionName) !== fnKey) continue;
      call.started = false;
      call.runStartedAt = null;
    }
  }
  stopAudioByFunction(functionName);
}

function applyTriggerFunctionStops(triggerMesh, entering) {
  const config = getMeshTriggerStopConfig(triggerMesh);
  if (config.mode === 'none' || !config.functionNames.length) return;

  for (const functionName of config.functionNames) {
    const key = normalizeControlFunctionKey(functionName);
    if (!key) continue;

    if (config.mode === 'permanent') {
      if (!entering) continue;
      _permanentFunctionStops.add(key);
      clearFunctionRuntimeStates(functionName);
      continue;
    }

    if (entering) {
      _momentaryFunctionStopCounts.set(key, (_momentaryFunctionStopCounts.get(key) ?? 0) + 1);
      clearFunctionRuntimeStates(functionName);
    } else {
      const next = (_momentaryFunctionStopCounts.get(key) ?? 0) - 1;
      if (next > 0) _momentaryFunctionStopCounts.set(key, next);
      else _momentaryFunctionStopCounts.delete(key);
    }
  }
}

function clearRuntimeFunctionStops() {
  _momentaryFunctionStopCounts.clear();
  _permanentFunctionStops.clear();
  _pausedFunctionKeys.clear();
}

function getMovementPathState(mesh, create = false) {
  if (!mesh) return null;
  let pathState = _movementPathStates.get(mesh.uuid) || null;
  if (!pathState && create) {
    pathState = { targetIndex: 0, finished: false, active: false, paused: false };
    _movementPathStates.set(mesh.uuid, pathState);
  }
  return pathState;
}

function startMovementPath(mesh, options = {}) {
  const config = getMeshMovementPathConfig(mesh);
  if (!config.enabled || !config.checkpoints.length) return;

  const pathState = getMovementPathState(mesh, true);
  if (options.reset === true || pathState.finished) {
    pathState.targetIndex = 0;
    pathState.finished = false;
  }
  pathState.active = true;
  pathState.paused = false;
}

function pauseMovementPath(mesh) {
  const pathState = getMovementPathState(mesh, false);
  if (!pathState) return;
  pathState.paused = true;
  pathState.active = false;
}

function stopMovementPath(mesh) {
  const pathState = getMovementPathState(mesh, false);
  if (!pathState) return;
  pathState.active = false;
  pathState.paused = false;
}

function resetMovementPath(mesh) {
  if (!mesh) return;
  _movementPathStates.delete(mesh.uuid);
  const basePos = _playtestBasePositions.get(mesh);
  if (state.isPlaytest && basePos) {
    mesh.position.copy(basePos);
  }
}

function applyPathAction(action, active) {
  if (!active) return;

  const targets = triggerMoveTargets(action.refType, action.refValue);
  if (!targets.length) return;

  const command = PATH_CONTROL_COMMANDS.includes(action.pathCommand)
    ? action.pathCommand
    : 'start';

  for (const target of targets) {
    if (command === 'start' || command === 'resume') {
      startMovementPath(target, { reset: false });
    } else if (command === 'pause') {
      pauseMovementPath(target);
    } else if (command === 'stop') {
      stopMovementPath(target);
    } else if (command === 'reset') {
      resetMovementPath(target);
    }
  }
}

function applyPlayerGroupAction(action) {
  const mode = CONTROL_PLAYER_GROUP_MODES.includes(action.playerGroupMode)
    ? action.playerGroupMode
    : 'set';
  const values = parseRawGroupListValue(action.playerGroupValue);
  const current = normalizeGroupListValue(playerProfile.groups);

  if (mode === 'set') {
    playerProfile.groups = normalizeGroupListValue(values);
    refreshPlayerProfileUI();
    return;
  }

  if (!values.length) return;

  if (mode === 'add') {
    playerProfile.groups = normalizeGroupListValue([...current, ...values]);
  } else if (mode === 'remove') {
    const removeSet = new Set(values.map(v => normalizeTouchRef(v)));
    const kept = current.filter(group => !removeSet.has(normalizeTouchRef(group)));
    playerProfile.groups = kept.length ? kept : ['default'];
  } else if (mode === 'random') {
    const idx = Math.floor(Math.random() * values.length);
    playerProfile.groups = [values[Math.max(0, Math.min(values.length - 1, idx))]];
  }

  refreshPlayerProfileUI();
}

function isFunctionPaused(functionName) {
  const key = normalizeControlFunctionKey(functionName);
  if (!key) return false;
  return _pausedFunctionKeys.has(key);
}

function stopAudioInstance(instance) {
  if (!instance) return;
  try {
    instance.audio.pause();
    instance.audio.currentTime = 0;
  } catch {
    // ignore media cleanup errors
  }
  _activeAudioInstances.delete(instance.id);
}

function stopAudioByActionKey(actionKey) {
  const ids = _audioHandlesByAction.get(actionKey);
  if (!ids || !ids.size) return;
  for (const id of [...ids]) {
    const instance = _activeAudioInstances.get(id);
    if (instance) stopAudioInstance(instance);
  }
  _audioHandlesByAction.delete(actionKey);
}

function stopAudioByFunction(functionName) {
  const fnKey = normalizeControlFunctionKey(functionName);
  if (!fnKey) return;
  for (const [id, instance] of [..._activeAudioInstances]) {
    if (normalizeControlFunctionKey(instance.functionName) !== fnKey) continue;
    stopAudioInstance(instance);
  }
  for (const [key, ids] of [..._audioHandlesByAction]) {
    for (const id of [...ids]) {
      if (!_activeAudioInstances.has(id)) ids.delete(id);
    }
    if (!ids.size) _audioHandlesByAction.delete(key);
  }
}

function clearAllRuntimeAudio() {
  for (const instance of _activeAudioInstances.values()) stopAudioInstance(instance);
  _activeAudioInstances.clear();
  _audioHandlesByAction.clear();
}

function updateAudioProximityVolume(instance) {
  if (!instance || instance.mode !== 'proximity') return;
  const listenerPos = state.isPlaytest ? fpsPos : editorCam.position;
  const sourceMesh = sceneObjects.find(m => m.uuid === instance.sourceMeshUuid) || null;
  const sourcePos = sourceMesh ? sourceMesh.position : (instance.callerMeshUuid ? (sceneObjects.find(m => m.uuid === instance.callerMeshUuid)?.position || null) : null);
  if (!sourcePos) {
    instance.audio.volume = 0;
    return;
  }
  const dist = listenerPos.distanceTo(sourcePos);
  const maxDist = Math.max(1, instance.maxDistance || 22);
  const t = THREE.MathUtils.clamp(1 - (dist / maxDist), 0, 1);
  instance.audio.volume = t * t;
}

function updateRuntimeAudioInstances() {
  for (const [id, instance] of [..._activeAudioInstances]) {
    if (!instance || instance.done) {
      _activeAudioInstances.delete(id);
      continue;
    }

    if (instance.untilEvent === 'functionDone') {
      const refName = instance.untilFunctionName || instance.functionName;
      if (refName && isControlFunctionMet(refName)) {
        stopAudioInstance(instance);
        continue;
      }
    }

    if (isFunctionPaused(instance.functionName)) {
      if (!instance.audio.paused) {
        try { instance.audio.pause(); } catch { /* ignore */ }
      }
      continue;
    }

    if (instance.resumeRequested && instance.audio.paused) {
      instance.resumeRequested = false;
      instance.audio.play().catch(() => {});
    }

    updateAudioProximityVolume(instance);
  }

  for (const [key, ids] of [..._audioHandlesByAction]) {
    for (const id of [...ids]) {
      if (!_activeAudioInstances.has(id)) ids.delete(id);
    }
    if (!ids.size) _audioHandlesByAction.delete(key);
  }
}

function executeAudioAction(functionName, actionIndex, action, callerMesh, active) {
  const actionKey = `${normalizeControlFunctionKey(functionName)}:${actionIndex}:${callerMesh?.uuid ?? 'global'}`;
  const until = AUDIO_UNTIL_EVENTS.includes(action.audioUntil) ? action.audioUntil : 'deactivate';

  if (!active) {
    if (until === 'deactivate') stopAudioByActionKey(actionKey);
    return;
  }

  const entry = getAudioLibraryEntryByName(action.audioName);
  if (!entry) return;

  const mode = AUDIO_PLAY_MODES.includes(action.audioMode) ? action.audioMode : 'global';
  const targets = action.refValue ? triggerMoveTargets(action.refType, action.refValue, callerMesh) : (callerMesh ? [callerMesh] : []);
  const emitTargets = targets.length ? targets : [callerMesh].filter(Boolean);
  const maxDistance = clampAudioDistance(action.audioDistance);
  const createdIds = new Set(_audioHandlesByAction.get(actionKey) || []);

  for (const sourceMesh of emitTargets) {
    const audio = new Audio(entry.dataUrl);
    audio.loop = action.audioLoop === true;
    audio.preload = 'auto';
    const instance = {
      id: _nextAudioInstanceId++,
      functionName,
      callerMeshUuid: callerMesh?.uuid ?? null,
      sourceMeshUuid: sourceMesh?.uuid ?? null,
      mode,
      maxDistance,
      untilEvent: until,
      untilFunctionName: String(action.audioUntilFunction ?? '').trim(),
      audio,
      done: false,
      resumeRequested: false,
    };

    audio.addEventListener('ended', () => {
      instance.done = true;
      if (instance.untilEvent === 'audioDone' || !audio.loop) stopAudioInstance(instance);
    });

    if (mode === 'proximity') updateAudioProximityVolume(instance);
    else audio.volume = 1;

    _activeAudioInstances.set(instance.id, instance);
    createdIds.add(instance.id);
    audio.play().catch(() => {
      instance.done = true;
      stopAudioInstance(instance);
    });
  }

  if (createdIds.size) _audioHandlesByAction.set(actionKey, createdIds);
}

function pauseFunctionRuntime(functionName) {
  const key = normalizeControlFunctionKey(functionName);
  if (!key) return;
  _pausedFunctionKeys.add(key);
}

function resumeFunctionRuntime(functionName) {
  const key = normalizeControlFunctionKey(functionName);
  if (!key) return;
  _pausedFunctionKeys.delete(key);
  for (const instance of _activeAudioInstances.values()) {
    if (normalizeControlFunctionKey(instance.functionName) === key) {
      instance.resumeRequested = true;
    }
  }
}

function stopFunctionRuntime(functionName, options = {}) {
  const key = normalizeControlFunctionKey(functionName);
  if (!key) return;
  _pausedFunctionKeys.delete(key);
  clearFunctionRuntimeStates(functionName);
  stopAudioByFunction(functionName);
  if (options.resetState) _controlFunctionStates.delete(key);
}

function applyFunctionControlAction(action, currentFunctionName, callerMesh, active, context = {}) {
  if (!active) return;

  const command = FUNCTION_CONTROL_COMMANDS.includes(action.functionControlCommand)
    ? action.functionControlCommand
    : 'stop';
  const targets = normalizeFunctionNameList(action.functionControlTarget);
  if (!targets.length) return;

  for (const targetName of targets) {
    const targetKey = normalizeControlFunctionKey(targetName);
    const currentKey = normalizeControlFunctionKey(currentFunctionName);

    if (command === 'pause') {
      pauseFunctionRuntime(targetName);
    } else if (command === 'resume') {
      resumeFunctionRuntime(targetName);
    } else if (command === 'stop') {
      stopFunctionRuntime(targetName);
    } else if (command === 'reset') {
      stopFunctionRuntime(targetName, { resetState: true });
    } else if (command === 'restart') {
      if (targetKey && targetKey === currentKey) continue;
      stopFunctionRuntime(targetName, { resetState: true });
      executeControlFunction(targetName, callerMesh, true, {
        depth: (context.depth ?? 0) + 1,
      });
    }
  }
}

function executeControlFunction(functionName, callerMesh, active, context = {}) {
  if ((context.depth ?? 0) > 6) return false;
  const func = getControlFunctionByName(functionName);
  if (!func) return false;
  if (active && isControlFunctionStopped(func.name)) return false;
  if (active && isFunctionPaused(func.name)) return false;
  const nowSeconds = performance.now() / 1000;
  let hasTransformAction = false;

  for (let i = 0; i < func.actions.length; i++) {
    const action = normalizeFunctionAction(func.actions[i]);
    const needsTargetRef = ['move', 'rotate', 'light', 'path'].includes(action.actionType);
    if (needsTargetRef && !action.refValue) continue;

    if (action.actionType === 'move') {
      hasTransformAction = true;
      const callerKey = callerMesh?.uuid ?? 'global';
      const stateKey = `${func.name}:${i}:${callerKey}`;
      if (!active && !action.returnOnDeactivate) continue; // keep current state
      const targetOffset = active ? action.offset : [0, 0, 0];
      setControlMoveActionState(stateKey, func.name, action, targetOffset, callerMesh, active);
      const st = _triggerMoveStates.get(stateKey);
      if (st) { st.callerUuid = callerMesh?.uuid ?? null; st.startedAt = nowSeconds; }
    } else if (action.actionType === 'rotate') {
      hasTransformAction = true;
      const callerKey = callerMesh?.uuid ?? 'global';
      const stateKey = `${func.name}:${i}:${callerKey}`;
      if (!active && !action.returnOnDeactivate) continue;
      const targetRotation = active ? action.rotateOffset : [0, 0, 0];
      setControlRotateActionState(stateKey, func.name, action, targetRotation, callerMesh, active);
      const st = _triggerRotateStates.get(stateKey);
      if (st) { st.callerUuid = callerMesh?.uuid ?? null; st.startedAt = nowSeconds; }
    } else if (action.actionType === 'light') {
      const targets = triggerMoveTargets(action.refType, action.refValue);
      for (const target of targets) applyLightActionToMesh(target, action.lightOp, action.lightValue);
    } else if (action.actionType === 'audio') {
      executeAudioAction(func.name, i, action, callerMesh, active);
    } else if (action.actionType === 'path') {
      applyPathAction(action, active);
    } else if (action.actionType === 'functionControl') {
      applyFunctionControlAction(action, func.name, callerMesh, active, context);
    } else if (action.actionType === 'playerGroup') {
      if (active) applyPlayerGroupAction(action);
    } else if (action.actionType === 'setVar') {
      if (active && action.setVarName) {
        const amount = resolveValueSource(action.setVarValueType, action.setVarValue, action.setVarValueVar);
        const current = getGameVar(action.setVarName);
        let nextValue = amount;
        if (action.setVarOp === '+') nextValue = current + amount;
        else if (action.setVarOp === '-') nextValue = current - amount;
        else if (action.setVarOp === '*') nextValue = current * amount;
        else if (action.setVarOp === '/') nextValue = amount === 0 ? current : current / amount;
        setGameVar(action.setVarName, nextValue);
      }
    } else if (action.actionType === 'setBool') {
      if (active && action.setBoolName) {
        if (action.setBoolValue === 'toggle') setGameBool(action.setBoolName, !getGameBool(action.setBoolName));
        else setGameBool(action.setBoolName, !!action.setBoolValue);
      }
    }
  }

  // When a new function with transform actions starts, un-mark all OTHER functions
  if (active && hasTransformAction) {
    const thisKey = normalizeControlFunctionKey(func.name);
    for (const [key, entry] of _controlFunctionStates) {
      if (key !== thisKey && entry.met) {
        entry.met = false;
      }
    }
  }

  // Light-only functions complete immediately
  if (active && !hasTransformAction) {
    markControlFunctionMet(func.name, callerMesh);
  }
  return true;
}

function compareOp(a, op, b) {
  switch (op) {
    case '=': return Math.abs(a - b) < 0.001;
    case '!=': return Math.abs(a - b) >= 0.001;
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return false;
  }
}

function evaluateCondition(condition, callerMesh, activatedAt) {
  const cond = normalizeCondition(condition);
  let result;
  switch (cond.type) {
    case 'none':
      result = true;
      break;
    case 'fnDone':
      result = !cond.ref || isControlFunctionMet(cond.ref);
      break;
    case 'touching': {
      const targets = triggerMoveTargets(cond.touchRefType, cond.touchRef);
      result = targets.some(t => isPlayerTouchingMesh(t));
      break;
    }
    case 'touchingPlayer':
      result = isPlayerTouchingMesh(callerMesh);
      break;
    case 'position': {
      let pos;
      if (!cond.posSubject || cond.posSubject === 'player') {
        pos = fpsPos;
      } else {
        const target = sceneObjects.find(m => (m.userData.label || '').toLowerCase() === cond.posSubject.toLowerCase());
        pos = target ? target.position : null;
      }
      result = pos ? compareOp(pos[cond.posAxis], cond.posOp, resolveValueSource(cond.posValueType, cond.posValue, cond.posValueVar)) : false;
      break;
    }
    case 'distance': {
      const target = sceneObjects.find(m => (m.userData.label || '').toLowerCase() === cond.distTarget.toLowerCase());
      if (target) {
        const dist = fpsPos.distanceTo(target.position);
        result = compareOp(dist, cond.distOp, resolveValueSource(cond.distValueType, cond.distValue, cond.distValueVar));
      } else {
        result = false;
      }
      break;
    }
    case 'timer': {
      const elapsed = (performance.now() / 1000) - (activatedAt || 0);
      result = elapsed >= resolveValueSource(cond.timerType, cond.timerSeconds, cond.timerVar);
      break;
    }
    case 'key':
      result = fpsKeys.has(cond.keyCode);
      break;
    case 'grounded':
      result = fpsGrounded;
      break;
    case 'varCmp':
      result = compareOp(getGameVar(cond.varCmpName), cond.varCmpOp, resolveValueSource(cond.varCmpValueType, cond.varCmpValue, cond.varCmpValueVar));
      break;
    case 'bool':
      result = getGameBool(cond.boolName);
      break;
    default:
      result = true;
  }
  return cond.negate ? !result : result;
}

function evaluateCallConditions(call, mesh) {
  const conds = call.conditions || [];
  if (!conds.length) return true;
  if (call.conditionLogic === 'or') {
    return conds.some(c => evaluateCondition(c, mesh, call.activatedAt));
  }
  return conds.every(c => evaluateCondition(c, mesh, call.activatedAt));
}

function evaluateTriggerCalls(mesh) {
  const pending = _activeTriggerCalls.get(mesh.uuid);
  if (!pending) return;

  const isOneShotController = !!pending[0]?.oneShot;

  for (const call of pending) {
    if (call.completed) continue;

    const met = evaluateCallConditions(call, mesh);
    if (met && !call.started) {
      if (isControlFunctionStopped(call.functionName)) {
        if (call.oneShot) call.completed = true;
      } else {
        const runStartedAt = performance.now() / 1000;
        const started = executeControlFunction(call.functionName, mesh, true);
        if (started) {
          call.started = true;
          call.runStartedAt = runStartedAt;
        }
      }
    }
    if (!met && call.started) {
      call.started = false;
      executeControlFunction(call.functionName, mesh, false);
    }

    if (!call.oneShot) continue;

    if (!call.functionName) {
      call.completed = true;
      continue;
    }

    const startedAt = Number.isFinite(call.runStartedAt) ? call.runStartedAt : (call.activatedAt ?? 0);
    const completedThisRun = hasFunctionRunCompletedForCaller(call.functionName, mesh.uuid, startedAt);
    if (!completedThisRun) continue;

    const fn = getControlFunctionByName(call.functionName);
    const hasReturnableTransform = !!fn && fn.actions.some(a => {
      const na = normalizeFunctionAction(a);
      return (na.actionType === 'move' || na.actionType === 'rotate') && na.returnOnDeactivate;
    });

    // One-shot switches should stop tracking after completion. If the function
    // has returnable transform actions, deactivate once so it returns with its style.
    if (call.started && hasReturnableTransform) {
      call.started = false;
      executeControlFunction(call.functionName, mesh, false);
    } else {
      call.started = false;
    }
    call.completed = true;
  }

  if (isOneShotController && pending.every(c => c.completed)) {
    _activeTriggerCalls.delete(mesh.uuid);
  }
}

function activateControlMesh(controllerMesh, options = {}) {
  const calls = ensureTriggerCalls(controllerMesh);
  if (!calls.length) return;
  const now = performance.now() / 1000;
  const oneShot = options.oneShot === true;
  _activeTriggerCalls.set(controllerMesh.uuid, calls.map(c => ({
    ...c,
    started: false,
    activatedAt: now,
    runStartedAt: null,
    completed: false,
    oneShot,
  })));
  evaluateTriggerCalls(controllerMesh);
}

function deactivateControlMesh(controllerMesh) {
  const calls = _activeTriggerCalls.get(controllerMesh.uuid);
  if (calls) {
    for (const call of calls) {
      if (!call.started) continue;
      executeControlFunction(call.functionName, controllerMesh, false);
    }
  }
  _activeTriggerCalls.delete(controllerMesh.uuid);
}

function pressSwitch(mesh) {
  const switchConfig = getMeshSwitchConfig(mesh);
  if (!switchConfig.enabled) return false;

  const min = Math.min(switchConfig.min, switchConfig.max);
  const max = Math.max(switchConfig.min, switchConfig.max);
  const value = getRuntimeValueByKey(switchConfig.varKey);
  if (value < min || value > max) return false;

  activateControlMesh(mesh, { oneShot: switchConfig.runMode !== 'repeat' });
  return true;
}

function updateTriggerMoveAnimations(nowSeconds) {
  if (!_playtestBasePositions.size) return;

  const anyFunctionJustCompleted = applyAnimatedTransforms(
    _playtestBasePositions,
    _playtestBaseRotations,
    _triggerMoveStates,
    _triggerRotateStates,
    nowSeconds
  );

  // Re-evaluate pending calls when a function just completed
  if (anyFunctionJustCompleted) {
    for (const [uuid, calls] of _activeTriggerCalls) {
      if (calls.some(c => !c.started)) {
        const mesh = sceneObjects.find(m => m.uuid === uuid);
        if (mesh) evaluateTriggerCalls(mesh);
      }
    }
  }

}

function updateMovementPathAnimations(dt) {
  if (!state.isPlaytest || dt <= 0) return;

  for (const mesh of sceneObjects) {
    const config = getMeshMovementPathConfig(mesh);
    if (!config.enabled || !config.checkpoints.length) {
      _movementPathStates.delete(mesh.uuid);
      continue;
    }

    const st = getMovementPathState(mesh, false);
    if (!st || !st.active || st.paused) continue;

    const speed = Math.max(0.01, Number(config.speed) || 0.01);
    let remainingDistance = speed * dt;
    if (remainingDistance <= 0) continue;

    if (st.finished && !config.loop) {
      st.active = false;
      continue;
    }
    if (st.targetIndex >= config.checkpoints.length || st.targetIndex < 0) st.targetIndex = 0;

    let guard = config.checkpoints.length * 2 + 4;
    while (remainingDistance > 1e-6 && guard-- > 0) {
      const idx = THREE.MathUtils.clamp(st.targetIndex, 0, config.checkpoints.length - 1);
      const cp = normalizeMovementPathCheckpoint(config.checkpoints[idx]);
      _pathPreviewTarget.set(cp.pos[0], cp.pos[1], cp.pos[2]);
      _pathPreviewDelta.subVectors(_pathPreviewTarget, mesh.position);
      const dist = _pathPreviewDelta.length();

      if (dist <= 1e-5 || remainingDistance >= dist) {
        mesh.position.copy(_pathPreviewTarget);
        remainingDistance = dist <= 1e-5 ? 0 : (remainingDistance - dist);

        const fnName = String(cp.functionName ?? '').trim();
        if (fnName) executeControlFunction(fnName, mesh, true);

        if (config.loop) {
          st.targetIndex = (idx + 1) % config.checkpoints.length;
          st.finished = false;
        } else if (idx >= config.checkpoints.length - 1) {
          st.targetIndex = idx;
          st.finished = true;
          st.active = false;
          break;
        } else {
          st.targetIndex = idx + 1;
        }
        continue;
      }

      mesh.position.addScaledVector(_pathPreviewDelta, remainingDistance / dist);
      remainingDistance = 0;
    }
  }
}

function applyFallDamage(fallDistance) {
  if (!gameRules.fallDamage) return;
  // Spawn protect: untilLanded blocks fall damage until first ground touch
  if (gameRules.spawnProtectCondition === 'untilLanded' && !fpsSpawnLanded) return;
  if (fpsSpawnProtectTimer > 0 && (gameRules.spawnProtectCondition === 'all' || gameRules.spawnProtectCondition === 'fall')) return;
  const threshold = gameRules.fallDamageMinHeight;
  if (fallDistance <= threshold) return;
  const dmg = Math.pow(fallDistance - threshold, 1.6) * 2.5 * gameRules.fallDamageMultiplier;
  fpsHealth = Math.max(0, fpsHealth - dmg);
  updateHealthHud();
  if (fpsHealth <= 0) respawnPlayer();
}

function respawnPlayer() {
  const activeCheckpoint = getActiveCheckpointMesh();
  const checkpointSpawn = activeCheckpoint ? getCheckpointSpawnState(activeCheckpoint) : null;
  const spawnState = checkpointSpawn ?? getSpawnBlockState() ?? { pos: fpsSpawnPos.clone(), yaw: fpsSpawnYaw, pitch: fpsSpawnPitch };
  applySpawnState(spawnState);
  fpsSpawnPos.copy(spawnState.pos);
  fpsSpawnYaw = spawnState.yaw;
  fpsSpawnPitch = spawnState.pitch;
  fpsVelY  = 0;
  fpsGrounded = false;
  fpsFallStartY = null;
  fpsHealth = gameRules.maxHealth;
  fpsSpawnProtectTimer = gameRules.spawnProtectTime;
  fpsSpawnLanded = false;
  updateHealthHud();
  syncFpsCamera();
}

// ─── Trigger blocks overlap detection ────────────────────────────────────────
const _triggerAABB = new THREE.Box3();
const _activeTriggers = new Set();

function checkTriggerBlocks() {
  const pH = gameRules.height;
  for (const m of sceneObjects) {
    if (m.userData.type !== 'trigger') continue;
    _triggerAABB.setFromObject(m);
    // Check player overlap with trigger AABB
    const overlap =
      fpsPos.x + PLAYER_RADIUS > _triggerAABB.min.x &&
      fpsPos.x - PLAYER_RADIUS < _triggerAABB.max.x &&
      fpsPos.z + PLAYER_RADIUS > _triggerAABB.min.z &&
      fpsPos.z - PLAYER_RADIUS < _triggerAABB.max.z &&
      fpsPos.y + pH > _triggerAABB.min.y &&
      fpsPos.y < _triggerAABB.max.y;

    if (overlap && !_activeTriggers.has(m)) {
      _activeTriggers.add(m);
      activateControlMesh(m);
      applyTriggerFunctionStops(m, true);
      // Apply gamerule overrides
      const rules = m.userData.triggerRules;
      if (rules) {
        for (const [key, val] of Object.entries(rules)) {
          applyCtAction(key, String(val));
        }
      }
    } else if (!overlap) {
      if (_activeTriggers.has(m)) {
        deactivateControlMesh(m);
        applyTriggerFunctionStops(m, false);
      }
      _activeTriggers.delete(m);
    }
  }
}

function checkCheckpointBlocks() {
  const pH = gameRules.height;
  for (const mesh of sceneObjects) {
    if (mesh.userData.type !== 'checkpoint') continue;
    const config = getMeshCheckpointConfig(mesh);
    if (config.interaction !== 'touch') {
      _activeTouchCheckpoints.delete(mesh);
      continue;
    }

    _checkpointAABB.setFromObject(mesh);
    const overlap =
      fpsPos.x + PLAYER_RADIUS > _checkpointAABB.min.x &&
      fpsPos.x - PLAYER_RADIUS < _checkpointAABB.max.x &&
      fpsPos.z + PLAYER_RADIUS > _checkpointAABB.min.z &&
      fpsPos.z - PLAYER_RADIUS < _checkpointAABB.max.z &&
      fpsPos.y + pH > _checkpointAABB.min.y &&
      fpsPos.y < _checkpointAABB.max.y;

    if (overlap && !_activeTouchCheckpoints.has(mesh)) {
      _activeTouchCheckpoints.add(mesh);
      activateCheckpoint(mesh);
    } else if (!overlap) {
      _activeTouchCheckpoints.delete(mesh);
    }
  }
}

// ─── Conditional triggers ────────────────────────────────────────────────────
const conditionalTriggers = [];
let _nextCtId = 1;

// ─── Game variables / booleans ───────────────────────────────────────────────
const gameVars = [];
const gameBools = [];

function namedValueKey(name) {
  return String(name ?? '').trim().toLowerCase();
}

function isUniqueNamedEntry(list, index, candidate) {
  const key = namedValueKey(candidate);
  if (!key) return false;
  for (let i = 0; i < list.length; i++) {
    if (i === index) continue;
    if (namedValueKey(list[i]?.name) === key) return false;
  }
  return true;
}

function buildNextAvailableName(prefix, list) {
  let n = 1;
  let candidate = `${prefix}${n}`;
  while (!isUniqueNamedEntry(list, -1, candidate)) {
    n += 1;
    candidate = `${prefix}${n}`;
  }
  return candidate;
}

function normalizeGameVarEntry(entry = {}) {
  const name = String(entry.name ?? '').trim();
  const defaultValue = Math.trunc(Number.isFinite(parseFloat(entry.defaultValue)) ? parseFloat(entry.defaultValue) : 0);
  const runtimeRaw = Number.isFinite(parseFloat(entry.runtimeValue)) ? parseFloat(entry.runtimeValue) : defaultValue;
  return { name, defaultValue, runtimeValue: Math.trunc(runtimeRaw) };
}

function normalizeGameBoolEntry(entry = {}) {
  const name = String(entry.name ?? '').trim();
  const defaultValue = !!entry.defaultValue;
  const runtimeValue = entry.runtimeValue === undefined ? defaultValue : !!entry.runtimeValue;
  return { name, defaultValue, runtimeValue };
}

function getGameVar(name) {
  const key = String(name ?? '').trim();
  const entry = gameVars.find(item => item.name === key);
  return entry ? entry.runtimeValue : 0;
}

function hasGameVar(name) {
  const key = String(name ?? '').trim();
  return !!key && gameVars.some(item => item.name === key);
}

function setGameVar(name, value) {
  const key = String(name ?? '').trim();
  const entry = gameVars.find(item => item.name === key);
  const nextValue = Math.trunc(Number.isFinite(parseFloat(value)) ? parseFloat(value) : 0);
  if (entry) {
    entry.runtimeValue = nextValue;
    refreshVarPanel();
    return;
  }
  if (key) _runtimeNumericOverrides.set(key, nextValue);
}

function getGameBool(name) {
  const key = String(name ?? '').trim();
  const entry = gameBools.find(item => item.name === key);
  return entry ? entry.runtimeValue : false;
}

function setGameBool(name, value) {
  const key = String(name ?? '').trim();
  const entry = gameBools.find(item => item.name === key);
  if (!entry) return;
  entry.runtimeValue = !!value;
  refreshBoolPanel();
}

function resetGameValueState() {
  for (const entry of gameVars) entry.runtimeValue = entry.defaultValue;
  for (const entry of gameBools) entry.runtimeValue = entry.defaultValue;
  _runtimeNumericOverrides.clear();
  refreshVarPanel();
  refreshBoolPanel();
}

function getKnownVarNames(extra = []) {
  return [...new Set([...gameVars.map(item => item.name).filter(Boolean), ...extra.filter(Boolean)])];
}

function getKnownBoolNames(extra = []) {
  return [...new Set([...gameBools.map(item => item.name).filter(Boolean), ...extra.filter(Boolean)])];
}

function resolveValueSource(sourceType, numericValue, variableName) {
  if (sourceType === 'var') return getGameVar(variableName);
  return Number.isFinite(parseFloat(numericValue)) ? parseFloat(numericValue) : 0;
}

function normalizeTouchRef(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isPlayerTouchingMesh(mesh) {
  if (!mesh) return false;
  const pH = gameRules.height;
  _tmpAABB.setFromObject(mesh);
  return (
    fpsPos.x + PLAYER_RADIUS > _tmpAABB.min.x &&
    fpsPos.x - PLAYER_RADIUS < _tmpAABB.max.x &&
    fpsPos.z + PLAYER_RADIUS > _tmpAABB.min.z &&
    fpsPos.z - PLAYER_RADIUS < _tmpAABB.max.z &&
    fpsPos.y + pH > _tmpAABB.min.y &&
    fpsPos.y < _tmpAABB.max.y
  );
}

function isPlayerTouchingRef(refType, refValue) {
  const needle = normalizeTouchRef(refValue);
  if (!needle) return false;

  for (const m of sceneObjects) {
    const match = refType === 'name'
      ? normalizeTouchRef(m.userData.label) === needle
      : meshHasGroup(m, needle);
    if (!match) continue;
    if (isPlayerTouchingMesh(m)) return true;
  }

  return false;
}

function getRuntimeValueByKey(key, context = null) {
  const namedKey = String(key ?? '').trim();
  if (hasGameVar(namedKey)) return getGameVar(namedKey);
  if (_runtimeNumericOverrides.has(namedKey)) return _runtimeNumericOverrides.get(namedKey);
  if (key === 'touching') return isPlayerTouchingRef(context?.touchRefType ?? 'group', context?.touchRefValue ?? '') ? 1 : 0;
  if (key === 'hits') return fpsHits;
  if (key === 'health') return fpsHealth;
  if (key === 'posY') return fpsPos.y;
  if (key === 'posX') return fpsPos.x;
  if (key === 'posZ') return fpsPos.z;
  if (key === 'grounded') return fpsGrounded ? 1 : 0;
  if (key === 'spawnLanded') return fpsSpawnLanded ? 1 : 0;
  if (key in gameRules) {
    const value = gameRules[key];
    return typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
  return 0;
}

function getCtSourceValue(key, ct = null) {
  if (key === 'var') return getGameVar(ct?.varCondName);
  if (key === 'bool') return getGameBool(ct?.boolCondName) ? 1 : 0;
  if (String(key).startsWith('var:')) return getGameVar(String(key).slice(4));
  return getRuntimeValueByKey(key, ct);
}

function compareCtValues(a, op, b) {
  const eps = 0.01;
  if (op === '<') return a < b;
  if (op === '>') return a > b;
  if (op === '<=') return a <= b;
  if (op === '>=') return a >= b;
  if (op === '!=') return Math.abs(a - b) >= eps;
  return Math.abs(a - b) < eps; // '='
}

function resolveCtActionMath(ct) {
  const baseKey = (ct.actionBase ?? 'none');
  const amount = ct.actionValueType === 'var'
    ? getGameVar(ct.actionValueVar)
    : parseFloat(ct.actionValue);
  const amountVal = Number.isFinite(amount) ? amount : 0;
  if (!baseKey || baseKey === 'none') return amountVal;

  const baseVal = getCtSourceValue(baseKey);
  const op = ct.actionOp || '+';
  if (op === '+') return baseVal + amountVal;
  if (op === '-') return baseVal - amountVal;
  if (op === '*') return baseVal * amountVal;
  if (op === '/') return amountVal === 0 ? baseVal : (baseVal / amountVal);
  return amountVal;
}

function getCtRepeatIntervalSeconds(ct) {
  const raw = parseFloat(ct.repeatInterval);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0.05, raw);
}

function evaluateConditionalTriggers() {
  // Sort by priority (higher = first)
  const sorted = [...conditionalTriggers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const now = performance.now() / 1000;
  for (const ct of sorted) {
    const isTouchCondition = ct.conditionType === 'touching';
    const isBoolCondition = ct.conditionType === 'bool';
    const condVal = getCtSourceValue(ct.conditionType, ct);
    const condOpRaw = (isTouchCondition || isBoolCondition) ? '=' : (ct.condOp ?? ct.op ?? '=');
    const condOp = condOpRaw === '==' ? '=' : condOpRaw;
    const condValue = (isTouchCondition || isBoolCondition)
      ? 1
      : (ct.valueType === 'var' ? getGameVar(ct.valueVarName) : (Number.isFinite(parseFloat(ct.value)) ? parseFloat(ct.value) : 0));

    // Backward compatibility: old data used op='is' or op='not'.
    const legacySense = ct.op === 'not' ? 'not' : (ct.op === 'is' ? 'is' : null);
    const condSense = ct.condSense ?? legacySense ?? 'is';

    let met = compareCtValues(condVal, condOp, condValue);
    if (condSense === 'not') met = !met;

    const mode = ct.mode || 'if';

    if (met) {
      let shouldFire = false;
      if (mode === 'if') {
        // Fire once when condition becomes true
        if (!ct._fired) shouldFire = true;
        ct._fired = true;
        ct._nextFireTime = null;
      } else if (mode === 'when') {
        // Fire every frame while true
        shouldFire = true;
        ct._fired = true;
        ct._nextFireTime = null;
      } else if (mode === 'while') {
        // Fire repeatedly on a strict interval while true.
        const interval = getCtRepeatIntervalSeconds(ct);
        if (!ct._fired) {
          ct._fired = true;
          ct._nextFireTime = now + interval;
        }
        if ((ct._nextFireTime ?? Infinity) <= now) {
          shouldFire = true;
          ct._lastFireTime = now;
          ct._nextFireTime = now + interval;
        }
      }
      if (shouldFire) {
        const mathVal = resolveCtActionMath(ct);
        applyCtAction(ct.ruleKey, String(mathVal));
      }
    } else {
      const wasFired = ct._fired;
      ct._fired = false;
      ct._lastFireTime = null;
      ct._nextFireTime = null;
      if (wasFired && ct.elseRuleKey) {
        applyCtAction(ct.elseRuleKey, ct.elseValueExpr ?? String(ct.elseRuleValue ?? 0));
      }
    }
  }
}

function resolveCtValue(ruleKey, expr) {
  const s = String(expr).trim();
  // Try "<key> + N" or "<key> - N"
  const match = s.match(/^(\w+)\s*([+\-*])\s*([\d.]+)$/);
  if (match) {
    const ref = match[1];
    const op = match[2];
    const num = parseFloat(match[3]);
    const base = hasGameVar(ref)
      ? getGameVar(ref)
      : (Number.isFinite(parseFloat(ref)) ? parseFloat(ref) : getRuntimeValueByKey(ref));
    if (op === '+') return base + num;
    if (op === '-') return base - num;
    if (op === '*') return base * num;
  }
  // Plain number
  const num = parseFloat(s);
  if (Number.isFinite(num)) return num;
  // Bare variable reference
  return hasGameVar(s) ? getGameVar(s) : getRuntimeValueByKey(s);
}

function applyCtAction(ruleKey, expr) {
  if (!ruleKey) return;
  if (String(ruleKey).startsWith('var:')) {
    setGameVar(String(ruleKey).slice(4), resolveCtValue(ruleKey, expr));
    return;
  }
  const val = resolveCtValue(ruleKey, expr);
  if (ruleKey === 'health') {
    fpsHealth = Math.max(0, Math.min(gameRules.maxHealth, val));
    updateHealthHud();
    if (fpsHealth <= 0) respawnPlayer();
  } else if (ruleKey === 'posX') {
    fpsPos.x = val;
    syncFpsCamera();
  } else if (ruleKey === 'posY') {
    fpsPos.y = Math.max(0, val);
    fpsVelY = 0;
    fpsGrounded = false;
    syncFpsCamera();
  } else if (ruleKey === 'posZ') {
    fpsPos.z = val;
    syncFpsCamera();
  } else if (ruleKey in gameRules) {
    gameRules[ruleKey] = val;
    syncGameruleUI();
  }
}

function syncGameruleUI() {
  grJumpInput.value    = gameRules.jumpHeight;
  grGravityInput.value = gameRules.gravity;
  if (grGravityEnabledInput) grGravityEnabledInput.checked = !!gameRules.gravityEnabled;
  grHeightInput.value  = gameRules.height;
  grSprintInput.value  = gameRules.sprintSpeed;
  grMaxHpInput.value   = gameRules.maxHealth;
  grFallDmgInput.checked = gameRules.fallDamage;
  grFallDmgMinHtInput.value = gameRules.fallDamageMinHeight;
  grFallDmgMultInput.value  = gameRules.fallDamageMultiplier;
  grSpawnProtTimeInput.value = gameRules.spawnProtectTime;
  grSpawnProtCondInput.value = gameRules.spawnProtectCondition;
  refreshPlayerProfileUI();
}

function startPlaytest() {
  if (state.isPlaytest) return;
  stopLibraryPreviewAudio();
  // Reset any editor simulation before starting playtest
  if (_simActive || _simBasePositions.size) resetSimulation();
  state.isPlaytest = true;
  runtimePauseActive = false;
  hideRuntimePauseMenu();
  runtimeOptimizer.emaFps = 60;
  runtimeOptimizer.lowFpsStreak = 0;
  runtimeOptimizer.highFpsStreak = 0;
  runtimeOptimizer.lastCheckMs = performance.now();
  runtimeOptimizer.lastSwapMs = performance.now();
  fpsHits = 0;
  fpsHealth = gameRules.maxHealth;
  fpsFallStartY = null;
  fpsSpawnProtectTimer = gameRules.spawnProtectTime;
  fpsSpawnLanded = false;
  _controlFunctionStates.clear();
  _playtestBasePositions.clear();
  _playtestBaseRotations.clear();
  _playtestPrevPositions.clear();
  _playtestPrevRotations.clear();
  _playtestPrevAABBs.clear();
  _triggerMoveStates.clear();
  _triggerRotateStates.clear();
  _movementPathStates.clear();
  _activeTriggerCalls.clear();
  clearRuntimeFunctionStops();
  clearAllRuntimeAudio();
  _pausedFunctionKeys.clear();
  activeCheckpointMeshUuid = null;
  _activeTouchCheckpoints.clear();
  for (const m of sceneObjects) {
    const pos = m.position.clone();
    _playtestBasePositions.set(m, pos);
    _playtestBaseRotations.set(m, m.quaternion.clone());
    _playtestPrevPositions.set(m, pos.clone());
    _playtestPrevRotations.set(m, m.quaternion.clone());
    _playtestPrevAABBs.set(m, new THREE.Box3().setFromObject(m));
  }

  // save target colors for reset on stop
  savedTargetColors.clear();
  for (const m of sceneObjects) {
    if (m.userData.type === 'target') {
      savedTargetColors.set(m, m.material.color.getHex());
      m.userData._health = m.userData.targetMaxHealth || 0;
      m.userData._dead = false;
      m.visible = true;
    }
  }

  // Hide dedicated light blocks (PointLight stays active); keep emitting walls/floors visible
  for (const m of sceneObjects) {
    if (m.userData.type === 'light' && m.userData.pointLight) {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.castShadow = false;
      m.userData._playtestHidden = true;
    }
  }

  // Hide spawn and trigger blocks during playtest
  for (const m of sceneObjects) {
    if (m.userData.type === 'spawn' || m.userData.type === 'trigger') {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.userData._playtestHidden = true;
    }
  }

  setPlaytestDevView(false);

  // Find spawn point from spawn blocks
  const spawnState = getSpawnBlockState() ?? getFallbackSpawnState();
  applySpawnState(spawnState);
  fpsVelY = 0;
  fpsGrounded = false;

  selectObject(null);
  orbitControls.enabled = false;

  crosshair.style.display = 'block';
  playHint.style.display  = 'block';
  document.getElementById('btn-stop').style.display     = 'inline-flex';
  document.getElementById('btn-playtest').style.display = 'none';

  fpsSpawnPos.copy(spawnState.pos);
  fpsSpawnYaw   = spawnState.yaw;
  fpsSpawnPitch = spawnState.pitch;

  healthHud.style.display = 'block';
  updateHealthHud();

  renderer.domElement.requestPointerLock();
  syncFpsCamera();
  refreshStatus();
}

function _cleanupPlaytest() {
  closeRuntimeKeypadOverlay();
  // Restore dedicated light block visibility
  for (const m of sceneObjects) {
    if (m.userData.type === 'light' && m.userData.pointLight) {
      m.material.visible = true;
      m.castShadow = true;
    }
  }
  // Restore spawn/trigger visibility
  for (const m of sceneObjects) {
    if (m.userData.type === 'spawn' || m.userData.type === 'trigger') {
      m.material.visible = true;
    }
  }
  // Restore target visibility and colors
  for (const m of sceneObjects) {
    if (m.userData.type === 'target') {
      m.visible = true;
      m.userData._dead = false;
    }
  }
  // Clear all playtest-hidden flags
  for (const m of sceneObjects) {
    const basePos = _playtestBasePositions.get(m);
    if (basePos) m.position.copy(basePos);
    const baseQuat = _playtestBaseRotations.get(m);
    if (baseQuat) m.quaternion.copy(baseQuat);
    m.userData._playtestHidden = false;
    m.visible = true;
  }
  _playtestBasePositions.clear();
  _playtestBaseRotations.clear();
  _playtestPrevPositions.clear();
  _playtestPrevRotations.clear();
  _playtestPrevAABBs.clear();
  _triggerMoveStates.clear();
  _triggerRotateStates.clear();
  _movementPathStates.clear();
  _activeTriggerCalls.clear();
  clearRuntimeFunctionStops();
  clearAllRuntimeAudio();
  _pausedFunctionKeys.clear();
  activeCheckpointMeshUuid = null;
  _activeTouchCheckpoints.clear();
  for (const [m, hex] of savedTargetColors) m.material.color.setHex(hex);
  savedTargetColors.clear();
  for (const m of sceneObjects) applyCustomSkinToMesh(m);
  fpsKeys.clear();
  editKeys.clear();
  _activeTriggers.clear();
  // Reset conditional trigger fired states
  for (const ct of conditionalTriggers) { ct._fired = false; ct._lastFireTime = null; ct._nextFireTime = null; }
  orbitControls.enabled = true;

  crosshair.style.display = 'none';
  playHint.style.display  = 'none';
  healthHud.style.display = 'none';
  document.getElementById('btn-stop').style.display = 'none';
  document.getElementById('btn-playtest').style.display = 'inline-flex';
  fpsDevView = false;
  updatePlayHint();
  refreshStatus();
}

function stopPlaytest(options = {}) {
  if (!state.isPlaytest) return;
  const returnToLibrary = options.returnToLibrary !== false;
  state.isPlaytest = false;
  runtimePauseActive = false;
  hideRuntimePauseMenu();
  _cleanupPlaytest();
  if (runtimeMode) {
    if (runtimeSettingsPanelEl) runtimeSettingsPanelEl.style.display = 'none';
    applyRuntimeChrome();
    if (runtimeLoaderMode && returnToLibrary) showRuntimeLoaderOverlay();
  }
  if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}

document.addEventListener('pointerlockchange', () => {
  fpsLocked = document.pointerLockElement === renderer.domElement;
  if (!fpsLocked && state.isPlaytest) {
    if (suppressPointerUnlockStop) {
      suppressPointerUnlockStop = false;
      return;
    }
    if (runtimeMode) {
      pauseRuntimeGame();
      return;
    }
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
  if (e.button !== 0) return;
  pDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
  if (e.button !== 0) return;
  if (!pDownPos) return;
  const dx = e.clientX - pDownPos.x;
  const dy = e.clientY - pDownPos.y;
  pDownPos = null;
  if (Math.hypot(dx, dy) > 5) return;          // drag -> not a click
  if (state.isPlaytest) {                       // playtest: lock or shoot
    if (runtimeMode && runtimePauseActive) return;
    if (tryOpenRuntimeKeypadFromPointerEvent(e)) return;
    if (!fpsLocked) renderer.domElement.requestPointerLock();
    else fpsShoot();
    return;
  }
  if (transformControls.dragging) return;
  handleEditorClick(e);
});

renderer.domElement.addEventListener('contextmenu', e => {
  if (state.isPlaytest && pickKeypadMeshFromPointerEvent(e)) e.preventDefault();
});

function handleEditorClick(e) {
  if (runtimeMode) return;
  const ndc = toNDC(e);

  if (state.colorPickArmed) {
    const hit = surfaceHit(ndc);
    if (hit?.object?.material?.color) {
      const hex = hit.object.material.color.getHex();
      state.brushColor = hex;
      if (paintColorInput) paintColorInput.value = colorHexToCss(hex);
    }
    state.colorPickArmed = false;
    refreshStatus();
    return;
  }

  if (state.mode === 'place') {
    const shapeParams = getPlacementShapeParams(state.placingType);
    const hit = surfaceHit(ndc);
    if (hit) {
      const pos = computeSurfacePlacement(hit.point, hit.normal, state.placingType, state.cloneScale, shapeParams);
      snapSurface(pos, hit.normal);
      placeObject(pos);
      return;
    }
    const pt = groundPoint(ndc);
    if (pt) {
      snap(pt);
      placeObject(new THREE.Vector3(pt.x, getPlacedY(state.placingType, shapeParams, state.cloneScale), pt.z));
    }
  } else if (state.mode === 'paint') {
    const hit = surfaceHit(ndc);
    if (hit?.object) paintMesh(hit.object, state.brushColor);
  } else if (state.mode === 'select') {
    if (tryApplyPathCheckpointViewportPick(ndc)) return;
    const obj = hitObject(ndc);
    if (e.shiftKey) {
      toggleMultiSelect(obj);
    } else {
      selectObject(obj);
      if (obj) selectEditorGroup(obj);
    }
  } else if (state.mode === 'delete') {
    const obj = hitObject(ndc);
    if (obj) deleteObject(obj);
  } else if (state.mode === 'erase') {
    const hit = surfaceHit(ndc);
    if (hit?.object) eraseHoleAtHit(hit);
  }
}

renderer.domElement.addEventListener('pointermove', e => {
  if (state.isPlaytest || !['place', 'erase', 'paint'].includes(state.mode)) { removeGhost(); return; }
  const ndc = toNDC(e);
  lastPlaceNDC.copy(ndc);

  if (state.mode === 'paint' && (e.buttons & 1) === 1) {
    const hit = surfaceHit(ndc);
    if (hit?.object) paintMesh(hit.object, state.brushColor);
  }

  if (state.mode === 'paint') {
    removeGhost();
    return;
  }

  if (state.mode === 'erase') {
    ensureGhost(state.placingType);
    const hit = surfaceHit(ndc);
    if (hit) {
      const pos = hit.point.clone().addScaledVector(hit.normal, THREE.MathUtils.clamp(state.eraserSize * 0.5, 0.05, 6));
      snapSurface(pos, hit.normal);
      ghost.position.copy(pos);
      ghost.visible = true;
      return;
    }
    const pt = groundPoint(ndc);
    if (!pt) { if (ghost) ghost.visible = false; return; }
    snap(pt);
    ghost.position.set(pt.x, THREE.MathUtils.clamp(state.eraserSize * 0.5, 0.05, 6), pt.z);
    ghost.visible = true;
    return;
  }

  // Try surface-snap first
  const shapeParams = getPlacementShapeParams(state.placingType);
  const hit = surfaceHit(ndc);
  if (hit) {
    ensureGhost(state.placingType);
    const pos = computeSurfacePlacement(hit.point, hit.normal, state.placingType, state.cloneScale, shapeParams);
    snapSurface(pos, hit.normal);
    ghost.position.copy(pos);
    ghost.visible = true;
    return;
  }

  // Fall back to ground plane
  const pt = groundPoint(ndc);
  if (!pt) { if (ghost) ghost.visible = false; return; }
  snap(pt);
  ensureGhost(state.placingType);
  ghost.position.set(pt.x, getPlacedY(state.placingType, shapeParams, state.cloneScale), pt.z);
  ghost.visible = true;
});

renderer.domElement.addEventListener('pointerleave', () => {
  if (ghost) ghost.visible = false;
});

function fpsShoot() {
  fpsRay.set(fpsCam.position, fpsCam.getWorldDirection(new THREE.Vector3()));
  const shootables = sceneObjects.filter(m => {
    if (m.userData.type === 'target' && !m.userData._dead) return true;
    if (m.userData.type === 'checkpoint') {
      const config = getMeshCheckpointConfig(m);
      if (config.interaction === 'shoot') return true;
      if (config.interaction === 'switch') return getMeshSwitchConfig(m).enabled;
    }
    return getMeshSwitchConfig(m).enabled;
  });
  const hits = fpsRay.intersectObjects(shootables, false);
  if (!hits.length) return;
  const target = hits[0].object;
  let handled = false;

  if (target.userData.type === 'target') {
    target.material.color.set(0x3399ff);
    fpsHits++;
    handled = true;
  }

  // Target health
  if (target.userData.targetMaxHealth > 0) {
    target.userData._health = (target.userData._health ?? target.userData.targetMaxHealth) - 1;
    if (target.userData._health <= 0) {
      target.visible = false;
      target.userData._dead = true;
    }
  }

  if (target.userData.type === 'checkpoint') {
    const cpConfig = getMeshCheckpointConfig(target);
    if (cpConfig.interaction === 'shoot' && activateCheckpoint(target)) handled = true;
  }

  const switchPressed = pressSwitch(target);
  if (switchPressed) handled = true;
  if (target.userData.type === 'checkpoint') {
    const cpConfig = getMeshCheckpointConfig(target);
    if (cpConfig.interaction === 'switch' && switchPressed && activateCheckpoint(target)) handled = true;
  }

  if (handled) refreshStatus();
}

function isEditingFormField() {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement;
}

// ─── Keyboard ────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (state.isPlaytest) {
    if (runtimeMode) {
      if (e.code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        toggleRuntimePauseGame();
        return;
      }
      if (e.code === 'Escape' && !e.repeat) {
        e.preventDefault();
        if (!runtimePauseActive) pauseRuntimeGame();
        return;
      }
      if (runtimePauseActive) {
        e.preventDefault();
        return;
      }
    }

    if (!runtimeMode && e.code === 'KeyV' && !e.repeat) {
      e.preventDefault();
      setPlaytestDevView(!fpsDevView);
      return;
    }
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'Space' && !e.repeat) startJump();
    if (e.code === 'KeyR') fpsSprinting = true;
    fpsKeys.add(e.code);
    return;
  }

  if (isEditingFormField()) return;

  if (runtimeMode) {
    const runtimeKey = e.key.toLowerCase();
    if (runtimeKey === 'p') {
      e.preventDefault();
      startPlaytest();
    }
    return;
  }

  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'a') {
    e.preventDefault();
    selectAllObjects();
    return;
  }

  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft'].includes(e.code)) {
    editKeys.add(e.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
  }

  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'g') {
    e.preventDefault();
    if (e.shiftKey) ungroupSelected(); else groupSelected();
    return;
  }

  if (state.mode === 'select' && !e.ctrlKey && !e.metaKey) {
    if (state.transformMode === 'scale') {
      if (e.code === 'KeyX') { e.preventDefault(); toggleScaleSide('x'); return; }
      if (e.code === 'KeyY') { e.preventDefault(); toggleScaleSide('y'); return; }
      if (e.code === 'KeyZ') { e.preventDefault(); toggleScaleSide('z'); return; }
    }
    if (e.code === 'Digit1') { setTransformMode('translate'); return; }
    if (e.code === 'Digit2') { setTransformMode('rotate');    return; }
    if (e.code === 'Digit3') { setTransformMode('scale');     return; }
  }

  if ((k === 'delete' || k === 'backspace') && state.mode === 'select' && state.selectedObject) {
    const all = getAllSelected();
    for (const m of all) deleteObject(m);
    return;
  }
  if (k === 'p') { startPlaytest(); return; }
  if (k === 'escape') { stopPlaytest(); }

  if (e.code === 'Tab' && state.mode === 'place') {
    e.preventDefault();
    raycaster.setFromCamera(lastPlaceNDC, editorCam);
    const hits = raycaster.intersectObjects(sceneObjects, false);
    if (hits.length) {
      const obj = hits[0].object;
      setPlacingType(obj.userData.type);
      state.cloneScale = obj.scale.clone();
      state.cloneShapeParams = normalizeShapeParams(obj.userData.type, obj.userData.shapeParams || {});
      if (state.cloneShapeParams.sides != null) state.placeSides = state.cloneShapeParams.sides;
      if (state.cloneShapeParams.depth != null) state.place2DDepth = state.cloneShapeParams.depth;
      if (shapeSidesInput && state.cloneShapeParams.sides != null) shapeSidesInput.value = String(state.cloneShapeParams.sides);
      if (shapeDepthInput && state.cloneShapeParams.depth != null) shapeDepthInput.value = r3(state.cloneShapeParams.depth, 2);
      removeGhost();
    }
    return;
  }
});

window.addEventListener('keyup', e => {
  fpsKeys.delete(e.code);
  if (e.code === 'KeyR') fpsSprinting = false;
  editKeys.delete(e.code);
});

// ─── UI wiring ───────────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  if (mode !== 'paint') state.colorPickArmed = false;
  Object.entries(modeButtons).forEach(([k, b]) => b.classList.toggle('active', k === mode));
  if (mode !== 'select') selectObject(null);
  transformGroup.style.opacity       = mode === 'select' ? '1'    : '.4';
  transformGroup.style.pointerEvents = mode === 'select' ? ''     : 'none';
  if (!['place', 'erase'].includes(mode)) removeGhost();
  refreshStatus();
}

function setTransformMode(tm) {
  state.transformMode = tm;
  transformControls.setMode(tm);
  Object.entries(transformButtons).forEach(([k, b]) => b.classList.toggle('active', k === tm));
  refreshStatus();
}

function setPlacingType(type) {
  state.placingType = type;
  state.cloneScale = null;
  state.cloneShapeParams = null;
  document.querySelectorAll('.lib-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  refreshStatus();
}

function setPlacementSides(val) {
  state.placeSides = clampShapeSides(parseInt(val, 10));
  if (shapeSidesInput) shapeSidesInput.value = String(state.placeSides);
  if (state.cloneShapeParams?.sides != null) state.cloneShapeParams.sides = state.placeSides;
  if (ghost && state.mode === 'place') removeGhost();
  if (ghost && state.mode === 'erase') ensureEraserGhost();
  saveEditorSettings();
  refreshStatus();
}

function setPlacementDepth(val) {
  state.place2DDepth = clampShapeDepth(parseFloat(val));
  if (shapeDepthInput) shapeDepthInput.value = r3(state.place2DDepth, 2);
  if (state.cloneShapeParams?.depth != null) state.cloneShapeParams.depth = state.place2DDepth;
  if (ghost && state.mode === 'place') removeGhost();
  saveEditorSettings();
  refreshStatus();
}

function setPlacementOpacity(val) {
  state.placeOpacity = clampMeshOpacity(parseFloat(val));
  if (placeOpacityInput) placeOpacityInput.value = r3(state.placeOpacity, 2);
  saveEditorSettings();
  refreshStatus();
}

function setBrushColor(value) {
  state.brushColor = parseCssColor(value, state.brushColor);
  if (paintColorInput) paintColorInput.value = colorHexToCss(state.brushColor);
  saveEditorSettings();
  refreshStatus();
}

function setEraserShape(value) {
  const allowed = ['box', 'sphere', 'cylinder', 'prism', 'square2d', 'triangle2d', 'circle2d', 'polygon2d'];
  state.eraserShape = allowed.includes(value) ? value : 'box';
  if (eraserShapeInput) eraserShapeInput.value = state.eraserShape;
  if (state.mode === 'erase') ensureEraserGhost();
  saveEditorSettings();
  refreshStatus();
}

function setEraserSize(value) {
  state.eraserSize = THREE.MathUtils.clamp(parseFloat(value) || 1, 0.1, 12);
  if (eraserSizeInput) eraserSizeInput.value = r3(state.eraserSize, 2);
  if (state.mode === 'erase') ensureEraserGhost();
  saveEditorSettings();
  refreshStatus();
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

function setDefaultLightIntensity(val) {
  const intensity = clampLightIntensity(parseFloat(val));
  state.defaultLightIntensity = intensity;
  lightIntensityInput.value = intensity.toFixed(1);
  refreshStatus();
}

function activeCameraPosition() {
  return state.isPlaytest ? fpsPos : editorCam.position;
}

function setChunkRange(val) {
  const range = THREE.MathUtils.clamp(parseInt(val, 10) || 1, 1, 5);
  state.chunkRenderRadius = range;
  chunkRangeSelect.value = String(range);
  lastChunkX = Infinity;
  lastChunkZ = Infinity;
  lastChunkRange = Infinity;
  const camPos = activeCameraPosition();
  updateGridChunks(camPos.x, camPos.z);
  refreshStatus();
}

function setTopMenu(panelName) {
  const selected = panelName || 'block';
  topMenuSelect.value = selected;
  topPanels.forEach(panel => panel.classList.toggle('active', panel.dataset.panel === selected));
  // Switch sidebar sections
  document.querySelectorAll('.sidebar-section').forEach(s => s.classList.remove('active'));
  const sideSection = document.getElementById('sidebar-' + selected);
  if (sideSection) sideSection.classList.add('active');
}

function moveEditorCamera(dt) {
  if (transformControls.dragging || isEditingFormField()) return;
  if (!editKeys.size) return;

  const direction = new THREE.Vector3();
  editorCam.getWorldDirection(direction);
  direction.y = 0;
  if (direction.lengthSq() < 1e-6) direction.set(0, 0, -1);
  direction.normalize();

  const right = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
  const delta = new THREE.Vector3();

  if (editKeys.has('KeyW')) delta.add(direction);
  if (editKeys.has('KeyS')) delta.addScaledVector(direction, -1);
  if (editKeys.has('KeyA')) delta.add(right);
  if (editKeys.has('KeyD')) delta.addScaledVector(right, -1);
  if (editKeys.has('Space') || editKeys.has('KeyE')) delta.y += 1;
  if (editKeys.has('ShiftLeft') || editKeys.has('KeyQ')) delta.y -= 1;
  if (!delta.lengthSq()) return;

  delta.normalize().multiplyScalar((delta.y ? EDIT_VERTICAL_SPEED : EDIT_SPEED) * dt);
  editorCam.position.add(delta);
  orbitControls.target.add(delta);
}

Object.entries(modeButtons).forEach(([k, b]) => b.addEventListener('click', () => setMode(k)));
Object.entries(transformButtons).forEach(([k, b]) => b.addEventListener('click', () => setTransformMode(k)));
document.querySelectorAll('.lib-btn').forEach(b => {
  b.addEventListener('click', () => setPlacingType(b.dataset.type));
  b.addEventListener('contextmenu', e => {
    if (runtimeMode || state.isPlaytest) return;
    e.preventDefault();
    const type = b.dataset.type;
    showLibraryContextMenu(type, e.clientX, e.clientY);
  });
});
libraryPaneButtons.forEach(btn => {
  btn.addEventListener('click', () => setLibraryPane(btn.dataset.libPane));
});

document.addEventListener('pointerdown', e => {
  const target = e.target;
  if (libraryContextMenuEl && libraryContextMenuEl.contains(target)) return;
  if (keypadContextMenuEl && keypadContextMenuEl.contains(target)) return;
  closeTransientMenus();
});

window.addEventListener('resize', () => {
  closeTransientMenus();
});

if (audioImportBtn && audioImportInput) {
  audioImportBtn.addEventListener('click', () => audioImportInput.click());
  audioImportInput.addEventListener('change', async () => {
    const files = audioImportInput.files;
    await importAudioFiles(files);
    audioImportInput.value = '';
    saveEditorSettings();
  });
}

snapSelect.addEventListener('change', () => { setSnap(snapSelect.value); saveEditorSettings(); });
lightIntensityInput.addEventListener('change', () => setDefaultLightIntensity(lightIntensityInput.value));
sunIntensityInput.addEventListener('change', applySunUI);
[sunTimeInput, sunNorthInput, sunTurbidityInput, sunShadowRangeInput].forEach(el => el.addEventListener('change', applySunUI));
if (sunDayDurationInput) sunDayDurationInput.addEventListener('change', applySunUI);
if (sunDayCycleEnabledInput) sunDayCycleEnabledInput.addEventListener('change', applySunUI);
chunkRangeSelect.addEventListener('change', () => setChunkRange(chunkRangeSelect.value));
topMenuSelect.addEventListener('change', () => setTopMenu(topMenuSelect.value));
if (scaleSideXSelect) scaleSideXSelect.addEventListener('change', () => { state.scaleSides.x = scaleSideXSelect.value === 'neg' ? 'neg' : 'pos'; refreshStatus(); });
if (scaleSideYSelect) scaleSideYSelect.addEventListener('change', () => { state.scaleSides.y = scaleSideYSelect.value === 'neg' ? 'neg' : 'pos'; refreshStatus(); });
if (scaleSideZSelect) scaleSideZSelect.addEventListener('change', () => { state.scaleSides.z = scaleSideZSelect.value === 'neg' ? 'neg' : 'pos'; refreshStatus(); });
if (shapeSidesInput) shapeSidesInput.addEventListener('change', () => setPlacementSides(shapeSidesInput.value));
if (shapeDepthInput) shapeDepthInput.addEventListener('change', () => setPlacementDepth(shapeDepthInput.value));
if (placeOpacityInput) placeOpacityInput.addEventListener('change', () => setPlacementOpacity(placeOpacityInput.value));
if (paintColorInput) paintColorInput.addEventListener('input', () => setBrushColor(paintColorInput.value));
if (eraserShapeInput) eraserShapeInput.addEventListener('change', () => setEraserShape(eraserShapeInput.value));
if (eraserSizeInput) eraserSizeInput.addEventListener('change', () => setEraserSize(eraserSizeInput.value));
if (pickColorBtn) {
  pickColorBtn.addEventListener('click', () => {
    state.colorPickArmed = true;
    setMode('paint');
    refreshStatus();
  });
}
syncScaleSideUI();

// Gamerule inputs
grJumpInput.addEventListener('change', () => { gameRules.jumpHeight = parseFloat(grJumpInput.value) || 8.5; });
grGravityInput.addEventListener('change', () => { gameRules.gravity = parseFloat(grGravityInput.value) || 24; });
if (grGravityEnabledInput) grGravityEnabledInput.addEventListener('change', () => { gameRules.gravityEnabled = !!grGravityEnabledInput.checked; });
grHeightInput.addEventListener('change', () => {
  gameRules.height = parseFloat(grHeightInput.value) || 1.75;
  gameRules.eyeHeight = gameRules.height - 0.15;
});
grSprintInput.addEventListener('change', () => { gameRules.sprintSpeed = parseFloat(grSprintInput.value) || 12; });
grMaxHpInput.addEventListener('change', () => { gameRules.maxHealth = Math.max(1, parseInt(grMaxHpInput.value) || 100); });
grFallDmgInput.addEventListener('change', () => { gameRules.fallDamage = grFallDmgInput.checked; });
grFallDmgMinHtInput.addEventListener('change', () => { gameRules.fallDamageMinHeight = Math.max(0, parseFloat(grFallDmgMinHtInput.value) || 4); });
grFallDmgMultInput.addEventListener('change', () => { gameRules.fallDamageMultiplier = Math.max(0, parseFloat(grFallDmgMultInput.value) || 1); });
grSpawnProtTimeInput.addEventListener('change', () => { gameRules.spawnProtectTime = Math.max(0, parseFloat(grSpawnProtTimeInput.value) || 0); });
grSpawnProtCondInput.addEventListener('change', () => { gameRules.spawnProtectCondition = grSpawnProtCondInput.value; });
if (playerNameInput) {
  playerNameInput.addEventListener('change', () => {
    playerProfile.name = String(playerNameInput.value || '').trim() || 'Player';
    playerNameInput.value = playerProfile.name;
  });
}
if (playerGroupsInput) {
  playerGroupsInput.addEventListener('change', () => {
    playerProfile.groups = normalizeGroupListValue(playerGroupsInput.value);
    playerGroupsInput.value = playerProfile.groups.join(', ');
    refreshPlayerProfileUI();
  });
}
if (btnAddVar) {
  btnAddVar.addEventListener('click', () => {
    gameVars.push(normalizeGameVarEntry({
      name: buildNextAvailableName('var', gameVars),
      defaultValue: 0,
      runtimeValue: 0,
    }));
    refreshVarPanel();
    refreshCondTriggerUI();
    refreshControlFunctionsUI();
  });
}
if (btnAddBool) {
  btnAddBool.addEventListener('click', () => {
    gameBools.push(normalizeGameBoolEntry({
      name: buildNextAvailableName('bool', gameBools),
      defaultValue: false,
      runtimeValue: false,
    }));
    refreshBoolPanel();
    refreshCondTriggerUI();
    refreshControlFunctionsUI();
  });
}
if (btnResetValues) {
  btnResetValues.addEventListener('click', () => {
    resetGameValueState();
    refreshCondTriggerUI();
    refreshControlFunctionsUI();
  });
}

// Grid fill controls
function setGridFill(enabled, color) {
  gridFillEnabled = enabled;
  if (color !== undefined) gridFillColor = color;
  // Update existing fill planes color
  for (const [, mesh] of gridFillPlanes) mesh.material.color.setHex(gridFillColor);
  // Force chunk rebuild
  lastChunkX = Infinity;
  const camPos = activeCameraPosition();
  updateGridChunks(camPos.x, camPos.z);
}
gridFillEnabledInput.addEventListener('change', () => setGridFill(gridFillEnabledInput.checked));
gridFillColorInput.addEventListener('input', () => {
  gridFillColor = parseInt(gridFillColorInput.value.replace('#', ''), 16);
  for (const [, mesh] of gridFillPlanes) mesh.material.color.setHex(gridFillColor);
});
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
document.getElementById('btn-group').addEventListener('click', groupSelected);
document.getElementById('btn-ungroup').addEventListener('click', ungroupSelected);
document.getElementById('btn-select-all').addEventListener('click', selectAllObjects);
document.getElementById('btn-clear').addEventListener('click', clearAll);

const btnSaveJson = document.getElementById('btn-save-json') || document.getElementById('btn-save');
if (btnSaveJson) btnSaveJson.addEventListener('click', saveLevel);
if (btnExportGame) {
  btnExportGame.addEventListener('click', async () => {
    const oldText = btnExportGame.textContent;
    btnExportGame.disabled = true;
    btnExportGame.textContent = '⏳ Building...';
    try {
      await exportStandaloneGameHtml();
    } catch (err) {
      console.error(err);
      alert('Failed to export standalone game HTML. Make sure the app is served from a web server.');
    } finally {
      btnExportGame.textContent = oldText;
      btnExportGame.disabled = false;
    }
  });
}
if (btnExportLoader) {
  btnExportLoader.addEventListener('click', async () => {
    const oldText = btnExportLoader.textContent;
    btnExportLoader.disabled = true;
    btnExportLoader.textContent = '⏳ Building...';
    try {
      await exportRuntimeLoaderHtml();
    } catch (err) {
      console.error(err);
      alert('Failed to export runtime loader HTML. Make sure the app is served from a web server.');
    } finally {
      btnExportLoader.textContent = oldText;
      btnExportLoader.disabled = false;
    }
  });
}
document.getElementById('btn-load').addEventListener('click', () => loadInput.click());
loadInput.addEventListener('change', () => {
  const file = loadInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    loadLevelJSON(e.target.result, { pushHistory: !runtimeMode });
    if (runtimeMode) {
      hideRuntimeLoaderOverlay();
      startRuntimeGame();
    }
  };
  reader.readAsText(file);
  loadInput.value = '';
});

document.getElementById('btn-playtest').addEventListener('click', startPlaytest);
document.getElementById('btn-stop').addEventListener('click', stopPlaytest);
if (btnResetCheckpoints) {
  btnResetCheckpoints.addEventListener('click', () => {
    resetActiveCheckpointToWorldSpawn({ respawnNow: state.isPlaytest });
  });
}
if (btnSaveProject) btnSaveProject.addEventListener('click', saveProjectToLibrary);
if (btnBackMenu) btnBackMenu.addEventListener('click', showMainMenu);

if (sidebarToggleBtn) {
  sidebarToggleBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    sidebarState.collapsed = !sidebarState.collapsed;
    applySidebarState();
  });
}

if (functionsToggleBtn) {
  functionsToggleBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    functionsPanelState.collapsed = !functionsPanelState.collapsed;
    applyFunctionsPanelState();
  });
}

if (sidebarResizerEl) {
  sidebarResizerEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || sidebarState.collapsed || e.target === sidebarToggleBtn) return;
    sidebarState.resizing = true;
    if (workspaceEl) workspaceEl.classList.add('sidebar-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
}

if (functionsResizerEl) {
  functionsResizerEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || functionsPanelState.collapsed || e.target === functionsToggleBtn) return;
    functionsPanelState.resizing = true;
    if (workspaceEl) workspaceEl.classList.add('functions-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
}

window.addEventListener('pointermove', e => {
  if (!workspaceEl) return;
  const rect = workspaceEl.getBoundingClientRect();
  if (sidebarState.resizing) {
    sidebarState.width = clampSidebarWidth(e.clientX - rect.left);
    applySidebarState({ save: false, reflow: true });
  }
  if (functionsPanelState.resizing) {
    functionsPanelState.width = clampFunctionsPanelWidth(rect.right - e.clientX);
    applyFunctionsPanelState({ save: false, reflow: true });
  }
});

window.addEventListener('pointerup', stopSidebarResize);
window.addEventListener('pointerup', stopFunctionsPanelResize);
window.addEventListener('pointercancel', stopSidebarResize);
window.addEventListener('pointercancel', stopFunctionsPanelResize);
window.addEventListener('resize', () => {
  const nextWidth = clampSidebarWidth(sidebarState.width);
  if (nextWidth !== sidebarState.width) {
    sidebarState.width = nextWidth;
    applySidebarState({ save: true, reflow: false });
  }
  const nextFnWidth = clampFunctionsPanelWidth(functionsPanelState.width);
  if (nextFnWidth !== functionsPanelState.width) {
    functionsPanelState.width = nextFnWidth;
    applyFunctionsPanelState({ save: true, reflow: false });
  }
});

if (mmNewBtn) mmNewBtn.addEventListener('click', startNewProject);
if (mmImportBtn && mmImportInput) mmImportBtn.addEventListener('click', () => mmImportInput.click());
if (mmImportInput) {
  mmImportInput.addEventListener('change', () => {
    const file = mmImportInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      loadLevelJSON(e.target.result, { pushHistory: false });
      currentProjectId = null;
      currentProjectName = '';
      showStudio();
    };
    reader.readAsText(file);
    mmImportInput.value = '';
  });
}

if (mainMenuProjectList) {
  mainMenuProjectList.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-project-del]');
    if (delBtn) {
      deleteProjectById(delBtn.dataset.projectDel);
      return;
    }
    const row = e.target.closest('[data-project-id]');
    if (row) openProjectById(row.dataset.projectId);
  });
}

// ─── Properties panel ────────────────────────────────────────────────────────
function r3(v, dec = 2) { return typeof v === 'number' ? v.toFixed(dec) : v; }
const R2D = 180 / Math.PI;

function typeLabel(type) {
  return DEFS[type]?.label ?? type;
}

function bindSurfaceProps(mesh) {
  const colorInput = document.getElementById('prop-surface-color');
  const colorValue = document.getElementById('prop-surface-color-value');
  if (!colorInput || !colorValue || state.selectedObject !== mesh) return;

  const targets = getPropertyTargets(mesh).filter(m => m.material?.color);
  if (!targets.length) return;
  let before = new Map(targets.map(m => [m, m.material.color.getHex()]));

  const sync = hex => {
    for (const t of targets) setMeshColor(t, hex);
    colorInput.value = colorHexToCss(hex);
    colorValue.textContent = colorHexToCss(hex).toUpperCase();
  };

  const commit = value => {
    const fallback = before.get(mesh) ?? mesh.material.color.getHex();
    const hex = parseCssColor(value, fallback);
    for (const t of targets) {
      const b = before.get(t);
      if (b !== undefined && b !== hex) pushUndo({ type: 'color', mesh: t, before: b, after: hex });
    }
    before = new Map(targets.map(t => [t, t.material.color.getHex()]));
    sync(hex);
  };

  colorInput.addEventListener('pointerdown', () => { before = new Map(targets.map(t => [t, t.material.color.getHex()])); });
  colorInput.addEventListener('input', () => sync(parseCssColor(colorInput.value, before.get(mesh) ?? mesh.material.color.getHex())));
  colorInput.addEventListener('change', () => commit(colorInput.value));
}

function bindLightProps(mesh) {
  const rangeInput = document.getElementById('prop-light-intensity-range');
  const numberInput = document.getElementById('prop-light-intensity-number');
  const distRange = document.getElementById('prop-light-distance-range');
  const distNumber = document.getElementById('prop-light-distance-number');
  if (!rangeInput || !numberInput || state.selectedObject !== mesh) return;

  const targets = getPropertyTargets(mesh).filter(m => m.userData.pointLight);
  if (!targets.length) return;
  let beforeInt = new Map(targets.map(m => [m, getMeshLightIntensity(m)]));

  const syncIntensity = value => {
    const v = clampLightIntensity(value);
    rangeInput.value = v;
    numberInput.value = v.toFixed(1);
    for (const t of targets) setMeshLightIntensity(t, v);
  };
  const commitIntensity = value => {
    const v = clampLightIntensity(value);
    for (const t of targets) {
      const b = beforeInt.get(t);
      if (b !== undefined && b !== v) pushUndo({ type: 'light-intensity', mesh: t, before: b, after: v });
    }
    beforeInt = new Map(targets.map(t => [t, getMeshLightIntensity(t)]));
    syncIntensity(v);
  };

  rangeInput.addEventListener('pointerdown', () => { beforeInt = new Map(targets.map(t => [t, getMeshLightIntensity(t)])); });
  rangeInput.addEventListener('input', () => syncIntensity(parseFloat(rangeInput.value)));
  rangeInput.addEventListener('change', () => commitIntensity(parseFloat(rangeInput.value)));
  numberInput.addEventListener('focus', () => { beforeInt = new Map(targets.map(t => [t, getMeshLightIntensity(t)])); });
  numberInput.addEventListener('input', () => syncIntensity(parseFloat(numberInput.value)));
  numberInput.addEventListener('change', () => commitIntensity(parseFloat(numberInput.value)));

  if (distRange && distNumber) {
    let beforeDist = new Map(targets.map(m => [m, m.userData.lightDistance || LIGHT_BLOCK_DISTANCE]));
    const syncDist = value => {
      const d = THREE.MathUtils.clamp(parseFloat(value) || LIGHT_BLOCK_DISTANCE, 1, 500);
      distRange.value = d;
      distNumber.value = d;
      for (const t of targets) setMeshLightDistance(t, d);
    };
    const commitDist = value => {
      const d = THREE.MathUtils.clamp(parseFloat(value) || LIGHT_BLOCK_DISTANCE, 1, 500);
      for (const t of targets) {
        const b = beforeDist.get(t);
        if (b !== undefined && b !== d) pushUndo({ type: 'light-distance', mesh: t, before: b, after: d });
      }
      beforeDist = new Map(targets.map(t => [t, t.userData.lightDistance || LIGHT_BLOCK_DISTANCE]));
      syncDist(d);
    };
    distRange.addEventListener('pointerdown', () => { beforeDist = new Map(targets.map(t => [t, t.userData.lightDistance || LIGHT_BLOCK_DISTANCE])); });
    distRange.addEventListener('input', () => syncDist(distRange.value));
    distRange.addEventListener('change', () => commitDist(distRange.value));
    distNumber.addEventListener('focus', () => { beforeDist = new Map(targets.map(t => [t, t.userData.lightDistance || LIGHT_BLOCK_DISTANCE])); });
    distNumber.addEventListener('input', () => syncDist(distNumber.value));
    distNumber.addEventListener('change', () => commitDist(distNumber.value));
  }
}

function bindEmitLightProps(mesh) {
  const toggle = document.getElementById('prop-emit-toggle');
  if (!toggle || state.selectedObject !== mesh) return;
  toggle.addEventListener('change', () => {
    const targets = getPropertyTargets(mesh).filter(m => m.userData.type !== 'light');
    if (toggle.checked) {
      for (const t of targets) {
        if (!t.userData.pointLight) {
          addLightToMesh(t);
          pushUndo({ type: 'add-light', mesh: t, intensity: t.userData.lightIntensity, distance: t.userData.lightDistance });
        }
      }
    } else {
      for (const t of targets) {
        if (t.userData.pointLight) {
          const intensity = t.userData.lightIntensity;
          const distance = t.userData.lightDistance;
          removeLightFromMesh(t);
          pushUndo({ type: 'remove-light', mesh: t, intensity, distance });
        }
      }
    }
    refreshProps();
  });
}

function bindSolidToggle(mesh) {
  const toggle = document.getElementById('prop-solid-toggle');
  if (!toggle || state.selectedObject !== mesh) return;
  toggle.addEventListener('change', () => {
    const targets = getPropertyTargets(mesh);
    for (const t of targets) {
      const before = t.userData.solid;
      t.userData.solid = toggle.checked;
      if (before !== toggle.checked) pushUndo({ type: 'solid', mesh: t, before, after: toggle.checked });
    }
  });
}

function bindSolidnessProps(mesh) {
  const rangeInput = document.getElementById('prop-solidness-range');
  const numberInput = document.getElementById('prop-solidness-number');
  if (!rangeInput || !numberInput || state.selectedObject !== mesh) return;

  const targets = getPropertyTargets(mesh).filter(t => t.userData.solid !== undefined);
  if (!targets.length) return;

  let before = new Map(targets.map(t => [t, clampMeshSolidness(t.userData.solidness ?? 1)]));

  const syncValue = value => {
    const v = clampMeshSolidness(parseFloat(value));
    rangeInput.value = v;
    numberInput.value = r3(v, 2);
    for (const t of targets) t.userData.solidness = v;
  };

  const commit = value => {
    const v = clampMeshSolidness(parseFloat(value));
    for (const t of targets) {
      const b = before.get(t);
      if (b !== undefined && Math.abs(b - v) > 0.0001) {
        pushUndo({ type: 'solidness', mesh: t, before: b, after: v });
      }
    }
    before = new Map(targets.map(t => [t, clampMeshSolidness(t.userData.solidness ?? 1)]));
    syncValue(v);
  };

  rangeInput.addEventListener('pointerdown', () => { before = new Map(targets.map(t => [t, clampMeshSolidness(t.userData.solidness ?? 1)])); });
  rangeInput.addEventListener('input', () => syncValue(rangeInput.value));
  rangeInput.addEventListener('change', () => commit(rangeInput.value));
  numberInput.addEventListener('focus', () => { before = new Map(targets.map(t => [t, clampMeshSolidness(t.userData.solidness ?? 1)])); });
  numberInput.addEventListener('input', () => syncValue(numberInput.value));
  numberInput.addEventListener('change', () => commit(numberInput.value));
}

function bindOpacityProps(mesh) {
  const rangeInput = document.getElementById('prop-opacity-range');
  const numberInput = document.getElementById('prop-opacity-number');
  if (!rangeInput || !numberInput || state.selectedObject !== mesh) return;

  const targets = getPropertyTargets(mesh).filter(t => t.material);
  if (!targets.length) return;

  let before = new Map(targets.map(t => [t, clampMeshOpacity(t.userData.opacity ?? t.material.opacity ?? 1)]));

  const syncValue = value => {
    const v = clampMeshOpacity(parseFloat(value));
    rangeInput.value = v;
    numberInput.value = r3(v, 2);
    for (const t of targets) setMeshOpacity(t, v);
  };

  const commit = value => {
    const v = clampMeshOpacity(parseFloat(value));
    for (const t of targets) {
      const b = before.get(t);
      if (b !== undefined && Math.abs(b - v) > 0.0001) {
        pushUndo({ type: 'opacity', mesh: t, before: b, after: v });
      }
    }
    before = new Map(targets.map(t => [t, clampMeshOpacity(t.userData.opacity ?? t.material.opacity ?? 1)]));
    syncValue(v);
  };

  rangeInput.addEventListener('pointerdown', () => { before = new Map(targets.map(t => [t, clampMeshOpacity(t.userData.opacity ?? t.material.opacity ?? 1)])); });
  rangeInput.addEventListener('input', () => syncValue(rangeInput.value));
  rangeInput.addEventListener('change', () => commit(rangeInput.value));
  numberInput.addEventListener('focus', () => { before = new Map(targets.map(t => [t, clampMeshOpacity(t.userData.opacity ?? t.material.opacity ?? 1)])); });
  numberInput.addEventListener('input', () => syncValue(numberInput.value));
  numberInput.addEventListener('change', () => commit(numberInput.value));
}

function buildCollisionConfigSnapshot(mesh) {
  return {
    collisionMode: getMeshCollisionMode(mesh),
    hitboxConfig: normalizeHitboxConfig(getMeshHitboxConfig(mesh)),
  };
}

function bindCollisionProps(mesh) {
  const collisionModeInput = document.getElementById('prop-collision-mode');
  if (!collisionModeInput || state.selectedObject !== mesh) return;

  const targets = getPropertyTargets(mesh);
  if (!targets.length) return;

  const applyToTargets = buildNext => {
    let changed = false;
    for (const target of targets) {
      const before = buildCollisionConfigSnapshot(target);
      const after = buildNext(before, target);
      if (!after) continue;
      const beforeSig = JSON.stringify(before);
      const nextState = {
        collisionMode: after.collisionMode === 'geometry' ? 'geometry' : 'aabb',
        hitboxConfig: normalizeHitboxConfig(after.hitboxConfig),
      };
      if (beforeSig === JSON.stringify(nextState)) continue;
      applyMeshCollisionConfig(target, nextState);
      pushUndo({ type: 'collision-config', mesh: target, before, after: nextState });
      changed = true;
    }
    if (changed) refreshProps();
  };

  collisionModeInput.addEventListener('change', () => {
    applyToTargets(before => ({ ...before, collisionMode: collisionModeInput.value }));
  });

  const hitboxModeInput = document.getElementById('prop-hitbox-mode');
  if (hitboxModeInput) {
    hitboxModeInput.addEventListener('change', () => {
      applyToTargets(before => ({
        ...before,
        collisionMode: 'aabb',
        hitboxConfig: { ...before.hitboxConfig, mode: hitboxModeInput.value === 'manual' ? 'manual' : 'auto' },
      }));
    });
  }

  const offsetInputs = ['x', 'y', 'z'].map(axis => document.getElementById(`prop-hitbox-offset-${axis}`));
  const sizeInputs = ['x', 'y', 'z'].map(axis => document.getElementById(`prop-hitbox-size-${axis}`));

  if (offsetInputs.every(Boolean)) {
    const handler = () => {
      applyToTargets(before => ({
        ...before,
        collisionMode: 'aabb',
        hitboxConfig: {
          ...before.hitboxConfig,
          mode: 'manual',
          offset: offsetInputs.map(input => parseFloat(input.value) || 0),
        },
      }));
    };
    offsetInputs.forEach(input => input.addEventListener('change', handler));
  }

  if (sizeInputs.every(Boolean)) {
    const handler = () => {
      applyToTargets(before => ({
        ...before,
        collisionMode: 'aabb',
        hitboxConfig: {
          ...before.hitboxConfig,
          mode: 'manual',
          size: sizeInputs.map(input => Math.abs(parseFloat(input.value) || 0.05)),
        },
      }));
    };
    sizeInputs.forEach(input => input.addEventListener('change', handler));
  }

  document.getElementById('prop-hitbox-autofit')?.addEventListener('click', () => {
    applyToTargets((before, target) => {
      const autoBox = computeAutoHitboxBox(target, new THREE.Vector3(), new THREE.Vector3());
      return {
        ...before,
        collisionMode: 'aabb',
        hitboxConfig: {
          mode: 'manual',
          offset: autoBox.center.toArray(),
          size: autoBox.size.toArray(),
        },
      };
    });
  });
}

function bindShapeParamProps(mesh) {
  const sidesInput = document.getElementById('prop-shape-sides');
  const depthInput = document.getElementById('prop-shape-depth');
  if ((!sidesInput && !depthInput) || state.selectedObject !== mesh) return;

  const type = mesh.userData.type;
  const def = DEFS[type];
  if (!def) return;

  const targets = getPropertyTargets(mesh).filter(t => t.userData.type === type);
  if (!targets.length) return;

  const applyShapeToTargets = patch => {
    for (const t of targets) {
      const beforeParams = normalizeShapeParams(type, t.userData.shapeParams || {});
      const nextParams = normalizeShapeParams(type, { ...beforeParams, ...patch });
      if (JSON.stringify(beforeParams) === JSON.stringify(nextParams)) continue;

      const beforeGeo = t.geometry.clone();
      const afterGeo = buildTypeGeometry(type, nextParams);
      t.userData.shapeParams = nextParams;
      setMeshGeometry(t, afterGeo);
      pushUndo({
        type: 'shape',
        mesh: t,
        beforeParams,
        afterParams: nextParams,
        beforeGeo,
        afterGeo: afterGeo.clone(),
      });
    }
    refreshProps();
  };

  if (sidesInput) {
    sidesInput.addEventListener('change', () => {
      applyShapeToTargets({ sides: clampShapeSides(parseInt(sidesInput.value, 10)) });
    });
  }
  if (depthInput) {
    depthInput.addEventListener('change', () => {
      applyShapeToTargets({ depth: clampShapeDepth(parseFloat(depthInput.value)) });
    });
  }
}

function bindTractionToggle(mesh) {
  const toggle = document.getElementById('prop-traction-toggle');
  if (!toggle || state.selectedObject !== mesh) return;
  toggle.addEventListener('change', () => {
    const targets = getPropertyTargets(mesh);
    for (const t of targets) {
      const before = !!t.userData.traction;
      t.userData.traction = toggle.checked;
      if (before !== toggle.checked) pushUndo({ type: 'traction', mesh: t, before, after: toggle.checked });
    }
  });
}

function isSwitchableObjectType(type) {
  return !['trigger', 'spawn', 'light'].includes(type);
}

function isControlActionHost(mesh) {
  if (!mesh) return false;
  if (mesh.userData.type === 'trigger') return true;
  return isSwitchableObjectType(mesh.userData.type);
}

function bindSwitchProps(mesh) {
  const toggle = document.getElementById('prop-switch-toggle');
  if (!toggle || state.selectedObject !== mesh) return;

  const switchableTargets = getPropertyTargets(mesh).filter(t => isSwitchableObjectType(t.userData.type));
  if (!switchableTargets.length) return;

  toggle.addEventListener('change', () => {
    for (const target of switchableTargets) {
      const config = getMeshSwitchConfig(target);
      config.enabled = toggle.checked;
      target.userData.switchConfig = normalizeSwitchConfig(config);
    }
    refreshProps();
  });

  const varInput = document.getElementById('prop-switch-var');
  const minInput = document.getElementById('prop-switch-min');
  const maxInput = document.getElementById('prop-switch-max');
  const modeInput = document.getElementById('prop-switch-mode');

  if (varInput) {
    varInput.addEventListener('change', () => {
      for (const target of switchableTargets) {
        const config = getMeshSwitchConfig(target);
        config.varKey = String(varInput.value || '').trim() || config.varKey;
        target.userData.switchConfig = normalizeSwitchConfig(config);
      }
    });
  }

  if (minInput) {
    minInput.addEventListener('change', () => {
      const value = parseFloat(minInput.value);
      for (const target of switchableTargets) {
        const config = getMeshSwitchConfig(target);
        config.min = Number.isFinite(value) ? value : config.min;
        target.userData.switchConfig = normalizeSwitchConfig(config);
      }
    });
  }

  if (maxInput) {
    maxInput.addEventListener('change', () => {
      const value = parseFloat(maxInput.value);
      for (const target of switchableTargets) {
        const config = getMeshSwitchConfig(target);
        config.max = Number.isFinite(value) ? value : config.max;
        target.userData.switchConfig = normalizeSwitchConfig(config);
      }
    });
  }

  if (modeInput) {
    modeInput.addEventListener('change', () => {
      for (const target of switchableTargets) {
        const config = getMeshSwitchConfig(target);
        config.runMode = SWITCH_RUN_MODES.includes(modeInput.value) ? modeInput.value : config.runMode;
        target.userData.switchConfig = normalizeSwitchConfig(config);
      }
    });
  }
}

function bindKeypadProps(mesh) {
  if (mesh.userData.type !== 'keypad' || state.selectedObject !== mesh) return;
  const targets = getPropertyTargets(mesh).filter(target => target.userData.type === 'keypad');
  if (!targets.length) return;

  const titleInput = document.getElementById('prop-keypad-title');
  const digitsInput = document.getElementById('prop-keypad-digits');
  const offsetXInput = document.getElementById('prop-keypad-offset-x');
  const offsetYInput = document.getElementById('prop-keypad-offset-y');

  const applyToTargets = updater => {
    for (const target of targets) {
      const next = normalizeKeypadConfig(updater(getMeshKeypadConfig(target)));
      target.userData.keypadConfig = next;
    }
    refreshProps();
  };

  if (titleInput) {
    titleInput.addEventListener('change', () => {
      applyToTargets(before => ({ ...before, title: titleInput.value }));
    });
  }
  if (digitsInput) {
    digitsInput.addEventListener('change', () => {
      applyToTargets(before => ({ ...before, maxDigits: digitsInput.value }));
    });
  }
  if (offsetXInput) {
    offsetXInput.addEventListener('change', () => {
      applyToTargets(before => ({ ...before, offsetX: offsetXInput.value }));
    });
  }
  if (offsetYInput) {
    offsetYInput.addEventListener('change', () => {
      applyToTargets(before => ({ ...before, offsetY: offsetYInput.value }));
    });
  }
}

function bindGroupProp(mesh) {
  const input = document.getElementById('prop-group');
  if (!input || state.selectedObject !== mesh) return;
  input.addEventListener('change', () => {
    const val = normalizeGroupListValue(input.value);
    input.value = val.join(', ');
    const targets = getPropertyTargets(mesh);
    for (const t of targets) setMeshGroups(t, val);
    refreshPlayerProfileUI();
  });
}

function bindMovementPathProps(mesh) {
  if (state.selectedObject !== mesh) return;

  const pathTargets = getPropertyTargets(mesh).filter(m => !['spawn', 'checkpoint', 'trigger'].includes(m.userData.type));
  if (!pathTargets.length) return;

  const withConfig = updater => {
    for (const target of pathTargets) {
      const cfg = getMeshMovementPathConfig(target);
      updater(cfg, target);
      target.userData.movementPath = normalizeMovementPathConfig(cfg);
    }
    refreshSelectedPathPreview();
  };

  const enabledInput = document.getElementById('prop-path-enabled');
  const speedInput = document.getElementById('prop-path-speed');
  const loopInput = document.getElementById('prop-path-loop');
  const addSelectedBtn = document.getElementById('prop-path-add-selected');
  const addCameraBtn = document.getElementById('prop-path-add-camera');
  const clearBtn = document.getElementById('prop-path-clear');

  if (enabledInput) {
    enabledInput.addEventListener('change', () => {
      withConfig(cfg => { cfg.enabled = !!enabledInput.checked; });
    });
  }

  if (speedInput) {
    speedInput.addEventListener('change', () => {
      const speed = Math.max(0.01, parseFloat(speedInput.value) || 0.01);
      speedInput.value = r3(speed, 2);
      withConfig(cfg => { cfg.speed = speed; });
    });
  }

  if (loopInput) {
    loopInput.addEventListener('change', () => {
      withConfig(cfg => { cfg.loop = !!loopInput.checked; });
    });
  }

  if (addSelectedBtn) {
    addSelectedBtn.addEventListener('click', () => {
      const pos = state.selectedObject ? state.selectedObject.position : mesh.position;
      withConfig(cfg => {
        cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [pos.x, pos.y, pos.z], functionName: '' }));
      });
      refreshProps();
    });
  }

  if (addCameraBtn) {
    addCameraBtn.addEventListener('click', () => {
      const cam = activeCameraPosition();
      withConfig(cfg => {
        cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [cam.x, cam.y, cam.z], functionName: '' }));
      });
      refreshProps();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      withConfig(cfg => { cfg.checkpoints = []; });
      clearPathCheckpointViewportPick();
      refreshProps();
    });
  }

  document.querySelectorAll('.prop-path-x').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      const value = parseFloat(input.value);
      withConfig((cfg, target) => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: target.position.toArray() }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.pos[0] = Number.isFinite(value) ? value : cp.pos[0];
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-y').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      const value = parseFloat(input.value);
      withConfig((cfg, target) => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: target.position.toArray() }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.pos[1] = Number.isFinite(value) ? value : cp.pos[1];
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-z').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      const value = parseFloat(input.value);
      withConfig((cfg, target) => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: target.position.toArray() }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.pos[2] = Number.isFinite(value) ? value : cp.pos[2];
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-fn').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [0, 0, 0] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.functionName = input.value.trim();
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-set-sel').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      const pos = state.selectedObject ? state.selectedObject.position : mesh.position;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [pos.x, pos.y, pos.z] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.pos = [pos.x, pos.y, pos.z];
        cfg.checkpoints[idx] = cp;
      });
      refreshProps();
    });
  });

  document.querySelectorAll('.prop-path-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      const selectedUuid = state.selectedObject?.uuid || '';
      const isSamePick = !!(_pendingPathCheckpointPick && _pendingPathCheckpointPick.index === idx && _pendingPathCheckpointPick.meshUuids.includes(selectedUuid));
      if (isSamePick) clearPathCheckpointViewportPick();
      else armPathCheckpointViewportPick(pathTargets, idx);
      refreshProps();
      refreshStatus();
    });
  });

  document.querySelectorAll('.prop-path-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        if (idx >= 0 && idx < cfg.checkpoints.length) cfg.checkpoints.splice(idx, 1);
      });
      if (_pendingPathCheckpointPick && _pendingPathCheckpointPick.index === idx) clearPathCheckpointViewportPick();
      refreshProps();
    });
  });
}

function bindCheckpointProps(mesh) {
  const interactionInput = document.getElementById('prop-checkpoint-interaction');
  if (!interactionInput || state.selectedObject !== mesh) return;

  const checkpointTargets = getPropertyTargets(mesh).filter(t => t.userData.type === 'checkpoint');
  if (!checkpointTargets.length) return;

  interactionInput.addEventListener('change', () => {
    const nextInteraction = CHECKPOINT_INTERACTIONS.includes(interactionInput.value)
      ? interactionInput.value
      : 'touch';
    for (const target of checkpointTargets) {
      const config = getMeshCheckpointConfig(target);
      config.interaction = nextInteraction;
      target.userData.checkpointConfig = normalizeCheckpointConfig(config);
    }
  });
}

function bindTriggerStopProps(mesh) {
  const modeInput = document.getElementById('prop-trigger-stop-mode');
  const fnInput = document.getElementById('prop-trigger-stop-fns');
  if ((!modeInput && !fnInput) || state.selectedObject !== mesh) return;

  const triggerTargets = getPropertyTargets(mesh).filter(t => t.userData.type === 'trigger');
  if (!triggerTargets.length) return;

  if (modeInput) {
    modeInput.addEventListener('change', () => {
      const nextMode = CONTROL_FUNCTION_STOP_MODES.includes(modeInput.value)
        ? modeInput.value
        : 'none';
      for (const target of triggerTargets) {
        const config = getMeshTriggerStopConfig(target);
        config.mode = nextMode;
        target.userData.triggerStopConfig = normalizeTriggerStopConfig(config);
      }
    });
  }

  if (fnInput) {
    fnInput.addEventListener('change', () => {
      const names = normalizeFunctionNameList(fnInput.value);
      fnInput.value = names.join(', ');
      for (const target of triggerTargets) {
        const config = getMeshTriggerStopConfig(target);
        config.functionNames = names;
        target.userData.triggerStopConfig = normalizeTriggerStopConfig(config);
      }
      refreshProps();
    });
  }
}

function bindTargetHealthProp(mesh) {
  const input = document.getElementById('prop-target-hp');
  if (!input || state.selectedObject !== mesh) return;
  input.addEventListener('change', () => {
    const val = Math.max(0, parseInt(input.value) || 0);
    const targets = getPropertyTargets(mesh).filter(t => t.userData.targetMaxHealth !== undefined);
    for (const t of targets) t.userData.targetMaxHealth = val;
  });
}

function bindTriggerRules(mesh) {
  const triggerTargets = getPropertyTargets(mesh).filter(t => t.userData.type === 'trigger');
  if (!triggerTargets.length) return;

  // Bind value inputs for existing rules
  document.querySelectorAll('.tr-rule-val').forEach(input => {
    input.addEventListener('change', () => {
      const key = input.dataset.rule;
      const val = parseFloat(input.value) || 0;
      for (const t of triggerTargets) {
        if (!t.userData.triggerRules) t.userData.triggerRules = {};
        t.userData.triggerRules[key] = val;
      }
    });
  });
  // Bind delete buttons
  document.querySelectorAll('.tr-rule-del').forEach(btn => {
    btn.addEventListener('click', () => {
      for (const t of triggerTargets) {
        if (t.userData.triggerRules) delete t.userData.triggerRules[btn.dataset.rule];
      }
      refreshProps();
    });
  });
  // Bind add button
  const addBtn = document.getElementById('tr-add-rule-btn');
  const addKey = document.getElementById('tr-add-rule-key');
  if (addBtn && addKey) {
    addBtn.addEventListener('click', () => {
      const key = addKey.value;
      if (key) {
        const defaultVal = key === 'health'
          ? Math.min(fpsHealth, gameRules.maxHealth)
          : (gameRules[key] ?? 0);
        for (const t of triggerTargets) {
          if (!t.userData.triggerRules) t.userData.triggerRules = {};
          t.userData.triggerRules[key] = defaultVal;
        }
        refreshProps();
      }
    });
  }
}

function bindControlActions(mesh) {
  const controlTargets = getPropertyTargets(mesh).filter(isControlActionHost);
  if (!controlTargets.length) return;

  const withCall = (index, updater) => {
    for (const target of controlTargets) {
      const calls = ensureTriggerCalls(target);
      while (calls.length <= index) calls.push(createDefaultTriggerCall());
      updater(calls[index], calls, target);
    }
  };

  const withCond = (callIdx, condIdx, updater) => {
    withCall(callIdx, call => {
      if (!call.conditions) call.conditions = [createDefaultCondition()];
      while (call.conditions.length <= condIdx) call.conditions.push(createDefaultCondition());
      updater(call.conditions[condIdx]);
    });
  };

  const addCallBtn = document.getElementById('tr-add-call-btn');
  if (addCallBtn) {
    addCallBtn.addEventListener('click', () => {
      for (const target of controlTargets) {
        const calls = ensureTriggerCalls(target);
        calls.push(createDefaultTriggerCall());
      }
      refreshProps();
    });
  }

  document.querySelectorAll('.tr-call-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.callIndex, 10);
      if (!Number.isFinite(index)) return;
      for (const target of controlTargets) {
        const calls = ensureTriggerCalls(target);
        if (index >= 0 && index < calls.length) calls.splice(index, 1);
      }
      refreshProps();
    });
  });

  document.querySelectorAll('.tr-call-fn').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.callIndex, 10);
      if (!Number.isFinite(index)) return;
      withCall(index, call => { call.functionName = input.value.trim(); });
    });
  });

  // AND/OR logic toggle
  document.querySelectorAll('.tr-cond-logic').forEach(sel => {
    sel.addEventListener('change', () => {
      const index = parseInt(sel.dataset.callIndex, 10);
      if (!Number.isFinite(index)) return;
      withCall(index, call => { call.conditionLogic = sel.value === 'or' ? 'or' : 'and'; });
      refreshProps();
    });
  });

  // Add condition button
  document.querySelectorAll('.tr-add-cond-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.callIndex, 10);
      if (!Number.isFinite(index)) return;
      withCall(index, call => {
        if (!call.conditions) call.conditions = [createDefaultCondition()];
        call.conditions.push(createDefaultCondition());
      });
      refreshProps();
    });
  });

  // Delete condition button
  document.querySelectorAll('.tr-cond-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const ci = parseInt(btn.dataset.callIndex, 10);
      const di = parseInt(btn.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCall(ci, call => {
        if (call.conditions && call.conditions.length > 1) {
          call.conditions.splice(di, 1);
        } else {
          call.conditions = [createDefaultCondition()];
        }
      });
      refreshProps();
    });
  });

  // Condition type change → rebuild UI
  document.querySelectorAll('.tr-cond-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => {
        const newType = CONDITION_TYPES.includes(sel.value) ? sel.value : 'none';
        Object.assign(cond, normalizeCondition({ type: newType }));
      });
      refreshProps();
    });
  });

  // fnDone ref
  document.querySelectorAll('.tr-cond-ref').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.ref = input.value.trim(); });
    });
  });

  // touching ref type
  document.querySelectorAll('.tr-cond-touch-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.touchRefType = sel.value === 'name' ? 'name' : 'group'; });
      refreshProps();
    });
  });

  // touching ref value
  document.querySelectorAll('.tr-cond-touch-ref').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.touchRef = input.value.trim(); });
    });
  });

  // position subject
  document.querySelectorAll('.tr-cond-pos-subj').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.posSubject = input.value.trim() || 'player'; });
    });
  });

  // position axis
  document.querySelectorAll('.tr-cond-pos-axis').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.posAxis = CONDITION_POS_AXES.includes(sel.value) ? sel.value : 'y'; });
    });
  });

  // position op
  document.querySelectorAll('.tr-cond-pos-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.posOp = CONDITION_OPS.includes(sel.value) ? sel.value : '>'; });
    });
  });

  // position value
  document.querySelectorAll('.tr-cond-pos-val').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.posValue = parseFloat(input.value) || 0; });
    });
  });

  // position value source type
  document.querySelectorAll('.tr-cond-pos-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.posValueType = sel.value === 'var' ? 'var' : 'digits'; });
      refreshProps();
    });
  });

  // position value variable
  document.querySelectorAll('.tr-cond-pos-var').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.posValueVar = input.value.trim(); });
    });
  });

  // distance target
  document.querySelectorAll('.tr-cond-dist-target').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.distTarget = input.value.trim(); });
    });
  });

  // distance op
  document.querySelectorAll('.tr-cond-dist-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.distOp = CONDITION_OPS.includes(sel.value) ? sel.value : '<'; });
    });
  });

  // distance value
  document.querySelectorAll('.tr-cond-dist-val').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.distValue = Math.max(0, parseFloat(input.value) || 0); });
    });
  });

  // distance value source type
  document.querySelectorAll('.tr-cond-dist-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.distValueType = sel.value === 'var' ? 'var' : 'digits'; });
      refreshProps();
    });
  });

  // distance value variable
  document.querySelectorAll('.tr-cond-dist-var').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.distValueVar = input.value.trim(); });
    });
  });

  // timer seconds
  document.querySelectorAll('.tr-cond-timer').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.timerSeconds = Math.max(0, parseFloat(input.value) || 0); });
    });
  });

  // timer source type
  document.querySelectorAll('.tr-cond-timer-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.timerType = sel.value === 'var' ? 'var' : 'digits'; });
      refreshProps();
    });
  });

  // timer variable
  document.querySelectorAll('.tr-cond-timer-var').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.timerVar = input.value.trim(); });
    });
  });

  // variable comparison condition
  document.querySelectorAll('.tr-cond-var-name').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.varCmpName = input.value.trim(); });
    });
  });

  document.querySelectorAll('.tr-cond-var-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.varCmpOp = CONDITION_OPS.includes(sel.value) ? sel.value : '='; });
    });
  });

  document.querySelectorAll('.tr-cond-var-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.varCmpValueType = sel.value === 'var' ? 'var' : 'digits'; });
      refreshProps();
    });
  });

  document.querySelectorAll('.tr-cond-var-ref').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.varCmpValueVar = input.value.trim(); });
    });
  });

  document.querySelectorAll('.tr-cond-var-val').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.varCmpValue = Math.trunc(parseFloat(input.value) || 0); });
    });
  });

  // boolean condition
  document.querySelectorAll('.tr-cond-bool-name').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.boolName = input.value.trim(); });
    });
  });

  // key code
  document.querySelectorAll('.tr-cond-key').forEach(sel => {
    sel.addEventListener('change', () => {
      const ci = parseInt(sel.dataset.callIndex, 10);
      const di = parseInt(sel.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.keyCode = sel.value || 'Space'; });
    });
  });

  // negate checkbox
  document.querySelectorAll('.tr-cond-negate').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.negate = input.checked; });
    });
  });
}

function refreshProps() {
  const m = state.selectedObject;
  if (!m) { hideProps(); return; }
  propsPanel.style.display = 'block';
  const p = m.position, q = m.rotation, s = m.scale;
  const def = DEFS[m.userData.type] || {};
  const isSurface = m.material?.color && !['light', 'spawn', 'trigger'].includes(m.userData.type);
  const hasLight = !!m.userData.pointLight;
  const isLightType = m.userData.type === 'light';
  const isSpawn = m.userData.type === 'spawn';
  const isCheckpoint = m.userData.type === 'checkpoint';
  const isTrigger = m.userData.type === 'trigger';
  const isTarget = m.userData.type === 'target';
  const isKeypad = m.userData.type === 'keypad';
  const canToggleSwitch = isSwitchableObjectType(m.userData.type);
  const switchConfig = getMeshSwitchConfig(m);
  const collisionMode = getMeshCollisionMode(m);
  const hitboxConfig = getMeshHitboxConfig(m);
  const autoHitbox = computeAutoHitboxBox(m, new THREE.Vector3(), new THREE.Vector3());
  const activeHitbox = hitboxConfig.mode === 'manual'
    ? { center: new THREE.Vector3().fromArray(hitboxConfig.offset), size: new THREE.Vector3().fromArray(hitboxConfig.size) }
    : autoHitbox;
  const checkpointConfig = isCheckpoint ? getMeshCheckpointConfig(m) : null;
  const keypadConfig = isKeypad ? getMeshKeypadConfig(m) : null;
  const isSwitch = canToggleSwitch && switchConfig.enabled;
  const canEditControlFunctions = isTrigger || canToggleSwitch;
  const switchVarOptions = renderDatalistOptions([...new Set([...SWITCH_VAR_KEYS, ...getKnownVarNames([switchConfig.varKey])])]);

  const surfaceControls = isSurface
    ? `<div class="prop-row"><span class="prop-key">Color</span><div class="prop-controls"><input id="prop-surface-color" type="color" value="${colorHexToCss(m.material.color.getHex())}"/><span id="prop-surface-color-value" class="prop-code">${colorHexToCss(m.material.color.getHex()).toUpperCase()}</span></div></div>`
    : '';

  const shapeParams = normalizeShapeParams(m.userData.type, m.userData.shapeParams || {});
  const shapeControls = (def.usesSides || def.is2D)
    ? `${def.usesSides ? `<div class="prop-row"><span class="prop-key">Sides</span><div class="prop-controls"><input id="prop-shape-sides" type="number" min="3" max="64" step="1" value="${shapeParams.sides ?? clampShapeSides(state.placeSides)}" style="width:64px"/></div></div>` : ''}
       ${def.is2D ? `<div class="prop-row"><span class="prop-key">Depth</span><div class="prop-controls"><input id="prop-shape-depth" type="number" min="0.05" max="8" step="0.05" value="${r3(shapeParams.depth ?? clampShapeDepth(state.place2DDepth), 2)}" style="width:64px"/></div></div>` : ''}`
    : '';

  const solidToggle = `<div class="prop-row"><span class="prop-key">Solid</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-solid-toggle" type="checkbox" ${m.userData.solid ? 'checked' : ''}/> Block</label></div></div>`;
  const solidnessControls = `<div class="prop-row"><span class="prop-key">Dense</span><div class="prop-controls"><input id="prop-solidness-range" type="range" min="0" max="1" step="0.01" value="${clampMeshSolidness(m.userData.solidness ?? 1)}"/><input id="prop-solidness-number" type="number" min="0" max="1" step="0.01" value="${r3(clampMeshSolidness(m.userData.solidness ?? 1), 2)}"/></div></div>`;
  const opacityControls = `<div class="prop-row"><span class="prop-key">Opacity</span><div class="prop-controls"><input id="prop-opacity-range" type="range" min="0.02" max="1" step="0.01" value="${clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1)}"/><input id="prop-opacity-number" type="number" min="0.02" max="1" step="0.01" value="${r3(clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1), 2)}"/></div></div>`;
  const tractionToggle = `<div class="prop-row"><span class="prop-key">Traction</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-traction-toggle" type="checkbox" ${m.userData.traction ? 'checked' : ''}/> Carry XZ</label></div></div>`;
  const collisionControls = `<div class="prop-row"><span class="prop-key">Collision</span><div class="prop-controls"><select id="prop-collision-mode" style="font-size:10px;padding:2px 3px"><option value="aabb" ${collisionMode !== 'geometry' ? 'selected' : ''}>Box</option><option value="geometry" ${collisionMode === 'geometry' ? 'selected' : ''}>Geometry</option></select><span style="color:var(--muted);font-size:9px">geometry follows cut meshes</span></div></div>
    ${collisionMode !== 'geometry' ? `<div class="prop-row"><span class="prop-key">Hitbox</span><div class="prop-controls"><select id="prop-hitbox-mode" style="font-size:10px;padding:2px 3px"><option value="auto" ${hitboxConfig.mode !== 'manual' ? 'selected' : ''}>Auto</option><option value="manual" ${hitboxConfig.mode === 'manual' ? 'selected' : ''}>Manual</option></select><button id="prop-hitbox-autofit" type="button" style="font-size:10px;padding:2px 6px">Auto Fit</button></div></div>
    <div class="prop-row"><span class="prop-key">Auto Box</span><span class="prop-val" style="font-size:9px">${r3(autoHitbox.size.x, 2)} × ${r3(autoHitbox.size.y, 2)} × ${r3(autoHitbox.size.z, 2)}</span></div>
    ${hitboxConfig.mode === 'manual' ? `<div class="prop-row"><span class="prop-key">HB Size</span><div class="prop-controls"><input id="prop-hitbox-size-x" type="number" step="0.05" value="${r3(activeHitbox.size.x, 2)}" style="width:52px"/><input id="prop-hitbox-size-y" type="number" step="0.05" value="${r3(activeHitbox.size.y, 2)}" style="width:52px"/><input id="prop-hitbox-size-z" type="number" step="0.05" value="${r3(activeHitbox.size.z, 2)}" style="width:52px"/></div></div>
    <div class="prop-row"><span class="prop-key">HB Offset</span><div class="prop-controls"><input id="prop-hitbox-offset-x" type="number" step="0.05" value="${r3(activeHitbox.center.x, 2)}" style="width:52px"/><input id="prop-hitbox-offset-y" type="number" step="0.05" value="${r3(activeHitbox.center.y, 2)}" style="width:52px"/><input id="prop-hitbox-offset-z" type="number" step="0.05" value="${r3(activeHitbox.center.z, 2)}" style="width:52px"/></div></div>` : ''}` : ''}`;

  let lightControls = '';
  if (hasLight) {
    const dist = m.userData.lightDistance || LIGHT_BLOCK_DISTANCE;
    lightControls = `
      <div class="prop-row"><span class="prop-key">Bright</span><div class="prop-controls"><input id="prop-light-intensity-range" type="range" min="0" max="100" step="0.1" value="${getMeshLightIntensity(m)}"/><input id="prop-light-intensity-number" type="number" min="0" max="100" step="0.1" value="${r3(getMeshLightIntensity(m), 1)}"/></div></div>
      <div class="prop-row"><span class="prop-key">Aura</span><div class="prop-controls"><input id="prop-light-distance-range" type="range" min="1" max="500" step="1" value="${dist}"/><input id="prop-light-distance-number" type="number" min="1" max="500" step="1" value="${dist}"/></div></div>`;
  }

  const emitToggle = !isLightType
    ? `<div class="prop-row"><span class="prop-key">Emit</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-emit-toggle" type="checkbox" ${hasLight ? 'checked' : ''}/> Light</label></div></div>`
    : '';

  const currentGroups = getMeshGroups(m);
  const groupOptions = renderDatalistOptions(getKnownGroups(currentGroups));

  const groupControls = true
    ? `<div class="prop-row"><span class="prop-key">Groups</span><div class="prop-controls"><input id="prop-group" list="prop-group-options" type="text" value="${escapeHtml(currentGroups.join(', '))}" placeholder="default, teamA" style="width:150px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/><datalist id="prop-group-options">${groupOptions}</datalist></div></div>`
    : '';

  const canEditPath = !['spawn', 'checkpoint', 'trigger'].includes(m.userData.type);
  const pathConfig = getMeshMovementPathConfig(m);
  const pathFnOptions = renderDatalistOptions(getKnownControlFunctionNames(pathConfig.checkpoints.map(cp => cp.functionName)));
  const pathRows = pathConfig.checkpoints.map((cp, idx) => {
    const px = Number.isFinite(cp.pos?.[0]) ? cp.pos[0] : 0;
    const py = Number.isFinite(cp.pos?.[1]) ? cp.pos[1] : 0;
    const pz = Number.isFinite(cp.pos?.[2]) ? cp.pos[2] : 0;
    const pickArmed = !!(_pendingPathCheckpointPick && _pendingPathCheckpointPick.index === idx && _pendingPathCheckpointPick.meshUuids.includes(m.uuid));
    return `<div class="prop-row" style="padding:2px 11px"><span class="prop-key" style="font-size:9px;min-width:24px">#${idx + 1}</span><div class="prop-controls" style="gap:4px;flex-wrap:wrap"><input class="prop-path-x" data-path-index="${idx}" type="number" step="0.1" value="${r3(px, 2)}" style="width:48px"/><input class="prop-path-y" data-path-index="${idx}" type="number" step="0.1" value="${r3(py, 2)}" style="width:48px"/><input class="prop-path-z" data-path-index="${idx}" type="number" step="0.1" value="${r3(pz, 2)}" style="width:48px"/><input class="prop-path-fn" data-path-index="${idx}" list="prop-path-fn-options" type="text" value="${escapeHtml(cp.functionName || '')}" placeholder="on-arrive fn" style="width:94px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 3px;font-size:10px"/><button class="prop-path-set-sel" data-path-index="${idx}" style="font-size:9px;padding:1px 5px">Sel</button><button class="prop-path-pick ${pickArmed ? 'active' : ''}" data-path-index="${idx}" style="font-size:9px;padding:1px 5px">Pick</button><button class="ct-del prop-path-del" data-path-index="${idx}" title="Delete checkpoint">✕</button></div></div>`;
  }).join('');
  const pathControls = canEditPath
    ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Path</span><div class="prop-controls" style="gap:6px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:9px"><input id="prop-path-enabled" type="checkbox" ${pathConfig.enabled ? 'checked' : ''}/> Ready</label><span style="font-size:9px;color:var(--muted)">Speed</span><input id="prop-path-speed" type="number" min="0.01" step="0.1" value="${r3(pathConfig.speed, 2)}" style="width:56px"/><label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:9px"><input id="prop-path-loop" type="checkbox" ${pathConfig.loop ? 'checked' : ''}/> Loop</label></div></div><div class="prop-row" style="padding:2px 11px"><div class="prop-controls" style="gap:4px;flex-wrap:wrap"><button id="prop-path-add-selected" style="font-size:9px;padding:1px 6px">+ Sel Pos</button><button id="prop-path-add-camera" style="font-size:9px;padding:1px 6px">+ Cam Pos</button><button id="prop-path-clear" class="danger-btn" style="font-size:9px;padding:1px 6px">Clear</button><span style="font-size:9px;color:var(--muted)">Call with function action: path -> start</span></div></div><div class="prop-row" style="padding:0 11px 3px 11px"><span style="font-size:9px;color:var(--muted)">Pick = click in viewport to place checkpoint</span></div><datalist id="prop-path-fn-options">${pathFnOptions}</datalist>${pathRows || '<div class="prop-row" style="padding:2px 11px"><span class="prop-val" style="font-size:10px;color:var(--muted)">No checkpoints yet.</span></div>'}`
    : '';

  const switchControls = canToggleSwitch
    ? `<div class="prop-row"><span class="prop-key">Switch</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-switch-toggle" type="checkbox" ${isSwitch ? 'checked' : ''}/> ${isKeypad ? 'Enabled' : 'Shootable'}</label></div></div>`
    : '';

  const switchRangeControls = isSwitch
    ? `<div class="prop-row"><span class="prop-key">Var</span><div class="prop-controls"><input id="prop-switch-var" list="prop-switch-var-options" type="text" value="${escapeHtml(switchConfig.varKey)}" placeholder="hits or codeVar" style="width:118px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/><datalist id="prop-switch-var-options">${switchVarOptions}</datalist><span style="color:var(--muted);font-size:9px">runtime key or game var</span></div></div>
      <div class="prop-row"><span class="prop-key">Range</span><div class="prop-controls"><input id="prop-switch-min" type="number" step="0.1" value="${switchConfig.min}" style="width:56px"/><span style="color:var(--muted);font-size:9px">to</span><input id="prop-switch-max" type="number" step="0.1" value="${switchConfig.max}" style="width:56px"/></div></div>
      <div class="prop-row"><span class="prop-key">Mode</span><div class="prop-controls"><select id="prop-switch-mode" style="font-size:10px;padding:2px 3px"><option value="oneShot" ${switchConfig.runMode === 'oneShot' ? 'selected' : ''}>One Shot</option><option value="repeat" ${switchConfig.runMode === 'repeat' ? 'selected' : ''}>Repeat</option></select><span style="color:var(--muted);font-size:9px">${isKeypad ? 'submit behavior' : 'shoot behavior'}</span></div></div>`
    : '';
  const keypadControls = isKeypad
    ? `<div class="prop-row"><span class="prop-key">Pad Title</span><div class="prop-controls"><input id="prop-keypad-title" type="text" value="${escapeHtml(keypadConfig.title)}" placeholder="Keypad" style="width:150px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/></div></div>
      <div class="prop-row"><span class="prop-key">Digits</span><div class="prop-controls"><input id="prop-keypad-digits" type="number" min="1" max="12" step="1" value="${keypadConfig.maxDigits}" style="width:56px"/><span style="color:var(--muted);font-size:9px">max entry length</span></div></div>
      <div class="prop-row"><span class="prop-key">UI Offset</span><div class="prop-controls"><input id="prop-keypad-offset-x" type="number" step="1" value="${r3(keypadConfig.offsetX, 0)}" style="width:56px"/><input id="prop-keypad-offset-y" type="number" step="1" value="${r3(keypadConfig.offsetY, 0)}" style="width:56px"/><span style="color:var(--muted);font-size:9px">from center</span></div></div>`
    : '';

  const checkpointControls = isCheckpoint
    ? `<div class="prop-row"><span class="prop-key">Checkpt</span><div class="prop-controls"><select id="prop-checkpoint-interaction" style="font-size:10px;padding:2px 3px"><option value="touch" ${checkpointConfig.interaction === 'touch' ? 'selected' : ''}>Touch</option><option value="shoot" ${checkpointConfig.interaction === 'shoot' ? 'selected' : ''}>Shoot</option><option value="switch" ${checkpointConfig.interaction === 'switch' ? 'selected' : ''}>Switch</option></select><span style="color:var(--muted);font-size:9px">sets next respawn</span></div></div>`
    : '';

  // Target health
  const targetControls = isTarget
    ? `<div class="prop-row"><span class="prop-key">Max HP</span><div class="prop-controls"><input id="prop-target-hp" type="number" min="0" max="9999" step="1" value="${m.userData.targetMaxHealth || 0}" style="width:56px"/><span style="color:var(--muted);font-size:9px">0 = invincible</span></div></div>`
    : '';

  // Trigger rules and function calls
  let triggerRulesHtml = '';
  if (isTrigger || canEditControlFunctions) {
    const calls = ensureTriggerCalls(m);
    const functionListId = 'prop-control-function-options';
    const fnNames = getKnownControlFunctionNames();
    const functionOptions = renderDatalistOptions(fnNames);
    const stopConfig = isTrigger ? getMeshTriggerStopConfig(m) : createDefaultTriggerStopConfig();
    const stopFnValue = stopConfig.functionNames.join(', ');

    const rules = m.userData.triggerRules || {};
    const ruleKeys = ['health','jumpHeight','gravity','height','sprintSpeed','maxHealth','fallDamage','fallDamageMinHeight','fallDamageMultiplier'];
    let rulesListHtml = '';
    if (isTrigger) {
      for (const [k, v] of Object.entries(rules)) {
        rulesListHtml += `<div class="prop-row" style="padding:2px 11px"><span class="prop-key" style="font-size:9px;min-width:50px">${k}</span><div class="prop-controls"><input class="tr-rule-val" data-rule="${k}" type="number" step="0.1" value="${v}" style="width:50px;font-size:10px"/><button class="ct-del tr-rule-del" data-rule="${k}">✕</button></div></div>`;
      }
    }

    let callsHtml = '';
    if (!calls.length) {
      callsHtml = `<div class="prop-row" style="padding:2px 11px"><span class="prop-val" style="color:var(--muted);font-size:10px">No calls yet.</span></div>`;
    } else {
      const labelOpts = renderDatalistOptions(getKnownLabels());
      const groupOpts = renderDatalistOptions(getKnownGroups());
      const varOpts = renderDatalistOptions(getKnownVarNames());
      const boolOpts = renderDatalistOptions(getKnownBoolNames());

      const buildCondFields = (cond, ci, di) => {
        const condTypeOpts = CONDITION_TYPES.map(t => {
          const labels = {none:'always',fnDone:'fn done',touching:'touch ref',touchingPlayer:'touching player',position:'position',distance:'distance',timer:'timer',key:'key held',grounded:'grounded',varCmp:'variable',bool:'boolean'};
          return `<option value="${t}" ${cond.type === t ? 'selected' : ''}>${labels[t]}</option>`;
        }).join('');

        let condFields = '';
        const dc = `data-call-index="${ci}" data-cond-index="${di}"`;
        switch (cond.type) {
          case 'fnDone':
            condFields = `<input class="tr-cond-ref" ${dc} list="${functionListId}" type="text" value="${escapeHtml(cond.ref)}" placeholder="fn name" style="width:68px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>`;
            break;
          case 'touching':
            condFields = `<select class="tr-cond-touch-type" ${dc} style="font-size:9px;padding:1px 2px"><option value="group" ${cond.touchRefType==='group'?'selected':''}>grp</option><option value="name" ${cond.touchRefType==='name'?'selected':''}>name</option></select><input class="tr-cond-touch-ref" ${dc} list="tr-cond-${cond.touchRefType === 'name' ? 'label' : 'group'}-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.touchRef)}" placeholder="target" style="width:60px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-label-opts-${ci}-${di}">${labelOpts}</datalist><datalist id="tr-cond-group-opts-${ci}-${di}">${groupOpts}</datalist>`;
            break;
          case 'position':
            condFields = `<input class="tr-cond-pos-subj" ${dc} list="tr-cond-pos-subj-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.posSubject)}" style="width:48px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-pos-subj-opts-${ci}-${di}"><option value="player">${labelOpts}</datalist><select class="tr-cond-pos-axis" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_POS_AXES.map(a => `<option value="${a}" ${cond.posAxis===a?'selected':''}>.${a}</option>`).join('')}</select><select class="tr-cond-pos-op" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_OPS.map(o => `<option value="${o}" ${cond.posOp===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select><select class="tr-cond-pos-type" ${dc} style="font-size:9px;padding:1px 2px"><option value="digits" ${cond.posValueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${cond.posValueType === 'var' ? 'selected' : ''}>var</option></select>${cond.posValueType === 'var' ? `<input class="tr-cond-pos-var" ${dc} list="tr-cond-var-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.posValueVar)}" style="width:64px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-var-opts-${ci}-${di}">${varOpts}</datalist>` : `<input class="tr-cond-pos-val" ${dc} type="number" step="0.1" value="${cond.posValue}" style="width:42px;font-size:9px;padding:1px 3px"/>`}`;
            break;
          case 'distance':
            condFields = `<input class="tr-cond-dist-target" ${dc} list="tr-cond-dist-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.distTarget)}" placeholder="object" style="width:54px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-dist-opts-${ci}-${di}">${labelOpts}</datalist><select class="tr-cond-dist-op" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_OPS.map(o => `<option value="${o}" ${cond.distOp===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select><select class="tr-cond-dist-type" ${dc} style="font-size:9px;padding:1px 2px"><option value="digits" ${cond.distValueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${cond.distValueType === 'var' ? 'selected' : ''}>var</option></select>${cond.distValueType === 'var' ? `<input class="tr-cond-dist-var" ${dc} list="tr-cond-dist-var-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.distValueVar)}" style="width:64px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-dist-var-opts-${ci}-${di}">${varOpts}</datalist>` : `<input class="tr-cond-dist-val" ${dc} type="number" step="0.5" min="0" value="${cond.distValue}" style="width:38px;font-size:9px;padding:1px 3px"/>`}`;
            break;
          case 'timer':
            condFields = `<select class="tr-cond-timer-type" ${dc} style="font-size:9px;padding:1px 2px"><option value="digits" ${cond.timerType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${cond.timerType === 'var' ? 'selected' : ''}>var</option></select>${cond.timerType === 'var' ? `<input class="tr-cond-timer-var" ${dc} list="tr-cond-timer-var-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.timerVar)}" style="width:64px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-timer-var-opts-${ci}-${di}">${varOpts}</datalist>` : `<input class="tr-cond-timer" ${dc} type="number" step="0.1" min="0" value="${cond.timerSeconds}" style="width:42px;font-size:9px;padding:1px 3px"/>`}<span style="font-size:8px;color:var(--muted)">s</span>`;
            break;
          case 'key':
            condFields = `<select class="tr-cond-key" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_KEY_CODES.map(k => `<option value="${k}" ${cond.keyCode===k?'selected':''}>${k.replace('Key','').replace('Digit','').replace('Left','')}</option>`).join('')}</select>`;
            break;
          case 'varCmp':
            condFields = `<input class="tr-cond-var-name" ${dc} list="tr-cond-var-name-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.varCmpName)}" placeholder="var" style="width:64px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-var-name-opts-${ci}-${di}">${varOpts}</datalist><select class="tr-cond-var-op" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_OPS.map(o => `<option value="${o}" ${cond.varCmpOp===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select><select class="tr-cond-var-type" ${dc} style="font-size:9px;padding:1px 2px"><option value="digits" ${cond.varCmpValueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${cond.varCmpValueType === 'var' ? 'selected' : ''}>var</option></select>${cond.varCmpValueType === 'var' ? `<input class="tr-cond-var-ref" ${dc} list="tr-cond-var-ref-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.varCmpValueVar)}" placeholder="var" style="width:64px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-var-ref-opts-${ci}-${di}">${varOpts}</datalist>` : `<input class="tr-cond-var-val" ${dc} type="number" step="1" value="${cond.varCmpValue}" style="width:42px;font-size:9px;padding:1px 3px"/>`}`;
            break;
          case 'bool':
            condFields = `<input class="tr-cond-bool-name" ${dc} list="tr-cond-bool-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.boolName)}" placeholder="bool" style="width:68px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-bool-opts-${ci}-${di}">${boolOpts}</datalist>`;
            break;
          default:
            condFields = '';
        }
        const negateCheck = cond.type !== 'none' ? `<label style="display:flex;align-items:center;gap:2px;font-size:8px;color:var(--muted);cursor:pointer" title="Negate (NOT)"><input class="tr-cond-negate" ${dc} type="checkbox" ${cond.negate ? 'checked' : ''} style="margin:0"/>!</label>` : '';
        const delCond = `<button class="ct-del tr-cond-del" ${dc} title="Remove condition" style="font-size:8px;padding:0 3px">✕</button>`;
        return `<select class="tr-cond-type" ${dc} style="font-size:9px;padding:1px 2px">${condTypeOpts}</select>${condFields}${negateCheck}${delCond}`;
      };

      callsHtml = calls.map((call, idx) => {
        const ci = idx;
        const conds = call.conditions || [normalizeCondition({})];
        const logic = call.conditionLogic || 'and';
        const logicToggle = conds.length > 1
          ? `<select class="tr-cond-logic" data-call-index="${ci}" style="font-size:8px;padding:1px 2px;font-weight:700;color:var(--accentHi)"><option value="and" ${logic==='and'?'selected':''}>ALL</option><option value="or" ${logic==='or'?'selected':''}>ANY</option></select>`
          : '';

        const condRows = conds.map((cond, di) => {
          const prefix = di === 0 ? '' : `<span style="color:var(--accentHi);font-size:7px;font-weight:700;min-width:22px;text-align:center">${logic === 'or' ? 'OR' : 'AND'}</span>`;
          return `<div style="display:flex;align-items:center;gap:3px;flex-wrap:wrap;padding:1px 0">${prefix}${buildCondFields(normalizeCondition(cond), ci, di)}</div>`;
        }).join('');

        const addCondBtn = `<button class="tr-add-cond-btn" data-call-index="${ci}" style="font-size:8px;padding:1px 5px;color:var(--muted);cursor:pointer">+ condition</button>`;

        return `<div style="border-left:2px solid var(--accent);margin:3px 11px;padding:2px 0 2px 6px"><div style="display:flex;align-items:center;gap:4px;padding:1px 0"><span style="font-size:9px;font-weight:700;min-width:20px;color:var(--text)">ƒ${idx+1}</span><input class="tr-call-fn" data-call-index="${ci}" list="${functionListId}" type="text" value="${escapeHtml(call.functionName)}" placeholder="function" style="width:78px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 4px;font-size:10px;font-family:inherit"/><span style="color:var(--accentHi);font-size:8px;font-weight:700">IF</span>${logicToggle}<button class="ct-del tr-call-del" data-call-index="${ci}" title="Remove call" style="margin-left:auto">✕</button></div><div style="padding-left:24px">${condRows}<div style="padding:1px 0">${addCondBtn}</div></div></div>`;
      }).join('');
    }

    triggerRulesHtml = `
      ${isTrigger ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Rules</span></div>
      ${rulesListHtml}
      <div class="prop-row" style="padding:3px 11px"><div class="prop-controls">
        <select id="tr-add-rule-key" style="font-size:10px;padding:2px;flex:1">${ruleKeys.filter(k => !(k in rules)).map(k => `<option value="${k}">${k}</option>`).join('')}</select>
        <button id="tr-add-rule-btn" style="font-size:10px;padding:2px 6px">+</button>
      </div></div>
      <div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Stops</span></div>
      <div class="prop-row" style="padding:2px 11px"><span class="prop-key" style="font-size:9px;min-width:50px">Mode</span><div class="prop-controls"><select id="prop-trigger-stop-mode" style="font-size:10px;padding:2px 3px"><option value="none" ${stopConfig.mode === 'none' ? 'selected' : ''}>None</option><option value="momentary" ${stopConfig.mode === 'momentary' ? 'selected' : ''}>Momentary</option><option value="permanent" ${stopConfig.mode === 'permanent' ? 'selected' : ''}>Permanent</option></select></div></div>
      <div class="prop-row" style="padding:2px 11px"><span class="prop-key" style="font-size:9px;min-width:50px">Fns</span><div class="prop-controls"><input id="prop-trigger-stop-fns" list="${functionListId}" type="text" value="${escapeHtml(stopFnValue)}" placeholder="doorOpen, liftDown" style="width:150px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 4px;font-size:10px"/><span style="color:var(--muted);font-size:9px">comma list</span></div></div>` : ''}
      ${canEditControlFunctions ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Calls</span></div><datalist id="${functionListId}">${functionOptions}</datalist>
      ${callsHtml}
      <div class="prop-row" style="padding:3px 11px"><div class="prop-controls"><button id="tr-add-call-btn" style="font-size:10px;padding:2px 6px">+ Call</button></div></div>` : ''}`;
  }

  const escapedLabel = (m.userData.label || '').replace(/"/g, '&quot;');
  propsContent.innerHTML = `
    <div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${typeLabel(m.userData.type)}</span></div>
    <div class="prop-row"><span class="prop-key">Name</span><div class="prop-controls"><input id="prop-label" type="text" value="${escapedLabel}" placeholder="(none)" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/></div></div>
    <div class="prop-row"><span class="prop-key">Pos</span><span class="prop-val">${r3(p.x)}, ${r3(p.y)}, ${r3(p.z)}</span></div>
    <div class="prop-row"><span class="prop-key">Rot°</span><span class="prop-val">${r3(q.x*R2D,1)}, ${r3(q.y*R2D,1)}, ${r3(q.z*R2D,1)}</span></div>
    <div class="prop-row"><span class="prop-key">Scale</span><span class="prop-val">${r3(s.x)}, ${r3(s.y)}, ${r3(s.z)}</span></div>
    ${m.userData.editorGroupId ? `<div class="prop-row"><span class="prop-key">Group</span><span class="prop-val" style="font-size:9px;color:var(--accentHi)">${m.userData.editorGroupId} (${getEditorGroupMembers(m).length} objects)</span></div>` : ''}
    ${surfaceControls}
    ${shapeControls}
    ${solidToggle}
    ${solidnessControls}
    ${opacityControls}
    ${tractionToggle}
    ${collisionControls}
    ${groupControls}
    ${pathControls}
    ${switchControls}
    ${switchRangeControls}
    ${keypadControls}
    ${checkpointControls}
    ${targetControls}
    ${emitToggle}
    ${lightControls}
    ${triggerRulesHtml}
  `;
  // Wire the Name label input
  {
    const labelInput = document.getElementById('prop-label');
    if (labelInput) {
      const applyLabel = () => { m.userData.label = labelInput.value.trim(); };
      labelInput.addEventListener('change', applyLabel);
      labelInput.addEventListener('blur', applyLabel);
    }
  }

  bindSurfaceProps(m);
  bindShapeParamProps(m);
  bindSolidToggle(m);
  bindSolidnessProps(m);
  bindOpacityProps(m);
  bindTractionToggle(m);
  bindCollisionProps(m);
  if (hasLight) bindLightProps(m);
  if (!isLightType) bindEmitLightProps(m);
  bindGroupProp(m);
  if (canEditPath) bindMovementPathProps(m);
  if (isCheckpoint) bindCheckpointProps(m);
  if (canToggleSwitch) bindSwitchProps(m);
  if (isKeypad) bindKeypadProps(m);
  if (isTarget) bindTargetHealthProp(m);
  if (isTrigger) {
    bindTriggerRules(m);
    bindTriggerStopProps(m);
  }
  if (canEditControlFunctions) bindControlActions(m);
  refreshSelectedPathPreview();
}
function hideProps() { propsPanel.style.display = 'none'; }

// ─── Status bar ───────────────────────────────────────────────────────────────
function refreshStatus() {
  if (state.isPlaytest) {
    const pauseText = runtimeMode
      ? (runtimePauseActive ? 'P · Resume' : 'P · Pause')
      : 'Esc · Exit';
    const playLabel = runtimePauseActive ? '⏸ PAUSED' : '▶ PLAY';
    statusText.innerHTML =
      `<span class="s-play">${playLabel}</span><span class="s-sep">│</span>` +
      `HP: ${Math.ceil(fpsHealth)}/${gameRules.maxHealth}<span class="s-sep">│</span>` +
      `WASD · Move<span class="s-sep">│</span>R · Sprint<span class="s-sep">│</span>Space · Jump<span class="s-sep">│</span>LMB · Shoot<span class="s-sep">│</span>` +
      `${pauseText}<span class="s-sep">│</span>Dev: ${fpsDevView ? 'ON' : 'OFF'}<span class="s-sep">│</span><span class="s-hit">Hits: ${fpsHits}</span>`;
    return;
  }
  const modeLabel = state.mode[0].toUpperCase() + state.mode.slice(1);
  let txt = `<span class="s-mode">${modeLabel}</span><span class="s-sep">│</span>Objects: ${sceneObjects.length}`;
  if (state.mode === 'place')
    txt += `<span class="s-sep">│</span>Placing: ${DEFS[state.placingType].label}`;
  if (state.mode === 'paint')
    txt += `<span class="s-sep">│</span>Brush: ${colorHexToCss(state.brushColor).toUpperCase()}${state.colorPickArmed ? ' (pick armed)' : ''}`;
  if (state.mode === 'erase')
    txt += `<span class="s-sep">│</span>Eraser: ${state.eraserShape} @ ${r3(state.eraserSize, 2)}`;
  if (state.mode === 'place' && state.placingType === 'light')
    txt += `<span class="s-sep">│</span>New Light: ${r3(state.defaultLightIntensity, 1)}`;
  if (state.mode === 'place' && DEFS[state.placingType]?.usesSides)
    txt += `<span class="s-sep">│</span>Sides: ${state.placeSides}`;
  if (state.mode === 'place' && DEFS[state.placingType]?.is2D)
    txt += `<span class="s-sep">│</span>Depth: ${r3(state.place2DDepth, 2)}`;
  if (state.mode === 'place')
    txt += `<span class="s-sep">│</span>Opacity: ${r3(state.placeOpacity, 2)}`;
  txt += `<span class="s-sep">│</span>Sun: ${r3(parseFloat(sunTimeInput.value), 1)}h`;
  txt += `<span class="s-sep">│</span>Grid: ${(state.chunkRenderRadius * 2) + 1}x${(state.chunkRenderRadius * 2) + 1}`;
  if (state.mode === 'select' && state.transformMode === 'scale') {
    const sx = state.scaleSides.x === 'pos' ? '+X' : '-X';
    const sy = state.scaleSides.y === 'pos' ? '+Y' : '-Y';
    const sz = state.scaleSides.z === 'pos' ? '+Z' : '-Z';
    txt += `<span class="s-sep">│</span>Scale Sides: ${sx} ${sy} ${sz}`;
  }
  const selectionCount = (state.selectedObject ? 1 : 0) + state.extraSelected.length;
  if (selectionCount) txt += `<span class="s-sep">│</span>Selected: ${selectionCount}`;
  if (state.selectedObject) {
    const p = state.selectedObject.position;
    txt += `<span class="s-sep">│</span>Sel: ${typeLabel(state.selectedObject.userData.type)} @ ${r3(p.x)},${r3(p.y)},${r3(p.z)}`;
  }
  statusText.innerHTML = txt;
}

function refreshVarPanel() {
  if (!varsListEl) return;
  varsListEl.innerHTML = gameVars.map((entry, index) => `
    <div class="ct-entry" data-var-index="${index}" style="flex-wrap:wrap">
      <div class="sf-row" style="width:100%;gap:4px">
        <span style="font-size:8px;color:var(--muted);min-width:34px">Name</span>
        <input class="var-name" data-var-index="${index}" type="text" value="${escapeHtml(entry.name)}" placeholder="score" style="flex:1;font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>
        <button class="ct-del var-del" data-var-index="${index}" title="Delete variable">✕</button>
      </div>
      <div class="sf-row" style="width:100%;gap:4px">
        <span style="font-size:8px;color:var(--muted);min-width:34px">Start</span>
        <input class="var-default" data-var-index="${index}" type="number" step="1" value="${entry.defaultValue}" style="width:72px;font-size:10px;padding:2px 4px"/>
        <span style="font-size:8px;color:var(--muted)">Now</span>
        <input class="var-runtime" data-var-index="${index}" type="number" step="1" value="${entry.runtimeValue}" style="width:72px;font-size:10px;padding:2px 4px"/>
      </div>
    </div>
  `).join('') || '<div style="font-size:9px;color:var(--muted)">No variables yet.</div>';

  varsListEl.querySelectorAll('.var-name').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.varIndex, 10);
      if (!Number.isFinite(index) || !gameVars[index]) return;
      const candidate = input.value.trim();
      if (!isUniqueNamedEntry(gameVars, index, candidate)) {
        input.value = gameVars[index].name;
        return;
      }
      gameVars[index].name = candidate;
      refreshVarPanel();
      refreshCondTriggerUI();
      refreshControlFunctionsUI();
    });
  });
  varsListEl.querySelectorAll('.var-default').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.varIndex, 10);
      if (!Number.isFinite(index) || !gameVars[index]) return;
      const value = Math.trunc(parseFloat(input.value) || 0);
      gameVars[index].defaultValue = value;
      if (!state.isPlaytest) gameVars[index].runtimeValue = value;
      refreshVarPanel();
    });
  });
  varsListEl.querySelectorAll('.var-runtime').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.varIndex, 10);
      if (!Number.isFinite(index) || !gameVars[index]) return;
      gameVars[index].runtimeValue = Math.trunc(parseFloat(input.value) || 0);
      refreshVarPanel();
    });
  });
  varsListEl.querySelectorAll('.var-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.varIndex, 10);
      if (!Number.isFinite(index)) return;
      gameVars.splice(index, 1);
      refreshVarPanel();
      refreshCondTriggerUI();
      refreshControlFunctionsUI();
    });
  });
}

function refreshBoolPanel() {
  if (!boolsListEl) return;
  boolsListEl.innerHTML = gameBools.map((entry, index) => `
    <div class="ct-entry" data-bool-index="${index}" style="flex-wrap:wrap">
      <div class="sf-row" style="width:100%;gap:4px">
        <span style="font-size:8px;color:var(--muted);min-width:34px">Name</span>
        <input class="bool-name" data-bool-index="${index}" type="text" value="${escapeHtml(entry.name)}" placeholder="doorOpen" style="flex:1;font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>
        <button class="ct-del bool-del" data-bool-index="${index}" title="Delete boolean">✕</button>
      </div>
      <div class="sf-row" style="width:100%;gap:8px">
        <label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--muted)"><span>Start</span><input class="bool-default" data-bool-index="${index}" type="checkbox" ${entry.defaultValue ? 'checked' : ''}/></label>
        <label style="display:flex;align-items:center;gap:4px;font-size:9px;color:var(--muted)"><span>Now</span><input class="bool-runtime" data-bool-index="${index}" type="checkbox" ${entry.runtimeValue ? 'checked' : ''}/></label>
      </div>
    </div>
  `).join('') || '<div style="font-size:9px;color:var(--muted)">No booleans yet.</div>';

  boolsListEl.querySelectorAll('.bool-name').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.boolIndex, 10);
      if (!Number.isFinite(index) || !gameBools[index]) return;
      const candidate = input.value.trim();
      if (!isUniqueNamedEntry(gameBools, index, candidate)) {
        input.value = gameBools[index].name;
        return;
      }
      gameBools[index].name = candidate;
      refreshBoolPanel();
      refreshCondTriggerUI();
      refreshControlFunctionsUI();
    });
  });
  boolsListEl.querySelectorAll('.bool-default').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.boolIndex, 10);
      if (!Number.isFinite(index) || !gameBools[index]) return;
      gameBools[index].defaultValue = input.checked;
      if (!state.isPlaytest) gameBools[index].runtimeValue = input.checked;
      refreshBoolPanel();
    });
  });
  boolsListEl.querySelectorAll('.bool-runtime').forEach(input => {
    input.addEventListener('change', () => {
      const index = parseInt(input.dataset.boolIndex, 10);
      if (!Number.isFinite(index) || !gameBools[index]) return;
      gameBools[index].runtimeValue = input.checked;
      refreshBoolPanel();
    });
  });
  boolsListEl.querySelectorAll('.bool-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.boolIndex, 10);
      if (!Number.isFinite(index)) return;
      gameBools.splice(index, 1);
      refreshBoolPanel();
      refreshCondTriggerUI();
      refreshControlFunctionsUI();
    });
  });
}

// ─── Conditional trigger UI ───────────────────────────────────────────────────
const CT_COND_TYPES = [
  { value: 'health', label: 'Health' },
  { value: 'touching', label: 'Touching Player' },
  { value: 'posY', label: 'Pos Y' },
  { value: 'posX', label: 'Pos X' },
  { value: 'posZ', label: 'Pos Z' },
  { value: 'grounded', label: 'Grounded' },
  { value: 'spawnLanded', label: 'Landed' },
  { value: 'var', label: 'Variable' },
  { value: 'bool', label: 'Boolean' },
];
const CT_COND_SENSES = ['is', 'not'];
const CT_COND_OPS = ['=', '!=', '<', '>', '<=', '>='];
const CT_TOUCH_REF_TYPES = ['group', 'name'];
const CT_RULE_KEYS = ['health','posY','posX','posZ','jumpHeight','gravity','height','sprintSpeed','maxHealth','fallDamage','fallDamageMinHeight','fallDamageMultiplier'];
const CT_ACTION_BASES = ['none','health','posY','posX','posZ','jumpHeight','gravity','height','sprintSpeed','maxHealth','fallDamage','fallDamageMinHeight','fallDamageMultiplier'];
const CT_ACTION_OPS = ['+', '-', '*', '/'];
const CT_MODES = ['if', 'when', 'while'];

function refreshCondTriggerUI() {
  if (!condTriggersListEl) return;
  const knownGroups = getKnownGroups(conditionalTriggers.map(ct => ct.touchRefType === 'group' ? ct.touchRefValue : ''));
  const touchGroupOptions = renderDatalistOptions(knownGroups);
  const knownVars = getKnownVarNames(conditionalTriggers.flatMap(ct => [ct.varCondName, ct.valueVarName, ct.actionValueVar]).filter(Boolean));
  const knownBools = getKnownBoolNames(conditionalTriggers.map(ct => ct.boolCondName).filter(Boolean));
  const varOptions = renderDatalistOptions(knownVars);
  const boolOptions = renderDatalistOptions(knownBools);
  const ruleKeys = [...CT_RULE_KEYS, ...knownVars.map(name => `var:${name}`)];
  const actionBases = [...CT_ACTION_BASES, ...knownVars.map(name => `var:${name}`)];
  condTriggersListEl.innerHTML = conditionalTriggers.map(ct => {
    const isTouchCondition = ct.conditionType === 'touching';
    const isVarCondition = ct.conditionType === 'var';
    const isBoolCondition = ct.conditionType === 'bool';
    const condSense = ct.condSense ?? ((ct.op === 'not') ? 'not' : 'is');
    const condOpRaw = ct.condOp ?? ct.op ?? '=';
    const condOp = condOpRaw === '==' ? '=' : condOpRaw;
    const touchRefType = ct.touchRefType ?? 'group';
    const touchRefValue = ct.touchRefValue ?? '';
    const varCondName = ct.varCondName ?? '';
    const boolCondName = ct.boolCondName ?? '';
    const valueType = ct.valueType === 'var' ? 'var' : 'digits';
    const valueVarName = ct.valueVarName ?? '';
    const actionBase = ct.actionBase ?? ((ct.ruleValueExpr || '').trim() ? 'none' : (ct.ruleKey ?? 'none'));
    const actionOp = ct.actionOp ?? '+';
    const actionValueType = ct.actionValueType === 'var' ? 'var' : 'digits';
    const actionValueVar = ct.actionValueVar ?? '';
    const actionValue = Number.isFinite(parseFloat(ct.actionValue)) ? parseFloat(ct.actionValue) : (Number.isFinite(parseFloat(ct.ruleValue)) ? parseFloat(ct.ruleValue) : 0);
    const intervalHtml = (ct.mode === 'while') ? `<span style="font-size:8px">every</span><input class="ct-interval" type="number" step="0.1" min="0.05" value="${ct.repeatInterval ?? 1}" style="width:34px;font-size:9px;padding:1px 2px"/><span style="font-size:8px">s</span>` : '';
    const conditionDetailHtml = isTouchCondition
      ? `<select class="ct-touch-type" style="font-size:9px;padding:1px 3px">${CT_TOUCH_REF_TYPES.map(type => `<option value="${type}" ${touchRefType === type ? 'selected' : ''}>${type}</option>`).join('')}</select>
      <input class="ct-touch-val" ${touchRefType === 'group' ? 'list="ct-touch-group-options"' : ''} type="text" value="${escapeHtml(touchRefValue)}" style="width:86px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" placeholder="group or name"/>`
      : isVarCondition
      ? `<select class="ct-sense">${CT_COND_SENSES.map(s => `<option value="${s}" ${condSense === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input class="ct-var-name" list="ct-var-options" type="text" value="${escapeHtml(varCondName)}" placeholder="var" style="width:68px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>
      <select class="ct-op">${CT_COND_OPS.map(o => `<option value="${o}" ${condOp === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <select class="ct-val-type" style="font-size:9px;padding:1px 2px"><option value="digits" ${valueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${valueType === 'var' ? 'selected' : ''}>var</option></select>
      ${valueType === 'var' ? `<input class="ct-val-var" list="ct-var-options" type="text" value="${escapeHtml(valueVarName)}" placeholder="var" style="width:68px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>` : `<input class="ct-val" type="number" step="0.1" value="${ct.value}"/>`}`
      : isBoolCondition
      ? `<select class="ct-sense">${CT_COND_SENSES.map(s => `<option value="${s}" ${condSense === s ? 'selected' : ''}>${s}</option>`).join('')}</select><input class="ct-bool-name" list="ct-bool-options" type="text" value="${escapeHtml(boolCondName)}" placeholder="bool" style="width:76px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>`
      : `<select class="ct-sense">${CT_COND_SENSES.map(s => `<option value="${s}" ${condSense === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="ct-op">${CT_COND_OPS.map(o => `<option value="${o}" ${condOp === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <select class="ct-val-type" style="font-size:9px;padding:1px 2px"><option value="digits" ${valueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${valueType === 'var' ? 'selected' : ''}>var</option></select>
      ${valueType === 'var' ? `<input class="ct-val-var" list="ct-var-options" type="text" value="${escapeHtml(valueVarName)}" placeholder="var" style="width:68px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>` : `<input class="ct-val" type="number" step="0.1" value="${ct.value}"/>`}`;
    return `
    <div class="ct-entry" data-ctid="${ct.id}">
      <span style="color:var(--muted);font-size:8px;display:flex;gap:4px;width:100%;align-items:center">
        P:<input class="ct-pri" type="number" step="1" value="${ct.priority ?? 0}" style="width:28px;font-size:9px;padding:1px 2px"/>
        <select class="ct-mode" style="font-size:9px;padding:1px 3px">${CT_MODES.map(m => `<option value="${m}" ${(ct.mode || 'if') === m ? 'selected' : ''}>${m.toUpperCase()}</option>`).join('')}</select>
        ${intervalHtml}
      </span>
      <select class="ct-cond">${CT_COND_TYPES.map(c => `<option value="${c.value}" ${ct.conditionType === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      ${conditionDetailHtml}
      <span class="ct-arrow">\u2192</span>
      <select class="ct-rk">${ruleKeys.map(k => `<option value="${k}" ${ct.ruleKey === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <span style="font-size:9px;color:var(--muted)">=</span>
      <select class="ct-ab">${actionBases.map(k => `<option value="${k}" ${actionBase === k ? 'selected' : ''}>${k === 'none' ? '(none)' : k}</option>`).join('')}</select>
      <select class="ct-aop">${CT_ACTION_OPS.map(o => `<option value="${o}" ${actionOp === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <select class="ct-av-type" style="font-size:9px;padding:1px 2px"><option value="digits" ${actionValueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${actionValueType === 'var' ? 'selected' : ''}>var</option></select>
      ${actionValueType === 'var' ? `<input class="ct-av-var" list="ct-var-options" type="text" value="${escapeHtml(actionValueVar)}" placeholder="var" style="width:68px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>` : `<input class="ct-av" type="number" step="0.1" value="${actionValue}" style="width:50px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>`}
      <span style="font-size:9px;color:var(--muted);width:100%;margin-top:2px">ELSE \u2192</span>
      <select class="ct-erk">
        <option value="" ${!ct.elseRuleKey ? 'selected' : ''}>(none)</option>
        ${ruleKeys.map(k => `<option value="${k}" ${ct.elseRuleKey === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
      <span style="font-size:9px;color:var(--muted)">=</span>
      <input class="ct-ervx" type="text" value="${ct.elseValueExpr ?? ct.elseRuleValue ?? 0}" style="width:60px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" placeholder="val or var+n"/>
      <button class="ct-del" data-ctid="${ct.id}">\u2715</button>
    </div>
  `}).join('') + `<datalist id="ct-touch-group-options">${touchGroupOptions}</datalist><datalist id="ct-var-options">${varOptions}</datalist><datalist id="ct-bool-options">${boolOptions}</datalist>`;
  // Bind change listeners
  condTriggersListEl.querySelectorAll('.ct-entry').forEach(el => {
    const id = parseInt(el.dataset.ctid);
    const ct = conditionalTriggers.find(c => c.id === id);
    if (!ct) return;
    el.querySelector('.ct-pri').addEventListener('change', e => { ct.priority = parseInt(e.target.value) || 0; });
    el.querySelector('.ct-mode').addEventListener('change', e => { ct.mode = e.target.value; refreshCondTriggerUI(); });
    const intervalInput = el.querySelector('.ct-interval');
    if (intervalInput) intervalInput.addEventListener('change', e => { ct.repeatInterval = Math.max(0.05, parseFloat(e.target.value) || 1); });
    el.querySelector('.ct-cond').addEventListener('change', e => {
      ct.conditionType = e.target.value;
      refreshCondTriggerUI();
    });
    const senseInput = el.querySelector('.ct-sense');
    if (senseInput) senseInput.addEventListener('change', e => { ct.condSense = e.target.value; });
    const opInput = el.querySelector('.ct-op');
    if (opInput) opInput.addEventListener('change', e => { ct.condOp = e.target.value; ct.op = e.target.value; });
    const valueTypeInput = el.querySelector('.ct-val-type');
    if (valueTypeInput) valueTypeInput.addEventListener('change', e => { ct.valueType = e.target.value === 'var' ? 'var' : 'digits'; refreshCondTriggerUI(); });
    const valueInput = el.querySelector('.ct-val');
    if (valueInput) valueInput.addEventListener('change', e => { ct.value = parseFloat(e.target.value) || 0; });
    const valueVarInput = el.querySelector('.ct-val-var');
    if (valueVarInput) valueVarInput.addEventListener('change', e => { ct.valueVarName = e.target.value.trim(); });
    const varNameInput = el.querySelector('.ct-var-name');
    if (varNameInput) varNameInput.addEventListener('change', e => { ct.varCondName = e.target.value.trim(); });
    const boolNameInput = el.querySelector('.ct-bool-name');
    if (boolNameInput) boolNameInput.addEventListener('change', e => { ct.boolCondName = e.target.value.trim(); });
    const touchTypeInput = el.querySelector('.ct-touch-type');
    if (touchTypeInput) touchTypeInput.addEventListener('change', e => { ct.touchRefType = e.target.value; });
    const touchValueInput = el.querySelector('.ct-touch-val');
    if (touchValueInput) touchValueInput.addEventListener('change', e => { ct.touchRefValue = e.target.value.trim(); });
    el.querySelector('.ct-rk').addEventListener('change', e => { ct.ruleKey = e.target.value; });
    el.querySelector('.ct-ab').addEventListener('change', e => { ct.actionBase = e.target.value; });
    el.querySelector('.ct-aop').addEventListener('change', e => { ct.actionOp = e.target.value; });
    const actionValueTypeInput = el.querySelector('.ct-av-type');
    if (actionValueTypeInput) actionValueTypeInput.addEventListener('change', e => { ct.actionValueType = e.target.value === 'var' ? 'var' : 'digits'; refreshCondTriggerUI(); });
    const actionValueInput = el.querySelector('.ct-av');
    if (actionValueInput) actionValueInput.addEventListener('change', e => { ct.actionValue = parseFloat(e.target.value) || 0; ct.ruleValue = ct.actionValue; });
    const actionValueVarInput = el.querySelector('.ct-av-var');
    if (actionValueVarInput) actionValueVarInput.addEventListener('change', e => { ct.actionValueVar = e.target.value.trim(); });
    el.querySelector('.ct-erk').addEventListener('change', e => { ct.elseRuleKey = e.target.value || ''; });
    el.querySelector('.ct-ervx').addEventListener('change', e => { ct.elseValueExpr = e.target.value.trim(); ct.elseRuleValue = parseFloat(e.target.value) || 0; });
    el.querySelector('.ct-del').addEventListener('click', () => {
      const idx = conditionalTriggers.findIndex(c => c.id === id);
      if (idx >= 0) conditionalTriggers.splice(idx, 1);
      refreshCondTriggerUI();
    });
  });
}

btnAddCondTrigger.addEventListener('click', () => {
  conditionalTriggers.push({
    id: _nextCtId++,
    conditionType: 'health',
    condSense: 'not',
    condOp: '=',
    op: '=',
    value: 1,
    valueType: 'digits',
    valueVarName: '',
    touchRefType: 'group',
    touchRefValue: 'default',
    varCondName: '',
    boolCondName: '',
    ruleKey: 'health',
    actionBase: 'health',
    actionOp: '-',
    actionValue: 1,
    actionValueType: 'digits',
    actionValueVar: '',
    ruleValue: 1,
    ruleValueExpr: 'health - 1',
    elseRuleKey: '',
    elseRuleValue: 0,
    elseValueExpr: '0',
    priority: 0,
    mode: 'if',
    repeatInterval: 1,
    _fired: false,
  });
  refreshCondTriggerUI();
});

// ─── Control functions UI (project-level function editor) ────────────────────
function refreshControlFunctionsUI() {
  if (!controlFunctionsListEl) return;

  ensureControlFunctionGroups();
  const search = String(controlFnSearchInput?.value ?? '').trim().toLowerCase();
  const visible = controlFunctions
    .map((fn, fnIdx) => ({ fn, fnIdx }))
    .filter(({ fn }) => !search || String(fn.name ?? '').toLowerCase().includes(search));

  const groupOptionsHtml = controlFunctionGroups
    .map(group => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
    .join('');

  const renderFunctionCard = (fn, fnIdx) => {
    const actionsHtml = fn.actions.map((action, actIdx) => {
      const isLight = action.actionType === 'light';
      const isRotate = action.actionType === 'rotate';
      const isAudio = action.actionType === 'audio';
      const isPath = action.actionType === 'path';
      const isFunctionControl = action.actionType === 'functionControl';
      const isPlayerGroup = action.actionType === 'playerGroup';
      const isSetVar = action.actionType === 'setVar';
      const isSetBool = action.actionType === 'setBool';
      const moveOpts = (isPlayerGroup || isFunctionControl || isSetVar || isSetBool) ? '' : getMoveTargetOptions(action.refType, action.refValue);
      const moveListId = `cfn-target-opts-${fnIdx}-${actIdx}`;
      const fnListId = `cfn-fn-opts-${fnIdx}-${actIdx}`;
      const audioListId = `cfn-audio-opts-${fnIdx}-${actIdx}`;
      const varListId = `cfn-var-opts-${fnIdx}-${actIdx}`;
      const boolListId = `cfn-bool-opts-${fnIdx}-${actIdx}`;
      const knownFnNames = renderDatalistOptions(getKnownControlFunctionNames([action.audioUntilFunction, action.functionControlTarget]));
      const knownAudioNames = renderDatalistOptions(getKnownAudioNames([action.audioName]));
      const knownVarNames = renderDatalistOptions(getKnownVarNames([action.setVarName, action.setVarValueVar]));
      const knownBoolNames = renderDatalistOptions(getKnownBoolNames([action.setBoolName]));
      const primaryHtml = isPlayerGroup
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Groups</span><select class="cfn-pg-mode" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${CONTROL_PLAYER_GROUP_MODES.map(mode => `<option value="${mode}" ${action.playerGroupMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select><input class="cfn-pg-value" data-fn="${fnIdx}" data-act="${actIdx}" list="cfn-pg-groups-${fnIdx}-${actIdx}" type="text" value="${escapeHtml(action.playerGroupValue || '')}" placeholder="default, red, blue" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="cfn-pg-groups-${fnIdx}-${actIdx}">${renderDatalistOptions(getKnownGroups())}</datalist></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Random</span><span style="font-size:8px;color:var(--muted)">Use comma list above when mode=random</span></div>`
        : isFunctionControl
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Cmd</span><select class="cfn-fc-cmd" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${FUNCTION_CONTROL_COMMANDS.map(cmd => `<option value="${cmd}" ${action.functionControlCommand === cmd ? 'selected' : ''}>${cmd}</option>`).join('')}</select><input class="cfn-fc-target" data-fn="${fnIdx}" data-act="${actIdx}" list="${fnListId}" type="text" value="${escapeHtml(action.functionControlTarget || '')}" placeholder="doorOpen, musicLoop" style="flex:1;min-width:94px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/></div><datalist id="${fnListId}">${knownFnNames}</datalist>`
        : isPath
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Path</span><select class="cfn-path-cmd" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${PATH_CONTROL_COMMANDS.map(cmd => `<option value="${cmd}" ${action.pathCommand === cmd ? 'selected' : ''}>${cmd}</option>`).join('')}</select><span style="font-size:8px;color:var(--muted)">target path</span></div>`
        : isSetVar
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Var</span><input class="cfn-set-var-name" data-fn="${fnIdx}" data-act="${actIdx}" list="${varListId}" type="text" value="${escapeHtml(action.setVarName || '')}" placeholder="score" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${varListId}">${knownVarNames}</datalist><select class="cfn-set-var-op" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${['=','+','-','*','/'].map(op => `<option value="${op}" ${action.setVarOp === op ? 'selected' : ''}>${op}</option>`).join('')}</select></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Value</span><select class="cfn-set-var-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="digits" ${action.setVarValueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${action.setVarValueType === 'var' ? 'selected' : ''}>var</option></select>${action.setVarValueType === 'var' ? `<input class="cfn-set-var-var" data-fn="${fnIdx}" data-act="${actIdx}" list="${varListId}" type="text" value="${escapeHtml(action.setVarValueVar || '')}" placeholder="var name" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>` : `<input class="cfn-set-var-value" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="1" value="${action.setVarValue}" style="width:72px;font-size:9px"/>`}</div>`
        : isSetBool
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Bool</span><input class="cfn-set-bool-name" data-fn="${fnIdx}" data-act="${actIdx}" list="${boolListId}" type="text" value="${escapeHtml(action.setBoolName || '')}" placeholder="doorOpen" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${boolListId}">${knownBoolNames}</datalist><select class="cfn-set-bool-value" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="true" ${action.setBoolValue === true ? 'selected' : ''}>true</option><option value="false" ${action.setBoolValue === false ? 'selected' : ''}>false</option><option value="toggle" ${action.setBoolValue === 'toggle' ? 'selected' : ''}>toggle</option></select></div>`
        : isAudio
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Audio</span><input class="cfn-audio-name" data-fn="${fnIdx}" data-act="${actIdx}" list="${audioListId}" type="text" value="${escapeHtml(action.audioName || '')}" placeholder="audio name" style="flex:1;min-width:94px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${audioListId}">${knownAudioNames}</datalist></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Mode</span><select class="cfn-audio-mode" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${AUDIO_PLAY_MODES.map(mode => `<option value="${mode}" ${action.audioMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select><span style="font-size:8px;color:var(--muted)">Range</span><input class="cfn-audio-dist" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="1" max="800" step="1" value="${action.audioDistance}" style="width:52px;font-size:9px"/></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Until</span><select class="cfn-audio-until" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${AUDIO_UNTIL_EVENTS.map(ev => `<option value="${ev}" ${action.audioUntil === ev ? 'selected' : ''}>${ev}</option>`).join('')}</select><input class="cfn-audio-until-fn" data-fn="${fnIdx}" data-act="${actIdx}" list="${fnListId}" type="text" value="${escapeHtml(action.audioUntilFunction || '')}" placeholder="fn name" style="width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-audio-loop" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.audioLoop ? 'checked' : ''}/> Loop</label></div><datalist id="${fnListId}">${knownFnNames}</datalist>`
        : isLight
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Light</span><select class="cfn-light-op" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${CONTROL_LIGHT_OPS.map(op => `<option value="${op}" ${action.lightOp === op ? 'selected' : ''}>${op}</option>`).join('')}</select><input class="cfn-light-val" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.lightValue}" style="width:46px;font-size:9px"/></div>`
        : isRotate
          ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">To Rot°</span><input class="cfn-rox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateOffset[0]}" style="width:42px;font-size:9px"/><input class="cfn-roy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateOffset[1]}" style="width:42px;font-size:9px"/><input class="cfn-roz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateOffset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">From Rot°</span><input class="cfn-rsox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateStartOffset[0]}" style="width:42px;font-size:9px"/><input class="cfn-rsoy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateStartOffset[1]}" style="width:42px;font-size:9px"/><input class="cfn-rsoz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateStartOffset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">Spin RPM</span><input class="cfn-rrx" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateRpm[0]}" style="width:42px;font-size:9px"/><input class="cfn-rry" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateRpm[1]}" style="width:42px;font-size:9px"/><input class="cfn-rrz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateRpm[2]}" style="width:42px;font-size:9px"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-rotate-repeat" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.rotateRepeat ? 'checked' : ''}/> Loop</label></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">Pivot</span><select class="cfn-rotate-mode" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="separate" ${action.rotateGroupMode === 'separate' ? 'selected' : ''}>self</option><option value="together" ${action.rotateGroupMode === 'together' ? 'selected' : ''}>group center</option></select></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Anim</span><select class="cfn-style" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="glide" ${action.style === 'glide' ? 'selected' : ''}>glide</option><option value="strict" ${action.style === 'strict' ? 'selected' : ''}>strict</option><option value="snap" ${action.style === 'snap' ? 'selected' : ''}>snap</option></select><input class="cfn-dur" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="0" step="0.1" value="${action.duration}" style="width:46px;font-size:9px" title="Duration (s)"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-return" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.returnOnDeactivate ? 'checked' : ''}/> Return</label></div>`
          : `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">To (orig)</span><input class="cfn-ox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[0]}" style="width:42px;font-size:9px"/><input class="cfn-oy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[1]}" style="width:42px;font-size:9px"/><input class="cfn-oz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">From (orig)</span><input class="cfn-sox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.startOffset[0]}" style="width:42px;font-size:9px"/><input class="cfn-soy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.startOffset[1]}" style="width:42px;font-size:9px"/><input class="cfn-soz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.startOffset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Anim</span><select class="cfn-style" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="glide" ${action.style === 'glide' ? 'selected' : ''}>glide</option><option value="strict" ${action.style === 'strict' ? 'selected' : ''}>strict</option><option value="snap" ${action.style === 'snap' ? 'selected' : ''}>snap</option></select><input class="cfn-dur" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="0" step="0.1" value="${action.duration}" style="width:46px;font-size:9px" title="Duration (s)"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-return" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.returnOnDeactivate ? 'checked' : ''}/> Return</label></div>`;
      const posReadout = (!isLight && !isPlayerGroup && !isFunctionControl && !isAudio && !isPath && !isSetVar && !isSetBool) ? `<div class="cfn-pos-readout" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:8px;color:var(--accentHi);margin-left:34px;min-height:12px;font-family:monospace;opacity:0.8"></div>` : '';
      const targetRefHtml = (isPlayerGroup || isFunctionControl || isSetVar || isSetBool)
        ? `<span style="font-size:8px;color:var(--muted);min-width:56px">player</span>`
        : `<select class="cfn-ref-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="group" ${action.refType === 'group' ? 'selected' : ''}>group</option><option value="name" ${action.refType === 'name' ? 'selected' : ''}>name</option></select><input class="cfn-ref-val" data-fn="${fnIdx}" data-act="${actIdx}" list="${moveListId}" type="text" value="${escapeHtml(action.refValue)}" style="width:70px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${moveListId}">${moveOpts}</datalist>`;
      return `<div style="border-left:2px solid var(--border);margin-left:4px;padding-left:6px;margin-bottom:4px">
        <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">#${actIdx+1}</span>${targetRefHtml}<select class="cfn-action-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="move" ${action.actionType === 'move' ? 'selected' : ''}>move</option><option value="rotate" ${action.actionType === 'rotate' ? 'selected' : ''}>rotate</option><option value="light" ${action.actionType === 'light' ? 'selected' : ''}>light</option><option value="audio" ${action.actionType === 'audio' ? 'selected' : ''}>audio</option><option value="path" ${action.actionType === 'path' ? 'selected' : ''}>path</option><option value="functionControl" ${action.actionType === 'functionControl' ? 'selected' : ''}>function ctrl</option><option value="playerGroup" ${action.actionType === 'playerGroup' ? 'selected' : ''}>player group</option><option value="setVar" ${action.actionType === 'setVar' ? 'selected' : ''}>set var</option><option value="setBool" ${action.actionType === 'setBool' ? 'selected' : ''}>set bool</option></select><button class="ct-del cfn-del-act" data-fn="${fnIdx}" data-act="${actIdx}" title="Remove action">✕</button></div>
        ${primaryHtml}${posReadout}
      </div>`;
    }).join('');

    return `<div class="ct-entry" style="flex-wrap:wrap" data-fn-index="${fnIdx}">
      <div class="sf-row" style="gap:4px;width:100%"><span style="font-size:9px;color:var(--accentHi);font-weight:700">ƒ</span><input class="cfn-name" data-fn="${fnIdx}" type="text" value="${escapeHtml(fn.name)}" placeholder="name" style="flex:1;font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><select class="cfn-group" data-fn="${fnIdx}" style="font-size:9px;padding:1px 3px">${groupOptionsHtml}</select><button class="cfn-sim" data-fn="${fnIdx}" title="Simulate" style="background:none;border:none;color:var(--accentHi);cursor:pointer;font-size:11px;padding:0 2px">▶</button><button class="cfn-sim-reset" data-fn="${fnIdx}" title="Reset" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:10px;padding:0 2px">■</button><button class="ct-del cfn-del-fn" data-fn="${fnIdx}" title="Delete function">✕</button></div>
      ${actionsHtml}
      <button class="cfn-add-act" data-fn="${fnIdx}" style="font-size:8px;padding:1px 5px;margin-left:12px">+ Action</button>
    </div>`;
  };

  const groupedHtml = controlFunctionGroups.map(group => {
    const rows = visible.filter(({ fn }) => fn.groupId === group.id);
    if (!rows.length && search) return '';
    const body = rows.map(({ fn, fnIdx }) => renderFunctionCard(fn, fnIdx)).join('') || '<div style="font-size:9px;color:var(--muted);padding:5px 2px">No functions in this group.</div>';
    const caret = group.collapsed ? '▸' : '▾';
    return `<div class="cfn-group-wrap" data-cfg="${escapeHtml(group.id)}"><button class="cfn-group-toggle" data-cfg="${escapeHtml(group.id)}"><span>${caret} ${escapeHtml(group.name)}</span><span style="opacity:.7">${rows.length}</span></button><div class="cfn-group-body" style="${group.collapsed ? 'display:none' : ''}">${body}</div><button class="cfn-group-add" data-cfg="${escapeHtml(group.id)}">+ Add Function</button></div>`;
  }).join('');

  controlFunctionsListEl.innerHTML = groupedHtml || '<div style="font-size:10px;color:var(--muted);padding:5px 1px">No matching functions.</div>';

  controlFunctionsListEl.querySelectorAll('.cfn-group').forEach(select => {
    const fnIdx = parseInt(select.dataset.fn, 10);
    if (Number.isFinite(fnIdx) && controlFunctions[fnIdx]) {
      select.value = controlFunctions[fnIdx].groupId;
    }
  });

  bindControlFunctionsUI();
}

function bindControlFunctionsUI() {
  if (!controlFunctionsListEl) return;

  const withFnAction = (fnIdx, actIdx, updater) => {
    const fn = controlFunctions[fnIdx];
    if (!fn) return;
    while (fn.actions.length <= actIdx) fn.actions.push(createDefaultFunctionAction());
    updater(fn.actions[actIdx]);
  };

  controlFunctionsListEl.querySelectorAll('.cfn-name').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.fn, 10);
      if (controlFunctions[idx]) controlFunctions[idx].name = input.value.trim();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-group').forEach(select => {
    select.addEventListener('change', () => {
      const idx = parseInt(select.dataset.fn, 10);
      const fn = controlFunctions[idx];
      if (!fn) return;
      if (controlFunctionGroups.some(group => group.id === select.value)) {
        fn.groupId = select.value;
      }
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-group-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = controlFunctionGroups.find(g => g.id === btn.dataset.cfg);
      if (!group) return;
      group.collapsed = !group.collapsed;
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-del-fn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.fn, 10);
      if (idx >= 0 && idx < controlFunctions.length) controlFunctions.splice(idx, 1);
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-sim').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.isPlaytest) return;
      simulateFunction(parseInt(btn.dataset.fn, 10));
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-sim-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.isPlaytest) return;
      resetSimulation();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-add-act').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.fn, 10);
      if (controlFunctions[idx]) controlFunctions[idx].actions.push(createDefaultFunctionAction());
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-del-act').forEach(btn => {
    btn.addEventListener('click', () => {
      const fnIdx = parseInt(btn.dataset.fn, 10);
      const actIdx = parseInt(btn.dataset.act, 10);
      const fn = controlFunctions[fnIdx];
      if (fn && actIdx >= 0 && actIdx < fn.actions.length) fn.actions.splice(actIdx, 1);
      if (fn && !fn.actions.length) fn.actions.push(createDefaultFunctionAction());
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-action-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.actionType = CONTROL_ACTION_TYPES.includes(sel.value) ? sel.value : 'move'; });
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-ref-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.refType = sel.value === 'name' ? 'name' : 'group'; });
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-ref-val').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.refValue = input.value.trim(); });
    });
  });

  const bindCfnNumber = (selector, updater) => {
    controlFunctionsListEl.querySelectorAll(selector).forEach(input => {
      input.addEventListener('change', () => {
        const fnIdx = parseInt(input.dataset.fn, 10);
        const actIdx = parseInt(input.dataset.act, 10);
        const val = parseFloat(input.value) || 0;
        withFnAction(fnIdx, actIdx, a => updater(a, val));
      });
    });
  };

  bindCfnNumber('.cfn-ox', (a, v) => { a.offset[0] = v; });
  bindCfnNumber('.cfn-oy', (a, v) => { a.offset[1] = v; });
  bindCfnNumber('.cfn-oz', (a, v) => { a.offset[2] = v; });
  bindCfnNumber('.cfn-sox', (a, v) => { a.startOffset[0] = v; });
  bindCfnNumber('.cfn-soy', (a, v) => { a.startOffset[1] = v; });
  bindCfnNumber('.cfn-soz', (a, v) => { a.startOffset[2] = v; });
  bindCfnNumber('.cfn-rox', (a, v) => { a.rotateOffset[0] = v; });
  bindCfnNumber('.cfn-roy', (a, v) => { a.rotateOffset[1] = v; });
  bindCfnNumber('.cfn-roz', (a, v) => { a.rotateOffset[2] = v; });
  bindCfnNumber('.cfn-rsox', (a, v) => { a.rotateStartOffset[0] = v; });
  bindCfnNumber('.cfn-rsoy', (a, v) => { a.rotateStartOffset[1] = v; });
  bindCfnNumber('.cfn-rsoz', (a, v) => { a.rotateStartOffset[2] = v; });
  bindCfnNumber('.cfn-rrx', (a, v) => { a.rotateRpm[0] = v; });
  bindCfnNumber('.cfn-rry', (a, v) => { a.rotateRpm[1] = v; });
  bindCfnNumber('.cfn-rrz', (a, v) => { a.rotateRpm[2] = v; });
  bindCfnNumber('.cfn-light-val', (a, v) => { a.lightValue = v; });
  bindCfnNumber('.cfn-dur', (a, v) => { a.duration = Math.max(0, v); });
  bindCfnNumber('.cfn-set-var-value', (a, v) => { a.setVarValue = Math.trunc(v); });

  controlFunctionsListEl.querySelectorAll('.cfn-pg-mode').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => {
        a.playerGroupMode = CONTROL_PLAYER_GROUP_MODES.includes(sel.value) ? sel.value : 'set';
      });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-pg-value').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.playerGroupValue = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-light-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.lightOp = CONTROL_LIGHT_OPS.includes(sel.value) ? sel.value : 'toggle'; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-audio-name').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.audioName = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-audio-mode').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.audioMode = AUDIO_PLAY_MODES.includes(sel.value) ? sel.value : 'global'; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-audio-dist').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.audioDistance = clampAudioDistance(input.value); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-audio-until').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.audioUntil = AUDIO_UNTIL_EVENTS.includes(sel.value) ? sel.value : 'deactivate'; });
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-audio-until-fn').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.audioUntilFunction = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-audio-loop').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.audioLoop = input.checked; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-fc-cmd').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => {
        a.functionControlCommand = FUNCTION_CONTROL_COMMANDS.includes(sel.value) ? sel.value : 'stop';
      });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-fc-target').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.functionControlTarget = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-path-cmd').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => {
        a.pathCommand = PATH_CONTROL_COMMANDS.includes(sel.value) ? sel.value : 'start';
      });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-set-var-name').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.setVarName = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-set-var-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.setVarOp = ['=', '+', '-', '*', '/'].includes(sel.value) ? sel.value : '='; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-set-var-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.setVarValueType = sel.value === 'var' ? 'var' : 'digits'; });
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-set-var-var').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.setVarValueVar = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-set-bool-name').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.setBoolName = input.value.trim(); });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-set-bool-value').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => {
        a.setBoolValue = sel.value === 'toggle' ? 'toggle' : (sel.value === 'true');
      });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-style').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.style = ['glide','strict','snap'].includes(sel.value) ? sel.value : 'glide'; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-return').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.returnOnDeactivate = input.checked; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-rotate-repeat').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.rotateRepeat = input.checked; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-rotate-mode').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.rotateGroupMode = sel.value === 'together' ? 'together' : 'separate'; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-group-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const groupId = String(btn.dataset.cfg || '').trim();
      controlFunctions.push(createDefaultControlFunction(groupId));
      refreshControlFunctionsUI();
    });
  });
}

if (btnAddControlFn) {
  btnAddControlFn.addEventListener('click', () => {
    ensureControlFunctionGroups();
    const defaultGroupId = controlFunctionGroups[0]?.id || '';
    controlFunctions.push(createDefaultControlFunction(defaultGroupId));
    refreshControlFunctionsUI();
  });
}
if (btnAddControlGroup) {
  btnAddControlGroup.addEventListener('click', () => {
    const name = String(controlFnNewGroupInput?.value ?? '').trim();
    if (!name) return;
    controlFunctionGroups.push(createDefaultControlFunctionGroup(name));
    if (controlFnNewGroupInput) controlFnNewGroupInput.value = '';
    refreshControlFunctionsUI();
  });
}
if (controlFnNewGroupInput) {
  controlFnNewGroupInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    btnAddControlGroup?.click();
  });
}
if (controlFnSearchInput) {
  controlFnSearchInput.addEventListener('input', () => refreshControlFunctionsUI());
}

// ─── Quality control helpers ─────────────────────────────────────────────────
const _objPos = new THREE.Vector3();

function applyShadowQuality(level) {
  quality.shadows = level;
  if (level === 'off') {
    renderer.shadowMap.enabled = false;
    sunLight.castShadow = false;
  } else {
    renderer.shadowMap.enabled = true;
    sunLight.castShadow = true;
    const mapSizes = { low: 512, medium: 2048, high: 4096 };
    const sz = mapSizes[level] || 2048;
    sunLight.shadow.mapSize.set(sz, sz);
    if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
  }
  renderer.shadowMap.needsUpdate = true;
}

function updateVisibility(cam) {
  cam.updateMatrixWorld();
  _projScreenMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  const camPos = cam.position;
  const rd2 = quality.renderDist * quality.renderDist;
  const ld2 = quality.lightDist * quality.lightDist;
  const shadowOff = quality.shadows === 'off';

  for (const m of sceneObjects) {
    // Dead targets stay fully hidden.
    if (m.userData._dead) continue;

    // In playtest, Dev View OFF hides only mesh display for hidden editor objects
    // while keeping object runtime behavior (lights/triggers/etc.) active.
    const hideDisplayOnly = state.isPlaytest && m.userData._playtestHidden && !fpsDevView;

    m.getWorldPosition(_objPos);
    const dist2 = camPos.distanceToSquared(_objPos);

    // Render distance: hide blocks too far away
    if (dist2 > rd2) {
      m.visible = false;
      if (m.userData._customSkinActive) {
        if (m.material) m.material.visible = false;
        if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      } else if (m.material) {
        m.material.visible = !hideDisplayOnly;
      }

      if (m.userData.pointLight) {
        m.userData.pointLight.visible = false;
        if (!shadowOff) m.userData.pointLight.castShadow = false;
      }
      continue;
    }

    // Frustum culling: use bounding-sphere test so objects don't pop out
    // before their geometry fully leaves the screen (containsPoint only checks
    // the centre point, intersectsObject checks the whole bounding sphere).
    const inFrustum = _frustum.intersectsObject(m) || dist2 < 100; // always show nearby
    m.visible = inFrustum;
    if (m.userData._customSkinActive) {
      if (m.material) m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = !hideDisplayOnly;
    } else if (m.material) {
      m.material.visible = !hideDisplayOnly;
    }

    // Point light distance culling
    if (m.userData.pointLight) {
      const lightVisible = dist2 < ld2;
      m.userData.pointLight.visible = lightVisible;
      if (!shadowOff) m.userData.pointLight.castShadow = lightVisible && dist2 < ld2 * 0.5;
    }

    // Disable shadow casting for far blocks
    if (!shadowOff) {
      m.castShadow = dist2 < rd2 * 0.6;
    } else {
      m.castShadow = false;
    }
  }
}

qualityRenderDistInput.addEventListener('change', () => {
  setRuntimeRenderDistance(qualityRenderDistInput.value);
  saveEditorSettings();
});
qualityShadowsSelect.addEventListener('change', () => {
  setRuntimeShadowQuality(qualityShadowsSelect.value);
  saveEditorSettings();
});
qualityLightDistInput.addEventListener('change', () => {
  setRuntimeLightDistance(qualityLightDistInput.value);
  saveEditorSettings();
});

function closestRuntimeQualityProfileIndex() {
  let bestIdx = 0;
  let bestScore = Infinity;
  const shadowRank = { off: 0, low: 1, medium: 2, high: 3 };

  for (let i = 0; i < RUNTIME_QUALITY_PROFILES.length; i++) {
    const profile = RUNTIME_QUALITY_PROFILES[i];
    const score =
      Math.abs((shadowRank[quality.shadows] ?? 0) - (shadowRank[profile.shadows] ?? 0)) * 18 +
      Math.abs(quality.renderDist - profile.renderDist) * 0.12 +
      Math.abs(quality.lightDist - profile.lightDist) * 0.2;
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function applyRuntimeQualityProfile(index) {
  const clamped = THREE.MathUtils.clamp(index, 0, RUNTIME_QUALITY_PROFILES.length - 1);
  const profile = RUNTIME_QUALITY_PROFILES[clamped];
  setRuntimeShadowQuality(profile.shadows);
  setRuntimeRenderDistance(profile.renderDist);
  setRuntimeLightDistance(profile.lightDist);
  runtimeOptimizer.lastSwapMs = performance.now();
  runtimeOptimizer.lowFpsStreak = 0;
  runtimeOptimizer.highFpsStreak = 0;
}

function updateRuntimeOptimizer(nowMs, dt) {
  if (!runtimeMode || !state.isPlaytest || runtimePauseActive) return;

  const instantFps = dt > 0 ? (1 / dt) : 60;
  runtimeOptimizer.emaFps = runtimeOptimizer.emaFps * 0.9 + instantFps * 0.1;

  if (nowMs - runtimeOptimizer.lastCheckMs < RUNTIME_OPTIMIZER_CHECK_INTERVAL_MS) return;
  runtimeOptimizer.lastCheckMs = nowMs;

  if (runtimeOptimizer.emaFps < 43) runtimeOptimizer.lowFpsStreak++;
  else runtimeOptimizer.lowFpsStreak = Math.max(0, runtimeOptimizer.lowFpsStreak - 1);

  if (runtimeOptimizer.emaFps > 82) runtimeOptimizer.highFpsStreak++;
  else runtimeOptimizer.highFpsStreak = Math.max(0, runtimeOptimizer.highFpsStreak - 1);

  if (nowMs - runtimeOptimizer.lastSwapMs < RUNTIME_OPTIMIZER_COOLDOWN_MS) return;

  const idx = closestRuntimeQualityProfileIndex();
  if (runtimeOptimizer.autoPerformance && runtimeOptimizer.lowFpsStreak >= 2 && idx > 0) {
    applyRuntimeQualityProfile(idx - 1);
    return;
  }

  if (runtimeOptimizer.autoVisual && runtimeOptimizer.highFpsStreak >= 3 && idx < RUNTIME_QUALITY_PROFILES.length - 1) {
    applyRuntimeQualityProfile(idx + 1);
  }
}

// ─── Animation loop ───────────────────────────────────────────────────────────
const _fwd   = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move  = new THREE.Vector3();
const _next  = new THREE.Vector3();
let lastT = 0;

function animate(t) {
  requestAnimationFrame(animate);
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;

  if (state.isPlaytest) {
    if (runtimeMode && runtimePauseActive) {
      syncFpsCamera();
      updateSunShadowCenter(fpsPos);
      updateGridChunks(fpsPos.x, fpsPos.z);
      updateVisibility(fpsCam);
      updateCheckpointIndicators(t / 1000);
      renderer.render(scene, fpsCam);
      return;
    }

    updateRuntimeOptimizer(t, dt);
    updateTriggerMoveAnimations(t / 1000);
    updateMovementPathAnimations(dt);
    updateRuntimeAudioInstances();
    const dayCycleEnabled = !!(sunDayCycleEnabledInput && sunDayCycleEnabledInput.checked);
    const dayCycleDuration = clampSunDayDuration(parseFloat(sunDayDurationInput.value));
    if (dayCycleEnabled && dayCycleDuration > 0) {
      const curTime = clampSunTime(parseFloat(sunTimeInput.value));
      const hoursPerSecond = 24 / dayCycleDuration;
      const nextTime = (curTime + (hoursPerSecond * dt)) % 24;
      sunTimeInput.value = nextTime.toFixed(3);
      updateSunSky();
    }

    // FPS movement
    _fwd.set(0, 0, -1).applyEuler(new THREE.Euler(0, fpsYaw, 0));
    _right.set(1, 0, 0).applyEuler(new THREE.Euler(0, fpsYaw, 0));
    _move.set(0, 0, 0);
    if (fpsKeys.has('KeyW') || fpsKeys.has('ArrowUp'))    _move.addScaledVector(_fwd, 1);
    if (fpsKeys.has('KeyS') || fpsKeys.has('ArrowDown'))  _move.addScaledVector(_fwd, -1);
    if (fpsKeys.has('KeyA') || fpsKeys.has('ArrowLeft'))  _move.addScaledVector(_right, -1);
    if (fpsKeys.has('KeyD') || fpsKeys.has('ArrowRight')) _move.addScaledVector(_right, 1);
    if (_move.lengthSq() > 0) {
      const speed = fpsSprinting ? gameRules.sprintSpeed : BASE_FPS_SPEED;
      _move.normalize().multiplyScalar(speed * dt);
    }

    refreshSolids();
    applyTractionCarry();
    resolveMovingSolidPushes();

    // Horizontal movement with ground-following for slopes/ramps
    if (_move.x !== 0 || _move.z !== 0) {
      movePlayerHorizontal(_move);
    }

    // Gravity and vertical collision
    if (gameRules.gravityEnabled) {
      fpsVelY -= gameRules.gravity * dt;
      let nextY = fpsPos.y + fpsVelY * dt;

      // Build a test position for vertical checks
      _next.set(fpsPos.x, nextY, fpsPos.z);

      if (fpsVelY <= 0) {
        // Track fall start position
        if (fpsFallStartY === null && !fpsGrounded) fpsFallStartY = fpsPos.y;
        // Falling — find ground
        const groundY = findGroundHeight(fpsPos);
        if (nextY <= groundY) {
          nextY = groundY;
          // Apply fall damage before resetting velocity
          if (fpsFallStartY !== null) {
            const fallDist = fpsFallStartY - nextY;
            applyFallDamage(fallDist);
            fpsFallStartY = null;
          }
          fpsVelY = 0;
          fpsGrounded = true;
        } else {
          fpsGrounded = false;
        }
      } else {
        fpsFallStartY = null; // rising, reset fall tracker
        // Rising — check if player box at nextY collides with any solid
        _next.y = nextY;
        if (collidesAt(_next)) {
          // Binary search to find exact ceiling contact
          let lo = fpsPos.y, hi = nextY;
          for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) / 2;
            _next.y = mid;
            if (collidesAt(_next)) hi = mid; else lo = mid;
          }
          nextY = lo;
          fpsVelY = 0;
        }
        fpsGrounded = false;
      }
      fpsPos.y = Math.max(0, nextY);
      if (fpsPos.y === 0 && fpsVelY === 0) fpsGrounded = true;
    } else {
      const flyDir = (fpsKeys.has('Space') || fpsKeys.has('KeyE') ? 1 : 0) - (fpsKeys.has('ShiftLeft') || fpsKeys.has('KeyQ') ? 1 : 0);
      const flySpeed = (fpsSprinting ? gameRules.sprintSpeed : BASE_FPS_SPEED) * dt;
      if (flyDir !== 0) {
        movePlayerVertical(flyDir * flySpeed);
      }
      fpsVelY = 0;
      fpsGrounded = false;
      fpsFallStartY = null;
    }

    // Track first ground touch after spawn
    if (!fpsSpawnLanded && fpsGrounded) fpsSpawnLanded = true;

    // Spawn protection countdown
    if (fpsSpawnProtectTimer > 0) fpsSpawnProtectTimer -= dt;

    // Trigger block overlap detection
    checkTriggerBlocks();
    checkCheckpointBlocks();

    // Re-evaluate trigger calls continuously so condition changes can start/stop actions.
    for (const [uuid, calls] of _activeTriggerCalls) {
      const mesh = sceneObjects.find(m => m.uuid === uuid);
      if (mesh) evaluateTriggerCalls(mesh);
    }

    // Conditional triggers evaluation
    evaluateConditionalTriggers();

    syncFpsCamera();

    updateSunShadowCenter(fpsPos);
    updateGridChunks(fpsPos.x, fpsPos.z);
    updateVisibility(fpsCam);
    updateCheckpointIndicators(t / 1000);
    renderer.render(scene, fpsCam);
    for (const m of sceneObjects) {
      _playtestPrevPositions.set(m, m.position.clone());
      _playtestPrevRotations.set(m, m.quaternion.clone());
      _playtestPrevAABBs.set(m, new THREE.Box3().setFromObject(m));
    }
  } else {
    if (_simBasePositions.size) {
      updateSimAnimations(t / 1000);
    }
    moveEditorCamera(dt);
    orbitControls.update();
    updateSunShadowCenter(editorCam.position);
    updateGridChunks(editorCam.position.x, editorCam.position.z);
    updateVisibility(editorCam);
    updateCheckpointIndicators(t / 1000);
    renderer.render(scene, editorCam);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
new ResizeObserver(onResize).observe(canvasContainer);
onResize();
setTopMenu(topMenuSelect.value);
loadEditorSettings();
applySidebarState({ save: false, reflow: true });
applyFunctionsPanelState({ save: false, reflow: true });
setLibraryPane(activeLibraryPane, { save: false });
refreshAudioLibraryUI();
setSnap(snapSelect.value);
setDefaultLightIntensity(lightIntensityInput.value);
setPlacementSides(state.placeSides);
setPlacementDepth(state.place2DDepth);
setPlacementOpacity(state.placeOpacity);
setBrushColor(colorHexToCss(state.brushColor));
setEraserShape(state.eraserShape);
setEraserSize(state.eraserSize);
applySunUI();
setChunkRange(chunkRangeSelect.value);
refreshCondTriggerUI();
ensureControlFunctionGroups();
refreshVarPanel();
refreshBoolPanel();
refreshPlayerProfileUI();
refreshControlFunctionsUI();
refreshStatus();

if (runtimeMode) {
  const runtimeEmbeddedLevel = coerceRuntimeLevelPayload(runtimeEmbeddedLevelRaw);
  applyRuntimeChrome();
  if (runtimeEmbeddedLevel) {
    startRuntimeGame(runtimeEmbeddedLevel);
  } else if (runtimeLoaderMode) {
    showStudio();
    showRuntimeLoaderOverlay();
  } else if (runtimeAutostart) {
    startRuntimeGame();
  } else {
    showStudio();
  }
} else {
  showMainMenu();
}
requestAnimationFrame(animate);
