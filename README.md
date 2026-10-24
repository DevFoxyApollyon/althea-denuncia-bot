// README.md

```
 █████╗ ██╗     ███████╗████████╗██╗  ██╗███████╗ █████╗ 
██╔══██╗██║     ██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗
███████║██║     █████╗     ██║   ███████║█████╗  ███████║
██╔══██║██║     ██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██║
██║  ██║███████╗███████╗   ██║   ██║  ██║███████╗██║  ██║
╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
```

# 🦊 ALTHEA – Bot de Denúncias para Discord

**ALTHEA é** um bot completo de **gerenciamento de denúncias, moderação e controle de staff** para servidores Discord.

Desenvolvido em **Node.js + discord.js v14.25**, com **MongoDB, painéis interativos, botões, modais, logs centralizados, ranking de staff, exportação de denúncias e configuração dinâmica por servidor.**

Projeto criado para **uso real em produção**, com foco em **estabilidade, organização, segurança e transparência.**

| Versão | Stack | Tecnologias |
|--------|-------|-------------|
| **v3.2.4** | **Node.js** (>= 18) | **discord.js v14**, **MongoDB**, **Mongoose**, **release** |

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
| `/ponte gamemode pausar\|retomar\|executor\|limites` | — | Responsável Admin | Modo gamemode do servidor |

---

## 🎮 Ponte com a gamemode

Além do PC da staff (mod Lua), a própria gamemode do servidor pode aplicar as punições
aceitas no Discord. Ela **busca** os pedidos no Althea (`/ponte/gm/v1`, HMAC na query) e
devolve o resultado; o Althea nunca chama o servidor do jogo.

- **Especificação do protocolo:** [`doc/PONTE_GAMEMODE.md`](doc/PONTE_GAMEMODE.md).
- **Include Pawn:** fica fora deste repositório (é dos devs do servidor). A versão 1.0.0 está na tag [`v3.12.0`](https://github.com/DevFoxyApollyon/althea-denuncia-bot/tree/v3.12.0/gamemode); os testes usam só a cópia dos vetores em `test/fixtures/vetores_protocolo_gm.json`.
- **Guia para os devs do servidor (servidor de teste):** [`doc/GUIA_SERVIDOR_TESTE.md`](doc/GUIA_SERVIDOR_TESTE.md).
- **No `.env`:** `PONTE_CHAVE_MESTRA` (base64 de 32 bytes) cifra os segredos. Sem ela, a API responde 503.
- **Fluxo:** aceite da denúncia → embed "🎮 Punição para o jogo" no Relatório de punições → um
  responsável clica em **Enviar ao jogo** → a gamemode busca, aplica e responde → o embed mostra
  o resultado de cada alvo. Sem resposta, o pedido vira **incerto** e vai para o Log Admin, onde
  um responsável decide ("foi aplicada" ou "reenviar"): nada é reenviado sozinho.
- **Quem aplica** é escolhido por servidor: `pc` (padrão), `gamemode` ou `ambos`
  (`/ponte gamemode executor`). O modo teste vem ligado: a gamemode só simula até ser desligado
  em `/ponte gamemode limites`.
- **Painel do dono:** aba Gamemode no `/admin` (credenciais, pedidos recentes e auditoria `gm_*`).

---

## 🧪 Desenvolvimento

```bash
npm run lint   # ESLint
npm test       # testes (node:test) — não acessam o banco nem o Discord
```

### Migração do banco secundário e retenção

As configurações dos servidores (`Config`) usam `MONGODB_URI`; os demais models
usam `SECONDARY_DB_URI`. Com o bot parado, execute `npm run db:migrar` para
simular a cópia e detectar conflitos. Se o resultado estiver correto, execute
`npm run db:migrar -- --aplicar`. A origem não é apagada e serve como cópia de
segurança. A collection `configs` não é copiada: as configurações permanecem no
banco principal. Os registros existentes no secundário recebem seis meses de
prazo a partir da migração; dados novos também expiram seis meses após a criação.
As configurações no principal também têm retenção de seis meses.

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
