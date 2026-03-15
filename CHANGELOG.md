# 📦 Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

Este projeto segue o padrão de versionamento semântico (SemVer).

---

## [1.1.0] - 2026-03-15
### 🚀 Novidades e Melhorias

#### 🛡️ Filtro de YouTube e Palavrões
- Mensagens com links do YouTube cujo título contenha palavras proibidas (ex: “hl”) agora são automaticamente filtradas e removidas em canais de denúncia.
- Sistema de detecção de palavrões e menções indevidas, com aplicação automática de strikes.

#### 🗄️ Dois Bancos de Dados
- Integração com banco de dados principal e secundário para maior segurança e performance.
- Sincronização automática de nicknames e dados dos usuários entre os bancos.

#### 📩 Notificação de Acusado
- O acusado recebe uma mensagem privada detalhada sempre que for denunciado, incluindo motivo, provas e link direto para a denúncia.
- Busca inteligente do acusado tanto por número quanto por userId, garantindo que a notificação chegue mesmo se o campo “conta” for diferente.

#### 🔄 Sincronização de Nickname
- Sempre que um usuário troca o nickname no Discord, o sistema atualiza automaticamente o registro no banco de dados.

#### 🧵 Registro do Último Tópico
- O sistema salva o ID do último tópico de denúncia criado pelo usuário, facilitando consultas e histórico.

#### 🛠️ Ajustes Gerais
- Organização e padronização do código.
- Correção de imports duplicados.
- Atualização para uso correto de respostas efêmeras (flags: [MessageFlags.Ephemeral]).
- Melhoria na documentação e estrutura do projeto.

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
