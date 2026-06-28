// BUTTONS.md

# 🔘 Buttons & Interactions

Este documento descreve **TODOS os botões e modais** utilizados pelo bot, seus `customId`, permissões e handlers responsáveis.

> **📝 Nota v1.2.1:** Os handlers de botões foram consolidados para melhor organização. Arquivo `buttons/denunciaButtons.js` foi integrado em `commands/denuncia.js`.

---

## 🔌 Botões do Painel `!denuncia`

Local: mensagem enviada pelo comando `!denuncia`  
Handler: `commands/denuncia.js` (consolidado em v1.2.1)

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
- Mesmo fluxo que PC
- Diferencia canal de destino

---

### 📂 `minhas_denuncias`
**Função:**  
Exibir denúncias do usuário.

**Permissão:** Qualquer membro  
**Dados:**
- Status da denúncia
- Links para tópicos
- Data de criação

---

## 🎯 Botões dentro do Tópico de Denúncia

Disponíveis após criar uma denúncia.

### 📝 `reivindicar`
**Função:** Marcar denúncia como reivindicada  
**Permissão:** Role `responsavel_admin`

### 🔎 `analisar`
**Função:** Marcar denúncia como em análise  
**Permissão:** Role `responsavel_admin`

### ✅ `aceitar_denuncia`
**Função:** Aceitar denúncia (abre modal de punição)  
**Permissão:** Role `responsavel_admin`  
**Modal:** `modal_aceitar`

### ❌ `recusar_denuncia`
**Função:** Recusar denúncia  
**Permissão:** Role `responsavel_admin`

### ✅ `finalizar_denuncia`
**Função:** Exportar e fechar denúncia  
**Permissão:** Role `administrador`  
**Resultado:** Gera HTML e ZIP, envia no Discord, tranca o tópico

### 🛠️ `correcao_button`
**Função:** Abrir modal de correção  
**Permissão:** Role `responsavel_admin`  
**Modal:** `modal_correcao`

---

## 🎯 Modais

### `modal_aceitar`
**Campos:**
- ID da log do aceite (TextInput)
- Resultado (TextInput)

**Handler:** `Handlers/handlerStatusButton.js`

### `modal_recusar`
**Campos:**
- Motivo da recusa (TextInput)

**Handler:** `Handlers/handlerStatusButton.js`

### `modal_correcao`
**Campos:**
- Novo log (TextInput)
- Novo status (TextInput)

**Handler:** `commands/correcao.js`

---

## 📋 Estrutura de customId

Padrão: `[acao]_[tipo]_[id]`

Exemplo:
- `aceitar_denuncia_123456`
- `reivindicar_denuncia_789012`
- `finalizar_denuncia_345678`

---

## 🔐 Permissões

Verificadas via roles do MongoDB:

- **administrador** — Acesso total
- **responsavel_admin** — Acesso moderado
- **Qualquer membro** — Apenas visualização

Configuradas via comando `!painel`.

---

**Última atualização:** v1.2.1
