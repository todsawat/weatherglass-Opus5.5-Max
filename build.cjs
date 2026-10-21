// Build: assembles src/ into the single self-contained page index.html (run: node build.cjs).
// Every source file becomes its own <script>, so a failure in one part cannot stop the others.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = __dirname, src = path.join(root, 'src');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
let three = fs.readFileSync(path.join(root, 'lib/three.min.js'), 'utf8');
three = three.replace(/^console\.warn\('Scripts "build\/three\.js"[^']*'\),/, '0,');   // drop the r160 UMD deprecation notice
let shell = fs.readFileSync(path.join(src, '00-shell.html'), 'utf8');
const css = fs.readdirSync(src).filter((f) => f.endsWith('.css')).sort().map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
if (css) shell = shell.replace('</style>', css + '\n</style>');
const js = fs.readdirSync(src).filter((f) => f.endsWith('.js')).sort();
for (const f of js) { try { execFileSync(process.execPath, ['--check', path.join(src, f)], { stdio: 'pipe' }); } catch (e) { console.error('SYNTAX ERROR in', f, '\n' + String(e.stderr).split('\n').slice(0, 5).join('\n')); process.exitCode = 1; } }
let body = shell + '\n<script>' + esc(three) + '</script>\n';
for (const f of js) body += `<script>/* ${f} */\n` + esc(fs.readFileSync(path.join(src, f), 'utf8')) + '\n</script>\n';
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="theme-color" content="#0d0c0b">',
  '<meta name="generator" content="Claude Opus 5.5 — Max effort">',
  '<meta name="description" content="Weatherglass: a living miniature landscape sealed in a brass-and-glass case. Grab, squeeze and shake clouds, blow wind, pour fog, wipe the glass, drag the sun and turn the seasons. Claude Opus 5.5 (Max effort) build.">',
].join('\n');
const full = `<!DOCTYPE html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${body}</body>\n</html>\n`;
fs.writeFileSync(path.join(root, 'index.html'), full);
console.log('built index.html', (full.length / 1024).toFixed(0) + ' KB from', js.length, 'scripts');
