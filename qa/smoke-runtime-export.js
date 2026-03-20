#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const BASE_URL = process.env.FLAME3D_BASE_URL || 'http://127.0.0.1:8000';

function readRuntimeBooleanFlag(scriptText, flagName) {
  const match = scriptText.match(new RegExp(`window\\.${flagName}\\s*=\\s*(true|false)\\s*;`, 'i'));
  return match ? match[1] === 'true' : null;
}

function verifyExport(kind, html, expected) {
  const runtimeFlagsMatch = html.match(/<script>\s*window\.__FLAME3D_RUNTIME_MODE__[\s\S]*?<\/script>/i);
  assert(runtimeFlagsMatch, `${kind}: missing runtime flags script`);
  const runtimeFlagsScript = runtimeFlagsMatch[0];
  assert(/<script\s+type=["']module["']>[\s\S]*?<\/script>/i.test(html), `${kind}: missing inline runtime module script`);
  assert(!/<script\s+type=["']module["']\s+src=["']\.\/main\.js(?:\?[^"']*)?["']\s*><\/script>/i.test(html), `${kind}: still references external main.js`);

  const runtimeMode = readRuntimeBooleanFlag(runtimeFlagsScript, '__FLAME3D_RUNTIME_MODE__');
  const runtimeLoader = readRuntimeBooleanFlag(runtimeFlagsScript, '__FLAME3D_RUNTIME_LOADER__');
  const runtimeAutostart = readRuntimeBooleanFlag(runtimeFlagsScript, '__FLAME3D_RUNTIME_AUTOSTART__');
  assert(runtimeMode === true, `${kind}: runtime mode flag not set`);
  assert(runtimeLoader === !!expected.loader, `${kind}: loader mode flag mismatch`);
  assert(runtimeAutostart === !!expected.autostart, `${kind}: autostart flag mismatch`);

  const embeddedAssign = /window\.__FLAME3D_EMBEDDED_LEVEL__\s*=/;
  if (expected.embeddedLevel) {
    assert(embeddedAssign.test(runtimeFlagsScript), `${kind}: missing embedded level payload assignment`);
  } else {
    assert(!embeddedAssign.test(runtimeFlagsScript), `${kind}: unexpected embedded level payload assignment`);
  }

  assert(html.includes("import * as THREE from 'three';"), `${kind}: runtime module content missing`);
}

async function downloadHtml(page, buttonSelector) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click(buttonSelector),
  ]);
  const filePath = await download.path();
  assert(filePath, `Download path was unavailable for ${buttonSelector}`);
  const html = await fs.readFile(filePath, 'utf8');
  return { html, suggestedFilename: download.suggestedFilename() };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const editorErrors = [];
  page.on('pageerror', err => editorErrors.push(String(err)));

  console.log(`[smoke] opening ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const exportButtonVisible = await page.locator('#btn-export-game').isVisible().catch(() => false);
  if (!exportButtonVisible) {
    const mainMenuNewButton = page.locator('#mm-new');
    if (await mainMenuNewButton.count()) {
      console.log('[smoke] entering editor from main menu');
      await mainMenuNewButton.first().click();
    }
  }
  await page.waitForSelector('#btn-export-game', { timeout: 15000 });

  console.log('[smoke] exporting standalone game html');
  const game = await downloadHtml(page, '#btn-export-game');
  verifyExport('game export', game.html, { loader: false, autostart: true, embeddedLevel: true });

  console.log('[smoke] exporting runtime loader html');
  const loader = await downloadHtml(page, '#btn-export-loader');
  verifyExport('loader export', loader.html, { loader: true, autostart: false, embeddedLevel: false });

  console.log('[smoke] basic playtest start/stop');
  await page.click('#btn-playtest');
  await page.waitForTimeout(700);
  const statusText = await page.locator('#status-text').innerText();
  assert(statusText && statusText.trim().length > 0, 'playtest status text was empty');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flame3d-export-'));
  const gamePath = path.join(tempDir, game.suggestedFilename || 'flame3d-game.html');
  const loaderPath = path.join(tempDir, loader.suggestedFilename || 'flame3d-game-loader.html');
  await fs.writeFile(gamePath, game.html, 'utf8');
  await fs.writeFile(loaderPath, loader.html, 'utf8');

  const runtimePage = await context.newPage();
  const runtimeErrors = [];
  runtimePage.on('pageerror', err => runtimeErrors.push(String(err)));

  console.log('[smoke] opening exported game html in isolation');
  await runtimePage.goto(pathToFileURL(gamePath).href, { waitUntil: 'domcontentloaded' });
  await runtimePage.waitForTimeout(1000);
  const gameRuntimeFlags = await runtimePage.evaluate(() => ({
    runtimeMode: !!globalThis.__FLAME3D_RUNTIME_MODE__,
    loaderMode: !!globalThis.__FLAME3D_RUNTIME_LOADER__,
  }));
  assert.equal(gameRuntimeFlags.runtimeMode, true, 'isolated game export did not enter runtime mode');
  assert.equal(gameRuntimeFlags.loaderMode, false, 'isolated game export unexpectedly enabled loader mode');

  console.log('[smoke] opening exported loader html in isolation');
  await runtimePage.goto(pathToFileURL(loaderPath).href, { waitUntil: 'domcontentloaded' });
  await runtimePage.waitForSelector('#runtime-add-json', { timeout: 15000 });
  const loaderRuntimeFlags = await runtimePage.evaluate(() => ({
    runtimeMode: !!globalThis.__FLAME3D_RUNTIME_MODE__,
    loaderMode: !!globalThis.__FLAME3D_RUNTIME_LOADER__,
  }));
  assert.equal(loaderRuntimeFlags.runtimeMode, true, 'isolated loader export did not enter runtime mode');
  assert.equal(loaderRuntimeFlags.loaderMode, true, 'isolated loader export did not enable loader mode');

  const allErrors = [...editorErrors, ...runtimeErrors];
  assert.equal(allErrors.length, 0, `console errors were raised: ${allErrors.slice(0, 3).join(' | ')}`);

  await context.close();
  await browser.close();
  console.log('[smoke] PASS');
}

main().catch(err => {
  console.error('[smoke] FAIL:', err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
