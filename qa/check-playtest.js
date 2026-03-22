const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const consoleMessages = [];

  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });

  // Auto-dismiss any confirm dialogs
  page.on('dialog', async dialog => {
    console.log('Dialog appeared:', dialog.message());
    await dialog.dismiss();
  });

  await page.goto('http://127.0.0.1:8000/flame3d-editor.html', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(5000);

  // Check page state
  const state = await page.evaluate(() => {
    const mainMenu = document.getElementById('main-menu');
    const topbar = document.getElementById('topbar');
    const workspace = document.getElementById('workspace');
    const playBtn = document.getElementById('btn-playtest');
    return {
      mainMenuExists: !!mainMenu,
      mainMenuHidden: mainMenu ? mainMenu.classList.contains('hidden') : null,
      topbarHidden: topbar ? topbar.classList.contains('studio-hidden') : null,
      workspaceHidden: workspace ? workspace.classList.contains('studio-hidden') : null,
      playBtnExists: !!playBtn,
      playBtnDisplay: playBtn ? playBtn.style.display : null,
    };
  });
  console.log('Page state:', JSON.stringify(state, null, 2));

  // Try clicking "New Project" if on main menu
  const clicked = await page.evaluate(() => {
    const newBtn = document.querySelector('#main-menu button');
    if (newBtn) { newBtn.click(); return 'clicked: ' + newBtn.textContent; }
    return 'no button found';
  });
  console.log('New project click:', clicked);
  await page.waitForTimeout(1000);

  // Check state after entering studio
  const state2 = await page.evaluate(() => {
    const mainMenu = document.getElementById('main-menu');
    const playBtn = document.getElementById('btn-playtest');
    return {
      mainMenuHidden: mainMenu ? mainMenu.classList.contains('hidden') : null,
      playBtnExists: !!playBtn,
      playBtnDisplay: playBtn ? playBtn.style.display : null,
      playBtnDisabled: playBtn ? playBtn.disabled : null,
    };
  });
  console.log('After studio:', JSON.stringify(state2, null, 2));

  // Try clicking Play
  const playResult = await page.evaluate(() => {
    const btn = document.getElementById('btn-playtest');
    if (!btn) return 'no play button';
    btn.click();
    return 'clicked play';
  });
  console.log('Play click:', playResult);
  await page.waitForTimeout(2000);

  // Check playtest state
  const state3 = await page.evaluate(() => {
    const stopBtn = document.getElementById('btn-stop');
    const crosshair = document.getElementById('crosshair');
    return {
      stopBtnDisplay: stopBtn ? stopBtn.style.display : null,
      crosshairDisplay: crosshair ? crosshair.style.display : null,
    };
  });
  console.log('After play:', JSON.stringify(state3, null, 2));

  // Report errors
  const errMsgs = consoleMessages.filter(m => m.type === 'error');
  if (errMsgs.length) {
    console.log('\nConsole errors:');
    for (const m of errMsgs) console.log(' -', m.text);
  }
  if (errors.length) {
    console.log('\nPage errors:');
    for (const e of errors) console.log(' -', e);
  }
  if (!errMsgs.length && !errors.length) {
    console.log('\nNo errors detected');
  }

  await browser.close();
})();
