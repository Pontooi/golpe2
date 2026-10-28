// Servidor sem dependências (Node 18+). Serve o site e faz a ponte com o Hugging Face,
// para que o token nunca apareça no navegador.
const http = require('http');
const fs = require('fs');
const path = require('path');

// Carrega .env simples (HF_TOKEN=...)
try {
  for (const linha of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const PORT = process.env.PORT || 3000;
const HF_TOKEN = process.env.HF_TOKEN;
const MODELO = process.env.HF_MODEL || 'ealvaradob/bert-finetuned-phishing';
const HF_URL = `https://router.huggingface.co/hf-inference/models/${MODELO}`;
const MAX_CHARS = 1000;
const LIMITE_POR_MIN = 10;

const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/script.js': ['script.js', 'text/javascript; charset=utf-8']
};

// Limite simples por IP (em memória)
const acessos = new Map();
function excedeuLimite(ip) {
  const agora = Date.now();
  const lista = (acessos.get(ip) || []).filter(t => agora - t < 60000);
  lista.push(agora);
  acessos.set(ip, lista);
  return lista.length > LIMITE_POR_MIN;
}

function json(res, status, obj) {
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', c => { dados += c; if (dados.length > 10000) { reject(new Error('grande')); req.destroy(); } });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

// A API pode devolver [{label,score},...] ou [[{label,score},...]]
function melhorRotulo(resp) {
  const lista = Array.isArray(resp[0]) ? resp[0] : resp;
  if (!Array.isArray(lista) || !lista.length || typeof lista[0].label !== 'string') return null;
  return lista.reduce((a, b) => (b.score > a.score ? b : a));
}

async function analisar(texto) {
  const r = await fetch(HF_URL, {
    method: 'POST',
    headers: {Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({inputs: texto}),
    signal: AbortSignal.timeout(15000)
  });
  if (r.status === 503) throw new Error('modelo carregando, tente de novo em instantes');
  if (!r.ok) throw new Error(`Hugging Face respondeu ${r.status}`);
  const topo = melhorRotulo(await r.json());
  if (!topo) throw new Error('resposta inesperada do modelo');
  const rotulo = topo.label.toLowerCase();
  // Ajuste conforme os rótulos do modelo escolhido
  const suspeito = /phish|scam|spam|fraud|malicious|label_1/.test(rotulo);
  return {suspeito, rotulo: topo.label, score: topo.score};
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'POST' && url === '/api/analisar') {
    if (!HF_TOKEN) return json(res, 503, {erro: 'servidor sem token configurado'});
    if (excedeuLimite(req.socket.remoteAddress)) return json(res, 429, {erro: 'muitas consultas, aguarde um minuto'});
    try {
      const {texto} = JSON.parse(await lerCorpo(req));
      if (typeof texto !== 'string' || texto.trim().length < 5) return json(res, 400, {erro: 'texto muito curto'});
      return json(res, 200, await analisar(texto.trim().slice(0, MAX_CHARS)));
    } catch (e) {
      console.error('erro:', e.message);
      return json(res, 502, {erro: e.message});
    }
  }

  const est = req.method === 'GET' && ESTATICOS[url];
  if (est) {
    return fs.readFile(path.join(__dirname, 'public', est[0]), (err, buf) => {
      if (err) { res.writeHead(404); return res.end('não encontrado'); }
      res.writeHead(200, {'Content-Type': est[1]});
      res.end(buf);
    });
  }
  res.writeHead(404); res.end('não encontrado');
}).listen(PORT, () => console.log(`http://localhost:${PORT}  (modelo: ${MODELO})${HF_TOKEN ? '' : '  ATENÇÃO: HF_TOKEN não definido'}`));
