const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const errors = [];

  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('PAGE_ERROR: ' + e.message));
  page.on('dialog', async d => { errors.push('ALERT: ' + d.message()); await d.dismiss(); });

  // Load app normally
  await page.goto('http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Create a project via UI first
  await page.click('#mm-new');
  await page.waitForTimeout(500);

  // Save it
  await page.evaluate(() => { window._origPrompt = window.prompt; window.prompt = () => 'Skin Test'; });
  await page.click('#btn-save-project');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.prompt = window._origPrompt; });

  // Go back
  await page.click('#btn-back-menu');
  await page.waitForTimeout(1000);

  // Inject a project with custom skins + functions into IDB
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
          customBlockSkins: { wall: { voxels: [{ x:0, y:0, z:0, color: 0xff0000 }], gridSize: { x:4, y:4, z:4 } } },
          controlFunctions: [{ name: 'testFunc', groupId: '', actions: [{ actionType: 'move', offset: [0,1,0], startOffset: [0,0,0], duration: 1, style: 'glide', refType: 'group', refValue: 'default', returnOnDeactivate: false }] }]
        }
      }
    });

    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      const r = tx.objectStore('kv').put(projects, 'flame3d_projects_v1');
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
  });

  // Reload to pick up the new project
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const rows = await page.locator('[data-project-id]').count();
  console.log('Project rows:', rows);

  // Click the skin-fn-test project
  const skinRow = page.locator('[data-project-id="skin-fn-test"]');
  if (await skinRow.count() === 0) {
    console.log('🔴 skin-fn-test project not found');
    await browser.close();
    return;
  }

  await skinRow.click();
  await page.waitForTimeout(3000);

  const menuH = await page.evaluate(() => document.getElementById('main-menu').classList.contains('hidden'));
  console.log('Menu hidden after click:', menuH ? '🟢' : '🔴');

  const fnCount = await page.evaluate(() => {
    const el = document.getElementById('control-functions-list');
    return el ? el.querySelectorAll('.ct-entry').length : -1;
  });
  console.log('Control functions rendered:', fnCount > 0 ? '🟢 (' + fnCount + ')' : '🔴 (0)');

  if (errors.length) {
    console.log('Errors:');
    errors.forEach(e => console.log('  ', e));
  } else {
    console.log('No errors 🟢');
  }

  await browser.close();
})();
