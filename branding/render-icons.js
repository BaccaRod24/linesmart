// Renders every raster brand asset (favicons, favicon.ico, apple-touch, PWA 192/512/maskable, og image)
// from site/assets/brand/icon.svg + logo.svg, in the current default theme (Midnight Blue).
// Usage: node branding/render-icons.js   (needs playwright; favicon.ico packed with Pillow via python3)
const { chromium } = require('../node_modules/playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const B = path.join(__dirname, '../site/assets/brand');
const BG = '#050b1c', MUTE = '#a3b3d9', ACC = '#3d9bff'; // Midnight Blue --bg / --mute / --accent
const icon = fs.readFileSync(path.join(B, 'icon.svg'), 'utf8');
const logo = fs.readFileSync(path.join(B, 'logo.svg'), 'utf8');
const uri = s => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
(async () => {
  const b = await chromium.launch();
  const shot = async (w, h, html, file, omitBg) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
    await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(B, file), omitBackground: omitBg });
    await p.close();
  };
  const plain = s => `<img src="${uri(icon)}" width="${s}" height="${s}" style="display:block">`;
  const onBg = (s, inner) => `<div style="width:${s}px;height:${s}px;background:${BG};display:flex;align-items:center;justify-content:center"><img src="${uri(icon)}" width="${inner}" height="${inner}"></div>`;
  for (const s of [16, 32, 48]) await shot(s, s, plain(s), `favicon-${s}.png`, true);
  for (const s of [192, 512]) await shot(s, s, plain(s), `icon-${s}.png`, true);
  await shot(512, 512, onBg(512, 340), 'icon-maskable-512.png', false);   // icon inside the 80% safe zone
  await shot(180, 180, onBg(180, 140), 'apple-touch-icon.png', false);
  await shot(1200, 630, `<div style="width:1200px;height:630px;background:${BG};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,sans-serif">
     <img src="${uri(logo)}" style="height:150px"><div style="color:${MUTE};font-size:34px;margin-top:36px;font-weight:500">Odds, lines &amp; team stats — NFL · NBA · College · NHL · MLB · Soccer</div>
     <div style="position:absolute;bottom:0;left:0;right:0;height:8px;background:${ACC}"></div></div>`, 'og-image.png', false);
  await b.close();
  execFileSync('python3', ['-c', `
from PIL import Image
b='${B}'
ims=[Image.open(f'{b}/favicon-{s}.png').convert('RGBA') for s in (48,32,16)]
ims[0].save('${path.join(__dirname, '../site/favicon.ico')}', sizes=[(48,48),(32,32),(16,16)], append_images=ims[1:])
`]);
  fs.rmSync(path.join(B, 'favicon-48.png'));
  console.log('rendered brand assets into', B);
})();
