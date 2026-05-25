/**
 * server.js — Backend RAG da Funerária Santa Maria
 * Tecnologia: Node.js + Express
 *
 * Inicie com: node server.js
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, true), // aceita file://, localhost e qualquer origem
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.options('*', cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Carrega a KB (hot-reload automático a cada requisição em dev) ─────────────
function loadKB() {
  const kbPath = path.join(__dirname, 'kb.json');
  try {
    return JSON.parse(fs.readFileSync(kbPath, 'utf-8'));
  } catch {
    return { entradas: [] };
  }
}

// ── Normalização de texto ─────────────────────────────────────────────────────
function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tokeniza query em n-gramas (uni + bi) ─────────────────────────────────────
function tokenize(text) {
  const words = normalize(text).split(' ').filter(w => w.length >= 2);
  const bigrams = words.slice(0, -1).map((w, i) => w + ' ' + words[i + 1]);
  return [...words, ...bigrams];
}

// ── Motor RAG: scoring híbrido tag + TF-IDF ───────────────────────────────────
function ragSearch(query, kb) {
  const queryNorm   = normalize(query);
  const queryTokens = tokenize(query);

  const entradas = kb.entradas.filter(e => e.id !== 'fallback');

  const scored = entradas.map(entrada => {
    let score = 0;

    // 1. Match exato de tags (peso máximo)
    for (const tag of entrada.tags) {
      const normTag = normalize(tag);
      if (queryNorm.includes(normTag)) {
        score += normTag.includes(' ') ? 20 : 10; // bigram tag vale mais
      }
    }

    // 2. Match parcial de tokens na pergunta (peso médio)
    const pergNorm = normalize(entrada.pergunta);
    for (const token of queryTokens) {
      if (pergNorm.includes(token)) score += 3;
    }

    // 3. Match na resposta (peso menor — contexto amplo)
    const respNorm = normalize(entrada.resposta);
    for (const token of queryTokens) {
      if (token.length >= 4 && respNorm.includes(token)) score += 1;
    }

    return { entrada, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ── Formata resposta Markdown → HTML simples ──────────────────────────────────
function mdToHtml(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^•\s/gm, '• ')
    .replace(/\n/g, '<br>');
}

// ── Histórico de conversa por sessão (em memória) ─────────────────────────────
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { history: [], createdAt: Date.now() });
  }
  return sessions.get(sessionId);
}

// Limpa sessões inativas (> 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) sessions.delete(id);
  }
}, 5 * 60 * 1000);

// ── POST /api/chat ─────────────────────────────────────────────────────────────
app.post('/api/chat', (req, res) => {
  const { message, sessionId } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Campo "message" é obrigatório.' });
  }

  const sid = sessionId || 'default';
  const session = getSession(sid);
  const kb = loadKB();

  // Salva mensagem do usuário no histórico
  session.history.push({ role: 'user', text: message, ts: Date.now() });

  // Busca RAG
  const results = ragSearch(message, kb);
  const best    = results[0];
  const THRESHOLD = 3;

  let entradaSelecionada;

  if (!best || best.score < THRESHOLD) {
    entradaSelecionada = kb.entradas.find(e => e.id === 'fallback');
  } else {
    entradaSelecionada = best.entrada;
  }

  const rawText  = entradaSelecionada.resposta;
  const htmlText = mdToHtml(rawText);

  // Salva resposta no histórico
  session.history.push({ role: 'assistant', text: rawText, ts: Date.now() });

  // Limita histórico a 20 mensagens
  if (session.history.length > 20) session.history.splice(0, session.history.length - 20);

  return res.json({
    id:        entradaSelecionada.id,
    resposta:  htmlText,
    score:     best ? best.score : 0,
    sessionId: sid,
    history:   session.history.length
  });
});

// ── GET /api/kb ────────────────────────────────────────────────────────────────
app.get('/api/kb', (req, res) => {
  const kb = loadKB();
  const resumo = kb.entradas.map(e => ({
    id:       e.id,
    pergunta: e.pergunta,
    tags:     e.tags
  }));
  res.json({ meta: kb.meta, total: resumo.length, entradas: resumo });
});

// ── GET /api/kb/search?q= ──────────────────────────────────────────────────────
app.get('/api/kb/search', (req, res) => {
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'Parâmetro "q" é obrigatório.' });

  const kb      = loadKB();
  const results = ragSearch(q, kb).slice(0, 5);

  res.json(results.map(r => ({
    id:       r.entrada.id,
    score:    r.score,
    pergunta: r.entrada.pergunta
  })));
});

// ── GET /health ────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const kb = loadKB();
  res.json({ status: 'ok', kbEntradas: kb.entradas.length, porta: PORT });
});

// ── Inicia servidor ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🕯️  Funerária Santa Maria — Chat RAG');
  console.log('─'.repeat(40));
  console.log(`  Servidor: http://localhost:${PORT}`);
  console.log(`  API Chat: POST http://localhost:${PORT}/api/chat`);
  console.log(`  KB Info:  GET  http://localhost:${PORT}/api/kb`);
  console.log(`  Health:   GET  http://localhost:${PORT}/health`);
  console.log('─'.repeat(40) + '\n');
});
