// node tools/icon.svg.js → renders icons/*.png with Playwright (art inside the 80% safe zone for maskable)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const svg = (pad, rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1f3a"/><stop offset="1" stop-color="#1f7ac9"/></linearGradient>
<pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><g fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="2"><rect x="18" y="18" width="28" height="28"/><rect x="18" y="18" width="28" height="28" transform="rotate(45 32 32)"/></g></pattern></defs>
<rect width="512" height="512" rx="${rx}" fill="url(#g)"/><rect width="512" height="512" rx="${rx}" fill="url(#p)"/>
<g transform="translate(256 262) scale(${(512-2*pad)/512}) translate(-256 -262)" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
<path d="M126 330v-74a130 130 0 0 1 260 0v74"/>
<path d="M386 344a26 26 0 0 1-26 26h-14v-92h40zM126 344a26 26 0 0 0 26 26h14v-92h-40z" fill="#fff"/>
<path d="M232 214v84l66-42z" fill="#fff" stroke-width="16"/></g></svg>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const out = path.join(__dirname, '..', 'icons');
  for (const [f, size, pad, rx] of [['icon-192.png', 192, 60, 110], ['icon-512.png', 512, 60, 110], ['icon-maskable-512.png', 512, 120, 0], ['apple-touch-icon.png', 180, 70, 0]]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(pad, rx).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
    await p.screenshot({ path: path.join(out, f), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await b.close(); console.log('icons ok');
})();
