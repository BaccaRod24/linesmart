const { chromium } = require('/workspace/sports-betting-site/node_modules/playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1600,height:1000}});
await p.goto('file://'+__dirname+'/compare.html');await p.waitForTimeout(500);
await p.screenshot({path:__dirname+'/logo-options.png'});


await b.close();})();
