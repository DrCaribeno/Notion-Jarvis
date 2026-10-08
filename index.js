/**
 * Jarvis · Núcleo de automação do Notion
 * ------------------------------------------------------------------
 * Antes de alterar este arquivo, leia `jarvis_architecture_log.md`.
 * As decisões não óbvias daqui (axios como transporte, Notion-Version
 * fixada em 2022-06-28) estão justificadas lá como ADR-001 e ADR-002.
 */

'use strict';

const axios = require('axios');
const { Client } = require('@notionhq/client');

// ── Configuração ──────────────────────────────────────────────────

const NOTION_VERSION = '2022-06-28'; // ADR-002: data_sources indisponível p/ esta integração
const BASE_URL = 'https://api.notion.com/v1';

/**
 * ADR-001: nesta sessão o agent proxy injeta o header Authorization nas
 * requisições para api.notion.com, então o token local é um placeholder.
 * Na sua máquina não há proxy e o NOTION_TOKEN do .env é usado de verdade.
 * O mesmo código serve aos dois ambientes.
 */
const NOTION_TOKEN = process.env.NOTION_TOKEN || 'proxy-injected-placeholder';

/** Mapa de IDs — espelha a seção 4 do log de arquitetura. Única fonte de verdade. */
const IDS = {
  paginas: {
    hub: '3f24414dac76812abcf5d0285b6738b3',
    motor: '3f24414dac76814f939ccc7e2b7cefcc',
    perfil: '3f24414dac7681adb316e534fb21dddd',
    indiceMateriais: '3f24414dac768103bd26ff0839c241b7',
    skillGerarApostila: '3f24414dac768199a591e16b34590b22',
    skillRotina5h: '3f24414dac7681f4b803fa4e7f5510e3',
    skillAnaliseSemanal: '3f24414dac7681a39f2accf2432eb736',
    blueprintAutomacao: '3f24414dac768129a7dcda035dec69e6',
  },
  bancos: {
    cronograma: '2b274f511f8e4409b0322f6a0f4b7043',
    hubControle: 'c4891265091e45b794551d561b969fab',
    centralComandos: '637e5706ca2343df8044326c1b517c91',
    diarioMotor: '9975790b8f8149529b92884b242ee36b',
    bibliotecaApostilas: '55d58868acc641a58708c6dfc0ce39e8',
    registroQuestoes: 'b8528bc3d95545bdb62ad7c6e4a0bc7d',
    filaAnki: 'b30fa0bab1d84dc5a4d2767b7ccc6342',
    repositorioVisual: 'f038c9b39ac64baa8a2487598b4fbd63',
  },
  /** data_source_id para a migração futura à API 2025-09-03 (ADR-002). */
  colecoes: {
    cronograma: 'af17ee56-06ee-40b7-89ac-1899d3ed7b1b',
    hubControle: 'a374d5c8-4f9a-48fc-946e-4883b4f039ec',
    centralComandos: 'a4b69910-a163-4042-9a06-b2f6699343b6',
    diarioMotor: '0bd5b810-3fa5-4ea3-8fa9-813bd72da4fe',
    bibliotecaApostilas: 'f6e5eb83-b268-4ff8-aa0f-c639239def90',
    registroQuestoes: 'eedd4b51-07b3-44b6-9071-1e00b30aa1d2',
    filaAnki: 'fd8e8e6d-ee4a-4ec1-9047-4b3cbdc56a4a',
    repositorioVisual: '72d53f7b-18bc-4fac-92d6-24d68cd10689',
  },
};

/** Valores de select aceitos pela Central de Comandos (seção 5 do log). */
const COMANDOS = Object.freeze([
  'Gerar apostila', 'Mini-apostila de correção', 'Questões extras', 'Cards extras',
  'Tirar dúvida', 'Ajustar cronograma', 'Análise semanal', 'Outro',
]);
const STATUS_PEDIDO = Object.freeze({
  pendente: '📥 Pendente',
  emAndamento: '⏳ Em andamento',
  feito: '✅ Feito',
  precisoInfo: '↩️ Preciso de info',
});

// ── Transporte ────────────────────────────────────────────────────

/** Instância axios — o transporte real de tudo (ADR-001). */
const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  },
});

/**
 * SDK oficial apoiado no axios. Sem este shim, o fetch nativo do Node furaria
 * o proxy e receberia 401 (ADR-001). Com ele, o SDK fica disponível para os
 * endpoints de conveniência sem abrir mão da autenticação.
 */
const notion = new Client({
  auth: NOTION_TOKEN,
  notionVersion: NOTION_VERSION,
  fetch: async (url, init = {}) => {
    const resposta = await http.request({
      url: String(url).replace(BASE_URL, ''),
      method: init.method || 'GET',
      data: init.body ? JSON.parse(init.body) : undefined,
      validateStatus: () => true, // o SDK interpreta o status por conta própria
    });
    return new Response(JSON.stringify(resposta.data), {
      status: resposta.status,
      headers: { 'content-type': 'application/json' },
    });
  },
});

/** Converte um erro da API em algo que explica a si mesmo. */
function traduzirErro(erro, contexto) {
  const status = erro.response?.status;
  const dados = erro.response?.data || {};
  const base = `[${contexto}] ${status || erro.code || 'erro'}: ${dados.message || erro.message}`;

  // Diagnósticos acionáveis — a diferença entre 400 e 404 importa (ADR-002).
  if (status === 404) {
    return new Error(`${base}\n  → O objeto existe mas não está compartilhado com a integração ` +
      `"ClaudeCode". Compartilhe o Hub Central MED 1.5 (seção 3 do log de arquitetura).`);
  }
  if (status === 400 && dados.code === 'invalid_request_url') {
    return new Error(`${base}\n  → Rota indisponível para esta integração. Confira NOTION_VERSION (ADR-002).`);
  }
  if (status === 401) {
    return new Error(`${base}\n  → Token inválido. Fora da sessão em nuvem, defina NOTION_TOKEN no .env.`);
  }
  return new Error(base);
}

// ── Normalização de propriedades ──────────────────────────────────

/**
 * Achata uma propriedade do Notion no valor JavaScript correspondente.
 * Sem isto, todo consumidor precisaria conhecer o formato interno de cada tipo.
 */
function lerPropriedade(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return (prop[prop.type] || []).map((t) => t.plain_text).join('') || null;
    case 'number':
      return prop.number;
    case 'checkbox':
      return prop.checkbox;
    case 'select':
      return prop.select?.name ?? null;
    case 'status':
      return prop.status?.name ?? null;
    case 'multi_select':
      return (prop.multi_select || []).map((o) => o.name);
    case 'date':
      return prop.date ? { inicio: prop.date.start, fim: prop.date.end } : null;
    case 'url':
      return prop.url;
    case 'relation':
      return (prop.relation || []).map((r) => r.id);
    case 'created_time':
      return prop.created_time;
    case 'last_edited_time':
      return prop.last_edited_time;
    case 'formula': {
      const f = prop.formula || {};
      return f[f.type] ?? null;
    }
    case 'rollup': {
      const r = prop.rollup || {};
      if (r.type === 'array') return (r.array || []).map(lerPropriedade);
      return r[r.type] ?? null;
    }
    default:
      return null;
  }
}

/** Achata todas as propriedades de uma página. */
function lerPropriedades(pagina) {
  const saida = {};
  for (const [nome, prop] of Object.entries(pagina.properties || {})) {
    saida[nome] = lerPropriedade(prop);
  }
  return saida;
}

/** Consulta um banco paginando até o fim — a API devolve no máximo 100 por vez. */
async function consultarBanco(bancoId, corpo = {}, contexto = 'consultarBanco') {
  const paginas = [];
  let cursor;
  do {
    try {
      const { data } = await http.post(`/databases/${bancoId}/query`, {
        ...corpo,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      paginas.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } catch (erro) {
      throw traduzirErro(erro, contexto);
    }
  } while (cursor);
  return paginas;
}

// ── FUNÇÃO 1 · Leitura do cronograma ──────────────────────────────

/**
 * Lê o Cronograma de Ataque com as propriedades e o status de cada dia.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.de]        Data inicial ISO `YYYY-MM-DD` (inclusive)
 * @param {string} [opcoes.ate]       Data final ISO `YYYY-MM-DD` (inclusive)
 * @param {boolean} [opcoes.hoje]     Atalho para o dia de hoje
 * @param {boolean} [opcoes.pendentes] Apenas dias ainda não marcados como Feito
 * @param {string} [opcoes.semana]    Filtra por uma opção de `Semana`
 * @returns {Promise<Array<object>>}  Dias normalizados, em ordem cronológica
 */
async function lerCronograma(opcoes = {}) {
  const { de, ate, hoje, pendentes, semana } = opcoes;
  const condicoes = [];

  // `É hoje` é fórmula e não é filtrável por SQL; filtramos por `Data` (seção 5).
  const dataHoje = new Date().toISOString().slice(0, 10);
  if (hoje) {
    condicoes.push({ property: 'Data', date: { equals: dataHoje } });
  } else {
    if (de) condicoes.push({ property: 'Data', date: { on_or_after: de } });
    if (ate) condicoes.push({ property: 'Data', date: { on_or_before: ate } });
  }
  if (pendentes) condicoes.push({ property: 'Feito', checkbox: { equals: false } });
  if (semana) condicoes.push({ property: 'Semana', select: { equals: semana } });

  const paginas = await consultarBanco(
    IDS.bancos.cronograma,
    {
      ...(condicoes.length ? { filter: { and: condicoes } } : {}),
      sorts: [{ property: 'Data', direction: 'ascending' }],
    },
    'lerCronograma',
  );

  return paginas.map((pagina) => {
    const p = lerPropriedades(pagina);
    return {
      id: pagina.id,
      url: pagina.url,
      dia: p['Dia'],
      data: p['Data']?.inicio ?? null,
      semana: p['Semana'],
      horas: p['Horas'],
      // Status do dia, derivado de duas propriedades distintas.
      status: {
        feito: p['Feito'] === true,
        apostila: p['Apostila'],           // 📥 Pedir · ⏳ Gerando · ✅ Pronta
        atrasado: p['Feito'] !== true && p['Data']?.inicio
          ? p['Data'].inicio < dataHoje
          : false,
      },
      plano: {
        ler: p['Ler'],
        esquematizar: p['Resumir / Esquematizar'],
        exercicio: p['Exercício ativo'],
      },
      revisoesProgramadas: p['Revisões programadas'], // ⚠️ texto livre — defeito 1 do log
      eventosDoModulo: p['Eventos do módulo'],        // ⚠️ agenda em prosa — defeito 2
      relacoes: {
        topicos: p['Tópicos'] || [],
        apostilaDoDia: p['Apostila do dia'] || [],
      },
    };
  });
}

// ── FUNÇÃO 2 · Escrita de agentes ─────────────────────────────────

/** Monta o payload de propriedades da Central de Comandos, omitindo o que não veio. */
function montarPropriedadesPedido({ pedido, comando, status, detalhes, resposta, resultado, concluidoEm, topicos }) {
  const props = {};
  if (pedido !== undefined) props['Pedido'] = { title: [{ text: { content: pedido } }] };
  if (comando !== undefined) props['Comando'] = { select: { name: comando } };
  if (status !== undefined) props['Status'] = { select: { name: status } };
  if (detalhes !== undefined) props['Detalhes'] = { rich_text: [{ text: { content: detalhes } }] };
  if (resposta !== undefined) props['Resposta do Claude'] = { rich_text: [{ text: { content: resposta } }] };
  if (resultado !== undefined) props['Resultado'] = { url: resultado };
  if (concluidoEm !== undefined) props['Concluído em'] = { date: { start: concluidoEm } };
  if (topicos !== undefined) props['Tópicos'] = { relation: topicos.map((id) => ({ id })) };
  // `Pedido em` é created_time (readOnly) — escrever nela devolve validation_error.
  return props;
}

/** Procura um pedido pelo título exato. Base da idempotência (ADR-003). */
async function buscarPedido(pedido) {
  const paginas = await consultarBanco(
    IDS.bancos.centralComandos,
    { filter: { property: 'Pedido', title: { equals: pedido } }, page_size: 1 },
    'buscarPedido',
  );
  return paginas[0] || null;
}

/**
 * Cria ou atualiza um pedido de agente na Central de Comandos.
 *
 * Idempotente por ADR-003: se já existir um pedido com o mesmo título, atualiza
 * em vez de duplicar. Chamar duas vezes com a mesma entrada é seguro.
 *
 * @param {object} entrada
 * @param {string} entrada.pedido        Título — também a chave de idempotência
 * @param {string} [entrada.comando]     Um de COMANDOS
 * @param {string} [entrada.status]      Um de STATUS_PEDIDO (padrão: pendente ao criar)
 * @param {string} [entrada.detalhes]    O que se quer, em uma ou duas frases
 * @param {string} [entrada.resposta]    Retorno do agente
 * @param {string} [entrada.resultado]   URL do material gerado
 * @param {string} [entrada.concluidoEm] Data ISO de fechamento
 * @param {string[]} [entrada.topicos]   IDs de páginas do Hub Central de Controle
 * @returns {Promise<{acao:'criado'|'atualizado', id:string, url:string, pedido:string}>}
 */
async function gerenciarAgente(entrada) {
  const { pedido, comando, status } = entrada;

  if (!pedido || !String(pedido).trim()) {
    throw new Error('[gerenciarAgente] `pedido` é obrigatório — é a chave de idempotência.');
  }
  if (comando && !COMANDOS.includes(comando)) {
    throw new Error(`[gerenciarAgente] comando inválido: "${comando}".\n  Aceitos: ${COMANDOS.join(' · ')}`);
  }
  const statusValidos = Object.values(STATUS_PEDIDO);
  if (status && !statusValidos.includes(status)) {
    throw new Error(`[gerenciarAgente] status inválido: "${status}".\n  Aceitos: ${statusValidos.join(' · ')}`);
  }

  const existente = await buscarPedido(pedido);

  // Ao criar, um pedido sem status entra como pendente — a fila nunca recebe linha órfã.
  const propriedades = montarPropriedadesPedido(
    existente ? entrada : { status: STATUS_PEDIDO.pendente, ...entrada },
  );

  try {
    if (existente) {
      const { data } = await http.patch(`/pages/${existente.id}`, { properties: propriedades });
      return { acao: 'atualizado', id: data.id, url: data.url, pedido };
    }
    const { data } = await http.post('/pages', {
      parent: { database_id: IDS.bancos.centralComandos },
      properties: propriedades,
    });
    return { acao: 'criado', id: data.id, url: data.url, pedido };
  } catch (erro) {
    throw traduzirErro(erro, 'gerenciarAgente');
  }
}

// ── Diagnóstico ───────────────────────────────────────────────────

/**
 * Verifica a autenticação e o alcance real da integração banco por banco.
 * É o primeiro comando a rodar numa sessão nova: diz exatamente o que falta.
 */
async function diagnostico() {
  console.log('\n🔎 Jarvis · diagnóstico\n' + '─'.repeat(58));
  console.log(`Notion-Version : ${NOTION_VERSION}`);
  console.log(`Token          : ${process.env.NOTION_TOKEN ? 'do ambiente (.env)' : 'injetado pelo proxy'}`);

  // 1. Autenticação
  let bot;
  try {
    const { data } = await http.get('/users/me');
    bot = data;
    console.log(`Autenticação   : ✅ "${data.name}" em "${data.bot?.workspace_name}"`);
  } catch (erro) {
    console.error(`Autenticação   : ❌ ${traduzirErro(erro, 'users/me').message}`);
    return { ok: false, etapa: 'autenticacao' };
  }

  // 2. Alcance — quantos objetos a integração enxerga
  let visiveis = 0;
  try {
    const { data } = await http.post('/search', { page_size: 100 });
    visiveis = data.results.length;
    console.log(`Objetos visíveis: ${visiveis === 0 ? '⚠️  0' : `✅ ${visiveis}`}`);
  } catch (erro) {
    console.log(`Objetos visíveis: ❌ ${traduzirErro(erro, 'search').message}`);
  }

  // 3. Cada banco, individualmente
  console.log('\nBancos de dados:');
  const relatorio = [];
  for (const [nome, id] of Object.entries(IDS.bancos)) {
    try {
      const { data } = await http.get(`/databases/${id}`);
      const titulo = (data.title || []).map((t) => t.plain_text).join('') || nome;
      console.log(`  ✅ ${nome.padEnd(20)} ${titulo}`);
      relatorio.push({ nome, id, ok: true });
    } catch (erro) {
      const status = erro.response?.status;
      const motivo = status === 404 ? 'não compartilhado com a integração' :
        erro.response?.data?.message || erro.message;
      console.log(`  ❌ ${nome.padEnd(20)} ${status || '?'} — ${motivo}`);
      relatorio.push({ nome, id, ok: false, status });
    }
  }

  const alcancaveis = relatorio.filter((r) => r.ok).length;
  console.log('\n' + '─'.repeat(58));
  console.log(`Alcance: ${alcancaveis}/${relatorio.length} bancos.`);

  if (alcancaveis === 0) {
    console.log(
      '\n⚠️  AÇÃO NECESSÁRIA — um passo manual, só você pode fazer:\n' +
      '    A integração autentica, mas nada foi compartilhado com ela.\n\n' +
      '    No Notion, abra o Hub Central MED 1.5 → ⋯ (canto superior direito)\n' +
      `    → Conexões → adicione "${bot.name}".\n\n` +
      '    O acesso é herdado pelas subpáginas, então esse único passo\n' +
      '    destrava os 8 bancos. Depois, rode este diagnóstico de novo.\n',
    );
  } else if (alcancaveis < relatorio.length) {
    console.log('    Compartilhe o Hub Central MED 1.5 para herdar o acesso aos bancos restantes.\n');
  } else {
    console.log('    Tudo alcançável. Jarvis operacional. ✅\n');
  }

  return { ok: alcancaveis > 0, alcancaveis, total: relatorio.length, relatorio };
}

// ── CLI ───────────────────────────────────────────────────────────

const COMANDOS_CLI = {
  async diagnostico() {
    const r = await diagnostico();
    process.exitCode = r.ok ? 0 : 1;
  },

  async cronograma(args) {
    const hoje = args.includes('--hoje');
    const pendentes = args.includes('--pendentes');
    const valor = (flag) => {
      const i = args.indexOf(flag);
      return i !== -1 ? args[i + 1] : undefined;
    };
    const dias = await lerCronograma({
      hoje, pendentes, de: valor('--de'), ate: valor('--ate'), semana: valor('--semana'),
    });

    console.log(`\n📅 Cronograma de Ataque — ${dias.length} dia(s)\n` + '─'.repeat(58));
    for (const d of dias) {
      const marca = d.status.feito ? '✅' : d.status.atrasado ? '🔴' : '⬜';
      console.log(`${marca} ${d.data || '(sem data)'}  ${d.dia || ''}`);
      if (d.horas) console.log(`     ${d.horas}h · ${d.semana || '—'} · apostila: ${d.status.apostila || '—'}`);
      if (d.plano.ler) console.log(`     Ler: ${d.plano.ler}`);
      if (d.revisoesProgramadas) console.log(`     Revisões: ${d.revisoesProgramadas}`);
      if (d.eventosDoModulo) console.log(`     Eventos: ${d.eventosDoModulo}`);
    }
    if (!dias.length) console.log('(nenhum dia encontrado para esse filtro)');
    console.log('');
  },

  async agente(args) {
    const [pedido, comando, ...resto] = args;
    if (!pedido) {
      console.error('Uso: node index.js agente "<pedido>" "<comando>" ["<detalhes>"]');
      console.error(`Comandos: ${COMANDOS.join(' · ')}`);
      process.exitCode = 1;
      return;
    }
    const r = await gerenciarAgente({
      pedido,
      comando: comando || 'Outro',
      detalhes: resto.join(' ') || undefined,
    });
    console.log(`\n✅ Pedido ${r.acao}: "${r.pedido}"\n   ${r.url}\n`);
  },

  ids() {
    console.log(JSON.stringify(IDS, null, 2));
  },

  ajuda() {
    console.log(`
Jarvis · automação do Notion

  node index.js diagnostico              Verifica autenticação e alcance (comece por aqui)
  node index.js cronograma [filtros]     Lê o Cronograma de Ataque
      --hoje | --pendentes | --de <AAAA-MM-DD> | --ate <AAAA-MM-DD> | --semana "<nome>"
  node index.js agente "<pedido>" "<comando>" ["<detalhes>"]
                                         Cria ou atualiza um pedido na Central de Comandos
  node index.js ids                      Imprime o mapa de IDs
  node index.js ajuda                    Esta mensagem

Antes de alterar o código, leia jarvis_architecture_log.md.
`);
  },
};

async function main() {
  const [comando = 'ajuda', ...args] = process.argv.slice(2);
  const executar = COMANDOS_CLI[comando];
  if (!executar) {
    console.error(`Comando desconhecido: "${comando}"`);
    COMANDOS_CLI.ajuda();
    process.exitCode = 1;
    return;
  }
  try {
    await executar(args);
  } catch (erro) {
    console.error(`\n❌ ${erro.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  IDS, COMANDOS, STATUS_PEDIDO,
  http, notion,
  lerCronograma, gerenciarAgente, buscarPedido, diagnostico,
  lerPropriedade, lerPropriedades, consultarBanco,
};
