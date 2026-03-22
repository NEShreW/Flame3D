#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');

const BASE_URL = process.env.FLAME3D_BASE_URL || 'http://127.0.0.1:8765';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const consoleMsgs = [];

  page.on('pageerror', err => errors.push(String(err)));
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warn') {
      consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  console.log(`Opening ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });

  // Dismiss main menu if visible
  const startBtn = page.locator('#mm-new');
  if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await startBtn.click();
    await page.waitForTimeout(1000);
  }

  console.log(`\n--- Page Errors ---`);
  for (const e of errors) console.log(e);
  console.log(`Total page errors: ${errors.length}`);

  console.log('\n--- Console Warnings/Errors ---');
  for (const m of consoleMsgs) console.log(m);

  // Take screenshot before clicking
  await page.screenshot({ path: 'test-results/before-click.png' });
  console.log('Saved before-click screenshot');

  // Check main menu state
  const mainMenuVisible = await page.locator('#main-menu').evaluate(el => {
    const style = window.getComputedStyle(el);
    return { display: style.display, classList: Array.from(el.classList) };
  });
  console.log(`\nMain menu state:`, JSON.stringify(mainMenuVisible));

  // Check workspace
  const wsState = await page.locator('#workspace').evaluate(el => {
    const style = window.getComputedStyle(el);
    return { display: style.display, classList: Array.from(el.classList) };
  });
  console.log(`Workspace state:`, JSON.stringify(wsState));

  // Check functions panel
  const fpState = await page.locator('#functions-panel').evaluate(el => {
    const style = window.getComputedStyle(el);
    return { display: style.display, width: style.width, overflow: style.overflow, classList: Array.from(el.classList) };
  });
  console.log(`Functions panel state:`, JSON.stringify(fpState));

  // Check fn-panel-tabs
  const tabsState = await page.locator('.fn-panel-tabs').evaluate(el => {
    const style = window.getComputedStyle(el);
    return { display: style.display, height: style.height, overflow: style.overflow, visibility: style.visibility };
  });
  console.log(`Tabs container state:`, JSON.stringify(tabsState));

  // Check if tab buttons exist
  const tabCount = await page.locator('.fn-panel-tab').count();
  console.log(`Tab buttons found: ${tabCount}`);

  // Check each tab's visibility details
  for (let i = 0; i < tabCount; i++) {
    const tabState = await page.locator('.fn-panel-tab').nth(i).evaluate(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: el.textContent,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        dataset: el.dataset.fnPane
      };
    });
    console.log(`Tab ${i}:`, JSON.stringify(tabState));
  }

  // Check pane state before click
  const fnPaneActive = await page.locator('#fn-pane-functions').evaluate(el => el.classList.contains('active'));
  const objPaneActive = await page.locator('#fn-pane-objlib').evaluate(el => el.classList.contains('active'));
  console.log(`Before click: functions pane active=${fnPaneActive}, objlib pane active=${objPaneActive}`);

  // Try clicking the Objects tab
  const objTab = page.locator('.fn-panel-tab[data-fn-pane="objlib"]');
  const isVisible = await objTab.isVisible();
  console.log(`Objects tab visible: ${isVisible}`);

  if (isVisible) {
    const box = await objTab.boundingBox();
    console.log(`Objects tab bounding box:`, JSON.stringify(box));
    await objTab.click();
    await page.waitForTimeout(200);
    const fnPaneActiveAfter = await page.locator('#fn-pane-functions').evaluate(el => el.classList.contains('active'));
    const objPaneActiveAfter = await page.locator('#fn-pane-objlib').evaluate(el => el.classList.contains('active'));
    console.log(`After click: functions pane active=${fnPaneActiveAfter}, objlib pane active=${objPaneActiveAfter}`);

    // Check the VISUAL state of the panes after clicking
    const fnPaneStyle = await page.locator('#fn-pane-functions').evaluate(el => {
      const s = window.getComputedStyle(el);
      return { display: s.display, height: s.height, visibility: s.visibility };
    });
    const objPaneStyle = await page.locator('#fn-pane-objlib').evaluate(el => {
      const s = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { display: s.display, height: s.height, visibility: s.visibility, rect: { w: rect.width, h: rect.height } };
    });
    console.log(`Functions pane visual after click:`, JSON.stringify(fnPaneStyle));
    console.log(`ObjLib pane visual after click:`, JSON.stringify(objPaneStyle));

    // Check active tab styling
    const activeTabText = await page.locator('.fn-panel-tab.active').textContent();
    console.log(`Active tab text after click: ${activeTabText}`);

    // Take screenshot after clicking Objects tab
    await page.screenshot({ path: 'test-results/after-objlib-click.png' });
    console.log('Saved after-objlib-click screenshot');

    // Now click back to Functions
    await page.locator('.fn-panel-tab[data-fn-pane="functions"]').click();
    await page.waitForTimeout(200);
    const activeTabTextBack = await page.locator('.fn-panel-tab.active').textContent();
    console.log(`Active tab text after clicking back: ${activeTabTextBack}`);
  } else {
    // Force click even if not visible to test functionality
    console.log('Tab not visible, force-clicking via JS...');
    await page.locator('.fn-panel-tab[data-fn-pane="objlib"]').evaluate(el => el.click());
    await page.waitForTimeout(200);
    const fnPaneActiveAfter = await page.locator('#fn-pane-functions').evaluate(el => el.classList.contains('active'));
    const objPaneActiveAfter = await page.locator('#fn-pane-objlib').evaluate(el => el.classList.contains('active'));
    console.log(`After force click: functions pane active=${fnPaneActiveAfter}, objlib pane active=${objPaneActiveAfter}`);
  }

  console.log('\n--- Post-Click Errors ---');
  for (const e of errors) console.log(e);

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
