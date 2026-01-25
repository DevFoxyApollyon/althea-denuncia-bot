# 📦 Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

Este projeto segue o padrão de versionamento semântico (SemVer).

---

## [1.0.1] - 2026-01-25
### 🔧 Refatoração e Correções

#### ♻️ Refatoração
- Consolidação de `denunciaButtons.js`: funções movidas para `commands/denuncia.js`
- Remoção de arquivos não utilizados:
  - `utils/performance.js`
  - `utils/monitoring.js`
  - `utils/commands.js`
  - `utils/templateProcessor.js`
  - `services/notificationService.js`
  - `buttons/denunciaButtons.js` (redundante)

#### 🐛 Correções
- Corrigido aviso deprecated do Discord.js: `ephemeral` → `flags: [MessageFlags.Ephemeral]`
  - `Handlers/handlerStatusButton.js`
  - `jobs/rankJobs.js`
  - `commands/painel.js`
  - `Handlers/handlerStatusButton.js` (função `safeDefer`)
- Adicionadas importações faltantes em `Handlers/interactionHandler.js`
- Removidos handlers não implementados (`atualizar`, `detalhe`)

#### ✨ Melhorias
- Código mais limpo e sem redundâncias
- Melhor organização de funcionalidades
- Redução de avisos de deprecação

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
