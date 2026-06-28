// DB_MODELS.md
# ðŸ—„ï¸ Modelos do Banco de Dados (MongoDB)

> **ðŸ“ v1.2.1:** Nenhuma alteraÃ§Ã£o nos modelos. Removido suporte a caching local (utils nÃ£o utilizadas).

---

## ðŸ“„ Config

Collection responsÃ¡vel por **configurar o bot por servidor**.

### Campos principais:
- `guildId`
- `roles.administrador`
- `roles.responsavel_admin`
- `channels.logs`
- `channels.log`
- `channels.analysis`
- `channels.pc`
- `channels.mobile`

Usado em:
- permissÃµes
- envio de logs
- criaÃ§Ã£o de denÃºncias

---

## ðŸ“„ Denuncia

Representa uma denÃºncia individual.

### Campos:
- `_id`
- `status` (analise | aceita | recusada)
- `threadId`
- `messageId`
- `criadoPor`
- `claimedBy`
- `acusadoId`
- `motivoAceite`
- `dataPunicao`
- `logMessageId`
- `createdAt`
- `dataAtualizacao`
- `ultimaEdicao`

Usado em:
- botÃµes
- exportaÃ§Ã£o
- logs
- rankings

---

## ðŸ“„ ModerationAction

Usado para estatÃ­sticas e ranking.

### Campos:
- `moderatorId`
- `action` (reivindicacao | analise | aceita | recusada)
- `denunciaId`
- `guildId`
- `weekOf`
- `weekNumber`
- `timestamp`

Usado em:
- `!rank`
- `!semana`
- `rankJobs.js`

---
