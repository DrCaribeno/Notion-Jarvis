/**
 * Jarvis · ecossistema de automação do Notion — ponto de entrada e CLI.
 *
 * Antes de alterar qualquer coisa aqui, leia `jarvis_architecture_log.md`.
 * As decisões não óbvias (axios como transporte, Notion-Version fixada,
 * revisões derivadas em vez de digitadas) estão justificadas lá.
 *
 * Módulos:
 *   src/notion.js       transporte, IDs, normalização, datas, blocos
 *   src/compromissos.js blocos de tempo e capacidade real do dia
 *   src/cronograma.js   leitura do plano diário
 *   src/revisoes.js     reconciliação das revisões com o Hub
 *   src/agentes.js      fila de pedidos e loop de autoaperfeiçoamento
 *   src/materiais.js    materiais da professora → kit de estudo; objetivos; consolidação
 *   src/code.js         Jarvis Code: conversa, fila e display no Hub
 */

'use strict';

const N = require('./src/notion');
const Compromissos = require('./src/compromissos');
const Cronograma = require('./src/cronograma');
const Revisoes = require('./src/revisoes');
const Agentes = require('./src/agentes');
const Materiais = require('./src/materiais');
const Code = require('./src/code');

const { IDS, http, notion } = N;

// ── Diagnóstico ───────────────────────────────────────────────────

async function diagnostico() {
  console.log('\n🔎 Jarvis · diagnóstico\n' + '─'.repeat(62));
  console.log(`Notion-Version : ${N.NOTION_VERSION}`);
  console.log(`Token          : ${process.env.NOTION_TOKEN ? 'do ambiente (.env)' : 'injetado pelo proxy'}`);
  console.log(`Capacidade     : janela ${N.JANELA_UTIL_H}h/dia · teto de estudo ${N.TETO_ESTUDO_DIA_H}h/dia`);

  let bot;
  try {
    const { data } = await http.get('/users/me');
    bot = data;
    console.log(`Autenticação   : ✅ "${data.name}" em "${data.bot?.workspace_name}"`);
    console.log(`Integração     : ${data.id}`);
  } catch (erro) {
    console.error(`Autenticação   : ❌ ${N.traduzirErro(erro, 'users/me').message}`);
    return { ok: false, etapa: 'autenticacao' };
  }

  try {
    const { data } = await http.post('/search', { page_size: 100 });
    console.log(`Objetos visíveis: ${data.results.length === 0 ? '⚠️  0' : `✅ ${data.results.length}`}`);
  } catch (erro) {
    console.log(`Objetos visíveis: ❌ ${N.traduzirErro(erro, 'search').message}`);
  }

  console.log('\nBancos de dados:');
  const relatorio = [];
  for (const [nome, id] of Object.entries(IDS.bancos)) {
    try {
      const { data } = await http.get(`/databases/${id}`);
      const titulo = (data.title || []).map((t) => t.plain_text).join('') || nome;
      console.log(`  ✅ ${nome.padEnd(20)} ${titulo}`);
      relatorio.push({ nome, id, ok: true });
    } catch (erro) {
      const status = erro.response?.status;
      const motivo = status === 404 ? 'não compartilhado com a integração'
        : erro.response?.data?.message || erro.message;
      console.log(`  ❌ ${nome.padEnd(20)} ${status || '?'} — ${motivo}`);
      relatorio.push({ nome, id, ok: false, status });
    }
  }

  console.log('\nPáginas de skill (alvo da injeção de diretrizes):');
  for (const [nome, id] of Object.entries(IDS.agentes)) {
    try {
      await http.get(`/pages/${id}`);
      console.log(`  ✅ ${nome}`);
    } catch (erro) {
      console.log(`  ❌ ${nome} — ${erro.response?.status || '?'}`);
    }
  }

  const alcancaveis = relatorio.filter((r) => r.ok).length;
  console.log('\n' + '─'.repeat(62));
  console.log(`Alcance: ${alcancaveis}/${relatorio.length} bancos.`);

  if (alcancaveis === 0) {
    console.log(
      `\n⚠️  AÇÃO NECESSÁRIA — a integração "${bot.name}" (${bot.id})\n` +
      '    autentica, mas não vê nenhum objeto.\n\n' +
      '    Há três integrações neste workspace: "Notion MCP", "Make" e "ClaudeCode".\n' +
      '    O compartilhamento precisa ser NESTA, a ClaudeCode.\n\n' +
      '    No Notion: abra o Hub Central MED 1.5 → ⋯ (canto superior direito)\n' +
      '    → Conexões → procure por "ClaudeCode" → Confirmar.\n' +
      '    O acesso é herdado pelas subpáginas, então um compartilhamento basta.\n',
    );
  } else if (alcancaveis < relatorio.length) {
    console.log('    Compartilhe o Hub Central MED 1.5 para herdar o acesso aos bancos restantes.\n');
  } else {
    console.log('    Tudo alcançável. Jarvis operacional. ✅\n');
  }

  return { ok: alcancaveis > 0, alcancaveis, total: relatorio.length, relatorio };
}

// ── CLI ───────────────────────────────────────────────────────────

const valorDe = (args, flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const COMANDOS_CLI = {
  async diagnostico() {
    const r = await diagnostico();
    process.exitCode = r.ok ? 0 : 1;
  },

  async cronograma(args) {
    const dias = await Cronograma.lerCronograma({
      hoje: args.includes('--hoje'),
      pendentes: args.includes('--pendentes'),
      capacidade: args.includes('--capacidade'),
      de: valorDe(args, '--de'),
      ate: valorDe(args, '--ate'),
      semana: valorDe(args, '--semana'),
    });

    console.log(`\n📅 Cronograma de Ataque — ${dias.length} dia(s)\n` + '─'.repeat(62));
    for (const d of dias) {
      const marca = d.status.feito ? '✅' : d.status.atrasado ? '🔴' : '⬜';
      console.log(`${marca} ${d.data || '(sem data)'}  ${d.dia || ''}`);
      if (d.horas) console.log(`     ${d.horas}h planejadas · ${d.semana || '—'} · kit: ${d.status.kit || '—'}`);
      if (d.plano.ler) console.log(`     Ler: ${d.plano.ler}`);
      if (d.revisoesProgramadas) console.log(`     Revisões: ${d.revisoesProgramadas}`);
      if (d.capacidade) {
        const c = d.capacidade;
        const icone = { 'viável': '🟢', sobrecarregado: '🟠', indeterminado: '⚪' }[c.veredito];
        console.log(`     ${icone} ${c.veredito}: ${c.horasComprometidas}h comprometidas, ` +
          `teto efetivo ${c.tetoEfetivo}h${c.excesso ? `, excesso de ${c.excesso}h` : ''}`);
        for (const b of c.blocos) {
          console.log(`        • ${b.horaInicio || '--:--'} ${b.compromisso}` +
            `${b.duracao ? ` (${b.duracao}h)` : ' (duração não informada)'}${b.inegociavel ? ' 🔒' : ''}`);
        }
      }
    }
    if (!dias.length) console.log('(nenhum dia encontrado para esse filtro)');
    console.log('');
  },

  async compromissos(args) {
    const lista = await Compromissos.lerCompromissos({ incluirInativos: args.includes('--todos') });
    console.log(`\n🗓️  Compromissos — ${lista.length}\n` + '─'.repeat(62));
    for (const c of lista) {
      const quando = c.recorrencia === 'Única'
        ? N.soData(c.vigencia?.inicio)
        : `${c.recorrencia} ${c.diasDaSemana.join('/') || '(sem dia da semana!)'}`;
      console.log(`${c.ativo ? '✅' : '⏸️ '} ${String(c.compromisso).padEnd(28)} ${String(c.tipo || '').padEnd(14)} ` +
        `${String(quando).padEnd(22)} ${c.horaInicio || '--:--'} ` +
        `${typeof c.duracao === 'number' ? `${c.duracao}h` : '⚠️ sem duração'}${c.inegociavel ? ' 🔒' : ''}`);
    }
    const semDuracao = lista.filter((c) => typeof c.duracao !== 'number');
    if (semDuracao.length) {
      console.log(`\n⚠️  ${semDuracao.length} compromisso(s) sem "Duração (h)". Enquanto estiverem assim,`);
      console.log('    o cálculo de capacidade desses dias sai como "indeterminado" em vez de');
      console.log('    assumir zero e te dar um número otimista e errado.');
    }
    console.log('');
  },

  async revisoes(args) {
    const aplicar = args.includes('--aplicar');
    const r = await Revisoes.reconciliarRevisoes({
      aplicar, de: valorDe(args, '--de'), ate: valorDe(args, '--ate'),
    });

    console.log(`\n🔁 Reconciliação de revisões ${aplicar ? '(APLICANDO)' : '(simulação)'}\n` + '─'.repeat(62));
    console.log(`Tópicos lidos: ${r.topicosLidos} · dias avaliados: ${r.diasAvaliados}`);
    console.log(`Fonte das datas: ${Object.entries(r.fontes).filter(([, n]) => n)
      .map(([f, n]) => `${n} por ${f}`).join('; ') || '—'}`);
    console.log(`Já corretos: ${r.inalterados} · a mudar: ${r.mudancas.length}\n`);

    for (const m of r.mudancas) {
      console.log(`${m.data} ${m.dia || ''}`);
      console.log(`  − ${m.antes || '(vazio)'}`);
      console.log(`  + ${m.depois}`);
    }
    if (!r.mudancas.length) console.log('(nada a mudar — o cronograma já reflete o Hub)');
    if (!aplicar && r.mudancas.length) {
      console.log('\nSimulação. Para gravar: node index.js revisoes --aplicar');
    }
    console.log('');
  },

  async auditoria(args) {
    const lista = await Agentes.lerAuditoria({ pendentesApenas: !args.includes('--todas') });
    console.log(`\n🔬 Auditoria de Agentes — ${lista.length}\n` + '─'.repeat(62));
    for (const a of lista) {
      console.log(`${a.classificacao || '—'} ${a.agente || '(sem agente)'} · ${a.status || '—'}`);
      console.log(`   ${a.auditoria || '(sem título)'}`);
      if (a.observacao) console.log(`   obs: ${a.observacao}`);
      if (a.diretrizGerada) console.log(`   diretriz: ${a.diretrizGerada}`);
    }
    if (!lista.length) console.log('(nenhuma auditoria pendente)');
    console.log('');
  },

  async otimizar(args) {
    const aplicar = args.includes('--aplicar');
    const r = await Agentes.otimizarAgentes({
      aplicar, ...(args.includes('--llm') ? { usarLLM: true } : {}),
    });

    console.log(`\n🧠 Loop de autoaperfeiçoamento ${aplicar ? '(APLICANDO)' : '(simulação)'}\n` + '─'.repeat(62));
    console.log(`Otimizador: ${r.otimizador} · auditorias pendentes: ${r.auditoriasPendentes}\n`);

    for (const res of r.resultados) {
      if (res.erro) { console.log(`❌ ${res.auditoria}\n   ${res.erro}`); continue; }
      console.log(`▸ ${res.agente} — ${res.classificacao}`);
      console.log(`  obs: ${res.observacao}`);
      console.log(`  padrões: ${(res.padroes || []).join(', ')} (${res.motivo})`);
      for (const d of res.diretrizes) console.log(`  + ${d}`);
      if (aplicar) {
        console.log(`  → injetadas ${res.injetadas}, duplicadas ${res.duplicadas}, versão v${res.versao}`);
      }
    }
    if (!r.resultados.length) console.log('(nada pendente — nenhum output foi marcado como inadequado)');
    if (!aplicar && r.resultados.some((x) => !x.erro)) {
      console.log('\nSimulação. Para gravar nas skills: node index.js otimizar --aplicar');
    }
    console.log('');
  },

  async agente(args) {
    const [pedido, comando, ...resto] = args.filter((a) => !a.startsWith('--'));
    if (!pedido) {
      console.error('Uso: node index.js agente "<pedido>" "<comando>" ["<detalhes>"]');
      console.error(`Comandos: ${Agentes.COMANDOS.join(' · ')}`);
      process.exitCode = 1;
      return;
    }
    const r = await Agentes.gerenciarAgente({
      pedido, comando: comando || 'Outro', detalhes: resto.join(' ') || undefined,
    });
    console.log(`\n✅ Pedido ${r.acao}: "${r.pedido}"\n   ${r.url}\n`);
  },

  async promover(args) {
    const aplicar = args.includes('--aplicar');
    const r = await Code.promoverPedidos({ aplicar });

    console.log(`\n📥 Promoção de pedidos ${aplicar ? '(APLICANDO)' : '(simulação)'}\n` + '─'.repeat(62));
    console.log(`Dias avaliados: ${r.diasAvaliados} · marcados "${Code.PEDIR}": ${r.aPromover.length}\n`);
    for (const a of r.aPromover) {
      console.log(`▸ ${a.data} → "${a.titulo}"`);
      console.log(`  ${a.detalhes}`);
      if (a.topicos.length) console.log(`  ${a.topicos.length} tópico(s) ligados`);
    }
    if (!r.aPromover.length) console.log('(nenhum dia pedindo kit)');
    if (aplicar && r.promovidos) {
      console.log(`\n✅ ${r.promovidos} promovido(s); os dias passaram a "${Code.GERANDO}".`);
      for (const x of r.resultados) console.log(`   ${x.pedidoUrl}`);
    }
    if (!aplicar && r.aPromover.length) {
      console.log('\nSimulação. Para gravar: node index.js promover --aplicar');
    }
    console.log('');
  },

  async materiais(args) {
    const aplicar = args.includes('--aplicar');
    if (args.includes('--objetivos')) {
      const dias = Number(valorDe(args, '--dias')) || 7;
      const lista = await Materiais.lerMateriais();
      const o = Materiais.objetivosDeEstudo(lista, { dias });
      console.log(`\n🎯 Objetivos de estudo · últimos ${dias} dias (desde ${o.desde})\n` + '─'.repeat(62));
      for (const m of o.itens) {
        console.log(`▸ ${m.material}${m.encontro ? ` · ${m.encontro}` : ''}${m.recebidoEm ? ` · ${m.recebidoEm}` : ''}`);
        console.log(`  Objetivos: ${m.objetivos || '—'}`);
        console.log(`  Sinais de prova: ${m.sinais || '—'}`);
        console.log(`  Anki: ${m.baralho || '—'} · ${m.exercicios} exercício(s), ${m.flashcards} flashcard(s)`);
      }
      if (!o.itens.length) console.log('(nenhum kit pronto na janela)');
      if (o.pendentes.length) console.log(`\n${o.pendentes.length} material(is) ainda sem kit.`);
      console.log('');
      return;
    }

    const r = await Materiais.promoverMateriais({ aplicar });
    console.log(`\n🧩 Materiais da professora → kit ${aplicar ? '(APLICANDO)' : '(simulação)'}\n` + '─'.repeat(62));
    console.log(`Materiais com Kit "${Materiais.KIT.novo}": ${r.novos}\n`);
    for (const a of r.aPromover) {
      console.log(`▸ ${a.recebidoEm || '—'} · ${a.tipo || '—'} → "${a.titulo}"`);
      console.log(`  ${a.detalhes}`);
      if (a.topicos.length) console.log(`  ${a.topicos.length} tópico(s) ligados`);
    }
    if (!r.aPromover.length) console.log('(nenhum material novo)');
    if (aplicar && r.promovidos) {
      console.log(`\n✅ ${r.promovidos} promovido(s); os materiais passaram a "${Materiais.KIT.gerando}".`);
      for (const x of r.resultados) console.log(`   ${x.pedidoUrl}`);
    }
    if (!aplicar && r.aPromover.length) {
      console.log('\nSimulação. Para gravar: node index.js materiais --aplicar');
    }
    console.log('');
  },

  async jarvis(args) {
    const aplicar = args.includes('--aplicar');
    const texto = args.filter((a) => !a.startsWith('--')).join(' ');
    if (!texto) {
      console.error('Uso: node index.js jarvis "<pergunta>" [--aplicar]');
      console.error('Escreva solto, sem barra. Ex: node index.js jarvis "o que eu faço hoje?"');
      console.error(`Comandos explícitos: ${Object.values(Code.COMANDOS_CODE).map((c) => c.uso).join(' · ')}`);
      process.exitCode = 1;
      return;
    }

    const resposta = await Code.executar(texto);
    console.log(`\n❯ ${texto}\n` + '─'.repeat(62));
    console.log(`${resposta.titulo}` +
      (resposta.via ? `   [${resposta.via}${resposta.comando ? ` → ${resposta.comando}` : ''}]` : '') + '\n');
    for (const b of resposta.blocos || []) {
      if (b.voz) { console.log(`\n  ↳ ${b.texto}`); continue; }
      console.log(`${b.t === 'b' ? '  • ' : b.t === 'h' ? '\n' : '  '}${b.texto}`);
    }
    if (aplicar) {
      const inj = await Code.injetarNoDisplay(resposta, {
        marcaTempo: new Date().toISOString().slice(0, 16).replace('T', ' '),
      });
      console.log(`\n✅ Injetado no display ${inj.displayId}` +
        ` (−${inj.blocosRemovidos} blocos, +${inj.blocosInjetados})`);
    } else {
      console.log('\nNão injetado. Para mandar ao display do Hub: --aplicar');
    }
    console.log('');
  },

  async fila(args) {
    const aplicar = args.includes('--aplicar');
    const r = await Code.atenderFila({ aplicar });

    console.log(`\n🧾 Fila do Code ${aplicar ? '(APLICANDO)' : '(simulação)'}\n` + '─'.repeat(62));
    console.log(`Pendentes de texto na Central: ${r.naFila}\n`);
    for (const a of r.atendidos) {
      console.log(`▸ "${a.pedido}"`);
      console.log(`  ❯ ${a.texto}`);
      console.log(`  ${a.resposta.titulo}`);
      for (const b of a.resposta.blocos || []) console.log(`    • ${b.texto}`);
    }
    if (!r.atendidos.length) console.log('(nada a atender)');
    if (r.injecao) console.log(`\n✅ Display atualizado: ${r.injecao.displayId}`);
    if (!aplicar && r.atendidos.length) {
      console.log('\nSimulação. Para responder e injetar: node index.js fila --aplicar');
    }
    console.log('');
  },

  // `code` segue aceito como apelido do comando antigo.
  async code(args) { return COMANDOS_CLI.jarvis(args); },

  ids() { console.log(JSON.stringify(IDS, null, 2)); },

  ajuda() {
    console.log(`
Jarvis · automação do Notion

  node index.js diagnostico                  Autenticação e alcance (comece por aqui)

  node index.js cronograma [filtros]         Plano diário
      --hoje · --pendentes · --capacidade · --de <AAAA-MM-DD> · --ate <...> · --semana "<nome>"
      --capacidade cruza com Compromissos e calcula o tempo livre real

  node index.js compromissos [--todos]       Blocos fixos de tempo

  node index.js revisoes [--aplicar]         Reconcilia as revisões com o Hub
      Sem --aplicar é simulação: mostra o diff sem gravar

  node index.js auditoria [--todas]          Auditorias de output dos agentes

  node index.js otimizar [--aplicar] [--llm] Converte auditorias em diretrizes e
      injeta nas páginas das skills. Sem --aplicar é simulação

  node index.js agente "<pedido>" "<comando>" ["<detalhes>"]
                                             Cria ou atualiza pedido na Central de Comandos

  — Materiais da professora (o gatilho do estudo) —

  node index.js materiais [--aplicar]        Todo material com Kit "📥 Novo" vira pedido
      "Kit de estudo" na Central de Comandos (resumo + exercícios + flashcards).
      Sem --aplicar é simulação
  node index.js materiais --objetivos [--dias N]
                                             Objetivos de estudo e sinais de prova dos
      kits prontos na janela: o resumo que guia a notificação

  — Jarvis Code —

  node index.js promover [--aplicar]         Promove "📥 Pedir" do Cronograma a pedido
      de kit na Central de Comandos (dia sem material da professora)

  node index.js jarvis "<pergunta>" [--aplicar]
                                             Conversa com o Jarvis Code. Escreva solto,
      sem barra: "o que eu faço hoje?", "o que a professora quer?", "tá fixando?",
      "tenho tempo quinta?", "como tá o F04?".
      Com --aplicar, injeta a resposta no display do Hub.
      Comandos explícitos também funcionam:
      ${Object.values(Code.COMANDOS_CODE).map((c) => c.uso).join(' · ')}

  node index.js fila [--aplicar]             Atende os comandos de texto da fila
      e injeta a última resposta no display

  node index.js ids                          Mapa de IDs
  node index.js ajuda                        Esta mensagem

Variáveis: NOTION_TOKEN · JANELA_UTIL_H (${N.JANELA_UTIL_H}) · TETO_ESTUDO_DIA_H (${N.TETO_ESTUDO_DIA_H})
           ANTHROPIC_API_KEY (opcional, habilita o otimizador por LLM)

Antes de alterar o código, leia jarvis_architecture_log.md.
`);
  },
};

async function main() {
  const [comando = 'ajuda', ...args] = process.argv.slice(2);
  const executar = COMANDOS_CLI[comando];
  if (!executar) {
    console.error(`Comando desconhecido: "${comando}"`);
    COMANDOS_CLI.ajuda();
    process.exitCode = 1;
    return;
  }
  try {
    await executar(args);
  } catch (erro) {
    console.error(`\n❌ ${erro.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  // mapa e transporte
  IDS, http, notion, diagnostico,
  COMANDOS: Agentes.COMANDOS, STATUS_PEDIDO: Agentes.STATUS_PEDIDO,
  CLASSIFICACAO: Agentes.CLASSIFICACAO, STATUS_AUDITORIA: Agentes.STATUS_AUDITORIA,
  // leitura
  lerCronograma: Cronograma.lerCronograma,
  lerCompromissos: Compromissos.lerCompromissos,
  lerTopicosHub: Revisoes.lerTopicosHub,
  lerAuditoria: Agentes.lerAuditoria,
  lerMateriais: Materiais.lerMateriais,
  // escrita
  gerenciarAgente: Agentes.gerenciarAgente,
  buscarPedido: Agentes.buscarPedido,
  reconciliarRevisoes: Revisoes.reconciliarRevisoes,
  otimizarAgentes: Agentes.otimizarAgentes,
  injetarDiretrizes: Agentes.injetarDiretrizes,
  promoverMateriais: Materiais.promoverMateriais,
  // materiais → objetivos e consolidação (puro)
  KIT: Materiais.KIT, COMANDO_KIT: Materiais.COMANDO_KIT, LIMIARES: Materiais.LIMIARES,
  objetivosDeEstudo: Materiais.objetivosDeEstudo,
  sugestoesDeConsolidacao: Materiais.sugestoesDeConsolidacao,
  resumoDeConsolidacao: Materiais.resumoDeConsolidacao,
  tituloPedidoDoMaterial: Materiais.tituloPedidoDoMaterial,
  // Code
  COMANDOS_CODE: Code.COMANDOS_CODE,
  interpretar: Code.interpretar,
  dataDosArgumentos: Code.dataDosArgumentos,
  executarCode: Code.executar,
  paraBlocosNotion: Code.paraBlocosNotion,
  promoverPedidos: Code.promoverPedidos,
  atenderFila: Code.atenderFila,
  injetarNoDisplay: Code.injetarNoDisplay,
  encontrarDisplay: Code.encontrarDisplay,
  // puro / testável
  lerPropriedade: N.lerPropriedade, lerPropriedades: N.lerPropriedades,
  consultarBanco: N.consultarBanco, dataDeFormula: N.dataDeFormula,
  somarDias: N.somarDias, diffDias: N.diffDias, diaSemana: N.diaSemana,
  ocorreEm: Compromissos.ocorreEm,
  horasComprometidasEm: Compromissos.horasComprometidasEm,
  avaliarCapacidade: Compromissos.avaliarCapacidade,
  derivarRevisoesDoTopico: Revisoes.derivarRevisoesDoTopico,
  indexarPorData: Revisoes.indexarPorData,
  textoDerivado: Revisoes.textoDerivado,
  sintetizarDiretriz: Agentes.sintetizarDiretriz,
  TAXONOMIA: Agentes.TAXONOMIA,
  // submódulos
  N, Compromissos, Cronograma, Revisoes, Agentes, Materiais, Code,
};
