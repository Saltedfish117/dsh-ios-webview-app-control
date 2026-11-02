import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {verifyArchive} from './package-validation.mjs';

const args=process.argv.slice(2);
const checkOnly=args.includes('--check-only');
const positional=args.filter(arg=>arg!=='--check-only');
if(positional.length>1||positional.some(arg=>arg.startsWith('--')))throw new Error('Usage: node scripts/verify-package.mjs [--check-only] [archive.tgz]');
const verified=await verifyArchive(positional[0]);
if(!checkOnly){
  await writeFile(verified.archive+'.sha256',verified.summary.sha256+'  '+path.basename(verified.archive)+'\n');
}
console.log(JSON.stringify({...verified.summary,checkOnly},null,2));
