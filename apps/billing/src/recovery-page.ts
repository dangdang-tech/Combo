export function recoveryCheckoutHtml(id: string, nonce: string, testMode: boolean): string {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9+/=_-]{16,128}$/.test(nonce))
    throw Error('invalid page identity');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>支付 · Combo</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#1c1917;font-family:system-ui;padding:32px 16px}main{max-width:440px;margin:auto;background:white;padding:28px;border-radius:12px}h1{font-size:22px}p{line-height:1.65}#amount{font-size:36px;font-weight:650}.test{color:#9a3412;background:#fff7ed;padding:10px}button,a{display:block;padding:13px;margin:12px 0;border:0;border-radius:7px;width:100%;font:inherit;background:#1c1917;color:white;text-align:center}button:disabled{opacity:.5}fieldset{border:0;padding:0}label{display:inline-block;padding:8px}img{width:280px;max-width:100%;display:block;margin:16px auto}[hidden]{display:none!important}#error{color:#b91c1c}.muted{color:#57534e;font-size:14px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid #2563eb;outline-offset:3px}</style></head><body><main>
<h1>Combo 收银台</h1>${testMode ? '<p class="test">测试支付环境，请勿用于正式业务。</p>' : ''}<p class="muted">为本次使用补充余额</p><p id="amount">正在查询…</p><p id="status" role="status">正在核对支付状态</p><p id="hint"></p>
<fieldset id="choice" hidden><label><input type="radio" name="method" value="wechat" checked>微信</label><label><input type="radio" name="method" value="alipay">支付宝</label><button id="generate">生成付款码</button></fieldset>
<img id="qr" alt="本次付款二维码" hidden><button id="recover" hidden>重新获取付款码</button><button id="refresh">刷新支付状态</button><p id="error" role="alert" hidden></p><a id="login" href="/authz/login?next=${encodeURIComponent(`/payments/${id}?version=2`)}" hidden>登录后继续</a><details id="support" hidden><summary>人工核对信息</summary><p class="muted">将以下支付编号提供给接入方支持人员。</p><code>${id}</code></details><p class="muted">到账后请回到原对话继续。恢复付款不会重新提交你的问题。</p>
</main><script nonce="${nonce}">(()=>{
 const id=${JSON.stringify(id)},base='/v2/payment-checkouts/'+id,el=x=>document.getElementById(x);
 const storage='combo-recovery:'+id;let payment,active=false,timer,stopped=false,pendingKey;
 let deadline=Date.now()+15*60*1000;
 function clear(){el('qr').hidden=true;el('qr').removeAttribute('src');}
 function show(p,image){payment=p;clear();el('choice').hidden=true;el('recover').hidden=true;el('login').hidden=true;el('support').hidden=true;
  const cents=BigInt(p.amount.amountCents);el('amount').textContent='¥ '+(cents/100n)+'.'+String(cents%100n).padStart(2,'0');
  if(p.status==='completed'){el('status').textContent='已确认入账';el('hint').textContent='可以回到原对话继续，无需再次付款。';return;}
  if(p.status==='closed'){el('support').hidden=false;el('status').textContent='本次支付的恢复时间已结束';el('hint').textContent='请联系支持核对原订单。';return;}
  const s=p.checkout.status;el('support').hidden=s!=='manual_review';
  const messages={not_started:['等待付款','选择付款方式后生成付款码。'],submitting:['正在生成付款码','请稍候，重复打开不会再次下单。'],ready:['请扫码付款','付款后会自动核对入账。'],missing_qr:['暂无可用付款码','可以重新获取；平台会先安全关闭原订单。'],unknown:['正在核对原订单','结果尚未确认，请勿重复付款。'],closing:['正在恢复付款','正在核对并关闭旧订单，请稍候。'],closed:['原付款入口已结束','可以重新获取付款码继续原任务。'],paid:['正在确认入账','渠道已反馈成功，等待平台完成入账。'],manual_review:['需要人工核对','暂时无法安全重新下单，请联系支持核对原订单。']};
  const m=messages[s];if(!m)throw Error();el('status').textContent=m[0];el('hint').textContent=m[1];el('choice').hidden=s!=='not_started';el('recover').hidden=!p.checkout.canRecover;
  if(s==='ready'&&typeof image==='string'&&image.startsWith('data:image/png;base64,')&&Date.parse(p.checkout.expiresAt)>Date.now()){el('qr').src=image;el('qr').hidden=false;}
  if(pendingKey&&pendingKey.expectedAttemptId!==p.checkout.attemptId){sessionStorage.removeItem(storage);pendingKey=undefined;}
 }
 async function request(method='GET',url=base,body){if(active||stopped)return;active=true;clearTimeout(timer);el('error').hidden=true;for(const k of ['generate','recover','refresh'])el(k).disabled=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try{const r=await fetch(url,{method,credentials:'same-origin',redirect:'error',cache:'no-store',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
   if([401,403,404].includes(r.status)){clear();el('amount').textContent='未显示';el('status').textContent='暂时无法查看此支付';el('choice').hidden=true;el('recover').hidden=true;el('login').hidden=r.status!==401;deadline=0;return;}
   if(!r.ok)throw Error();const data=(await r.json()).data;show(data.payment||data,data.qrImage);
  }catch{clear();el('error').textContent='结果暂时无法确认，请刷新查询原支付。';el('error').hidden=false;}
  finally{clearTimeout(timeout);active=false;for(const k of ['generate','recover','refresh'])el(k).disabled=false;if(!stopped&&Date.now()<deadline&&payment?.status!=='completed'&&payment?.status!=='closed')timer=setTimeout(()=>request(),method==='POST'?0:3000);}
 }
 el('generate').onclick=()=>request('POST',base,{payType:document.querySelector('input[name="method"]:checked').value});
 el('recover').onclick=()=>{if(!payment?.checkout.canRecover)return;try{pendingKey=JSON.parse(sessionStorage.getItem(storage)||'null');if(!pendingKey||pendingKey.expectedAttemptId!==payment.checkout.attemptId){pendingKey={recoveryKey:crypto.randomUUID(),expectedAttemptId:payment.checkout.attemptId};sessionStorage.setItem(storage,JSON.stringify(pendingKey));}request('POST','/v2/payments/'+id+'/recover',pendingKey);}catch{el('error').textContent='无法保存恢复编号，请允许当前页面使用会话存储。';el('error').hidden=false;}};
 el('refresh').onclick=()=>{deadline=Date.now()+15*60*1000;request();};window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});request();
})();</script></body></html>`;
}
