import fs from 'node:fs';
const dir='versions/v2.16.1';
const marker="/* Runs inside the original app's script scope, before boot. */";
let base=fs.readFileSync('index.html','utf8');
const start=base.indexOf(marker),end=base.indexOf('\nboot();',start);
if(start<0||end<0)throw Error('Missing integration boundaries');
base=base.slice(0,start)+fs.readFileSync(dir+'/integration.js','utf8').trim()+'\n'+fs.readFileSync(dir+'/prediction-integration.js','utf8').trim()+'\n'+fs.readFileSync(dir+'/mox-integration.js','utf8').trim()+base.slice(end);
base=base.replaceAll('v2.16.0 · Mox 現金回贈與對帳','v2.16.1 · 分類與帳項修正');
base=base.replace(/<script src="\.\/(?:mox-rewards|rewards)[^"\n]*"><\/script>\s*/g,'');
base=base.replace(/<script src="\.\/parser[^"\n]*"><\/script>/,'<script src="./parser.js"></script>\n<script src="./rewards.js"></script>\n<script src="./mox-rewards.js"></script>');
base=base.replaceAll("face:'cardimgs/","face:'../../cardimgs/");
fs.writeFileSync(dir+'/index.html',base);
const root=base.replace('src="./parser.js"','src="./parser-v2.16.1.js"').replace('src="./rewards.js"','src="./rewards-v2.16.1.js"').replace('src="./mox-rewards.js"','src="./mox-rewards-v2.16.1.js"').replaceAll("face:'../../cardimgs/","face:'cardimgs/").replaceAll('href="../v2.16.0/"','href="./versions/v2.16.0/"');
fs.writeFileSync('index.html',root);
fs.copyFileSync(dir+'/rewards.js','rewards-v2.16.1.js');
fs.copyFileSync(dir+'/parser.js','parser-v2.16.1.js');

fs.copyFileSync(dir+'/mox-rewards.js','mox-rewards-v2.16.1.js');
