// api/ai.js — Vercel serverless function
// Proxies requests to OpenAI so the API key stays server-side only.
//
// Environment variable required (set in Vercel dashboard → Project → Settings → Environment Variables):
//   OPENAI_KEY   — your OpenAI secret key (sk-...)
//
// The app also falls back to OPENAI_API_KEY for convenience.

export default async function handler(req, res) {
  // ── CORS headers (allow same-origin and Vercel preview URLs) ──────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── API key ────────────────────────────────────────────────────────────────
  const apiKey = process.env.OPENAI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        'OpenAI API key not configured. Set OPENAI_KEY in your Vercel environment variables.',
    });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const {
    system    = 'You are a helpful assistant.',
    message   = '',
    messages  = [],   // prior conversation turns (role: user|assistant)
    maxTokens = 700,
  } = body;

  if (!message && messages.length === 0) {
    return res.status(400).json({ error: 'No message provided' });
  }

  // ── Build the OpenAI messages array ───────────────────────────────────────
  // Filter out error-role messages that the client may have stored locally
  const priorTurns = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  );

  const openAiMessages = [
    { role: 'system', content: system },
    ...priorTurns,
    ...(message ? [{ role: 'user', content: message }] : []),
  ];

  // ── Call OpenAI ────────────────────────────────────────────────────────────
  let openAiRes;
  try {
    openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',           // fast + cheap; swap to gpt-4o if preferred
        max_tokens: Math.min(maxTokens, 2000),
        temperature: 0.7,
        messages: openAiMessages,
      }),
    });
  } catch (networkErr) {
    return res.status(502).json({ error: `Network error reaching OpenAI: ${networkErr.message}` });
  }

  // ── Parse OpenAI response ──────────────────────────────────────────────────
  let data;
  try {
    data = await openAiRes.json();
  } catch {
    return res.status(502).json({ error: 'Invalid response from OpenAI' });
  }

  if (!openAiRes.ok) {
    const errMsg = data?.error?.message || `OpenAI error ${openAiRes.status}`;
    // Surface rate-limit status so the client can show the right message
    if (openAiRes.status === 429) {
      return res.status(429).json({ error: errMsg });
    }
    return res.status(openAiRes.status).json({ error: errMsg });
  }

  const content = data?.choices?.[0]?.message?.content ?? '';
  return res.status(200).json({ content });
}
