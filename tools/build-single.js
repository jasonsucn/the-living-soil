/* Build a self-contained HTML file. No dependencies. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '息壤.html');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
if (!html.includes('<link rel="stylesheet" href="styles.css">')) {
  throw new Error('stylesheet link not found');
}
html = html.replace('<link rel="stylesheet" href="styles.css">', function () {
  return '<style>\n' + css + '\n</style>';
});

const scripts = ['background.js', 'audio.js', 'glyph.js', 'life.js', 'app.js'];
for (const name of scripts) {
  const needle = '<script src="js/' + name + '"></script>';
  if (!html.includes(needle)) throw new Error('script tag not found: ' + name);
  const js = fs.readFileSync(path.join(root, 'js', name), 'utf8')
    .replace(/<\/script/gi, '<\\/script');
  html = html.replace(needle, function () {
    return '<script>\n' + js + '\n</script>';
  });
}

if (/<script src=|<link rel="stylesheet"/.test(html)) {
  throw new Error('an external asset reference remains');
}
fs.writeFileSync(out, html, 'utf8');
const bytes = Buffer.byteLength(html, 'utf8');
console.log('wrote', out);
console.log('bytes', bytes, '(' + (bytes / 1024).toFixed(1) + ' KiB)');
