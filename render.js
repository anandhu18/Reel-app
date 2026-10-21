import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadClip } from './footage.js';
import { synthesize, voiceEnabled } from './voice.js';

const run = promisify(execFile);
const ff = (args, cwd) => run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd, maxBuffer: 1 << 26 });

async function duration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(stdout.trim());
}

const ts = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return `${h}:${String(m).padStart(2, '0')}:${sec}`;
};

function buildAss(scenes, durations) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Arial,88,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,80,80,520,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
  let t = 0;
  const lines = [];
  scenes.forEach((scene, i) => {
    const words = scene.narration.replace(/[{}\\]/g, '').split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let w = 0; w < words.length; w += 3) chunks.push(words.slice(w, w + 3).join(' ').toUpperCase());
    const total = words.length || 1;
    let cursor = t;
    chunks.forEach((chunk) => {
      const n = chunk.split(' ').length;
      const len = (durations[i] * n) / total;
      lines.push(`Dialogue: 0,${ts(cursor)},${ts(cursor + len)},Default,,0,0,0,,${chunk}`);
      cursor += len;
    });
    t += durations[i];
  });
  return header + lines.join('\n') + '\n';
}

export async function renderReel({ id, scenes, outDir, workRoot, onProgress }) {
  const dir = path.join(workRoot, id);
  await fs.mkdir(dir, { recursive: true });
  const withVoice = voiceEnabled();
  const used = new Set();
  const durations = [];
  const sceneFiles = [];
  const audioFiles = [];

  try {
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const base = Math.round((i / scenes.length) * 80);
      onProgress(base, `Scene ${i + 1} of ${scenes.length}: finding footage`);
      const raw = path.join(dir, `raw_${i}.mp4`);
      await downloadClip(s.keywords || s.narration, raw, used);

      let dur;
      let voicePath = null;
      if (withVoice) {
        onProgress(base + 3, `Scene ${i + 1} of ${scenes.length}: recording voiceover`);
        voicePath = path.join(dir, `voice_${i}.mp3`);
        await synthesize(s.narration, voicePath);
        dur = (await duration(voicePath)) + 0.3;
      } else {
        dur = Math.max(2.5, s.narration.split(/\s+/).length / 2.6);
      }
      durations.push(dur);

      onProgress(base + 6, `Scene ${i + 1} of ${scenes.length}: cutting`);
      const sceneOut = path.join(dir, `scene_${i}.mp4`);
      await ff([
        '-stream_loop', '-1', '-i', raw, '-t', dur.toFixed(2),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1',
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', sceneOut,
      ]);
      sceneFiles.push(sceneOut);

      if (voicePath) {
        const aOut = path.join(dir, `audio_${i}.m4a`);
        await ff(['-i', voicePath, '-af', 'apad', '-t', dur.toFixed(2), '-ar', '44100', '-ac', '2', '-c:a', 'aac', aOut]);
        audioFiles.push(aOut);
      }
    }

    onProgress(85, 'Joining scenes');
    await fs.writeFile(path.join(dir, 'video.txt'), sceneFiles.map((f) => `file '${path.basename(f)}'`).join('\n'));
    await ff(['-f', 'concat', '-safe', '0', '-i', 'video.txt', '-c', 'copy', 'joined.mp4'], dir);

    if (withVoice) {
      await fs.writeFile(path.join(dir, 'audio.txt'), audioFiles.map((f) => `file '${path.basename(f)}'`).join('\n'));
      await ff(['-f', 'concat', '-safe', '0', '-i', 'audio.txt', '-c', 'copy', 'voice.m4a'], dir);
    }

    onProgress(92, 'Adding captions');
    await fs.writeFile(path.join(dir, 'captions.ass'), buildAss(scenes, durations));
    await fs.mkdir(outDir, { recursive: true });
    const finalPath = path.join(outDir, `${id}.mp4`);
    const inputs = withVoice ? ['-i', 'joined.mp4', '-i', 'voice.m4a'] : ['-i', 'joined.mp4'];
    const audioArgs = withVoice ? ['-c:a', 'aac', '-b:a', '160k', '-shortest'] : ['-an'];
    await ff([
      ...inputs, '-vf', 'subtitles=captions.ass',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      ...audioArgs, '-movflags', '+faststart', finalPath,
    ], dir);

    onProgress(100, 'Done');
    return finalPath;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
