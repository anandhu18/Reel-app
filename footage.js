import fs from 'node:fs/promises';

async function search(query) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=8`;
  const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!res.ok) throw new Error(`Pexels error ${res.status}`);
  const data = await res.json();
  return data.videos || [];
}

function pickFile(video) {
  const files = (video.video_files || [])
    .filter((f) => f.file_type === 'video/mp4' && f.height >= f.width)
    .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920));
  return files.find((f) => f.height >= 1280) || files[0];
}

export async function downloadClip(query, outPath, usedIds) {
  if (!process.env.PEXELS_API_KEY) throw new Error('PEXELS_API_KEY is missing in .env');

  const attempts = [query, query.split(/\s+/).slice(0, 2).join(' '), query.split(/\s+/)[0], 'abstract background'];
  for (const q of attempts) {
    if (!q) continue;
    const videos = await search(q);
    const video = videos.find((v) => !usedIds.has(v.id) && pickFile(v)) || videos.find((v) => pickFile(v));
    if (!video) continue;
    usedIds.add(video.id);
    const file = pickFile(video);
    const res = await fetch(file.link);
    if (!res.ok) throw new Error(`Clip download failed (${res.status})`);
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error(`No footage found for "${query}". Try a different search.`);
}
