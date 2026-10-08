const NAV=[['dashboard','Dashboard'],['profile','My Profile'],['cards','My Cards'],['designer','Card Designer'],['upload','Upload Design'],['qr','QR / NFC'],['orders','Orders'],['analytics','Analytics'],['settings','Settings']];
const SEC=['about','video','social','contact'],FLD=['name','profession','company','location','email','phone','website','whatsapp','instagram','linkedin','github','youtube','twitter','telegram','video_url'];
let me,V={};
const main=$('#main');
async function boot(){
  try{me=await api('/me')}catch{return location.href='/login.html'}
  $('#nav').innerHTML=`<div class="logo">WUK72 CARDS</div>${NAV.map(n=>`<a href="#${n[0]}" data-r="${n[0]}">${n[1]}</a>`).join('')}${me.role==='ADMIN'?'<a href="/admin.html">Admin</a>':''}<a href="#" id="lo">Log out</a>`;
  $('#lo').addEventListener('click',e=>{e.preventDefault();logout()});
  addEventListener('hashchange',route);route();
}
async function route(){
  const r=location.hash.slice(1)||'dashboard';
  document.querySelectorAll('[data-r]').forEach(a=>a.classList.toggle('on',a.dataset.r===r));
  main.innerHTML='Loading…';
  try{await (V[r]||V.dashboard)()}catch(e){main.innerHTML=`<p class="msg err">${esc(e.message)}</p>`}
}
const note=(t,err)=>{const m=$('#m');if(m){m.className='msg'+(err?' err':'');m.textContent=t}};
const banner=()=>me.verified?'':'<p class="msg err">Verify your email to edit your profile, create cards and place orders.</p>';
V.dashboard=async()=>{
  const [cards,orders]=await Promise.all([api('/cards'),api('/orders')]);
  const scans=cards.reduce((a,c)=>a+c.scans,0),last=orders[0];
  main.innerHTML=`<h2>Hi, ${esc(me.username)}</h2>${banner()}<div class="cards">
  <div class="c">Active cards<b>${cards.filter(c=>c.active).length}</b></div><div class="c">QR / NFC scans<b>${scans}</b></div>
  <div class="c">Latest order<b style="font-size:1.1rem">${last?esc(nice(last.status)):'None yet'}</b></div></div>
  <h3>Quick actions</h3><p><a class="btn p" href="#profile">Edit profile</a> <a class="btn" href="#cards">My cards</a> <a class="btn" href="/p/${esc(me.username)}" target="_blank">View public profile</a></p>`;
};
V.profile=async()=>{
  const p=await api('/profile'),d=JSON.parse(p.data),s=JSON.parse(p.sections),t=JSON.parse(p.theme);
  main.innerHTML=`<h2>My Profile</h2>${banner()}<form id="f"><div class="row">${FLD.map(k=>`<div><label>${k.replace('_',' ')}</label><input name="${k}" value="${esc(d[k])}"></div>`).join('')}</div>
  <label>About / bio</label><textarea name="bio" rows="4">${esc(d.bio)}</textarea>
  <label>Accent colour</label><input type="color" name="accent" value="${esc(t.accent||'#39ff7a')}" style="width:80px;padding:2px">
  <p>${SEC.map(k=>`<label style="margin-right:16px"><input type="checkbox" name="s_${k}" ${s[k]!==false?'checked':''} style="width:auto;margin:0 6px 0 0">${k}</label>`).join('')}</p>
  <button class="btn p">Save</button> <a class="btn" href="/p/${esc(me.username)}" target="_blank">Preview</a><p class="msg" id="m"></p></form>
  <p style="color:var(--mut)">Video URL must be an embed link, e.g. https://www.youtube.com/embed/ID or https://player.vimeo.com/video/ID.</p>`;
  $('#f').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target),data={bio:fd.get('bio')};
    FLD.forEach(k=>data[k]=fd.get(k)||'');const sections={};SEC.forEach(k=>sections[k]=fd.has('s_'+k));
    try{await api('/profile',{method:'PUT',body:{data,sections,theme:{accent:fd.get('accent')}}});note('Saved.')}catch(x){note(x.message,1)}});
};
V.cards=async()=>{
  const [cards,prods]=await Promise.all([api('/cards'),api('/products')]);
  main.innerHTML=`<h2>My Cards</h2>${banner()}<div class="cards">${cards.map(c=>`<div class="c"><span class="tag">${c.active?'Active':'Disabled'}</span><h3>${esc(c.code)}</h3>
  Scans: ${c.scans}<br>Design: ${esc(nice(c.design_status))}<p><a class="btn s" href="#profile">Edit profile</a> <a class="btn s" href="/c/${esc(c.code)}" target="_blank">View</a> <a class="btn s" href="#analytics">Analytics</a></p></div>`).join('')||'<p>No cards yet.</p>'}</div>
  <h3>New card</h3><form id="f" style="max-width:360px"><select name="p">${prods.map(p=>`<option value="${p.id}">${esc(p.name)} (${money(p.price_minor,p.currency)})</option>`).join('')}</select><button class="btn p">Create card + unique QR</button><p class="msg" id="m"></p></form>`;
  $('#f').addEventListener('submit',async e=>{e.preventDefault();try{await api('/cards',{body:{product_id:+new FormData(e.target).get('p')}});V.cards()}catch(x){note(x.message,1)}});
};
V.designer=async()=>{main.innerHTML='<h2>Card Designer</h2><p>The drag-and-drop designer is not built yet. For now, use <a href="#upload">Upload Design</a> to submit your own artwork.</p>'};
V.upload=async()=>{
  const cards=await api('/cards');
  main.innerHTML=`<h2>Upload Your Design</h2><p style="color:var(--mut)">CR80: 85.60 × 53.98 mm (3.375 × 2.125 in). Add 3 mm bleed on every side (91.60 × 59.98 mm, about 1082 × 709 px at 300 dpi). Keep text 3 mm inside the trim. PNG, JPG, SVG or PDF; PDFs print page 1 only.</p>
  <form id="f" style="max-width:420px"><label>Card</label><select name="code">${cards.map(c=>`<option>${esc(c.code)}</option>`).join('')}</select>
  <label>Side</label><select name="side"><option value="front_file">Front</option><option value="back_file">Back</option></select>
  <label>File</label><input type="file" name="file" accept=".png,.jpg,.jpeg,.svg,.pdf" required><button class="btn p">Upload</button><p class="msg" id="m"></p></form>
  <div class="cards">${cards.map(c=>['front_file','back_file'].map(s=>c[s]?`<div class="c">${esc(c.code)} · ${s.split('_')[0]}<br><img class="pv" src="/files/${esc(c[s])}" alt="design preview"></div>`:'').join('')).join('')}</div>`;
  $('#f').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target),file=fd.get('file');
    if(file.size>20e6)return note('Max 20 MB for designs.',1);
    try{const up=new FormData();up.append('kind','design');up.append('file',file);const r=await api('/files',{form:up});
      await api(`/cards/${fd.get('code')}/design`,{method:'PUT',body:{[fd.get('side')]:r.id}});note('Uploaded. Sent for design review.');V.upload()}catch(x){note(x.message,1)}});
};
V.qr=async()=>{
  const cards=await api('/cards'),B=location.origin;
  main.innerHTML=`<h2>QR / NFC</h2><p style="color:var(--mut)">Your QR and NFC chip both use the card link. Your profile can change; this link never does.</p><div class="cards">${cards.map(c=>`<div class="c"><h3>${esc(c.code)}</h3>
  <img src="/api/cards/${esc(c.code)}/qr.png" alt="QR" width="180" style="background:#fff;border-radius:10px"><p>QR link: ${B}/c/${esc(c.code)}?s=qr<br>NFC link: ${B}/c/${esc(c.code)}?s=nfc</p>
  <a class="btn s" href="/api/cards/${esc(c.code)}/qr.png" download="${esc(c.code)}.png">Download QR</a></div>`).join('')||'<p>Create a card first.</p>'}</div>`;
};
V.orders=async()=>{
  const [o,cards]=await Promise.all([api('/orders'),api('/cards')]);
  main.innerHTML=`<h2>Orders</h2>${banner()}<table><tr><th>#</th><th>Qty</th><th>Total</th><th>Status</th></tr>${o.map(x=>`<tr><td>${x.id}</td><td>${x.qty}</td><td>${money(x.amount_minor,x.currency)}</td><td><span class="tag">${esc(nice(x.status))}</span></td></tr>`).join('')||'<tr><td colspan=4>No orders.</td></tr>'}</table>
  <h3>Place order</h3><form id="f" style="max-width:520px"><label>Card</label><select name="card_code">${cards.map(c=>`<option>${esc(c.code)}</option>`).join('')}</select><label>Quantity</label><input name="qty" type="number" min="1" max="100" value="1">
  ${['name','line1','city','state','postal','country','phone'].map(k=>`<label>${k}</label><input name="${k}" required>`).join('')}<button class="btn p">Continue to payment</button><p class="msg" id="m"></p></form>`;
  $('#f').addEventListener('submit',async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.target)),{card_code,qty,...shipping}=fd;
    try{const r=await api('/orders',{body:{card_code,qty:+qty,shipping}});note(`Order #${r.order_id} created (${money(r.amount_minor,r.currency)}). Payment provider is not connected yet.`);}catch(x){note(x.message,1)}});
};
V.analytics=async()=>{
  const a=await api('/analytics');
  main.innerHTML=`<h2>Analytics</h2><p style="color:var(--mut)">Counts only: date, source and device type. No IPs or personal data.</p><table><tr><th>Day</th><th>Card</th><th>Source</th><th>Device</th><th>Scans</th></tr>${a.map(r=>`<tr><td>${esc(r.day)}</td><td>${esc(r.code)}</td><td>${esc(r.source)}</td><td>${esc(r.device)}</td><td>${r.n}</td></tr>`).join('')||'<tr><td colspan=5>No scans yet.</td></tr>'}</table>`;
};
V.settings=async()=>{main.innerHTML=`<h2>Settings</h2><p>Email: ${esc(me.email)}<br>Username: ${esc(me.username)}<br>Verified: ${me.verified?'yes':'no'}</p><p><a class="btn" href="/forgot.html">Change password</a> <button class="btn" id="lo2">Log out</button></p>`;$('#lo2').addEventListener('click',logout)};
boot();
