require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const Jimp = require('jimp');
const FileStore = require('session-file-store')(session);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
const CAMERA_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const ALLOWED_IMAGE_MIME = /^data:image\/(png|jpeg|jpg|webp);base64,/i;
const GOOGLE_ENABLED = String(process.env.ENABLE_GOOGLE_AUTH || 'true') === 'true';
const FACEBOOK_ENABLED = String(process.env.ENABLE_FACEBOOK_AUTH || 'true') === 'true';
const LOCAL_ENABLED = String(process.env.ENABLE_LOCAL_AUTH || 'false') === 'true';
const USE_SECURE_COOKIE = APP_ORIGIN.startsWith('https://');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      users: [],
      submissions: [],
      photoHashes: [],
      cameraChallenges: [],
      counters: { users: 0, submissions: 0 }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function nextId(db, key, prefix) {
  db.counters[key] = (db.counters[key] || 0) + 1;
  return `${prefix}_${db.counters[key]}`;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    provider: user.provider,
    name: user.name,
    email: user.email || '',
    avatar: user.avatar || '🌿',
    createdAt: user.createdAt,
    stats: user.stats || defaultStats(),
    objects: user.objects || defaultObjects(),
    recentSubmissions: (user.recentSubmissionIds || []).length
  };
}

function defaultStats() {
  return {
    puzzles: 0,
    approvedCount: 0,
    totalCaptures: 0,
    streak: 0,
    lastApprovedDate: null
  };
}

function defaultObjects() {
  return {
    bottle: 0,
    cup: 0,
    bag: 0,
    container: 0
  };
}

function calculateLevel(puzzles) {
  if (puzzles >= 100) return { level: 3, name: 'Kiến tạo hành tinh xanh', current: puzzles - 100, max: 100, nextLabel: 'Mở rộng chiến dịch' };
  if (puzzles >= 50) return { level: 2, name: 'Người giữ nhịp tái chế', current: puzzles - 50, max: 50, nextLabel: 'Đến Level 3' };
  if (puzzles >= 15) return { level: 1, name: 'Người sống xanh', current: puzzles - 15, max: 35, nextLabel: 'Đến Level 2' };
  return { level: 0, name: 'Bắt đầu hành trình', current: puzzles, max: 15, nextLabel: 'Đến Level 1' };
}

function randomAvatar(name) {
  const avatars = ['🌿', '🌎', '♻️', '🌱', '🍃', '🌳'];
  const i = Math.abs((name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % avatars.length;
  return avatars[i];
}

function findUserById(id) {
  const db = readDb();
  return db.users.find((u) => u.id === id) || null;
}

function upsertOAuthUser({ provider, providerId, name, email }) {
  const db = readDb();
  let user = db.users.find((u) => u.provider === provider && u.providerId === providerId);
  if (!user && email) {
    user = db.users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
  }
  if (!user) {
    user = {
      id: nextId(db, 'users', 'usr'),
      provider,
      providerId,
      name: name || 'Người dùng xanh',
      email: email || '',
      avatar: randomAvatar(name || email || provider),
      createdAt: nowIso(),
      stats: defaultStats(),
      objects: defaultObjects(),
      recentSubmissionIds: []
    };
    db.users.push(user);
  } else {
    user.provider = provider;
    user.providerId = providerId;
    if (name) user.name = name;
    if (email) user.email = email;
  }
  writeDb(db);
  return user;
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => done(null, findUserById(id)));

if (GOOGLE_ENABLED && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : '';
      const user = upsertOAuthUser({
        provider: 'google',
        providerId: profile.id,
        name: profile.displayName,
        email
      });
      done(null, user);
    } catch (error) {
      done(error);
    }
  }));
}

if (FACEBOOK_ENABLED && process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_CALLBACK_URL) {
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: process.env.FACEBOOK_CALLBACK_URL,
    profileFields: ['id', 'displayName', 'emails']
  }, (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : '';
      const user = upsertOAuthUser({
        provider: 'facebook',
        providerId: profile.id,
        name: profile.displayName,
        email
      });
      done(null, user);
    } catch (error) {
      done(error);
    }
  }));
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  store: new FileStore({ path: SESSION_DIR, logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'replace-me-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: USE_SECURE_COOKIE,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(passport.initialize());
app.use(passport.session());

function requireAuth(req, res, next) {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ ok: false, message: 'Bạn cần đăng nhập trước.' });
  }
  next();
}

function trimExpiredChallenges(db) {
  const now = Date.now();
  db.cameraChallenges = db.cameraChallenges.filter((c) => now - c.createdAt <= CAMERA_CHALLENGE_TTL_MS && !c.used);
}

async function readImageFromDataUrl(dataUrl) {
  if (!ALLOWED_IMAGE_MIME.test(dataUrl || '')) {
    throw new Error('Định dạng ảnh không hợp lệ.');
  }
  const base64 = dataUrl.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  const image = await Jimp.read(buffer);
  return { image, buffer };
}

async function computeImageMetrics(image) {
  const clone = image.clone().resize(256, Jimp.AUTO).quality(80);
  const w = clone.bitmap.width;
  const h = clone.bitmap.height;

  let brightSum = 0;
  let brightSqSum = 0;
  let edgeSum = 0;
  let centerBright = 0;
  let centerCount = 0;

  const gray = new Array(w * h);
  let idx = 0;
  clone.scan(0, 0, w, h, function (x, y, offset) {
    const r = this.bitmap.data[offset];
    const g = this.bitmap.data[offset + 1];
    const b = this.bitmap.data[offset + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[idx++] = lum;
    brightSum += lum;
    brightSqSum += lum * lum;
    const inCenter = x > w * 0.2 && x < w * 0.8 && y > h * 0.15 && y < h * 0.95;
    if (inCenter) {
      centerBright += lum;
      centerCount += 1;
    }
  });

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      edgeSum += Math.abs(gx) + Math.abs(gy);
    }
  }

  const count = w * h;
  const brightness = brightSum / count;
  const variance = Math.max(0, brightSqSum / count - brightness * brightness);
  const contrast = Math.sqrt(variance);
  const sharpness = edgeSum / count;
  const centerBrightness = centerCount ? centerBright / centerCount : brightness;
  const phash = image.hash(16);

  return {
    width: image.bitmap.width,
    height: image.bitmap.height,
    brightness: Number(brightness.toFixed(2)),
    contrast: Number(contrast.toFixed(2)),
    sharpness: Number(sharpness.toFixed(2)),
    centerBrightness: Number(centerBrightness.toFixed(2)),
    phash
  };
}

function hammingDistanceHex(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const n1 = parseInt(a[i], 16);
    const n2 = parseInt(b[i], 16);
    let xor = n1 ^ n2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

function inferObjects(clientMetrics = {}, metrics = {}) {
  const objects = [];
  const lowerHints = Array.isArray(clientMetrics.objectHints)
    ? clientMetrics.objectHints.map((v) => String(v || '').toLowerCase())
    : [];
  if (lowerHints.some((v) => v.includes('bottle'))) objects.push('bottle');
  if (lowerHints.some((v) => v.includes('cup'))) objects.push('cup');
  if (lowerHints.some((v) => v.includes('bag'))) objects.push('bag');
  if (lowerHints.some((v) => v.includes('container') || v.includes('box'))) objects.push('container');

  if (!objects.length && metrics.sharpness > 22 && metrics.contrast > 32) objects.push('container');
  return [...new Set(objects)];
}

function evaluateSubmission({ metrics, clientMetrics, duplicateDistance }) {
  const originOk = clientMetrics && clientMetrics.captureSource === 'camera';
  const resolutionOk = metrics.width >= 720 && metrics.height >= 540;
  const brightnessOk = metrics.brightness >= 55 && metrics.brightness <= 220;
  const contrastOk = metrics.contrast >= 25;
  const sharpnessOk = metrics.sharpness >= 15;
  const centerOk = metrics.centerBrightness >= 45;
  const duplicateOk = duplicateDistance > 4;
  const liveSessionOk = Boolean(clientMetrics && clientMetrics.liveCamera === true);

  const score = [originOk, resolutionOk, brightnessOk, contrastOk, sharpnessOk, centerOk, duplicateOk, liveSessionOk].filter(Boolean).length;
  const approved = score >= 7;

  const reasons = [
    { key: 'captureSource', label: 'Chụp trực tiếp từ camera', pass: originOk && liveSessionOk },
    { key: 'binVisible', label: 'Thùng rác nhìn rõ', pass: centerOk && contrastOk },
    { key: 'quality', label: 'Ảnh đủ sáng và đủ nét', pass: brightnessOk && sharpnessOk },
    { key: 'unique', label: 'Ảnh không trùng lặp', pass: duplicateOk },
    { key: 'resolution', label: 'Kích thước ảnh đủ lớn', pass: resolutionOk }
  ];

  let message = 'Ảnh đã đạt điều kiện xác thực và được cộng 1 puzzle.';
  if (!approved) {
    const failed = reasons.filter((r) => !r.pass).map((r) => r.label);
    message = `Ảnh chưa đạt: ${failed.join(', ')}.`;
  }

  return { approved, reasons, score, message };
}

function updateStreak(stats) {
  const today = new Date().toISOString().slice(0, 10);
  if (!stats.lastApprovedDate) {
    stats.streak = 1;
    stats.lastApprovedDate = today;
    return;
  }
  const last = new Date(stats.lastApprovedDate + 'T00:00:00Z');
  const now = new Date(today + 'T00:00:00Z');
  const diffDays = Math.round((now - last) / 86400000);
  if (diffDays === 0) return;
  if (diffDays === 1) stats.streak += 1;
  else stats.streak = 1;
  stats.lastApprovedDate = today;
}

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    auth: {
      google: GOOGLE_ENABLED && Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL),
      facebook: FACEBOOK_ENABLED && Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_CALLBACK_URL),
      local: LOCAL_ENABLED
    },
    appOrigin: APP_ORIGIN,
    challengeTtlSeconds: CAMERA_CHALLENGE_TTL_MS / 1000
  });
});

app.get('/api/auth/me', (req, res) => {
  const user = sanitizeUser(req.user);
  const level = user ? calculateLevel(user.stats.puzzles) : null;
  res.json({ ok: true, user, level });
});

app.post('/api/auth/register', async (req, res) => {
  if (!LOCAL_ENABLED) {
    return res.status(403).json({ ok: false, message: 'Đăng ký email/mật khẩu hiện đang tắt. Hãy dùng Google hoặc Facebook.' });
  }
  const { name, email, password } = req.body || {};
  const safeName = String(name || '').trim();
  const safeEmail = String(email || '').trim().toLowerCase();
  const safePassword = String(password || '');
  if (!safeName || !safeEmail || safePassword.length < 8) {
    return res.status(400).json({ ok: false, message: 'Vui lòng nhập đủ tên, email và mật khẩu từ 8 ký tự.' });
  }
  const db = readDb();
  if (db.users.some((u) => u.email && u.email.toLowerCase() === safeEmail)) {
    return res.status(409).json({ ok: false, message: 'Email này đã tồn tại.' });
  }
  const passwordHash = await bcrypt.hash(safePassword, 10);
  const user = {
    id: nextId(db, 'users', 'usr'),
    provider: 'local',
    providerId: null,
    name: safeName,
    email: safeEmail,
    passwordHash,
    avatar: randomAvatar(safeName),
    createdAt: nowIso(),
    stats: defaultStats(),
    objects: defaultObjects(),
    recentSubmissionIds: []
  };
  db.users.push(user);
  writeDb(db);
  req.login(user, (err) => {
    if (err) return res.status(500).json({ ok: false, message: 'Không thể đăng nhập sau khi đăng ký.' });
    res.json({ ok: true, user: sanitizeUser(user), level: calculateLevel(0) });
  });
});

app.post('/api/auth/login', async (req, res) => {
  if (!LOCAL_ENABLED) {
    return res.status(403).json({ ok: false, message: 'Đăng nhập email/mật khẩu hiện đang tắt. Hãy dùng Google hoặc Facebook.' });
  }
  const { email, password } = req.body || {};
  const db = readDb();
  const user = db.users.find((u) => u.provider === 'local' && u.email && u.email.toLowerCase() === String(email || '').trim().toLowerCase());
  if (!user || !user.passwordHash) {
    return res.status(401).json({ ok: false, message: 'Sai email hoặc mật khẩu.' });
  }
  const match = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!match) {
    return res.status(401).json({ ok: false, message: 'Sai email hoặc mật khẩu.' });
  }
  req.login(user, (err) => {
    if (err) return res.status(500).json({ ok: false, message: 'Không thể đăng nhập.' });
    res.json({ ok: true, user: sanitizeUser(user), level: calculateLevel(user.stats.puzzles || 0) });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => res.json({ ok: true }));
  });
});

app.get('/auth/google', (req, res, next) => {
  if (!(GOOGLE_ENABLED && passport._strategy('google'))) {
    return res.redirect('/?oauth=google-disabled');
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!(GOOGLE_ENABLED && passport._strategy('google'))) {
    return res.redirect('/?oauth=google-disabled');
  }
  passport.authenticate('google', (err, user) => {
    if (err || !user) return res.redirect('/?oauth=google-failed');
    req.login(user, (loginErr) => {
      if (loginErr) return res.redirect('/?oauth=google-failed');
      res.redirect('/?oauth=google-success');
    });
  })(req, res, next);
});

app.get('/auth/facebook', (req, res, next) => {
  if (!(FACEBOOK_ENABLED && passport._strategy('facebook'))) {
    return res.redirect('/?oauth=facebook-disabled');
  }
  passport.authenticate('facebook', { scope: ['email'] })(req, res, next);
});

app.get('/auth/facebook/callback', (req, res, next) => {
  if (!(FACEBOOK_ENABLED && passport._strategy('facebook'))) {
    return res.redirect('/?oauth=facebook-disabled');
  }
  passport.authenticate('facebook', (err, user) => {
    if (err || !user) return res.redirect('/?oauth=facebook-failed');
    req.login(user, (loginErr) => {
      if (loginErr) return res.redirect('/?oauth=facebook-failed');
      res.redirect('/?oauth=facebook-success');
    });
  })(req, res, next);
});

app.post('/api/camera/challenge', requireAuth, (req, res) => {
  const db = readDb();
  trimExpiredChallenges(db);
  const challenge = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    sessionId: req.sessionID,
    createdAt: Date.now(),
    used: false
  };
  db.cameraChallenges.push(challenge);
  writeDb(db);
  res.json({ ok: true, challengeId: challenge.id, expiresIn: CAMERA_CHALLENGE_TTL_MS / 1000 });
});

app.post('/api/submissions', requireAuth, async (req, res) => {
  try {
    const { challengeId, imageDataUrl, clientMetrics } = req.body || {};
    if (!challengeId || !imageDataUrl) {
      return res.status(400).json({ ok: false, message: 'Thiếu challenge hoặc ảnh.' });
    }

    const db = readDb();
    trimExpiredChallenges(db);
    const challenge = db.cameraChallenges.find((c) => c.id === challengeId && c.userId === req.user.id && c.sessionId === req.sessionID);
    if (!challenge || challenge.used) {
      return res.status(400).json({ ok: false, message: 'Challenge chụp ảnh không hợp lệ hoặc đã hết hạn.' });
    }

    const { image } = await readImageFromDataUrl(imageDataUrl);
    const metrics = await computeImageMetrics(image);
    const existingDistances = db.photoHashes.map((h) => hammingDistanceHex(h.phash, metrics.phash));
    const duplicateDistance = existingDistances.length ? Math.min(...existingDistances) : 999;
    const evaluation = evaluateSubmission({ metrics, clientMetrics, duplicateDistance });
    const detectedObjects = inferObjects(clientMetrics, metrics);

    challenge.used = true;

    const submission = {
      id: nextId(db, 'submissions', 'sub'),
      userId: req.user.id,
      createdAt: nowIso(),
      status: evaluation.approved ? 'approved' : 'rejected',
      metrics,
      detectedObjects,
      reasons: evaluation.reasons,
      message: evaluation.message,
      photoHash: metrics.phash
    };
    db.submissions.unshift(submission);
    db.photoHashes.push({ phash: metrics.phash, userId: req.user.id, createdAt: submission.createdAt });

    const user = db.users.find((u) => u.id === req.user.id);
    user.stats.totalCaptures += 1;
    if (!Array.isArray(user.recentSubmissionIds)) user.recentSubmissionIds = [];
    user.recentSubmissionIds.unshift(submission.id);
    user.recentSubmissionIds = user.recentSubmissionIds.slice(0, 20);

    if (evaluation.approved) {
      user.stats.puzzles += 1;
      user.stats.approvedCount += 1;
      updateStreak(user.stats);
      detectedObjects.forEach((obj) => {
        user.objects[obj] = (user.objects[obj] || 0) + 1;
      });
    }

    writeDb(db);

    res.json({
      ok: true,
      approved: evaluation.approved,
      submission: {
        id: submission.id,
        status: submission.status,
        createdAt: submission.createdAt,
        reasons: submission.reasons,
        detectedObjects,
        metrics,
        message: submission.message
      },
      user: sanitizeUser(user),
      level: calculateLevel(user.stats.puzzles)
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message || 'Không thể xử lý ảnh.' });
  }
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  const submissions = db.submissions.filter((s) => s.userId === req.user.id).slice(0, 12);
  res.json({
    ok: true,
    user: sanitizeUser(user),
    level: calculateLevel(user.stats.puzzles),
    submissions,
    puzzleThresholds: [15, 50, 100]
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Plastic Trash for Environment listening on ${APP_ORIGIN}`);
});
