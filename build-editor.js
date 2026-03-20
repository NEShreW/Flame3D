#!/usr/bin/env node

/**
 * Build script to create a standalone HTML file of the Flame3D editor.
 * Run with: node build-editor.js
 * Output: flame3d-editor.html
 */

const fs = require('fs');
const path = require('path');

function safeJsonForInlineScript(obj) {
  const json = JSON.stringify(obj);
  return json.replace(/<\/script>/g, '<\\/script>');
}

function safeModuleSourceForInlineScript(src) {
  // Escape closing script tags in the source
  return src.replace(/<\/script>/g, '<\\/script>');
}

async function buildEditorHtml() {
  try {
    // Read the source files from disk
    const indexPath = path.join(__dirname, 'index.html');
    const mainPath = path.join(__dirname, 'main.js');

    if (!fs.existsSync(indexPath)) {
      throw new Error(`index.html not found at ${indexPath}`);
    }
    if (!fs.existsSync(mainPath)) {
      throw new Error(`main.js not found at ${mainPath}`);
    }

    const indexSource = fs.readFileSync(indexPath, 'utf8');
    const mainSource = fs.readFileSync(mainPath, 'utf8');

    // Create a script tag to replace the module import
    const runtimeFlagsScript = [
      '<script>',
      'window.__FLAME3D_RUNTIME_MODE__ = false;',
      'window.__FLAME3D_EDITOR_EXPORT__ = true;',
      '</script>',
    ].join('\n');

    const runtimeMainScriptTag = [
      '<script type="module">',
      safeModuleSourceForInlineScript(mainSource),
      '</script>',
    ].join('\n');

    // Replace the module script tag with inline script
    const scriptTagRe = /<script\s+type=["']module["']\s+src=["']\.\/main\.js(?:\?[^"']*)?["']\s*><\/script>/i;
    let html = indexSource.replace(scriptTagRe, '').trim();

    // Update title
    html = html.replace(/<title>[^<]*<\/title>/i, '<title>Flame3D – FPS Level Editor</title>');

    // Inject flag script before runtime main script
    if (!/<\/head>/i.test(html)) {
      throw new Error('Invalid HTML template: missing </head>');
    }
    html = html.replace(/<\/head>/i, `${runtimeFlagsScript}\n</head>`);

    // Inject main script at end of body
    if (!/<\/body>/i.test(html)) {
      throw new Error('Invalid HTML template: missing </body>');
    }
    html = html.replace(/<\/body>/i, `${runtimeMainScriptTag}\n</body>`);

    // Ensure file ends with newline
    if (!html.endsWith('\n')) {
      html = `${html}\n`;
    }

    // Write output
    const outputPath = path.join(__dirname, 'flame3d-editor.html');
    fs.writeFileSync(outputPath, html, 'utf8');

    console.log(`✓ Editor exported to: ${outputPath}`);
    console.log(`✓ File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('✗ Failed to build editor HTML:');
    console.error(err.message);
    process.exit(1);
  }
}

buildEditorHtml();
