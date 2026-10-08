# Jarvis · Log de Arquitetura

> **Núcleo de Memória.** Este arquivo é o cérebro persistente do Jarvis.
> **Protocolo obrigatório:** antes de escrever ou alterar qualquer código, ler este
> arquivo por inteiro; depois de qualquer alteração, atualizar as seções
> *Status das integrações* e *Diário de bordo*. Nenhum ID do Notion deve ser
> escrito direto no código: todos vivem em `IDS` no `index.js`, espelhando a
> tabela de mapeamento abaixo.

- **Projeto:** Notion-Jarvis — ecossistema de automação do Notion de Breno
- **Repositório:** `DrCaribeno/Notion-Jarvis` · branch `claude/notion-jarvis-automation-dd2wz6`
- **Runtime:** Node.js v22.22.0 · npm 10.9.4 (sessão em nuvem, container efêmero)
- **Workspace Notion:** `Breno's Notion` (`12dd846f-533a-450e-8778-504592474043`)
- **Integração (bot):** `ClaudeCode` (`3f34414d-ac76-81ff-957c-002778ff3e0b`), tipo *workspace bot*
- **Última atualização:** 2026-10-08 (sessão 2)

### Estrutura do código
```
index.js              ponto de entrada, CLI e API pública
src/notion.js         transporte, mapa de IDs, normalização, datas, blocos
src/compromissos.js   blocos de tempo e capacidade real do dia      (item 2)
src/cronograma.js     leitura do plano diário
src/revisoes.js       reconciliação das revisões com o Hub          (item 1)
src/agentes.js        fila de pedidos e loop de autoaperfeiçoamento (item 3)
test/logica.test.js   94 asserções sobre a lógica pura (`npm test`)
```

---

## 1. Escopo

Automatizar e interligar o **Hub Central MED 1.5**, que já existe e é maduro.
O Jarvis **não** recria essa estrutura — ele a lê, cruza e mantém coerente.

Três frentes, na ordem de prioridade acordada:

1. **Gerenciar agentes.** Os "agentes" são as skills e rotinas do `Motor · Claude`
   (Gerar Apostila, Rotina das 5h, Análise Semanal), acionados por linhas na
   **Central de Comandos**. Jarvis cria, despacha e fecha esses pedidos por código.
2. **Integrar cronograma × agenda.** Reconciliar o `Cronograma de Ataque` (nível dia)
   com o `Hub Central de Controle` (nível tópico) e com os compromissos fixos do
   módulo. Ver proposta na seção 6 — **ainda não implementado, aguarda decisão.**
3. **Conectar as páginas do hub.** Usar as relations já existentes para que um
   tópico, seu dia, sua apostila, suas questões e seus cards se encontrem sozinhos.

### Contexto humano (não perder de vista)
Breno, 2º ano de Medicina na UFRR, refazendo o módulo MED 1.5 em paralelo ao 2º ano.
Grupo tutorial B4, tutoriais às 14h. Meta: NF ≥ 7,0 com folga (≥ 80% nas ACs).
Marcos: TBL 23/10 · **AC1 26/10** · ECG 05 ou 06/11 · **AC2 09/11** · Mini-OSCE 12/11 ·
Exame final 19/11 (só se NF ficar entre 6,0 e 6,9).
58 tópicos, 135,5 h previstas, janela de estudo 08/10 → 13/11.

---

## 2. Decisões de arquitetura

Registradas como ADR enxutos. Cada uma nasceu de um teste contra a API real nesta
sessão, não de suposição — por isso a coluna *evidência*.

### ADR-001 — axios é o transporte; o SDK roda sobre ele
**Decisão:** toda chamada HTTP sai por uma instância **axios**. O
`@notionhq/client` é instanciado com um `fetch` customizado que delega ao axios,
em vez de usar o `fetch` nativo.

**Evidência:** nesta sessão o token do Notion **não está no ambiente** — não existe
`NOTION_TOKEN`. Quem autentica é o *agent proxy* (`HTTPS_PROXY=http://127.0.0.1:36595`),
que injeta o header `Authorization` nas requisições para `api.notion.com`.
Consequência medida:

| Cliente | Resultado |
|---|---|
| `curl` | ✅ `200` — autenticou como `ClaudeCode` |
| `axios` | ✅ `200` — autenticou como `ClaudeCode` |
| `@notionhq/client` (fetch nativo) | ❌ `401 unauthorized: API token is invalid` |

**Causa:** o `fetch` nativo do Node 22 ignora `HTTP(S)_PROXY`. O SDK furava o proxy
e chegava à Notion com o token placeholder, sem a injeção. O axios usa o adaptador
`http` do Node, que honra as variáveis de proxy.

**Efeito colateral bom:** o mesmo código funciona nos dois mundos sem `if`. Aqui o
proxy injeta e o `NOTION_TOKEN` pode ser um placeholder; na sua máquina não há proxy
e o `NOTION_TOKEN` real do `.env` é usado. O código não precisa saber onde está.

### ADR-002 — Notion-Version fixada em `2022-06-28`
**Decisão:** fixar `2022-06-28` em uma constante única (`NOTION_VERSION`) e usar os
endpoints de **database**, não de **data source**.

**Evidência:** o SDK v5.27.0 assume por padrão `2025-09-03` (era *data sources*) e
removeu `databases.query` em favor de `dataSources.query`. Mas esta integração
**não está habilitada** nessa API:

| Endpoint | Versão | Resposta |
|---|---|---|
| `POST /v1/data_sources/{id}/query` | 2025-09-03 | ❌ `400 invalid_request_url` |
| `GET /v1/data_sources/{id}` | 2025-09-03 e 2022-06-28 | ❌ `400 invalid_request_url` |
| `POST /v1/databases/{id}/query` | 2022-06-28 | ✅ endpoint válido (`404` só por falta de compartilhamento) |
| `GET /v1/databases/{id}` | 2025-09-03 | ✅ endpoint válido (`404` idem) |

`400 invalid_request_url` é a Notion dizendo que a *rota não existe para esta
integração*; `404 object_not_found` é a rota existindo e o objeto não estando
compartilhado. São diagnósticos diferentes e o código os trata de forma diferente.

**Dívida técnica registrada:** quando a integração for migrada para `2025-09-03`,
trocar `NOTION_VERSION` e os paths de `databases/{id}/query` para
`data_sources/{id}/query`. Os IDs `collection://…` da tabela da seção 4 já são os
futuros `data_source_id` — a migração é de rota, não de identificadores.

### ADR-003 — Jarvis é idempotente e declarativo
Toda escrita busca antes de criar (`buscarPedido` antes de `criarPedido`) e é segura
para repetir. Rodar duas vezes não duplica linha. Isso é pré-requisito para a rotina
das 5h poder ser reexecutada sem medo após uma falha parcial.

### ADR-004 — Jarvis não é fonte de verdade de conteúdo
O conteúdo (apostilas, cards, questões) é gerado pelas skills do `Motor · Claude`.
O Jarvis move estado, reconcilia datas e liga relations. Ele não escreve fisiologia.
Isso mantém a responsabilidade de cada parte nítida e evita que uma mudança de
prompt quebre a automação.

### ADR-005 — Nenhum segredo no repositório
`.env` fica no `.gitignore`; o repositório carrega apenas `.env.example`. O token
real nunca é logado, nem em erro. O `diagnostico` imprime o nome do bot, nunca a chave.

### ADR-006 — Escritas destrutivas são dry-run por padrão
`revisoes` e `otimizar` **simulam** por padrão e só gravam com `--aplicar`.
Ambas sobrescrevem conteúdo que você poderia ter escrito à mão (o campo de
revisões, as páginas das skills), e um diff na tela custa menos que um
`Ctrl+Z` em 37 linhas do Notion. A injeção de diretrizes, além disso, só
acrescenta: nunca apaga o que você escreveu na seção.

### ADR-007 — Duração ausente nunca vale zero
Um compromisso sem `Duração (h)` não entra como zero no cálculo: o dia inteiro
passa a `veredito: 'indeterminado'` e o bloco é nomeado em `indeterminados`.
Tratar ausência como zero daria uma capacidade otimista e silenciosamente
errada — exatamente a classe de defeito que o item 1 existe para extinguir.
A premissa é: é melhor dizer "não sei" do que dizer um número errado.

### ADR-008 — Otimizador de prompt plugável
A síntese da diretriz tem duas implementações. O padrão é **determinístico**,
por taxonomia de falhas (`src/agentes.js` → `TAXONOMIA`): funciona sem nenhuma
credencial, é reproduzível e, por ser reproduzível, torna a injeção idempotente.
O alternativo usa **LLM** e só entra em ação se `ANTHROPIC_API_KEY` existir.

**Medido:** não há credencial de LLM nesta sessão (`ANTHROPIC_API_KEY` ausente;
`api.anthropic.com` está em `no_proxy`, logo o proxy não injeta nada). Por isso
o caminho determinístico é o padrão e é o único coberto por testes. O caminho
por LLM está escrito mas **não exercitado** — se ele falhar em tempo de
execução, o loop cai no determinístico e registra o motivo, em vez de travar.

---

## 3. Bloqueio ativo — compartilhamento na integração certa

**Status em 2026-10-08, sessão 2: ainda bloqueado. `0/10` bancos alcançáveis.**

As permissões foram concedidas, mas não chegaram à integração que o código usa.
Há **três bots** neste workspace, e os IDs de dois deles são quase idênticos:

| Bot | ID | Papel |
|---|---|---|
| `Notion MCP` | `3f2**4**414d-ac76-8138-951a-0027d53e0c6a` | Conector MCP — é por aqui que o hub foi mapeado |
| `Make` | `3f2**4**414d-ac76-8162-acf2-0027f2c82356` | Automação do Anki |
| **`ClaudeCode`** | **`3f3**4**414d-ac76-81ff-957c-002778ff3e0b`** | **A que o `index.js` usa** |

Repare: `ClaudeCode` começa com `3f3**4**`, as outras duas com `3f2**4**`.

Evidência de que a autenticação está certa e só falta o compartilhamento:

```
GET  /v1/users            →  200 OK, lista os 4 usuários do workspace
GET  /v1/users/me         →  200 OK, "ClaudeCode"
POST /v1/search           →  200 OK, results: []          ← zero objetos visíveis
GET  /v1/pages/3f24…38b3  →  404 "Make sure the relevant pages and databases
                                  are shared with your integration ClaudeCode."
```

**Como liberar:** no Notion, abrir o **Hub Central MED 1.5** → `⋯` (canto
superior direito) → **Conexões** → procurar **`ClaudeCode`** → Confirmar.
O acesso é herdado pelas subpáginas, então **um compartilhamento no Hub
destrava os 10 bancos e as 3 páginas de skill**. Em seguida,
`node index.js diagnostico` deve mostrar `10/10`.

Os IDs da seção 4 vieram do conector MCP (autenticado como você, vê tudo), e é
também por ele que os bancos novos foram criados — por isso o mapeamento está
completo embora a API da integração ainda responda 404.

## 4. Mapeamento de IDs do Notion

`db_id` serve para `databases.retrieve` e `databases/{id}/query`.
`collection_id` é o `data_source_id` da API nova (ver ADR-002) — guardado para a migração futura.

### Páginas

| Página | ID | Papel |
|---|---|---|
| 🫀 Hub Central MED 1.5 | `3f24414dac76812abcf5d0285b6738b3` | Raiz. **Compartilhar esta** destrava tudo |
| 🧠 Motor · Claude | `3f24414dac76814f939ccc7e2b7cefcc` | Painel dos agentes |
| Perfil de aprendizagem | `3f24414dac7681adb316e534fb21dddd` | Memória sobre o Breno |
| Índice de materiais | `3f24414dac768103bd26ff0839c241b7` | Catálogo da pasta Fisiologia |
| Skill · Gerar Apostila | `3f24414dac768199a591e16b34590b22` | **Agente** |
| Skill · Rotina diária das 5h | `3f24414dac7681f4b803fa4e7f5510e3` | **Agente** |
| Skill · Análise semanal | `3f24414dac7681a39f2accf2432eb736` | **Agente** |
| Fase 4 · Blueprint de Automação | `3f24414dac768129a7dcda035dec69e6` | Make + Anki |
| Arquivo – versões anteriores | `3f24414dac76818b816cceb3496a085b` | Histórico |

### Bancos de dados

| Banco | db_id | collection_id (data_source futuro) |
|---|---|---|
| Cronograma de Ataque | `2b274f511f8e4409b0322f6a0f4b7043` | `af17ee56-06ee-40b7-89ac-1899d3ed7b1b` |
| Hub Central de Controle (58 tópicos) | `c4891265091e45b794551d561b969fab` | `a374d5c8-4f9a-48fc-946e-4883b4f039ec` |
| Central de Comandos | `637e5706ca2343df8044326c1b517c91` | `a4b69910-a163-4042-9a06-b2f6699343b6` |
| Diário do Motor | `9975790b8f8149529b92884b242ee36b` | `0bd5b810-3fa5-4ea3-8fa9-813bd72da4fe` |
| Biblioteca de Apostilas | `55d58868acc641a58708c6dfc0ce39e8` | `f6e5eb83-b268-4ff8-aa0f-c639239def90` |
| Registro de Questões | `b8528bc3d95545bdb62ad7c6e4a0bc7d` | `eedd4b51-07b3-44b6-9071-1e00b30aa1d2` |
| Fila Anki | `b30fa0bab1d84dc5a4d2767b7ccc6342` | `fd8e8e6d-ee4a-4ec1-9047-4b3cbdc56a4a` |
| Repositório Clínico e Visual | `f038c9b39ac64baa8a2487598b4fbd63` | `72d53f7b-18bc-4fac-92d6-24d68cd10689` |
| **Compromissos** ⭐ | `ebb4eacd50eb40249d20cc124a7078b6` | `1de67c6f-c1b3-49f3-a24a-2ed3fb8cc7f3` |
| **Auditoria de Agentes** ⭐ | `163ee7f987324454a8578e8e0760fb2a` | `8e7588a0-bdc9-4cba-96c3-070aadc93476` |

⭐ criados em 2026-10-08 (sessão 2). `Compromissos` fica sob o Hub e criou a
relação dual `Compromissos` no Cronograma de Ataque. `Auditoria de Agentes` fica
sob o `Motor · Claude` e criou a relação dual `Auditorias` no Hub de Controle.

> Views inline (não consultar direto; usar sempre o banco acima): Plano de hoje
> `3f24414dac76811b884feb9bd6bb791d` · Tópicos de hoje `3f24414dac76818e909cc6dc3a1c29cd`
> · Domínio `3f24414dac7681999546e536e2bf7e74` · Pontos fracos `3f24414dac768178935fca64d7c53561`.

---

## 5. Schemas que o código depende

Só as propriedades que o `index.js` lê ou escreve. Nome exato, com acento — a API
é sensível a isso e um acento errado vira `validation_error`.

### Cronograma de Ataque — leitura (`lerCronograma`)
| Propriedade | Tipo | Uso |
|---|---|---|
| `Dia` | title | Rótulo do dia |
| `Data` | date | Chave de filtro e ordenação |
| `Semana` | select | `S1 · Fundação biofísica` … `S6 · OSCE e fechamento` |
| `Horas` | number | Carga do dia — base do balanceamento futuro |
| `Feito` | checkbox | **Status primário do dia** |
| `Apostila` | select | `📥 Pedir` · `⏳ Gerando` · `✅ Pronta` — gatilho de agente |
| `Ler` / `Resumir / Esquematizar` / `Exercício ativo` | text | Plano do dia |
| `Revisões programadas` | text | ⚠️ texto livre — ver defeito na seção 6 |
| `Eventos do módulo` | text | ⚠️ agenda em prosa — ver seção 6 |
| `Tópicos` | relation → Hub | Ligação dia ↔ tópico |
| `Apostila do dia` | relation → Biblioteca | Material do dia |
| `É hoje` | formula | Não filtrável por SQL; filtrar por `Data` |

### Hub Central de Controle — leitura
Chave humana: `userDefined:ID` (texto: `F01`…`K10`). Título: `Tópico Fisiológico Granular`.
`Status`: `Não iniciado` · `Em estudo` · `Estudado` · `Em revisão` · `Dominado` · `Reforço`.
`Nível de Risco`: `Crítico` · `Médio` · `Baixo`. `Sistema`: 8 opções.
Datas: `Data Alvo de Domínio`, `Data Real de Estudo`, `Data da Prova`.
Derivadas (fórmulas, somente leitura): `Revisão Ativa 1/2/3`, `Revisão Pré-Prova`,
`Revisão de hoje`, `Agenda`, `% Acerto`, `Taxa de acerto` (−1 = sem questões).
Rollups: `Acertos`, `Questões feitas`.

### Central de Comandos — escrita (`gerenciarAgente`)
| Propriedade | Tipo | Observação |
|---|---|---|
| `Pedido` | title | Chave de idempotência (ADR-003) |
| `Comando` | select | `Gerar apostila` · `Mini-apostila de correção` · `Questões extras` · `Cards extras` · `Tirar dúvida` · `Ajustar cronograma` · `Análise semanal` · `Outro` |
| `Status` | select | `📥 Pendente` · `⏳ Em andamento` · `✅ Feito` · `↩️ Preciso de info` |
| `Detalhes` | text | O que se quer |
| `Resposta do Claude` | text | Retorno do agente |
| `Resultado` | url | Link do material gerado |
| `Concluído em` | date | Fechamento |
| `Tópicos` | relation → Hub | Contexto |
| `Pedido em` | created_time | **readOnly** — nunca escrever |

### Compromissos — leitura (`lerCompromissos`, item 2)
| Propriedade | Tipo | Uso |
|---|---|---|
| `Compromisso` | title | Nome do bloco |
| `Tipo` | select | Aula · Tutorial · Conferência · Prática · Prova · Atlética/Liga · Treino físico · Outro módulo · Pessoal |
| `Recorrência` | select | `Única` · `Semanal` · `Quinzenal` |
| `Dia da semana` | multi_select | Seg…Dom. **Obrigatório** em recorrentes — sem ele o bloco não é alocado |
| `Vigência` | date | Única: o dia. Recorrente: intervalo de validade |
| `Hora início` | text | `HH:MM`. Contexto humano e detecção de conflito |
| `Duração (h)` | number | **AUTORITATIVO** no cálculo. Ausente ⇒ dia indeterminado (ADR-007) |
| `Inegociável` | checkbox | Bloco que não pode ser remanejado |
| `Ativo` | checkbox | Filtro padrão da leitura; desmarcar aposenta sem apagar |
| `Dias no Cronograma` | relation → Cronograma | Reservado |

### Auditoria de Agentes — leitura e escrita (item 3)
| Propriedade | Tipo | Quem preenche |
|---|---|---|
| `Auditoria` | title | Você |
| `Agente` | select | Você — `Gerar Apostila` · `Rotina diária das 5h` · `Análise semanal` |
| `Classificação` | select | Você — `✅ Adequado` · `⚠️ Parcial` · `❌ Inadequado` |
| `Observação` | text | **Você** — é a matéria-prima da diretriz |
| `Output avaliado` | url | Você |
| `Status` | select | `📥 Nova` · `⏳ Em análise` · `✅ Aplicada` · `⏸️ Descartada` |
| `Diretriz gerada` | text | Jarvis |
| `Aplicado em` | date | Jarvis |
| `Versão do prompt` | number | Jarvis — contador de diretrizes na skill |
| `Tópicos` | relation → Hub | Você, opcional |

O loop só consome linhas com `Classificação` ∈ {❌ Inadequado, ⚠️ Parcial} **e**
`Status` ∈ {📥 Nova, ⏳ Em análise}.

---

## 6. Correções estruturais — implementadas

Os três defeitos da seção 6 da sessão 1 foram aprovados e implementados em
2026-10-08. O que segue é o desenho final de cada um.

### Item 1 · Revisões derivadas, não digitadas → `src/revisoes.js`

**O defeito:** o Hub calculava R1/R2/R3 e a pré-prova por fórmula; o Cronograma
guardava as mesmas revisões como texto digitado. Duas verdades para o mesmo
fato, e a do Cronograma envelhecia em silêncio.

**A correção:** `Revisões programadas` deixa de ser digitado e passa a ser
derivado. Toda linha gravada carrega a marca `⟳ derivado do Hub`, para que
nunca haja dúvida sobre quem é o autor do campo.

**Hierarquia de fontes**, nesta ordem:
1. **Resultado da fórmula do Hub** — é a fonte preferida, porque é a definição
   que você já mantém. Lida via API, que entrega fórmulas calculadas (o conector
   MCP devolve só referências opacas `formulaResult://`, por isso o código usa
   a API e não o MCP).
2. **Regra documentada no Hub** — R1 +1, R2 +7, R3 +15 a partir da `Data Real
   de Estudo`, ou da `Data Alvo de Domínio` enquanto ela estiver vazia;
   pré-prova na véspera da `Data da Prova`.
3. **Nada** — sem base, nenhuma data é inventada e o tópico é contado em
   `fontes['sem base']`.

Cada execução informa quantos tópicos vieram de cada fonte. O parser de fórmula
(`dataDeFormula`) é tolerante de propósito — aceita objeto de data, ISO, ISO
embutida em texto, `dd/mm/aaaa` e `dd/mm` — porque o tipo de retorno das suas
fórmulas só será conhecido na primeira leitura real, e um palpite errado
produziria datas erradas sem avisar.

**O que NÃO é tocado:** a relação `Tópicos` do dia. Ela guarda os tópicos de
*estudo* daquele dia, não os de revisão; sobrescrevê-la destruiria informação.

**Estado em 2026-10-08:** `Data Real de Estudo` está vazia nos 58 tópicos, logo
hoje tudo deriva da `Data Alvo`. Assim que você começar a preencher a data real,
o reconciliador passa a refletir o seu ritmo de verdade.

### Item 2 · Tempo livre real → `src/compromissos.js`

**O defeito:** a agenda vivia em prosa, então nenhuma automação sabia quantas
horas você realmente tinha. O cronograma previa 39,5 h na semana de neuro sem
descontar uma aula.

**A correção:** o banco `Compromissos` e um cálculo explícito por dia.

```
tempoLivre  = JANELA_UTIL_H − horas comprometidas
tetoEfetivo = min(TETO_ESTUDO_DIA_H, tempoLivre)
excesso     = horas planejadas − tetoEfetivo
```

| Premissa | Padrão | Origem |
|---|---|---|
| `JANELA_UTIL_H` | 14 | **Chute meu.** Ajuste à sua rotina — é a premissa mais frágil do modelo |
| `TETO_ESTUDO_DIA_H` | 6 | Regra de adaptação do `Motor · Claude`: "sem passar de 6 h num dia comum" |

Veredito por dia: `viável` · `sobrecarregado` (com o excesso em horas) ·
`indeterminado` (algum bloco sem `Duração (h)` — ver ADR-007).

Recorrência: `Única` casa a data; `Semanal` exige dia da semana dentro da
vigência; `Quinzenal` exige, além disso, número par de semanas desde o início.
Toda a aritmética de data é feita em UTC para ser determinística, e os rótulos
de dia da semana são verificados contra os que você já escreveu no Cronograma
("Seg 12/10", "Sáb 24/10", "Seg 09/11") nos testes.

**Semeado em 2026-10-08:** 10 blocos do calendário do módulo (tutoriais, TBL,
AC1, AC2, ECG, Mini-OSCE, vistas, IESC II, exame final inativo). As datas e
horas foram transcritas do Hub; **as durações ficaram em branco de propósito**,
porque o Hub não as declara e inventá-las produziria contas erradas. Enquanto
estiverem em branco, esses dias saem como `indeterminado`.

Pendências que só você resolve: duração de cada bloco · hora e duração do
IESC II · dia da semana do tutorial B4 · se o B4 é subturma B1 (ECG 05/11) ou
B2 (06/11) · cadastrar Atlética/Liga e treino físico.

### Item 3 · Loop de autoaperfeiçoamento → `src/agentes.js`

**O ciclo:** você classifica um output como `❌ Inadequado` ou `⚠️ Parcial` e
escreve o que saiu errado → o Jarvis converte a observação em diretriz
normativa → injeta na página da própria skill → a rotina das 5h, que lê a skill
antes de gerar material, passa a obedecer.

**Onde a diretriz é injetada:** num bloco *toggle* chamado
`⟳ Diretrizes aprendidas (mantido pelo Jarvis)`, criado na primeira execução.
É toggle e não heading porque toggles aceitam filhos — assim a injeção cai
sempre dentro da seção, sem depender da ordem dos blocos da página.

Cada item injetado fica assim:

> `[2026-10-08 · v3]` **Cortar prosa: no máximo 8 linhas corridas por tópico…**
> *⟨auditoria: "a apostila ficou longa demais, muito texto corrido"⟩*

A observação literal viaja junto com a diretriz, para que nada se perca na
tradução e você possa auditar a tradução que o Jarvis fez.

**Garantias:**
- **Idempotente** — uma diretriz cujo texto já existe na seção não é reinjetada.
  Isso depende de o otimizador ser determinístico (ADR-008).
- **Só acrescenta** — o Jarvis nunca apaga o que você escreveu na seção.
- **Versionado** — `Versão do prompt` na auditoria recebe o contador de
  diretrizes da skill.
- **Fecha o ciclo** — a auditoria vai para `✅ Aplicada` com data e diretriz, e
  o `Diário do Motor` recebe uma linha `Ajuste do Motor`.

**Taxonomia de falhas** (`TAXONOMIA`): 12 padrões reconhecidos — prolixidade,
falta de esquema, falta de cálculo, superficialidade, falta de clínica, cards
grandes, erro factual, pegadinhas ausentes, embriologia ausente, formato,
questões e SNA transversal. Mais de um padrão pode casar na mesma observação, e
todas as diretrizes correspondentes entram. Sem padrão reconhecido, a sua
observação vira a regra, literal — como *restrição dura* se a classificação foi
`❌ Inadequado`, como *ajuste* se foi `⚠️ Parcial`.

---

## 7. Status das integrações

| # | Integração | Status | Nota |
|---|---|---|---|
| 1 | Autenticação na API do Notion | ✅ Operacional | `users/me` e `users` respondem 200 |
| 2 | Transporte axios + shim do SDK | ✅ Operacional | ADR-001, verificado |
| 3 | Mapeamento de IDs do hub | ✅ Completo | 9 páginas, 10 bancos |
| 4 | `diagnostico()` | ✅ Operacional | 10 bancos + 3 páginas de skill |
| 5 | Lógica pura (datas, capacidade, derivação, taxonomia) | ✅ Testada | 94 asserções, `npm test` |
| 6 | Banco `Compromissos` | ✅ Criado e semeado | 10 blocos; durações pendentes |
| 7 | Banco `Auditoria de Agentes` | ✅ Criado | Aguarda a primeira auditoria sua |
| 8 | `lerCronograma()` / `lerCompromissos()` | 🟡 Codificado, não validado | Bloqueio da seção 3 |
| 9 | `reconciliarRevisoes()` | 🟡 Codificado, não validado | Dry-run por padrão (ADR-006) |
| 10 | `otimizarAgentes()` — determinístico | 🟡 Codificado, lógica testada | Injeção não validada; dry-run por padrão |
| 11 | `otimizarAgentes()` — por LLM | ⬜ Escrito, não exercitado | Sem credencial nesta sessão (ADR-008) |
| 12 | Promoção de `📥 Pedir` → Central de Comandos | ⬜ Não começou | Defeito 3 da sessão 1, ainda aberto |
| 13 | Ponte Anki (`sincronizar_anki.bat`) | ⬜ Fora de escopo | Vive no Make |

Legenda: ✅ operacional e verificado · 🟡 escrito, verificação bloqueada ·
⬜ não começou

**Leitura honesta do estado:** toda a lógica que pode ser testada sem a API
está testada. Nenhum caminho de escrita foi exercitado contra o seu Notion,
porque a integração `ClaudeCode` não vê nada ainda. É exatamente por isso que
as duas escritas destrutivas são dry-run por padrão: a primeira execução real
vai te mostrar o diff antes de tocar em qualquer coisa.

---

## 8. Diário de bordo

### 2026-10-08 · Sessão 1 — fundação
- Reconhecimento do ambiente: Node 22.22, repositório vazio, branch correta.
- Descoberto que **não há `NOTION_TOKEN` no ambiente**; a autenticação é injetada pelo proxy.
- Testada a autenticação: bot `ClaudeCode` no workspace `Breno's Notion`. ✅
- **Medido** que o SDK falha e o axios funciona por causa do proxy → ADR-001.
- **Medido** que `/v1/data_sources/*` não existe para esta integração → ADR-002.
- `POST /v1/search` retorna vazio → identificado o bloqueio de compartilhamento.
- Hub mapeado pelo conector MCP: 9 páginas, 8 bancos, schemas completos.
- Instalados `@notionhq/client@5.27.0` e `axios@1.20.0`.
- Escritos `index.js` (diagnóstico + `lerCronograma` + `gerenciarAgente`) e este log.
- Identificados 3 defeitos estruturais e proposta a correção — não codificados.

### 2026-10-08 · Sessão 2 — as três correções estruturais
- Permissões anunciadas, mas o diagnóstico seguiu em `0/8`. Investigado: existem
  **três bots** no workspace e o compartilhamento não chegou ao `ClaudeCode`.
  `GET /v1/users` responde 200 (autenticação ok) e `POST /v1/search` segue
  vazio (zero objetos). Registrado na seção 3 com a tabela de desambiguação.
- Decidido não travar: o trabalho estrutural foi feito pelo conector MCP, que
  tem acesso pleno, e o código foi escrito para a API, que passa a funcionar
  assim que o compartilhamento certo for feito.
- **Medido** que o MCP devolve fórmulas como referências opacas
  (`formulaResult://`), enquanto a API REST as entrega calculadas → confirmou
  que o item 1 deve ler as fórmulas pela API.
- **Medido** que não há credencial de LLM na sessão → ADR-008, otimizador plugável.
- Criados os bancos `Compromissos` (sob o Hub) e `Auditoria de Agentes` (sob o
  `Motor · Claude`), com relações duais para o Cronograma e para o Hub.
- Semeados 10 blocos do calendário do módulo em `Compromissos`, com datas e
  horas transcritas do Hub e **durações deliberadamente em branco**.
- Código refatorado em 5 módulos sob `src/` — três features novas num só
  arquivo seria dívida técnica.
- Implementados os itens 1, 2 e 3 (desenho na seção 6).
- Escrita a suíte `test/logica.test.js`: **94 asserções, todas passando**,
  ancoradas em dados reais do Hub (os rótulos de dia da semana do Cronograma
  servem de verdade de referência para a aritmética de datas).
- Três asserções minhas estavam erradas e foram corrigidas; uma delas revelou
  um comportamento que valia asseverar melhor: um mesmo dia acumula marcadores
  diferentes (13/10 recebe R1 de F04/F05 e R2 de N03).

**Próxima sessão começa por:**
1. `node index.js diagnostico` — confirmar se o compartilhamento chegou ao `ClaudeCode`.
2. `node index.js revisoes` (dry-run) — ler o diff antes de aplicar.
3. Preencher as durações em `Compromissos` e resolver as pendências do item 2.
4. Primeira auditoria real para exercitar o loop do item 3 ponta a ponta.
5. Defeito 3 ainda aberto: promover `📥 Pedir` do Cronograma a pedido formal
   na Central de Comandos, fazendo dela a única fila de trabalho.
