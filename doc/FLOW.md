# 🔁 Fluxo Completo do Sistema de Denúncias

Este documento descreve **TODO o fluxo do bot**, desde a configuração inicial até o encerramento da denúncia.

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
  - permite correção administrativa

📌 Nenhuma nova denúncia é criada.

---

## 5️⃣ Reivindicação

- Staff clica em 📝 Reivindicar
- Bot define responsável e registra ação
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

## 9️⃣ Rankings

- Todas ações são registradas
- `!rank` → mensal
- `!semana` → semanal
