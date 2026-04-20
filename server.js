require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const Jimp = require('jimp');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CAMERA_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const ALLOWED_IMAGE_MIME = /^data:image\/(png|jpeg|jpg|webp);base64,/i;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';
const USE_SECURE_COOKIE = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SESSION_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function emptyDb() {
  return {
    profiles: [],
    submissions: [],
    photoHashes: [],
    cameraChallenges: [],
    counters: { profiles: 0, submissions: 0 }
  };
}

function normalizeDbShape(raw) {
  const db = raw && typeof raw === 'object' ? raw : emptyDb();
  db.profiles = Array.isArray(db.profiles)
    ? db.profiles
    : Array.isArray(db.users)
      ? db.users.map((user) => ({
          id: user.id,
          sessionKey: user.id,
          name: user.name || user.username || 'Khách xanh',
          alias: user.username || null,
          avatar: user.avatar || randomAvatar(user.id),
          createdAt: user.createdAt || nowIso(),
          stats: user.stats || defaultStats(),
          objects: user.objects || defaultObjects(),
          isGuest: true
        }))
      : [];
  db.submissions = Array.isArray(db.submissions) ? db.submissions : [];
  db.photoHashes = Array.isArray(db.photoHashes) ? db.photoHashes : [];
  db.cameraChallenges = Array.isArray(db.cameraChallenges) ? db.cameraChallenges : [];
  db.counters = db.counters && typeof db.counters === 'object' ? db.counters : {};
  db.counters.profiles = Number(db.counters.profiles || db.counters.users || db.profiles.length || 0);
  db.counters.submissions = Number(db.counters.submissions || db.submissions.length || 0);
  return db;
}

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = emptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
  try {
    return normalizeDbShape(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch {
    const seed = emptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2), 'utf8');
    return seed;
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(normalizeDbShape(db), null, 2), 'utf8');
}

function nextId(db, counterKey, prefix) {
  db.counters[counterKey] = (db.counters[counterKey] || 0) + 1;
  return `${prefix}_${db.counters[counterKey]}`;
}

function defaultStats() {
  return {
    puzzles: 0,
    totalCaptures: 0,
    approvedCount: 0,
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

function randomAvatar(seed) {
  const avatars = ['🌿', '🌱', '🍃', '🌎', '♻️', '🌳'];
  const raw = String(seed || 'green');
  const idx = [...raw].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % avatars.length;
  return avatars[idx];
}

function calculateLevel(puzzles) {
  if (puzzles >= 100) return { level: 3, name: 'Kiến tạo hành tinh xanh', current: puzzles - 100, max: 100, nextTarget: 'Mở rộng chiến dịch xanh' };
  if (puzzles >= 50) return { level: 2, name: 'Người giữ nhịp tái chế', current: puzzles - 50, max: 50, nextTarget: 'Đến Level 3' };
  if (puzzles >= 15) return { level: 1, name: 'Người sống xanh', current: puzzles - 15, max: 35, nextTarget: 'Đến Level 2' };
  return { level: 0, name: 'Bắt đầu hành trình', current: puzzles, max: 15, nextTarget: 'Đến Level 1' };
}

function sanitizeProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    name: profile.name,
    alias: profile.alias || null,
    avatar: profile.avatar,
    createdAt: profile.createdAt,
    isGuest: true,
    stats: profile.stats || defaultStats(),
    objects: profile.objects || defaultObjects(),
    level: calculateLevel((profile.stats || defaultStats()).puzzles || 0)
  };
}

function trimExpiredChallenges(db) {
  const now = Date.now();
  db.cameraChallenges = db.cameraChallenges.filter((c) => (now - c.createdAt <= CAMERA_CHALLENGE_TTL_MS) && !c.used);
}

function hammingDistanceHex(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

async function readImageFromDataUrl(dataUrl) {
  if (!ALLOWED_IMAGE_MIME.test(String(dataUrl || ''))) {
    throw new Error('Định dạng ảnh không hợp lệ.');
  }
  const buffer = Buffer.from(String(dataUrl).split(',')[1], 'base64');
  return Jimp.read(buffer);
}

async function computeImageMetrics(image) {
  const clone = image.clone().resize(256, Jimp.AUTO).quality(80);
  const w = clone.bitmap.width;
  const h = clone.bitmap.height;
  const gray = new Array(w * h);
  let brightSum = 0;
  let brightSq = 0;
  let edgeSum = 0;
  let centerBright = 0;
  let centerCount = 0;
  let idx = 0;

  clone.scan(0, 0, w, h, function scan(x, y, offset) {
    const r = this.bitmap.data[offset];
    const g = this.bitmap.data[offset + 1];
    const b = this.bitmap.data[offset + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[idx++] = lum;
    brightSum += lum;
    brightSq += lum * lum;
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
  const variance = Math.max(0, brightSq / count - brightness * brightness);
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

function inferObjects(clientMetrics = {}, metrics = {}) {
  const hints = Array.isArray(clientMetrics.objectHints)
    ? clientMetrics.objectHints.map((v) => String(v || '').toLowerCase())
    : [];
  const objects = [];
  if (hints.some((v) => v.includes('bottle'))) objects.push('bottle');
  if (hints.some((v) => v.includes('cup'))) objects.push('cup');
  if (hints.some((v) => v.includes('bag'))) objects.push('bag');
  if (hints.some((v) => v.includes('container') || v.includes('box'))) objects.push('container');
  if (!objects.length && metrics.sharpness > 22 && metrics.contrast > 32) objects.push('container');
  return [...new Set(objects)];
}

function evaluateSubmission({ metrics, clientMetrics, duplicateDistance }) {
  const originOk = clientMetrics && clientMetrics.captureSource === 'camera' && clientMetrics.liveCamera === true;
  const resolutionOk = metrics.width >= 720 && metrics.height >= 540;
  const brightnessOk = metrics.brightness >= 55 && metrics.brightness <= 220;
  const contrastOk = metrics.contrast >= 25;
  const sharpnessOk = metrics.sharpness >= 15;
  const centerOk = metrics.centerBrightness >= 45;
  const duplicateOk = duplicateDistance > 4;

  const checks = [originOk, resolutionOk, brightnessOk, contrastOk, sharpnessOk, centerOk, duplicateOk];
  const score = checks.filter(Boolean).length;
  const approved = score >= 6;
  const reasons = [
    { label: 'Ảnh được chụp trực tiếp từ camera', pass: originOk },
    { label: 'Thùng rác nhìn rõ trong vùng giữa ảnh', pass: centerOk && contrastOk },
    { label: 'Ảnh đủ sáng và đủ nét', pass: brightnessOk && sharpnessOk },
    { label: 'Ảnh chưa bị trùng với ảnh cũ', pass: duplicateOk },
    { label: 'Kích thước ảnh đủ lớn', pass: resolutionOk }
  ];

  const message = approved
    ? 'Ảnh hợp lệ. Bạn được cộng 1 puzzle.'
    : `Ảnh chưa đạt: ${reasons.filter((r) => !r.pass).map((r) => r.label).join(', ')}.`;

  return { approved, score, reasons, message };
}

function updateStreak(stats) {
  const today = new Date().toISOString().slice(0, 10);
  if (!stats.lastApprovedDate) {
    stats.streak = 1;
    stats.lastApprovedDate = today;
    return;
  }
  const prev = new Date(`${stats.lastApprovedDate}T00:00:00Z`);
  const curr = new Date(`${today}T00:00:00Z`);
  const diffDays = Math.round((curr - prev) / 86400000);
  if (diffDays === 0) return;
  if (diffDays === 1) stats.streak += 1;
  else stats.streak = 1;
  stats.lastApprovedDate = today;
}

function findProfileById(id) {
  const db = readDb();
  return db.profiles.find((p) => p.id === id) || null;
}

function createGuestProfile(db, sessionKey) {
  const profile = {
    id: nextId(db, 'profiles', 'guest'),
    sessionKey,
    name: `Khách xanh #${db.counters.profiles}`,
    alias: null,
    avatar: randomAvatar(sessionKey),
    createdAt: nowIso(),
    stats: defaultStats(),
    objects: defaultObjects(),
    isGuest: true
  };
  db.profiles.push(profile);
  return profile;
}

function attachProfile(req, res, next) {
  const db = readDb();
  let profile = null;

  if (req.session.profileId) {
    profile = db.profiles.find((p) => p.id === req.session.profileId) || null;
  }

  if (!profile) {
    profile = createGuestProfile(db, req.sessionID);
    req.session.profileId = profile.id;
    writeDb(db);
  }

  req.profile = profile;
  req.db = db;
  next();
}

function getHistoryForProfile(db, profileId) {
  return db.submissions.filter((s) => s.profileId === profileId).slice(-12).reverse();
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new FileStore({ path: SESSION_DIR, logFn: () => {} }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: USE_SECURE_COOKIE,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

app.use(express.static(PUBLIC_DIR));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'online', time: nowIso() });
});

app.get('/api/session/bootstrap', attachProfile, (req, res) => {
  const db = req.db;
  trimExpiredChallenges(db);
  writeDb(db);
  res.json({
    ok: true,
    profile: sanitizeProfile(req.profile),
    history: getHistoryForProfile(db, req.profile.id),
    challengeTtlSeconds: CAMERA_CHALLENGE_TTL_MS / 1000
  });
});

app.get('/api/dashboard', attachProfile, (req, res) => {
  const db = req.db;
  res.json({
    ok: true,
    profile: sanitizeProfile(req.profile),
    history: getHistoryForProfile(db, req.profile.id),
    challengeTtlSeconds: CAMERA_CHALLENGE_TTL_MS / 1000
  });
});

app.post('/api/profile/reset', attachProfile, (req, res) => {
  const db = req.db;
  const profileId = req.profile.id;
  const profile = db.profiles.find((p) => p.id === profileId);
  if (!profile) {
    return res.status(404).json({ ok: false, message: 'Không tìm thấy hồ sơ hiện tại.' });
  }

  profile.stats = defaultStats();
  profile.objects = defaultObjects();
  db.submissions = db.submissions.filter((s) => s.profileId !== profileId);
  db.photoHashes = db.photoHashes.filter((item) => item.profileId !== profileId);
  db.cameraChallenges = db.cameraChallenges.filter((item) => item.profileId !== profileId);
  writeDb(db);

  res.json({
    ok: true,
    message: 'Đã reset dữ liệu trên thiết bị này.',
    profile: sanitizeProfile(profile),
    history: []
  });
});

app.post('/api/camera/challenge', attachProfile, (req, res) => {
  const db = req.db;
  trimExpiredChallenges(db);
  const challenge = {
    id: crypto.randomUUID(),
    profileId: req.profile.id,
    sessionId: req.sessionID,
    createdAt: Date.now(),
    used: false
  };
  db.cameraChallenges.push(challenge);
  writeDb(db);
  res.json({ ok: true, challengeId: challenge.id, expiresIn: CAMERA_CHALLENGE_TTL_MS / 1000 });
});

app.post('/api/submissions', attachProfile, async (req, res) => {
  try {
    const { challengeId, imageDataUrl, clientMetrics } = req.body || {};
    if (!challengeId || !imageDataUrl) {
      return res.status(400).json({ ok: false, message: 'Thiếu challenge hoặc ảnh chụp.' });
    }

    const db = req.db;
    trimExpiredChallenges(db);
    const challenge = db.cameraChallenges.find((c) => c.id === challengeId && c.profileId === req.profile.id && c.sessionId === req.sessionID);
    if (!challenge || challenge.used) {
      return res.status(400).json({ ok: false, message: 'Challenge chụp ảnh không hợp lệ hoặc đã hết hạn.' });
    }

    const image = await readImageFromDataUrl(imageDataUrl);
    const metrics = await computeImageMetrics(image);
    const duplicateDistance = db.photoHashes.length
      ? Math.min(...db.photoHashes.map((item) => hammingDistanceHex(item.phash, metrics.phash)))
      : 999;
    const evaluation = evaluateSubmission({ metrics, clientMetrics, duplicateDistance });
    const detectedObjects = inferObjects(clientMetrics, metrics);

    challenge.used = true;

    const profile = db.profiles.find((p) => p.id === req.profile.id);
    profile.stats.totalCaptures += 1;
    if (evaluation.approved) {
      profile.stats.puzzles += 1;
      profile.stats.approvedCount += 1;
      updateStreak(profile.stats);
      detectedObjects.forEach((key) => {
        if (typeof profile.objects[key] === 'number') profile.objects[key] += 1;
      });
      db.photoHashes.push({
        profileId: profile.id,
        phash: metrics.phash,
        createdAt: nowIso()
      });
    }

    const submission = {
      id: nextId(db, 'submissions', 'sub'),
      profileId: profile.id,
      createdAt: nowIso(),
      approved: evaluation.approved,
      message: evaluation.message,
      reasons: evaluation.reasons,
      metrics: {
        brightness: metrics.brightness,
        contrast: metrics.contrast,
        sharpness: metrics.sharpness,
        width: metrics.width,
        height: metrics.height
      },
      objects: detectedObjects
    };
    db.submissions.push(submission);
    writeDb(db);

    res.json({
      ok: true,
      approved: evaluation.approved,
      message: evaluation.message,
      reasons: evaluation.reasons,
      profile: sanitizeProfile(profile),
      submission
    });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Không thể xử lý ảnh chụp.', detail: error.message });
  }
});

app.post('/api/admin/reset-dev', (req, res) => {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return res.status(403).json({ ok: false, message: 'Tính năng reset bị tắt ở production.' });
  }
  writeDb(emptyDb());
  res.json({ ok: true, message: 'Đã reset dữ liệu local.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Plastic Trash feature-focus server running on http://localhost:${PORT}`);
});
