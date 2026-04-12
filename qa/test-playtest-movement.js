/**
 * Playwright test: verify player can actually MOVE in playtest mode.
 * Run: npx -p playwright node qa/test-playtest-movement.js
 * Set FLAME3D_BASE_URL env var to override the server URL.
 */
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.FLAME3D_BASE_URL || 'http://localhost:8000';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const page = await (await browser.newContext()).newPage();

  const jsErrors = [];
  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('crash', () => { throw new Error('Page crashed during test'); });

  // Dismiss any auto-restore confirm dialogs before the page loads
  await page.addInitScript(() => { window.confirm = () => false; });

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(5000);

    assert(!jsErrors.length,
      `Unexpected JS errors on page load:\n${jsErrors.join('\n')}`);

    const playBtn = page.locator('#btn-playtest');
    assert(
      await playBtn.isVisible({ timeout: 3000 }).catch(() => false),
      'Play button is not visible — not in studio?'
    );

    // Enter playtest
    await playBtn.click();
    await page.waitForTimeout(800);

    assert(
      await page.evaluate(() => state?.isPlaytest),
      'isPlaytest should be true after clicking the play button'
    );
    assert(!jsErrors.length,
      `JS errors after entering playtest:\n${jsErrors.join('\n')}`);

    // Record start position
    const pos0 = await page.evaluate(() => ({ x: fpsPos.x, y: fpsPos.y, z: fpsPos.z }));

    // Press W for 1 second
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(200);
    const posW = await page.evaluate(() => ({ x: fpsPos.x, y: fpsPos.y, z: fpsPos.z }));
    const movedW = Math.abs(posW.x - pos0.x) > 0.01 || Math.abs(posW.z - pos0.z) > 0.01;

    // Press D for 0.5 seconds
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyD');
    await page.waitForTimeout(200);
    const posD = await page.evaluate(() => ({ x: fpsPos.x, y: fpsPos.y, z: fpsPos.z }));
    const movedD = Math.abs(posD.x - posW.x) > 0.01 || Math.abs(posD.z - posW.z) > 0.01;

    assert(
      movedW || movedD,
      `Player did not move with WASD keys.\n` +
      `  pos0=${JSON.stringify(pos0)}\n` +
      `  posW=${JSON.stringify(posW)}\n` +
      `  posD=${JSON.stringify(posD)}`
    );

    assert(
      await page.evaluate(() => state?.isPlaytest),
      'Playtest exited unexpectedly during movement test (pointer-lock issue?)'
    );

    console.log(`PASS: player movement works (W:${movedW} D:${movedD})`);
  } finally {
    await browser.close();
  }
})();

