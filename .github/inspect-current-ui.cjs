const fs = require('fs');
const path = require('path');

const roots = ['src', 'backend', 'public', 'index.html', 'package.json'];
const patterns = [
  /贞贞/g,
  /平价AI小屋/g,
  /AI工坊/g,
  /zhenzhen/gi,
  /t8star/gi,
  /seedance\.nz/gi,
  /MODEL NOTES/g,
  /模型注意事项/g,
  /t8-control-rail/g,
  /PlacementShelf/g,
  /placementShelf/g,
  /CreatorAgentPanel/g,
  /TerminalPanel/g,
];
const binaryExt = new Set(['.png','.jpg','.jpeg','.gif','.webp','.ico','.woff','.woff2','.ttf','.otf','.mp3','.mp4','.zip','.glb','.wasm']);

function walk(target, out = []) {
  if (!fs.existsSync(target)) return out;
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  for (const name of fs.readdirSync(target)) {
    if (['node_modules', 'dist', 'dist_electron', '.git'].includes(name)) continue;
    walk(path.join(target, name), out);
  }
  return out;
}

const files = roots.flatMap((item) => walk(item));
for (const file of files) {
  if (binaryExt.has(path.extname(file).toLowerCase())) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (patterns.some((pattern) => { pattern.lastIndex = 0; return pattern.test(line); })) {
      console.log(`${file}:${index + 1}:${line.trim().slice(0, 500)}`);
    }
  });
}
