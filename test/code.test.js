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
    status: { feito: false, apostila: '📥 Pedir', atrasado: false },
    plano: { ler: 'Guyton cap. 5', esquematizar: 'Placas alar e basal', exercicio: '10 questões' },
    revisoesProgramadas: '⟳ derivado do Hub · R1: F04, F05',
    eventosDoModulo: 'Feriado', relacoes: { topicos: ['t1', 't2'], apostilaDoDia: [], compromissos: [] } },
  { id: 'd2', url: 'u/d2', dia: 'Qui 01/10 — atrasado', data: '2026-10-01',
    semana: 'S1 · Fundação biofísica', horas: 4,
    status: { feito: false, apostila: null, atrasado: true },
    plano: { ler: 'Guyton cap. 1', esquematizar: null, exercicio: null },
    revisoesProgramadas: null, eventosDoModulo: null,
    relacoes: { topicos: [], apostilaDoDia: [], compromissos: [] } },
  { id: 'd3', url: 'u/d3', dia: 'Ter 13/10', data: '2026-10-13', semana: 'S2 · Neuro total', horas: 5,
    status: { feito: false, apostila: '📥 Pedir', atrasado: false },
    plano: { ler: 'Guyton cap. 6', esquematizar: null, exercicio: null },
    revisoesProgramadas: null, eventosDoModulo: null,
    relacoes: { topicos: ['t3'], apostilaDoDia: [], compromissos: [] } },
];

const TOPICOS = [
  { id: 't1', url: 'u/t1', idHumano: 'F04', topico: 'Potencial de ação', sistema: 'Fundamentos',
    status: 'Em estudo', risco: 'Crítico', dataReal: null, dataAlvo: '2026-10-12',
    dataProva: '2026-10-26', formulas: {} },
  { id: 't2', url: 'u/t2', idHumano: 'F05', topico: 'Propagação do potencial', sistema: 'Fundamentos',
    status: 'Reforço', risco: 'Crítico', dataReal: null, dataAlvo: '2026-10-12',
    dataProva: '2026-10-26', formulas: {} },
  { id: 't3', url: 'u/t3', idHumano: 'K09', topico: 'Equilíbrio ácido-base', sistema: 'Renal',
    status: 'Não iniciado', risco: 'Crítico', dataReal: null, dataAlvo: '2026-11-06',
    dataProva: '2026-11-09', formulas: {} },
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
};

const textos = (resposta) => (resposta.blocos || []).map((b) => b.texto).join(' | ');

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
  eq(ajuda.blocos.length, Object.keys(Code.COMANDOS_CODE).length, 'ajuda lista todos os comandos');
  ok(textos(ajuda).includes('/status <ID>'), 'ajuda mostra a forma de uso');

  const hoje = await Code.HANDLERS.hoje(['2026-10-12'], FONTES);
  ok(hoje.titulo.includes('2026-10-12'), 'hoje no título', hoje.titulo);
  ok(textos(hoje).includes('Guyton cap. 5'), 'hoje traz a leitura do dia');
  ok(textos(hoje).includes('Placas alar'), 'hoje traz o que esquematizar');
  ok(textos(hoje).includes('📥 Pedir'), 'hoje mostra o estado da apostila');
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
  ok(textos(desconhecido).includes('Não entendi'), 'desconhecido avisa');
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

  // ── Resultado ───────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(62));
  if (falhas.length) {
    console.log(`❌ ${falhas.length} falha(s) de ${passes + falhas.length}:\n`);
    for (const f of falhas) console.log(`   • ${f}`);
    process.exit(1);
  }
  console.log(`✅ ${passes} asserções passaram.`);
})();
