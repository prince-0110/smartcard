const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(p,o={}){
  const h={'X-Requested-With':'fetch'};let body;
  if(o.form)body=o.form;else if(o.body){h['Content-Type']='application/json';body=JSON.stringify(o.body)}
  const r=await fetch('/api'+p,{method:o.method||(body?'POST':'GET'),headers:h,body});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(j.error||'Request failed'),{status:r.status,details:j.details});
  return j;
}
const money=(m,c)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:c||'INR'}).format(m/100);
const nice=s=>String(s).replace(/_/g,' ');
async function logout(){await api('/auth/logout',{method:'POST',body:{}});location.href='/login.html'}
