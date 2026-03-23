const fs = require('fs');
const code = fs.readFileSync('main.js', 'utf8');
const lines = code.split('\n');

// Find where depth first goes to 0 after line 4033 (0-indexed 4032)
const len = code.length;
let depth = 0;
let pos = 0;
let lineNum = 1;

function getLine() {
  return lineNum;
}

function advance() {
  if (code[pos] === '\n') lineNum++;
  pos++;
}

while (pos < len) {
  const ch = code[pos];
  
  // Line comment
  if (ch === '/' && code[pos+1] === '/') {
    while (pos < len && code[pos] !== '\n') pos++;
    lineNum++;
    pos++;
    continue;
  }
  
  // Block comment
  if (ch === '/' && code[pos+1] === '*') {
    pos += 2;
    while (pos < len && !(code[pos] === '*' && code[pos+1] === '/')) {
      if (code[pos] === '\n') lineNum++;
      pos++;
    }
    pos += 2;
    continue;
  }
  
  // Single or double quoted string
  if (ch === "'" || ch === '"') {
    const q = ch;
    pos++;
    while (pos < len && code[pos] !== q) {
      if (code[pos] === '\\') pos++;
      if (code[pos] === '\n') lineNum++;
      pos++;
    }
    pos++;
    continue;
  }
  
  // Template literal
  if (ch === '`') {
    pos++;
    skipTL();
    continue;
  }
  
  if (ch === '{') {
    depth++;
    if (lineNum >= 4033 && lineNum <= 4035) {
      console.log(`Open { at line ${lineNum}, depth now ${depth}`);
    }
  } else if (ch === '}') {
    depth--;
    if (lineNum >= 4033 && depth === 0) {
      console.log(`Depth returns to 0 at line ${lineNum}: "${lines[lineNum-1].trim().substring(0,60)}"`);
      if (lineNum < 4479) {
        console.log('  -> Function closed EARLY!');
        // Show surrounding context
        for (let l = Math.max(0, lineNum-3); l <= Math.min(lines.length-1, lineNum+2); l++) {
          console.log(`  ${l+1}: ${lines[l].substring(0,80)}`);
        }
      }
      break;
    }
  }
  
  if (code[pos] === '\n') lineNum++;
  pos++;
}

function skipTL() {
  while (pos < len && code[pos] !== '`') {
    if (code[pos] === '\\') {
      if (code[pos+1] === '\n') lineNum++;
      pos += 2;
      continue;
    }
    if (code[pos] === '$' && code[pos+1] === '{') {
      pos += 2;
      let exprD = 1;
      while (pos < len && exprD > 0) {
        const c = code[pos];
        if (c === '{') exprD++;
        else if (c === '}') {
          exprD--;
          if (exprD === 0) break;
        }
        else if (c === '`') {
          pos++;
          skipTL();
          continue;
        }
        else if (c === "'" || c === '"') {
          const q = c;
          pos++;
          while (pos < len && code[pos] !== q) {
            if (code[pos] === '\\') pos++;
            if (code[pos] === '\n') lineNum++;
            pos++;
          }
          pos++;
          continue;
        }
        else if (c === '/' && code[pos+1] === '/') {
          while (pos < len && code[pos] !== '\n') pos++;
          lineNum++;
          pos++;
          continue;
        }
        else if (c === '/' && code[pos+1] === '*') {
          pos += 2;
          while (pos < len && !(code[pos] === '*' && code[pos+1] === '/')) {
            if (code[pos] === '\n') lineNum++;
            pos++;
          }
          pos += 2;
          continue;
        }
        if (code[pos] === '\n') lineNum++;
        pos++;
      }
      pos++; // skip closing }
      continue;
    }
    if (code[pos] === '\n') lineNum++;
    pos++;
  }
  if (pos < len) pos++; // skip closing `
}
