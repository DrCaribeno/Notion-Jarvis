/**
 * Compromissos — os blocos de tempo que competem com o estudo.
 *
 * Responde à única pergunta que o cronograma precisa: quantas horas de um
 * determinado dia já estão tomadas? `Duração (h)` é o campo autoritativo;
 * `Hora início` existe para contexto humano e detecção de conflito.
 */

'use strict';

const N = require('./notion');

const ATIVO = 'Ativo';
const RECORRENCIA = 'Recorrência';
const DIA_SEMANA = 'Dia da semana';
const VIGENCIA = 'Vigência';
const DURACAO = 'Duração (h)';

/** Lê os compromissos. Por padrão só os ativos — inativos ficam no histórico. */
async function lerCompromissos({ incluirInativos = false } = {}) {
  const paginas = await N.consultarBanco(
    N.IDS.bancos.compromissos,
    incluirInativos ? {} : { filter: { property: ATIVO, checkbox: { equals: true } } },
    'lerCompromissos',
  );

  return paginas.map((pagina) => {
    const p = N.lerPropriedades(pagina);
    return {
      id: pagina.id,
      url: pagina.url,
      compromisso: p['Compromisso'],
      tipo: p['Tipo'],
      recorrencia: p[RECORRENCIA] || 'Única',
      diasDaSemana: p[DIA_SEMANA] || [],
      vigencia: p[VIGENCIA],
      horaInicio: p['Hora início'],
      duracao: p[DURACAO],            // null = indeterminado, nunca zero
      inegociavel: p['Inegociável'] === true,
      ativo: p[ATIVO] === true,
      observacao: p['Observação'],
    };
  });
}

/**
 * Decide se um compromisso acontece numa data.
 * Regras: `Única` casa a data exata; `Semanal` exige o dia da semana dentro da
 * vigência; `Quinzenal` exige, além disso, número par de semanas desde o início.
 */
function ocorreEm(compromisso, dataISO) {
  const inicio = N.soData(compromisso.vigencia?.inicio);
  if (!inicio) return false;

  if (compromisso.recorrencia === 'Única') return inicio === dataISO;

  const fim = N.soData(compromisso.vigencia?.fim);
  if (N.diffDias(inicio, dataISO) < 0) return false;
  if (fim && N.diffDias(dataISO, fim) < 0) return false;

  // Sem dia da semana marcado, um recorrente é ambíguo: não dá para alocar.
  if (!compromisso.diasDaSemana.length) return false;
  if (!compromisso.diasDaSemana.includes(N.diaSemana(dataISO))) return false;

  if (compromisso.recorrencia === 'Quinzenal') {
    return Math.floor(N.diffDias(inicio, dataISO) / 7) % 2 === 0;
  }
  return true;
}

/**
 * Soma as horas comprometidas numa data.
 *
 * Compromissos sem `Duração (h)` NÃO entram como zero: vão para
 * `indeterminados`, e quem consome decide o que fazer. Tratá-los como zero
 * produziria uma capacidade otimista e silenciosamente errada — o mesmo tipo
 * de defeito que este módulo existe para corrigir.
 */
function horasComprometidasEm(compromissos, dataISO) {
  const doDia = compromissos.filter((c) => ocorreEm(c, dataISO));
  const comDuracao = doDia.filter((c) => typeof c.duracao === 'number' && c.duracao > 0);
  const indeterminados = doDia.filter((c) => !(typeof c.duracao === 'number' && c.duracao > 0));

  return {
    data: dataISO,
    horas: comDuracao.reduce((soma, c) => soma + c.duracao, 0),
    blocos: doDia,
    indeterminados,
    confiavel: indeterminados.length === 0,
  };
}

/**
 * Avalia a capacidade real de um dia.
 *
 * Modelo, com as premissas explícitas (ajustáveis por variável de ambiente):
 *   JANELA_UTIL_H ....... horas acordado-produtivas de um dia (padrão 14)
 *   TETO_ESTUDO_DIA_H ... teto de estudo num dia comum (padrão 6, regra do Motor)
 *
 *   tempoLivre   = JANELA_UTIL_H − horas comprometidas
 *   tetoEfetivo  = min(TETO_ESTUDO_DIA_H, tempoLivre)
 *   sobrecarga   = horas planejadas − tetoEfetivo
 */
function avaliarCapacidade({ dataISO, horasPlanejadas, compromissos }) {
  const comprometido = horasComprometidasEm(compromissos, dataISO);
  const tempoLivre = Math.max(0, N.JANELA_UTIL_H - comprometido.horas);
  const tetoEfetivo = Math.min(N.TETO_ESTUDO_DIA_H, tempoLivre);
  const planejadas = typeof horasPlanejadas === 'number' ? horasPlanejadas : 0;
  const excesso = Number((planejadas - tetoEfetivo).toFixed(2));

  let veredito;
  if (!comprometido.confiavel) veredito = 'indeterminado';
  else if (excesso > 0) veredito = 'sobrecarregado';
  else veredito = 'viável';

  return {
    data: dataISO,
    diaDaSemana: N.diaSemana(dataISO),
    horasPlanejadas: planejadas,
    horasComprometidas: Number(comprometido.horas.toFixed(2)),
    tempoLivre: Number(tempoLivre.toFixed(2)),
    tetoEfetivo: Number(tetoEfetivo.toFixed(2)),
    excesso: excesso > 0 ? excesso : 0,
    veredito,
    blocos: comprometido.blocos.map((b) => ({
      compromisso: b.compromisso, tipo: b.tipo,
      horaInicio: b.horaInicio, duracao: b.duracao, inegociavel: b.inegociavel,
    })),
    indeterminados: comprometido.indeterminados.map((b) => b.compromisso),
    premissas: { janelaUtilH: N.JANELA_UTIL_H, tetoEstudoDiaH: N.TETO_ESTUDO_DIA_H },
  };
}

module.exports = { lerCompromissos, ocorreEm, horasComprometidasEm, avaliarCapacidade };
