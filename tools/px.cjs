// Usage: node tools/px.cjs image.png x,y [x,y ...]   -> prints the colour at each pixel (average of a 5x5 patch)
const sharp = require('sharp');
(async () => {
  const [file, ...pts] = process.argv.slice(2);
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  for (const p of pts) {
    const [x, y] = p.split(',').map(Number); let r = 0, g = 0, b = 0, n = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const xx = Math.min(info.width - 1, Math.max(0, x + i)), yy = Math.min(info.height - 1, Math.max(0, y + j)), k = (yy * info.width + xx) * info.channels; r += data[k]; g += data[k + 1]; b += data[k + 2]; n++; }
    const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    console.log(p, '#' + h(r) + h(g) + h(b));
  }
})();
