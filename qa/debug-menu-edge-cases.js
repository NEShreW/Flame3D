#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');
const BASE_URL = process.env.FLAME3D_BASE_URL || 'http://127.0.0.1:8000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Enter editor, place objects, save, go back
  await page.click('#mm-new');
  await page.waitForTimeout(500);

  // Place blocks by clicking canvas
  const canvas = page.locator('#canvas-container canvas');
  const box = await canvas.boundingBox();
  if (box) {
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(box.x + box.width/2 + i*30, box.y + box.height/2);
      await page.waitForTimeout(200);
    }
  }

  // Save project
  await page.evaluate(() => { window._origPrompt = window.prompt; window.prompt = () => 'Normal Project'; });
  await page.click('#btn-save-project');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.prompt = window._origPrompt; });

  // Go back
  await page.click('#btn-back-menu');
  await page.waitForTimeout(1000);
  console.log(`Rows: ${await page.locator('[data-project-id]').count()}`);

  // Inject edge cases directly into IndexedDB
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

    projects.push(
      { id:'e-string', name:'String Payload', payload: JSON.stringify({version:2, objects:[{type:'wall',position:[0,1,0],quaternion:[0,0,0,1],scale:[1,1,1]}], settings:{}}), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },
      { id:'e-unk', name:'Unknown Type', payload:{version:2, objects:[{type:'badtype',position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1]}], settings:{}}, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },
      { id:'e-nofield', name:'No Fields', payload:{version:2, objects:[{type:'wall'}], settings:{}}, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },
      { id:'e-null', name:'Null Payload', payload:null, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },
      { id:'e-noobj', name:'No Objects', payload:{version:2, settings:{}}, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() },
    );

    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      const r = tx.objectStore('kv').put(projects, 'flame3d_projects_v1');
      r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    });
  });

  // Reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  console.log(`After reload: ${await page.locator('[data-project-id]').count()} rows`);

  const all = await page.locator('[data-project-id]').evaluateAll(els =>
    els.map(el => ({ id: el.dataset.projectId, name: el.querySelector('.mm-project-name')?.textContent }))
  );
  for (const p of all) console.log(`  ${p.id}: ${p.name}`);

  for (const tid of ['e-string','e-unk','e-nofield','e-null','e-noobj']) {
    errors.length = 0;
    const row = page.locator(`[data-project-id="${tid}"]`);
    if (!(await row.count())) { console.log(`[${tid}] skip`); continue; }

    console.log(`[${tid}] click...`);
    await row.click();
    await page.waitForTimeout(1500);

    const vis = await page.locator('#main-menu').isVisible();
    console.log(`[${tid}] menu=${vis ? 'VISIBLE' : 'hidden'} ${vis ? '🔴' : '🟢'}`);
    if (errors.length) for (const e of errors) console.error(`  err: ${e}`);

    if (!vis) { await page.click('#btn-back-menu'); await page.waitForTimeout(500); }
    else { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500); }
  }

  await browser.close();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
