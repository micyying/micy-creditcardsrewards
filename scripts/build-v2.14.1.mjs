import fs from 'node:fs';

const marker='/* Runs inside the original app\'s script scope, before boot. */';
const integration=fs.readFileSync('versions/v2.14.1/integration.js','utf8').trim();
let base=fs.readFileSync('index.html','utf8');
const start=base.indexOf(marker);
const end=base.indexOf('\nboot();',start);
if(start<0||end<0)throw new Error('Cannot find v2.14 integration block');
base=base.slice(0,start)+integration+base.slice(end);
base=base.replaceAll('v2.14.0 · 結單解析與來源核對','v2.14.1 · 月結周期分欄');

let version=base
 .replace('src="./parser-v2.14.js"','src="./parser.js"')
 .replaceAll('face:\'cardimgs/','face:\'../../cardimgs/');
fs.writeFileSync('versions/v2.14.1/index.html',version);

let root=version
 .replace('src="./parser.js"','src="./parser-v2.14.1.js"')
 .replaceAll('face:\'../../cardimgs/','face:\'cardimgs/')
 .replace('href="../v2.14.0/">開啟 v2.14.0','href="./versions/v2.14.0/">開啟 v2.14.0');
fs.writeFileSync('index.html',root);
