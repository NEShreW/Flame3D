import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Sky }              from 'three/addons/objects/Sky.js';

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

// Player gamerule inputs
const grJumpInput    = document.getElementById('gr-jump');
const grGravityInput = document.getElementById('gr-gravity');
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
const scaleSideXSelect = document.getElementById('scale-side-x');
const scaleSideYSelect = document.getElementById('scale-side-y');
const scaleSideZSelect = document.getElementById('scale-side-z');

// ─── Editor state ────────────────────────────────────────────────────────────
const state = {
  mode:          'place',      // place | select | delete
  placingType:   'wall',       // wall | floor | target | light
  transformMode: 'translate',  // translate | rotate | scale
  snapSize:      1,
  defaultLightIntensity: 3,
  chunkRenderRadius: 2,
  selectedObject: null,
  extraSelected:  [],
  isPlaytest:    false,
  cloneScale:    null,
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

const gameRules = {
  jumpHeight: 8.5,
  gravity: 24,
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
  trigger: {
    label: 'Control',
    makeGeo: () => new THREE.BoxGeometry(2, 2, 2),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xf0a020, emissive: 0xf0a020, emissiveIntensity: 0.3, transparent: true, opacity: 0.35 }),
    placedY: 1,
  },
};

const CONTROL_ACTION_TYPES = ['move', 'light'];
const CONTROL_LIGHT_OPS = ['toggle', 'enable', 'disable', 'intensity', 'distance'];
const CONDITION_TYPES = ['none', 'fnDone', 'touching', 'position', 'distance', 'timer', 'key', 'grounded'];
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
const _controlFunctionStates = new Map();

// ─── Global control functions (project-level) ────────────────────────────────
const controlFunctions = [];
const _activeTriggerCalls = new Map(); // meshUuid -> [{functionName, condition, started, activatedAt}]

function createDefaultSwitchConfig() {
  return {
    enabled: false,
    varKey: 'hits',
    min: 0,
    max: 999999,
  };
}

function normalizeSwitchConfig(config = {}) {
  const base = createDefaultSwitchConfig();
  const varKey = SWITCH_VAR_KEYS.includes(config.varKey) ? config.varKey : base.varKey;
  const min = Number.isFinite(parseFloat(config.min)) ? parseFloat(config.min) : base.min;
  const max = Number.isFinite(parseFloat(config.max)) ? parseFloat(config.max) : base.max;
  return {
    enabled: !!config.enabled,
    varKey,
    min,
    max,
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

function createMesh(type, ghost = false, options = {}) {
  const def = DEFS[type];
  const mat = def.makeMat();
  if (ghost) { mat.transparent = true; mat.opacity = .42; mat.depthWrite = false; }
  const mesh = new THREE.Mesh(def.makeGeo(), mat);
  mesh.castShadow    = !ghost;
  mesh.receiveShadow = !ghost;
  mesh.userData.type = type;
  mesh.userData.solid = type === 'wall' || type === 'floor';
  mesh.userData.traction = false;
  mesh.userData.groups = ['default'];
  mesh.userData.group = 'default';
  mesh.userData.switchConfig = createDefaultSwitchConfig();
  if (type === 'trigger') {
    mesh.userData.triggerRules = {};
    mesh.userData.triggerMoveActions = [];
    mesh.userData.triggerCalls = [];
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
    const bS = transformBefore.sca;
    const cS = m.scale;
    const axis = transformControls.axis; // 'X','Y','Z','XY','XZ','YZ','XYZ' etc.

    // + side edit anchors min face; - side edit anchors max face.
    let px = transformBefore.pos.x;
    let py = transformBefore.pos.y;
    let pz = transformBefore.pos.z;

    if (axis && axis.includes('Y')) {
      const ay = state.scaleSides.y === 'pos' ? bb.min.y : bb.max.y;
      py -= (cS.y - bS.y) * ay;
    }
    if (axis && axis.includes('X')) {
      const ax = state.scaleSides.x === 'pos' ? bb.min.x : bb.max.x;
      px -= (cS.x - bS.x) * ax;
    }
    if (axis && axis.includes('Z')) {
      const az = state.scaleSides.z === 'pos' ? bb.min.z : bb.max.z;
      pz -= (cS.z - bS.z) * az;
    }

    m.position.set(px, py, pz);
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
    hideProps();
  }
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

function ensureGhost(type) {
  if (!ghost || ghost.userData.type !== type) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghost = createMesh(type, true);
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
function getGeoSize(type) {
  if (!_geoSizeCache[type]) {
    const geo = DEFS[type].makeGeo();
    geo.computeBoundingBox();
    _geoSizeCache[type] = geo.boundingBox.getSize(new THREE.Vector3());
    geo.dispose();
  }
  return _geoSizeCache[type];
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

function computeSurfacePlacement(hitPoint, normal, ghostType, scale) {
  const size = getGeoSize(ghostType).clone();
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
  const mesh = createMesh(state.placingType, false, { lightIntensity: state.defaultLightIntensity });
  mesh.position.copy(pos);
  if (state.cloneScale) mesh.scale.copy(state.cloneScale);
  addToScene(mesh);
  pushUndo({ type: 'add', mesh });
  refreshStatus();
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
      touchRefType: ct.touchRefType ?? 'group',
      touchRefValue: ct.touchRefValue ?? '',
      ruleKey: ct.ruleKey,
      actionBase: ct.actionBase ?? 'none',
      actionOp: ct.actionOp ?? '+',
      actionValue: ct.actionValue ?? (ct.ruleValue ?? 0),
      ruleValue: ct.ruleValue,
      ruleValueExpr: ct.ruleValueExpr ?? String(ct.ruleValue),
      elseRuleKey: ct.elseRuleKey || '', elseRuleValue: ct.elseRuleValue ?? 0, elseValueExpr: ct.elseValueExpr ?? String(ct.elseRuleValue ?? 0),
      priority: ct.priority ?? 0, mode: ct.mode || 'if', repeatInterval: ct.repeatInterval ?? 1,
    })),
    controlFunctions: controlFunctions.map(normalizeControlFunction),
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
  // Restore control functions
  if (settings.controlFunctions) {
    controlFunctions.length = 0;
    for (const fn of settings.controlFunctions) {
      controlFunctions.push(normalizeControlFunction(fn));
    }
    refreshControlFunctionsUI();
  }
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
    };
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
    return o;
  });
}

function deserializeObject(d) {
  const mesh = createMesh(d.type, false, { lightIntensity: d.lightIntensity });
  mesh.position.fromArray(d.position);
  mesh.quaternion.fromArray(d.quaternion);
  mesh.scale.fromArray(d.scale);
  if (d.color !== undefined) mesh.material.color.setHex(d.color);
  if (d.solid !== undefined) mesh.userData.solid = d.solid;
  if (d.traction !== undefined) mesh.userData.traction = !!d.traction;
  if (d.label) mesh.userData.label = d.label;
  if (d.groups !== undefined || d.group !== undefined) {
    setMeshGroups(mesh, d.groups ?? d.group);
  }
  if (d.editorGroupId) mesh.userData.editorGroupId = d.editorGroupId;
  if (d.triggerRules) mesh.userData.triggerRules = { ...d.triggerRules };
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

  const inlineMain = `<script type="module">\n${mainSource.replace(/<\//g, '<\\/')}\n<\/script>`;
  const scriptTagRe = /<script\s+type=["']module["']\s+src=["']\.\/main\.js["']\s*><\/script>/i;

  let html = indexSource.replace(scriptTagRe, '').trim();
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${loaderMode ? 'Flame3D Game Loader' : 'Flame3D Game'}</title>`);
  if (!/<\/body>/i.test(html)) throw new Error('Invalid HTML template: missing </body>');
  html = html.replace(/<\/body>/i, `${runtimeFlagsScript}\n${inlineMain}\n</body>`);
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
    sidebarWidth: sidebarState.width,
    sidebarCollapsed: sidebarState.collapsed,
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
    if (s.sidebarWidth != null) sidebarState.width = parseFloat(s.sidebarWidth) || sidebarState.width;
    if (s.sidebarCollapsed != null) sidebarState.collapsed = !!s.sidebarCollapsed;
  } catch { /* corrupt data: ignore */ }
}

function clampSidebarWidth(value) {
  const maxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 220));
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, parseFloat(value) || sidebarState.width || 200));
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

function stopSidebarResize() {
  if (!sidebarState.resizing) return;
  sidebarState.resizing = false;
  if (workspaceEl) workspaceEl.classList.remove('sidebar-resizing');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  applySidebarState({ save: true, reflow: true });
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

function createDefaultFunctionAction() {
  return {
    actionType: 'move',
    refType: 'group',
    refValue: '',
    offset: [0, 0, 0],
    style: 'glide',
    duration: 1,
    returnOnDeactivate: true,
    lightOp: 'toggle',
    lightValue: 3,
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
    offset: normalizeVec(config.offset ?? base.offset),
    style: ['glide', 'strict', 'snap'].includes(config.style) ? config.style : base.style,
    duration: Math.max(0, parseFloat(config.duration) || base.duration),
    returnOnDeactivate: config.returnOnDeactivate !== false,
    lightOp: CONTROL_LIGHT_OPS.includes(config.lightOp) ? config.lightOp : base.lightOp,
    lightValue: Number.isFinite(parseFloat(config.lightValue)) ? parseFloat(config.lightValue) : base.lightValue,
  };
}

function createDefaultControlFunction() {
  return {
    name: '',
    actions: [createDefaultFunctionAction()],
  };
}

function normalizeControlFunction(fn = {}) {
  const actions = Array.isArray(fn.actions) ? fn.actions.map(normalizeFunctionAction) : [];
  return {
    name: String(fn.name ?? '').trim(),
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
    distTarget: String(cond.distTarget ?? '').trim(),
    distOp: CONDITION_OPS.includes(cond.distOp) ? cond.distOp : '<',
    distValue: Math.max(0, Number.isFinite(parseFloat(cond.distValue)) ? parseFloat(cond.distValue) : 5),
    timerSeconds: Math.max(0, Number.isFinite(parseFloat(cond.timerSeconds)) ? parseFloat(cond.timerSeconds) : 1),
    keyCode: String(cond.keyCode ?? 'Space').trim(),
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
          <label style="display:flex;justify-content:space-between;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:9px 10px"><span style="font-size:11px;color:var(--muted)">Dev View</span><input id="rp-dev-view" type="checkbox"/></label>
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
  overlay.querySelector('#rp-dev-view')?.addEventListener('change', e => setPlaytestDevView(!!e.target.checked));
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
    const devViewInput = runtimeSettingsPanelEl.querySelector('#rt-dev-view');
    const autoPerfInput = runtimeSettingsPanelEl.querySelector('#rt-auto-perf');
    const autoVisualInput = runtimeSettingsPanelEl.querySelector('#rt-auto-visual');

    if (shadowSelect) shadowSelect.value = quality.shadows;
    if (renderInput) renderInput.value = quality.renderDist;
    if (lightInput) lightInput.value = quality.lightDist;
    if (cycleInput && sunDayCycleEnabledInput) cycleInput.checked = !!sunDayCycleEnabledInput.checked;
    if (dayDurInput && sunDayDurationInput) dayDurInput.value = clampSunDayDuration(parseFloat(sunDayDurationInput.value));
    if (devViewInput) devViewInput.checked = !!fpsDevView;
    if (autoPerfInput) autoPerfInput.checked = !!runtimeOptimizer.autoPerformance;
    if (autoVisualInput) autoVisualInput.checked = !!runtimeOptimizer.autoVisual;
  }

  if (runtimePauseOverlayEl) {
    const shadowSelect = runtimePauseOverlayEl.querySelector('#rp-quality-shadows');
    const renderInput = runtimePauseOverlayEl.querySelector('#rp-quality-render');
    const lightInput = runtimePauseOverlayEl.querySelector('#rp-quality-light');
    const cycleInput = runtimePauseOverlayEl.querySelector('#rp-day-cycle');
    const dayDurInput = runtimePauseOverlayEl.querySelector('#rp-day-duration');
    const devViewInput = runtimePauseOverlayEl.querySelector('#rp-dev-view');
    const autoPerfInput = runtimePauseOverlayEl.querySelector('#rp-auto-perf');
    const autoVisualInput = runtimePauseOverlayEl.querySelector('#rp-auto-visual');

    if (shadowSelect) shadowSelect.value = quality.shadows;
    if (renderInput) renderInput.value = quality.renderDist;
    if (lightInput) lightInput.value = quality.lightDist;
    if (cycleInput && sunDayCycleEnabledInput) cycleInput.checked = !!sunDayCycleEnabledInput.checked;
    if (dayDurInput && sunDayDurationInput) dayDurInput.value = clampSunDayDuration(parseFloat(sunDayDurationInput.value));
    if (devViewInput) devViewInput.checked = !!fpsDevView;
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
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:10px;color:var(--muted)">Dev View</span><input id="rt-dev-view" type="checkbox"/></div>
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
  panel.querySelector('#rt-dev-view')?.addEventListener('change', e => {
    setPlaytestDevView(!!e.target.checked);
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
  if (mainMenuEl) mainMenuEl.classList.add('hidden');
  if (topbarEl) {
    topbarEl.classList.remove('studio-hidden');
    if (!runtimeMode) topbarEl.style.display = '';
  }
  if (workspaceEl) workspaceEl.classList.remove('studio-hidden');
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
const playerBox = new THREE.Box3();
const _spawnAABB = new THREE.Box3();
const _playtestBasePositions = new Map();
const _playtestPrevPositions = new Map();
const _playtestPrevAABBs = new Map();
const _triggerMoveStates = new Map();
const _triggerMoveTemp = new THREE.Vector3();

// ─── Editor simulation (preview without playtest) ────────────────────────────
const _simBasePositions = new Map(); // mesh -> original Vector3
const _simLightStates = new Map();   // mesh -> { had, intensity, distance }
let _simActive = false;

function ensureSimBasePositions(meshes) {
  for (const mesh of meshes) {
    if (!_simBasePositions.has(mesh)) {
      _simBasePositions.set(mesh, mesh.position.clone());
    }
  }
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
      const prev = _triggerMoveStates.get(stateKey);
      const fromOffset = prev ? prev.currentOffset.clone() : new THREE.Vector3();
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
    } else if (action.actionType === 'light') {
      for (const target of targets) {
        ensureSimLightState(target);
        applyLightActionToMesh(target, action.lightOp, action.lightValue);
      }
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
  _simActive = false;
  refreshControlFunctionsUI();
}

function updateSimAnimations(nowSeconds) {
  const offsetsByMesh = new Map();

  for (const [key, st] of _triggerMoveStates) {
    if (!key.startsWith('sim:')) continue;
    const rawT = st.duration <= 0 ? 1 : THREE.MathUtils.clamp((nowSeconds - st.startedAt) / st.duration, 0, 1);
    let easedT = rawT;
    if (st.style === 'glide') easedT = rawT * rawT * (3 - 2 * rawT);
    else if (st.style === 'snap') easedT = rawT >= 1 ? 1 : 0;

    st.currentOffset.copy(st.fromOffset).lerp(st.toOffset, easedT);

    for (const mesh of st.targets) {
      if (!offsetsByMesh.has(mesh)) offsetsByMesh.set(mesh, new THREE.Vector3());
      offsetsByMesh.get(mesh).add(st.currentOffset);
    }

    if (rawT >= 1 && st.toOffset.lengthSq() === 0) {
      _triggerMoveStates.delete(key);
    }
  }

  for (const [mesh, basePos] of _simBasePositions) {
    const offset = offsetsByMesh.get(mesh);
    if (offset) _triggerMoveTemp.copy(basePos).add(offset);
    else _triggerMoveTemp.copy(basePos);
    mesh.position.copy(_triggerMoveTemp);
  }

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
  for (const [key] of _triggerMoveStates) {
    if (key.startsWith('sim:')) { anySimRunning = true; break; }
  }
  if (!anySimRunning && _simLightStates.size === 0) {
    // Keep positions as-is (final state) but mark inactive
    _simActive = false;
  }
}
const _tractionCarry = new THREE.Vector3();
let fpsDevView = false;

function getPlayHintBaseHtml() {
  if (runtimeMode) {
    return 'WASD · Move &nbsp;│&nbsp; R · Sprint &nbsp;│&nbsp; Space · Jump &nbsp;│&nbsp; Mouse · Look &nbsp;│&nbsp; LMB · Shoot &nbsp;│&nbsp; P · Pause';
  }
  return 'WASD · Move &nbsp;│&nbsp; R · Sprint &nbsp;│&nbsp; Space · Jump &nbsp;│&nbsp; Mouse · Look &nbsp;│&nbsp; LMB · Shoot &nbsp;│&nbsp; Esc · Exit';
}

function updatePlayHint() {
  if (!playHint) return;
  playHint.innerHTML = `${getPlayHintBaseHtml()} &nbsp;│&nbsp; V · Dev View (${fpsDevView ? 'ON' : 'OFF'})`;
}

function setPlaytestDevView(enabled) {
  fpsDevView = !!enabled;
  for (const m of sceneObjects) {
    if (!m.userData._playtestHidden) continue;
    if (m.material) m.material.visible = fpsDevView;
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

function isSolidMesh(mesh) {
  return Boolean(mesh.userData.solid);
}

function refreshSolids() {
  _solidColliders.length = 0;

  // Build one collider per editor group, plus one per ungrouped solid.
  const grouped = new Map();
  for (const m of sceneObjects) {
    if (!isSolidMesh(m)) continue;
    const gid = m.userData.editorGroupId;
    if (gid) {
      if (!grouped.has(gid)) grouped.set(gid, []);
      grouped.get(gid).push(m);
      continue;
    }
    _solidAABB.setFromObject(m);
    _solidColliders.push({ members: [m], aabb: _solidAABB.clone() });
  }

  for (const members of grouped.values()) {
    let seeded = false;
    const aabb = new THREE.Box3();
    for (const m of members) {
      _tmpAABB.setFromObject(m);
      if (!seeded) {
        aabb.copy(_tmpAABB);
        seeded = true;
      } else {
        aabb.union(_tmpAABB);
      }
    }
    if (seeded) _solidColliders.push({ members, aabb });
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

/**
 * Simple full-body AABB collision.
 * Player box: feet at pos.y, head at pos.y + playerHeight.
 * Returns true if player box overlaps any solid mesh's world AABB.
 */
function collidesAt(pos, playerHeight) {
  const pH = playerHeight ?? gameRules.height;
  const sampleXZ = [
    [0, 0],
    [ PLAYER_RADIUS * 0.7, 0],
    [-PLAYER_RADIUS * 0.7, 0],
    [0,  PLAYER_RADIUS * 0.7],
    [0, -PLAYER_RADIUS * 0.7],
  ];
  for (const c of _solidColliders) {
    const aabb = c.aabb;
    // Check all 3 axes overlap
    if (pos.x + PLAYER_RADIUS <= aabb.min.x) continue;
    if (pos.x - PLAYER_RADIUS >= aabb.max.x) continue;
    if (pos.z + PLAYER_RADIUS <= aabb.min.z) continue;
    if (pos.z - PLAYER_RADIUS >= aabb.max.z) continue;
    if (pos.y + pH <= aabb.min.y) continue;  // player entirely below block
    if (pos.y >= aabb.max.y) continue;       // player entirely above block

    // AABB overlap is only broad-phase. Confirm with actual rendered geometry
    // so grouped colliders don't block empty space inside the group bounds.
    let hitGeometry = false;
    for (const [ox, oz] of sampleXZ) {
      _physOrigin.set(pos.x + ox, pos.y + 0.01, pos.z + oz);
      _physRay.set(_physOrigin, _upDir);
      _physRay.near = 0;
      _physRay.far  = pH + 0.05;
      const hits = _physRay.intersectObjects(c.members, false);
      if (hits.length > 0) {
        hitGeometry = true;
        break;
      }
    }
    if (hitGeometry) return true;
  }
  return false;
}

/**
 * Check only horizontal + body-above-step collision (for walk movement).
 * Ignores the bottom STEP_HEIGHT of the player so small ledges don't block.
 */
function collidesWalk(pos) {
  const bodyBot = pos.y + STEP_HEIGHT;
  const bodyTop = pos.y + gameRules.height;
  for (const c of _solidColliders) {
    const aabb = c.aabb;
    if (pos.x + PLAYER_RADIUS <= aabb.min.x) continue;
    if (pos.x - PLAYER_RADIUS >= aabb.max.x) continue;
    if (pos.z + PLAYER_RADIUS <= aabb.min.z) continue;
    if (pos.z - PLAYER_RADIUS >= aabb.max.z) continue;
    if (bodyTop <= aabb.min.y) continue;
    if (bodyBot >= aabb.max.y) continue;

    // AABB says overlap. Confirm against rendered triangles for this collider
    // so grouped ramps/walls share one collider but still use true geometry.
    _physOrigin.set(pos.x, pos.y + gameRules.height + 0.1, pos.z);
    _physRay.set(_physOrigin, _downDir);
    _physRay.near = 0;
    _physRay.far  = gameRules.height + STEP_HEIGHT + 0.2;
    const hits = _physRay.intersectObjects(c.members, false);
    let hasSupport = false;
    for (const h of hits) {
      if (h.point.y <= pos.y + STEP_HEIGHT + 0.01) {
        hasSupport = true;
        break;
      }
    }
    if (hasSupport) continue;

    // If the player's body does not actually intersect any rendered triangles,
    // this is just empty space inside the collider bounds and should stay walkable.
    if (!colliderIntersectsBody(c, pos, bodyBot, bodyTop)) continue;

    return true;
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
      if (hit.point.y > fpsPos.y + 0.05) continue;
      if (fpsPos.y - hit.point.y > maxDrop) continue;
      if (hit.point.y > bestY) {
        bestY = hit.point.y;
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
  if (!prevPos) return;

  _tractionCarry.set(
    supportMesh.position.x - prevPos.x,
    0,
    supportMesh.position.z - prevPos.z,
  );
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
  const spawn = sceneObjects.find(m => m.userData.type === 'spawn');
  if (!spawn) return null;

  _spawnAABB.setFromObject(spawn);
  const center = spawn.getWorldPosition(new THREE.Vector3());
  return {
    pos: new THREE.Vector3(center.x, _spawnAABB.min.y + 0.01, center.z),
    yaw: spawn.rotation.y,
    pitch: 0,
  };
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

function setControlMoveActionState(stateKey, action, targetOffset, callerMesh) {
  if (!targetOffset) {
    _triggerMoveStates.delete(stateKey);
    return;
  }

  const prev = _triggerMoveStates.get(stateKey);
  const fromOffset = prev ? prev.currentOffset.clone() : new THREE.Vector3();
  _triggerMoveStates.set(stateKey, {
    callerUuid: callerMesh?.uuid ?? null,
    targets: triggerMoveTargets(action.refType, action.refValue),
    fromOffset,
    toOffset: new THREE.Vector3(targetOffset[0], targetOffset[1], targetOffset[2]),
    currentOffset: fromOffset.clone(),
    startedAt: performance.now() / 1000,
    duration: action.duration,
    style: action.style,
    functionName: stateKey.split(':')[0], // extract fn name from key
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

function executeControlFunction(functionName, callerMesh, active) {
  const func = getControlFunctionByName(functionName);
  if (!func) return;
  const nowSeconds = performance.now() / 1000;
  let hasMoveAction = false;

  for (let i = 0; i < func.actions.length; i++) {
    const action = normalizeFunctionAction(func.actions[i]);
    if (!action.refValue) continue;

    if (action.actionType === 'move') {
      hasMoveAction = true;
      const stateKey = `${func.name}:${i}`;
      if (!active && !action.returnOnDeactivate) continue; // keep current state
      const targetOffset = active ? action.offset : [0, 0, 0];
      setControlMoveActionState(stateKey, action, targetOffset, callerMesh);
      const st = _triggerMoveStates.get(stateKey);
      if (st) { st.callerUuid = callerMesh?.uuid ?? null; st.startedAt = nowSeconds; }
    } else if (action.actionType === 'light') {
      const targets = triggerMoveTargets(action.refType, action.refValue);
      for (const target of targets) applyLightActionToMesh(target, action.lightOp, action.lightValue);
    }
  }

  // When a new function with move actions starts, un-mark all OTHER functions
  if (active && hasMoveAction) {
    const thisKey = normalizeControlFunctionKey(func.name);
    for (const [key, entry] of _controlFunctionStates) {
      if (key !== thisKey && entry.met) {
        entry.met = false;
      }
    }
  }

  // Light-only functions complete immediately
  if (active && !hasMoveAction) {
    markControlFunctionMet(func.name, callerMesh);
  }
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
      result = false;
      const pH = gameRules.height;
      for (const t of targets) {
        _condAABB.setFromObject(t);
        if (fpsPos.x + PLAYER_RADIUS > _condAABB.min.x &&
            fpsPos.x - PLAYER_RADIUS < _condAABB.max.x &&
            fpsPos.z + PLAYER_RADIUS > _condAABB.min.z &&
            fpsPos.z - PLAYER_RADIUS < _condAABB.max.z &&
            fpsPos.y + pH > _condAABB.min.y &&
            fpsPos.y < _condAABB.max.y) {
          result = true;
          break;
        }
      }
      break;
    }
    case 'position': {
      let pos;
      if (!cond.posSubject || cond.posSubject === 'player') {
        pos = fpsPos;
      } else {
        const target = sceneObjects.find(m => (m.userData.label || '').toLowerCase() === cond.posSubject.toLowerCase());
        pos = target ? target.position : null;
      }
      result = pos ? compareOp(pos[cond.posAxis], cond.posOp, cond.posValue) : false;
      break;
    }
    case 'distance': {
      const target = sceneObjects.find(m => (m.userData.label || '').toLowerCase() === cond.distTarget.toLowerCase());
      if (target) {
        const dist = fpsPos.distanceTo(target.position);
        result = compareOp(dist, cond.distOp, cond.distValue);
      } else {
        result = false;
      }
      break;
    }
    case 'timer': {
      const elapsed = (performance.now() / 1000) - (activatedAt || 0);
      result = elapsed >= cond.timerSeconds;
      break;
    }
    case 'key':
      result = fpsKeys.has(cond.keyCode);
      break;
    case 'grounded':
      result = fpsGrounded;
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
  for (const call of pending) {
    if (call.started) continue;
    if (!evaluateCallConditions(call, mesh)) continue;
    call.started = true;
    executeControlFunction(call.functionName, mesh, true);
  }
}

function activateControlMesh(controllerMesh, options = {}) {
  const calls = ensureTriggerCalls(controllerMesh);
  if (!calls.length) return;
  const now = performance.now() / 1000;
  _activeTriggerCalls.set(controllerMesh.uuid, calls.map(c => ({ ...c, started: false, activatedAt: now })));
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

  activateControlMesh(mesh);
  return true;
}

function updateTriggerMoveAnimations(nowSeconds) {
  if (!_playtestBasePositions.size) return;

  const offsetsByMesh = new Map();
  let anyFunctionJustCompleted = false;

  for (const [key, st] of _triggerMoveStates) {
    const rawT = st.duration <= 0 ? 1 : THREE.MathUtils.clamp((nowSeconds - st.startedAt) / st.duration, 0, 1);
    let easedT = rawT;
    if (st.style === 'glide') easedT = rawT * rawT * (3 - 2 * rawT);
    else if (st.style === 'snap') easedT = rawT >= 1 ? 1 : 0;

    st.currentOffset.copy(st.fromOffset).lerp(st.toOffset, easedT);

    for (const mesh of st.targets) {
      if (!offsetsByMesh.has(mesh)) offsetsByMesh.set(mesh, new THREE.Vector3());
      offsetsByMesh.get(mesh).add(st.currentOffset);
    }

    if (rawT >= 1 && st.toOffset.lengthSq() === 0) {
      _triggerMoveStates.delete(key);
    }

    if (rawT >= 1 && st.functionName && !st.functionMarked) {
      markControlFunctionMet(st.functionName);
      st.functionMarked = true;
      anyFunctionJustCompleted = true;
    }
  }

  // Re-evaluate pending calls when a function just completed
  if (anyFunctionJustCompleted) {
    for (const [uuid, calls] of _activeTriggerCalls) {
      if (calls.some(c => !c.started)) {
        const mesh = sceneObjects.find(m => m.uuid === uuid);
        if (mesh) evaluateTriggerCalls(mesh);
      }
    }
  }

  for (const [mesh, basePos] of _playtestBasePositions) {
    const offset = offsetsByMesh.get(mesh);
    if (offset) _triggerMoveTemp.copy(basePos).add(offset);
    else _triggerMoveTemp.copy(basePos);
    mesh.position.copy(_triggerMoveTemp);
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
  const spawnState = getSpawnBlockState() ?? { pos: fpsSpawnPos.clone(), yaw: fpsSpawnYaw, pitch: fpsSpawnPitch };
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
const _condAABB = new THREE.Box3();
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
      // Apply gamerule overrides
      const rules = m.userData.triggerRules;
      if (rules) {
        for (const [key, val] of Object.entries(rules)) {
          applyCtAction(key, String(val));
        }
      }
    } else if (!overlap) {
      if (_activeTriggers.has(m)) deactivateControlMesh(m);
      _activeTriggers.delete(m);
    }
  }
}

// ─── Conditional triggers ────────────────────────────────────────────────────
const conditionalTriggers = [];
let _nextCtId = 1;

function normalizeTouchRef(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isPlayerTouchingRef(refType, refValue) {
  const needle = normalizeTouchRef(refValue);
  if (!needle) return false;

  playerBox.min.set(fpsPos.x - PLAYER_RADIUS, fpsPos.y, fpsPos.z - PLAYER_RADIUS);
  playerBox.max.set(fpsPos.x + PLAYER_RADIUS, fpsPos.y + gameRules.height, fpsPos.z + PLAYER_RADIUS);

  for (const m of sceneObjects) {
    const match = refType === 'name'
      ? normalizeTouchRef(m.userData.label) === needle
      : meshHasGroup(m, needle);
    if (!match) continue;
    _tmpAABB.setFromObject(m);
    if (playerBox.intersectsBox(_tmpAABB)) return true;
  }

  return false;
}

function getRuntimeValueByKey(key, context = null) {
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
  const amount = parseFloat(ct.actionValue);
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
    const condVal = getCtSourceValue(ct.conditionType, ct);
    const condOpRaw = isTouchCondition ? '=' : (ct.condOp ?? ct.op ?? '=');
    const condOp = condOpRaw === '==' ? '=' : condOpRaw;
    const condValue = isTouchCondition ? 1 : (Number.isFinite(parseFloat(ct.value)) ? parseFloat(ct.value) : 0);

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
    const runtimeBase = getRuntimeValueByKey(ref);
    const base = runtimeBase || (parseFloat(ref) || 0);
    if (op === '+') return base + num;
    if (op === '-') return base - num;
    if (op === '*') return base * num;
  }
  // Plain number
  const num = parseFloat(s);
  if (Number.isFinite(num)) return num;
  // Bare variable reference
  return getRuntimeValueByKey(s);
}

function applyCtAction(ruleKey, expr) {
  if (!ruleKey) return;
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
  grHeightInput.value  = gameRules.height;
  grSprintInput.value  = gameRules.sprintSpeed;
  grMaxHpInput.value   = gameRules.maxHealth;
  grFallDmgInput.checked = gameRules.fallDamage;
  grFallDmgMinHtInput.value = gameRules.fallDamageMinHeight;
  grFallDmgMultInput.value  = gameRules.fallDamageMultiplier;
  grSpawnProtTimeInput.value = gameRules.spawnProtectTime;
  grSpawnProtCondInput.value = gameRules.spawnProtectCondition;
}

function startPlaytest() {
  if (state.isPlaytest) return;
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
  _playtestPrevPositions.clear();
  _playtestPrevAABBs.clear();
  _triggerMoveStates.clear();
  _activeTriggerCalls.clear();
  for (const m of sceneObjects) {
    const pos = m.position.clone();
    _playtestBasePositions.set(m, pos);
    _playtestPrevPositions.set(m, pos.clone());
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
      m.castShadow = false;
      m.userData._playtestHidden = true;
    }
  }

  // Hide spawn and trigger blocks during playtest
  for (const m of sceneObjects) {
    if (m.userData.type === 'spawn' || m.userData.type === 'trigger') {
      m.material.visible = false;
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
    m.userData._playtestHidden = false;
    m.visible = true;
  }
  _playtestBasePositions.clear();
  _playtestPrevPositions.clear();
  _playtestPrevAABBs.clear();
  _triggerMoveStates.clear();
  _activeTriggerCalls.clear();
  for (const [m, hex] of savedTargetColors) m.material.color.setHex(hex);
  savedTargetColors.clear();
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
  pDownPos = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!pDownPos) return;
  const dx = e.clientX - pDownPos.x;
  const dy = e.clientY - pDownPos.y;
  pDownPos = null;
  if (Math.hypot(dx, dy) > 5) return;          // drag → not a click
  if (state.isPlaytest) {                       // playtest: lock or shoot
    if (runtimeMode && runtimePauseActive) return;
    if (!fpsLocked) renderer.domElement.requestPointerLock();
    else fpsShoot();
    return;
  }
  if (transformControls.dragging) return;
  handleEditorClick(e);
});

function handleEditorClick(e) {
  if (runtimeMode) return;
  const ndc = toNDC(e);
  if (state.mode === 'place') {
    const hit = surfaceHit(ndc);
    if (hit) {
      const pos = computeSurfacePlacement(hit.point, hit.normal, state.placingType, state.cloneScale);
      snapSurface(pos, hit.normal);
      placeObject(pos);
      return;
    }
    const pt = groundPoint(ndc);
    if (pt) {
      snap(pt);
      placeObject(new THREE.Vector3(pt.x, DEFS[state.placingType].placedY, pt.z));
    }
  } else if (state.mode === 'select') {
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
  }
}

renderer.domElement.addEventListener('pointermove', e => {
  if (state.isPlaytest || state.mode !== 'place') { removeGhost(); return; }
  const ndc = toNDC(e);
  lastPlaceNDC.copy(ndc);

  // Try surface-snap first
  const hit = surfaceHit(ndc);
  if (hit) {
    ensureGhost(state.placingType);
    const pos = computeSurfacePlacement(hit.point, hit.normal, state.placingType, state.cloneScale);
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
  ghost.position.set(pt.x, DEFS[state.placingType].placedY, pt.z);
  ghost.visible = true;
});

renderer.domElement.addEventListener('pointerleave', () => {
  if (ghost) ghost.visible = false;
});

function fpsShoot() {
  fpsRay.set(fpsCam.position, fpsCam.getWorldDirection(new THREE.Vector3()));
  const shootables = sceneObjects.filter(m => {
    if (m.userData.type === 'target' && !m.userData._dead) return true;
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

  if (pressSwitch(target)) handled = true;
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

    if (e.code === 'KeyV' && !e.repeat) {
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
  refreshStatus();
}

function setPlacingType(type) {
  state.placingType = type;
  state.cloneScale = null;
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
document.querySelectorAll('.lib-btn').forEach(b => b.addEventListener('click', () => setPlacingType(b.dataset.type)));

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
syncScaleSideUI();

// Gamerule inputs
grJumpInput.addEventListener('change', () => { gameRules.jumpHeight = parseFloat(grJumpInput.value) || 8.5; });
grGravityInput.addEventListener('change', () => { gameRules.gravity = parseFloat(grGravityInput.value) || 24; });
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

window.addEventListener('pointermove', e => {
  if (!sidebarState.resizing || !workspaceEl) return;
  const rect = workspaceEl.getBoundingClientRect();
  sidebarState.width = clampSidebarWidth(e.clientX - rect.left);
  applySidebarState({ save: false, reflow: true });
});

window.addEventListener('pointerup', stopSidebarResize);
window.addEventListener('pointercancel', stopSidebarResize);
window.addEventListener('resize', () => {
  const nextWidth = clampSidebarWidth(sidebarState.width);
  if (nextWidth === sidebarState.width) return;
  sidebarState.width = nextWidth;
  applySidebarState({ save: true, reflow: false });
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
  return isSwitchableObjectType(mesh.userData.type) && getMeshSwitchConfig(mesh).enabled;
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

  if (varInput) {
    varInput.addEventListener('change', () => {
      for (const target of switchableTargets) {
        const config = getMeshSwitchConfig(target);
        config.varKey = SWITCH_VAR_KEYS.includes(varInput.value) ? varInput.value : config.varKey;
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
}

function bindGroupProp(mesh) {
  const input = document.getElementById('prop-group');
  if (!input || state.selectedObject !== mesh) return;
  input.addEventListener('change', () => {
    const val = normalizeGroupListValue(input.value);
    input.value = val.join(', ');
    const targets = getPropertyTargets(mesh);
    for (const t of targets) setMeshGroups(t, val);
  });
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

  // timer seconds
  document.querySelectorAll('.tr-cond-timer').forEach(input => {
    input.addEventListener('change', () => {
      const ci = parseInt(input.dataset.callIndex, 10);
      const di = parseInt(input.dataset.condIndex, 10);
      if (!Number.isFinite(ci) || !Number.isFinite(di)) return;
      withCond(ci, di, cond => { cond.timerSeconds = Math.max(0, parseFloat(input.value) || 0); });
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
  const isSurface = m.userData.type === 'wall' || m.userData.type === 'floor';
  const hasLight = !!m.userData.pointLight;
  const isLightType = m.userData.type === 'light';
  const isSpawn = m.userData.type === 'spawn';
  const isTrigger = m.userData.type === 'trigger';
  const isTarget = m.userData.type === 'target';
  const canToggleSwitch = isSwitchableObjectType(m.userData.type);
  const switchConfig = getMeshSwitchConfig(m);
  const isSwitch = canToggleSwitch && switchConfig.enabled;
  const canEditControlFunctions = isTrigger || isSwitch;

  const surfaceControls = isSurface
    ? `<div class="prop-row"><span class="prop-key">Color</span><div class="prop-controls"><input id="prop-surface-color" type="color" value="${colorHexToCss(m.material.color.getHex())}"/><span id="prop-surface-color-value" class="prop-code">${colorHexToCss(m.material.color.getHex()).toUpperCase()}</span></div></div>`
    : '';

  const solidToggle = `<div class="prop-row"><span class="prop-key">Solid</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-solid-toggle" type="checkbox" ${m.userData.solid ? 'checked' : ''}/> Block</label></div></div>`;
  const tractionToggle = `<div class="prop-row"><span class="prop-key">Traction</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-traction-toggle" type="checkbox" ${m.userData.traction ? 'checked' : ''}/> Carry XZ</label></div></div>`;

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

  const switchControls = canToggleSwitch
    ? `<div class="prop-row"><span class="prop-key">Switch</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-switch-toggle" type="checkbox" ${isSwitch ? 'checked' : ''}/> Shootable</label></div></div>`
    : '';

  const switchRangeControls = isSwitch
    ? `<div class="prop-row"><span class="prop-key">Var</span><div class="prop-controls"><select id="prop-switch-var" style="font-size:10px;padding:2px 3px">${SWITCH_VAR_KEYS.map(key => `<option value="${key}" ${switchConfig.varKey === key ? 'selected' : ''}>${key}</option>`).join('')}</select><span style="color:var(--muted);font-size:9px">must be in range</span></div></div>
      <div class="prop-row"><span class="prop-key">Range</span><div class="prop-controls"><input id="prop-switch-min" type="number" step="0.1" value="${switchConfig.min}" style="width:56px"/><span style="color:var(--muted);font-size:9px">to</span><input id="prop-switch-max" type="number" step="0.1" value="${switchConfig.max}" style="width:56px"/></div></div>`
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

      const buildCondFields = (cond, ci, di) => {
        const condTypeOpts = CONDITION_TYPES.map(t => {
          const labels = {none:'always',fnDone:'fn done',touching:'touching',position:'position',distance:'distance',timer:'timer',key:'key held',grounded:'grounded'};
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
            condFields = `<input class="tr-cond-pos-subj" ${dc} list="tr-cond-pos-subj-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.posSubject)}" style="width:48px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-pos-subj-opts-${ci}-${di}"><option value="player">${labelOpts}</datalist><select class="tr-cond-pos-axis" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_POS_AXES.map(a => `<option value="${a}" ${cond.posAxis===a?'selected':''}>.${a}</option>`).join('')}</select><select class="tr-cond-pos-op" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_OPS.map(o => `<option value="${o}" ${cond.posOp===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select><input class="tr-cond-pos-val" ${dc} type="number" step="0.1" value="${cond.posValue}" style="width:42px;font-size:9px;padding:1px 3px"/>`;
            break;
          case 'distance':
            condFields = `<input class="tr-cond-dist-target" ${dc} list="tr-cond-dist-opts-${ci}-${di}" type="text" value="${escapeHtml(cond.distTarget)}" placeholder="object" style="width:54px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="tr-cond-dist-opts-${ci}-${di}">${labelOpts}</datalist><select class="tr-cond-dist-op" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_OPS.map(o => `<option value="${o}" ${cond.distOp===o?'selected':''}>${escapeHtml(o)}</option>`).join('')}</select><input class="tr-cond-dist-val" ${dc} type="number" step="0.5" min="0" value="${cond.distValue}" style="width:38px;font-size:9px;padding:1px 3px"/>`;
            break;
          case 'timer':
            condFields = `<input class="tr-cond-timer" ${dc} type="number" step="0.1" min="0" value="${cond.timerSeconds}" style="width:42px;font-size:9px;padding:1px 3px"/><span style="font-size:8px;color:var(--muted)">s</span>`;
            break;
          case 'key':
            condFields = `<select class="tr-cond-key" ${dc} style="font-size:9px;padding:1px 2px">${CONDITION_KEY_CODES.map(k => `<option value="${k}" ${cond.keyCode===k?'selected':''}>${k.replace('Key','').replace('Digit','').replace('Left','')}</option>`).join('')}</select>`;
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
      </div></div>` : ''}
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
    ${solidToggle}
    ${tractionToggle}
    ${groupControls}
    ${switchControls}
    ${switchRangeControls}
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
  bindSolidToggle(m);
  bindTractionToggle(m);
  if (hasLight) bindLightProps(m);
  if (!isLightType) bindEmitLightProps(m);
  bindGroupProp(m);
  if (canToggleSwitch) bindSwitchProps(m);
  if (isTarget) bindTargetHealthProp(m);
  if (isTrigger) {
    bindTriggerRules(m);
  }
  if (canEditControlFunctions) bindControlActions(m);
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
  if (state.mode === 'place' && state.placingType === 'light')
    txt += `<span class="s-sep">│</span>New Light: ${r3(state.defaultLightIntensity, 1)}`;
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

// ─── Conditional trigger UI ───────────────────────────────────────────────────
const CT_COND_TYPES = [
  { value: 'health', label: 'Health' },
  { value: 'touching', label: 'Touching' },
  { value: 'posY', label: 'Pos Y' },
  { value: 'posX', label: 'Pos X' },
  { value: 'posZ', label: 'Pos Z' },
  { value: 'grounded', label: 'Grounded' },
  { value: 'spawnLanded', label: 'Landed' },
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
  condTriggersListEl.innerHTML = conditionalTriggers.map(ct => {
    const isTouchCondition = ct.conditionType === 'touching';
    const condSense = ct.condSense ?? ((ct.op === 'not') ? 'not' : 'is');
    const condOpRaw = ct.condOp ?? ct.op ?? '=';
    const condOp = condOpRaw === '==' ? '=' : condOpRaw;
    const touchRefType = ct.touchRefType ?? 'group';
    const touchRefValue = ct.touchRefValue ?? '';
    const actionBase = ct.actionBase ?? ((ct.ruleValueExpr || '').trim() ? 'none' : (ct.ruleKey ?? 'none'));
    const actionOp = ct.actionOp ?? '+';
    const actionValue = Number.isFinite(parseFloat(ct.actionValue)) ? parseFloat(ct.actionValue) : (Number.isFinite(parseFloat(ct.ruleValue)) ? parseFloat(ct.ruleValue) : 0);
    const intervalHtml = (ct.mode === 'while') ? `<span style="font-size:8px">every</span><input class="ct-interval" type="number" step="0.1" min="0.05" value="${ct.repeatInterval ?? 1}" style="width:34px;font-size:9px;padding:1px 2px"/><span style="font-size:8px">s</span>` : '';
    const conditionDetailHtml = isTouchCondition
      ? `<select class="ct-touch-type" style="font-size:9px;padding:1px 3px">${CT_TOUCH_REF_TYPES.map(type => `<option value="${type}" ${touchRefType === type ? 'selected' : ''}>${type}</option>`).join('')}</select>
      <input class="ct-touch-val" ${touchRefType === 'group' ? 'list="ct-touch-group-options"' : ''} type="text" value="${escapeHtml(touchRefValue)}" style="width:86px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" placeholder="group or name"/>`
      : `<select class="ct-sense">${CT_COND_SENSES.map(s => `<option value="${s}" ${condSense === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="ct-op">${CT_COND_OPS.map(o => `<option value="${o}" ${condOp === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <input class="ct-val" type="number" step="0.1" value="${ct.value}"/>`;
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
      <select class="ct-rk">${CT_RULE_KEYS.map(k => `<option value="${k}" ${ct.ruleKey === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <span style="font-size:9px;color:var(--muted)">=</span>
      <select class="ct-ab">${CT_ACTION_BASES.map(k => `<option value="${k}" ${actionBase === k ? 'selected' : ''}>${k === 'none' ? '(none)' : k}</option>`).join('')}</select>
      <select class="ct-aop">${CT_ACTION_OPS.map(o => `<option value="${o}" ${actionOp === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <input class="ct-av" type="number" step="0.1" value="${actionValue}" style="width:50px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>
      <span style="font-size:9px;color:var(--muted);width:100%;margin-top:2px">ELSE \u2192</span>
      <select class="ct-erk">
        <option value="" ${!ct.elseRuleKey ? 'selected' : ''}>(none)</option>
        ${CT_RULE_KEYS.map(k => `<option value="${k}" ${ct.elseRuleKey === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select>
      <span style="font-size:9px;color:var(--muted)">=</span>
      <input class="ct-ervx" type="text" value="${ct.elseValueExpr ?? ct.elseRuleValue ?? 0}" style="width:60px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px" placeholder="val or var+n"/>
      <button class="ct-del" data-ctid="${ct.id}">\u2715</button>
    </div>
  `}).join('') + `<datalist id="ct-touch-group-options">${touchGroupOptions}</datalist>`;
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
    const valueInput = el.querySelector('.ct-val');
    if (valueInput) valueInput.addEventListener('change', e => { ct.value = parseFloat(e.target.value) || 0; });
    const touchTypeInput = el.querySelector('.ct-touch-type');
    if (touchTypeInput) touchTypeInput.addEventListener('change', e => { ct.touchRefType = e.target.value; });
    const touchValueInput = el.querySelector('.ct-touch-val');
    if (touchValueInput) touchValueInput.addEventListener('change', e => { ct.touchRefValue = e.target.value.trim(); });
    el.querySelector('.ct-rk').addEventListener('change', e => { ct.ruleKey = e.target.value; });
    el.querySelector('.ct-ab').addEventListener('change', e => { ct.actionBase = e.target.value; });
    el.querySelector('.ct-aop').addEventListener('change', e => { ct.actionOp = e.target.value; });
    el.querySelector('.ct-av').addEventListener('change', e => { ct.actionValue = parseFloat(e.target.value) || 0; ct.ruleValue = ct.actionValue; });
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
    touchRefType: 'group',
    touchRefValue: 'default',
    ruleKey: 'health',
    actionBase: 'health',
    actionOp: '-',
    actionValue: 1,
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
const controlFunctionsListEl = document.getElementById('control-functions-list');
const btnAddControlFn = document.getElementById('btn-add-control-fn');

function refreshControlFunctionsUI() {
  if (!controlFunctionsListEl) return;
  const groupOptions = renderDatalistOptions(getKnownGroups());
  const labelOptions = renderDatalistOptions(getKnownLabels());

  controlFunctionsListEl.innerHTML = controlFunctions.map((fn, fnIdx) => {
    const actionsHtml = fn.actions.map((action, actIdx) => {
      const isLight = action.actionType === 'light';
      const moveOpts = getMoveTargetOptions(action.refType, action.refValue);
      const moveListId = `cfn-target-opts-${fnIdx}-${actIdx}`;
      const primaryHtml = isLight
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Light</span><select class="cfn-light-op" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${CONTROL_LIGHT_OPS.map(op => `<option value="${op}" ${action.lightOp === op ? 'selected' : ''}>${op}</option>`).join('')}</select><input class="cfn-light-val" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.lightValue}" style="width:46px;font-size:9px"/></div>`
        : `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">XYZ</span><input class="cfn-ox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[0]}" style="width:42px;font-size:9px"/><input class="cfn-oy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[1]}" style="width:42px;font-size:9px"/><input class="cfn-oz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Anim</span><select class="cfn-style" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="glide" ${action.style === 'glide' ? 'selected' : ''}>glide</option><option value="strict" ${action.style === 'strict' ? 'selected' : ''}>strict</option><option value="snap" ${action.style === 'snap' ? 'selected' : ''}>snap</option></select><input class="cfn-dur" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="0" step="0.1" value="${action.duration}" style="width:46px;font-size:9px" title="Duration (s)"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-return" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.returnOnDeactivate ? 'checked' : ''}/> Return</label></div>`;
      const posReadout = !isLight ? `<div class="cfn-pos-readout" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:8px;color:var(--accentHi);margin-left:34px;min-height:12px;font-family:monospace;opacity:0.8"></div>` : '';
      return `<div style="border-left:2px solid var(--border);margin-left:4px;padding-left:6px;margin-bottom:4px">
        <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">#${actIdx+1}</span><select class="cfn-ref-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="group" ${action.refType === 'group' ? 'selected' : ''}>group</option><option value="name" ${action.refType === 'name' ? 'selected' : ''}>name</option></select><input class="cfn-ref-val" data-fn="${fnIdx}" data-act="${actIdx}" list="${moveListId}" type="text" value="${escapeHtml(action.refValue)}" style="width:70px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><select class="cfn-action-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="move" ${action.actionType === 'move' ? 'selected' : ''}>move</option><option value="light" ${action.actionType === 'light' ? 'selected' : ''}>light</option></select><button class="ct-del cfn-del-act" data-fn="${fnIdx}" data-act="${actIdx}" title="Remove action">✕</button><datalist id="${moveListId}">${moveOpts}</datalist></div>
        ${primaryHtml}${posReadout}
      </div>`;
    }).join('');

    return `<div class="ct-entry" style="flex-wrap:wrap" data-fn-index="${fnIdx}">
      <div class="sf-row" style="gap:4px;width:100%"><span style="font-size:9px;color:var(--accentHi);font-weight:700">ƒ</span><input class="cfn-name" data-fn="${fnIdx}" type="text" value="${escapeHtml(fn.name)}" placeholder="name" style="flex:1;font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><button class="cfn-sim" data-fn="${fnIdx}" title="Simulate" style="background:none;border:none;color:var(--accentHi);cursor:pointer;font-size:11px;padding:0 2px">▶</button><button class="cfn-sim-reset" data-fn="${fnIdx}" title="Reset" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:10px;padding:0 2px">■</button><button class="ct-del cfn-del-fn" data-fn="${fnIdx}" title="Delete function">✕</button></div>
      ${actionsHtml}
      <button class="cfn-add-act" data-fn="${fnIdx}" style="font-size:8px;padding:1px 5px;margin-left:12px">+ Action</button>
    </div>`;
  }).join('');

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
  bindCfnNumber('.cfn-light-val', (a, v) => { a.lightValue = v; });
  bindCfnNumber('.cfn-dur', (a, v) => { a.duration = Math.max(0, v); });

  controlFunctionsListEl.querySelectorAll('.cfn-light-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.lightOp = CONTROL_LIGHT_OPS.includes(sel.value) ? sel.value : 'toggle'; });
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
}

if (btnAddControlFn) {
  btnAddControlFn.addEventListener('click', () => {
    controlFunctions.push(createDefaultControlFunction());
    refreshControlFunctionsUI();
  });
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
      if (m.material) m.material.visible = !hideDisplayOnly;

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
    if (m.material) m.material.visible = !hideDisplayOnly;

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
      renderer.render(scene, fpsCam);
      return;
    }

    updateRuntimeOptimizer(t, dt);
    updateTriggerMoveAnimations(t / 1000);
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

    // Horizontal movement with ground-following for slopes/ramps
    if (_move.x !== 0 || _move.z !== 0) {
      // Try both axes combined
      _next.copy(fpsPos);
      _next.x += _move.x;
      _next.z += _move.z;
      if (fpsGrounded) {
        let g = findGroundHeight(_next);
        if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
      }
      if (!collidesWalk(_next)) {
        if (fpsGrounded && _next.y > fpsPos.y) { fpsVelY = 0; }
        fpsPos.copy(_next);
      } else {
        // Wall slide: try X only
        _next.copy(fpsPos);
        _next.x += _move.x;
        if (fpsGrounded) {
          let g = findGroundHeight(_next);
          if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
        }
        if (!collidesWalk(_next)) {
          if (fpsGrounded && _next.y > fpsPos.y) { fpsVelY = 0; }
          fpsPos.copy(_next);
        }
        // Try Z only
        _next.copy(fpsPos);
        _next.z += _move.z;
        if (fpsGrounded) {
          let g = findGroundHeight(_next);
          if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
        }
        if (!collidesWalk(_next)) {
          if (fpsGrounded && _next.y > fpsPos.y) { fpsVelY = 0; }
          fpsPos.copy(_next);
        }
      }
    }

    // Gravity and vertical collision
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

    // Track first ground touch after spawn
    if (!fpsSpawnLanded && fpsGrounded) fpsSpawnLanded = true;

    // Spawn protection countdown
    if (fpsSpawnProtectTimer > 0) fpsSpawnProtectTimer -= dt;

    // Trigger block overlap detection
    checkTriggerBlocks();

    // Re-evaluate pending trigger calls with continuous conditions
    for (const [uuid, calls] of _activeTriggerCalls) {
      if (!calls.some(c => !c.started)) continue;
      const mesh = sceneObjects.find(m => m.uuid === uuid);
      if (mesh) evaluateTriggerCalls(mesh);
    }

    // Conditional triggers evaluation
    evaluateConditionalTriggers();

    syncFpsCamera();

    updateSunShadowCenter(fpsPos);
    updateGridChunks(fpsPos.x, fpsPos.z);
    updateVisibility(fpsCam);
    renderer.render(scene, fpsCam);
    for (const m of sceneObjects) {
      _playtestPrevPositions.set(m, m.position.clone());
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
    renderer.render(scene, editorCam);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
new ResizeObserver(onResize).observe(canvasContainer);
onResize();
setTopMenu(topMenuSelect.value);
loadEditorSettings();
applySidebarState({ save: false, reflow: true });
setSnap(snapSelect.value);
setDefaultLightIntensity(lightIntensityInput.value);
applySunUI();
setChunkRange(chunkRangeSelect.value);
refreshCondTriggerUI();
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
