/**
 * Guarda a classificação dos fornecedores.
 * Roda como Cloudflare Pages Function; os dados ficam no KV, nunca no repositório.
 * O acesso à página inteira é barrado antes daqui pelo Cloudflare Access.
 */
const CHAVE = 'classificacoes';
const LIMITE = 2 * 1024 * 1024;

const resposta = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const quem = (request) =>
  request.headers.get('cf-access-authenticated-user-email') || 'não identificado';

export async function onRequestGet({ env }) {
  if (!env.PAINEL) return resposta({ erro: 'KV PAINEL não configurado' }, 500);
  const guardado = await env.PAINEL.get(CHAVE);
  return new Response(guardado || JSON.stringify({ itens: {}, atualizadoEm: null }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestPut({ request, env }) {
  if (!env.PAINEL) return resposta({ erro: 'KV PAINEL não configurado' }, 500);

  const texto = await request.text();
  if (texto.length > LIMITE) return resposta({ erro: 'documento grande demais' }, 413);

  let enviado;
  try {
    enviado = JSON.parse(texto);
  } catch {
    return resposta({ erro: 'JSON inválido' }, 400);
  }
  if (!enviado || typeof enviado.itens !== 'object' || Array.isArray(enviado.itens)) {
    return resposta({ erro: 'esperado um objeto em "itens"' }, 400);
  }

  const documento = {
    itens: enviado.itens,
    atualizadoEm: new Date().toISOString(),
    porQuem: quem(request),
  };
  await env.PAINEL.put(CHAVE, JSON.stringify(documento));
  return resposta({ ok: true, atualizadoEm: documento.atualizadoEm, porQuem: documento.porQuem });
}
