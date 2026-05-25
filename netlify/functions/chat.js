/**
 * Netlify Function — /api/chat
 * Converte o endpoint POST /api/chat do server.js para serverless.
 */

const fs   = require('fs');
const path = require('path');

// ── Carrega a KB ──────────────────────────────────────────────────────────────
function loadKB() {
  const kbPath = path.join(__dirname, '../../kb.json');
  try {
    return JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  } catch {
    return { entradas: [] };
  }
}

// ── Normalização ──────────────────────────────────────────────────────────────
function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tokeniza em uni + bi-gramas ───────────────────────────────────────────────
function tokenize(text) {
  const words   = normalize(text).split(' ').filter(w => w.length >= 2);
  const bigrams = words.slice(0, -1).map((w, i) => w + ' ' + words[i + 1]);
  return [...words, ...bigrams];
}

// ── Motor RAG ─────────────────────────────────────────────────────────────────
function ragSearch(query, kb) {
  const queryNorm   = normalize(query);
  const queryTokens = tokenize(query);
  const entradas    = kb.entradas.filter(e => e.id !== 'fallback');

  const scored = entradas.map(entrada => {
    let score = 0;

    for (const tag of entrada.tags) {
      const normTag = normalize(tag);
      if (queryNorm.includes(normTag)) score += normTag.includes(' ') ? 20 : 10;
    }

    const pergNorm = normalize(entrada.pergunta);
    for (const token of queryTokens) {
      if (pergNorm.includes(token)) score += 3;
    }

    const respNorm = normalize(entrada.resposta);
    for (const token of queryTokens) {
      if (token.length >= 4 && respNorm.includes(token)) score += 1;
    }

    return { entrada, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ── Markdown → HTML ───────────────────────────────────────────────────────────
function mdToHtml(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^•\s/gm, '• ')
    .replace(/\n/g, '<br>');
}

// ── Handler Netlify ───────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido.' }) };
  }

  const { message, sessionId } = body;

  if (!message || typeof message !== 'string') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Campo "message" é obrigatório.' }),
    };
  }

  const kb      = loadKB();
  const results = ragSearch(message, kb);
  const best    = results[0];
  const THRESHOLD = 3;

  const entradaSelecionada =
    !best || best.score < THRESHOLD
      ? kb.entradas.find(e => e.id === 'fallback')
      : best.entrada;

  const htmlText = mdToHtml(entradaSelecionada.resposta);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      id:        entradaSelecionada.id,
      resposta:  htmlText,
      score:     best ? best.score : 0,
      sessionId: sessionId || 'default',
    }),
  };
};
