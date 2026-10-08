/**
 * Camada de transporte e primitivas do Notion.
 * Decisões justificadas em jarvis_architecture_log.md (ADR-001, ADR-002).
 */

'use strict';

const axios = require('axios');
const { Client } = require('@notionhq/client');

const NOTION_VERSION = '2022-06-28'; // ADR-002
const BASE_URL = 'https://api.notion.com/v1';
const NOTION_TOKEN = process.env.NOTION_TOKEN || 'proxy-injected-placeholder';

/** Parâmetros do modelo de capacidade. Sobrescrevíveis por variável de ambiente. */
const JANELA_UTIL_H = Number(process.env.JANELA_UTIL_H || 14);     // janela acordado-produtiva
const TETO_ESTUDO_DIA_H = Number(process.env.TETO_ESTUDO_DIA_H || 6); // regra de adaptação do Motor

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
    compromissos: 'ebb4eacd50eb40249d20cc124a7078b6',       // criado em 2026-10-08
    auditoriaAgentes: '163ee7f987324454a8578e8e0760fb2a',     // criado em 2026-10-08
    terminalCode: 'e13980fc76b447cf824c5eebe584335d',         // criado em 2026-10-08
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
    compromissos: '1de67c6f-c1b3-49f3-a24a-2ed3fb8cc7f3',
    auditoriaAgentes: '8e7588a0-bdc9-4cba-96c3-070aadc93476',
    terminalCode: '7cdb5b46-1af5-4535-b4d3-129592c60bd9',
  },
  /**
   * Blocos nomeados dentro de páginas. Preenchidos quando o bloco é criado —
   * a API do Notion não permite buscar bloco por nome, então o id é registrado
   * aqui. `null` faz o código varrer a página para descobri-lo.
   */
  blocos: {
    // Synced block do Hub onde o Code injeta as respostas. Criado em 2026-10-08.
    displayCode: '9d83ac917556430a92882008ff30cccf',
  },
  /** Agente (opção de select na Auditoria) → página da skill a ser reescrita. */
  agentes: {
    'Gerar Apostila': '3f24414dac768199a591e16b34590b22',
    'Rotina diária das 5h': '3f24414dac7681f4b803fa4e7f5510e3',
    'Análise semanal': '3f24414dac7681a39f2accf2432eb736',
  },
};

// ── Transporte ────────────────────────────────────────────────────

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  },
});

/** SDK oficial apoiado no axios — sem o shim, o fetch nativo fura o proxy (ADR-001). */
const notion = new Client({
  auth: NOTION_TOKEN,
  notionVersion: NOTION_VERSION,
  fetch: async (url, init = {}) => {
    const resposta = await http.request({
      url: String(url).replace(BASE_URL, ''),
      method: init.method || 'GET',
      data: init.body ? JSON.parse(init.body) : undefined,
      validateStatus: () => true,
    });
    return new Response(JSON.stringify(resposta.data), {
      status: resposta.status,
      headers: { 'content-type': 'application/json' },
    });
  },
});

function traduzirErro(erro, contexto) {
  const status = erro.response?.status;
  const dados = erro.response?.data || {};
  const base = `[${contexto}] ${status || erro.code || 'erro'}: ${dados.message || erro.message}`;

  if (status === 404) {
    return new Error(`${base}\n  → O objeto existe mas não está compartilhado com a integração ` +
      `"ClaudeCode". Confirme que o compartilhamento foi feito NESSA integração (seção 3 do log).`);
  }
  if (status === 400 && dados.code === 'invalid_request_url') {
    return new Error(`${base}\n  → Rota indisponível para esta integração. Confira NOTION_VERSION (ADR-002).`);
  }
  if (status === 401) {
    return new Error(`${base}\n  → Token inválido. Fora da sessão em nuvem, defina NOTION_TOKEN no .env.`);
  }
  if (status === 400 && dados.code === 'validation_error') {
    return new Error(`${base}\n  → Propriedade ou valor fora do schema. Nomes têm acento e são sensíveis (seção 5).`);
  }
  return new Error(base);
}

// ── Datas (tudo em UTC para ser determinístico) ───────────────────

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Data de hoje em ISO `YYYY-MM-DD`. */
const hoje = () => new Date().toISOString().slice(0, 10);

/** Extrai `YYYY-MM-DD` de um ISO date ou datetime. */
const soData = (iso) => (iso ? String(iso).slice(0, 10) : null);

/** Soma dias a uma data ISO, devolvendo ISO. */
function somarDias(iso, n) {
  const [a, m, d] = soData(iso).split('-').map(Number);
  const t = Date.UTC(a, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Diferença em dias inteiros entre duas datas ISO (b − a). */
function diffDias(a, b) {
  const ms = (iso) => {
    const [y, m, d] = soData(iso).split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86400000);
}

/** Rótulo do dia da semana de uma data ISO: 'Seg'…'Dom'. */
function diaSemana(iso) {
  const [a, m, d] = soData(iso).split('-').map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

/** Lista as datas ISO de um intervalo, inclusive nas duas pontas. */
function intervaloDatas(de, ate) {
  const saida = [];
  for (let d = soData(de); diffDias(d, soData(ate)) >= 0; d = somarDias(d, 1)) saida.push(d);
  return saida;
}

// ── Normalização de propriedades ──────────────────────────────────

function lerPropriedade(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return (prop[prop.type] || []).map((t) => t.plain_text).join('') || null;
    case 'number': return prop.number;
    case 'checkbox': return prop.checkbox;
    case 'select': return prop.select?.name ?? null;
    case 'status': return prop.status?.name ?? null;
    case 'multi_select': return (prop.multi_select || []).map((o) => o.name);
    case 'date': return prop.date ? { inicio: prop.date.start, fim: prop.date.end } : null;
    case 'url': return prop.url;
    case 'relation': return (prop.relation || []).map((r) => r.id);
    case 'created_time': return prop.created_time;
    case 'last_edited_time': return prop.last_edited_time;
    case 'formula': {
      const f = prop.formula || {};
      return f[f.type] ?? null;
    }
    case 'rollup': {
      const r = prop.rollup || {};
      if (r.type === 'array') return (r.array || []).map(lerPropriedade);
      return r[r.type] ?? null;
    }
    default: return null;
  }
}

function lerPropriedades(pagina) {
  const saida = {};
  for (const [nome, prop] of Object.entries(pagina.properties || {})) {
    saida[nome] = lerPropriedade(prop);
  }
  return saida;
}

/**
 * Extrai uma data ISO de um valor de fórmula, que pode vir como objeto de data,
 * string ISO ou string no formato brasileiro. Devolve null se não houver data.
 * Tolerante de propósito: não sabemos o tipo de retorno das fórmulas do Hub até
 * a primeira leitura real, e um palpite errado produziria datas silenciosamente
 * erradas no cronograma.
 */
function dataDeFormula(valor) {
  if (!valor) return null;
  if (typeof valor === 'object') {
    if (valor.inicio) return soData(valor.inicio);
    if (valor.start) return soData(valor.start);
    return null;
  }
  const texto = String(valor);
  const iso = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const br = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const brCurto = texto.match(/\b(\d{2})\/(\d{2})\b/);
  if (brCurto) return `${new Date().getUTCFullYear()}-${brCurto[2]}-${brCurto[1]}`;
  return null;
}

// ── Operações compostas ───────────────────────────────────────────

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

async function criarPagina(bancoId, propriedades, contexto = 'criarPagina') {
  try {
    const { data } = await http.post('/pages', {
      parent: { database_id: bancoId }, properties: propriedades,
    });
    return data;
  } catch (erro) { throw traduzirErro(erro, contexto); }
}

async function atualizarPagina(paginaId, propriedades, contexto = 'atualizarPagina') {
  try {
    const { data } = await http.patch(`/pages/${paginaId}`, { properties: propriedades });
    return data;
  } catch (erro) { throw traduzirErro(erro, contexto); }
}

/** Lê os blocos filhos de uma página ou bloco, paginando. */
async function lerBlocos(blocoId, contexto = 'lerBlocos') {
  const blocos = [];
  let cursor;
  do {
    try {
      const { data } = await http.get(`/blocks/${blocoId}/children`, {
        params: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
      });
      blocos.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } catch (erro) { throw traduzirErro(erro, contexto); }
  } while (cursor);
  return blocos;
}

/** Anexa blocos filhos a uma página ou bloco. */
async function anexarBlocos(blocoId, children, contexto = 'anexarBlocos') {
  try {
    const { data } = await http.patch(`/blocks/${blocoId}/children`, { children });
    return data;
  } catch (erro) { throw traduzirErro(erro, contexto); }
}

/** Texto plano de um bloco, qualquer que seja o tipo. */
function textoDoBloco(bloco) {
  const corpo = bloco?.[bloco?.type];
  return (corpo?.rich_text || []).map((t) => t.plain_text).join('');
}

/** Atalhos para montar propriedades sem repetir a forma do payload. */
const prop = {
  titulo: (t) => ({ title: [{ text: { content: String(t).slice(0, 2000) } }] }),
  texto: (t) => ({ rich_text: [{ text: { content: String(t ?? '').slice(0, 2000) } }] }),
  select: (n) => ({ select: n ? { name: n } : null }),
  numero: (n) => ({ number: n ?? null }),
  checkbox: (b) => ({ checkbox: Boolean(b) }),
  data: (iso) => ({ date: iso ? { start: iso } : null }),
  url: (u) => ({ url: u || null }),
  relacao: (ids) => ({ relation: (ids || []).map((id) => ({ id })) }),
};

/** Registra uma linha no Diário do Motor. */
async function registrarDiario({ registro, tipo = 'Ajuste do Motor', oQueFoiFeito, ajustes, data }) {
  return criarPagina(IDS.bancos.diarioMotor, {
    Registro: prop.titulo(registro),
    Tipo: prop.select(tipo),
    Data: prop.data(data || hoje()),
    ...(oQueFoiFeito !== undefined ? { 'O que foi feito': prop.texto(oQueFoiFeito) } : {}),
    ...(ajustes !== undefined ? { 'Ajustes no plano': prop.texto(ajustes) } : {}),
  }, 'registrarDiario');
}

module.exports = {
  NOTION_VERSION, BASE_URL, IDS, JANELA_UTIL_H, TETO_ESTUDO_DIA_H,
  http, notion, traduzirErro,
  hoje, soData, somarDias, diffDias, diaSemana, intervaloDatas, DIAS_SEMANA,
  lerPropriedade, lerPropriedades, dataDeFormula,
  consultarBanco, criarPagina, atualizarPagina,
  lerBlocos, anexarBlocos, textoDoBloco,
  prop, registrarDiario,
};
