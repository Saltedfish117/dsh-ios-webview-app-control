// Test-only resolver: use the immutable SDK actually bundled in the running Electron installation.
import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const sdkRoot=process.env.DSH_DESKTOP_SDK_ROOT;
if(!sdkRoot||!path.isAbsolute(sdkRoot))throw new Error('Set DSH_DESKTOP_SDK_ROOT to the confirmed actual Desktop app.asar/dsh directory.');
const pkgFile=path.join(sdkRoot,'node_modules','@deepseek-ai','dsh-desktop-host','package.json');
if(!fs.existsSync(pkgFile))throw new Error('Desktop SDK root not found.');
const desktopAnchor=pathToFileURL(path.join(sdkRoot,'package.json')).href;
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier.startsWith('@deepseek-ai/'))return nextResolve(specifier,{...context,parentURL:desktopAnchor});
  return nextResolve(specifier,context);
}});
