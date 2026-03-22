#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');

const BASE_URL = process.env.FLAME3D_BASE_URL || 'http://127.0.0.1:8000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', err => errors.push(String(err)));
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  console.log(`[debug] Opening ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000); // wait for IndexedDB boot

  // Check if main menu is visible
  const menuVisible = await page.locator('#main-menu').isVisible();
  console.log(`[debug] Main menu visible: ${menuVisible}`);

  // Click "New Project" to enter the studio
  console.log('[debug] Clicking "New Project"...');
  await page.click('#mm-new');
  await page.waitForTimeout(500);

  const menuVisibleAfterNew = await page.locator('#main-menu').isVisible();
  console.log(`[debug] Main menu visible after New: ${menuVisibleAfterNew}`);

  // Save a project
  console.log('[debug] Saving project...');
  // Use page.evaluate to directly call saveProjectToLibrary with a preset name
  await page.evaluate(() => {
    // Override prompt to auto-return a name
    window._origPrompt = window.prompt;
    window.prompt = () => 'Test Project Debug';
  });
  await page.click('#btn-save-project');
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.prompt = window._origPrompt; });

  // Go back to the main menu
  console.log('[debug] Going to main menu...');
  await page.click('#btn-back-menu');
  await page.waitForTimeout(1000);

  const menuVisibleAfterBack = await page.locator('#main-menu').isVisible();
  console.log(`[debug] Main menu visible after Back: ${menuVisibleAfterBack}`);

  // Check if the project is listed
  const projectRows = await page.locator('[data-project-id]').count();
  console.log(`[debug] Project rows visible: ${projectRows}`);

  if (projectRows === 0) {
    console.error('[debug] No projects found in menu!');
    await browser.close();
    return;
  }

  // Get the project ID and other info
  const projectId = await page.locator('[data-project-id]').first().getAttribute('data-project-id');
  const projectName = await page.locator('.mm-project-name').first().innerText();
  console.log(`[debug] Project ID: ${projectId}, Name: ${projectName}`);

  // Clear errors before the click
  errors.length = 0;
  logs.length = 0;

  // Now click on the first project
  console.log('[debug] Clicking on the project row...');
  await page.locator('[data-project-id]').first().click();
  await page.waitForTimeout(2000);

  const menuVisibleAfterClick = await page.locator('#main-menu').isVisible();
  const menuHiddenClass = await page.locator('#main-menu').evaluate(el => el.classList.contains('hidden'));
  const topbarVisible = await page.locator('#topbar').isVisible();
  console.log(`[debug] Main menu visible after click: ${menuVisibleAfterClick}`);
  console.log(`[debug] Main menu has 'hidden' class: ${menuHiddenClass}`);
  console.log(`[debug] Topbar visible after click: ${topbarVisible}`);

  if (errors.length) {
    console.error('[debug] JS errors during click:');
    for (const e of errors) console.error(`  ${e}`);
  }

  if (logs.length) {
    console.log('[debug] Console logs during click:');
    for (const l of logs) console.log(`  ${l}`);
  }

  if (menuVisibleAfterClick) {
    console.error('\n🔴 BUG CONFIRMED: Main menu is still visible after clicking a project!');
  } else {
    console.log('\n🟢 Menu disappeared correctly after clicking a project.');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
