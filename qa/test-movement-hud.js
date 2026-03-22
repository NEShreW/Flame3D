/**
 * Playwright test: diagnose playtest movement using coord HUD.
 * Run: node qa/test-movement-hud.js
 */
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('crash', () => { console.log('PAGE CRASHED'); });

  await page.addInitScript(() => { window.confirm = () => false; });
  await page.goto('http://localhost:8000/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(4000);

  // Enter studio
  await page.locator('#mm-new').click();
  await page.waitForTimeout(2000);

  // Enter play
  await page.locator('#btn-playtest').click();
  await page.waitForTimeout(1000);

  // Read coord HUD position
  const getPos = async () => {
    const text = await page.evaluate(() => document.getElementById('coord-hud')?.textContent || '');
    const match = text.match(/Pos\s+X:([\d.-]+)\s+Y:([\d.-]+)\s+Z:([\d.-]+)/);
    if (match) return { x: parseFloat(match[1]), y: parseFloat(match[2]), z: parseFloat(match[3]) };
    return { x: NaN, y: NaN, z: NaN, raw: text };
  };

  const pos0 = await getPos();
  console.log('Position at start:', JSON.stringify(pos0));

  // Check if playtest is active via UI
  const stopVisible = await page.evaluate(() => {
    const btn = document.getElementById('btn-stop');
    return btn ? getComputedStyle(btn).display : 'N/A';
  });
  console.log('Stop button display:', stopVisible);
  if (stopVisible === 'none' || stopVisible === 'N/A') {
    console.log('FAIL: Playtest not active');
    console.log('Errors:', errors);
    await browser.close();
    return;
  }

  // Test 1: Dispatch KeyW via window.dispatchEvent (simulating real keydown)
  console.log('\n--- Test 1: keyboard.down("w") for 2 seconds ---');
  await page.keyboard.down('w');
  await page.waitForTimeout(2000);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  const pos1 = await getPos();
  console.log('Position after W:', JSON.stringify(pos1));
  const dist1 = Math.sqrt((pos1.x-pos0.x)**2 + (pos1.z-pos0.z)**2);
  console.log('Horizontal distance moved:', dist1.toFixed(4));

  // Test 2: Directly dispatch keydown event on window
  console.log('\n--- Test 2: Direct dispatching KeyboardEvent on window ---');
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyW', key: 'w', keyCode: 87, which: 87, bubbles: true
    }));
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', {
      code: 'KeyW', key: 'w', keyCode: 87, which: 87, bubbles: true
    }));
  });
  await page.waitForTimeout(300);
  const pos2 = await getPos();
  console.log('Position after dispatched KeyW:', JSON.stringify(pos2));
  const dist2 = Math.sqrt((pos2.x-pos1.x)**2 + (pos2.z-pos1.z)**2);
  console.log('Horizontal distance moved:', dist2.toFixed(4));

  // Test 3: Y position change (gravity test) - check if falling
  console.log('\n--- Test 3: Check Y position over time ---');
  const posA = await getPos();
  await page.waitForTimeout(2000);
  const posB = await getPos();
  console.log('Y before:', posA.y, 'Y after 2s:', posB.y, 'dY:', (posB.y - posA.y).toFixed(4));

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log('Errors:', errors.length ? errors.join(' | ') : 'NONE');
  if (dist1 > 0.1 || dist2 > 0.1) {
    console.log('PASS: Player can move');
  } else {
    console.log('FAIL: Player cannot move horizontally');
    if (Math.abs(posB.y - posA.y) > 0.1) {
      console.log('  BUT gravity IS working (Y changed)');
    } else {
      console.log('  Gravity also appears stuck');
    }
  }

  await browser.close();
})();
