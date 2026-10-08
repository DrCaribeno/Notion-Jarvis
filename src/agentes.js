/**
 * Agentes — fila de trabalho (Central de Comandos) e loop de autoaperfeiçoamento
 * (Auditoria de Agentes).
 *
 * O loop: você classifica um output como Inadequado ou Parcial e escreve o que
 * saiu errado. O Jarvis converte a observação em diretriz normativa e injeta na
 * própria página da skill, numa seção que ele mantém. A rotina das 5h, que lê a
 * skill antes de gerar material, passa a obedecer a diretriz. A observação
 * literal vai junto, para nada se perder na tradução.
 */

'use strict';

const axios = require('axios');
const N = require('./notion');

// ── Central de Comandos ───────────────────────────────────────────

const COMANDOS = Object.freeze([
  'Gerar apostila', 'Mini-apostila de correção', 'Questões extras', 'Cards extras',
  'Tirar dúvida', 'Ajustar cronograma', 'Análise semanal', 'Outro',
]);
const STATUS_PEDIDO = Object.freeze({
  pendente: '📥 Pendente', emAndamento: '⏳ Em andamento',
  feito: '✅ Feito', precisoInfo: '↩️ Preciso de info',
});

function montarPropriedadesPedido({ pedido, comando, status, detalhes, resposta, resultado, concluidoEm, topicos }) {
  const props = {};
  if (pedido !== undefined) props['Pedido'] = N.prop.titulo(pedido);
  if (comando !== undefined) props['Comando'] = N.prop.select(comando);
  if (status !== undefined) props['Status'] = N.prop.select(status);
  if (detalhes !== undefined) props['Detalhes'] = N.prop.texto(detalhes);
  if (resposta !== undefined) props['Resposta do Claude'] = N.prop.texto(resposta);
  if (resultado !== undefined) props['Resultado'] = N.prop.url(resultado);
  if (concluidoEm !== undefined) props['Concluído em'] = N.prop.data(concluidoEm);
  if (topicos !== undefined) props['Tópicos'] = N.prop.relacao(topicos);
  // `Pedido em` é created_time (readOnly) — escrever nela devolve validation_error.
  return props;
}

async function buscarPedido(pedido) {
  const paginas = await N.consultarBanco(
    N.IDS.bancos.centralComandos,
    { filter: { property: 'Pedido', title: { equals: pedido } }, page_size: 1 },
    'buscarPedido',
  );
  return paginas[0] || null;
}

/** Cria ou atualiza um pedido. Idempotente pelo título (ADR-003). */
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
  const propriedades = montarPropriedadesPedido(
    existente ? entrada : { status: STATUS_PEDIDO.pendente, ...entrada },
  );

  if (existente) {
    const data = await N.atualizarPagina(existente.id, propriedades, 'gerenciarAgente');
    return { acao: 'atualizado', id: data.id, url: data.url, pedido };
  }
  const data = await N.criarPagina(N.IDS.bancos.centralComandos, propriedades, 'gerenciarAgente');
  return { acao: 'criado', id: data.id, url: data.url, pedido };
}

// ── Auditoria de Agentes ──────────────────────────────────────────

const CLASSIFICACAO = Object.freeze({
  adequado: '✅ Adequado', parcial: '⚠️ Parcial', inadequado: '❌ Inadequado',
});
const STATUS_AUDITORIA = Object.freeze({
  nova: '📥 Nova', emAnalise: '⏳ Em análise', aplicada: '✅ Aplicada', descartada: '⏸️ Descartada',
});

const TITULO_SECAO = '⟳ Diretrizes aprendidas (mantido pelo Jarvis)';

/**
 * Taxonomia de falhas → diretriz normativa.
 * Cada entrada traduz um padrão recorrente de reclamação em uma regra que a
 * skill pode seguir. Mais de um padrão pode casar: todas as diretrizes entram.
 */
const TAXONOMIA = [
  { nome: 'prolixidade', teste: /long[ao]|extens[ao]|prolix|texto demais|muito texto|cansativ|verbos[ao]|arrastad|enrola/i,
    diretriz: 'Cortar prosa: no máximo 8 linhas corridas por tópico. Preferir tabela, esquema e bullet a parágrafo.' },
  { nome: 'falta de esquema', teste: /esquema|diagrama|fluxograma|fluxo|desenh|ilustra|visual|imagem/i,
    diretriz: 'Incluir ao menos um esquema ou fluxograma por tópico, com os passos do mecanismo numerados.' },
  { nome: 'falta de cálculo', teste: /c[áa]lculo|conta|f[óo]rmula|matem[áa]tic|num[ée]ric/i,
    diretriz: 'Incluir no mínimo 2 questões de cálculo com resolução passo a passo (PAM, DC, FE, clearance, Poiseuille, pressão efetiva de filtração).' },
  { nome: 'superficialidade', teste: /superficial|ras[ao]|b[áa]sic|simples demais|pouco profund|[óo]bvi|decoreba/i,
    diretriz: 'Elevar a profundidade ao padrão UFRR: partir de caso clínico ou fármaco e cobrar o mecanismo, não a definição.' },
  { nome: 'falta de clínica', teste: /cl[íi]nic|caso|paciente|aplica[çc]/i,
    diretriz: 'Ancorar cada tópico em um caso clínico com gatilho de prova (paciente de UBS ou do HGR), usando o campo Conexão Clínica do Hub.' },
  { nome: 'cards grandes', teste: /card|anki|flashcard/i,
    diretriz: 'Cards menores: uma ideia por card, resposta em até 2 linhas, sem enumeração longa.' },
  { nome: 'erro factual', teste: /errad|incorret|err[oa]s?\b|equivocad|impreci|confus[ao]|contradi|invent/i,
    diretriz: 'Conferir cada afirmação contra a Leitura declarada no Hub antes de publicar, citando capítulo. Não afirmar o que não estiver na fonte.' },
  { nome: 'pegadinhas ausentes', teste: /pegadinha|armadilha|ponto cego|confund|troca/i,
    diretriz: 'Fechar cada tópico com as pegadinhas correspondentes da lista de Pontos cegos do módulo.' },
  { nome: 'embriologia ausente', teste: /embri/i,
    diretriz: 'Incluir a embriologia correlata: caem de 2 a 4 questões de embriologia em toda prova.' },
  { nome: 'formato', teste: /format|layout|organiza|estrutura|desorganiz|bagun[çc]|padr[ãa]o/i,
    diretriz: 'Padronizar a estrutura de cada tópico: objetivo → mecanismo → esquema → pegadinhas → questões.' },
  { nome: 'questões', teste: /quest[õo]es|simulado|bateria|exerc[íi]cio|prova/i,
    diretriz: 'Cada tópico fecha com bateria no formato da prova: alternativas, somatória, assertivas I–IV e asserção-razão.' },
  { nome: 'SNA transversal', teste: /\bsna\b|aut[ôo]nom|adren|muscarin|simp[áa]tic/i,
    diretriz: 'Tratar o SNA como transversal: marcar α1, β1 e muscarínicos sempre que aparecerem em neuro, cardio e pressão arterial.' },
];

/**
 * Otimizador determinístico (padrão). Converte a observação em diretrizes.
 * Funciona sem credencial de LLM e é reproduzível — a mesma observação sempre
 * gera a mesma diretriz, o que torna a injeção idempotente.
 */
function sintetizarDiretriz(observacao, classificacao) {
  const obs = String(observacao || '').trim();
  if (!obs) return { diretrizes: [], padroes: [], motivo: 'observação vazia' };

  const casados = TAXONOMIA.filter((t) => t.teste.test(obs));
  if (casados.length) {
    return {
      diretrizes: casados.map((t) => t.diretriz),
      padroes: casados.map((t) => t.nome),
      motivo: 'taxonomia',
    };
  }
  // Nenhum padrão conhecido: a observação do Breno vira a regra, literal.
  const severidade = classificacao === CLASSIFICACAO.inadequado ? 'Restrição dura' : 'Ajuste';
  return {
    diretrizes: [`${severidade} vinda da auditoria: ${obs.replace(/\s+/g, ' ')}`],
    padroes: ['literal'],
    motivo: 'sem padrão conhecido — observação usada literalmente',
  };
}

/**
 * Otimizador por LLM (opcional). Só entra em ação se ANTHROPIC_API_KEY existir.
 *
 * ⚠️ Este caminho NÃO foi exercitado: não há credencial de LLM no ambiente da
 * sessão em nuvem. O caminho determinístico acima é o padrão e está testado.
 */
async function sintetizarDiretrizComLLM(observacao, classificacao, nomeAgente) {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error('[sintetizarDiretrizComLLM] ANTHROPIC_API_KEY ausente.');

  const { data } = await axios.post('https://api.anthropic.com/v1/messages', {
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    max_tokens: 400,
    system:
      'Você otimiza prompts de skills de estudo de medicina. Receberá a crítica de um estudante ' +
      'ao output de uma skill. Responda APENAS com 1 a 3 diretrizes imperativas, uma por linha, ' +
      'sem numeração e sem preâmbulo. Cada diretriz deve ser verificável e específica.',
    messages: [{
      role: 'user',
      content: `Skill: ${nomeAgente}\nClassificação: ${classificacao}\nCrítica do estudante: ${observacao}`,
    }],
  }, {
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    timeout: 60000,
  });

  const texto = (data.content || []).map((b) => b.text || '').join('\n');
  const diretrizes = texto.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
  return { diretrizes, padroes: ['llm'], motivo: 'LLM' };
}

/** Lê as auditorias. Por padrão só as que pedem ação. */
async function lerAuditoria({ pendentesApenas = true } = {}) {
  const filtro = pendentesApenas ? {
    and: [
      { or: [
        { property: 'Classificação', select: { equals: CLASSIFICACAO.inadequado } },
        { property: 'Classificação', select: { equals: CLASSIFICACAO.parcial } },
      ] },
      { or: [
        { property: 'Status', select: { equals: STATUS_AUDITORIA.nova } },
        { property: 'Status', select: { equals: STATUS_AUDITORIA.emAnalise } },
      ] },
    ],
  } : undefined;

  const paginas = await N.consultarBanco(
    N.IDS.bancos.auditoriaAgentes,
    filtro ? { filter: filtro } : {},
    'lerAuditoria',
  );

  return paginas.map((pagina) => {
    const p = N.lerPropriedades(pagina);
    return {
      id: pagina.id,
      url: pagina.url,
      auditoria: p['Auditoria'],
      agente: p['Agente'],
      classificacao: p['Classificação'],
      observacao: p['Observação'],
      outputAvaliado: p['Output avaliado'],
      status: p['Status'],
      diretrizGerada: p['Diretriz gerada'],
      versao: p['Versão do prompt'],
      topicos: p['Tópicos'] || [],
    };
  });
}

/**
 * Localiza a seção de diretrizes na página da skill; cria se não existir.
 * A seção é um toggle, e não um heading, porque toggles aceitam filhos — assim
 * a injeção cai sempre dentro da seção, sem depender da ordem dos blocos.
 */
async function obterSecaoDiretrizes(paginaId, { criar = true } = {}) {
  const blocos = await N.lerBlocos(paginaId, 'obterSecaoDiretrizes');
  const existente = blocos.find((b) => b.type === 'toggle' && N.textoDoBloco(b).includes('Diretrizes aprendidas'));
  if (existente) return { id: existente.id, criada: false };
  if (!criar) return null;

  const resultado = await N.anexarBlocos(paginaId, [{
    object: 'block', type: 'toggle',
    toggle: {
      rich_text: [{ text: { content: TITULO_SECAO } }],
      color: 'orange_background',
      children: [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ text: {
          content: 'Seção mantida automaticamente a partir da Auditoria de Agentes. '
            + 'Cada item nasceu de uma observação sua sobre um output inadequado. '
            + 'Edite à vontade: o Jarvis só acrescenta, nunca apaga o que você escreveu.',
        } }] },
      }],
    },
  }], 'obterSecaoDiretrizes');

  return { id: resultado.results[0].id, criada: true };
}

/**
 * Injeta diretrizes na seção, sem duplicar.
 * A comparação ignora o prefixo de data e versão: o que identifica uma diretriz
 * é o seu texto, então reaplicar a mesma auditoria não polui a skill.
 */
async function injetarDiretrizes(paginaId, diretrizes, meta) {
  const secao = await obterSecaoDiretrizes(paginaId);
  const existentes = await N.lerBlocos(secao.id, 'injetarDiretrizes');
  const textosExistentes = existentes.map((b) => N.textoDoBloco(b));

  const novas = diretrizes.filter((d) => !textosExistentes.some((t) => t.includes(d)));
  const duplicadas = diretrizes.length - novas.length;

  if (!novas.length) return { secaoId: secao.id, injetadas: 0, duplicadas, versao: textosExistentes.length };

  const versao = textosExistentes.filter((t) => t.startsWith('[')).length + 1;
  const children = novas.map((d) => ({
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { text: { content: `[${meta.data} · v${versao}] ` }, annotations: { code: true } },
        { text: { content: d, link: null }, annotations: { bold: true } },
        { text: { content: `  ⟨auditoria: "${String(meta.observacao || '').replace(/\s+/g, ' ').slice(0, 300)}"⟩` },
          annotations: { italic: true, color: 'gray' } },
      ],
    },
  }));

  await N.anexarBlocos(secao.id, children, 'injetarDiretrizes');
  return { secaoId: secao.id, injetadas: novas.length, duplicadas, versao, secaoCriada: secao.criada };
}

/**
 * Loop de autoaperfeiçoamento: lê a Auditoria, sintetiza diretrizes, injeta nas
 * skills e fecha as auditorias.
 *
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.aplicar=false] Sem isto, só mostra o que faria.
 * @param {boolean} [opcoes.usarLLM]       Força o otimizador por LLM (precisa de chave).
 */
async function otimizarAgentes({ aplicar = false, usarLLM = Boolean(process.env.ANTHROPIC_API_KEY) } = {}) {
  const auditorias = await lerAuditoria({ pendentesApenas: true });
  const data = N.hoje();
  const resultados = [];

  for (const a of auditorias) {
    const paginaSkill = N.IDS.agentes[a.agente];
    if (!paginaSkill) {
      resultados.push({ auditoria: a.auditoria, url: a.url, erro:
        `Agente "${a.agente || '(vazio)'}" não mapeado. Aceitos: ${Object.keys(N.IDS.agentes).join(' · ')}` });
      continue;
    }
    if (!String(a.observacao || '').trim()) {
      resultados.push({ auditoria: a.auditoria, url: a.url, erro:
        'Observação vazia — sem ela não há o que otimizar. Descreva o que saiu errado.' });
      continue;
    }

    let sintese;
    try {
      sintese = usarLLM
        ? await sintetizarDiretrizComLLM(a.observacao, a.classificacao, a.agente)
        : sintetizarDiretriz(a.observacao, a.classificacao);
    } catch (erro) {
      // LLM indisponível não trava o loop: cai no determinístico e avisa.
      sintese = sintetizarDiretriz(a.observacao, a.classificacao);
      sintese.motivo += ` (LLM falhou: ${erro.message})`;
    }

    const registro = {
      auditoria: a.auditoria, url: a.url, agente: a.agente,
      classificacao: a.classificacao, observacao: a.observacao,
      diretrizes: sintese.diretrizes, padroes: sintese.padroes, motivo: sintese.motivo,
    };

    if (aplicar) {
      const injecao = await injetarDiretrizes(paginaSkill, sintese.diretrizes, {
        data, observacao: a.observacao,
      });
      await N.atualizarPagina(a.id, {
        Status: N.prop.select(STATUS_AUDITORIA.aplicada),
        'Diretriz gerada': N.prop.texto(sintese.diretrizes.join(' | ')),
        'Aplicado em': N.prop.data(data),
        'Versão do prompt': N.prop.numero(injecao.versao),
      }, 'otimizarAgentes');
      Object.assign(registro, injecao);
    }
    resultados.push(registro);
  }

  const aplicadas = resultados.filter((r) => r.injetadas > 0).length;
  if (aplicar && aplicadas) {
    await N.registrarDiario({
      registro: `Skills ajustadas pela auditoria · ${aplicadas}`,
      tipo: 'Ajuste do Motor',
      oQueFoiFeito: resultados.filter((r) => r.injetadas > 0)
        .map((r) => `${r.agente}: +${r.injetadas} diretriz(es) [${(r.padroes || []).join(', ')}]`).join('\n'),
      ajustes: resultados.flatMap((r) => r.diretrizes || []).join('\n'),
    });
  }

  return {
    aplicado: aplicar,
    otimizador: usarLLM ? 'LLM' : 'determinístico',
    auditoriasPendentes: auditorias.length,
    aplicadas,
    resultados,
  };
}

module.exports = {
  COMANDOS, STATUS_PEDIDO, CLASSIFICACAO, STATUS_AUDITORIA, TAXONOMIA, TITULO_SECAO,
  gerenciarAgente, buscarPedido, montarPropriedadesPedido,
  lerAuditoria, sintetizarDiretriz, sintetizarDiretrizComLLM,
  obterSecaoDiretrizes, injetarDiretrizes, otimizarAgentes,
};
