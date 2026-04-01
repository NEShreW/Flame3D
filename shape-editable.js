// ═══════════════════════════════════════════════════════════════════
// shape-editable.js — 3D-Editable Non-Shape Objects
// Injected into main.js at build time via @@SHAPE_EDITABLE@@ marker.
// All code here shares scope with main.js (same module closure).
// ═══════════════════════════════════════════════════════════════════

// ── Constants ────────────────────────────────────────────────────

const SHAPE_PALETTE = [
  'cube', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism',
  'torus', 'plane2d', 'triangle2d', 'circle2d', 'polygon2d',
];

const SHAPE_EDITABLE_TYPES = new Set([
  'trigger', 'light', 'spawn', 'checkpoint', 'teleport', 'keypad',
  'target', 'pivot', 'joint', 'camera', 'npc', 'commandBlock',
  'wall', 'floor', 'screen', 'text', 'text3d',
]);

// Types that are visible during playtest by default (legacy behavior)
const DEFAULT_VISIBLE_IN_PLAY = new Set([
  'wall', 'floor', 'target', 'screen', 'text', 'text3d',
  'npc', 'camera', 'keypad', 'commandBlock',
]);

// ── Helpers ──────────────────────────────────────────────────────

function getEffectiveShapeType(mesh) {
  const st = mesh?.userData?.shapeType;
  if (st && DEFS[st]) return st;
  return mesh?.userData?.type || 'cube';
}

function getEffectiveDef(mesh) {
  return DEFS[getEffectiveShapeType(mesh)] || DEFS[mesh?.userData?.type] || {};
}

function clampTubeRadius(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0.24;
  return Math.max(0.02, Math.min(2.0, n));
}

// ── Playtest Visibility ──────────────────────────────────────────

function shouldHideInPlaytest(mesh) {
  // hiddenInGame always wins
  if (mesh.userData.hiddenInGame) return true;

  // Explicit visibleInPlay toggle takes precedence
  if (mesh.userData.visibleInPlay !== undefined) {
    return !mesh.userData.visibleInPlay;
  }

  // Legacy behavior: hide light blocks (with pointLight), spawn, trigger, pivot
  const t = mesh.userData.type;
  if (t === 'light' && mesh.userData.pointLight) return true;
  if (t === 'spawn' || t === 'trigger' || t === 'pivot') return true;

  return false;
}

// ── Property Panel: HTML Builders ────────────────────────────────

function buildShapeSelectHTML(mesh) {
  if (!SHAPE_EDITABLE_TYPES.has(mesh.userData.type)) return '';
  const current = mesh.userData.shapeType || '';
  let html = '<div class="prop-row"><span class="prop-key">Shape</span><div class="prop-controls"><select id="prop-shape-type" style="flex:1;max-width:140px">';
  html += `<option value=""${!current ? ' selected' : ''}>Default (${DEFS[mesh.userData.type]?.label || mesh.userData.type})</option>`;
  for (const s of SHAPE_PALETTE) {
    const label = DEFS[s]?.label || s;
    html += `<option value="${s}"${current === s ? ' selected' : ''}>${label}</option>`;
  }
  html += '</select></div></div>';
  return html;
}

function buildTubeRadiusHTML(mesh) {
  const effectiveType = getEffectiveShapeType(mesh);
  if (effectiveType !== 'torus') return '';
  const sp = normalizeShapeParams(effectiveType, mesh.userData.shapeParams || {});
  const val = r3(sp.tubeRadius ?? 0.24, 2);
  return `<div class="prop-row"><span class="prop-key">Tube R</span><div class="prop-controls"><input id="prop-shape-tube-radius" type="number" min="0.02" max="2" step="0.01" value="${val}" style="width:64px"/></div></div>`;
}

function buildVisibleInPlayHTML(mesh) {
  if (!SHAPE_EDITABLE_TYPES.has(mesh.userData.type)) return '';
  let checked;
  if (mesh.userData.visibleInPlay !== undefined) {
    checked = !!mesh.userData.visibleInPlay;
  } else {
    checked = DEFAULT_VISIBLE_IN_PLAY.has(mesh.userData.type);
  }
  return `<div class="prop-row"><span class="prop-key">Play Vis</span><div class="prop-controls"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px"><input id="prop-visible-in-play" type="checkbox" ${checked ? 'checked' : ''}/> Visible in Play</label></div></div>`;
}

function buildEffectiveShapeControls(mesh) {
  const effectiveType = getEffectiveShapeType(mesh);
  const eDef = DEFS[effectiveType] || {};
  const sp = normalizeShapeParams(effectiveType, mesh.userData.shapeParams || {});
  let html = '';
  if (eDef.usesSides) {
    html += `<div class="prop-row"><span class="prop-key">Sides</span><div class="prop-controls"><input id="prop-shape-sides" type="number" min="3" max="64" step="1" value="${sp.sides ?? clampShapeSides(state.placeSides)}" style="width:64px"/></div></div>`;
  }
  if (eDef.is2D) {
    html += `<div class="prop-row"><span class="prop-key">Depth</span><div class="prop-controls"><input id="prop-shape-depth" type="number" min="0.05" max="8" step="0.05" value="${r3(sp.depth ?? clampShapeDepth(state.place2DDepth), 2)}" style="width:64px"/></div></div>`;
  }
  html += buildTubeRadiusHTML(mesh);
  return html;
}

// ── Property Panel: Binding ──────────────────────────────────────

function bindShapeSelectProps(mesh) {
  const sel = document.getElementById('prop-shape-type');
  if (!sel || state.selectedObject !== mesh) return;

  sel.addEventListener('change', () => {
    const val = sel.value || undefined; // '' → undefined (= default/remove)
    const targets = getPropertyTargets(mesh).filter(t => t.userData.type === mesh.userData.type);

    for (const t of targets) {
      const beforeShapeType = t.userData.shapeType;
      const beforeParams = { ...t.userData.shapeParams };
      const beforeGeo = t.geometry.clone();

      // Set or clear shapeType
      if (val) {
        t.userData.shapeType = val;
      } else {
        delete t.userData.shapeType;
      }

      // Reset shapeParams for new effective shape
      const effectiveType = getEffectiveShapeType(t);
      t.userData.shapeParams = normalizeShapeParams(effectiveType, {});

      // Rebuild geometry
      const afterGeo = buildTypeGeometry(effectiveType, t.userData.shapeParams);
      setMeshGeometry(t, afterGeo);

      pushUndo({
        type: 'shapeTypeChange',
        mesh: t,
        beforeShapeType,
        afterShapeType: val,
        beforeParams,
        afterParams: { ...t.userData.shapeParams },
        beforeGeo,
        afterGeo: afterGeo.clone(),
      });
    }
    refreshProps();
  });
}

function bindTubeRadiusProps(mesh) {
  const input = document.getElementById('prop-shape-tube-radius');
  if (!input || state.selectedObject !== mesh) return;

  const effectiveType = getEffectiveShapeType(mesh);
  if (effectiveType !== 'torus') return;

  const targets = getPropertyTargets(mesh).filter(t => getEffectiveShapeType(t) === 'torus');
  if (!targets.length) return;

  input.addEventListener('change', () => {
    const newRadius = clampTubeRadius(parseFloat(input.value));
    for (const t of targets) {
      const beforeParams = normalizeShapeParams(effectiveType, t.userData.shapeParams || {});
      const nextParams = normalizeShapeParams(effectiveType, { ...beforeParams, tubeRadius: newRadius });
      if (JSON.stringify(beforeParams) === JSON.stringify(nextParams)) continue;

      const beforeGeo = t.geometry.clone();
      const afterGeo = buildTypeGeometry(effectiveType, nextParams);
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
  });
}

function bindVisibleInPlayProps(mesh) {
  const cb = document.getElementById('prop-visible-in-play');
  if (!cb || state.selectedObject !== mesh) return;

  cb.addEventListener('change', () => {
    const targets = getPropertyTargets(mesh);
    for (const t of targets) {
      const before = t.userData.visibleInPlay;
      t.userData.visibleInPlay = cb.checked;
      pushUndo({
        type: 'visibleInPlay',
        mesh: t,
        before,
        after: cb.checked,
      });
    }
  });
}
