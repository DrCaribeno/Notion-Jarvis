/**
 * Code — o assistente de retorno do Hub.
 *
 * Três responsabilidades:
 *   1. `promoverPedidos()`  Cronograma `📥 Pedir` → pedido formal na Central de
 *                           Comandos. Fecha a pendência 3: a Central passa a ser
 *                           a única fila de trabalho.
 *   2. `atenderFila()`      Lê comandos de texto da fila, interpreta e responde.
 *   3. `injetarNoDisplay()` Injeta a resposta formatada no bloco de display do
 *                           Hub (um synced block), que é a tela do Code.
 *
 * Por que uma gramática de comandos e não linguagem natural: não há credencial
 * de LLM (ADR-008). Comandos determinísticos funcionam hoje, são testáveis sem
 * rede e nunca alucinam um dado do seu Hub. Quando houver chave, `interpretar()`
 * ganha um caminho por LLM sem mudar o resto.
 */

'use strict';

const N = require('./notion');
const Compromissos = require('./compromissos');
const Cronograma = require('./cronograma');
const Revisoes = require('./revisoes');
const Agentes = require('./agentes');

// ── Gramática ─────────────────────────────────────────────────────

/** Cada comando declara o que faz e como é chamado. `ajuda` se gera daqui. */
const COMANDOS_CODE = {
  hoje:       { uso: '/hoje',              descricao: 'Plano de hoje com capacidade real' },
  capacidade: { uso: '/capacidade [data]', descricao: 'Tempo livre do dia, descontando compromissos' },
  revisoes:   { uso: '/revisoes [data]',   descricao: 'Revisões que caem no dia, derivadas do Hub' },
  status:     { uso: '/status <ID>',       descricao: 'Situação de um tópico, ex: /status F04' },
  pendentes:  { uso: '/pendentes',         descricao: 'Dias atrasados do cronograma' },
  fracos:     { uso: '/fracos',            descricao: 'Tópicos em Reforço ou abaixo de 70%' },
  agenda:     { uso: '/agenda [data]',     descricao: 'Compromissos do dia' },
  ajuda:      { uso: '/ajuda',             descricao: 'Esta lista' },
};

/** Normaliza texto para casar comando: sem acento, minúsculo, sem barra. */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/^\/+/, '');
}

/**
 * Interpreta um texto livre num comando.
 * Tolerante: aceita `/hoje`, `hoje`, `HOJE`, `/status f04`, `status: F04`.
 */
function interpretar(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return { comando: null, argumentos: [], reconhecido: false, bruto };

  const limpo = normalizar(bruto).replace(/^([a-z]+)\s*:/, '$1');
  const [primeira, ...resto] = limpo.split(/\s+/);

  // Casamento exato, depois por prefixo (>= 4 letras, para `revis` → `revisoes`).
  let comando = Object.keys(COMANDOS_CODE).find((c) => c === primeira);
  if (!comando && primeira.length >= 4) {
    comando = Object.keys(COMANDOS_CODE).find((c) => c.startsWith(primeira));
  }
  if (!comando) return { comando: null, argumentos: [], reconhecido: false, bruto };

  // Argumentos saem do texto ORIGINAL, para preservar caixa (IDs são F04, não f04).
  const argumentos = bruto.trim().replace(/^\/+/, '').split(/\s+/).slice(1)
    .map((a) => a.replace(/[:,]$/, '')).filter(Boolean);

  return { comando, argumentos, reconhecido: true, bruto };
}

/** Extrai uma data ISO dos argumentos; aceita `hoje`, `amanha`, `dd/mm`. */
function dataDosArgumentos(argumentos, hoje = N.hoje()) {
  for (const a of argumentos) {
    const iso = String(a).match(/^(\d{4}-\d{2}-\d{2})$/);
    if (iso) return iso[1];
    const br = String(a).match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
    if (br) return `${br[3] || hoje.slice(0, 4)}-${br[2]}-${br[1]}`;
    const rel = normalizar(a);
    if (rel === 'hoje') return hoje;
    if (rel === 'amanha') return N.somarDias(hoje, 1);
    if (rel === 'ontem') return N.somarDias(hoje, -1);
  }
  return hoje;
}

// ── Resposta: representação intermediária (pura, testável) ────────

/**
 * Uma resposta é `{ titulo, blocos }`, com blocos descritos de forma simples:
 *   { t: 'p'|'b'|'h'|'code', texto, cor? }
 * Essa camada é pura de propósito: os handlers são testáveis sem rede, e a
 * conversão para o formato de bloco do Notion vive num único lugar.
 */
const r = {
  p: (texto, cor) => ({ t: 'p', texto, ...(cor ? { cor } : {}) }),
  b: (texto, cor) => ({ t: 'b', texto, ...(cor ? { cor } : {}) }),
  h: (texto) => ({ t: 'h', texto }),
};

const ICONE_VEREDITO = { 'viável': '🟢', sobrecarregado: '🟠', indeterminado: '⚪' };

// ── Handlers ──────────────────────────────────────────────────────

/** Fontes de dados injetáveis — os testes passam dublês no lugar dos módulos. */
const FONTES_PADRAO = {
  lerCronograma: Cronograma.lerCronograma,
  lerCompromissos: Compromissos.lerCompromissos,
  lerTopicosHub: Revisoes.lerTopicosHub,
};

const HANDLERS = {
  async ajuda() {
    return {
      titulo: 'Comandos do Code',
      blocos: Object.values(COMANDOS_CODE).map((c) => r.b(`${c.uso} — ${c.descricao}`)),
    };
  },

  async hoje(argumentos, fontes) {
    const data = dataDosArgumentos(argumentos);
    const dias = await fontes.lerCronograma({ de: data, ate: data, capacidade: true });
    if (!dias.length) {
      return { titulo: `Plano de ${data}`, blocos: [r.p('Nenhum dia do cronograma cai nesta data.')] };
    }
    const d = dias[0];
    const blocos = [r.p(`${d.dia || data}${d.semana ? ` · ${d.semana}` : ''}`)];

    if (d.capacidade) {
      const c = d.capacidade;
      blocos.push(r.p(
        `${ICONE_VEREDITO[c.veredito] || ''} ${c.veredito} — ${c.horasPlanejadas}h planejadas, ` +
        `${c.horasComprometidas}h comprometidas, teto efetivo ${c.tetoEfetivo}h` +
        (c.excesso ? `, excesso de ${c.excesso}h` : ''),
      ));
      if (c.indeterminados.length) {
        blocos.push(r.p(`⚠️ Sem duração informada: ${c.indeterminados.join(', ')}`, 'orange'));
      }
    }
    if (d.plano.ler) blocos.push(r.b(`Ler — ${d.plano.ler}`));
    if (d.plano.esquematizar) blocos.push(r.b(`Esquematizar — ${d.plano.esquematizar}`));
    if (d.plano.exercicio) blocos.push(r.b(`Exercício — ${d.plano.exercicio}`));
    if (d.revisoesProgramadas) blocos.push(r.b(`Revisões — ${d.revisoesProgramadas}`));
    if (d.status.apostila) blocos.push(r.b(`Apostila — ${d.status.apostila}`));
    blocos.push(r.p(d.status.feito ? '✅ Marcado como feito.' : '⬜ Ainda não marcado como feito.'));
    return { titulo: `Plano de ${data}`, blocos };
  },

  async capacidade(argumentos, fontes) {
    const data = dataDosArgumentos(argumentos);
    const [dias, compromissos] = await Promise.all([
      fontes.lerCronograma({ de: data, ate: data }),
      fontes.lerCompromissos(),
    ]);
    const c = Compromissos.avaliarCapacidade({
      dataISO: data, horasPlanejadas: dias[0]?.horas, compromissos,
    });
    const blocos = [
      r.p(`${ICONE_VEREDITO[c.veredito] || ''} ${data} (${c.diaDaSemana}) — ${c.veredito}`),
      r.b(`Planejado: ${c.horasPlanejadas}h`),
      r.b(`Comprometido: ${c.horasComprometidas}h`),
      r.b(`Tempo livre: ${c.tempoLivre}h · teto efetivo: ${c.tetoEfetivo}h`),
    ];
    if (c.excesso) blocos.push(r.b(`Excesso: ${c.excesso}h acima do que o dia aguenta`, 'red'));
    for (const b of c.blocos) {
      blocos.push(r.b(`${b.horaInicio || '--:--'} ${b.compromisso}` +
        `${b.duracao ? ` (${b.duracao}h)` : ' — sem duração informada'}${b.inegociavel ? ' 🔒' : ''}`));
    }
    blocos.push(r.p(`Premissas: janela de ${c.premissas.janelaUtilH}h/dia, ` +
      `teto de estudo de ${c.premissas.tetoEstudoDiaH}h/dia.`, 'gray'));
    return { titulo: `Capacidade de ${data}`, blocos };
  },

  async revisoes(argumentos, fontes) {
    const data = dataDosArgumentos(argumentos);
    const topicos = await fontes.lerTopicosHub();
    const { indice, fontes: origens } = Revisoes.indexarPorData(topicos);
    const doDia = indice.get(data) || [];
    const blocos = [r.p(Revisoes.textoDerivado(doDia))];
    for (const rev of doDia) {
      blocos.push(r.b(`${rev.marcador} · ${rev.idHumano || '—'} — ${rev.topico || ''}`));
    }
    blocos.push(r.p(`Fonte: ${Object.entries(origens).filter(([, n]) => n)
      .map(([f, n]) => `${n} por ${f}`).join('; ') || '—'}`, 'gray'));
    return { titulo: `Revisões de ${data}`, blocos };
  },

  async status(argumentos, fontes) {
    const alvo = (argumentos[0] || '').toUpperCase();
    if (!alvo) {
      return { titulo: 'Status', blocos: [r.p('Diga qual tópico. Ex: /status F04')] };
    }
    const topicos = await fontes.lerTopicosHub();
    const achados = topicos.filter((t) =>
      String(t.idHumano || '').toUpperCase() === alvo ||
      String(t.topico || '').toUpperCase().includes(alvo));
    if (!achados.length) {
      return { titulo: `Status de ${alvo}`, blocos: [r.p(`Nenhum tópico com ID ou título contendo "${alvo}".`)] };
    }
    const blocos = [];
    for (const t of achados.slice(0, 5)) {
      const rev = Revisoes.derivarRevisoesDoTopico(t);
      blocos.push(r.h(`${t.idHumano || '—'} · ${t.topico || ''}`));
      blocos.push(r.b(`Status: ${t.status || '—'} · risco: ${t.risco || '—'} · sistema: ${t.sistema || '—'}`));
      blocos.push(r.b(`Alvo: ${t.dataAlvo || '—'} · estudado em: ${t.dataReal || 'ainda não'}`));
      blocos.push(r.b(`R1 ${rev.R1 || '—'} · R2 ${rev.R2 || '—'} · R3 ${rev.R3 || '—'} · pré-prova ${rev.PP || '—'} (${rev.fonte})`));
      if (t.dataProva) blocos.push(r.b(`Prova: ${t.dataProva}`));
    }
    if (achados.length > 5) blocos.push(r.p(`… e mais ${achados.length - 5} tópico(s).`, 'gray'));
    return { titulo: `Status de ${alvo}`, blocos };
  },

  async pendentes(argumentos, fontes) {
    const dias = await fontes.lerCronograma({ pendentes: true });
    const hoje = N.hoje();
    const atrasados = dias.filter((d) => d.data && d.data < hoje);
    if (!atrasados.length) {
      return { titulo: 'Dias atrasados', blocos: [r.p('✅ Nada atrasado. Cronograma em dia.')] };
    }
    return {
      titulo: `Dias atrasados (${atrasados.length})`,
      blocos: atrasados.map((d) => r.b(`🔴 ${d.data} — ${d.dia || ''}${d.horas ? ` (${d.horas}h)` : ''}`)),
    };
  },

  async fracos(argumentos, fontes) {
    const topicos = await fontes.lerTopicosHub();
    const fracos = topicos.filter((t) => t.status === 'Reforço');
    if (!fracos.length) {
      return { titulo: 'Pontos fracos', blocos: [r.p('✅ Nenhum tópico em Reforço. Vazio é bom sinal.')] };
    }
    return {
      titulo: `Pontos fracos (${fracos.length})`,
      blocos: fracos.map((t) => r.b(`${t.idHumano || '—'} · ${t.topico || ''} — ${t.sistema || ''}`, 'red')),
    };
  },

  async agenda(argumentos, fontes) {
    const data = dataDosArgumentos(argumentos);
    const compromissos = await fontes.lerCompromissos();
    const soma = Compromissos.horasComprometidasEm(compromissos, data);
    if (!soma.blocos.length) {
      return { titulo: `Agenda de ${data}`, blocos: [r.p('Nenhum compromisso neste dia.')] };
    }
    const blocos = soma.blocos
      .slice()
      .sort((a, b) => String(a.horaInicio || '~').localeCompare(String(b.horaInicio || '~')))
      .map((b) => r.b(`${b.horaInicio || '--:--'} ${b.compromisso} · ${b.tipo || ''}` +
        `${b.duracao ? ` (${b.duracao}h)` : ' — sem duração'}${b.inegociavel ? ' 🔒' : ''}`));
    blocos.push(r.p(`Total conhecido: ${soma.horas}h` +
      (soma.confiavel ? '' : ` · ${soma.indeterminados.length} bloco(s) sem duração`), 'gray'));
    return { titulo: `Agenda de ${data}`, blocos };
  },
};

/** Resposta para texto não reconhecido — nunca falha em silêncio. */
async function respostaDesconhecida(bruto) {
  const ajuda = await HANDLERS.ajuda();
  return {
    titulo: 'Comando não reconhecido',
    blocos: [
      r.p(`Não entendi "${String(bruto).slice(0, 120)}".`, 'orange'),
      r.p('Comandos disponíveis:'),
      ...ajuda.blocos,
    ],
  };
}

/** Executa um texto de comando e devolve a resposta (ainda não formatada). */
async function executar(texto, fontes = FONTES_PADRAO) {
  const { comando, argumentos, reconhecido, bruto } = interpretar(texto);
  if (!reconhecido) return { ...(await respostaDesconhecida(bruto)), comando: null, bruto };
  try {
    const resposta = await HANDLERS[comando](argumentos, fontes);
    return { ...resposta, comando, bruto };
  } catch (erro) {
    return {
      titulo: `Falha em /${comando}`,
      blocos: [r.p(erro.message, 'red')],
      comando, bruto, erro: erro.message,
    };
  }
}

// ── Formatação para o Notion ──────────────────────────────────────

const TIPO_BLOCO = { p: 'paragraph', b: 'bulleted_list_item', h: 'heading_3' };

/** Converte a resposta na lista de blocos que a API do Notion aceita. */
function paraBlocosNotion(resposta, { marcaTempo } = {}) {
  const cabecalho = [
    `❯ ${resposta.bruto || resposta.comando || ''}`,
    marcaTempo ? `· ${marcaTempo}` : null,
  ].filter(Boolean).join('  ');

  const blocos = [
    {
      object: 'block', type: 'paragraph',
      paragraph: {
        rich_text: [{ text: { content: cabecalho }, annotations: { code: true, color: 'gray' } }],
      },
    },
    {
      object: 'block', type: 'heading_3',
      heading_3: { rich_text: [{ text: { content: resposta.titulo } }] },
    },
  ];

  for (const b of resposta.blocos || []) {
    const tipo = TIPO_BLOCO[b.t] || 'paragraph';
    blocos.push({
      object: 'block', type: tipo,
      [tipo]: {
        rich_text: [{ text: { content: String(b.texto).slice(0, 2000) } }],
        ...(b.cor ? { color: b.cor } : {}),
      },
    });
  }
  // A API aceita no máximo 100 blocos por chamada.
  return blocos.slice(0, 100);
}

// ── Display no Hub ────────────────────────────────────────────────

/**
 * Localiza o bloco de display do Code no Hub — o synced block criado no
 * redesign. Usa `IDS.blocos.displayCode` se já registrado; senão varre o Hub.
 */
async function encontrarDisplay({ paginaId = N.IDS.paginas.hub } = {}) {
  const registrado = N.IDS.blocos && N.IDS.blocos.displayCode;
  if (registrado) return registrado;

  const blocos = await N.lerBlocos(paginaId, 'encontrarDisplay');
  const direto = blocos.find((b) => b.type === 'synced_block' && !b.synced_block?.synced_from);
  if (direto) return direto.id;

  // O display pode estar dentro de uma coluna, então desce um nível.
  for (const b of blocos.filter((x) => x.has_children && ['column_list', 'column'].includes(x.type))) {
    const filhos = await N.lerBlocos(b.id, 'encontrarDisplay');
    const achado = filhos.find((f) => f.type === 'synced_block' && !f.synced_block?.synced_from);
    if (achado) return achado.id;
    for (const col of filhos.filter((x) => x.has_children && x.type === 'column')) {
      const netos = await N.lerBlocos(col.id, 'encontrarDisplay');
      const n = netos.find((f) => f.type === 'synced_block' && !f.synced_block?.synced_from);
      if (n) return n.id;
    }
  }
  throw new Error(
    '[encontrarDisplay] Nenhum synced block encontrado no Hub.\n' +
    '  → Crie o bloco de display (redesign do Hub) e registre o id em IDS.blocos.displayCode.',
  );
}

/**
 * Injeta a resposta no display, substituindo o conteúdo anterior.
 * Apaga os filhos atuais e anexa os novos — é uma tela, não um histórico.
 */
async function injetarNoDisplay(resposta, { displayId, marcaTempo } = {}) {
  const alvo = displayId || await encontrarDisplay();
  const antigos = await N.lerBlocos(alvo, 'injetarNoDisplay');

  for (const b of antigos) {
    try {
      await N.http.delete(`/blocks/${b.id}`);
    } catch (erro) {
      throw N.traduzirErro(erro, 'injetarNoDisplay/limpar');
    }
  }

  const blocos = paraBlocosNotion(resposta, { marcaTempo });
  await N.anexarBlocos(alvo, blocos, 'injetarNoDisplay');
  return { displayId: alvo, blocosRemovidos: antigos.length, blocosInjetados: blocos.length };
}

// ── Pendência 3: promover `📥 Pedir` à Central de Comandos ────────

const PEDIR = '📥 Pedir';
const GERANDO = '⏳ Gerando';

/** Título determinístico — é a chave de idempotência do pedido (ADR-003). */
const tituloPedidoDoDia = (dia) => `Apostila do dia · ${dia.data}${dia.dia ? ` (${dia.dia})` : ''}`;

/**
 * Promove todo dia marcado `📥 Pedir` a um pedido formal na Central de Comandos
 * e move o dia para `⏳ Gerando`, para não ser promovido duas vezes.
 *
 * Fecha a pendência 3: havia dois caminhos para o mesmo trabalho e nada ligava
 * um ao outro. Agora a Central de Comandos é a única fila.
 */
async function promoverPedidos({ aplicar = false, registrarNoDiario = true } = {}) {
  const dias = await Cronograma.lerCronograma({});
  const aPromover = dias.filter((d) => d.status.apostila === PEDIR);

  const acoes = aPromover.map((d) => ({
    diaId: d.id,
    data: d.data,
    titulo: tituloPedidoDoDia(d),
    detalhes: [
      d.plano.ler && `Ler: ${d.plano.ler}`,
      d.plano.esquematizar && `Esquematizar: ${d.plano.esquematizar}`,
      d.plano.exercicio && `Exercício: ${d.plano.exercicio}`,
    ].filter(Boolean).join(' · ') || 'Apostila do dia pedida pelo Cronograma.',
    topicos: d.relacoes.topicos,
  }));

  let promovidos = 0;
  const resultados = [];
  if (aplicar) {
    for (const a of acoes) {
      const pedido = await Agentes.gerenciarAgente({
        pedido: a.titulo,
        comando: 'Gerar apostila',
        status: Agentes.STATUS_PEDIDO.pendente,
        detalhes: a.detalhes,
        ...(a.topicos.length ? { topicos: a.topicos } : {}),
      });
      // Só muda o dia depois que o pedido existe: se falhar no meio, o dia
      // continua como `📥 Pedir` e a próxima execução tenta de novo.
      await N.atualizarPagina(a.diaId, { Apostila: N.prop.select(GERANDO) }, 'promoverPedidos');
      resultados.push({ ...a, pedidoUrl: pedido.url, acao: pedido.acao });
      promovidos += 1;
    }
    if (registrarNoDiario && promovidos) {
      await N.registrarDiario({
        registro: `Pedidos promovidos do Cronograma · ${promovidos}`,
        tipo: 'Ajuste do Motor',
        oQueFoiFeito: `${promovidos} dia(s) marcados "${PEDIR}" viraram pedido na Central de Comandos ` +
          `e passaram a "${GERANDO}". A Central é agora a única fila de trabalho.`,
        ajustes: resultados.map((x) => `${x.data}: ${x.titulo}`).join('\n'),
      });
    }
  }

  return { aplicado: aplicar, diasAvaliados: dias.length, aPromover: acoes, promovidos, resultados };
}

// ── Fila de comandos ──────────────────────────────────────────────

const ESTADO_TERMINAL = Object.freeze({
  digitando: '⌨️ Digitando', enviado: '📥 Enviado',
  respondido: '✅ Respondido', naoEntendi: '↩️ Não entendi',
});

/**
 * Lê o Terminal do Code — a interface na página do Hub.
 * Entra na fila toda linha com `Enviar` marcado que ainda não foi respondida.
 */
async function lerTerminal() {
  const paginas = await N.consultarBanco(
    N.IDS.bancos.terminalCode,
    {
      filter: {
        and: [
          { property: 'Enviar', checkbox: { equals: true } },
          { property: 'Estado', select: { does_not_equal: ESTADO_TERMINAL.respondido } },
        ],
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    },
    'lerTerminal',
  );

  return paginas.map((pagina) => {
    const p = N.lerPropriedades(pagina);
    return {
      origem: 'terminal',
      id: pagina.id, url: pagina.url,
      pedido: p['Comando'],
      texto: (p['Comando'] || '').trim(),
    };
  });
}

/**
 * Lê os comandos de texto da Central de Comandos.
 *
 * São pedidos com `Comando` = "Tirar dúvida" ou "Outro", cujo `Detalhes` (ou
 * título) carrega o texto. Os demais comandos da Central são trabalho das
 * skills do Motor, não do Code, e são deixados em paz.
 */
async function lerComandosDaCentral() {
  const paginas = await N.consultarBanco(
    N.IDS.bancos.centralComandos,
    {
      filter: {
        and: [
          { property: 'Status', select: { equals: Agentes.STATUS_PEDIDO.pendente } },
          { or: [
            { property: 'Comando', select: { equals: 'Tirar dúvida' } },
            { property: 'Comando', select: { equals: 'Outro' } },
          ] },
        ],
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
    },
    'lerComandosDaCentral',
  );

  return paginas.map((pagina) => {
    const p = N.lerPropriedades(pagina);
    return {
      origem: 'central',
      id: pagina.id, url: pagina.url,
      pedido: p['Pedido'],
      // O texto do comando pode vir em Detalhes ou no próprio título.
      texto: (p['Detalhes'] && p['Detalhes'].trim()) || p['Pedido'] || '',
    };
  });
}

/** Fecha um item da fila com a resposta, no schema da sua origem. */
async function fecharItem(item, resposta, textoResposta) {
  if (item.origem === 'terminal') {
    return N.atualizarPagina(item.id, {
      Estado: N.prop.select(resposta.erro || !resposta.comando
        ? ESTADO_TERMINAL.naoEntendi : ESTADO_TERMINAL.respondido),
      Resposta: N.prop.texto(textoResposta),
      Enviar: N.prop.checkbox(false), // devolve o terminal ao repouso
    }, 'fecharItem/terminal');
  }
  return N.atualizarPagina(item.id, {
    Status: N.prop.select(resposta.erro
      ? Agentes.STATUS_PEDIDO.precisoInfo : Agentes.STATUS_PEDIDO.feito),
    'Resposta do Claude': N.prop.texto(textoResposta),
    'Concluído em': N.prop.data(N.hoje()),
  }, 'fecharItem/central');
}

/**
 * Atende a fila das DUAS entradas — o Terminal do Code (interface no Hub) e a
 * Central de Comandos (fila formal) —, interpreta cada comando, responde e
 * injeta a resposta mais recente no display do Hub.
 *
 * O Terminal vem primeiro de propósito: é a entrada interativa, e quem acabou
 * de digitar está olhando o display esperando a resposta.
 */
async function atenderFila({ aplicar = false, displayId, limite = 10, fontes = FONTES_PADRAO } = {}) {
  const [doTerminal, daCentral] = await Promise.all([lerTerminal(), lerComandosDaCentral()]);
  const todos = [...doTerminal, ...daCentral];
  const fila = todos.slice(0, limite);

  const atendidos = [];
  for (const item of fila) {
    const resposta = await executar(item.texto, fontes);
    const textoResposta = [resposta.titulo, ...(resposta.blocos || []).map((b) => `• ${b.texto}`)].join('\n');
    if (aplicar) await fecharItem(item, resposta, textoResposta);
    atendidos.push({ ...item, resposta, textoResposta });
  }

  // O display mostra a resposta mais recente — é uma tela, não um log.
  let injecao = null;
  if (aplicar && atendidos.length) {
    injecao = await injetarNoDisplay(atendidos[atendidos.length - 1].resposta, {
      displayId, marcaTempo: new Date().toISOString().slice(0, 16).replace('T', ' '),
    });
  }

  return {
    aplicado: aplicar,
    naFila: todos.length,
    porOrigem: { terminal: doTerminal.length, central: daCentral.length },
    atendidos, injecao,
  };
}

module.exports = {
  COMANDOS_CODE, PEDIR, GERANDO,
  normalizar, interpretar, dataDosArgumentos,
  HANDLERS, FONTES_PADRAO, executar, respostaDesconhecida,
  paraBlocosNotion, encontrarDisplay, injetarNoDisplay,
  promoverPedidos, tituloPedidoDoDia,
  ESTADO_TERMINAL, lerTerminal, lerComandosDaCentral, fecharItem, atenderFila,
};
