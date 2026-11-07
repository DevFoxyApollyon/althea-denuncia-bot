# Ponte Discord ⇄ SA-MP: briefing para o Claude Code

> Leia este arquivo inteiro antes de mexer no código. Ele junta o pedido original, as decisões já tomadas, o mapa do código atual do Althea e os cuidados que **quebram produção se forem ignorados**.
>
> Como usar: abra o Claude Code na pasta `althea` e rode
> `/add-dir "C:\Users\joaov\Downloads\Data Ovitinz PC\Data Ovitinz PC\moonloader"`
> para ele enxergar também a pasta do MoonLoader. Depois diga: *"Siga o PONTE_SAMP_PLANO.md, etapa por etapa, e pare ao fim de cada etapa para eu validar."*

---

## 1. Objetivo

Quando uma denúncia é aceita no Discord, ela vai para uma **fila** dentro do jogo, num painel mimgui do script Lua no PC do staff. O staff revisa, edita, remove ou adiciona jogadores e **só então** aplica as punições. **Nada é aplicado sem confirmação humana no painel do jogo.** Tudo é auditável e isolado por `guildId`. O bot atende vários servidores.

```
Discord ⇄ Althea (Node + Express, Square Cloud, MongoDB) ⇄ HTTPS + token ⇄ Lua no PC (MoonLoader) ⇄ servidor SA-MP
```

O bot hospedado **não** consegue conectar no PC. Quem inicia é sempre o Lua, por polling HTTPS.

---

## 2. Decisões já tomadas (não perguntar de novo)

| Tema | Decisão |
|---|---|
| Código base | Integrar no bot **Althea** existente (esta pasta), sem reescrever o fluxo de denúncias. |
| Onde ficam as denúncias aprovadas | Coleção `denuncias` (model `models/Denuncia.js`), `status: 'aceita'`. |
| Quem pode aceitar | Cargo de staff **configurável por guild** (já existe: `Config.roles.responsavel_admin` e `Config.roles.administrador`). Reaproveitar `checkModPermission` e `validarResponsavelAdminLog`. |
| Vários PCs por guild | Sim, simultâneos. |
| Códigos de ativação | Gerados **apenas** pelo dono (`OWNER_DISCORD_ID`). |
| Painel web | Só para o dono: tokens ativos, quem usou cada um, servidores e códigos. |
| Lua HTTP | `effil` + `requests.lua` (`ssl.https`) + `cjson`. Todos já estão instalados em `moonloader/lib` (ver §6). |
| Testes | `node --test` (padrão do projeto). **Não** introduzir Jest. |

---

## 3. Mapa do código atual (o que já existe e importa)

### Infra
- `index.js`: sobe o Discord, conecta os bancos e chama `iniciarSite(client, log)` (`site/servidor.js`) no `clientReady`.
- `squarecloud.app`: `SUBDOMAIN=althea-denuncias`, `MEMORY=3000`, `START=node --expose-gc --max-old-space-size=2560 index.js`.
- **Dois bancos Mongo** via `utils/persistencia.js`:
  - `model()` e `modelPermanente()` usam o **principal** (`MONGODB_URI`).
  - `modelSecundario()` e `modelSecundarioPermanente()` usam o **secundário** (`SECONDARY_DB_URI`).
  - `registrar()` **lança erro** se a coleção não estiver coerente com `utils/retencaoDados.js` (`COLECOES_PERMANENTES` e `COLECOES_COM_REGRA_PROPRIA`). Todo model novo precisa ser registrado ali, senão o bot não sobe.
  - Coleções que não estão em nenhuma lista ganham `dataRetencaoAte` com TTL de 6 meses, ou o prazo de `PRAZOS_EM_DIAS`.
- `utils/env.js`: lista `OBRIGATORIAS` e `OPCIONAIS`. Adicionar `OWNER_DISCORD_ID` e `PONTE_SAMP_ATIVA` como **opcionais**, para não derrubar o bot em quem não usa a ponte.
- `utils/configCache.js`: `getConfig(guildId)` com cache. Os hooks do model `Config` invalidam o cache sozinhos.
- `utils/logger.js`: `new Logger({ tag })` e `log.info/warn/error/success`. Usar sempre, nunca `console.log`.

### Fluxo de aceite (o ponto de integração)
Arquivo: `Handlers/statusDenuncia/acoesStatus.js`.

1. **No tópico**: botão `customId: 'aceitar'` → `handleStatusButton` → `handleAceitar` abre o modal `punishment_modal` com os campos:
   - `acusadoId`: **ID de conta do jogo**, pode ser vários separados por `+` (ex.: `1039+2471`);
   - `motivo`;
   - `data`.
   
   `handlePunishmentModal` grava `status:'aceita'`, `acusadoId`, `motivoAceite`, `dataPunicao` e `staffId`. Também posta no canal **Cadeia Staff** (`Config.channels.logs`) a mensagem `➱ Denúncia aceita Acusado (...)`, com os botões `log_aceitar_<denuncia.messageId>` e `log_recusar_<...>` (montados em `mensagensStatus.js#createLogActionRow`).
2. **No canal da staff (Cadeia Staff)**: `log_aceitar_<messageId>` → `interactionHandler.handleLogButton` → `handleLogAceitarButton` (só `responsavel_admin`). Esse handler edita a mensagem com "|| data || por X" e remove os botões.
3. O roteamento fica em `Handlers/interactionHandler.js`, no objeto `ROTAS` (`exatos` e `prefixos`). Para um botão novo, basta registrar ali.

> ⚠️ **Não renomear** os customIds existentes para `aceitar:<id>`. Isso quebra todas as mensagens já publicadas. A integração deve ser feita **chamando um serviço novo** no fim dos dois handlers acima (ver §5.3).

### Site e Express (já existe)
- `site/servidor.js#criarApp` já tem Express na porta `SITE_PORT || PORT || 80`, com `trust proxy` e cabeçalhos de segurança. A **CSP** é `script-src 'self'` e `style-src 'self'`, então **não pode haver JS nem CSS inline**: as páginas do `/admin` precisam usar arquivos `.js` e `.css` externos.
- Login Discord OAuth2 já pronto: `/auth/entrar` → `/auth/retorno`. A sessão é um cookie HMAC (`site/sessao.js`, `althea_sessao`, httpOnly, sameSite lax, secure em HTTPS). O usuário logado fica em `req.usuario = { id, nome, avatar }`.
- **Proteção de origem**: todo método diferente de GET, HEAD e OPTIONS exige `Origin === SITE_URL`, senão responde 403. **O script Lua não manda `Origin`**, então a API do jogo precisa ser montada **antes** desse middleware (ou ser excluída dele explicitamente).
- `site/protecao.js`: rate limit por IP (`ipDoCliente` lê `cf-connecting-ip`). `criarLimitador(max, janelaMs)` vem de `site/rotas/comum.js`.
- O site só sobe se `SITE_URL`, `CLIENT_ID`, `CLIENT_SECRET` e `SESSION_SECRET` (≥ 32 caracteres) estiverem definidos.

### Testes
- `test/*.test.js` com `node:test` e `assert/strict`. `test/helpers/env.js` aponta os bancos para `mongodb://127.0.0.1:1/...` (inexistente, de propósito). `test/helpers/discordFalso.js` é um Discord de mentira.
- Para testar as operações atômicas de verdade, adicionar `mongodb-memory-server` como **devDependency** e usar só nos testes novos. Se o download do binário falhar, isolar a lógica em funções puras com o model injetado.

### Bug que encontrei de passagem (não corrigir sem perguntar)
`handleStatusButton` usa `processingLock` como trava, mas o campo **não existe no schema** de `Denuncia`. Com o `strict` padrão do mongoose, o `$set: { processingLock: true }` é descartado, e a trava nunca trava de verdade. Avisar o JV antes de mexer.

---

## 4. Descoberta importante sobre os IDs do jogo (muda o pedido original)

O pedido original dizia: *"guardar o NICK, o ID do SA-MP muda a cada sessão, resolver nick → ID na hora"*. **No Brasil RolePlay não é bem assim:**

- O servidor usa um **ID próprio e fixo por conta** (ex.: `472860`), diferente do ID do SA-MP (0–999). O comentário do `staff_panel.lua` (linhas ~446–450) diz: *"Os comandos só aceitam o ID próprio"*.
- O `acusadoId` que a staff digita no modal **já é esse ID de conta** (o model `Usuario` liga `conta` ↔ `userId` do Discord).
- O `staff_panel.lua` já aprende o par "ID SA-MP → ID do servidor" por dois caminhos: o texto 3D `ID: 472860` (só de quem está perto) e mensagens no formato `Nick (472860)`. Funções `setServerId`, `serverIdOf`, `scanLabels` e `refreshPlayers`.

**Consequência para o modelo:** cada alvo guarda `contaId` (o ID fixo, obrigatório) e `nick` (opcional, preenchido quando conhecido). No jogo, o comando usa o `contaId`. Saber se o jogador está **online** vira uma verificação de "melhor esforço" (pelo mapa aprendido). Ver a pergunta 1 em §9.

---

## 5. O que construir

### 5.1 Models novos (todos com `guildId` e índices)
Coloque-os em `models/`. Escolha o banco certo e registre cada coleção em `utils/retencaoDados.js`.

| Model / coleção | Banco | Retenção | Campos principais | Índices |
|---|---|---|---|---|
| `PonteServidor` / `ponteservidores` | principal | **permanente** | `guildId`, `ativo`, `ativadoEm`, `ativadoPor`, `codigoId`, `limitePcs`, `templates` (mapa `cmd → template`), `canalAlertasId`, `desativadoEm/Por` | `guildId` único |
| `PonteCodigo` / `pontecodigos` | principal | **permanente** | `codigoHash` (sha256), `ultimos4`, `criadoPor`, `criadoEm`, `expiraEm?`, `limitePcs?`, `usadoEm?`, `usadoPorGuild?`, `usadoPorUser?`, `expirado` | `codigoHash` único |
| `PonteInstalacao` / `ponteinstalacoes` | principal | **permanente** | `guildId`, `nome`, `tokenHash`, `ultimos4`, `hwidHash?`, `status` (`ativa`/`revogada`/`bloqueada`), `criadoPor`, `criadoEm`, `ultimoUsoEm`, `ultimoIp`, `ultimoPingEm`, `versaoScript` | `tokenHash` único; `{guildId:1, status:1}` |
| `PontePunicao` / `pontepunicoes` | principal | 45 dias (em `PRAZOS_EM_DIAS`) | ver §5.2 | `denunciaId` **único**; `{guildId:1, status:1, criadoEm:-1}` |
| `PonteUso` / `ponteusos` | principal | TTL de 90 dias (em `PRAZOS_EM_DIAS`) | `guildId`, `instalacaoId`, `em`, `acao` (`fila`, `editar`, `aplicar`, `auth_falhou`, `hwid_diferente`, `guild_inativa`, `ping`), `punicaoId?`, `contaId?`, `nick?`, `comando?`, `ip`, `detalhes` | `{guildId:1, em:-1}` |

> Gravar o `ping` em `PonteUso` encheria a coleção. O ping só atualiza `ultimoPingEm` na instalação. Só falhas e ações vão para `PonteUso`.

### 5.2 `PontePunicao` (uma por denúncia)
```js
{
  denunciaId: ObjectId (único), guildId, status: 'aceita'|'executando'|'aplicada'|'cancelada',
  origem: 'topico'|'canal_staff', aceitoPor: { id, nome }, aceitoEm,
  msgDiscord: { texto, link, acusado, motivo, provas },
  mensagens: { topicoMsgId, canalMsgId, topicoId, canalId },
  alvos: [{ _id, contaId, nick, cmd, tempo, motivo, removido: false, adicionadoNoJogo: false }],
  versao: Number (trava otimista), executandoPor?: instalacaoId, executandoDesde?,
  aplicadaEm?, aplicadaPor?: { instalacaoId, nomePc }, resultado?: [{ alvoId, comando, ok, erro }]
}
```

### 5.3 Serviço de aceite (`services/ponteSamp/aceite.js`)
- `registrarAceite({ client, denuncia, origem, staff })`:
  1. Se a guild não estiver ativa (`PonteServidor.ativo`), **não faz nada** e não muda o fluxo atual do bot.
  2. Faz `findOneAndUpdate({ denunciaId }, { $setOnInsert: {...} }, { upsert: true, new: true, rawResult: true })`. Se o documento já existia, devolve `{ jaExistia: true, aceitoPor }`.
  3. Monta os `alvos` a partir de `denuncia.acusadoId.split('+')`, com `motivo = denuncia.motivoAceite` e `cmd` e `tempo` vindos do template padrão da guild.
  4. Edita **as duas** mensagens (o status no tópico e a mensagem da Cadeia Staff) para incluir `✅ Aceita por X, aguardando no painel do jogo`. Guarda os IDs. Usar `.catch()` em cada edição, porque a mensagem pode ter sido apagada.
  5. Trata o erro `E11000` (corrida dos dois cliques) como "já aceita por X".
- Chamar `registrarAceite` em dois pontos:
  - no fim do caminho de sucesso de `handlePunishmentModal`, com `origem: 'topico'`;
  - em `handleLogAceitarButton`, depois de editar a mensagem, com `origem: 'canal_staff'`.
  
  Se já existia, a resposta efêmera ganha a linha "ℹ️ Já está no painel do jogo (aceita por X)". **Não** bloquear o fluxo atual do bot.
- Toda chamada fica em `try/catch`: uma falha da ponte **nunca** pode quebrar o aceite normal da denúncia.

### 5.4 Comandos de barra (em `commands/slash.js`, no array `comandos`)
- `/ativar codigo:` (precisa de `ManageGuild`): faz o hash, `findOneAndUpdate({ codigoHash, usadoEm: null, expirado: false, $or: [{ expiraEm: null }, { expiraEm: { $gt: now } }] }, { $set: { usadoEm, usadoPorGuild, usadoPorUser } })` de forma atômica e liga o `PonteServidor`.
- `/instalacao nova nome:` | `listar` | `revogar id:` | `renovar id:`. Exige `ManageGuild` ou o cargo `responsavel_admin`. O token é `crypto.randomBytes(32).toString('base64url')`, mostrado **uma vez**, em resposta efêmera, junto com o bloco de config pronto para colar no `.ini`. Grava só o `sha256` e os 4 últimos caracteres. Respeita o `limitePcs`.
- `/ponte templates` (responsável): mostra e edita os templates de comando da guild (modal).
- `/ponte-codigo gerar [validade_dias] [limite_pcs]`: **só** para `OWNER_DISCORD_ID`. Qualquer outro usuário recebe "❌ Sem permissão" e a tentativa é registrada. Pode ser escondido com `setDefaultMemberPermissions(0)`, mas a checagem real é o ID do usuário.

### 5.5 API do jogo (`site/ponte/apiJogo.js`, montada em `/ponte/api`)
- Montar em `criarApp` **antes** do middleware de Origin e **fora** de `/api` (que exige sessão). Usar `express.json({ limit: '32kb' })` só nesse router.
- **Autenticação** pelo cabeçalho `Authorization: Bearer <token>`:
  - sha256 do token → `PonteInstalacao` com status `ativa`; senão **401**;
  - `PonteServidor.ativo` da guild da instalação; senão **403**;
  - `req.ponte = { guildId, instalacao }`. **Toda** query usa `req.ponte.guildId`. O cliente nunca envia `guildId`.
- **HWID** pelo cabeçalho `X-HWID` (o sha256 vem calculado pelo script):
  - no primeiro uso, grava;
  - se for diferente do gravado: `status:'bloqueada'`, registra `hwid_diferente`, avisa no `canalAlertasId` (ou no `Config.channels.log`) e responde 403.
- **Rate limit**: `criarLimitador` por token (60/min) e por IP (120/min). Falhas de autenticação por IP têm limite próprio (10/min); depois disso, 429.
- Rotas:
  - `GET /fila`: punições da guild com `status: 'aceita'`, as mais antigas primeiro, no máximo 50.
  - `PATCH /fila/:id`: corpo `{ versao, alvos: [...] }`. Usa `findOneAndUpdate({ _id, guildId, status: 'aceita', versao }, { $set: { alvos }, $inc: { versao: 1 } })`. Se não achar, responde **409** e o painel recarrega. Valida cada alvo (ver §5.7). Remover é `removido: true`, nunca apagar.
  - `POST /fila/:id/executar`: `findOneAndUpdate({ _id, guildId, status: 'aceita', versao }, { $set: { status: 'executando', executandoPor, executandoDesde } })`. Se não achar, **409** ("outro PC já está aplicando"). Uma execução que fica presa mais de 10 minutos volta para `aceita` (um job ou uma checagem na própria rota cuida disso).
  - `POST /fila/:id/aplicada`: corpo `{ resultado: [...] }`. Usa `findOneAndUpdate({ _id, guildId, status: 'executando', executandoPor: instalacaoId }, { $set: { status: 'aplicada', ... } })`. Depois atualiza as duas mensagens do Discord com "🎮 Aplicada no painel por X (PC: nome)". Se algum alvo ficou pendente (offline), a resposta diz isso e o painel pergunta se o restante continua na fila (status volta para `aceita`, e só os alvos aplicados são marcados como `removido`).
  - `POST /fila/:id/cancelar`: volta de `executando` para `aceita` quando o staff aborta.
  - `POST /ping`: atualiza `ultimoPingEm`, `versaoScript` e `ultimoIp`.
- Toda ação passa pelo registro em `PonteUso` (função `auditar(req, acao, extra)`).
- Respostas sempre em JSON `{ ok, erro?, ... }`, nunca o stack.

### 5.6 Painel web do dono (`/admin`)
- Separado da API do jogo: o token de um PC **nunca** abre o `/admin`, e a sessão do site nunca abre `/ponte/api`.
- Reaproveita o login existente: `req.usuario.id === process.env.OWNER_DISCORD_ID`; senão **404** (para não revelar que a rota existe). Para voltar ao `/admin` depois do login, adicione um `destino` (aceitando só `/admin`) no token de estado de `/auth/entrar`, sem quebrar o fluxo atual.
- **CSRF**: o middleware de Origin já cobre os POSTs. Somar a ele um token CSRF em cabeçalho (`X-CSRF`), gerado por `criarToken({ sid, csrf: true }, segredo)` e entregue por `GET /admin/api/csrf`.
- Rate limit próprio no `/admin/api`.
- Arquivos em `site/public/admin/index.html`, `admin.js` e `admin.css`, sem nada inline (CSP), em HTML simples com tabelas e `fetch`. Telas:
  - **Servidores**: guild (nome e ID), ativo, data de ativação, número de PCs, botão desativar.
  - **Instalações**: nome do PC, guild, status, criado por, último uso, IP, HWID parcial (8 caracteres), `…abcd` (só os últimos 4), online se `ultimoPingEm` tiver menos de 90 s, botão revogar.
  - **Uso e auditoria**: filtros por guild e por ação, com paginação por `em`.
  - **Códigos**: gerar (o código aparece uma vez), lista de usados e não usados, botão expirar.

### 5.7 Validação e sanitização (servidor **e** Lua)
- `contaId`: `/^\d{1,9}$/`.
- `nick`: `/^[A-Za-z0-9_\[\]\.\$@=()]{3,24}$/`, vazio permitido.
- `tempo`: inteiro de 0 a 99999.
- `cmd`: só chaves que existem nos templates da guild.
- `motivo`: corte em 60 caracteres. Remover `\r`, `\n`, `{` e `}` (cores do SA-MP), `/` no início e caracteres de controle; colapsar espaços.
- O template só aceita os marcadores `{cmd}`, `{id}`, `{tempo}` e `{motivo}`. O resultado precisa começar com `/` e não pode ter mais de 128 caracteres (limite do chat do SA-MP). **A montagem final acontece no Lua**, mas o servidor devolve uma prévia para conferência.

---

## 6. Script Lua (`moonloader/ponte_denuncias.lua` + `moonloader/config/ponte_denuncias.ini`)

### Ambiente já instalado no PC do JV (conferido)
- `MoonLoader.asi`, `SAMPFUNCS.asi` e `lua51.dll`.
- Em `moonloader/lib`: `mimgui/`, `samp/` (SAMP.Lua, `samp.events`), `effil.lua` + `libeffil.dll`, `requests.lua` (usa `socket.http`, `ssl.https`, `cjson.safe`, `xml`, `md5`, `base64`), `ssl.dll`, `cjson.dll`, `encoding.lua`, `inicfg` e `fAwesome5.lua`.
- **Script de referência de estilo**: `moonloader/staff_panel.lua` (v2.11.0, também do JV). Seguir os mesmos padrões:
  - `encoding.default = 'CP1252'` e `u8 = encoding.UTF8`;
  - `pcall(require, 'mimgui')` com mensagem amigável quando falta;
  - `inicfg.load(DEFAULTS, 'nome')`;
  - fila de comandos com intervalo (`cmdQueue` e `nextCmdAt`);
  - `sendChat` com `u8:decode`;
  - temas `fogo` e `preto`, e escala de texto.
- **Reaproveitar** (copiar, não importar) a lógica de `serverIdOf`, `setServerId`, `scanLabels` e `refreshPlayers` do `staff_panel.lua`, para saber se o `contaId` está online e qual é o ID SA-MP dele.

### Requisitos do script
- O HTTP roda em `effil.thread` (o padrão `asyncHttpRequest` da comunidade MoonLoader), com `requests` dentro da thread. O resultado volta ao `lua_thread` principal por polling de `effil.channel` ou do status da thread. **Nunca** bloquear o frame.
- Polling da fila a cada 10 s com o painel aberto e a cada 30 s com ele fechado. Ping a cada 45 s. Em erro de rede, backoff de 5 s → 10 s → 30 s → 60 s, sem travar, e uma mensagem discreta no chat só na primeira falha.
- `.ini` local: `url`, `token`, `modo_teste=true` (**padrão ligado**), `delay_ms=1500` (mínimo de 1500 imposto no código), `tecla`.
- **HWID**: sha256 (ou md5, porque `md5.lua` já existe) de `serial do volume C:` + nome do PC, lidos por `ffi` com `GetVolumeInformationA` e `GetComputerNameA`. Mandar só o hash.
- Painel mimgui com duas abas e fonte com acentos (carregar o glyph range Cyrillic+Latin ou o `GetGlyphRangesDefault` com Latin-1; o `staff_panel.lua` mostra como).
  1. **Mensagem do Discord**: texto original, acusado, motivo, provas, quem aceitou, origem (tópico ou canal da staff) e um link (botão que copia o link para a área de transferência com `setClipboardText`).
  2. **Comandos**: para cada alvo, uma linha com `ID SA-MP | contaId | nick | motivo | ●online/○offline` e, logo abaixo, o comando montado (`/jail 472860 30 DM`). Botões **Editar** (cmd numa lista dos templates da guild, tempo e motivo), **Remover/Desfazer** e **+ Adicionar jogador** no fim. Cada edição faz `PATCH` com `versao`; se der 409, recarrega e avisa.
  - Checkbox **Modo teste**: o **Aplicar** não envia nada ao servidor. Só escreve no chat local (`sampAddChatMessage`) duas linhas por alvo: `[TESTE] ID x | conta | motivo` e, embaixo, o comando.
  - Modo real: `POST /executar`; depois, para cada alvo não removido, revalida o online e o ID, chama `sampSendChat` e espera ≥ 1500 ms; no fim, `POST /aplicada` com o resultado por alvo. Alvo offline fica pendente e não é enviado.
  - Antes do primeiro comando real, uma confirmação dupla ("Clique de novo em 3 s para confirmar"), igual ao `bulkConfirmUntil` do `staff_panel.lua`.
- Comandos no chat do jogo: `/fila` abre o painel e lista a quantidade; `/aplicar` aplica a punição selecionada, com a mesma confirmação.
- Toda chamada SAMP passa por `pcall` (o `staff_panel.lua` faz isso porque as assinaturas variam entre versões do SAMPFUNCS).

---

## 7. README e Square Cloud
- Atualizar `README.md` com uma seção "Ponte com o jogo", cobrindo:
  - as variáveis novas (`OWNER_DISCORD_ID`, `PONTE_SAMP_ATIVA`);
  - que o `SITE_URL` precisa ser `https://althea-denuncias.squareweb.app` (ou o domínio atual);
  - como gerar código → `/ativar` → `/instalacao nova` → colar no `.ini`;
  - instalação do MoonLoader, mimgui, SAMP.Lua, effil e requests;
  - como trocar de PC (`/instalacao renovar`).
- Atualizar `.env.example`, `doc/BUTTONS.md`, `doc/DB_MODELS.md` e `CHANGELOG.md`, e subir a versão no `package.json` (3.11.0 → 3.12.0).
- O `squarecloud.app` já tem `SUBDOMAIN`. Conferir se a publicação web está ativa no plano.

---

## 8. Etapas (validar cada uma antes de seguir)
1. Models + `retencaoDados.js` + `env.js`. Rodar `npm test` e `npm run lint`.
2. Serviço de tokens e códigos (hash, geração, validação), com testes.
3. Comandos `/ativar`, `/instalacao` e `/ponte-codigo`.
4. `registrarAceite` + ganchos nos dois handlers + edição das mensagens, com teste de upsert concorrente (duas chamadas em `Promise.all` geram um documento só).
5. API do jogo, com testes: 401, 403, isolamento (token da guild A não enxerga a fila da B), 409 na versão, execução atômica (dois "PCs" em paralelo: só um ganha).
6. `/admin` (servidores, instalações, uso, códigos).
7. Script Lua + `.ini` de exemplo.
8. README e documentação; `npm test` e `npm run lint` finais.

---

## 9. Perguntas em aberto (fazer ao JV antes da etapa 4)
1. **Formato real dos comandos de punição** no Brasil RolePlay (e nos outros servidores), com a ordem dos parâmetros. Exemplos: `/prender {id} {tempo} {motivo}`, `/ban {id} {dias} {motivo}`, `/kick {id} {motivo}`. Eles aceitam o **ID de conta fixo** (ex.: 472860) mesmo com o jogador **offline**? Existe versão offline (`/banoff`, `/prenderoff`)? Isso define se "offline = pendente" vale ou não.
2. A denúncia deve entrar na fila do jogo **já no aceite do tópico** (modal de punição) ou **só depois** da confirmação do responsável no botão `log_aceitar` da Cadeia Staff? Hoje são duas etapas em sequência. O plano acima aceita qualquer uma das duas (o que vier primeiro cria a punição, o segundo só informa), mas o JV pode preferir só a segunda.
3. Qual canal recebe os alertas de HWID diferente: o `Config.channels.log` (log admin) ou um canal novo?
4. Pode corrigir o bug do `processingLock` (§3) nesta mesma entrega?

Até ter as respostas, usar como placeholder: `jail = "/prender {id} {tempo} {motivo}"`, `ban = "/ban {id} {tempo} {motivo}"`, `kick = "/kick {id} {motivo}"`, marcados com `-- CONFIGURÁVEL` e `// CONFIGURÁVEL`.

---

## 10. Regras do projeto
- Textos de interface, comentários e logs em **português do Brasil**, no mesmo tom do código atual (comentários curtos que explicam o *porquê*).
- Nenhum segredo no código. Tudo vem do `.env`.
- Nada aplicado sem clique humano no jogo; modo teste ligado por padrão.
- Nenhuma falha da ponte pode derrubar ou alterar o fluxo atual de denúncias.
- Automação de conta pode violar as regras do servidor. Por isso tudo fica auditado e com confirmação manual.
