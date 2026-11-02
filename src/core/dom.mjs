// This function is serialized into the selected WebView. No application/framework knowledge.
export function domAction(args,env=globalThis){
  const selector=args.selector;
  const nodes=selector?env.document.querySelectorAll(selector):[env.document.scrollingElement];
  if(nodes.length!==1||!nodes[0])throw new Error('selector must match exactly one element');
  const e=nodes[0];
  if(args.action==='scroll'){
    if(!Number.isFinite(args.y)||args.y<0)throw new Error('y must be nonnegative');
    const before=e.scrollTop;e.scrollTop=args.y;
    return {kind:'programmatic-scroll',before,actual:e.scrollTop,eventDispatched:true,effectVerified:false,nativeGestureVerified:false};
  }
  for(let a=e;a;a=a.parentElement){const s=env.getComputedStyle(a);if(a.hidden||a.inert||a.disabled||a.getAttribute?.('aria-disabled')==='true'||s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||Number(s.opacity)===0||s.pointerEvents==='none')throw new Error('element/ancestor is hidden, inert or disabled');}
  const r=e.getBoundingClientRect(),l=Math.max(0,r.left),t=Math.max(0,r.top),rr=Math.min(env.innerWidth,r.right),b=Math.min(env.innerHeight,r.bottom);
  if(r.width<=0||r.height<=0||rr<=l||b<=t)throw new Error('element is outside the WebView viewport');
  const hit=env.document.elementFromPoint((l+rr)/2,(t+b)/2);if(!hit||(hit!==e&&!e.contains(hit)))throw new Error('element is covered by a DOM overlay');
  if(args.action==='click')e.click();
  else if(args.action==='input'){
    const tag=e.tagName?.toLowerCase(),type=String(e.type||'text').toLowerCase();
    if(!['input','textarea'].includes(tag)||['password','file','hidden','submit','button','checkbox','radio'].includes(type))throw new Error('unsupported or sensitive input type');
    if(e.readOnly)throw new Error('input is read-only');
    const proto=tag==='input'?env.HTMLInputElement.prototype:env.HTMLTextAreaElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(!setter)throw new Error('standard input value setter unavailable');
    setter.call(e,args.value);e.dispatchEvent(new env.Event('input',{bubbles:true}));e.dispatchEvent(new env.Event('change',{bubbles:true}));
  }else throw new Error('unsupported DOM action');
  return {kind:'dom-'+args.action,eventDispatched:true,effectVerified:false,nativeTouchVerified:false};
}
