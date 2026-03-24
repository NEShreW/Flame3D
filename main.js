import * as THREE from 'three';
import { OrbitControls }    from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Sky }              from 'three/addons/objects/Sky.js';
import { CSG }              from 'https://esm.sh/three-csg-ts@3.2.0?external=three';

// ─── IndexedDB-backed storage (replaces localStorage for large project data) ─
const _IDB_NAME = 'flame3d_store';
const _IDB_VERSION = 1;
const _IDB_STORE = 'kv';

/** Open (or create) the IndexedDB database. */
function _openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, _IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_IDB_STORE)) {
        db.createObjectStore(_IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked by another connection'));
  });
}

/** Read a value from IndexedDB by key. */
async function _idbGet(key) {
  const db = await _openIDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(_IDB_STORE, 'readonly');
      const store = tx.objectStore(_IDB_STORE);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Write a value to IndexedDB by key (serialized per-key to prevent race conditions). */
const _idbWriteQueues = new Map();
async function _idbSet(key, value) {
  const prev = _idbWriteQueues.get(key) || Promise.resolve();
  const work = prev.then(async () => {
    const db = await _openIDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(_IDB_STORE, 'readwrite');
        const store = tx.objectStore(_IDB_STORE);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  });
  // Keep queue reference but don't let errors break the chain for future writes
  _idbWriteQueues.set(key, work.catch(() => {}));
  return work;
}

/**
 * In-memory cache for project data, backed by IndexedDB.
 * All synchronous reads come from cache; writes update cache + flush async.
 */
const _storageCache = {
  projects: [],
  runtimeLibrary: [],
  _ready: false,
};

/** Flush projects cache to IndexedDB. Returns the write promise. */
function _flushProjects() {
  return _idbSet('flame3d_projects_v1', _storageCache.projects);
}

/** Flush runtime library cache to IndexedDB (fire-and-forget). */
function _flushRuntimeLibrary() {
  _idbSet('flame3d_runtime_library_v1', _storageCache.runtimeLibrary).catch(err => {
    console.error('Failed to persist runtime library:', err);
  });
}

// ─── Auto-restore (periodic background save) ────────────────────────────────
const _RESTORE_IDB_KEY = 'flame3d_autorestore_v1';
let _restoreDirty = false;
let _restoreTimer = null;

/** Save current editor state to the restore slot (IDB). */
function _flushRestore() {
  if (runtimeMode) return;
  try {
    const payload = buildLevelPayload();
    const data = { projectId: currentProjectId, projectName: currentProjectName, payload, savedAt: new Date().toISOString() };
    _idbSet(_RESTORE_IDB_KEY, data).then(() => {
      // Also update the project in the project list if it was previously saved
      if (currentProjectId) {
        const projects = getStoredProjects();
        const idx = projects.findIndex(p => p.id === currentProjectId);
        if (idx >= 0) {
          projects[idx].payload = payload;
          projects[idx].updatedAt = data.savedAt;
          _flushProjects().catch(err => {
            console.warn('[Autosave] Project list flush failed:', err);
          });
        }
      }
    }).catch(err => {
      console.warn('[Autosave] IDB write failed:', err);
      // Re-mark dirty and schedule a retry so a transient storage error doesn't
      // silently swallow unsaved progress.
      _restoreDirty = true;
      if (!_restoreTimer) {
        _restoreTimer = setTimeout(() => { _restoreTimer = null; if (_restoreDirty) _flushRestore(); }, 5000);
      }
    });
  } catch (err) {
    console.warn('[Autosave] Serialization failed:', err);
  }
  _restoreDirty = false;
}

/** Mark that the scene has changed; a background timer will persist it. */
function markRestoreDirty() {
  if (runtimeMode) return;
  _restoreDirty = true;
  if (!_restoreTimer) {
    _restoreTimer = setTimeout(() => { _restoreTimer = null; if (_restoreDirty) _flushRestore(); }, 2000);
  }
}

/** Clear the restore slot (called after a manual save). */
function clearRestoreSlot() {
  _restoreDirty = false;
  if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null; }
  _idbSet(_RESTORE_IDB_KEY, null).catch(err => {
    console.warn('[Restore] Failed to clear restore slot:', err);
  });
}

/** Pending auto-restore data (set at boot, consumed when entering studio). */
let _pendingRestore = null;

/** Show restore banner if unsaved data exists. Called when entering studio. */
function _offerRestore() {
  const data = _pendingRestore;
  if (!data?.payload) return;
  _pendingRestore = null;
  const when = data.savedAt ? new Date(data.savedAt).toLocaleString() : 'unknown time';
  const projLabel = data.projectName ? ` ("${data.projectName}")` : '';
  // Build banner
  const banner = document.createElement('div');
  banner.id = 'restore-banner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#1a3050,#1d3860);color:#fff;padding:12px 18px;display:flex;align-items:center;gap:12px;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.6);backdrop-filter:blur(8px)';
  banner.innerHTML = `<span style="flex:1">📦 Unsaved progress found${projLabel} from ${when}.</span>`;
  const btnRestore = document.createElement('button');
  btnRestore.textContent = 'Restore';
  btnRestore.style.cssText = 'padding:5px 16px;background:linear-gradient(135deg,#2080d0,#388bfd);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;transition:background .15s';
  const btnDiscard = document.createElement('button');
  btnDiscard.textContent = 'Discard';
  btnDiscard.style.cssText = 'padding:5px 16px;background:#3a3f48;color:#e6edf3;border:none;border-radius:6px;cursor:pointer;font-size:13px;transition:background .15s';
  const remove = () => { banner.remove(); };
  btnRestore.onclick = () => {
    const json = typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload);
    currentProjectId = data.projectId || null;
    currentProjectName = data.projectName || '';
    loadLevelJSON(json, { pushHistory: false });
    clearRestoreSlot();
    remove();
  };
  btnDiscard.onclick = () => { clearRestoreSlot(); remove(); };
  banner.appendChild(btnRestore);
  banner.appendChild(btnDiscard);
  document.body.appendChild(banner);
  // Auto-dismiss after 30 seconds
  setTimeout(() => { if (banner.parentNode) remove(); }, 30000);
}

/**
 * Boot storage: load from IndexedDB (migrating from localStorage if needed).
 * Returns a promise that resolves when cache is ready.
 */
async function _bootStorage() {
  try {
    // Try loading from IndexedDB first
    let projects = await _idbGet('flame3d_projects_v1');
    if (!Array.isArray(projects)) {
      // Migrate from localStorage
      try {
        const raw = localStorage.getItem('flame3d_projects_v1');
        projects = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(projects)) projects = [];
        if (projects.length) {
          await _idbSet('flame3d_projects_v1', projects);
          localStorage.removeItem('flame3d_projects_v1');
        }
      } catch (err) {
        console.warn('[Boot] localStorage project migration failed:', err);
        projects = [];
      }
    }
    _storageCache.projects = projects;

    let rtLib = await _idbGet('flame3d_runtime_library_v1');
    if (!Array.isArray(rtLib)) {
      try {
        const raw = localStorage.getItem('flame3d_runtime_library_v1');
        rtLib = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(rtLib)) rtLib = [];
        if (rtLib.length) {
          await _idbSet('flame3d_runtime_library_v1', rtLib);
          localStorage.removeItem('flame3d_runtime_library_v1');
        }
      } catch (err) {
        console.warn('[Boot] localStorage runtime library migration failed:', err);
        rtLib = [];
      }
    }
    _storageCache.runtimeLibrary = rtLib;
  } catch (err) {
    console.error('IndexedDB boot failed, starting with empty data:', err);
    _storageCache.projects = [];
    _storageCache.runtimeLibrary = [];
  }
  _storageCache._ready = true;
}

// ─── DOM refs ────────────────────────────────────────────────────────────────
const canvasContainer = document.getElementById('canvas-container');
const statusText      = document.getElementById('status-text');
const crosshair       = document.getElementById('crosshair');
const coordHud        = document.getElementById('coord-hud');
const playHint        = document.getElementById('play-hint');
const propsPanel      = document.getElementById('props-panel');
const propsContent    = document.getElementById('props-content');

// --- Auto-persist ANY property change made in the inspector panel ---
propsContent.addEventListener('change', () => markRestoreDirty());
propsContent.addEventListener('input', e => {
  if (e.target.matches('input[type="color"]')) markRestoreDirty();
});

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
const sunSizeInput     = document.getElementById('sun-size');
const skyColorInput    = document.getElementById('sky-color');
const cloudsEnabledInput = document.getElementById('clouds-enabled');
const cloudWindSpeedInput = document.getElementById('cloud-wind-speed');
const cloudWindDirInput = document.getElementById('cloud-wind-dir');
const cloudOpacityInput = document.getElementById('cloud-opacity');
const starsEnabledInput = document.getElementById('stars-enabled');
const starsCountInput   = document.getElementById('stars-count');
const starsBrightnessInput = document.getElementById('stars-brightness');
const moonEnabledInput  = document.getElementById('moon-enabled');
const moonBrightnessInput = document.getElementById('moon-brightness');
const moonAuraInput     = document.getElementById('moon-aura');
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
const paintModeInput   = document.getElementById('paint-mode');
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
const grCrouchHeightInput = document.getElementById('gr-crouch-height');
const grSprintInput  = document.getElementById('gr-sprint');
const grSprintDurationInput  = document.getElementById('gr-sprint-duration');
const grSprintRechargeInput  = document.getElementById('gr-sprint-recharge');
const grAirDashEnabledInput  = document.getElementById('gr-airdash-enabled');
const grAirDashDurationInput = document.getElementById('gr-airdash-duration');
const grAllowAirSprintInput  = document.getElementById('gr-allow-air-sprint');
const grMaxHpInput   = document.getElementById('gr-maxhp');
const grFallDmgInput = document.getElementById('gr-falldmg');
const healthHud      = document.getElementById('health-hud');
const healthBarFill  = document.getElementById('health-bar-fill');
const healthText     = document.getElementById('health-text');
const sprintHud      = document.getElementById('sprint-hud');
const sprintBarFill  = document.getElementById('sprint-bar-fill');

// Grid floor fill
const gridFillColorInput   = document.getElementById('grid-fill-color');
const gridFillEnabledInput = document.getElementById('grid-fill-enabled');

// World border settings
const worldBorderEnabledInput = document.getElementById('world-border-enabled');
const worldBorderMinXInput = document.getElementById('world-border-min-x');
const worldBorderMaxXInput = document.getElementById('world-border-max-x');
const worldBorderMinZInput = document.getElementById('world-border-min-z');
const worldBorderMaxZInput = document.getElementById('world-border-max-z');

// Quality settings
const qualityRenderDistInput = document.getElementById('quality-render-dist');
const qualityShadowsSelect   = document.getElementById('quality-shadows');
const qualityLightDistInput  = document.getElementById('quality-light-dist');

// Fog settings
const fogEnabledInput    = document.getElementById('fog-enabled');
const fogColorInput      = document.getElementById('fog-color');
const fogDensityInput    = document.getElementById('fog-density');
const fogBrightnessInput = document.getElementById('fog-brightness');

// FOV settings
const fovEditorInput   = document.getElementById('fov-editor');
const fovPlaytestInput = document.getElementById('fov-playtest');

// Worlds
const worldsTabBar = document.getElementById('worlds-tab-bar');
const btnAddWorld  = document.getElementById('btn-add-world');

// Fall damage & spawn protection inputs
const grFallDmgMinHtInput  = document.getElementById('gr-falldmg-minht');
const grFallDmgMultInput   = document.getElementById('gr-falldmg-mult');
const grSpawnProtTimeInput = document.getElementById('gr-spawnprot-time');
const grSpawnProtCondInput = document.getElementById('gr-spawnprot-cond');
const grGroundTouchFnInput = document.getElementById('gr-ground-touch-fn');

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

const modeSelect = document.getElementById('mode-select');
const gizmoSelect = document.getElementById('gizmo-select');
const transformGroup = document.getElementById('transform-group');
const scaleSideXSelect = document.getElementById('scale-side-x');
const scaleSideYSelect = document.getElementById('scale-side-y');
const scaleSideZSelect = document.getElementById('scale-side-z');

// ─── Editor state ────────────────────────────────────────────────────────────
const MODES = { PLACE: 'place', SELECT: 'select', DELETE: 'delete', PAINT: 'paint', ERASE: 'erase' };
const TRANSFORMS = { TRANSLATE: 'translate', ROTATE: 'rotate', SCALE: 'scale' };
const state = {
  mode:          MODES.PLACE,      // place | select | delete | paint | erase
  placingType:   'wall',       // wall | floor | target | light
  transformMode: TRANSFORMS.TRANSLATE,  // translate | rotate | scale
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
  paintSubMode: 'draw', // draw | erase-paint | fill
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
const MAX_UNDO = 80;
const GHOST_OPACITY = 0.42;
const undoStack    = [];
const redoStack    = [];
let _nextEditorGroupId = 1;
let _nextPlacedOrder = 1;
let currentProjectId = null;
let currentProjectName = '';

// ─── Clipboard (Copy/Paste) ──────────────────────────────────────────────────
let _clipboard = [];  // array of serialized objects for paste
let _clipboardCenter = new THREE.Vector3();

// ─── Custom Object Templates ─────────────────────────────────────────────────
const customObjectTemplates = [];  // { id, name, objects: [serialized], thumbnail? }
let _nextCustomTemplateId = 1;

// ─── Terrain Sculpt State ────────────────────────────────────────────────────
const terrainSculptState = {
  active: false,
  brush: 'raise',     // raise | lower | flatten | smooth
  radius: 3,
  strength: 0.3,
  _painting: false,
};

// ─── Texture Paint State ─────────────────────────────────────────────────────
const texturePaintState = {
  enabled: false,
  pattern: 'none',   // none | checker | brick | stripe | grid | noise | gradient | wood | cobblestone | marble | custom
  scale: 1,
  color2: 0x222222,  // secondary colour for patterns
  customImage: null,  // HTMLImageElement for uploaded texture
};

// ─── World system ────────────────────────────────────────────────────────────
let worlds = [{ id: 'world_1', name: 'World 1', objects: [] }];
let activeWorldId = 'world_1';
let _nextWorldId = 2;
function getActiveWorld() { return worlds.find(w => w.id === activeWorldId) || worlds[0]; }
function worldObjects(worldId) { return sceneObjects.filter(m => (m.userData.world || 'world_1') === worldId); }

/** Save current scene objects into the active world's store. */
function _stashCurrentWorld() {
  const w = worlds.find(ww => ww.id === activeWorldId);
  if (w) w.objects = sceneObjects.map(m => serializeSingleObject(m));
}

/** Remove all objects from the scene (real removal). */
function _clearScene() {
  selectObject(null);
  const toRemove = [...sceneObjects];
  toRemove.forEach(removeFromScene);
}

/** Load a world's stored objects into the scene. */
function _loadWorldObjects(worldId) {
  const w = worlds.find(ww => ww.id === worldId);
  if (!w || !w.objects) return;
  const meshes = w.objects.map(deserializeObject).filter(Boolean);
  meshes.forEach(m => { m.userData.world = worldId; addToScene(m); });
}

/** Load ALL worlds' objects into the scene (for playtest). */
function _loadAllWorldObjects() {
  for (const w of worlds) {
    if (w.id === activeWorldId) continue; // current world is already in scene
    if (!w.objects || !w.objects.length) continue;
    const meshes = w.objects.map(deserializeObject).filter(Boolean);
    meshes.forEach(m => { m.userData.world = w.id; addToScene(m); });
  }
}

/** After loading a project, distribute objects into world stores and keep only active world in scene. */
function _distributeObjectsToWorlds() {
  // All objects are currently in scene after loadLevelJSON. Separate them.
  const activeObjs = [];
  const otherObjs = new Map(); // worldId -> serialized[]
  for (const m of [...sceneObjects]) {
    const mw = m.userData.world || 'world_1';
    if (mw === activeWorldId) {
      activeObjs.push(m);
    } else {
      if (!otherObjs.has(mw)) otherObjs.set(mw, []);
      otherObjs.get(mw).push(serializeSingleObject(m));
      removeFromScene(m);
    }
  }
  // Store other world data
  for (const [wid, objs] of otherObjs) {
    const w = worlds.find(ww => ww.id === wid);
    if (w) w.objects = objs;
  }
  // Ensure active world store is empty (objects are live in scene)
  const aw = worlds.find(ww => ww.id === activeWorldId);
  if (aw) aw.objects = [];
}

// ─── Fog settings ────────────────────────────────────────────────────────────
const fogSettings = {
  enabled: true,
  mode: 'exp2',        // 'linear' | 'exp2'
  color: 0x87ceeb,
  density: 0.0008,     // for exp2
  near: 10,            // for linear
  far: 500,            // for linear
  brightness: 1,       // fog brightness multiplier
};

// ─── FOV settings ────────────────────────────────────────────────────────────
let editorFov = 60;
let playtestFov = 75;
let _runtimeFovOverride = null;  // set by functions during playtest

// ─── Teleport cooldown (anti-re-teleport) ────────────────────────────────────
const _teleportCooldowns = new Map();  // triggerMeshUuid -> true while player still inside

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
const customFonts = [];
let activeLibraryPane = 'objects';
let libraryPreviewAudio = null;
let libraryPreviewAudioId = null;

const CUSTOM_SKIN_GRID_DEFAULT = Object.freeze({ x: 8, y: 6, z: 8 });
const CUSTOM_SKIN_GRID_MIN = 1;
const customBlockSkins = {};
const customSculptSkins = {};
const skeletonDefinitions = {};
let skeletonEditorOverlayEl = null;
let skeletonEditorState = null;
let skeleton3DState = null;
const _skeletonRuntimeStates = new Map();
let sculptEditorOverlayEl = null;
let libraryContextMenuEl = null;
let keypadContextMenuEl = null;
let worldContextMenuEl = null;
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
let runtimeScreenOverlayEl = null;

// ─── Portal view (render-through teleport) ────────────────────────────────────
const PORTAL_MAX_DIST = 40;

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
renderer.outputColorSpace       = THREE.SRGBColorSpace;
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
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0008);

const ambientLight = new THREE.HemisphereLight(0x87ceeb, 0x362e1e, 0.4);
scene.add(ambientLight);

const LIGHT_BLOCK_DISTANCE = 24;
const LIGHT_BLOCK_DECAY = 1.4;
const LIGHT_BLOCK_SHADOW_MAP = 1024;
const LIGHT_BLOCK_SHADOW_BIAS = -0.0005;

// ─── Sun / Sky defaults ──────────────────────────────────────────────────────
const SUN_INTENSITY_DEFAULT  = 22;
const SUN_TIME_DEFAULT       = 14;     // 2 PM — nice afternoon
const SUN_NORTH_DEFAULT      = 0;      // north offset degrees
const SUN_TURBIDITY_DEFAULT  = 2.5;    // haze (2=clear, 10=hazy)
const SUN_SHADOW_RANGE_DEFAULT = 100;
const SUN_DAY_DURATION_DEFAULT = 120;  // seconds for a full 24h cycle
const SUN_DAY_CYCLE_ENABLED_DEFAULT = false;
const SUN_DISTANCE = 400;
const SUN_SIZE_DEFAULT = 800;
const SKY_COLOR_DEFAULT = '#5588cc';
const CLOUDS_ENABLED_DEFAULT = true;
const CLOUD_WIND_SPEED_DEFAULT = 3;
const CLOUD_WIND_DIR_DEFAULT = 45;
const CLOUD_OPACITY_DEFAULT = 0.6;
const STARS_ENABLED_DEFAULT = true;
const STARS_COUNT_DEFAULT = 1500;
const STARS_BRIGHTNESS_DEFAULT = 1;
const MOON_ENABLED_DEFAULT = true;
const MOON_BRIGHTNESS_DEFAULT = 1.5;
const MOON_AURA_DEFAULT = 0.8;
const NIGHT_SKY_COLOR = new THREE.Color(0x0a0e24); // deep navy blue night

// ─── Sky dome ────────────────────────────────────────────────────────────────
const sky = new Sky();
sky.scale.setScalar(450000);
sky.material.fog = false;
sky.frustumCulled = false;
sky.renderOrder = -1;
sky.material.depthWrite = false;
sky.material.depthTest = false;
scene.add(sky);

const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value        = SUN_TURBIDITY_DEFAULT;
skyUniforms['rayleigh'].value         = 3;       // vivid blue sky — physically accurate Rayleigh
skyUniforms['mieCoefficient'].value   = 0.003;   // subtle atmospheric haze
skyUniforms['mieDirectionalG'].value  = 0.75;    // bright sun-halo forward scattering

// ─── Cloud layer ─────────────────────────────────────────────────────────────
const _cloudGroup = new THREE.Group();
_cloudGroup.renderOrder = 1;
_cloudGroup.frustumCulled = false;
scene.add(_cloudGroup);
let _cloudParticles = null;
let _cloudMaterial = null;
let _cloudWindOffset = new THREE.Vector2(0, 0);

function _buildClouds() {
  // Remove old
  while (_cloudGroup.children.length) _cloudGroup.remove(_cloudGroup.children[0]);
  const count = 200;
  const spread = 800;
  const height = 180;
  const heightVariance = 30;
  const geo = new THREE.PlaneGeometry(40, 40);
  _cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: CLOUD_OPACITY_DEFAULT,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geo, _cloudMaterial.clone());
    mesh.position.set(
      (Math.random() - 0.5) * spread,
      height + (Math.random() - 0.5) * heightVariance,
      (Math.random() - 0.5) * spread,
    );
    mesh.rotation.x = -Math.PI / 2; // face down
    mesh.scale.set(1 + Math.random() * 2, 1 + Math.random() * 1.5, 1);
    mesh.userData._cloudBaseX = mesh.position.x;
    mesh.userData._cloudBaseZ = mesh.position.z;
    mesh.frustumCulled = false;
    _cloudGroup.add(mesh);
  }
  _cloudGroup.visible = CLOUDS_ENABLED_DEFAULT;
}
_buildClouds();

function _updateCloudWind(dt) {
  if (!_cloudGroup.visible || _cloudGroup.children.length === 0) return;
  const speed = THREE.MathUtils.clamp(parseFloat(cloudWindSpeedInput?.value) || 0, 0, 50);
  const dirDeg = parseFloat(cloudWindDirInput?.value) || CLOUD_WIND_DIR_DEFAULT;
  const dirRad = THREE.MathUtils.degToRad(dirDeg);
  _cloudWindOffset.x += Math.cos(dirRad) * speed * dt;
  _cloudWindOffset.y += Math.sin(dirRad) * speed * dt;
  const spread = 800;
  for (const c of _cloudGroup.children) {
    let nx = c.userData._cloudBaseX + _cloudWindOffset.x;
    let nz = c.userData._cloudBaseZ + _cloudWindOffset.y;
    // Wrap around
    const half = spread / 2;
    nx = ((nx + half) % spread + spread) % spread - half;
    nz = ((nz + half) % spread + spread) % spread - half;
    c.position.x = nx;
    c.position.z = nz;
  }
}

// ─── Star field ──────────────────────────────────────────────────────────────
let _starsMesh = null;
let _starsMaterial = null;

function _buildStars(count) {
  if (_starsMesh) { scene.remove(_starsMesh); _starsMesh.geometry.dispose(); _starsMaterial.dispose(); }
  const positions = new Float32Array(count * 3);
  const radius = 420;
  for (let i = 0; i < count; i++) {
    // Distribute on upper hemisphere (y > -0.1)
    let x, y, z;
    do {
      x = (Math.random() - 0.5) * 2;
      y = Math.random(); // upper half
      z = (Math.random() - 0.5) * 2;
      const len = Math.sqrt(x * x + y * y + z * z);
      x /= len; y /= len; z /= len;
    } while (y < -0.1);
    positions[i * 3] = x * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z * radius;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  _starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  _starsMesh = new THREE.Points(geo, _starsMaterial);
  _starsMesh.renderOrder = 0;
  _starsMesh.frustumCulled = false;
  scene.add(_starsMesh);
}
_buildStars(STARS_COUNT_DEFAULT);

// ─── Moon ────────────────────────────────────────────────────────────────────
const _moonGroup = new THREE.Group();
_moonGroup.frustumCulled = false;
scene.add(_moonGroup);

const _moonGeo = new THREE.SphereGeometry(6, 32, 32);
const _moonMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e0, fog: false, transparent: true, opacity: 0 });
const _moonMesh = new THREE.Mesh(_moonGeo, _moonMat);
_moonMesh.frustumCulled = false;
_moonGroup.add(_moonMesh);

// Moon aura (glow sprite)
const _moonAuraCanvas = document.createElement('canvas');
_moonAuraCanvas.width = 128;
_moonAuraCanvas.height = 128;
const _moonAuraCtx = _moonAuraCanvas.getContext('2d');
const gradient = _moonAuraCtx.createRadialGradient(64, 64, 8, 64, 64, 64);
gradient.addColorStop(0, 'rgba(200,210,255,0.5)');
gradient.addColorStop(0.4, 'rgba(200,210,255,0.15)');
gradient.addColorStop(1, 'rgba(200,210,255,0)');
_moonAuraCtx.fillStyle = gradient;
_moonAuraCtx.fillRect(0, 0, 128, 128);
const _moonAuraTexture = new THREE.CanvasTexture(_moonAuraCanvas);
const _moonAuraMat = new THREE.SpriteMaterial({
  map: _moonAuraTexture,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  fog: false,
  blending: THREE.AdditiveBlending,
});
const _moonAuraSprite = new THREE.Sprite(_moonAuraMat);
_moonAuraSprite.scale.set(30, 30, 1);
_moonAuraSprite.frustumCulled = false;
_moonGroup.add(_moonAuraSprite);

// ─── Sun light ───────────────────────────────────────────────────────────────
const sunTarget = new THREE.Object3D();
scene.add(sunTarget);

const sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY_DEFAULT);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
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

/** Convert time-of-day (0-24) + north offset → sun direction vector (unit).
 *  Uses a physically-motivated solar arc with smooth civil/nautical twilight. */
function sunPositionFromTime(time, northDeg) {
  // Hour angle: 0 at solar noon (12h), ±π at midnight
  const hourAngle = ((time - 12) / 24) * Math.PI * 2;

  // Declination ~0 for equinox-like default; latitude 40° for temperate look
  const latitude = THREE.MathUtils.degToRad(40);
  const declination = 0; // equinox

  // Solar elevation via spherical astronomy formula
  const sinElev = Math.sin(latitude) * Math.sin(declination)
    + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(THREE.MathUtils.clamp(sinElev, -1, 1));

  // Solar azimuth (measured from south, positive westward)
  const cosAz = (Math.sin(declination) - Math.sin(latitude) * sinElev)
    / (Math.cos(latitude) * Math.cos(elevation) + 1e-10);
  let azimuth = Math.acos(THREE.MathUtils.clamp(cosAz, -1, 1));
  if (hourAngle > 0) azimuth = -azimuth; // afternoon = west
  azimuth += THREE.MathUtils.degToRad(northDeg);

  const cosEl = Math.cos(elevation);
  return new THREE.Vector3(
    -Math.sin(azimuth) * cosEl,
    Math.sin(elevation),
    -Math.cos(azimuth) * cosEl,
  ).normalize();
}

/** Compute atmospheric light color tint based on sun elevation.
 *  Models real-world color-temperature shift from ~2000 K at horizon
 *  through ~6500 K at zenith, with smooth blue-hour and twilight. */
function sunColorFromElevation(elevDeg) {
  const color = new THREE.Color();
  if (elevDeg > 25) {
    // High sun — near-white daylight (CIE D65 ≈ 6500 K)
    color.setRGB(1.0, 0.98, 0.94);
  } else if (elevDeg > 6) {
    // Mid-morning / late-afternoon — gentle warm bias
    const f = THREE.MathUtils.mapLinear(elevDeg, 6, 25, 0, 1);
    color.setRGB(
      1.0,
      THREE.MathUtils.lerp(0.85, 0.98, f),
      THREE.MathUtils.lerp(0.65, 0.94, f),
    );
  } else if (elevDeg > 0.5) {
    // Golden hour — warm orange (≈ 3000 K)
    const f = THREE.MathUtils.mapLinear(elevDeg, 0.5, 6, 0, 1);
    color.setRGB(
      1.0,
      THREE.MathUtils.lerp(0.45, 0.85, f),
      THREE.MathUtils.lerp(0.15, 0.65, f),
    );
  } else if (elevDeg > -4) {
    // Civil twilight — deep orange to salmon-pink horizon
    const f = THREE.MathUtils.mapLinear(elevDeg, -4, 0.5, 0, 1);
    color.setRGB(
      THREE.MathUtils.lerp(0.6, 1.0, f),
      THREE.MathUtils.lerp(0.2, 0.45, f),
      THREE.MathUtils.lerp(0.15, 0.15, f),
    );
  } else if (elevDeg > -12) {
    // Nautical twilight — blue hour
    const f = THREE.MathUtils.mapLinear(elevDeg, -12, -4, 0, 1);
    color.setRGB(
      THREE.MathUtils.lerp(0.04, 0.6, f),
      THREE.MathUtils.lerp(0.04, 0.2, f),
      THREE.MathUtils.lerp(0.12, 0.15, f),
    );
  } else {
    // Night
    color.setRGB(0.04, 0.04, 0.12);
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

  // New settings
  const sunSize = THREE.MathUtils.clamp(parseFloat(sunSizeInput?.value) || SUN_SIZE_DEFAULT, 100, 10000);
  const userSkyColor = new THREE.Color(skyColorInput?.value || SKY_COLOR_DEFAULT);
  const cloudsEnabled = cloudsEnabledInput ? cloudsEnabledInput.checked : CLOUDS_ENABLED_DEFAULT;
  const cloudWindSpeed = THREE.MathUtils.clamp(parseFloat(cloudWindSpeedInput?.value) || 0, 0, 50);
  const cloudWindDir = parseFloat(cloudWindDirInput?.value) || CLOUD_WIND_DIR_DEFAULT;
  const cloudOpacity = THREE.MathUtils.clamp(parseFloat(cloudOpacityInput?.value) || CLOUD_OPACITY_DEFAULT, 0, 1);
  const starsEnabled = starsEnabledInput ? starsEnabledInput.checked : STARS_ENABLED_DEFAULT;
  const starsBrightness = THREE.MathUtils.clamp(parseFloat(starsBrightnessInput?.value) || STARS_BRIGHTNESS_DEFAULT, 0.1, 3);
  const moonEnabled = moonEnabledInput ? moonEnabledInput.checked : MOON_ENABLED_DEFAULT;
  const moonBrightness = THREE.MathUtils.clamp(parseFloat(moonBrightnessInput?.value) || MOON_BRIGHTNESS_DEFAULT, 0.1, 5);
  const moonAura = THREE.MathUtils.clamp(parseFloat(moonAuraInput?.value) || MOON_AURA_DEFAULT, 0, 3);

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

  // ── Physically-based sky dome update ──
  const baseRayleigh = 3.0;
  const horizonBoost = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, 0, 20, 1.5, 0), 0, 1.5);
  skyUniforms['rayleigh'].value = baseRayleigh + horizonBoost;
  skyUniforms['turbidity'].value = turbidity;
  const baseMie = 0.003;
  const horizonMie = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -2, 15, 0.012, 0), 0, 0.012);
  skyUniforms['mieCoefficient'].value = baseMie + horizonMie;
  skyUniforms['mieDirectionalG'].value = THREE.MathUtils.lerp(0.85, 0.75, THREE.MathUtils.clamp(elevDeg / 60, 0, 1));
  skyUniforms['sunPosition'].value.copy(sunDir);

  // Sun disk size — scale the sun position to control apparent size
  if (skyUniforms['sunPosition']) {
    // The Sky shader sun disk size is controlled by sunPosition magnitude implicitly;
    // we override by scaling mieDirectionalG for a fatter sun glow
    const sizeScale = sunSize / 800; // 800 = default
    skyUniforms['mieDirectionalG'].value = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.85, 0.75, THREE.MathUtils.clamp(elevDeg / 60, 0, 1)) * sizeScale,
      0.5, 0.999,
    );
  }

  // ── Dynamic exposure ──
  const dayFactor = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -6, 25, 0, 1), 0, 1);
  const targetExposure = THREE.MathUtils.lerp(0.35, 0.6, dayFactor);
  renderer.toneMappingExposure += (targetExposure - renderer.toneMappingExposure) * 0.08;

  // ── Sun directional light ──
  const sunFade = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -2, 8, 0, 1), 0, 1);
  sunLight.intensity = intensity * sunFade;
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
  sunLight.shadow.bias       = -0.00015 * biasScale;
  sunLight.shadow.normalBias =  0.012   * biasScale;
  sunLight.shadow.camera.updateProjectionMatrix();

  // ── Hemisphere ambient light (sky + ground bounce) ──
  const ambientDayFactor = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -8, 20, 0, 1), 0, 1);
  ambientLight.intensity = THREE.MathUtils.lerp(0.12, 0.55, ambientDayFactor);
  const sunCol = sunColorFromElevation(elevDeg);

  // Blend user sky color with sun-derived color
  const zenithBlue = new THREE.Color().copy(userSkyColor);
  const skyTint = new THREE.Color().copy(sunCol).lerp(zenithBlue, THREE.MathUtils.lerp(0, 0.5, ambientDayFactor));

  // Night: deep navy blue
  if (ambientDayFactor < 0.25) {
    const nightMix = THREE.MathUtils.mapLinear(ambientDayFactor, 0, 0.25, 1, 0);
    ambientLight.color.setRGB(
      THREE.MathUtils.lerp(skyTint.r, NIGHT_SKY_COLOR.r, nightMix),
      THREE.MathUtils.lerp(skyTint.g, NIGHT_SKY_COLOR.g, nightMix),
      THREE.MathUtils.lerp(skyTint.b, NIGHT_SKY_COLOR.b, nightMix),
    );
  } else {
    ambientLight.color.copy(skyTint);
  }
  // Ground color
  ambientLight.groundColor.setRGB(
    THREE.MathUtils.lerp(0.02, 0.18, ambientDayFactor),
    THREE.MathUtils.lerp(0.02, 0.14, ambientDayFactor),
    THREE.MathUtils.lerp(0.04, 0.08, ambientDayFactor),
  );

  // Make light-emitting blocks less affected by darkness
  for (const m of sceneObjects) {
    if (m.userData.pointLight && m.material) {
      const nightBoost = THREE.MathUtils.lerp(1.8, 1.0, ambientDayFactor);
      m.material.emissiveIntensity = nightBoost;
    }
  }

  // ── Apply sky color to renderer clear color ──
  renderer.setClearColor(userSkyColor);

  // ── Atmospheric perspective fog ──
  // Tint fog with a blend of the sun color and the user sky color so the
  // horizon / distant haze actually reflects the sky colour the user chose.
  if (scene.fog) {
    const horizonColor = new THREE.Color().copy(sunCol).lerp(userSkyColor, 0.5);
    const fogBright = THREE.MathUtils.lerp(0.005, 0.55, ambientDayFactor);
    scene.fog.color.copy(horizonColor).multiplyScalar(fogBright);
    if (ambientDayFactor > 0.5) {
      const aerialBlend = THREE.MathUtils.mapLinear(ambientDayFactor, 0.5, 1, 0, 0.3);
      scene.fog.color.lerp(new THREE.Color().copy(userSkyColor).multiplyScalar(0.7), aerialBlend);
    }
  }

  // ── Clouds ──
  _cloudGroup.visible = cloudsEnabled;
  if (cloudsEnabled) {
    for (const c of _cloudGroup.children) {
      if (c.material) c.material.opacity = cloudOpacity * THREE.MathUtils.clamp(ambientDayFactor * 2.5, 0.15, 1);
    }
  }

  // ── Stars ──
  if (_starsMaterial) {
    const starAlpha = starsEnabled
      ? THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -2, 6, 1, 0), 0, 1) * starsBrightness
      : 0;
    _starsMaterial.opacity = starAlpha;
    if (_starsMesh) _starsMesh.visible = starAlpha > 0.01;
  }

  // ── Moon ──
  if (moonEnabled) {
    // Place moon opposite the sun
    const moonDir = sunDir.clone().negate();
    // Keep it above horizon even if sun is high
    if (moonDir.y < 0.05) moonDir.y = 0.05;
    moonDir.normalize();
    _moonMesh.position.copy(moonDir.clone().multiplyScalar(SUN_DISTANCE * 0.95));
    _moonAuraSprite.position.copy(_moonMesh.position);
    // Moon visibility: fade in as sun sets
    const moonAlpha = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(elevDeg, -4, 8, 1, 0), 0, 1);
    _moonMat.opacity = moonAlpha * moonBrightness;
    _moonAuraMat.opacity = moonAlpha * moonAura * 0.5;
    _moonGroup.visible = moonAlpha > 0.01;
  } else {
    _moonGroup.visible = false;
  }
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

/** Keep sky dome, clouds, stars, and moon centered on the active camera so
 *  the player can never walk to the edge of the sky. */
function syncSkyToCamera(cam) {
  const p = cam.position;
  sky.position.set(p.x, p.y, p.z);
  _cloudGroup.position.set(p.x, 0, p.z);
  if (_starsMesh) _starsMesh.position.set(p.x, p.y, p.z);
  _moonGroup.position.set(p.x, p.y, p.z);
}

const EDIT_SPEED = 12;
const EDIT_VERTICAL_SPEED = 9;
const editKeys = new Set();

// ─── Editor free-look mode (toggle with F key) ──────────────────────────────
let editorFreeLook = false;
function startEditorFreeLook() {
  if (state.isPlaytest || editorFreeLook) return;
  editorFreeLook = true;
  orbitControls.enabled = false;
  renderer.domElement.requestPointerLock();
}
function stopEditorFreeLook() {
  if (!editorFreeLook) return;
  editorFreeLook = false;
  orbitControls.enabled = true;
  if (document.pointerLockElement === renderer.domElement) {
    suppressPointerUnlockStop = true;
    document.exitPointerLock();
  }
}

const PLAYER_RADIUS = 0.35;
const STEP_HEIGHT = 0.55;
const COLLISION_SUBSTEP = 0.05;

const gameRules = {
  jumpHeight: 8.5,
  gravity: 24,
  gravityEnabled: true,
  height: 1.75,
  eyeHeight: 1.6,
  crouchHeight: 1.0,
  fallDamage: false,
  fallDamageMinHeight: 4,
  fallDamageMultiplier: 1,
  sprintSpeed: 12,
  sprintDuration: 0,
  sprintRechargeTime: 3,
  allowAirSprint: false,
  airDashEnabled: false,
  airDashDuration: 0.5,
  maxHealth: 100,
  spawnProtectTime: 0,
  spawnProtectCondition: 'all',
  groundTouchFunction: '',
};
const playerProfile = {
  name: 'Player',
  groups: ['default'],
};

// ─── Keybinds ────────────────────────────────────────────────────────────────
const DEFAULT_KEYBINDS = {
  forward: 'KeyW',
  backward: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'KeyR',
  crouch: 'ShiftLeft',
  shoot: 'mouse0',
  toggleMouse: 'KeyT',
};

const keybinds = { ...DEFAULT_KEYBINDS };

function keybindLabel(code) {
  if (code === 'mouse0') return 'LMB';
  if (code === 'mouse2') return 'RMB';
  return code.replace('Key', '').replace('Digit', '').replace('Left', '').replace('Right', '').replace('Arrow', '');
}

function keybindMatch(action, code) {
  return keybinds[action] === code;
}
const BASE_FPS_SPEED = 7;
let _groundTouchFnActive = false; // tracks whether ground-touch function is currently active

// ─── Chunked infinite grid ───────────────────────────────────────────────────
const CHUNK_SIZE  = 20;
const gridChunks  = new Map();
const gridFillPlanes = new Map();
let gridFillColor   = 0x1a2636;
let gridFillEnabled = false;
let gridFillTexture = 'none'; // none, grass, dirt, stone, sand, snow
let worldBorderEnabled = false;
let worldBorderMinX = -50;
let worldBorderMaxX = 50;
let worldBorderMinZ = -50;
let worldBorderMaxZ = 50;
let lastChunkX = Infinity;
let lastChunkZ = Infinity;
let lastChunkRange = Infinity;

// ─── Procedural ground textures ──────────────────────────────────────────────
const GROUND_TEXTURES = {
  grass: { base: [0x4a8c3c, 0x3d7a30, 0x5ca04a], detail: [0x3a6c28, 0x6ab85a] },
  dirt:  { base: [0x8b6b47, 0x7a5c3a, 0x9c7b55], detail: [0x6a4e30, 0xa08560] },
  stone: { base: [0x808080, 0x707070, 0x909090], detail: [0x606060, 0xa0a0a0] },
  sand:  { base: [0xd4b878, 0xc4a868, 0xe4c888], detail: [0xb49858, 0xf0d898] },
  snow:  { base: [0xe8e8f0, 0xd8d8e8, 0xf0f0f8], detail: [0xc8c8e0, 0xffffff] },
};

function _generateGroundTexture(texName) {
  const config = GROUND_TEXTURES[texName];
  if (!config) return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Fill with base color
  const baseIdx = Math.floor(Math.random() * config.base.length);
  ctx.fillStyle = '#' + config.base[baseIdx].toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, size, size);
  // Add noise patches
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 1 + Math.random() * 4;
    const cIdx = Math.floor(Math.random() * (config.base.length + config.detail.length));
    const c = cIdx < config.base.length ? config.base[cIdx] : config.detail[cIdx - config.base.length];
    ctx.fillStyle = '#' + c.toString(16).padStart(6, '0');
    ctx.globalAlpha = 0.15 + Math.random() * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function _getGridFillMaterial() {
  if (gridFillTexture && gridFillTexture !== 'none' && GROUND_TEXTURES[gridFillTexture]) {
    const tex = _generateGroundTexture(gridFillTexture);
    return new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  }
  return new THREE.MeshStandardMaterial({ color: gridFillColor, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
}


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
      if (state.isPlaytest) g.visible = false;
      scene.add(g);
      gridChunks.set(key, g);
    }
    // Fill planes
    if (gridFillEnabled && !gridFillPlanes.has(key)) {
      const [kx, kz] = key.split(',').map(Number);
      const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
      const mat = _getGridFillMaterial();
      const plane = new THREE.Mesh(geo, mat);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(kx * CHUNK_SIZE + CHUNK_SIZE / 2, -0.01, kz * CHUNK_SIZE + CHUNK_SIZE / 2);
      plane.receiveShadow = true;
      if (state.isPlaytest) plane.visible = false;
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

// ─── Grid axis number labels (sprites) ───────────────────────────────────────
const GRID_LABEL_STEP = 5;
const gridLabelSprites = new Map();
let lastLabelCX = Infinity, lastLabelCZ = Infinity, lastLabelRange = Infinity;

function _makeTextSprite(text, isMajor) {
  const fontSize = isMajor ? 48 : 32;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px monospace`;
  const tw = ctx.measureText(text).width;
  canvas.width = Math.ceil(tw + 12);
  canvas.height = fontSize + 12;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.fillStyle = isMajor ? 'rgba(100,180,255,0.9)' : 'rgba(70,130,200,0.55)';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 6, 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  const aspect = canvas.width / canvas.height;
  const scale = isMajor ? 1.2 : 0.8;
  sprite.scale.set(scale * aspect, scale, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function updateGridLabels(wx, wz) {
  const cx = Math.floor(wx / CHUNK_SIZE);
  const cz = Math.floor(wz / CHUNK_SIZE);
  const range = state.chunkRenderRadius;
  if (cx === lastLabelCX && cz === lastLabelCZ && range === lastLabelRange) return;
  lastLabelCX = cx; lastLabelCZ = cz; lastLabelRange = range;

  const neededKeys = new Set();
  const minX = (cx - range) * CHUNK_SIZE;
  const maxX = (cx + range + 1) * CHUNK_SIZE;
  const minZ = (cz - range) * CHUNK_SIZE;
  const maxZ = (cz + range + 1) * CHUNK_SIZE;
  const startX = Math.ceil(minX / GRID_LABEL_STEP) * GRID_LABEL_STEP;
  const startZ = Math.ceil(minZ / GRID_LABEL_STEP) * GRID_LABEL_STEP;

  // X axis labels (placed along Z=0 line)
  for (let x = startX; x <= maxX; x += GRID_LABEL_STEP) {
    const key = `x${x}`;
    neededKeys.add(key);
    if (!gridLabelSprites.has(key)) {
      const isMajor = x % 10 === 0;
      const sprite = _makeTextSprite(String(x), isMajor);
      sprite.position.set(x, 0.15, 0.6);
      if (state.isPlaytest) sprite.visible = false;
      scene.add(sprite);
      gridLabelSprites.set(key, sprite);
    }
  }
  // Z axis labels (placed along X=0 line)
  for (let z = startZ; z <= maxZ; z += GRID_LABEL_STEP) {
    const key = `z${z}`;
    neededKeys.add(key);
    if (!gridLabelSprites.has(key)) {
      const isMajor = z % 10 === 0;
      const sprite = _makeTextSprite(String(z), isMajor);
      sprite.position.set(0.6, 0.15, z);
      if (state.isPlaytest) sprite.visible = false;
      scene.add(sprite);
      gridLabelSprites.set(key, sprite);
    }
  }

  // Remove labels that are no longer needed
  for (const [key, sprite] of gridLabelSprites) {
    if (!neededKeys.has(key)) {
      scene.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
      gridLabelSprites.delete(key);
    }
  }
}

function setGridVisible(visible) {
  for (const [, mesh] of gridChunks) mesh.visible = visible;
  for (const [, sprite] of gridLabelSprites) sprite.visible = visible;
  // Grid fill planes stay visible (floor color persists even when grid lines are hidden)
}

// ─── Coordinate HUD + looked-at object ──────────────────────────────────────
const _coordRay = new THREE.Raycaster();
const _coordCenter = new THREE.Vector2(0, 0);
let _lastCoordHudTime = 0;
let _lastCoordHudAimText = '';
const _COORD_HUD_THROTTLE_MS = 150;

function updateCoordHud() {
  if (!coordHud) return;
  let cam, pos;
  if (state.isPlaytest) {
    cam = fpsCam;
    pos = fpsPos;
  } else {
    cam = editorCam;
    pos = editorCam.position;
  }

  let text = `Pos  X:${pos.x.toFixed(1)}  Y:${pos.y.toFixed(1)}  Z:${pos.z.toFixed(1)}`;

  // Throttle the expensive raycast to avoid running it every frame
  const now = performance.now();
  if (now - _lastCoordHudTime >= _COORD_HUD_THROTTLE_MS) {
    _lastCoordHudTime = now;
    _coordRay.setFromCamera(_coordCenter, cam);
    const hits = _coordRay.intersectObjects(sceneObjects, false);
    if (hits.length > 0) {
      const hit = hits[0];
      const obj = hit.object;
      const label = typeLabel(obj.userData?.type) || obj.name || 'Object';
      const op = obj.position;
      const hp = hit.point;
      _lastCoordHudAimText = `\nAim  ${label} @ ${op.x.toFixed(1)},${op.y.toFixed(1)},${op.z.toFixed(1)}`;
      _lastCoordHudAimText += `\nHit  X:${hp.x.toFixed(1)}  Y:${hp.y.toFixed(1)}  Z:${hp.z.toFixed(1)}`;
    } else {
      _lastCoordHudAimText = '';
    }
  }

  coordHud.textContent = text + _lastCoordHudAimText;
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
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xf0a020, emissive: 0xf0a020, emissiveIntensity: 0.3, transparent: true, opacity: 0.25 }),
    placedY: 1,
  },
  keypad: {
    label: 'Keypad',
    makeGeo: () => new THREE.BoxGeometry(1.6, 2.2, 0.45),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x8ca4b8, roughness: 0.45, metalness: 0.25, emissive: 0x0f141b, emissiveIntensity: 0.45, transparent: true, opacity: 0.50 }),
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
  pivot: {
    label: 'Pivot',
    makeGeo: () => new THREE.SphereGeometry(0.15, 10, 8),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff6600, emissiveIntensity: 1.2, transparent: true, opacity: 0.85 }),
    placedY: 0.15,
  },
  joint: {
    label: 'Joint',
    makeGeo: () => new THREE.SphereGeometry(0.18, 14, 10),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x00ccff, emissiveIntensity: 1.0, transparent: true, opacity: 0.8 }),
    placedY: 0.18,
  },
  skeleton: {
    label: 'Skeleton',
    makeGeo: () => new THREE.SphereGeometry(0.22, 16, 12),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xffaa22, emissive: 0xffaa22, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }),
    placedY: 0.22,
  },
  terrain: {
    label: 'Terrain',
    makeGeo: params => {
      const seg = params?.segments ?? 64;
      const sz  = params?.terrainSize ?? 20;
      const geo = new THREE.PlaneGeometry(sz, sz, seg, seg);
      geo.rotateX(-Math.PI / 2);
      return geo;
    },
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x5a8c3c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, flatShading: true }),
    placedY: 0,
  },
  teleport: {
    label: 'Teleport',
    makeGeo: () => new THREE.TorusGeometry(0.7, 0.12, 12, 24),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x9b59ff, emissive: 0x9b59ff, emissiveIntensity: 0.75, transparent: true, opacity: 0.8 }),
    placedY: 0.7,
  },
  text: {
    label: 'Text',
    makeGeo: () => new THREE.PlaneGeometry(3, 1),
    makeMat: () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide }),
    placedY: 1.5,
  },
  text3d: {
    label: '3D Text',
    makeGeo: () => new THREE.BoxGeometry(3, 1, 0.15),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true }),
    placedY: 1.5,
  },
  screen: {
    label: 'Screen',
    makeGeo: () => new THREE.BoxGeometry(4, 2.25, 0.05),
    makeMat: () => new THREE.MeshBasicMaterial({ color: 0x222222, side: THREE.DoubleSide }),
    placedY: 2,
  },
  camera: {
    label: 'Camera',
    makeGeo: () => new THREE.ConeGeometry(0.25, 0.5, 8),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0x3498db, emissive: 0x3498db, emissiveIntensity: 0.4 }),
    placedY: 2,
  },
  npc: {
    label: 'NPC',
    makeGeo: () => new THREE.BoxGeometry(0.6, 1.8, 0.4),
    makeMat: () => new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.85 }),
    placedY: 0.9,
  },
};

function normalizeSkinGridSize(gridSize = {}) {
  const parseDim = (value, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.max(CUSTOM_SKIN_GRID_MIN, n) : fallback;
  };
  return {
    x: parseDim(gridSize.x, CUSTOM_SKIN_GRID_DEFAULT.x),
    y: parseDim(gridSize.y, CUSTOM_SKIN_GRID_DEFAULT.y),
    z: parseDim(gridSize.z, CUSTOM_SKIN_GRID_DEFAULT.z),
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
    mode: 'variable',
    code: '',
  };
}

const KEYPAD_MODES = ['variable', 'code'];

function normalizeKeypadConfig(config = {}) {
  const base = createDefaultKeypadConfig();
  const title = String(config.title ?? base.title).trim() || base.title;
  const maxDigits = THREE.MathUtils.clamp(parseInt(config.maxDigits, 10) || base.maxDigits, 1, 12);
  const offsetX = THREE.MathUtils.clamp(parseFloat(config.offsetX) || 0, -600, 600);
  const offsetY = THREE.MathUtils.clamp(parseFloat(config.offsetY) || 0, -400, 400);
  const mode = KEYPAD_MODES.includes(config.mode) ? config.mode : base.mode;
  const code = String(config.code ?? '').trim();
  return { title, maxDigits, offsetX, offsetY, mode, code };
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
    const geom = new THREE.BoxGeometry(layout.cellSize, layout.cellSize, layout.cellSize);
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
    // Cache AABB for terrain — only recompute if geometry changed
    if (mesh.userData.type === 'terrain' && mesh.userData._cachedCollisionAABB) {
      out.copy(mesh.userData._cachedCollisionAABB);
      return out;
    }
    out.setFromObject(mesh);
    if (mesh.userData.type === 'terrain') {
      if (!mesh.userData._cachedCollisionAABB) mesh.userData._cachedCollisionAABB = new THREE.Box3();
      mesh.userData._cachedCollisionAABB.copy(out);
    }
    return out;
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

  // Try sculpt skin first
  const sculptSkinRaw = customSculptSkins[mesh.userData.type];
  if (sculptSkinRaw?.primitives?.length) {
    applySculptSkinToMesh(mesh);
    return;
  }

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

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  SKELETON EDITOR OVERLAY                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

function openSkeletonEditor(definitionName) {
  if (skeletonEditorOverlayEl) closeSkeletonEditor();

  // Resolve or create definition
  let defName = String(definitionName || '').trim();
  if (!defName) defName = 'Skeleton_' + Date.now().toString(36);
  if (!skeletonDefinitions[defName]) {
    skeletonDefinitions[defName] = createDefaultSkeletonDefinition(defName);
  }
  const def = skeletonDefinitions[defName];

  // Editor state
  skeletonEditorState = {
    defName,
    selectedBoneId: null,
    mode: 'select', // select | addBone
    currentClipName: '',
    playheadTime: 0,
    isPlaying: false,
    playStartWall: 0,
    playStartTime: 0,
    _animFrameId: null,
  };

  // Build overlay DOM
  const overlay = document.createElement('div');
  overlay.id = 'skeleton-editor-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20010;display:flex;background:#080c10;font-family:inherit;color:#d4d8dd';
  overlay.innerHTML = `
    <div id="skel-left-panel" style="width:240px;min-width:200px;background:#101418;display:flex;flex-direction:column;border-right:1px solid #222">
      <div style="padding:8px 10px;border-bottom:1px solid #222;display:flex;align-items:center;gap:6px">
        <span style="font-size:12px;font-weight:700;color:#ffaa22">☠ Skeleton Editor</span>
        <span id="skel-def-name" style="font-size:10px;color:#889;margin-left:auto;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${defName}">${defName}</span>
      </div>
      <div style="padding:6px 10px;border-bottom:1px solid #222;display:flex;gap:4px;flex-wrap:wrap">
        <button id="skel-btn-add-bone" style="font-size:10px;padding:2px 6px;background:#225;border:1px solid #447;color:#aad;border-radius:3px;cursor:pointer" title="Add child bone to selected (or root)">+ Bone</button>
        <button id="skel-btn-del-bone" style="font-size:10px;padding:2px 6px;background:#422;border:1px solid #744;color:#daa;border-radius:3px;cursor:pointer" title="Delete selected bone (Del)">✕ Bone</button>
        <button id="skel-btn-dup-bone" style="font-size:10px;padding:2px 6px;background:#225;border:1px solid #447;color:#aad;border-radius:3px;cursor:pointer" title="Duplicate selected bone (Ctrl+D)">⊕ Dup</button>
        <button id="skel-btn-humanoid" style="font-size:10px;padding:2px 6px;background:#332200;border:1px solid #664;color:#ffcc66;border-radius:3px;cursor:pointer" title="Load humanoid template">🦴 Humanoid</button>
        <button id="skel-btn-import-fbx" style="font-size:10px;padding:2px 6px;background:#223;border:1px solid #446;color:#aaf;border-radius:3px;cursor:pointer" title="Import animation from .fbx file">📁 Import FBX</button>
        <button id="skel-btn-import-fbx-skin" style="font-size:10px;padding:2px 6px;background:#232;border:1px solid #464;color:#afa;border-radius:3px;cursor:pointer" title="Import mesh/skin from .fbx file as full-body mesh skins">🧍 Import Skin</button>
      </div>
      <div style="padding:4px 10px;font-size:9px;font-weight:700;color:#889;border-bottom:1px solid #1a1a1a">BONE TREE</div>
      <div id="skel-bone-tree" style="flex:1;overflow-y:auto;padding:4px 0;font-size:11px"></div>
      <div id="skel-bone-props" style="border-top:1px solid #222;padding:6px 10px;font-size:10px;display:none">
        <div style="font-size:9px;font-weight:700;color:#889;margin-bottom:4px">BONE PROPERTIES</div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><span style="width:40px;color:#889">Name</span><input id="skel-bone-name" type="text" style="flex:1;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/></div>
        <div style="font-size:9px;color:#667;margin:4px 0 2px">Head (world)</div>
        <div style="display:flex;gap:3px;margin-bottom:3px">
          <span style="color:#e44;font-size:9px">X</span><input id="skel-bone-hx" type="number" step="0.01" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/>
          <span style="color:#4e4;font-size:9px">Y</span><input id="skel-bone-hy" type="number" step="0.01" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/>
          <span style="color:#48f;font-size:9px">Z</span><input id="skel-bone-hz" type="number" step="0.01" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/>
        </div>
        <div style="font-size:9px;color:#667;margin:4px 0 2px">Tail (world)</div>
        <div style="display:flex;gap:3px;margin-bottom:3px">
          <span style="color:#e44;font-size:9px">X</span><input id="skel-bone-tx" type="number" step="0.01" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/>
          <span style="color:#4e4;font-size:9px">Y</span><input id="skel-bone-ty" type="number" step="0.01" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/>
          <span style="color:#48f;font-size:9px">Z</span><input id="skel-bone-tz" type="number" step="0.01" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/>
        </div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><span style="width:40px;color:#889">Roll</span><input id="skel-bone-roll" type="number" step="1" style="width:55px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:2px 4px;font-size:10px"/> <span style="color:#556;font-size:9px">deg</span></div>
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px"><label style="color:#889;font-size:9px;display:flex;align-items:center;gap:4px"><input id="skel-bone-connected" type="checkbox" style="margin:0"/> Connected</label></div>
        <button id="skel-bone-edit-skin" style="font-size:10px;padding:2px 6px;background:#224;border:1px solid #446;color:#aaf;border-radius:3px;cursor:pointer;margin-top:2px" title="Edit voxel skin for this bone">🎨 Edit Bone Skin</button>
      </div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;position:relative;overflow:hidden;min-width:0;min-height:0">
      <canvas id="skel-3d-canvas" style="flex:1;display:block;min-height:0"></canvas>
      <div id="skel-timeline" style="height:120px;min-height:80px;max-height:180px;background:#0c0e12;border-top:1px solid #222;display:flex;flex-direction:column;flex-shrink:0">
        <div style="padding:4px 10px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #1a1a1a">
          <button id="skel-tl-play" style="font-size:11px;padding:1px 6px;background:#1a2a1a;border:1px solid #2a4a2a;color:#8f8;border-radius:3px;cursor:pointer">▶</button>
          <button id="skel-tl-stop" style="font-size:11px;padding:1px 6px;background:#2a1a1a;border:1px solid #4a2a2a;color:#f88;border-radius:3px;cursor:pointer">⏹</button>
          <span style="font-size:9px;color:#889">Time:</span>
          <input id="skel-tl-time" type="number" min="0" step="0.05" value="0" style="width:50px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:1px 4px;font-size:10px"/>
          <span style="font-size:9px;color:#889">/ Dur:</span>
          <input id="skel-tl-duration" type="number" min="0.1" step="0.1" value="1" style="width:45px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;padding:1px 4px;font-size:10px"/>
          <label style="display:flex;align-items:center;gap:2px;font-size:9px;color:#889;cursor:pointer"><input id="skel-tl-loop" type="checkbox" checked style="margin:0"/>Loop</label>
          <span style="font-size:9px;color:#889">Spd:</span>
          <input id="skel-tl-speed" type="range" min="0.1" max="3" step="0.1" value="1" style="width:50px" title="Playback speed"/>
          <span id="skel-tl-speed-val" style="font-size:9px;color:#aaa;min-width:20px">1×</span>
          <button id="skel-tl-add-kf" style="font-size:10px;padding:1px 6px;background:#222;border:1px solid #444;color:#ddd;border-radius:3px;cursor:pointer">◆ Add KF</button>
          <button id="skel-tl-del-kf" style="font-size:10px;padding:1px 6px;background:#322;border:1px solid #544;color:#daa;border-radius:3px;cursor:pointer">✕ KF</button>
          <button id="skel-tl-copy-kf" style="font-size:10px;padding:1px 6px;background:#222;border:1px solid #444;color:#ddd;border-radius:3px;cursor:pointer" title="Copy current bone pose">📋 Copy</button>
          <button id="skel-tl-paste-kf" style="font-size:10px;padding:1px 6px;background:#222;border:1px solid #444;color:#ddd;border-radius:3px;cursor:pointer" title="Paste as keyframe at playhead">📌 Paste</button>
          <select id="skel-tl-clip" style="font-size:10px;padding:1px 4px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px;margin-left:auto"></select>
          <button id="skel-tl-new-clip" style="font-size:10px;padding:1px 6px;background:#222;border:1px solid #444;color:#ddd;border-radius:3px;cursor:pointer">+ Clip</button>
          <button id="skel-tl-del-clip" style="font-size:10px;padding:1px 6px;background:#322;border:1px solid #544;color:#daa;border-radius:3px;cursor:pointer">✕ Clip</button>
        </div>
        <div id="skel-tl-track" style="flex:1;position:relative;overflow:hidden;cursor:crosshair">
          <canvas id="skel-tl-canvas" style="width:100%;height:100%;display:block"></canvas>
        </div>
      </div>
    </div>
    <div id="skel-right-panel" style="width:180px;min-width:140px;background:#101418;display:flex;flex-direction:column;border-left:1px solid #222">
      <div style="padding:6px 10px;border-bottom:1px solid #222;font-size:9px;font-weight:700;color:#889">POSES</div>
      <div id="skel-pose-list" style="flex:1;overflow-y:auto;padding:4px 0;font-size:10px"></div>
      <div style="padding:4px 10px;border-top:1px solid #222;display:flex;gap:4px;flex-wrap:wrap">
        <button id="skel-pose-save" style="font-size:10px;padding:2px 6px;background:#1a2a1a;border:1px solid #2a4a2a;color:#8f8;border-radius:3px;cursor:pointer;flex:1">Save Pose</button>
        <button id="skel-pose-load" style="font-size:10px;padding:2px 6px;background:#222;border:1px solid #444;color:#ddd;border-radius:3px;cursor:pointer;flex:1">Load Pose</button>
        <button id="skel-pose-mirror" style="font-size:10px;padding:2px 6px;background:#224;border:1px solid #446;color:#aaf;border-radius:3px;cursor:pointer;flex:1" title="Mirror pose left↔right">↔ Mirror</button>
      </div>
      <div style="padding:6px 10px;border-top:1px solid #222;border-bottom:1px solid #222;font-size:9px;font-weight:700;color:#889">ACTIONS</div>
      <div style="padding:4px 10px;display:flex;flex-direction:column;gap:3px">
        <button id="skel-btn-close" style="font-size:11px;padding:4px 8px;background:#2a1a1a;border:1px solid #4a2a2a;color:#f88;border-radius:3px;cursor:pointer">✕ Close Editor</button>
      </div>
      <div style="padding:6px 10px;border-top:1px solid #222;font-size:9px;color:#667;line-height:1.6;overflow-y:auto">
        <div style="font-weight:700;color:#889;margin-bottom:4px">📖 How to Use</div>
        <div><b style="color:#ffaa22">1.</b> Click <b>🦴 Humanoid</b> to load a template, or <b>+ Bone</b> to add manually. <b>⊕ Dup</b> duplicates the selected bone.</div>
        <div><b style="color:#ffaa22">2.</b> Click bones in the <b>tree</b> or <b>3D view</b> to select. Edit properties below, or <b>drag the gizmo</b> in 3D (press <b>G</b>=move, <b>R</b>=rotate).</div>
        <div><b style="color:#ffaa22">3.</b> <b>🎨 Edit Bone Skin</b> — paint voxels onto the selected bone.</div>
        <div><b style="color:#ffaa22">4.</b> <b>Timeline:</b> <b>+ Clip</b> to create a clip → pose bones → <b>◆ Add KF</b>. Use <b>📋 Copy / 📌 Paste</b> to duplicate poses between times.</div>
        <div><b style="color:#ffaa22">5.</b> <b>📁 Import FBX</b> — import animations from Mixamo or other .fbx files directly onto your skeleton.</div>
        <div><b style="color:#ffaa22">6.</b> <b>↔ Mirror</b> swaps left/right pose. <b>Save/Load Pose</b> for snapshots.</div>
        <div style="margin-top:4px;color:#556">🖱 Orbit, scroll zoom. <b>Del</b>=delete bone, <b>Ctrl+D</b>=dup, <b>Space</b>=play/stop, <b>←/→</b>=nudge time.</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  skeletonEditorOverlayEl = overlay;

  // ─── 3D Scene Setup ─────────────────────────────────────────────────────────
  const skelCanvas = document.getElementById('skel-3d-canvas');
  const skelRenderer = new THREE.WebGLRenderer({ canvas: skelCanvas, antialias: true });
  skelRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  skelRenderer.setClearColor(0x12161c);

  const skelScene = new THREE.Scene();
  const skelCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  skelCamera.position.set(0, 1.2, 3);

  const skelControls = new OrbitControls(skelCamera, skelCanvas);
  skelControls.target.set(0, 0.6, 0);
  skelControls.enableDamping = true;
  skelControls.dampingFactor = 0.12;
  skelControls.update();

  // Lights
  const skelAmbient = new THREE.AmbientLight(0x445566, 0.6);
  skelScene.add(skelAmbient);
  const skelDirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
  skelDirLight.position.set(3, 5, 4);
  skelScene.add(skelDirLight);

  // Ground grid
  const skelGrid = new THREE.GridHelper(4, 16, 0x333, 0x222);
  skelScene.add(skelGrid);

  // Bone visual group
  const boneVisualGroup = new THREE.Group();
  skelScene.add(boneVisualGroup);

  // Bone skin visual group
  const boneSkinGroup = new THREE.Group();
  skelScene.add(boneSkinGroup);

  // Shared geometry for bone markers
  const boneSphereGeo = new THREE.SphereGeometry(0.04, 8, 6);
  const boneLineMaterial = new THREE.LineBasicMaterial({ color: 0xcccccc, linewidth: 1 });
  const BONE_COLORS = {
    default: 0xcccccc, selected: 0xffee44, root: 0x44ff88, hasSkin: 0x6688ff,
  };

  let skeletonResult = null; // { skeleton, rootGroup, boneMap, allBones }

  skeleton3DState = {
    renderer: skelRenderer, scene: skelScene, camera: skelCamera, controls: skelControls,
    boneVisualGroup, boneSkinGroup, boneMap: null,
  };

  function skel3DResize() {
    const container = skelCanvas.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w < 1 || h < 1) return;
    skelRenderer.setSize(w, h, false);
    skelCamera.aspect = w / h;
    skelCamera.updateProjectionMatrix();
  }

  // Use ResizeObserver for layout changes instead of per-frame resize
  const _skelResizeObserver = new ResizeObserver(() => skel3DResize());
  _skelResizeObserver.observe(skelCanvas.parentElement);
  overlay._skelResizeObserver = _skelResizeObserver;

  // ─── Rebuild bone visuals from definition ──────────────────────────────────
  function rebuildBoneVisuals() {
    // Clear old
    while (boneVisualGroup.children.length) {
      const c = boneVisualGroup.children[0];
      boneVisualGroup.remove(c);
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    if (skeletonResult?.rootGroup) {
      skelScene.remove(skeletonResult.rootGroup);
    }

    const result = buildThreeBonesFromDef(def);
    if (!result) { skeletonResult = null; skeleton3DState.boneMap = null; return; }
    skeletonResult = result;
    skeleton3DState.boneMap = result.boneMap;

    skelScene.add(result.rootGroup);
    result.rootGroup.updateMatrixWorld(true);

    // Draw bone markers and connecting lines
    for (const bd of def.bones) {
      const threeBone = result.boneMap.get(bd.id);
      if (!threeBone) continue;

      const worldPos = new THREE.Vector3();
      threeBone.getWorldPosition(worldPos);

      // Sphere marker
      const isSelected = skeletonEditorState.selectedBoneId === bd.id;
      const isRoot = bd.parent === null;
      const hasSkin = !!(def.boneSkins[bd.id]?.voxels?.length || def.boneSkins[bd.id]?.type === 'mesh');
      let color = BONE_COLORS.default;
      if (isSelected) color = BONE_COLORS.selected;
      else if (hasSkin) color = BONE_COLORS.hasSkin;
      else if (isRoot) color = BONE_COLORS.root;

      const markerMat = new THREE.MeshBasicMaterial({ color });
      const marker = new THREE.Mesh(boneSphereGeo, markerMat);
      marker.position.copy(worldPos);
      marker.userData._boneId = bd.id;
      boneVisualGroup.add(marker);

      // Line to parent
      if (bd.parent) {
        const parentBone = result.boneMap.get(bd.parent);
        if (parentBone) {
          const parentPos = new THREE.Vector3();
          parentBone.getWorldPosition(parentPos);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([parentPos, worldPos]);
          const lineColor = isSelected ? 0xffee44 : 0x667788;
          const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: lineColor }));
          boneVisualGroup.add(line);
        }
      }

      // Bone length indicator (small line extending from bone)
      const endPos = new THREE.Vector3(0, boneLength(bd), 0);
      endPos.applyQuaternion(threeBone.getWorldQuaternion(new THREE.Quaternion()));
      endPos.add(worldPos);
      const lenGeo = new THREE.BufferGeometry().setFromPoints([worldPos, endPos]);
      const lenLine = new THREE.Line(lenGeo, new THREE.LineBasicMaterial({ color: color, linewidth: 1, opacity: 0.5, transparent: true }));
      boneVisualGroup.add(lenLine);
    }

    rebuildBoneSkinVisuals();
  }

  // ─── Lightweight: update bone marker positions without rebuilding skeleton ──
  function updateBoneMarkerPositions() {
    if (!skeletonResult?.boneMap) return;

    // Clear old visuals only (markers/lines), keep skeleton structure intact
    while (boneVisualGroup.children.length) {
      const c = boneVisualGroup.children[0];
      boneVisualGroup.remove(c);
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }

    for (const bd of def.bones) {
      const threeBone = skeletonResult.boneMap.get(bd.id);
      if (!threeBone) continue;

      const worldPos = new THREE.Vector3();
      threeBone.getWorldPosition(worldPos);

      // Sphere marker
      const isSelected = skeletonEditorState.selectedBoneId === bd.id;
      const isRoot = bd.parent === null;
      const hasSkin = !!(def.boneSkins[bd.id]?.voxels?.length || def.boneSkins[bd.id]?.type === 'mesh');
      let color = BONE_COLORS.default;
      if (isSelected) color = BONE_COLORS.selected;
      else if (hasSkin) color = BONE_COLORS.hasSkin;
      else if (isRoot) color = BONE_COLORS.root;

      const markerMat = new THREE.MeshBasicMaterial({ color });
      const marker = new THREE.Mesh(boneSphereGeo, markerMat);
      marker.position.copy(worldPos);
      marker.userData._boneId = bd.id;
      boneVisualGroup.add(marker);

      // Line to parent
      if (bd.parent) {
        const parentBone = skeletonResult.boneMap.get(bd.parent);
        if (parentBone) {
          const parentPos = new THREE.Vector3();
          parentBone.getWorldPosition(parentPos);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([parentPos, worldPos]);
          const lineColor = isSelected ? 0xffee44 : 0x667788;
          const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: lineColor }));
          boneVisualGroup.add(line);
        }
      }

      // Bone length indicator
      const endPos = new THREE.Vector3(0, boneLength(bd), 0);
      endPos.applyQuaternion(threeBone.getWorldQuaternion(new THREE.Quaternion()));
      endPos.add(worldPos);
      const lenGeo = new THREE.BufferGeometry().setFromPoints([worldPos, endPos]);
      const lenLine = new THREE.Line(lenGeo, new THREE.LineBasicMaterial({ color: color, linewidth: 1, opacity: 0.5, transparent: true }));
      boneVisualGroup.add(lenLine);
    }

    rebuildBoneSkinVisuals();
  }

  // ─── Rebuild per-bone skin visuals (mesh or voxel) ───────────────────────────
  function rebuildBoneSkinVisuals() {
    while (boneSkinGroup.children.length) {
      const c = boneSkinGroup.children[0];
      boneSkinGroup.remove(c);
      c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    if (!skeletonResult) return;

    for (const [boneId, skinDef] of Object.entries(def.boneSkins)) {
      const threeBone = skeletonResult.boneMap.get(boneId);
      if (!threeBone) continue;

      const boneDef = def.bones.find(b => b.id === boneId);
      const boneLen = boneDef ? boneLength(boneDef) : 0.3;
      const boneGroup = new THREE.Group();

      if (skinDef?.type === 'mesh' && skinDef.vertices?.length && skinDef.indices?.length) {
        // ── Mesh skin path ──
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(skinDef.vertices, 3));
        geo.setIndex(skinDef.indices);
        if (skinDef.colors?.length) {
          const floatColors = new Float32Array(skinDef.colors.length);
          for (let i = 0; i < skinDef.colors.length; i++) floatColors[i] = skinDef.colors[i] / 255;
          geo.setAttribute('color', new THREE.Float32BufferAttribute(floatColors, 3));
        }
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: !!(skinDef.colors?.length),
          roughness: 0.7, metalness: 0.1,
          side: THREE.DoubleSide,
          color: skinDef.colors?.length ? 0xffffff : 0x7f8ea0,
        });
        boneGroup.add(new THREE.Mesh(geo, mat));

      } else if (skinDef?.voxels?.length) {
        // ── Voxel skin path (legacy) ──
        const gridSize = normalizeSkinGridSize(skinDef.gridSize || { x: 4, y: 4, z: 4 });
        const voxels = skinDef.voxels;
        const cellSize = boneLen / Math.max(gridSize.x, gridSize.y, gridSize.z);

        const byColor = new Map();
        for (const v of voxels) {
          const col = v.color ?? 0x7f8ea0;
          if (!byColor.has(col)) byColor.set(col, []);
          byColor.get(col).push(v);
        }

        const sharedGeo = new THREE.BoxGeometry(cellSize * 0.95, cellSize * 0.95, cellSize * 0.95);
        for (const [color, colorVoxels] of byColor) {
          const mat = new THREE.MeshStandardMaterial({ color });
          const instMesh = new THREE.InstancedMesh(sharedGeo, mat, colorVoxels.length);
          const mtx = new THREE.Matrix4();
          for (let i = 0; i < colorVoxels.length; i++) {
            const v = colorVoxels[i];
            mtx.makeTranslation(
              (v.x - gridSize.x / 2 + 0.5) * cellSize,
              (v.y - gridSize.y / 2 + 0.5) * cellSize + boneLen / 2,
              (v.z - gridSize.z / 2 + 0.5) * cellSize
            );
            instMesh.setMatrixAt(i, mtx);
          }
          instMesh.instanceMatrix.needsUpdate = true;
          boneGroup.add(instMesh);
        }
      } else {
        continue; // no skin data
      }

      // Attach to bone world transform
      const boneWorldPos = new THREE.Vector3();
      const boneWorldQuat = new THREE.Quaternion();
      threeBone.getWorldPosition(boneWorldPos);
      threeBone.getWorldQuaternion(boneWorldQuat);
      boneGroup.position.copy(boneWorldPos);
      // Mesh skins: apply FBX bind-pose world quat correction
      // Voxel skins: apply alignment correction to orient grid along bone direction
      const isMeshSkin = skinDef?.type === 'mesh';
      const bindWorldQuat = isMeshSkin && def.boneBindWorldQuats?.[boneId];
      if (bindWorldQuat) {
        const bwq = new THREE.Quaternion(bindWorldQuat[0], bindWorldQuat[1], bindWorldQuat[2], bindWorldQuat[3]);
        boneGroup.quaternion.copy(boneWorldQuat).multiply(bwq);
      } else {
        const isVoxelSkin = !isMeshSkin;
        boneGroup.quaternion.copy(boneWorldQuat);
      }
      boneGroup.userData._skinBoneId = boneId;
      boneSkinGroup.add(boneGroup);
    }
  }

  // ─── Bone tree UI ──────────────────────────────────────────────────────────
  const boneTreeEl = document.getElementById('skel-bone-tree');

  function refreshBoneTree() {
    const bones = def.bones;
    const childrenMap = new Map();
    const rootBones = [];
    for (const b of bones) {
      if (b.parent && bones.some(p => p.id === b.parent)) {
        if (!childrenMap.has(b.parent)) childrenMap.set(b.parent, []);
        childrenMap.get(b.parent).push(b);
      } else {
        rootBones.push(b);
      }
    }

    function renderBone(b, depth) {
      const indent = depth * 14;
      const isSel = skeletonEditorState.selectedBoneId === b.id;
      const hasSkin = !!(def.boneSkins[b.id]?.voxels?.length || def.boneSkins[b.id]?.type === 'mesh');
      const skinIcon = hasSkin ? '🎨' : '';
      const children = childrenMap.get(b.id) || [];
      let html = `<div class="skel-bone-item" data-bone-id="${b.id}" style="padding:2px 6px 2px ${6 + indent}px;cursor:pointer;background:${isSel ? '#2a3040' : 'transparent'};border-left:2px solid ${isSel ? '#ffaa22' : 'transparent'};display:flex;align-items:center;gap:3px" title="${b.id}">
        <span style="color:${!b.parent ? '#4f8' : '#aaa'};font-size:9px">${!b.parent ? '◉' : '○'}</span>
        <span style="color:${isSel ? '#ffcc44' : '#ccc'};font-size:10px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.name}</span>
        ${skinIcon ? `<span style="font-size:9px">${skinIcon}</span>` : ''}
      </div>`;
      for (const child of children) {
        html += renderBone(child, depth + 1);
      }
      return html;
    }

    boneTreeEl.innerHTML = rootBones.length
      ? rootBones.map(b => renderBone(b, 0)).join('')
      : '<div style="padding:8px 10px;color:#667;font-size:10px;text-align:center">No bones yet.<br>Click "+ Bone" or "🦴 Humanoid"</div>';

    // Click handlers
    boneTreeEl.querySelectorAll('.skel-bone-item').forEach(el => {
      el.addEventListener('click', () => {
        skeletonEditorState.selectedBoneId = el.dataset.boneId;
        refreshBoneTree();
        refreshBoneProps();
        rebuildBoneVisuals();
        if (typeof attachTransformToBone === 'function') attachTransformToBone(el.dataset.boneId);
      });
    });
  }

  // ─── Bone properties panel ──────────────────────────────────────────────────
  const bonePropsEl = document.getElementById('skel-bone-props');

  function refreshBoneProps() {
    const bid = skeletonEditorState.selectedBoneId;
    const boneDef = bid ? def.bones.find(b => b.id === bid) : null;
    if (!boneDef) {
      bonePropsEl.style.display = 'none';
      return;
    }
    bonePropsEl.style.display = '';
    document.getElementById('skel-bone-name').value = boneDef.name;
    document.getElementById('skel-bone-length').value = boneDef.length;
    document.getElementById('skel-bone-px').value = boneDef.position[0];
    document.getElementById('skel-bone-py').value = boneDef.position[1];
    document.getElementById('skel-bone-pz').value = boneDef.position[2];

    // Convert quaternion to euler for display
    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(boneDef.rotation[0], boneDef.rotation[1], boneDef.rotation[2], boneDef.rotation[3])
    );
    const R2D = 180 / Math.PI;
    document.getElementById('skel-bone-rx').value = Math.round(euler.x * R2D * 10) / 10;
    document.getElementById('skel-bone-ry').value = Math.round(euler.y * R2D * 10) / 10;
    document.getElementById('skel-bone-rz').value = Math.round(euler.z * R2D * 10) / 10;
  }

  function applyBoneProps() {
    const bid = skeletonEditorState.selectedBoneId;
    const boneDef = bid ? def.bones.find(b => b.id === bid) : null;
    if (!boneDef) return;

    boneDef.name = document.getElementById('skel-bone-name').value.trim() || 'Bone';
    boneDef.length = Math.max(0.01, parseFloat(document.getElementById('skel-bone-length').value) || 0.3);
    boneDef.position[0] = parseFloat(document.getElementById('skel-bone-px').value) || 0;
    boneDef.position[1] = parseFloat(document.getElementById('skel-bone-py').value) || 0;
    boneDef.position[2] = parseFloat(document.getElementById('skel-bone-pz').value) || 0;

    const D2R = Math.PI / 180;
    const rx = (parseFloat(document.getElementById('skel-bone-rx').value) || 0) * D2R;
    const ry = (parseFloat(document.getElementById('skel-bone-ry').value) || 0) * D2R;
    const rz = (parseFloat(document.getElementById('skel-bone-rz').value) || 0) * D2R;
    const euler = new THREE.Euler(rx, ry, rz);
    const quat = new THREE.Quaternion().setFromEuler(euler);
    boneDef.rotation = quat.toArray();

    refreshBoneTree();
    rebuildBoneVisuals();
    markRestoreDirty();
  }

  // Wire bone property inputs
  ['skel-bone-name', 'skel-bone-length', 'skel-bone-px', 'skel-bone-py', 'skel-bone-pz',
   'skel-bone-rx', 'skel-bone-ry', 'skel-bone-rz'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', applyBoneProps);
  });

  // ─── Add / Delete bone ─────────────────────────────────────────────────────
  document.getElementById('skel-btn-add-bone').addEventListener('click', () => {
    const parentId = skeletonEditorState.selectedBoneId || null;
    const newBone = createDefaultBone({
      name: 'Bone_' + (def.bones.length + 1),
      parent: parentId,
      position: parentId ? [0, 0.2, 0] : [0, 0, 0],
      length: 0.2,
    });
    def.bones.push(newBone);
    skeletonEditorState.selectedBoneId = newBone.id;
    refreshBoneTree();
    refreshBoneProps();
    rebuildBoneVisuals();
    markRestoreDirty();
  });

  document.getElementById('skel-btn-del-bone').addEventListener('click', () => {
    const bid = skeletonEditorState.selectedBoneId;
    if (!bid) return;
    // Find all descendants
    const toRemove = new Set([bid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of def.bones) {
        if (b.parent && toRemove.has(b.parent) && !toRemove.has(b.id)) {
          toRemove.add(b.id);
          changed = true;
        }
      }
    }
    def.bones = def.bones.filter(b => !toRemove.has(b.id));
    // Remove bone skins for deleted bones
    for (const id of toRemove) delete def.boneSkins[id];
    // Remove from poses
    for (const pose of Object.values(def.poses)) {
      for (const id of toRemove) delete pose[id];
    }
    // Remove from animation keyframes
    for (const anim of Object.values(def.animations)) {
      for (const kf of anim.keyframes) {
        for (const id of toRemove) delete kf.bones[id];
      }
    }
    skeletonEditorState.selectedBoneId = null;
    refreshBoneTree();
    refreshBoneProps();
    rebuildBoneVisuals();
    markRestoreDirty();
  });

  // ─── Humanoid template ──────────────────────────────────────────────────────
  document.getElementById('skel-btn-humanoid').addEventListener('click', () => {
    if (def.bones.length > 0 && !confirm('This will replace all current bones. Continue?')) return;
    const humanoid = createHumanoidSkeleton(def.name);
    def.bones = humanoid.bones;
    def.poses = humanoid.poses;
    def.animations = {};
    def.boneSkins = {};
    skeletonEditorState.selectedBoneId = 'root';
    refreshBoneTree();
    refreshBoneProps();
    rebuildBoneVisuals();
    refreshPoseList();
    refreshClipSelect();
    markRestoreDirty();
  });

  // ─── Duplicate bone ─────────────────────────────────────────────────────────
  function duplicateSelectedBone() {
    const bid = skeletonEditorState.selectedBoneId;
    const boneDef = bid ? def.bones.find(b => b.id === bid) : null;
    if (!boneDef) return;
    const newBone = createDefaultBone({
      name: boneDef.name + '_copy',
      parent: boneDef.parent,
      position: [...boneDef.position],
      rotation: [...boneDef.rotation],
      length: boneDef.length,
    });
    def.bones.push(newBone);
    skeletonEditorState.selectedBoneId = newBone.id;
    refreshBoneTree();
    refreshBoneProps();
    rebuildBoneVisuals();
    markRestoreDirty();
  }
  document.getElementById('skel-btn-dup-bone').addEventListener('click', duplicateSelectedBone);

  // ─── TransformControls for interactive bone editing ─────────────────────────
  const skelTransformCtrl = new TransformControls(skelCamera, skelCanvas);
  skelTransformCtrl.setSize(0.6);
  skelTransformCtrl.setSpace('local');
  skelScene.add(skelTransformCtrl);
  skelTransformCtrl.addEventListener('dragging-changed', (e) => {
    skelControls.enabled = !e.value;
  });
  let _skelTransformTarget = null;

  function attachTransformToBone(boneId) {
    if (!skeletonResult?.boneMap) { skelTransformCtrl.detach(); _skelTransformTarget = null; return; }
    const threeBone = skeletonResult.boneMap.get(boneId);
    if (!threeBone) { skelTransformCtrl.detach(); _skelTransformTarget = null; return; }
    skelTransformCtrl.attach(threeBone);
    _skelTransformTarget = boneId;
  }

  skelTransformCtrl.addEventListener('objectChange', () => {
    if (!_skelTransformTarget) return;
    const boneDef = def.bones.find(b => b.id === _skelTransformTarget);
    const threeBone = skeletonResult?.boneMap?.get(_skelTransformTarget);
    if (!boneDef || !threeBone) return;
    boneDef.position = [threeBone.position.x, threeBone.position.y, threeBone.position.z];
    boneDef.rotation = threeBone.quaternion.toArray();
    refreshBoneProps();
    skeletonResult.rootGroup.updateMatrixWorld(true);
    rebuildBoneVisuals();
    if (_skelTransformTarget) attachTransformToBone(_skelTransformTarget);
  });

  // ─── 3D bone click selection (raycasting) ──────────────────────────────────
  const _skelRaycaster = new THREE.Raycaster();
  const _skelMouse = new THREE.Vector2();

  skelCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (skelTransformCtrl.dragging) return;
    const rect = skelCanvas.getBoundingClientRect();
    _skelMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _skelMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _skelRaycaster.setFromCamera(_skelMouse, skelCamera);

    const hits = _skelRaycaster.intersectObjects(boneVisualGroup.children, false);
    const boneHit = hits.find(h => h.object.userData._boneId);
    if (boneHit) {
      skeletonEditorState.selectedBoneId = boneHit.object.userData._boneId;
      refreshBoneTree();
      refreshBoneProps();
      rebuildBoneVisuals();
      attachTransformToBone(boneHit.object.userData._boneId);
    }
  });

  // ─── Pose system ───────────────────────────────────────────────────────────
  const poseListEl = document.getElementById('skel-pose-list');

  function refreshPoseList() {
    const names = Object.keys(def.poses);
    poseListEl.innerHTML = names.length
      ? names.map(name => `<div class="skel-pose-item" data-pose="${name}" style="padding:3px 10px;cursor:pointer;display:flex;align-items:center;gap:4px;font-size:10px">
          <span style="flex:1;color:#ccc">${name}</span>
          <button class="skel-pose-del" data-pose="${name}" style="font-size:8px;background:#322;border:1px solid #544;color:#daa;border-radius:2px;padding:0 3px;cursor:pointer">✕</button>
        </div>`).join('')
      : '<div style="padding:8px 10px;color:#667;font-size:10px;text-align:center">No poses saved.</div>';

    poseListEl.querySelectorAll('.skel-pose-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('skel-pose-del')) {
          const poseName = e.target.dataset.pose;
          delete def.poses[poseName];
          refreshPoseList();
          markRestoreDirty();
          return;
        }
        const poseName = el.dataset.pose;
        if (def.poses[poseName] && skeletonResult?.boneMap) {
          applyPoseToSkeleton(skeletonResult.boneMap, def.poses[poseName], skeletonResult.restLocalQuats);
          skeletonResult.rootGroup.updateMatrixWorld(true);
          rebuildBoneVisuals();
        }
      });
    });
  }

  document.getElementById('skel-pose-save').addEventListener('click', () => {
    if (!skeletonResult?.boneMap) return;
    const name = prompt('Pose name:', 'Pose_' + (Object.keys(def.poses).length + 1));
    if (!name?.trim()) return;
    def.poses[name.trim()] = capturePoseFromSkeleton(skeletonResult.boneMap, skeletonResult.restLocalQuats);
    refreshPoseList();
    markRestoreDirty();
  });

  document.getElementById('skel-pose-load').addEventListener('click', () => {
    const names = Object.keys(def.poses);
    if (!names.length) return;
    const name = prompt('Load pose name:\n' + names.join(', '));
    if (!name?.trim() || !def.poses[name.trim()]) return;
    if (skeletonResult?.boneMap) {
      applyPoseToSkeleton(skeletonResult.boneMap, def.poses[name.trim()], skeletonResult.restLocalQuats);
      skeletonResult.rootGroup.updateMatrixWorld(true);
      rebuildBoneVisuals();
    }
  });

  // ─── Mirror pose ───────────────────────────────────────────────────────────
  document.getElementById('skel-pose-mirror').addEventListener('click', () => {
    if (!skeletonResult?.boneMap) return;
    const currentPose = capturePoseFromSkeleton(skeletonResult.boneMap, skeletonResult.restLocalQuats);
    const mirrored = mirrorPose(currentPose);
    applyPoseToSkeleton(skeletonResult.boneMap, mirrored, skeletonResult.restLocalQuats);
    skeletonResult.rootGroup.updateMatrixWorld(true);
    rebuildBoneVisuals();
  });

  // ─── Per-bone voxel skin editing ───────────────────────────────────────────
  document.getElementById('skel-bone-edit-skin').addEventListener('click', () => {
    const bid = skeletonEditorState.selectedBoneId;
    if (!bid) return;
    const boneDef = def.bones.find(b => b.id === bid);
    if (!boneDef) return;

    // Initialize bone skin if missing
    if (!def.boneSkins[bid]) {
      def.boneSkins[bid] = { gridSize: { x: 4, y: 4, z: 4 }, voxels: [] };
    }
    const skinDef = def.boneSkins[bid];

    // Open mini voxel editor as a sub-overlay
    const subOverlay = document.createElement('div');
    subOverlay.id = 'skel-bone-skin-overlay';
    subOverlay.style.cssText = 'position:fixed;inset:40px;z-index:20020;background:#0c0e12;border:2px solid #ffaa22;border-radius:8px;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,0,0,0.8)';
    subOverlay.innerHTML = `
      <div style="padding:8px 12px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #222">
        <span style="font-size:12px;font-weight:700;color:#ffaa22">🎨 Bone Skin: ${boneDef.name}</span>
        <span style="font-size:9px;color:#667">Grid: </span>
        <input id="bskin-gx" type="number" min="1" max="16" value="${skinDef.gridSize.x}" style="width:32px;font-size:10px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:2px;padding:1px 3px"/>
        <span style="color:#667">×</span>
        <input id="bskin-gy" type="number" min="1" max="16" value="${skinDef.gridSize.y}" style="width:32px;font-size:10px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:2px;padding:1px 3px"/>
        <span style="color:#667">×</span>
        <input id="bskin-gz" type="number" min="1" max="16" value="${skinDef.gridSize.z}" style="width:32px;font-size:10px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:2px;padding:1px 3px"/>
        <input id="bskin-color" type="color" value="#7f8ea0" style="width:28px;height:22px;border:none;cursor:pointer;margin-left:8px"/>
        <select id="bskin-mode" style="font-size:10px;padding:1px 4px;background:#1a1e24;border:1px solid #333;color:#d4d8dd;border-radius:3px">
          <option value="paint">Paint</option>
          <option value="erase">Erase</option>
        </select>
        <span style="font-size:9px;color:#667;margin-left:4px">Layer Y:</span>
        <input id="bskin-layer" type="range" min="0" max="${skinDef.gridSize.y - 1}" value="0" style="width:60px"/>
        <span id="bskin-layer-val" style="font-size:10px;color:#aaa">0</span>
        <button id="bskin-save" style="font-size:10px;padding:2px 10px;background:#1a2a1a;border:1px solid #2a4a2a;color:#8f8;border-radius:3px;cursor:pointer;margin-left:auto">Save</button>
        <button id="bskin-cancel" style="font-size:10px;padding:2px 10px;background:#2a1a1a;border:1px solid #4a2a2a;color:#f88;border-radius:3px;cursor:pointer">Cancel</button>
      </div>
      <canvas id="bskin-canvas" style="flex:1;display:block"></canvas>
    `;
    document.body.appendChild(subOverlay);

    // Mini 3D voxel editor
    const bCanvas = document.getElementById('bskin-canvas');
    const bRenderer = new THREE.WebGLRenderer({ canvas: bCanvas, antialias: true });
    bRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    bRenderer.setClearColor(0x141820);
    const bScene = new THREE.Scene();
    const bCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
    bCamera.position.set(1, 1, 2);
    const bControls = new OrbitControls(bCamera, bCanvas);
    bControls.enableDamping = true;
    bScene.add(new THREE.AmbientLight(0x445566, 0.6));
    const bDirLight = new THREE.DirectionalLight(0xffeedd, 1.0);
    bDirLight.position.set(2, 4, 3);
    bScene.add(bDirLight);

    const bVoxelMap = new Map();
    // Load existing voxels
    for (const v of skinDef.voxels) bVoxelMap.set(`${v.x}|${v.y}|${v.z}`, v.color);

    const bVoxelGroup = new THREE.Group();
    bScene.add(bVoxelGroup);
    const bGridGroup = new THREE.Group();
    bScene.add(bGridGroup);

    let bGridSize = { ...skinDef.gridSize };
    let bLayer = 0;
    let bBrushColor = 0x7f8ea0;
    let bEraseMode = false;

    function bRebuildGrid() {
      while (bGridGroup.children.length) bGridGroup.remove(bGridGroup.children[0]);
      const g = bGridSize;
      const cellSize = boneDef.length / Math.max(g.x, g.y, g.z);
      // Draw layer grid
      for (let x = 0; x <= g.x; x++) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3((x - g.x / 2) * cellSize, (bLayer - g.y / 2 + 0.5) * cellSize, (-g.z / 2) * cellSize),
          new THREE.Vector3((x - g.x / 2) * cellSize, (bLayer - g.y / 2 + 0.5) * cellSize, (g.z / 2) * cellSize),
        ]);
        bGridGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x335, transparent: true, opacity: 0.5 })));
      }
      for (let z = 0; z <= g.z; z++) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3((-g.x / 2) * cellSize, (bLayer - g.y / 2 + 0.5) * cellSize, (z - g.z / 2) * cellSize),
          new THREE.Vector3((g.x / 2) * cellSize, (bLayer - g.y / 2 + 0.5) * cellSize, (z - g.z / 2) * cellSize),
        ]);
        bGridGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x335, transparent: true, opacity: 0.5 })));
      }
    }

    function bRebuildVoxels() {
      while (bVoxelGroup.children.length) {
        const c = bVoxelGroup.children[0];
        bVoxelGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
      const g = bGridSize;
      const cellSize = boneDef.length / Math.max(g.x, g.y, g.z);
      const sharedGeo = new THREE.BoxGeometry(cellSize * 0.92, cellSize * 0.92, cellSize * 0.92);
      for (const [key, color] of bVoxelMap) {
        const [x, y, z] = key.split('|').map(Number);
        const mat = new THREE.MeshStandardMaterial({ color });
        const mesh = new THREE.Mesh(sharedGeo, mat);
        mesh.position.set(
          (x - g.x / 2 + 0.5) * cellSize,
          (y - g.y / 2 + 0.5) * cellSize,
          (z - g.z / 2 + 0.5) * cellSize
        );
        mesh.userData._vkey = key;
        bVoxelGroup.add(mesh);
      }
    }

    // Click to paint/erase
    const bRay = new THREE.Raycaster();
    const bMouse = new THREE.Vector2();
    bCanvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = bCanvas.getBoundingClientRect();
      bMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      bMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      bRay.setFromCamera(bMouse, bCamera);

      if (bEraseMode) {
        // Erase: hit existing voxel
        const hits = bRay.intersectObjects(bVoxelGroup.children, false);
        if (hits.length) {
          const key = hits[0].object.userData._vkey;
          if (key) { bVoxelMap.delete(key); bRebuildVoxels(); }
        }
      } else {
        // Paint on grid plane (Y = layer)
        const g = bGridSize;
        const cellSize = boneDef.length / Math.max(g.x, g.y, g.z);
        const planeY = (bLayer - g.y / 2 + 0.5) * cellSize;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const pt = new THREE.Vector3();
        bRay.ray.intersectPlane(plane, pt);
        if (pt) {
          const gx = Math.floor(pt.x / cellSize + g.x / 2);
          const gz = Math.floor(pt.z / cellSize + g.z / 2);
          if (gx >= 0 && gx < g.x && gz >= 0 && gz < g.z) {
            bVoxelMap.set(`${gx}|${bLayer}|${gz}`, bBrushColor);
            bRebuildVoxels();
          }
        }
      }
    });

    // Wire controls
    const bLayerInput = document.getElementById('bskin-layer');
    const bLayerVal = document.getElementById('bskin-layer-val');
    bLayerInput.addEventListener('input', () => {
      bLayer = parseInt(bLayerInput.value) || 0;
      bLayerVal.textContent = bLayer;
      bRebuildGrid();
    });
    document.getElementById('bskin-color').addEventListener('input', (e) => {
      bBrushColor = parseInt(e.target.value.replace('#', ''), 16) || 0x7f8ea0;
    });
    document.getElementById('bskin-mode').addEventListener('change', (e) => {
      bEraseMode = e.target.value === 'erase';
    });
    ['bskin-gx', 'bskin-gy', 'bskin-gz'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        bGridSize.x = Math.max(1, Math.min(16, parseInt(document.getElementById('bskin-gx').value) || 4));
        bGridSize.y = Math.max(1, Math.min(16, parseInt(document.getElementById('bskin-gy').value) || 4));
        bGridSize.z = Math.max(1, Math.min(16, parseInt(document.getElementById('bskin-gz').value) || 4));
        const maxLayer = Math.max(0, bGridSize.y - 1);
        bLayerInput.max = maxLayer;
        if (bLayer > maxLayer) { bLayer = maxLayer; bLayerInput.value = bLayer; bLayerVal.textContent = bLayer; }
        bRebuildGrid();
        bRebuildVoxels();
      });
    });

    // Save / Cancel
    document.getElementById('bskin-save').addEventListener('click', () => {
      def.boneSkins[bid] = {
        gridSize: { ...bGridSize },
        voxels: Array.from(bVoxelMap.entries()).map(([key, color]) => {
          const [x, y, z] = key.split('|').map(Number);
          return { x, y, z, color };
        }),
      };
      bAnimId = null;
      bRenderer.dispose();
      subOverlay.remove();
      rebuildBoneVisuals();
      refreshBoneTree();
      markRestoreDirty();
    });
    document.getElementById('bskin-cancel').addEventListener('click', () => {
      bAnimId = null;
      bRenderer.dispose();
      subOverlay.remove();
    });

    // Resize + render loop
    let bAnimId = true;
    function bResize() {
      const rect = bCanvas.parentElement.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height - 40;
      if (w < 1 || h < 1) return;
      bRenderer.setSize(w, h, false);
      bCamera.aspect = w / h;
      bCamera.updateProjectionMatrix();
    }
    function bAnimate() {
      if (!bAnimId) return;
      bAnimId = requestAnimationFrame(bAnimate);
      bControls.update();
      bResize();
      bRenderer.render(bScene, bCamera);
    }
    bRebuildGrid();
    bRebuildVoxels();
    bResize();
    bAnimId = requestAnimationFrame(bAnimate);
  });

  // ─── Animation timeline system ────────────────────────────────────────────
  const tlClipSelect = document.getElementById('skel-tl-clip');
  const tlTimeInput = document.getElementById('skel-tl-time');
  const tlDurInput = document.getElementById('skel-tl-duration');
  const tlLoopInput = document.getElementById('skel-tl-loop');
  const tlCanvas = document.getElementById('skel-tl-canvas');
  const tlCtx = tlCanvas.getContext('2d');

  function refreshClipSelect() {
    const names = Object.keys(def.animations);
    tlClipSelect.innerHTML = names.length
      ? names.map(n => `<option value="${n}" ${n === skeletonEditorState.currentClipName ? 'selected' : ''}>${n}</option>`).join('')
      : '<option value="">No clips</option>';
    if (names.length && !skeletonEditorState.currentClipName) {
      skeletonEditorState.currentClipName = names[0];
    }
    syncClipToUI();
  }

  function getCurrentClip() {
    return def.animations[skeletonEditorState.currentClipName] || null;
  }

  function syncClipToUI() {
    const clip = getCurrentClip();
    if (clip) {
      tlDurInput.value = clip.duration;
      tlLoopInput.checked = clip.loop;
    }
  }

  // New clip
  document.getElementById('skel-tl-new-clip').addEventListener('click', () => {
    const name = prompt('New animation clip name:', 'Anim_' + (Object.keys(def.animations).length + 1));
    if (!name?.trim()) return;
    def.animations[name.trim()] = { duration: 1, loop: true, keyframes: [] };
    skeletonEditorState.currentClipName = name.trim();
    refreshClipSelect();
    drawTimeline();
    markRestoreDirty();
  });

  // Delete clip
  document.getElementById('skel-tl-del-clip').addEventListener('click', () => {
    const clip = skeletonEditorState.currentClipName;
    if (!clip) return;
    delete def.animations[clip];
    skeletonEditorState.currentClipName = Object.keys(def.animations)[0] || '';
    refreshClipSelect();
    drawTimeline();
    markRestoreDirty();
  });

  // Switch clip
  tlClipSelect.addEventListener('change', () => {
    skeletonEditorState.currentClipName = tlClipSelect.value;
    syncClipToUI();
    drawTimeline();
  });

  // Duration / loop change
  tlDurInput.addEventListener('change', () => {
    const clip = getCurrentClip();
    if (clip) clip.duration = Math.max(0.1, parseFloat(tlDurInput.value) || 1);
    drawTimeline();
    markRestoreDirty();
  });
  tlLoopInput.addEventListener('change', () => {
    const clip = getCurrentClip();
    if (clip) clip.loop = tlLoopInput.checked;
    markRestoreDirty();
  });

  // Speed control
  let _skelPlaybackSpeed = 1;
  const tlSpeedInput = document.getElementById('skel-tl-speed');
  const tlSpeedVal = document.getElementById('skel-tl-speed-val');
  tlSpeedInput.addEventListener('input', () => {
    _skelPlaybackSpeed = parseFloat(tlSpeedInput.value) || 1;
    tlSpeedVal.textContent = _skelPlaybackSpeed.toFixed(1) + '×';
  });

  // Copy/paste keyframe pose
  let _skelClipboard = null;
  document.getElementById('skel-tl-copy-kf').addEventListener('click', () => {
    if (!skeletonResult?.boneMap) return;
    _skelClipboard = capturePoseFromSkeleton(skeletonResult.boneMap, skeletonResult.restLocalQuats);
  });
  document.getElementById('skel-tl-paste-kf').addEventListener('click', () => {
    if (!_skelClipboard) { alert('Nothing copied. Click 📋 Copy first.'); return; }
    const clip = getCurrentClip();
    if (!clip) { alert('Create a clip first.'); return; }
    const time = skeletonEditorState.playheadTime;
    clip.keyframes = clip.keyframes.filter(kf => Math.abs(kf.time - time) > 0.001);
    clip.keyframes.push({ time, bones: JSON.parse(JSON.stringify(_skelClipboard)) });
    clip.keyframes.sort((a, b) => a.time - b.time);
    drawTimeline();
    markRestoreDirty();
  });

  // Time input
  tlTimeInput.addEventListener('change', () => {
    skeletonEditorState.playheadTime = Math.max(0, parseFloat(tlTimeInput.value) || 0);
    previewAtPlayhead();
    drawTimeline();
  });

  // Add keyframe at playhead
  document.getElementById('skel-tl-add-kf').addEventListener('click', () => {
    const clip = getCurrentClip();
    if (!clip || !skeletonResult?.boneMap) return;
    const time = skeletonEditorState.playheadTime;
    // Remove existing keyframe at same time (within tolerance)
    clip.keyframes = clip.keyframes.filter(kf => Math.abs(kf.time - time) > 0.001);
    clip.keyframes.push({ time, bones: capturePoseFromSkeleton(skeletonResult.boneMap, skeletonResult.restLocalQuats) });
    clip.keyframes.sort((a, b) => a.time - b.time);
    drawTimeline();
    markRestoreDirty();
  });

  // Delete keyframe nearest to playhead
  document.getElementById('skel-tl-del-kf').addEventListener('click', () => {
    const clip = getCurrentClip();
    if (!clip || !clip.keyframes.length) return;
    const time = skeletonEditorState.playheadTime;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < clip.keyframes.length; i++) {
      const dist = Math.abs(clip.keyframes[i].time - time);
      if (dist < nearestDist) { nearest = i; nearestDist = dist; }
    }
    clip.keyframes.splice(nearest, 1);
    drawTimeline();
    markRestoreDirty();
  });

  // Click/drag on timeline track to scrub playhead
  const tlTrack = document.getElementById('skel-tl-track');
  function _tlScrub(e) {
    const rect = tlTrack.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const clip = getCurrentClip();
    const dur = clip?.duration || 1;
    const time = Math.max(0, Math.min(dur, (x / rect.width) * dur));
    skeletonEditorState.playheadTime = Math.round(time * 100) / 100;
    tlTimeInput.value = skeletonEditorState.playheadTime;
    previewAtPlayhead();
    drawTimeline();
  }
  tlTrack.addEventListener('pointerdown', (e) => {
    _tlScrub(e);
    const onMove = (ev) => _tlScrub(ev);
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // Draw timeline
  function drawTimeline() {
    const rect = tlCanvas.parentElement.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 1 || h < 1) return;
    tlCanvas.width = w * Math.min(window.devicePixelRatio, 2);
    tlCanvas.height = h * Math.min(window.devicePixelRatio, 2);
    tlCanvas.style.width = w + 'px';
    tlCanvas.style.height = h + 'px';
    const ctx = tlCtx;
    const dpr = tlCanvas.width / w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const clip = getCurrentClip();
    const dur = clip?.duration || 1;
    const kfs = clip?.keyframes || [];

    // Background
    ctx.fillStyle = '#0c0e12';
    ctx.fillRect(0, 0, w, h);

    // Time ruler ticks
    ctx.fillStyle = '#334';
    ctx.font = '9px sans-serif';
    const step = dur <= 2 ? 0.1 : dur <= 5 ? 0.25 : dur <= 10 ? 0.5 : 1;
    for (let t = 0; t <= dur + 0.001; t += step) {
      const x = (t / dur) * w;
      ctx.fillStyle = '#334';
      ctx.fillRect(x, 0, 1, h);
      if (t % (step * 2) < 0.001 || step >= 0.25) {
        ctx.fillStyle = '#667';
        ctx.fillText(t.toFixed(step < 0.25 ? 2 : 1) + 's', x + 2, 10);
      }
    }

    // Keyframe diamonds
    for (const kf of kfs) {
      const x = (kf.time / dur) * w;
      ctx.save();
      ctx.translate(x, h / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffaa22';
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }

    // Playhead
    const px = (skeletonEditorState.playheadTime / dur) * w;
    ctx.fillStyle = '#ff4444';
    ctx.fillRect(px - 1, 0, 2, h);
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 6);
    ctx.closePath();
    ctx.fillStyle = '#ff4444';
    ctx.fill();
  }

  // Preview animation at current playhead time
  function previewAtPlayhead() {
    if (!skeletonResult?.boneMap) return;
    const clip = getCurrentClip();
    if (!clip) return;
    const boneIds = def.bones.map(b => b.id);
    const pose = evaluateAnimationAtTime(clip, skeletonEditorState.playheadTime, boneIds);
    if (pose) {
      applyPoseToSkeleton(skeletonResult.boneMap, pose, skeletonResult.restLocalQuats);
      skeletonResult.rootGroup.updateMatrixWorld(true);
      updateBoneMarkerPositions();
    }
  }

  // Play / Stop animation preview
  document.getElementById('skel-tl-play').addEventListener('click', () => {
    if (skeletonEditorState.isPlaying) return;
    skeletonEditorState.isPlaying = true;
    skeletonEditorState.playStartWall = performance.now() / 1000;
    skeletonEditorState.playStartTime = skeletonEditorState.playheadTime;
  });

  document.getElementById('skel-tl-stop').addEventListener('click', () => {
    skeletonEditorState.isPlaying = false;
  });

  // ─── Import FBX (placed after timeline variables are initialized) ───────────
  document.getElementById('skel-btn-import-fbx').addEventListener('click', () => {
    if (!def.bones.length) {
      alert('Add bones first (e.g. load 🦴 Humanoid template) before importing FBX animations.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fbx';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const imported = await importFBXAnimationToDefinition(buf, def);
        let msg = `Imported ${imported.length} clip(s) from "${file.name}":\n`;
        for (const ic of imported) {
          def.animations[ic.name] = ic.clip;
          msg += `  • ${ic.name} — ${ic.totalKeyframes} keyframes, ${ic.mappedBones} bones mapped\n`;
        }
        skeletonEditorState.currentClipName = imported[0].name;
        refreshClipSelect();
        drawTimeline();
        markRestoreDirty();
        alert(msg);
      } catch (err) {
        alert('FBX import failed: ' + err.message);
        console.warn('FBX import error:', err);
      }
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  });

  // ─── Import FBX Skin (mesh → voxel skins) ──────────────────────────────────
  document.getElementById('skel-btn-import-fbx-skin').addEventListener('click', () => {
    if (!def.bones.length) {
      alert('Add bones first (e.g. load 🦴 Humanoid template) before importing FBX skins.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fbx';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const result = await importFBXSkinToDefinition(buf, def);
        rebuildBoneVisuals();
        refreshBoneTree();
        markRestoreDirty();
        alert(
          `FBX Skin imported from "${file.name}":\n` +
          `  • ${result.bonesWithSkin} bones received mesh skins\n` +
          `  • ${result.totalTris} total triangles\n` +
          `  • ${result.assignedVerts}/${result.totalVerts} vertices assigned`
        );
      } catch (err) {
        alert('FBX skin import failed: ' + err.message);
        console.warn('FBX skin import error:', err);
      }
    });
    document.body.appendChild(input);
    input.click();
    input.remove();
  });

  // ─── Keyboard shortcuts inside skeleton editor ─────────────────────────────
  function _skelKeyHandler(e) {
    if (!skeletonEditorOverlayEl) return;
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key;
    if (key === 'Delete' || key === 'Backspace') {
      document.getElementById('skel-btn-del-bone')?.click();
      e.preventDefault();
    } else if (key === 'd' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      duplicateSelectedBone();
    } else if (key === ' ') {
      e.preventDefault();
      if (skeletonEditorState.isPlaying) {
        skeletonEditorState.isPlaying = false;
      } else {
        document.getElementById('skel-tl-play')?.click();
      }
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      const clip = getCurrentClip();
      const step = clip ? clip.duration / 20 : 0.05;
      skeletonEditorState.playheadTime = Math.max(0, skeletonEditorState.playheadTime - step);
      tlTimeInput.value = skeletonEditorState.playheadTime.toFixed(2);
      previewAtPlayhead();
      drawTimeline();
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      const clip = getCurrentClip();
      const dur = clip?.duration || 1;
      const step = dur / 20;
      skeletonEditorState.playheadTime = Math.min(dur, skeletonEditorState.playheadTime + step);
      tlTimeInput.value = skeletonEditorState.playheadTime.toFixed(2);
      previewAtPlayhead();
      drawTimeline();
    } else if (key === 'g' || key === 'G') {
      skelTransformCtrl.setMode('translate');
    } else if (key === 'r' || key === 'R') {
      skelTransformCtrl.setMode('rotate');
    } else if (key === 'Escape') {
      skelTransformCtrl.detach();
      _skelTransformTarget = null;
    }
  }
  window.addEventListener('keydown', _skelKeyHandler);
  overlay._skelKeyHandler = _skelKeyHandler;

  // ─── Close button ──────────────────────────────────────────────────────────
  document.getElementById('skel-btn-close').addEventListener('click', () => {
    closeSkeletonEditor();
  });

  // ─── Main render loop ─────────────────────────────────────────────────────
  function skelAnimate() {
    if (!skeletonEditorOverlayEl) return;
    skeletonEditorState._animFrameId = requestAnimationFrame(skelAnimate);

    skelControls.update();

    // Animation playback
    if (skeletonEditorState.isPlaying) {
      const clip = getCurrentClip();
      if (clip && skeletonResult?.boneMap) {
        const now = performance.now() / 1000;
        const elapsed = (now - skeletonEditorState.playStartWall) * _skelPlaybackSpeed;
        let t = skeletonEditorState.playStartTime + elapsed;
        if (clip.loop) {
          t = ((t % clip.duration) + clip.duration) % clip.duration;
        } else {
          t = Math.min(t, clip.duration);
          if (t >= clip.duration) skeletonEditorState.isPlaying = false;
        }
        skeletonEditorState.playheadTime = Math.round(t * 100) / 100;
        tlTimeInput.value = skeletonEditorState.playheadTime;

        const boneIds = def.bones.map(b => b.id);
        const pose = evaluateAnimationAtTime(clip, t, boneIds);
        if (pose) {
          applyPoseToSkeleton(skeletonResult.boneMap, pose, skeletonResult.restLocalQuats);
          skeletonResult.rootGroup.updateMatrixWorld(true);
          updateBoneMarkerPositions();
        }
        drawTimeline();
      } else {
        skeletonEditorState.isPlaying = false;
      }
    }

    skelRenderer.render(skelScene, skelCamera);
  }

  // ─── Initialize ────────────────────────────────────────────────────────────
  skel3DResize();
  rebuildBoneVisuals();
  refreshBoneTree();
  refreshBoneProps();
  refreshPoseList();
  refreshClipSelect();
  drawTimeline();
  skeletonEditorState._animFrameId = requestAnimationFrame(skelAnimate);
}

function closeSkeletonEditor() {
  if (!skeletonEditorOverlayEl) return;
  if (skeletonEditorState?._animFrameId) cancelAnimationFrame(skeletonEditorState._animFrameId);
  if (skeleton3DState?.renderer) skeleton3DState.renderer.dispose();
  if (skeletonEditorOverlayEl._skelResizeObserver) skeletonEditorOverlayEl._skelResizeObserver.disconnect();
  if (skeletonEditorOverlayEl._skelKeyHandler) window.removeEventListener('keydown', skeletonEditorOverlayEl._skelKeyHandler);
  skeletonEditorOverlayEl.remove();
  skeletonEditorOverlayEl = null;
  skeletonEditorState = null;
  skeleton3DState = null;
  // Persist any unsaved changes and refresh scene visuals
  markRestoreDirty();
  refreshAllSkeletonVisuals();
}

function refreshAllSkeletonVisuals() {
  for (const m of sceneObjects) {
    if (m.userData.type === 'skeleton') refreshSkeletonMeshVisual(m);
  }
}

function refreshSkeletonMeshVisual(mesh) {
  // Remove old skeleton visual
  if (mesh.userData._skelVisualGroup) {
    mesh.remove(mesh.userData._skelVisualGroup);
    mesh.userData._skelVisualGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    mesh.userData._skelVisualGroup = null;
  }

  const cfg = getMeshSkeletonConfig(mesh);
  if (!cfg?.definitionName) return;
  const def = skeletonDefinitions[cfg.definitionName];
  if (!def?.bones?.length) return;

  const result = buildThreeBonesFromDef(def);
  if (!result) return;

  const group = new THREE.Group();
  result.rootGroup.updateMatrixWorld(true);

  // Draw bones as lines + spheres
  const sphereGeo = new THREE.SphereGeometry(0.03, 6, 4);
  for (const bd of def.bones) {
    const threeBone = result.boneMap.get(bd.id);
    if (!threeBone) continue;
    const worldPos = new THREE.Vector3();
    threeBone.getWorldPosition(worldPos);

    const hasSkin = !!(def.boneSkins[bd.id]?.voxels?.length || def.boneSkins[bd.id]?.type === 'mesh');
    const color = hasSkin ? 0x6688ff : (bd.parent ? 0xcccccc : 0x44ff88);
    const marker = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color }));
    marker.position.copy(worldPos);
    marker.userData._boneId = bd.id;
    marker.userData._childType = 'marker';
    group.add(marker);

    if (bd.parent) {
      const parentBone = result.boneMap.get(bd.parent);
      if (parentBone) {
        const pPos = new THREE.Vector3();
        parentBone.getWorldPosition(pPos);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([pPos, worldPos]);
        const boneLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x667788 }));
        boneLine.userData._boneId = bd.id;
        boneLine.userData._childType = 'line';
        group.add(boneLine);
      }
    }

    // Bone skins
    if (hasSkin) {
      const skinDef = def.boneSkins[bd.id];
      const boneQuat = new THREE.Quaternion();
      threeBone.getWorldQuaternion(boneQuat);
      const skinG = new THREE.Group();

      if (skinDef.type === 'mesh' && skinDef.vertices?.length && skinDef.indices?.length) {
        // Mesh skin
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(skinDef.vertices, 3));
        geo.setIndex(skinDef.indices);
        if (skinDef.colors?.length) {
          const fc = new Float32Array(skinDef.colors.length);
          for (let ci = 0; ci < skinDef.colors.length; ci++) fc[ci] = skinDef.colors[ci] / 255;
          geo.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
        }
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: !!(skinDef.colors?.length),
          roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide,
          color: skinDef.colors?.length ? 0xffffff : 0x7f8ea0,
        });
        skinG.add(new THREE.Mesh(geo, mat));
      } else {
        // Voxel skin (legacy)
        const gridSize = normalizeSkinGridSize(skinDef.gridSize || { x: 4, y: 4, z: 4 });
        const cellSize = boneLength(bd) / Math.max(gridSize.x, gridSize.y, gridSize.z);
        const voxels = skinDef.voxels;
        const byColor = new Map();
        for (const v of voxels) {
          const col = v.color ?? 0x7f8ea0;
          if (!byColor.has(col)) byColor.set(col, []);
          byColor.get(col).push(v);
        }
        const sharedGeo = new THREE.BoxGeometry(cellSize * 0.95, cellSize * 0.95, cellSize * 0.95);
        for (const [col, cvoxels] of byColor) {
          const mat = new THREE.MeshStandardMaterial({ color: col });
          const inst = new THREE.InstancedMesh(sharedGeo, mat, cvoxels.length);
          const mtx = new THREE.Matrix4();
          for (let i = 0; i < cvoxels.length; i++) {
            const v = cvoxels[i];
            mtx.makeTranslation(
              (v.x - gridSize.x / 2 + 0.5) * cellSize,
              (v.y - gridSize.y / 2 + 0.5) * cellSize + boneLength(bd) / 2,
              (v.z - gridSize.z / 2 + 0.5) * cellSize
            );
            inst.setMatrixAt(i, mtx);
          }
          inst.instanceMatrix.needsUpdate = true;
          skinG.add(inst);
        }
      }
      skinG.position.copy(worldPos);
      // Mesh skins: apply FBX bind-pose world quat correction (vertices are in FBX bone-local space)
      // Voxel skins: apply alignment correction to orient grid along bone direction
      const isMeshSkin = skinDef.type === 'mesh';
      const bindWorldQuat = isMeshSkin && def.boneBindWorldQuats?.[bd.id];
      if (bindWorldQuat) {
        const bwq = new THREE.Quaternion(bindWorldQuat[0], bindWorldQuat[1], bindWorldQuat[2], bindWorldQuat[3]);
        skinG.quaternion.copy(boneQuat).multiply(bwq);
        skinG.userData._boneBindWorldQuat = bwq;
      } else {
        skinG.quaternion.copy(boneQuat);
      }
      skinG.userData._boneId = bd.id;
      skinG.userData._childType = 'skin';
      group.add(skinG);
    }
  }

  mesh.userData._skelVisualGroup = group;
  mesh.userData._skelBoneMap = result.boneMap;
  mesh.userData._skelRootGroup = result.rootGroup;
  mesh.userData._skelRestLocalQuats = result.restLocalQuats;
  mesh.userData._skelDef = def;
  mesh.add(group);
}

function closeWorldContextMenu() {
  if (!worldContextMenuEl) return;
  worldContextMenuEl.remove();
  worldContextMenuEl = null;
}

function closeTransientMenus() {
  closeLibraryContextMenu();
  closeKeypadContextMenu();
  closeWorldContextMenu();
  closeRuntimeKeypadOverlay();
}
function skinEditorCellKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

function captureSkinEditorSnapshot() {
  return {
    gridSize: { ...skinEditorState.gridSize },
    layer: skinEditorState.layer,
    brushColor: skinEditorState.brushColor,
    voxels: Array.from(skinEditorState.voxelMap.entries()),
  };
}

function applySkinEditorSnapshot(snapshot) {
  if (!snapshot) return;
  skinEditorState.gridSize = normalizeSkinGridSize(snapshot.gridSize || CUSTOM_SKIN_GRID_DEFAULT);
  skinEditorState.layer = THREE.MathUtils.clamp(parseInt(snapshot.layer, 10) || 0, 0, Math.max(0, skinEditorState.gridSize.y - 1));
  const bc = Number(snapshot.brushColor);
  skinEditorState.brushColor = Number.isFinite(bc) ? Math.round(THREE.MathUtils.clamp(bc, 0, 0xffffff)) : 0x7f8ea0;
  skinEditorState.voxelMap = new Map(Array.isArray(snapshot.voxels) ? snapshot.voxels : []);
  skin3DState?.syncFromState?.();
}

function skinEditorSnapshotsEqual(a, b) {
  if (!a || !b) return false;
  if (a.gridSize.x !== b.gridSize.x || a.gridSize.y !== b.gridSize.y || a.gridSize.z !== b.gridSize.z) return false;
  if (a.layer !== b.layer || a.brushColor !== b.brushColor) return false;
  if (a.voxels.length !== b.voxels.length) return false;
  for (let i = 0; i < a.voxels.length; i++) {
    const av = a.voxels[i];
    const bv = b.voxels[i];
    if (av[0] !== bv[0] || av[1] !== bv[1]) return false;
  }
  return true;
}

function syncSkinEditorHistoryUi() {
  if (!skinEditorOverlayEl) return;
  const undoBtn = skinEditorOverlayEl.querySelector('#skin-undo');
  const redoBtn = skinEditorOverlayEl.querySelector('#skin-redo');
  if (undoBtn) undoBtn.disabled = skinEditorState.undoStack.length === 0;
  if (redoBtn) redoBtn.disabled = skinEditorState.redoStack.length === 0;
}

function commitSkinEditorChange(beforeSnapshot) {
  const before = beforeSnapshot || captureSkinEditorSnapshot();
  const after = captureSkinEditorSnapshot();
  if (skinEditorSnapshotsEqual(before, after)) {
    syncSkinEditorHistoryUi();
    return;
  }
  skinEditorState.undoStack.push(before);
  if (skinEditorState.undoStack.length > MAX_UNDO) skinEditorState.undoStack.splice(0, skinEditorState.undoStack.length - MAX_UNDO);
  skinEditorState.redoStack.length = 0;
  syncSkinEditorHistoryUi();
}

function undoSkinEditorChange() {
  if (!skinEditorState.undoStack.length) return;
  const before = skinEditorState.undoStack.pop();
  const current = captureSkinEditorSnapshot();
  skinEditorState.redoStack.push(current);
  applySkinEditorSnapshot(before);
  syncSkinEditorHistoryUi();
}

function redoSkinEditorChange() {
  if (!skinEditorState.redoStack.length) return;
  const after = skinEditorState.redoStack.pop();
  const current = captureSkinEditorSnapshot();
  skinEditorState.undoStack.push(current);
  applySkinEditorSnapshot(after);
  syncSkinEditorHistoryUi();
}

function resizeSkinEditorGrid(nextGridSize) {
  const before = captureSkinEditorSnapshot();
  const next = normalizeSkinGridSize(nextGridSize);
  skinEditorState.gridSize = next;
  const trimmed = new Map();
  for (const [key, color] of skinEditorState.voxelMap.entries()) {
    const [x, y, z] = key.split('|').map(v => parseInt(v, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < 0 || x >= next.x || y < 0 || y >= next.y || z < 0 || z >= next.z) continue;
    trimmed.set(skinEditorCellKey(x, y, z), color);
  }
  skinEditorState.voxelMap = trimmed;
  skinEditorState.layer = THREE.MathUtils.clamp(skinEditorState.layer, 0, Math.max(0, next.y - 1));
  skin3DState?.syncFromState?.();
  commitSkinEditorChange(before);
}

function transformSkinEditorVoxels(transformFn) {
  if (typeof transformFn !== 'function' || !skinEditorState.voxelMap.size) return;
  const before = captureSkinEditorSnapshot();
  const transformed = [];
  for (const [key, color] of skinEditorState.voxelMap.entries()) {
    const [x, y, z] = key.split('|').map(v => parseInt(v, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const nextPos = transformFn(x, y, z);
    if (!nextPos) continue;
    transformed.push({
      x: Math.round(nextPos.x),
      y: Math.round(nextPos.y),
      z: Math.round(nextPos.z),
      color,
    });
  }
  if (!transformed.length) return;

  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const v of transformed) {
    minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z);
  }

  const oldGrid = normalizeSkinGridSize(skinEditorState.gridSize);
  const shiftX = minX < 0 ? -minX : 0;
  const shiftY = minY < 0 ? -minY : 0;
  const shiftZ = minZ < 0 ? -minZ : 0;
  const newGrid = {
    x: Math.max(oldGrid.x, maxX + shiftX + 1),
    y: Math.max(oldGrid.y, maxY + shiftY + 1),
    z: Math.max(oldGrid.z, maxZ + shiftZ + 1),
  };

  const nextMap = new Map();
  for (const v of transformed) {
    const nx = v.x + shiftX;
    const ny = v.y + shiftY;
    const nz = v.z + shiftZ;
    if (nx < 0 || ny < 0 || nz < 0) continue;
    nextMap.set(skinEditorCellKey(nx, ny, nz), v.color);
  }

  skinEditorState.gridSize = normalizeSkinGridSize(newGrid);
  skinEditorState.voxelMap = nextMap;
  skinEditorState.layer = THREE.MathUtils.clamp(skinEditorState.layer + shiftY, 0, Math.max(0, skinEditorState.gridSize.y - 1));
  skin3DState?.syncFromState?.();
  commitSkinEditorChange(before);
}

function moveSkinEditorVoxels(dx = 0, dy = 0, dz = 0) {
  transformSkinEditorVoxels((x, y, z) => ({ x: x + dx, y: y + dy, z: z + dz }));
}

function rotateSkinEditorVoxelsY(dir = 1) {
  const sign = dir >= 0 ? 1 : -1;
  const cx = (skinEditorState.gridSize.x - 1) * 0.5;
  const cz = (skinEditorState.gridSize.z - 1) * 0.5;
  transformSkinEditorVoxels((x, y, z) => {
    const rx = x - cx;
    const rz = z - cz;
    return {
      x: cx + (sign > 0 ? rz : -rz),
      y,
      z: cz + (sign > 0 ? -rx : rx),
    };
  });
}

function scaleSkinEditorVoxels(factor = 1) {
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) return;
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (const key of skinEditorState.voxelMap.keys()) {
    const [x, y, z] = key.split('|').map(v => parseInt(v, 10));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  if (!Number.isFinite(minX)) return;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  transformSkinEditorVoxels((x, y, z) => ({
    x: cx + (x - cx) * f,
    y: cy + (y - cy) * f,
    z: cz + (z - cz) * f,
  }));
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
  const normalized = normalizeCustomBlockSkin({ gridSize: skinEditorState.gridSize, voxels });
  if (normalized.voxels.length) customBlockSkins[skinEditorState.type] = normalized;
  else delete customBlockSkins[skinEditorState.type];
  refreshCustomSkinsOnScene();
  removeGhost();
}

function openSkinEditorForType(type) {
  if (!DEFS[type]) return;
  closeTransientMenus();
  closeSkinEditorOverlay();
  closeSculptEditorOverlay();

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
        <button id="skin-mode-erase" type="button" style="flex:1;font-size:11px;padding:5px 8px">Erase</button>
        <button id="skin-mode-view" type="button" style="flex:1;font-size:11px;padding:5px 8px">View</button>
      </div>
      <div style="font-size:10px;color:#444d56;line-height:1.5">Paint: left-click place, right-click erase.<br>Erase: left-click erase.<br>View: drag to orbit, scroll to zoom.</div>
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
          <input id="skin-grid-x" type="number" min="1" step="1" value="${skinEditorState.gridSize.x}" style="width:56px"/>
          <span style="font-size:10px;color:#8b949e">Y</span>
          <input id="skin-grid-y" type="number" min="1" step="1" value="${skinEditorState.gridSize.y}" style="width:56px"/>
          <span style="font-size:10px;color:#8b949e">Z</span>
          <input id="skin-grid-z" type="number" min="1" step="1" value="${skinEditorState.gridSize.z}" style="width:56px"/>
        </div>
        <div style="font-size:10px;color:#444d56">Any positive size is allowed. Expand or crop the voxel work area per block type.</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em">TRANSFORM VOXELS</label>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
          <button id="skin-move-x-neg" type="button" style="font-size:11px;padding:5px 6px">-X</button>
          <button id="skin-move-y-pos" type="button" style="font-size:11px;padding:5px 6px">+Y</button>
          <button id="skin-move-x-pos" type="button" style="font-size:11px;padding:5px 6px">+X</button>
          <button id="skin-move-z-neg" type="button" style="font-size:11px;padding:5px 6px">-Z</button>
          <button id="skin-move-y-neg" type="button" style="font-size:11px;padding:5px 6px">-Y</button>
          <button id="skin-move-z-pos" type="button" style="font-size:11px;padding:5px 6px">+Z</button>
        </div>
        <div style="display:flex;gap:6px">
          <button id="skin-rot-y-ccw" type="button" style="flex:1;font-size:11px;padding:5px 8px">Rotate Y -90</button>
          <button id="skin-rot-y-cw" type="button" style="flex:1;font-size:11px;padding:5px 8px">Rotate Y +90</button>
        </div>
        <div style="display:flex;gap:6px">
          <button id="skin-scale-down" type="button" style="flex:1;font-size:11px;padding:5px 8px">Scale 0.5x</button>
          <button id="skin-scale-up" type="button" style="flex:1;font-size:11px;padding:5px 8px">Scale 2x</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <span style="font-size:10px;color:#8b949e;flex:1;letter-spacing:.06em">VOXELS</span>
        <span id="skin-voxel-count" style="font-size:12px;font-weight:600;color:#e6edf3">0</span>
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
    const erasing = e.button === 2 || skinEditorState.eraseMode;
    const target = getHitTarget3D(e, erasing);
    applyPaint3D(target);
    updateGhost3D(target);
  }, true);

  canvas3d.addEventListener('pointermove', e => {
    if (!skin3DState.isPainting) {
      if (!oc3d.enabled) updateGhost3D(getHitTarget3D(e, skinEditorState.eraseMode));
      return;
    }
    const erasing = e.buttons === 2 || skinEditorState.eraseMode;
    const target = getHitTarget3D(e, erasing);
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
  const btnErase = overlay.querySelector('#skin-mode-erase');
  const btnView = overlay.querySelector('#skin-mode-view');
  function setSkinMode(mode) {
    skinEditorState.eraseMode = mode === 'erase';
    oc3d.enabled = mode === 'view';
    canvas3d.style.cursor = mode === 'view' ? 'grab' : 'crosshair';
    btnPaint.style.background = mode === 'paint' ? '#1e3a24' : '';
    btnPaint.style.borderColor = mode === 'paint' ? '#2f7a3f' : '';
    btnPaint.style.color = mode === 'paint' ? '#8be9a8' : '';
    btnErase.style.background = mode === 'erase' ? '#3a1e1e' : '';
    btnErase.style.borderColor = mode === 'erase' ? '#7a2f2f' : '';
    btnErase.style.color = mode === 'erase' ? '#ff8080' : '';
    btnView.style.background = mode === 'view' ? '#1e2a3a' : '';
    btnView.style.borderColor = mode === 'view' ? '#2f5a7a' : '';
    btnView.style.color = mode === 'view' ? '#79c0ff' : '';
  }
  btnPaint.addEventListener('click', () => setSkinMode('paint'));
  btnErase.addEventListener('click', () => setSkinMode('erase'));
  btnView.addEventListener('click', () => setSkinMode('view'));
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

  overlay.querySelector('#skin-move-x-neg')?.addEventListener('click', () => moveSkinEditorVoxels(-1, 0, 0));
  overlay.querySelector('#skin-move-x-pos')?.addEventListener('click', () => moveSkinEditorVoxels(1, 0, 0));
  overlay.querySelector('#skin-move-y-neg')?.addEventListener('click', () => moveSkinEditorVoxels(0, -1, 0));
  overlay.querySelector('#skin-move-y-pos')?.addEventListener('click', () => moveSkinEditorVoxels(0, 1, 0));
  overlay.querySelector('#skin-move-z-neg')?.addEventListener('click', () => moveSkinEditorVoxels(0, 0, -1));
  overlay.querySelector('#skin-move-z-pos')?.addEventListener('click', () => moveSkinEditorVoxels(0, 0, 1));
  overlay.querySelector('#skin-rot-y-ccw')?.addEventListener('click', () => rotateSkinEditorVoxelsY(-1));
  overlay.querySelector('#skin-rot-y-cw')?.addEventListener('click', () => rotateSkinEditorVoxelsY(1));
  overlay.querySelector('#skin-scale-down')?.addEventListener('click', () => scaleSkinEditorVoxels(0.5));
  overlay.querySelector('#skin-scale-up')?.addEventListener('click', () => scaleSkinEditorVoxels(2));

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
  menu.style.minWidth = '220px';
  menu.style.padding = '8px';
  menu.style.borderRadius = '8px';
  menu.style.border = '1px solid var(--border)';
  menu.style.background = 'rgba(15,20,27,0.97)';
  menu.style.boxShadow = '0 10px 28px rgba(0,0,0,0.4)';
  menu.innerHTML = `
    <div style="font-size:10px;color:var(--muted);padding:2px 4px 8px 4px;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(typeLabel(type))}</div>
    <div style="font-size:9px;color:var(--muted);padding:0 4px 6px 4px;letter-spacing:.04em">MODELER</div>
    <button type="button" data-skin-voxel="1" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px">🧊 Voxel Painter</button>
    <button type="button" data-skin-sculpt="1" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px;margin-top:3px">🔵 Sculpt Modeler</button>
    <div style="height:1px;background:var(--border);margin:8px 0"></div>
    <button type="button" data-skin-reset="1" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px" ${hasCustomSkinForType(type) || hasCustomSculptForType(type) ? '' : 'disabled'}>Reset To Default</button>
  `;

  document.body.appendChild(menu);
  clampFloatingPanelPosition(menu, x + 4, y + 4);

  menu.querySelector('[data-skin-voxel]')?.addEventListener('click', () => {
    closeLibraryContextMenu();
    openSkinEditorForType(type);
  });

  menu.querySelector('[data-skin-sculpt]')?.addEventListener('click', () => {
    closeLibraryContextMenu();
    openSculptEditorForType(type);
  });

  menu.querySelector('[data-skin-reset]')?.addEventListener('click', () => {
    delete customBlockSkins[type];
    delete customSculptSkins[type];
    refreshCustomSkinsOnScene();
    removeGhost();
    closeLibraryContextMenu();
    saveEditorSettings();
  });

  menu.addEventListener('pointerdown', e => e.stopPropagation());
  libraryContextMenuEl = menu;
}

// ─── Sculpt Modeler ──────────────────────────────────────────────────────────
// Sculpt skins store a list of primitive operations (add/subtract) that compose
// into a smooth 3D model using merged geometry.

const SCULPT_PRIMITIVES = ['sphere', 'box', 'cylinder'];
const SCULPT_OPS = ['add', 'subtract'];

function createDefaultSculptPrimitive() {
  return {
    shape: 'sphere',
    op: 'add',
    position: [0, 0, 0],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    color: 0x7f8ea0,
  };
}

function normalizeSculptPrimitive(prim = {}) {
  const pos = Array.isArray(prim.position) ? prim.position.map(v => Number.isFinite(v) ? v : 0) : [0, 0, 0];
  const scl = Array.isArray(prim.scale) ? prim.scale.map(v => Number.isFinite(v) && v > 0 ? v : 1) : [1, 1, 1];
  const rot = Array.isArray(prim.rotation) ? prim.rotation.map(v => Number.isFinite(v) ? v : 0) : [0, 0, 0];
  return {
    shape: SCULPT_PRIMITIVES.includes(prim.shape) ? prim.shape : 'sphere',
    op: SCULPT_OPS.includes(prim.op) ? prim.op : 'add',
    position: pos.slice(0, 3),
    scale: scl.slice(0, 3),
    rotation: rot.slice(0, 3),
    color: Number.isFinite(prim.color) ? Math.round(THREE.MathUtils.clamp(prim.color, 0, 0xffffff)) : 0x7f8ea0,
  };
}

function normalizeSculptSkin(def = {}) {
  const prims = Array.isArray(def.primitives) ? def.primitives.map(normalizeSculptPrimitive) : [];
  return { version: 1, primitives: prims };
}

function hasCustomSculptForType(type) {
  const skin = customSculptSkins[type];
  return !!(skin && skin.primitives && skin.primitives.length);
}

function serializeCustomSculptSkins() {
  const out = {};
  for (const [type, skinRaw] of Object.entries(customSculptSkins)) {
    if (!DEFS[type]) continue;
    const skin = normalizeSculptSkin(skinRaw);
    if (skin.primitives.length) out[type] = skin;
  }
  return out;
}

function setCustomSculptSkinsMap(map = {}) {
  for (const key of Object.keys(customSculptSkins)) delete customSculptSkins[key];
  for (const [type, raw] of Object.entries(map || {})) {
    if (!DEFS[type]) continue;
    const skin = normalizeSculptSkin(raw);
    if (skin.primitives.length) customSculptSkins[type] = skin;
  }
}

function buildSculptPrimitiveGeometry(prim) {
  const p = normalizeSculptPrimitive(prim);
  let geo;
  switch (p.shape) {
    case 'box':
      geo = new THREE.BoxGeometry(1, 1, 1);
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
      break;
    case 'sphere':
    default:
      geo = new THREE.SphereGeometry(0.5, 16, 12);
      break;
  }
  return geo;
}

function buildSculptSkinVisual(mesh, skin) {
  if (!mesh?.geometry || !skin?.primitives?.length) return null;

  const group = new THREE.Group();
  group.name = 'customSkinVisual';
  group.userData.customSkinVisual = true;

  // Get mesh bounding box to scale primitives proportionally
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const meshSize = new THREE.Vector3();
  bb.getSize(meshSize);
  const meshCenter = new THREE.Vector3();
  bb.getCenter(meshCenter);

  for (const prim of skin.primitives) {
    if (prim.op === 'subtract') continue; // skip subtractive for basic visual

    const geo = buildSculptPrimitiveGeometry(prim);
    const mat = new THREE.MeshStandardMaterial({
      color: prim.color,
      roughness: 0.6,
      metalness: 0.1,
    });
    const primMesh = new THREE.Mesh(geo, mat);
    primMesh.castShadow = true;
    primMesh.receiveShadow = true;
    primMesh.position.set(
      prim.position[0] * meshSize.x * 0.5,
      prim.position[1] * meshSize.y * 0.5,
      prim.position[2] * meshSize.z * 0.5
    );
    primMesh.scale.set(
      prim.scale[0] * meshSize.x * 0.5,
      prim.scale[1] * meshSize.y * 0.5,
      prim.scale[2] * meshSize.z * 0.5
    );
    primMesh.rotation.set(
      prim.rotation[0] * Math.PI / 180,
      prim.rotation[1] * Math.PI / 180,
      prim.rotation[2] * Math.PI / 180
    );
    group.add(primMesh);
  }

  return group;
}

function applySculptSkinToMesh(mesh) {
  if (!mesh?.userData) return;
  // Remove previous sculpt skin
  const prev = mesh.userData.customSkinGroup;
  if (prev && prev.userData?.isSculptSkin) {
    mesh.remove(prev);
    disposeObjectTree(prev);
    delete mesh.userData.customSkinGroup;
    mesh.userData._customSkinActive = false;
  }

  const skinRaw = customSculptSkins[mesh.userData.type];
  if (!skinRaw?.primitives?.length) return;

  const skin = normalizeSculptSkin(skinRaw);
  if (!skin.primitives.length) return;

  const visual = buildSculptSkinVisual(mesh, skin);
  if (!visual) return;

  visual.userData.isSculptSkin = true;
  mesh.add(visual);
  mesh.userData.customSkinGroup = visual;
  mesh.userData._customSkinActive = true;

  // Hide original material
  if (mesh.material) {
    mesh.material.visible = false;
    mesh.material.transparent = true;
    mesh.material.opacity = 0;
  }
}

function refreshSculptSkinsOnScene() {
  for (const mesh of sceneObjects) {
    if (hasCustomSculptForType(mesh.userData.type)) {
      applySculptSkinToMesh(mesh);
    }
  }
}

// Sculpt editor state
const sculptEditorState = {
  type: 'wall',
  primitives: [],
  selectedIndex: -1,
  brushColor: 0x7f8ea0,
  brushShape: 'sphere',
  undoStack: [],
  redoStack: [],
};

function captureSculptSnapshot() {
  return {
    primitives: sculptEditorState.primitives.map(p => ({ ...p, position: [...p.position], scale: [...p.scale], rotation: [...p.rotation] })),
    selectedIndex: sculptEditorState.selectedIndex,
  };
}

function applySculptSnapshot(snap) {
  sculptEditorState.primitives = (snap.primitives || []).map(normalizeSculptPrimitive);
  sculptEditorState.selectedIndex = snap.selectedIndex ?? -1;
}

function commitSculptChange(before) {
  const after = captureSculptSnapshot();
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  sculptEditorState.undoStack.push(before);
  if (sculptEditorState.undoStack.length > MAX_UNDO) sculptEditorState.undoStack.splice(0, sculptEditorState.undoStack.length - MAX_UNDO);
  sculptEditorState.redoStack.length = 0;
}

function undoSculptChange() {
  if (!sculptEditorState.undoStack.length) return;
  const before = sculptEditorState.undoStack.pop();
  sculptEditorState.redoStack.push(captureSculptSnapshot());
  applySculptSnapshot(before);
}

function redoSculptChange() {
  if (!sculptEditorState.redoStack.length) return;
  const after = sculptEditorState.redoStack.pop();
  sculptEditorState.undoStack.push(captureSculptSnapshot());
  applySculptSnapshot(after);
}

function closeSculptEditorOverlay() {
  if (!sculptEditorOverlayEl) return;
  const st = sculptEditorOverlayEl._sculptState;
  if (st?.animId) cancelAnimationFrame(st.animId);
  if (st?.transformControls) { st.transformControls.detach(); st.transformControls.dispose(); }
  if (st?.renderer) st.renderer.dispose();
  if (st?.controls) st.controls.dispose();
  sculptEditorOverlayEl.remove();
  sculptEditorOverlayEl = null;
}

function openSculptEditorForType(type) {
  if (!DEFS[type]) return;
  closeTransientMenus();
  closeSculptEditorOverlay();
  closeSkinEditorOverlay();

  sculptEditorState.type = type;
  sculptEditorState.selectedIndex = -1;
  sculptEditorState.undoStack = [];
  sculptEditorState.redoStack = [];

  const existing = normalizeSculptSkin(customSculptSkins[type] || {});
  sculptEditorState.primitives = existing.primitives.map(normalizeSculptPrimitive);
  if (existing.primitives.length) {
    sculptEditorState.brushColor = existing.primitives[existing.primitives.length - 1].color;
  }

  const overlay = document.createElement('div');
  overlay.id = 'sculpt-editor-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20010;display:flex;background:#080c10';
  overlay.innerHTML = `
    <div id="sculpt-sidebar" style="width:280px;min-width:240px;display:flex;flex-direction:column;gap:10px;padding:16px;background:#0b1118;border-right:1px solid #1d2430;overflow-y:auto;box-sizing:border-box">
      <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8b949e">Sculpt Modeler</div>
      <div id="sculpt-title" style="font-size:20px;font-weight:700;color:#e6edf3">Sculpt ${escapeHtml(typeLabel(type))}</div>
      <div style="display:flex;gap:6px">
        <button id="sculpt-undo" type="button" style="flex:1;font-size:11px;padding:5px 8px" disabled>Undo</button>
        <button id="sculpt-redo" type="button" style="flex:1;font-size:11px;padding:5px 8px" disabled>Redo</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em">ADD PRIMITIVE</label>
        <div style="display:flex;gap:4px">
          <select id="sculpt-shape" style="flex:1;font-size:11px;padding:4px 6px">
            <option value="sphere">Sphere</option>
            <option value="box">Box</option>
            <option value="cylinder">Cylinder</option>
          </select>
          <button id="sculpt-add" type="button" style="font-size:11px;padding:5px 10px;background:#1e3a24;border-color:#2f7a3f;color:#8be9a8">+ Add</button>
        </div>
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em;margin-top:4px">COLOR</label>
        <input id="sculpt-color" type="color" value="#7f8ea0" style="width:100%;height:28px;cursor:pointer"/>
      </div>
      <div id="sculpt-prim-list" style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto"></div>
      <div id="sculpt-selected-controls" style="display:none;flex-direction:column;gap:6px;background:#111821;border:1px solid #1d2430;border-radius:8px;padding:10px">
        <label style="font-size:10px;color:#8b949e;letter-spacing:.06em">SELECTED PRIMITIVE</label>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:9px;color:#8b949e;width:28px">Pos</span>
          <input id="sculpt-pos-x" type="number" step="0.1" style="width:52px" placeholder="X"/>
          <input id="sculpt-pos-y" type="number" step="0.1" style="width:52px" placeholder="Y"/>
          <input id="sculpt-pos-z" type="number" step="0.1" style="width:52px" placeholder="Z"/>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:9px;color:#8b949e;width:28px">Size</span>
          <input id="sculpt-scl-x" type="number" step="0.1" min="0.1" style="width:52px" placeholder="X"/>
          <input id="sculpt-scl-y" type="number" step="0.1" min="0.1" style="width:52px" placeholder="Y"/>
          <input id="sculpt-scl-z" type="number" step="0.1" min="0.1" style="width:52px" placeholder="Z"/>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:9px;color:#8b949e;width:28px">Rot°</span>
          <input id="sculpt-rot-x" type="number" step="5" style="width:52px"/>
          <input id="sculpt-rot-y" type="number" step="5" style="width:52px"/>
          <input id="sculpt-rot-z" type="number" step="5" style="width:52px"/>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:9px;color:#8b949e;width:28px">Color</span>
          <input id="sculpt-prim-color" type="color" style="width:60px;height:24px;cursor:pointer"/>
        </div>
        <button id="sculpt-del-prim" type="button" style="font-size:11px;padding:4px 8px;color:#ff6b6b">Remove Primitive</button>
      </div>
      <div style="font-size:10px;color:#6a737d;line-height:1.6;background:#0d1117;border:1px solid #1d2430;border-radius:6px;padding:8px 10px;margin-top:4px">
        <div style="font-weight:700;color:#8b949e;margin-bottom:4px">🎮 Controls</div>
        <div>🖱 <b>Left-drag</b> on the 3D view to orbit the camera</div>
        <div>🖱 <b>Scroll</b> to zoom in/out</div>
        <div>🖱 <b>Click</b> a shape in the 3D view to select it</div>
        <div>🔧 Drag the <b>gizmo arrows</b> on a selected shape to move/rotate/scale it</div>
        <div>⌨ Press <b>1</b>=Move, <b>2</b>=Rotate, <b>3</b>=Scale</div>
        <div>⌨ <b>Delete/Backspace</b> to remove selected</div>
        <div>⌨ <b>Ctrl+Z</b> / <b>Ctrl+Y</b> to Undo/Redo</div>
      </div>
      <div style="display:flex;gap:4px;margin-top:4px">
        <button id="sculpt-gizmo-translate" type="button" style="flex:1;font-size:10px;padding:4px 6px;background:#1a2740;border:1px solid #58a6ff;color:#58a6ff;border-radius:4px;cursor:pointer">Move</button>
        <button id="sculpt-gizmo-rotate" type="button" style="flex:1;font-size:10px;padding:4px 6px;border-radius:4px;cursor:pointer">Rotate</button>
        <button id="sculpt-gizmo-scale" type="button" style="flex:1;font-size:10px;padding:4px 6px;border-radius:4px;cursor:pointer">Scale</button>
      </div>
      <div style="margin-top:auto;display:flex;flex-direction:column;gap:8px">
        <button id="sculpt-save" type="button" style="font-size:12px;padding:8px 12px;background:#1e3a24;border-color:#2f7a3f;color:#8be9a8">Save Sculpt</button>
        <button id="sculpt-cancel" type="button" style="font-size:12px;padding:8px 12px">Close</button>
      </div>
    </div>
    <canvas id="sculpt-3d-canvas" style="flex:1;display:block;outline:none"></canvas>
  `;
  document.body.appendChild(overlay);
  sculptEditorOverlayEl = overlay;

  // Set up 3D preview
  const canvas3d = overlay.querySelector('#sculpt-3d-canvas');
  const w0 = Math.max(canvas3d.clientWidth || 0, window.innerWidth - 280);
  const h0 = Math.max(canvas3d.clientHeight || 0, window.innerHeight);

  const r3d = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
  r3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  r3d.setSize(w0, h0, false);
  r3d.setClearColor(0x080c10);

  const s3d = new THREE.Scene();
  const cam3d = new THREE.PerspectiveCamera(55, w0 / h0, 0.1, 200);
  cam3d.position.set(4, 3, 5);
  cam3d.lookAt(0, 0, 0);

  s3d.add(new THREE.AmbientLight(0xd0e8ff, 0.75));
  const sun3d = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sun3d.position.set(8, 12, 6);
  s3d.add(sun3d);
  s3d.add(new THREE.DirectionalLight(0xc0d8ff, 0.4).translateX(-5).translateY(3));

  const gridH = new THREE.GridHelper(12, 12, 0x1a2230, 0x1a2230);
  s3d.add(gridH);

  // Axis helpers
  const axH = new THREE.AxesHelper(1.5);
  axH.renderOrder = 31;
  s3d.add(axH);

  // TransformControls for dragging/rotating/scaling primitives
  const sculptTc = new TransformControls(cam3d, canvas3d);
  sculptTc.setSize(0.8);
  sculptTc.addEventListener('dragging-changed', e => { oc3d.enabled = !e.value; });
  s3d.add(sculptTc);
  let sculptGizmoMode = 'translate';
  let sculptDragBefore = null;
  sculptTc.addEventListener('mouseDown', () => {
    sculptDragBefore = captureSculptSnapshot();
  });
  sculptTc.addEventListener('objectChange', () => {
    const idx = sculptEditorState.selectedIndex;
    if (idx < 0 || idx >= sculptEditorState.primitives.length) return;
    const obj = sculptTc.object;
    if (!obj) return;
    sculptEditorState.primitives[idx].position = [obj.position.x, obj.position.y, obj.position.z];
    sculptEditorState.primitives[idx].scale = [obj.scale.x, obj.scale.y, obj.scale.z];
    sculptEditorState.primitives[idx].rotation = [
      obj.rotation.x * 180 / Math.PI,
      obj.rotation.y * 180 / Math.PI,
      obj.rotation.z * 180 / Math.PI
    ];
    refreshSelectedControls();
  });
  sculptTc.addEventListener('mouseUp', () => {
    if (sculptDragBefore) {
      commitSculptChange(sculptDragBefore);
      sculptDragBefore = null;
      syncUndoRedoButtons();
    }
  });

  const oc3d = new OrbitControls(cam3d, canvas3d);
  oc3d.enableDamping = true;
  oc3d.dampingFactor = 0.1;
  oc3d.update();

  const sculptPreviewGroup = new THREE.Group();
  s3d.add(sculptPreviewGroup);

  // Outline material for selected primitive
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, wireframe: true, transparent: true, opacity: 0.8 });

  const sculptState = { renderer: r3d, scene: s3d, camera: cam3d, controls: oc3d, previewGroup: sculptPreviewGroup, animId: null, outlineMat, transformControls: sculptTc };
  overlay._sculptState = sculptState;

  function rebuildPreview() {
    // Clear previous
    while (sculptPreviewGroup.children.length) {
      const c = sculptPreviewGroup.children[0];
      sculptPreviewGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    }

    sculptEditorState.primitives.forEach((prim, idx) => {
      const geo = buildSculptPrimitiveGeometry(prim);
      const color = prim.color;
      const mat = prim.op === 'subtract'
        ? new THREE.MeshStandardMaterial({ color: 0xff4444, transparent: true, opacity: 0.3, wireframe: true })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(prim.position[0], prim.position[1], prim.position[2]);
      m.scale.set(prim.scale[0], prim.scale[1], prim.scale[2]);
      m.rotation.set(prim.rotation[0] * Math.PI / 180, prim.rotation[1] * Math.PI / 180, prim.rotation[2] * Math.PI / 180);
      m.castShadow = true;
      m.receiveShadow = true;
      sculptPreviewGroup.add(m);

      // Wireframe outline for selected
      if (idx === sculptEditorState.selectedIndex) {
        const outline = new THREE.Mesh(geo.clone(), outlineMat);
        outline.position.copy(m.position);
        outline.scale.copy(m.scale).multiplyScalar(1.02);
        outline.rotation.copy(m.rotation);
        sculptPreviewGroup.add(outline);
      }
    });

    // Attach TransformControls to the selected primitive mesh
    sculptTc.detach();
    const selIdx = sculptEditorState.selectedIndex;
    if (selIdx >= 0 && selIdx < sculptEditorState.primitives.length) {
      let meshCount = -1;
      for (const child of sculptPreviewGroup.children) {
        if (child.material !== outlineMat) {
          meshCount++;
          if (meshCount === selIdx) {
            sculptTc.attach(child);
            sculptTc.setMode(sculptGizmoMode);
            break;
          }
        }
      }
    }
  }

  function refreshPrimList() {
    const listEl = overlay.querySelector('#sculpt-prim-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    sculptEditorState.primitives.forEach((prim, idx) => {
      const div = document.createElement('div');
      const sel = idx === sculptEditorState.selectedIndex;
      div.style.cssText = `padding:5px 8px;border-radius:4px;cursor:pointer;font-size:11px;display:flex;align-items:center;gap:6px;${sel ? 'background:#1a2740;border:1px solid #58a6ff' : 'background:#111821;border:1px solid #1d2430'}`;
      const colorSwatch = `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:#${prim.color.toString(16).padStart(6, '0')}"></span>`;
      div.innerHTML = `${colorSwatch}<span>${prim.op === 'subtract' ? '−' : '+'} ${prim.shape}</span><span style="margin-left:auto;font-size:9px;color:#8b949e">#${idx + 1}</span>`;
      div.addEventListener('click', () => {
        sculptEditorState.selectedIndex = idx;
        refreshPrimList();
        refreshSelectedControls();
        rebuildPreview();
      });
      listEl.appendChild(div);
    });
  }

  // Click-to-select in 3D viewport
  const sculptRaycaster = new THREE.Raycaster();
  const sculptPickNdc = new THREE.Vector2();
  canvas3d.addEventListener('pointerdown', e => {
    if (sculptTc.dragging) return;
    const rect = canvas3d.getBoundingClientRect();
    sculptPickNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    sculptRaycaster.setFromCamera(sculptPickNdc, cam3d);
    const meshes = [];
    let meshIdx = 0;
    for (const child of sculptPreviewGroup.children) {
      if (child.material !== outlineMat) {
        meshes.push({ mesh: child, idx: meshIdx++ });
      }
    }
    const hits = sculptRaycaster.intersectObjects(meshes.map(m => m.mesh), false);
    if (hits.length) {
      const hitMesh = hits[0].object;
      const found = meshes.find(m => m.mesh === hitMesh);
      if (found && found.idx !== sculptEditorState.selectedIndex) {
        sculptEditorState.selectedIndex = found.idx;
        refreshPrimList();
        refreshSelectedControls();
        rebuildPreview();
      }
    }
  });

  // Gizmo mode buttons
  function updateGizmoButtons() {
    const btnT = overlay.querySelector('#sculpt-gizmo-translate');
    const btnR = overlay.querySelector('#sculpt-gizmo-rotate');
    const btnS = overlay.querySelector('#sculpt-gizmo-scale');
    const activeStyle = 'background:#1a2740;border:1px solid #58a6ff;color:#58a6ff';
    const normalStyle = 'background:transparent;border:1px solid var(--border,#30363d);color:var(--text,#d4d8dd)';
    if (btnT) btnT.style.cssText = `flex:1;font-size:10px;padding:4px 6px;border-radius:4px;cursor:pointer;${sculptGizmoMode === 'translate' ? activeStyle : normalStyle}`;
    if (btnR) btnR.style.cssText = `flex:1;font-size:10px;padding:4px 6px;border-radius:4px;cursor:pointer;${sculptGizmoMode === 'rotate' ? activeStyle : normalStyle}`;
    if (btnS) btnS.style.cssText = `flex:1;font-size:10px;padding:4px 6px;border-radius:4px;cursor:pointer;${sculptGizmoMode === 'scale' ? activeStyle : normalStyle}`;
  }
  overlay.querySelector('#sculpt-gizmo-translate')?.addEventListener('click', () => { sculptGizmoMode = 'translate'; sculptTc.setMode('translate'); updateGizmoButtons(); });
  overlay.querySelector('#sculpt-gizmo-rotate')?.addEventListener('click', () => { sculptGizmoMode = 'rotate'; sculptTc.setMode('rotate'); updateGizmoButtons(); });
  overlay.querySelector('#sculpt-gizmo-scale')?.addEventListener('click', () => { sculptGizmoMode = 'scale'; sculptTc.setMode('scale'); updateGizmoButtons(); });
  updateGizmoButtons();

  function refreshSelectedControls() {
    const panel = overlay.querySelector('#sculpt-selected-controls');
    if (!panel) return;
    const idx = sculptEditorState.selectedIndex;
    if (idx < 0 || idx >= sculptEditorState.primitives.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'flex';
    const prim = sculptEditorState.primitives[idx];
    overlay.querySelector('#sculpt-pos-x').value = prim.position[0].toFixed(2);
    overlay.querySelector('#sculpt-pos-y').value = prim.position[1].toFixed(2);
    overlay.querySelector('#sculpt-pos-z').value = prim.position[2].toFixed(2);
    overlay.querySelector('#sculpt-scl-x').value = prim.scale[0].toFixed(2);
    overlay.querySelector('#sculpt-scl-y').value = prim.scale[1].toFixed(2);
    overlay.querySelector('#sculpt-scl-z').value = prim.scale[2].toFixed(2);
    overlay.querySelector('#sculpt-rot-x').value = prim.rotation[0].toFixed(1);
    overlay.querySelector('#sculpt-rot-y').value = prim.rotation[1].toFixed(1);
    overlay.querySelector('#sculpt-rot-z').value = prim.rotation[2].toFixed(1);
    overlay.querySelector('#sculpt-prim-color').value = '#' + prim.color.toString(16).padStart(6, '0');
  }

  function syncUndoRedoButtons() {
    const u = overlay.querySelector('#sculpt-undo');
    const r = overlay.querySelector('#sculpt-redo');
    if (u) u.disabled = !sculptEditorState.undoStack.length;
    if (r) r.disabled = !sculptEditorState.redoStack.length;
  }

  function refreshAll() {
    rebuildPreview();
    refreshPrimList();
    refreshSelectedControls();
    syncUndoRedoButtons();
  }

  // Animate
  function sculptAnimate() {
    sculptState.animId = requestAnimationFrame(sculptAnimate);
    oc3d.update();
    r3d.render(s3d, cam3d);
  }
  sculptAnimate();

  // Resize
  const ro = new ResizeObserver(() => {
    const w = canvas3d.clientWidth;
    const h = canvas3d.clientHeight;
    if (w > 0 && h > 0) {
      cam3d.aspect = w / h;
      cam3d.updateProjectionMatrix();
      r3d.setSize(w, h, false);
    }
  });
  ro.observe(canvas3d);

  // Wire events
  overlay.querySelector('#sculpt-add')?.addEventListener('click', () => {
    const before = captureSculptSnapshot();
    const shape = overlay.querySelector('#sculpt-shape')?.value || 'sphere';
    const colorInput = overlay.querySelector('#sculpt-color');
    const color = colorInput ? parseInt(colorInput.value.replace('#', ''), 16) : 0x7f8ea0;
    sculptEditorState.primitives.push(normalizeSculptPrimitive({ shape, op: 'add', color, position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0] }));
    sculptEditorState.selectedIndex = sculptEditorState.primitives.length - 1;
    commitSculptChange(before);
    refreshAll();
  });

  overlay.querySelector('#sculpt-del-prim')?.addEventListener('click', () => {
    const idx = sculptEditorState.selectedIndex;
    if (idx < 0 || idx >= sculptEditorState.primitives.length) return;
    const before = captureSculptSnapshot();
    sculptEditorState.primitives.splice(idx, 1);
    sculptEditorState.selectedIndex = Math.min(idx, sculptEditorState.primitives.length - 1);
    commitSculptChange(before);
    refreshAll();
  });

  // Position/scale/rotation inputs
  const bindPrimInput = (id, prop, index, parse = parseFloat) => {
    const el = overlay.querySelector(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const idx = sculptEditorState.selectedIndex;
      if (idx < 0 || idx >= sculptEditorState.primitives.length) return;
      const before = captureSculptSnapshot();
      const v = parse(el.value);
      if (!Number.isFinite(v)) return;
      sculptEditorState.primitives[idx][prop][index] = v;
      commitSculptChange(before);
      rebuildPreview();
      syncUndoRedoButtons();
    });
  };
  bindPrimInput('#sculpt-pos-x', 'position', 0);
  bindPrimInput('#sculpt-pos-y', 'position', 1);
  bindPrimInput('#sculpt-pos-z', 'position', 2);
  bindPrimInput('#sculpt-scl-x', 'scale', 0);
  bindPrimInput('#sculpt-scl-y', 'scale', 1);
  bindPrimInput('#sculpt-scl-z', 'scale', 2);
  bindPrimInput('#sculpt-rot-x', 'rotation', 0);
  bindPrimInput('#sculpt-rot-y', 'rotation', 1);
  bindPrimInput('#sculpt-rot-z', 'rotation', 2);

  overlay.querySelector('#sculpt-prim-color')?.addEventListener('change', (e) => {
    const idx = sculptEditorState.selectedIndex;
    if (idx < 0 || idx >= sculptEditorState.primitives.length) return;
    const before = captureSculptSnapshot();
    sculptEditorState.primitives[idx].color = parseInt(e.target.value.replace('#', ''), 16) || 0x7f8ea0;
    commitSculptChange(before);
    rebuildPreview();
    refreshPrimList();
    syncUndoRedoButtons();
  });

  overlay.querySelector('#sculpt-undo')?.addEventListener('click', () => { undoSculptChange(); refreshAll(); });
  overlay.querySelector('#sculpt-redo')?.addEventListener('click', () => { redoSculptChange(); refreshAll(); });

  overlay.querySelector('#sculpt-save')?.addEventListener('click', () => {
    const skin = normalizeSculptSkin({ primitives: sculptEditorState.primitives });
    if (skin.primitives.length) {
      customSculptSkins[type] = skin;
      // Remove voxel skin if sculpt replaces it
      delete customBlockSkins[type];
    } else {
      delete customSculptSkins[type];
    }
    refreshCustomSkinsOnScene();
    refreshSculptSkinsOnScene();
    removeGhost();
    closeSculptEditorOverlay();
    saveEditorSettings();
  });

  overlay.querySelector('#sculpt-cancel')?.addEventListener('click', () => {
    closeSculptEditorOverlay();
  });

  overlay.addEventListener('keydown', e => {
    // Don't intercept keys when typing in number/text inputs
    const ae = document.activeElement;
    const isInput = ae instanceof HTMLInputElement || ae instanceof HTMLTextAreaElement || ae instanceof HTMLSelectElement;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); undoSculptChange(); refreshAll();
    }
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault(); redoSculptChange(); refreshAll();
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSculptEditorOverlay(); }
    if (!isInput && e.key === '1') { sculptGizmoMode = 'translate'; sculptTc.setMode('translate'); updateGizmoButtons(); }
    if (!isInput && e.key === '2') { sculptGizmoMode = 'rotate'; sculptTc.setMode('rotate'); updateGizmoButtons(); }
    if (!isInput && e.key === '3') { sculptGizmoMode = 'scale'; sculptTc.setMode('scale'); updateGizmoButtons(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
      const idx = sculptEditorState.selectedIndex;
      if (idx >= 0 && idx < sculptEditorState.primitives.length) {
        e.preventDefault();
        const before = captureSculptSnapshot();
        sculptEditorState.primitives.splice(idx, 1);
        sculptEditorState.selectedIndex = Math.min(idx, sculptEditorState.primitives.length - 1);
        commitSculptChange(before);
        refreshAll();
      }
    }
  });

  overlay.tabIndex = 0;
  overlay.focus();
  refreshAll();
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
      ${keypadConfig.mode === 'code'
        ? `<div style="font-size:10px;color:#89a1b5;line-height:1.5">Enter the correct code to proceed.</div>`
        : `<div style="font-size:10px;color:#89a1b5;line-height:1.5">Variable: ${escapeHtml(switchConfig.varKey)}<br>Accepts when value is between ${r3(Math.min(switchConfig.min, switchConfig.max), 1)} and ${r3(Math.max(switchConfig.min, switchConfig.max), 1)}.</div>`}
      <div id="runtime-keypad-status" style="font-size:11px;color:#89a1b5;min-height:16px"></div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        ${['1','2','3','4','5','6','7','8','9','.','0','<-'].map(value => `<button type="button" data-keypad-key="${value}" style="font-size:18px;padding:12px 0;border-radius:12px;background:#162130;border:1px solid rgba(143,180,215,0.12);color:#e6edf3">${value}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px">
        <button id="runtime-keypad-clear" type="button" style="flex:1;font-size:14px;padding:10px 12px;border-radius:12px;background:#30232a;border:1px solid #7b2a3b;color:#ffd4d4">C</button>
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
    if (keypadConfig.mode === 'code') {
      const entered = value || '0';
      if (entered === keypadConfig.code) {
        setStatus('Code accepted!', '#8be9a8');
        activateControlMesh(mesh, { oneShot: true });
        window.setTimeout(() => {
          if (activeRuntimeKeypadMesh === mesh) closeRuntimeKeypadOverlay({ restorePointerLock: true });
        }, 120);
      } else {
        setStatus('Incorrect code.', '#ff6b6b');
        value = '';
        syncDisplay();
      }
      return;
    }
    if (!switchConfig.varKey) {
      setStatus('Assign a variable in Properties first.', '#ffb86b');
      return;
    }
    const nextValue = parseFloat(value || '0') || 0;
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
      } else if (key === '.') {
        if (!value.includes('.') && value.length < keypadConfig.maxDigits) {
          value += value.length === 0 ? '0.' : '.';
        }
      } else if (value.length < keypadConfig.maxDigits) {
        value += key;
      }
      syncDisplay();
      setStatus('');
    });
  });

  overlay.querySelector('#runtime-keypad-clear')?.addEventListener('click', () => {
    value = '';
    syncDisplay();
    setStatus('');
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
    if (e.key === '.' && !value.includes('.') && value.length < keypadConfig.maxDigits) {
      e.preventDefault();
      value += value.length === 0 ? '0.' : '.';
      syncDisplay();
    } else if (/^[0-9]$/.test(e.key) && value.length < keypadConfig.maxDigits) {
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

// ─── Runtime screen interaction overlay ───────────────────────────────────────
function closeRuntimeScreenOverlay(options = {}) {
  if (!runtimeScreenOverlayEl) return;
  runtimeScreenOverlayEl.remove();
  runtimeScreenOverlayEl = null;
  if (options.restorePointerLock && state.isPlaytest && !runtimePauseActive && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
}

function openRuntimeScreenOverlay(mesh) {
  if (!mesh || !state.isPlaytest) return false;
  const sc = normalizeScreenConfig(mesh.userData.screenConfig);
  if (!sc.interactive) return false;
  closeRuntimeScreenOverlay();

  const overlay = document.createElement('div');
  overlay.id = 'runtime-screen-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:20050;background:rgba(6,10,14,0.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center';

  let contentHtml = '';
  if (sc.mediaType === 'url' && sc.url) {
    const safeUrl = sc.url;
    contentHtml = `<iframe id="runtime-screen-iframe" src="${escapeHtml(safeUrl)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" style="width:100%;height:100%;border:none;border-radius:12px"></iframe>`;
  } else if (sc.mediaType === 'html' && sc.htmlContent) {
    contentHtml = `<iframe id="runtime-screen-iframe" sandbox="allow-scripts" style="width:100%;height:100%;border:none;border-radius:12px"></iframe>`;
  } else if (sc.mediaType === 'video' && sc.videoData) {
    contentHtml = `<video id="runtime-screen-video" src="${escapeHtml(sc.videoData)}" controls autoplay style="width:100%;max-height:100%;border-radius:12px;background:#000"></video>`;
  } else if (sc.mediaType === 'image' && sc.imageData) {
    contentHtml = `<img src="${escapeHtml(sc.imageData)}" style="max-width:100%;max-height:100%;border-radius:12px;object-fit:contain"/>`;
  } else if (sc.mediaType === 'color') {
    contentHtml = `<div style="width:100%;height:100%;background:${escapeHtml(sc.screenColor)};border-radius:12px"></div>`;
  } else {
    return false;
  }

  overlay.innerHTML = `
    <div id="runtime-screen-panel" style="position:relative;width:min(80vw,960px);height:min(70vh,640px);border-radius:14px;border:1px solid rgba(143,180,215,0.22);background:rgba(10,16,22,0.98);box-shadow:0 24px 70px rgba(0,0,0,0.5);overflow:hidden;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(143,180,215,0.12)">
        <span style="font-size:11px;color:#89a1b5;letter-spacing:.1em;text-transform:uppercase">Screen</span>
        <button id="runtime-screen-close" type="button" style="font-size:11px;padding:4px 10px;border-radius:6px;background:#30232a;border:1px solid #7b2a3b;color:#ffd4d4;cursor:pointer">✕ Close</button>
      </div>
      <div style="flex:1;overflow:hidden;padding:4px">${contentHtml}</div>
    </div>
  `;

  const panel = overlay.querySelector('#runtime-screen-panel');
  // For html media type, set srcdoc after insertion to avoid escaping issues
  if (sc.mediaType === 'html' && sc.htmlContent) {
    const iframe = overlay.querySelector('#runtime-screen-iframe');
    if (iframe) iframe.srcdoc = sc.htmlContent;
  }

  overlay.querySelector('#runtime-screen-close')?.addEventListener('click', () => closeRuntimeScreenOverlay({ restorePointerLock: true }));
  overlay.addEventListener('pointerdown', e => {
    if (!panel.contains(e.target)) closeRuntimeScreenOverlay({ restorePointerLock: true });
  });
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRuntimeScreenOverlay({ restorePointerLock: true });
    }
  });

  document.body.appendChild(overlay);
  runtimeScreenOverlayEl = overlay;
  overlay.tabIndex = 0;
  overlay.focus();
  return true;
}

function tryOpenRuntimeScreenFromPointerEvent(e) {
  if (!state.isPlaytest) return false;
  const ndc = fpsLocked ? new THREE.Vector2(0, 0) : toNDC(e);
  raycaster.setFromCamera(ndc, fpsCam);
  const hits = raycaster.intersectObjects(sceneObjects, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData?.type) obj = obj.parent;
    if (obj?.userData?.type === 'screen') {
      const sc = normalizeScreenConfig(obj.userData.screenConfig);
      if (sc.interactive) {
        e?.preventDefault?.();
        if (document.pointerLockElement === renderer.domElement) {
          suppressPointerUnlockStop = true;
          document.exitPointerLock();
        }
        return openRuntimeScreenOverlay(obj);
      }
    }
  }
  return false;
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
  if (type === 'terrain') {
    next.segments = params.segments ?? 64;
    next.terrainSize = params.terrainSize ?? 20;
  }
  return next;
}

function buildTypeGeometry(type, shapeParams = {}) {
  const def = DEFS[type];
  return def.makeGeo(normalizeShapeParams(type, shapeParams));
}

const CONTROL_ACTION_TYPES = ['move', 'rotate', 'light', 'audio', 'path', 'functionControl', 'playerGroup', 'setVar', 'setBool', 'playerStats', 'teleport', 'skeleton'];
const SKELETON_ANIM_COMMANDS = ['play', 'stop', 'pause', 'resume'];
const TELEPORT_MODES = ['coords', 'spawn', 'object'];
const CONTROL_LIGHT_OPS = ['toggle', 'enable', 'disable', 'intensity', 'distance'];
const CONTROL_PLAYER_GROUP_MODES = ['set', 'add', 'remove', 'random'];
const AUDIO_PLAY_MODES = ['global', 'proximity'];
const AUDIO_UNTIL_EVENTS = ['deactivate', 'audioDone', 'functionDone', 'manual'];
const PATH_CONTROL_COMMANDS = ['start', 'pause', 'resume', 'stop', 'reset'];
const FUNCTION_CONTROL_COMMANDS = ['pause', 'resume', 'stop', 'reset', 'restart'];
const CONDITION_TYPES = ['none', 'fnDone', 'touching', 'touchingPlayer', 'position', 'distance', 'timer', 'key', 'grounded', 'varCmp', 'bool'];
const PLAYER_STAT_KEYS = ['health', 'maxHealth', 'jumpHeight', 'gravity', 'sprintSpeed', 'height'];
const PLAYER_STAT_OPS = ['=', '+', '-', '*', '/'];
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

// ─── Joint config ────────────────────────────────────────────────────────────
const JOINT_AXES = ['X', 'Y', 'Z'];

function createDefaultJointConfig() {
  return {
    parentLabel: '',
    childLabel: '',
    axis: 'Y',
    speed: 1,        // rotations per second
    angle: 0,        // current angle in degrees (runtime state kept separate)
    minAngle: -180,
    maxAngle: 180,
    mode: 'manual',  // 'manual' = controlled by function, 'auto' = oscillate, 'fixed' = passive parent-child link
  };
}

function normalizeJointConfig(config = {}) {
  const base = createDefaultJointConfig();
  return {
    parentLabel: String(config.parentLabel ?? base.parentLabel).trim(),
    childLabel: String(config.childLabel ?? base.childLabel).trim(),
    axis: JOINT_AXES.includes(config.axis) ? config.axis : base.axis,
    speed: Math.max(0, Number.isFinite(parseFloat(config.speed)) ? parseFloat(config.speed) : base.speed),
    angle: Number.isFinite(parseFloat(config.angle)) ? parseFloat(config.angle) : base.angle,
    minAngle: Number.isFinite(parseFloat(config.minAngle)) ? parseFloat(config.minAngle) : base.minAngle,
    maxAngle: Number.isFinite(parseFloat(config.maxAngle)) ? parseFloat(config.maxAngle) : base.maxAngle,
    mode: ['manual', 'auto', 'fixed'].includes(config.mode) ? config.mode : base.mode,
  };
}

function getMeshJointConfig(mesh) {
  if (!mesh?.userData || mesh.userData.type !== 'joint') return null;
  const cfg = normalizeJointConfig(mesh.userData.jointConfig);
  mesh.userData.jointConfig = cfg;
  return cfg;
}

// ─── Skeleton config (per-mesh instance) ─────────────────────────────────────
function createDefaultSkeletonConfig() {
  return {
    definitionName: '',
    currentAnimation: '',
    currentPose: '',
    playOnStart: true,
    loopAnimation: true,
    animationSpeed: 1,
  };
}

function normalizeSkeletonConfig(config = {}) {
  const base = createDefaultSkeletonConfig();
  return {
    definitionName: String(config.definitionName ?? base.definitionName).trim(),
    currentAnimation: String(config.currentAnimation ?? base.currentAnimation).trim(),
    currentPose: String(config.currentPose ?? base.currentPose).trim(),
    playOnStart: typeof config.playOnStart === 'boolean' ? config.playOnStart : base.playOnStart,
    loopAnimation: typeof config.loopAnimation === 'boolean' ? config.loopAnimation : base.loopAnimation,
    animationSpeed: Math.max(0, Number.isFinite(parseFloat(config.animationSpeed)) ? parseFloat(config.animationSpeed) : base.animationSpeed),
  };
}

function getMeshSkeletonConfig(mesh) {
  if (!mesh?.userData || mesh.userData.type !== 'skeleton') return null;
  const cfg = normalizeSkeletonConfig(mesh.userData.skeletonConfig);
  mesh.userData.skeletonConfig = cfg;
  return cfg;
}

// ─── Skeleton definitions (project-level registry) ───────────────────────────
function createDefaultBone(overrides = {}) {
  const head = Array.isArray(overrides.head) ? overrides.head.slice(0, 3).map(v => Number(v) || 0) : [0, 0, 0];
  const tail = Array.isArray(overrides.tail) ? overrides.tail.slice(0, 3).map(v => Number(v) || 0) : [head[0], head[1] + 0.3, head[2]];
  // Backward compat: convert old position+length+rotation to head/tail
  if (!overrides.head && !overrides.tail && (overrides.position || overrides.length != null)) {
    // Old format: position is offset from parent, length is bone extent
    // We'll accept the old fields but they'll be converted in normalizeSkeletonDefinition
  }
  return {
    id: overrides.id || ('bone_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
    name: overrides.name || 'Bone',
    parent: overrides.parent ?? null,
    connected: overrides.connected ?? false,
    head,
    tail,
    roll: Number.isFinite(overrides.roll) ? overrides.roll : 0,
  };
}

function normalizeBone(raw = {}) {
  // Backward compat: convert old position+length format to head/tail
  if (raw.position && !raw.head && !raw.tail) {
    return createDefaultBone({
      id: raw.id,
      name: raw.name,
      parent: raw.parent,
      connected: raw.connected,
      head: [0, 0, 0],   // will be resolved below in _resolveOldBonePositions
      tail: [0, 0.3, 0],
      roll: 0,
      _oldPosition: raw.position,
      _oldLength: raw.length,
      _oldRotation: raw.rotation,
    });
  }
  return createDefaultBone({
    id: raw.id,
    name: raw.name,
    parent: raw.parent,
    connected: raw.connected,
    head: raw.head,
    tail: raw.tail,
    roll: raw.roll,
  });
}

/** Convert old-format bones (position+length+rotation) to head/tail world positions. */
function _resolveOldBonePositions(bones) {
  const boneMap = new Map();
  for (const b of bones) boneMap.set(b.id, b);

  // Build THREE hierarchy temporarily to compute world positions
  const threeBones = new Map();
  const rootBones = [];
  for (const bd of bones) {
    const bone = new THREE.Bone();
    const pos = bd._oldPosition || bd.position || [0, 0, 0];
    const rot = bd._oldRotation || bd.rotation || [0, 0, 0, 1];
    const len = bd._oldLength || bd.length || 0.3;
    bone.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
    if (Array.isArray(rot) && rot.length >= 4) {
      bone.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
    }
    bone.userData._len = Math.max(0.01, len);
    bone.userData._id = bd.id;
    threeBones.set(bd.id, bone);
  }
  for (const bd of bones) {
    const bone = threeBones.get(bd.id);
    if (bd.parent && threeBones.has(bd.parent)) {
      threeBones.get(bd.parent).add(bone);
    } else {
      rootBones.push(bone);
    }
  }
  const group = new THREE.Group();
  for (const r of rootBones) group.add(r);
  group.updateMatrixWorld(true);

  // Compute head and tail world positions from children average direction
  const wp = new THREE.Vector3();
  for (const bd of bones) {
    const bone = threeBones.get(bd.id);
    bone.getWorldPosition(wp);
    bd.head = [wp.x, wp.y, wp.z];

    // Compute tail: the bone's "natural" direction derived from children positions
    const children = bones.filter(b => b.parent === bd.id);
    const dir = new THREE.Vector3();
    if (children.length > 0) {
      for (const child of children) {
        const cb = threeBones.get(child.id);
        const cp = new THREE.Vector3();
        cb.getWorldPosition(cp);
        dir.add(cp);
      }
      dir.divideScalar(children.length).sub(wp);
    } else {
      // Leaf bone: direction from parent to this bone
      dir.set(bd._oldPosition?.[0] || 0, bd._oldPosition?.[1] || 0, bd._oldPosition?.[2] || 0);
      if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    }
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    dir.normalize().multiplyScalar(bone.userData._len);
    bd.tail = [wp.x + dir.x, wp.y + dir.y, wp.z + dir.z];
    bd.roll = 0;
    bd.connected = !!bd.parent;
    delete bd._oldPosition;
    delete bd._oldLength;
    delete bd._oldRotation;
    delete bd.position;
    delete bd.rotation;
    delete bd.length;
  }
  return bones;
}

/** Compute bone length from head/tail distance. */
function boneLength(boneDef) {
  const dx = boneDef.tail[0] - boneDef.head[0];
  const dy = boneDef.tail[1] - boneDef.head[1];
  const dz = boneDef.tail[2] - boneDef.head[2];
  return Math.max(0.01, Math.sqrt(dx * dx + dy * dy + dz * dz));
}

function createDefaultSkeletonDefinition(name = 'Unnamed') {
  return {
    name: String(name).trim() || 'Unnamed',
    bones: [],
    poses: {},
    animations: {},
    boneSkins: {},
    boneBindWorldQuats: {},
  };
}

function normalizeSkeletonDefinition(def = {}) {
  const name = String(def.name ?? 'Unnamed').trim() || 'Unnamed';
  let bones = Array.isArray(def.bones) ? def.bones.map(normalizeBone) : [];
  // Backward compat: if any bone has old-style `position` field, resolve to head/tail
  if (bones.some(b => b._oldPosition || b.position)) {
    bones = _resolveOldBonePositions(bones);
  }
  const poses = {};
  if (def.poses && typeof def.poses === 'object') {
    for (const [poseName, poseData] of Object.entries(def.poses)) {
      if (!poseData || typeof poseData !== 'object') continue;
      const pose = {};
      for (const [boneId, quat] of Object.entries(poseData)) {
        if (Array.isArray(quat) && quat.length >= 4) {
          pose[boneId] = quat.slice(0, 4).map(Number);
        }
      }
      poses[poseName] = pose;
    }
  }
  const animations = {};
  if (def.animations && typeof def.animations === 'object') {
    for (const [animName, animData] of Object.entries(def.animations)) {
      if (!animData || typeof animData !== 'object') continue;
      const anim = {
        duration: Math.max(0.1, Number.isFinite(animData.duration) ? animData.duration : 1),
        loop: typeof animData.loop === 'boolean' ? animData.loop : true,
        keyframes: [],
      };
      if (Array.isArray(animData.keyframes)) {
        for (const kf of animData.keyframes) {
          if (!kf || typeof kf !== 'object') continue;
          const keyframe = { time: Math.max(0, Number.isFinite(kf.time) ? kf.time : 0), bones: {} };
          if (kf.bones && typeof kf.bones === 'object') {
            for (const [boneId, quat] of Object.entries(kf.bones)) {
              if (Array.isArray(quat) && quat.length >= 4) {
                keyframe.bones[boneId] = quat.slice(0, 4).map(Number);
              }
            }
          }
          anim.keyframes.push(keyframe);
        }
        anim.keyframes.sort((a, b) => a.time - b.time);
      }
      animations[animName] = anim;
    }
  }
  const boneSkins = {};
  if (def.boneSkins && typeof def.boneSkins === 'object') {
    for (const [boneId, skinRaw] of Object.entries(def.boneSkins)) {
      if (!skinRaw || typeof skinRaw !== 'object') continue;
      if (skinRaw.type === 'mesh') {
        // Mesh skins: preserve vertices/indices/colors arrays as-is
        boneSkins[boneId] = {
          type: 'mesh',
          vertices: Array.isArray(skinRaw.vertices) ? skinRaw.vertices : [],
          indices: Array.isArray(skinRaw.indices) ? skinRaw.indices : [],
          colors: Array.isArray(skinRaw.colors) ? skinRaw.colors : [],
        };
      } else {
        boneSkins[boneId] = normalizeCustomBlockSkin(skinRaw);
      }
    }
  }
  // Preserve FBX bind-pose world quaternions for mesh skin correction
  const boneBindWorldQuats = {};
  if (def.boneBindWorldQuats && typeof def.boneBindWorldQuats === 'object') {
    for (const [boneId, quat] of Object.entries(def.boneBindWorldQuats)) {
      if (Array.isArray(quat) && quat.length >= 4) {
        boneBindWorldQuats[boneId] = quat.slice(0, 4).map(Number);
      }
    }
  }
  return { name, bones, poses, animations, boneSkins, boneBindWorldQuats };
}

function serializeSkeletonDefinitions() {
  const out = {};
  for (const [name, defRaw] of Object.entries(skeletonDefinitions)) {
    const def = normalizeSkeletonDefinition(defRaw);
    if (!def.bones.length) continue;
    out[name] = def;
  }
  return out;
}

function setSkeletonDefinitionsMap(map = {}) {
  for (const key of Object.keys(skeletonDefinitions)) delete skeletonDefinitions[key];
  if (map && typeof map === 'object') {
    for (const [name, defRaw] of Object.entries(map)) {
      const def = normalizeSkeletonDefinition(defRaw);
      if (!def.bones.length) continue;
      skeletonDefinitions[name] = def;
    }
  }
}

function createHumanoidSkeleton(name = 'Humanoid') {
  const def = createDefaultSkeletonDefinition(name);
  // Blender-style: each bone is defined by head and tail world positions
  const b = (id, nm, parent, head, tail, connected = true) => ({
    id, name: nm, parent, connected, head, tail, roll: 0,
  });
  def.bones = [
    b('root',        'Root',        null,        [0,   0,    0],     [0,   0.2,   0],    false),
    b('spine',       'Spine',       'root',      [0,   0.2,  0],     [0,   0.45,  0]),
    b('chest',       'Chest',       'spine',     [0,   0.45, 0],     [0,   0.7,   0]),
    b('neck',        'Neck',        'chest',     [0,   0.7,  0],     [0,   0.8,   0]),
    b('head',        'Head',        'neck',      [0,   0.8,  0],     [0,   1.0,   0]),
    b('shoulderL',   'Shoulder L',  'chest',     [-0.08, 0.65, 0],   [-0.18, 0.65, 0],   false),
    b('upperArmL',   'Upper Arm L', 'shoulderL', [-0.18, 0.65, 0],   [-0.43, 0.65, 0]),
    b('lowerArmL',   'Lower Arm L', 'upperArmL', [-0.43, 0.65, 0],   [-0.65, 0.65, 0]),
    b('handL',       'Hand L',      'lowerArmL', [-0.65, 0.65, 0],   [-0.75, 0.65, 0]),
    b('shoulderR',   'Shoulder R',  'chest',     [0.08,  0.65, 0],   [0.18,  0.65, 0],   false),
    b('upperArmR',   'Upper Arm R', 'shoulderR', [0.18,  0.65, 0],   [0.43,  0.65, 0]),
    b('lowerArmR',   'Lower Arm R', 'upperArmR', [0.43,  0.65, 0],   [0.65,  0.65, 0]),
    b('handR',       'Hand R',      'lowerArmR', [0.65,  0.65, 0],   [0.75,  0.65, 0]),
    b('hipL',        'Hip L',       'root',      [-0.1,  0,    0],   [-0.1, -0.05, 0],    false),
    b('upperLegL',   'Upper Leg L', 'hipL',      [-0.1, -0.05, 0],   [-0.1, -0.35, 0]),
    b('lowerLegL',   'Lower Leg L', 'upperLegL', [-0.1, -0.35, 0],   [-0.1, -0.63, 0]),
    b('footL',       'Foot L',      'lowerLegL', [-0.1, -0.63, 0],   [-0.1, -0.63, 0.12]),
    b('hipR',        'Hip R',       'root',      [0.1,  0,    0],   [0.1, -0.05, 0],     false),
    b('upperLegR',   'Upper Leg R', 'hipR',      [0.1, -0.05, 0],   [0.1, -0.35, 0]),
    b('lowerLegR',   'Lower Leg R', 'upperLegR', [0.1, -0.35, 0],   [0.1, -0.63, 0]),
    b('footR',       'Foot R',      'lowerLegR', [0.1, -0.63, 0],   [0.1, -0.63, 0.12]),
  ];
  // T-Pose: all identity deltas (no rotation from rest)
  const tPose = {};
  for (const bone of def.bones) tPose[bone.id] = [0, 0, 0, 1];
  def.poses['T-Pose'] = tPose;
  return def;
}

// ─── Blender-style bone rest matrix computation ──────────────────────────────

/**
 * Compute the world-space rest matrix for a bone from head/tail/roll.
 * Local Y axis = head→tail (bone direction).
 * Roll rotates around Y axis.
 * Returns a THREE.Matrix4.
 */
function _computeBoneRestMatrix(head, tail, roll) {
  const hv = new THREE.Vector3(head[0], head[1], head[2]);
  const tv = new THREE.Vector3(tail[0], tail[1], tail[2]);
  const dir = new THREE.Vector3().subVectors(tv, hv);
  const len = dir.length();
  if (len < 1e-10) {
    return new THREE.Matrix4().makeTranslation(hv.x, hv.y, hv.z);
  }
  dir.normalize();

  // Y axis = bone direction (head→tail)
  const yAxis = dir.clone();

  // Choose a reference vector that isn't parallel to yAxis
  const ref = Math.abs(yAxis.y) < 0.999
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, 0, 1);

  // X axis = perpendicular to Y
  const xAxis = new THREE.Vector3().crossVectors(yAxis, ref).normalize();
  // Z axis = perpendicular to both
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();

  // Apply roll around the bone (Y) axis
  if (roll !== 0) {
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(yAxis, roll);
    xAxis.applyQuaternion(rollQuat);
    zAxis.applyQuaternion(rollQuat);
  }

  const m = new THREE.Matrix4();
  m.makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(hv);
  return m;
}

// ─── THREE.js skeleton builder (Blender-style head/tail) ─────────────────────
function buildThreeBonesFromDef(def) {
  if (!def?.bones?.length) return null;

  const boneMap = new Map();
  const restWorldMatrices = new Map();
  const restLocalQuats = new Map(); // for pose system: bone rest quaternion in local space

  // Compute world-space rest matrix for each bone
  for (const bd of def.bones) {
    const worldMat = _computeBoneRestMatrix(bd.head, bd.tail, bd.roll || 0);
    restWorldMatrices.set(bd.id, worldMat);
  }

  // Create THREE.Bone objects with proper local transforms
  const rootBones = [];
  for (const bd of def.bones) {
    const bone = new THREE.Bone();
    bone.name = bd.id;

    const worldMat = restWorldMatrices.get(bd.id);

    if (bd.parent && restWorldMatrices.has(bd.parent)) {
      // Child bone: local transform = inverse(parent_world) * this_world
      const parentWorldInv = restWorldMatrices.get(bd.parent).clone().invert();
      const localMat = parentWorldInv.clone().multiply(worldMat);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      localMat.decompose(pos, quat, scl);
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
    } else {
      // Root bone: local = world
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      worldMat.decompose(pos, quat, scl);
      bone.position.copy(pos);
      bone.quaternion.copy(quat);
    }

    // Store rest quaternion for pose delta system
    restLocalQuats.set(bd.id, bone.quaternion.clone());

    bone.userData._boneDefId = bd.id;
    bone.userData._boneLength = boneLength(bd);
    boneMap.set(bd.id, bone);
  }

  // Set up parent-child hierarchy
  for (const bd of def.bones) {
    const bone = boneMap.get(bd.id);
    if (bd.parent && boneMap.has(bd.parent)) {
      boneMap.get(bd.parent).add(bone);
    } else {
      rootBones.push(bone);
    }
  }

  // Build skeleton
  const allBones = [];
  const rootGroup = new THREE.Group();
  for (const root of rootBones) rootGroup.add(root);
  rootGroup.traverse(obj => { if (obj.isBone) allBones.push(obj); });
  const skeleton = new THREE.Skeleton(allBones);
  return { skeleton, rootGroup, boneMap, allBones, restLocalQuats };
}

function applyPoseToSkeleton(boneMap, pose, restLocalQuats) {
  if (!boneMap) return;
  for (const [boneId, bone] of boneMap) {
    const restQ = restLocalQuats?.get(boneId);
    if (!restQ) continue;
    const delta = pose?.[boneId];
    if (delta && Array.isArray(delta) && delta.length >= 4) {
      // Pose delta: final = rest * delta
      const dq = new THREE.Quaternion(delta[0], delta[1], delta[2], delta[3]);
      bone.quaternion.copy(restQ).multiply(dq);
    } else {
      // No pose data: use rest orientation
      bone.quaternion.copy(restQ);
    }
  }
}

function capturePoseFromSkeleton(boneMap, restLocalQuats) {
  const pose = {};
  for (const [boneId, bone] of boneMap) {
    const restQ = restLocalQuats?.get(boneId);
    if (restQ) {
      // Delta = inverse(rest) * current
      const delta = restQ.clone().invert().multiply(bone.quaternion.clone());
      pose[boneId] = delta.toArray();
    } else {
      pose[boneId] = bone.quaternion.toArray();
    }
  }
  return pose;
}

function interpolatePoses(poseA, poseB, t, boneIds) {
  const result = {};
  const _qa = new THREE.Quaternion();
  const _qb = new THREE.Quaternion();
  for (const id of boneIds) {
    const a = poseA?.[id] || [0, 0, 0, 1];
    const b = poseB?.[id] || [0, 0, 0, 1];
    _qa.set(a[0], a[1], a[2], a[3]);
    _qb.set(b[0], b[1], b[2], b[3]);
    _qa.slerp(_qb, t);
    result[id] = _qa.toArray();
  }
  return result;
}

function evaluateAnimationAtTime(animDef, time, boneIds) {
  if (!animDef?.keyframes?.length) return null;
  const kfs = animDef.keyframes;
  if (kfs.length === 1) return kfs[0].bones;
  // Clamp or loop time
  const dur = animDef.duration || 1;
  let t = animDef.loop ? ((time % dur) + dur) % dur : Math.min(time, dur);
  // Find surrounding keyframes
  let prev = kfs[0], next = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t >= kfs[i].time && t <= kfs[i + 1].time) {
      prev = kfs[i];
      next = kfs[i + 1];
      break;
    }
  }
  if (prev === next) return prev.bones;
  const segDur = next.time - prev.time;
  const segT = segDur > 0 ? (t - prev.time) / segDur : 0;
  return interpolatePoses(prev.bones, next.bones, segT, boneIds);
}

// ─── FBX Import helpers ──────────────────────────────────────────────────────
const _MIXAMO_BONE_MAP = {
  // Mixamo naming (with and without colon, with and without "rig")
  'hips': 'root', 'pelvis': 'root',
  'spine': 'spine', 'spine1': 'chest', 'spine2': 'chest', 'chest': 'chest',
  'neck': 'neck', 'head': 'head',
  'leftshoulder': 'shoulderL', 'righthoulder': 'shoulderR',
  'leftshoulder': 'shoulderL', 'rightshoulder': 'shoulderR',
  'leftarm': 'upperArmL', 'rightarm': 'upperArmR',
  'leftforearm': 'lowerArmL', 'rightforearm': 'lowerArmR',
  'lefthand': 'handL', 'righthand': 'handR',
  'leftupleg': 'upperLegL', 'rightupleg': 'upperLegR',
  'leftthigh': 'upperLegL', 'rightthigh': 'upperLegR',
  'leftleg': 'lowerLegL', 'rightleg': 'lowerLegR',
  'leftshin': 'lowerLegL', 'rightshin': 'lowerLegR',
  'leftfoot': 'footL', 'rightfoot': 'footR',
  'lefthip': 'hipL', 'righthip': 'hipR',
  'lefttoebase': 'footL', 'righttoebase': 'footR',
};

function _normalizeBoneName(name) {
  // Strip common prefixes, collapse whitespace/underscores, lowercase
  return name
    .replace(/^mixamorig[:\s]*/i, '')  // "mixamorig:Hips" -> "Hips", "mixamorigHips" -> "Hips"
    .replace(/^Armature[\|\/]/i, '')    // "Armature|Hips" -> "Hips"
    .toLowerCase()
    .replace(/[\s_:]+/g, '');
}

function _mapFBXBoneName(fbxName, defBoneIds) {
  // Direct match
  if (defBoneIds.has(fbxName)) return fbxName;

  const normalized = _normalizeBoneName(fbxName);

  // Try mapping table
  const mapped = _MIXAMO_BONE_MAP[normalized];
  if (mapped && defBoneIds.has(mapped)) return mapped;

  // Fuzzy match against skeleton bone IDs
  for (const id of defBoneIds) {
    const idNorm = _normalizeBoneName(id);
    if (idNorm === normalized) return id;
  }
  // Substring match (e.g. "leftupleg" contains "upperleg" or vice versa)
  for (const id of defBoneIds) {
    const idNorm = _normalizeBoneName(id);
    if (normalized.includes(idNorm) || idNorm.includes(normalized)) return id;
  }
  return null;
}

async function importFBXAnimationToDefinition(arrayBuffer, def) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  const fbx = loader.parse(arrayBuffer, '');
  fbx.updateMatrixWorld(true);

  const defBoneIds = new Set(def.bones.map(b => b.id));
  const clips = fbx.animations || [];
  if (!clips.length) throw new Error('No animation clips found in FBX file.');

  // Log all track names for debugging
  console.log('[FBX Import] Found', clips.length, 'clip(s). Tracks:');
  for (const clip of clips) {
    for (const track of clip.tracks) {
      console.log('  Track:', track.name, '| Values:', track.values.length, '| Times:', track.times.length);
    }
  }

  // ─── Build FBX bone hierarchy mapping ──────────────────────────────────────
  // Map ALL FBX bones by name for hierarchy evaluation
  const fbxBonesByName = new Map();
  // Map Flame3D bone IDs to FBX bone objects
  const fbxBoneByFlameId = new Map();
  fbx.traverse(obj => {
    if (obj.isBone || obj.type === 'Bone') {
      fbxBonesByName.set(obj.name, obj);
      const mapped = _mapFBXBoneName(obj.name, defBoneIds);
      if (mapped && !fbxBoneByFlameId.has(mapped)) {
        fbxBoneByFlameId.set(mapped, obj);
      }
    }
  });

  // Extract FBX bind-pose world quaternions (before any animation changes)
  const fbxBindWorldQuats = new Map();
  for (const [flameId, fbxBone] of fbxBoneByFlameId) {
    const q = new THREE.Quaternion();
    fbxBone.getWorldQuaternion(q);
    fbxBindWorldQuats.set(flameId, q);
  }
  // Save bind-pose local quaternions for all FBX bones (to restore later)
  const savedBindQuats = new Map();
  for (const [name, bone] of fbxBonesByName) {
    savedBindQuats.set(name, bone.quaternion.clone());
  }

  // Store bind world quats in definition (needed for mesh skin correction at render time)
  if (!def.boneBindWorldQuats) def.boneBindWorldQuats = {};
  for (const [flameId, q] of fbxBindWorldQuats) {
    def.boneBindWorldQuats[flameId] = q.toArray();
  }

  const importedClips = [];
  for (const clip of clips) {
    // ─── Collect ALL quaternion tracks (mapped + unmapped) for full hierarchy eval
    // Map: fbxBoneName -> entries[]
    const allFBXQuatTracks = new Map();
    // Map: flameId -> entries[]  (mapped bones only)
    const boneQuatTracks = new Map();
    const unmappedBones = new Set();

    for (const track of clip.tracks) {
      const dotIdx = track.name.lastIndexOf('.');
      if (dotIdx < 0) continue;
      const fbxBoneName = track.name.slice(0, dotIdx);
      const property = track.name.slice(dotIdx + 1);

      let entries = null;
      if (property === 'quaternion') {
        entries = [];
        for (let i = 0; i < track.times.length; i++) {
          entries.push({
            time: track.times[i],
            quat: [track.values[i * 4], track.values[i * 4 + 1], track.values[i * 4 + 2], track.values[i * 4 + 3]],
          });
        }
      } else if (property === 'rotation' && track.values.length === track.times.length * 3) {
        entries = [];
        const _euler = new THREE.Euler();
        const _quat = new THREE.Quaternion();
        for (let i = 0; i < track.times.length; i++) {
          _euler.set(track.values[i * 3], track.values[i * 3 + 1], track.values[i * 3 + 2]);
          _quat.setFromEuler(_euler);
          entries.push({ time: track.times[i], quat: _quat.toArray() });
        }
      }
      if (!entries) continue;

      // Store track for ALL FBX bones (for hierarchy evaluation)
      if (!allFBXQuatTracks.has(fbxBoneName)) {
        allFBXQuatTracks.set(fbxBoneName, entries);
      }

      // Also track mapped bones separately
      const boneId = _mapFBXBoneName(fbxBoneName, defBoneIds);
      if (boneId) {
        if (!boneQuatTracks.has(boneId)) {
          boneQuatTracks.set(boneId, entries);
        }
      } else {
        unmappedBones.add(fbxBoneName);
      }
    }

    if (unmappedBones.size) {
      console.warn('[FBX Import] Unmapped bones:', Array.from(unmappedBones).join(', '));
    }
    console.log('[FBX Import] Mapped bones:', Array.from(boneQuatTracks.keys()).join(', '));

    if (!boneQuatTracks.size) continue;

    // Gather all unique times across mapped bone tracks
    const allTimesSet = new Set();
    for (const entries of boneQuatTracks.values()) {
      for (const e of entries) allTimesSet.add(Math.round(e.time * 1000) / 1000);
    }
    let allTimes = Array.from(allTimesSet).sort((a, b) => a - b);

    // Reduce keyframe density if too many
    if (allTimes.length > 120) {
      const step = Math.ceil(allTimes.length / 120);
      allTimes = allTimes.filter((_, i) => i % step === 0 || i === allTimes.length - 1);
    }

    // ─── Helper: set all FBX bones to their animated quaternions at time t
    function _setFBXHierarchyToTime(time) {
      for (const [fbxBoneName, entries] of allFBXQuatTracks) {
        const bone = fbxBonesByName.get(fbxBoneName);
        if (!bone) continue;
        const q = _sampleQuatTrack(entries, time);
        bone.quaternion.set(q[0], q[1], q[2], q[3]);
      }
      // Bones without animation tracks keep their bind-pose quaternion (already set)
      fbx.updateMatrixWorld(true);
    }

    // ─── Build retargeted keyframes ──────────────────────────────────────────
    // For each time: evaluate full FBX hierarchy, compute retargeted local quats
    // Retarget formula: L_retarget(B) = W_P_bind * inv(W_P_anim) * W_B_anim * inv(W_B_bind)
    // where W_P = FBX bone mapped to Flame3D PARENT of B
    const keyframes = allTimes.map(time => {
      _setFBXHierarchyToTime(time);

      const bones = {};
      for (const [flameId] of boneQuatTracks) {
        const fbxBone = fbxBoneByFlameId.get(flameId);
        if (!fbxBone) continue;

        // Get this bone's animated world quaternion
        const W_B_anim = new THREE.Quaternion();
        fbxBone.getWorldQuaternion(W_B_anim);
        const W_B_bind = fbxBindWorldQuats.get(flameId);

        // Find the Flame3D parent's FBX bone for retargeting
        const flameBoneDef = def.bones.find(b => b.id === flameId);
        const flameParentId = flameBoneDef?.parent;
        const fbxParentBone = flameParentId ? fbxBoneByFlameId.get(flameParentId) : null;

        let L_retarget;
        if (fbxParentBone && fbxBindWorldQuats.has(flameParentId)) {
          // Non-root: L = W_P_bind * inv(W_P_anim) * W_B_anim * inv(W_B_bind)
          const W_P_anim = new THREE.Quaternion();
          fbxParentBone.getWorldQuaternion(W_P_anim);
          const W_P_bind = fbxBindWorldQuats.get(flameParentId);

          L_retarget = new THREE.Quaternion()
            .copy(W_P_bind)
            .multiply(W_P_anim.clone().invert())
            .multiply(W_B_anim)
            .multiply(W_B_bind.clone().invert());
        } else {
          // Root bone (or parent unmapped): L = W_B_anim * inv(W_B_bind)
          L_retarget = new THREE.Quaternion()
            .copy(W_B_anim)
            .multiply(W_B_bind.clone().invert());
        }

        bones[flameId] = L_retarget.toArray();
      }
      return { time, bones };
    });

    // Restore FBX bones to bind pose
    for (const [name, q] of savedBindQuats) {
      const bone = fbxBonesByName.get(name);
      if (bone) bone.quaternion.copy(q);
    }
    fbx.updateMatrixWorld(true);

    const duration = clip.duration || allTimes[allTimes.length - 1] || 1;
    importedClips.push({
      name: clip.name || 'Imported_' + (importedClips.length + 1),
      clip: { duration, loop: true, keyframes },
      mappedBones: boneQuatTracks.size,
      totalKeyframes: keyframes.length,
    });
  }
  if (!importedClips.length) {
    throw new Error(
      'No matching bone animations found.\n' +
      'Your skeleton bones: ' + Array.from(defBoneIds).join(', ') + '\n' +
      'Tip: Load the 🦴 Humanoid template first, then import the FBX.'
    );
  }
  return importedClips;
}

/** Sample a quaternion value from a track at a given time via SLERP interpolation */
function _sampleQuatTrack(entries, time) {
  if (!entries.length) return [0, 0, 0, 1];
  if (entries.length === 1) return [...entries[0].quat];
  // Before first
  if (time <= entries[0].time) return [...entries[0].quat];
  // After last
  if (time >= entries[entries.length - 1].time) return [...entries[entries.length - 1].quat];
  // Find surrounding entries
  for (let i = 0; i < entries.length - 1; i++) {
    if (time >= entries[i].time && time <= entries[i + 1].time) {
      const segDur = entries[i + 1].time - entries[i].time;
      const t = segDur > 0 ? (time - entries[i].time) / segDur : 0;
      const _qa = new THREE.Quaternion().fromArray(entries[i].quat);
      const _qb = new THREE.Quaternion().fromArray(entries[i + 1].quat);
      _qa.slerp(_qb, t);
      return _qa.toArray();
    }
  }
  return [...entries[entries.length - 1].quat];
}

// ─── FBX Skin (mesh) Import ──────────────────────────────────────────────────
// Stores actual mesh triangles per bone for proper full-body skins.
// Data: { type:'mesh', vertices:[x,y,z,...], indices:[i0,i1,i2,...], colors:[r,g,b,...] }
// Vertices in bone-local space, uniformly scaled to Flame3D proportions.
async function importFBXSkinToDefinition(arrayBuffer, def) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const loader = new FBXLoader();
  const fbx = loader.parse(arrayBuffer, '');
  fbx.updateMatrixWorld(true);

  const defBoneIds = new Set(def.bones.map(b => b.id));
  if (!defBoneIds.size) throw new Error('No bones in skeleton definition. Load a template first.');

  // Build Flame3D rest-pose skeleton for height measurement
  const restResult = buildThreeBonesFromDef(def);
  if (!restResult) throw new Error('Failed to build rest-pose skeleton.');
  restResult.rootGroup.updateMatrixWorld(true);

  // Build FBX bone name → Flame3D bone ID mapping
  const fbxBoneNameToId = new Map();
  const fbxBoneByFlameId = new Map();
  fbx.traverse(obj => {
    if (obj.isBone || obj.type === 'Bone') {
      const mapped = _mapFBXBoneName(obj.name, defBoneIds);
      if (mapped) {
        fbxBoneNameToId.set(obj.name, mapped);
        if (!fbxBoneByFlameId.has(mapped)) fbxBoneByFlameId.set(mapped, obj);
      }
    }
  });
  console.log('[FBX Skin] Bone mapping:', Object.fromEntries(fbxBoneNameToId));

  // Store FBX bind-pose world quaternions for mesh skin correction at render time
  if (!def.boneBindWorldQuats) def.boneBindWorldQuats = {};
  for (const [flameId, fbxBone] of fbxBoneByFlameId) {
    const q = new THREE.Quaternion();
    fbxBone.getWorldQuaternion(q);
    def.boneBindWorldQuats[flameId] = q.toArray();
  }

  // Compute global scale factor: Flame3D height / FBX height
  const _tmpV = new THREE.Vector3();
  let fbxMinY = Infinity, fbxMaxY = -Infinity;
  for (const fbxBone of fbxBoneByFlameId.values()) {
    fbxBone.getWorldPosition(_tmpV);
    fbxMinY = Math.min(fbxMinY, _tmpV.y);
    fbxMaxY = Math.max(fbxMaxY, _tmpV.y);
  }
  let flameMinY = Infinity, flameMaxY = -Infinity;
  for (const bd of def.bones) {
    const tb = restResult.boneMap.get(bd.id);
    if (!tb) continue;
    tb.getWorldPosition(_tmpV);
    flameMinY = Math.min(flameMinY, _tmpV.y);
    flameMaxY = Math.max(flameMaxY, _tmpV.y);
  }
  const fbxHeight = Math.max(fbxMaxY - fbxMinY, 0.01);
  const flameHeight = Math.max(flameMaxY - flameMinY, 0.01);
  const uniformScale = flameHeight / fbxHeight;
  console.log(`[FBX Skin] Scale: Flame3D ${flameHeight.toFixed(3)} / FBX ${fbxHeight.toFixed(1)} = ${uniformScale.toFixed(6)}`);

  // Collect meshes
  const meshes = [];
  fbx.traverse(obj => {
    if ((obj.isSkinnedMesh || obj.isMesh) && obj.geometry?.attributes?.position) {
      meshes.push(obj);
    }
  });
  if (!meshes.length) throw new Error('No meshes found in FBX file.');

  // Per-bone geometry accumulator
  const boneGeo = new Map();
  for (const id of defBoneIds) boneGeo.set(id, { vertMap: new Map(), verts: [], colors: [], faces: [] });

  let totalVerts = 0, assignedVerts = 0;
  const _pos = new THREE.Vector3();
  const _offset = new THREE.Vector3();
  const _bonePos = new THREE.Vector3();
  const _boneQuatInv = new THREE.Quaternion();

  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const vertCount = posAttr.count;
    totalVerts += vertCount;

    // Texture sampling setup
    const uvAttr = geo.attributes.uv || null;
    const colorAttr = geo.attributes.color || null;
    let texCtx = null, texW = 0, texH = 0;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (mat?.map?.image) {
      try {
        const img = mat.map.image;
        texW = img.width || img.naturalWidth || 64;
        texH = img.height || img.naturalHeight || 64;
        const cnv = document.createElement('canvas');
        cnv.width = texW; cnv.height = texH;
        texCtx = cnv.getContext('2d', { willReadFrequently: true });
        texCtx.drawImage(img, 0, 0, texW, texH);
      } catch { texCtx = null; }
    }
    let matColor = [127, 142, 160];
    if (mat?.color) {
      const c = mat.color;
      matColor = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
    }

    // Skin weight data
    const skinIdxAttr = geo.attributes.skinIndex;
    const skinWtAttr = geo.attributes.skinWeight;
    const hasSkinning = mesh.isSkinnedMesh && skinIdxAttr && skinWtAttr && mesh.skeleton;
    const fbxIdxToBoneId = new Map();
    const fbxIdxToFbxBone = new Map();
    if (hasSkinning) {
      for (let i = 0; i < mesh.skeleton.bones.length; i++) {
        const fbxBone = mesh.skeleton.bones[i];
        const mapped = fbxBoneNameToId.get(fbxBone.name);
        if (mapped) { fbxIdxToBoneId.set(i, mapped); fbxIdxToFbxBone.set(i, fbxBone); }
      }
    }

    // Helper: get color at vertex index
    function _sampleColor(vi) {
      let r = matColor[0], g = matColor[1], b = matColor[2];
      if (texCtx && uvAttr) {
        const u = uvAttr.getX(vi), v = uvAttr.getY(vi);
        const px = THREE.MathUtils.clamp(Math.floor(((u % 1) + 1) % 1 * texW), 0, texW - 1);
        const py = THREE.MathUtils.clamp(Math.floor((1 - ((v % 1) + 1) % 1) * texH), 0, texH - 1);
        const pixel = texCtx.getImageData(px, py, 1, 1).data;
        r = pixel[0]; g = pixel[1]; b = pixel[2];
      } else if (colorAttr) {
        r = Math.round(colorAttr.getX(vi) * 255);
        g = Math.round(colorAttr.getY(vi) * 255);
        b = Math.round(colorAttr.getZ(vi) * 255);
      }
      return [r, g, b];
    }

    // Helper: ensure a vertex exists in a bone's buffer, return local index
    function _ensureVert(boneId, origIdx) {
      const bg = boneGeo.get(boneId);
      const key = `${mesh.uuid}_${origIdx}`;
      if (bg.vertMap.has(key)) return bg.vertMap.get(key);
      // Compute bone-local position
      _pos.set(posAttr.getX(origIdx), posAttr.getY(origIdx), posAttr.getZ(origIdx));
      _pos.applyMatrix4(mesh.matrixWorld);
      const fbxBone = fbxBoneByFlameId.get(boneId);
      if (!fbxBone) return 0;
      fbxBone.getWorldPosition(_bonePos);
      fbxBone.getWorldQuaternion(_boneQuatInv);
      _boneQuatInv.invert();
      _offset.copy(_pos).sub(_bonePos).applyQuaternion(_boneQuatInv).multiplyScalar(uniformScale);
      const localIdx = bg.verts.length / 3;
      bg.vertMap.set(key, localIdx);
      bg.verts.push(_offset.x, _offset.y, _offset.z);
      const [r, g, b] = _sampleColor(origIdx);
      bg.colors.push(r, g, b);
      return localIdx;
    }

    // Assign each vertex to its best bone
    const vertBoneAssign = new Array(vertCount).fill(null);
    for (let vi = 0; vi < vertCount; vi++) {
      _pos.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi));
      _pos.applyMatrix4(mesh.matrixWorld);
      let bestBoneId = null, bestWeight = 0;
      if (hasSkinning) {
        let bestIdx = -1;
        for (let w = 0; w < 4; w++) {
          const boneIdx = skinIdxAttr.getComponent(vi, w);
          const weight = skinWtAttr.getComponent(vi, w);
          if (weight > bestWeight && fbxIdxToBoneId.has(boneIdx)) { bestIdx = boneIdx; bestWeight = weight; }
        }
        if (bestIdx >= 0) bestBoneId = fbxIdxToBoneId.get(bestIdx);
      }
      if (!bestBoneId) {
        let minDist = Infinity;
        for (const [flameId, fbxBone] of fbxBoneByFlameId) {
          fbxBone.getWorldPosition(_bonePos);
          const d = _pos.distanceTo(_bonePos);
          if (d < minDist) { minDist = d; bestBoneId = flameId; }
        }
      }
      if (!bestBoneId) continue;
      assignedVerts++;
      vertBoneAssign[vi] = bestBoneId;
      _ensureVert(bestBoneId, vi);
    }

    // Collect triangles — assign each face to majority-vote bone
    const index = geo.index;
    if (index) {
      for (let fi = 0; fi < index.count; fi += 3) {
        const a = index.getX(fi), b = index.getX(fi + 1), c = index.getX(fi + 2);
        const bA = vertBoneAssign[a], bB = vertBoneAssign[b], bC = vertBoneAssign[c];
        if (!bA && !bB && !bC) continue;
        const faceBone = (bA === bB || bA === bC) ? bA : (bB === bC) ? bB : (bA || bB || bC);
        if (!faceBone || !boneGeo.has(faceBone)) continue;
        const iA = _ensureVert(faceBone, a);
        const iB = _ensureVert(faceBone, b);
        const iC = _ensureVert(faceBone, c);
        boneGeo.get(faceBone).faces.push(iA, iB, iC);
      }
    } else {
      for (let fi = 0; fi < vertCount; fi += 3) {
        const bA = vertBoneAssign[fi], bB = vertBoneAssign[fi+1], bC = vertBoneAssign[fi+2];
        const faceBone = (bA === bB || bA === bC) ? bA : (bB === bC) ? bB : (bA || bB || bC);
        if (!faceBone || !boneGeo.has(faceBone)) continue;
        const iA = _ensureVert(faceBone, fi);
        const iB = _ensureVert(faceBone, fi+1);
        const iC = _ensureVert(faceBone, fi+2);
        boneGeo.get(faceBone).faces.push(iA, iB, iC);
      }
    }
  }

  // Write mesh skins into def.boneSkins
  let bonesWithSkin = 0, totalTris = 0;
  for (const [boneId, bg] of boneGeo) {
    if (!bg.faces.length || !bg.verts.length) continue;
    def.boneSkins[boneId] = {
      type: 'mesh',
      vertices: bg.verts,
      indices: bg.faces,
      colors: bg.colors,
    };
    bonesWithSkin++;
    totalTris += bg.faces.length / 3;
  }
  console.log(`[FBX Skin] ${totalVerts} verts, ${assignedVerts} assigned, ${bonesWithSkin} bones, ${totalTris} tris`);
  return { bonesWithSkin, totalTris, totalVerts, assignedVerts };
}

// ─── Humanoid mirror pairs ───────────────────────────────────────────────────
const _MIRROR_BONE_PAIRS = [
  ['shoulderL', 'shoulderR'], ['upperArmL', 'upperArmR'], ['lowerArmL', 'lowerArmR'], ['handL', 'handR'],
  ['hipL', 'hipR'], ['upperLegL', 'upperLegR'], ['lowerLegL', 'lowerLegR'], ['footL', 'footR'],
];

function mirrorPose(pose) {
  const mirrored = {};
  for (const [id, q] of Object.entries(pose)) {
    mirrored[id] = [...q];
  }
  for (const [l, r] of _MIRROR_BONE_PAIRS) {
    const lq = pose[l], rq = pose[r];
    if (lq) mirrored[r] = [lq[0], -lq[1], -lq[2], lq[3]];
    if (rq) mirrored[l] = [rq[0], -rq[1], -rq[2], rq[3]];
  }
  // Mirror center bones (flip Y and Z rotation)
  for (const id of Object.keys(pose)) {
    if (!_MIRROR_BONE_PAIRS.flat().includes(id) && mirrored[id]) {
      const q = pose[id];
      mirrored[id] = [-q[0], q[1], q[2], -q[3]]; // negate X and W for X-axis mirror
    }
  }
  return mirrored;
}

function createDefaultCheckpointConfig() {
  return {
    interaction: 'touch',
  };
}

const PATH_FRONT_AXES = ['+Z', '-Z', '+X', '-X'];
const CHECKPOINT_MOVE_STYLES = ['glide', 'snap', 'strict'];

function createDefaultMovementPathConfig() {
  return {
    enabled: false,
    speed: 2,
    loop: true,
    frontAxis: '-Z',
    checkpoints: [],
  };
}

function normalizeMovementPathCheckpoint(checkpoint = {}) {
  const pos = Array.isArray(checkpoint.pos) ? checkpoint.pos : [0, 0, 0];
  return {
    pos: [0, 1, 2].map(i => Number.isFinite(parseFloat(pos[i])) ? parseFloat(pos[i]) : 0),
    functionName: String(checkpoint.functionName ?? '').trim(),
    faceDirection: checkpoint.faceDirection === true,
    waitDuration: Math.max(0, Number.isFinite(parseFloat(checkpoint.waitDuration)) ? parseFloat(checkpoint.waitDuration) : 0),
    moveStyle: CHECKPOINT_MOVE_STYLES.includes(checkpoint.moveStyle) ? checkpoint.moveStyle : 'glide',
    speed: Math.max(0, Number.isFinite(parseFloat(checkpoint.speed)) ? parseFloat(checkpoint.speed) : 0),
    pauseOnArrival: checkpoint.pauseOnArrival === true,
  };
}

function normalizeMovementPathConfig(config = {}) {
  const base = createDefaultMovementPathConfig();
  const checkpoints = Array.isArray(config.checkpoints)
    ? config.checkpoints.map(normalizeMovementPathCheckpoint)
    : [];
  const frontAxis = PATH_FRONT_AXES.includes(config.frontAxis) ? config.frontAxis : base.frontAxis;
  return {
    enabled: config.enabled === true,
    speed: Math.max(0.01, Number.isFinite(parseFloat(config.speed)) ? parseFloat(config.speed) : base.speed),
    loop: config.loop !== false,
    frontAxis,
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

function normalizeTeleportConfig(config = {}) {
  return {
    pairLabel: String(config.pairLabel ?? '').trim(),
    crossWorld: config.crossWorld === true,
    targetWorld: String(config.targetWorld ?? '').trim(),
  };
}

function getMeshTeleportConfig(mesh) {
  const config = normalizeTeleportConfig(mesh?.userData?.teleportConfig);
  if (mesh?.userData) mesh.userData.teleportConfig = config;
  return config;
}

// ─── Text Block Config ───────────────────────────────────────────────────────
function normalizeTextConfig(config = {}) {
  return {
    content: String(config.content ?? 'Hello World'),
    fontSize: Math.max(8, Math.min(200, parseInt(config.fontSize, 10) || 48)),
    fontFamily: String(config.fontFamily ?? 'Arial'),
    textColor: String(config.textColor ?? '#ffffff'),
    bgColor: String(config.bgColor ?? 'transparent'),
    align: ['left','center','right'].includes(config.align) ? config.align : 'center',
    bold: !!config.bold,
    italic: !!config.italic,
  };
}

async function _registerCustomFont(entry) {
  try {
    const face = new FontFace(entry.name, `url(${entry.dataUrl})`);
    await face.load();
    document.fonts.add(face);
  } catch (e) { console.warn('Failed to load custom font:', entry.name, e); }
}

function _getAvailableFontNames() {
  const system = ['Arial','Georgia','Times New Roman','Courier New','Verdana','Impact','Comic Sans MS','Trebuchet MS','Palatino','Garamond'];
  const custom = customFonts.map(f => f.name);
  return [...custom, ...system];
}

function _applyTextTexture(mesh) {
  const tc = mesh.userData.textConfig;
  if (!tc) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = tc.fontSize;
  const fontStr = (tc.italic ? 'italic ' : '') + (tc.bold ? 'bold ' : '') + fontSize + 'px ' + tc.fontFamily;
  ctx.font = fontStr;
  const lines = tc.content.split('\\n');
  const lineHeight = fontSize * 1.25;
  const maxWidth = Math.max(64, ...lines.map(l => ctx.measureText(l).width)) + fontSize;
  const totalHeight = Math.max(64, lines.length * lineHeight + fontSize * 0.5);
  canvas.width = Math.min(2048, Math.pow(2, Math.ceil(Math.log2(maxWidth))));
  canvas.height = Math.min(2048, Math.pow(2, Math.ceil(Math.log2(totalHeight))));
  if (tc.bgColor && tc.bgColor !== 'transparent') {
    ctx.fillStyle = tc.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.font = fontStr;
  ctx.fillStyle = tc.textColor;
  ctx.textBaseline = 'top';
  ctx.textAlign = tc.align;
  const alignX = tc.align === 'left' ? fontSize * 0.25 : tc.align === 'right' ? canvas.width - fontSize * 0.25 : canvas.width / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], alignX, fontSize * 0.25 + i * lineHeight);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  if (mesh.material.map) mesh.material.map.dispose();
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;
}

// ─── Screen/Media Config ─────────────────────────────────────────────────────
function normalizeScreenConfig(config = {}) {
  return {
    mediaType: ['image', 'color', 'video', 'url', 'html'].includes(config.mediaType) ? config.mediaType : 'color',
    imageData: config.imageData || null,
    videoData: config.videoData || null,
    url: String(config.url ?? ''),
    htmlContent: String(config.htmlContent ?? ''),
    screenColor: String(config.screenColor ?? '#222222'),
    interactive: !!config.interactive,
  };
}

function _applyScreenTexture(mesh) {
  const sc = mesh.userData.screenConfig;
  if (!sc) return;
  // Clean up previous video element
  if (mesh.userData._screenVideo) {
    mesh.userData._screenVideo.pause();
    mesh.userData._screenVideo.src = '';
    mesh.userData._screenVideo = null;
  }
  if (sc.mediaType === 'image' && sc.imageData) {
    const tex = new THREE.TextureLoader().load(sc.imageData);
    tex.minFilter = THREE.LinearFilter;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.color.setHex(0xffffff);
    mesh.material.needsUpdate = true;
  } else if (sc.mediaType === 'video' && sc.videoData) {
    const video = document.createElement('video');
    video.src = sc.videoData;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.play().catch(err => { console.warn('[Video] Autoplay blocked or failed:', err.message); });
    const tex = new THREE.VideoTexture(video);
    tex.minFilter = THREE.LinearFilter;
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.color.setHex(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.userData._screenVideo = video;
  } else if ((sc.mediaType === 'url' || sc.mediaType === 'html') && (sc.url || sc.htmlContent)) {
    // Render HTML/URL preview as a canvas snapshot
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 288;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (sc.mediaType === 'url') {
      ctx.fillText('🌐 ' + (sc.url.length > 35 ? sc.url.slice(0, 35) + '…' : sc.url), 256, 130);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#8888aa';
      ctx.fillText('Click to interact during playtest', 256, 160);
    } else {
      ctx.fillText('📄 HTML Content', 256, 130);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#8888aa';
      ctx.fillText(sc.htmlContent.length + ' chars — Click to interact', 256, 160);
    }
    const tex = new THREE.CanvasTexture(canvas);
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = tex;
    mesh.material.color.setHex(0xffffff);
    mesh.material.needsUpdate = true;
  } else {
    if (mesh.material.map) { mesh.material.map.dispose(); mesh.material.map = null; }
    mesh.material.color.set(sc.screenColor);
    mesh.material.needsUpdate = true;
  }
}

// ─── Camera Object Config ────────────────────────────────────────────────────
function normalizeCameraConfig(config = {}) {
  return {
    fov: Math.max(10, Math.min(150, parseFloat(config.fov) || 60)),
    near: Math.max(0.01, parseFloat(config.near) || 0.1),
    far: Math.max(1, parseFloat(config.far) || 1000),
  };
}

// ─── NPC Config ──────────────────────────────────────────────────────────────
const NPC_BEHAVIORS = ['idle', 'wander', 'patrol'];

function normalizeNpcConfig(config = {}) {
  return {
    displayName: String(config.displayName ?? 'NPC').trim(),
    behavior: NPC_BEHAVIORS.includes(config.behavior) ? config.behavior : 'idle',
    wanderRadius: Math.max(0.5, Math.min(50, parseFloat(config.wanderRadius) || 5)),
    interactDistance: Math.max(0.5, Math.min(20, parseFloat(config.interactDistance) || 3)),
    dialogueLines: Array.isArray(config.dialogueLines) ? config.dialogueLines.map(l => String(l)) : ['Hello there!'],
    skinColor: parseInt(config.skinColor) || 0xf0c8a0,
    shirtColor: parseInt(config.shirtColor) || 0x3a7bd5,
    pantsColor: parseInt(config.pantsColor) || 0x4a4a5a,
    walkSpeed: Math.max(0.1, Math.min(10, parseFloat(config.walkSpeed) || 1.5)),
    facePlayer: config.facePlayer !== false,
    idleAnimation: config.idleAnimation !== false,
  };
}

function _buildNpcHumanoid(config) {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: config.skinColor, roughness: 0.85 });
  const shirt = new THREE.MeshStandardMaterial({ color: config.shirtColor, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: config.pantsColor, roughness: 0.8 });

  // Head (sphere)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), skin);
  head.position.set(0, 1.525, 0);
  head.castShadow = true;
  head.receiveShadow = true;
  head.name = 'npc_head';
  group.add(head);

  // Body (box)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), shirt);
  body.position.set(0, 1.05, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = 'npc_body';
  group.add(body);

  // Left arm
  const lArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.2), shirt.clone());
  lArm.position.set(-0.34, 1.05, 0);
  lArm.castShadow = true;
  lArm.receiveShadow = true;
  lArm.name = 'npc_larm';
  group.add(lArm);

  // Right arm
  const rArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.2), shirt.clone());
  rArm.position.set(0.34, 1.05, 0);
  rArm.castShadow = true;
  rArm.receiveShadow = true;
  rArm.name = 'npc_rarm';
  group.add(rArm);

  // Left leg
  const lLeg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.25), pants);
  lLeg.position.set(-0.13, 0.475, 0);
  lLeg.castShadow = true;
  lLeg.receiveShadow = true;
  lLeg.name = 'npc_lleg';
  group.add(lLeg);

  // Right leg
  const rLeg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.25), pants.clone());
  rLeg.position.set(0.13, 0.475, 0);
  rLeg.castShadow = true;
  rLeg.receiveShadow = true;
  rLeg.name = 'npc_rleg';
  group.add(rLeg);

  // Nameplate (canvas texture) — shown in editor
  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 256;
  nameCanvas.height = 48;
  const nameCtx = nameCanvas.getContext('2d');
  nameCtx.fillStyle = 'rgba(0,0,0,0.5)';
  nameCtx.fillRect(0, 0, 256, 48);
  nameCtx.fillStyle = '#ffffff';
  nameCtx.font = 'bold 24px sans-serif';
  nameCtx.textAlign = 'center';
  nameCtx.textBaseline = 'middle';
  nameCtx.fillText(config.displayName.slice(0, 20), 128, 24);
  const nameTex = new THREE.CanvasTexture(nameCanvas);
  const namePlate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.22),
    new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthTest: false, side: THREE.DoubleSide })
  );
  namePlate.position.set(0, 1.95, 0);
  namePlate.renderOrder = 9999;
  namePlate.name = 'npc_nameplate';
  group.add(namePlate);

  return group;
}

function _applyNpcAppearance(mesh) {
  const config = mesh.userData.npcConfig;
  if (!config) return;
  // Remove existing humanoid group if any
  const existing = mesh.getObjectByName('npc_head');
  if (existing) {
    const humanoid = existing.parent;
    if (humanoid !== mesh) {
      mesh.remove(humanoid);
      humanoid.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
    }
  }
  const group = _buildNpcHumanoid(config);
  // Center: mesh's own geometry is just a thin invisible box for selection
  mesh.material.visible = false;
  mesh.add(group);
}

function _updateNpcNameplate(mesh) {
  const config = mesh.userData.npcConfig;
  if (!config) return;
  const plate = mesh.getObjectByName('npc_nameplate');
  if (!plate || !plate.material.map) return;
  const canvas = plate.material.map.image;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(config.displayName.slice(0, 20), 128, 24);
  plate.material.map.needsUpdate = true;
}

// ─── NPC Runtime State ───────────────────────────────────────────────────────
const _npcRuntimeStates = new Map(); // mesh.uuid -> { wanderTarget, wanderTimer, dialogueIndex, lastInteractTime }
let _npcDialogueActive = null; // { mesh, lineIndex } if dialogue is open
const _npcInteractCooldown = 0.5; // seconds between interactions

function _getNpcState(mesh) {
  if (_npcRuntimeStates.has(mesh.uuid)) return _npcRuntimeStates.get(mesh.uuid);
  const s = { wanderTarget: null, wanderTimer: 0, dialogueIndex: 0, originPos: mesh.position.clone(), walkPhase: 0, patrolIndex: 0 };
  _npcRuntimeStates.set(mesh.uuid, s);
  return s;
}

function _getPathForMesh(mesh) {
  const cfg = normalizeMovementPathConfig(mesh?.userData?.movementPath);
  if (!cfg.checkpoints || !cfg.checkpoints.length) return null;
  return cfg.checkpoints.map(cp => new THREE.Vector3(cp.pos[0], cp.pos[1], cp.pos[2]));
}

function updateNpcBehaviors(dt, time) {
  for (const m of sceneObjects) {
    if (m.userData.type !== 'npc') continue;
    const cfg = normalizeNpcConfig(m.userData.npcConfig);
    const st = _getNpcState(m);
    const group = m.getObjectByName('npc_head')?.parent;
    let isWalking = false;
    // Face player
    if (cfg.facePlayer) {
      const dx = fpsPos.x - m.position.x;
      const dz = fpsPos.z - m.position.z;
      const target = Math.atan2(dx, dz);
      let diff = target - m.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      m.rotation.y += diff * Math.min(1, dt * 4);
    }
    // Wander behavior
    if (cfg.behavior === 'wander') {
      st.wanderTimer -= dt;
      if (!st.wanderTarget || st.wanderTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * cfg.wanderRadius;
        st.wanderTarget = new THREE.Vector3(st.originPos.x + Math.cos(angle) * dist, m.position.y, st.originPos.z + Math.sin(angle) * dist);
        st.wanderTimer = 2 + Math.random() * 4;
      }
      const dx = st.wanderTarget.x - m.position.x;
      const dz = st.wanderTarget.z - m.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 0.2) {
        const speed = cfg.walkSpeed * dt;
        m.position.x += (dx / dist) * Math.min(speed, dist);
        m.position.z += (dz / dist) * Math.min(speed, dist);
        if (!cfg.facePlayer) m.rotation.y = Math.atan2(dx, dz);
        st.walkPhase += dt * cfg.walkSpeed * 3;
        _animateNpcWalk(m, st.walkPhase);
        isWalking = true;
      } else {
        _animateNpcWalk(m, 0);
      }
    }
    // Patrol behavior — follow path checkpoints in order
    if (cfg.behavior === 'patrol') {
      const path = _getPathForMesh(m);
      if (path && path.length > 0) {
        if (st.patrolIndex === undefined) st.patrolIndex = 0;
        const target = path[st.patrolIndex % path.length];
        const dx = target.x - m.position.x;
        const dz = target.z - m.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.3) {
          const speed = cfg.walkSpeed * dt;
          m.position.x += (dx / dist) * Math.min(speed, dist);
          m.position.z += (dz / dist) * Math.min(speed, dist);
          if (!cfg.facePlayer) m.rotation.y = Math.atan2(dx, dz);
          st.walkPhase += dt * cfg.walkSpeed * 3;
          _animateNpcWalk(m, st.walkPhase);
          isWalking = true;
        } else {
          st.patrolIndex = (st.patrolIndex + 1) % path.length;
          _animateNpcWalk(m, 0);
        }
      }
    }
    // Idle animation — only when not actively walking
    if (cfg.idleAnimation && group && !isWalking) {
      const head = group.getObjectByName('npc_head');
      const lArm = group.getObjectByName('npc_larm');
      const rArm = group.getObjectByName('npc_rarm');
      if (head) head.rotation.y = Math.sin(time * 0.5) * 0.05;
      const breath = Math.sin(time * 1.5) * 0.03;
      if (lArm) lArm.rotation.x = breath;
      if (rArm) rArm.rotation.x = -breath;
    }
    // Nameplate billboard
    const plate = m.getObjectByName('npc_nameplate');
    if (plate && fpsCam) {
      plate.quaternion.copy(fpsCam.quaternion);
    }
  }
}

function _animateNpcWalk(mesh, phase) {
  const group = mesh.getObjectByName('npc_head')?.parent;
  if (!group) return;
  const swing = Math.sin(phase) * 0.6;
  const lArm = group.getObjectByName('npc_larm');
  const rArm = group.getObjectByName('npc_rarm');
  const lLeg = group.getObjectByName('npc_lleg');
  const rLeg = group.getObjectByName('npc_rleg');
  if (lArm) lArm.rotation.x = swing;
  if (rArm) rArm.rotation.x = -swing;
  if (lLeg) lLeg.rotation.x = -swing;
  if (rLeg) rLeg.rotation.x = swing;
}

function checkNpcInteraction() {
  if (_npcDialogueActive) { _advanceNpcDialogue(); return; }
  let closest = null, closestDist = Infinity;
  for (const m of sceneObjects) {
    if (m.userData.type !== 'npc') continue;
    const cfg = normalizeNpcConfig(m.userData.npcConfig);
    const dx = fpsPos.x - m.position.x, dz = fpsPos.z - m.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < cfg.interactDistance && dist < closestDist) { closest = m; closestDist = dist; }
  }
  if (!closest) return;
  const cfg = normalizeNpcConfig(closest.userData.npcConfig);
  if (!cfg.dialogueLines.length) return;
  _npcDialogueActive = { mesh: closest, lineIndex: 0 };
  _showNpcDialogue(cfg.displayName, cfg.dialogueLines[0]);
}

function _advanceNpcDialogue() {
  if (!_npcDialogueActive) return;
  const cfg = normalizeNpcConfig(_npcDialogueActive.mesh.userData.npcConfig);
  _npcDialogueActive.lineIndex++;
  if (_npcDialogueActive.lineIndex >= cfg.dialogueLines.length) {
    _hideNpcDialogue();
    _npcDialogueActive = null;
  } else {
    _showNpcDialogue(cfg.displayName, cfg.dialogueLines[_npcDialogueActive.lineIndex]);
  }
}

function _showNpcDialogue(name, text) {
  let box = document.getElementById('npc-dialogue-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'npc-dialogue-box';
    box.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:14px 24px;border-radius:10px;font-size:14px;max-width:450px;text-align:center;z-index:9999;pointer-events:none;border:1px solid rgba(255,255,255,0.15)';
    document.body.appendChild(box);
  }
  const safeName = name.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  box.innerHTML = '<div style="font-weight:700;margin-bottom:4px;color:#8be9fd">' + safeName + '</div><div>' + safeText + '</div><div style="font-size:10px;color:#888;margin-top:6px">Press E to continue</div>';
  box.style.display = 'block';
}

function _hideNpcDialogue() {
  const box = document.getElementById('npc-dialogue-box');
  if (box) box.style.display = 'none';
}

function _showNpcInteractHint() {
  let hint = document.getElementById('npc-interact-hint');
  let showHint = false;
  if (!_npcDialogueActive) {
    for (const m of sceneObjects) {
      if (m.userData.type !== 'npc') continue;
      const cfg = normalizeNpcConfig(m.userData.npcConfig);
      if (!cfg.dialogueLines.length) continue;
      const dx = fpsPos.x - m.position.x, dz = fpsPos.z - m.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < cfg.interactDistance) { showHint = true; break; }
    }
  }
  if (showHint) {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'npc-interact-hint';
      hint.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);color:#fff;padding:6px 16px;border-radius:6px;font-size:12px;z-index:9998;pointer-events:none';
      hint.textContent = 'Press E to talk';
      document.body.appendChild(hint);
    }
    hint.style.display = 'block';
  } else if (hint) {
    hint.style.display = 'none';
  }
}

function clearNpcRuntimeState() {
  _npcRuntimeStates.clear();
  _npcDialogueActive = null;
  _hideNpcDialogue();
  const hint = document.getElementById('npc-interact-hint');
  if (hint) hint.style.display = 'none';
}

function bindNpcProps(mesh) {
  if (mesh.userData.type !== 'npc' || state.selectedObject !== mesh) return;
  const targets = getPropertyTargets(mesh).filter(t => t.userData.type === 'npc');
  if (!targets.length) return;
  const applyAll = () => {
    const name = document.getElementById('prop-npc-name');
    const beh = document.getElementById('prop-npc-behavior');
    const spd = document.getElementById('prop-npc-speed');
    const wr = document.getElementById('prop-npc-wander-radius');
    const id = document.getElementById('prop-npc-interact-dist');
    const fp = document.getElementById('prop-npc-face-player');
    const ia = document.getElementById('prop-npc-idle-anim');
    const sk = document.getElementById('prop-npc-skin');
    const sh = document.getElementById('prop-npc-shirt');
    const pa = document.getElementById('prop-npc-pants');
    const dl = document.getElementById('prop-npc-dialogue');
    for (const t of targets) {
      const cfg = normalizeNpcConfig({
        displayName: name?.value ?? 'NPC',
        behavior: beh?.value ?? 'idle',
        walkSpeed: parseFloat(spd?.value) || 1.2,
        wanderRadius: parseFloat(wr?.value) || 5,
        interactDistance: parseFloat(id?.value) || 3,
        facePlayer: fp?.checked ?? true,
        idleAnimation: ia?.checked ?? true,
        skinColor: sk ? parseInt(sk.value.slice(1), 16) : 0xf0c8a0,
        shirtColor: sh ? parseInt(sh.value.slice(1), 16) : 0x4488cc,
        pantsColor: pa ? parseInt(pa.value.slice(1), 16) : 0x334455,
        dialogueLines: dl ? dl.value.split('\n').filter(l => l.trim()) : [],
      });
      t.userData.npcConfig = cfg;
      // Sync NPC displayName to the generic label field
      t.userData.label = cfg.displayName;
      const labelEl = document.getElementById('prop-label');
      if (labelEl) labelEl.value = cfg.displayName;
      _applyNpcAppearance(t);
    }
  };
  const ids = ['prop-npc-name','prop-npc-behavior','prop-npc-speed','prop-npc-wander-radius','prop-npc-interact-dist','prop-npc-face-player','prop-npc-idle-anim','prop-npc-dialogue'];
  for (const elId of ids) {
    const el = document.getElementById(elId);
    if (el) el.addEventListener('change', applyAll);
  }
  for (const elId of ['prop-npc-skin','prop-npc-shirt','prop-npc-pants','prop-npc-name']) {
    const el = document.getElementById(elId);
    if (el) el.addEventListener('input', applyAll);
  }
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
      libraryPreviewAudio.play().catch(err => { console.warn('[Audio] Preview resume failed:', err.message); });
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
  audio.play().catch(err => { console.warn('[Audio] Preview play failed:', err.message); });
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
    } catch (err) {
      console.warn('[Audio] Failed to read file:', file.name, err);
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
  pl.shadow.normalBias = 0.02;
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
  return !['light', 'spawn', 'checkpoint', 'trigger', 'target', 'pivot', 'npc', 'teleport'].includes(type);
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
  const defaultOpacity = clampMeshOpacity(
    mat.transparent ? (mat.opacity ?? 1) : (Number.isFinite(options.opacity) ? options.opacity : 1)
  );
  if (ghost) {
    mat.transparent = true; mat.opacity = GHOST_OPACITY; mat.depthWrite = false;
  }
  const mesh = new THREE.Mesh(buildTypeGeometry(type, shapeParams), mat);
  if (ghost) {
    // Add wireframe edge overlay for better visibility
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x58a6ff, wireframe: true, transparent: true, opacity: 0.5, depthWrite: false });
    const wire = new THREE.Mesh(buildTypeGeometry(type, shapeParams), wireMat);
    mesh.add(wire);
    mesh.userData._ghostWire = wire;
  }
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
  mesh.userData.world = activeWorldId;
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
  if (type === 'joint') {
    mesh.userData.jointConfig = createDefaultJointConfig();
  }
  if (type === 'skeleton') {
    mesh.userData.skeletonConfig = createDefaultSkeletonConfig();
  }
  if (type === 'teleport') {
    mesh.userData.teleportConfig = normalizeTeleportConfig({});
  }
  if (type === 'text' || type === 'text3d') {
    mesh.userData.textConfig = normalizeTextConfig(options.textConfig);
    _applyTextTexture(mesh);
  }
  if (type === 'screen') {
    mesh.userData.screenConfig = normalizeScreenConfig(options.screenConfig);
    _applyScreenTexture(mesh);
  }
  if (type === 'camera') {
    mesh.userData.cameraConfig = normalizeCameraConfig(options.cameraConfig);
  }
  if (type === 'npc') {
    mesh.userData.npcConfig = normalizeNpcConfig(options.npcConfig);
    mesh.userData.hitboxConfig = { mode: 'auto', offset: [0, 0.9, 0], size: [0.6, 1.8, 0.4] };
    if (!ghost) _applyNpcAppearance(mesh);
  }
  if (type === 'terrain') {
    const seg = shapeParams.segments ?? 64;
    const sz  = shapeParams.terrainSize ?? 20;
    const heightmap = options.heightmap || new Float32Array((seg + 1) * (seg + 1));
    mesh.userData.terrainConfig = { segments: seg, terrainSize: sz, heightmap };
    mesh.userData.collisionMode = 'geometry';   // terrain needs geometry collision for slopes
    // Apply heightmap to geometry
    _applyHeightmapToMesh(mesh);
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
    pl.shadow.normalBias = 0.02;
    mesh.add(pl);
    mesh.userData.pointLight = pl;
    mesh.userData.lightDistance = pl.distance;
    setMeshLightIntensity(mesh, options.lightIntensity);
  }
  if (!ghost) applyCustomSkinToMesh(mesh);
  // Default invisible-at-runtime types to hidden in game
  if (['spawn', 'trigger', 'light', 'pivot', 'joint', 'skeleton', 'camera'].includes(type)) {
    mesh.userData.hiddenInGame = true;
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
    const m = state.selectedObject;
    const after = captureTRS(m);
    const moved = !trsEqual(transformBefore, after);

    // Draw Path: add checkpoint at new position then snap back
    if (moved && m.userData._drawAnimPath) {
      const cfg = getMeshMovementPathConfig(m);
      cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: m.position.toArray() }));
      m.userData.movementPath = normalizeMovementPathConfig(cfg);
      if (m.userData._drawAnimPathOrigin) m.position.copy(m.userData._drawAnimPathOrigin);
      refreshSelectedPathPreview();
      refreshProps();
    }
    // Normal mode: shift all checkpoints by the delta
    else if (moved && !m.userData._drawAnimPath && state.transformMode !== 'scale') {
      const dx = after.pos.x - transformBefore.pos.x;
      const dy = after.pos.y - transformBefore.pos.y;
      const dz = after.pos.z - transformBefore.pos.z;
      const cfg = getMeshMovementPathConfig(m);
      if (cfg.checkpoints.length) {
        for (const cp of cfg.checkpoints) {
          cp.pos[0] += dx;
          cp.pos[1] += dy;
          cp.pos[2] += dz;
        }
        m.userData.movementPath = normalizeMovementPathConfig(cfg);
        refreshSelectedPathPreview();
      }
    }

    if (moved && !m.userData._drawAnimPath)
      pushUndo({ type: 'transform', mesh: m, before: transformBefore, after });
    // Commit extra selected undos
    for (let i = 0; i < state.extraSelected.length; i++) {
      const em = state.extraSelected[i];
      const a = captureTRS(em);
      if (extraTransformBefore[i] && !trsEqual(extraTransformBefore[i], a))
        pushUndo({ type: 'transform', mesh: em, before: extraTransformBefore[i], after: a });
    }
    transformBefore = null;
    extraTransformBefore = [];
    _extraOffsetsBefore = [];
    if (typeof refreshObjLib === 'function') refreshObjLib();
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

  // For grouped objects, start the preview line from the group center
  const groupMembers = getPropertyTargets(mesh).filter(m => !['spawn', 'checkpoint', 'trigger'].includes(m.userData.type));
  let startPos;
  if (groupMembers.length > 1) {
    startPos = new THREE.Vector3();
    for (const m of groupMembers) startPos.add(m.position);
    startPos.divideScalar(groupMembers.length);
  } else {
    startPos = mesh.position.clone();
  }

  const points = [startPos];
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
    const markerColor = armed ? 0xffc857 : (cp.faceDirection ? 0x57b8ff : 0x65d46e);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 12),
      new THREE.MeshBasicMaterial({
        color: markerColor,
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

  // Auto-uncheck Draw Path when deselecting
  if (state.selectedObject && state.selectedObject !== obj && state.selectedObject.userData._drawAnimPath) {
    const prev = state.selectedObject;
    if (prev.userData._drawAnimPathOrigin) prev.position.copy(prev.userData._drawAnimPathOrigin);
    delete prev.userData._drawAnimPath;
    delete prev.userData._drawAnimPathOrigin;
  }

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
  if (typeof refreshObjLib === 'function') refreshObjLib();
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
  if (mesh.material.emissive) {
    mesh.userData._hi = { emissive: mesh.material.emissive.getHex(), ei: mesh.material.emissiveIntensity };
    mesh.material.emissive.set(0x2255cc);
    mesh.material.emissiveIntensity = .4;
  } else {
    mesh.userData._hi = { color: mesh.material.color.getHex() };
    mesh.material.color.set(0x5588ee);
  }
}
function unhighlight(mesh) {
  if (!mesh.material || !mesh.userData._hi) return;
  if (mesh.material.emissive && mesh.userData._hi.emissive !== undefined) {
    mesh.material.emissive.set(mesh.userData._hi.emissive);
    mesh.material.emissiveIntensity = mesh.userData._hi.ei;
  } else if (mesh.userData._hi.color !== undefined) {
    mesh.material.color.set(mesh.userData._hi.color);
  }
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
function pushUndo(action) {
  undoStack.push(action);
  if (undoStack.length > MAX_UNDO) undoStack.splice(0, undoStack.length - MAX_UNDO);
  redoStack.length = 0;
  syncUndoUI();
  markRestoreDirty();
}

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

function addToScene(mesh) {
  if (!mesh.userData._placedOrder) mesh.userData._placedOrder = _nextPlacedOrder++;
  sceneObjects.push(mesh);
  scene.add(mesh);
  if (typeof refreshObjLib === 'function') refreshObjLib();
  markRestoreDirty();
}
function removeFromScene(mesh) {
  const i = sceneObjects.indexOf(mesh);
  if (i >= 0) sceneObjects.splice(i, 1);
  if (state.selectedObject === mesh) selectObject(null);
  scene.remove(mesh);
  if (typeof refreshObjLib === 'function') refreshObjLib();
  markRestoreDirty();
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
  else if (a.type === 'metalness') {
    if (a.mesh.material) { a.mesh.material.metalness = a.after; a.mesh.material.needsUpdate = true; }
    a.mesh.userData.metalness = a.after;
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'roughness') {
    if (a.mesh.material) { a.mesh.material.roughness = a.after; a.mesh.material.needsUpdate = true; }
    a.mesh.userData.roughness = a.after;
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
  else if (a.type === 'compound') { for (const op of a.ops) applyAction(op); }
  else if (a.type === 'terrain-sculpt') {
    a.mesh.userData.terrainConfig.heightmap = a.after.slice();
    _applyHeightmapToMesh(a.mesh);
  }
  else if (a.type === 'texture-paint') {
    if (a.afterPattern) applyTexturePaint(a.mesh, a.afterPattern.pattern, a.afterPattern.color1, a.afterPattern.color2, a.afterPattern.scale);
    else applyTexturePaint(a.mesh, 'none', 0, 0, 1);
  }
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
  else if (a.type === 'metalness') {
    if (a.mesh.material) { a.mesh.material.metalness = a.before; a.mesh.material.needsUpdate = true; }
    a.mesh.userData.metalness = a.before;
    if (state.selectedObject === a.mesh) refreshProps();
  }
  else if (a.type === 'roughness') {
    if (a.mesh.material) { a.mesh.material.roughness = a.before; a.mesh.material.needsUpdate = true; }
    a.mesh.userData.roughness = a.before;
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
  else if (a.type === 'compound') { for (let i = a.ops.length - 1; i >= 0; i--) applyInverse(a.ops[i]); }
  else if (a.type === 'terrain-sculpt') {
    a.mesh.userData.terrainConfig.heightmap = a.before.slice();
    _applyHeightmapToMesh(a.mesh);
  }
  else if (a.type === 'texture-paint') {
    if (a.beforePattern) applyTexturePaint(a.mesh, a.beforePattern.pattern, a.beforePattern.color1, a.beforePattern.color2, a.beforePattern.scale);
    else applyTexturePaint(a.mesh, 'none', 0, 0, 1);
  }
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
  if (ghost) {
    if (ghost.userData._ghostWire) {
      ghost.userData._ghostWire.geometry.dispose();
      ghost.userData._ghostWire.material.dispose();
    }
    scene.remove(ghost); ghost = null;
  }
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
  const hits = raycaster.intersectObjects(sceneObjects, true);
  if (!hits.length) return null;
  // Map hit child back to its sceneObject parent
  for (const h of hits) {
    let obj = h.object;
    while (obj) {
      if (sceneObjects.includes(obj)) return obj;
      obj = obj.parent;
    }
  }
  return null;
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
  const hits = raycaster.intersectObjects(sceneObjects, true);
  if (!hits.length || !hits[0].face) return null;
  const hit = hits[0];
  // Map hit child back to its sceneObject parent
  let obj = hit.object;
  while (obj && !sceneObjects.includes(obj)) obj = obj.parent;
  const normal = hit.face.normal.clone()
    .transformDirection(hit.object.matrixWorld)
    .normalize();
  return { point: hit.point, normal, object: obj || hit.object };
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
  // Track original color for erase-paint
  if (mesh.userData.originalColor === undefined) {
    mesh.userData.originalColor = mesh.material.color.getHex();
  }
  const before = mesh.material.color.getHex();
  const after = colorHex;
  if (before === after) return;
  setMeshColor(mesh, after);
  pushUndo({ type: 'color', mesh, before, after });
}

/** Flood-fill paint: paint all touching objects with the same color. */
function _floodFillPaint(startMesh, targetColor) {
  if (!startMesh?.material?.color) return;
  const sourceColor = startMesh.material.color.getHex();
  if (sourceColor === targetColor) return;
  const visited = new Set();
  const queue = [startMesh];
  const undoOps = [];
  const tolerance = 0.6; // adjacency distance threshold

  while (queue.length) {
    const mesh = queue.shift();
    if (visited.has(mesh)) continue;
    visited.add(mesh);
    if (!mesh.material?.color) continue;
    if (mesh.material.color.getHex() !== sourceColor) continue;

    if (mesh.userData.originalColor === undefined) {
      mesh.userData.originalColor = mesh.material.color.getHex();
    }
    const before = mesh.material.color.getHex();
    setMeshColor(mesh, targetColor);
    undoOps.push({ type: 'color', mesh, before, after: targetColor });

    // Find adjacent objects (touching or very close)
    const box = new THREE.Box3().setFromObject(mesh).expandByScalar(tolerance);
    for (const other of sceneObjects) {
      if (visited.has(other) || !other.material?.color) continue;
      if (other.material.color.getHex() !== sourceColor) continue;
      const oBox = new THREE.Box3().setFromObject(other);
      if (box.intersectsBox(oBox)) queue.push(other);
    }
  }
  // Push as a single compound undo
  if (undoOps.length) pushUndo({ type: 'compound', ops: undoOps });
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

  // Match the ghost's snapped position: offset along normal, snap non-normal
  // axes, then project back to the surface so the cutter intersects the target.
  const halfSize = THREE.MathUtils.clamp(state.eraserSize * 0.5, 0.05, 6);
  const cutterPos = hit.point.clone().addScaledVector(hit.normal, halfSize);
  snapSurface(cutterPos, hit.normal);
  cutterPos.addScaledVector(hit.normal, -halfSize);
  const cutter = makeEraserCutterMesh(cutterPos, hit.normal, throughDepth);

  target.updateMatrixWorld(true);
  cutter.updateMatrixWorld(true);

  try {
    const result = CSG.subtract(target, cutter);
    if (!result?.geometry) return;
    const beforeGeo = target.geometry.clone();
    const afterGeo = result.geometry.clone();
    target.userData.collisionMode = 'geometry';
    target.userData._hasCustomGeometry = true;
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
  if (!confirm(`Clear all ${sceneObjects.length} object(s) from the scene?`)) return;
  const meshes = [...sceneObjects];
  selectObject(null);
  meshes.forEach(removeFromScene);
  pushUndo({ type: 'clear', meshes });
  refreshStatus();
}

// ─── Copy / Paste ────────────────────────────────────────────────────────────
function copySelected() {
  const all = getAllSelected();
  if (!all.length) return;
  _clipboard = all.map(m => serializeSingleObject(m));
  // Compute center of copied objects
  _clipboardCenter.set(0, 0, 0);
  for (const m of all) _clipboardCenter.add(m.position);
  _clipboardCenter.divideScalar(all.length);
  refreshStatus();
}

function pasteClipboard() {
  if (!_clipboard.length) return;
  // Paste offset: 2 units forward from editor camera
  const dir = new THREE.Vector3();
  editorCam.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  const pasteCenter = editorCam.position.clone().add(dir.multiplyScalar(8));
  pasteCenter.y = _clipboardCenter.y;
  if (state.snapSize) {
    pasteCenter.x = Math.round(pasteCenter.x / state.snapSize) * state.snapSize;
    pasteCenter.z = Math.round(pasteCenter.z / state.snapSize) * state.snapSize;
  }
  const offset = pasteCenter.clone().sub(_clipboardCenter);
  const newMeshes = [];
  const newGroupMap = {};
  for (const data of _clipboard) {
    const d = JSON.parse(JSON.stringify(data));
    d.position[0] += offset.x;
    d.position[1] += offset.y;
    d.position[2] += offset.z;
    // Remap editor group ids so pasted objects get new groups
    if (d.editorGroupId) {
      if (!newGroupMap[d.editorGroupId]) newGroupMap[d.editorGroupId] = 'eg_' + (_nextEditorGroupId++);
      d.editorGroupId = newGroupMap[d.editorGroupId];
    }
    const mesh = deserializeObject(d);
    if (mesh) {
      addToScene(mesh);
      newMeshes.push(mesh);
    }
  }
  if (newMeshes.length) {
    pushUndo({ type: 'compound', ops: newMeshes.map(m => ({ type: 'add', mesh: m })) });
    selectObject(newMeshes[0]);
    if (newMeshes.length > 1) {
      state.extraSelected = newMeshes.slice(1);
      rebuildExtraBoxes();
    }
  }
  refreshStatus();
}

function duplicateSelected() {
  const all = getAllSelected();
  if (!all.length) return;
  const serialized = all.map(m => serializeSingleObject(m));
  const center = new THREE.Vector3();
  for (const m of all) center.add(m.position);
  center.divideScalar(all.length);
  const offset = new THREE.Vector3(state.snapSize || 1, 0, 0);
  const newMeshes = [];
  const newGroupMap = {};
  for (const data of serialized) {
    const d = JSON.parse(JSON.stringify(data));
    d.position[0] += offset.x;
    d.position[1] += offset.y;
    d.position[2] += offset.z;
    if (d.editorGroupId) {
      if (!newGroupMap[d.editorGroupId]) newGroupMap[d.editorGroupId] = 'eg_' + (_nextEditorGroupId++);
      d.editorGroupId = newGroupMap[d.editorGroupId];
    }
    const mesh = deserializeObject(d);
    if (mesh) {
      addToScene(mesh);
      newMeshes.push(mesh);
    }
  }
  if (newMeshes.length) {
    pushUndo({ type: 'compound', ops: newMeshes.map(m => ({ type: 'add', mesh: m })) });
    selectObject(newMeshes[0]);
    if (newMeshes.length > 1) {
      state.extraSelected = newMeshes.slice(1);
      rebuildExtraBoxes();
    }
  }
  refreshStatus();
}

// ─── Custom Object Templates ────────────────────────────────────────────────
function saveSelectionAsCustomObject(name) {
  const all = getAllSelected();
  if (!all.length) return;
  // Compute center
  const center = new THREE.Vector3();
  for (const m of all) center.add(m.position);
  center.divideScalar(all.length);
  // Serialize with positions relative to center
  const objects = all.map(m => {
    const d = serializeSingleObject(m);
    d.position[0] -= center.x;
    d.position[1] -= center.y;
    d.position[2] -= center.z;
    return d;
  });
  const templateName = name || 'Custom ' + _nextCustomTemplateId;
  const template = {
    id: 'ct_' + (_nextCustomTemplateId++),
    name: templateName,
    objects,
    color: all[0].material?.color ? all[0].material.color.getHex() : 0x888888,
  };
  customObjectTemplates.push(template);
  refreshCustomObjectUI();
  refreshObjLib();
  markRestoreDirty();
}

function placeCustomTemplate(templateId, pos) {
  const template = customObjectTemplates.find(t => t.id === templateId);
  if (!template) return;
  const newMeshes = [];
  const newGroupId = 'eg_' + (_nextEditorGroupId++);
  for (const data of template.objects) {
    const d = JSON.parse(JSON.stringify(data));
    d.position[0] += pos.x;
    d.position[1] += pos.y;
    d.position[2] += pos.z;
    // Link as editor group if multiple
    if (template.objects.length > 1) d.editorGroupId = newGroupId;
    const mesh = deserializeObject(d);
    if (mesh) {
      addToScene(mesh);
      newMeshes.push(mesh);
    }
  }
  if (newMeshes.length) {
    pushUndo({ type: 'compound', ops: newMeshes.map(m => ({ type: 'add', mesh: m })) });
  }
  refreshStatus();
}

function deleteCustomTemplate(templateId) {
  const idx = customObjectTemplates.findIndex(t => t.id === templateId);
  if (idx >= 0) {
    customObjectTemplates.splice(idx, 1);
    refreshCustomObjectUI();
    refreshObjLib();
    markRestoreDirty();
  }
}

function serializeCustomObjectTemplates() {
  return customObjectTemplates.map(t => ({ ...t, objects: t.objects.map(o => ({ ...o })) }));
}

function loadCustomObjectTemplates(arr) {
  customObjectTemplates.length = 0;
  if (!Array.isArray(arr)) return;
  for (const t of arr) {
    customObjectTemplates.push({
      id: t.id || 'ct_' + (_nextCustomTemplateId++),
      name: t.name || 'Custom',
      objects: Array.isArray(t.objects) ? t.objects : [],
      color: t.color ?? 0x888888,
    });
    const numId = parseInt(String(t.id).replace('ct_', ''), 10);
    if (Number.isFinite(numId) && numId >= _nextCustomTemplateId) _nextCustomTemplateId = numId + 1;
  }
  refreshCustomObjectUI();
}

function refreshCustomObjectUI() {
  const container = document.getElementById('custom-objects-list');
  if (!container) return;
  container.innerHTML = '';
  if (!customObjectTemplates.length) {
    container.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:4px 8px">No custom objects saved yet.<br>Select objects and click "Save as Custom".</div>';
    return;
  }
  for (const t of customObjectTemplates) {
    const div = document.createElement('div');
    div.className = 'custom-tpl-item';
    div.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:4px;font-size:11px;background:#111821;border:1px solid #1d2430;margin-bottom:3px;';
    const colorHex = '#' + (t.color ?? 0x888888).toString(16).padStart(6, '0');
    div.innerHTML = `
      <span style="display:inline-block;width:18px;height:18px;border-radius:3px;background:${colorHex};flex-shrink:0"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.name)} <span style="color:#8b949e">(${t.objects.length})</span></span>
      <button class="ct-place-btn" title="Place this custom object" style="font-size:10px;padding:1px 5px;cursor:pointer">⊕</button>
      <button class="ct-del-btn" title="Delete template" style="font-size:10px;padding:1px 5px;cursor:pointer;color:#f85149">✕</button>
    `;
    div.querySelector('.ct-place-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      state._placingCustomTemplate = t.id;
      state.mode = 'place';
      if (modeSelect) modeSelect.value = 'place';
      refreshStatus();
    });
    div.querySelector('.ct-del-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteCustomTemplate(t.id);
    });
    container.appendChild(div);
  }
}

// ─── Terrain Sculpting ──────────────────────────────────────────────────────
function _applyHeightmapToMesh(mesh) {
  const tc = mesh.userData.terrainConfig;
  if (!tc) return;
  const pos = mesh.geometry.attributes.position;
  const hm = tc.heightmap;
  for (let i = 0; i < pos.count; i++) {
    if (i < hm.length) pos.setY(i, hm[i]);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  // Invalidate cached collision AABB
  mesh.userData._cachedCollisionAABB = null;
}

function _getTerrainVertexIndex(tc, localX, localZ) {
  const seg = tc.segments;
  const sz = tc.terrainSize;
  const halfSize = sz / 2;
  const col = Math.round(((localX + halfSize) / sz) * seg);
  const row = Math.round(((localZ + halfSize) / sz) * seg);
  if (col < 0 || col > seg || row < 0 || row > seg) return -1;
  return row * (seg + 1) + col;
}

function sculptTerrain(mesh, worldPoint, brush, radius, strength) {
  const tc = mesh.userData.terrainConfig;
  if (!tc) return;
  const hm = tc.heightmap;
  const seg = tc.segments;
  const sz = tc.terrainSize;
  const halfSize = sz / 2;

  // Convert world point to local space
  const invMatrix = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const localPt = worldPoint.clone().applyMatrix4(invMatrix);

  const cellSize = sz / seg;
  const radiusCells = Math.ceil(radius / cellSize);
  const centerCol = Math.round(((localPt.x + halfSize) / sz) * seg);
  const centerRow = Math.round(((localPt.z + halfSize) / sz) * seg);

  // Precompute flatten target
  let flattenY = 0;
  if (brush === 'flatten') {
    const ci = _getTerrainVertexIndex(tc, localPt.x, localPt.z);
    flattenY = ci >= 0 && ci < hm.length ? hm[ci] : 0;
  }

  // Smooth: gather neighbors for averaging
  let smoothBuffer = null;
  if (brush === 'smooth') {
    smoothBuffer = new Float32Array(hm.length);
    smoothBuffer.set(hm);
  }

  for (let dr = -radiusCells; dr <= radiusCells; dr++) {
    for (let dc = -radiusCells; dc <= radiusCells; dc++) {
      const r = centerRow + dr;
      const c = centerCol + dc;
      if (r < 0 || r > seg || c < 0 || c > seg) continue;
      const idx = r * (seg + 1) + c;
      if (idx < 0 || idx >= hm.length) continue;

      const vx = (c / seg) * sz - halfSize;
      const vz = (r / seg) * sz - halfSize;
      const dist = Math.sqrt((vx - localPt.x) ** 2 + (vz - localPt.z) ** 2);
      if (dist > radius) continue;
      const falloff = 1 - (dist / radius);

      if (brush === 'raise') {
        hm[idx] += strength * falloff;
      } else if (brush === 'lower') {
        hm[idx] -= strength * falloff;
      } else if (brush === 'flatten') {
        hm[idx] += (flattenY - hm[idx]) * falloff * strength * 0.5;
      } else if (brush === 'smooth') {
        // Average of neighbors
        let sum = 0, count = 0;
        for (let sr = -1; sr <= 1; sr++) {
          for (let sc = -1; sc <= 1; sc++) {
            const nr = r + sr, nc = c + sc;
            if (nr < 0 || nr > seg || nc < 0 || nc > seg) continue;
            const ni = nr * (seg + 1) + nc;
            if (ni >= 0 && ni < smoothBuffer.length) { sum += smoothBuffer[ni]; count++; }
          }
        }
        if (count) hm[idx] += ((sum / count) - hm[idx]) * falloff * strength;
      }
    }
  }
  _applyHeightmapToMesh(mesh);
}

function handleTerrainSculptClick(e) {
  if (!terrainSculptState.active) return false;
  const ndc = toNDC(e);
  raycaster.setFromCamera(ndc, editorCam);
  let terrains = sceneObjects.filter(m => m.userData.type === 'terrain');
  let hits = raycaster.intersectObjects(terrains, false);

  // If no terrain hit, check if the click landed on the ground floor (Y ≈ 0)
  // and auto-create a terrain block there
  if (!hits.length) {
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundPt = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, groundPt)) {
      const seg = 64;
      const sz = 20;
      const mesh = createMesh('terrain', false, { shapeParams: { segments: seg, terrainSize: sz } });
      mesh.position.set(
        Math.round(groundPt.x / sz) * sz,
        0,
        Math.round(groundPt.z / sz) * sz
      );
      addToScene(mesh);
      pushUndo({ type: 'add', mesh });
      terrains = [mesh];
      hits = raycaster.intersectObjects(terrains, false);
      if (!hits.length) return false;
    } else {
      return false;
    }
  }

  const hit = hits[0];
  _terrainSculptBeforeState = hit.object.userData.terrainConfig.heightmap.slice();
  _terrainSculptMesh = hit.object;
  sculptTerrain(hit.object, hit.point, terrainSculptState.brush, terrainSculptState.radius, terrainSculptState.strength);
  terrainSculptState._painting = true;
  return true;
}

let _terrainSculptBeforeState = null;
let _terrainSculptMesh = null;

function handleTerrainSculptDrag(e) {
  if (!terrainSculptState._painting) return;
  const ndc = toNDC(e);
  raycaster.setFromCamera(ndc, editorCam);
  const terrains = sceneObjects.filter(m => m.userData.type === 'terrain');
  const hits = raycaster.intersectObjects(terrains, false);
  if (!hits.length) return;
  sculptTerrain(hits[0].object, hits[0].point, terrainSculptState.brush, terrainSculptState.radius, terrainSculptState.strength);
}

function handleTerrainSculptEnd() {
  if (!terrainSculptState._painting) return;
  terrainSculptState._painting = false;
  if (_terrainSculptMesh && _terrainSculptBeforeState) {
    const before = _terrainSculptBeforeState;
    const after = _terrainSculptMesh.userData.terrainConfig.heightmap.slice();
    const mesh = _terrainSculptMesh;
    pushUndo({
      type: 'terrain-sculpt',
      mesh,
      before,
      after,
    });
  }
  _terrainSculptBeforeState = null;
  _terrainSculptMesh = null;
}

// ─── Texture Paint ──────────────────────────────────────────────────────────
const _patternCanvasCache = new Map();
function _generatePatternCanvas(pattern, color1, color2, scale) {
  const cacheKey = `${pattern}_${color1}_${color2}_${scale}`;
  if (_patternCanvasCache.has(cacheKey)) return _patternCanvasCache.get(cacheKey);
  const size = Math.max(32, Math.round(64 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c1 = '#' + color1.toString(16).padStart(6, '0');
  const c2 = '#' + color2.toString(16).padStart(6, '0');

  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, size, size);

  if (pattern === 'checker') {
    ctx.fillStyle = c2;
    const half = size / 2;
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
  } else if (pattern === 'brick') {
    ctx.fillStyle = c2;
    const bh = size / 4;
    ctx.lineWidth = Math.max(1, size / 32);
    ctx.strokeStyle = c2;
    for (let row = 0; row < 4; row++) {
      const y = row * bh;
      ctx.strokeRect(0, y, size, bh);
      const off = row % 2 === 0 ? 0 : size / 2;
      ctx.beginPath();
      ctx.moveTo(off + size / 2, y);
      ctx.lineTo(off + size / 2, y + bh);
      ctx.stroke();
      if (row % 2 === 1) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(0, y + bh);
        ctx.stroke();
      }
    }
  } else if (pattern === 'stripe') {
    ctx.fillStyle = c2;
    const step = size / 8;
    for (let i = 0; i < 8; i += 2) {
      ctx.fillRect(0, i * step, size, step);
    }
  } else if (pattern === 'grid') {
    ctx.strokeStyle = c2;
    ctx.lineWidth = Math.max(1, size / 32);
    const step = size / 4;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
    }
  } else if (pattern === 'noise') {
    const imgData = ctx.getImageData(0, 0, size, size);
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    for (let p = 0; p < imgData.data.length; p += 4) {
      const t = Math.random();
      imgData.data[p]     = Math.round(r1 + (r2 - r1) * t);
      imgData.data[p + 1] = Math.round(g1 + (g2 - g1) * t);
      imgData.data[p + 2] = Math.round(b1 + (b2 - b1) * t);
      imgData.data[p + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  } else if (pattern === 'gradient') {
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  } else if (pattern === 'wood') {
    // Wood grain - horizontal wavy lines
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    const imgData = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const grain = (Math.sin((y / size) * 30 + Math.sin(x / size * 8) * 2) + 1) * 0.5;
        const t = grain * 0.6 + Math.random() * 0.1;
        const i = (y * size + x) * 4;
        imgData.data[i]     = Math.round(r1 + (r2 - r1) * t);
        imgData.data[i + 1] = Math.round(g1 + (g2 - g1) * t);
        imgData.data[i + 2] = Math.round(b1 + (b2 - b1) * t);
        imgData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  } else if (pattern === 'cobblestone') {
    // Cobblestone - rounded irregular shapes
    ctx.fillStyle = c2;
    const cols = 4, rows = 4;
    const cw = size / cols, ch = size / rows;
    for (let r = 0; r < rows; r++) {
      for (let c2i = 0; c2i < cols; c2i++) {
        const cx = c2i * cw + cw / 2 + (Math.random() - 0.5) * cw * 0.3;
        const cy = r * ch + ch / 2 + (Math.random() - 0.5) * ch * 0.3;
        const rx = cw * 0.38 + (Math.random() - 0.5) * cw * 0.1;
        const ry = ch * 0.38 + (Math.random() - 0.5) * ch * 0.1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, Math.random() * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Mortar lines
    ctx.strokeStyle = c1;
    ctx.lineWidth = Math.max(1, size / 32);
    for (let i = 1; i < cols; i++) {
      const x = i * cw + (Math.random() - 0.5) * 2;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - 0.5) * 4, size); ctx.stroke();
    }
    for (let i = 1; i < rows; i++) {
      const y = i * ch + (Math.random() - 0.5) * 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (Math.random() - 0.5) * 4); ctx.stroke();
    }
  } else if (pattern === 'marble') {
    // Marble - soft veins
    const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    const imgData = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = Math.sin(x / size * 10 + Math.sin(y / size * 6) * 3 + Math.random() * 0.5);
        const t = (v + 1) * 0.5 * 0.4 + Math.random() * 0.05;
        const i = (y * size + x) * 4;
        imgData.data[i]     = Math.round(r1 + (r2 - r1) * t);
        imgData.data[i + 1] = Math.round(g1 + (g2 - g1) * t);
        imgData.data[i + 2] = Math.round(b1 + (b2 - b1) * t);
        imgData.data[i + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }
  _patternCanvasCache.set(cacheKey, canvas);
  return canvas;
}

function applyTexturePaint(mesh, pattern, color1, color2, scale, customImg) {
  if (!mesh?.material) return;
  if (pattern === 'none') {
    if (mesh.material.map) {
      mesh.material.map.dispose();
      mesh.material.map = null;
      mesh.material.needsUpdate = true;
    }
    mesh.userData._texturePattern = null;
    return;
  }
  let tex;
  if (pattern === 'custom' && customImg) {
    tex = new THREE.Texture(customImg);
    tex.needsUpdate = true;
  } else {
    const canvas = _generatePatternCanvas(pattern, color1, color2, scale);
    tex = new THREE.CanvasTexture(canvas);
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  if (mesh.material.map) mesh.material.map.dispose();
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;
  mesh.userData._texturePattern = { pattern, color1, color2, scale };
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
      size: parseFloat(sunSizeInput?.value) || SUN_SIZE_DEFAULT,
    },
    skyColor: skyColorInput?.value || SKY_COLOR_DEFAULT,
    clouds: {
      enabled: cloudsEnabledInput ? cloudsEnabledInput.checked : CLOUDS_ENABLED_DEFAULT,
      windSpeed: parseFloat(cloudWindSpeedInput?.value) || CLOUD_WIND_SPEED_DEFAULT,
      windDir: parseFloat(cloudWindDirInput?.value) || CLOUD_WIND_DIR_DEFAULT,
      opacity: parseFloat(cloudOpacityInput?.value) ?? CLOUD_OPACITY_DEFAULT,
    },
    stars: {
      enabled: starsEnabledInput ? starsEnabledInput.checked : STARS_ENABLED_DEFAULT,
      count: parseInt(starsCountInput?.value) || STARS_COUNT_DEFAULT,
      brightness: parseFloat(starsBrightnessInput?.value) || STARS_BRIGHTNESS_DEFAULT,
    },
    moon: {
      enabled: moonEnabledInput ? moonEnabledInput.checked : MOON_ENABLED_DEFAULT,
      brightness: parseFloat(moonBrightnessInput?.value) || MOON_BRIGHTNESS_DEFAULT,
      aura: parseFloat(moonAuraInput?.value) ?? MOON_AURA_DEFAULT,
    },
    gameRules: { ...gameRules },
    gameRulesVarBinds: { ...gameRulesVarBinds },
    gridFill: { enabled: gridFillEnabled, color: gridFillColor, texture: gridFillTexture },
    worldBorder: { enabled: worldBorderEnabled, minX: worldBorderMinX, maxX: worldBorderMaxX, minZ: worldBorderMinZ, maxZ: worldBorderMaxZ },
    worlds: worlds.map(w => ({ ...w })),
    activeWorldId,
    fog: { ...fogSettings },
    fov: { editor: editorFov, playtest: playtestFov },
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
    customFonts: customFonts.map(f => ({ name: f.name, dataUrl: f.dataUrl })),
    controlFunctionGroups: controlFunctionGroups.map(normalizeControlFunctionGroup),
    controlFunctions: controlFunctions.map(normalizeControlFunction),
    customBlockSkins: serializeCustomBlockSkins(),
    customSculptSkins: serializeCustomSculptSkins(),
    skeletonDefinitions: serializeSkeletonDefinitions(),
    keybinds: { ...keybinds },
    customObjectTemplates: serializeCustomObjectTemplates(),
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
  markRestoreDirty();
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
    if (d.size !== undefined && sunSizeInput) sunSizeInput.value = d.size;
    if (sunDayCycleEnabledInput) {
      if (d.dayCycleEnabled !== undefined) {
        sunDayCycleEnabledInput.checked = !!d.dayCycleEnabled;
      } else if (d.dayDuration !== undefined) {
        sunDayCycleEnabledInput.checked = Number(d.dayDuration) > 0;
      } else {
        sunDayCycleEnabledInput.checked = SUN_DAY_CYCLE_ENABLED_DEFAULT;
      }
    }
    if (d.time === undefined && d.elevation !== undefined) {
      const elev = THREE.MathUtils.clamp(d.elevation, -10, 89);
      sunTimeInput.value = (12 + elev / 90 * 7).toFixed(1);
    }
    if (d.time === undefined && d.azimuth !== undefined) {
      sunNorthInput.value = Math.round(d.azimuth);
    }
  }
  // Sky color
  if (settings.skyColor && skyColorInput) skyColorInput.value = settings.skyColor;
  // Clouds
  if (settings.clouds) {
    if (cloudsEnabledInput) cloudsEnabledInput.checked = settings.clouds.enabled !== false;
    if (cloudWindSpeedInput && settings.clouds.windSpeed !== undefined) cloudWindSpeedInput.value = settings.clouds.windSpeed;
    if (cloudWindDirInput && settings.clouds.windDir !== undefined) cloudWindDirInput.value = settings.clouds.windDir;
    if (cloudOpacityInput && settings.clouds.opacity !== undefined) cloudOpacityInput.value = settings.clouds.opacity;
  }
  // Stars
  if (settings.stars) {
    if (starsEnabledInput) starsEnabledInput.checked = settings.stars.enabled !== false;
    if (starsCountInput && settings.stars.count !== undefined) {
      starsCountInput.value = settings.stars.count;
      _buildStars(settings.stars.count);
    }
    if (starsBrightnessInput && settings.stars.brightness !== undefined) starsBrightnessInput.value = settings.stars.brightness;
  }
  // Moon
  if (settings.moon) {
    if (moonEnabledInput) moonEnabledInput.checked = settings.moon.enabled !== false;
    if (moonBrightnessInput && settings.moon.brightness !== undefined) moonBrightnessInput.value = settings.moon.brightness;
    if (moonAuraInput && settings.moon.aura !== undefined) moonAuraInput.value = settings.moon.aura;
  }
  updateSunSky();
  syncSunInputs();
  // Restore game rules
  if (settings.gameRules) {
    Object.assign(gameRules, settings.gameRules);
    syncGameruleUI();
  }
  // Restore variable bindings for gamerule inputs
  if (settings.gameRulesVarBinds) {
    for (const k of Object.keys(gameRulesVarBinds)) delete gameRulesVarBinds[k];
    Object.assign(gameRulesVarBinds, settings.gameRulesVarBinds);
    syncGameruleUI();
  }
  // Restore grid fill
  if (settings.gridFill) {
    gridFillEnabled = !!settings.gridFill.enabled;
    gridFillColor = settings.gridFill.color ?? 0x1a2636;
    gridFillTexture = settings.gridFill.texture || 'none';
    gridFillEnabledInput.checked = gridFillEnabled;
    gridFillColorInput.value = '#' + gridFillColor.toString(16).padStart(6, '0');
    const texSel = document.getElementById('grid-fill-texture');
    if (texSel) texSel.value = gridFillTexture;
    setGridFill(gridFillEnabled, gridFillColor, gridFillTexture);
  }
  // Restore world border
  if (settings.worldBorder) {
    worldBorderEnabled = !!settings.worldBorder.enabled;
    worldBorderMinX = Number.isFinite(settings.worldBorder.minX) ? settings.worldBorder.minX : -50;
    worldBorderMaxX = Number.isFinite(settings.worldBorder.maxX) ? settings.worldBorder.maxX : 50;
    worldBorderMinZ = Number.isFinite(settings.worldBorder.minZ) ? settings.worldBorder.minZ : -50;
    worldBorderMaxZ = Number.isFinite(settings.worldBorder.maxZ) ? settings.worldBorder.maxZ : 50;
    syncWorldBorderUI();
  }
  // Restore worlds
  if (Array.isArray(settings.worlds) && settings.worlds.length) {
    worlds.length = 0;
    for (const w of settings.worlds) worlds.push({ id: w.id, name: w.name || w.id, objects: Array.isArray(w.objects) ? w.objects : [] });
    _nextWorldId = worlds.reduce((m, w) => {
      const n = parseInt(String(w.id).replace('world_', ''), 10);
      return Number.isFinite(n) && n >= m ? n + 1 : m;
    }, _nextWorldId);
  }
  if (settings.activeWorldId && worlds.some(w => w.id === settings.activeWorldId)) {
    activeWorldId = settings.activeWorldId;
  } else {
    activeWorldId = worlds[0]?.id || 'world_1';
  }
  // Restore fog
  if (settings.fog) {
    fogSettings.enabled = settings.fog.enabled !== false;
    fogSettings.mode = settings.fog.mode === 'linear' ? 'linear' : 'exp2';
    fogSettings.color = Number.isFinite(settings.fog.color) ? settings.fog.color : 0x87ceeb;
    fogSettings.density = Number.isFinite(settings.fog.density) ? settings.fog.density : 0.0008;
    fogSettings.near = Number.isFinite(settings.fog.near) ? settings.fog.near : 10;
    fogSettings.far = Number.isFinite(settings.fog.far) ? settings.fog.far : 500;
    fogSettings.brightness = Number.isFinite(settings.fog.brightness) ? settings.fog.brightness : 1;
  }
  applyFogSettings();
  syncFogUI();
  // Restore FOV
  if (settings.fov) {
    editorFov = THREE.MathUtils.clamp(Number.isFinite(settings.fov.editor) ? settings.fov.editor : 60, 30, 150);
    playtestFov = THREE.MathUtils.clamp(Number.isFinite(settings.fov.playtest) ? settings.fov.playtest : 75, 30, 150);
    editorCam.fov = editorFov;
  syncFovUI();
    editorCam.updateProjectionMatrix();
  }
  refreshWorldUI();
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
  customFonts.length = 0;
  if (Array.isArray(settings.customFonts)) {
    for (const entry of settings.customFonts) {
      if (entry && entry.name && entry.dataUrl) {
        customFonts.push({ name: String(entry.name), dataUrl: String(entry.dataUrl) });
        _registerCustomFont(entry);
      }
    }
  }
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
  setCustomSculptSkinsMap(settings.customSculptSkins || {});
  setSkeletonDefinitionsMap(settings.skeletonDefinitions || {});
  // Restore keybinds
  if (settings.keybinds) {
    Object.assign(keybinds, DEFAULT_KEYBINDS, settings.keybinds);
    syncKeybindButtons();
  }
  loadCustomObjectTemplates(settings.customObjectTemplates || []);
  ensureControlFunctionGroups();
  refreshVarPanel();
  refreshBoolPanel();
  refreshPlayerProfileUI();
  refreshControlFunctionsUI();
}

function serializeScene() {
  // Serialize current scene objects (active world)
  const currentObjs = sceneObjects.map(m => {
    const o = {
      type:       m.userData.type,
      position:   m.position.toArray(),
      quaternion: m.quaternion.toArray(),
      scale:      m.scale.toArray(),
      color:      m.material.color.getHex(),
      solid:      !!m.userData.solid,
      solidness:  clampMeshSolidness(m.userData.solidness ?? 1),
      opacity:    clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1),
      world:      m.userData.world || 'world_1',
    };
    if (m.userData.hiddenInGame) o.hiddenInGame = true;
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
    if (m.userData.teleportConfig) {
      o.teleportConfig = normalizeTeleportConfig(m.userData.teleportConfig);
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
    if (m.userData.type === 'joint' && m.userData.jointConfig) {
      o.jointConfig = normalizeJointConfig(m.userData.jointConfig);
    }
    if (m.userData.type === 'skeleton' && m.userData.skeletonConfig) {
      o.skeletonConfig = normalizeSkeletonConfig(m.userData.skeletonConfig);
    }
    if (m.userData.type === 'terrain' && m.userData.terrainConfig) {
      o.terrainConfig = {
        segments: m.userData.terrainConfig.segments,
        terrainSize: m.userData.terrainConfig.terrainSize,
        heightmap: Array.from(m.userData.terrainConfig.heightmap),
      };
    }
    if (m.userData._texturePattern) {
      o.texturePattern = { ...m.userData._texturePattern };
    }
    if (m.userData.textConfig) {
      o.textConfig = normalizeTextConfig(m.userData.textConfig);
    }
    if (m.userData.screenConfig) {
      o.screenConfig = normalizeScreenConfig(m.userData.screenConfig);
    }
    if (m.userData.cameraConfig) {
      o.cameraConfig = normalizeCameraConfig(m.userData.cameraConfig);
    }
    if (m.userData.type === 'npc' && m.userData.npcConfig) {
      o.npcConfig = normalizeNpcConfig(m.userData.npcConfig);
    }
    if (m.userData.metalness !== undefined) o.metalness = m.userData.metalness;
    if (m.userData.roughness !== undefined) o.roughness = m.userData.roughness;
    if (m.userData._hasCustomGeometry) {
      o.customGeometry = _serializeBufferGeometry(m.geometry);
    }
    return o;
  });
  // Combine with stored objects from other worlds
  const otherWorldObjs = [];
  for (const w of worlds) {
    if (w.id === activeWorldId) continue;
    if (Array.isArray(w.objects)) otherWorldObjs.push(...w.objects);
  }
  return [...currentObjs, ...otherWorldObjs];
}

function _isNumArray(arr, len) {
  return Array.isArray(arr) && arr.length === len && arr.every(v => Number.isFinite(v));
}

function deserializeObject(d) {
  if (!d || !DEFS[d.type]) {
    console.warn('deserializeObject: skipping unknown or invalid type:', d?.type);
    return null;
  }
  // Validate core transform arrays before applying
  if (d.position && !_isNumArray(d.position, 3)) { console.warn('deserializeObject: invalid position, skipping:', d.position); return null; }
  if (d.quaternion && !_isNumArray(d.quaternion, 4)) { console.warn('deserializeObject: invalid quaternion, skipping:', d.quaternion); return null; }
  if (d.scale) {
    if (!_isNumArray(d.scale, 3)) { console.warn('deserializeObject: invalid scale, skipping:', d.scale); return null; }
    if (d.scale.some(v => v === 0)) { console.warn('deserializeObject: zero scale component, fixing'); d.scale = d.scale.map(v => v === 0 ? 1 : v); }
  }
  const mesh = createMesh(d.type, false, {
    lightIntensity: d.lightIntensity,
    shapeParams: d.shapeParams,
    opacity: d.opacity,
  });
  if (Array.isArray(d.position))  mesh.position.fromArray(d.position);
  if (Array.isArray(d.quaternion)) mesh.quaternion.fromArray(d.quaternion);
  if (Array.isArray(d.scale))     mesh.scale.fromArray(d.scale);
  if (d.color !== undefined) mesh.material.color.setHex(d.color);
  if (d.solid !== undefined) mesh.userData.solid = d.solid;
  if (d.world) mesh.userData.world = d.world;
  if (d.collisionMode === 'geometry') mesh.userData.collisionMode = 'geometry';
  if (d.hitboxConfig) mesh.userData.hitboxConfig = normalizeHitboxConfig(d.hitboxConfig);
  if (d.solidness !== undefined) mesh.userData.solidness = clampMeshSolidness(parseFloat(d.solidness));
  if (d.opacity !== undefined) setMeshOpacity(mesh, parseFloat(d.opacity));
  if (d.metalness !== undefined) { mesh.material.metalness = parseFloat(d.metalness); mesh.userData.metalness = mesh.material.metalness; }
  if (d.roughness !== undefined) { mesh.material.roughness = parseFloat(d.roughness); mesh.userData.roughness = mesh.material.roughness; }
  if (d.traction !== undefined) mesh.userData.traction = !!d.traction;
  if (d.hiddenInGame) mesh.userData.hiddenInGame = true;
  if (d.label) mesh.userData.label = d.label;
  if (d.groups !== undefined || d.group !== undefined) {
    setMeshGroups(mesh, d.groups ?? d.group);
  }
  if (d.editorGroupId) mesh.userData.editorGroupId = d.editorGroupId;
  if (d.triggerRules) mesh.userData.triggerRules = { ...d.triggerRules };
  if (d.movementPath) mesh.userData.movementPath = normalizeMovementPathConfig(d.movementPath);
  if (d.checkpointConfig) mesh.userData.checkpointConfig = normalizeCheckpointConfig(d.checkpointConfig);
  if (d.teleportConfig) mesh.userData.teleportConfig = normalizeTeleportConfig(d.teleportConfig);
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
  if (d.jointConfig && d.type === 'joint') mesh.userData.jointConfig = normalizeJointConfig(d.jointConfig);
  if (d.skeletonConfig && d.type === 'skeleton') mesh.userData.skeletonConfig = normalizeSkeletonConfig(d.skeletonConfig);
  if (d.terrainConfig && d.type === 'terrain') {
    const tc = d.terrainConfig;
    const seg = tc.segments ?? 64;
    mesh.userData.terrainConfig = {
      segments: seg,
      terrainSize: tc.terrainSize ?? 20,
      heightmap: new Float32Array(Array.isArray(tc.heightmap) ? tc.heightmap : (seg + 1) * (seg + 1)),
    };
    _applyHeightmapToMesh(mesh);
  }
  if (d.texturePattern) {
    applyTexturePaint(mesh, d.texturePattern.pattern, d.texturePattern.color1, d.texturePattern.color2, d.texturePattern.scale);
  }
  if (d.textConfig && (d.type === 'text' || d.type === 'text3d')) {
    mesh.userData.textConfig = normalizeTextConfig(d.textConfig);
    _applyTextTexture(mesh);
  }
  if (d.screenConfig && d.type === 'screen') {
    mesh.userData.screenConfig = normalizeScreenConfig(d.screenConfig);
    _applyScreenTexture(mesh);
  }
  if (d.cameraConfig && d.type === 'camera') {
    mesh.userData.cameraConfig = normalizeCameraConfig(d.cameraConfig);
  }
  if (d.npcConfig && d.type === 'npc') {
    mesh.userData.npcConfig = normalizeNpcConfig(d.npcConfig);
    _applyNpcAppearance(mesh);
  }
  if (d.customGeometry) {
    const restoredGeo = _deserializeBufferGeometry(d.customGeometry);
    setMeshGeometry(mesh, restoredGeo);
    mesh.userData._hasCustomGeometry = true;
    mesh.userData.collisionMode = 'geometry';
  }
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
  _stashCurrentWorld(); // ensure settings.worlds[active].objects matches exported objects
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
  const after = (parsed.objects ?? []).map(deserializeObject).filter(Boolean);
  after.forEach(addToScene);
  // Update editor group ID counter to avoid collisions
  for (const m of after) {
    const gid = m.userData.editorGroupId;
    if (gid) { const n = parseInt(String(gid).replace('eg_', ''), 10); if (n >= _nextEditorGroupId) _nextEditorGroupId = n + 1; }
  }
  applySceneSettings(parsed.settings);
  // Distribute objects: only active world stays in scene, others go to world stores
  _distributeObjectsToWorlds();
  refreshWorldUI();
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
  return _storageCache.projects;
}

function setStoredProjects(projects) {
  _storageCache.projects = Array.isArray(projects) ? projects : [];
  _flushProjects().catch(err => {
    alert('Failed to persist projects to storage: ' + err.message);
  });
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
    customSculptSkins: serializeCustomSculptSkins(),
    customObjectTemplates: serializeCustomObjectTemplates(),
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
    if (s.customSculptSkins && typeof s.customSculptSkins === 'object') {
      setCustomSculptSkinsMap(s.customSculptSkins);
    }
  } catch (err) { console.warn('[Settings] Failed to apply scene settings (corrupt data?):', err); }
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
  _stashCurrentWorld();
  return JSON.stringify({ version: 2, settings: serializeSettings(), objects: serializeScene() });
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
    rotateKeepUpright: false,
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
    pathCommand: 'start',
    playerGroupMode: 'set',
    playerGroupValue: 'default',
    setVarName: '',
    setVarOp: '=',
    setVarValueType: 'digits',
    setVarValue: 0,
    setVarValueVar: '',
    setBoolName: '',
    setBoolValue: true,
    playerStatKey: 'health',
    playerStatOp: '=',
    playerStatValue: 100,
    playerStatTarget: '',
    playerStatTargetType: 'name',
    teleportMode: 'coords',
    teleportCoords: [0, 0, 0],
    teleportWorldId: '',
    teleportTargetRef: '',
    skelAnimCommand: 'play',
    skelAnimClip: '',
    skelAnimSpeed: 1,
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
    rotateKeepUpright: config.rotateKeepUpright === true,
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
    pathCommand: PATH_CONTROL_COMMANDS.includes(config.pathCommand) ? config.pathCommand : base.pathCommand,
    playerGroupMode: CONTROL_PLAYER_GROUP_MODES.includes(config.playerGroupMode) ? config.playerGroupMode : base.playerGroupMode,
    playerGroupValue: String(config.playerGroupValue ?? '').trim() || base.playerGroupValue,
    setVarName: String(config.setVarName ?? '').trim(),
    setVarOp: ['=', '+', '-', '*', '/'].includes(config.setVarOp) ? config.setVarOp : '=',
    setVarValueType: config.setVarValueType === 'var' ? 'var' : 'digits',
    setVarValue: Number.isFinite(parseFloat(config.setVarValue)) ? parseFloat(config.setVarValue) : 0,
    setVarValueVar: String(config.setVarValueVar ?? '').trim(),
    setBoolName: String(config.setBoolName ?? '').trim(),
    setBoolValue: config.setBoolValue === 'toggle' ? 'toggle' : !!config.setBoolValue,
    playerStatKey: PLAYER_STAT_KEYS.includes(config.playerStatKey) ? config.playerStatKey : 'health',
    playerStatOp: PLAYER_STAT_OPS.includes(config.playerStatOp) ? config.playerStatOp : '=',
    playerStatValue: Number.isFinite(parseFloat(config.playerStatValue)) ? parseFloat(config.playerStatValue) : 0,
    playerStatTarget: String(config.playerStatTarget ?? '').trim(),
    playerStatTargetType: config.playerStatTargetType === 'group' ? 'group' : 'name',
    teleportMode: TELEPORT_MODES.includes(config.teleportMode) ? config.teleportMode : 'coords',
    teleportCoords: normalizeVec(config.teleportCoords ?? [0, 0, 0]),
    teleportWorldId: String(config.teleportWorldId ?? '').trim(),
    teleportTargetRef: String(config.teleportTargetRef ?? '').trim(),
    skelAnimCommand: SKELETON_ANIM_COMMANDS.includes(config.skelAnimCommand) ? config.skelAnimCommand : 'play',
    skelAnimClip: String(config.skelAnimClip ?? '').trim(),
    skelAnimSpeed: Math.max(0, Number.isFinite(parseFloat(config.skelAnimSpeed)) ? parseFloat(config.skelAnimSpeed) : 1),
  };
}

function createDefaultControlFunction(groupId = '') {
  return {
    name: '',
    groupId: String(groupId ?? '').trim(),
    alwaysActive: false,
    actions: [createDefaultFunctionAction()],
  };
}

function normalizeControlFunction(fn = {}) {
  const actions = Array.isArray(fn.actions) ? fn.actions.map(normalizeFunctionAction) : [];
  return {
    name: String(fn.name ?? '').trim(),
    groupId: String(fn.groupId ?? '').trim(),
    alwaysActive: fn.alwaysActive === true,
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
  let listEl = mainMenuProjectList || document.getElementById('mm-project-list');
  if (!listEl) {
    const menu = document.getElementById('main-menu');
    if (menu) {
      listEl = document.createElement('div');
      listEl.id = 'mm-project-list';
      const projectsSection = menu.querySelector('.mm-projects');
      if (projectsSection) {
        projectsSection.appendChild(listEl);
      } else {
        menu.appendChild(listEl);
      }
      // Wire click handlers on the new element
      listEl.addEventListener('click', e => {
        const delBtn = e.target.closest('[data-project-del]');
        if (delBtn) {
          deleteProjectById(delBtn.dataset.projectDel);
          return;
        }
        const row = e.target.closest('[data-project-id]');
        if (row) openProjectById(row.dataset.projectId);
      });
    } else {
      return;
    }
  }
  let projects;
  try {
    projects = getStoredProjects().sort((a, b) =>
      (new Date(b.updatedAt || 0).getTime() || 0) - (new Date(a.updatedAt || 0).getTime() || 0)
    );
  } catch (err) {
    listEl.innerHTML = '<div class="mm-empty" style="color:red">Error loading projects from localStorage.</div>';
    return;
  }
  if (!projects.length) {
    listEl.innerHTML = '<div class="mm-empty">No saved projects yet. Open Studio and use Save.</div>';
    return;
  }
  listEl.innerHTML = projects.map(p => {
    const raw = p.payload || p.data;
    const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    const objCount = parsed?.objects?.length ?? 0;
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
  return _storageCache.runtimeLibrary
    .map(normalizeRuntimeLibraryEntry)
    .filter(Boolean)
    .sort((a, b) => (new Date(b.updatedAt).getTime() || 0) - (new Date(a.updatedAt).getTime() || 0));
}

function setRuntimeLibrary(entries) {
  try {
    const normalized = Array.isArray(entries)
      ? entries.map(normalizeRuntimeLibraryEntry).filter(Boolean)
      : [];
    _storageCache.runtimeLibrary = normalized;
    _flushRuntimeLibrary();
    return true;
  } catch (err) {
    console.error(err);
    alert('Unable to save runtime game library: ' + err.message);
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
  // Flush any pending auto-save before leaving studio, then stop the timer
  if (_restoreDirty) _flushRestore();
  if (_restoreTimer) { clearTimeout(_restoreTimer); _restoreTimer = null; }
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
  syncSunInputs();
  updateSunSky();
  onResize();
  refreshStatus();
  _offerRestore();
}

function resetSceneForNewProject() {
  if (state.isPlaytest) stopPlaytest();
  selectObject(null);
  const toRemove = [...sceneObjects];
  toRemove.forEach(removeFromScene);
  undoStack.length = 0;
  redoStack.length = 0;
  // Clear project-scoped collections so nothing leaks between projects
  controlFunctions.length = 0;
  _controlFunctionStates.clear();
  conditionalTriggers.length = 0;
  gameVars.length = 0;
  gameBools.length = 0;
  // Reset all project-level state to defaults so nothing leaks between projects
  applySceneSettings({});
  // Reset worlds to a single default world
  worlds.length = 0;
  worlds.push({ id: 'world_1', name: 'World 1', objects: [] });
  activeWorldId = 'world_1';
  _nextWorldId = 2;
  refreshWorldUI();
  refreshControlFunctionsUI();
  syncUndoUI();
  refreshStatus();
}

function startNewProject() {
  currentProjectId = null;
  currentProjectName = '';
  resetSceneForNewProject();
  _pendingRestore = null;
  clearRestoreSlot();
  syncSunInputs();
  updateSunSky();
  applyFogSettings();
  showStudio();
}

function openProjectById(projectId) {
  const project = getStoredProjects().find(p => p.id === projectId);
  if (!project) return;
  const raw = project.payload || project.data;
  const payload = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : null);
  // Clear previous project state before loading new one
  resetSceneForNewProject();
  currentProjectId = project.id;
  currentProjectName = project.name || '';
  // Clear any pending restore so it doesn't offer to overwrite the project we just opened
  _pendingRestore = null;
  clearRestoreSlot();
  if (!payload) {
    console.warn('Project has no payload, opening empty.');
  } else {
    try {
      loadLevelJSON(payload, { pushHistory: false });
    } catch (err) {
      console.error('Failed to load project:', err);
      alert('Failed to load project: ' + (err.message || err));
    }
  }
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

async function saveProjectToLibrary() {
  try {
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

    _storageCache.projects = projects;
    await _flushProjects();
    currentProjectId = id;
    currentProjectName = name;
    clearRestoreSlot();
    renderProjectLibrary();
  } catch (err) {
    alert('Failed to save project: ' + err.message);
  }
}

// ─── Playtest ─────────────────────────────────────────────────────────────────
let fpsLocked   = false;
let fpsYaw      = 0;
let fpsPitch    = 0;
let fpsHits     = 0;
let fpsVelY     = 0;
let fpsGrounded = false;
let fpsSprinting = false;
let fpsSprintStamina = 1;           // 0..1, fraction of sprint remaining
let fpsWasSprintingOnGround = false; // true if player was sprinting when they left the ground
let fpsAirDashRemaining = 0;        // seconds of air dash left
let fpsAirDashUsed = false;         // true once air dash has been consumed this jump
let fpsHealth      = 100;
let fpsFallStartY  = null;
let fpsSpawnPos    = new THREE.Vector3();
let fpsSpawnYaw    = 0;
let fpsSpawnPitch  = 0;
let fpsSpawnProtectTimer = 0;
let fpsSpawnLanded = true;
let fpsCrouching = false;
let _fpsCurrentHeight = 1.75;
let _fpsCurrentEyeHeight = 1.6;
const CROUCH_TRANSITION_SPEED = 10; // units/sec (smooth crouch transition)
let _playtestWorldId = 'world_1';
let _prePlaytestWorldId = 'world_1';
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
const _pathTriggerMoveOffsets = new Map(); // mesh.uuid -> Vector3 (trigger move offset for path-active meshes)

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

  // Pre-compute which editor groups have an active/paused movement path so
  // we don't reset group members that are being driven by path animations.
  const _pathActiveGroups = new Set();
  for (const [mesh] of basePositions) {
    const gid = mesh.userData.editorGroupId;
    if (!gid) continue;
    const ps = _movementPathStates.get(mesh.uuid);
    if (ps && (ps.active || ps.paused)) _pathActiveGroups.add(gid);
  }

  for (const [mesh, basePos] of basePositions) {
    // For path-active meshes/groups, store the trigger move offset so the path
    // system can apply it as a group offset (e.g. elevator on a moving spaceship).
    const pathSt = _movementPathStates.get(mesh.uuid);
    const gid = mesh.userData.editorGroupId;
    const isPathActive = (pathSt && (pathSt.active || pathSt.paused)) || (gid && _pathActiveGroups.has(gid));
    if (isPathActive) {
      const offset = offsetsByMesh.get(mesh);
      if (offset) _pathTriggerMoveOffsets.set(mesh.uuid, offset.clone());
      continue;
    }

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
          if (!st.keepUpright) mesh.quaternion.premultiply(_triggerRotateQuat);
        }
      } else {
        for (const mesh of st.targets) {
          if (!basePositions.has(mesh)) continue;
          if (!st.keepUpright) mesh.quaternion.multiply(_triggerRotateQuat);
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
        if (!st.keepUpright) mesh.quaternion.premultiply(_triggerRotateQuat);
      }
    } else {
      for (const mesh of st.targets) {
        if (!basePositions.has(mesh)) continue;
        if (!st.keepUpright) mesh.quaternion.multiply(_triggerRotateQuat);
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
        keepUpright: action.rotateKeepUpright === true,
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
    } else if (action.actionType === 'path') {
      const targets = triggerMoveTargets(action.refType, action.refValue);
      // Ensure all editor-group members have base positions saved
      const allTargets = new Set(targets);
      for (const t of targets) {
        const gid = t.userData.editorGroupId;
        if (gid) {
          for (const m of sceneObjects) {
            if (m.userData.editorGroupId === gid) allTargets.add(m);
          }
        }
      }
      ensureSimBasePositions([...allTargets]);
      for (const target of targets) startMovementPath(target, { reset: true });
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
  _movementPathStates.clear();
  _pathTriggerMoveOffsets.clear();
  clearJointRuntimeStates();
  _simActive = false;
  refreshControlFunctionsUI();
}

function updateSimAnimations(nowSeconds) {
  _pathTriggerMoveOffsets.clear();
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
  if (!anySimRunning) {
    for (const [, st] of _movementPathStates) {
      if (st.active && !st.paused) { anySimRunning = true; break; }
    }
  }
  if (!anySimRunning && _simLightStates.size === 0) {
    // Keep positions as-is (final state) but mark inactive
    _simActive = false;
  }
}
const _tractionCarry = new THREE.Vector3();
const _tractionLocalPoint = new THREE.Vector3();
const _tractionWorldPoint = new THREE.Vector3();
let _tractionCarriedThisFrame = false; // true when traction carry moved the player vertically
let _tractionSupportMesh = null;        // traction platform the player is standing on (or null)
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
const _pathFacingDir = new THREE.Vector3();
const _pathFacingQuat = new THREE.Quaternion();
const _pathFrontVec = new THREE.Vector3();

function getPlayHintBaseHtml() {
  const fwd = keybindLabel(keybinds.forward);
  const bwd = keybindLabel(keybinds.backward);
  const lt  = keybindLabel(keybinds.left);
  const rt  = keybindLabel(keybinds.right);
  const spr = keybindLabel(keybinds.sprint);
  const jmp = keybindLabel(keybinds.jump);
  const cro = keybindLabel(keybinds.crouch);
  const sh  = keybindLabel(keybinds.shoot);
  const tm  = keybindLabel(keybinds.toggleMouse);
  const moveKeys = `${fwd}${lt}${bwd}${rt}`;
  if (runtimeMode) {
    return `${moveKeys} · Move &nbsp;│&nbsp; ${spr} · Sprint &nbsp;│&nbsp; ${jmp} · Jump &nbsp;│&nbsp; ${cro} · Crouch &nbsp;│&nbsp; Mouse · Look &nbsp;│&nbsp; ${sh} · Shoot &nbsp;│&nbsp; ${tm} · Free Cursor &nbsp;│&nbsp; P · Pause`;
  }
  return `${moveKeys} · Move &nbsp;│&nbsp; ${spr} · Sprint &nbsp;│&nbsp; ${jmp} · Jump &nbsp;│&nbsp; ${cro} · Crouch &nbsp;│&nbsp; Mouse · Look &nbsp;│&nbsp; ${sh} · Shoot &nbsp;│&nbsp; ${tm} · Free Cursor &nbsp;│&nbsp; Esc · Exit`;
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

// ─── Fast terrain heightmap sampler (avoids raycasting) ──────────────────────
const _terrainInvMat = new THREE.Matrix4();
const _terrainLocalPt = new THREE.Vector3();
const _terrainWorldPt = new THREE.Vector3();

function _sampleTerrainHeightWorld(mesh, worldX, worldZ) {
  const tc = mesh.userData.terrainConfig;
  if (!tc || !tc.heightmap || mesh.userData._hasCustomGeometry) return null;
  mesh.updateMatrixWorld(false);
  _terrainInvMat.copy(mesh.matrixWorld).invert();
  _terrainLocalPt.set(worldX, 0, worldZ);
  _terrainLocalPt.applyMatrix4(_terrainInvMat);
  const seg = tc.segments;
  const sz = tc.terrainSize;
  const hm = tc.heightmap;
  const col = ((_terrainLocalPt.x + sz / 2) / sz) * seg;
  const row = ((_terrainLocalPt.z + sz / 2) / sz) * seg;
  if (col < -0.5 || col > seg + 0.5 || row < -0.5 || row > seg + 0.5) return null;
  const col0 = Math.max(0, Math.min(seg - 1, Math.floor(col)));
  const row0 = Math.max(0, Math.min(seg - 1, Math.floor(row)));
  const col1 = Math.min(col0 + 1, seg);
  const row1 = Math.min(row0 + 1, seg);
  const fx = Math.max(0, Math.min(1, col - col0));
  const fz = Math.max(0, Math.min(1, row - row0));
  const stride = seg + 1;
  const h00 = hm[row0 * stride + col0] || 0;
  const h10 = hm[row0 * stride + col1] || 0;
  const h01 = hm[row1 * stride + col0] || 0;
  const h11 = hm[row1 * stride + col1] || 0;
  const h = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
  _terrainWorldPt.set(_terrainLocalPt.x, h, _terrainLocalPt.z);
  _terrainWorldPt.applyMatrix4(mesh.matrixWorld);
  return _terrainWorldPt.y;
}

function _isTerrainCollider(c) {
  const m = c.members[0];
  return m.userData.type === 'terrain' && m.userData.terrainConfig && !m.userData._hasCustomGeometry;
}

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
  let idx = 0;
  for (const m of sceneObjects) {
    if (!isSolidMesh(m)) continue;
    if (idx >= _solidColliders.length) {
      _solidColliders.push({ members: [m], aabb: new THREE.Box3() });
    }
    const c = _solidColliders[idx];
    c.members[0] = m;
    c.members.length = 1;
    computeMeshCollisionAABB(m, c.aabb);
    idx++;
  }
  _solidColliders.length = idx;
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

    // Fast terrain heightmap test: check if player body intersects terrain surface
    if (_isTerrainCollider(c)) {
      const th = _sampleTerrainHeightWorld(c.members[0], pos.x, pos.z);
      if (th !== null && th > pos.y && th < pos.y + pH) return true;
      continue;
    }

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
  const bodyTop = pos.y + _fpsCurrentHeight;
  for (const c of _solidColliders) {
    if (colliderIgnored(c, ignoreMeshes)) continue;
    const aabb = c.aabb;
    if (pos.x + PLAYER_RADIUS <= aabb.min.x) continue;
    if (pos.x - PLAYER_RADIUS >= aabb.max.x) continue;
    if (pos.z + PLAYER_RADIUS <= aabb.min.z) continue;
    if (pos.z - PLAYER_RADIUS >= aabb.max.z) continue;
    if (bodyTop <= aabb.min.y) continue;
    if (bodyBot >= aabb.max.y) continue;

    // Fast terrain heightmap test
    if (_isTerrainCollider(c)) {
      const th = _sampleTerrainHeightWorld(c.members[0], pos.x, pos.z);
      if (th !== null && th > bodyBot && th < bodyTop) return true;
      continue;
    }

    if (getMeshCollisionMode(c.members[0]) !== 'geometry') return true;
    if (colliderIntersectsPlayerGeometry(c, pos, bodyBot, bodyTop)) return true;
  }
  return false;
}

/** Raycast-based ground detection — works with rotated meshes / slopes. */
function findGroundHeight(pos, ignoreMeshes = null) {
  let ground = 0;
  if (!_solidColliders.length) return ground;
  const offsets = [[0,0],[PLAYER_RADIUS*.7,0],[-PLAYER_RADIUS*.7,0],[0,PLAYER_RADIUS*.7],[0,-PLAYER_RADIUS*.7]];
  for (const [ox, oz] of offsets) {
    _physOrigin.set(pos.x + ox, pos.y + STEP_HEIGHT + 1, pos.z + oz);
    _physRay.set(_physOrigin, _downDir);
    _physRay.far  = Infinity;
    _physRay.near = 0;

    for (const c of _solidColliders) {
      if (colliderIgnored(c, ignoreMeshes)) continue;
      const aabb = c.aabb;
      if (_physOrigin.x < aabb.min.x - PLAYER_RADIUS || _physOrigin.x > aabb.max.x + PLAYER_RADIUS) continue;
      if (_physOrigin.z < aabb.min.z - PLAYER_RADIUS || _physOrigin.z > aabb.max.z + PLAYER_RADIUS) continue;
      if (_physOrigin.y < aabb.min.y) continue;

      // Fast path: terrain heightmap sampling (avoids expensive raycasting)
      if (_isTerrainCollider(c)) {
        const th = _sampleTerrainHeightWorld(c.members[0], _physOrigin.x, _physOrigin.z);
        if (th !== null && th <= pos.y + STEP_HEIGHT + 0.01) {
          ground = Math.max(ground, th);
        }
        continue;
      }

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

const _pushHori = new THREE.Vector3();
const _pushEscape = new THREE.Vector3();

/**
 * If the player is stuck inside static solid geometry, push them out along
 * the shortest escape axis in a single frame.
 */
function resolveStaticPenetration() {
  if (!collidesAt(fpsPos)) return;
  const pH = _fpsCurrentHeight;
  setPlayerAABB(_playerAABB, fpsPos, pH);
  // Find shortest escape among all overlapping solids
  let bestDist = Infinity;
  let bestAxis = 'x';
  let bestSign = 1;
  let bestVal = 0;
  for (const c of _solidColliders) {
    const aabb = c.aabb;
    if (_playerAABB.max.x <= aabb.min.x || _playerAABB.min.x >= aabb.max.x) continue;
    if (_playerAABB.max.z <= aabb.min.z || _playerAABB.min.z >= aabb.max.z) continue;
    if (_playerAABB.max.y <= aabb.min.y || _playerAABB.min.y >= aabb.max.y) continue;
    // Compute overlap on each axis
    const overlapPX = _playerAABB.max.x - aabb.min.x; // push left (-x)
    const overlapNX = aabb.max.x - _playerAABB.min.x; // push right (+x)
    const overlapPZ = _playerAABB.max.z - aabb.min.z; // push back (-z)
    const overlapNZ = aabb.max.z - _playerAABB.min.z; // push forward (+z)
    const overlapPY = _playerAABB.max.y - aabb.min.y; // push down (-y)
    const overlapNY = aabb.max.y - _playerAABB.min.y; // push up (+y)
    const candidates = [
      { axis: 'x', sign: -1, d: overlapPX },
      { axis: 'x', sign:  1, d: overlapNX },
      { axis: 'z', sign: -1, d: overlapPZ },
      { axis: 'z', sign:  1, d: overlapNZ },
      { axis: 'y', sign: -1, d: overlapPY },
      { axis: 'y', sign:  1, d: overlapNY },
    ];
    for (const c of candidates) {
      if (c.d > 0 && c.d < bestDist) {
        bestDist = c.d;
        bestAxis = c.axis;
        bestSign = c.sign;
        bestVal = c.d;
      }
    }
  }
  if (bestDist === Infinity) return;
  // Apply push with a small margin
  const margin = 0.02;
  const push = (bestVal + margin) * bestSign;
  if (bestAxis === 'x') fpsPos.x += push;
  else if (bestAxis === 'z') fpsPos.z += push;
  else fpsPos.y += push;
}

function resolveMovingSolidPushes(tractionIgnore) {
  for (const mesh of sceneObjects) {
    if (!isSolidMesh(mesh)) continue;
    if (mesh.userData._playtestHidden || !mesh.visible) continue;
    if (mesh.userData.traction) continue;
    if (tractionIgnore && tractionIgnore.has(mesh)) continue;

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

      _pushHori.set(stepVec.x, 0, stepVec.z);
      movePlayerHorizontal(_pushHori, ignoreMeshes);
      movePlayerVertical(stepVec.y, ignoreMeshes);

      setPlayerAABB(_playerAABB, fpsPos);
      if (_playerAABB.intersectsBox(steppedAABB)) {
        _pushEscape.set(0, 0, 0);
        if (stepVec.x !== 0) _pushEscape.x = stepVec.x > 0 ? (steppedAABB.max.x - _playerAABB.min.x) : (steppedAABB.min.x - _playerAABB.max.x);
        if (stepVec.z !== 0) _pushEscape.z = stepVec.z > 0 ? (steppedAABB.max.z - _playerAABB.min.z) : (steppedAABB.min.z - _playerAABB.max.z);
        if (stepVec.y !== 0) _pushEscape.y = stepVec.y > 0 ? (steppedAABB.max.y - _playerAABB.min.y) : (steppedAABB.min.y - _playerAABB.max.y);
        _pushHori.set(_pushEscape.x, 0, _pushEscape.z);
        movePlayerHorizontal(_pushHori, ignoreMeshes);
        movePlayerVertical(_pushEscape.y, ignoreMeshes);
      }
    }
  }
}

function getTractionSupportMesh() {
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
  _tractionCarriedThisFrame = false;
  _tractionSupportMesh = null;
  const supportMesh = getTractionSupportMesh() || getTractionSupportMeshFromPreviousFrame();
  if (!supportMesh) return null;
  _tractionSupportMesh = supportMesh;

  const prevPos = _playtestPrevPositions.get(supportMesh);
  const prevQuat = _playtestPrevRotations.get(supportMesh);
  if (!prevPos) return null;

  const ignore = buildCollisionIgnoreSet(supportMesh);

  if (prevQuat) {
    _tractionPrevQuat.copy(prevQuat).invert();
    _tractionLocalPoint.copy(fpsPos).sub(prevPos).applyQuaternion(_tractionPrevQuat);
    _tractionWorldPoint.copy(_tractionLocalPoint).applyQuaternion(supportMesh.quaternion).add(supportMesh.position);
    _tractionCarry.subVectors(_tractionWorldPoint, fpsPos);
  } else {
    _tractionCarry.set(
      supportMesh.position.x - prevPos.x,
      supportMesh.position.y - prevPos.y,
      supportMesh.position.z - prevPos.z,
    );
  }
  if (_tractionCarry.lengthSq() <= 1e-8) return ignore;

  // Apply vertical carry component first (platform going up/down)
  if (Math.abs(_tractionCarry.y) > 1e-6) {
    _next.copy(fpsPos);
    _next.y += _tractionCarry.y;
    if (!collidesAt(_next, undefined, ignore)) {
      fpsPos.y = _next.y;
      _tractionCarriedThisFrame = true;
      fpsVelY = 0;
    } else if (_tractionCarry.y > 0) {
      // Platform moving up but ceiling blocks full carry — binary-search
      // for the highest safe Y so the player isn't left inside the platform.
      let lo = 0, hi = _tractionCarry.y;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        _next.y = fpsPos.y + mid;
        if (collidesAt(_next, undefined, ignore)) hi = mid; else lo = mid;
      }
      if (lo > 1e-6) {
        fpsPos.y += lo;
        _tractionCarriedThisFrame = true;
        fpsVelY = 0;
      }
    }
  }

  // Apply horizontal carry with collision checks
  const hSq = _tractionCarry.x * _tractionCarry.x + _tractionCarry.z * _tractionCarry.z;
  if (hSq <= 1e-8) return ignore;

  _next.copy(fpsPos);
  _next.x += _tractionCarry.x;
  _next.z += _tractionCarry.z;
  if (fpsGrounded) {
    const g = findGroundHeight(_next, ignore);
    if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
  }
  if (!collidesWalk(_next, ignore)) {
    if (fpsGrounded && _next.y > fpsPos.y) fpsVelY = 0;
    fpsPos.copy(_next);
    return ignore;
  }

  if (_tractionCarry.x !== 0) {
    _next.copy(fpsPos);
    _next.x += _tractionCarry.x;
    if (fpsGrounded) {
      const g = findGroundHeight(_next, ignore);
      if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
    }
    if (!collidesWalk(_next, ignore)) {
      if (fpsGrounded && _next.y > fpsPos.y) fpsVelY = 0;
      fpsPos.copy(_next);
    }
  }
  if (_tractionCarry.z !== 0) {
    _next.copy(fpsPos);
    _next.z += _tractionCarry.z;
    if (fpsGrounded) {
      const g = findGroundHeight(_next, ignore);
      if (g > _next.y && g <= _next.y + STEP_HEIGHT) _next.y = g;
    }
    if (!collidesWalk(_next, ignore)) {
      if (fpsGrounded && _next.y > fpsPos.y) fpsVelY = 0;
      fpsPos.copy(_next);
    }
  }
  return ignore;
}

function clampPlayerToWorldBorder() {
  if (!worldBorderEnabled) return;
  const minX = Math.min(worldBorderMinX, worldBorderMaxX);
  const maxX = Math.max(worldBorderMinX, worldBorderMaxX);
  const minZ = Math.min(worldBorderMinZ, worldBorderMaxZ);
  const maxZ = Math.max(worldBorderMinZ, worldBorderMaxZ);
  fpsPos.x = THREE.MathUtils.clamp(fpsPos.x, minX, maxX);
  fpsPos.z = THREE.MathUtils.clamp(fpsPos.z, minZ, maxZ);
}

function syncFpsCamera() {
  const fov = _runtimeFovOverride ?? playtestFov;
  if (fpsCam.fov !== fov) { fpsCam.fov = fov; fpsCam.updateProjectionMatrix(); }
  fpsCam.position.set(fpsPos.x, fpsPos.y + _fpsCurrentEyeHeight, fpsPos.z);
  fpsCam.rotation.order = 'YXZ';
  fpsCam.rotation.y = fpsYaw;
  fpsCam.rotation.x = fpsPitch;
}

// ─── Fog ──────────────────────────────────────────────────────────────────────
function applyFogSettings() {
  if (!fogSettings.enabled) {
    scene.fog = null;
    return;
  }
  const b = THREE.MathUtils.clamp(fogSettings.brightness ?? 1, 0, 5);
  const base = new THREE.Color(fogSettings.color);
  const col = base.multiplyScalar(b);
  if (fogSettings.mode === 'linear') {
    scene.fog = new THREE.Fog(col, fogSettings.near, fogSettings.far);
  } else {
    scene.fog = new THREE.FogExp2(col, fogSettings.density);
  }
}
function syncFogUI() {
  if (fogEnabledInput) fogEnabledInput.checked = fogSettings.enabled;
  if (fogColorInput)   fogColorInput.value = '#' + (fogSettings.color >>> 0).toString(16).padStart(6, '0');
  if (fogDensityInput) fogDensityInput.value = fogSettings.density;
  if (fogBrightnessInput) fogBrightnessInput.value = fogSettings.brightness ?? 1;
}

function readFogUI() {
  fogSettings.enabled = !!(fogEnabledInput && fogEnabledInput.checked);
  if (fogColorInput) fogSettings.color = parseInt(fogColorInput.value.replace('#', ''), 16) || 0;
  if (fogDensityInput) fogSettings.density = parseFloat(fogDensityInput.value) || 0.025;
  if (fogBrightnessInput) fogSettings.brightness = parseFloat(fogBrightnessInput.value) || 1;
  applyFogSettings();
  markRestoreDirty();
}

function syncFovUI() {
  if (fovEditorInput) fovEditorInput.value = editorFov;
  if (fovPlaytestInput) fovPlaytestInput.value = playtestFov;
}


// ─── World switching ──────────────────────────────────────────────────────────
function switchToWorld(worldId, options = {}) {
  const target = worlds.find(w => w.id === worldId);
  if (!target) return;

  // In editor: save current world, clear scene, load target world
  if (!state.isPlaytest) {
    _stashCurrentWorld();
    _clearScene();
    activeWorldId = worldId;
    _loadWorldObjects(worldId);
    // Clear the target's store since its objects are now live in scene
    target.objects = [];
    refreshWorldUI();
    refreshStatus();
    return;
  }

  // During playtest: same clear+load swap as editor
  // Restore original positions before stashing so world stores keep clean data
  for (const m of sceneObjects) {
    const basePos = _playtestBasePositions.get(m);
    if (basePos) m.position.copy(basePos);
    const baseQuat = _playtestBaseRotations.get(m);
    if (baseQuat) m.quaternion.copy(baseQuat);
  }
  _stashCurrentWorld();
  _clearScene();
  _playtestWorldId = worldId;
  activeWorldId = worldId;
  _loadWorldObjects(worldId);
  // Clear the target's store since its objects are now live in scene
  const tw = worlds.find(ww => ww.id === worldId);
  if (tw) tw.objects = [];

  // Re-apply playtest setup for newly loaded objects
  for (const m of sceneObjects) {
    _playtestBasePositions.set(m, m.position.clone());
    _playtestBaseRotations.set(m, m.quaternion.clone());
    _playtestPrevPositions.set(m, m.position.clone());
    _playtestPrevRotations.set(m, m.quaternion.clone());
    _playtestPrevAABBs.set(m, new THREE.Box3().setFromObject(m));
    if (m.userData.type === 'target') {
      savedTargetColors.set(m, m.material.color.getHex());
      m.userData._health = m.userData.targetMaxHealth || 0;
      m.userData._dead = false;
    }
    if (m.userData.type === 'light' && m.userData.pointLight) {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.castShadow = false;
      m.userData._playtestHidden = true;
    }
    if (['spawn', 'trigger', 'pivot'].includes(m.userData.type)) {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.userData._playtestHidden = true;
    }
    if (m.userData.hiddenInGame) {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.userData._playtestHidden = true;
    }
    applyCustomSkinToMesh(m);
  }

  // Find spawn in new world
  if (!options.keepPosition) {
    const spawn = sceneObjects.find(m => m.userData.type === 'spawn' && (m.userData.world || 'world_1') === worldId);
    if (spawn) {
      fpsPos.set(spawn.position.x, spawn.position.y - 0.875 + 0.01, spawn.position.z);
      fpsYaw = spawn.rotation.y;
      fpsPitch = 0;
      fpsVelY = 0;
      fpsGrounded = false;
    }
  }
}

// ─── Teleport execution ──────────────────────────────────────────────────────
function resolveWorldId(ref) {
  if (!ref) return null;
  if (worlds.some(w => w.id === ref)) return ref;
  const byName = worlds.find(w => w.name.toLowerCase() === ref.trim().toLowerCase());
  return byName ? byName.id : null;
}

function executeSkeletonAction(action) {
  const cmd = action.skelAnimCommand || 'play';
  const clipName = action.skelAnimClip || '';
  const refType = action.refType || 'group';
  const refValue = action.refValue || '';

  const targets = refType === 'name'
    ? sceneObjects.filter(m => m.userData.type === 'skeleton' && m.userData.label === refValue)
    : sceneObjects.filter(m => m.userData.type === 'skeleton' && (m.userData.groups || [m.userData.group || 'default']).some(g => g === refValue));

  for (const mesh of targets) {
    if (cmd === 'play' && clipName) {
      skeletonPlayAnimation(mesh, clipName);
    } else if (cmd === 'stop') {
      skeletonStopAnimation(mesh);
    } else if (cmd === 'pause') {
      skeletonPauseAnimation(mesh);
    } else if (cmd === 'resume') {
      skeletonResumeAnimation(mesh);
    }
  }
}

function executeTeleportAction(action, callerMesh) {
  const mode = action.teleportMode || 'coords';
  const targetWorld = resolveWorldId(action.teleportWorldId) || _playtestWorldId;

  // Switch world if different
  if (targetWorld !== _playtestWorldId) {
    switchToWorld(targetWorld, { keepPosition: mode !== 'spawn' });
  }

  if (mode === 'coords') {
    const c = action.teleportCoords || [0, 0, 0];
    fpsPos.set(c[0], c[1], c[2]);
    fpsVelY = 0;
    fpsGrounded = false;
  } else if (mode === 'spawn') {
    // Already handled by switchToWorld for cross-world; for same world:
    if (targetWorld === _playtestWorldId) {
      const spawn = sceneObjects.find(m => m.userData.type === 'spawn' && (m.userData.world || 'world_1') === _playtestWorldId);
      if (spawn) {
        fpsPos.set(spawn.position.x, spawn.position.y - 0.875 + 0.01, spawn.position.z);
        fpsYaw = spawn.rotation.y;
        fpsPitch = 0;
        fpsVelY = 0;
        fpsGrounded = false;
      }
    }
  } else if (mode === 'object') {
    const ref = action.teleportTargetRef;
    if (ref) {
      const target = sceneObjects.find(m => (m.userData.label || '').toLowerCase() === ref.toLowerCase());
      if (target) {
        fpsPos.set(target.position.x, target.position.y, target.position.z);
        fpsVelY = 0;
        fpsGrounded = false;
      }
    }
  }

  // Set teleport cooldown for the caller trigger
  if (callerMesh) {
    _teleportCooldowns.set(callerMesh.uuid, true);
  }
}

// ─── World UI refresh (editor) ───────────────────────────────────────────────
function refreshWorldUI() {
  if (!worldsTabBar) return;
  worldsTabBar.innerHTML = worlds.map(w => {
    const active = w.id === activeWorldId;
    const isMain = w.id === (worlds[0]?.id || 'world_1');
    return `<button class="world-tab${active ? ' active' : ''}" data-world-id="${escapeHtml(w.id)}" style="font-size:9px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;background:${active ? 'var(--accent)' : 'var(--surface2)'};color:var(--text);cursor:pointer">${isMain ? '★ ' : ''}${escapeHtml(w.name)}</button>`;
  }).join('');
  // Bind tab clicks + right-click context menu
  worldsTabBar.querySelectorAll('.world-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      switchToWorld(btn.dataset.worldId);
      refreshWorldUI();
    });
    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      showWorldContextMenu(btn.dataset.worldId, e.clientX, e.clientY);
    });
  });
}

function showWorldContextMenu(worldId, x, y) {
  closeWorldContextMenu();
  closeLibraryContextMenu();
  closeKeypadContextMenu();
  const w = worlds.find(ww => ww.id === worldId);
  if (!w) return;
  const isMain = worlds[0]?.id === worldId;
  const canDelete = worlds.length > 1;

  const menu = document.createElement('div');
  menu.style.cssText = 'position:fixed;z-index:20020;min-width:180px;padding:8px;border-radius:10px;border:1px solid var(--border);background:rgba(15,20,27,0.97);box-shadow:0 12px 36px rgba(0,0,0,0.5);backdrop-filter:blur(12px)';
  menu.innerHTML = `
    <div style="font-size:10px;color:var(--muted);padding:2px 4px 8px 4px;letter-spacing:.06em;text-transform:uppercase">${escapeHtml(w.name)}</div>
    <button type="button" data-action="main" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px" ${isMain ? 'disabled' : ''}>★ Set as Main World</button>
    <button type="button" data-action="rename" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px;margin-top:4px">✎ Rename</button>
    <button type="button" data-action="duplicate" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px;margin-top:4px">⧉ Duplicate</button>
    <button type="button" data-action="delete" style="width:100%;justify-content:flex-start;font-size:11px;padding:5px 8px;margin-top:4px;color:${canDelete ? '#f85' : 'var(--muted)'}" ${canDelete ? '' : 'disabled'}>✕ Delete World</button>
  `;
  document.body.appendChild(menu);
  clampFloatingPanelPosition(menu, x + 4, y + 4);
  menu.addEventListener('pointerdown', e => e.stopPropagation());

  menu.querySelector('[data-action="main"]')?.addEventListener('click', () => {
    closeWorldContextMenu();
    const idx = worlds.findIndex(ww => ww.id === worldId);
    if (idx > 0) {
      const [moved] = worlds.splice(idx, 1);
      worlds.unshift(moved);
      refreshWorldUI();
    }
  });

  menu.querySelector('[data-action="rename"]')?.addEventListener('click', () => {
    closeWorldContextMenu();
    const newName = prompt('Rename world:', w.name);
    if (newName && newName.trim()) {
      w.name = newName.trim();
      refreshWorldUI();
    }
  });

  menu.querySelector('[data-action="duplicate"]')?.addEventListener('click', () => {
    closeWorldContextMenu();
    const newId = 'world_' + _nextWorldId++;
    // Get source objects: from scene if active world, else from store
    let sourceData;
    if (worldId === activeWorldId) {
      sourceData = sceneObjects.map(m => serializeSingleObject(m));
    } else {
      const srcWorld = worlds.find(ww => ww.id === worldId);
      sourceData = srcWorld ? srcWorld.objects.map(d => ({ ...d })) : [];
    }
    // Tag clones with new world id
    for (const d of sourceData) d.world = newId;
    worlds.push({ id: newId, name: w.name + ' Copy', objects: sourceData });
    switchToWorld(newId);
    refreshWorldUI();
  });

  menu.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    closeWorldContextMenu();
    if (worlds.length <= 1) return;
    if (!confirm(`Delete "${w.name}" and all its objects?`)) return;
    if (worldId === activeWorldId) {
      // Active world: remove objects from scene
      const toRemove = [...sceneObjects];
      for (const m of toRemove) {
        scene.remove(m);
        const idx = sceneObjects.indexOf(m);
        if (idx >= 0) sceneObjects.splice(idx, 1);
        if (m.userData.pointLight) { scene.remove(m.userData.pointLight); }
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      }
    }
    // else: non-active world's objects are only in its store, just drop them
    worlds.splice(worlds.findIndex(ww => ww.id === worldId), 1);
    if (activeWorldId === worldId) switchToWorld(worlds[0].id);
    refreshWorldUI();
  });

  worldContextMenuEl = menu;
}

function _serializeBufferGeometry(geo) {
  const data = {};
  const pos = geo.attributes.position;
  if (pos) data.position = Array.from(pos.array);
  const norm = geo.attributes.normal;
  if (norm) data.normal = Array.from(norm.array);
  const uv = geo.attributes.uv;
  if (uv) data.uv = Array.from(uv.array);
  if (geo.index) data.index = Array.from(geo.index.array);
  return data;
}

function _deserializeBufferGeometry(data) {
  const geo = new THREE.BufferGeometry();
  if (data.position) geo.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  if (data.normal)   geo.setAttribute('normal',   new THREE.Float32BufferAttribute(data.normal, 3));
  if (data.uv)       geo.setAttribute('uv',       new THREE.Float32BufferAttribute(data.uv, 2));
  if (data.index)    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function serializeSingleObject(m) {
  const o = {
    type:       m.userData.type,
    position:   m.position.toArray(),
    quaternion: m.quaternion.toArray(),
    scale:      m.scale.toArray(),
    color:      m.material.color.getHex(),
    solid:      !!m.userData.solid,
    solidness:  clampMeshSolidness(m.userData.solidness ?? 1),
    opacity:    clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1),
    world:      m.userData.world || 'world_1',
  };
  if (m.userData.hiddenInGame) o.hiddenInGame = true;
  if (m.userData.collisionMode === 'geometry') o.collisionMode = 'geometry';
  const hitboxConfig = normalizeHitboxConfig(m.userData.hitboxConfig);
  if (hitboxConfig.mode !== 'auto' || hitboxConfig.offset.some(v => Math.abs(v) > 0.0001) || hitboxConfig.size.some((v, i) => Math.abs(v - createDefaultHitboxConfig().size[i]) > 0.0001)) {
    o.hitboxConfig = hitboxConfig;
  }
  if (m.userData.shapeParams && Object.keys(m.userData.shapeParams).length) o.shapeParams = { ...m.userData.shapeParams };
  if (m.userData.pointLight) {
    o.lightColor     = m.userData.pointLight.color.getHex();
    o.lightIntensity = m.userData.pointLight.intensity;
    o.lightDistance   = m.userData.pointLight.distance;
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
  if (m.userData.teleportConfig) {
    o.teleportConfig = normalizeTeleportConfig(m.userData.teleportConfig);
  }
  if (m.userData.triggerStopConfig) {
    const stopConfig = normalizeTriggerStopConfig(m.userData.triggerStopConfig);
    if (stopConfig.mode !== 'none' || stopConfig.functionNames.length) o.triggerStopConfig = stopConfig;
  }
  if (Array.isArray(m.userData.triggerCalls) && m.userData.triggerCalls.length) {
    o.triggerCalls = normalizeTriggerCalls(m.userData.triggerCalls);
  }
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
  if (m.userData.type === 'joint' && m.userData.jointConfig) {
    o.jointConfig = normalizeJointConfig(m.userData.jointConfig);
  }
  if (m.userData.type === 'skeleton' && m.userData.skeletonConfig) {
    o.skeletonConfig = normalizeSkeletonConfig(m.userData.skeletonConfig);
  }
  if (m.userData.type === 'npc' && m.userData.npcConfig) {
    o.npcConfig = normalizeNpcConfig(m.userData.npcConfig);
  }
  if (m.userData.type === 'terrain' && m.userData.terrainConfig) {
    o.terrainConfig = {
      segments: m.userData.terrainConfig.segments,
      terrainSize: m.userData.terrainConfig.terrainSize,
      heightmap: Array.from(m.userData.terrainConfig.heightmap),
    };
  }
  if (m.userData._texturePattern) {
    o.texturePattern = { ...m.userData._texturePattern };
  }
  if (m.userData.textConfig) o.textConfig = normalizeTextConfig(m.userData.textConfig);
  if (m.userData.screenConfig) o.screenConfig = normalizeScreenConfig(m.userData.screenConfig);
  if (m.userData.cameraConfig) o.cameraConfig = normalizeCameraConfig(m.userData.cameraConfig);
  if (m.userData.metalness !== undefined) o.metalness = m.userData.metalness;
  if (m.userData.roughness !== undefined) o.roughness = m.userData.roughness;
  if (m.userData._hasCustomGeometry) {
    o.customGeometry = _serializeBufferGeometry(m.geometry);
  }
  return o;
}

// ─── Editor orbit center indicator ───────────────────────────────────────────
const _orbitIndicator = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.6, depthTest: false })
);
_orbitIndicator.renderOrder = 9999;
_orbitIndicator.name = '__orbit_indicator__';
scene.add(_orbitIndicator);

const _orbitToggle = document.getElementById('orbit-indicator-toggle');
const _ORBIT_DOT_SCREEN_SIZE = 6; // constant pixel radius
function updateOrbitIndicator() {
  if (state.isPlaytest) { _orbitIndicator.visible = false; return; }
  _orbitIndicator.visible = _orbitToggle ? _orbitToggle.checked : true;
  _orbitIndicator.position.copy(orbitControls.target);
  // Keep constant apparent (screen-space) size regardless of zoom
  const d = editorCam.position.distanceTo(orbitControls.target);
  const vFov = editorCam.fov * Math.PI / 180;
  const screenH = renderer.domElement.clientHeight;
  const worldPerPx = 2 * d * Math.tan(vFov / 2) / screenH;
  _orbitIndicator.scale.setScalar(worldPerPx * _ORBIT_DOT_SCREEN_SIZE / 0.08);
}

function startJump() {
  if (!gameRules.gravityEnabled) return;
  if (!fpsGrounded) return;
  fpsVelY = resolveGameRule('jumpHeight', 8.5);
  fpsGrounded = false;
}

function updateHealthHud() {
  const pct = Math.max(0, fpsHealth / resolveGameRule('maxHealth', 100) * 100);
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
  const safePos = resolveSpawnPosition(pos);
  return {
    pos: safePos,
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

// ─── Spawn direction indicator ───────────────────────────────────────────────
function ensureSpawnDirectionIndicator(mesh) {
  if (!mesh || mesh.userData.type !== 'spawn') return null;
  if (mesh.userData._spawnDirIndicator) return mesh.userData._spawnDirIndicator;

  const group = new THREE.Group();

  // Arrow shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6),
    new THREE.MeshBasicMaterial({ color: 0x30d050, transparent: true, opacity: 0.85, depthTest: false })
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.set(0, 0, -0.3);
  group.add(shaft);

  // Arrow head (cone)
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.2, 6),
    new THREE.MeshBasicMaterial({ color: 0x30d050, transparent: true, opacity: 0.85, depthTest: false })
  );
  head.rotation.x = -Math.PI / 2;
  head.position.set(0, 0, -0.7);
  group.add(head);

  group.position.set(0, 0.5, 0);
  group.renderOrder = 31;

  mesh.add(group);
  mesh.userData._spawnDirIndicator = group;
  return group;
}

function updateSpawnDirectionIndicators() {
  for (const mesh of sceneObjects) {
    if (mesh.userData.type !== 'spawn') continue;
    const indicator = ensureSpawnDirectionIndicator(mesh);
    if (!indicator) continue;
    indicator.visible = !state.isPlaytest;
  }
}

// ─── Joint visual indicators ─────────────────────────────────────────────────
const _jointLineMat = new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.65, depthTest: false });
const _jointLineMatChild = new THREE.LineBasicMaterial({ color: 0xff6644, transparent: true, opacity: 0.65, depthTest: false });

function ensureJointIndicator(mesh) {
  if (!mesh || mesh.userData.type !== 'joint') return null;
  if (mesh.userData._jointIndicator) return mesh.userData._jointIndicator;

  const group = new THREE.Group();
  group.renderOrder = 32;

  // Rotation axis ring
  const ringGeo = new THREE.TorusGeometry(0.35, 0.015, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.5, depthTest: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.name = 'jointRing';
  group.add(ring);

  // Parent line (updated each frame)
  const parentLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const parentLine = new THREE.Line(parentLineGeo, _jointLineMat);
  parentLine.name = 'parentLine';
  parentLine.frustumCulled = false;
  group.add(parentLine);

  // Child line
  const childLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const childLine = new THREE.Line(childLineGeo, _jointLineMatChild);
  childLine.name = 'childLine';
  childLine.frustumCulled = false;
  group.add(childLine);

  mesh.add(group);
  mesh.userData._jointIndicator = group;
  return group;
}

function updateJointIndicators() {
  for (const mesh of sceneObjects) {
    if (mesh.userData.type !== 'joint') continue;
    const indicator = ensureJointIndicator(mesh);
    if (!indicator) continue;
    indicator.visible = !state.isPlaytest;

    const jc = getMeshJointConfig(mesh);
    if (!jc) continue;

    // Orient the ring to match the rotation axis
    const ring = indicator.getObjectByName('jointRing');
    if (ring) {
      ring.rotation.set(0, 0, 0);
      if (jc.axis === 'X') ring.rotation.y = Math.PI / 2;
      else if (jc.axis === 'Z') ring.rotation.x = Math.PI / 2;
      // Y axis: ring lies flat (default torus orientation is XZ plane -> already Y)
    }

    // Update parent/child connection lines
    const parentLine = indicator.getObjectByName('parentLine');
    const childLine = indicator.getObjectByName('childLine');
    const jointWorldPos = mesh.getWorldPosition(new THREE.Vector3());

    if (parentLine) {
      const parentMesh = jc.parentLabel ? sceneObjects.find(m => m.userData.label === jc.parentLabel) : null;
      const posArr = parentLine.geometry.attributes.position.array;
      posArr[0] = posArr[1] = posArr[2] = 0; // local origin = joint
      if (parentMesh) {
        const wp = parentMesh.getWorldPosition(new THREE.Vector3());
        const local = mesh.worldToLocal(wp);
        posArr[3] = local.x; posArr[4] = local.y; posArr[5] = local.z;
      } else {
        posArr[3] = posArr[4] = posArr[5] = 0;
      }
      parentLine.geometry.attributes.position.needsUpdate = true;
      parentLine.visible = !!parentMesh;
    }

    if (childLine) {
      const childMesh = jc.childLabel ? sceneObjects.find(m => m.userData.label === jc.childLabel) : null;
      const posArr = childLine.geometry.attributes.position.array;
      posArr[0] = posArr[1] = posArr[2] = 0;
      if (childMesh) {
        const wp = childMesh.getWorldPosition(new THREE.Vector3());
        const local = mesh.worldToLocal(wp);
        posArr[3] = local.x; posArr[4] = local.y; posArr[5] = local.z;
      } else {
        posArr[3] = posArr[4] = posArr[5] = 0;
      }
      childLine.geometry.attributes.position.needsUpdate = true;
      childLine.visible = !!childMesh;
    }
  }
}

// ─── Joint runtime state & update ────────────────────────────────────────────
const _jointRuntimeStates = new Map(); // mesh.uuid -> { angle, direction }

function getJointRuntimeState(mesh) {
  let st = _jointRuntimeStates.get(mesh.uuid);
  if (!st) {
    st = { angle: 0, direction: 1 };
    _jointRuntimeStates.set(mesh.uuid, st);
  }
  return st;
}

function clearJointRuntimeStates() {
  _jointRuntimeStates.clear();
}

function updateJointAnimations(dt) {
  if ((!state.isPlaytest && !_simActive) || dt <= 0) return;

  for (const mesh of sceneObjects) {
    if (mesh.userData.type !== 'joint') continue;
    const jc = getMeshJointConfig(mesh);
    if (!jc || !jc.childLabel) continue;

    const childMesh = sceneObjects.find(m => m.userData.label === jc.childLabel);
    if (!childMesh) continue;

    // Collect all editor group members of the child (so the whole group rotates)
    const childGid = childMesh.userData.editorGroupId;
    const childMembers = childGid
      ? sceneObjects.filter(m => m.userData.editorGroupId === childGid)
      : [childMesh];

    if (jc.mode === 'fixed') {
      // Fixed mode: child follows parent movement but no independent rotation
      // The group animation system already handles this via editorGroupId
      continue;
    }

    if (jc.mode === 'auto') {
      const st = getJointRuntimeState(mesh);
      const angleDelta = jc.speed * 360 * dt; // degrees per second
      st.angle += angleDelta * st.direction;

      // Clamp and bounce at limits
      if (st.angle >= jc.maxAngle) {
        st.angle = jc.maxAngle;
        st.direction = -1;
      } else if (st.angle <= jc.minAngle) {
        st.angle = jc.minAngle;
        st.direction = 1;
      }

      // Compute rotation delta from previous frame
      const prevAngle = st.angle - angleDelta * st.direction; // approximate previous
      const deltaRad = (st.angle - (prevAngle + angleDelta * st.direction === st.angle ? prevAngle : prevAngle)) * Math.PI / 180;
    }

    // For both auto and manual, apply the rotation around the joint point
    if (jc.mode === 'auto') {
      const st = getJointRuntimeState(mesh);
      const jointPos = mesh.getWorldPosition(new THREE.Vector3());

      // Build axis vector
      const axis = new THREE.Vector3();
      if (jc.axis === 'X') axis.set(1, 0, 0);
      else if (jc.axis === 'Z') axis.set(0, 0, 1);
      else axis.set(0, 1, 0);

      // Compute absolute target rotation for this frame
      const targetRad = st.angle * Math.PI / 180;

      // Store the initial positions/quaternions on first frame
      if (st._initPositions === undefined) {
        st._initPositions = new Map();
        st._initQuaternions = new Map();
        for (const m of childMembers) {
          st._initPositions.set(m.uuid, m.position.clone());
          st._initQuaternions.set(m.uuid, m.quaternion.clone());
        }
        st._initJointPos = jointPos.clone();
      }

      // Apply rotation: reset to initial, then rotate by targetRad around joint
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(axis, targetRad);
      for (const m of childMembers) {
        const initPos = st._initPositions.get(m.uuid);
        const initQuat = st._initQuaternions.get(m.uuid);
        if (!initPos || !initQuat) continue;

        // Position: rotate offset from joint around axis
        const offset = initPos.clone().sub(st._initJointPos);
        offset.applyQuaternion(rotQuat);
        m.position.copy(st._initJointPos).add(offset);

        // Also account for joint having moved (e.g. on a moving platform)
        const jointDelta = jointPos.clone().sub(st._initJointPos);
        m.position.add(jointDelta);

        // Rotation: apply joint rotation to initial quaternion
        m.quaternion.copy(rotQuat).multiply(initQuat);
      }
    }
  }
}

// ─── Skeleton Runtime Animation ─────────────────────────────────────────────
function updateSkeletonAnimations(dt) {
  if ((!state.isPlaytest && !_simActive) || dt <= 0) return;

  for (const mesh of sceneObjects) {
    if (mesh.userData.type !== 'skeleton') continue;
    const cfg = getMeshSkeletonConfig(mesh);
    if (!cfg?.definitionName) continue;
    const def = skeletonDefinitions[cfg.definitionName];
    if (!def) continue;

    const animName = cfg.currentAnimation;
    const anim = animName ? def.animations?.[animName] : null;
    if (!anim || !anim.keyframes?.length || anim.duration <= 0) continue;

    // Get or create runtime state
    let rst = _skeletonRuntimeStates.get(mesh.uuid);
    if (!rst) {
      rst = { time: 0, playing: !!cfg.playOnStart, speed: cfg.animationSpeed || 1 };
      _skeletonRuntimeStates.set(mesh.uuid, rst);
    }

    if (!rst.playing) continue;

    // Advance time
    rst.time += dt * rst.speed;
    const duration = anim.duration;

    if (rst.time >= duration) {
      if (cfg.loopAnimation) {
        rst.time = rst.time % duration;
      } else {
        rst.time = duration;
        rst.playing = false;
      }
    }

    // Find surrounding keyframes
    const kfs = anim.keyframes;
    if (kfs.length === 1) {
      applySkeletonKeyframe(mesh, def, kfs[0]);
      continue;
    }

    let kfA = kfs[0], kfB = kfs[kfs.length - 1];
    for (let i = 0; i < kfs.length - 1; i++) {
      if (rst.time >= kfs[i].time && rst.time <= kfs[i + 1].time) {
        kfA = kfs[i];
        kfB = kfs[i + 1];
        break;
      }
    }

    const segDur = kfB.time - kfA.time;
    const t = segDur > 0 ? Math.min(1, Math.max(0, (rst.time - kfA.time) / segDur)) : 1;

    // Interpolate bone rotations
    applyInterpolatedKeyframes(mesh, def, kfA, kfB, t);
  }
}

function applySkeletonKeyframe(mesh, def, kf) {
  const boneMap = mesh.userData._skelBoneMap;
  const restQ = mesh.userData._skelRestLocalQuats;
  if (!boneMap || !kf?.bones) return;

  for (const [boneId, quat] of Object.entries(kf.bones)) {
    const bone = boneMap.get(boneId);
    if (!bone) continue;
    const rest = restQ?.get(boneId);
    if (rest && Array.isArray(quat) && quat.length >= 4) {
      const dq = new THREE.Quaternion(quat[0], quat[1], quat[2], quat[3]);
      bone.quaternion.copy(rest).multiply(dq);
    } else if (Array.isArray(quat) && quat.length >= 4) {
      bone.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    }
  }
  mesh.userData._skelRootGroup?.updateMatrixWorld(true);
  updateSkeletonBoneSkinPositions(mesh, def);
}

function applyInterpolatedKeyframes(mesh, def, kfA, kfB, t) {
  const boneMap = mesh.userData._skelBoneMap;
  const restQ = mesh.userData._skelRestLocalQuats;
  if (!boneMap) return;

  const allBoneIds = new Set([
    ...Object.keys(kfA.bones || {}),
    ...Object.keys(kfB.bones || {}),
  ]);

  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();

  for (const boneId of allBoneIds) {
    const bone = boneMap.get(boneId);
    if (!bone) continue;

    const aQuat = kfA.bones?.[boneId];
    const bQuat = kfB.bones?.[boneId];

    if (aQuat && Array.isArray(aQuat) && aQuat.length >= 4) {
      qa.set(aQuat[0], aQuat[1], aQuat[2], aQuat[3]);
    } else {
      qa.set(0, 0, 0, 1);
    }
    if (bQuat && Array.isArray(bQuat) && bQuat.length >= 4) {
      qb.set(bQuat[0], bQuat[1], bQuat[2], bQuat[3]);
    } else {
      qb.set(0, 0, 0, 1);
    }

    // Interpolate the delta, then apply: final = rest * slerp(deltaA, deltaB, t)
    qa.slerp(qb, t);
    const rest = restQ?.get(boneId);
    if (rest) {
      bone.quaternion.copy(rest).multiply(qa);
    } else {
      bone.quaternion.copy(qa);
    }
  }

  mesh.userData._skelRootGroup?.updateMatrixWorld(true);
  updateSkeletonBoneSkinPositions(mesh, def);
}

function updateSkeletonBoneSkinPositions(mesh, def) {
  const visualGroup = mesh.userData._skelVisualGroup;
  const boneMap = mesh.userData._skelBoneMap;
  if (!visualGroup || !boneMap) return;

  // Build lookup maps from tagged children for robust matching
  const markersByBone = new Map();
  const linesByBone = new Map();
  const skinsByBone = new Map();
  for (const child of visualGroup.children) {
    const bid = child.userData._boneId;
    if (!bid) continue;
    switch (child.userData._childType) {
      case 'marker': markersByBone.set(bid, child); break;
      case 'line':   linesByBone.set(bid, child); break;
      case 'skin':   skinsByBone.set(bid, child); break;
    }
  }

  for (const bd of def.bones) {
    const threeBone = boneMap.get(bd.id);
    if (!threeBone) continue;

    const worldPos = new THREE.Vector3();
    threeBone.getWorldPosition(worldPos);

    // Update marker sphere
    const marker = markersByBone.get(bd.id);
    if (marker) marker.position.copy(worldPos);

    // Update bone connection line
    const line = linesByBone.get(bd.id);
    if (line && bd.parent) {
      const parentBone = boneMap.get(bd.parent);
      if (parentBone) {
        const pPos = new THREE.Vector3();
        parentBone.getWorldPosition(pPos);
        line.geometry.setFromPoints([pPos, worldPos]);
        line.geometry.attributes.position.needsUpdate = true;
      }
    }

    // Update bone skin group
    const skinG = skinsByBone.get(bd.id);
    if (skinG) {
      skinG.position.copy(worldPos);
      const boneQuat = new THREE.Quaternion();
      threeBone.getWorldQuaternion(boneQuat);
      const bindWorldQuat = skinG.userData._boneBindWorldQuat;
      if (bindWorldQuat) {
        skinG.quaternion.copy(boneQuat).multiply(bindWorldQuat);
      } else {
        skinG.quaternion.copy(boneQuat);
      }
    }
  }
}

function clearSkeletonRuntimeStates() {
  _skeletonRuntimeStates.clear();
}

function skeletonPlayAnimation(mesh, animName) {
  const cfg = getMeshSkeletonConfig(mesh);
  if (!cfg) return;
  cfg.currentAnimation = animName;
  let rst = _skeletonRuntimeStates.get(mesh.uuid);
  if (!rst) {
    rst = { time: 0, playing: true, speed: cfg.animationSpeed || 1 };
    _skeletonRuntimeStates.set(mesh.uuid, rst);
  } else {
    rst.time = 0;
    rst.playing = true;
    rst.speed = cfg.animationSpeed || 1;
  }
}

function skeletonStopAnimation(mesh) {
  const rst = _skeletonRuntimeStates.get(mesh.uuid);
  if (rst) rst.playing = false;
}

function skeletonPauseAnimation(mesh) {
  const rst = _skeletonRuntimeStates.get(mesh.uuid);
  if (rst) rst.playing = false;
}

function skeletonResumeAnimation(mesh) {
  const rst = _skeletonRuntimeStates.get(mesh.uuid);
  if (rst) rst.playing = true;
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
    keepUpright: action.rotateKeepUpright === true,
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
    pathState = { targetIndex: 0, finished: false, active: false, paused: false, waitTimer: 0 };
    _movementPathStates.set(mesh.uuid, pathState);
  }
  return pathState;
}

function startMovementPath(mesh, options = {}) {
  const config = getMeshMovementPathConfig(mesh);
  if (!config.checkpoints.length) return;

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
  // Reset all group members to their base positions
  const gid = mesh.userData.editorGroupId;
  const members = gid ? sceneObjects.filter(m => m.userData.editorGroupId === gid) : [mesh];
  for (const m of members) {
    const basePos = _playtestBasePositions.get(m) || _simBasePositions.get(m);
    if ((state.isPlaytest || _simActive) && basePos) {
      m.position.copy(basePos);
    }
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

function playerMatchesTarget(targetType, targetValue) {
  if (!targetValue) return true;
  const needle = normalizeTouchRef(targetValue);
  if (!needle) return true;
  if (targetType === 'name') {
    return normalizeTouchRef(playerProfile.name) === needle;
  }
  return getPlayerGroupSet().has(needle);
}

function applyPlayerStatsAction(action) {
  if (!playerMatchesTarget(action.playerStatTargetType, action.playerStatTarget)) return;
  const stat = action.playerStatKey;
  const op = action.playerStatOp;
  const val = action.playerStatValue;
  let current;
  if (stat === 'health') current = fpsHealth;
  else if (stat in gameRules) current = gameRules[stat];
  else return;

  let next = val;
  if (op === '+') next = current + val;
  else if (op === '-') next = current - val;
  else if (op === '*') next = current * val;
  else if (op === '/') next = val === 0 ? current : current / val;

  if (stat === 'health') {
    fpsHealth = Math.max(0, Math.min(gameRules.maxHealth, next));
    updateHealthHud();
    if (fpsHealth <= 0) respawnPlayer();
  } else if (stat in gameRules) {
    gameRules[stat] = next;
    syncGameruleUI();
  }
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
      instance.audio.play().catch(err => { console.warn('[Audio] Runtime resume failed:', err.message); });
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
    } else if (action.actionType === 'playerStats') {
      if (active) applyPlayerStatsAction(action);
    } else if (action.actionType === 'teleport') {
      if (active) executeTeleportAction(action, callerMesh);
    } else if (action.actionType === 'skeleton') {
      if (active) executeSkeletonAction(action);
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

  // Clear path trigger offsets before recomputing
  _pathTriggerMoveOffsets.clear();

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
  if ((!state.isPlaytest && !_simActive) || dt <= 0) return;

  // Track which editor groups have already been moved this frame
  const processedGroups = new Set();

  for (const mesh of sceneObjects) {
    const config = getMeshMovementPathConfig(mesh);
    if (!config.checkpoints.length) {
      _movementPathStates.delete(mesh.uuid);
      continue;
    }

    // If this mesh belongs to a group that was already processed, skip it
    const gid = mesh.userData.editorGroupId;
    if (gid && processedGroups.has(gid)) continue;

    const st = getMovementPathState(mesh, false);
    if (!st || !st.active || st.paused) continue;

    // Handle wait timer — if waiting at a checkpoint, count down before moving
    if (st.waitTimer > 0) {
      st.waitTimer -= dt;
      if (st.waitTimer > 0) {
        if (gid) processedGroups.add(gid);
        continue;
      }
      st.waitTimer = 0;
    }

    if (st.finished && !config.loop) {
      st.active = false;
      continue;
    }
    if (st.targetIndex >= config.checkpoints.length || st.targetIndex < 0) st.targetIndex = 0;

    // Get current checkpoint to determine its speed and style
    const currentCp = normalizeMovementPathCheckpoint(config.checkpoints[st.targetIndex]);
    const cpSpeed = (currentCp.speed > 0) ? currentCp.speed : Math.max(0.01, Number(config.speed) || 0.01);
    const moveStyle = currentCp.moveStyle || 'glide';

    // Collect group members (if grouped) so they move as one unit
    const groupMembers = gid ? sceneObjects.filter(m => m.userData.editorGroupId === gid) : null;

    // Compute the group center as the reference position for path navigation
    let refPos;
    if (groupMembers && groupMembers.length > 1) {
      refPos = new THREE.Vector3();
      for (const m of groupMembers) refPos.add(m.position);
      refPos.divideScalar(groupMembers.length);
    } else {
      refPos = mesh.position;
    }

    // Compute trigger-move offset for this path object (e.g. elevator on a moving spaceship).
    // If the mesh (or any group member) has a pending trigger-move offset, use it to shift
    // all checkpoint target positions so the path follows the group's triggered movement.
    let groupMoveOffset = null;
    const trigOff = _pathTriggerMoveOffsets.get(mesh.uuid);
    if (trigOff) {
      groupMoveOffset = trigOff;
    } else if (groupMembers) {
      for (const m of groupMembers) {
        const off = _pathTriggerMoveOffsets.get(m.uuid);
        if (off) { groupMoveOffset = off; break; }
      }
    }

    // Handle snap: instantly teleport to checkpoint
    if (moveStyle === 'snap') {
      const idx = THREE.MathUtils.clamp(st.targetIndex, 0, config.checkpoints.length - 1);
      const cp = normalizeMovementPathCheckpoint(config.checkpoints[idx]);
      _pathPreviewTarget.set(cp.pos[0], cp.pos[1], cp.pos[2]);
      if (groupMoveOffset) _pathPreviewTarget.add(groupMoveOffset);
      _pathPreviewDelta.subVectors(_pathPreviewTarget, refPos);

      // Apply face-direction
      if (cp.faceDirection) {
        _pathFacingDir.copy(_pathPreviewDelta).normalize();
        _pathFacingDir.y = 0;
        const hLen = _pathFacingDir.length();
        if (hLen > 1e-5) {
          _pathFacingDir.divideScalar(hLen);
          switch (config.frontAxis) {
            case '+X': _pathFrontVec.set(1, 0, 0); break;
            case '-X': _pathFrontVec.set(-1, 0, 0); break;
            case '+Z': _pathFrontVec.set(0, 0, 1); break;
            default:   _pathFrontVec.set(0, 0, -1); break;
          }
          _pathFacingQuat.setFromUnitVectors(_pathFrontVec, _pathFacingDir);
          if (groupMembers && groupMembers.length > 1) {
            const prevQuat = mesh.quaternion.clone();
            const rotDelta = _pathFacingQuat.clone().multiply(prevQuat.clone().invert());
            for (const m of groupMembers) {
              const offset = m.position.clone().sub(refPos);
              offset.applyQuaternion(rotDelta);
              m.position.copy(refPos).add(offset);
              m.quaternion.premultiply(rotDelta);
            }
          } else {
            mesh.quaternion.copy(_pathFacingQuat);
          }
        }
      }

      // Teleport
      if (groupMembers && groupMembers.length > 1) {
        for (const m of groupMembers) m.position.add(_pathPreviewDelta);
      } else {
        mesh.position.copy(_pathPreviewTarget);
      }

      // On-arrive function
      const fnName = String(cp.functionName ?? '').trim();
      if (fnName) executeControlFunction(fnName, mesh, true);

      // Handle wait/pause on arrival, then advance
      if (cp.waitDuration > 0) st.waitTimer = cp.waitDuration;
      if (cp.pauseOnArrival) { st.paused = true; st.active = false; }

      if (config.loop) {
        st.targetIndex = (idx + 1) % config.checkpoints.length;
        st.finished = false;
      } else if (idx >= config.checkpoints.length - 1) {
        st.targetIndex = idx;
        st.finished = true;
        st.active = false;
      } else {
        st.targetIndex = idx + 1;
      }

      if (gid) processedGroups.add(gid);
      continue;
    }

    // For glide and strict: distance-based movement
    let remainingDistance = cpSpeed * dt;
    if (remainingDistance <= 0) continue;

    // strict mode: don't carry leftover distance to next checkpoint
    const isStrict = (moveStyle === 'strict');

    let guard = config.checkpoints.length * 2 + 4;
    while (remainingDistance > 1e-6 && guard-- > 0) {
      const idx = THREE.MathUtils.clamp(st.targetIndex, 0, config.checkpoints.length - 1);
      const cp = normalizeMovementPathCheckpoint(config.checkpoints[idx]);
      _pathPreviewTarget.set(cp.pos[0], cp.pos[1], cp.pos[2]);
      if (groupMoveOffset) _pathPreviewTarget.add(groupMoveOffset);
      _pathPreviewDelta.subVectors(_pathPreviewTarget, refPos);
      const dist = _pathPreviewDelta.length();

      // Apply face-direction rotation when the checkpoint requests it and we have a valid travel direction
      if (cp.faceDirection && dist > 1e-5) {
        // Compute facing direction (Y-axis ignored for horizontal facing)
        _pathFacingDir.copy(_pathPreviewDelta).normalize();
        _pathFacingDir.y = 0;
        const hLen = _pathFacingDir.length();
        if (hLen > 1e-5) {
          _pathFacingDir.divideScalar(hLen);
          // Get the object's front vector based on configured frontAxis
          switch (config.frontAxis) {
            case '+X': _pathFrontVec.set(1, 0, 0); break;
            case '-X': _pathFrontVec.set(-1, 0, 0); break;
            case '+Z': _pathFrontVec.set(0, 0, 1); break;
            default:   _pathFrontVec.set(0, 0, -1); break; // -Z default
          }
          _pathFacingQuat.setFromUnitVectors(_pathFrontVec, _pathFacingDir);

          if (groupMembers && groupMembers.length > 1) {
            // Rotate all group members around the group center
            const prevQuat = mesh.quaternion.clone();
            const rotDelta = _pathFacingQuat.clone().multiply(prevQuat.clone().invert());
            for (const m of groupMembers) {
              // Rotate position around group center
              const offset = m.position.clone().sub(refPos);
              offset.applyQuaternion(rotDelta);
              m.position.copy(refPos).add(offset);
              m.quaternion.premultiply(rotDelta);
            }
          } else {
            mesh.quaternion.copy(_pathFacingQuat);
          }
        }
      }

      if (dist <= 1e-5 || remainingDistance >= dist) {
        if (groupMembers && groupMembers.length > 1) {
          // Move all group members by the same delta (center -> target)
          for (const m of groupMembers) m.position.add(_pathPreviewDelta);
          refPos.copy(_pathPreviewTarget);
        } else {
          mesh.position.copy(_pathPreviewTarget);
        }
        remainingDistance = dist <= 1e-5 ? 0 : (remainingDistance - dist);

        const fnName = String(cp.functionName ?? '').trim();
        if (fnName) executeControlFunction(fnName, mesh, true);

        // Handle wait/pause on arrival
        if (cp.waitDuration > 0) st.waitTimer = cp.waitDuration;
        if (cp.pauseOnArrival) { st.paused = true; st.active = false; }

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

        // strict: stop at the checkpoint, don't carry over distance
        if (isStrict || st.waitTimer > 0 || !st.active) break;

        // For next checkpoint, recalculate speed if per-checkpoint speed differs
        const nextCp = normalizeMovementPathCheckpoint(config.checkpoints[st.targetIndex]);
        const nextSpeed = (nextCp.speed > 0) ? nextCp.speed : Math.max(0.01, Number(config.speed) || 0.01);
        if (nextCp.moveStyle === 'snap' || nextCp.moveStyle === 'strict') break;
        remainingDistance = remainingDistance * (nextSpeed / cpSpeed);

        continue;
      }

      const step = _pathPreviewDelta.clone().multiplyScalar(remainingDistance / dist);
      if (groupMembers && groupMembers.length > 1) {
        for (const m of groupMembers) m.position.add(step);
        refPos.add(step);
      } else {
        mesh.position.add(step);
      }
      remainingDistance = 0;
    }

    // Mark this group as processed so other members are skipped
    if (gid) processedGroups.add(gid);
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
    // Only check triggers in the current playtest world
    if ((m.userData.world || 'world_1') !== _playtestWorldId) continue;
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
      // Anti-re-teleport: if this trigger is on cooldown, skip activation
      if (_teleportCooldowns.has(m.uuid)) continue;
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
      // Clear teleport cooldown once player has left the trigger
      _teleportCooldowns.delete(m.uuid);
    }
  }
}

// ─── Teleport blocks overlap detection ───────────────────────────────────────
const _activeTeleports = new Set();
const _teleportBlockAABB = new THREE.Box3();

function checkTeleportBlocks() {
  const pH = gameRules.height;
  for (const m of sceneObjects) {
    if (m.userData.type !== 'teleport') continue;
    if ((m.userData.world || 'world_1') !== _playtestWorldId) continue;
    _teleportBlockAABB.setFromObject(m);
    // Expand the AABB slightly for easier triggering
    _teleportBlockAABB.expandByScalar(0.3);
    const overlap =
      fpsPos.x + PLAYER_RADIUS > _teleportBlockAABB.min.x &&
      fpsPos.x - PLAYER_RADIUS < _teleportBlockAABB.max.x &&
      fpsPos.z + PLAYER_RADIUS > _teleportBlockAABB.min.z &&
      fpsPos.z - PLAYER_RADIUS < _teleportBlockAABB.max.z &&
      fpsPos.y + pH > _teleportBlockAABB.min.y &&
      fpsPos.y < _teleportBlockAABB.max.y;

    if (overlap && !_activeTeleports.has(m.uuid)) {
      if (_teleportCooldowns.has(m.uuid)) continue;
      _activeTeleports.add(m.uuid);
      // Find the paired teleport block by label match
      const config = getMeshTeleportConfig(m);
      const pairLabel = config.pairLabel;
      if (pairLabel) {
        // Cross-world teleport: search stored world data for destination
        if (config.crossWorld && config.targetWorld && config.targetWorld !== _playtestWorldId) {
          const targetWorld = worlds.find(w => w.id === config.targetWorld);
          if (targetWorld) {
            // Find destination object data in target world's stored objects
            // Match by label or by teleportConfig.pairLabel
            const pairLabelLower = pairLabel.toLowerCase();
            const srcLabelLower = (m.userData.label || '').toLowerCase();
            const destData = (targetWorld.objects || []).find(o =>
              o.type === 'teleport' && (
                (o.label || '').toLowerCase() === pairLabelLower ||
                (o.teleportConfig?.pairLabel || '').toLowerCase() === pairLabelLower ||
                (o.teleportConfig?.pairLabel || '').toLowerCase() === srcLabelLower
              )
            );
            if (destData) {
              const offsetX = fpsPos.x - m.position.x;
              const offsetY = fpsPos.y - m.position.y;
              const offsetZ = fpsPos.z - m.position.z;
              const destPos = destData.position || [0, 0, 0];
              // Clear stale teleport state before world switch
              _activeTeleports.clear();
              // Switch world first, then position player
              switchToWorld(config.targetWorld, { keepPosition: true });
              fpsPos.set(destPos[0] + offsetX, destPos[1] + offsetY, destPos[2] + offsetZ);
              if (fpsGrounded) fpsVelY = 0;
              // Set cooldown on ALL teleporters near the player to prevent immediate re-teleport
              const pH = gameRules.height;
              for (const o of sceneObjects) {
                if (o.userData.type !== 'teleport') continue;
                const bb = new THREE.Box3().setFromObject(o).expandByScalar(0.5);
                if (fpsPos.x + PLAYER_RADIUS > bb.min.x && fpsPos.x - PLAYER_RADIUS < bb.max.x &&
                    fpsPos.z + PLAYER_RADIUS > bb.min.z && fpsPos.z - PLAYER_RADIUS < bb.max.z &&
                    fpsPos.y + pH > bb.min.y && fpsPos.y < bb.max.y) {
                  _teleportCooldowns.set(o.uuid, true);
                  _activeTeleports.add(o.uuid);
                }
              }
              return; // world switched, abort further processing
            }
          }
        }
        // Same-world teleport
        const dest = sceneObjects.find(o =>
          o !== m &&
          o.userData.type === 'teleport' &&
          (o.userData.label || '').toLowerCase() === pairLabel.toLowerCase() &&
          (o.userData.world || 'world_1') === _playtestWorldId
        );
        if (dest) {
          // Relative-coordinate teleport: preserve player's offset from source block center
          const offsetX = fpsPos.x - m.position.x;
          const offsetY = fpsPos.y - m.position.y;
          const offsetZ = fpsPos.z - m.position.z;
          fpsPos.set(dest.position.x + offsetX, dest.position.y + offsetY, dest.position.z + offsetZ);
          // Preserve vertical velocity for momentum-based feel (only zero if grounded)
          if (fpsGrounded) fpsVelY = 0;
          // Set cooldown on destination so player doesn't immediately bounce back
          _teleportCooldowns.set(dest.uuid, true);
          _teleportCooldowns.set(m.uuid, true);
        }
      }
    } else if (!overlap) {
      _activeTeleports.delete(m.uuid);
      _teleportCooldowns.delete(m.uuid);
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

// ─── Variable-bound number input system ──────────────────────────────────────
// Allows any number input to alternatively hold a variable name.
// If the entered text is a valid variable name (exists in gameVars), the value
// resolves to that variable's runtime value. Otherwise it's treated as a literal.
const gameRulesVarBinds = {}; // key -> varName

function resolveNumericOrVar(rawValue, fallback = 0) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const num = parseFloat(rawValue);
  if (Number.isFinite(num)) return num;
  // It's a string — treat as variable name
  const varName = String(rawValue).trim();
  if (!varName) return fallback;
  const entry = gameVars.find(item => item.name === varName);
  if (entry) return entry.runtimeValue;
  const overrideVal = _runtimeNumericOverrides.get(varName);
  if (overrideVal !== undefined) return overrideVal;
  return fallback;
}

function resolveGameRule(key, fallback) {
  const varName = gameRulesVarBinds[key];
  if (varName) {
    const entry = gameVars.find(item => item.name === varName);
    if (entry) return entry.runtimeValue;
  }
  const val = gameRules[key];
  return val !== undefined ? val : (fallback ?? 0);
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
  function syncVarAwareInput(el, ruleKey, ruleValue) {
    if (!el) return;
    const varName = gameRulesVarBinds[ruleKey];
    if (varName) {
      el.value = varName;
      el.style.color = '#57b8ff';
    } else {
      el.value = ruleValue;
      el.style.color = '';
    }
  }
  syncVarAwareInput(grJumpInput, 'jumpHeight', gameRules.jumpHeight);
  syncVarAwareInput(grGravityInput, 'gravity', gameRules.gravity);
  if (grGravityEnabledInput) grGravityEnabledInput.checked = !!gameRules.gravityEnabled;
  grHeightInput.value  = gameRules.height;
  if (grCrouchHeightInput) grCrouchHeightInput.value = gameRules.crouchHeight;
  syncVarAwareInput(grSprintInput, 'sprintSpeed', gameRules.sprintSpeed);
  syncVarAwareInput(grSprintDurationInput, 'sprintDuration', gameRules.sprintDuration);
  syncVarAwareInput(grSprintRechargeInput, 'sprintRechargeTime', gameRules.sprintRechargeTime);
  if (grAirDashEnabledInput) grAirDashEnabledInput.checked = !!gameRules.airDashEnabled;
  syncVarAwareInput(grAirDashDurationInput, 'airDashDuration', gameRules.airDashDuration);
  syncVarAwareInput(grMaxHpInput, 'maxHealth', gameRules.maxHealth);
  grFallDmgInput.checked = gameRules.fallDamage;
  syncVarAwareInput(grFallDmgMinHtInput, 'fallDamageMinHeight', gameRules.fallDamageMinHeight);
  syncVarAwareInput(grFallDmgMultInput, 'fallDamageMultiplier', gameRules.fallDamageMultiplier);
  syncVarAwareInput(grSpawnProtTimeInput, 'spawnProtectTime', gameRules.spawnProtectTime);
  grSpawnProtCondInput.value = gameRules.spawnProtectCondition;
  if (grGroundTouchFnInput) grGroundTouchFnInput.value = gameRules.groundTouchFunction || '';
  refreshPlayerProfileUI();
}

function startPlaytest() {
  if (state.isPlaytest) return;
  // Flush any pending autosave before entering playtest
  if (_restoreDirty) { clearTimeout(_restoreTimer); _restoreTimer = null; _flushRestore(); }
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
  fpsSprintStamina = 1;
  fpsWasSprintingOnGround = false;
  fpsAirDashRemaining = 0;
  fpsAirDashUsed = false;
  fpsFallStartY = null;
  fpsCrouching = false;
  _fpsCurrentHeight = gameRules.height;
  _fpsCurrentEyeHeight = gameRules.eyeHeight;
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
  _pathTriggerMoveOffsets.clear();
  clearJointRuntimeStates();
  clearSkeletonRuntimeStates();
  clearNpcRuntimeState();
  _activeTriggerCalls.clear();
  _teleportCooldowns.clear();
  _runtimeFovOverride = null;
  _playtestWorldId = activeWorldId;
  _prePlaytestWorldId = activeWorldId;
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
    if (m.userData.type === 'spawn' || m.userData.type === 'trigger' || m.userData.type === 'pivot') {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.userData._playtestHidden = true;
    }
  }

  // Hide objects marked as hidden in game
  for (const m of sceneObjects) {
    if (m.userData.hiddenInGame) {
      m.material.visible = false;
      if (m.userData.customSkinGroup) m.userData.customSkinGroup.visible = false;
      m.userData._playtestHidden = true;
    }
  }

  setPlaytestDevView(false);
  setGridVisible(false);
  _groundTouchFnActive = false;

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
  if (sprintHud) sprintHud.style.display = gameRules.sprintDuration > 0 ? 'flex' : 'none';
  updateHealthHud();

  renderer.domElement.requestPointerLock();
  syncFpsCamera();

  // Auto-execute "Always Active" control functions
  for (const fn of controlFunctions) {
    if (fn.alwaysActive && fn.name) {
      executeControlFunction(fn.name, null, true);
    }
  }

  refreshStatus();
}

function _cleanupPlaytest() {
  closeRuntimeKeypadOverlay();
  closeRuntimeScreenOverlay();
  // Remove portal discs from teleport meshes
  for (const m of sceneObjects) {
    if (m.userData._portalDisc) {
      m.remove(m.userData._portalDisc);
      m.userData._portalDisc.material.dispose();
      delete m.userData._portalDisc;
    }
    if (m.userData._portalRT) {
      m.userData._portalRT.dispose();
      delete m.userData._portalRT;
    }
    // Stop any playing screen videos
    if (m.userData._screenVideo) {
      m.userData._screenVideo.pause();
      m.userData._screenVideo.src = '';
      m.userData._screenVideo = null;
    }
  }
  // Restore dedicated light block visibility
  for (const m of sceneObjects) {
    if (m.userData.type === 'light' && m.userData.pointLight) {
      m.material.visible = true;
      m.castShadow = true;
    }
  }
  // Restore spawn/trigger visibility
  for (const m of sceneObjects) {
    if (m.userData.type === 'spawn' || m.userData.type === 'trigger' || m.userData.type === 'pivot') {
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
  _pathTriggerMoveOffsets.clear();
  _movementPathStates.clear();
  clearJointRuntimeStates();
  clearSkeletonRuntimeStates();
  clearNpcRuntimeState();
  _activeTriggerCalls.clear();
  _teleportCooldowns.clear();
  _runtimeFovOverride = null;
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
  _activeTeleports.clear();
  // Reset conditional trigger fired states
  for (const ct of conditionalTriggers) { ct._fired = false; ct._lastFireTime = null; ct._nextFireTime = null; }
  orbitControls.enabled = true;

  crosshair.style.display = 'none';
  playHint.style.display  = 'none';
  healthHud.style.display = 'none';
  if (sprintHud) sprintHud.style.display = 'none';
  document.getElementById('btn-stop').style.display = 'none';
  document.getElementById('btn-playtest').style.display = 'inline-flex';
  fpsDevView = false;
  updatePlayHint();
  setGridVisible(true);
  refreshStatus();
  // After playtest, restore the original editor world.
  // Restore positions before stashing so world store has clean data.
  for (const m of sceneObjects) {
    const basePos = _playtestBasePositions.get(m);
    if (basePos) m.position.copy(basePos);
    const baseQuat = _playtestBaseRotations.get(m);
    if (baseQuat) m.quaternion.copy(baseQuat);
  }
  _stashCurrentWorld();
  _clearScene();
  activeWorldId = _prePlaytestWorldId;
  _loadWorldObjects(activeWorldId);
  const aw = worlds.find(ww => ww.id === activeWorldId);
  if (aw) aw.objects = [];
  refreshWorldUI();
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
  if (!fpsLocked && editorFreeLook) {
    // Pointer lock lost while in free-look — exit free-look cleanly
    editorFreeLook = false;
    orbitControls.enabled = true;
    return;
  }
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
  // Editor free-look: rotate orbit target around camera
  if (editorFreeLook && document.pointerLockElement === renderer.domElement && !state.isPlaytest) {
    const sens = 0.003;
    const spherical = new THREE.Spherical().setFromVector3(
      orbitControls.target.clone().sub(editorCam.position)
    );
    spherical.theta -= e.movementX * sens;
    spherical.phi   -= e.movementY * sens;
    spherical.phi    = Math.max(0.05, Math.min(Math.PI - 0.05, spherical.phi));
    const offset = new THREE.Vector3().setFromSpherical(spherical);
    orbitControls.target.copy(editorCam.position).add(offset);
    editorCam.lookAt(orbitControls.target);
    return;
  }
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
    if (tryOpenRuntimeScreenFromPointerEvent(e)) return;
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
    // Custom template placement
    if (state._placingCustomTemplate) {
      const pt = groundPoint(ndc);
      if (pt) {
        snap(pt);
        placeCustomTemplate(state._placingCustomTemplate, new THREE.Vector3(pt.x, 0, pt.z));
        state._placingCustomTemplate = null;
      }
      return;
    }
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
    // Terrain sculpting intercept
    if (terrainSculptState.active && handleTerrainSculptClick(e)) return;
    const hit = surfaceHit(ndc);
    if (hit?.object) {
      // Texture painting
      if (texturePaintState.enabled && (texturePaintState.pattern !== 'none' || texturePaintState.customImage)) {
        const beforePattern = hit.object.userData._texturePattern ? { ...hit.object.userData._texturePattern } : null;
        const pat = texturePaintState.customImage ? 'custom' : texturePaintState.pattern;
        applyTexturePaint(hit.object, pat, state.brushColor, texturePaintState.color2, texturePaintState.scale, texturePaintState.customImage);
        const afterPattern = { ...hit.object.userData._texturePattern };
        pushUndo({ type: 'texture-paint', mesh: hit.object, beforePattern, afterPattern });
      } else if (state.paintSubMode === 'erase-paint') {
        paintMesh(hit.object, hit.object.userData.originalColor ?? 0xcccccc);
      } else if (state.paintSubMode === 'fill') {
        _floodFillPaint(hit.object, state.brushColor);
      } else {
        paintMesh(hit.object, state.brushColor);
      }
    }
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

  // Terrain sculpt drag
  if (state.mode === 'paint' && terrainSculptState._painting && (e.buttons & 1) === 1) {
    handleTerrainSculptDrag(e);
  }

  if (state.mode === 'paint' && (e.buttons & 1) === 1) {
    const hit = surfaceHit(ndc);
    if (hit?.object) {
      if (state.paintSubMode === 'erase-paint') {
        paintMesh(hit.object, hit.object.userData.originalColor ?? 0xcccccc);
      } else if (state.paintSubMode !== 'fill') {
        paintMesh(hit.object, state.brushColor);
      }
    }
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

renderer.domElement.addEventListener('pointerup', () => {
  handleTerrainSculptEnd();
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
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) return true;
  // Block editor keys when a full-screen overlay (e.g. skin editor) is open
  if (skinEditorOverlayEl) return true;
  return false;
}

// ─── Keyboard Shortcuts Help ─────────────────────────────────────────────────
function toggleShortcutsHelp() {
  let overlay = document.getElementById('shortcuts-help-overlay');
  if (overlay) { overlay.remove(); return; }
  overlay = document.createElement('div');
  overlay.id = 'shortcuts-help-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const box = document.createElement('div');
  box.style.cssText = 'background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:10px;padding:24px 32px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;font-family:monospace;font-size:13px';
  box.innerHTML = `
    <h2 style="margin:0 0 16px;color:#f97316;font-size:16px">⌨ Keyboard Shortcuts</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><th style="text-align:left;padding:4px 8px;color:#8b949e;border-bottom:1px solid #30363d" colspan=2>Editor</th></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+Z</td><td style="padding:3px 8px">Undo</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+Y</td><td style="padding:3px 8px">Redo</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+C</td><td style="padding:3px 8px">Copy</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+V</td><td style="padding:3px 8px">Paste</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+D</td><td style="padding:3px 8px">Duplicate</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+G</td><td style="padding:3px 8px">Group</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+Shift+G</td><td style="padding:3px 8px">Ungroup</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Ctrl+A</td><td style="padding:3px 8px">Select all</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Delete / Backspace</td><td style="padding:3px 8px">Delete selected</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">1 / 2 / 3</td><td style="padding:3px 8px">Translate / Rotate / Scale</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">X / Y / Z</td><td style="padding:3px 8px">Toggle scale side (in scale mode)</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Tab</td><td style="padding:3px 8px">Clone object under cursor</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">F</td><td style="padding:3px 8px">Toggle freelook</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">P</td><td style="padding:3px 8px">Start playtest</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Escape</td><td style="padding:3px 8px">Stop playtest / exit freelook</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">?</td><td style="padding:3px 8px">Toggle this help</td></tr>
      <tr><th style="text-align:left;padding:8px 8px 4px;color:#8b949e;border-top:1px solid #30363d" colspan=2>Playtest (FPS)</th></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">WASD</td><td style="padding:3px 8px">Move</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Space</td><td style="padding:3px 8px">Jump</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">R</td><td style="padding:3px 8px">Sprint</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">Shift</td><td style="padding:3px 8px">Crouch</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">E</td><td style="padding:3px 8px">Interact with NPC</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">T</td><td style="padding:3px 8px">Toggle mouse cursor</td></tr>
      <tr><td style="padding:3px 8px;color:#58a6ff">V</td><td style="padding:3px 8px">Dev view (editor playtest)</td></tr>
    </table>
    <div style="text-align:center;margin-top:14px;color:#8b949e;font-size:11px">Press <b>?</b> or click outside to close</div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
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
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'ShiftLeft', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (keybindMatch('jump', e.code) && !e.repeat) startJump();
    if (keybindMatch('sprint', e.code)) fpsSprinting = true;
    if (keybindMatch('crouch', e.code)) fpsCrouching = true;
    if (keybindMatch('toggleMouse', e.code) && !e.repeat) {
      e.preventDefault();
      if (fpsLocked) {
        suppressPointerUnlockStop = true;
        document.exitPointerLock();
      } else {
        renderer.domElement.requestPointerLock();
      }
      return;
    }
    if (e.code === 'KeyE' && !e.repeat) checkNpcInteraction();
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
  if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); copySelected(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
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
  if (k === 'escape') { if (editorFreeLook) { stopEditorFreeLook(); return; } stopPlaytest(); }
  if (k === 'f' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (editorFreeLook) stopEditorFreeLook(); else startEditorFreeLook();
    return;
  }

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

  if (e.key === '?' && !e.ctrlKey && !e.metaKey) { toggleShortcutsHelp(); return; }
});

window.addEventListener('keyup', e => {
  fpsKeys.delete(e.code);
  if (keybindMatch('sprint', e.code)) fpsSprinting = false;
  if (keybindMatch('crouch', e.code)) fpsCrouching = false;
  editKeys.delete(e.code);
});

// ─── UI wiring ───────────────────────────────────────────────────────────────
function setMode(mode) {
  state.mode = mode;
  if (mode !== 'paint') state.colorPickArmed = false;
  if (mode !== 'place') state._placingCustomTemplate = null;
  if (modeSelect) modeSelect.value = mode;
  if (mode !== 'select') selectObject(null);
  transformGroup.style.opacity       = mode === 'select' ? '1'    : '.4';
  transformGroup.style.pointerEvents = mode === 'select' ? ''     : 'none';
  if (!['place', 'erase'].includes(mode)) removeGhost();
  refreshStatus();
}

function setTransformMode(tm) {
  state.transformMode = tm;
  transformControls.setMode(tm);
  if (gizmoSelect) gizmoSelect.value = tm;
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
  markRestoreDirty();
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

if (modeSelect) modeSelect.addEventListener('change', () => setMode(modeSelect.value));
if (gizmoSelect) gizmoSelect.addEventListener('change', () => setTransformMode(gizmoSelect.value));
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

/* Collapsible .sf-sub headers */
document.querySelectorAll('.sf-sub').forEach(sub => {
  sub.addEventListener('click', () => {
    const collapsed = sub.classList.toggle('collapsed');
    let sib = sub.nextElementSibling;
    while (sib && !sib.classList.contains('sf-sub')) {
      sib.style.display = collapsed ? 'none' : '';
      sib = sib.nextElementSibling;
    }
  });
});

/* Collapsible sidebar library categories */
document.querySelectorAll('.lib-category-title').forEach(title => {
  title.addEventListener('click', () => {
    const body = title.nextElementSibling;
    if (!body || !body.classList.contains('lib-category-body')) return;
    const collapsed = title.classList.toggle('collapsed');
    body.classList.toggle('collapsed', collapsed);
  });
});

// --- Object library search filter ---
const libSearchInput = document.getElementById('lib-search');
if (libSearchInput) {
  libSearchInput.addEventListener('input', () => {
    const q = libSearchInput.value.trim().toLowerCase();
    const cats = document.querySelectorAll('#library-pane-objects .lib-category');
    for (const cat of cats) {
      const btns = cat.querySelectorAll('.lib-btn');
      let anyVisible = false;
      for (const btn of btns) {
        const text = (btn.textContent || '').toLowerCase();
        const type = (btn.dataset.type || '').toLowerCase();
        const match = !q || text.includes(q) || type.includes(q);
        btn.style.display = match ? '' : 'none';
        if (match) anyVisible = true;
      }
      cat.style.display = anyVisible ? '' : 'none';
    }
  });
}

document.addEventListener('pointerdown', e => {
  const target = e.target;
  if (libraryContextMenuEl && libraryContextMenuEl.contains(target)) return;
  if (keypadContextMenuEl && keypadContextMenuEl.contains(target)) return;
  if (worldContextMenuEl && worldContextMenuEl.contains(target)) return;
  if (skinEditorOverlayEl && skinEditorOverlayEl.contains(target)) return;
  if (sculptEditorOverlayEl && sculptEditorOverlayEl.contains(target)) return;
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
// New sky/cloud/star/moon listeners
if (sunSizeInput) sunSizeInput.addEventListener('change', applySunUI);
if (skyColorInput) skyColorInput.addEventListener('input', applySunUI);
if (cloudsEnabledInput) cloudsEnabledInput.addEventListener('change', applySunUI);
if (cloudWindSpeedInput) cloudWindSpeedInput.addEventListener('change', applySunUI);
if (cloudWindDirInput) cloudWindDirInput.addEventListener('change', applySunUI);
if (cloudOpacityInput) cloudOpacityInput.addEventListener('change', applySunUI);
if (starsEnabledInput) starsEnabledInput.addEventListener('change', applySunUI);
if (starsCountInput) starsCountInput.addEventListener('change', () => { _buildStars(parseInt(starsCountInput.value) || STARS_COUNT_DEFAULT); applySunUI(); });
if (starsBrightnessInput) starsBrightnessInput.addEventListener('change', applySunUI);
if (moonEnabledInput) moonEnabledInput.addEventListener('change', applySunUI);
if (moonBrightnessInput) moonBrightnessInput.addEventListener('change', applySunUI);
if (moonAuraInput) moonAuraInput.addEventListener('change', applySunUI);
chunkRangeSelect.addEventListener('change', () => setChunkRange(chunkRangeSelect.value));
topMenuSelect.addEventListener('change', () => setTopMenu(topMenuSelect.value));
if (scaleSideXSelect) scaleSideXSelect.addEventListener('change', () => { state.scaleSides.x = scaleSideXSelect.value === 'neg' ? 'neg' : 'pos'; refreshStatus(); });
if (scaleSideYSelect) scaleSideYSelect.addEventListener('change', () => { state.scaleSides.y = scaleSideYSelect.value === 'neg' ? 'neg' : 'pos'; refreshStatus(); });
if (scaleSideZSelect) scaleSideZSelect.addEventListener('change', () => { state.scaleSides.z = scaleSideZSelect.value === 'neg' ? 'neg' : 'pos'; refreshStatus(); });
if (shapeSidesInput) shapeSidesInput.addEventListener('change', () => setPlacementSides(shapeSidesInput.value));
if (shapeDepthInput) shapeDepthInput.addEventListener('change', () => setPlacementDepth(shapeDepthInput.value));
if (placeOpacityInput) placeOpacityInput.addEventListener('change', () => setPlacementOpacity(placeOpacityInput.value));
if (paintColorInput) paintColorInput.addEventListener('input', () => setBrushColor(paintColorInput.value));
if (paintModeInput) paintModeInput.addEventListener('change', () => { state.paintSubMode = paintModeInput.value; refreshStatus(); });
if (eraserShapeInput) eraserShapeInput.addEventListener('change', () => setEraserShape(eraserShapeInput.value));
if (eraserSizeInput) eraserSizeInput.addEventListener('change', () => setEraserSize(eraserSizeInput.value));
if (pickColorBtn) {
  pickColorBtn.addEventListener('click', () => {
    state.colorPickArmed = true;
    setMode('paint');
    refreshStatus();
  });
}
texturePaintState.customImage = null; // clear uploaded image when selecting a pattern
  const texBtn = document.getElementById('texture-upload-btn');
  if (texBtn) texBtn.textContent = '📁 Upload Image';
  
// Texture paint wiring
const texPatternSelect = document.getElementById('texture-pattern');
const texColor2Input   = document.getElementById('texture-color2');
const texScaleInput    = document.getElementById('texture-scale');
if (texPatternSelect) texPatternSelect.addEventListener('change', () => {
  texturePaintState.pattern = texPatternSelect.value;
  texturePaintState.enabled = texPatternSelect.value !== 'none';
  texturePaintState.customImage = null; // clear uploaded image when selecting a pattern
  const texBtn = document.getElementById('texture-upload-btn');
  if (texBtn) texBtn.textContent = '📁 Upload Image';
  refreshStatus();
});
if (texColor2Input) texColor2Input.addEventListener('input', () => {
  texturePaintState.color2 = parseInt(texColor2Input.value.replace('#', ''), 16) || 0x222222;
});
if (texScaleInput) texScaleInput.addEventListener('change', () => {
  texturePaintState.scale = parseFloat(texScaleInput.value) || 1;
});

// Custom image texture upload
const texUploadBtn  = document.getElementById('texture-upload-btn');
const texUploadFile = document.getElementById('texture-upload-file');
if (texUploadBtn && texUploadFile) {
  texUploadBtn.addEventListener('click', () => texUploadFile.click());
  texUploadFile.addEventListener('change', () => {
    const file = texUploadFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        texturePaintState.customImage = img;
        texturePaintState.pattern = 'custom';
        texturePaintState.enabled = true;
        if (texPatternSelect) texPatternSelect.value = 'none';
        texUploadBtn.textContent = '✅ ' + file.name.slice(0, 12);
        refreshStatus();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    texUploadFile.value = '';
  });
}

// Terrain sculpt wiring
const terrainSculptToggle = document.getElementById('terrain-sculpt-toggle');
const terrainBrushSelect  = document.getElementById('terrain-brush');
const terrainRadiusInput  = document.getElementById('terrain-radius');
const terrainStrengthInput = document.getElementById('terrain-strength');
if (terrainSculptToggle) terrainSculptToggle.addEventListener('change', () => {
  terrainSculptState.active = terrainSculptToggle.checked;
  if (terrainSculptToggle.checked) setMode('paint');
  refreshStatus();
});
if (terrainBrushSelect) terrainBrushSelect.addEventListener('change', () => {
  terrainSculptState.brush = terrainBrushSelect.value;
});
if (terrainRadiusInput) terrainRadiusInput.addEventListener('change', () => {
  terrainSculptState.radius = parseFloat(terrainRadiusInput.value) || 3;
});
if (terrainStrengthInput) terrainStrengthInput.addEventListener('change', () => {
  terrainSculptState.strength = parseFloat(terrainStrengthInput.value) || 0.3;
});

// Copy / Paste / Duplicate buttons
const btnCopy = document.getElementById('btn-copy');
const btnPaste = document.getElementById('btn-paste');
const btnDuplicate = document.getElementById('btn-duplicate');
if (btnCopy) btnCopy.addEventListener('click', () => copySelected());
if (btnPaste) btnPaste.addEventListener('click', () => pasteClipboard());
if (btnDuplicate) btnDuplicate.addEventListener('click', () => duplicateSelected());

// Save as Custom Object button
const btnSaveCustom = document.getElementById('btn-save-custom');
if (btnSaveCustom) btnSaveCustom.addEventListener('click', () => {
  const all = getAllSelected();
  if (!all.length) { alert('Select one or more objects first.'); return; }
  const name = prompt('Custom object name:', 'Custom ' + _nextCustomTemplateId);
  if (name === null) return;
  saveSelectionAsCustomObject(name || undefined);
});

syncScaleSideUI();

// Gamerule inputs — support variable names in number fields
function bindVarAwareGrInput(inputEl, ruleKey, parseFn, fallback) {
  if (!inputEl) return;
  inputEl.type = 'text';
  inputEl.inputMode = 'decimal';
  inputEl.addEventListener('change', () => {
    const raw = inputEl.value.trim();
    const num = parseFloat(raw);
    if (Number.isFinite(num)) {
      delete gameRulesVarBinds[ruleKey];
      gameRules[ruleKey] = parseFn(num);
      inputEl.style.color = '';
    } else if (raw) {
      // Treat as variable name
      gameRulesVarBinds[ruleKey] = raw;
      inputEl.style.color = '#57b8ff';
    } else {
      delete gameRulesVarBinds[ruleKey];
      gameRules[ruleKey] = fallback;
      inputEl.style.color = '';
    }
    markRestoreDirty();
  });
}
bindVarAwareGrInput(grJumpInput, 'jumpHeight', v => v || 8.5, 8.5);
bindVarAwareGrInput(grGravityInput, 'gravity', v => v || 24, 24);
if (grGravityEnabledInput) grGravityEnabledInput.addEventListener('change', () => { gameRules.gravityEnabled = !!grGravityEnabledInput.checked; });
grHeightInput.addEventListener('change', () => {
  gameRules.height = parseFloat(grHeightInput.value) || 1.75;
  gameRules.eyeHeight = gameRules.height - 0.15;
});
if (grCrouchHeightInput) grCrouchHeightInput.addEventListener('change', () => {
  gameRules.crouchHeight = parseFloat(grCrouchHeightInput.value) || 1.0;
});
bindVarAwareGrInput(grSprintInput, 'sprintSpeed', v => v || 12, 12);
bindVarAwareGrInput(grSprintDurationInput, 'sprintDuration', v => Math.max(0, v), 0);
bindVarAwareGrInput(grSprintRechargeInput, 'sprintRechargeTime', v => Math.max(0.1, v || 3), 3);
if (grAirDashEnabledInput) grAirDashEnabledInput.addEventListener('change', () => { gameRules.airDashEnabled = !!grAirDashEnabledInput.checked; });
bindVarAwareGrInput(grAirDashDurationInput, 'airDashDuration', v => Math.max(0.1, v || 0.5), 0.5);
if (grAllowAirSprintInput) grAllowAirSprintInput.addEventListener('change', () => { gameRules.allowAirSprint = !!grAllowAirSprintInput.checked; });
bindVarAwareGrInput(grMaxHpInput, 'maxHealth', v => Math.max(1, Math.round(v) || 100), 100);
grFallDmgInput.addEventListener('change', () => { gameRules.fallDamage = grFallDmgInput.checked; });
bindVarAwareGrInput(grFallDmgMinHtInput, 'fallDamageMinHeight', v => Math.max(0, v || 4), 4);
bindVarAwareGrInput(grFallDmgMultInput, 'fallDamageMultiplier', v => Math.max(0, v || 1), 1);
bindVarAwareGrInput(grSpawnProtTimeInput, 'spawnProtectTime', v => Math.max(0, v), 0);
grSpawnProtCondInput.addEventListener('change', () => { gameRules.spawnProtectCondition = grSpawnProtCondInput.value; });
if (grGroundTouchFnInput) grGroundTouchFnInput.addEventListener('change', () => { gameRules.groundTouchFunction = grGroundTouchFnInput.value.trim(); });
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
function setGridFill(enabled, color, texture) {
  gridFillEnabled = enabled;
  if (color !== undefined) gridFillColor = color;
  if (texture !== undefined) gridFillTexture = texture;
  // Rebuild fill planes with new material when texture changes
  if (texture !== undefined) {
    for (const [key, mesh] of gridFillPlanes) {
      scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
    }
    gridFillPlanes.clear();
  } else {
    // Just update color on existing planes
    for (const [, mesh] of gridFillPlanes) mesh.material.color.setHex(gridFillColor);
  }
  // Force chunk rebuild
  lastChunkX = Infinity;
  const camPos = activeCameraPosition();
  updateGridChunks(camPos.x, camPos.z);
}
gridFillEnabledInput.addEventListener('change', () => setGridFill(gridFillEnabledInput.checked));
gridFillColorInput.addEventListener('input', () => {
  gridFillColor = parseInt(gridFillColorInput.value.replace('#', ''), 16);
  gridFillTexture = 'none';
  const texSel = document.getElementById('grid-fill-texture');
  if (texSel) texSel.value = 'none';
  for (const [, mesh] of gridFillPlanes) { if (mesh.material.map) { mesh.material.map.dispose(); mesh.material.map = null; } mesh.material.color.setHex(gridFillColor); mesh.material.needsUpdate = true; }
});
{
  const texSel = document.getElementById('grid-fill-texture');
  if (texSel) texSel.addEventListener('change', () => {
    setGridFill(gridFillEnabled, undefined, texSel.value);
  });
}

// World border controls
function syncWorldBorderUI() {
  if (worldBorderEnabledInput) worldBorderEnabledInput.checked = worldBorderEnabled;
  if (worldBorderMinXInput) worldBorderMinXInput.value = worldBorderMinX;
  if (worldBorderMaxXInput) worldBorderMaxXInput.value = worldBorderMaxX;
  if (worldBorderMinZInput) worldBorderMinZInput.value = worldBorderMinZ;
  if (worldBorderMaxZInput) worldBorderMaxZInput.value = worldBorderMaxZ;
}
function readWorldBorderUI() {
  worldBorderEnabled = !!(worldBorderEnabledInput && worldBorderEnabledInput.checked);
  if (worldBorderMinXInput) worldBorderMinX = parseFloat(worldBorderMinXInput.value) || -50;
  if (worldBorderMaxXInput) worldBorderMaxX = parseFloat(worldBorderMaxXInput.value) || 50;
  if (worldBorderMinZInput) worldBorderMinZ = parseFloat(worldBorderMinZInput.value) || -50;
  if (worldBorderMaxZInput) worldBorderMaxZ = parseFloat(worldBorderMaxZInput.value) || 50;
}
if (worldBorderEnabledInput) worldBorderEnabledInput.addEventListener('change', readWorldBorderUI);
if (worldBorderMinXInput) worldBorderMinXInput.addEventListener('change', readWorldBorderUI);
if (worldBorderMaxXInput) worldBorderMaxXInput.addEventListener('change', readWorldBorderUI);
if (worldBorderMinZInput) worldBorderMinZInput.addEventListener('change', readWorldBorderUI);
if (worldBorderMaxZInput) worldBorderMaxZInput.addEventListener('change', readWorldBorderUI);

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
      alert('Failed to export standalone game HTML.\n\nError: ' + (err.message || err) + '\n\nMake sure the app is served from a web server.');
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
      alert('Failed to export runtime loader HTML.\n\nError: ' + (err.message || err) + '\n\nMake sure the app is served from a web server.');
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

// Sidebar Files panel buttons (mirror the topbar file buttons)
const sbSaveProject = document.getElementById('sb-save-project');
const sbSaveJson    = document.getElementById('sb-save-json');
const sbLoadJson    = document.getElementById('sb-load-json');
const sbExportGame  = document.getElementById('sb-export-game');
const sbExportLoader = document.getElementById('sb-export-loader');
const sbClearAll    = document.getElementById('sb-clear-all');
if (sbSaveProject) sbSaveProject.addEventListener('click', saveProjectToLibrary);
if (sbSaveJson) sbSaveJson.addEventListener('click', saveLevel);
if (sbLoadJson) sbLoadJson.addEventListener('click', () => loadInput.click());
if (sbExportGame) sbExportGame.addEventListener('click', async () => {
  sbExportGame.disabled = true; sbExportGame.textContent = '⏳ Building...';
  try { await exportStandaloneGameHtml(); }
  catch (err) { console.error(err); alert('Failed to export game HTML.\n\nError: ' + (err.message || err)); }
  finally { sbExportGame.textContent = '🎮 Export Game HTML'; sbExportGame.disabled = false; }
});
if (sbExportLoader) sbExportLoader.addEventListener('click', async () => {
  sbExportLoader.disabled = true; sbExportLoader.textContent = '⏳ Building...';
  try { await exportRuntimeLoaderHtml(); }
  catch (err) { console.error(err); alert('Failed to export loader HTML.\n\nError: ' + (err.message || err)); }
  finally { sbExportLoader.textContent = '🧩 Export Loader HTML'; sbExportLoader.disabled = false; }
});
if (sbClearAll) sbClearAll.addEventListener('click', clearAll);

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
      resetSceneForNewProject();
      loadLevelJSON(e.target.result, { pushHistory: false });
      currentProjectId = null;
      currentProjectName = '';
      // Prevent stale autosave banner from appearing over the imported project
      _pendingRestore = null;
      clearRestoreSlot();
      markRestoreDirty();
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

function bindReflectProps(mesh) {
  const metalRange = document.getElementById('prop-metalness-range');
  const metalNum = document.getElementById('prop-metalness-number');
  const roughRange = document.getElementById('prop-roughness-range');
  const roughNum = document.getElementById('prop-roughness-number');
  if (!metalRange || !metalNum || !roughRange || !roughNum || state.selectedObject !== mesh) return;

  const targets = getPropertyTargets(mesh).filter(t => t.material);
  if (!targets.length) return;

  const bindMaterialProp = (propName, rangeEl, numEl, undoType) => {
    let before = new Map(targets.map(t => [t, t.material[propName] ?? 0]));
    const sync = val => {
      const v = THREE.MathUtils.clamp(parseFloat(val) || 0, 0, 1);
      rangeEl.value = v;
      numEl.value = r3(v, 2);
      for (const t of targets) { t.material[propName] = v; t.material.needsUpdate = true; t.userData[propName] = v; }
    };
    const commit = val => {
      const v = THREE.MathUtils.clamp(parseFloat(val) || 0, 0, 1);
      for (const t of targets) {
        const b = before.get(t);
        if (b !== undefined && Math.abs(b - v) > 0.001) pushUndo({ type: undoType, mesh: t, before: b, after: v });
      }
      before = new Map(targets.map(t => [t, t.material[propName] ?? 0]));
      sync(v);
    };
    rangeEl.addEventListener('pointerdown', () => { before = new Map(targets.map(t => [t, t.material[propName] ?? 0])); });
    rangeEl.addEventListener('input', () => sync(rangeEl.value));
    rangeEl.addEventListener('change', () => commit(rangeEl.value));
    numEl.addEventListener('focus', () => { before = new Map(targets.map(t => [t, t.material[propName] ?? 0])); });
    numEl.addEventListener('input', () => sync(numEl.value));
    numEl.addEventListener('change', () => commit(numEl.value));
  };

  bindMaterialProp('metalness', metalRange, metalNum, 'metalness');
  bindMaterialProp('roughness', roughRange, roughNum, 'roughness');
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

function bindGameVisibleToggle(mesh) {
  const toggle = document.getElementById('prop-game-visible');
  if (!toggle || state.selectedObject !== mesh) return;
  toggle.addEventListener('change', () => {
    const targets = getPropertyTargets(mesh);
    for (const t of targets) {
      t.userData.hiddenInGame = !toggle.checked;
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
  const modeSelect = document.getElementById('prop-keypad-mode');
  const codeInput = document.getElementById('prop-keypad-code');


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
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      applyToTargets(before => ({ ...before, mode: modeSelect.value }));
    });
  }
  if (codeInput) {
    codeInput.addEventListener('change', () => {
      applyToTargets(before => ({ ...before, code: codeInput.value }));
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
  const drawInput = document.getElementById('prop-path-draw');
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

  if (drawInput) {
    drawInput.addEventListener('change', () => {
      const targets = getPropertyTargets(mesh).filter(m => !['spawn', 'checkpoint', 'trigger'].includes(m.userData.type));
      for (const t of targets) {
        if (drawInput.checked) {
          t.userData._drawAnimPath = true;
          t.userData._drawAnimPathOrigin = t.position.clone();
        } else {
          if (t.userData._drawAnimPathOrigin) t.position.copy(t.userData._drawAnimPathOrigin);
          delete t.userData._drawAnimPath;
          delete t.userData._drawAnimPathOrigin;
        }
      }
      if (!drawInput.checked) {
        selBox.setFromObject(state.selectedObject);
        transformControls.attach(state.selectedObject);
      }
      refreshSelectedPathPreview();
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

  const frontAxisInput = document.getElementById('prop-path-front-axis');
  if (frontAxisInput) {
    frontAxisInput.addEventListener('change', () => {
      withConfig(cfg => { cfg.frontAxis = PATH_FRONT_AXES.includes(frontAxisInput.value) ? frontAxisInput.value : '-Z'; });
    });
  }

  if (addSelectedBtn) {
    addSelectedBtn.addEventListener('click', () => {
      // For grouped objects, use the group center as the checkpoint position
      let pos;
      if (pathTargets.length > 1) {
        pos = new THREE.Vector3();
        for (const t of pathTargets) pos.add(t.position);
        pos.divideScalar(pathTargets.length);
      } else {
        pos = state.selectedObject ? state.selectedObject.position : mesh.position;
      }
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

  document.querySelectorAll('.prop-path-face').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [0, 0, 0] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.faceDirection = !!input.checked;
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-style').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [0, 0, 0] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.moveStyle = CHECKPOINT_MOVE_STYLES.includes(input.value) ? input.value : 'glide';
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-cp-speed').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [0, 0, 0] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.speed = Math.max(0, parseFloat(input.value) || 0);
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-wait').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [0, 0, 0] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.waitDuration = Math.max(0, parseFloat(input.value) || 0);
        cfg.checkpoints[idx] = cp;
      });
    });
  });

  document.querySelectorAll('.prop-path-pause').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.pathIndex, 10);
      if (!Number.isFinite(idx)) return;
      withConfig(cfg => {
        while (cfg.checkpoints.length <= idx) cfg.checkpoints.push(normalizeMovementPathCheckpoint({ pos: [0, 0, 0] }));
        const cp = normalizeMovementPathCheckpoint(cfg.checkpoints[idx]);
        cp.pauseOnArrival = !!input.checked;
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

function bindTeleportProps(mesh) {
  const pairInput = document.getElementById('prop-teleport-pair');
  if (!pairInput || state.selectedObject !== mesh) return;

  const teleportTargets = getPropertyTargets(mesh).filter(t => t.userData.type === 'teleport');
  if (!teleportTargets.length) return;

  pairInput.addEventListener('change', () => {
    for (const target of teleportTargets) {
      const existing = normalizeTeleportConfig(target.userData.teleportConfig);
      existing.pairLabel = pairInput.value;
      target.userData.teleportConfig = existing;
    }
    markRestoreDirty();
  });

  const crossWorldCb = document.getElementById('prop-teleport-cross-world');
  if (crossWorldCb) {
    crossWorldCb.addEventListener('change', () => {
      for (const target of teleportTargets) {
        const existing = normalizeTeleportConfig(target.userData.teleportConfig);
        existing.crossWorld = crossWorldCb.checked;
        target.userData.teleportConfig = existing;
      }
      markRestoreDirty();
      refreshProps();
    });
  }
  const targetWorldSel = document.getElementById('prop-teleport-target-world');
  if (targetWorldSel) {
    targetWorldSel.addEventListener('change', () => {
      for (const target of teleportTargets) {
        const existing = normalizeTeleportConfig(target.userData.teleportConfig);
        existing.targetWorld = targetWorldSel.value;
        target.userData.teleportConfig = existing;
      }
      markRestoreDirty();
    });
  }
  const previewBtn = document.getElementById('prop-teleport-preview');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const cfg = normalizeTeleportConfig(mesh.userData.teleportConfig);
      if (!cfg.pairLabel) { previewBtn.textContent = 'No pair set'; setTimeout(() => { previewBtn.textContent = '👁 View Destination'; }, 1500); return; }
      if (cfg.crossWorld) {
        const tw = worlds.find(w => w.id === cfg.targetWorld);
        previewBtn.textContent = tw ? `Destination: ${tw.name || tw.id}` : 'Target world not found';
        setTimeout(() => { previewBtn.textContent = '👁 View Destination'; }, 2000);
        return;
      }
      const dest = sceneObjects.find(o => o.userData.type === 'teleport' && (o.userData.label || '').toLowerCase() === cfg.pairLabel.toLowerCase() && o !== mesh && (o.userData.world || 'world_1') === activeWorldId);
      if (!dest) { previewBtn.textContent = 'Pair not found'; setTimeout(() => { previewBtn.textContent = '👁 View Destination'; }, 1500); return; }
      const dp = dest.position;
      orbitControls.target.set(dp.x, dp.y, dp.z);
      editorCam.position.set(dp.x + 5, dp.y + 4, dp.z + 5);
      orbitControls.update();
    });
  }
}

function bindTextProps(mesh) {
  if (state.selectedObject !== mesh) return;
  const targets = getPropertyTargets(mesh).filter(t => t.userData.type === 'text' || t.userData.type === 'text3d');
  const update = () => {
    const content = document.getElementById('prop-text-content');
    const font = document.getElementById('prop-text-font');
    const size = document.getElementById('prop-text-size');
    const color = document.getElementById('prop-text-color');
    const bg = document.getElementById('prop-text-bg');
    const bgTrans = document.getElementById('prop-text-bg-transparent');
    const align = document.getElementById('prop-text-align');
    const bold = document.getElementById('prop-text-bold');
    const italic = document.getElementById('prop-text-italic');
    for (const t of targets) {
      t.userData.textConfig = normalizeTextConfig({
        content: content?.value ?? 'Hello World',
        fontFamily: font?.value ?? 'Arial',
        fontSize: parseInt(size?.value, 10) || 48,
        textColor: color?.value ?? '#ffffff',
        bgColor: bgTrans?.checked ? 'transparent' : (bg?.value ?? '#000000'),
        align: align?.value ?? 'center',
        bold: !!bold?.checked,
        italic: !!italic?.checked,
      });
      _applyTextTexture(t);
    }
    markRestoreDirty();
  };
  ['prop-text-content','prop-text-font','prop-text-size','prop-text-color','prop-text-bg','prop-text-bg-transparent','prop-text-align','prop-text-bold','prop-text-italic'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', update);
    if (el) el.addEventListener('input', update);
  });
  const fontUploadBtn = document.getElementById('prop-text-font-upload');
  const fontFileInput = document.getElementById('prop-text-font-file');
  if (fontUploadBtn && fontFileInput) {
    fontUploadBtn.addEventListener('click', () => fontFileInput.click());
    fontFileInput.addEventListener('change', () => {
      const file = fontFileInput.files[0];
      if (!file) return;
      const name = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '');
      if (!name) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const entry = { name, dataUrl: reader.result };
        if (!customFonts.find(f => f.name === name)) customFonts.push(entry);
        await _registerCustomFont(entry);
        const fontInput = document.getElementById('prop-text-font');
        if (fontInput) { fontInput.value = name; update(); }
        markRestoreDirty();
        refreshProps();
      };
      reader.readAsDataURL(file);
    });
  }
}

function bindScreenProps(mesh) {
  if (state.selectedObject !== mesh) return;
  const targets = getPropertyTargets(mesh).filter(t => t.userData.type === 'screen');
  const typeSel = document.getElementById('prop-screen-type');
  if (typeSel) typeSel.addEventListener('change', () => {
    for (const t of targets) {
      const sc = normalizeScreenConfig(t.userData.screenConfig);
      sc.mediaType = typeSel.value;
      t.userData.screenConfig = sc;
      _applyScreenTexture(t);
    }
    markRestoreDirty();
    refreshProps();
  });
  const colorInput = document.getElementById('prop-screen-color');
  if (colorInput) colorInput.addEventListener('input', () => {
    for (const t of targets) {
      const sc = normalizeScreenConfig(t.userData.screenConfig);
      sc.screenColor = colorInput.value;
      t.userData.screenConfig = sc;
      _applyScreenTexture(t);
    }
    markRestoreDirty();
  });
  const uploadBtn = document.getElementById('prop-screen-upload');
  const fileInput = document.getElementById('prop-screen-file');
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        loadLevelJSON(e.target.result, { pushHistory: !runtimeMode });
        if (runtimeMode) {
          hideRuntimeLoaderOverlay();
          startRuntimeGame();
        } else {
          // Detach from any previously-open project so autosave does not overwrite it,
          // and start tracking the newly-loaded content immediately.
          currentProjectId = null;
          currentProjectName = '';
          clearRestoreSlot();
          markRestoreDirty();
        }
      };
      reader.readAsDataURL(file);
    });
  }
  // Video upload
  const videoUploadBtn = document.getElementById('prop-screen-video-upload');
  const videoFileInput = document.getElementById('prop-screen-video-file');
  if (videoUploadBtn && videoFileInput) {
    videoUploadBtn.addEventListener('click', () => videoFileInput.click());
    videoFileInput.addEventListener('change', () => {
      const file = videoFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        for (const t of targets) {
          const sc = normalizeScreenConfig(t.userData.screenConfig);
          sc.mediaType = 'video';
          sc.videoData = reader.result;
          t.userData.screenConfig = sc;
          _applyScreenTexture(t);
        }
        markRestoreDirty();
        refreshProps();
      };
      reader.readAsDataURL(file);
    });
  }
  // URL input
  const urlInput = document.getElementById('prop-screen-url');
  if (urlInput) urlInput.addEventListener('change', () => {
    for (const t of targets) {
      const sc = normalizeScreenConfig(t.userData.screenConfig);
      sc.url = urlInput.value;
      t.userData.screenConfig = sc;
      _applyScreenTexture(t);
    }
    markRestoreDirty();
  });
  // HTML content textarea
  const htmlInput = document.getElementById('prop-screen-html');
  if (htmlInput) htmlInput.addEventListener('change', () => {
    for (const t of targets) {
      const sc = normalizeScreenConfig(t.userData.screenConfig);
      sc.htmlContent = htmlInput.value;
      t.userData.screenConfig = sc;
      _applyScreenTexture(t);
    }
    markRestoreDirty();
  });
  // HTML file upload
  const htmlUploadBtn = document.getElementById('prop-screen-html-upload');
  const htmlFileInput = document.getElementById('prop-screen-html-file');
  if (htmlUploadBtn && htmlFileInput) {
    htmlUploadBtn.addEventListener('click', () => htmlFileInput.click());
    htmlFileInput.addEventListener('change', () => {
      const file = htmlFileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        for (const t of targets) {
          const sc = normalizeScreenConfig(t.userData.screenConfig);
          sc.htmlContent = reader.result;
          t.userData.screenConfig = sc;
          _applyScreenTexture(t);
        }
        markRestoreDirty();
        refreshProps();
      };
      reader.readAsText(file);
    });
  }
  // Interactive checkbox
  const interactiveCheck = document.getElementById('prop-screen-interactive');
  if (interactiveCheck) interactiveCheck.addEventListener('change', () => {
    for (const t of targets) {
      const sc = normalizeScreenConfig(t.userData.screenConfig);
      sc.interactive = interactiveCheck.checked;
      t.userData.screenConfig = sc;
    }
    markRestoreDirty();
  });
}

function bindCameraProps(mesh) {
  if (state.selectedObject !== mesh) return;
  const targets = getPropertyTargets(mesh).filter(t => t.userData.type === 'camera');
  const fovInput = document.getElementById('prop-camera-fov');
  const nearInput = document.getElementById('prop-camera-near');
  const farInput = document.getElementById('prop-camera-far');
  const update = () => {
    for (const t of targets) {
      t.userData.cameraConfig = normalizeCameraConfig({
        fov: parseFloat(fovInput?.value) || 60,
        near: parseFloat(nearInput?.value) || 0.1,
        far: parseFloat(farInput?.value) || 1000,
      });
    }
    markRestoreDirty();
  };
  if (fovInput) fovInput.addEventListener('change', update);
  if (nearInput) nearInput.addEventListener('change', update);
  if (farInput) farInput.addEventListener('change', update);
}

function bindTriggerStopProps(mesh) {
  const modeInput = document.getElementById('prop-trigger-stop-mode');
  if (!modeInput || state.selectedObject !== mesh) return;

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

  document.querySelectorAll('.tr-stop-fn').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.stopIndex, 10);
      if (!Number.isFinite(idx)) return;
      const name = input.value.trim();
      for (const target of triggerTargets) {
        const config = getMeshTriggerStopConfig(target);
        if (idx >= 0 && idx < config.functionNames.length) {
          if (name) { config.functionNames[idx] = name; }
          else { config.functionNames.splice(idx, 1); }
        }
        target.userData.triggerStopConfig = normalizeTriggerStopConfig(config);
      }
      refreshProps();
    });
  });

  document.querySelectorAll('.tr-stop-fn-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stopIndex, 10);
      if (!Number.isFinite(idx)) return;
      for (const target of triggerTargets) {
        const config = getMeshTriggerStopConfig(target);
        if (idx >= 0 && idx < config.functionNames.length) config.functionNames.splice(idx, 1);
        target.userData.triggerStopConfig = normalizeTriggerStopConfig(config);
      }
      refreshProps();
    });
  });

  const addBtn = document.getElementById('tr-add-stop-fn-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      for (const target of triggerTargets) {
        const config = getMeshTriggerStopConfig(target);
        config.functionNames.push('');
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

function bindJointProps(mesh) {
  if (!mesh || mesh.userData.type !== 'joint') return;
  const jc = getMeshJointConfig(mesh);
  if (!jc) return;

  const parentInput = document.getElementById('prop-joint-parent');
  const childInput = document.getElementById('prop-joint-child');
  const axisSelect = document.getElementById('prop-joint-axis');
  const modeSelect = document.getElementById('prop-joint-mode');
  const speedInput = document.getElementById('prop-joint-speed');
  const minInput = document.getElementById('prop-joint-min');
  const maxInput = document.getElementById('prop-joint-max');

  if (parentInput) parentInput.addEventListener('change', () => {
    jc.parentLabel = parentInput.value.trim();
    mesh.userData.jointConfig = jc;
    updateJointIndicators();
  });
  if (childInput) childInput.addEventListener('change', () => {
    jc.childLabel = childInput.value.trim();
    mesh.userData.jointConfig = jc;
    updateJointIndicators();
  });
  if (axisSelect) axisSelect.addEventListener('change', () => {
    jc.axis = axisSelect.value;
    mesh.userData.jointConfig = jc;
    updateJointIndicators();
  });
  if (modeSelect) modeSelect.addEventListener('change', () => {
    jc.mode = modeSelect.value;
    mesh.userData.jointConfig = jc;
  });
  if (speedInput) speedInput.addEventListener('change', () => {
    jc.speed = Math.max(0, parseFloat(speedInput.value) || 0);
    mesh.userData.jointConfig = jc;
  });
  if (minInput) minInput.addEventListener('change', () => {
    jc.minAngle = parseFloat(minInput.value) || -180;
    mesh.userData.jointConfig = jc;
  });
  if (maxInput) maxInput.addEventListener('change', () => {
    jc.maxAngle = parseFloat(maxInput.value) || 180;
    mesh.userData.jointConfig = jc;
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
  const isJoint = m.userData.type === 'joint';
  const isSkeleton = m.userData.type === 'skeleton';
  const canToggleSwitch = isSwitchableObjectType(m.userData.type);
  const switchConfig = getMeshSwitchConfig(m);
  const collisionMode = getMeshCollisionMode(m);
  const hitboxConfig = getMeshHitboxConfig(m);
  const autoHitbox = computeAutoHitboxBox(m, new THREE.Vector3(), new THREE.Vector3());
  const activeHitbox = hitboxConfig.mode === 'manual'
    ? { center: new THREE.Vector3().fromArray(hitboxConfig.offset), size: new THREE.Vector3().fromArray(hitboxConfig.size) }
    : autoHitbox;
  const checkpointConfig = isCheckpoint ? getMeshCheckpointConfig(m) : null;
  const isTeleport = m.userData.type === 'teleport';
  const teleportConfig = isTeleport ? getMeshTeleportConfig(m) : null;
  const isNpc = m.userData.type === 'npc';
  const npcConfig = isNpc ? normalizeNpcConfig(m.userData.npcConfig) : null;
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
  const solidnessControls = `<div class="prop-row"><span class="prop-key" title="How much this object resists being pushed through (1 = fully solid, 0 = pass-through)">Density</span><div class="prop-controls"><input id="prop-solidness-range" type="range" min="0" max="1" step="0.01" value="${clampMeshSolidness(m.userData.solidness ?? 1)}"/><input id="prop-solidness-number" type="number" min="0" max="1" step="0.01" value="${r3(clampMeshSolidness(m.userData.solidness ?? 1), 2)}"/></div></div>`;
  const opacityControls = `<div class="prop-row"><span class="prop-key">Opacity</span><div class="prop-controls"><input id="prop-opacity-range" type="range" min="0.02" max="1" step="0.01" value="${clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1)}"/><input id="prop-opacity-number" type="number" min="0.02" max="1" step="0.01" value="${r3(clampMeshOpacity(m.userData.opacity ?? m.material.opacity ?? 1), 2)}"/></div></div>`;
  const curMetalness = m.material.metalness ?? 0;
  const curRoughness = m.material.roughness ?? 0.5;
  const reflectControls = `<div class="prop-row"><span class="prop-key">Metal</span><div class="prop-controls"><input id="prop-metalness-range" type="range" min="0" max="1" step="0.01" value="${r3(curMetalness, 2)}"/><input id="prop-metalness-number" type="number" min="0" max="1" step="0.01" value="${r3(curMetalness, 2)}"/></div></div><div class="prop-row"><span class="prop-key">Rough</span><div class="prop-controls"><input id="prop-roughness-range" type="range" min="0" max="1" step="0.01" value="${r3(curRoughness, 2)}"/><input id="prop-roughness-number" type="number" min="0" max="1" step="0.01" value="${r3(curRoughness, 2)}"/></div></div>`;
  const tractionToggle = `<div class="prop-row"><span class="prop-key" title="When enabled, the player moves with this object (like standing on a moving platform)">Moving Platform</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-traction-toggle" type="checkbox" ${m.userData.traction ? 'checked' : ''}/> Carry player</label></div></div>`;
  const gameVisibleToggle = `<div class="prop-row"><span class="prop-key">In-Game</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-game-visible" type="checkbox" ${!m.userData.hiddenInGame ? 'checked' : ''}/> Visible</label></div></div>`;
  const collisionControls = `<div class="prop-row"><span class="prop-key" title="How the game checks if the player bumps into this object">Collision</span><div class="prop-controls"><select id="prop-collision-mode" style="font-size:10px;padding:2px 3px"><option value="aabb" ${collisionMode !== 'geometry' ? 'selected' : ''}>Simple Box</option><option value="geometry" ${collisionMode === 'geometry' ? 'selected' : ''}>Exact Shape</option></select><span style="color:var(--muted);font-size:9px">exact shape = matches erased holes</span></div></div>
    ${collisionMode !== 'geometry' ? `<div class="prop-row"><span class="prop-key">Hitbox</span><div class="prop-controls"><select id="prop-hitbox-mode" style="font-size:10px;padding:2px 3px"><option value="auto" ${hitboxConfig.mode !== 'manual' ? 'selected' : ''}>Auto</option><option value="manual" ${hitboxConfig.mode === 'manual' ? 'selected' : ''}>Manual</option></select><button id="prop-hitbox-autofit" type="button" style="font-size:10px;padding:2px 6px">Auto Fit</button></div></div>
    <div class="prop-row"><span class="prop-key">Auto Box</span><span class="prop-val" style="font-size:9px">${r3(autoHitbox.size.x, 2)} × ${r3(autoHitbox.size.y, 2)} × ${r3(autoHitbox.size.z, 2)}</span></div>
    ${hitboxConfig.mode === 'manual' ? `<div class="prop-row"><span class="prop-key" title="Custom hitbox dimensions (width, height, depth)">Hitbox Size</span><div class="prop-controls"><input id="prop-hitbox-size-x" type="number" step="0.05" value="${r3(activeHitbox.size.x, 2)}" style="width:52px"/><input id="prop-hitbox-size-y" type="number" step="0.05" value="${r3(activeHitbox.size.y, 2)}" style="width:52px"/><input id="prop-hitbox-size-z" type="number" step="0.05" value="${r3(activeHitbox.size.z, 2)}" style="width:52px"/></div></div>
    <div class="prop-row"><span class="prop-key" title="Move the hitbox center relative to the object">Hitbox Offset</span><div class="prop-controls"><input id="prop-hitbox-offset-x" type="number" step="0.05" value="${r3(activeHitbox.center.x, 2)}" style="width:52px"/><input id="prop-hitbox-offset-y" type="number" step="0.05" value="${r3(activeHitbox.center.y, 2)}" style="width:52px"/><input id="prop-hitbox-offset-z" type="number" step="0.05" value="${r3(activeHitbox.center.z, 2)}" style="width:52px"/></div></div>` : ''}` : ''}`;

  let lightControls = '';
  if (hasLight) {
    const dist = m.userData.lightDistance || LIGHT_BLOCK_DISTANCE;
    lightControls = `
      <div class="prop-row"><span class="prop-key">Bright</span><div class="prop-controls"><input id="prop-light-intensity-range" type="range" min="0" max="100" step="0.1" value="${getMeshLightIntensity(m)}"/><input id="prop-light-intensity-number" type="number" min="0" max="100" step="0.1" value="${r3(getMeshLightIntensity(m), 1)}"/></div></div>
      <div class="prop-row"><span class="prop-key" title="How far the light reaches">Range</span><div class="prop-controls"><input id="prop-light-distance-range" type="range" min="1" max="500" step="1" value="${dist}"/><input id="prop-light-distance-number" type="number" min="1" max="500" step="1" value="${dist}"/></div></div>`;
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
    const cpSpeed = Number.isFinite(cp.speed) ? cp.speed : 0;
    const cpWait = Number.isFinite(cp.waitDuration) ? cp.waitDuration : 0;
    const cpStyle = cp.moveStyle || 'glide';
    const cpSpeedDisplay = cpSpeed > 0 ? r3(cpSpeed, 2) : '';
    const cpSpeedPlaceholder = r3(pathConfig.speed, 2);
    return `<div class="prop-row" style="padding:2px 11px"><span class="prop-key" style="font-size:9px;min-width:24px">#${idx + 1}</span><div class="prop-controls" style="gap:4px;flex-wrap:wrap"><input class="prop-path-x" data-path-index="${idx}" type="number" step="0.1" value="${r3(px, 2)}" style="width:48px"/><input class="prop-path-y" data-path-index="${idx}" type="number" step="0.1" value="${r3(py, 2)}" style="width:48px"/><input class="prop-path-z" data-path-index="${idx}" type="number" step="0.1" value="${r3(pz, 2)}" style="width:48px"/><label style="display:flex;align-items:center;gap:2px;cursor:pointer;font-size:9px" title="Rotate to face this checkpoint"><input class="prop-path-face" data-path-index="${idx}" type="checkbox" ${cp.faceDirection ? 'checked' : ''}/> Face</label><input class="prop-path-fn" data-path-index="${idx}" list="prop-path-fn-options" type="text" value="${escapeHtml(cp.functionName || '')}" placeholder="on-arrive fn" style="width:94px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 3px;font-size:10px"/><select class="prop-path-style" data-path-index="${idx}" style="font-size:9px;padding:1px 3px" title="Movement style to this point">${CHECKPOINT_MOVE_STYLES.map(s => `<option value="${s}" ${cpStyle === s ? 'selected' : ''}>${s}</option>`).join('')}</select><span style="font-size:8px;color:var(--muted)" title="Speed to this point (empty = path default)">Spd</span><input class="prop-path-cp-speed" data-path-index="${idx}" type="number" min="0" step="0.1" value="${cpSpeedDisplay}" placeholder="${cpSpeedPlaceholder}" style="width:44px" title="Speed to this point (empty = use path default ${cpSpeedPlaceholder})"/><span style="font-size:8px;color:var(--muted)" title="Wait duration (seconds) at this point before moving on">Wait</span><input class="prop-path-wait" data-path-index="${idx}" type="number" min="0" step="0.1" value="${r3(cpWait, 2)}" style="width:44px" title="Seconds to wait at this checkpoint"/><label style="display:flex;align-items:center;gap:2px;cursor:pointer;font-size:9px" title="Pause on arrival (requires function resume)"><input class="prop-path-pause" data-path-index="${idx}" type="checkbox" ${cp.pauseOnArrival ? 'checked' : ''}/> Pause</label><button class="prop-path-set-sel" data-path-index="${idx}" style="font-size:9px;padding:1px 5px">Sel</button><button class="prop-path-pick ${pickArmed ? 'active' : ''}" data-path-index="${idx}" style="font-size:9px;padding:1px 5px">Pick</button><button class="ct-del prop-path-del" data-path-index="${idx}" title="Delete checkpoint">✕</button></div></div>`;
  }).join('');
  const pathControls = canEditPath
    ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Path</span><div class="prop-controls" style="gap:6px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:9px"><input id="prop-path-enabled" type="checkbox" ${pathConfig.enabled ? 'checked' : ''}/> Ready</label><label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:9px" title="While checked, moving this object places checkpoints instead of moving existing ones"><input id="prop-path-draw" type="checkbox" ${m.userData._drawAnimPath ? 'checked' : ''}/> Draw</label><span style="font-size:9px;color:var(--muted)">Speed</span><input id="prop-path-speed" type="number" min="0.01" step="0.1" value="${r3(pathConfig.speed, 2)}" style="width:56px"/><label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:9px"><input id="prop-path-loop" type="checkbox" ${pathConfig.loop ? 'checked' : ''}/> Loop</label><span style="font-size:9px;color:var(--muted)">Front</span><select id="prop-path-front-axis" style="font-size:9px;padding:1px 3px">${PATH_FRONT_AXES.map(a => `<option value="${a}" ${pathConfig.frontAxis === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div><div class="prop-row" style="padding:2px 11px"><div class="prop-controls" style="gap:4px;flex-wrap:wrap"><button id="prop-path-add-selected" style="font-size:9px;padding:1px 6px">+ Sel Pos</button><button id="prop-path-add-camera" style="font-size:9px;padding:1px 6px">+ Cam Pos</button><button id="prop-path-clear" class="danger-btn" style="font-size:9px;padding:1px 6px">Clear</button><span style="font-size:9px;color:var(--muted)">Call with function action: path -> start</span></div></div><div class="prop-row" style="padding:0 11px 3px 11px"><span style="font-size:9px;color:var(--muted)">Pick = click in viewport to place checkpoint</span></div><datalist id="prop-path-fn-options">${pathFnOptions}</datalist>${pathRows || '<div class="prop-row" style="padding:2px 11px"><span class="prop-val" style="font-size:10px;color:var(--muted)">No checkpoints yet.</span></div>'}`
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
      <div class="prop-row"><span class="prop-key">Pad Mode</span><div class="prop-controls"><select id="prop-keypad-mode" style="font-size:10px;padding:2px 3px"><option value="variable" ${keypadConfig.mode !== 'code' ? 'selected' : ''}>Variable</option><option value="code" ${keypadConfig.mode === 'code' ? 'selected' : ''}>Code</option></select><span style="color:var(--muted);font-size:9px">${keypadConfig.mode === 'code' ? 'enter a set code to trigger' : 'sets a variable on submit'}</span></div></div>
      ${keypadConfig.mode === 'code' ? `<div class="prop-row"><span class="prop-key">Code</span><div class="prop-controls"><input id="prop-keypad-code" type="text" value="${escapeHtml(keypadConfig.code)}" placeholder="1234" style="width:118px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/><span style="color:var(--muted);font-size:9px">secret code</span></div></div>` : ''}
      <div class="prop-row"><span class="prop-key">Digits</span><div class="prop-controls"><input id="prop-keypad-digits" type="number" min="1" max="12" step="1" value="${keypadConfig.maxDigits}" style="width:56px"/><span style="color:var(--muted);font-size:9px">max entry length</span></div></div>
      <div class="prop-row"><span class="prop-key">UI Offset</span><div class="prop-controls"><input id="prop-keypad-offset-x" type="number" step="1" value="${r3(keypadConfig.offsetX, 0)}" style="width:56px"/><input id="prop-keypad-offset-y" type="number" step="1" value="${r3(keypadConfig.offsetY, 0)}" style="width:56px"/><span style="color:var(--muted);font-size:9px">from center</span></div></div>`
    : '';

  const checkpointControls = isCheckpoint
    ? `<div class="prop-row"><span class="prop-key">Checkpt</span><div class="prop-controls"><select id="prop-checkpoint-interaction" style="font-size:10px;padding:2px 3px"><option value="touch" ${checkpointConfig.interaction === 'touch' ? 'selected' : ''}>Touch</option><option value="shoot" ${checkpointConfig.interaction === 'shoot' ? 'selected' : ''}>Shoot</option><option value="switch" ${checkpointConfig.interaction === 'switch' ? 'selected' : ''}>Switch</option></select><span style="color:var(--muted);font-size:9px">sets next respawn</span></div></div>`
    : '';

  const teleportControls = isTeleport
    ? `<div class="prop-row"><span class="prop-key">Pair</span><div class="prop-controls"><input id="prop-teleport-pair" type="text" value="${escapeHtml(teleportConfig.pairLabel)}" placeholder="destination name" style="width:118px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/><span style="color:var(--muted);font-size:9px">Name of paired teleport block</span></div></div><div class="prop-row"><span class="prop-key">Cross-World</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px"><input id="prop-teleport-cross-world" type="checkbox" ${teleportConfig.crossWorld ? 'checked' : ''}/> Enabled</label></div></div>${teleportConfig.crossWorld ? `<div class="prop-row"><span class="prop-key">Target World</span><div class="prop-controls"><select id="prop-teleport-target-world" style="font-size:10px;padding:2px 3px">${worlds.map(w => `<option value="${w.id}" ${teleportConfig.targetWorld === w.id ? 'selected' : ''}>${w.name || w.id}</option>`).join('')}</select></div></div>` : ''}<div class="prop-row"><span class="prop-key">Preview</span><div class="prop-controls"><button id="prop-teleport-preview" style="font-size:9px;padding:2px 6px" title="Snap camera to the paired teleport destination">👁 View Destination</button></div></div>`
    : '';

  // Text block controls
  const isText = m.userData.type === 'text' || m.userData.type === 'text3d';
  const textConfig = isText ? normalizeTextConfig(m.userData.textConfig) : null;
  const textControls = isText
    ? `<div class="prop-row"><span class="prop-key">Text</span><div class="prop-controls"><textarea id="prop-text-content" rows="3" style="width:170px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:3px 5px;font-size:11px;font-family:inherit;resize:vertical">${escapeHtml(textConfig.content)}</textarea></div></div><div class="prop-row"><span class="prop-key">Font</span><div class="prop-controls"><input id="prop-text-font" type="text" list="prop-text-font-list" value="${escapeHtml(textConfig.fontFamily)}" style="width:80px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px"/><datalist id="prop-text-font-list">${_getAvailableFontNames().map(n => `<option value="${escapeHtml(n)}"/>`).join('')}</datalist><input id="prop-text-size" type="number" min="8" max="200" step="1" value="${textConfig.fontSize}" style="width:44px" title="Font size"/><button id="prop-text-font-upload" style="font-size:8px;padding:1px 4px" title="Upload .ttf / .otf / .woff font file">+</button><input id="prop-text-font-file" type="file" accept=".ttf,.otf,.woff,.woff2" style="display:none"/></div></div><div class="prop-row"><span class="prop-key">Style</span><div class="prop-controls"><input id="prop-text-color" type="color" value="${textConfig.textColor}" title="Text color"/><input id="prop-text-bg" type="color" value="${textConfig.bgColor === 'transparent' ? '#000000' : textConfig.bgColor}" title="Background color"/><label style="font-size:9px;cursor:pointer"><input id="prop-text-bg-transparent" type="checkbox" ${textConfig.bgColor === 'transparent' ? 'checked' : ''}/> No BG</label></div></div><div class="prop-row"><span class="prop-key">Align</span><div class="prop-controls"><select id="prop-text-align" style="font-size:10px"><option value="left" ${textConfig.align === 'left' ? 'selected' : ''}>Left</option><option value="center" ${textConfig.align === 'center' ? 'selected' : ''}>Center</option><option value="right" ${textConfig.align === 'right' ? 'selected' : ''}>Right</option></select><label style="font-size:9px;cursor:pointer"><input id="prop-text-bold" type="checkbox" ${textConfig.bold ? 'checked' : ''}/> B</label><label style="font-size:9px;cursor:pointer"><input id="prop-text-italic" type="checkbox" ${textConfig.italic ? 'checked' : ''}/> I</label></div></div>`
    : '';

  // Screen/media controls
  const isScreen = m.userData.type === 'screen';
  const screenConfig = isScreen ? normalizeScreenConfig(m.userData.screenConfig) : null;
  const _screenMediaOpts = [['color','Solid Color'],['image','Image'],['video','Video'],['url','Website URL'],['html','HTML']];
  const screenControls = isScreen
    ? `<div class="prop-row"><span class="prop-key">Media</span><div class="prop-controls"><select id="prop-screen-type" style="font-size:10px">${_screenMediaOpts.map(([v,l]) => `<option value="${v}" ${screenConfig.mediaType === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>` +
      `<div class="prop-row"><span class="prop-key">Interact</span><div class="prop-controls"><label style="font-size:10px;cursor:pointer"><input id="prop-screen-interactive" type="checkbox" ${screenConfig.interactive ? 'checked' : ''}/> Clickable in-game</label></div></div>` +
      (screenConfig.mediaType === 'color' ? `<div class="prop-row"><span class="prop-key">Color</span><div class="prop-controls"><input id="prop-screen-color" type="color" value="${screenConfig.screenColor}"/></div></div>` : '') +
      (screenConfig.mediaType === 'image' ? `<div class="prop-row"><span class="prop-key">Image</span><div class="prop-controls"><button id="prop-screen-upload" style="font-size:9px;padding:2px 6px">Upload Image</button><input id="prop-screen-file" type="file" accept="image/*" style="display:none"/></div></div>` : '') +
      (screenConfig.mediaType === 'video' ? `<div class="prop-row"><span class="prop-key">Video</span><div class="prop-controls"><button id="prop-screen-video-upload" style="font-size:9px;padding:2px 6px">Upload Video</button><input id="prop-screen-video-file" type="file" accept="video/*" style="display:none"/></div></div>` : '') +
      (screenConfig.mediaType === 'url' ? `<div class="prop-row"><span class="prop-key">URL</span><div class="prop-controls"><input id="prop-screen-url" type="text" value="${escapeHtml(screenConfig.url)}" placeholder="https://example.com" style="width:160px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px"/></div></div>` : '') +
      (screenConfig.mediaType === 'html' ? `<div class="prop-row"><span class="prop-key">HTML</span><div class="prop-controls"><textarea id="prop-screen-html" rows="4" style="width:170px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:3px 5px;font-size:10px;font-family:monospace;resize:vertical" placeholder="&lt;h1&gt;Hello&lt;/h1&gt;">${escapeHtml(screenConfig.htmlContent)}</textarea></div></div><div class="prop-row"><div class="prop-controls"><button id="prop-screen-html-upload" style="font-size:9px;padding:2px 6px">Upload HTML File</button><input id="prop-screen-html-file" type="file" accept=".html,.htm" style="display:none"/></div></div>` : '')
    : '';

  // Camera controls
  const isCamera = m.userData.type === 'camera';
  const cameraConfig = isCamera ? normalizeCameraConfig(m.userData.cameraConfig) : null;
  const cameraControls = isCamera
    ? `<div class="prop-row"><span class="prop-key">FOV</span><div class="prop-controls"><input id="prop-camera-fov" type="number" min="10" max="150" step="1" value="${cameraConfig.fov}" style="width:56px"/></div></div><div class="prop-row"><span class="prop-key">Near</span><div class="prop-controls"><input id="prop-camera-near" type="number" min="0.01" step="0.1" value="${cameraConfig.near}" style="width:56px"/></div></div><div class="prop-row"><span class="prop-key">Far</span><div class="prop-controls"><input id="prop-camera-far" type="number" min="1" step="10" value="${cameraConfig.far}" style="width:56px"/></div></div>`
    : '';

  // NPC controls
  const npcControls = isNpc
    ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Identity</span></div>` +
      `<div class="prop-row"><span class="prop-key">Name</span><div class="prop-controls"><input id="prop-npc-name" type="text" value="${escapeHtml(npcConfig.displayName)}" style="width:130px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px" placeholder="NPC name"/></div></div>` +
      `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Appearance</span></div>` +
      `<div class="prop-row"><span class="prop-key">Skin</span><div class="prop-controls"><input id="prop-npc-skin" type="color" value="${'#' + npcConfig.skinColor.toString(16).padStart(6, '0')}" title="Skin color"/><span style="font-size:9px;color:var(--muted)">Skin</span></div></div>` +
      `<div class="prop-row"><span class="prop-key">Shirt</span><div class="prop-controls"><input id="prop-npc-shirt" type="color" value="${'#' + npcConfig.shirtColor.toString(16).padStart(6, '0')}" title="Shirt color"/><span style="font-size:9px;color:var(--muted)">Shirt</span></div></div>` +
      `<div class="prop-row"><span class="prop-key">Pants</span><div class="prop-controls"><input id="prop-npc-pants" type="color" value="${'#' + npcConfig.pantsColor.toString(16).padStart(6, '0')}" title="Pants color"/><span style="font-size:9px;color:var(--muted)">Pants</span></div></div>` +
      `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Motion</span></div>` +
      `<div class="prop-row"><span class="prop-key">Behavior</span><div class="prop-controls"><select id="prop-npc-behavior" style="font-size:10px"><option value="idle" ${npcConfig.behavior === 'idle' ? 'selected' : ''}>Idle</option><option value="wander" ${npcConfig.behavior === 'wander' ? 'selected' : ''}>Wander</option><option value="patrol" ${npcConfig.behavior === 'patrol' ? 'selected' : ''}>Patrol (uses path)</option></select></div></div>` +
      `<div class="prop-row"><span class="prop-key">Walk Speed</span><div class="prop-controls"><input id="prop-npc-speed" type="number" min="0.1" max="10" step="0.1" value="${npcConfig.walkSpeed}" style="width:50px"/></div></div>` +
      `<div class="prop-row"><span class="prop-key">Wander Radius</span><div class="prop-controls"><input id="prop-npc-wander-radius" type="number" min="0.5" max="50" step="0.5" value="${npcConfig.wanderRadius}" style="width:50px" title="How far the NPC wanders from its origin"/></div></div>` +
      `<div class="prop-row"><span class="prop-key">Talk Range</span><div class="prop-controls"><input id="prop-npc-interact-dist" type="number" min="0.5" max="20" step="0.5" value="${npcConfig.interactDistance}" style="width:50px" title="How close the player must be to interact"/></div></div>` +
      `<div class="prop-row"><span class="prop-key">Face Player</span><div class="prop-controls"><label style="font-size:10px;cursor:pointer"><input id="prop-npc-face-player" type="checkbox" ${npcConfig.facePlayer ? 'checked' : ''}/> Turn toward player</label></div></div>` +
      `<div class="prop-row"><span class="prop-key">Idle Anim</span><div class="prop-controls"><label style="font-size:10px;cursor:pointer"><input id="prop-npc-idle-anim" type="checkbox" ${npcConfig.idleAnimation ? 'checked' : ''}/> Breathing / sway</label></div></div>` +
      `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Dialogue</span><span style="font-size:9px;color:var(--muted);margin-left:auto">${npcConfig.dialogueLines.length} line${npcConfig.dialogueLines.length !== 1 ? 's' : ''}</span></div>` +
      `<div class="prop-row"><div class="prop-controls" style="width:100%"><textarea id="prop-npc-dialogue" rows="6" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:4px 6px;font-size:11px;font-family:inherit;resize:vertical;line-height:1.4" placeholder="One line per dialogue message&#10;Player presses E to advance&#10;Last line closes the dialogue">${escapeHtml(npcConfig.dialogueLines.join('\n'))}</textarea></div></div>`
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
      ${stopConfig.functionNames.map((fn, si) => `<div class="prop-row" style="padding:2px 11px"><span class="prop-key" style="font-size:9px;min-width:50px">${si === 0 ? 'Fns' : ''}</span><div class="prop-controls" style="gap:4px"><input class="tr-stop-fn" data-stop-index="${si}" list="${functionListId}" type="text" value="${escapeHtml(fn)}" placeholder="functionName" style="width:130px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 4px;font-size:10px;font-family:inherit"/><button class="ct-del tr-stop-fn-del" data-stop-index="${si}" title="Remove">✕</button></div></div>`).join('')}
      <div class="prop-row" style="padding:3px 11px"><div class="prop-controls"><button id="tr-add-stop-fn-btn" style="font-size:10px;padding:2px 6px">+ Stop Fn</button></div></div>` : ''}
      ${canEditControlFunctions ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Calls</span></div><datalist id="${functionListId}">${functionOptions}</datalist>
      ${callsHtml}
      <div class="prop-row" style="padding:3px 11px"><div class="prop-controls"><button id="tr-add-call-btn" style="font-size:10px;padding:2px 6px">+ Call</button></div></div>` : ''}`;
  }

  const escapedLabel = (m.userData.label || '').replace(/"/g, '&quot;');

  // Joint controls
  const jointConfig = isJoint ? getMeshJointConfig(m) : null;
  const _jointLabelOpts = isJoint ? renderDatalistOptions(sceneObjects.filter(o => o !== m && o.userData.label).map(o => o.userData.label)) : '';

  // Skeleton controls
  const skelConfig = isSkeleton ? getMeshSkeletonConfig(m) : null;
  const skelDefNames = Object.keys(skeletonDefinitions);
  const skelDef = skelConfig?.definitionName ? skeletonDefinitions[skelConfig.definitionName] : null;
  const skelAnimNames = skelDef ? Object.keys(skelDef.animations || {}) : [];
  const skelPoseNames = skelDef ? Object.keys(skelDef.poses || {}) : [];
  const skeletonControls = isSkeleton && skelConfig
    ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Skeleton</span></div>
       <div class="prop-row"><span class="prop-key">Definition</span><div class="prop-controls"><select id="prop-skel-def" style="font-size:10px;padding:2px 3px;max-width:130px"><option value="">(none)</option>${skelDefNames.map(n => `<option value="${escapeHtml(n)}" ${skelConfig.definitionName === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select><button id="prop-skel-new-def" style="font-size:9px;padding:2px 5px" title="Create new definition">+</button></div></div>
       <div class="prop-row"><span class="prop-key">Editor</span><div class="prop-controls"><button id="prop-skel-open-editor" style="font-size:10px;padding:2px 8px" ${!skelConfig.definitionName ? 'disabled' : ''}>Open Skeleton Editor</button></div></div>
       <div class="prop-row"><span class="prop-key">Animation</span><div class="prop-controls"><select id="prop-skel-anim" style="font-size:10px;padding:2px 3px;max-width:130px"><option value="">(none)</option>${skelAnimNames.map(n => `<option value="${escapeHtml(n)}" ${skelConfig.currentAnimation === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div></div>
       <div class="prop-row"><span class="prop-key">Pose</span><div class="prop-controls"><select id="prop-skel-pose" style="font-size:10px;padding:2px 3px;max-width:130px"><option value="">(default)</option>${skelPoseNames.map(n => `<option value="${escapeHtml(n)}" ${skelConfig.currentPose === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div></div>
       <div class="prop-row"><span class="prop-key">Auto Play</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-skel-autoplay" type="checkbox" ${skelConfig.playOnStart ? 'checked' : ''}/> On Start</label></div></div>
       <div class="prop-row"><span class="prop-key">Loop</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-skel-loop" type="checkbox" ${skelConfig.loopAnimation ? 'checked' : ''}/> Loop Clip</label></div></div>
       <div class="prop-row"><span class="prop-key">Speed</span><div class="prop-controls"><input id="prop-skel-speed" type="number" min="0" step="0.1" value="${skelConfig.animationSpeed}" style="width:60px"/><span style="color:var(--muted);font-size:9px">x</span></div></div>
       <div class="prop-row"><span class="prop-key">Bones</span><span class="prop-val" style="font-size:9px;color:var(--muted)">${skelDef ? skelDef.bones.length : 0} bones, ${skelAnimNames.length} clips, ${skelPoseNames.length} poses</span></div>`
    : '';
  const jointControls = isJoint && jointConfig
    ? `<div class="prop-row" style="padding:5px 11px;border-bottom:none"><span class="prop-key" style="font-size:9px;font-weight:700">Joint</span></div>
       <div class="prop-row"><span class="prop-key">Parent</span><div class="prop-controls"><input id="prop-joint-parent" list="prop-joint-label-opts" type="text" value="${escapeHtml(jointConfig.parentLabel)}" placeholder="parent object name" style="width:130px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/></div></div>
       <div class="prop-row"><span class="prop-key">Child</span><div class="prop-controls"><input id="prop-joint-child" list="prop-joint-label-opts" type="text" value="${escapeHtml(jointConfig.childLabel)}" placeholder="child object name" style="width:130px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/></div></div>
       <datalist id="prop-joint-label-opts">${_jointLabelOpts}</datalist>
       <div class="prop-row"><span class="prop-key">Axis</span><div class="prop-controls"><select id="prop-joint-axis" style="font-size:10px;padding:2px 3px">${JOINT_AXES.map(a => `<option value="${a}" ${jointConfig.axis === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div></div>
       <div class="prop-row"><span class="prop-key">Mode</span><div class="prop-controls"><select id="prop-joint-mode" style="font-size:10px;padding:2px 3px"><option value="auto" ${jointConfig.mode === 'auto' ? 'selected' : ''}>Auto (oscillate)</option><option value="manual" ${jointConfig.mode === 'manual' ? 'selected' : ''}>Manual (function)</option><option value="fixed" ${jointConfig.mode === 'fixed' ? 'selected' : ''}>Fixed (link only)</option></select></div></div>
       <div class="prop-row"><span class="prop-key">Speed</span><div class="prop-controls"><input id="prop-joint-speed" type="number" min="0" step="0.1" value="${r3(jointConfig.speed, 2)}" style="width:60px"/><span style="color:var(--muted);font-size:9px">rot/s</span></div></div>
       <div class="prop-row"><span class="prop-key">Min°</span><div class="prop-controls"><input id="prop-joint-min" type="number" step="1" value="${r3(jointConfig.minAngle, 1)}" style="width:60px"/></div></div>
       <div class="prop-row"><span class="prop-key">Max°</span><div class="prop-controls"><input id="prop-joint-max" type="number" step="1" value="${r3(jointConfig.maxAngle, 1)}" style="width:60px"/></div></div>`
    : '';

  propsContent.innerHTML = `
    <div class="props-category">
      <div class="props-cat-hdr" data-cat="identity">▾ Identity</div>
      <div class="props-cat-body" data-cat="identity">
        <div class="prop-row"><span class="prop-key">Type</span><span class="prop-val">${typeLabel(m.userData.type)}</span></div>
        <div class="prop-row"><span class="prop-key">Name</span><div class="prop-controls"><input id="prop-label" type="text" value="${escapedLabel}" placeholder="(none)" style="flex:1;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:2px 5px;font-size:11px;font-family:inherit"/></div></div>
        ${groupControls}
        ${m.userData.editorGroupId ? `<div class="prop-row"><span class="prop-key">Grouped</span><span class="prop-val" style="font-size:9px;color:var(--accentHi)">Yes — ${getEditorGroupMembers(m).length} objects</span></div>` : ''}
      </div>
    </div>
    <div class="props-category">
      <div class="props-cat-hdr" data-cat="transform">▾ Transform</div>
      <div class="props-cat-body" data-cat="transform">
        <div class="prop-row"><span class="prop-key">Pos</span><span class="prop-val">${r3(p.x)}, ${r3(p.y)}, ${r3(p.z)}</span></div>
        <div class="prop-row"><span class="prop-key">Rot°</span><span class="prop-val">${r3(q.x*R2D,1)}, ${r3(q.y*R2D,1)}, ${r3(q.z*R2D,1)}</span></div>
        <div class="prop-row"><span class="prop-key">Scale</span><span class="prop-val">${r3(s.x)}, ${r3(s.y)}, ${r3(s.z)}</span></div>
      </div>
    </div>
    <div class="props-category">
      <div class="props-cat-hdr" data-cat="appearance">▾ Appearance</div>
      <div class="props-cat-body" data-cat="appearance">
        ${surfaceControls}
        ${shapeControls}
        ${opacityControls}
        ${reflectControls}
        ${emitToggle}
        ${lightControls}
      </div>
    </div>
    <div class="props-category">
      <div class="props-cat-hdr" data-cat="physics">▾ Physics</div>
      <div class="props-cat-body" data-cat="physics">
        ${solidToggle}
        ${solidnessControls}
        ${tractionToggle}
        ${collisionControls}
        ${gameVisibleToggle}
      </div>
    </div>
    ${(pathControls || switchControls || switchRangeControls || keypadControls || checkpointControls || targetControls || triggerRulesHtml || jointControls || skeletonControls || npcControls) ? `<div class="props-category">
      <div class="props-cat-hdr" data-cat="behavior">▾ Behavior</div>
      <div class="props-cat-body" data-cat="behavior">
        ${pathControls}
        ${switchControls}
        ${switchRangeControls}
        ${keypadControls}
        ${checkpointControls}
        ${teleportControls}
        ${targetControls}
        ${triggerRulesHtml}
        ${jointControls}
        ${skeletonControls}
        ${npcControls}
      </div>
    </div>` : ''}
    ${(textControls || screenControls || cameraControls) ? `<div class="props-category">
      <div class="props-cat-hdr" data-cat="content">▾ Content</div>
      <div class="props-cat-body" data-cat="content">
        ${textControls}
        ${screenControls}
        ${cameraControls}
      </div>
    </div>` : ''}
  `;
  // Wire the Name label input
  {
    const labelInput = document.getElementById('prop-label');
    if (labelInput) {
      const applyLabel = () => {
        const name = labelInput.value.trim();
        if (name && sceneObjects.some(o => o !== m && (o.userData.label || '') === name)) {
          labelInput.style.borderColor = '#e04040';
          labelInput.title = 'Name already in use by another object';
          return;
        }
        labelInput.style.borderColor = '';
        labelInput.title = '';
        m.userData.label = name;
        // Sync label to NPC displayName / nameplate
        if (m.userData.type === 'npc' && m.userData.npcConfig) {
          m.userData.npcConfig.displayName = name || 'NPC';
          _updateNpcNameplate(m);
          const npcNameEl = document.getElementById('prop-npc-name');
          if (npcNameEl) npcNameEl.value = m.userData.npcConfig.displayName;
        }
        if (typeof refreshObjLib === 'function') refreshObjLib();
      };
      labelInput.addEventListener('change', applyLabel);
      labelInput.addEventListener('blur', applyLabel);
    }
  }

  // Wire category collapse
  propsContent.querySelectorAll('.props-cat-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const cat = hdr.dataset.cat;
      const body = propsContent.querySelector(`.props-cat-body[data-cat="${cat}"]`);
      if (!body) return;
      const collapsed = body.classList.toggle('collapsed');
      hdr.textContent = hdr.textContent.replace(/^[▾▸]/, collapsed ? '▸' : '▾');
    });
  });

  bindSurfaceProps(m);
  bindShapeParamProps(m);
  bindSolidToggle(m);
  bindSolidnessProps(m);
  bindOpacityProps(m);
  bindReflectProps(m);
  bindTractionToggle(m);
  bindGameVisibleToggle(m);
  bindCollisionProps(m);
  if (hasLight) bindLightProps(m);
  if (!isLightType) bindEmitLightProps(m);
  bindGroupProp(m);
  if (canEditPath) bindMovementPathProps(m);
  if (isCheckpoint) bindCheckpointProps(m);
  if (isTeleport) bindTeleportProps(m);
  if (canToggleSwitch) bindSwitchProps(m);
  if (isKeypad) bindKeypadProps(m);
  if (isTarget) bindTargetHealthProp(m);
  if (isTrigger) {
    bindTriggerRules(m);
    bindTriggerStopProps(m);
  }
  if (canEditControlFunctions) bindControlActions(m);
  if (isJoint) bindJointProps(m);
  if (isSkeleton) bindSkeletonProps(m);
  if (isText) bindTextProps(m);
  if (isScreen) bindScreenProps(m);
  if (isCamera) bindCameraProps(m);
  if (isNpc) bindNpcProps(m);
  refreshSelectedPathPreview();
}

function bindSkeletonProps(mesh) {
  const defSelect = document.getElementById('prop-skel-def');
  const newDefBtn = document.getElementById('prop-skel-new-def');
  const openEditorBtn = document.getElementById('prop-skel-open-editor');
  const animSelect = document.getElementById('prop-skel-anim');
  const poseSelect = document.getElementById('prop-skel-pose');
  const autoPlayCb = document.getElementById('prop-skel-autoplay');
  const loopCb = document.getElementById('prop-skel-loop');
  const speedInput = document.getElementById('prop-skel-speed');

  if (defSelect) defSelect.addEventListener('change', () => {
    mesh.userData.skeletonConfig.definitionName = defSelect.value;
    refreshSkeletonMeshVisual(mesh);
    refreshProps();
  });
  if (newDefBtn) newDefBtn.addEventListener('click', () => {
    const name = prompt('Skeleton definition name:', 'Skeleton_' + Date.now().toString(36));
    if (!name?.trim()) return;
    const defName = name.trim();
    if (!skeletonDefinitions[defName]) {
      skeletonDefinitions[defName] = createDefaultSkeletonDefinition(defName);
    }
    mesh.userData.skeletonConfig.definitionName = defName;
    refreshSkeletonMeshVisual(mesh);
    refreshProps();
  });
  if (openEditorBtn) openEditorBtn.addEventListener('click', () => {
    const cfg = getMeshSkeletonConfig(mesh);
    if (cfg?.definitionName) openSkeletonEditor(cfg.definitionName);
  });
  if (animSelect) animSelect.addEventListener('change', () => {
    mesh.userData.skeletonConfig.currentAnimation = animSelect.value;
  });
  if (poseSelect) poseSelect.addEventListener('change', () => {
    mesh.userData.skeletonConfig.currentPose = poseSelect.value;
    applySkeletonPoseToVisual(mesh);
  });
  if (autoPlayCb) autoPlayCb.addEventListener('change', () => {
    mesh.userData.skeletonConfig.playOnStart = autoPlayCb.checked;
  });
  if (loopCb) loopCb.addEventListener('change', () => {
    mesh.userData.skeletonConfig.loopAnimation = loopCb.checked;
  });
  if (speedInput) speedInput.addEventListener('change', () => {
    mesh.userData.skeletonConfig.animationSpeed = Math.max(0, parseFloat(speedInput.value) || 1);
  });
}

function applySkeletonPoseToVisual(mesh) {
  const cfg = getMeshSkeletonConfig(mesh);
  if (!cfg?.definitionName) return;
  const def = skeletonDefinitions[cfg.definitionName];
  if (!def) return;
  const pose = cfg.currentPose ? def.poses?.[cfg.currentPose] : null;
  if (!pose || !mesh.userData._skelBoneMap) return;
  for (const [boneId, quat] of Object.entries(pose)) {
    const bone = mesh.userData._skelBoneMap.get(boneId);
    if (bone && Array.isArray(quat) && quat.length >= 4) {
      bone.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    }
  }
  mesh.userData._skelRootGroup?.updateMatrixWorld(true);
  refreshSkeletonMeshVisual(mesh);
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

// ─── Keybind UI wiring ──────────────────────────────────────────────────────
function syncKeybindButtons() {
  document.querySelectorAll('.keybind-btn').forEach(btn => {
    const action = btn.dataset.action;
    if (action && keybinds[action] !== undefined) {
      btn.textContent = keybindLabel(keybinds[action]);
    }
  });
}
let _keybindListeningBtn = null;
function stopKeybindListening() {
  if (_keybindListeningBtn) {
    _keybindListeningBtn.classList.remove('listening');
    _keybindListeningBtn.textContent = keybindLabel(keybinds[_keybindListeningBtn.dataset.action]);
    _keybindListeningBtn = null;
  }
}
document.querySelectorAll('.keybind-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_keybindListeningBtn === btn) { stopKeybindListening(); return; }
    stopKeybindListening();
    _keybindListeningBtn = btn;
    btn.classList.add('listening');
    btn.textContent = 'Press a key…';
  });
});
document.addEventListener('keydown', (e) => {
  if (!_keybindListeningBtn) return;
  e.preventDefault();
  e.stopPropagation();
  const action = _keybindListeningBtn.dataset.action;
  keybinds[action] = e.code;
  stopKeybindListening();
  updatePlayHint();
}, true);
document.addEventListener('mousedown', (e) => {
  if (!_keybindListeningBtn) return;
  const action = _keybindListeningBtn.dataset.action;
  if (action === 'shoot') {
    e.preventDefault();
    e.stopPropagation();
    keybinds[action] = 'mouse' + e.button;
    stopKeybindListening();
    updatePlayHint();
    return;
  }
  // If clicking outside a keybind button and not awaiting mouse bind, stop listening
  if (!e.target.classList.contains('keybind-btn')) {
    stopKeybindListening();
  }
}, true);
{
  const resetBtn = document.getElementById('btn-reset-keybinds');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    Object.assign(keybinds, DEFAULT_KEYBINDS);
    syncKeybindButtons();
    updatePlayHint();
  });
}

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
      const isPlayerStats = action.actionType === 'playerStats';
      const isTeleport = action.actionType === 'teleport';
      const isSkeletonAct = action.actionType === 'skeleton';
      const moveOpts = (isPlayerGroup || isFunctionControl || isSetVar || isSetBool || isPlayerStats || isTeleport || isSkeletonAct) ? '' : getMoveTargetOptions(action.refType, action.refValue);
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
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Cmd</span><select class="cfn-fc-cmd" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${FUNCTION_CONTROL_COMMANDS.map(cmd => `<option value="${cmd}" ${action.functionControlCommand === cmd ? 'selected' : ''}>${cmd}</option>`).join('')}</select></div>${normalizeFunctionNameList(action.functionControlTarget || '').map((tgt, ti) => `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">${ti === 0 ? 'Targets' : ''}</span><input class="cfn-fc-target-entry" data-fn="${fnIdx}" data-act="${actIdx}" data-tgt-index="${ti}" list="${fnListId}" type="text" value="${escapeHtml(tgt)}" placeholder="functionName" style="flex:1;min-width:80px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><button class="ct-del cfn-fc-target-del" data-fn="${fnIdx}" data-act="${actIdx}" data-tgt-index="${ti}" title="Remove">✕</button></div>`).join('')}<div class="sf-row" style="gap:4px"><span style="font-size:8px;min-width:42px"></span><button class="cfn-fc-target-add" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:8px;padding:1px 5px;color:var(--muted);cursor:pointer">+ Target</button></div><datalist id="${fnListId}">${knownFnNames}</datalist>`
        : isPath
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Path</span><select class="cfn-path-cmd" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${PATH_CONTROL_COMMANDS.map(cmd => `<option value="${cmd}" ${action.pathCommand === cmd ? 'selected' : ''}>${cmd}</option>`).join('')}</select><span style="font-size:8px;color:var(--muted)">target path</span></div>`
        : isSetVar
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Var</span><input class="cfn-set-var-name" data-fn="${fnIdx}" data-act="${actIdx}" list="${varListId}" type="text" value="${escapeHtml(action.setVarName || '')}" placeholder="score" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${varListId}">${knownVarNames}</datalist><select class="cfn-set-var-op" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${['=','+','-','*','/'].map(op => `<option value="${op}" ${action.setVarOp === op ? 'selected' : ''}>${op}</option>`).join('')}</select></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Value</span><select class="cfn-set-var-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="digits" ${action.setVarValueType !== 'var' ? 'selected' : ''}>digits</option><option value="var" ${action.setVarValueType === 'var' ? 'selected' : ''}>var</option></select>${action.setVarValueType === 'var' ? `<input class="cfn-set-var-var" data-fn="${fnIdx}" data-act="${actIdx}" list="${varListId}" type="text" value="${escapeHtml(action.setVarValueVar || '')}" placeholder="var name" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/>` : `<input class="cfn-set-var-value" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="1" value="${action.setVarValue}" style="width:72px;font-size:9px"/>`}</div>`
        : isSetBool
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Bool</span><input class="cfn-set-bool-name" data-fn="${fnIdx}" data-act="${actIdx}" list="${boolListId}" type="text" value="${escapeHtml(action.setBoolName || '')}" placeholder="doorOpen" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${boolListId}">${knownBoolNames}</datalist><select class="cfn-set-bool-value" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="true" ${action.setBoolValue === true ? 'selected' : ''}>true</option><option value="false" ${action.setBoolValue === false ? 'selected' : ''}>false</option><option value="toggle" ${action.setBoolValue === 'toggle' ? 'selected' : ''}>toggle</option></select></div>`
        : isPlayerStats
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Target</span><select class="cfn-ps-target-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="name" ${action.playerStatTargetType === 'name' ? 'selected' : ''}>name</option><option value="group" ${action.playerStatTargetType === 'group' ? 'selected' : ''}>group</option></select><input class="cfn-ps-target" data-fn="${fnIdx}" data-act="${actIdx}" type="text" value="${escapeHtml(action.playerStatTarget || '')}" placeholder="Player" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Stat</span><select class="cfn-ps-key" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${PLAYER_STAT_KEYS.map(k => `<option value="${k}" ${action.playerStatKey === k ? 'selected' : ''}>${k}</option>`).join('')}</select><select class="cfn-ps-op" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${PLAYER_STAT_OPS.map(op => `<option value="${op}" ${action.playerStatOp === op ? 'selected' : ''}>${op}</option>`).join('')}</select><input class="cfn-ps-value" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="1" value="${action.playerStatValue}" style="width:64px;font-size:9px"/></div><div style="font-size:8px;color:#444d56;margin-left:42px">Only affects players matching the target. Non-player objects are ignored.</div>`
        : isSkeletonAct
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Skeleton</span><select class="cfn-ref-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="group" ${action.refType === 'group' ? 'selected' : ''}>group</option><option value="name" ${action.refType === 'name' ? 'selected' : ''}>name</option></select><input class="cfn-ref-val" data-fn="${fnIdx}" data-act="${actIdx}" list="${moveListId}" type="text" value="${escapeHtml(action.refValue)}" placeholder="skeleton name" style="flex:1;min-width:70px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${moveListId}">${getMoveTargetOptions(action.refType, action.refValue)}</datalist></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Cmd</span><select class="cfn-skel-cmd" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${SKELETON_ANIM_COMMANDS.map(cmd => `<option value="${cmd}" ${action.skelAnimCommand === cmd ? 'selected' : ''}>${cmd}</option>`).join('')}</select></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Clip</span><input class="cfn-skel-clip" data-fn="${fnIdx}" data-act="${actIdx}" type="text" value="${escapeHtml(action.skelAnimClip || '')}" placeholder="animation clip name" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Speed</span><input class="cfn-skel-speed" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" min="0" value="${action.skelAnimSpeed ?? 1}" style="width:52px;font-size:9px"/></div>`
        : isTeleport
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Mode</span><select class="cfn-teleport-mode" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${TELEPORT_MODES.map(m => `<option value="${m}" ${action.teleportMode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>${action.teleportMode === 'coords' ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Coords</span><input class="cfn-teleport-x" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.teleportCoords[0]}" style="width:52px;font-size:9px"/><input class="cfn-teleport-y" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.teleportCoords[1]}" style="width:52px;font-size:9px"/><input class="cfn-teleport-z" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.teleportCoords[2]}" style="width:52px;font-size:9px"/></div>` : ''}${action.teleportMode === 'object' ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Object</span><input class="cfn-teleport-target-ref" data-fn="${fnIdx}" data-act="${actIdx}" type="text" value="${escapeHtml(action.teleportTargetRef || '')}" placeholder="object name" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/></div>` : ''}<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">World</span><select class="cfn-teleport-world" data-fn="${fnIdx}" data-act="${actIdx}" style="flex:1;min-width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"><option value="" ${!action.teleportWorldId ? 'selected' : ''}>(current world)</option>${worlds.map(w => `<option value="${w.id}" ${action.teleportWorldId === w.id ? 'selected' : ''}>${escapeHtml(w.name || w.id)}</option>`).join('')}</select></div>`
        : isAudio
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Audio</span><input class="cfn-audio-name" data-fn="${fnIdx}" data-act="${actIdx}" list="${audioListId}" type="text" value="${escapeHtml(action.audioName || '')}" placeholder="audio name" style="flex:1;min-width:94px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${audioListId}">${knownAudioNames}</datalist></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Mode</span><select class="cfn-audio-mode" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${AUDIO_PLAY_MODES.map(mode => `<option value="${mode}" ${action.audioMode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select><span style="font-size:8px;color:var(--muted)">Range</span><input class="cfn-audio-dist" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="1" max="800" step="1" value="${action.audioDistance}" style="width:52px;font-size:9px"/></div><div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:42px">Until</span><select class="cfn-audio-until" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${AUDIO_UNTIL_EVENTS.map(ev => `<option value="${ev}" ${action.audioUntil === ev ? 'selected' : ''}>${ev}</option>`).join('')}</select><input class="cfn-audio-until-fn" data-fn="${fnIdx}" data-act="${actIdx}" list="${fnListId}" type="text" value="${escapeHtml(action.audioUntilFunction || '')}" placeholder="fn name" style="width:84px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-audio-loop" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.audioLoop ? 'checked' : ''}/> Loop</label></div><datalist id="${fnListId}">${knownFnNames}</datalist>`
        : isLight
        ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Light</span><select class="cfn-light-op" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px">${CONTROL_LIGHT_OPS.map(op => `<option value="${op}" ${action.lightOp === op ? 'selected' : ''}>${op}</option>`).join('')}</select><input class="cfn-light-val" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.lightValue}" style="width:46px;font-size:9px"/></div>`
        : isRotate
          ? `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">To Rot°</span><input class="cfn-rox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateOffset[0]}" style="width:42px;font-size:9px"/><input class="cfn-roy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateOffset[1]}" style="width:42px;font-size:9px"/><input class="cfn-roz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateOffset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">From Rot°</span><input class="cfn-rsox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateStartOffset[0]}" style="width:42px;font-size:9px"/><input class="cfn-rsoy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateStartOffset[1]}" style="width:42px;font-size:9px"/><input class="cfn-rsoz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateStartOffset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">Spin RPM</span><input class="cfn-rrx" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateRpm[0]}" style="width:42px;font-size:9px"/><input class="cfn-rry" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateRpm[1]}" style="width:42px;font-size:9px"/><input class="cfn-rrz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.rotateRpm[2]}" style="width:42px;font-size:9px"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-rotate-repeat" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.rotateRepeat ? 'checked' : ''}/> Loop</label></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">Pivot</span><select class="cfn-rotate-mode" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="separate" ${action.rotateGroupMode === 'separate' ? 'selected' : ''}>self</option><option value="together" ${action.rotateGroupMode === 'together' ? 'selected' : ''}>group center</option></select><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-keep-upright" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.rotateKeepUpright ? 'checked' : ''}/> Keep upright</label></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Anim</span><select class="cfn-style" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="glide" ${action.style === 'glide' ? 'selected' : ''}>glide</option><option value="strict" ${action.style === 'strict' ? 'selected' : ''}>strict</option><option value="snap" ${action.style === 'snap' ? 'selected' : ''}>snap</option></select><input class="cfn-dur" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="0" step="0.1" value="${action.duration}" style="width:46px;font-size:9px" title="Duration (s)"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-return" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.returnOnDeactivate ? 'checked' : ''}/> Return</label></div>`
          : `<div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">To (orig)</span><input class="cfn-ox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[0]}" style="width:42px;font-size:9px"/><input class="cfn-oy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[1]}" style="width:42px;font-size:9px"/><input class="cfn-oz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.offset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:56px">From (orig)</span><input class="cfn-sox" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.startOffset[0]}" style="width:42px;font-size:9px"/><input class="cfn-soy" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.startOffset[1]}" style="width:42px;font-size:9px"/><input class="cfn-soz" data-fn="${fnIdx}" data-act="${actIdx}" type="number" step="0.1" value="${action.startOffset[2]}" style="width:42px;font-size:9px"/></div>
          <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">Anim</span><select class="cfn-style" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="glide" ${action.style === 'glide' ? 'selected' : ''}>glide</option><option value="strict" ${action.style === 'strict' ? 'selected' : ''}>strict</option><option value="snap" ${action.style === 'snap' ? 'selected' : ''}>snap</option></select><input class="cfn-dur" data-fn="${fnIdx}" data-act="${actIdx}" type="number" min="0" step="0.1" value="${action.duration}" style="width:46px;font-size:9px" title="Duration (s)"/><label style="display:flex;align-items:center;gap:3px;font-size:8px;color:var(--muted);cursor:pointer"><input class="cfn-return" data-fn="${fnIdx}" data-act="${actIdx}" type="checkbox" ${action.returnOnDeactivate ? 'checked' : ''}/> Return</label></div>`;
      const posReadout = (!isLight && !isPlayerGroup && !isFunctionControl && !isAudio && !isPath && !isSetVar && !isSetBool && !isPlayerStats && !isTeleport && !isSkeletonAct) ? `<div class="cfn-pos-readout" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:8px;color:var(--accentHi);margin-left:34px;min-height:12px;font-family:monospace;opacity:0.8"></div>` : '';
      const targetRefHtml = (isPlayerGroup || isFunctionControl || isSetVar || isSetBool || isPlayerStats || isTeleport || isSkeletonAct)
        ? `<span style="font-size:8px;color:var(--muted);min-width:56px">player</span>`
        : `<select class="cfn-ref-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="group" ${action.refType === 'group' ? 'selected' : ''}>group</option><option value="name" ${action.refType === 'name' ? 'selected' : ''}>name</option></select><input class="cfn-ref-val" data-fn="${fnIdx}" data-act="${actIdx}" list="${moveListId}" type="text" value="${escapeHtml(action.refValue)}" style="width:70px;font-size:9px;padding:1px 3px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><datalist id="${moveListId}">${moveOpts}</datalist>`;
      return `<div style="border-left:2px solid var(--border);margin-left:4px;padding-left:6px;margin-bottom:4px">
        <div class="sf-row" style="gap:4px"><span style="font-size:8px;color:var(--muted);min-width:32px">#${actIdx+1}</span>${targetRefHtml}<select class="cfn-action-type" data-fn="${fnIdx}" data-act="${actIdx}" style="font-size:9px;padding:1px 3px"><option value="move" ${action.actionType === 'move' ? 'selected' : ''}>move</option><option value="rotate" ${action.actionType === 'rotate' ? 'selected' : ''}>rotate</option><option value="light" ${action.actionType === 'light' ? 'selected' : ''}>light</option><option value="audio" ${action.actionType === 'audio' ? 'selected' : ''}>audio</option><option value="path" ${action.actionType === 'path' ? 'selected' : ''}>path</option><option value="functionControl" ${action.actionType === 'functionControl' ? 'selected' : ''}>function ctrl</option><option value="playerGroup" ${action.actionType === 'playerGroup' ? 'selected' : ''}>player group</option><option value="setVar" ${action.actionType === 'setVar' ? 'selected' : ''}>set var</option><option value="setBool" ${action.actionType === 'setBool' ? 'selected' : ''}>set bool</option><option value="playerStats" ${action.actionType === 'playerStats' ? 'selected' : ''}>player stats</option><option value="teleport" ${action.actionType === 'teleport' ? 'selected' : ''}>teleport</option><option value="skeleton" ${action.actionType === 'skeleton' ? 'selected' : ''}>skeleton</option></select><button class="ct-del cfn-del-act" data-fn="${fnIdx}" data-act="${actIdx}" title="Remove action">✕</button></div>
        ${primaryHtml}${posReadout}
      </div>`;
    }).join('');

    return `<div class="ct-entry" style="flex-wrap:wrap" data-fn-index="${fnIdx}">
      <div class="sf-row" style="gap:4px;width:100%"><span style="font-size:9px;color:var(--accentHi);font-weight:700">ƒ</span><input class="cfn-name" data-fn="${fnIdx}" type="text" value="${escapeHtml(fn.name)}" placeholder="name" style="flex:1;font-size:10px;padding:2px 4px;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:3px"/><select class="cfn-group" data-fn="${fnIdx}" style="font-size:9px;padding:1px 3px">${groupOptionsHtml}</select><label style="display:flex;align-items:center;gap:2px;cursor:pointer;font-size:9px;color:var(--muted)" title="Auto-execute when playtest starts"><input class="cfn-always-active" data-fn="${fnIdx}" type="checkbox" ${fn.alwaysActive ? 'checked' : ''}/> Always Active</label><button class="cfn-sim" data-fn="${fnIdx}" title="Simulate" style="background:none;border:none;color:var(--accentHi);cursor:pointer;font-size:11px;padding:0 2px">▶</button><button class="cfn-sim-reset" data-fn="${fnIdx}" title="Reset" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:10px;padding:0 2px">■</button><button class="ct-del cfn-del-fn" data-fn="${fnIdx}" title="Delete function">✕</button></div>
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

  controlFunctionsListEl.querySelectorAll('.cfn-always-active').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.fn, 10);
      if (controlFunctions[idx]) controlFunctions[idx].alwaysActive = !!input.checked;
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

  controlFunctionsListEl.querySelectorAll('.cfn-fc-target-entry').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      const tgtIdx = parseInt(input.dataset.tgtIndex, 10);
      withFnAction(fnIdx, actIdx, a => {
        const list = normalizeFunctionNameList(a.functionControlTarget || '');
        const name = input.value.trim();
        if (tgtIdx >= 0 && tgtIdx < list.length) {
          if (name) { list[tgtIdx] = name; }
          else { list.splice(tgtIdx, 1); }
        }
        a.functionControlTarget = list.join(', ');
      });
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-fc-target-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const fnIdx = parseInt(btn.dataset.fn, 10);
      const actIdx = parseInt(btn.dataset.act, 10);
      const tgtIdx = parseInt(btn.dataset.tgtIndex, 10);
      withFnAction(fnIdx, actIdx, a => {
        const list = normalizeFunctionNameList(a.functionControlTarget || '');
        if (tgtIdx >= 0 && tgtIdx < list.length) list.splice(tgtIdx, 1);
        a.functionControlTarget = list.join(', ');
      });
      refreshControlFunctionsUI();
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-fc-target-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const fnIdx = parseInt(btn.dataset.fn, 10);
      const actIdx = parseInt(btn.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => {
        const list = normalizeFunctionNameList(a.functionControlTarget || '');
        list.push('');
        a.functionControlTarget = list.join(', ');
      });
      refreshControlFunctionsUI();
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

  controlFunctionsListEl.querySelectorAll('.cfn-ps-target-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.playerStatTargetType = sel.value; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-ps-target').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.playerStatTarget = input.value.trim(); });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-ps-key').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.playerStatKey = sel.value; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-ps-op').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.playerStatOp = sel.value; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-ps-value').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.playerStatValue = parseFloat(input.value) || 0; });
    });
  });

  controlFunctionsListEl.querySelectorAll('.cfn-teleport-mode').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.teleportMode = TELEPORT_MODES.includes(sel.value) ? sel.value : 'coords'; });
      refreshControlFunctionsUI();
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-teleport-x').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.teleportCoords[0] = parseFloat(input.value) || 0; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-teleport-y').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.teleportCoords[1] = parseFloat(input.value) || 0; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-teleport-z').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.teleportCoords[2] = parseFloat(input.value) || 0; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-teleport-world').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.teleportWorldId = sel.value; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-teleport-target-ref').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.teleportTargetRef = input.value.trim(); });
    });
  });

  // Skeleton action bindings
  controlFunctionsListEl.querySelectorAll('.cfn-skel-cmd').forEach(sel => {
    sel.addEventListener('change', () => {
      const fnIdx = parseInt(sel.dataset.fn, 10);
      const actIdx = parseInt(sel.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.skelAnimCommand = SKELETON_ANIM_COMMANDS.includes(sel.value) ? sel.value : 'play'; });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-skel-clip').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.skelAnimClip = input.value.trim(); });
    });
  });
  controlFunctionsListEl.querySelectorAll('.cfn-skel-speed').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.skelAnimSpeed = Math.max(0, parseFloat(input.value) || 1); });
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

  controlFunctionsListEl.querySelectorAll('.cfn-keep-upright').forEach(input => {
    input.addEventListener('change', () => {
      const fnIdx = parseInt(input.dataset.fn, 10);
      const actIdx = parseInt(input.dataset.act, 10);
      withFnAction(fnIdx, actIdx, a => { a.rotateKeepUpright = input.checked; });
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

      // Keep point lights on even when mesh is out of render distance
      if (m.userData.pointLight) {
        const lightVisible = dist2 < ld2;
        m.userData.pointLight.visible = lightVisible;
        if (!shadowOff) m.userData.pointLight.castShadow = lightVisible && dist2 < ld2 * 0.5;
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

// Fog UI listeners
if (fogEnabledInput) fogEnabledInput.addEventListener('change', readFogUI);
if (fogColorInput) fogColorInput.addEventListener('input', readFogUI);
if (fogDensityInput) fogDensityInput.addEventListener('change', readFogUI);
if (fogBrightnessInput) fogBrightnessInput.addEventListener('change', readFogUI);

// FOV UI listeners
if (fovEditorInput) fovEditorInput.addEventListener('change', () => {
  editorFov = THREE.MathUtils.clamp(parseInt(fovEditorInput.value) || 60, 30, 150);
  editorCam.fov = editorFov;
  editorCam.updateProjectionMatrix();
});
if (fovPlaytestInput) fovPlaytestInput.addEventListener('change', () => {
  playtestFov = THREE.MathUtils.clamp(parseInt(fovPlaytestInput.value) || 75, 30, 150);
});

// Worlds UI
if (btnAddWorld) btnAddWorld.addEventListener('click', () => {
  const id = 'world_' + _nextWorldId++;
  worlds.push({ id, name: id, objects: [] });
  switchToWorld(id);
  refreshWorldUI();
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

// ─── Portal view rendering ────────────────────────────────────────────────────
const _portalDiscGeo = new THREE.CircleGeometry(0.58, 32);
const _portalTmpPos = new THREE.Vector3();
const _portalCam = new THREE.PerspectiveCamera(75, 1, 0.1, 200);

function _createPortalRenderTarget() {
  const rt = new THREE.WebGLRenderTarget(256, 256);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
}

function _ensurePortalDisc(mesh) {
  if (mesh.userData._portalDisc) return mesh.userData._portalDisc;
  if (!mesh.userData._portalRT) mesh.userData._portalRT = _createPortalRenderTarget();
  const mat = new THREE.MeshBasicMaterial({ map: mesh.userData._portalRT.texture, side: THREE.DoubleSide, transparent: true });
  const disc = new THREE.Mesh(_portalDiscGeo, mat);
  disc.userData._isPortalDisc = true;
  disc.renderOrder = 1;
  mesh.add(disc);
  mesh.userData._portalDisc = disc;
  return disc;
}

function _renderPortalViews() {
  if (!state.isPlaytest) return;
  for (const m of sceneObjects) {
    if (m.userData.type !== 'teleport') continue;
    // Hide portal disc if not in playtest or no pair
    if (m.userData._portalDisc) m.userData._portalDisc.visible = false;

    _portalTmpPos.setFromMatrixPosition(m.matrixWorld);
    const dist = _portalTmpPos.distanceTo(fpsPos);
    if (dist > PORTAL_MAX_DIST) continue;

    const config = getMeshTeleportConfig(m);
    if (!config.pairLabel) continue;
    // Only same-world portals for live rendering
    if (config.crossWorld) continue;

    const pairLower = config.pairLabel.toLowerCase();
    const srcLabelLower = (m.userData.label || '').toLowerCase();
    const dest = sceneObjects.find(o =>
      o !== m && o.userData.type === 'teleport' &&
      (o.userData.world || 'world_1') === _playtestWorldId &&
      (
        (o.userData.label || '').toLowerCase() === pairLower ||
        (getMeshTeleportConfig(o).pairLabel || '').toLowerCase() === srcLabelLower
      )
    );
    if (!dest) continue;

    const disc = _ensurePortalDisc(m);
    disc.visible = true;
    if (!m.userData._portalRT) m.userData._portalRT = _createPortalRenderTarget();

    // Position portal camera at destination, facing the same direction as the player
    _portalCam.position.copy(dest.position);
    _portalCam.position.y += 0.7;
    _portalCam.rotation.set(fpsPitch, fpsYaw, 0, 'YXZ');
    _portalCam.fov = fpsCam.fov;
    _portalCam.updateProjectionMatrix();

    // Render scene from destination perspective
    disc.visible = false;
    const destDisc = dest.userData._portalDisc;
    const destDiscWasVisible = destDisc ? destDisc.visible : false;
    if (destDisc) destDisc.visible = false;

    // Temporarily show objects visible from portal camera (frustum culling
    // hid them because they're off the player's screen).
    const _savedVis = [];
    _portalCam.updateMatrixWorld();
    _projScreenMatrix.multiplyMatrices(_portalCam.projectionMatrix, _portalCam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    for (const o of sceneObjects) {
      if (!o.visible && !o.userData._dead && _frustum.intersectsObject(o)) {
        _savedVis.push(o);
        o.visible = true;
      }
    }

    renderer.setRenderTarget(m.userData._portalRT);
    renderer.render(scene, _portalCam);
    renderer.setRenderTarget(null);

    // Restore visibility
    for (const o of _savedVis) o.visible = false;

    disc.material.map = m.userData._portalRT.texture;
    disc.material.needsUpdate = true;
    disc.visible = true;
    if (destDisc) destDisc.visible = destDiscWasVisible;
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
      updateGridLabels(fpsPos.x, fpsPos.z);
      updateCoordHud();
      updateVisibility(fpsCam);
      updateCheckpointIndicators(t / 1000);
      syncSkyToCamera(fpsCam);
      renderer.render(scene, fpsCam);
      return;
    }

    updateRuntimeOptimizer(t, dt);
    updateTriggerMoveAnimations(t / 1000);
    updateMovementPathAnimations(dt);
    updateJointAnimations(dt);
    updateSkeletonAnimations(dt);
    updateNpcBehaviors(dt, t / 1000);
    _showNpcInteractHint();
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

    // ── Cloud wind animation ──
    _updateCloudWind(dt);

    // ── Crouch transition ──
    {
      const rate = CROUCH_TRANSITION_SPEED * dt;
      // When uncrouching, check if standing up would cause a collision
      if (!fpsCrouching && _fpsCurrentHeight < gameRules.height) {
        if (collidesAt(fpsPos, gameRules.height)) {
          fpsCrouching = true;
        }
      }
      const th = fpsCrouching ? gameRules.crouchHeight : gameRules.height;
      const te = fpsCrouching ? (gameRules.crouchHeight - 0.15) : gameRules.eyeHeight;
      if (_fpsCurrentHeight < th) _fpsCurrentHeight = Math.min(th, _fpsCurrentHeight + rate);
      else if (_fpsCurrentHeight > th) _fpsCurrentHeight = Math.max(th, _fpsCurrentHeight - rate);
      if (_fpsCurrentEyeHeight < te) _fpsCurrentEyeHeight = Math.min(te, _fpsCurrentEyeHeight + rate);
      else if (_fpsCurrentEyeHeight > te) _fpsCurrentEyeHeight = Math.max(te, _fpsCurrentEyeHeight - rate);
    }

    // FPS movement
    _fwd.set(0, 0, -1).applyEuler(new THREE.Euler(0, fpsYaw, 0));
    _right.set(1, 0, 0).applyEuler(new THREE.Euler(0, fpsYaw, 0));
    _move.set(0, 0, 0);
    if (fpsKeys.has(keybinds.forward) || fpsKeys.has('ArrowUp'))    _move.addScaledVector(_fwd, 1);
    if (fpsKeys.has(keybinds.backward) || fpsKeys.has('ArrowDown'))  _move.addScaledVector(_fwd, -1);
    if (fpsKeys.has(keybinds.left) || fpsKeys.has('ArrowLeft'))  _move.addScaledVector(_right, -1);
    if (fpsKeys.has(keybinds.right) || fpsKeys.has('ArrowRight')) _move.addScaledVector(_right, 1);
    // ── Sprint stamina & air-sprint logic ──────────────────────────────
    const wantsSprint = fpsSprinting; // player is holding R
    let canSprint = false;

    if (wantsSprint) {
      if (fpsGrounded) {
        // On ground: can always sprint if stamina allows
        canSprint = (gameRules.sprintDuration <= 0 || fpsSprintStamina > 0);
        fpsWasSprintingOnGround = canSprint;
      } else {
        // In air: only continue sprinting if allowed or you were sprinting when you left the ground (momentum)
        // OR if air dash is active
        if (gameRules.allowAirSprint || fpsWasSprintingOnGround) {
          canSprint = (gameRules.sprintDuration <= 0 || fpsSprintStamina > 0);
        } else if (gameRules.airDashEnabled && !fpsAirDashUsed) {
          // Start air dash
          fpsAirDashUsed = true;
          fpsAirDashRemaining = gameRules.airDashDuration;
        }
        // If air dash is active, allow sprint speed
        if (fpsAirDashRemaining > 0) {
          canSprint = true;
          fpsAirDashRemaining -= dt;
        }
      }
    } else {
      fpsWasSprintingOnGround = false;
    }

    // Drain stamina while sprinting (only if sprintDuration > 0 = limited)
    if (canSprint && gameRules.sprintDuration > 0) {
      fpsSprintStamina = Math.max(0, fpsSprintStamina - dt / gameRules.sprintDuration);
      if (fpsSprintStamina <= 0) canSprint = false; // ran out mid-frame
    }
    // Recharge stamina when not sprinting (only if sprintDuration > 0 = limited)
    if (!canSprint && gameRules.sprintDuration > 0) {
      fpsSprintStamina = Math.min(1, fpsSprintStamina + dt / gameRules.sprintRechargeTime);
    }

    // Reset air dash when landing
    if (fpsGrounded) {
      fpsAirDashUsed = false;
      fpsAirDashRemaining = 0;
    }

    // Update sprint meter HUD
    if (sprintHud && sprintBarFill) {
      if (gameRules.sprintDuration > 0) {
        sprintHud.style.display = 'flex';
        sprintBarFill.style.width = (fpsSprintStamina * 100) + '%';
        if (fpsSprintStamina > 0.5) sprintBarFill.style.background = 'linear-gradient(90deg,#3090e0,#50b0ff)';
        else if (fpsSprintStamina > 0.2) sprintBarFill.style.background = 'linear-gradient(90deg,#c0a030,#e0c040)';
        else sprintBarFill.style.background = 'linear-gradient(90deg,#e04040,#f06060)';
      } else {
        sprintHud.style.display = 'none';
      }
    }

    if (_move.lengthSq() > 0) {
      let speed = canSprint ? resolveGameRule('sprintSpeed', 12) : BASE_FPS_SPEED;
      if (fpsCrouching) speed *= 0.5;
      _move.normalize().multiplyScalar(speed * dt);
    }

    refreshSolids();
    const _tractionIgnore = applyTractionCarry();
    resolveMovingSolidPushes(_tractionIgnore);
    resolveStaticPenetration();

    // Horizontal movement with ground-following for slopes/ramps
    if (_move.x !== 0 || _move.z !== 0) {
      movePlayerHorizontal(_move, _tractionIgnore);
    }
    // Gravity and vertical collision
    if (gameRules.gravityEnabled) {
      // When standing on a traction platform and not jumping upward, suppress
      // gravity entirely and lock the player to the platform surface.  This
      // eliminates the gravity-pull / ground-snap oscillation that causes
      // camera shaking on moving platforms.
      if (_tractionSupportMesh && fpsVelY <= 0) {
        // Only snap to ground via raycast when traction didn't already carry
        // vertically.  Traction uses exact arithmetic; the raycast can return
        // a slightly different Y each frame causing visible per-frame jitter.
        if (!_tractionCarriedThisFrame) {
          const groundY = findGroundHeight(fpsPos);
          if (groundY >= fpsPos.y - 0.25 && groundY <= fpsPos.y + STEP_HEIGHT) {
            if (fpsFallStartY !== null) {
              const fallDist = fpsFallStartY - groundY;
              applyFallDamage(fallDist);
            }
            fpsPos.y = groundY;
          }
        }
        fpsVelY = 0;
        fpsGrounded = true;
        fpsFallStartY = null;
      } else {
        fpsVelY -= resolveGameRule('gravity', 24) * dt;
        let nextY = fpsPos.y + fpsVelY * dt;

        // Build a test position for vertical checks
        _next.set(fpsPos.x, nextY, fpsPos.z);

        if (fpsVelY <= 0) {
          // Track fall start position
          if (fpsFallStartY === null && !fpsGrounded) fpsFallStartY = fpsPos.y;
          // Falling — find ground (don't ignore traction mesh — we need it as ground)
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
          if (collidesAt(_next, undefined, _tractionIgnore)) {
            // Binary search to find exact ceiling contact
            let lo = fpsPos.y, hi = nextY;
            for (let i = 0; i < 8; i++) {
              const mid = (lo + hi) / 2;
              _next.y = mid;
              if (collidesAt(_next, undefined, _tractionIgnore)) hi = mid; else lo = mid;
            }
            nextY = lo;
            fpsVelY = 0;
          }
          fpsGrounded = false;
        }
        fpsPos.y = Math.max(0, nextY);
        if (fpsPos.y === 0 && fpsVelY === 0) fpsGrounded = true;
      }
    } else {
      const flyDir = (fpsKeys.has('Space') || fpsKeys.has('KeyE') ? 1 : 0) - (fpsKeys.has(keybinds.crouch) || fpsKeys.has('KeyQ') ? 1 : 0);
      const flySpeed = (canSprint ? resolveGameRule('sprintSpeed', 12) : BASE_FPS_SPEED) * dt;
      if (flyDir !== 0) {
        movePlayerVertical(flyDir * flySpeed);
      }
      fpsVelY = 0;
      fpsGrounded = false;
      fpsFallStartY = null;
    }

    // Track first ground touch after spawn
    if (!fpsSpawnLanded && fpsGrounded) fpsSpawnLanded = true;

    // Ground touch function trigger — only when touching the grid floor (y ≈ 0), not objects
    if (gameRules.groundTouchFunction) {
      const onGrid = fpsGrounded && fpsPos.y < 0.01;
      if (onGrid && !_groundTouchFnActive) {
        _groundTouchFnActive = true;
        executeControlFunction(gameRules.groundTouchFunction, null, true);
      } else if (!onGrid && _groundTouchFnActive) {
        _groundTouchFnActive = false;
        executeControlFunction(gameRules.groundTouchFunction, null, false);
      }
    }

    // Spawn protection countdown
    if (fpsSpawnProtectTimer > 0) fpsSpawnProtectTimer -= dt;

    // Trigger block overlap detection
    checkTriggerBlocks();
    checkTeleportBlocks();
    checkCheckpointBlocks();

    // Re-evaluate trigger calls continuously so condition changes can start/stop actions.
    for (const [uuid, calls] of _activeTriggerCalls) {
      const mesh = sceneObjects.find(m => m.uuid === uuid);
      if (mesh) evaluateTriggerCalls(mesh);
    }

    // Conditional triggers evaluation
    evaluateConditionalTriggers();

    clampPlayerToWorldBorder();
    syncFpsCamera();

    updateSunShadowCenter(fpsPos);
    updateGridChunks(fpsPos.x, fpsPos.z);
    updateGridLabels(fpsPos.x, fpsPos.z);
    updateCoordHud();
    updateVisibility(fpsCam);
    updateCheckpointIndicators(t / 1000);
    updateOrbitIndicator();
    updateSpawnDirectionIndicators();
    updateJointIndicators();
    syncSkyToCamera(fpsCam);
    _renderPortalViews();
    renderer.render(scene, fpsCam);
    for (const m of sceneObjects) {
      _playtestPrevPositions.set(m, m.position.clone());
      _playtestPrevRotations.set(m, m.quaternion.clone());
      _playtestPrevAABBs.set(m, new THREE.Box3().setFromObject(m));
    }
  } else {
    if (_simBasePositions.size || _movementPathStates.size) {
      updateSimAnimations(t / 1000);
      updateMovementPathAnimations(dt);
    }
    _updateCloudWind(dt);
    moveEditorCamera(dt);
    orbitControls.update();
    updateOrbitIndicator();
    updateSunShadowCenter(editorCam.position);
    updateGridChunks(editorCam.position.x, editorCam.position.z);
    updateGridLabels(editorCam.position.x, editorCam.position.z);
    updateCoordHud();
    updateVisibility(editorCam);
    updateCheckpointIndicators(t / 1000);
    updateSpawnDirectionIndicators();
    updateJointIndicators();
    syncSkyToCamera(editorCam);
    renderer.render(scene, editorCam);
  }
}

// ─── Right-panel tab switching (Functions / Objects Library) ──────────────────
const _fnPaneTabs = document.querySelectorAll('.fn-panel-tab');
const _fnPanes    = document.querySelectorAll('.fn-pane');
let _activeFnPane = 'functions';
function setFnPane(name) {
  _activeFnPane = name;
  _fnPaneTabs.forEach(t => t.classList.toggle('active', t.dataset.fnPane === name));
  _fnPanes.forEach(p => p.classList.toggle('active', p.id === 'fn-pane-' + name));
  if (name === 'objlib') refreshObjLib();
}
_fnPaneTabs.forEach(t => t.addEventListener('click', () => setFnPane(t.dataset.fnPane)));

// ─── Objects Library ─────────────────────────────────────────────────────────
const _objlibList      = document.getElementById('objlib-list');
const _objlibSearch    = document.getElementById('objlib-search');
const _objlibFilterCat = document.getElementById('objlib-filter-cat');
const _objlibFilterType = document.getElementById('objlib-filter-type');
const _objlibFilterWorld = document.getElementById('objlib-filter-world');
const _objlibSort      = document.getElementById('objlib-sort');
const _objlibCount     = document.getElementById('objlib-count');

const OBJLIB_CATEGORIES = {
  structure: { label: 'Structure', types: ['wall', 'floor', 'terrain'] },
  shapes:    { label: 'Shapes',    types: ['cube', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism', 'torus'] },
  flat:      { label: 'Flat / 2D', types: ['plane2d', 'triangle2d', 'circle2d', 'polygon2d'] },
  gameplay:  { label: 'Gameplay',  types: ['spawn', 'checkpoint', 'target', 'trigger', 'teleport', 'keypad', 'light', 'pivot', 'joint', 'skeleton'] },
  characters: { label: 'Characters', types: ['npc'] },
  media:     { label: 'Media',     types: ['text', 'text3d', 'screen', 'camera'] },
};

const OBJLIB_TYPE_ICONS = {
  wall: '🧱', floor: '⬜', target: '🎯', light: '💡', spawn: '🟢', checkpoint: '🔵',
  trigger: '⚡', teleport: '🌀', keypad: '🔢', cube: '📦', sphere: '🔮', cylinder: '🛢️', cone: '🔺',
  pyramid: '🔻', prism: '⬡', torus: '⭕', plane2d: '▬', triangle2d: '◺', circle2d: '●',
  polygon2d: '⬠', pivot: '🔶', joint: '🔗', skeleton: '🦴', terrain: '🏔️',
  text: '📝', text3d: '🔤', screen: '🖥️', camera: '🎥', npc: '🧑',
};

function _objlibCategoryOf(type) {
  for (const [cat, def] of Object.entries(OBJLIB_CATEGORIES)) {
    if (def.types.includes(type)) return cat;
  }
  return '';
}

function _objlibPopulateTypeFilter() {
  const cat = _objlibFilterCat.value;
  const prev = _objlibFilterType.value;
  _objlibFilterType.innerHTML = '<option value="">All Types</option>';
  let types;
  if (cat && OBJLIB_CATEGORIES[cat]) {
    types = OBJLIB_CATEGORIES[cat].types;
  } else if (!cat || cat === 'grouped' || cat === 'named' || cat === 'has-function') {
    types = Object.keys(DEFS);
  } else {
    types = Object.keys(DEFS);
  }
  for (const t of types) {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = (OBJLIB_TYPE_ICONS[t] || '') + ' ' + (DEFS[t]?.label || t);
    _objlibFilterType.appendChild(opt);
  }
  if ([...(_objlibFilterType.options)].some(o => o.value === prev)) _objlibFilterType.value = prev;
}

function _objlibPopulateWorldFilter() {
  const prev = _objlibFilterWorld.value;
  _objlibFilterWorld.innerHTML = '<option value="">All Worlds</option>';
  for (const w of worlds) {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name || w.id;
    _objlibFilterWorld.appendChild(opt);
  }
  if ([...(_objlibFilterWorld.options)].some(o => o.value === prev)) _objlibFilterWorld.value = prev;
}

function _meshHasFunction(m) {
  const label = m.userData.label;
  if (!label) return false;
  for (const fn of controlFunctions) {
    for (const act of (fn.actions || [])) {
      if (act.teleportTargetRef && act.teleportTargetRef.toLowerCase() === label.toLowerCase()) return true;
    }
    if (fn.triggerCalls) {
      for (const tc of fn.triggerCalls) {
        if (tc.targetRef && tc.targetRef.toLowerCase() === label.toLowerCase()) return true;
      }
    }
  }
  const groups = (m.userData.groups || []);
  for (const fn of controlFunctions) {
    for (const act of (fn.actions || [])) {
      if (act.touchRef && groups.some(g => normalizeTouchRef(g) === normalizeTouchRef(act.touchRef))) return true;
    }
  }
  return false;
}

function refreshObjLib() {
  if (_activeFnPane !== 'objlib' || !_objlibList) return;
  _objlibPopulateWorldFilter();

  const searchRaw = (_objlibSearch?.value || '').trim().toLowerCase();
  const filterCat = _objlibFilterCat?.value || '';
  const filterType = _objlibFilterType?.value || '';
  const filterWorld = _objlibFilterWorld?.value || '';
  const sortMode = _objlibSort?.value || 'name-asc';

  // Collect objects: current scene + stored worlds
  let items = sceneObjects.map(m => ({ mesh: m, stored: false }));
  for (const w of worlds) {
    if (w.id === activeWorldId) continue;
    if (!Array.isArray(w.objects)) continue;
    for (const d of w.objects) {
      items.push({ data: d, stored: true, worldId: w.id });
    }
  }

  // Helper to extract info from either live mesh or stored data
  function getInfo(item) {
    if (!item.stored) {
      const m = item.mesh;
      return {
        type: m.userData.type || 'wall',
        label: m.userData.label || '',
        world: m.userData.world || 'world_1',
        pos: m.position,
        groups: m.userData.groups || [],
        editorGroupId: m.userData.editorGroupId || '',
        color: m.material?.color ? '#' + m.material.color.getHexString() : '#555',
        placedOrder: m.userData._placedOrder || 0,
        mesh: m,
      };
    } else {
      const d = item.data;
      return {
        type: d.type || 'wall',
        label: d.label || '',
        world: d.world || item.worldId || 'world_1',
        pos: d.position ? { x: d.position[0], y: d.position[1], z: d.position[2] } : { x: 0, y: 0, z: 0 },
        groups: d.groups || [],
        editorGroupId: d.editorGroupId || '',
        color: d.color !== undefined ? '#' + d.color.toString(16).padStart(6, '0') : '#555',
        placedOrder: 0,
        mesh: null,
      };
    }
  }

  // Filter
  let filtered = items.filter(item => {
    const info = getInfo(item);
    // Category filter
    if (filterCat) {
      if (filterCat === 'grouped') {
        if (!info.editorGroupId) return false;
      } else if (filterCat === 'named') {
        if (!info.label) return false;
      } else if (filterCat === 'has-function') {
        if (!item.mesh || !_meshHasFunction(item.mesh)) return false;
      } else if (OBJLIB_CATEGORIES[filterCat]) {
        if (!OBJLIB_CATEGORIES[filterCat].types.includes(info.type)) return false;
      }
    }
    // Type filter
    if (filterType && info.type !== filterType) return false;
    // World filter
    if (filterWorld && info.world !== filterWorld) return false;
    // Search
    if (searchRaw) {
      const haystack = [
        info.label,
        info.type,
        DEFS[info.type]?.label || '',
        info.world,
        (worlds.find(w => w.id === info.world)?.name || ''),
        ...info.groups,
        info.editorGroupId,
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchRaw)) return false;
    }
    return true;
  });

  // Sort
  const infos = filtered.map(item => ({ item, info: getInfo(item) }));
  switch (sortMode) {
    case 'name-asc':
      infos.sort((a, b) => (a.info.label || 'zzz').localeCompare(b.info.label || 'zzz'));
      break;
    case 'name-desc':
      infos.sort((a, b) => (b.info.label || '').localeCompare(a.info.label || ''));
      break;
    case 'newest':
      infos.sort((a, b) => (b.info.placedOrder || 0) - (a.info.placedOrder || 0));
      break;
    case 'oldest':
      infos.sort((a, b) => (a.info.placedOrder || 0) - (b.info.placedOrder || 0));
      break;
    case 'type':
      infos.sort((a, b) => a.info.type.localeCompare(b.info.type) || (a.info.label || '').localeCompare(b.info.label || ''));
      break;
    case 'world':
      infos.sort((a, b) => a.info.world.localeCompare(b.info.world) || (a.info.label || '').localeCompare(b.info.label || ''));
      break;
    case 'distance': {
      const camPos = editorCam.position;
      infos.sort((a, b) => {
        const da = Math.hypot(a.info.pos.x - camPos.x, a.info.pos.y - camPos.y, a.info.pos.z - camPos.z);
        const db = Math.hypot(b.info.pos.x - camPos.x, b.info.pos.y - camPos.y, b.info.pos.z - camPos.z);
        return da - db;
      });
      break;
    }
  }

  // Render
  if (_objlibCount) _objlibCount.textContent = infos.length + ' object' + (infos.length !== 1 ? 's' : '');
  _objlibList.innerHTML = '';
  const selectedUuid = state.selectedObject?.uuid;
  for (const { item, info } of infos) {
    const worldName = worlds.find(w => w.id === info.world)?.name || info.world;
    const icon = OBJLIB_TYPE_ICONS[info.type] || '⬜';
    const px = info.pos.x?.toFixed?.(1) ?? info.pos.x;
    const py = info.pos.y?.toFixed?.(1) ?? info.pos.y;
    const pz = info.pos.z?.toFixed?.(1) ?? info.pos.z;

    const div = document.createElement('div');
    div.className = 'objlib-item';
    if (info.mesh && info.mesh.uuid === selectedUuid) div.classList.add('selected');
    div.innerHTML = `
      <div class="objlib-swatch" style="background:${info.color}">${icon}</div>
      <div class="objlib-info">
        <div class="objlib-name">${escapeHtml(info.label || '(unnamed)')}</div>
        <div class="objlib-detail">${escapeHtml(DEFS[info.type]?.label || info.type)} · ${escapeHtml(worldName)}</div>
        <div class="objlib-detail">${px}, ${py}, ${pz}</div>
      </div>`;
    if (info.mesh) {
      div.addEventListener('click', () => {
        selectObject(info.mesh);
        orbitControls.target.copy(info.mesh.position);
        refreshObjLib();
      });
    }
    _objlibList.appendChild(div);
  }
}

// Wire filter/sort/search events
if (_objlibSearch) _objlibSearch.addEventListener('input', refreshObjLib);
if (_objlibFilterCat) _objlibFilterCat.addEventListener('change', () => { _objlibPopulateTypeFilter(); refreshObjLib(); });
if (_objlibFilterType) _objlibFilterType.addEventListener('change', refreshObjLib);
if (_objlibFilterWorld) _objlibFilterWorld.addEventListener('change', refreshObjLib);
if (_objlibSort) _objlibSort.addEventListener('change', refreshObjLib);
_objlibPopulateTypeFilter();

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
syncFogUI();
syncFovUI();
refreshWorldUI();
refreshCustomObjectUI();
refreshStatus();

// Boot storage (IndexedDB + localStorage migration) then show UI
_bootStorage().then(async () => {
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
    // Cache auto-restore data; offer it when the user opens a project
    try {
      _pendingRestore = await _idbGet(_RESTORE_IDB_KEY);
      if (_pendingRestore && !_pendingRestore.payload) _pendingRestore = null;
    } catch (err) {
      console.warn('[Boot] Failed to read auto-restore data:', err);
      _pendingRestore = null;
    }
    showMainMenu();
  }
}).catch(err => {
  console.error('Boot storage failed:', err);
  showMainMenu();
});
requestAnimationFrame(animate);

// Save restore data when leaving the page
window.addEventListener('beforeunload', () => { if (_restoreDirty) _flushRestore(); });
