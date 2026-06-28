// FLOW.md

# 🔄 Fluxo Completo do Sistema de Denúncias

Este documento descreve **TODO o fluxo do bot**, desde a configuração inicial até o encerramento da denúncia.

> **📝 Última atualização:** v1.2.1 — Atualização de documentação e preparação de release

---

## 0️⃣ Configuração Inicial (`!painel`)

Antes de usar o sistema, o administrador deve executar:

### `!painel`
Permite configurar no MongoDB:
- Cargos administrativos
- Canais de denúncia (PC/Mobile)
- Canais de logs
- Canal de análise

**🔴 Sem essa etapa, o bot não funciona corretamente.**

**Handler:** `commands/painel.js`  
**Database:** `Config` collection

---

## 1️⃣ Abertura do Painel de Denúncias (`!denuncia`)

- Staff executa `!denuncia`
- Bot envia embed **Sistema de Denúncias**
- Botões:
  - 🖥️ Denúncia PC
  - 📱 Denúncia Mobile
  - 📂 Minhas Denúncias

**Handler:** `commands/denuncia.js`

---

## 2️⃣ Criação da Denúncia

### Fluxo:
1. **Usuário clica** em "Denúncia PC" ou "Denúncia Mobile"
2. **Modal abre** com campos:
   - Descrição (TextInput)
   - Evidências (TextInput)
3. **Usuário preenche** e submete
4. **Bot cria:**
   - Documento na collection `Denuncia`
   - Tópico no canal apropriado (PC ou Mobile)
   - Embed de denúncia com status **📝 Reivindicada**
   - Botões de staff

### Dados Salvos:
```javascript
{
  guildId: "...",
  userId: "...",
  username: "...",
  plataforma: "PC" | "Mobile",
  conteudo: "...",
  status: "reivindicada",
  threadId: "...",
  data_criacao: new Date(),
  logMessage: "..."
}
```

**Handler:** `commands/denuncia.js` → `handleDenunciaCommand`  
**Database:** `Denuncia` collection

---

## 3️⃣ Análise da Denúncia

### Fluxo:
1. **Staff visualiza** a denúncia no tópico
2. **Staff clica** em um dos botões:
   - 📝 **Reivindicar** — "Vou analisar isso"
   - 🔎 **Analisar** — "Estou analisando"
   - ✅ **Aceitar** — Abrir modal de punição
   - ❌ **Recusar** — Rejeitar denúncia
   - 🛠️ **Correção** — Corrigir dados

### Mudanças de Status:
```
Reivindicada (inicial)
    ↓
Analisando (staff em ação)
    ↓
Aceita (aprovada) OU Recusada (rejeitada)
    ↓
Finalizada (arquivada)
```

**Handler:** `Handlers/handlerStatusButton.js`  
**Database:** Atualiza `Denuncia` collection

---

## 4️⃣ Aceitar Denúncia

### Fluxo:
1. **Staff clica** em "✅ Aceitar"
2. **Modal abre** com campos:
   - ID da log do aceite
   - Resultado
3. **Bot:**
   - Atualiza status para **✅ Aceita**
   - Registra em `ModerationAction`
   - Envia mensagem de confirmação

### Dados Registrados:
```javascript
// Em ModerationAction:
{
  guildId: "...",
  moderatorId: "...",
  action: "aceitar",
  denunciaId: ObjectId,
  timestamp: new Date()
}
```

**Handler:** `Handlers/handlerStatusButton.js`  
**Database:** `ModerationAction` collection (para ranking)

---

## 5️⃣ Recusar Denúncia

### Fluxo:
1. **Staff clica** em "❌ Recusar"
2. **Bot:**
   - Atualiza status para **❌ Recusada**
   - Registra em `ModerationAction`
   - Notifica o acusador (se configurado)

**Handler:** `Handlers/handlerStatusButton.js`

---

## 6️⃣ Correção de Denúncia

### Fluxo:
1. **Staff clica** em "🛠️ Correção"
2. **Modal abre** com campos:
   - Novo log
   - Novo status
3. **Bot:**
   - Atualiza dados da denúncia
   - NÃO cria nova denúncia
   - Registra mudança

**Handler:** `commands/correcao.js`  
**Importante:** Não duplica denúncias, apenas corrige

---

## 7️⃣ Finalizar Denúncia (Exportação)

### Fluxo:
1. **Staff clica** em "✅ Finalizar"
2. **Bot:**
   - Recupera todas as mensagens do tópico
   - Baixa anexos (se possível)
   - Gera HTML com histórico
   - Compacta em ZIP
   - Envia arquivo no Discord
   - **Tranca o tópico**
   - **Arquiva o tópico**
   - Atualiza status para **Finalizada**

### Arquivo Gerado:
```
denuncia_[id].zip
├── index.html        (histórico formatado)
├── mensagens.json    (dados brutos)
└── attachments/      (arquivos)
    ├── image1.png
    ├── video.mp4
    └── document.pdf
```

**Handler:** `Handlers/exportDenuncia.js`  
**Timeout:** 5 segundos por anexo  
**Tamanho máximo:** 50 MB por arquivo

---

## 8️⃣ Visualizar Minhas Denúncias (`!minhas_denuncias`)

### Fluxo:
1. **Usuário clica** em "📂 Minhas Denúncias"
2. **Bot:**
   - Busca todas as denúncias do usuário
   - Exibe em lista com links para tópicos
   - Mostra status de cada

**Handler:** `commands/denuncia.js` → `handleMyDenunciasButton`  
**Query:** `Denuncia.find({ userId: userID, guildId: guildID })`

---

## 9️⃣ Ranking de Staff

### `!rank` (Ranking Mensal)
- Conta ações no último mês
- Exibe top 10 moderadores
- Base: `ModerationAction` collection

### `!semana` (Ranking Semanal)
- Conta ações na última semana
- Mesmo formato do mensal

**Handler:** `commands/rank.js` e `commands/semana.js`  
**Service:** `services/rankService.js`

---

## 🔐 Verificações de Permissão

```javascript
// Em todos os pontos críticos:

1. Role "administrador"
   └─ Acesso total
   
2. Role "responsavel_admin"
   └─ Analisar denúncias
   └─ Aceitar/Recusar
   └─ Corrigir dados
   
3. Membro comum
   └─ Apenas criar denúncia
   └─ Visualizar próprias denúncias
```

Configurado via `!painel` e armazenado em `Config` collection.

---

## 🔄 Ciclo Completo

```
Usuário cria denúncia
      ↓
Staff recebe notificação
      ↓
Staff reivindicador/analisa
      ↓
Staff aceita ou recusa
      ↓
[Se aceita] → Registra punição
      ↓
Finaliza denúncia
      ↓
Exporta histórico
      ↓
Tópico é trancado e arquivado
      ↓
Aparece no ranking de staff
```

---

## 🔧 Tratamento de Erros

O bot é robusto contra:

- **Unknown interaction (10062)** — Resposta expirada
- **InteractionNotReplied** — Falta de resposta
- **DM bloqueada (50007)** — Usuário bloqueou DM
- **Timeouts de download** — 5 segundos máximo
- **Arquivo muito grande** — 50 MB máximo
- **Cliques duplicados** — Proteção automática

Todos os erros são registrados em logs centralizados.

---

## 🧹 Limpeza de Dados

### Automático:
- `jobs/autoFinalizador.js` — Finaliza denúncias após período X
- `jobs/nicknamePoller.js` — Sincroniza nicknames

### Manual:
```bash
# Para resetar todas as denúncias:
# (No MongoDB)
db.denuncias.deleteMany({})
```

---

**Última atualização:** v1.2.1  
**Próximas melhorias:** Sistema de appeals, internacionalização
