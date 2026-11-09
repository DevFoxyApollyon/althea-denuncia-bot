// README.md

```
 █████╗ ██╗     ████████╗██╗  ██╗███████╗ █████╗ 
██╔══██╗██║     ╚══██╔══╝██║  ██║██╔════╝██╔══██╗
███████║██║        ██║   ███████║█████╗  ███████║
██╔══██║██║        ██║   ██╔══██║██╔══╝  ██╔══██║
██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║
╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

# 🦊 ALTHEA – Bot de Denúncias para Discord

**ALTHEA é** um bot completo de **gerenciamento de denúncias, moderação e controle de staff** para servidores Discord.

Desenvolvido em **Node.js + discord.js v14.27**, com **MongoDB, painéis interativos, botões, modais, logs centralizados, ranking de staff, exportação de denúncias e configuração dinâmica por servidor.**

Projeto criado para **uso real em produção**, com foco em **estabilidade, organização, segurança e transparência.**

| Versão | Stack | Tecnologias |
|--------|-------|-------------|
| **v3.12.0** | **Node.js** (>= 18) | **discord.js v14**, **MongoDB**, **Mongoose**, **release** |

---

## ✨ Principais Funcionalidades

### 📌 Sistema de Denúncias
- Criação de denúncias via **modal**
- Separação por plataforma: 
  - 🖥️ PC
  - 📱 Mobile
- Organização automática em **tópicos (threads)**
- Status da denúncia:
  - 📝 Reivindicada
  - 🔎 Em análise
  - ✅ Aceita
  - ❌ Recusada
- Finalização automática após prazo configurado
- Arquivamento de histórico completo com exportação em HTML/ZIP

---

### 🔒 Tópicos Restritos e Controle de Acesso
- Bloqueio de mensagens fora do escopo do denunciante e dos acusados
- Proteção contra participação indevida em tópicos de denúncia
- Registro e validação de autorização por usuário e thread

---

### 🧩 Sincronização de Nickname e Perfil
- Atualização automática de nickname do usuário no MongoDB
- Restauração automática do nickname ao entrar no servidor
- Extração e persistência da conta associada ao apelido

---

### 🛡️ Monitoramento Automático
- Detecção de links proibidos
- Detecção de mensagens encaminhadas
- Bloqueio de emojis figurinha/gif em contexto indevido
- Verificação de marcação de admin e conteúdo sensível

---

### 🔘 Botões Interativos
Disponíveis tanto no painel de denúncias quanto dentro do tópico:

- 🖥️ Denúncia PC  
- 📱 Denúncia Mobile  
- 📂 Minhas Denúncias  
- 🛠️ Correção  
- 📝 Reivindicar  
- 🔎 Analisar  
- ✅ Aceitar (abre modal de punição)  
- ❌ Recusar  
- ✅ Finalizar (exportar e fechar tópico)

---

### 📂 Minhas Denúncias
- Usuário pode visualizar todas as denúncias que criou
- Exibe:
  - status atual
  - links diretos para os tópicos
- Reduz tickets e aumenta transparência

---

### 🛠️ Correção de Denúncias
- Disponível:
  - pelo botão **Correção** no `!denuncia`
  - pelo comando `!correcao`
- Permite:
  - corrigir status
  - corrigir logs
  - ajustar erro humano
- **Não cria nova denúncia**
- Evita duplicidade e retrabalho

---

### 🧩 Painel de Configuração do Servidor
- Comando `!painel`
- Permite configurar diretamente pelo Discord:
  - cargos administrativos
  - cargos responsáveis
  - canais de denúncia (PC / Mobile)
  - canais de logs
  - canal de análise
- Dados persistidos no MongoDB
- **Obrigatório antes de usar o sistema**

---

### 📊 Ranking de Staff
Baseado em ações reais registradas no banco:

- `!rank` → ranking principal
- Usa a collection `ModerationAction`
- Pode rodar automaticamente via `jobs/rankJobs.js`

---

### 📦 Finalizar Denúncia (Exportação)
- Botão **Finalizar**
- Exporta todo o histórico do tópico:
  - mensagens
  - autores
  - timestamps
  - anexos (quando possível)
- Gera:
  - HTML
  - ZIP 
- Envia o arquivo no Discord
- **Tranca e arquiva o tópico automaticamente**
- Encerra oficialmente a denúncia
- Também pode ocorrer automaticamente por cronologia, pela rotina de finalização do ALTHEA

---

### 🤖 Automação da Rotina de Finalização
- Verificação periódica de denúncias pendentes
- Finalização automática de registros antigos
- Encerramento seguro com logs de acompanhamento
- Tratamento de timeouts e falhas por ciclo

---

### 🛡️ Robustez e Segurança
Tratamento completo de erros comuns do Discord:

- `Unknown interaction (10062)`
- `InteractionNotReplied`
- DM bloqueada (`50007`)
- Timeouts e erros 5xx
- Proteção contra cliques duplicados
- Logs centralizados

---

## ⌨️ Comandos

Os comandos de barra são registrados automaticamente em cada servidor quando o bot inicia.
Os comandos com `!` continuam funcionando.

| Barra | Prefixo | Quem pode usar | O que faz |
|-------|---------|----------------|-----------|
| `/painel` | `!painel` | Administrador do servidor ou Responsável Admin | Abre o painel de configuração |
| `/denuncia` | `!denuncia` | Responsável Admin | Publica/atualiza a mensagem de abertura de denúncias |
| `/rank [periodo]` | `!rank [mensal\|semanal\|hoje]` | Administrador e Responsável Admin | Ranking de atendimento da staff |
| `/status` | `!status` | Administrador do servidor | Diagnóstico do bot |
| `/ponte gamemode criar\|listar\|revogar\|renovar` | — | Dono do bot (`OWNER_DISCORD_ID`) | Credenciais da gamemode (o segredo sai uma vez, em anexo) |
| `/ponte gamemode pausar\|retomar\|limites` | — | Responsável Admin | Modo gamemode do servidor |
| `/ponte motivos` | — | Responsável Admin | Tabela de motivos de punição (vale para todos os servidores) |
| `/tempban` | — | Responsável Admin e dono do bot | Punição direto ao jogo (com o link de uma denúncia aceita, corrige a dela) |
| `/desbanir` | — | Responsável Admin e dono do bot | Desfaz pelo jogo: desbanir, tirar da cadeia e tirar avisos (pelo link ou pelo ID da conta) |
| `/provastaff` | — | Responsável Admin | Painel de provas da staff no canal fixo |
| `/link` | — | Staff | Link da mensagem principal a partir do link de um tópico |
| `/ativar` | — | Gerenciar Servidor | Ativa a ponte com o jogo (código do dono) |
| `/ponte-codigo gerar` | — | Dono do bot | Gera código de ativação da ponte |

Com a **senha da Cadeia Staff** ligada (Painel do bot), Aceitar e Recusar da Cadeia Staff, o `/tempban`
e o `/desbanir` pedem a senha (vale 30 minutos).

---

## 🎮 Ponte com a gamemode

A gamemode do servidor aplica as punições aceitas no Discord (o PC da staff com o mod Lua
saiu da ponte). Ela **busca** os pedidos no Althea (`/ponte/gm/v1`, HMAC na query) e
devolve o resultado; o Althea nunca chama o servidor do jogo.

- **Especificação do protocolo:** [`doc/PONTE_GAMEMODE.md`](doc/PONTE_GAMEMODE.md).
- **Include Pawn:** fica fora deste repositório (é dos devs do servidor). A versão 1.0.0 está na tag [`v3.12.0`](https://github.com/DevFoxyApollyon/althea-denuncia-bot/tree/v3.12.0/gamemode); os testes usam só a cópia dos vetores em `test/fixtures/vetores_protocolo_gm.json`.
- **Guia para os devs do servidor (servidor de teste):** [`doc/GUIA_SERVIDOR_TESTE.md`](doc/GUIA_SERVIDOR_TESTE.md).
- **No `.env`:** `PONTE_CHAVE_MESTRA` (base64 de 32 bytes) cifra os segredos. Sem ela, a API responde 503.
- **Fluxo:** aceite da denúncia → embed "🎮 Punição para o jogo" no Relatório de punições → um
  responsável clica em **Enviar ao jogo** → a gamemode busca, aplica e responde → o embed mostra
  o resultado de cada alvo. Sem resposta, o pedido vira **incerto** e vai para o Log Admin, onde
  um responsável decide ("foi aplicada" ou "reenviar"): nada é reenviado sozinho.
- O modo teste vem ligado: a gamemode só simula até ser desligado em `/ponte gamemode limites`.
- Ao iniciar, o bot apaga o que sobrou do PC da staff no banco (PCs, tokens e auditoria do PC)
  e passa as punições que estavam na fila do PC para a gamemode (`services/ponteSamp/limpezaPc.js`).
- **Painel do dono (`/admin`):** status ao vivo (com a lista do que está esperando envio), controle de
  cada servidor (modo teste, pausa, limites e trava por IP), credenciais, pedidos, auditoria, códigos,
  acessos e **Bloqueados** (quem está ali não usa botões, comandos nem o site do bot). Quem banir ou
  expulsar o dono do bot de um servidor é bloqueado sozinho.
- **Include da gamemode:** a versão atual é a 1.0.1 (traz a consulta do `/desbanir` pelo ID); o pacote
  vai à parte para os devs do servidor.

---

## 🧪 Desenvolvimento

```bash
npm run lint   # ESLint
npm test       # testes (node:test) — não acessam o banco nem o Discord
```

### Bancos e retenção

O banco principal (`MONGODB_URI`) guarda o que é do bot: denúncias, ações da
staff e configurações. O secundário (`SECONDARY_DB_URI`) guarda o site, as
mensagens das denúncias, a nota da staff, os strikes, o vínculo entre Discord e
ID do jogo, as notificações, as sugestões e a ponte com o jogo. Cada coleção
tem o seu prazo em `utils/retencaoDados.js`.

---

## 🧠 Tecnologias Utilizadas

- Node.js 18+
- discord.js v14
- MongoDB + Mongoose
- PM2 (opcional)
- SquareCloud
- Git / GitHub

## ⚠️ Aviso de Segurança (npm audit)

Este projeto utiliza discord.js v14.

Na versão 3.12.0, `npm audit fix` (sem `--force`) atualizou `body-parser` e `undici` e o
`npm audit` passou a mostrar 0 vulnerabilidades.

Nunca use `npm audit fix --force`: ele faria downgrade do discord.js e quebraria o projeto.

## 🗺️ Roadmap
- [ ] Internacionalização (EN)
- [ ] Melhorias visuais no painel
- [ ] Métricas avançadas
- [ ] Cache inteligente de queries

---

## 📂 Estrutura do Projeto

```bash
.
├── commands/
│   ├── denuncia.js
│   ├── painel.js
│   ├── correcao.js
│   ├── status.js
│   └── rank.js
│
├── doc/
│   ├── BUTTONS.md
│   ├── DB_MODELS.md
│   └── FLOW.md
│
├── Handlers/
│   ├── exportDenuncia.js
│   ├── handlerStatusButton.js
│   ├── interactionHandler.js
│   ├── leiaAvisoHandler.js
│   ├── LogManager.js
│   ├── messageDeleteHandler.js
│   └── messageReactionHandler.js
│
├── jobs/
│   └── rankJobs.js
│
├── models/
│   ├── Config.js
│   ├── Denuncia.js
│   └── ModerationAction.js
│
├── services/
│   └── rankService.js
│
├── utils/
│   ├── logger.js
│   ├── dateUtils.js
│   ├── advancedMonitoring.js
│   └── smartCache.js
│
├── index.js
├── package.json
├── .env.example
├── CHANGELOG.md
└── README.md
```

---

## 📝 Licença

MIT License

---

**Desenvolvido por:** DevFoxyApollyon  
**Repositório:** https://github.com/DevFoxyApollyon/althea-denuncia-bot
