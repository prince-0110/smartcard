const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');

const E = process.env;
const PROD = E.NODE_ENV === 'production';
const BASE = E.BASE_URL || 'http://localhost:3000';
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });

// ---------- DB ----------
const db = new Database(path.join(__dirname, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'USER', verified INT DEFAULT 0, suspended INT DEFAULT 0, created INT);
CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, user_id INT NOT NULL, kind TEXT NOT NULL, expires INT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id INT NOT NULL, expires INT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(user_id INT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', sections TEXT NOT NULL DEFAULT '{}',
  theme TEXT NOT NULL DEFAULT '{}', updated INT);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, user_id INT NOT NULL, name TEXT, mime TEXT, size INT, is_public INT DEFAULT 0, kind TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, description TEXT, price_minor INT,
  currency TEXT DEFAULT 'INR', material TEXT, thickness_mm REAL, finishes TEXT, double_sided INT DEFAULT 1, nfc INT DEFAULT 0, active INT DEFAULT 1);
CREATE TABLE IF NOT EXISTS cards(id INTEGER PRIMARY KEY, user_id INT NOT NULL, code TEXT UNIQUE NOT NULL, product_id INT,
  design TEXT, front_file TEXT, back_file TEXT, design_status TEXT DEFAULT 'draft', active INT DEFAULT 1, nfc INT DEFAULT 0, created INT);
CREATE TABLE IF NOT EXISTS scans(id INTEGER PRIMARY KEY, card_id INT NOT NULL, ts INT, source TEXT, device TEXT);
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, user_id INT NOT NULL, card_id INT NOT NULL, product_id INT NOT NULL,
  qty INT DEFAULT 1, amount_minor INT, currency TEXT, status TEXT DEFAULT 'pending', shipping TEXT, provider_ref TEXT, created INT);
`);
if (!db.prepare('SELECT 1 FROM products').get()) {
  const ins = db.prepare('INSERT INTO products(slug,name,description,price_minor,material,thickness_mm,finishes,nfc) VALUES(?,?,?,?,?,?,?,?)');
  [['basic-pvc','Basic PVC Card','Everyday PVC card',29900,'PVC',0.76,'matte,gloss',0],
   ['premium-pvc','Premium PVC Card','Thick premium PVC',49900,'PVC',1.0,'matte,gloss,soft-touch',0],
   ['nfc','NFC Card','PVC card with NFC chip',79900,'PVC+NFC',0.9,'matte,gloss',1],
   ['metal','Metal Card','Laser-engraved metal',299900,'Stainless steel',0.8,'black,silver,gold',1],
   ['custom','Custom Design Card','Your artwork, print-ready',59900,'PVC',0.76,'matte,gloss',0]].forEach(p => ins.run(...p));
}
if (E.ADMIN_EMAIL && E.ADMIN_PASSWORD && !db.prepare('SELECT 1 FROM users WHERE role=?').get('ADMIN')) {
  db.prepare('INSERT INTO users(email,username,pass_hash,role,verified,created) VALUES(?,?,?,?,1,?)')
    .run(E.ADMIN_EMAIL.toLowerCase(), 'admin', bcrypt.hashSync(E.ADMIN_PASSWORD, 12), 'ADMIN', Date.now());
}

if (!db.prepare("SELECT 1 FROM users WHERE username='demo'").get()) {
  const r = db.prepare("INSERT INTO users(email,username,pass_hash,verified,created) VALUES('demo@example.invalid','demo',?,1,?)").run('!disabled', Date.now());
  db.prepare('INSERT INTO profiles(user_id,data,updated) VALUES(?,?,?)').run(r.lastInsertRowid, JSON.stringify({ name: 'Demo Profile', profession: 'Frontend Developer', company: 'Wuk72', bio: 'This is what a smart card profile looks like.', website: 'https://example.com', email: 'hello@example.com' }), Date.now());
}
// ---------- helpers ----------
const now = () => Date.now();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rnd = n => crypto.randomBytes(n).toString('base64url');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    const c = Array.from(crypto.randomBytes(7), b => A[b % A.length]).join('');
    if (!db.prepare('SELECT 1 FROM cards WHERE code=?').get(c)) return c;
  }
}
const mail = (to, subject, link) => console.log(`[mail] to=${to} subject="${subject}" link=${link}`); // swap for SMTP/Resend
function issue(userId, kind, ttlMs) {
  const t = rnd(32);
  db.prepare('INSERT INTO tokens VALUES(?,?,?,?)').run(sha(t), userId, kind, now() + ttlMs);
  return t;
}
function consume(t, kind) {
  const r = db.prepare('SELECT * FROM tokens WHERE hash=? AND kind=? AND expires>?').get(sha(t || ''), kind, now());
  if (r) db.prepare('DELETE FROM tokens WHERE hash=?').run(r.hash);
  return r;
}
const parse = (schema, body, res) => {
  const r = schema.safeParse(body);
  if (!r.success) { res.status(400).json({ error: 'Invalid input', details: r.error.flatten().fieldErrors }); return null; }
  return r.data;
};

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'],
  mediaSrc: ["'self'"], frameSrc: ['https://www.youtube.com', 'https://player.vimeo.com'], styleSrc: ["'self'", "'unsafe-inline'"] } } }));
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// CSRF defence: cookies are SameSite=Lax and every mutation must carry a custom header (blocks cross-site forms)
app.use('/api', (req, res, next) =>
  (req.method === 'GET' || req.get('x-requested-with') === 'fetch') ? next() : res.status(403).json({ error: 'Forbidden' }));

app.use((req, res, next) => {
  const sid = req.cookies.sid;
  if (sid) {
    const s = db.prepare('SELECT * FROM sessions WHERE hash=? AND expires>?').get(sha(sid), now());
    if (s) {
      const u = db.prepare('SELECT id,email,username,role,verified,suspended FROM users WHERE id=?').get(s.user_id);
      if (u && !u.suspended) req.user = u;
    }
  }
  next();
});
const needUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Login required' });
const needVerified = (req, res, next) => req.user.verified ? next() : res.status(403).json({ error: 'Verify your email first' });
const needAdmin = (req, res, next) => req.user?.role === 'ADMIN' ? next() : res.status(403).json({ error: 'Forbidden' });

const authLimit = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: true, legacyHeaders: false });

// ---------- auth ----------
app.post('/api/auth/signup', authLimit, (req, res) => {
  const d = parse(z.object({
    email: z.string().email().max(200), password: z.string().min(10).max(128),
    username: z.string().regex(/^[a-z0-9_]{3,30}$/)
  }), req.body, res); if (!d) return;
  if (['admin', 'api', 'c', 'p', 'login'].includes(d.username)) return res.status(400).json({ error: 'Username reserved' });
  try {
    const r = db.prepare('INSERT INTO users(email,username,pass_hash,created) VALUES(?,?,?,?)')
      .run(d.email.toLowerCase(), d.username, bcrypt.hashSync(d.password, 12), now());
    db.prepare('INSERT INTO profiles(user_id,updated) VALUES(?,?)').run(r.lastInsertRowid, now());
    mail(d.email, 'Verify your email', `${BASE}/api/auth/verify?token=${issue(r.lastInsertRowid, 'verify', 864e5)}`);
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'Email or username already in use' }); }
});
app.get('/api/auth/verify', (req, res) => {
  const t = consume(req.query.token, 'verify');
  if (t) db.prepare('UPDATE users SET verified=1 WHERE id=?').run(t.user_id);
  res.redirect(t ? '/?verified=1' : '/?verified=0');
});
app.post('/api/auth/login', authLimit, (req, res) => {
  const d = parse(z.object({ email: z.string().email(), password: z.string().max(128) }), req.body, res); if (!d) return;
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(d.email.toLowerCase());
  const ok = bcrypt.compareSync(d.password, u?.pass_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!u || !ok || u.suspended) return res.status(401).json({ error: 'Invalid credentials' });
  const sid = rnd(32);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(sid), u.id, now() + 7 * 864e5);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 864e5 });
  res.json({ ok: true, role: u.role });
});
app.post('/api/auth/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(req.cookies.sid));
  res.clearCookie('sid').json({ ok: true });
});
app.post('/api/auth/forgot', authLimit, (req, res) => {
  const u = db.prepare('SELECT id,email FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase());
  if (u) mail(u.email, 'Reset password', `${BASE}/reset.html?token=${issue(u.id, 'reset', 36e5)}`);
  res.json({ ok: true }); // same response either way: no account enumeration
});
app.post('/api/auth/reset', authLimit, (req, res) => {
  const d = parse(z.object({ token: z.string(), password: z.string().min(10).max(128) }), req.body, res); if (!d) return;
  const t = consume(d.token, 'reset');
  if (!t) return res.status(400).json({ error: 'Invalid or expired token' });
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(bcrypt.hashSync(d.password, 12), t.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(t.user_id); // log out everywhere
  res.json({ ok: true });
});
app.get('/api/me', needUser, (req, res) => res.json(req.user));

// ---------- profile ----------
const profileSchema = z.object({
  data: z.record(z.string().max(2000)).optional(),   // name, bio, socials, etc.
  sections: z.record(z.boolean()).optional(),        // {about:true, video:true, resume:false}
  theme: z.record(z.string().max(100)).optional()
});
app.get('/api/profile', needUser, (req, res) => res.json(db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id)));
app.put('/api/profile', needUser, needVerified, (req, res) => {
  const d = parse(profileSchema, req.body, res); if (!d) return;
  const cur = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(req.user.id);
  db.prepare('UPDATE profiles SET data=?,sections=?,theme=?,updated=? WHERE user_id=?').run(
    JSON.stringify(d.data ?? JSON.parse(cur.data)), JSON.stringify(d.sections ?? JSON.parse(cur.sections)),
    JSON.stringify(d.theme ?? JSON.parse(cur.theme)), now(), req.user.id);
  res.json({ ok: true });
});

// ---------- uploads (private by default) ----------
const ALLOWED = { 'image/png': 8, 'image/jpeg': 8, 'image/svg+xml': 2, 'application/pdf': 20, 'video/mp4': 100, 'video/webm': 100 };
const upload = multer({ dest: UP, limits: { fileSize: 100 * 1048576, files: 1 },
  fileFilter: (req, f, cb) => cb(ALLOWED[f.mimetype] ? null : new Error('Unsupported file type'), !!ALLOWED[f.mimetype]) });
app.post('/api/files', needUser, needVerified, upload.single('file'), (req, res) => {
  const f = req.file; if (!f) return res.status(400).json({ error: 'No file' });
  if (f.size > ALLOWED[f.mimetype] * 1048576) { fs.unlinkSync(f.path); return res.status(413).json({ error: 'File too large' }); }
  const head = fs.readFileSync(f.path).subarray(0, 8).toString('latin1'); // basic magic-byte check
  const magicOk = { 'image/png': '\x89PNG', 'image/jpeg': '\xff\xd8', 'application/pdf': '%PDF' }[f.mimetype];
  if (magicOk && !head.startsWith(magicOk)) { fs.unlinkSync(f.path); return res.status(400).json({ error: 'File content does not match type' }); }
  const id = f.filename;
  db.prepare('INSERT INTO files VALUES(?,?,?,?,?,0,?)').run(id, req.user.id, f.originalname.slice(0, 200), f.mimetype, f.size, String(req.body.kind || 'misc').slice(0, 30));
  res.json({ id, url: `/files/${id}` });
});
app.patch('/api/files/:id', needUser, (req, res) => {
  db.prepare('UPDATE files SET is_public=? WHERE id=? AND user_id=?').run(req.body.is_public ? 1 : 0, req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/files/:id', needUser, (req, res) => {
  const r = db.prepare('DELETE FROM files WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (r.changes) fs.rm(path.join(UP, path.basename(req.params.id)), () => {});
  res.json({ ok: true });
});
app.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(req.params.id);
  const allowed = f && (f.is_public || req.user?.id === f.user_id || req.user?.role === 'ADMIN');
  if (!allowed) return res.sendStatus(404);
  res.set({ 'Content-Type': f.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.sendFile(path.join(UP, path.basename(f.id)));
});

// ---------- products & cards ----------
app.get('/api/products', (req, res) => res.json(db.prepare('SELECT * FROM products WHERE active=1').all()));
app.post('/api/cards', needUser, needVerified, (req, res) => {
  const d = parse(z.object({ product_id: z.number().int(), design: z.record(z.any()).optional() }), req.body, res); if (!d) return;
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(d.product_id);
  if (!p) return res.status(404).json({ error: 'Unknown product' });
  const code = newCode();
  db.prepare('INSERT INTO cards(user_id,code,product_id,design,nfc,created) VALUES(?,?,?,?,?,?)')
    .run(req.user.id, code, p.id, JSON.stringify(d.design || {}), p.nfc, now());
  res.json({ code, url: `${BASE}/c/${code}` });
});
app.get('/api/cards', needUser, (req, res) => res.json(db.prepare(`SELECT c.*,
  (SELECT COUNT(*) FROM scans s WHERE s.card_id=c.id) scans FROM cards c WHERE user_id=?`).all(req.user.id)));
app.put('/api/cards/:code/design', needUser, (req, res) => {
  const d = parse(z.object({ design: z.record(z.any()).optional(), front_file: z.string().optional(), back_file: z.string().optional() }), req.body, res); if (!d) return;
  const own = f => !f || db.prepare('SELECT 1 FROM files WHERE id=? AND user_id=?').get(f, req.user.id);
  if (!own(d.front_file) || !own(d.back_file)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare(`UPDATE cards SET design=COALESCE(?,design),front_file=COALESCE(?,front_file),back_file=COALESCE(?,back_file),
    design_status=CASE WHEN ? THEN 'pending_review' ELSE design_status END WHERE code=? AND user_id=?`)
    .run(d.design && JSON.stringify(d.design), d.front_file, d.back_file, d.front_file || d.back_file ? 1 : 0, req.params.code, req.user.id);
  res.json({ ok: true });
});
app.get('/api/cards/:code/qr.png', needUser, async (req, res) => {
  const c = db.prepare('SELECT code FROM cards WHERE code=? AND user_id=?').get(req.params.code, req.user.id);
  if (!c) return res.sendStatus(404);
  res.type('png').send(await QRCode.toBuffer(`${BASE}/c/${c.code}?s=qr`, { errorCorrectionLevel: 'H', margin: 2, width: 1024 }));
});
// QR URLs are baked in at print time; /c/:code is the stable, never-changing entry point (NFC uses ?s=nfc)
app.get('/c/:code', (req, res) => {
  const c = db.prepare(`SELECT c.id,c.active,u.username,u.suspended FROM cards c JOIN users u ON u.id=c.user_id WHERE c.code=?`).get(req.params.code);
  if (!c || !c.active || c.suspended) return res.status(404).send('Card not found');
  const ua = req.get('user-agent') || '';
  // privacy: no IP, no full user-agent, no precise location. Only source + coarse device class.
  db.prepare('INSERT INTO scans(card_id,ts,source,device) VALUES(?,?,?,?)').run(c.id, now(),
    req.query.s === 'nfc' ? 'nfc' : req.query.s === 'qr' ? 'qr' : 'direct', /mobile|android|iphone/i.test(ua) ? 'mobile' : 'desktop');
  res.redirect(302, `/p/${c.username}`);
});

// ---------- public profile ----------
app.get('/p/:username', (req, res) => {
  const u = db.prepare('SELECT id,username,suspended FROM users WHERE username=?').get(req.params.username);
  if (!u || u.suspended) return res.status(404).send('Profile not found');
  const p = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(u.id);
  const d = JSON.parse(p.data), s = JSON.parse(p.sections), t = JSON.parse(p.theme);
  const on = k => s[k] !== false;
  const accent = /^#[0-9a-f]{6}$/i.test(t.accent) ? t.accent : '#6d5efc';
  const socials = ['website', 'instagram', 'linkedin', 'github', 'youtube', 'twitter', 'telegram']
    .filter(k => safeUrl(d[k])).map(k => `<a href="${esc(d[k])}" rel="noopener nofollow">${k}</a>`).join('');
  const vid = d.video_url && /^https:\/\/(www\.youtube\.com\/embed\/|player\.vimeo\.com\/video\/)[\w-]+$/.test(d.video_url)
    ? `<iframe src="${esc(d.video_url)}" allowfullscreen loading="lazy"></iframe>` : '';
  res.send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(d.name || u.username)}</title>
<style>:root{--a:${accent}}body{margin:0;font:16px system-ui;background:#0b0b12;color:#eee;display:grid;place-items:start center}
main{width:min(100%,520px);padding:24px}h1{margin:.2em 0}.sub{opacity:.7}section{background:#16161f;border-radius:16px;padding:16px;margin:14px 0}
iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:12px}.links{display:flex;flex-wrap:wrap;gap:8px}
.links a,.btn{background:var(--a);color:#fff;padding:8px 14px;border-radius:99px;text-decoration:none}</style>
<main><h1>${esc(d.name || u.username)}</h1><div class=sub>${esc(d.profession)} ${d.company ? '· ' + esc(d.company) : ''}</div>
${on('about') && d.bio ? `<section><h3>About</h3>${esc(d.bio)}</section>` : ''}
${on('video') && vid ? `<section>${vid}</section>` : ''}
${on('social') && socials ? `<section class=links>${socials}</section>` : ''}
${on('contact') ? `<section class=links>${d.email ? `<a href="mailto:${esc(d.email)}">Email</a>` : ''}${d.phone ? `<a href="tel:${esc(d.phone)}">Call</a>` : ''}</section>` : ''}</main>`);
});

// ---------- orders & payments ----------
app.post('/api/orders', needUser, needVerified, (req, res) => {
  const d = parse(z.object({ card_code: z.string(), qty: z.number().int().min(1).max(100).default(1),
    shipping: z.object({ name: z.string(), line1: z.string(), city: z.string(), state: z.string(), postal: z.string(), country: z.string(), phone: z.string() }) }), req.body, res); if (!d) return;
  const c = db.prepare('SELECT * FROM cards WHERE code=? AND user_id=?').get(d.card_code, req.user.id);
  if (!c) return res.sendStatus(404);
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(c.product_id);
  const amount = p.price_minor * d.qty; // price is ALWAYS computed server-side
  const r = db.prepare('INSERT INTO orders(user_id,card_id,product_id,qty,amount_minor,currency,shipping,created) VALUES(?,?,?,?,?,?,?,?)')
    .run(req.user.id, c.id, p.id, d.qty, amount, p.currency, JSON.stringify(d.shipping), now());
  res.json({ order_id: r.lastInsertRowid, amount_minor: amount, currency: p.currency, payment: createPayment(r.lastInsertRowid, amount, p.currency) });
});
app.get('/api/orders', needUser, (req, res) => res.json(db.prepare('SELECT id,card_id,qty,amount_minor,currency,status,created FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id)));

// Provider adapter: implement the real SDK call here (Razorpay orders.create / Stripe PaymentIntents). Keys stay server-side.
function createPayment(orderId, amount, currency) {
  const provider = E.PAYMENT_PROVIDER || 'razorpay';
  return { provider, order_id: orderId, note: 'TODO: call provider SDK with env keys and return the client token only' };
}
// Webhook: verify signature with the provider secret, then confirm. Raw body needed for real signature checks.
app.post('/api/payments/webhook', express.raw({ type: '*/*', limit: '100kb' }), (req, res) => {
  const secret = E.RAZORPAY_KEY_SECRET; if (!secret) return res.sendStatus(503);
  const sig = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  const got = req.get('x-razorpay-signature') || '';
  if (got.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(sig))) return res.sendStatus(400);
  const ev = JSON.parse(req.body.toString());
  const id = ev?.payload?.payment?.entity?.notes?.order_id;
  if (id) db.prepare("UPDATE orders SET status='payment_confirmed' WHERE id=? AND status='pending'").run(id);
  res.sendStatus(200);
});

// ---------- analytics ----------
app.get('/api/analytics', needUser, (req, res) => res.json(db.prepare(`SELECT c.code, s.source, s.device, COUNT(*) n,
  date(s.ts/1000,'unixepoch') day FROM scans s JOIN cards c ON c.id=s.card_id WHERE c.user_id=? GROUP BY 1,2,3,5`).all(req.user.id)));

// ---------- admin (never selects pass_hash/tokens) ----------
const admin = express.Router();
admin.use(needUser, needAdmin);
admin.get('/users', (req, res) => res.json(db.prepare(`SELECT id,email,username,role,verified,suspended,created FROM users
  WHERE email LIKE ? OR username LIKE ? LIMIT 100`).all(`%${req.query.q || ''}%`, `%${req.query.q || ''}%`)));
admin.post('/users/:id/suspend', (req, res) => {
  const on = req.body.suspended ? 1 : 0;
  db.prepare("UPDATE users SET suspended=? WHERE id=? AND role!='ADMIN'").run(on, req.params.id);
  if (on) db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id);
  res.json({ ok: true });
});
admin.get('/orders', (req, res) => res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all()));
const STATUSES = ['pending', 'payment_confirmed', 'design_review', 'printing', 'dispatched', 'delivered', 'cancelled'];
admin.post('/orders/:id/status', (req, res) => {
  if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status, req.params.id); res.json({ ok: true });
});
admin.get('/cards', (req, res) => res.json(db.prepare('SELECT * FROM cards ORDER BY id DESC LIMIT 200').all()));
admin.post('/cards/:id/active', (req, res) => { db.prepare('UPDATE cards SET active=? WHERE id=?').run(req.body.active ? 1 : 0, req.params.id); res.json({ ok: true }); });
admin.post('/cards/:id/design', (req, res) => {
  if (!['approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
  db.prepare('UPDATE cards SET design_status=? WHERE id=?').run(req.body.status, req.params.id); res.json({ ok: true });
});
admin.get('/scans', (req, res) => res.json(db.prepare('SELECT card_id,COUNT(*) n FROM scans GROUP BY card_id').all()));
admin.put('/products/:id', (req, res) => {
  const d = parse(z.object({ name: z.string(), description: z.string(), price_minor: z.number().int().min(0), active: z.boolean() }), req.body, res); if (!d) return;
  db.prepare('UPDATE products SET name=?,description=?,price_minor=?,active=? WHERE id=?').run(d.name, d.description, d.price_minor, d.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.use('/api/admin', admin);

app.use((err, req, res, next) => res.status(400).json({ error: PROD ? 'Request failed' : err.message }));
app.listen(E.PORT || 3000, () => console.log(`Listening on ${BASE}`));
