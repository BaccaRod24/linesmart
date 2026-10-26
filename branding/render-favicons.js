// Renders PNG favicons + og image for the chosen concept (2) into site/assets/brand
const { chromium } = require('../node_modules/playwright');
const fs = require('fs'), path = require('path');
const B = path.join(__dirname, '../site/assets/brand');
const icon = fs.readFileSync(path.join(__dirname, 'concept-2/icon.svg'), 'utf8');
const logo = fs.readFileSync(path.join(__dirname, 'concept-2/logo.svg'), 'utf8');
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
  for (const s of [16, 32, 48])
    await shot(s, s, `<img src="${uri(icon)}" width="${s}" height="${s}" style="display:block">`, `favicon-${s}.png`, true);
  await shot(180, 180, `<div style="width:180px;height:180px;background:#0b0f17;display:flex;align-items:center;justify-content:center"><img src="${uri(icon)}" width="140" height="140"></div>`, 'apple-touch-icon.png', false);
  await shot(1200, 630, `<div style="width:1200px;height:630px;background:#0b0f17;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Inter,sans-serif">
     <img src="${uri(logo)}" style="height:150px"><div style="color:#8b9ab3;font-size:34px;margin-top:36px;font-weight:500">Odds, lines &amp; team stats — NFL · NBA · College · NHL · MLB · Soccer</div>
     <div style="position:absolute;bottom:0;left:0;right:0;height:8px;background:#22d3a6"></div></div>`, 'og-image.png', false);
  await b.close();
})();
