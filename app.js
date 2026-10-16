require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const helmet = require('helmet');
const slugify = require('slugify');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_NAME = process.env.SITE_NAME || 'R&R Cosmetics';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'change-this-cookie-secret';
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(__dirname, 'catalog.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    price REAL,
    image TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    path TEXT NOT NULL,
    product_id INTEGER,
    viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON page_views(viewed_at);
  CREATE INDEX IF NOT EXISTS idx_page_views_visitor ON page_views(visitor_id);
`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());
app.use((req, res, next) => {
  res.locals.siteName = SITE_NAME;
  res.locals.baseUrl = BASE_URL;
  res.locals.money = (value) => value == null || value === '' ? '' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value));
  next();
});

// Count real browser page views. Known preview crawlers are excluded so WhatsApp link previews
// do not inflate the visitor numbers. The random cookie is anonymous; raw IP addresses are not stored.
app.use((req, res, next) => {
  const ua = req.get('user-agent') || '';
  const isBot = /bot|crawler|spider|WhatsApp|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|Discordbot|Googlebot|bingbot/i.test(ua);
  if (req.method !== 'GET' || isBot || req.path.startsWith('/admin') || req.path.startsWith('/assets')) return next();
  let visitorId = req.cookies.catalog_visitor;
  if (!visitorId || !/^[a-f0-9-]{36}$/i.test(visitorId)) {
    visitorId = crypto.randomUUID();
    res.cookie('catalog_visitor', visitorId, { httpOnly: true, sameSite: 'Lax', secure: BASE_URL.startsWith('https://'), maxAge: 365 * 24 * 60 * 60 * 1000 });
  }
  const productMatch = req.path.match(/^\/product\/([^/]+)/);
  let productId = null;
  if (productMatch) {
    const product = db.prepare('SELECT id FROM products WHERE slug = ?').get(productMatch[1]);
    if (product) productId = product.id;
  }
  db.prepare('INSERT INTO page_views (visitor_id, path, product_id) VALUES (?, ?, ?)').run(visitorId, req.path.slice(0, 500), productId);
  next();
});

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const splitAt = decoded.indexOf(':');
    const user = decoded.slice(0, splitAt);
    const password = decoded.slice(splitAt + 1);
    const safeEqual = (a, b) => {
      const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
      return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
    };
    if (splitAt >= 0 && safeEqual(user, ADMIN_USER) && safeEqual(password, ADMIN_PASSWORD) && ADMIN_PASSWORD !== 'change-this-password') return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Product Catalog Admin", charset="UTF-8"');
  res.status(401).send('Admin access required. Please contact the site administrator for access.');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Only JPG, PNG, WEBP, and GIF images are allowed.'), allowed.includes(file.mimetype));
  }
});

function makeSlug(name) {
  const base = slugify(name, { lower: true, strict: true }) || 'product';
  let slug = base; let i = 2;
  while (db.prepare('SELECT id FROM products WHERE slug = ?').get(slug)) slug = `${base}-${i++}`;
  return slug;
}
function removeUploadedImage(image) {
  if (image && image.startsWith('/uploads/')) {
    const full = path.join(uploadDir, path.basename(image));
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

app.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  res.render('index', { products, pageTitle: SITE_NAME });
});

app.get('/product/:slug', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).render('not-found');
  const productUrl = `${BASE_URL}/product/${encodeURIComponent(product.slug)}`;
  const imageUrl = `${BASE_URL}${product.image}`;
  res.render('product', { product, productUrl, imageUrl, pageTitle: `${product.name} | ${SITE_NAME}` });
});

app.get('/admin', requireAdmin, (_req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY id DESC').all();
  const stats = db.prepare(`SELECT COUNT(*) AS pageViews, COUNT(DISTINCT visitor_id) AS uniqueVisitors,
    COUNT(DISTINCT CASE WHEN date(viewed_at) = date('now') THEN visitor_id END) AS todayVisitors,
    SUM(CASE WHEN date(viewed_at) = date('now') THEN 1 ELSE 0 END) AS todayViews FROM page_views`).get();
  const topPages = db.prepare(`SELECT path, COUNT(*) AS views FROM page_views GROUP BY path ORDER BY views DESC LIMIT 10`).all();
  const topProducts = db.prepare(`SELECT p.name, p.slug, COUNT(v.id) AS views FROM products p LEFT JOIN page_views v ON p.id = v.product_id GROUP BY p.id ORDER BY views DESC LIMIT 10`).all();
  res.render('admin', { products, stats, topPages, topProducts, error: null, editProduct: null });
});

app.post('/admin/products', requireAdmin, upload.single('image'), (req, res) => {
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const rawPrice = String(req.body.price || '').trim();
  const price = rawPrice === '' ? null : Number(rawPrice);
  if (!name) { if (req.file) removeUploadedImage(`/uploads/${req.file.filename}`); return res.status(400).send('Product name is required.'); }
  if (rawPrice !== '' && (!Number.isFinite(price) || price < 0)) { if (req.file) removeUploadedImage(`/uploads/${req.file.filename}`); return res.status(400).send('Price must be a valid non-negative number.'); }
  if (!req.file) return res.status(400).send('Please choose a product image.');
  const slug = makeSlug(name);
  db.prepare('INSERT INTO products (name, slug, description, price, image) VALUES (?, ?, ?, ?, ?)').run(name, slug, description, price, `/uploads/${req.file.filename}`);
  res.redirect('/admin');
});

app.post('/admin/products/:id/update', requireAdmin, upload.single('image'), (req, res) => {
  const id = Number(req.params.id);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!product) return res.status(404).send('Product not found.');
  const name = String(req.body.name || '').trim();
  const description = String(req.body.description || '').trim();
  const rawPrice = String(req.body.price || '').trim();
  const price = rawPrice === '' ? null : Number(rawPrice);
  if (!name || (rawPrice !== '' && (!Number.isFinite(price) || price < 0))) { if (req.file) removeUploadedImage(`/uploads/${req.file.filename}`); return res.status(400).send('Enter a product name and a valid price.'); }
  const newSlugBase = slugify(name, { lower: true, strict: true }) || `product-${id}`;
  let slug = newSlugBase; let suffix = 2;
  while (db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(slug, id)) slug = `${newSlugBase}-${suffix++}`;
  const image = req.file ? `/uploads/${req.file.filename}` : product.image;
  db.prepare('UPDATE products SET name = ?, slug = ?, description = ?, price = ?, image = ? WHERE id = ?').run(name, slug, description, price, image, id);
  if (req.file) removeUploadedImage(product.image);
  res.redirect('/admin');
});

app.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id));
  if (product) { db.prepare('DELETE FROM products WHERE id = ?').run(product.id); removeUploadedImage(product.image); }
  res.redirect('/admin');
});

app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\n'));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => {
  console.error(err.message);
  if (err instanceof multer.MulterError) return res.status(400).send(`Image upload error: ${err.message}`);
  res.status(400).send(err.message || 'Something went wrong.');
});

app.listen(PORT, () => console.log(`${SITE_NAME} running at ${BASE_URL} (port ${PORT})`));
