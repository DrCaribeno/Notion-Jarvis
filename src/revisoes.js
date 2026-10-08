/**
 * Reconciliador de revisões — correção do defeito 1 do log de arquitetura.
 *
 * O Hub calcula R1/R2/R3 e a pré-prova por fórmula. O Cronograma guardava as
 * mesmas revisões como texto digitado, então bastava você estudar fora do dia
 * previsto para o texto passar a mentir. Aqui o campo deixa de ser digitado e
 * passa a ser DERIVADO: a verdade é o Hub, sempre.
 *
 * Preferimos ler o resultado das próprias fórmulas do Hub. Se uma fórmula não
 * devolver data legível, caímos na regra documentada no Hub (R1 +1, R2 +7,
 * R3 +15 a partir da Data Real de Estudo, ou da Data Alvo enquanto ela estiver
 * vazia; pré-prova na véspera da prova) e dizemos qual fonte foi usada. Nunca
 * inventamos data em silêncio.
 */

'use strict';

const N = require('./notion');

const CAMPO = 'Revisões programadas';
const MARCA = '⟳ derivado do Hub';
const OFFSETS = { R1: 1, R2: 7, R3: 15 };

/** Lê os tópicos do Hub com tudo o que as revisões precisam. */
async function lerTopicosHub() {
  const paginas = await N.consultarBanco(N.IDS.bancos.hubControle, {}, 'lerTopicosHub');
  return paginas.map((pagina) => {
    const p = N.lerPropriedades(pagina);
    return {
      id: pagina.id,
      url: pagina.url,
      idHumano: p['userDefined:ID'] || null,
      topico: p['Tópico Fisiológico Granular'],
      sistema: p['Sistema'],
      status: p['Status'],
      risco: p['Nível de Risco'],
      dataReal: N.soData(p['Data Real de Estudo']?.inicio),
      dataAlvo: N.soData(p['Data Alvo de Domínio']?.inicio),
      dataProva: N.soData(p['Data da Prova']?.inicio),
      formulas: {
        R1: p['Revisão Ativa 1'],
        R2: p['Revisão Ativa 2'],
        R3: p['Revisão Ativa 3'],
        PP: p['Revisão Pré-Prova'],
      },
    };
  });
}

/**
 * Deriva as datas de revisão de um tópico.
 * @returns {{R1:?string, R2:?string, R3:?string, PP:?string, fonte:string}}
 */
function derivarRevisoesDoTopico(topico) {
  const base = topico.dataReal || topico.dataAlvo;
  const daFormula = {
    R1: N.dataDeFormula(topico.formulas.R1),
    R2: N.dataDeFormula(topico.formulas.R2),
    R3: N.dataDeFormula(topico.formulas.R3),
    PP: N.dataDeFormula(topico.formulas.PP),
  };
  const algumaFormula = Object.values(daFormula).some(Boolean);

  const daRegra = {
    R1: base ? N.somarDias(base, OFFSETS.R1) : null,
    R2: base ? N.somarDias(base, OFFSETS.R2) : null,
    R3: base ? N.somarDias(base, OFFSETS.R3) : null,
    PP: topico.dataProva ? N.somarDias(topico.dataProva, -1) : null,
  };

  return {
    R1: daFormula.R1 || daRegra.R1,
    R2: daFormula.R2 || daRegra.R2,
    R3: daFormula.R3 || daRegra.R3,
    PP: daFormula.PP || daRegra.PP,
    fonte: algumaFormula ? 'fórmula do Hub' : (base || topico.dataProva ? 'regra documentada' : 'sem base'),
  };
}

/** Inverte: de tópicos para um índice `data → revisões que caem nela`. */
function indexarPorData(topicos) {
  const indice = new Map();
  const fontes = { 'fórmula do Hub': 0, 'regra documentada': 0, 'sem base': 0 };

  for (const topico of topicos) {
    const r = derivarRevisoesDoTopico(topico);
    fontes[r.fonte] = (fontes[r.fonte] || 0) + 1;
    for (const marcador of ['R1', 'R2', 'R3', 'PP']) {
      const data = r[marcador];
      if (!data) continue;
      if (!indice.has(data)) indice.set(data, []);
      indice.get(data).push({
        marcador,
        topicoId: topico.id,
        idHumano: topico.idHumano,
        topico: topico.topico,
        fonte: r.fonte,
      });
    }
  }
  return { indice, fontes };
}

/** Monta o texto derivado de um dia. Determinístico: mesma entrada, mesmo texto. */
function textoDerivado(revisoesDoDia) {
  if (!revisoesDoDia || !revisoesDoDia.length) return `${MARCA} · sem revisões neste dia`;

  const rotulos = { R1: 'R1', R2: 'R2', R3: 'R3', PP: '🎯 Pré-prova' };
  const partes = [];
  for (const marcador of ['R1', 'R2', 'R3', 'PP']) {
    const nomes = revisoesDoDia
      .filter((r) => r.marcador === marcador)
      .map((r) => r.idHumano || r.topico)
      .sort();
    if (nomes.length) partes.push(`${rotulos[marcador]}: ${nomes.join(', ')}`);
  }
  return `${MARCA} · ${partes.join(' · ')}`;
}

/**
 * Reconcilia o campo `Revisões programadas` do Cronograma com o Hub.
 *
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.aplicar=false] Sem isto, só mostra o que mudaria.
 * @param {string} [opcoes.de] / [opcoes.ate] Limita a janela de dias.
 * @param {boolean} [opcoes.registrarNoDiario=true] Grava no Diário ao aplicar.
 */
async function reconciliarRevisoes({ aplicar = false, de, ate, registrarNoDiario = true } = {}) {
  const { lerCronograma } = require('./cronograma');

  const [topicos, dias] = await Promise.all([
    lerTopicosHub(),
    lerCronograma({ de, ate }),
  ]);

  const { indice, fontes } = indexarPorData(topicos);

  const mudancas = [];
  const inalterados = [];
  for (const dia of dias) {
    if (!dia.data) continue;
    const novo = textoDerivado(indice.get(dia.data));
    const atual = dia.revisoesProgramadas || '';
    if (atual.trim() === novo.trim()) { inalterados.push(dia.data); continue; }
    mudancas.push({ id: dia.id, data: dia.data, dia: dia.dia, antes: atual, depois: novo });
  }

  let aplicadas = 0;
  if (aplicar) {
    for (const m of mudancas) {
      await N.atualizarPagina(m.id, { [CAMPO]: N.prop.texto(m.depois) }, 'reconciliarRevisoes');
      aplicadas += 1;
    }
    if (registrarNoDiario && aplicadas) {
      await N.registrarDiario({
        registro: `Revisões reconciliadas · ${aplicadas} dia(s)`,
        tipo: 'Ajuste do Motor',
        oQueFoiFeito:
          `O campo "${CAMPO}" do Cronograma passou a ser derivado do Hub em ${aplicadas} dia(s). ` +
          `Fonte das datas: ${Object.entries(fontes).filter(([, n]) => n).map(([f, n]) => `${n} por ${f}`).join('; ')}.`,
        ajustes: mudancas.slice(0, 20).map((m) => `${m.data}: ${m.depois}`).join('\n'),
      });
    }
  }

  return {
    aplicado: aplicar,
    topicosLidos: topicos.length,
    diasAvaliados: dias.length,
    fontes,
    mudancas,
    inalterados: inalterados.length,
    aplicadas,
  };
}

module.exports = {
  CAMPO, MARCA, OFFSETS,
  lerTopicosHub, derivarRevisoesDoTopico, indexarPorData, textoDerivado, reconciliarRevisoes,
};
