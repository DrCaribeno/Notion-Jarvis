/**
 * Testes da lógica pura do Jarvis — tudo o que roda sem tocar na API.
 * Sem framework de propósito: `node test/logica.test.js` e pronto.
 *
 * Várias asserções de data são ancoradas nos rótulos que já existem no
 * Cronograma de Ataque ("Seg 12/10", "Sáb 24/10", "Seg 09/11"). Se o cálculo
 * de dia da semana divergir desses rótulos, o teste quebra.
 */

'use strict';

const J = require('../index.js');
const { N, Compromissos, Revisoes, Agentes, Materiais } = J;

let passes = 0;
const falhas = [];

function ok(condicao, nome, detalhe) {
  if (condicao) { passes += 1; return; }
  falhas.push(`${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}
const eq = (a, b, nome) => ok(
  JSON.stringify(a) === JSON.stringify(b), nome,
  `esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`,
);
function grupo(titulo) { console.log(`\n${titulo}`); }

// ── A. Datas ──────────────────────────────────────────────────────
grupo('A. Aritmética de datas (UTC, determinística)');
eq(N.somarDias('2026-10-12', 1), '2026-10-13', 'somarDias +1');
eq(N.somarDias('2026-10-12', 7), '2026-10-19', 'somarDias +7');
eq(N.somarDias('2026-10-12', 15), '2026-10-27', 'somarDias +15');
eq(N.somarDias('2026-10-31', 1), '2026-11-01', 'somarDias atravessa o mês');
eq(N.somarDias('2026-12-31', 1), '2027-01-01', 'somarDias atravessa o ano');
eq(N.somarDias('2026-11-09', -1), '2026-11-08', 'somarDias negativo (véspera da prova)');
eq(N.diffDias('2026-10-08', '2026-11-13'), 36, 'diffDias janela do módulo');
eq(N.diffDias('2026-10-12', '2026-10-12'), 0, 'diffDias mesmo dia');
eq(N.diffDias('2026-10-13', '2026-10-12'), -1, 'diffDias negativo');
// Rótulos reais do Cronograma como verdade de referência:
eq(N.diaSemana('2026-10-12'), 'Seg', 'diaSemana bate com "Seg 12/10"');
eq(N.diaSemana('2026-10-24'), 'Sáb', 'diaSemana bate com "Sáb 24/10"');
eq(N.diaSemana('2026-10-25'), 'Dom', 'diaSemana bate com "Dom 25/10"');
eq(N.diaSemana('2026-10-26'), 'Seg', 'diaSemana bate com "Seg 26/10" (AC1)');
eq(N.diaSemana('2026-11-07'), 'Sáb', 'diaSemana bate com "Sáb 07/11"');
eq(N.diaSemana('2026-11-09'), 'Seg', 'diaSemana bate com "Seg 09/11" (AC2)');
eq(N.diaSemana('2026-10-12T23:30:00.000-04:00'), 'Seg', 'diaSemana ignora hora e fuso');
eq(N.intervaloDatas('2026-10-08', '2026-10-11').length, 4, 'intervaloDatas inclui as duas pontas');

// ── B. Leitura de fórmulas ────────────────────────────────────────
grupo('B. dataDeFormula (tolerante por projeto)');
eq(N.dataDeFormula({ inicio: '2026-10-13' }), '2026-10-13', 'objeto de data normalizado');
eq(N.dataDeFormula({ start: '2026-10-13T00:00:00.000Z' }), '2026-10-13', 'objeto cru da API');
eq(N.dataDeFormula('2026-10-13'), '2026-10-13', 'string ISO');
eq(N.dataDeFormula('R1 em 2026-10-13 (neuro)'), '2026-10-13', 'ISO embutida em texto');
eq(N.dataDeFormula('13/10/2026'), '2026-10-13', 'formato brasileiro');
eq(N.dataDeFormula('Revisar em 13/10'), `${new Date().getUTCFullYear()}-10-13`, 'brasileiro curto');
eq(N.dataDeFormula(null), null, 'nulo');
eq(N.dataDeFormula(''), null, 'string vazia');
eq(N.dataDeFormula('sem data aqui'), null, 'texto sem data');
eq(N.dataDeFormula({}), null, 'objeto vazio');

// ── C. Ocorrência de compromissos ─────────────────────────────────
grupo('C. Compromissos · ocorreEm');
const unica = { recorrencia: 'Única', vigencia: { inicio: '2026-10-26' }, diasDaSemana: [] };
ok(Compromissos.ocorreEm(unica, '2026-10-26'), 'Única casa a data exata');
ok(!Compromissos.ocorreEm(unica, '2026-10-27'), 'Única não vaza para o dia seguinte');

const iesc = { recorrencia: 'Semanal', diasDaSemana: ['Seg'],
  vigencia: { inicio: '2026-10-08', fim: '2026-11-13' } };
ok(Compromissos.ocorreEm(iesc, '2026-10-12'), 'Semanal casa a segunda dentro da vigência');
ok(!Compromissos.ocorreEm(iesc, '2026-10-13'), 'Semanal ignora a terça');
ok(!Compromissos.ocorreEm(iesc, '2026-10-05'), 'Semanal respeita o início da vigência');
ok(!Compromissos.ocorreEm(iesc, '2026-11-16'), 'Semanal respeita o fim da vigência');

const semDia = { recorrencia: 'Semanal', diasDaSemana: [], vigencia: { inicio: '2026-10-08', fim: '2026-11-13' } };
ok(!Compromissos.ocorreEm(semDia, '2026-10-12'), 'Semanal sem dia da semana não é alocado (ambíguo)');

const semVigencia = { recorrencia: 'Semanal', diasDaSemana: ['Seg'], vigencia: null };
ok(!Compromissos.ocorreEm(semVigencia, '2026-10-12'), 'sem vigência não ocorre');

const quinzenal = { recorrencia: 'Quinzenal', diasDaSemana: ['Seg'],
  vigencia: { inicio: '2026-10-12', fim: '2026-11-13' } };
ok(Compromissos.ocorreEm(quinzenal, '2026-10-12'), 'Quinzenal: semana 0 ocorre');
ok(!Compromissos.ocorreEm(quinzenal, '2026-10-19'), 'Quinzenal: semana 1 não ocorre');
ok(Compromissos.ocorreEm(quinzenal, '2026-10-26'), 'Quinzenal: semana 2 ocorre');

// ── D. Soma de horas comprometidas ────────────────────────────────
grupo('D. Compromissos · horasComprometidasEm');
const agenda = [
  { compromisso: 'IESC II', recorrencia: 'Semanal', diasDaSemana: ['Seg'], duracao: 4,
    vigencia: { inicio: '2026-10-08', fim: '2026-11-13' } },
  { compromisso: 'Tutorial B4', recorrencia: 'Semanal', diasDaSemana: ['Qui'], duracao: 2,
    vigencia: { inicio: '2026-10-08', fim: '2026-11-13' } },
  { compromisso: 'Treino', recorrencia: 'Semanal', diasDaSemana: ['Seg', 'Qua', 'Sex'], duracao: 1.5,
    vigencia: { inicio: '2026-10-08', fim: '2026-11-13' } },
  { compromisso: 'AC1', recorrencia: 'Única', diasDaSemana: [], duracao: 2,
    vigencia: { inicio: '2026-10-26' } },
  { compromisso: 'Atlética (sem duração)', recorrencia: 'Semanal', diasDaSemana: ['Ter'], duracao: null,
    vigencia: { inicio: '2026-10-08', fim: '2026-11-13' } },
];
const seg = Compromissos.horasComprometidasEm(agenda, '2026-10-12');
eq(seg.horas, 5.5, 'segunda soma IESC (4h) + treino (1,5h)');
eq(seg.blocos.length, 2, 'segunda tem 2 blocos');
ok(seg.confiavel, 'segunda é confiável (todos com duração)');

const ter = Compromissos.horasComprometidasEm(agenda, '2026-10-13');
eq(ter.horas, 0, 'terça soma 0 horas conhecidas');
eq(ter.indeterminados.length, 1, 'terça tem 1 indeterminado');
ok(!ter.confiavel, 'terça NÃO é confiável — sem duração não vira zero');

const segAC1 = Compromissos.horasComprometidasEm(agenda, '2026-10-26');
eq(segAC1.horas, 7.5, 'dia da AC1 acumula recorrentes + a prova');

// ── E. Capacidade do dia ──────────────────────────────────────────
grupo('E. Compromissos · avaliarCapacidade');
const viavel = Compromissos.avaliarCapacidade({ dataISO: '2026-10-14', horasPlanejadas: 5, compromissos: agenda });
eq(viavel.veredito, 'viável', 'dia leve com 5h planejadas é viável');
const quarta = Compromissos.avaliarCapacidade({ dataISO: '2026-10-14', horasPlanejadas: 5, compromissos: agenda });
eq(N.diaSemana('2026-10-14'), 'Qua', 'sanidade: 14/10 é quarta');
eq(quarta.horasComprometidas, 1.5, 'quarta tem o treino (1,5h)');

const sobrecarga = Compromissos.avaliarCapacidade({ dataISO: '2026-10-12', horasPlanejadas: 9, compromissos: agenda });
eq(sobrecarga.veredito, 'sobrecarregado', '9h planejadas numa segunda estoura o teto');
eq(sobrecarga.tetoEfetivo, 6, 'teto efetivo é o teto de estudo (6h), pois sobram 8,5h livres');
eq(sobrecarga.excesso, 3, 'excesso de 3h');

const indet = Compromissos.avaliarCapacidade({ dataISO: '2026-10-13', horasPlanejadas: 4, compromissos: agenda });
eq(indet.veredito, 'indeterminado', 'dia com compromisso sem duração é indeterminado, não viável');
eq(indet.indeterminados, ['Atlética (sem duração)'], 'indeterminado é nomeado');

const lotado = Compromissos.avaliarCapacidade({
  dataISO: '2026-10-12', horasPlanejadas: 3,
  compromissos: [{ compromisso: 'Maratona', recorrencia: 'Única', diasDaSemana: [], duracao: 13,
    vigencia: { inicio: '2026-10-12' } }],
});
eq(lotado.tempoLivre, 1, 'janela de 14h menos 13h comprometidas deixa 1h');
eq(lotado.tetoEfetivo, 1, 'teto efetivo cai para o tempo livre quando ele é menor que 6h');
eq(lotado.veredito, 'sobrecarregado', '3h planejadas em 1h livre é sobrecarga');

// ── F. Derivação das revisões ─────────────────────────────────────
grupo('F. Revisões · derivarRevisoesDoTopico');
const comFormula = Revisoes.derivarRevisoesDoTopico({
  dataReal: '2026-10-12', dataAlvo: '2026-10-10', dataProva: '2026-10-26',
  formulas: { R1: { inicio: '2026-10-13' }, R2: { inicio: '2026-10-19' }, R3: null, PP: null },
});
eq(comFormula.R1, '2026-10-13', 'fórmula do Hub tem prioridade em R1');
eq(comFormula.R2, '2026-10-19', 'fórmula do Hub tem prioridade em R2');
eq(comFormula.R3, '2026-10-27', 'R3 cai na regra (+15) quando a fórmula não devolve data');
eq(comFormula.PP, '2026-10-25', 'pré-prova é a véspera da prova');
eq(comFormula.fonte, 'fórmula do Hub', 'fonte reportada como fórmula');

const soRegra = Revisoes.derivarRevisoesDoTopico({
  dataReal: null, dataAlvo: '2026-10-12', dataProva: '2026-10-26',
  formulas: { R1: null, R2: null, R3: null, PP: null },
});
eq(soRegra.R1, '2026-10-13', 'regra: R1 = alvo +1');
eq(soRegra.R2, '2026-10-19', 'regra: R2 = alvo +7');
eq(soRegra.R3, '2026-10-27', 'regra: R3 = alvo +15');
eq(soRegra.fonte, 'regra documentada', 'fonte reportada como regra');

const realVence = Revisoes.derivarRevisoesDoTopico({
  dataReal: '2026-10-20', dataAlvo: '2026-10-12', dataProva: null,
  formulas: { R1: null, R2: null, R3: null, PP: null },
});
eq(realVence.R1, '2026-10-21', 'Data Real de Estudo prevalece sobre a Data Alvo');

const semBase = Revisoes.derivarRevisoesDoTopico({
  dataReal: null, dataAlvo: null, dataProva: null,
  formulas: { R1: null, R2: null, R3: null, PP: null },
});
eq(semBase.R1, null, 'sem base não inventa data');
eq(semBase.fonte, 'sem base', 'fonte reportada como sem base');

// ── G. Texto derivado ─────────────────────────────────────────────
grupo('G. Revisões · indexarPorData e textoDerivado');
const topicos = [
  { id: 't1', idHumano: 'F04', topico: 'Potencial de ação', dataReal: null, dataAlvo: '2026-10-12',
    dataProva: '2026-10-26', formulas: {} },
  { id: 't2', idHumano: 'F05', topico: 'Propagação', dataReal: null, dataAlvo: '2026-10-12',
    dataProva: '2026-10-26', formulas: {} },
  { id: 't3', idHumano: 'N03', topico: 'Vias sensitivas', dataReal: null, dataAlvo: '2026-10-06',
    dataProva: '2026-10-26', formulas: {} },
];
const { indice, fontes } = Revisoes.indexarPorData(topicos);
eq(fontes['regra documentada'], 3, 'três tópicos derivados pela regra');
// 13/10 é um caso real de sobreposição: R1 de F04/F05 (alvo 12/10) e R2 de N03 (alvo 06/10).
const d13 = indice.get('2026-10-13');
eq(d13.map((r) => r.idHumano).sort(), ['F04', 'F05', 'N03'], '13/10 junta revisões de marcadores diferentes');
eq(d13.filter((r) => r.marcador === 'R1').map((r) => r.idHumano).sort(), ['F04', 'F05'], '13/10: R1 de F04 e F05');
eq(d13.filter((r) => r.marcador === 'R2').map((r) => r.idHumano), ['N03'], '13/10: R2 de N03 (alvo 06/10 +7)');
eq(indice.get('2026-10-25').map((r) => r.idHumano).sort(), ['F04', 'F05', 'N03'], '25/10 é a pré-prova de todos');

const texto = Revisoes.textoDerivado(indice.get('2026-10-13'));
ok(texto.startsWith('⟳ derivado do Hub'), 'texto carrega a marca de derivado', texto);
ok(texto.includes('R1: F04, F05'), 'texto lista os tópicos de R1 em ordem', texto);
ok(texto.includes('R2: N03'), 'texto separa R2 de R1 no mesmo dia', texto);
eq(Revisoes.textoDerivado([]), '⟳ derivado do Hub · sem revisões neste dia', 'dia sem revisão é explícito');
eq(Revisoes.textoDerivado(undefined), '⟳ derivado do Hub · sem revisões neste dia', 'dia inexistente no índice');
eq(
  Revisoes.textoDerivado(indice.get('2026-10-13')),
  Revisoes.textoDerivado(indice.get('2026-10-13')),
  'textoDerivado é determinístico (idempotência da escrita depende disso)',
);
const misto = Revisoes.textoDerivado([
  { marcador: 'PP', idHumano: 'C02' }, { marcador: 'R1', idHumano: 'K09' }, { marcador: 'R3', idHumano: 'A01' },
]);
ok(misto.indexOf('R1:') < misto.indexOf('R3:') && misto.indexOf('R3:') < misto.indexOf('Pré-prova'),
  'marcadores saem sempre na ordem R1 → R2 → R3 → pré-prova', misto);

// ── H. Síntese de diretrizes ──────────────────────────────────────
grupo('H. Agentes · sintetizarDiretriz (otimizador determinístico)');
const prolixo = Agentes.sintetizarDiretriz('A apostila ficou longa demais, muito texto corrido', '❌ Inadequado');
ok(prolixo.padroes.includes('prolixidade'), 'reconhece prolixidade', JSON.stringify(prolixo.padroes));
ok(prolixo.diretrizes[0].includes('8 linhas'), 'emite diretriz quantificada');

const calculo = Agentes.sintetizarDiretriz('Faltou cálculo de clearance e não teve esquema nenhum', '⚠️ Parcial');
ok(calculo.padroes.includes('falta de cálculo'), 'reconhece falta de cálculo');
ok(calculo.padroes.includes('falta de esquema'), 'reconhece falta de esquema');
eq(calculo.diretrizes.length, 2, 'duas reclamações geram duas diretrizes');

const factual = Agentes.sintetizarDiretriz('Tinha um erro na curva da hemoglobina, está incorreto', '❌ Inadequado');
ok(factual.padroes.includes('erro factual'), 'reconhece erro factual');

const literal = Agentes.sintetizarDiretriz('Prefiro que venha em ordem alfabética', '❌ Inadequado');
eq(literal.padroes, ['literal'], 'sem padrão conhecido, usa a observação literalmente');
ok(literal.diretrizes[0].includes('ordem alfabética'), 'preserva a observação na diretriz');
ok(literal.diretrizes[0].startsWith('Restrição dura'), 'Inadequado vira restrição dura');
const literalParcial = Agentes.sintetizarDiretriz('Prefiro em ordem alfabética', '⚠️ Parcial');
ok(literalParcial.diretrizes[0].startsWith('Ajuste'), 'Parcial vira ajuste, não restrição dura');

const vazio = Agentes.sintetizarDiretriz('', '❌ Inadequado');
eq(vazio.diretrizes, [], 'observação vazia não gera diretriz');
eq(vazio.motivo, 'observação vazia', 'e explica o motivo');
eq(Agentes.sintetizarDiretriz(null, '❌ Inadequado').diretrizes, [], 'observação nula também');

const repetido = Agentes.sintetizarDiretriz('Ficou longo demais', '❌ Inadequado');
eq(repetido.diretrizes, prolixo.diretrizes.slice(0, 1), 'mesma classe de observação gera a mesma diretriz');

const sinais = Agentes.sintetizarDiretriz('Ignorou o que a professora enfatizou na aula', '⚠️ Parcial');
ok(sinais.padroes.includes('sinais de prova'), 'reconhece falta de sinais de prova (sessão 6)');
ok(sinais.diretrizes[0].includes('Sinais de prova'), 'e a diretriz manda preencher Sinais de prova');
ok(!Agentes.TAXONOMIA.some((t) => /apostila/i.test(t.diretriz)), 'nenhuma diretriz da taxonomia fala mais em apostila');

// ── I. Materiais da professora → kit, objetivos e consolidação ────
grupo('I. Materiais · promoção, objetivos e consolidação (sessão 6)');
eq(Materiais.COMANDO_KIT, 'Kit de estudo', 'o comando do kit tem o nome do select da Central');
ok(Agentes.COMANDOS.includes(Materiais.COMANDO_KIT), 'e consta na lista de comandos aceitos');
eq(Materiais.KIT.novo, '📥 Novo', 'estado de entrada bate com o schema de Materiais da Aula');
eq(Materiais.KIT.pronto, '✅ Pronto', 'estado final idem');

const m1 = { material: 'Aula 3 · Vias somatossensoriais', recebidoEm: '2026-10-13', tipo: 'Aula', encontro: 'Conf. 2' };
eq(Materiais.tituloPedidoDoMaterial(m1), Materiais.tituloPedidoDoMaterial({ ...m1 }),
  'título do pedido é determinístico (idempotência)');
ok(Materiais.tituloPedidoDoMaterial(m1).startsWith('Kit de estudo · Aula 3'), 'título carrega o material');
ok(Materiais.tituloPedidoDoMaterial(m1).includes('2026-10-13'), 'e a data, que o torna único');
ok(Materiais.detalhesDoPedido(m1).includes('Conf. 2'), 'detalhes carregam o encontro');

const ordem = Materiais.ordenarParaAtendimento([
  { material: 'Slides', tipo: 'Slides', recebidoEm: '2026-10-10' },
  { material: 'Aviso', tipo: 'Aviso', recebidoEm: '2026-10-09' },
  { material: 'Problema', tipo: 'Problema do tutorial', recebidoEm: '2026-10-12' },
  { material: 'Aula velha', tipo: 'Aula', recebidoEm: '2026-10-08' },
  { material: 'Aula nova', tipo: 'Aula', recebidoEm: '2026-10-11' },
]).map((m) => m.material);
eq(ordem, ['Problema', 'Aula velha', 'Aula nova', 'Slides', 'Aviso'],
  'problema do tutorial primeiro; dentro do tipo, o mais antigo primeiro');

const hojeFixo = '2026-10-13';
const materiais = [
  { material: 'A', kit: '✅ Pronto', recebidoEm: '2026-10-12', processadoEm: '2026-10-13', objetivos: 'x', sinais: 's', exercicios: 8, flashcards: 12 },
  { material: 'B', kit: '✅ Pronto', recebidoEm: '2026-09-01', processadoEm: '2026-09-02', objetivos: 'y' },
  { material: 'C', kit: '📥 Novo', recebidoEm: '2026-10-13' },
  { material: 'D', kit: '⏳ Gerando', recebidoEm: '2026-10-13' },
];
const o7 = Materiais.objetivosDeEstudo(materiais, { dias: 7, hoje: hojeFixo });
eq(o7.desde, '2026-10-06', 'janela de 7 dias começa em 06/10');
eq(o7.itens.map((i) => i.material), ['A'], 'só o kit pronto na janela');
eq(o7.itens[0].sinais, 's', 'sinais de prova viajam junto');
eq(o7.pendentes.map((p) => p.material), ['C', 'D'], 'pendentes = tudo que não está Pronto');
eq(Materiais.objetivosDeEstudo(materiais, { dias: 60, hoje: hojeFixo }).itens.map((i) => i.material), ['A', 'B'],
  'janela maior inclui o antigo, mais recente primeiro');
eq(Materiais.objetivosDeEstudo([], { hoje: hojeFixo }).itens, [], 'lista vazia não quebra');

const sug = (anki, idHumano = 'N03') => Materiais.sugestoesDeConsolidacao({ idHumano, anki }, { hoje: hojeFixo });
eq(sug({}).map((s) => s.regra), ['sem cards'], 'sem cards → diz que não há dado, não inventa');
eq(sug({ cards: 10, vistos: 10, consolidados: 6, lapsos: 0, revisoes: 20, retencao: 0.9, atualizadoEm: hojeFixo })
  .map((s) => s.regra), ['consolidando'], 'tudo bom → consolidando, e só');
const baixa = sug({ cards: 20, vistos: 20, consolidados: 2, lapsos: 1, revisoes: 12, retencao: 0.6, atualizadoEm: hojeFixo });
eq(baixa[0].regra, 'retenção baixa', 'retenção baixa é a primeira sugestão');
ok(baixa.some((s) => s.regra === 'manter o baralho'), 'e cobertura completa com pouca consolidação → manter o baralho');
eq(sug({ cards: 20, vistos: 20, consolidados: 2, lapsos: 1, revisoes: 3, retencao: 0.6, atualizadoEm: hojeFixo })
  .some((s) => s.regra === 'retenção baixa'), false, 'retenção com menos de 5 revisões não é lida (base insuficiente)');
ok(sug({ cards: 20, vistos: 5, consolidados: 0, lapsos: 0, revisoes: 0, retencao: null, atualizadoEm: hojeFixo })
  .some((s) => s.regra === 'cobertura'), 'poucos vistos → cobertura');
ok(sug({ cards: 20, vistos: 20, consolidados: 12, lapsos: 7, revisoes: 30, retencao: 0.85, atualizadoEm: hojeFixo })
  .some((s) => s.regra === 'lapsos'), 'lapsos ≥ 5 → cards grandes demais');
eq(sug({ cards: 20, vistos: 20, consolidados: 12, revisoes: 30, retencao: 0.85, atualizadoEm: '2026-10-10' })[0].regra,
  'sem sincronizar', 'sincronização com mais de 2 dias vem primeiro');
eq(sug({ cards: 20, vistos: 20, consolidados: 12, revisoes: 30, retencao: 0.85, atualizadoEm: '2026-10-11' })
  .some((s) => s.regra === 'sem sincronizar'), false, 'exatamente 2 dias ainda é aceitável');
eq(JSON.stringify(baixa), JSON.stringify(sug({ cards: 20, vistos: 20, consolidados: 2, lapsos: 1, revisoes: 12, retencao: 0.6, atualizadoEm: hojeFixo })),
  'sugestões são determinísticas');

const resumo = Materiais.resumoDeConsolidacao([
  { idHumano: 'F04', anki: { cards: 20, vistos: 20, consolidados: 2, lapsos: 1, revisoes: 12, retencao: 0.6, atualizadoEm: hojeFixo } },
  { idHumano: 'F05', anki: { cards: 10, vistos: 10, consolidados: 6, revisoes: 20, retencao: 0.9, atualizadoEm: '2026-10-01' } },
  { idHumano: 'K09', anki: {} },
], { hoje: hojeFixo });
eq(resumo.topicosComCards, 2, 'resumo conta tópicos com cards');
eq(resumo.semCards, 1, 'e sem cards');
eq(resumo.semSincronizar, 1, 'o aviso de sincronização é agregado, não repetido por tópico');
eq(resumo.sugestoes[0].idHumano, 'F04', 'o urgente vem primeiro');
ok(!resumo.sugestoes.some((s) => s.regra === 'sem sincronizar'), 'e não aparece como sugestão individual');

// ── Resultado ─────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(62));
if (falhas.length) {
  console.log(`❌ ${falhas.length} falha(s) de ${passes + falhas.length}:\n`);
  for (const f of falhas) console.log(`   • ${f}`);
  process.exit(1);
}
console.log(`✅ ${passes} asserções passaram.`);
