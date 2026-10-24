# Althea na gamemode: guia do servidor de teste

Para o responsável pela gamemode. Este guia explica como ligar o Althea num **servidor de teste**. Depois que o teste estiver aprovado, o mesmo passo a passo vale para o servidor oficial.

**O que o Althea faz:** quando a staff aceita uma denúncia no Discord e um responsável clica em **Enviar ao jogo**, a gamemode busca a punição no Althea e a aplica com as funções que ela já tem. Em seguida ela devolve o resultado. O Althea **nunca** se conecta ao servidor do jogo: só sai HTTPS do servidor para o Althea, e nenhuma porta nova é aberta.

A especificação técnica completa está em `doc/PONTE_GAMEMODE.md`.

---

## 1. O que vem no pacote

| arquivo | para que serve |
|---|---|
| `gamemode/althea_ponte/` (3 arquivos `.inc`) | o include. Vai para a pasta de includes |
| `gamemode/exemplo/exemplo_gamemode.pwn` | exemplo completo com MySQL R41-4, com o SQL da tabela `althea_pedidos` no topo |
| `gamemode/teste/teste_cripto.pwn` | confere se o SHA-256/HMAC funciona no servidor (filterscript) |
| `gamemode/LEIA-ME.md` | mapa da pasta |
| `doc/PONTE_GAMEMODE.md` | especificação do protocolo |
| este guia | passo a passo do teste |

**O que NÃO vem no pacote:** o arquivo `althea_credenciais.txt`. Ele é a senha do servidor e é enviado à parte, pelo dono do bot (JV). Não pode ir para o código, para o git nem para grupos.

---

## 2. O que o servidor de teste precisa ter

- SA-MP 0.3.7 ou open.mp, compilando com o `pawncc` 3.10.x.
- O plugin **pawn-requests** (Southclaws) com o `requests.inc`.
- O MySQL **R41-4**, se for seguir o exemplo; outra forma de banco também serve.
- Saída HTTPS liberada para `althea-denuncias.squareweb.app`.
- **Relógio certo (NTP).** Se o relógio estiver mais de 60 s fora da hora, o Althea recusa tudo com `RELOGIO`.
- **Contas de teste:** uma comum para punir e uma de admin para conferir a proteção.

---

## 3. Instalação, passo a passo

### 3.1 Plugin e includes
1. Instale o pawn-requests: copie o plugin para `plugins/`, coloque `requests` na linha `plugins` do `server.cfg` e o `requests.inc` na pasta de includes.
2. Copie a pasta `althea_ponte/` (os 3 `.inc`) para a pasta de includes.

### 3.2 Conferir a criptografia (2 minutos)
1. Compile `gamemode/teste/teste_cripto.pwn` como filterscript.
2. No servidor, rode `loadfs teste_cripto`.
3. O console deve terminar com `---- 14 OK, 0 FALHOU`. Se aparecer qualquer `FALHOU`, pare e avise o JV.

### 3.3 Colocar na gamemode
No topo da gamemode, **nesta ordem**:

```pawn
#include <requests>

#define ALTHEA_MODO_TESTE (true)              // começa SEMPRE em teste
#define ALTHEA_MAX_BAN_DIAS (30)
#define ALTHEA_PERMITIR_BAN_PERMANENTE (true) // o bot libera ban permanente; sem isto, ele é recusado
#define ALTHEA_MAX_CADEIA_MIN (300)
#define ALTHEA_MAX_POR_HORA (30)
#define ALTHEA_DEFINIR_ONREQUESTFAILURE       // tire se a gamemode já tem OnRequestFailure
#include "althea_ponte/althea_ponte"
```

Se a gamemode **já tem** `OnRequestFailure`, tire o `#define ALTHEA_DEFINIR_ONREQUESTFAILURE` e chame `Althea_FalhaRequisicao(id);` dentro dele.

Nos callbacks:

```pawn
public OnGameModeInit()  { Althea_Iniciar();  /* ... */ }
public OnGameModeExit()  { Althea_Encerrar(); /* ... */ }
public OnRconCommand(cmd[]) { if (Althea_ComandoRcon(cmd)) return 1; /* ... */ }
```

### 3.4 Tabela de controle
Rode no banco o `CREATE TABLE althea_pedidos` que está no topo de `exemplo_gamemode.pwn`. A chave primária `pedido_id` garante que o mesmo pedido **nunca** seja aplicado duas vezes, mesmo depois de reiniciar o servidor.

### 3.5 A única função que vocês escrevem
Copie o `Althea_Aplicar()` do exemplo e troque o que está marcado com `TROQUE` pelas funções que a gamemode já tem:

| no exemplo | troque por |
|---|---|
| `SELECT ... FROM contas` | a tabela de contas real (id, nome, admin, organização) |
| `Gm_Banir(conta, dias, somar, motivo)` | o ban da gamemode. `dias = 0` é permanente. Com `somar`, se a conta já estiver banida, soma os dias ao ban atual |
| `Gm_Prender(conta, minutos, motivo)` | a cadeia |
| `Gm_DarAvisos(conta, quantidade, motivo)` | os avisos |
| `Gm_Desbanir`, `Gm_Soltar` | desbanir e tirar da cadeia |

Regras:
- **Conta de staff/admin** responde `ALTHEA_CONTA_PROTEGIDA`: o bot nunca pune staff.
- As funções precisam funcionar com o jogador **online e offline**.
- Nas strings, use sempre `%e` no `mysql_format`. Nunca use o motivo como texto de formatação.

### 3.6 Credencial
1. Peça ao JV o arquivo `althea_credenciais.txt`. Ele gera o arquivo no Discord com `/ponte gamemode criar`.
2. Salve em `scriptfiles/althea_credenciais.txt`.
3. Se puderem, passem ao JV o IP de saída do servidor de teste: com ele, a credencial só funciona a partir desse IP.

### 3.7 Ligar
Compile e suba a gamemode. No console deve aparecer:

```
[Althea] Integracao ligada (versao 1.0.0, conexao 65f0a1b2..., modo teste LIGADO).
```

Rode `rcon althea status` e confira `ligada=1 pausada=0 teste=1`. Do lado do JV, o painel do Althea passa a mostrar o servidor como **online**.

---

## 4. Roteiro de teste (junto com o JV)

Façam na ordem. Cada passo diz o que deve acontecer.

| # | o que fazer | o que deve acontecer |
|---|---|---|
| 1 | JV aceita uma denúncia contra a **conta de teste** e clica em **Enviar ao jogo** | no console: `[Althea] [TESTE] ban conta=... motivo="... [DC]" aprovado por ...`. No Discord: 🧪 simulada. **Nada é aplicado** |
| 2 | denúncia com **cadeia** (ex.: MIX) | `[TESTE] cadeia ...` |
| 3 | denúncia contra a **conta de admin** | recusada com `CONTA_PROTEGIDA` |
| 4 | denúncia com ID de conta que não existe | recusada com `CONTA_INEXISTENTE` |
| 5 | `rcon althea pausar` e enviar uma punição | nada acontece no jogo; depois de `rcon althea retomar`, ela chega |
| 6 | **aplicar de verdade:** o JV desliga o modo teste no bot (`/ponte gamemode limites`) e vocês rodam `rcon althea teste 0` | a conta de teste é banida ou presa de fato, a linha aparece em `althea_pedidos` com `OK`, e o Discord mostra ✅ aplicada |
| 7 | voltar para teste: `rcon althea teste 1` | os próximos voltam a ser só simulados |

Cada pedido tem um ID próprio, e a tabela `althea_pedidos` impede que o **mesmo** pedido seja aplicado duas vezes (`DUPLICADO`). Se a staff reenviar uma punição pelo Discord, nasce um pedido novo, que é aplicado: por isso o Althea nunca reenvia sozinho, só por decisão de um responsável.

**Para passar para o servidor oficial:** repitam a instalação lá, começando de novo **em modo teste**, e soltem aos poucos: primeiro cadeia, depois ban curto, por último permanente.

---

## 5. Comandos RCON

| comando | faz |
|---|---|
| `althea status` | mostra se está ligada, pausada, em teste e os contadores |
| `althea pausar` / `althea retomar` | para e volta a buscar punições |
| `althea teste 1` / `althea teste 0` | liga e desliga o modo teste (só simula) |
| `althea recarregar` | relê o `althea_credenciais.txt` sem reiniciar (depois que o JV renovar a credencial) |

---

## 6. Problemas comuns

| no console | causa | o que fazer |
|---|---|---|
| `Arquivo de credenciais nao encontrado` | falta o arquivo | salvar em `scriptfiles/althea_credenciais.txt` |
| `Credenciais invalidas` | arquivo editado ou cortado | pedir outro ao JV, salvar e rodar `rcon althea recarregar` |
| `Falha na comunicacao (HTTP 401, RELOGIO)` | relógio do servidor errado | ligar o NTP |
| `Falha na comunicacao (HTTP 401, ASSINATURA)` | credencial antiga ou errada | pedir ao JV para conferir (pode ter sido renovada) |
| `Falha na comunicacao (HTTP 403, IP)` | IP do servidor fora da lista da credencial | passar o IP certo ao JV |
| `Falha na comunicacao (HTTP 403, GUILD_INATIVA)` | o servidor do Discord ainda aplica pelo PC | o JV roda `/ponte gamemode executor tipo: Gamemode` |
| `Falha na comunicacao (HTTP 503)` | falta a chave no Althea | avisar o JV |
| ban permanente recusado com `DADOS_INVALIDOS` | falta o `#define ALTHEA_PERMITIR_BAN_PERMANENTE (true)` | colocar o define e recompilar |
| `ALERTA: ... selo invalido. Integracao PAUSADA` | pedido adulterado ou bug | **não retomar sozinho**: avisar o JV na hora |
| `ALERTA: limite de punicoes por hora atingido` | passou de `ALTHEA_MAX_POR_HORA` | conferir no Discord e usar `rcon althea retomar` |
| `Auto-teste do SHA-256 falhou` | include alterado ou compilador diferente | rodar o `teste_cripto` (passo 3.2) e avisar o JV |

---

## 7. Regras de ouro

1. Sempre comece em **modo teste**.
2. **Nunca** coloque o `althea_credenciais.txt` no git, em print ou em grupo. Se vazar, o JV renova na hora com `/ponte gamemode renovar`.
3. Não mudem os arquivos `.inc`. Se precisar de algo diferente, peçam ao JV: a mudança é feita do lado do bot.
4. Para parar tudo na hora: `rcon althea pausar`.
