// Read-only metric for the actual first-turn guidance + tool-definition surface.
import {Context} from '@deepseek-ai/cordis';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const target=path.resolve(process.argv[2]||'src/plugin.mjs');
const plugin=await import(pathToFileURL(target).href);
const ctx=new Context();
try{
  await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{mode:'native'});
  ctx.provide('approval',{config:{policy:'never'},request:async()=>{throw Error('metric must never request permission');}});
  await ctx.plugin(plugin,{runtime:{autoPrepare:false}});
  const assembly=await ctx.systemPrompt.assemble();
  const text=assembly.sections.map(s=>s.text).join('\n')+'\n'+JSON.stringify(assembly.tools);
  console.log(JSON.stringify({source:target,tools:assembly.tools.length,characters:text.length,utf8Bytes:Buffer.byteLength(text),estimatedTokens:Math.ceil(Buffer.byteLength(text)/4),tokenMethod:'UTF-8 bytes/4 estimate; not provider tokenizer'},null,2));
}finally{await ctx.fiber.dispose();}
