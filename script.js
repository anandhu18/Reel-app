const API = 'https://api.anthropic.com/v1/messages';

export async function generateScript({ topic, tone, durationSec }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is missing in .env');

  const words = Math.round(durationSec * 2.5);
  const sceneCount = Math.max(3, Math.round(durationSec / 5));

  const system = `You write scripts for short vertical Instagram Reels (faceless, voiceover over stock footage).
Return ONLY a JSON object, no markdown, no commentary:
{
  "title": "short internal title",
  "scenes": [ { "narration": "spoken line", "keywords": "2-3 word stock footage search" } ],
  "caption": "Instagram caption, 1-3 short lines, ends with a question or call to action",
  "hashtags": ["#tag1", "#tag2"]
}
Rules:
- Exactly ${sceneCount} scenes, about ${words} spoken words in total.
- Scene 1 is the hook: a bold, curiosity-driven first line, under 12 words. No greetings.
- Plain spoken language, short sentences, no emojis in narration.
- "keywords" must describe something concrete and filmable (e.g. "coffee shop laptop", "city traffic night"), never abstract ideas.
- Give 6 to 10 hashtags, mix of broad and niche.`;

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: `Topic: ${topic}\nTone: ${tone}\nLength: about ${durationSec} seconds` }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Claude returned no JSON. Try again.');

  const parsed = JSON.parse(text.slice(start, end + 1));
  const scenes = (parsed.scenes || [])
    .filter((s) => s && typeof s.narration === 'string' && s.narration.trim())
    .map((s) => ({ narration: s.narration.trim(), keywords: String(s.keywords || topic).trim() }));
  if (!scenes.length) throw new Error('Script came back empty. Try again.');

  return {
    title: parsed.title || topic,
    scenes,
    caption: String(parsed.caption || '').trim(),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(String) : [],
  };
}
