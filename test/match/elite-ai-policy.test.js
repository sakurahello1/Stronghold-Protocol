import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url);
const sha=text=>createHash('sha256').update(text).digest('hex');
for(const id of ['arturia','lavinia'])test(`${id}: installed decision policy is the released bundle, with only host check comments`,()=>{
  const addon=new URL(`addons/${id}/`,root);
  const meta=JSON.parse(readFileSync(new URL('addon.json',addon),'utf8'));
  for(const [path,expected] of Object.entries(meta.files)){
    if(!path.startsWith('policy/')) continue;
    const original=readFileSync(new URL(path,addon),'utf8').replaceAll('\r\n','\n');
    assert.equal(sha(original),expected,path);
    const runtime=readFileSync(new URL(`server/match/${id}/${path}`,root),'utf8').replaceAll('\r\n','\n')
      .replace(/^[ \t]*\/\/ host-compat loop-cap:[^\n]*\n/gm,'')
      .replace(/ \/\/ i18n-ignore: host-compat internal strategy\/data labels; never UI text/g,'')
      .replace("import { mitigate } from '../../../../../sim/attack.js'; // host-compat: public settlement API renamed in 0.3.2", "import { mitigate } from '../../../../../sim/damage.js';");
    assert.equal(runtime,original,path);
  }
});
