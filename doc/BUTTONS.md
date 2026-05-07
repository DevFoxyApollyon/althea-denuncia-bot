# 🔘 Buttons & Interactions

Este documento descreve **TODOS os botões e modais** utilizados pelo bot, seus `customId`, permissões e handlers responsáveis.

> **📝 Nota v1.0.1:** Os handlers de botões foram consolidados para melhor organização. `buttons/denunciaButtons.js` foi integrado em `commands/denuncia.js`. Arquivo `buttons/statusButtons.js` foi removido (redundante).

---

## 📌 Botões do Painel `!denuncia`

Local: mensagem enviada pelo comando `!denuncia`  
Handler: `commands/denuncia.js` (consolidado em v1.0.1)

---

### 🖥️ `denuncia_pc`
**Função:**  
Abrir modal para criação de denúncia PC.

**Fluxo:**
- Abre modal
- Cria denúncia no MongoDB

# 🛸 Buttons & Interactions (v3)

Este documento descreve **TODOS os botões, menus e modais** utilizados pelo bot, seus `customId`, permissões e handlers responsáveis.

> **📝 Atualização v3:**
> - Toda lógica de mudança de status (permissão, cooldown, lock) foi centralizada em `Handlers/handlerStatusButton.js`.
> - Novo sistema de feedback pós-denúncia (menu, modal, temp storage).
> - Enforcement de cooldown de reivindicação.
> - Novos botões e modais para feedback e manutenção.
> - Fluxo de permissões e locks revisado.

---

## 📌 Botões do Painel `!denuncia`

Local: mensagem enviada pelo comando `!denuncia`
Handler: `commands/denuncia.js`

### 🖥️ `denuncia_pc` / 📱 `denuncia_mobile`
**Função:** Abrir modal para criação de denúncia (PC/Mobile).
**Fluxo:**
- Abre modal
- Cria denúncia no MongoDB
- Cria tópico/thread no canal correto
- Publica denúncia
- Adiciona botões de staff + Finalizar

### 📂 `minhas_denuncias`
**Função:** Listar denúncias do usuário, status e links.

### 🛠️ `correcao`
**Função:** Iniciar fluxo de correção administrativa (não cria nova denúncia).
**Integração:**
- Botão → `commands/denuncia.js`
- Lógica → `commands/correcao.js`

---

## 📌 Botões do Tópico da Denúncia (Staff)

Handler: `Handlers/handlerStatusButton.js` (centraliza permissões, cooldowns, locks)

### 📝 `reivindicar`
**Função:** Staff assume a denúncia.
**Efeitos:**
- Define `claimedBy` (respeita cooldown)
- Registra ação em `ModerationAction`
- Renomeia tópico

### 🔎 `analiser`
**Função:** Marcar denúncia como **em análise**.
**Permissões:**
- Apenas quem reivindicou ou responsável admin

### ✅ `aceitar`
**Função:** Aceitar denúncia e abrir **modal de punição**.

### ❌ `recusar`
**Função:** Recusar denúncia.
**Efeitos:**
- Atualiza status
- Remove logs
- Envia DM
- Mostra aviso de reanálise

### ✅ `finalizar_denuncia`
**Função:** Exportar denúncia e **fechar tópico**.
**Efeitos:**
- Exporta mensagens/anexos
- Gera HTML/ZIP
- Envia arquivo
- Tranca e arquiva tópico

---

## 📝 Novo: Sistema de Feedback

### `feedback_menu`
**Função:** Menu enviado após finalização para avaliação do atendimento.
**Handler:** `utils/feedback.js`

### `feedback_modal`
**Função:** Modal para comentário detalhado após seleção no menu.
**Armazenamento:** `models/FeedbackTemp.js`

---

## 🦟 Modais

### `punishment_modal`
**Usado em:** botão `aceitar`
**Campos:** acusadoId, motivo, data
**Resultado:** Denúncia aceita + logs + DM + aviso de reanálise

### `feedback_modal`
**Usado em:** menu de feedback
**Campos:** rating, comentário
**Resultado:** Feedback armazenado para análise
---
