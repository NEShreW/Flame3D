/**
 * Playwright test: verify player can actually MOVE in playtest mode.
 * Run: npx -p playwright node qa/test-playtest-movement.js
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect JS errors
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[console.error] ' + msg.text());
  });
  page.on('crash', () => { console.log('PAGE CRASHED'); });

  // Override confirm BEFORE page loads to dismiss auto-restore dialog
  await page.addInitScript(() => { window.confirm = () => false; });

  console.log('Loading page...');
  try {
    await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log('DOM loaded');
  } catch (err) {
    console.log('ERROR loading page:', err.message);
    await browser.close();
    return;
  }

  // Wait for scripts
  await page.waitForTimeout(5000);

  console.log('Errors so far:', errors.length ? errors : 'NONE');

  try {
    const title = await page.title();
    console.log('Page title:', title);
  } catch (err) {
    console.log('Page likely crashed:', err.message);
    await browser.close();
    return;
  }

  // Verify we're in the studio
  const playBtn = page.locator('#btn-playtest');
  const playVisible = await playBtn.isVisible({ timeout: 2000 }).catch(() => false);
  console.log('Play button visible:', playVisible);
  if (!playVisible) { console.log('FAIL: Not in studio'); await browser.close(); return; }

  // Get fpsPos BEFORE play
  const preFpsPos = await page.evaluate(() => {
    return typeof fpsPos !== 'undefined' ? { x: fpsPos.x, y: fpsPos.y, z: fpsPos.z } : null;
  });
  console.log('fpsPos before play:', preFpsPos);

  // Click Play
  await playBtn.click();
  await page.waitForTimeout(500);

  // Check state
  const stateCheck1 = await page.evaluate(() => ({
    isPlaytest: state?.isPlaytest,
    fpsLocked: typeof fpsLocked !== 'undefined' ? fpsLocked : 'N/A',
    fpsPos: typeof fpsPos !== 'undefined' ? { x: fpsPos.x, y: fpsPos.y, z: fpsPos.z } : null,
  }));
  console.log('State after clicking Play:', JSON.stringify(stateCheck1));

  // Check for errors so far
  if (errors.length) {
    console.log('JS ERRORS detected after Play:', errors);
    await browser.close();
    return;
  }

  // Record position before movement
  const posBefore = await page.evaluate(() => ({
    x: fpsPos.x, y: fpsPos.y, z: fpsPos.z,
  }));
  console.log('Position before WASD:', JSON.stringify(posBefore));

  // Simulate pressing W for 1 second
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(200);

  const posAfterW = await page.evaluate(() => ({
    x: fpsPos.x, y: fpsPos.y, z: fpsPos.z,
  }));
  console.log('Position after W (1s):', JSON.stringify(posAfterW));

  const movedW = Math.abs(posAfterW.x - posBefore.x) > 0.01 ||
                 Math.abs(posAfterW.z - posBefore.z) > 0.01;
  console.log('Moved with W key:', movedW);

  // Try pressing D for 0.5s
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(200);

  const posAfterD = await page.evaluate(() => ({
    x: fpsPos.x, y: fpsPos.y, z: fpsPos.z,
  }));
  console.log('Position after D (0.5s):', JSON.stringify(posAfterD));

  const movedD = Math.abs(posAfterD.x - posAfterW.x) > 0.01 ||
                 Math.abs(posAfterD.z - posAfterW.z) > 0.01;
  console.log('Moved with D key:', movedD);

  // Check if isPlaytest is still true
  const stillPlaying = await page.evaluate(() => state?.isPlaytest);
  console.log('Still in playtest:', stillPlaying);

  // Check fpsKeys contents
  const fpsKeysInfo = await page.evaluate(() => ({
    size: fpsKeys.size,
    contents: Array.from(fpsKeys),
  }));
  console.log('fpsKeys after test:', JSON.stringify(fpsKeysInfo));

  // Check all errors
  console.log('\nJS errors collected:', errors.length ? errors : 'NONE');

  // Final verdict
  if (!stillPlaying) {
    console.log('\n>>> FAIL: Playtest exited unexpectedly (pointer lock issue?)');
  } else if (!movedW && !movedD) {
    console.log('\n>>> FAIL: Player did NOT move with WASD');
  } else {
    console.log('\n>>> PASS: Player movement works');
  }

  await browser.close();
})();
