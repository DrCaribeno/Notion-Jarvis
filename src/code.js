/**
 * Jarvis Code — o assistente de retorno do Hub.
 *
 * Três responsabilidades:
 *   1. `promoverPedidos()`  Cronograma `📥 Pedir` → pedido formal na Central de
 *                           Comandos. Fecha a pendência 3: a Central passa a ser
 *                           a única fila de trabalho.
 *   2. `atenderFila()`      Lê o que você escreveu, interpreta e responde.
 *   3. `injetarNoDisplay()` Injeta a resposta formatada no bloco de display do
 *                           Hub (um synced block), que é a tela do Jarvis Code.
 *
 * COMO ELE ENTENDE O QUE VOCÊ ESCREVE
 *
 * Você não vai digitar comandos ali — vai conversar. Então `interpretar()` tem
 * dois caminhos: casa um comando explícito (`/hoje`) quando ele aparece, e
 * senão **classifica a frase por intenção**, com uma tabela de sinônimos
 * (`INTENCOES`). "o que eu faço hoje?", "tenho tempo quinta?", "como tá o F04?"
 * e "o que tá atrasado?" todas chegam ao handler certo.
 *
 * Isso é classificação de intenção, não compreensão de linguagem: não há
 * credencial de LLM (ADR-008). A vantagem é que funciona hoje, é testável sem
 * rede e **nunca inventa um dado do seu Hub** — se não entender, diz que não
 * entendeu e sugere o que sabe fazer. Com uma chave de LLM, `interpretar()`
 * ganha um caminho melhor sem mudar mais nada.
 */

'use strict';

const N = require('./notion');
const Compromissos = require('./compromissos');
const Cronograma = require('./cronograma');
const Revisoes = require('./revisoes');
const Agentes = require('./agentes');
const Materiais = require('./materiais');

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
  objetivos:  { uso: '/objetivos [dias]',  descricao: 'O que a professora quer: objetivos e sinais de prova dos materiais recentes' },
  materiais:  { uso: '/materiais',         descricao: 'Materiais da professora ainda sem kit' },
  consolidar: { uso: '/consolidar [ID]',   descricao: 'Como o aprendizado está consolidando, lido no Anki' },
  ajuda:      { uso: '/ajuda',             descricao: 'Esta lista' },
};

/**
 * Classificação de intenção para conversa casual.
 *
 * A ordem importa: o primeiro que casar ganha, então o mais específico vem
 * antes. `status` está no fim de propósito — "como tá" é genérico e só deve
 * vencer se nada mais específico tiver casado.
 */
const INTENCOES = [
  { comando: 'ajuda', teste: /\bajuda|socorro|help|o que (voce|vc|tu) (faz|sabe|pode)|quais.*(comando|op[cç]|coisa)|como (te )?(uso|usar|falo)\b/ },
  { comando: 'pendentes', teste: /\batrasad|pendente|atraso|devendo|deixei (pra|para) tr[aá]s|fiquei para tr[aá]s|em d[ií]vida|nao fiz|ficou para tr[aá]s\b/ },
  // Materiais da professora sem kit: "chegou material", "o que tá sem kit".
  { comando: 'materiais', teste: /\bmateria(l|is)\b|sem kit|kit pendente|chegou (aula|slide|conferencia|problema)|a (prof|professora) (mandou|enviou)/ },
  // Objetivos de estudo e sinais de prova: "o que a professora quer", "o que cai".
  { comando: 'objetivos', teste: /\bobjetivo|professora|o que cai|sina(l|is) de prova|o que (eu )?(preciso|tenho que|devo) (saber|estudar|aprender)|o que ela (quer|cobra|enfatiz)/ },
  // Consolidação, lida no Anki: "tá fixando?", "retenção", "o que consolidar".
  { comando: 'consolidar', teste: /consolid|\banki\b|reten[cç]|memoriz|fixa(r|ndo|ou)|esquec|lapso|decor(ar|ei)/ },
  { comando: 'fracos', teste: /\bfraco|fraqueza|refor[cç]o|pior|ruim|mal\b|dificuldade|travad|empacad|nao entr[ao]|onde (eu )?err/ },
  { comando: 'revisoes', teste: /\brevis|\br1\b|\br2\b|\br3\b|pre.?prova|relembr|rever\b/ },
  { comando: 'capacidade', teste: /\btempo|livre|cabe\b|aguent|capacidade|sobra|quantas horas|consigo (estudar|encaixar)|d[aá] tempo|folga\b/ },
  { comando: 'agenda', teste: /\bagenda|compromisso|aula|tutorial|prova\b|ocupad|marcad|reuni[aã]o|treino|atl[eé]tica|liga\b|iesc\b/ },
  { comando: 'hoje', teste: /\bhoje|agora|plano do dia|dia de hoje|come[cç]ar|o que (eu )?(fa[cç]o|estudo|leio|tenho|tem)\b/ },
  { comando: 'status', teste: /\bstatus|situa[cç][aã]o|andamento|como (t[aá]|est[aá]|vai|anda)|j[aá] (estudei|vi|dominei)|domin/ },
];

/**
 * Procura um ID de tópico do Hub em qualquer lugar da frase.
 * Os prefixos reais são F, N, R, C, K, E, H e I (ver seção 5 do log).
 * Aceita "F4" e "f 04" e normaliza para `F04`.
 */
function extrairIdTopico(texto) {
  const m = String(texto || '').match(/\b([FNRCKEHI])\s?(\d{1,2})\b/i);
  if (!m) return null;
  return `${m[1].toUpperCase()}${m[2].padStart(2, '0')}`;
}

const DIAS_ESCRITOS = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6,
};

/**
 * Procura uma data em qualquer lugar da frase: ISO, dd/mm, "dia 26",
 * hoje/amanhã/ontem, ou um dia da semana escrito ("quinta" → a próxima quinta,
 * incluindo hoje se hoje já for quinta). Devolve null se não achar nada — quem
 * chama decide o padrão.
 */
function extrairDataDoTexto(texto, hoje = N.hoje()) {
  const bruto = String(texto || '');
  const limpo = normalizar(bruto);

  const iso = bruto.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const br = bruto.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (br) {
    const ano = br[3] || hoje.slice(0, 4);
    return `${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  }

  // Ordem importa: "depois de amanha" contém "amanha" e tem de vencer primeiro.
  if (/\bdepois de amanha\b/.test(limpo)) return N.somarDias(hoje, 2);
  if (/\bamanha\b/.test(limpo)) return N.somarDias(hoje, 1);
  if (/\bontem\b/.test(limpo)) return N.somarDias(hoje, -1);
  if (/\bhoje\b/.test(limpo)) return hoje;

  const dia = bruto.match(/\bdia\s+(\d{1,2})\b/i);
  if (dia) return `${hoje.slice(0, 7)}-${String(dia[1]).padStart(2, '0')}`;

  for (const [nome, alvo] of Object.entries(DIAS_ESCRITOS)) {
    if (!new RegExp(`\\b${nome}`).test(limpo)) continue;
    const atual = N.DIAS_SEMANA.indexOf(N.diaSemana(hoje));
    return N.somarDias(hoje, (alvo - atual + 7) % 7);
  }
  return null;
}

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
  const [primeira] = limpo.split(/\s+/);

  // Caminho 1: comando explícito. Exato, depois por prefixo (>= 4 letras, para
  // `revis` → `revisoes`). Prefixo curto NÃO casa, senão texto solto viraria
  // comando por acidente.
  let comando = Object.keys(COMANDOS_CODE).find((c) => c === primeira);
  if (!comando && primeira.length >= 4) {
    comando = Object.keys(COMANDOS_CODE).find((c) => c.startsWith(primeira));
  }
  let via = comando ? 'comando' : null;

  // Caminho 2: conversa. Classifica a frase por intenção.
  if (!comando) {
    const achado = INTENCOES.find((i) => i.teste.test(limpo));
    if (achado) { comando = achado.comando; via = 'conversa'; }
  }

  // Último recurso: a frase cita um dia mas nenhuma intenção casou
  // ("e amanhã?", "o que rola dia 26?"). O plano do dia é a resposta útil.
  if (!comando && extrairDataDoTexto(bruto)) { comando = 'hoje'; via = 'conversa'; }

  if (!comando) return { comando: null, argumentos: [], reconhecido: false, bruto, via: null };

  let argumentos;
  if (via === 'comando') {
    // Argumentos saem do texto ORIGINAL, para preservar caixa (IDs são F04).
    argumentos = bruto.trim().replace(/^\/+/, '').split(/\s+/).slice(1)
      .map((a) => a.replace(/[:,]$/, '')).filter(Boolean);
  } else {
    // Em conversa não há posição fixa: pescamos o que importa da frase inteira.
    argumentos = [extrairIdTopico(bruto), extrairDataDoTexto(bruto)].filter(Boolean);
  }

  return { comando, argumentos, reconhecido: true, bruto, via };
}

/**
 * Resolve a data a usar a partir dos argumentos. Cai em hoje quando nenhum
 * argumento carrega data — é o padrão útil para "tenho tempo?" sem dia.
 */
function dataDosArgumentos(argumentos, hoje = N.hoje()) {
  for (const a of argumentos) {
    const achada = extrairDataDoTexto(a, hoje);
    if (achada) return achada;
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
  /** Linha da voz do Jarvis. Sempre a última, sempre cinza, sempre separável. */
  voz: (texto) => ({ t: 'p', texto, cor: 'gray', voz: true }),
};

const ICONE_VEREDITO = { 'viável': '🟢', sobrecarregado: '🟠', indeterminado: '⚪' };

// ── A voz do Jarvis ───────────────────────────────────────────────

/**
 * REGRA DE OURO: a personalidade vive na MOLDURA, nunca nos números.
 *
 * Os handlers produzem fatos. Esta camada acrescenta UMA linha de comentário no
 * fim, em cinza e marcada com `voz: true`. Nenhum dado passa por aqui, então
 * nenhuma piada pode corromper uma hora, uma data ou um percentual — e quem
 * quiser o retorno cru só precisa descartar os blocos com `voz`.
 *
 * O tom é o do Jarvis: educado, seco, prestativo, e com o bom senso de avisar
 * quando a aritmética não fecha. Ele não bajula e não dramatiza.
 *
 * Determinístico de propósito: a escolha sai de uma característica do próprio
 * fato (`escolher`), não de aleatoriedade. Varia conforme a situação, mas a
 * mesma situação sempre dá a mesma frase — do contrário não haveria como testar.
 */

/** Escolhe uma entre várias falas, de forma estável para o mesmo fato. */
const escolher = (opcoes, semente) => opcoes[Math.abs(Number(semente) || 0) % opcoes.length];

const voz = {
  hoje({ veredito, excesso, feito, kit, horas }) {
    if (feito) return escolher([
      'Dia marcado como feito. Anotado, e com certo orgulho.',
      'Feito. Permita-me registrar que isto está virando hábito.',
    ], horas);
    if (veredito === 'sobrecarregado') {
      return `O plano pede ${horas}h e o dia aguenta ${(horas - excesso).toFixed(1)}h. `
        + 'A física é inflexível; o cronograma, não. Posso redistribuir.';
    }
    if (veredito === 'indeterminado') {
      return 'Não consigo fechar a conta: há compromisso sem duração informada. '
        + 'Prefiro dizer que não sei a lhe dar um número bonito e errado.';
    }
    if (kit === '📥 Pedir') return 'O kit do dia está pedido. Entra na próxima rotina das 5h.';
    return escolher([
      'Dia viável. Sugiro começar antes que ele deixe de ser.',
      'Cabe. Recomendo aproveitar a folga enquanto ela existe.',
    ], horas);
  },

  capacidade({ veredito, excesso, tempoLivre, inegociaveis }) {
    if (veredito === 'indeterminado') {
      return 'Há bloco sem duração na agenda. Com ele preenchido, eu lhe dou o número exato.';
    }
    if (veredito === 'sobrecarregado') {
      return `Faltam ${excesso}h para o plano caber. `
        + (inegociaveis ? 'E o que está travado não negocia — sobra mexer no estudo.' : 'Algo tem de sair.');
    }
    if (tempoLivre >= 12) return 'Dia notavelmente vazio. Isto costuma ser temporário.';
    return 'A conta fecha, com folga.';
  },

  pendentes({ n }) {
    if (n === 0) return 'Nada atrasado. Registro isto como um evento digno de nota.';
    if (n === 1) return 'Um dia atrasado. Ainda é um número civilizado.';
    if (n <= 3) return `${n} dias atrasados. Recuperável, se começar hoje.`;
    return `${n} dias atrasados. Posso redistribuir sem passar de 6h por dia — `
      + 'ou seguimos ambos fingindo que não contei.';
  },

  fracos({ n }) {
    if (n === 0) return 'Nenhum tópico em Reforço. Vazio aqui é a melhor notícia que eu posso dar.';
    if (n === 1) return 'Um tópico em Reforço. Mini-apostila de correção resolve.';
    return `${n} tópicos em Reforço. Sugiro atacá-los antes dos novos — `
      + 'o acúmulo aqui é o que derruba na prova.';
  },

  agenda({ n, horas, confiavel }) {
    if (n === 0) return 'Agenda livre. Suspeito que não por muito tempo.';
    if (!confiavel) return 'Falta duração em algum bloco, então o total está incompleto.';
    if (horas >= 8) return `${horas}h comprometidas. Hoje o estudo disputa espaço.`;
    return `${horas}h comprometidas. O resto do dia é seu.`;
  },

  revisoes({ n }) {
    if (n === 0) return 'Nenhuma revisão hoje. Bom dia para adiantar matéria nova.';
    if (n >= 8) return `${n} revisões no mesmo dia. Isto costuma ser sinal de acúmulo, não de disciplina.`;
    return `${n} revisão(ões). São as que mantêm o que você já estudou de pé.`;
  },

  status({ status, temDataReal }) {
    if (status === 'Reforço') return 'Este está em Reforço. É dos que merecem atenção fora de hora.';
    if (status === 'Dominado') return 'Dominado. Deixe com o Anki e siga adiante.';
    if (!temDataReal) {
      return 'Sem Data Real de Estudo, as revisões saem da Data Alvo. '
        + 'Preencha quando estudar e elas passam a seguir o seu ritmo, não o previsto.';
    }
    return null;
  },

  objetivos({ n, pendentes }) {
    if (n === 0 && pendentes === 0) return 'Nenhum material da professora ainda. Quando chegar, o estudo começa por ele.';
    if (n === 0) return `${pendentes} material(is) esperando kit. Os objetivos aparecem quando a rotina das 5h passar.`;
    if (pendentes) return `${n} kit(s) prontos e ${pendentes} na fila. O que ela enfatiza está em Sinais de prova — leia antes do livro.`;
    return 'Tudo o que ela mandou já virou kit. O retrato do que cai está se formando nos Sinais de prova.';
  },

  materiais({ n }) {
    if (n === 0) return 'Nenhum material sem kit. A professora manda, eu transformo; por ora, estamos quites.';
    if (n === 1) return 'Um material esperando kit. Entra na próxima rotina das 5h, ou agora, se pedir.';
    return `${n} materiais esperando kit. Problema de tutorial vai primeiro; o resto, na ordem em que chegou.`;
  },

  consolidar({ n, semSincronizar, semCards, urgentes }) {
    if (semSincronizar) return 'O Anki não sincroniza há mais de dois dias. Sem isso, estou lendo um placar velho.';
    if (n === 0 && semCards) return 'Nenhum tópico com cards no Anki ainda. O primeiro kit muda isso.';
    if (urgentes) return `${urgentes} tópico(s) pedem revisão antes de matéria nova. Memória é como dívida: juros compostos.`;
    return 'Nada urgente. O que foi visto está se fixando no ritmo esperado.';
  },
};

/** Monta a linha da voz, se houver algo que valha dizer. */
function comentar(comando, fatos) {
  const fn = voz[comando];
  if (!fn || !fatos) return null;
  try {
    const linha = fn(fatos);
    return linha ? r.voz(linha) : null;
  } catch {
    return null; // a voz nunca derruba uma resposta
  }
}

// ── Handlers ──────────────────────────────────────────────────────

/** Fontes de dados injetáveis — os testes passam dublês no lugar dos módulos. */
const FONTES_PADRAO = {
  lerCronograma: Cronograma.lerCronograma,
  lerCompromissos: Compromissos.lerCompromissos,
  lerTopicosHub: Revisoes.lerTopicosHub,
  lerMateriais: Materiais.lerMateriais,
};

const HANDLERS = {
  async ajuda() {
    return {
      titulo: 'O que eu sei fazer',
      blocos: [
        ...Object.values(COMANDOS_CODE).map((c) => r.b(`${c.uso} — ${c.descricao}`)),
        r.voz('A barra é opcional. Pergunte como falaria com uma pessoa: '
          + '"o que eu faço hoje?", "tenho tempo quinta?", "como tá o F04?".'),
      ],
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
    if (d.relacoes.materiaisDoDia.length) {
      blocos.push(r.b(`Materiais da aula — ${d.relacoes.materiaisDoDia.length} ligado(s) a este dia`));
    }
    if (d.status.kit) blocos.push(r.b(`Kit de estudo — ${d.status.kit}`));
    blocos.push(r.p(d.status.feito ? '✅ Marcado como feito.' : '⬜ Ainda não marcado como feito.'));
    return {
      titulo: `Plano de ${data}`, blocos,
      fatos: {
        veredito: d.capacidade?.veredito, excesso: d.capacidade?.excesso || 0,
        feito: d.status.feito, kit: d.status.kit, horas: d.horas || 0,
      },
    };
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
    return {
      titulo: `Capacidade de ${data}`, blocos,
      fatos: {
        veredito: c.veredito, excesso: c.excesso, tempoLivre: c.tempoLivre,
        inegociaveis: c.blocos.some((b) => b.inegociavel),
      },
    };
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
    return { titulo: `Revisões de ${data}`, blocos, fatos: { n: doDia.length } };
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
    return {
      titulo: `Status de ${alvo}`, blocos,
      fatos: { status: achados[0].status, temDataReal: Boolean(achados[0].dataReal) },
    };
  },

  async pendentes(argumentos, fontes) {
    const dias = await fontes.lerCronograma({ pendentes: true });
    const hoje = N.hoje();
    const atrasados = dias.filter((d) => d.data && d.data < hoje);
    if (!atrasados.length) {
      return {
        titulo: 'Dias atrasados',
        blocos: [r.p('✅ Nada atrasado. Cronograma em dia.')],
        fatos: { n: 0 },
      };
    }
    return {
      titulo: `Dias atrasados (${atrasados.length})`,
      blocos: atrasados.map((d) => r.b(`🔴 ${d.data} — ${d.dia || ''}${d.horas ? ` (${d.horas}h)` : ''}`)),
      fatos: { n: atrasados.length },
    };
  },

  async fracos(argumentos, fontes) {
    const topicos = await fontes.lerTopicosHub();
    const fracos = topicos.filter((t) => t.status === 'Reforço');
    if (!fracos.length) {
      return {
        titulo: 'Pontos fracos',
        blocos: [r.p('✅ Nenhum tópico em Reforço.')],
        fatos: { n: 0 },
      };
    }
    return {
      titulo: `Pontos fracos (${fracos.length})`,
      blocos: fracos.map((t) => r.b(`${t.idHumano || '—'} · ${t.topico || ''} — ${t.sistema || ''}`, 'red')),
      fatos: { n: fracos.length },
    };
  },

  async agenda(argumentos, fontes) {
    const data = dataDosArgumentos(argumentos);
    const compromissos = await fontes.lerCompromissos();
    const soma = Compromissos.horasComprometidasEm(compromissos, data);
    if (!soma.blocos.length) {
      return {
        titulo: `Agenda de ${data}`,
        blocos: [r.p('Nenhum compromisso neste dia.')],
        fatos: { n: 0, horas: 0, confiavel: true },
      };
    }
    const blocos = soma.blocos
      .slice()
      .sort((a, b) => String(a.horaInicio || '~').localeCompare(String(b.horaInicio || '~')))
      .map((b) => r.b(`${b.horaInicio || '--:--'} ${b.compromisso} · ${b.tipo || ''}` +
        `${b.duracao ? ` (${b.duracao}h)` : ' — sem duração'}${b.inegociavel ? ' 🔒' : ''}`));
    blocos.push(r.p(`Total conhecido: ${soma.horas}h` +
      (soma.confiavel ? '' : ` · ${soma.indeterminados.length} bloco(s) sem duração`), 'gray'));
    return {
      titulo: `Agenda de ${data}`, blocos,
      fatos: { n: soma.blocos.length, horas: soma.horas, confiavel: soma.confiavel },
    };
  },

  /**
   * O que a professora quer: objetivos e sinais de prova dos materiais já
   * processados na janela recente. É o mesmo resumo que vai na notificação.
   */
  async objetivos(argumentos, fontes) {
    const dias = Number(argumentos.find((a) => /^\d{1,3}$/.test(String(a)))) || 7;
    const materiais = await fontes.lerMateriais();
    const r0 = Materiais.objetivosDeEstudo(materiais, { dias });
    const blocos = [];
    if (!r0.itens.length) {
      blocos.push(r.p(`Nenhum kit pronto nos últimos ${dias} dias.`));
    }
    for (const m of r0.itens) {
      blocos.push(r.h(`${m.material}${m.encontro ? ` · ${m.encontro}` : ''}${m.recebidoEm ? ` · ${m.recebidoEm}` : ''}`));
      blocos.push(r.b(`Objetivos — ${m.objetivos || 'ainda não preenchidos'}`));
      blocos.push(r.b(`Sinais de prova — ${m.sinais || 'sem sinal registrado'}`, m.sinais ? 'red' : undefined));
      blocos.push(r.b(`Anki — ${m.baralho || 'baralho não informado'} · ${m.exercicios} exercício(s), ${m.flashcards} flashcard(s)`));
    }
    if (r0.pendentes.length) {
      blocos.push(r.p(`${r0.pendentes.length} material(is) ainda sem kit: ` +
        r0.pendentes.map((p) => `${p.material} (${p.kit})`).join(', '), 'gray'));
    }
    return {
      titulo: `Objetivos de estudo · últimos ${dias} dias`, blocos,
      fatos: { n: r0.itens.length, pendentes: r0.pendentes.length },
    };
  },

  /** Materiais da professora que ainda não viraram kit, na ordem de atendimento. */
  async materiais(argumentos, fontes) {
    const todos = await fontes.lerMateriais();
    const pendentes = Materiais.ordenarParaAtendimento(todos.filter((m) => m.kit && m.kit !== Materiais.KIT.pronto));
    if (!pendentes.length) {
      return { titulo: 'Materiais sem kit', blocos: [r.p('✅ Todo material recebido já tem kit.')], fatos: { n: 0 } };
    }
    return {
      titulo: `Materiais sem kit (${pendentes.length})`,
      blocos: pendentes.map((m) => r.b(
        `${m.kit} ${m.material}${m.tipo ? ` · ${m.tipo}` : ''}${m.encontro ? ` · ${m.encontro}` : ''}` +
        `${m.recebidoEm ? ` · recebido ${m.recebidoEm}` : ''}`,
        m.kit === Materiais.KIT.precisoInfo ? 'orange' : undefined,
      )),
      fatos: { n: pendentes.length },
    };
  },

  /** Como o aprendizado está consolidando, lido nos campos Anki · do Hub. */
  async consolidar(argumentos, fontes) {
    const alvo = (argumentos[0] || '').toUpperCase();
    const topicos = await fontes.lerTopicosHub();
    const hoje = N.hoje();

    if (alvo && !/^\d+$/.test(alvo)) {
      const t = topicos.find((x) => String(x.idHumano || '').toUpperCase() === alvo);
      if (!t) return { titulo: `Consolidação de ${alvo}`, blocos: [r.p(`Nenhum tópico com ID "${alvo}".`)] };
      const sug = Materiais.sugestoesDeConsolidacao(t, { hoje });
      const a = t.anki || {};
      const blocos = [
        r.h(`${t.idHumano} · ${t.topico || ''}`),
        r.b(`Anki — ${a.cards ?? 0} cards · ${a.vistos ?? 0} vistos · ${a.consolidados ?? 0} consolidados · ` +
          `${a.lapsos ?? 0} lapsos · retenção ${typeof a.retencao === 'number' ? `${Math.round(a.retencao * 100)}%` : '—'}` +
          `${a.atualizadoEm ? ` · sincronizado ${a.atualizadoEm}` : ' · nunca sincronizado'}`),
        ...sug.map((s) => r.b(s.texto, s.prioridade === 1 ? 'red' : s.prioridade === 4 ? 'green' : undefined)),
      ];
      return {
        titulo: `Consolidação de ${alvo}`, blocos,
        fatos: { n: 1, semSincronizar: sug.some((s) => s.regra === 'sem sincronizar') ? 1 : 0,
          semCards: 0, urgentes: sug.filter((s) => s.prioridade === 1 && s.regra !== 'sem sincronizar').length },
      };
    }

    const resumo = Materiais.resumoDeConsolidacao(topicos, { hoje });
    const blocos = [
      r.p(`${resumo.topicosComCards} tópico(s) com cards no Anki · ${resumo.semCards} ainda sem cards` +
        (resumo.semSincronizar ? ` · ${resumo.semSincronizar} sem sincronizar há mais de ${Materiais.LIMIARES.diasSemSincronizar} dias` : '')),
    ];
    if (!resumo.sugestoes.length && resumo.topicosComCards) blocos.push(r.p('Nada urgente a consolidar.'));
    for (const s of resumo.sugestoes) {
      blocos.push(r.b(s.texto, s.prioridade === 1 ? 'red' : s.prioridade === 4 ? 'green' : undefined));
    }
    if (resumo.totalSugestoes > resumo.sugestoes.length) {
      blocos.push(r.p(`… e mais ${resumo.totalSugestoes - resumo.sugestoes.length} sugestão(ões). Pergunte por um tópico: /consolidar N03.`, 'gray'));
    }
    blocos.push(r.p(`Limiares: retenção ≥ ${Math.round(Materiais.LIMIARES.retencaoMinima * 100)}%, ` +
      `cobertura ≥ ${Math.round(Materiais.LIMIARES.coberturaMinima * 100)}%, consolidação (≥ 14 d) ≥ ` +
      `${Math.round(Materiais.LIMIARES.consolidacaoBoa * 100)}%, lapsos < ${Materiais.LIMIARES.lapsosAltos}.`, 'gray'));
    return {
      titulo: 'Consolidação · lida no Anki', blocos,
      fatos: {
        n: resumo.topicosComCards, semSincronizar: resumo.semSincronizar, semCards: resumo.semCards,
        urgentes: resumo.sugestoes.filter((s) => s.prioridade === 1).length,
      },
    };
  },
};

/**
 * Cortesia. Numa interface de conversa, "oi" e "obrigado" não são erro — e
 * responder "não entendi" a um cumprimento é grosseiro e parece defeito.
 */
const SOCIAL = [
  { teste: /\b(quem (e|sou|voce|vc|tu)|seu nome|o que voce e|o que vc e|voce e o que)\b/,
    resposta: 'Jarvis Code. Leio seu Cronograma, seus Compromissos, o Hub de Controle, os Materiais da Aula '
      + 'e o que o Anki manda para o Hub, e respondo sobre eles. Não tenho opinião sobre fisiologia e não '
      + 'invento dado que não esteja lá — o que, no meu ramo, conta como virtude.' },
  { teste: /\b(tchau|ate logo|ate mais|falou|flw|bye)\b/,
    resposta: 'Até. Estarei aqui, que é literalmente tudo o que eu faço.' },
  // Sem \b no fim: `obrigad` é prefixo de propósito (obrigado/obrigada/obrigadão).
  { teste: /\b(obrigad|valeu|vlw|thanks|brigad|perfeito|massa|top|show)/,
    resposta: 'Ao seu dispor.' },
  // Prefixos, sem \b no fim (desculpa/desculpe/desculpas).
  { teste: /\b(desculp|foi mal|perdao|errei)/,
    resposta: 'Não há o que desculpar. Eu guardo datas, não ressentimentos.' },
  { teste: /\b(tudo bem|como (voce |vc )?(vai|esta|ta)|beleza)\b/,
    resposta: 'Operacional. O senhor é a variável interessante aqui — quer o plano de hoje?' },
  { teste: /^(oi|ola|eai|e ai|opa|fala|hey|hi|bom dia|boa tarde|boa noite)\b/,
    resposta: 'Pois não. Pergunte o que quiser do módulo: o que tem hoje, se o dia aguenta o plano, '
      + 'o que a professora quer, como está um tópico, o que ficou atrasado.' },
];

/**
 * Cumprimentos são testados sobre o texto NORMALIZADO (sem acento, minúsculo),
 * senão "quem é você?" não casa com um padrão escrito sem acento.
 */
function respostaSocial(texto) {
  const limpo = normalizar(texto);
  const achado = SOCIAL.find((x) => x.teste.test(limpo));
  if (!achado) return null;
  return { titulo: 'Jarvis Code', blocos: [r.p(achado.resposta)] };
}

/**
 * Texto não reconhecido. Nunca falha em silêncio, e nunca culpa o usuário:
 * se eu não entendi, o limite é meu, e o mínimo que devo é dizer o que sei fazer.
 */
async function respostaDesconhecida(bruto) {
  const ajuda = await HANDLERS.ajuda();
  return {
    titulo: 'Fora do meu alcance',
    blocos: [
      r.p(`Não consegui tirar um sentido útil de "${String(bruto).slice(0, 120)}". `
        + 'A limitação é minha, não sua — meu vocabulário é estreito de propósito, '
        + 'para nunca responder com um dado inventado.'),
      r.p('O que eu sei fazer, e faço bem:'),
      ...ajuda.blocos,
      r.voz('Pode escrever solto, sem barra. "e amanhã?" e "tô travado em quê?" eu entendo.'),
    ],
  };
}

/** Executa um texto de comando e devolve a resposta (ainda não formatada). */
async function executar(texto, fontes = FONTES_PADRAO) {
  const { comando, argumentos, reconhecido, bruto, via } = interpretar(texto);

  if (!reconhecido) {
    // Cortesia antes de "não entendi": um cumprimento não é comando falhado.
    const social = respostaSocial(bruto);
    if (social) return { ...social, comando: 'social', bruto, via: 'social' };
    return { ...(await respostaDesconhecida(bruto)), comando: null, bruto, via: null };
  }
  try {
    const resposta = await HANDLERS[comando](argumentos, fontes);
    const linha = comentar(comando, resposta.fatos);
    return {
      ...resposta,
      blocos: linha ? [...resposta.blocos, linha] : resposta.blocos,
      comando, bruto, via,
    };
  } catch (erro) {
    return {
      titulo: `Falha em /${comando}`,
      blocos: [r.p(erro.message, 'red')],
      comando, bruto, via, erro: erro.message,
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
/** Nome da propriedade no Cronograma. Era `Apostila` até 2026-10-09. */
const CAMPO_KIT = 'Kit de estudo';

/** Título determinístico — é a chave de idempotência do pedido (ADR-003). */
const tituloPedidoDoDia = (dia) => `Kit de estudo do dia · ${dia.data}${dia.dia ? ` (${dia.dia})` : ''}`;

/**
 * Promove todo dia marcado `📥 Pedir` a um pedido formal na Central de Comandos
 * e move o dia para `⏳ Gerando`, para não ser promovido duas vezes.
 *
 * Fecha a pendência 3: havia dois caminhos para o mesmo trabalho e nada ligava
 * um ao outro. Agora a Central de Comandos é a única fila. Desde a sessão 6 o
 * pedido é um **Kit de estudo** (resumo + exercícios + flashcards), não uma
 * apostila; o caminho principal passou a ser `Materiais.promoverMateriais`,
 * e este fica para o dia sem material da professora.
 */
async function promoverPedidos({ aplicar = false, registrarNoDiario = true } = {}) {
  const dias = await Cronograma.lerCronograma({});
  const aPromover = dias.filter((d) => d.status.kit === PEDIR);

  const acoes = aPromover.map((d) => ({
    diaId: d.id,
    data: d.data,
    titulo: tituloPedidoDoDia(d),
    detalhes: [
      d.plano.ler && `Ler: ${d.plano.ler}`,
      d.plano.esquematizar && `Esquematizar: ${d.plano.esquematizar}`,
      d.plano.exercicio && `Exercício: ${d.plano.exercicio}`,
    ].filter(Boolean).join(' · ') || 'Kit do dia pedido pelo Cronograma, sem material da professora.',
    topicos: d.relacoes.topicos,
  }));

  let promovidos = 0;
  const resultados = [];
  if (aplicar) {
    for (const a of acoes) {
      const pedido = await Agentes.gerenciarAgente({
        pedido: a.titulo,
        comando: Materiais.COMANDO_KIT,
        status: Agentes.STATUS_PEDIDO.pendente,
        detalhes: a.detalhes,
        ...(a.topicos.length ? { topicos: a.topicos } : {}),
      });
      // Só muda o dia depois que o pedido existe: se falhar no meio, o dia
      // continua como `📥 Pedir` e a próxima execução tenta de novo.
      await N.atualizarPagina(a.diaId, { [CAMPO_KIT]: N.prop.select(GERANDO) }, 'promoverPedidos');
      resultados.push({ ...a, pedidoUrl: pedido.url, acao: pedido.acao });
      promovidos += 1;
    }
    if (registrarNoDiario && promovidos) {
      await N.registrarDiario({
        registro: `Pedidos promovidos do Cronograma · ${promovidos}`,
        tipo: 'Ajuste do Motor',
        oQueFoiFeito: `${promovidos} dia(s) marcados "${PEDIR}" viraram pedido "${Materiais.COMANDO_KIT}" ` +
          `na Central de Comandos e passaram a "${GERANDO}". A Central é a única fila de trabalho.`,
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
  COMANDOS_CODE, PEDIR, GERANDO, CAMPO_KIT,
  INTENCOES, normalizar, interpretar, dataDosArgumentos,
  extrairIdTopico, extrairDataDoTexto,
  HANDLERS, FONTES_PADRAO, executar, respostaDesconhecida, SOCIAL, respostaSocial,
  paraBlocosNotion, encontrarDisplay, injetarNoDisplay,
  promoverPedidos, tituloPedidoDoDia,
  ESTADO_TERMINAL, lerTerminal, lerComandosDaCentral, fecharItem, atenderFila,
};
