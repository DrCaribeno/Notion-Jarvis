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
- **Última atualização:** 2026-10-08 (sessão 4)

### Estrutura do código
```
index.js              ponto de entrada, CLI e API pública
src/notion.js         transporte, mapa de IDs, normalização, datas, blocos
src/compromissos.js   blocos de tempo e capacidade real do dia      (item 2)
src/cronograma.js     leitura do plano diário
src/revisoes.js       reconciliação das revisões com o Hub          (item 1)
src/agentes.js        fila de pedidos e loop de autoaperfeiçoamento (item 3)
src/code.js           assistente Code: fila, comandos e display no Hub
test/logica.test.js   94 asserções sobre datas, capacidade, revisões, taxonomia
test/code.test.js     133 asserções sobre conversa, handlers, cortesia e voz
```
`npm test` roda as duas suítes: **227 asserções**.

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

### ADR-009 — Duas camadas de acesso: API da integração e conector MCP
O Jarvis tem **dois** caminhos para o Notion, e eles têm alcances diferentes:

| Camada | Autentica como | Alcance | Usada para |
|---|---|---|---|
| API REST (`src/notion.js`) | integração `ClaudeCode` | só o que for compartilhado — **hoje, nada** | todo o código executável |
| Conector MCP | Breno | workspace inteiro | estrutura, schemas, views, redesign |

Isso não é redundância: é a razão pela qual a sessão 3 pôde entregar o redesign do
Hub e os bancos novos enquanto o código seguia bloqueado. O que é estrutura
(criar banco, criar view, editar blocos) foi feito pelo MCP; o que é execução
recorrente (ler, reconciliar, injetar) está no código, esperando o
compartilhamento. **Regra:** nunca presumir que uma leitura feita por MCP estará
disponível ao código — e vice-versa.

### ADR-010 — Sucesso de chamada não é prova de efeito
Medido na sessão 3: `<synced_block color="gray_bg">` retorna `200`, **e a cor é
silenciosamente descartada**. Nenhum erro, nenhum aviso; só um re-fetch revela.
O mesmo padrão vale para ícones inválidos em alguns caminhos.

**Regra que passa a valer para toda escrita estrutural:** depois de gravar,
**re-ler e conferir o atributo**. Um `200` sozinho não entra no log como feito.
Foi isso que impediu a sessão 3 de reportar o painel cinza como entregue quando
ele não existia na forma pedida.

### ADR-011 — Reposicionar é trocar de lugar, nunca remover
A especificação de markdown do Notion avisa que remover uma tag `<page>` **apaga**
a subpágina, e que uma tag `<database url>` **move** o banco. Então:

- **Nunca** remover ou reposicionar a tag `<database url>` do banco de origem.
- Para posicionar um banco na página, criar uma **view vinculada**
  (`notion-create-view` com `parent_page_id`, ou a tag com `data-source-url`) e
  mover esse bloco. Foi assim que a galeria de marcos foi posta na coluna sem
  risco para o banco `Compromissos`.

**Emenda (medida depois, na própria sessão 3):** "só um ponteiro" estava errado.
Um bloco de view vinculada **é** tratado como database filho: tentar removê-lo
por `update_content` dispara o guard do Notion —
*"This operation would delete 1 child page(s), database(s)… To proceed, either
include these items in new_str… OR set allow_deleting_content: true"*.
O guard é uma salvaguarda, não um obstáculo. **Regra:** para reposicionar, não
remova — **troque as posições** das duas tags numa única chamada, de modo que
cada uma siga presente exatamente uma vez. Nunca passe `allow_deleting_content:
true` numa página de verdade sem o aval explícito do Breno.
- Edições no conteúdo do Hub usam `update_content` (busca-e-substituição
  ancorada), nunca `replace_content`, justamente para não precisar reescrever as
  tags de `<page>` e `<database>` e arriscar omitir uma.

### ADR-012 — Assimetria de leitura e escrita nos ícones nativos
Escreve-se `icons/document_gray`; um callout **relê** como
`/icons/document_gray.svg` (barra inicial e extensão), enquanto o ícone de página
relê como `icons/document_gray`. As duas formas são aceitas na entrada.
Consequência prática: ao ancorar `old_str` sobre um callout já existente, usar a
forma `/icons/..._gray.svg`.

Regra de nomenclatura: `icons/<nome>_<cor>`, **sufixo de cor obrigatório**.
Cores: gray, lightgray, blue, red, green, yellow, orange, pink, purple, brown.
Monocromáticas: `_gray` e `_lightgray`. `_black` não existe.

### ADR-014 — A personalidade vive na moldura, nunca nos números
O Jarvis Code tem voz: seca, educada, prestativa, com o bom senso de avisar
quando a aritmética não fecha. Mas a voz é **estruturalmente separada do dado**.

Os handlers produzem fatos e nada mais. Uma camada `voz` acrescenta **uma** linha
no fim, em cinza, marcada `voz: true`. Nenhum número passa por ela, então
nenhuma frase pode corromper uma hora, uma data ou um percentual — e quem quiser
o retorno cru só descarta os blocos marcados.

A escolha da fala é **determinística**: sai de uma característica do próprio fato
(`escolher`), não de aleatoriedade. Varia com a situação, mas a mesma situação dá
sempre a mesma frase. Sem isso não haveria como testar a voz, e uma voz não
testável acabaria dizendo algo que contradiz o dado ao lado.

Há também cortesia (`SOCIAL`): "oi", "obrigado", "quem é você" recebem resposta,
não "não entendi". Responder erro a um cumprimento parece defeito e esfria uma
interface de conversa. E o "não entendi" assume o limite como próprio — se não
compreendi, o vocabulário estreito é meu, não culpa de quem escreveu.

### ADR-013 — Um banco nomeado sempre nasce com aba de tabela em primeiro lugar
Medido: `notion-create-database` cria um `Default view` de tipo **table**, e ele
fica em primeiro lugar. Não existe ferramenta para **apagar** uma view, para
**reordenar** abas, nem para **definir a view padrão** — `notion-update-view`
muda nome, filtros, ordenações e configuração, mas **não o tipo**.

Consequência: um banco nomeado posto inline **renderiza como tabela**, mesmo que
você tenha criado uma view de lista nele. Para um bloco que de fato renderiza
como lista, use `notion-create-view` com `parent_page_id`: isso cria um database
**vinculado** com **uma única view**, do tipo pedido. O custo é que ele vem **sem
título** — precisa de um heading manual acima.

Foi o que o Terminal do Code acabou usando: o heading `### Code` faz o rótulo, e
o bloco carrega só a view `Terminal (lista)`. Confirmado por fetch do bloco:
uma view, `"type":"list"`.

---

## 3. Bloqueio ativo — compartilhamento na integração certa

**Status em 2026-10-08, sessão 3: AINDA BLOQUEADO. `0/11` bancos alcançáveis.**

Na sessão 3 o acesso foi anunciado como resolvido ("a descoberta do ID resolve o
impasse"). Não resolveu: saber o ID não concede permissão — alguém precisa abrir
Conexões no Notion e adicionar a integração. Reconfirmado por três sondas:
`POST /v1/search` → `200` com `results: []`; `GET /v1/blocks/<hub>/children` →
`404`; `GET /v1/users` → `200` listando os 4 usuários (logo, a autenticação está
íntegra e o que falta é só compartilhamento).

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
destrava os 11 bancos e as 3 páginas de skill**. Em seguida,
`node index.js diagnostico` deve mostrar `11/11`.

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
| **Terminal do Code** ⭐⭐ | `e13980fc76b447cf824c5eebe584335d` | `7cdb5b46-1af5-4535-b4d3-129592c60bd9` |

⭐⭐ criado na sessão 3, inline no topo do Hub. ⭐ criados na sessão 2. `Compromissos` fica sob o Hub e criou a
relação dual `Compromissos` no Cronograma de Ataque. `Auditoria de Agentes` fica
sob o `Motor · Claude` e criou a relação dual `Auditorias` no Hub de Controle.

> Views inline (não consultar direto; usar sempre o banco acima): Plano de hoje
> `3f24414dac76811b884feb9bd6bb791d` · Tópicos de hoje `3f24414dac76818e909cc6dc3a1c29cd`
> · Domínio `3f24414dac7681999546e536e2bf7e74` · Pontos fracos `3f24414dac768178935fca64d7c53561`.

### Blocos e views nomeados (sessão 3)

| O que | ID | Observação |
|---|---|---|
| **Display do Code** (synced block) | `9d83ac917556430a92882008ff30cccf` | Registrado em `IDS.blocos.displayCode`. É aqui que o Code injeta a resposta |
| **Terminal na coluna do Code** | `3f34414dac7681e3a3a9e27563d5b310` | Database vinculado com **uma só** view, `Terminal (lista)` — é o que renderiza como lista (ADR-013) |
| View vinculada antiga do Terminal | `2e794f15c0ce417bb11bd0914beb797c` | Renderizava tabela; movida para o fim da página como `inline=false`. **Não apagada**, para não acionar o guard |
| View vinculada da galeria de marcos | `3f34414dac768160b805ce8dcfecf0d9` | Idem |
| View `Marcos` (gallery, cardSize small) | `view://3f34414d-ac76-811e-bcb9-000c9529312c` | A que aparece na coluna do Hub |
| View `Próximos marcos` (gallery, small) | `view://3f34414d-ac76-8122-991d-000c8138c55d` | Aba no banco Compromissos |
| View `Galeria` da Biblioteca (small) | `view://3f34414d-ac76-81b7-9a89-000c60b69d32` | Aba no banco Biblioteca de Apostilas |
| View `Terminal (lista)` | `view://3f34414d-ac76-812b-b9bb-000cd91d5d01` | A view do bloco da coluna. Única view do database vinculado |
| View `Terminal` (aba no banco) | `view://3f34414d-ac76-8147-a047-000cfc68b38e` | Aba de lista no banco nomeado, que ainda tem `Default view` (table) na frente |

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

## 7. O assistente Code e o redesign do Hub (sessão 3)

### Pendência 3 fechada — `📥 Pedir` vira pedido formal

`promoverPedidos()` em `src/code.js`. Todo dia do Cronograma marcado `📥 Pedir`
passa a gerar um pedido na Central de Comandos (título determinístico
`Apostila do dia · <data> (<dia>)`, que é a chave de idempotência) e o dia vai
para `⏳ Gerando`, para não ser promovido duas vezes.

A ordem das duas escritas é deliberada: **o pedido é criado antes de o dia mudar
de estado**. Se falhar no meio, o dia continua `📥 Pedir` e a próxima execução
tenta de novo — em vez de um dia marcado "Gerando" sem pedido nenhum.

Com isso a **Central de Comandos é a única fila de trabalho**, que era o ponto
do defeito 3.

### O assistente Jarvis Code

**Nome:** "Code" virou **Jarvis Code** na sessão 4, para não competir com o nome
do próprio sistema. O comando do CLI é `jarvis`; `code` segue aceito como apelido.

**Conversa, não comandos.** A sessão 4 corrigiu uma premissa errada da sessão 3:
eu havia desenhado uma gramática de barras, mas o Breno não vai programar ali —
a conversa é casual. Então `interpretar()` passou a ter dois caminhos: casa um
comando explícito quando ele aparece, e senão **classifica a frase por intenção**
(`INTENCOES`, 8 famílias de sinônimos). "o que eu faço hoje?", "tenho tempo
quinta?", "tô travado em quê?" e "e amanhã?" chegam ao handler certo.

Isso é classificação de intenção, não compreensão de linguagem — não há
credencial de LLM (ADR-008). A vantagem é que funciona hoje, é testável sem rede
e **nunca inventa um dado do Hub**: se não entender, diz que não entendeu.

Dois extratores varrem a frase inteira, porque em conversa não há posição fixa:
`extrairIdTopico` acha `F04` em "como tá o f4?" e normaliza; `extrairDataDoTexto`
entende ISO, `dd/mm`, "dia 26", hoje/amanhã/ontem/depois de amanhã e dia da
semana escrito ("quinta" → a próxima quinta, hoje incluído). Último recurso: uma
frase que cita um dia e nada mais cai no plano daquele dia.

| Comando | Responde |
|---|---|
| `/hoje` | Plano do dia com capacidade real cruzada |
| `/capacidade [data]` | Tempo livre, descontando Compromissos |
| `/revisoes [data]` | Revisões do dia, derivadas do Hub |
| `/status <ID>` | Situação de um tópico, com R1/R2/R3 |
| `/pendentes` | Dias atrasados |
| `/fracos` | Tópicos em Reforço |
| `/agenda [data]` | Compromissos do dia, por hora |
| `/ajuda` | A lista, gerada do próprio registro de comandos |

O parser é tolerante (`/hoje`, `hoje`, `HOJE`, `/revisões`, `revis`, `/status: F04`)
mas **não casa prefixos de menos de 4 letras**, para não transformar um texto
solto num comando por acidente. Argumentos preservam a caixa, porque os IDs do
Hub são `F04`, não `f04`. Texto não reconhecido **nunca falha em silêncio**:
devolve "não entendi" com a lista de comandos.

**Duas entradas, uma fila.** `atenderFila()` lê o **Terminal do Code** (a
interface na página, acionada pelo checkbox `Enviar`) e os comandos de texto da
**Central de Comandos** (`Comando` = Tirar dúvida ou Outro). O Terminal vem
primeiro de propósito: quem acabou de digitar está olhando o display.

**O display.** `injetarNoDisplay()` apaga os filhos do synced block
`9d83ac917556430a92882008ff30cccf` e anexa a resposta formatada. É uma tela, não
um histórico — o histórico fica na coluna `Resposta` de cada linha.

Os handlers recebem `fontes` injetáveis, e é por isso que os 82 testes do Code
rodam sem tocar na rede.

### Redesign do Hub — o que foi feito, e o que não é possível

Tudo abaixo foi aplicado **e verificado por re-fetch** (ADR-010).

| Pedido | Estado | Como |
|---|---|---|
| Bloco de 3 colunas com margens | ✅ | `14/72/14`, laterais com `<empty-block/>`. Ratios vão verbatim e o render é proporcional à **soma**, então precisam somar 100 |
| Callout de metas sem o vermelho | ✅ | `red_bg` removido; agora default |
| Ícone da página monocromático | ✅ | `icons/activity_gray` — `iconMetadata` confirma `type: "icon"` |
| Ícones dos blocos monocromáticos | ✅ | 9 abas + 4 callouts, todos `icons/*_gray` |
| Terminal do Code, inline, view de Lista | ✅ | Pela via do ADR-013: database vinculado com **uma única** view de lista. A primeira tentativa (banco nomeado + aba de lista) renderizava **tabela** — ver diário |
| …"sem linhas de grade" | ⚠️ **não é atributo de API** | Nenhuma diretiva do view-dsl-spec controla gridlines. Uma lista do Notion não desenha grade na interface, mas isso é render, que esta API não mostra — então não afirmo que "desliguei" nada |
| Bloco sincronizado para o display | ✅ | Criado, com o id registrado |
| …com fundo `gray_background` | ⚠️ **impossível no bloco** | Ver abaixo |
| Galeria em Biblioteca de Apostilas | ✅ | View `Galeria`, `cardSize: small` |
| Galeria em Próximos marcos | ✅ | Não existia banco; a galeria sai do `Compromissos` |
| Cartão pequeno | ✅ | `COVER "<prop>" SIZE small` → grava `cardSize: "small"` |
| Ocultar conteúdo interno do cartão | ❌ **impossível** | Ver abaixo |

**Synced block não aceita cor própria.** Medido: o atributo `color` é aceito com
`200` e **silenciosamente descartado** — é o caso que originou o ADR-010. O
painel cinza foi obtido com um `<callout color="gray_bg">` **dentro** do synced
block, que é visualmente equivalente e sobrevive ao re-fetch. O bloco que o
script escreve continua sendo o synced block; o callout é só a moldura.

**Ocultar o preview do cartão não tem caminho.** O "Card preview → None" da
interface não é exposto pelo DSL de views nem por nenhuma ferramenta; `COVER` só
aponta para uma propriedade Files, nunca para "none". Pior: a serialização de
view nunca emite a chave `cover` para esse estado, então **nem seria
verificável**. É um clique na UI do Notion, e foi deixado para você.

**Onde as colunas de margem NÃO foram aplicadas, e por quê.** O bloco de 3
colunas envolve o topo (Code + metas), onde largura estreita ajuda. Não envolve
as seções de banco (`Hoje`, `Pontos fracos`) por duas razões concretas: o Notion
**não permite colunas dentro de colunas**, e a seção `Próximos marcos / Domínio`
já é um bloco de colunas; e comprimir uma tabela inline a 72% da largura produz
rolagem horizontal, que é o oposto de limpo. Se quiser a página toda mais
estreita, o caminho nativo é desligar **Full width** no menu `⋯` da página — um
clique, sem custo estrutural.

**A lista de marcos virou galeria do `Compromissos`.** Os bullets escritos à mão
tinham os pontos de cada avaliação; isso agora vive no campo `Observação` do
banco, então nada se perdeu. O ganho: as datas passam a ter **uma fonte só** e a
galeria se atualiza quando a coordenação remarcar algo — o que a lista digitada
nunca fez. É a mesma troca do item 1.

---

## 8. Status das integrações

| # | Integração | Status | Nota |
|---|---|---|---|
| 1 | Autenticação na API do Notion | ✅ Operacional | `users/me` e `users` em 200 |
| 2 | Transporte axios + shim do SDK | ✅ Operacional | ADR-001 |
| 3 | Mapeamento de IDs | ✅ Completo | 9 páginas, 11 bancos, 7 blocos/views |
| 4 | `diagnostico()` | ✅ Operacional | 11 bancos + 3 páginas de skill |
| 5 | Lógica pura | ✅ Testada | 176 asserções, `npm test` |
| 6 | Banco `Compromissos` | ✅ Criado e semeado | 10 blocos; durações pendentes |
| 7 | Banco `Auditoria de Agentes` | ✅ Criado | Aguarda a primeira auditoria |
| 8 | Banco `Terminal do Code` | ✅ Criado, 4 exemplos | Renderiza como lista pela via do ADR-013 |
| 9 | Redesign do Hub | ✅ Aplicado e verificado | Seção 7 |
| 10 | Galerias com cartão pequeno | ✅ Aplicado | `cardSize: small` confirmado |
| 11 | `lerCronograma` / `lerCompromissos` | 🟡 Codificado, não validado | Bloqueio da seção 3 |
| 12 | `reconciliarRevisoes()` | 🟡 Codificado, não validado | Dry-run por padrão |
| 13 | `otimizarAgentes()` determinístico | 🟡 Codificado, lógica testada | Injeção não exercitada |
| 14 | `promoverPedidos()` | 🟡 Codificado, lógica testada | Dry-run por padrão |
| 15 | `atenderFila()` + `injetarNoDisplay()` | 🟡 Codificado, lógica testada | O append REST no synced block não foi exercitado |
| 16 | `otimizarAgentes()` por LLM | ⬜ Escrito, não exercitado | Sem credencial (ADR-008) |
| 17 | Ocultar preview do cartão | ⬜ Impossível por API | Um clique na UI |
| 18 | Ponte Anki | ⬜ Fora de escopo | Vive no Make |

**Leitura honesta:** tudo que é estrutura está feito e verificado no Notion.
Tudo que é execução recorrente está escrito e com a lógica testada, mas **nenhum
caminho de escrita do código foi exercitado contra o Notion**, porque a
integração `ClaudeCode` continua sem ver nada. As escritas destrutivas são
dry-run por padrão (ADR-006), então a primeira execução real mostra o diff antes
de gravar.

---

## 9. Diário de bordo


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

### 2026-10-08 · Sessão 3 — o Code, a pendência 3 e o redesign
- `--aplicar` **não pôde rodar**: o diagnóstico seguiu `0/11`. Saber o ID da
  integração não concede acesso. Reconfirmado com três sondas (seção 3).
- Decidido não travar: estrutura pelo MCP, execução no código → ADR-009.
- **Sondado antes de tocar no Hub.** Cinco investigações paralelas numa página
  descartável, mais um verificador adversarial, para não errar na página de
  verdade. Rendeu quatro achados que mudaram o plano:
  - Colunas laterais **vazias funcionam**; ratios vão verbatim e o render é
    proporcional à soma, logo precisam somar 100.
  - `<synced_block color>` é aceito com 200 e **descartado em silêncio** → ADR-010.
  - 45 identificadores de ícone nativo confirmados, com a regra de nomenclatura
    e a assimetria de leitura/escrita → ADR-012.
  - **Cartão pequeno é possível** via `COVER "<prop>" SIZE small`; ocultar o
    preview do cartão **não tem caminho** por API.
- Escrito `src/code.js`: gramática de 8 comandos, dupla entrada (Terminal +
  Central), injeção no display, e `promoverPedidos()` fechando a pendência 3.
- Redesign do Hub aplicado e **verificado por re-fetch**: colunas 14/72/14,
  callout de metas sem o vermelho, ícone de página e das 9 abas monocromáticos,
  Terminal inline com view de lista, synced block de display, duas galerias com
  `cardSize: small`, títulos sem emoji.
- Criado o banco `Terminal do Code` com 4 comandos de exemplo.
- `test/code.test.js`: **82 asserções**, todas passando. Total do projeto: 176.
- Nenhum `<page>` ou banco perdido no redesign — conferido tag por tag, usando
  `update_content` ancorado em vez de `replace_content` (ADR-011).

### 2026-10-08 · Sessão 3, adendo — o verificador me pegou
O verificador adversarial do workflow terminou **depois** de eu ter reportado a
sessão como concluída, e derrubou duas das minhas afirmações:

1. **"Terminal inline com view de Lista ✅" estava errado.** O banco nomeado
   nasce com `Default view` de tipo table em primeiro lugar, e não há ferramenta
   para apagar view, reordenar abas ou definir a padrão — então o bloco
   renderizava **tabela**, não lista. Confirmei no fetch do banco (duas views,
   `Default view` table à frente de `Terminal` list) e corrigi: o bloco da coluna
   agora é um database vinculado com **uma única** view de lista (ADR-013),
   verificado por fetch do próprio bloco.
2. **"Lista não tem linhas de grade por natureza" era afirmação demais.**
   Gridline não é atributo desta API; o que a interface desenha, eu não vejo
   daqui. A redação no log foi corrigida para não prometer o que não verifiquei.

Também apurou uma armadilha que nenhuma sonda tinha visto: `COVER "<prop
não-Files>" SIZE small` **apaga** a chave `cover` que a view já tivesse, com
`200` e sem aviso. Verifiquei o caso concreto: nem `Biblioteca de Apostilas` nem
`Compromissos` têm propriedade Files, e as duas galerias eram novas, criadas
nesta sessão — então **nada foi destruído**. Mas a regra vale para a próxima vez:
se a base tiver propriedade Files, use `COVER "<PropFiles>" SIZE small`.

E emendou o ADR-011: um bloco de view vinculada **não** é um ponteiro
descartável — o guard do Notion o protege como database filho. Reposicionar é
trocar de lugar, não remover.

**Lição que fica:** a sonda adversarial pagou o próprio custo. Sem ela eu teria
deixado um "view de Lista ✅" que, na tela, era uma tabela.

### 2026-10-08 · Sessão 4 — Jarvis Code, conversa e voz
Três pedidos do Breno, e o primeiro derrubou uma premissa minha.

- **"Lá não irei programar, a conversa será casual."** A gramática de barras que
  eu desenhei na sessão 3 estava errada para o uso real. Adicionada
  classificação de intenção (`INTENCOES`) + extratores de ID e data que varrem a
  frase inteira. Dois bugs encontrados pelos próprios testes novos: "depois de
  amanhã" casava `amanha` primeiro (ordem das checagens), e `/\b(desculp…)\b/`
  não casava "desculpa" — o `\b` final cai entre duas letras. O mesmo erro de
  `\b` já havia me pegado com `obrigad`; agora está comentado no código.
- **"Chamar de Jarvis Code."** Renomeado: módulo, CLI (`jarvis`, com `code` como
  apelido), banco no Notion e a caixa no Hub.
- **"Personalidade do Jarvis, senso de humor e auxílio."** → ADR-014. A voz é uma
  camada separada: uma linha cinza no fim, marcada `voz: true`, determinística.
  Os handlers passaram a declarar `fatos`, e `comentar()` escolhe a fala a partir
  deles. Mais cortesia (`SOCIAL`), para "oi" e "obrigado" não virarem erro.
- **Topo do Hub reorganizado**, conforme pedido: o Jarvis Code virou uma **caixa
  cinza recolhida de uma linha** (`<details color="gray_bg">`) no topo, com o
  terminal e o display dentro. O bloco de 3 colunas com margens vazias saiu — ele
  existia para emoldurar o Code grande, e com a caixa recolhida perdeu a função.
  No lugar: metas + uma linha de atalhos para Hub Central de Controle, Cronograma,
  Compromissos e Central de Comandos (menções, sem duplicar banco). Resultado:
  `## Hoje` subiu de ~20 linhas para a terceira posição da página.
- Verificado por re-fetch que o synced block `9d83ac91…` **sobreviveu à mudança**
  com o mesmo id — era o risco real, porque `IDS.blocos.displayCode` o referencia.
- **227 asserções** passando (94 + 133).

**Próxima sessão começa por:**
1. **O compartilhamento.** `node index.js diagnostico` tem de dar `11/11`. Até
   lá, nenhum comando de escrita do código funciona — e é só isso que separa o
   sistema de estar no ar.
2. `node index.js revisoes` (dry-run) → ler o diff → `--aplicar`.
3. `node index.js promover` (dry-run) → `--aplicar`.
4. `node index.js fila --aplicar` para exercitar o display ponta a ponta. É o
   único caminho ainda não exercitado nem em lógica nem em rede: o append REST
   dentro do synced block.
5. Preencher as durações em `Compromissos` (sem elas os dias saem como
   `indeterminado`) e resolver: hora do IESC II, dia do tutorial B4, subturma do
   ECG, e cadastrar Atlética/Liga e treino físico.
6. Primeira auditoria real para fechar o ciclo do item 3.
7. Opcional, um clique seu na UI: "Card preview → None" nas duas galerias, que a
   API não alcança.
