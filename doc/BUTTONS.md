# 🔘 Buttons & Interactions

Este documento descreve **TODOS os botões e modais** utilizados pelo bot, seus `customId`, permissões e handlers responsáveis.

---

## 📌 Botões do Painel `!denuncia`

Local: mensagem enviada pelo comando `!denuncia`  
Handler: `commands/denuncia.js`

---

### 🖥️ `denuncia_pc`
**Função:**  
Abrir modal para criação de denúncia PC.

**Fluxo:**
- Abre modal
- Cria denúncia no MongoDB
- Cria tópico/thread no canal PC
- Publica denúncia
- Adiciona botões de staff + Finalizar

---

### 📱 `denuncia_mobile`
**Função:**  
Abrir modal para criação de denúncia Mobile.

**Fluxo:**  
Idêntico ao PC, porém usando `config.channels.mobile`.

---

### 📂 `minhas_denuncias`
**Função:**  
Permitir que o usuário visualize todas as denúncias que ele criou.

**O que mostra:**
- Lista de denúncias
- Status atual
- Link do tópico (quando existir)

**Objetivo:**  
Transparência e redução de tickets desnecessários.

---

### 🛠️ `correcao`
**Função:**  
Iniciar fluxo de **correção de denúncia existente**.

**Importante:**
- NÃO cria nova denúncia
- Reutiliza a lógica do comando `!correcao`
- Usado para corrigir erros humanos ou administrativos

**Integração:**
- Botão → `commands/denuncia.js`
- Lógica → `commands/correcao.js`

---

## 📌 Botões do Tópico da Denúncia (Staff)

Handler: `Handlers/handlerStatusButton.js`

---

### 📝 `reivindicar`
**Função:**  
Staff assume a denúncia.

**Efeitos:**
- Define `claimedBy`
- Registra ação em `ModerationAction`
- Renomeia tópico

---

### 🔎 `analiser`
**Função:**  
Marcar denúncia como **em análise**.

**Permissões:**
- Quem reivindicou
- Responsável admin

---

### ✅ `aceitar`
**Função:**  
Aceitar denúncia e abrir **modal de punição**.

---

### ❌ `recusar`
**Função:**  
Recusar denúncia.

**Efeitos:**
- Atualiza status
- Remove logs
- Envia DM
- Mostra aviso de reanálise

---

### ✅ `finalizar_denuncia`
**Função:**  
Exportar a denúncia e **fechar o tópico**.

**Efeitos:**
- Exporta mensagens/anexos
- Gera HTML/ZIP
- Envia arquivo
- Tranca e arquiva o tópico

---

## 🪟 Modais

### `punishment_modal`
**Usado em:** botão `aceitar`

**Campos:**
- acusadoId
- motivo
- data

**Resultado:**  
Denúncia aceita + logs + DM + aviso de reanálise
