/**
 * kb-builder.js — Script de formatação da base de conhecimento
 * Funerária Santa Maria
 *
 * Uso:
 *   node kb-builder.js                        → valida e exibe resumo do kb.json
 *   node kb-builder.js --add                  → adiciona nova entrada interativamente
 *   node kb-builder.js --check "sua pergunta" → testa a busca RAG localmente
 *   node kb-builder.js --export               → exporta kb.json formatado/minificado
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const KB_PATH = path.join(__dirname, 'kb.json');

// ── Carrega a KB ──────────────────────────────────────────────────────────────
function loadKB() {
  if (!fs.existsSync(KB_PATH)) {
    console.error('❌  kb.json não encontrado em:', KB_PATH);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(KB_PATH, 'utf-8'));
  } catch (e) {
    console.error('❌  Erro ao parsear kb.json:', e.message);
    process.exit(1);
  }
}

// ── Salva a KB ────────────────────────────────────────────────────────────────
function saveKB(kb) {
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2), 'utf-8');
  console.log('✅  kb.json atualizado com sucesso.');
}

// ── Normaliza texto para comparação ──────────────────────────────────────────
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Busca RAG simples (TF-IDF keyword matching) ───────────────────────────────
function ragSearch(query, kb, topK = 1) {
  const normalizedQuery = normalize(query);
  const queryTokens = normalizedQuery.split(' ');

  const entradas = kb.entradas.filter(e => e.id !== 'fallback');

  const scores = entradas.map(entrada => {
    let score = 0;
    const haystack = normalize(entrada.pergunta + ' ' + entrada.tags.join(' ') + ' ' + entrada.resposta);

    // Pontuação por tags (peso alto)
    for (const tag of entrada.tags) {
      const normTag = normalize(tag);
      if (normalizedQuery.includes(normTag)) score += 10;
    }

    // Pontuação por tokens individuais
    for (const token of queryTokens) {
      if (token.length < 3) continue;
      if (haystack.includes(token)) score += 1;
    }

    return { entrada, score };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

// ── Valida e exibe resumo ─────────────────────────────────────────────────────
function summarize() {
  const kb = loadKB();
  console.log('\n📚  Base de Conhecimento — Funerária Santa Maria');
  console.log('─'.repeat(50));
  console.log(`  Versão:     ${kb.meta.versao}`);
  console.log(`  Atualizado: ${kb.meta.atualizado}`);
  console.log(`  Entradas:   ${kb.entradas.length}`);
  console.log('─'.repeat(50));
  kb.entradas.forEach((e, i) => {
    const tagStr = e.tags.slice(0, 4).join(', ') + (e.tags.length > 4 ? '...' : '');
    console.log(`  [${String(i + 1).padStart(2, '0')}] ${e.id.padEnd(28)} tags: ${tagStr}`);
  });
  console.log('─'.repeat(50));
  console.log('\nUse --check "pergunta" para testar a busca.');
  console.log('Use --add para adicionar nova entrada.\n');
}

// ── Testa busca ───────────────────────────────────────────────────────────────
function checkQuery(query) {
  const kb = loadKB();
  console.log(`\n🔍  Buscando: "${query}"`);
  console.log('─'.repeat(50));

  const results = ragSearch(query, kb, 3);

  if (!results.length || results[0].score === 0) {
    const fallback = kb.entradas.find(e => e.id === 'fallback');
    console.log('⚠️  Nenhum resultado relevante. Respondendo com fallback:');
    console.log('\n' + fallback.resposta);
    return;
  }

  results.forEach(({ entrada, score }, i) => {
    if (score === 0) return;
    console.log(`\n#${i + 1} [score: ${score}] → ${entrada.id}`);
    console.log(`   Pergunta: ${entrada.pergunta}`);
    console.log(`   Resposta: ${entrada.resposta.slice(0, 120)}...`);
  });
  console.log('─'.repeat(50) + '\n');
}

// ── Adiciona nova entrada ─────────────────────────────────────────────────────
async function addEntry() {
  const kb = loadKB();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log('\n➕  Adicionar nova entrada à base de conhecimento\n');

  const id = await ask('ID único (ex: novo_servico): ');
  const pergunta = await ask('Pergunta/título da entrada: ');
  const tagsRaw = await ask('Tags separadas por vírgula (ex: serviço,novo,ajuda): ');
  const resposta = await ask('Resposta completa: ');

  rl.close();

  const tags = tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);

  if (kb.entradas.find(e => e.id === id)) {
    console.error(`\n❌  ID "${id}" já existe. Use um ID diferente.`);
    process.exit(1);
  }

  // Inserir antes do fallback
  const fallbackIndex = kb.entradas.findIndex(e => e.id === 'fallback');
  const newEntry = { id, tags, pergunta, resposta };

  if (fallbackIndex >= 0) {
    kb.entradas.splice(fallbackIndex, 0, newEntry);
  } else {
    kb.entradas.push(newEntry);
  }

  kb.meta.atualizado = new Date().toISOString().slice(0, 10);
  saveKB(kb);
  console.log(`\n✅  Entrada "${id}" adicionada com ${tags.length} tag(s).\n`);
}

// ── Export minificado ──────────────────────────────────────────────────────────
function exportKB() {
  const kb = loadKB();
  const outPath = path.join(__dirname, 'kb.min.json');
  fs.writeFileSync(outPath, JSON.stringify(kb), 'utf-8');
  const size = fs.statSync(outPath).size;
  console.log(`\n✅  Exportado em kb.min.json (${(size / 1024).toFixed(1)} KB)\n`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === '--check' && args[1]) {
  checkQuery(args.slice(1).join(' '));
} else if (args[0] === '--add') {
  addEntry();
} else if (args[0] === '--export') {
  exportKB();
} else {
  summarize();
}
