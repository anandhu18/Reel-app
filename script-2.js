const API = 'https://api.anthropic.com/v1/messages';


async function viaGemini(system, userMsg) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 4000,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

async function viaClaude(system, userMsg) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).map((b) => (b.type === 'text' ? b.text : '')).join('');
}

export async function generateScript({ topic, tone, durationSec }) {
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('Add GEMINI_API_KEY in Render environment variables');
  }

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

  const userMsg = `Topic: ${topic}\nTone: ${tone}\nLength: about ${durationSec} seconds`;
  const text = process.env.GEMINI_API_KEY ? await viaGemini(system, userMsg) : await viaClaude(system, userMsg);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('The AI returned no JSON. Try again.');

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
