const msg = document.getElementById('msg');
const out = document.getElementById('out');
const iaBox = document.getElementById('ia');
const btn = document.getElementById('go');

const rules = [
  {n:'Pressa ou ameaça', re:/urgente|imediatamente|agora mesmo|hoje mesmo|ainda hoje|em 24 ?h(?:oras)?|última chance|bloquead[ao]|suspens[ao]/gi, w:'Quem aplica golpe cria medo e pressa para você não parar para conferir.'},
  {n:'Pedido de senha ou código', re:/senha|código de (?:verifica\w+|segurança|acesso)|token|confirme seus dados|informe seus dados/gi, w:'Banco e empresas não pedem senha nem código por mensagem. Nunca repasse.'},
  {n:'Dinheiro ou taxa adiantada', re:/\bpix\b|transfer[êe]ncia|pague uma taxa|taxa de cadastro|depósito|pagamento antecipado/gi, w:'Antes de pagar, confirme quem pediu e por quê, por um canal que você já conhecia.'},
  {n:'Link para resolver um problema', re:/clique (?:aqui|neste link)|acesse o link|link abaixo|(?:bit\.ly|tinyurl\.com)\/\S*|https?:\/\/\S+/gi, w:'O link pode levar a uma página falsa. Abra o app ou digite o endereço oficial você mesmo.'},
  {n:'Prêmio ou oferta inesperada', re:/parabéns|foi selecionad[oa]|você ganhou|prêmio|renda extra|vaga garantida/gi, w:'Desconfie de benefício que ninguém prometeu e que exige pagamento ou dados.'},
  {n:'Troca de número ou de canal', re:/troquei de número|número novo|sou eu|meu celular quebrou|não consigo atender/gi, w:'Ligue para o número antigo da pessoa antes de fazer qualquer coisa.'}
];

const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function analisarRegras(t) {
  const hits = [];
  rules.forEach((r, i) => { for (const m of t.matchAll(r.re)) hits.push({s: m.index, e: m.index + m[0].length, i}); });
  hits.sort((a, b) => a.s - b.s);
  let html = '', pos = 0;
  const used = [];
  for (const h of hits) {
    if (h.s < pos) continue;
    html += esc(t.slice(pos, h.s)) + '<mark>' + esc(t.slice(h.s, h.e)) + '</mark>';
    pos = h.e;
    if (!used.includes(h.i)) used.push(h.i);
  }
  html += esc(t.slice(pos));
  return {html, used};
}

function renderRegras({html, used}) {
  let body = '<div class="msg">' + html + '</div>';
  if (used.length) {
    body += '<p class="count">' + used.length + (used.length > 1 ? ' sinais encontrados' : ' sinal encontrado') + '</p><dl>' +
      used.map(i => '<dt>' + rules[i].n + '</dt><dd>' + rules[i].w + '</dd>').join('') + '</dl>' +
      '<div class="next"><p><strong>Antes de responder:</strong> não clique, não pague e não mande código. Confirme com a pessoa ou a empresa por um canal que você mesmo encontrou.</p></div>';
  } else {
    body += '<p class="count">Nada marcado</p><p>O texto não tem os padrões que esta página reconhece. Confira mesmo assim quem enviou e, se pedir dinheiro ou dados, confirme por outro canal.</p>';
  }
  return body;
}

function renderIA(r) {
  if (r.error) {
    return '<div class="ai"><h3>Segunda opinião da IA</h3><p>Não foi possível consultar a IA agora (' + esc(r.error) + '). Vale o resultado das marcações acima.</p></div>';
  }
  const pct = Math.round(r.score * 100);
  const texto = r.suspeito
    ? 'O modelo achou a mensagem <strong>suspeita</strong> (' + pct + '% de confiança).'
    : 'O modelo não achou sinais claros de golpe (' + pct + '% de confiança).';
  return '<div class="ai"><h3>Segunda opinião da IA</h3><p>' + texto + '</p>' +
    '<p class="fine">É uma estimativa de um modelo automático e pode errar, principalmente em português. Não a trate como garantia.</p></div>';
}

async function consultarIA(texto) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch('/api/analisar', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({texto}),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) return {error: dados.erro || 'erro ' + resp.status};
    return dados;
  } catch (e) {
    return {error: e.name === 'AbortError' ? 'tempo esgotado' : 'servidor indisponível'};
  }
}

btn.onclick = async () => {
  const t = msg.value.trim();
  if (!t) { msg.focus(); return; }
  const regras = analisarRegras(t);
  out.innerHTML = renderRegras(regras);
  out.hidden = false;
  out.scrollIntoView({behavior: 'smooth', block: 'nearest'});

  if (iaBox.checked) {
    const slot = document.createElement('div');
    slot.innerHTML = '<div class="ai"><p>Consultando a IA…</p></div>';
    out.appendChild(slot);
    btn.disabled = true;
    const r = await consultarIA(t);
    slot.innerHTML = renderIA(r);
    btn.disabled = false;
  }
};

document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { msg.value = b.dataset.t; msg.focus(); });
