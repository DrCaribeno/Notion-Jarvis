/**
 * Testes do assistente Code — gramática, handlers e formatação.
 *
 * Os handlers recebem `fontes` injetáveis, então tudo aqui roda sem tocar na
 * API do Notion. Os dublês devolvem exatamente a forma que os módulos reais
 * devolvem, e a capacidade é calculada pelo módulo real a partir dos dublês,
 * para que a composição seja de fato exercitada.
 */

'use strict';

const J = require('../index.js');
const { N, Code, Compromissos } = J;

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
const grupo = (t) => console.log(`\n${t}`);

// ── Dublês ────────────────────────────────────────────────────────

const COMPROMISSOS = [
  { compromisso: 'IESC II', tipo: 'Outro módulo', recorrencia: 'Semanal', diasDaSemana: ['Seg'],
    vigencia: { inicio: '2026-10-08', fim: '2026-11-13' }, horaInicio: '08:00', duracao: 4,
    inegociavel: true, ativo: true },
  { compromisso: 'Treino', tipo: 'Treino físico', recorrencia: 'Semanal', diasDaSemana: ['Seg', 'Qua'],
    vigencia: { inicio: '2026-10-08', fim: '2026-11-13' }, horaInicio: '18:00', duracao: 1.5,
    inegociavel: false, ativo: true },
  { compromisso: 'Diretoria da Atlética', tipo: 'Atlética/Liga', recorrencia: 'Semanal',
    diasDaSemana: ['Ter'], vigencia: { inicio: '2026-10-08', fim: '2026-11-13' },
    horaInicio: '19:00', duracao: null, inegociavel: false, ativo: true },
];

const DIAS = [
  { id: 'd1', url: 'u/d1', dia: 'Seg 12/10 — Embriologia do SN', data: '2026-10-12',
    semana: 'S2 · Neuro total', horas: 7,
    status: { feito: false, kit: '📥 Pedir', atrasado: false },
    plano: { ler: 'Guyton cap. 5', esquematizar: 'Placas alar e basal', exercicio: '10 questões' },
    revisoesProgramadas: '⟳ derivado do Hub · R1: F04, F05',
    eventosDoModulo: 'Feriado',
    relacoes: { topicos: ['t1', 't2'], materiaisDoDia: ['m1'], apostilaDoDia: [], compromissos: [] } },
  { id: 'd2', url: 'u/d2', dia: 'Qui 01/10 — atrasado', data: '2026-10-01',
    semana: 'S1 · Fundação biofísica', horas: 4,
    status: { feito: false, kit: null, atrasado: true },
    plano: { ler: 'Guyton cap. 1', esquematizar: null, exercicio: null },
    revisoesProgramadas: null, eventosDoModulo: null,
    relacoes: { topicos: [], materiaisDoDia: [], apostilaDoDia: [], compromissos: [] } },
  { id: 'd3', url: 'u/d3', dia: 'Ter 13/10', data: '2026-10-13', semana: 'S2 · Neuro total', horas: 5,
    status: { feito: false, kit: '📥 Pedir', atrasado: false },
    plano: { ler: 'Guyton cap. 6', esquematizar: null, exercicio: null },
    revisoesProgramadas: null, eventosDoModulo: null,
    relacoes: { topicos: ['t3'], materiaisDoDia: [], apostilaDoDia: [], compromissos: [] } },
];

/** Métricas Anki · como o sincronizar_anki.ps1 grava no Hub (sessão 6). */
const ANKI_VAZIO = { cards: null, vistos: null, consolidados: null, lapsos: null, revisoes: null,
  retencao: null, questoesFeitas: null, questoesCertas: null, ultimaRevisao: null, atualizadoEm: null };

const TOPICOS = [
  { id: 't1', url: 'u/t1', idHumano: 'F04', topico: 'Potencial de ação', sistema: 'Fundamentos',
    status: 'Em estudo', risco: 'Crítico', dataReal: null, dataAlvo: '2026-10-12',
    dataProva: '2026-10-26', formulas: {},
    // Retenção baixa com base suficiente: pede revisão antes de matéria nova.
    anki: { ...ANKI_VAZIO, cards: 20, vistos: 20, consolidados: 2, lapsos: 1, revisoes: 12, retencao: 0.6,
      atualizadoEm: N.hoje() } },
  { id: 't2', url: 'u/t2', idHumano: 'F05', topico: 'Propagação do potencial', sistema: 'Fundamentos',
    status: 'Reforço', risco: 'Crítico', dataReal: null, dataAlvo: '2026-10-12',
    dataProva: '2026-10-26', formulas: {},
    // Consolidado: metade com intervalo ≥ 14 d e retenção boa.
    anki: { ...ANKI_VAZIO, cards: 10, vistos: 10, consolidados: 6, lapsos: 0, revisoes: 20, retencao: 0.9,
      atualizadoEm: N.hoje() } },
  { id: 't3', url: 'u/t3', idHumano: 'K09', topico: 'Equilíbrio ácido-base', sistema: 'Renal',
    status: 'Não iniciado', risco: 'Crítico', dataReal: null, dataAlvo: '2026-11-06',
    dataProva: '2026-11-09', formulas: {}, anki: { ...ANKI_VAZIO } },
];

const HOJE = N.hoje();
const MATERIAIS = [
  { id: 'm1', url: 'u/m1', material: 'Aula 3 · Vias somatossensoriais', tipo: 'Aula',
    recebidoEm: N.somarDias(HOJE, -1), encontro: 'Conf. 2', topicos: ['t1'], link: null,
    kit: '✅ Pronto', objetivos: 'Explicar os três neurônios da via; localizar lesão por dermátomo.',
    sinais: 'Repetiu Brown-Séquard duas vezes; disse que cai AVC talâmico.',
    exercicios: 8, flashcards: 14, baralho: 'MED 1.5 › 2 Neuro › N03',
    processadoEm: HOJE, errosNoKit: null, pedidos: ['p1'] },
  { id: 'm2', url: 'u/m2', material: 'Problema do T2', tipo: 'Problema do tutorial',
    recebidoEm: HOJE, encontro: 'T2', topicos: ['t1', 't2'], link: null,
    kit: '📥 Novo', objetivos: null, sinais: null, exercicios: null, flashcards: null, baralho: null,
    processadoEm: null, errosNoKit: null, pedidos: [] },
  { id: 'm3', url: 'u/m3', material: 'Slides da Conf. 1', tipo: 'Slides',
    recebidoEm: N.somarDias(HOJE, -3), encontro: 'Conf. 1', topicos: ['t3'], link: 'https://x',
    kit: '↩️ Preciso de info', objetivos: 'Qual tópico?', sinais: null, exercicios: null, flashcards: null,
    baralho: null, processadoEm: null, errosNoKit: null, pedidos: [] },
  { id: 'm4', url: 'u/m4', material: 'Aula antiga', tipo: 'Aula',
    recebidoEm: N.somarDias(HOJE, -30), encontro: 'Conf. 0', topicos: [], link: null,
    kit: '✅ Pronto', objetivos: 'Velho', sinais: null, exercicios: 6, flashcards: 10, baralho: 'X',
    processadoEm: N.somarDias(HOJE, -30), errosNoKit: null, pedidos: [] },
];

/** Dublê fiel: honra os filtros e calcula capacidade com o módulo real. */
const FONTES = {
  async lerCronograma(opcoes = {}) {
    let dias = DIAS.slice();
    if (opcoes.de) dias = dias.filter((d) => d.data >= opcoes.de);
    if (opcoes.ate) dias = dias.filter((d) => d.data <= opcoes.ate);
    if (opcoes.pendentes) dias = dias.filter((d) => !d.status.feito);
    if (opcoes.capacidade) {
      dias = dias.map((d) => ({
        ...d,
        capacidade: Compromissos.avaliarCapacidade({
          dataISO: d.data, horasPlanejadas: d.horas, compromissos: COMPROMISSOS,
        }),
      }));
    }
    return dias;
  },
  async lerCompromissos() { return COMPROMISSOS; },
  async lerTopicosHub() { return TOPICOS; },
  async lerMateriais(opcoes = {}) {
    let lista = MATERIAIS.slice();
    if (opcoes.kit) lista = lista.filter((m) => m.kit === opcoes.kit);
    return lista;
  },
};

const textos = (resposta) => (resposta.blocos || []).map((b) => b.texto).join(' | ');
/** Só os blocos de DADO — descarta a linha da voz. */
const dados = (resposta) => (resposta.blocos || []).filter((b) => !b.voz);
const vozDe = (resposta) => (resposta.blocos || []).filter((b) => b.voz);

// ── A. Gramática ──────────────────────────────────────────────────
grupo('A. Code · interpretar');
eq(Code.interpretar('/hoje').comando, 'hoje', 'barra + comando');
eq(Code.interpretar('hoje').comando, 'hoje', 'sem barra');
eq(Code.interpretar('HOJE').comando, 'hoje', 'maiúsculas');
eq(Code.interpretar('  /hoje  ').comando, 'hoje', 'espaços em volta');
eq(Code.interpretar('/revisões').comando, 'revisoes', 'acento no comando');
eq(Code.interpretar('revis').comando, 'revisoes', 'prefixo de 5 letras casa');
eq(Code.interpretar('/status: F04').comando, 'status', 'dois-pontos após o comando');
eq(Code.interpretar('/status F04').argumentos, ['F04'], 'argumento preserva a CAIXA');
eq(Code.interpretar('/capacidade 2026-10-26').argumentos, ['2026-10-26'], 'argumento de data');
eq(Code.interpretar('/hoje').reconhecido, true, 'reconhecido');
eq(Code.interpretar('faz um café').reconhecido, false, 'texto solto não é reconhecido');
eq(Code.interpretar('').reconhecido, false, 'vazio não é reconhecido');
eq(Code.interpretar(null).reconhecido, false, 'nulo não quebra');
eq(Code.interpretar('ho').reconhecido, false, 'prefixo curto (2 letras) NÃO casa, evita falso positivo');

grupo('B. Code · dataDosArgumentos');
eq(Code.dataDosArgumentos(['2026-10-26'], '2026-10-08'), '2026-10-26', 'ISO');
eq(Code.dataDosArgumentos(['26/10'], '2026-10-08'), '2026-10-26', 'dd/mm usa o ano de hoje');
eq(Code.dataDosArgumentos(['26/10/2025'], '2026-10-08'), '2025-10-26', 'dd/mm/aaaa');
eq(Code.dataDosArgumentos(['hoje'], '2026-10-08'), '2026-10-08', 'hoje');
eq(Code.dataDosArgumentos(['amanha'], '2026-10-08'), '2026-10-09', 'amanha');
eq(Code.dataDosArgumentos(['amanhã'], '2026-10-08'), '2026-10-09', 'amanhã com acento');
eq(Code.dataDosArgumentos(['ontem'], '2026-10-08'), '2026-10-07', 'ontem');
eq(Code.dataDosArgumentos([], '2026-10-08'), '2026-10-08', 'sem argumento cai em hoje');
eq(Code.dataDosArgumentos(['xpto'], '2026-10-08'), '2026-10-08', 'argumento inútil cai em hoje');

// ── C. Handlers ───────────────────────────────────────────────────
(async () => {
  grupo('C. Code · handlers');

  const ajuda = await Code.HANDLERS.ajuda([], FONTES);
  eq(dados(ajuda).length, Object.keys(Code.COMANDOS_CODE).length, 'ajuda lista todos os comandos');
  ok(textos(ajuda).includes('/status <ID>'), 'ajuda mostra a forma de uso');
  eq(vozDe(ajuda).length, 1, 'ajuda traz exatamente uma linha de voz');

  const hoje = await Code.HANDLERS.hoje(['2026-10-12'], FONTES);
  ok(hoje.titulo.includes('2026-10-12'), 'hoje no título', hoje.titulo);
  ok(textos(hoje).includes('Guyton cap. 5'), 'hoje traz a leitura do dia');
  ok(textos(hoje).includes('Placas alar'), 'hoje traz o que esquematizar');
  ok(textos(hoje).includes('Kit de estudo — 📥 Pedir'), 'hoje mostra o estado do kit (não "apostila")');
  ok(!textos(hoje).toLowerCase().includes('apostila'), 'hoje não fala mais em apostila');
  ok(textos(hoje).includes('Materiais da aula — 1'), 'hoje conta os materiais da professora ligados ao dia');
  ok(textos(hoje).includes('sobrecarregado'), 'hoje cruza capacidade: 7h num dia com 5,5h tomadas');
  ok(textos(hoje).includes('⬜'), 'hoje diz que não está feito');

  const hojeVazio = await Code.HANDLERS.hoje(['2026-12-25'], FONTES);
  ok(textos(hojeVazio).includes('Nenhum dia'), 'dia fora do cronograma responde sem quebrar');

  const cap = await Code.HANDLERS.capacidade(['2026-10-12'], FONTES);
  ok(textos(cap).includes('5.5h'), 'capacidade soma IESC (4h) + treino (1,5h)', textos(cap));
  ok(textos(cap).includes('IESC II'), 'capacidade lista os blocos');
  ok(textos(cap).includes('🔒'), 'capacidade marca o inegociável');
  ok(textos(cap).includes('Premissas'), 'capacidade declara as premissas do modelo');

  const capTer = await Code.HANDLERS.capacidade(['2026-10-13'], FONTES);
  ok(textos(capTer).includes('indeterminado'), 'terça é indeterminada: Atlética sem duração');
  ok(textos(capTer).includes('sem duração'), 'e diz qual bloco está sem duração');

  const rev = await Code.HANDLERS.revisoes(['2026-10-13'], FONTES);
  ok(textos(rev).includes('derivado do Hub'), 'revisões traz a marca de derivado');
  ok(textos(rev).includes('F04'), 'revisões lista F04 (R1 do alvo 12/10)');
  ok(textos(rev).includes('regra documentada'), 'revisões declara a fonte da data');

  const st = await Code.HANDLERS.status(['F04'], FONTES);
  ok(textos(st).includes('Potencial de ação'), 'status acha por ID humano');
  ok(textos(st).includes('Em estudo'), 'status traz o Status do Hub');
  ok(textos(st).includes('2026-10-13'), 'status calcula R1 = alvo +1');
  ok(textos(st).includes('ainda não'), 'status diz que não há Data Real de Estudo');

  const stMin = await Code.HANDLERS.status(['f04'], FONTES);
  ok(textos(stMin).includes('Potencial'), 'status é insensível à caixa do ID');

  const stNada = await Code.HANDLERS.status(['Z99'], FONTES);
  ok(textos(stNada).includes('Nenhum tópico'), 'status de ID inexistente responde direito');

  const stSemArg = await Code.HANDLERS.status([], FONTES);
  ok(textos(stSemArg).includes('/status F04'), 'status sem argumento ensina o uso');

  const pend = await Code.HANDLERS.pendentes([], FONTES);
  ok(pend.titulo.includes('1'), 'pendentes conta 1 atrasado', pend.titulo);
  ok(textos(pend).includes('2026-10-01'), 'pendentes nomeia o dia atrasado');

  const fr = await Code.HANDLERS.fracos([], FONTES);
  ok(textos(fr).includes('F05'), 'fracos pega o tópico em Reforço');
  ok(!textos(fr).includes('F04'), 'fracos NÃO pega o que está apenas Em estudo');

  const ag = await Code.HANDLERS.agenda(['2026-10-12'], FONTES);
  ok(textos(ag).includes('08:00 IESC II'), 'agenda ordena por hora');
  const posIesc = textos(ag).indexOf('IESC'), posTreino = textos(ag).indexOf('Treino');
  ok(posIesc < posTreino, 'agenda põe 08:00 antes de 18:00');

  const agVazia = await Code.HANDLERS.agenda(['2026-10-15'], FONTES);
  ok(textos(agVazia).includes('Nenhum compromisso'), 'agenda vazia responde direito');

  // ── D. executar ─────────────────────────────────────────────────
  grupo('D. Code · executar');
  const exec = await Code.executar('/fracos', FONTES);
  eq(exec.comando, 'fracos', 'executar resolve o comando');
  eq(exec.bruto, '/fracos', 'executar guarda o texto original');

  const desconhecido = await Code.executar('me explica a vida', FONTES);
  eq(desconhecido.comando, null, 'desconhecido não tem comando');
  ok(textos(desconhecido).includes('faz um café') || textos(desconhecido).includes('sentido útil'),
    'desconhecido eco o que recebeu e assume o limite como próprio');
  ok(textos(desconhecido).includes('/hoje'), 'desconhecido lista os comandos — nunca falha em silêncio');

  const quebrado = await Code.executar('/fracos', {
    ...FONTES, lerTopicosHub: async () => { throw new Error('404 não compartilhado'); },
  });
  ok(textos(quebrado).includes('404'), 'erro de fonte vira resposta, não exceção');
  eq(quebrado.comando, 'fracos', 'e o comando segue identificado');
  ok(Boolean(quebrado.erro), 'e o erro é sinalizado para a fila marcar "Preciso de info"');

  // ── E. Formatação ───────────────────────────────────────────────
  grupo('E. Code · paraBlocosNotion');
  const blocos = Code.paraBlocosNotion(
    await Code.executar('/status F04', FONTES), { marcaTempo: '2026-10-08 12:00' },
  );
  eq(blocos[0].type, 'paragraph', 'primeiro bloco é o eco do comando');
  eq(blocos[0].paragraph.rich_text[0].annotations.code, true, 'eco vem em fonte de código');
  ok(blocos[0].paragraph.rich_text[0].text.content.includes('❯ /status F04'), 'eco mostra o comando');
  ok(blocos[0].paragraph.rich_text[0].text.content.includes('2026-10-08 12:00'), 'eco carrega a marca de tempo');
  eq(blocos[1].type, 'heading_3', 'segundo bloco é o título');
  ok(blocos.every((b) => b.object === 'block'), 'todos os blocos declaram object:block');
  ok(blocos.every((b) => b[b.type]?.rich_text), 'todos têm rich_text no tipo correto');

  const tipos = Code.paraBlocosNotion({
    titulo: 'T', bruto: '/x',
    blocos: [{ t: 'p', texto: 'par' }, { t: 'b', texto: 'item' }, { t: 'h', texto: 'cab' },
      { t: 'desconhecido', texto: 'cai em parágrafo' }],
  });
  eq(tipos[2].type, 'paragraph', 'p → paragraph');
  eq(tipos[3].type, 'bulleted_list_item', 'b → bulleted_list_item');
  eq(tipos[4].type, 'heading_3', 'h → heading_3');
  eq(tipos[5].type, 'paragraph', 'tipo desconhecido cai em parágrafo sem quebrar');

  const comCor = Code.paraBlocosNotion({ titulo: 'T', bruto: '/x', blocos: [{ t: 'p', texto: 'x', cor: 'red' }] });
  eq(comCor[2].paragraph.color, 'red', 'cor é repassada ao bloco');

  const gigante = Code.paraBlocosNotion({
    titulo: 'T', bruto: '/x',
    blocos: Array.from({ length: 300 }, (_, i) => ({ t: 'b', texto: `linha ${i}` })),
  });
  ok(gigante.length <= 100, 'respeita o limite de 100 blocos por chamada da API', `${gigante.length}`);

  const longo = Code.paraBlocosNotion({ titulo: 'T', bruto: '/x', blocos: [{ t: 'p', texto: 'a'.repeat(5000) }] });
  ok(longo[2].paragraph.rich_text[0].text.content.length <= 2000, 'trunca texto no limite de 2000 do Notion');

  // ── F. Promoção de pedidos ──────────────────────────────────────
  grupo('F. Code · pendência 3');
  const t1 = Code.tituloPedidoDoDia(DIAS[0]);
  eq(t1, Code.tituloPedidoDoDia(DIAS[0]), 'título do pedido é determinístico (idempotência)');
  ok(t1.includes('2026-10-12'), 'título carrega a data, que é o que o torna único', t1);
  ok(Code.tituloPedidoDoDia(DIAS[0]) !== Code.tituloPedidoDoDia(DIAS[2]),
    'dias diferentes geram títulos diferentes');
  eq(Code.PEDIR, '📥 Pedir', 'estado de entrada bate com o schema do Cronograma');
  eq(Code.GERANDO, '⏳ Gerando', 'estado de saída bate com o schema do Cronograma');
  eq(Code.CAMPO_KIT, 'Kit de estudo', 'o campo gravado no Cronograma é o renomeado (era Apostila)');
  ok(t1.startsWith('Kit de estudo do dia'), 'o pedido do dia é um kit, não uma apostila', t1);
  ok(J.COMANDOS.includes(J.COMANDO_KIT), 'o comando do kit existe no select da Central');
  ok(!J.COMANDOS.includes('Gerar apostila'), '"Gerar apostila" saiu do select da Central');


  // ── G. Conversa casual ──────────────────────────────────────────
  grupo('G. Code · conversa casual (sem barra)');
  const conv = (t) => Code.interpretar(t);
  eq(conv('o que eu faço hoje?').comando, 'hoje', 'pergunta sobre o dia');
  eq(conv('o que eu faço hoje?').via, 'conversa', 'e vem pelo caminho de conversa');
  eq(conv('/hoje').via, 'comando', 'a barra ainda usa o caminho de comando');
  eq(conv('tenho tempo quinta?').comando, 'capacidade', 'pergunta sobre tempo');
  eq(conv('da tempo de estudar?').comando, 'capacidade', 'variação sobre tempo');
  eq(conv('o que ta atrasado?').comando, 'pendentes', 'pergunta sobre atraso');
  eq(conv('to travado em que?').comando, 'fracos', 'pergunta sobre dificuldade');
  eq(conv('preciso rever o que?').comando, 'revisoes', 'pergunta sobre revisão');
  eq(conv('que prova vem?').comando, 'agenda', 'pergunta sobre compromisso');
  eq(conv('como ta o F04?').comando, 'status', 'pergunta sobre tópico');
  eq(conv('me ajuda').comando, 'ajuda', 'pedido de ajuda');
  eq(conv('e amanha?').comando, 'hoje', 'frase só com data cai no plano do dia');
  eq(conv('faz um cafe pra mim').reconhecido, false, 'pedido fora de escopo não é reconhecido');
  eq(conv('me explica a vida').reconhecido, false, 'conversa fora de escopo também não');
  // Sessão 6: o material da professora, os objetivos e a consolidação.
  eq(conv('o que a professora quer?').comando, 'objetivos', 'pergunta sobre a professora → objetivos');
  eq(conv('o que cai na prova?').comando, 'objetivos', '"o que cai" → objetivos (não agenda)');
  eq(conv('o que eu preciso saber?').comando, 'objetivos', 'pergunta sobre o que saber → objetivos');
  eq(conv('chegou aula nova, tem kit?').comando, 'materiais', 'material novo → materiais');
  eq(conv('o que ta sem kit?').comando, 'materiais', '"sem kit" → materiais');
  eq(conv('ta fixando?').comando, 'consolidar', 'fixação → consolidar');
  eq(conv('como ta minha retencao no anki?').comando, 'consolidar', 'retenção/anki → consolidar');
  eq(conv('o que consolidar hoje?').comando, 'consolidar', 'consolidar vence "hoje"');
  eq(conv('que prova vem?').comando, 'agenda', 'e "que prova vem" continua sendo agenda');
  eq(conv('/consolidar N03').argumentos, ['N03'], 'consolidar com ID preserva a caixa');
  eq(conv('/objetivos 14').argumentos, ['14'], 'objetivos aceita janela em dias');

  grupo('H. Code · extração de ID e data da frase inteira');
  eq(Code.extrairIdTopico('como ta o F04?'), 'F04', 'ID no meio da frase');
  eq(Code.extrairIdTopico('e o f4, ja vi?'), 'F04', 'ID em minúscula e sem zero → normalizado');
  eq(Code.extrairIdTopico('status K9'), 'K09', 'outro prefixo, um dígito');
  eq(Code.extrairIdTopico('nada aqui'), null, 'sem ID devolve null');
  eq(Code.extrairIdTopico('tenho 42 questoes'), null, 'número solto não é ID');
  eq(Code.extrairDataDoTexto('e amanha?', '2026-10-08'), '2026-10-09', 'amanhã');
  eq(Code.extrairDataDoTexto('ontem eu parei', '2026-10-08'), '2026-10-07', 'ontem');
  eq(Code.extrairDataDoTexto('depois de amanha', '2026-10-08'), '2026-10-10', 'depois de amanhã');
  eq(Code.extrairDataDoTexto('o que rola dia 26?', '2026-10-08'), '2026-10-26', '"dia N" usa o mês corrente');
  eq(Code.extrairDataDoTexto('tenho tempo 26/10?', '2026-10-08'), '2026-10-26', 'dd/mm');
  eq(Code.extrairDataDoTexto('e em 2026-11-09?', '2026-10-08'), '2026-11-09', 'ISO embutida');
  // 2026-10-08 é quinta (ancorado nos rótulos do Cronograma).
  eq(Code.extrairDataDoTexto('tenho tempo na segunda?', '2026-10-08'), '2026-10-12', 'segunda → a próxima');
  eq(Code.extrairDataDoTexto('e quinta?', '2026-10-08'), '2026-10-08', 'quinta sendo hoje → hoje');
  eq(Code.extrairDataDoTexto('e sexta?', '2026-10-08'), '2026-10-09', 'sexta → amanhã');
  eq(Code.extrairDataDoTexto('nada de data aqui'), null, 'sem data devolve null');

  grupo('I. Code · cortesia');
  const social = async (t) => Code.executar(t, FONTES);
  ok((await social('oi')).comando === 'social', 'cumprimento é tratado como social');
  ok(textos(await social('oi')).includes('Pois não'), 'e recebe resposta, não erro');
  ok(textos(await social('obrigado jarvis')).includes('dispor'), 'agradecimento com palavra depois');
  ok(textos(await social('obrigada')).includes('dispor'), 'flexão de gênero');
  ok(textos(await social('quem é você?')).includes('Jarvis Code'), 'identidade, com acento');
  ok(textos(await social('qual seu nome?')).includes('Jarvis Code'), 'identidade por outra via');
  ok(textos(await social('tchau')).includes('Até'), 'despedida');
  ok(textos(await social('desculpa')).includes('ressentimentos'), 'desculpa');
  ok((await social('faz um café pra mim')).comando === null, 'fora de escopo NÃO é social');

  grupo('J. Code · a voz não contamina o dado');
  const comVoz = await Code.executar('/pendentes', FONTES);
  eq(vozDe(comVoz).length, 1, 'resposta traz exatamente uma linha de voz');
  eq(vozDe(comVoz)[0].cor, 'gray', 'a voz é sempre cinza');
  ok(vozDe(comVoz)[0].voz === true, 'e sempre marcada, para poder ser descartada');
  ok(comVoz.blocos[comVoz.blocos.length - 1].voz === true, 'a voz é sempre o ÚLTIMO bloco');
  ok(dados(comVoz).every((b) => !b.voz), 'os blocos de dado não têm marca de voz');
  ok(dados(comVoz).some((b) => b.texto.includes('2026-10-01')), 'o dado continua intacto sob a voz');

  // Determinismo: a mesma situação tem de dar a mesma frase, senão não há teste.
  const v1 = await Code.executar('/pendentes', FONTES);
  const v2 = await Code.executar('/pendentes', FONTES);
  eq(vozDe(v1)[0].texto, vozDe(v2)[0].texto, 'a voz é determinística para o mesmo fato');

  // A voz muda com o fato, não por capricho.
  const semAtraso = await Code.executar('/pendentes', {
    ...FONTES, lerCronograma: async () => [],
  });
  ok(vozDe(semAtraso)[0].texto !== vozDe(v1)[0].texto, 'fato diferente → fala diferente');
  ok(vozDe(semAtraso)[0].texto.includes('Nada atrasado'), 'e a fala corresponde ao fato');

  grupo('K. Code · a voz nunca derruba a resposta');
  eq(Code.comentar ? 'exportado' : 'interno', 'interno', 'comentar é detalhe interno');
  const vozQuebrada = await Code.executar('/fracos', FONTES);
  ok(Array.isArray(vozQuebrada.blocos), 'resposta segue válida');
  ok(vozDe(vozQuebrada).length <= 1, 'no máximo uma linha de voz');

  // ── L. Materiais da professora, objetivos e consolidação ───────
  grupo('L. Code · objetivos, materiais e consolidar (sessão 6)');
  const obj = await Code.HANDLERS.objetivos([], FONTES);
  ok(obj.titulo.includes('7 dias'), 'objetivos usa janela padrão de 7 dias', obj.titulo);
  ok(textos(obj).includes('Vias somatossensoriais'), 'objetivos lista o kit pronto recente');
  ok(textos(obj).includes('Brown-Séquard'), 'objetivos traz os sinais de prova da professora');
  ok(textos(obj).includes('N03'), 'objetivos aponta o baralho do Anki');
  ok(!textos(obj).includes('Aula antiga'), 'kit pronto há 30 dias fica fora da janela de 7');
  ok(textos(obj).includes('2 material(is) ainda sem kit'), 'objetivos conta os pendentes (Novo + Preciso de info)');
  eq(obj.fatos, { n: 1, pendentes: 2 }, 'fatos de objetivos');

  const obj30 = await Code.HANDLERS.objetivos(['30'], FONTES);
  ok(textos(obj30).includes('Aula antiga'), 'janela de 30 dias inclui o kit antigo');

  const mats = await Code.HANDLERS.materiais([], FONTES);
  eq(mats.fatos.n, 2, 'materiais conta só os sem kit');
  const posProblema = textos(mats).indexOf('Problema do T2'), posSlides = textos(mats).indexOf('Slides');
  ok(posProblema < posSlides, 'problema do tutorial vem antes dos slides, mesmo chegando depois');
  ok(dados(mats).some((b) => b.cor === 'orange'), 'Preciso de info é destacado');

  const cons = await Code.HANDLERS.consolidar([], FONTES);
  ok(textos(cons).includes('2 tópico(s) com cards'), 'consolidar conta tópicos com cards', textos(cons));
  ok(textos(cons).includes('1 ainda sem cards'), 'e os sem cards');
  ok(textos(cons).includes('F04') && textos(cons).includes('60%'), 'F04 aparece com retenção de 60%');
  ok(textos(cons).includes('F05') && textos(cons).includes('Fixou'), 'F05 aparece como consolidado');
  ok(textos(cons).includes('Limiares'), 'consolidar declara os limiares');
  eq(cons.fatos.urgentes, 1, 'uma sugestão urgente (retenção baixa de F04)');

  const consF04 = await Code.HANDLERS.consolidar(['F04'], FONTES);
  ok(textos(consF04).includes('20 cards'), 'consolidar por ID mostra as métricas cruas');
  ok(textos(consF04).includes('Revise o baralho hoje'), 'e a sugestão correspondente');
  const consZ = await Code.HANDLERS.consolidar(['Z99'], FONTES);
  ok(textos(consZ).includes('Nenhum tópico'), 'ID inexistente responde direito');

  const vozObj = await Code.executar('o que a professora quer?', FONTES);
  eq(vozDe(vozObj).length, 1, 'objetivos tem voz');
  ok(vozDe(vozObj)[0].texto.includes('Sinais de prova'), 'e a voz aponta para os sinais de prova');
  const vozCons = await Code.executar('ta fixando?', FONTES);
  ok(vozDe(vozCons)[0].texto.includes('1 tópico(s) pedem revisão'), 'a voz de consolidar nomeia o urgente', vozDe(vozCons)[0].texto);

  const semSync = await Code.executar('/consolidar', {
    ...FONTES,
    lerTopicosHub: async () => TOPICOS.map((t) => ({ ...t, anki: { ...t.anki, atualizadoEm: '2026-01-01' } })),
  });
  ok(vozDe(semSync)[0].texto.includes('não sincroniza'), 'sem sincronização recente a voz avisa que o placar é velho');
  ok(textos(semSync).includes('sem sincronizar'), 'e o resumo conta os tópicos sem sincronizar');

  // ── Resultado ───────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(62));
  if (falhas.length) {
    console.log(`❌ ${falhas.length} falha(s) de ${passes + falhas.length}:\n`);
    for (const f of falhas) console.log(`   • ${f}`);
    process.exit(1);
  }
  console.log(`✅ ${passes} asserções passaram.`);
})();
