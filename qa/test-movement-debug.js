/**
 * Playwright test: diagnose why playtest movement fails.
 * Run: npx -p playwright node qa/test-movement-debug.js
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push('[console.error] ' + msg.text());
  });
  page.on('crash', () => { console.log('PAGE CRASHED'); });

  // Dismiss auto-restore confirm
  await page.addInitScript(() => { window.confirm = () => false; });

  console.log('Loading page...');
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(5000);
  console.log('Errors after load:', errors.length ? errors.join(' | ') : 'NONE');

  // Check what's visible
  const pageState = await page.evaluate(() => {
    const mainMenu = document.getElementById('main-menu');
    const studio = document.getElementById('studio');
    const canvas = document.querySelector('canvas');
    return {
      mainMenu: mainMenu ? getComputedStyle(mainMenu).display : 'N/A',
      studio: studio ? getComputedStyle(studio).display : 'N/A',
      canvas: !!canvas,
      bodyChildren: document.body.children.length,
      buttons: Array.from(document.querySelectorAll('button')).map(b => ({
        id: b.id, text: b.textContent.trim().slice(0,30),
        visible: getComputedStyle(b).display !== 'none' && b.offsetParent !== null
      })).filter(b => b.visible).slice(0, 15),
    };
  });
  console.log('Page state:', JSON.stringify(pageState, null, 2));

  // Click New Project if main menu is showing
  if (pageState.mainMenu !== 'none') {
    const newBtn = page.locator('#mm-new');
    if (await newBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('Clicking New Project...');
      await newBtn.click();
      await page.waitForTimeout(2000);
    } else {
      console.log('No New Project button visible; trying to click any visible entry button...');
      // Maybe a different button text
      const entryBtn = page.locator('button:visible').first();
      const btnText = await entryBtn.textContent().catch(() => '');
      console.log('First visible button:', btnText);
    }
  }

  // Now check if play button is available
  const playVisible = await page.locator('#btn-playtest').isVisible({ timeout: 2000 }).catch(() => false);
  console.log('Play button visible:', playVisible);
  if (!playVisible) {
    console.log('FAIL: Cannot enter studio');
    await browser.close();
    return;
  }

  // Enter play mode
  console.log('Clicking Play...');
  await page.locator('#btn-playtest').click();
  await page.waitForTimeout(500);

  const playState = await page.evaluate(() => ({
    isPlaytest: typeof state !== 'undefined' ? state.isPlaytest : 'N/A',
    fpsLocked: typeof fpsLocked !== 'undefined' ? fpsLocked : 'N/A',
    pos: typeof fpsPos !== 'undefined' ? [fpsPos.x.toFixed(3), fpsPos.y.toFixed(3), fpsPos.z.toFixed(3)] : null,
    stopBtn: getComputedStyle(document.getElementById('btn-stop')).display,
    crosshair: getComputedStyle(document.getElementById('crosshair')).display,
  }));
  console.log('After play:', JSON.stringify(playState));

  if (!playState.isPlaytest || playState.isPlaytest === 'N/A') {
    console.log('FAIL: Playtest did not activate');
    console.log('Errors:', errors);
    await browser.close();
    return;
  }

  // Record position
  const pos0 = await page.evaluate(() => [fpsPos.x, fpsPos.y, fpsPos.z]);
  console.log('pos0:', pos0);

  // Press W for 1 second
  await page.keyboard.down('w');
  await page.waitForTimeout(100);
  // Also try dispatching the event directly as a fallback
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
  });
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
  });
  await page.waitForTimeout(200);

  const pos1 = await page.evaluate(() => [fpsPos.x, fpsPos.y, fpsPos.z]);
  console.log('pos1 after W:', pos1);

  const dx = pos1[0] - pos0[0];
  const dy = pos1[1] - pos0[1];
  const dz = pos1[2] - pos0[2];
  const dist = Math.sqrt(dx*dx + dz*dz);
  console.log(`Movement: dx=${dx.toFixed(4)} dy=${dy.toFixed(4)} dz=${dz.toFixed(4)} hDist=${dist.toFixed(4)}`);

  // Check if fpsKeys is getting populated
  await page.keyboard.down('w');
  await page.waitForTimeout(50);
  const keysCheck = await page.evaluate(() => ({
    fpsKeysSize: typeof fpsKeys !== 'undefined' ? fpsKeys.size : 'N/A',
    fpsKeysContents: typeof fpsKeys !== 'undefined' ? Array.from(fpsKeys) : [],
    isPlaytest: state?.isPlaytest,
  }));
  await page.keyboard.up('w');
  console.log('fpsKeys while W held:', JSON.stringify(keysCheck));

  // Check the animate loop is running
  const animCheck = await page.evaluate(() => {
    return new Promise(resolve => {
      const start = fpsPos.clone ? [fpsPos.x, fpsPos.y, fpsPos.z] : null;
      // Manually add key and check after 500ms
      fpsKeys.add('KeyW');
      setTimeout(() => {
        const end = [fpsPos.x, fpsPos.y, fpsPos.z];
        fpsKeys.delete('KeyW');
        resolve({ start, end, moved: start ? (Math.abs(end[0]-start[0]) > 0.001 || Math.abs(end[2]-start[2]) > 0.001) : 'N/A' });
      }, 500);
    });
  });
  console.log('Direct fpsKeys injection test:', JSON.stringify(animCheck));

  console.log('\nFinal errors:', errors.length ? errors.join(' | ') : 'NONE');
  if (animCheck.moved) {
    console.log('>>> The animate loop DOES move the player when fpsKeys has KeyW');
    console.log('>>> Issue is likely that keyboard events are not reaching fpsKeys (pointer lock / focus)');
  } else if (animCheck.moved === false) {
    console.log('>>> The animate loop does NOT move even with fpsKeys.add("KeyW")');
    console.log('>>> There is a bug in the movement/physics code or an exception in animate()');
  }

  await browser.close();
})();
