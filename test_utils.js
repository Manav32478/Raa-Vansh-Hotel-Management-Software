'use strict';
const fs = require('fs');

// The checked-in app is a single-file build. Tests should execute its final inline
// application script instead of relying on the missing src/app.js build input.
function appScript(){
  const html = fs.readFileSync('index.html', 'utf8');
  const scripts = Array.from(html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi));
  if(!scripts.length) throw new Error('No inline application script found in index.html');
  return scripts[scripts.length - 1][1];
}

module.exports = { appScript };
