# Ponte Althea ⇄ gamemode (protocolo gm/v1)

Este documento é a especificação da integração em que **a gamemode aplica as punições** aprovadas no Discord, sem nenhum PC de staff no meio. Ele serve para os dois lados:

- **Devs da gamemode:** seções 1, 2, 7, 8 e 9, mais a pasta `gamemode/` (include pronto e exemplo).
- **Bot (Althea):** o documento inteiro, com atenção às seções 3 a 6.

---

## 1. Visão geral

```
Discord ──(aceite + confirmação do responsável)──► Althea (Square Cloud)
                                                     ▲        │
                         GET /pedidos (assinado)     │        │  pedidos com selo
                         POST /resultados (assinado) │        ▼
                                                   gamemode (pawn-requests)
                                                     │
                                                     └─► Althea_Aplicar() → funções que a gamemode já tem
```

- **A gamemode busca; o Althea nunca chama a gamemode.** Nenhuma porta nova é aberta no servidor do jogo: só sai HTTPS para o Althea.
- **O bot pede, a gamemode decide.** Ela confere o selo, os limites e a conta, e só então aplica.
- **Nada é aplicado sem um responsável confirmar no Discord.**

---

## 2. Credenciais

- São geradas **só pelo dono do bot** com `/ponte gamemode criar`. O Althea entrega, uma única vez, o arquivo `althea_credenciais.txt`:
  ```
  id=65f0a1b2c3d4e5f6a7b8c9d0
  segredo=<64 letras hexadecimais>
  ```
- O arquivo fica em `scriptfiles/althea_credenciais.txt` no servidor do jogo. **Não pode ir para o código nem para o git.**
- O `id` identifica a conexão. O `segredo` **nunca trafega**: serve só de chave do HMAC.
- No Althea, o segredo fica **cifrado** (AES-256-GCM com `PONTE_CHAVE_MESTRA`). Ele precisa ser recuperável para conferir o HMAC, por isso não é guardado como hash.
- Para trocar, use `/ponte gamemode renovar`: o segredo antigo para de valer na hora. No servidor, substitua o arquivo e rode `rcon althea recarregar`, sem reiniciar.

---

## 3. Autenticação de cada requisição

A autenticação vai na **query string**, não em cabeçalhos. No pawn-requests, cada `RequestHeaders()` fica para sempre na memória do plugin, então cabeçalhos por requisição vazariam memória a cada busca.

```
?id=<conexão>&ts=<unix segundos>&nonce=<32 hex>&sig=<64 hex>
```

```
canonico   = METODO + "\n" + CAMINHO + "\n" + ts + "\n" + nonce + "\n" + sha256hex(corpo)
assinatura = hex( HMAC-SHA256( chave = segredo (as 64 letras, como texto), mensagem = canonico ) )
```

- `CAMINHO` é só o caminho, **sem a query** (exemplo: `/ponte/gm/v1/pedidos`).
- `corpo` é o corpo **exato** recebido, byte a byte. Em GET é vazio, e `sha256("")` vale `e3b0c442…b855`.
- Todo hexadecimal é **minúsculo**.

**O Althea recusa (401, com `codigo` no JSON):**

| codigo | quando |
|---|---|
| `CREDENCIAL` | `id` inexistente ou formato inválido |
| `RELOGIO` | `ts` fora de ±60 s do relógio do Althea (o servidor do jogo precisa de NTP) |
| `NONCE` | nonce repetido para a mesma conexão nos últimos 10 minutos |
| `ASSINATURA` | HMAC não confere (comparação em tempo constante) |

**E também recusa (403):** `IP` (fora da lista da conexão), `REVOGADA`, `GUILD_INATIVA`, `PONTE_DESLIGADA`. Se `PONTE_CHAVE_MESTRA` não estiver configurada, responde 503.

**Limites de taxa:**
- 20 buscas por minuto por conexão;
- 120 resultados por minuto por conexão;
- 10 falhas de autenticação por minuto por IP; passou disso, o IP fica bloqueado por 10 minutos e o canal de alertas é avisado.

---

## 4. Endpoints

Base: `https://<SUBDOMAIN>.squareweb.app/ponte/gm/v1`. Esta API é montada **antes** da checagem de Origin do site e é separada de `/ponte/api` (a API dos PCs).

### 4.1 `GET /pedidos?limite=10&versao=1.0.0&teste=0&<auth>`

`versao` e `teste` são informativos: aparecem no painel do dono. O `limite` vai de 1 a 20 (padrão 10).

Resposta 200:

```json
{
  "ok": true,
  "agora": 1800000006,
  "pausado": false,
  "pedidos": [
    {
      "id": "65f0a1b2c3d4e5f6a7b8c9d0",
      "tipo": "ban",
      "conta": 472860,
      "nick": "",
      "tempo": 5,
      "avisos": 1,
      "somar": true,
      "motivo": "DM + RK [DC]",
      "aprovadoPor": "joao.staff",
      "emitidoEm": 1800000006,
      "teste": false,
      "selo": "fc90…"
    }
  ]
}
```

**Entrega atômica.** Cada pedido passa de `aprovado` para `entregue` com `findOneAndUpdate`, um de cada vez. Duas buscas ao mesmo tempo (dois servidores, ou uma requisição repetida) nunca recebem o mesmo pedido.
- Na entrega, o Althea grava `emitidoEm`, `leaseAte` (agora + 120 s) e `entregas +1`, e calcula o selo.
- Com `pausado: true`, a lista vem sempre vazia.
- Toda busca atualiza o `ultimoContatoEm`, o IP e a versão da conexão. Isso alimenta o online/offline no painel do dono.

### 4.2 `POST /resultados/:pedidoId?<auth>`

Corpo (JSON, até 2 KB):

```json
{"status":"aplicada","codigo":"OK","nome":"Fulano_Tal","organizacao":"Policia Militar [6]","conta":472860}
```

- O pedido precisa ser **desta conexão** e estar em `entregue` ou `incerto`. Uma resposta atrasada resolve o incerto.
- Respostas:
  - **200:** gravado. Também vale para a repetição idêntica de um resultado já gravado (idempotente).
  - **404:** pedido não existe nesta conexão.
  - **409:** pedido já tem outro resultado final.
  - Nos casos 404 e 409, o include descarta o resultado e não insiste.

---

## 5. Pedido e selo

| campo | regra |
|---|---|
| `id` | ObjectId, 24 hex minúsculos |
| `tipo` | `ban` (dias; 0 = permanente), `cadeia` (minutos), `desbanir`, `soltar` (tempo 0, avisos 0) |
| `conta` | ID fixo da conta (1 a 999999999), ou 0 quando só há o nick |
| `nick` | vazio, ou de 3 a 24 caracteres de `[A-Za-z0-9_[].$@=()]` |
| `avisos` | de 0 ao máximo da guild. É o **total** de avisos da punição (a gamemode decide como dar) |
| `somar` | só em `ban`: se a conta já está banida, soma os dias ao ban atual |
| `motivo` | de 1 a 60 caracteres ASCII de `[A-Za-z0-9 .,:;!?()[]-_+#*@&/]`, sem `/` nem espaço no começo, terminando em ` [DC]` |
| `aprovadoPor` | de 1 a 24 caracteres de `[A-Za-z0-9_.-]` (o nome de quem confirmou no Discord, sem acento) |
| `emitidoEm` | unix (s) do momento da entrega. A gamemode recusa se tiver mais de 600 s |
| `teste` | `true` manda a gamemode só simular |

O motivo é **convertido para ASCII no bot**: tira acentos e troca qualquer outro caractere por espaço. Se a gamemode recebesse UTF-8 e usasse CP1252, os acentos chegariam quebrados.

```
selo = hex(HMAC-SHA256(segredo, "pedido\n" + [id, tipo, conta, nick, tempo, avisos, somar?1:0, motivo, aprovadoPor, emitidoEm, teste?1:0].join("|")))
```

Nenhum campo pode conter `|`, porque a validação do bot e a da gamemode impedem. **Selo inválido faz a gamemode pausar a integração inteira.** Isso só acontece se alguém adulterou o pedido ou se há um bug grave, então o Althea avisa o dono por DM e no canal de alertas.

---

## 6. Resultados: o que o Althea faz com cada um

| status | codigo | Althea |
|---|---|---|
| `aplicada` | `OK` | pedido aplicado; grava em `PontePunicao.resultado` (`ok: true`, `pc: "gamemode:<nome>"`) |
| `aplicada` | `DUPLICADO` | a gamemode já tinha aplicado; trata como aplicada |
| `simulada` | `SIMULADA` | nada aplicado; registra e avisa "🧪 simulado no jogo"; a punição volta a esperar confirmação |
| `recusada` | `CONTA_INEXISTENTE`, `CONTA_PROTEGIDA`, `JA_BANIDO`, `NAO_BANIDO`, `NAO_PRESO`, `RECUSADO`, `DADOS_INVALIDOS`, `EXPIRADO` | não aplicado; avisa na Cadeia Staff com o motivo; a staff corrige e reenvia se quiser |
| `recusada` | `SELO_INVALIDO` | **alerta de segurança**: DM ao dono e canal de alertas; pausa a conexão no Althea também |
| `devolvida` | `PAUSADO`, `LIMITE_HORA` | **com certeza não aplicado**: volta para `aprovado` sozinho; com mais de 5 devoluções, vira `erro` e alerta |
| `erro` | `ERRO_GAMEMODE` | não se sabe se aplicou: vira `incerto` (conferência humana) |
| `erro` | `TIMEOUT_GAMEMODE` | a gamemode não respondeu em 60 s: `incerto` |

**Incerto nunca é reenviado sozinho.** Um job a cada 30 s marca como `incerto` todo `entregue` com `leaseAte` vencido. Em seguida, posta no Log Admin dois botões, que só um responsável pode usar e que ficam auditados:
- "✅ Foi aplicada";
- "🔁 Não foi aplicada, reenviar".

---

## 7. Validações e limites (os dois lados)

| regra | bot (antes de criar o pedido) | gamemode (antes de aplicar) |
|---|---|---|
| tipos permitidos | `ban`, `cadeia`, `desbanir`, `soltar` | igual (`ALTHEA_TIPO`) |
| ban máximo | `maxBanDias` da guild (padrão 30) | `ALTHEA_MAX_BAN_DIAS` |
| ban permanente | só com `permitirPermanente` (padrão: liberado) | só com `ALTHEA_PERMITIR_BAN_PERMANENTE` |
| cadeia máxima | `maxCadeiaMin` (padrão 300) | `ALTHEA_MAX_CADEIA_MIN` |
| avisos | `maxAvisos` (padrão 3) | `ALTHEA_MAX_AVISOS` |
| volume | — | `ALTHEA_MAX_POR_HORA` (passou: pausa e devolve) |
| staff/admin | — | `CONTA_PROTEGIDA` (consulta da gamemode) |
| duplicidade | `{punicaoId, alvoId, rodada}` único em `pontepedidosgm` (reenviar = rodada nova, pedido novo) | memória de 128 pedidos + tabela `althea_pedidos` com chave primária |
| validade | — | `emitidoEm` de até 600 s |
| modo teste | `teste: true` enquanto o `gm.modoTeste` da guild estiver ligado (padrão) | `ALTHEA_MODO_TESTE` / `rcon althea teste 1` |

**Confirmação no Discord:** basta **um** responsável (`responsavel_admin`) clicar em "Enviar ao jogo", inclusive para ban permanente. A dupla confirmação do plano original foi retirada a pedido do JV.

---

## 8. Instalação na gamemode

1. Instalar o plugin **pawn-requests** (Southclaws) e o include `requests.inc`.
2. Copiar a pasta `gamemode/althea_ponte/` (com os 3 arquivos `.inc`) para a pasta de includes.
3. Seguir o `gamemode/exemplo/exemplo_gamemode.pwn`:
   - `#include <requests>` e, depois, `#include "althea_ponte/althea_ponte"`;
   - `Althea_Iniciar()` no `OnGameModeInit` e `Althea_Encerrar()` no `OnGameModeExit`;
   - `if (Althea_ComandoRcon(cmd)) return 1;` no `OnRconCommand`;
   - se a gamemode já tem `OnRequestFailure`, chamar `Althea_FalhaRequisicao(id)` dentro dele; se não tem, definir `ALTHEA_DEFINIR_ONREQUESTFAILURE`;
   - escrever `Althea_Aplicar()` com as funções da gamemode (o exemplo mostra o caminho assíncrono com MySQL R41-4, `INSERT IGNORE` para não aplicar duas vezes e `%e` em todas as strings).
4. Criar a tabela `althea_pedidos` (SQL no topo do exemplo).
5. Colocar `scriptfiles/althea_credenciais.txt`.
6. Subir **em modo teste** e conferir o console por alguns dias.
7. Desligar o modo teste aos poucos: primeiro cadeia, depois ban curto, por último permanente.

**Comandos RCON:** `althea status`, `althea pausar`, `althea retomar`, `althea teste 1`, `althea teste 0` e `althea recarregar`.

**Desempenho:**
- um timer de 2 s faz só comparações;
- busca a cada 10 s com a fila vazia e a cada 2 s logo depois de receber pedidos;
- cada HMAC custa cerca de 0,13 ms no interpretador sem JIT, ou seja, menos de 1 ms por busca;
- nenhum array grande na pilha e nenhum `RequestHeaders` por requisição.

---

## 9. Testes já feitos (include)

- `gamemode/teste/teste_cripto.pwn`: 14 vetores (FIPS 180-2, RFC 4231 e bordas de bloco) passam.
- `gamemode/teste/vetores_protocolo.json`: assinaturas e selos gerados pela referência em Node e conferidos pelo Pawn. **O bot precisa reproduzir os mesmos valores** (teste obrigatório no Althea).
- Simulação de ponta a ponta do include, com natives de mentira (format, arquivo, pawn-requests e JSON): 35 requisições conferidas contra a referência em Node, cobrindo:
  - assinatura, nonce único e relógio;
  - repetição devolvendo a mesma resposta;
  - expirado e dados inválidos (tempo acima do limite, `%` no motivo, permanente proibido);
  - conta protegida, conclusão assíncrona e timeout seguido de resposta atrasada;
  - selo adulterado pausando e devolvendo o resto do lote;
  - limite por hora;
  - modo teste local e o vindo do Althea;
  - backoff depois de 500 e de 401;
  - busca sem resposta e resposta atrasada ignorada;
  - pausa vinda do Althea e `OnRequestFailure`;
  - nenhum nó JSON vazado.
- Compilado com o `pawncc` 3.10.10 com `-E -;+ -(+` (avisos viram erro), sem nenhum aviso, contra o `a_samp`, o `requests.inc` e o `a_mysql.inc` (R41-4) originais.

---

## 10. Referência do protocolo em Node

`services/ponteSamp/protocoloGm.js`:

```js
const crypto = require('node:crypto');
const sha256 = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const hmac = (segredo, t) => crypto.createHmac('sha256', Buffer.from(String(segredo), 'utf8')).update(String(t), 'utf8').digest('hex');
const canonicoRequisicao = ({ metodo, caminho, ts, nonce, corpo = '' }) => `${metodo}\n${caminho}\n${ts}\n${nonce}\n${sha256(corpo)}`;
const canonicoPedido = (p) => 'pedido\n' + [p.id, p.tipo, p.conta, p.nick, p.tempo, p.avisos, p.somar ? 1 : 0, p.motivo, p.aprovadoPor, p.emitidoEm, p.teste ? 1 : 0].join('|');
```
