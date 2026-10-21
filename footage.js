import fs from 'node:fs/promises';

// Returns [{ id, link }] from whichever provider has a key set.
async function searchPexels(query) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&size=medium&per_page=8`;
  const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!res.ok) throw new Error(`Pexels error ${res.status}`);
  const data = await res.json();
  return (data.videos || [])
    .map((v) => {
      const files = (v.video_files || [])
        .filter((f) => f.file_type === 'video/mp4' && f.height >= f.width)
        .sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920));
      const file = files.find((f) => f.height >= 1280) || files[0];
      return file ? { id: `pexels-${v.id}`, link: file.link } : null;
    })
    .filter(Boolean);
}

async function searchPixabay(query) {
  const url = `https://pixabay.com/api/videos/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(query.slice(0, 100))}&per_page=10&safesearch=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pixabay error ${res.status}`);
  const data = await res.json();
  return (data.hits || [])
    .map((h) => {
      const v = h.videos || {};
      const link = (v.large && v.large.url) || (v.medium && v.medium.url) || (v.small && v.small.url);
      return link ? { id: `pixabay-${h.id}`, link } : null;
    })
    .filter(Boolean);
}

const search = (q) => (process.env.PEXELS_API_KEY ? searchPexels(q) : searchPixabay(q));

export async function downloadClip(query, outPath, usedIds) {
  if (!process.env.PEXELS_API_KEY && !process.env.PIXABAY_API_KEY) {
    throw new Error('Add PIXABAY_API_KEY (or PEXELS_API_KEY) in Render environment variables');
  }

  const attempts = [query, query.split(/\s+/).slice(0, 2).join(' '), query.split(/\s+/)[0], 'abstract background'];
  for (const q of attempts) {
    if (!q) continue;
    const clips = await search(q);
    const clip = clips.find((c) => !usedIds.has(c.id)) || clips[0];
    if (!clip) continue;
    usedIds.add(clip.id);
    const res = await fetch(clip.link);
    if (!res.ok) throw new Error(`Clip download failed (${res.status})`);
    await fs.writeFile(outPath, Buffer.from(await res.arrayBuffer()));
    return;
  }
  throw new Error(`No footage found for "${query}". Try a different search.`);
}
