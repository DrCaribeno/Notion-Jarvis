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
- **Última atualização:** 2026-10-08

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

---

## 3. Bloqueio ativo — compartilhamento da integração

**Este é o único impedimento entre o código e os dados reais, e ele é resolvido por você, no Notion.**

A integração `ClaudeCode` autentica com sucesso, mas **nada está compartilhado com ela**:

```
POST /v1/search  →  200 OK, results: []          (zero objetos visíveis)
GET  /v1/pages/3f24414d…6738b3  →  404
  "Could not find page … Make sure the relevant pages and databases
   are shared with your integration \"ClaudeCode\"."
```

Os IDs da seção 4 foram obtidos pelo **conector MCP do Notion** (autenticado como
você, vê o workspace inteiro) — e não pela API da integração. Por isso o mapeamento
está completo embora a API ainda responda 404.

**Como liberar:** abrir o **Hub Central MED 1.5** no Notion → `⋯` (canto superior
direito) → **Conexões** / *Connections* → **adicionar `ClaudeCode`**. O acesso é
herdado por todas as subpáginas e bancos, então **um único compartilhamento no Hub
destrava os 8 bancos de uma vez**. Depois, `node index.js diagnostico` passa de
`404` para `✅` em todas as linhas.

---

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

---

## 6. Proposta aberta — reconciliação cronograma × agenda

**Postura proativa, conforme combinado: estrutura proposta, nada codificado ainda.**
Isto nasceu da leitura dos schemas, não de um palpite.

### Defeito 1 — `Revisões programadas` é texto livre (prioridade alta)
O Hub calcula as revisões por **fórmula** (R1 +1 dia, R2 +7, R3 +15 a partir da
`Data Real de Estudo`, com fallback na `Data Alvo`). O Cronograma guarda as mesmas
revisões como **texto digitado**. São duas verdades para o mesmo fato.

No instante em que você estuda um tópico fora do dia previsto e preenche a
`Data Real de Estudo`, o Hub recalcula sozinho e **o texto do Cronograma fica
mentindo** — silenciosamente, sem erro visível. Com 58 tópicos × 3 revisões, a
chance de o cronograma estar desatualizado cresce todo dia.

**Correção proposta — Agente Sincronizador:** uma função que, para cada dia `D`,
deriva do Hub quais tópicos têm R1/R2/R3/pré-prova caindo em `D` e reescreve
`Revisões programadas` + preenche a relation `Tópicos`. O campo passa a ser
**derivado**, nunca digitado. Roda no começo da rotina das 5h, antes de gerar material.

### Defeito 2 — a agenda é prosa (prioridade alta)
Os compromissos fixos (tutoriais 14h, AC1 26/10 16h30, TBL 23/10 16h30, Mini-OSCE
12/11 14h, IESC II segundas de manhã, MD 2.5 até 09/10) hoje vivem em tabelas da aba
*Mapa da prova* e no texto `Eventos do módulo`. Nada disso é consultável por código,
então **nenhuma automação sabe quantas horas você realmente tem livre num dia**.
O cronograma prevê 39,5 h na semana de neuro sem subtrair aula nenhuma.

**Duas opções, e eu recomendo a (A):**

- **(A) Banco `Compromissos` no Notion** — `Título`, `Início` (datetime), `Fim`,
  `Tipo` (Tutorial · Conferência · Prática · Prova · Outro módulo · Pessoal),
  `Recorrência`, relation → `Cronograma de Ataque`.
  *A favor:* fonte única dentro do hub, sem credencial nova, funciona na rotina das
  5h mesmo com o PC desligado, e o Jarvis já tem permissão de escrita.
  *Contra:* os eventos recorrentes precisam ser cadastrados uma vez.
- **(B) Google Calendar** como fonte. *A favor:* você provavelmente já mantém.
  *Contra:* mais uma credencial, OAuth a renovar, e some a ligação direta com os tópicos.

Com a (A) fecha o ciclo que te interessa: **`Horas` do dia − horas comprometidas =
capacidade real**; se a capacidade for menor que o plano, o Sincronizador redistribui
respeitando o teto de 6 h/dia que a regra de adaptação já define, e registra o
remanejamento no `Diário do Motor`.

### Defeito 3 — gatilhos sem dono (prioridade média)
`Apostila = 📥 Pedir` no Cronograma e uma linha `📥 Pendente` na Central de Comandos
são dois caminhos para o mesmo trabalho. Hoje nada garante que o primeiro vire o
segundo. Proposta: o Jarvis promove todo `📥 Pedir` a um pedido formal na Central de
Comandos (idempotente, por ADR-003), e a Central passa a ser a **única fila de trabalho**.

**Nada disso entra no código sem seu aval.** Diga qual frente ataco primeiro.

---

## 7. Status das integrações

| # | Integração | Status | Nota |
|---|---|---|---|
| 1 | Autenticação na API do Notion | ✅ Operacional | Via injeção do proxy; `users/me` → `ClaudeCode` |
| 2 | Transporte axios + shim do SDK | ✅ Operacional | ADR-001 |
| 3 | Mapeamento de IDs do hub | ✅ Completo | 9 páginas, 8 bancos (seção 4) |
| 4 | `diagnostico()` | ✅ Operacional | Distingue `400` de `404`, varre os 8 bancos |
| 5 | `lerCronograma()` | 🟡 Codificado, não validado | Espera o compartilhamento da seção 3 |
| 6 | `gerenciarAgente()` | 🟡 Codificado, não validado | Idem |
| 7 | Reconciliação cronograma × agenda | ⬜ Proposto | Seção 6, aguarda decisão |
| 8 | Banco `Compromissos` | ⬜ Proposto | Seção 6, opção (A) |
| 9 | Promoção de `📥 Pedir` → Central | ⬜ Proposto | Seção 6, defeito 3 |
| 10 | Ponte Anki (`sincronizar_anki.bat`) | ⬜ Fora de escopo | Vive no Make, não tocar ainda |

Legenda: ✅ operacional e verificado · 🟡 escrito, verificação bloqueada · ⬜ não começou

---

## 8. Diário de bordo

### 2026-10-08 · Sessão 1 — fundação
- Reconhecimento do ambiente: Node 22.22, repositório vazio (nenhum commit), branch correta.
- Descoberto que **não há `NOTION_TOKEN` no ambiente**; a autenticação é injetada pelo proxy.
- Testada a autenticação: bot `ClaudeCode` no workspace `Breno's Notion`. ✅
- **Medido** que o SDK falha e o axios funciona por causa do proxy → ADR-001.
- **Medido** que `/v1/data_sources/*` não existe para esta integração → ADR-002.
- `POST /v1/search` retorna vazio → identificado o bloqueio de compartilhamento (seção 3).
- Hub mapeado pelo conector MCP: 9 páginas, 8 bancos, schemas completos (seções 4 e 5).
- Instalados `@notionhq/client@5.27.0` e `axios@1.20.0`.
- Escritos `index.js` (diagnóstico + `lerCronograma` + `gerenciarAgente`) e este log.
- Identificados 3 defeitos estruturais e proposta a correção (seção 6) — **não codificados**.

**Próxima sessão começa por:** confirmar se o compartilhamento foi feito
(`node index.js diagnostico`); depois, a decisão do Breno sobre a seção 6.
