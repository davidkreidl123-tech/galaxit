// Erzeugt assets/icon.png + assets/icon.ico aus den SVGs.  node scripts/build-icon.js
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const A = path.join(__dirname, '..', 'assets');

(async () => {
  const bg = await sharp(path.join(A, 'icon-bg.svg'), { density: 300 }).resize(1024, 1024).png().toBuffer();
  const logo = await sharp(path.join(A, 'logo.svg'), { density: 300 }).resize(900, 900).png().toBuffer();
  const icon = await sharp(bg).composite([{ input: logo, top: 62, left: 62 }]).png().toBuffer();
  await sharp(icon).resize(512, 512).toFile(path.join(A, 'icon.png'));
  await sharp(logo).resize(512, 512).toFile(path.join(A, 'logo.png'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => sharp(icon).resize(s, s).png().toBuffer()));
  fs.writeFileSync(path.join(A, 'icon.ico'), await pngToIco(pngs));
  console.log('icon.png, logo.png, icon.ico erstellt');
})();
