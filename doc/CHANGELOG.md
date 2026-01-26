# 📦 Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

Este projeto segue o padrão de versionamento semântico (SemVer).

---

## [1.0.2] - 2026-01-26
### 🐛 Correções

#### 🔧 Correção de Timeout na Consulta de Denúncias
- **Problema:** `DiscordAPIError[10062]: Unknown interaction` ao consultar denúncias
  - Token da interação expirava antes da resposta ser enviada
- **Solução em `commands/denuncia.js` (função `handleConsultaModalSubmit`):**
  - Adicionado timeout de 10 segundos na consulta ao banco de dados com `Promise.race()`
  - Implementado rastreamento de estado defer para melhor tratamento de erros
  - Resposta condicional: usa `reply()` se defer falhou, caso contrário `editReply()`
  - Melhor logging de erros e tratamento de casos onde o token expirou

---

## [1.0.1] - 2026-01-25
### 🔧 Manutenção, Refatoração e Correções

#### ♻️ Refatoração
- Consolidação de `denunciaButtons.js`: funcionalidades movidas para `commands/denuncia.js`
- Remoção de arquivos não utilizados ou redundantes:
  - `utils/performance.js`
  - `utils/monitoring.js`
  - `utils/commands.js`
  - `utils/templateProcessor.js`
  - `services/notificationService.js`
  - `buttons/denunciaButtons.js`

#### 🐛 Correções
- Correção do aviso deprecated do Discord.js:  
  `ephemeral` → `flags: [MessageFlags.Ephemeral]`
  - `Handlers/handlerStatusButton.js` (inclui `safeDefer`)
  - `jobs/rankJobs.js`
  - `commands/painel.js`
- Correção de imports ausentes em `Handlers/interactionHandler.js`
- Remoção de handlers não implementados (`atualizar`, `detalhe`)

#### ✨ Melhorias
- Código mais limpo e organizado
- Redução de avisos de deprecação
- Melhor separação de responsabilidades

---

## [1.0.0] - 2026-01-25
### 🎉 Lançamento Inicial

#### ✨ Adicionado
- Sistema completo de denúncias com organização automática em threads
- Botões interativos (PC, Mobile, Minhas Denúncias, Correção)
- Modal de criação de denúncia
- Modal de aplicação de punição
- Sistema de reivindicação de denúncias
- Sistema de análise
- Aceitar / Recusar denúncia
- Exportação de denúncias (HTML + ZIP)
- Botão **Finalizar** (exporta, tranca e arquiva o tópico)
- Sistema de correção (`!correcao` + botão)
- Painel de configuração do servidor (`!painel`)
- Ranking mensal (`!rank`)
- Ranking semanal (`!semana`)
- Logs centralizados e auditáveis
- Integração com MongoDB
- Deploy preparado para SquareCloud

#### 🛡️ Segurança
- Tratamento de `Unknown interaction (10062)`
- Tratamento de `InteractionNotReplied`
- Tratamento de DM bloqueada (`50007`)
- Proteção contra cliques duplicados
- Validação de permissões por cargo

---

## [Unreleased]
- Melhorias visuais
- Internacionalização (EN)
- Métricas avançadas
