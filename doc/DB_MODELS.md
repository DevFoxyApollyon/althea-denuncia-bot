# 🗄️ Modelos do Banco de Dados (MongoDB)

---

## 📄 Config

Collection responsável por **configurar o bot por servidor**.

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
- permissões
- envio de logs
- criação de denúncias

---

## 📄 Denuncia

Representa uma denúncia individual.

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
- botões
- exportação
- logs
- rankings

---

## 📄 ModerationAction

Usado para estatísticas e ranking.

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
