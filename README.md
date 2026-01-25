# 🤖 ALTHEA — Bot de Denúncias para Discord

**ALTHEA** é um bot completo de **gerenciamento de denúncias, moderação e controle de staff** para servidores Discord.  
Desenvolvido em **Node.js + discord.js v14.25**, com **MongoDB**, **painéis interativos**, **botões**, **modais**, **logs centralizados**, **ranking de staff**, **exportação de denúncias** e **configuração dinâmica por servidor**.

Projeto criado para **uso real em produção**, com foco em **estabilidade**, **organização**, **segurança** e **transparência**.


![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![discord.js](https://img.shields.io/badge/discord.js-v14-blue)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-green)
![Release](https://img.shields.io/github/v/release/DevFoxyApollyon/althea-denuncia-bot)

---

## 🧠 Identidade do Projeto

```text
 █████╗ ██╗     ███████╗████████╗██╗  ██╗███████╗ █████╗ 
██╔══██╗██║     ██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗
███████║██║     █████╗     ██║   ███████║█████╗  ███████║
██╔══██║██║     ██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██║
██║  ██║███████╗███████╗   ██║   ██║  ██║███████╗██║  ██║
╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝

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

- `!rank` → ranking mensal
- `!semana` → ranking semanal
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

## 🧠 Tecnologias Utilizadas

- Node.js 18+
- discord.js v14
- MongoDB + Mongoose
- PM2 (opcional)
- SquareCloud
- Git / GitHub

## ⚠️ Aviso de Segurança (npm audit)

Este projeto utiliza discord.js v14.

Algumas dependências indiretas (como undici) reportam vulnerabilidades moderadas via npm audit.

Aplicar npm audit fix --force causaria downgrade do discord.js e quebraria o projeto.
Por isso, as vulnerabilidades foram analisadas e monitoradas, sem impacto prático no uso real do bot.

## 🗺️ Roadmap
- [ ] Internacionalização (EN)
- [ ] Melhorias visuais no painel
- [ ] Métricas avançadas
- [ ] Cache inteligente de queries

---

## 📂 Estrutura do Projeto

```bash
.
├── buttons/
│   └── statusButtons.js
│
├── commands/
│   ├── denuncia.js
│   ├── painel.js
│   ├── correcao.js
│   ├── status.js
│   ├── rank.js
│   └── semana.js
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
├── squarecloud.app
├── .env.example
└── README.md
