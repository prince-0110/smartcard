const TABS=['Users','Cards','Orders','Products','Designs','Analytics'],ST=['pending','payment_confirmed','design_review','printing','dispatched','delivered','cancelled'];
const main=$('#main');let T={};
async function boot(){
  let me;try{me=await api('/me')}catch{return location.href='/login.html'}
  if(me.role!=='ADMIN')return main.textContent='Forbidden';
  $('#nav').innerHTML=`<div class="logo">ADMIN</div>${TABS.map(t=>`<a href="#${t}" data-r="${t}">${t}</a>`).join('')}<a href="/app.html">My dashboard</a><a href="#" id="lo">Log out</a>`;
  $('#lo').addEventListener('click',e=>{e.preventDefault();logout()});
  addEventListener('hashchange',route);route();
}
async function route(){const t=location.hash.slice(1)||'Users';document.querySelectorAll('[data-r]').forEach(a=>a.classList.toggle('on',a.dataset.r===t));
  try{await (T[t]||T.Users)()}catch(e){main.innerHTML=`<p class="msg err">${esc(e.message)}</p>`}}
// one delegated handler for all action buttons: data-act="url|json-body"
main.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;
  try{await api(b.dataset.act,{body:JSON.parse(b.dataset.body)});route()}catch(x){alert(x.message)}});
main.addEventListener('change',async e=>{const s=e.target.closest('select[data-st]');if(!s)return;
  try{await api(`/admin/orders/${s.dataset.st}/status`,{body:{status:s.value}})}catch(x){alert(x.message)}});
const act=(u,b,l)=>`<button class="btn s" data-act="${esc(u)}" data-body='${esc(JSON.stringify(b))}'>${l}</button>`;
T.Users=async()=>{
  const q=new URLSearchParams(location.search).get('q')||'',u=await api('/admin/users?q='+encodeURIComponent(q));
  main.innerHTML=`<h2>Users</h2><form><input name="q" placeholder="Search email or username" value="${esc(q)}"></form><table><tr><th>ID</th><th>Email</th><th>User</th><th>Role</th><th>Status</th><th></th></tr>${u.map(x=>`<tr><td>${x.id}</td><td>${esc(x.email)}</td><td>${esc(x.username)}</td><td>${x.role}</td><td>${x.suspended?'Suspended':x.verified?'Verified':'Unverified'}</td><td>${x.role==='ADMIN'?'':act(`/admin/users/${x.id}/suspend`,{suspended:!x.suspended},x.suspended?'Restore':'Suspend')}</td></tr>`).join('')}</table>`;
};
T.Cards=async()=>{const c=await api('/admin/cards');
  main.innerHTML=`<h2>Cards</h2><table><tr><th>ID</th><th>Code</th><th>User</th><th>Design</th><th></th></tr>${c.map(x=>`<tr><td>${x.id}</td><td>${esc(x.code)}</td><td>${x.user_id}</td><td>${esc(nice(x.design_status))}</td><td>${act(`/admin/cards/${x.id}/active`,{active:!x.active},x.active?'Disable':'Enable')}</td></tr>`).join('')}</table>`};
T.Orders=async()=>{const o=await api('/admin/orders');
  main.innerHTML=`<h2>Orders</h2><table><tr><th>#</th><th>User</th><th>Qty</th><th>Total</th><th>Ship to</th><th>Status</th></tr>${o.map(x=>{const s=JSON.parse(x.shipping||'{}');return`<tr><td>${x.id}</td><td>${x.user_id}</td><td>${x.qty}</td><td>${money(x.amount_minor,x.currency)}</td><td>${esc(s.name)}, ${esc(s.city)}</td><td><select data-st="${x.id}">${ST.map(t=>`<option ${t===x.status?'selected':''}>${t}</option>`).join('')}</select></td></tr>`}).join('')}</table>`};
T.Products=async()=>{const p=await api('/products');
  main.innerHTML=`<h2>Products</h2><table><tr><th>Name</th><th>Price (minor units)</th><th></th></tr>${p.map(x=>`<tr><td>${esc(x.name)}</td><td><input type="number" value="${x.price_minor}" data-p="${x.id}" style="margin:0;width:140px"></td><td><button class="btn s" data-save="${x.id}">Save</button></td></tr>`).join('')}</table><p style="color:var(--mut)">Prices are in paise (29900 = ₹299).</p>`;
  main.querySelectorAll('[data-save]').forEach(b=>b.addEventListener('click',async()=>{const x=p.find(i=>i.id==b.dataset.save),v=+$(`[data-p="${x.id}"]`).value;
    try{await api('/admin/products/'+x.id,{method:'PUT',body:{name:x.name,description:x.description||'',price_minor:v,active:!!x.active}});b.textContent='Saved'}catch(e){alert(e.message)}}));
};
T.Designs=async()=>{const c=(await api('/admin/cards')).filter(x=>x.front_file||x.back_file);
  main.innerHTML=`<h2>Design review</h2><table><tr><th>Card</th><th>Files</th><th>Status</th><th></th></tr>${c.map(x=>`<tr><td>${esc(x.code)}</td><td>${[x.front_file&&`<a href="/files/${esc(x.front_file)}" target="_blank">Front</a>`,x.back_file&&`<a href="/files/${esc(x.back_file)}" target="_blank">Back</a>`].filter(Boolean).join(' · ')}</td><td>${esc(nice(x.design_status))}</td><td>${act(`/admin/cards/${x.id}/design`,{status:'approved'},'Approve')} ${act(`/admin/cards/${x.id}/design`,{status:'rejected'},'Reject')}</td></tr>`).join('')||'<tr><td colspan=4>Nothing to review.</td></tr>'}</table>`};
T.Analytics=async()=>{const s=await api('/admin/scans');
  main.innerHTML=`<h2>Scans per card</h2><table><tr><th>Card ID</th><th>Scans</th></tr>${s.map(x=>`<tr><td>${x.card_id}</td><td>${x.n}</td></tr>`).join('')||'<tr><td colspan=2>No scans yet.</td></tr>'}</table>`};
boot();
