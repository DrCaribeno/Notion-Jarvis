/**
 * Materiais da Aula — o gatilho do estudo.
 *
 * Desde 09/10 (sessão 6) o estudo de um tema começa quando a professora envia
 * o material: aula, slides, problema do tutorial, conferência, prática, texto
 * ou aviso. Cada linha nova no banco `Materiais da Aula` (Kit = 📥 Novo) vira
 * um pedido de **Kit de estudo** na Central de Comandos — resumo objetivo +
 * exercícios + flashcards no Anki. Não há mais apostila em PDF.
 *
 * Este módulo faz três coisas:
 *   1. `lerMateriais()` / `promoverMateriais()` — move estado (ADR-004: o
 *      Jarvis não escreve fisiologia; quem gera o kit é a skill do Motor).
 *   2. `objetivosDeEstudo()` — extrai, dos materiais já processados, o resumo
 *      que guia as notificações: o que a professora quer e o que ela sinalizou.
 *   3. `sugestoesDeConsolidacao()` — lê os campos Anki · do Hub e traduz em
 *      sugestões sobre como o aprendizado está (ou não) consolidando. É puro
 *      e determinístico: a mesma métrica dá sempre a mesma sugestão.
 */

'use strict';

const N = require('./notion');

const KIT = Object.freeze({
  novo: '📥 Novo', gerando: '⏳ Gerando', pronto: '✅ Pronto', precisoInfo: '↩️ Preciso de info',
});

const TIPOS = Object.freeze([
  'Aula', 'Slides', 'Problema do tutorial', 'Conferência', 'Prática', 'Texto / artigo', 'Aviso',
]);

/** Ordem de atendimento: o problema do tutorial muda o foco de tudo o mais. */
const PRIORIDADE_TIPO = Object.freeze({
  'Problema do tutorial': 0, Aula: 1, 'Conferência': 1, Slides: 2, 'Prática': 3, 'Texto / artigo': 4, Aviso: 5,
});

const COMANDO_KIT = 'Kit de estudo';

// ── Leitura ───────────────────────────────────────────────────────

function normalizarMaterial(pagina) {
  const p = N.lerPropriedades(pagina);
  return {
    id: pagina.id,
    url: pagina.url,
    material: p['Material'],
    tipo: p['Tipo'],
    recebidoEm: N.soData(p['Recebido em']?.inicio),
    encontro: p['Encontro'],
    topicos: p['Tópicos'] || [],
    link: p['Link'],
    kit: p['Kit'],
    objetivos: p['Objetivos de estudo'],
    sinais: p['Sinais de prova'],
    exercicios: p['Exercícios'],
    flashcards: p['Flashcards'],
    baralho: p['Baralho Anki'],
    processadoEm: N.soData(p['Processado em']?.inicio),
    errosNoKit: p['Erros no kit'],
    pedidos: p['Pedido'] || [],
  };
}

/**
 * Lê os materiais da professora.
 * @param {object} [opcoes]
 * @param {string} [opcoes.kit]   Só os que estão nesse estado (`KIT.novo`…)
 * @param {string} [opcoes.desde] Recebidos a partir desta data ISO
 */
async function lerMateriais({ kit, desde } = {}) {
  const condicoes = [];
  if (kit) condicoes.push({ property: 'Kit', select: { equals: kit } });
  if (desde) condicoes.push({ property: 'Recebido em', date: { on_or_after: desde } });

  const paginas = await N.consultarBanco(
    N.IDS.bancos.materiaisAula,
    {
      ...(condicoes.length ? { filter: { and: condicoes } } : {}),
      sorts: [{ property: 'Recebido em', direction: 'descending' }],
    },
    'lerMateriais',
  );
  return paginas.map(normalizarMaterial);
}

// ── Promoção: material novo → pedido de kit ───────────────────────

/** Título determinístico — chave de idempotência do pedido (ADR-003). */
const tituloPedidoDoMaterial = (m) =>
  `${COMANDO_KIT} · ${m.material || '(sem título)'}${m.recebidoEm ? ` (${m.recebidoEm})` : ''}`;

function detalhesDoPedido(m) {
  return [
    m.tipo && `Tipo: ${m.tipo}`,
    m.encontro && `Encontro: ${m.encontro}`,
    m.link && `Link: ${m.link}`,
    'Gerar o kit: objetivos e sinais de prova na página do material; exercícios e flashcards na Fila Anki.',
  ].filter(Boolean).join(' · ');
}

/** Ordena para atendimento: tipo mais urgente primeiro, depois o mais antigo. */
function ordenarParaAtendimento(materiais) {
  return materiais.slice().sort((a, b) =>
    (PRIORIDADE_TIPO[a.tipo] ?? 9) - (PRIORIDADE_TIPO[b.tipo] ?? 9) ||
    String(a.recebidoEm || '9999').localeCompare(String(b.recebidoEm || '9999')));
}

/**
 * Todo material com Kit = 📥 Novo vira um pedido "Kit de estudo" na Central de
 * Comandos e passa a ⏳ Gerando. A Central continua sendo a única fila.
 *
 * Ordem deliberada: o pedido nasce ANTES de o material mudar de estado. Se
 * falhar no meio, o material continua 📥 Novo e a próxima execução tenta de
 * novo — em vez de um material "Gerando" sem pedido nenhum.
 */
async function promoverMateriais({ aplicar = false, registrarNoDiario = true } = {}) {
  const Agentes = require('./agentes');
  const novos = ordenarParaAtendimento(await lerMateriais({ kit: KIT.novo }));

  const acoes = novos.map((m) => ({
    materialId: m.id, material: m.material, tipo: m.tipo, recebidoEm: m.recebidoEm,
    titulo: tituloPedidoDoMaterial(m), detalhes: detalhesDoPedido(m), topicos: m.topicos,
  }));

  let promovidos = 0;
  const resultados = [];
  if (aplicar) {
    for (const a of acoes) {
      const pedido = await Agentes.gerenciarAgente({
        pedido: a.titulo,
        comando: COMANDO_KIT,
        status: Agentes.STATUS_PEDIDO.pendente,
        detalhes: a.detalhes,
        ...(a.topicos.length ? { topicos: a.topicos } : {}),
      });
      await N.atualizarPagina(a.materialId, {
        Kit: N.prop.select(KIT.gerando),
        Pedido: N.prop.relacao([pedido.id]),
      }, 'promoverMateriais');
      resultados.push({ ...a, pedidoUrl: pedido.url, acao: pedido.acao });
      promovidos += 1;
    }
    if (registrarNoDiario && promovidos) {
      await N.registrarDiario({
        registro: `Materiais da professora promovidos a kit · ${promovidos}`,
        tipo: 'Ajuste do Motor',
        oQueFoiFeito: `${promovidos} material(is) com Kit "${KIT.novo}" viraram pedido "${COMANDO_KIT}" ` +
          `na Central de Comandos e passaram a "${KIT.gerando}".`,
        ajustes: resultados.map((x) => `${x.recebidoEm || '—'}: ${x.titulo}`).join('\n'),
      });
    }
  }

  return { aplicado: aplicar, novos: novos.length, aPromover: acoes, promovidos, resultados };
}

// ── Objetivos de estudo (o que guia a notificação) ────────────────

/**
 * Dos materiais já processados, os que entraram na janela recente, com os
 * objetivos e sinais que a professora deixou. Puro: recebe a lista e devolve.
 */
function objetivosDeEstudo(materiais, { dias = 7, hoje = N.hoje() } = {}) {
  const desde = N.somarDias(hoje, -Math.max(0, dias));
  const prontos = (materiais || []).filter((m) => m.kit === KIT.pronto);
  const recentes = prontos
    .filter((m) => {
      const ref = m.processadoEm || m.recebidoEm;
      return !ref || N.diffDias(desde, ref) >= 0;
    })
    .sort((a, b) => String(b.recebidoEm || '').localeCompare(String(a.recebidoEm || '')));

  const pendentes = (materiais || []).filter((m) => m.kit && m.kit !== KIT.pronto);
  return {
    desde, dias,
    itens: recentes.map((m) => ({
      material: m.material, tipo: m.tipo, encontro: m.encontro, recebidoEm: m.recebidoEm,
      objetivos: m.objetivos || null, sinais: m.sinais || null,
      baralho: m.baralho || null, exercicios: m.exercicios ?? 0, flashcards: m.flashcards ?? 0,
    })),
    pendentes: pendentes.map((m) => ({ material: m.material, tipo: m.tipo, kit: m.kit, recebidoEm: m.recebidoEm })),
  };
}

// ── Consolidação (lida no Anki, dita em palavras) ─────────────────

/** Limiares, explícitos para serem discutíveis. Espelham o callout do Hub. */
const LIMIARES = Object.freeze({
  retencaoMinima: 0.80,     // abaixo disso, revisar antes de matéria nova
  coberturaMinima: 0.90,    // cards vistos ÷ total
  consolidacaoBoa: 0.50,    // cards com intervalo ≥ 14 d ÷ total
  lapsosAltos: 5,
  revisoesParaConfiar: 5,   // retenção só é lida com esta base mínima
  diasSemSincronizar: 2,
});

/**
 * Traduz os campos Anki · de um tópico em sugestões. Cada sugestão tem
 * `regra`, `texto` e `prioridade` (1 = mais urgente). Devolve [] quando não há
 * nada a dizer — e diz quando não há dado, em vez de inventar.
 */
function sugestoesDeConsolidacao(topico, { hoje = N.hoje() } = {}) {
  const a = topico.anki || {};
  const cards = Number(a.cards) || 0;
  const rotulo = topico.idHumano || topico.topico || 'tópico';
  const saida = [];

  if (!cards) {
    saida.push({ regra: 'sem cards', prioridade: 3,
      texto: `${rotulo}: sem cards no Anki ainda. O kit do material é o que os cria.` });
    return saida;
  }

  const atualizado = a.atualizadoEm ? N.soData(a.atualizadoEm) : null;
  if (!atualizado || N.diffDias(atualizado, hoje) > LIMIARES.diasSemSincronizar) {
    saida.push({ regra: 'sem sincronizar', prioridade: 1,
      texto: `${rotulo}: o Anki não sincroniza desde ${atualizado || 'nunca'}. O placar está cego; ` +
        'dois cliques em sincronizar_anki.bat.' });
  }

  const vistos = Number(a.vistos) || 0;
  const consolidados = Number(a.consolidados) || 0;
  const lapsos = Number(a.lapsos) || 0;
  const revisoes = Number(a.revisoes) || 0;
  const retencao = typeof a.retencao === 'number' ? a.retencao : null;
  const cobertura = vistos / cards;
  const consolidacao = consolidados / cards;

  if (retencao !== null && revisoes >= LIMIARES.revisoesParaConfiar && retencao < LIMIARES.retencaoMinima) {
    saida.push({ regra: 'retenção baixa', prioridade: 1,
      texto: `${rotulo}: retenção de ${Math.round(retencao * 100)}% em ${revisoes} revisões. ` +
        'Revise o baralho hoje, antes de matéria nova — recuperação espaçada vale mais que releitura.' });
  }
  if (cobertura < LIMIARES.coberturaMinima) {
    saida.push({ regra: 'cobertura', prioridade: 2,
      texto: `${rotulo}: ${vistos} de ${cards} cards vistos (${Math.round(cobertura * 100)}%). ` +
        'Cubra os nunca vistos antes de pedir cards novos.' });
  }
  if (lapsos >= LIMIARES.lapsosAltos) {
    saida.push({ regra: 'lapsos', prioridade: 2,
      texto: `${rotulo}: ${lapsos} lapsos. Os cards estão grandes demais; um mini-kit os quebra em ideias menores.` });
  }
  if (cobertura >= LIMIARES.coberturaMinima && consolidacao < LIMIARES.consolidacaoBoa) {
    saida.push({ regra: 'manter o baralho', prioridade: 3,
      texto: `${rotulo}: ${consolidados} de ${cards} cards consolidados (≥ 14 dias). ` +
        'Mantenha o baralho diário até passar da metade.' });
  }
  if (consolidacao >= LIMIARES.consolidacaoBoa &&
      (retencao === null || retencao >= LIMIARES.retencaoMinima)) {
    saida.push({ regra: 'consolidando', prioridade: 4,
      texto: `${rotulo}: ${Math.round(consolidacao * 100)}% consolidado` +
        (retencao !== null ? ` com retenção de ${Math.round(retencao * 100)}%` : '') +
        '. Fixou. Deixe com o Anki e siga adiante.' });
  }

  return saida.sort((x, y) => x.prioridade - y.prioridade);
}

/**
 * Resumo de consolidação para vários tópicos: as sugestões mais urgentes
 * primeiro, limitadas, e um aviso único de sincronização em vez de um por tópico.
 */
function resumoDeConsolidacao(topicos, { hoje = N.hoje(), limite = 6 } = {}) {
  const comCards = (topicos || []).filter((t) => Number(t.anki?.cards) > 0);
  const todas = [];
  let semSincronizar = 0;
  for (const t of comCards) {
    for (const s of sugestoesDeConsolidacao(t, { hoje })) {
      if (s.regra === 'sem sincronizar') { semSincronizar += 1; continue; }
      todas.push({ ...s, idHumano: t.idHumano, topico: t.topico });
    }
  }
  todas.sort((x, y) => x.prioridade - y.prioridade || String(x.idHumano).localeCompare(String(y.idHumano)));
  return {
    topicosComCards: comCards.length,
    semCards: (topicos || []).length - comCards.length,
    semSincronizar,
    sugestoes: todas.slice(0, limite),
    totalSugestoes: todas.length,
  };
}

module.exports = {
  KIT, TIPOS, PRIORIDADE_TIPO, COMANDO_KIT, LIMIARES,
  normalizarMaterial, lerMateriais,
  tituloPedidoDoMaterial, detalhesDoPedido, ordenarParaAtendimento, promoverMateriais,
  objetivosDeEstudo, sugestoesDeConsolidacao, resumoDeConsolidacao,
};
