// BUTTONS.md
# ðŸ”˜ Buttons & Interactions

Este documento descreve **TODOS os botÃµes e modais** utilizados pelo bot, seus `customId`, permissÃµes e handlers responsÃ¡veis.

> **ðŸ“ Nota v1.2.1:** Os handlers de botÃµes foram consolidados para melhor organizaÃ§Ã£o. `buttons/denunciaButtons.js` foi integrado em `commands/denuncia.js`. Arquivo `buttons/statusButtons.js` foi removido (redundante).

---

## ðŸ“Œ BotÃµes do Painel `!denuncia`

Local: mensagem enviada pelo comando `!denuncia`  
Handler: `commands/denuncia.js` (consolidado em v1.2.1)

---

### ðŸ–¥ï¸ `denuncia_pc`
**FunÃ§Ã£o:**  
Abrir modal para criaÃ§Ã£o de denÃºncia PC.

**Fluxo:**
- Abre modal
- Cria denÃºncia no MongoDB
- Cria tÃ³pico/thread no canal PC
- Publica denÃºncia
- Adiciona botÃµes de staff + Finalizar

---

### ðŸ“± `denuncia_mobile`
**FunÃ§Ã£o:**  
Abrir modal para criaÃ§Ã£o de denÃºncia Mobile.

**Fluxo:**  
IdÃªntico ao PC, porÃ©m usando `config.channels.mobile`.

---

### ðŸ“‚ `minhas_denuncias`
**FunÃ§Ã£o:**  
Permitir que o usuÃ¡rio visualize todas as denÃºncias que ele criou.

**O que mostra:**
- Lista de denÃºncias
- Status atual
- Link do tÃ³pico (quando existir)

**Objetivo:**  
TransparÃªncia e reduÃ§Ã£o de tickets desnecessÃ¡rios.

---

### ðŸ› ï¸ `correcao`
**FunÃ§Ã£o:**  
Iniciar fluxo de **correÃ§Ã£o de denÃºncia existente**.

**Importante:**
- NÃƒO cria nova denÃºncia
- Reutiliza a lÃ³gica do comando `!correcao`
- Usado para corrigir erros humanos ou administrativos

**IntegraÃ§Ã£o:**
- BotÃ£o â†’ `commands/denuncia.js`
- LÃ³gica â†’ `commands/correcao.js`

---

## ðŸ“Œ BotÃµes do TÃ³pico da DenÃºncia (Staff)

Handler: `Handlers/handlerStatusButton.js`

---

### ðŸ“ `reivindicar`
**FunÃ§Ã£o:**  
Staff assume a denÃºncia.

**Efeitos:**
- Define `claimedBy`
- Registra aÃ§Ã£o em `ModerationAction`
- Renomeia tÃ³pico

---

### ðŸ”Ž `analiser`
**FunÃ§Ã£o:**  
Marcar denÃºncia como **em anÃ¡lise**.

**PermissÃµes:**
- Quem reivindicou
- ResponsÃ¡vel admin

---

### âœ… `aceitar`
**FunÃ§Ã£o:**  
Aceitar denÃºncia e abrir **modal de puniÃ§Ã£o**.

---

### âŒ `recusar`
**FunÃ§Ã£o:**  
Recusar denÃºncia.

**Efeitos:**
- Atualiza status
- Remove logs
- Envia DM
- Mostra aviso de reanÃ¡lise

---

### âœ… `finalizar_denuncia`
**FunÃ§Ã£o:**  
Exportar a denÃºncia e **fechar o tÃ³pico**.

**Efeitos:**
- Exporta mensagens/anexos
- Gera HTML/ZIP
- Envia arquivo
- Tranca e arquiva o tÃ³pico

---

## ðŸªŸ Modais

### `punishment_modal`
**Usado em:** botÃ£o `aceitar`

**Campos:**
- acusadoId
- motivo
- data

**Resultado:**  
DenÃºncia aceita + logs + DM + aviso de reanÃ¡lise
