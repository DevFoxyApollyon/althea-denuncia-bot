
# 🗄️ Modelos do Banco de Dados (MongoDB) — v3

> **📝 v3:**
> - Novo modelo `FeedbackTemp` para avaliações pós-denúncia
> - Campos de controle de status, claimedBy, locks e cooldowns revisados
> - Melhorias em Denuncia para rastreamento de fluxo e feedback

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
- `status` (analise | aceita | recusada | finalizada)
- `threadId`
- `messageId`
- `criadoPor`
- `claimedBy` (staff que reivindicou, respeita cooldown)
- `acusadoId`
- `motivoAceite`
- `dataPunicao`
- `logMessageId`
- `createdAt`
- `dataAtualizacao`
- `ultimaEdicao`
- `locked` (controle de lock para evitar ações simultâneas)
- `cooldowns` (controle de cooldowns por ação)
- `feedbackId` (referência para feedback pós-denúncia)

Usado em:
- botões
- exportação
- logs
- rankings
- feedback

---

## 📄 ModerationAction

Usado para estatísticas e ranking.

### Campos:
- `moderatorId`
- `action` (reivindicacao | analise | aceita | recusada | finalizada)
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

## 🆕 FeedbackTemp

Armazena avaliações temporárias pós-denúncia (menu/modal).

### Campos:
- `_id`
- `denunciaId`
- `userId`
- `rating` (1-5)
- `comentario`
- `createdAt`

Usado em:
- Sistema de feedback pós-denúncia
- Análise de atendimento

---

## Observações v3

- Todos os controles de status, locks e cooldowns são centralizados em `Handlers/handlerStatusButton.js`.
- O campo `feedbackId` em Denuncia referencia o feedback dado pelo usuário.
- O modelo FeedbackTemp é temporário e pode ser limpo periodicamente.
