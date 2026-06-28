// FLOW.md
# ðŸ” Fluxo Completo do Sistema de DenÃºncias

Este documento descreve **TODO o fluxo do bot**, desde a configuraÃ§Ã£o inicial atÃ© o encerramento da denÃºncia.

> **ðŸ“ Ãšltima atualizaÃ§Ã£o:** v1.2.1 - AtualizaÃ§Ã£o de documentaÃ§Ã£o e preparaÃ§Ã£o da release

---

## 0ï¸âƒ£ ConfiguraÃ§Ã£o Inicial (`!painel`)

Antes de usar o sistema, o administrador deve executar:

### `!painel`
Permite configurar no MongoDB:
- cargos administrativos
- canais de denÃºncia (PC/Mobile)
- canais de logs
- canal de anÃ¡lise

ðŸ“Œ Sem essa etapa, o bot nÃ£o funciona corretamente.

---

## 1ï¸âƒ£ Abertura do Painel de DenÃºncias (`!denuncia`)

- Staff executa `!denuncia`
- Bot envia embed **Sistema de DenÃºncias**
- BotÃµes:
  - ðŸ–¥ï¸ DenÃºncia PC
  - ðŸ“± DenÃºncia Mobile
  - ðŸ“‚ Minhas DenÃºncias
  - ðŸ› ï¸ CorreÃ§Ã£o

---

## 2ï¸âƒ£ CriaÃ§Ã£o da DenÃºncia (PC/Mobile)

- UsuÃ¡rio clica em PC ou Mobile
- Modal Ã© aberto
- UsuÃ¡rio envia denÃºncia
- Bot:
  - cria registro no MongoDB
  - cria tÃ³pico/thread
  - publica denÃºncia
  - fixa aviso no topo
  - adiciona botÃµes de staff + Finalizar

---

## 3ï¸âƒ£ Minhas DenÃºncias

- UsuÃ¡rio clica em **Minhas DenÃºncias**
- Bot lista denÃºncias criadas pelo usuÃ¡rio
- UsuÃ¡rio acompanha status sem depender da staff

---

## 4ï¸âƒ£ CorreÃ§Ã£o via BotÃ£o ou Comando (`correcao`)

- UsuÃ¡rio/staff clica em **CorreÃ§Ã£o** ou usa `!correcao`
- Bot:
  - solicita ID da denÃºncia
  - localiza registro
  - permite correÃ§Ã£o administrativa

ðŸ“Œ Nenhuma nova denÃºncia Ã© criada.

---

## 5ï¸âƒ£ ReivindicaÃ§Ã£o

- Staff clica em ðŸ“ Reivindicar
- Bot define responsÃ¡vel e registra aÃ§Ã£o
- Renomeia tÃ³pico

---

## 6ï¸âƒ£ AnÃ¡lise

- Staff clica em ðŸ”Ž Analisar
- Bot muda status e atualiza logs

---

## 7ï¸âƒ£ DecisÃ£o

### âœ… Aceitar
- Modal de puniÃ§Ã£o
- Atualiza banco
- Envia logs
- Envia DM
- Mostra aviso de reanÃ¡lise

### âŒ Recusar
- Atualiza banco
- Remove logs
- Envia DM
- Mostra aviso de reanÃ¡lise

---

## 8ï¸âƒ£ Finalizar (Exportar)

- Staff clica em **Finalizar**
- Bot:
  - exporta histÃ³rico
  - gera ZIP/HTML
  - envia arquivo
  - **tranca e arquiva tÃ³pico**

âž¡ï¸ DenÃºncia encerrada.

---

## 9ï¸âƒ£ Rankings

- Todas aÃ§Ãµes sÃ£o registradas
- `!rank` â†’ mensal
- `!semana` â†’ semanal
