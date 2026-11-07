# Ponte Discord ⇄ SA-MP: plano v2 (executor pela gamemode)

> Briefing para o Claude Code. **Leia inteiro antes de mexer no código.**
> O plano v1 (PC da staff + mod Lua) já foi implementado e continua valendo. Ele está guardado em `doc/PONTE_SAMP_PLANO_v1.md`.
> A especificação do protocolo está em `doc/PONTE_GAMEMODE.md`. Ela é a fonte da verdade do formato: não invente campo, nome nem regra que não esteja lá.

---

## 0. O que mudou

O chefe aprovou a integração **direta com a gamemode**: os devs do servidor colocam um include na gamemode, e ela **busca** no Althea as punições aprovadas e as aplica sozinha. Nenhum PC precisa estar ligado.

- O caminho atual (PC + `ponte_denuncias.lua`) **não sai**. Ele vira um dos "executores" possíveis por guild.
- O lado do **jogo já está pronto e testado** na pasta `gamemode/`:
  - include Pawn com SHA-256/HMAC próprio;
  - exemplo com MySQL;
  - vetores de teste.
  
  **Não edite nada em `gamemode/` sem pedir.** Se o bot precisar de algo diferente, a mudança é no bot.
- **Falta o lado do bot**, descrito abaixo.

---

## 1. Estado atual do Althea (já existe, reaproveitar)

| peça | onde |
|---|---|
| Fila por denúncia (`PontePunicao`, banco secundário, 45 dias) com `alvos[]`, `resultado[]`, `versao`, `status: aceita/executando/aplicada/cancelada` | `models/PontePunicao.js` |
| Aceite cria a punição (upsert por `denunciaId`) e classifica cmd/tempo/avisos pela tabela de motivos | `services/ponteSamp/aceite.js` (`registrarAceite`, `montarAlvos`) |
| Tabela de motivos global, `motivoComSufixo` (`[DC]`), `limparMotivo`, `validarAlvos` | `services/ponteSamp/validacao.js`, `motivos.js`, `constantes.js` |
| Guild ativa, códigos, instalações de PC (`PonteServidor`, `PonteCodigo`, `PonteInstalacao`) | `models/`, `services/ponteSamp/gestao.js` |
| API dos PCs em `/ponte/api` (antes da checagem de Origin) | `site/ponte/apiJogo.js` |
| Painel do dono `/admin` (OAuth + `OWNER_DISCORD_ID` + CSRF) | `site/ponte/admin.js`, `site/ponte/painel/` |
| Avisos: aplicadas / organização / nick não encontrado / já banido / sem resposta | `services/ponteSamp/avisoOrganizacao.js` |
| Aviso de punição parada na fila | `services/ponteSamp/paradas.js` (job) |
| Auditoria `PonteUso` (90 dias) | `models/PonteUso.js` |
| Testes com `mongodb-memory-server` | `test/ponte.test.js`, `test/helpers/mongoMemoria.js` |

Comandos de punição reais do Brasil RP (via PC): `/tempban {id} {dias} {motivo}` (0 = permanente), `/agendacadeia {id} {min} {motivo}`, `/agendaaviso` e `/blackban {nick}`. Na gamemode, isso vira os tipos `ban`, `cadeia`, `desbanir` e `soltar` do protocolo. **Os comandos de chat não são usados no modo gamemode.**

---

## 2. Decisões (não perguntar de novo)

| tema | decisão |
|---|---|
| Quem aplica | Por guild: `PonteServidor.executor` = `pc` (padrão, como hoje), `gamemode` ou `ambos` |
| Coexistência | Os dois executores competem pelo mesmo `status`: só sai de `aceita` uma vez. Em `gamemode`, `POST /ponte/api/fila/:id/executar` responde 409 com "Este servidor aplica pela gamemode" |
| Confirmação humana | Em `gamemode` e `ambos`, o pedido só nasce depois de um responsável (`roles.responsavel_admin`) clicar em **Enviar ao jogo** no Discord |
| Dupla confirmação | Ban permanente, ou ban maior ou igual a `gm.duplaAPartirDias` (padrão 15): dois responsáveis **diferentes** |
| Credenciais da gamemode | Só o **dono** cria, revoga e renova (`/ponte gamemode criar|revogar|renovar`). O responsável pode pausar, retomar e trocar o executor |
| Segredo | 32 bytes aleatórios em hex (64 letras), cifrado com AES-256-GCM e a chave `PONTE_CHAVE_MESTRA` (base64 de 32 bytes, no `.env`). Mostrado **uma vez**, como anexo efêmero `althea_credenciais.txt` |
| Reenvio | `devolvida` volta para a fila sozinha. `incerto` **nunca** volta sozinho: só pelo botão de um responsável |
| Acúmulo de ban | No modo gamemode, o bot **não soma**: manda `somar: true` em todo `ban` e a gamemode soma ao ban atual. `bansAnteriores` continua só para o PC |
| Banco | Coleções novas no **secundário** (como o resto da ponte) |
| Testes | `node --test`, com os vetores de `gamemode/teste/vetores_protocolo.json` **obrigatórios** |

---

## 3. O que construir no bot

### 3.1 Configuração e segredo
- `.env.example` e `utils/env.js` (opcional, com aviso): `PONTE_CHAVE_MESTRA`. Sem ela, a API gm responde 503 e `/ponte gamemode criar` explica o que falta.
- `services/ponteSamp/cifra.js`:
  - `cifrar(texto)` devolve `{ iv, tag, dados }` em base64, com AES-256-GCM e IV aleatório de 12 bytes;
  - `decifrar(obj)` faz o caminho inverso;
  - teste de ida e volta, e de adulteração (deve falhar).
- `services/ponteSamp/protocoloGm.js`: **já está pronto**, conferido com os vetores. Use-o como está:
  - `assinaturaConfere(segredo, { metodo, caminho, ts, nonce, corpo }, sig)`;
  - `selarPedido`;
  - `motivoParaGamemode(motivoComSufixo(alvo.motivo))`, nesta ordem, para manter o `[DC]`;
  - `nomeParaGamemode`.

### 3.2 Models (banco secundário; registrar em `utils/retencaoDados.js`)
- **`PonteConexaoGm`** (`ponteconexoesgm`, **permanente**):
  - `guildId`, `nome`, `segredoCifrado {iv, tag, dados}`, `ultimos4`;
  - `ipsPermitidos [String]` (vazio = qualquer IP, com aviso no painel);
  - `status` (`ativa`, `revogada`), `pausada`, `criadoPor`, `criadoEm`;
  - `ultimoContatoEm`, `ultimoIp`, `versaoInclude`, `modoTesteInformado`;
  - `revogadoEm/Por`.
  - Índice `{guildId:1, status:1}`.
- **`PontePedidoGm`** (`pontepedidosgm`, 90 dias em `PRAZOS_EM_DIAS`), um por alvo enviado:
  - `punicaoId`, `alvoId`, `denunciaId`, `guildId`, `conexaoId`;
  - `tipo`, `conta` (Number), `nick`, `tempo`, `avisos`, `somar`, `motivo`, `aprovadoPor`, `teste`;
  - `confirmadoPor [{id, nome, em}]`;
  - `status`: `aguardando_dupla` | `aprovado` | `entregue` | `aplicada` | `simulada` | `recusada` | `erro` | `incerto` | `cancelado`;
  - `codigo`, `emitidoEm` (unix s), `entregueEm`, `leaseAte`, `entregas` (Number), `devolucoes` (Number);
  - `resultado {nome, organizacao, conta}`, `resolvidoPor {id, nome, em}` (para incertos), `criadoEm`.
  - Índices:
    - **único** `{punicaoId:1, alvoId:1, rodada:1}`, com `rodada` (Number) incrementado a cada "reenviar";
    - `{guildId:1, status:1, criadoEm:1}`;
    - `{status:1, leaseAte:1}`.
- **`PonteServidor`** ganha:
  - `executor` (enum `pc` | `gamemode` | `ambos`, padrão `pc`);
  - `gm: { pausado, maxBanDias (30), permitirPermanente (false), maxCadeiaMin (300), maxAvisos (3), duplaAPartirDias (15), modoTeste (true) }`.
- **`PonteUso.acao`** ganha: `gm_busca`, `gm_resultado`, `gm_auth_falhou`, `gm_selo_invalido`, `gm_enviar`, `gm_confirmar`, `gm_cancelar`, `gm_incerto_ok`, `gm_incerto_reenviar`, `gm_credencial`.

### 3.3 API da gamemode: `site/ponte/apiGamemode.js`, montada em `/ponte/gm/v1`
- Em `site/servidor.js`, montar **junto de `/ponte/api`, antes da checagem de Origin**.
- `express.raw({ type: () => true, limit: '4kb' })`: a assinatura é conferida sobre os **bytes exatos**. O JSON é parseado **depois** da autenticação.
- Middleware de autenticação, na ordem:
  1. ponte ligada;
  2. chave mestra presente;
  3. query `id` (24 hex), `ts` (inteiro), `nonce` (32 hex) e `sig` (64 hex);
  4. conexão ativa;
  5. guild ativa e `executor` diferente de `pc`;
  6. IP permitido (`ipDoCliente`);
  7. `|agora − ts| ≤ 60`;
  8. nonce não visto (memória por conexão, 10 min, no máximo 20 mil itens);
  9. HMAC com `assinaturaConfere`, usando `req.path` **sem a query** e o mesmo prefixo que o include usa (`/ponte/gm/v1/...`; confira `req.baseUrl + req.path`).
  
  Os erros saem com `codigo`, conforme a tabela da seção 3 da especificação. Toda falha é auditada, com limite e bloqueio por IP.
- `GET /pedidos`:
  - responde `pausado` (`servidor.gm.pausado || conexao.pausada`);
  - entrega em laço de `findOneAndUpdate({ guildId, status: 'aprovado' }, { $set: { status: 'entregue', conexaoId, entregueEm, leaseAte: +120 s, emitidoEm: agora }, $inc: { entregas: 1 } }, { sort: { criadoEm: 1 }, new: true })` até o `limite` (1 a 20);
  - sela cada pedido com o segredo decifrado;
  - atualiza o contato da conexão.
- `POST /resultados/:id`:
  - aplica a tabela da seção 6 da especificação, com transição condicional (`status ∈ {entregue, incerto}` e `conexaoId` igual);
  - repetição idêntica de um resultado já final responde 200; resultado final diferente responde 409.
  - `aplicada`:
    - grava em `PontePunicao.resultado` um item no formato atual: `alvoId`, `comando: "gamemode: ban 5d +1 aviso"`, `ok: true`, `nome`, `organizacao`, `contaId`, `pc: "gamemode:<nome>"`, `em`;
    - assim o histórico, o relatório e o `avisarAplicadas` continuam funcionando sem mudança.
  - Quando todos os pedidos da rodada estiverem finais, a punição vai para `aplicada` (pelo menos um aplicado) ou volta para `aceita` (nenhum aplicado). Depois, `atualizarMensagensDiscord`.
  - `devolvida` volta para `aprovado` (`devolucoes +1`); passando de 5, vira `erro` com alerta.
  - `SELO_INVALIDO`: pausa a conexão, manda DM ao dono e avisa no canal de alertas.

### 3.4 Discord (modo `gamemode` / `ambos`)
- Depois do `registrarAceite` (sem mudar o fluxo atual), posta, **em resposta à mensagem da Cadeia Staff**, um embed **"🎮 Punição para o jogo"**:
  - alvos com tipo, tempo, avisos e motivo (já no formato da gamemode);
  - botões `ponte_gm_enviar:<punicaoId>`, `ponte_gm_editar:<punicaoId>` e `ponte_gm_cancelar:<punicaoId>`, registrados no `ROTAS.botao.prefixos` do `interactionHandler`.
- **Editar:** um select do alvo abre um modal (tipo, tempo, avisos, motivo). Reaproveita `validarAlvos` e a trava por `versao`. Alvo sem regra (motivo fora da tabela) **bloqueia o envio** até ser editado, como o automático já faz hoje.
- **Enviar:**
  - só `responsavel_admin`;
  - valida os limites `gm.*`;
  - cria os `PontePedidoGm`: em `aprovado`, ou em `aguardando_dupla` quando precisa de segunda confirmação. Neste caso aparece o botão **"Confirmar (2ª pessoa)"**, que recusa a mesma pessoa;
  - a punição passa de `aceita` para `executando` (com `executandoPor: null` e um campo novo `executor: 'gamemode'`);
  - o embed passa a mostrar "📤 Enviado por X, aguardando a gamemode".
  - Liberar execuções presas, no modo gamemode, **não** vale para punições com pedidos `entregue` ou `incerto`.
- **Resultados:** o embed é editado com o status de cada alvo (✅ aplicada, 🧪 simulada, ❌ recusada (código), ⚠️ incerto).
- **Incerto:** o job a cada 30 s (no mesmo `setInterval` de `paradas.js`, ou um novo `jobs/ponteGamemode.js`) posta no Log Admin `ponte_gm_incerto_ok:<pedidoId>` e `ponte_gm_incerto_reenviar:<pedidoId>`. Reenviar cria um pedido novo (`rodada +1`) em `aprovado` e registra quem confirmou.
- **Comandos:**
  - `/ponte gamemode criar nome: ips:` (só o dono; anexo efêmero com as credenciais);
  - `listar`, `revogar id:`, `renovar id:` (só o dono);
  - `pausar`, `retomar`, `executor tipo:` e `limites` (modal com os `gm.*`), para o responsável.

### 3.5 Painel do dono (`/admin`)
- Aba **Gamemode**, com as conexões:
  - guild, nome, status, pausada;
  - online se `ultimoContatoEm` tiver menos de 30 s;
  - IP, versão do include, modo teste informado;
  - IPs permitidos, `…ultimos4`;
  - botões revogar e pausar.
- Também mostra os pedidos recentes (filtro por status) e a auditoria `gm_*`.

### 3.6 Testes obrigatórios (`test/ponteGamemode.test.js`)
1. Os vetores de `gamemode/teste/vetores_protocolo.json` (requisições e selos) batem com o `protocoloGm.js` e com a rota real (assinando uma requisição com os dados do vetor).
2. Autenticação: sem `sig` → 401; `ts` ±61 s → `RELOGIO`; nonce repetido → `NONCE`; corpo alterado em um byte → `ASSINATURA`; IP fora da lista → 403; conexão revogada → 403; `executor: 'pc'` → 403.
3. Isolamento: a conexão da guild A nunca recebe pedido da guild B, nem consegue gravar resultado nele (404).
4. Entrega atômica: duas buscas em `Promise.all` recebem conjuntos **disjuntos**, e a soma é igual ao total.
5. Idempotência do resultado: a mesma resposta duas vezes → 200 e 200; resposta diferente → 409.
6. `devolvida` volta para `aprovado` (até 5 vezes); `TIMEOUT_GAMEMODE` e lease vencido viram `incerto` e **não** voltam sozinhos.
7. A dupla confirmação recusa a mesma pessoa.
8. Em `executor: 'gamemode'`, `POST /ponte/api/fila/:id/executar` → 409.
9. `motivoParaGamemode(motivoComSufixo(...))` sempre passa na mesma regra do `Alt_MotivoValido` do Pawn (copiar a regex da especificação).

### 3.7 Documentação e entrega
- `README.md`: seção "Ponte com a gamemode", apontando para `doc/PONTE_GAMEMODE.md` e `gamemode/LEIA-ME.md`.
- `CHANGELOG.md` e versão do `package.json` (minor).
- `scripts/pacote-squarecloud.js`: acrescentar `'gamemode/**'` em `FORA_DO_ZIP` (o Pawn não vai para a hospedagem).
- `doc/DB_MODELS.md` e `doc/BUTTONS.md` com os itens novos.

---

## 4. Etapas (parar ao fim de cada uma; `npm test` e `npm run lint` verdes)
1. `cifra.js`, `PONTE_CHAVE_MESTRA`, models, retenção e o teste dos vetores.
2. API `/ponte/gm/v1` com autenticação, `GET /pedidos` e `POST /resultados`, mais os testes 2 a 6.
3. Discord: embed, editar, enviar, dupla confirmação, cancelar, resultados no embed e o bloqueio do PC em `executor: gamemode`.
4. Job de incerto + botões; alertas de selo e de falhas de autenticação.
5. Comandos `/ponte gamemode …`.
6. Painel do dono.
7. Documentação, pacote e versão.

---

## 5. Perguntas em aberto (fazer ao JV antes da etapa 3)
1. Quais IPs o servidor do jogo usa para sair para a internet? Eles vão em `ipsPermitidos`; vazio é aceito, mas com aviso no painel.
2. Ban permanente pelo bot vai ser liberado (`permitirPermanente`) ou continua só pelo PC e no jogo?
3. O valor `duplaAPartirDias = 15` serve?
4. O embed "🎮 Punição para o jogo" vai na Cadeia Staff (em resposta à mensagem do aceite) ou num canal próprio?

---

## 6. Regras do projeto (iguais às de antes)
- Textos, comentários e logs em português do Brasil, no estilo do código atual.
- Nada de segredo no código nem em log. O segredo da gamemode nunca aparece depois da criação, nem no `/admin`.
- Nenhuma falha da ponte pode quebrar o aceite normal das denúncias.
- Nada é aplicado sem confirmação humana; modo teste ligado por padrão (`gm.modoTeste`).
- Sem commit nem deploy sem o JV pedir. **Não editar `gamemode/`.**
