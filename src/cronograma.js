/**
 * Cronograma de Ataque — leitura do plano diário, com status e capacidade real.
 */

'use strict';

const N = require('./notion');
const C = require('./compromissos');

/**
 * Lê o Cronograma de Ataque com as propriedades e o status de cada dia.
 *
 * @param {object} [opcoes]
 * @param {string} [opcoes.de]          Data inicial ISO (inclusive)
 * @param {string} [opcoes.ate]         Data final ISO (inclusive)
 * @param {boolean} [opcoes.hoje]       Atalho para o dia de hoje
 * @param {boolean} [opcoes.pendentes]  Apenas dias ainda não marcados como Feito
 * @param {string} [opcoes.semana]      Filtra por uma opção de `Semana`
 * @param {boolean} [opcoes.capacidade] Cruza com Compromissos e calcula o tempo livre
 */
async function lerCronograma(opcoes = {}) {
  const { de, ate, hoje, pendentes, semana, capacidade } = opcoes;
  const condicoes = [];

  // `É hoje` é fórmula e não é filtrável; filtramos por `Data` (seção 5 do log).
  const dataHoje = N.hoje();
  if (hoje) {
    condicoes.push({ property: 'Data', date: { equals: dataHoje } });
  } else {
    if (de) condicoes.push({ property: 'Data', date: { on_or_after: de } });
    if (ate) condicoes.push({ property: 'Data', date: { on_or_before: ate } });
  }
  if (pendentes) condicoes.push({ property: 'Feito', checkbox: { equals: false } });
  if (semana) condicoes.push({ property: 'Semana', select: { equals: semana } });

  const paginas = await N.consultarBanco(
    N.IDS.bancos.cronograma,
    {
      ...(condicoes.length ? { filter: { and: condicoes } } : {}),
      sorts: [{ property: 'Data', direction: 'ascending' }],
    },
    'lerCronograma',
  );

  const dias = paginas.map((pagina) => {
    const p = N.lerPropriedades(pagina);
    const data = N.soData(p['Data']?.inicio);
    return {
      id: pagina.id,
      url: pagina.url,
      dia: p['Dia'],
      data,
      semana: p['Semana'],
      horas: p['Horas'],
      status: {
        feito: p['Feito'] === true,
        // `Apostila` virou `Kit de estudo` em 2026-10-09 (sessão 6). O nome
        // antigo fica como reserva para um banco que ainda não tenha migrado.
        kit: p['Kit de estudo'] ?? p['Apostila'] ?? null,
        atrasado: p['Feito'] !== true && data ? data < dataHoje : false,
      },
      plano: {
        ler: p['Ler'],
        esquematizar: p['Resumir / Esquematizar'],
        exercicio: p['Exercício ativo'],
      },
      revisoesProgramadas: p['Revisões programadas'],
      eventosDoModulo: p['Eventos do módulo'],
      relacoes: {
        topicos: p['Tópicos'] || [],
        materiaisDoDia: p['Materiais do dia'] || [],   // materiais da professora que o dia estuda
        apostilaDoDia: p['Apostila do dia'] || [],     // legado (modelo de apostila, aposentado)
        compromissos: p['Compromissos'] || [],
      },
    };
  });

  if (!capacidade) return dias;

  // Uma leitura dos compromissos serve a todos os dias — evita N consultas.
  const compromissos = await C.lerCompromissos();
  for (const d of dias) {
    d.capacidade = d.data
      ? C.avaliarCapacidade({ dataISO: d.data, horasPlanejadas: d.horas, compromissos })
      : null;
  }
  return dias;
}

module.exports = { lerCronograma };
