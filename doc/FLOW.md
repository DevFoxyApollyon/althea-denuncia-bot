
# 🔁 Fluxo Completo do Sistema de Denúncias (v3)

Este documento descreve **TODO o fluxo do bot**, desde a configuração inicial até o encerramento da denúncia, incluindo feedback e automações.

> **📝 Atualização v3:**
> - Toda lógica de mudança de status (permissão, cooldown, lock) foi centralizada em `Handlers/handlerStatusButton.js`.
> - Novo sistema de feedback pós-denúncia.
> - Melhorias em auto-finalização e sincronização de nicknames.
> - Fluxo revisado para evitar bypasses e garantir rastreabilidade.

---

## 0️⃣ Configuração Inicial (`!painel`)

Antes de usar o sistema, o administrador deve executar:

### `!painel`
Permite configurar no MongoDB:
- cargos administrativos
- canais de denúncia (PC/Mobile)
- canais de logs
- canal de análise

📌 Sem essa etapa, o bot não funciona corretamente.

---

## 1️⃣ Abertura do Painel de Denúncias (`!denuncia`)

- Staff executa `!denuncia`
- Bot envia embed **Sistema de Denúncias**
- Botões:
  - 🖥️ Denúncia PC
  - 📱 Denúncia Mobile
  - 📂 Minhas Denúncias
  - 🛠️ Correção

---

## 2️⃣ Criação da Denúncia (PC/Mobile)

- Usuário clica em PC ou Mobile
- Modal é aberto
- Usuário envia denúncia
- Bot:
  - cria registro no MongoDB
  - cria tópico/thread
  - publica denúncia
  - fixa aviso no topo
  - adiciona botões de staff + Finalizar

---

## 3️⃣ Minhas Denúncias

- Usuário clica em **Minhas Denúncias**
- Bot lista denúncias criadas pelo usuário
- Usuário acompanha status sem depender da staff

---

## 4️⃣ Correção via Botão ou Comando (`correcao`)

- Usuário/staff clica em **Correção** ou usa `!correcao`
- Bot:
  - solicita ID da denúncia
  - localiza registro
  - permite correção administrativa (sem criar nova denúncia)

---

## 5️⃣ Reivindicação

- Staff clica em 📝 Reivindicar
- Bot define responsável (respeita cooldown) e registra ação
- Renomeia tópico

---

## 6️⃣ Análise

- Staff clica em 🔎 Analisar
- Bot muda status e atualiza logs

---

## 7️⃣ Decisão

### ✅ Aceitar
- Modal de punição
- Atualiza banco
- Envia logs
- Envia DM
- Mostra aviso de reanálise

### ❌ Recusar
- Atualiza banco
- Remove logs
- Envia DM
- Mostra aviso de reanálise

---

## 8️⃣ Finalizar (Exportar)

- Staff clica em **Finalizar**
- Bot:
  - exporta histórico
  - gera ZIP/HTML
  - envia arquivo
  - **tranca e arquiva tópico**

➡️ Denúncia encerrada.

---

## 9️⃣ Feedback Pós-Denúncia

- Após finalização, bot envia menu de feedback para o denunciante
- Usuário avalia atendimento (menu + modal)
- Feedback armazenado em `FeedbackTemp`
- Staff pode consultar avaliações

---

## 🔄 Automação e Manutenção

- **Auto-finalização:** denúncias paradas são finalizadas automaticamente (`jobs/autoFinalizador.js`)
- **Sincronização de nicknames:** bot repara e sincroniza nicks periodicamente (`jobs/nicknamePoller.js`)
- **Detecção de palavras proibidas:** monitoramento em tempo real, inclusive em edições (`utils/strikeWords.js`)

---

## 🔝 Rankings

- Todas ações são registradas
- `!rank` → mensal
- `!semana` → semanal

---

## Observações v3

- Toda lógica de status, permissões, locks e cooldowns está centralizada em `Handlers/handlerStatusButton.js`.
- O fluxo de feedback é obrigatório após finalização.
- Logs e exportações são automáticos e rastreáveis.
