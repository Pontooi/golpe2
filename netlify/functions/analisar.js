// Função serverless do Netlify: faz a ponte com o Hugging Face.
// O token fica na variável de ambiente HF_TOKEN, definida no painel do Netlify.
const MODELO = process.env.HF_MODEL || 'ealvaradob/bert-finetuned-phishing';
const HF_URL = `https://router.huggingface.co/hf-inference/models/${MODELO}`;
const MAX_CHARS = 1000;
const LIMITE_POR_MIN = 10;

// Limite por IP em memória (vale só por instância da função: é um freio básico, não garantia)
const acessos = new Map();
function excedeuLimite(ip) {
  const agora = Date.now();
  const lista = (acessos.get(ip) || []).filter(t => agora - t < 60000);
  lista.push(agora);
  acessos.set(ip, lista);
  return lista.length > LIMITE_POR_MIN;
}

const resp = (status, obj) => ({
  statusCode: status,
  headers: {'Content-Type': 'application/json; charset=utf-8'},
  body: JSON.stringify(obj)
});

function melhorRotulo(dados) {
  const lista = Array.isArray(dados[0]) ? dados[0] : dados;
  if (!Array.isArray(lista) || !lista.length || typeof lista[0].label !== 'string') return null;
  return lista.reduce((a, b) => (b.score > a.score ? b : a));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resp(405, {erro: 'use POST'});
  const token = process.env.HF_TOKEN;
  if (!token) return resp(503, {erro: 'servidor sem token configurado'});
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'desconhecido';
  if (excedeuLimite(ip)) return resp(429, {erro: 'muitas consultas, aguarde um minuto'});

  let texto;
  try {
    if ((event.body || '').length > 10000) return resp(413, {erro: 'texto muito grande'});
    texto = JSON.parse(event.body || '{}').texto;
  } catch {
    return resp(400, {erro: 'pedido inválido'});
  }
  if (typeof texto !== 'string' || texto.trim().length < 5) return resp(400, {erro: 'texto muito curto'});

  try {
    const r = await fetch(HF_URL, {
      method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({inputs: texto.trim().slice(0, MAX_CHARS)}),
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 503) return resp(502, {erro: 'modelo carregando, tente de novo em instantes'});
    if (!r.ok) return resp(502, {erro: `Hugging Face respondeu ${r.status}`});
    const topo = melhorRotulo(await r.json());
    if (!topo) return resp(502, {erro: 'resposta inesperada do modelo'});
    // Ajuste conforme os rótulos do modelo escolhido
    const suspeito = /phish|scam|spam|fraud|malicious|label_1/.test(topo.label.toLowerCase());
    return resp(200, {suspeito, rotulo: topo.label, score: topo.score});
  } catch (e) {
    console.error('erro:', e.message, e.cause ? `(${e.cause.code || e.cause.message})` : '');
    return resp(502, {erro: e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha ao consultar o Hugging Face'});
  }
};
