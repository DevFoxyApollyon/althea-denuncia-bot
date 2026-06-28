// CHANGELOG.md
# 📋 Changelog

Todas as mudanÃ§as relevantes deste projeto serÃ£o documentadas neste arquivo.

Este projeto segue o padrÃ£o de versionamento semÃ¢ntico (SemVer).

---

## [1.2.1] - 2026-06-27
### ðŸ“ DocumentaÃ§Ã£o e preparaÃ§Ã£o de release

#### ✨ Atualizações
- Ajuste de documentaÃ§Ã£o de fluxo, botÃµes e modelos para a release 1.2.1
- OrganizaÃ§Ã£o do repositÃ³rio para publicaÃ§Ã£o no GitHub
- PreparaÃ§Ã£o do projeto para versionamento e distribuiÃ§Ã£o consistentes

---

## [1.0.1] - 2026-01-25
### ðŸ”§ ManutenÃ§Ã£o, RefatoraÃ§Ã£o e CorreÃ§Ãµes

#### â™»ï¸ RefatoraÃ§Ã£o
- ConsolidaÃ§Ã£o de `denunciaButtons.js`: funcionalidades movidas para `commands/denuncia.js`
- RemoÃ§Ã£o de arquivos nÃ£o utilizados ou redundantes:
  - `utils/performance.js`
  - `utils/monitoring.js`
  - `utils/commands.js`
  - `utils/templateProcessor.js`
  - `services/notificationService.js`
  - `buttons/denunciaButtons.js`

#### ðŸ› CorreÃ§Ãµes
- CorreÃ§Ã£o do aviso deprecated do Discord.js:  
  `ephemeral` â†’ `flags: [MessageFlags.Ephemeral]`
  - `Handlers/handlerStatusButton.js` (inclui `safeDefer`)
  - `jobs/rankJobs.js`
  - `commands/painel.js`
- CorreÃ§Ã£o de imports ausentes em `Handlers/interactionHandler.js`
- RemoÃ§Ã£o de handlers nÃ£o implementados (`atualizar`, `detalhe`)

#### ✨ Melhorias
- CÃ³digo mais limpo e organizado
- ReduÃ§Ã£o de avisos de deprecaÃ§Ã£o
- Melhor separaÃ§Ã£o de responsabilidades

---

## [1.0.0] - 2026-01-25
### ðŸŽ‰ LanÃ§amento Inicial

#### ✨ Adicionado
- Sistema completo de denÃºncias com organizaÃ§Ã£o automÃ¡tica em threads
- BotÃµes interativos (PC, Mobile, Minhas DenÃºncias, CorreÃ§Ã£o)
- Modal de criaÃ§Ã£o de denÃºncia
- Modal de aplicaÃ§Ã£o de puniÃ§Ã£o
- Sistema de reivindicaÃ§Ã£o de denÃºncias
- Sistema de anÃ¡lise
- Aceitar / Recusar denÃºncia
- ExportaÃ§Ã£o de denÃºncias (HTML + ZIP)
- BotÃ£o **Finalizar** (exporta, tranca e arquiva o tÃ³pico)
- Sistema de correÃ§Ã£o (`!correcao` + botÃ£o)
- Painel de configuraÃ§Ã£o do servidor (`!painel`)
- Ranking mensal (`!rank`)
- Ranking semanal (`!semana`)
- Logs centralizados e auditÃ¡veis
- IntegraÃ§Ã£o com MongoDB
- Deploy preparado para SquareCloud

#### ðŸ›¡ï¸ SeguranÃ§a
- Tratamento de `Unknown interaction (10062)`
- Tratamento de `InteractionNotReplied`
- Tratamento de DM bloqueada (`50007`)
- ProteÃ§Ã£o contra cliques duplicados
- ValidaÃ§Ã£o de permissÃµes por cargo

---

## [Unreleased]
- Melhorias visuais
- InternacionalizaÃ§Ã£o (EN)
- MÃ©tricas avanÃ§adas
