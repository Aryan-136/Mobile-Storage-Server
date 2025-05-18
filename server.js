// server.js
const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const ffmpeg  = require('fluent-ffmpeg');
const path    = require('path');
const fs      = require('fs-extra');
const http    = require('http');
const socketio= require('socket.io');
const archiver= require('archiver');
const FileType= require('file-type');
const { execFile } = require('child_process');
const Database= require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const THUMB_ROOT  = path.join(__dirname, 'thumbs');
const DB_FILE     = path.join(__dirname, 'files.db');

// Ensure folders exist
fs.ensureDirSync(UPLOAD_ROOT);
fs.ensureDirSync(THUMB_ROOT);

// Setup DB
const db = new Database(DB_FILE);
db.prepare(`CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  user TEXT,
  relpath TEXT,
  filename TEXT,
  mimetype TEXT,
  size INTEGER,
  created INTEGER
)`).run();

// Multer storage with relative path preserved
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Save files under uploads/username/ + relative folder structure
    const username = req.body.username;
    if (!username) return cb(new Error('Missing username'));
    const relPath = file.originalname.includes('/') ? file.originalname : file.originalname;
    const userDir = path.join(UPLOAD_ROOT, username);
    await fs.ensureDir(userDir);
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    // Keep original filename (supports subfolders via preservePath)
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage,
  preservePath: true,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    // Accept all, virus scan later
    cb(null, true);
  }
}).any();

// Scan file for virus using ClamAV
async function scanFile(filepath) {
  return new Promise((res, rej) => {
    execFile('clamscan', ['--no-summary', filepath], (err, stdout, stderr) => {
      if (err) return rej(new Error('Virus detected or scan error'));
      res(true);
    });
  });
}

// Generate thumbnail for image/video
async function makeThumbnail(user, relpath, fullpath) {
  const thumbDir = path.join(THUMB_ROOT, user, path.dirname(relpath));
  await fs.ensureDir(thumbDir);
  const baseName = path.basename(relpath);
  const thumbPath = path.join(thumbDir, baseName + '.jpg');

  if (fullpath.match(/\.(jpg|jpeg|png|gif)$/i)) {
    // Image thumb
    await sharp(fullpath).resize(300).jpeg({ quality: 80 }).toFile(thumbPath);
  } else if (fullpath.match(/\.(mp4|mov|avi|mkv)$/i)) {
    // Video thumb
    await new Promise((res, rej) =>
      ffmpeg(fullpath)
        .screenshots({ count: 1, filename: baseName + '.jpg', folder: thumbDir })
        .on('end', res)
        .on('error', rej)
    );
  } else {
    // No thumbnail for other files
    return null;
  }
  return path.relative(THUMB_ROOT, thumbPath).replace(/\\/g, '/');
}

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_ROOT));
app.use('/thumbs', express.static(THUMB_ROOT));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Upload endpoint
app.post('/upload', (req, res) => {
  upload(req, res, async err => {
    if (err) return res.status(400).send(err.message);

    const username = req.body.username;
    if (!username) return res.status(400).send('Missing username');

    try {
      // For each file: virus scan, thumbnail, DB insert, notify client
      for (const file of req.files) {
        await scanFile(file.path);

        // Verify MIME type matches extension
        const type = await FileType.fromFile(file.path);
        if (!type || !file.mimetype.includes(type.mime.split('/')[0])) {
          await fs.unlink(file.path);
          return res.status(400).send('File type mismatch or disallowed');
        }

        // Calculate relative path from user's root folder
        const relpath = path.relative(path.join(UPLOAD_ROOT, username), file.path).replace(/\\/g, '/');

        const thumbRel = await makeThumbnail(username, relpath, file.path);

        // Insert into DB
        db.prepare(`INSERT INTO files (user, relpath, filename, mimetype, size, created) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(username, relpath, file.originalname, file.mimetype, file.size, Date.now());

        // Notify all clients viewing this user about new file
        io.to(username).emit('fileAdded', {
          relpath,
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          thumb: thumbRel ? '/thumbs/' + thumbRel : null
        });
      }

      res.json({ success: true });
    } catch (e) {
      console.error(e);
      res.status(500).send('Upload failed: ' + e.message);
    }
  });
});

// Search endpoint
app.get('/search', (req, res) => {
  const { username, q = '', type = '' } = req.query;
  if (!username) return res.status(400).send('Missing username');

  let sql = `SELECT * FROM files WHERE user = ?`;
  const params = [username];

  if (q) {
    sql += ` AND filename LIKE ?`;
    params.push(`%${q}%`);
  }
  if (type) {
    sql += ` AND mimetype LIKE ?`;
    params.push(type + '%');
  }

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ZIP download
app.get('/zip/:user', (req, res) => {
  const user = req.params.user;
  const userDir = path.join(UPLOAD_ROOT, user);
  if (!fs.existsSync(userDir)) return res.status(404).send('User folder not found');

  res.attachment(`${user}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.directory(userDir, false);
  archive.pipe(res);
  archive.finalize();
});

// Socket.io connection
io.on('connection', socket => {
  console.log('Socket connected', socket.id);

  socket.on('joinUser', username => {
    socket.join(username);
    // Send current files for this user
    const rows = db.prepare('SELECT * FROM files WHERE user = ?').all(username);
    socket.emit('fileList', rows);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
