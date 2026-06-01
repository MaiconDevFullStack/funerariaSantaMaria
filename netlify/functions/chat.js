/**
 * Netlify Function — /api/chat
 * RAG + Groq (llama-3.3-70b) para conversas naturais com base estrita na KB.
 * Fallback automático para RAG puro se GROQ_API_KEY não estiver configurada.
 *
 * Variável de ambiente necessária no painel Netlify:
 *   GROQ_API_KEY=gsk_...
 */

const fs   = require('fs');
const path = require('path');

// ── Carrega a KB ──────────────────────────────────────────────────────────────
function loadKB() {
  // Em produção (Netlify), kb.json é bundled junto com a function
  // Em desenvolvimento local, sobe dois níveis até a raiz do projeto
  const candidates = [
    path.join(__dirname, 'kb.json'),        // bundled (produção)
    path.join(__dirname, '../../kb.json'),  // local dev
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch { /* tenta próximo */ }
  }
  console.error('[chat] kb.json não encontrado em nenhum caminho');
  return { entradas: [] };
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

  return entradas
    .map(entrada => {
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
    })
    .sort((a, b) => b.score - a.score);
}

// ── Monta contexto com as melhores entradas RAG ───────────────────────────────
function buildContext(results, topN = 5) {
  return results
    .slice(0, topN)
    .filter(r => r.score > 0)
    .map((r, i) =>
      `[Entrada ${i + 1}]\nPergunta de referência: ${r.entrada.pergunta}\nInformação: ${r.entrada.resposta}`
    )
    .join('\n\n---\n\n');
}

// ── Chama a API da Groq ──────────────────────────────────────────────────────
async function callGroq(userMessage, context, apiKey) {
  const systemPrompt = `Você é o assistente virtual da Funerária Santa Maria, uma empresa de serviços funerários que atua 24 horas por dia com amor, respeito e dignidade.

REGRAS OBRIGATÓRIAS — siga todas sem exceção:
1. Responda SOMENTE com base nas informações da BASE DE CONHECIMENTO fornecida abaixo.
2. Se a pergunta não puder ser respondida com as informações disponíveis, diga que não possui essa informação no momento e oriente o cliente a entrar em contato pelo WhatsApp (11) 98765-4321.
3. NUNCA invente preços, serviços, datas ou informações que não constem na base de conhecimento.
4. Seja empático, acolhedor e respeitoso — o cliente pode estar vivendo um momento de dor profunda.
5. Use linguagem natural e calorosa, como uma conversa humana genuína.
6. Seja objetivo e direto, sem rodeios desnecessários.
7. Não mencione que você é uma IA, que consultou uma base de dados ou que tem limitações técnicas.
8. Quando listar itens, use formatação clara com marcadores ou quebras de linha.

BASE DE CONHECIMENTO:
${context}`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
      max_tokens:  700,
      temperature: 0.35,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
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

  const kb           = loadKB();
  const results      = ragSearch(message, kb);
  const best         = results[0];
  const THRESHOLD    = 3;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  // Nenhuma entrada relevante → retorna fallback direto (sem chamar LLM)
  if (!best || best.score < THRESHOLD) {
    const fallback = kb.entradas.find(e => e.id === 'fallback');
    const respostaFallback = fallback
      ? mdToHtml(fallback.resposta)
      : 'Não consegui encontrar uma resposta. Por favor, entre em contato pelo WhatsApp <strong>(11) 98765-4321</strong>.';
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id:        'fallback',
        resposta:  respostaFallback,
        score:     0,
        sessionId: sessionId || 'default',
        source:    'rag-fallback',
      }),
    };
  }

  // Encontrou contexto relevante — tenta Groq se API key disponível
  if (GROQ_API_KEY) {
    try {
      const context      = buildContext(results);
      const grokResponse = await callGroq(message, context, GROQ_API_KEY);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          id:        best.entrada.id,
          resposta:  mdToHtml(grokResponse),
          score:     best.score,
          sessionId: sessionId || 'default',
          source:    'grok-rag',
        }),
      };
    } catch (err) {
      // Grok falhou — log e fallback para RAG puro
      console.error('[chat] Groq API falhou, usando RAG puro:', err.message);
    }
  }

  // RAG puro (sem API key ou após erro do Grok)
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      id:        best.entrada.id,
      resposta:  mdToHtml(best.entrada.resposta),
      score:     best.score,
      sessionId: sessionId || 'default',
      source:    'rag',
    }),
  };
};
