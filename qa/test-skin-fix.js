'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.FLAME3D_BASE_URL || 'http://127.0.0.1:8000';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push('PAGE_ERROR: ' + e.message));
  page.on('dialog', async d => { await d.dismiss(); });

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // Enter studio and save a throwaway project so IDB is initialised
    await page.click('#mm-new');
    await page.waitForTimeout(500);
    await page.evaluate(() => { window._origPrompt = window.prompt; window.prompt = () => 'Skin Test'; });
    await page.click('#btn-save-project');
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.prompt = window._origPrompt; });

    // Return to main menu
    await page.click('#btn-back-menu');
    await page.waitForTimeout(1000);

    // Inject a project with custom block skins + control functions directly into IDB
    await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('flame3d_store', 1);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      const projects = await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readonly');
        const r = tx.objectStore('kv').get('flame3d_projects_v1');
        r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
      });
      projects.push({
        id: 'skin-fn-test', name: 'Skin+Fn Test',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        payload: {
          version: 2,
          objects: [{ type: 'wall', position: [0,0,0], quaternion: [0,0,0,1], scale: [1,1,1] }],
          settings: {
            customBlockSkins: {
              wall: { voxels: [{ x:0, y:0, z:0, color: 0xff0000 }], gridSize: { x:4, y:4, z:4 } },
            },
            controlFunctions: [{
              name: 'testFunc', groupId: '', actions: [{
                actionType: 'move', offset: [0,1,0], startOffset: [0,0,0],
                duration: 1, style: 'glide', refType: 'group', refValue: 'default',
                returnOnDeactivate: false,
              }],
            }],
          },
        },
      });
      await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        const r = tx.objectStore('kv').put(projects, 'flame3d_projects_v1');
        r.onsuccess = () => res(); r.onerror = () => rej(r.error);
      });
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    const rowCount = await page.locator('[data-project-id]').count();
    assert(rowCount > 0, `No project rows found after reload (got ${rowCount})`);

    const skinRow = page.locator('[data-project-id="skin-fn-test"]');
    assert(await skinRow.count() > 0, 'skin-fn-test project not found in the project list');

    await skinRow.click();
    await page.waitForTimeout(3000);

    const menuHidden = await page.evaluate(
      () => document.getElementById('main-menu').classList.contains('hidden')
    );
    assert(menuHidden, 'Main menu should be hidden after opening the project');

    const fnCount = await page.evaluate(() => {
      const el = document.getElementById('control-functions-list');
      return el ? el.querySelectorAll('.ct-entry').length : -1;
    });
    assert(fnCount > 0, `Expected >0 control functions to be rendered; got ${fnCount}`);

    assert(!jsErrors.length, `Unexpected JS errors:\n${jsErrors.join('\n')}`);

    console.log(`PASS: custom skins and functions loaded correctly (functions: ${fnCount})`);
  } finally {
    await browser.close();
  }
})();

