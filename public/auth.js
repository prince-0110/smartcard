const M=document.body.dataset.mode,q=new URLSearchParams(location.search);
const F={
login:['Welcome back',[['email','Email','email'],['password','Password','password']],'Log in','<a href="/forgot.html">Forgot password?</a> · <a href="/signup.html">Create account</a>'],
signup:['Create your card',[['email','Email','email'],['username','Username (a-z, 0-9, _)','text'],['password','Password (10+ chars)','password']],'Sign up','<a href="/login.html">Already have an account?</a>'],
forgot:['Reset password',[['email','Email','email']],'Send reset link','<a href="/login.html">Back to login</a>'],
reset:['Choose a new password',[['password','New password (10+ chars)','password']],'Update password','']};
const [title,fields,btn,alt]=F[M];
$('#app').innerHTML=`<form class="box"><h1>${title}</h1>${fields.map(f=>`<label>${f[1]}</label><input name="${f[0]}" type="${f[2]}" required autocomplete="${f[0]==='password'?(M==='login'?'current-password':'new-password'):f[0]}">`).join('')}
<button class="btn p" style="width:100%">${btn}</button><p class="msg" id="m" role="status"></p><p class="alt">${alt}</p></form>`;
if(q.get('verified'))$('#m').textContent=q.get('verified')==='1'?'Email verified. You can log in.':'Verification link invalid or expired.';
$('form').addEventListener('submit',async e=>{
  e.preventDefault();const m=$('#m');m.className='msg';m.textContent='Working…';
  const b=Object.fromEntries(new FormData(e.target));if(M==='reset')b.token=q.get('token')||'';
  try{
    const r=await api('/auth/'+M,{body:b});
    if(M==='login')return location.href=r.role==='ADMIN'?'/admin.html':'/app.html';
    m.textContent={signup:'Account created. Check your email to verify (link prints in the server console in dev).',forgot:'If that email exists, a reset link has been sent.',reset:'Password updated. Redirecting…'}[M];
    if(M==='reset')setTimeout(()=>location.href='/login.html',1200);
  }catch(x){m.className='msg err';m.textContent=x.message}
});
