// README.md
# ðŸ¤– ALTHEA â€” Bot de DenÃºncias para Discord

**ALTHEA** Ã© um bot completo de **gerenciamento de denÃºncias, moderaÃ§Ã£o e controle de staff** para servidores Discord.  
Desenvolvido em **Node.js + discord.js v14.25**, com **MongoDB**, **painÃ©is interativos**, **botÃµes**, **modais**, **logs centralizados**, **ranking de staff**, **exportaÃ§Ã£o de denÃºncias** e **configuraÃ§Ã£o dinÃ¢mica por servidor**.

Projeto criado para **uso real em produÃ§Ã£o**, com foco em **estabilidade**, **organizaÃ§Ã£o**, **seguranÃ§a** e **transparÃªncia**.


![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![discord.js](https://img.shields.io/badge/discord.js-v14-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-green)
![Release](https://img.shields.io/github/v/release/DevFoxyApollyon/althea-denuncia-bot)

---

## ðŸ§  Identidade do Projeto

```text
 â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ•—     â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•—  â–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•— 
â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â•â•â•â•šâ•â•â–ˆâ–ˆâ•”â•â•â•â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•â•â•â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•—
â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—     â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—  â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•‘
â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•‘     â–ˆâ–ˆâ•”â•â•â•     â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•‘â–ˆâ–ˆâ•”â•â•â•  â–ˆâ–ˆâ•”â•â•â–ˆâ–ˆâ•‘
â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—   â–ˆâ–ˆâ•‘   â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ•—â–ˆâ–ˆâ•‘  â–ˆâ–ˆâ•‘
â•šâ•â•  â•šâ•â•â•šâ•â•â•â•â•â•â•â•šâ•â•â•â•â•â•â•   â•šâ•â•   â•šâ•â•  â•šâ•â•â•šâ•â•â•â•â•â•â•â•šâ•â•  â•šâ•â•

## âœ¨ Principais Funcionalidades

### ðŸ“Œ Sistema de DenÃºncias
- CriaÃ§Ã£o de denÃºncias via **modal**
- SeparaÃ§Ã£o por plataforma:
  - ðŸ–¥ï¸ PC
  - ðŸ“± Mobile
- OrganizaÃ§Ã£o automÃ¡tica em **tÃ³picos (threads)**
- Status da denÃºncia:
  - ðŸ“ Reivindicada
  - ðŸ”Ž Em anÃ¡lise
  - âœ… Aceita
  - âŒ Recusada

---

### ðŸ”˜ BotÃµes Interativos
DisponÃ­veis tanto no painel de denÃºncias quanto dentro do tÃ³pico:

- ðŸ–¥ï¸ DenÃºncia PC  
- ðŸ“± DenÃºncia Mobile  
- ðŸ“‚ Minhas DenÃºncias  
- ðŸ› ï¸ CorreÃ§Ã£o  
- ðŸ“ Reivindicar  
- ðŸ”Ž Analisar  
- âœ… Aceitar (abre modal de puniÃ§Ã£o)  
- âŒ Recusar  
- âœ… Finalizar (exportar e fechar tÃ³pico)

---

### ðŸ“‚ Minhas DenÃºncias
- UsuÃ¡rio pode visualizar todas as denÃºncias que criou
- Exibe:
  - status atual
  - links diretos para os tÃ³picos
- Reduz tickets e aumenta transparÃªncia

---

### ðŸ› ï¸ CorreÃ§Ã£o de DenÃºncias
- DisponÃ­vel:
  - pelo botÃ£o **CorreÃ§Ã£o** no `!denuncia`
  - pelo comando `!correcao`
- Permite:
  - corrigir status
  - corrigir logs
  - ajustar erro humano
- **NÃ£o cria nova denÃºncia**
- Evita duplicidade e retrabalho

---

### ðŸ§© Painel de ConfiguraÃ§Ã£o do Servidor
- Comando `!painel`
- Permite configurar diretamente pelo Discord:
  - cargos administrativos
  - cargos responsÃ¡veis
  - canais de denÃºncia (PC / Mobile)
  - canais de logs
  - canal de anÃ¡lise
- Dados persistidos no MongoDB
- **ObrigatÃ³rio antes de usar o sistema**

---

### ðŸ“Š Ranking de Staff
Baseado em aÃ§Ãµes reais registradas no banco:

- `!rank` â†’ ranking mensal
- `!semana` â†’ ranking semanal
- Usa a collection `ModerationAction`
- Pode rodar automaticamente via `jobs/rankJobs.js`

---

### ðŸ“¦ Finalizar DenÃºncia (ExportaÃ§Ã£o)
- BotÃ£o **Finalizar**
- Exporta todo o histÃ³rico do tÃ³pico:
  - mensagens
  - autores
  - timestamps
  - anexos (quando possÃ­vel)
- Gera:
  - HTML
  - ZIP
- Envia o arquivo no Discord
- **Tranca e arquiva o tÃ³pico automaticamente**
- Encerra oficialmente a denÃºncia

---

### ðŸ›¡ï¸ Robustez e SeguranÃ§a
Tratamento completo de erros comuns do Discord:

- `Unknown interaction (10062)`
- `InteractionNotReplied`
- DM bloqueada (`50007`)
- Timeouts e erros 5xx
- ProteÃ§Ã£o contra cliques duplicados
- Logs centralizados

---

## ðŸ§  Tecnologias Utilizadas

- Node.js 18+
- discord.js v14
- MongoDB + Mongoose
- PM2 (opcional)
- SquareCloud
- Git / GitHub

## âš ï¸ Aviso de SeguranÃ§a (npm audit)

Este projeto utiliza discord.js v14.

Algumas dependÃªncias indiretas (como undici) reportam vulnerabilidades moderadas via npm audit.

Aplicar npm audit fix --force causaria downgrade do discord.js e quebraria o projeto.
Por isso, as vulnerabilidades foram analisadas e monitoradas, sem impacto prÃ¡tico no uso real do bot.

## ðŸ—ºï¸ Roadmap
- [ ] InternacionalizaÃ§Ã£o (EN)
- [ ] Melhorias visuais no painel
- [ ] MÃ©tricas avanÃ§adas
- [ ] Cache inteligente de queries

---

## ðŸ“‚ Estrutura do Projeto

```bash
.
â”œâ”€â”€ commands/
â”‚   â”œâ”€â”€ denuncia.js
â”‚   â”œâ”€â”€ painel.js
â”‚   â”œâ”€â”€ correcao.js
â”‚   â”œâ”€â”€ status.js
â”‚   â”œâ”€â”€ rank.js
â”‚   â””â”€â”€ semana.js
â”‚
â”œâ”€â”€ doc/
â”‚   â”œâ”€â”€ BUTTONS.md
â”‚   â”œâ”€â”€ DB_MODELS.md
â”‚   â””â”€â”€ FLOW.md
â”‚
â”œâ”€â”€ Handlers/
â”‚   â”œâ”€â”€ exportDenuncia.js
â”‚   â”œâ”€â”€ handlerStatusButton.js
â”‚   â”œâ”€â”€ interactionHandler.js
â”‚   â”œâ”€â”€ leiaAvisoHandler.js
â”‚   â”œâ”€â”€ LogManager.js
â”‚   â”œâ”€â”€ messageDeleteHandler.js
â”‚   â””â”€â”€ messageReactionHandler.js
â”‚
â”œâ”€â”€ jobs/
â”‚   â””â”€â”€ rankJobs.js
â”‚
â”œâ”€â”€ models/
â”‚   â”œâ”€â”€ Config.js
â”‚   â”œâ”€â”€ Denuncia.js
â”‚   â””â”€â”€ ModerationAction.js
â”‚
â”œâ”€â”€ services/
â”‚   â””â”€â”€ rankService.js
â”‚
â”œâ”€â”€ utils/
â”‚   â”œâ”€â”€ logger.js
â”‚   â”œâ”€â”€ dateUtils.js
â”‚   â”œâ”€â”€ advancedMonitoring.js
â”‚   â””â”€â”€ smartCache.js
â”‚
â”œâ”€â”€ index.js
â”œâ”€â”€ package.json
â”œâ”€â”€ squarecloud.app
â”œâ”€â”€ .env.example
â”œâ”€â”€ CHANGELOG.md
â””â”€â”€ README.md
