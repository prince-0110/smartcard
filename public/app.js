document.documentElement.classList.add('js');
const rm=matchMedia('(prefers-reduced-motion:reduce)').matches;
// Matrix rain
const cv=document.getElementById('rain'),cx=cv.getContext('2d');let cols,drops;
function size(){cv.width=innerWidth;cv.height=innerHeight;cols=Math.ceil(cv.width/16);drops=Array.from({length:cols},()=>Math.random()*-50)}size();addEventListener('resize',size);
function rain(){cx.fillStyle='rgba(20,19,21,.12)';cx.fillRect(0,0,cv.width,cv.height);cx.fillStyle='#39ff7a';cx.font='14px monospace';
drops.forEach((d,i)=>{cx.fillText(String.fromCharCode(0x30A0+Math.random()*96),i*16,d*16);drops[i]=d*16>cv.height&&Math.random()>.975?0:d+1})}
if(!rm)setInterval(rain,60);else{cx.fillStyle='#141315';cx.fillRect(0,0,cv.width,cv.height)}
// decorative QR pattern (real QR is generated server-side)
(function(){const q=document.getElementById('qr');let s=72,h=[];const f=(x,y)=>(x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13);
for(let y=0;y<21;y++)for(let x=0;x<21;x++){s=(s*1103515245+12345)&0x7fffffff;let on=f(x,y)?(x%6==0||y%6==0||x==(x>13?14:0)||(x>1&&x<5&&y>1&&y<5)||(x>15&&x<19&&y>1&&y<5)||(x>1&&x<5&&y>15&&y<19)||(x%6==0)):(s>>8)%2;
h.push(`<span class="${on?'':'o'}"></span>`)}q.innerHTML=h.join('')})();
// 3D tilt
const st=document.getElementById('stage'),cd=document.getElementById('card');
st.addEventListener('pointermove',e=>{if(rm)return;const r=st.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
cd.style.animation='none';cd.style.transform=`rotateY(${x*22}deg) rotateX(${-y*22}deg)`;cd.style.setProperty('--sh',(x*160)+'%')});
st.addEventListener('pointerleave',()=>{cd.style.transform='';cd.style.animation=''});
// reveal + step highlight
const io=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('in')),{threshold:.12});
document.querySelectorAll('.rv').forEach(el=>io.observe(el));
const steps=[...document.querySelectorAll('.step')];let si=0;
setInterval(()=>{steps.forEach((s,i)=>s.classList.toggle('on',i===si));si=(si+1)%3},1800);
// spotlight
document.getElementById('fg').addEventListener('pointermove',e=>{const c=e.target.closest('.fc');if(!c)return;const r=c.getBoundingClientRect();c.style.setProperty('--x',e.clientX-r.left+'px');c.style.setProperty('--y',e.clientY-r.top+'px')});
// live demo
const n=document.getElementById('n'),t=document.getElementById('t');
n.oninput=()=>document.getElementById('dn').textContent=n.value||'Your name';
t.oninput=()=>document.getElementById('dt').textContent=t.value||'Your title';
document.getElementById('sw').onclick=e=>{const b=e.target.closest('button');if(!b)return;
document.querySelectorAll('#sw button').forEach(x=>x.classList.remove('on'));b.classList.add('on');document.getElementById('dp').style.setProperty('--ac',b.dataset.c)};
document.getElementById('y').textContent=new Date().getFullYear();
