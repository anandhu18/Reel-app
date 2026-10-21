import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateScript } from './script.js';
import { renderReel } from './render.js';
import { voiceEnabled } from './voice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'output');
const WORK = path.join(__dirname, 'work');

const app = express();
app.use(express.json({ limit: '1mb' }));

// Optional password so strangers can't spend your API credits
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, b64] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Basic' && b64) {
      const pass = Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':');
      if (pass === process.env.APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Reel Studio"').status(401).send('Password required');
  });
}
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/videos', express.static(OUT));

app.get('/api/config', (_req, res) => {
  res.json({
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    pexels: Boolean(process.env.PEXELS_API_KEY || process.env.PIXABAY_API_KEY),
    voice: voiceEnabled(),
  });
});

app.post('/api/script', async (req, res) => {
  try {
    const topic = String(req.body.topic || '').trim().slice(0, 200);
    if (!topic) return res.status(400).json({ error: 'Enter a topic first.' });
    const tone = String(req.body.tone || 'energetic').slice(0, 40);
    const durationSec = Math.min(60, Math.max(10, Number(req.body.durationSec) || 30));
    res.json(await generateScript({ topic, tone, durationSec }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// One render at a time keeps ffmpeg from overloading a small server.
const jobs = new Map();
let queue = Promise.resolve();

app.post('/api/render', (req, res) => {
  const scenes = Array.isArray(req.body.scenes) ? req.body.scenes : [];
  const clean = scenes
    .map((s) => ({ narration: String(s.narration || '').trim().slice(0, 400), keywords: String(s.keywords || '').trim().slice(0, 80) }))
    .filter((s) => s.narration);
  if (!clean.length || clean.length > 12) return res.status(400).json({ error: 'Add between 1 and 12 scenes.' });

  const id = crypto.randomBytes(6).toString('hex');
  const job = { status: 'queued', progress: 0, step: 'Waiting in queue' };
  jobs.set(id, job);

  queue = queue.then(async () => {
    job.status = 'working';
    try {
      await renderReel({
        id, scenes: clean, outDir: OUT, workRoot: WORK,
        onProgress: (p, step) => { job.progress = p; job.step = step; },
      });
      job.status = 'done';
      job.url = `/videos/${id}.mp4`;
    } catch (e) {
      console.error(e);
      job.status = 'error';
      job.error = e.stderr ? String(e.stderr).slice(0, 300) : e.message;
    }
  });

  res.json({ id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Reel Studio running at http://localhost:${port}`));
