import fs from 'node:fs';

const marker='/* Runs inside the original app\'s script scope, before boot. */';
const integration=fs.readFileSync('versions/v2.14.2/integration.js','utf8').trim();
let base=fs.readFileSync('index.html','utf8');
const start=base.indexOf(marker);
const end=base.indexOf('\nboot();',start);
if(start<0||end<0)throw new Error('Cannot find v2.14 integration block');
base=base.slice(0,start)+integration+base.slice(end);
base=base.replaceAll('v2.14.1 · 月結周期分欄','v2.14.2 · 月結總額與多維回贈');

let version=base
 .replace('src="./parser-v2.14.js"','src="./parser.js"')
 .replaceAll('face:\'cardimgs/','face:\'../../cardimgs/');
fs.writeFileSync('versions/v2.14.2/index.html',version);

let root=version
 .replace('src="./parser.js"','src="./parser-v2.14.2.js"')
 .replaceAll('face:\'../../cardimgs/','face:\'cardimgs/')
 .replace('href="../v2.14.1/">開啟 v2.14.1','href="./versions/v2.14.1/">開啟 v2.14.1');
fs.writeFileSync('index.html',root);
