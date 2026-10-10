# 📋 Changelog

Todas as mudanças relevantes deste projeto serão documentadas neste arquivo.

Este projeto segue o padrão de versionamento semântico (SemVer).

---

## [3.3.0] - 2026-10-10
### ✨ Novidades
**Portal web (site)**
- Site de denúncias com login pelo Discord: abrir denúncia, enviar provas (com prévia e progresso), acompanhar o caso em tempo real e avaliar o atendimento.
- Áreas separadas para jogador, staff e responsável, com escolha de servidor ao clicar na logo.
- Painel da staff: fila por prioridade e prazo (SLA), ações do caso, notas internas, respostas prontas e perfil do jogador com reincidência.
- Painel do responsável: visão geral, números, ranking (mesmos dados do `/rank`), auditoria e configurações de categorias, prazos e respostas prontas.
- Teste da staff: o responsável monta o teste (vídeo do YouTube, perguntas e alternativas) e a staff responde pelo site; a correção é feita no servidor.
- Chat por servidor: abas de conversa e avisos, respostas, reações, menções (`@nome` e `@all`), envio de imagem, áudio e vídeo, aviso fixado, música (YouTube/Spotify), lista de quem está online e sons.
- Moderação do chat: apagar mensagem, castigo com tempo e motivo, banimento, modo lento, chat fechado, castigo automático por flood e fila de mensagens sinalizadas, tudo registrado na auditoria.
- Notificações do navegador (Web Push) para novidades nos casos e menções no chat.
- Categorias das denúncias reconhecidas pelo motivo (39 categorias em grupos), alerta de denúncia duplicada e rascunho salvo.
- Denúncias abertas: quem é acusado pode se identificar pelo site.
- Páginas de termos de serviço, política de privacidade e política de cookies, com aviso de cookies.

**Bot**
- Os botões da denúncia acompanham a situação: o que já foi feito (reivindicar, analisar, aceitar, recusar) fica desativado, também quando a ação vem do site.
- O denunciante recebe mensagem direta quando a denúncia é reivindicada; o acusado identificado recebe quando ela é aceita e quando há mensagem nova no tópico.
- Se a mensagem direta de arquivamento falhar por causa do anexo, o aviso é reenviado sem ele e o erro real fica no log.
- Comandos de barra `/rank`, `/painel`, `/status` e `/denuncia` (os comandos com `!` continuam funcionando).
- ESLint (`npm run lint`) e testes automatizados (`npm test`).

### 🔧 Correções
- Lista do responsável mostrava as denúncias de todos os servidores em vez de só o servidor escolhido.
- A nota de avaliação do atendimento não era gravada.
- O bot esperava a preparação dos bancos para entrar no Discord; agora entra logo e aplica os prazos em segundo plano.
- O site consultava o Discord a cada requisição para saber os cargos; passa a usar a memória do bot, com cache de 1 minuto.
- O reset mensal do ranking agora move as ações antigas para `moderationactions_arquivo` em vez de apagar tudo.
- O cooldown de reivindicação passa a valer mesmo depois de um restart do bot.
- O painel de status mostrava latência do banco, comandos e erros sempre zerados.
- Sincronização de nickname com mais de um ID em `BOT_ALVO_ID`.
- Datas do model `Denuncia` eram trocadas pelo horário atual ao serem gravadas.
- Erro escondido no auto-finalizador quando a finalização de uma denúncia falhava.
- `uuid` era usado sem estar declarado no `package.json`.

### 🧱 Estrutura
- Regras de retenção por coleção em `utils/retencaoDados.js`: configurações e cadastros são permanentes; denúncias e suas mensagens duram 45 dias, ações da staff 30 dias, acessos 15 dias, strikes 24 horas e o restante 6 meses.
- `utils/persistencia.js` define em qual banco cada modelo fica: tudo no principal, exceto vínculo Discord/ID do jogo, notificações e sugestões (secundário).
- `npm run bancos` lista o conteúdo dos dois bancos (somente leitura) e `npm run pacote` gera o zip para a SquareCloud.
- Segurança do site: sessão assinada, verificação de origem, política de conteúdo (CSP) sem scripts embutidos, limites de requisição e validação do conteúdo dos arquivos enviados.
- Nova dependência: `web-push`.
- Cache único de configurações (`utils/configCache.js`), invalidado automaticamente ao salvar.
- Mensagens dos tópicos gravadas na coleção `DenunciaMensagem` (denúncias antigas continuam sendo lidas do formato anterior).
- Novos índices em `Denuncia` e índice único `{ guildId, userId }` em `Usuario`.
- Validação de todas as variáveis do `.env` na inicialização.
- `handlerStatusButton.js` dividido em `Handlers/statusDenuncia/`.
- Removidos módulos sem uso e as dependências `googleapis`, `limiter` e `uuid`.

---

## [3.2.3] - 2026-09-09
### 🔧 Correção do painel
- Corrigido o processamento dos modais de Canais Externos e Canal de Provas.
- Os IDs de `registro`, `cloud`, `canalDenuncia` e `databaseprovas` agora são salvos corretamente.

---

## [3.2.2] - 2026-09-09
### 🔧 Correção de publicação
- Nova release para garantir que o deploy carregue os handlers de PC, Mobile e envio de formulário da denúncia.
- Atualização da versão exibida no startup do bot para facilitar a conferência do deploy.

---

## [3.2.1] - 2026-09-09
### 🚀 Sistema de denúncias, arquivamento e persistência

#### ✨ Novidades
- Mensagem fixa de abertura de denúncias com botões para PC, Mobile e consulta.
- Configuração dos canais externos `registro` e `cloud` para armazenar denúncias e exportações.
- Persistência das mensagens, anexos, embeds, edições e exclusões das denúncias no banco de dados.
- Menu de feedback integrado diretamente à mensagem principal da denúncia.
- Registro de mensagens da thread no banco em tempo real.

#### 🔧 Ajustes
- Exportação manual alinhada ao AutoFinalizador, com divisão por partes e limite de upload do servidor Cloud.
- AutoFinalizador direcionado ao canal Cloud, com compatibilidade para configurações antigas.
- Painel administrativo ampliado para configurar canais externos e canal fixo de denúncias.
- Limpeza do feedback passa a remover apenas o menu, preservando a mensagem original.

---

## [3.1.0] - 2026-08-16
### 🚀 Atualizações de funcionalidade do ALTHEA

#### ✨ Novidades
- Sistema de restrição de tópicos por denunciante e acusados
- Sincronização automática de nickname e restauração de perfil ao entrar no servidor
- Finalização automática de denúncias sem resposta após prazo definido
- Melhor monitoramento de mensagens com links proibidos, emojis e encaminhamentos
- Fluxo mais robusto de exportação, arquivamento e envio de logs da denúncia
- Revisão dos módulos de automação para maior estabilidade e memória segura em produção

#### 🔧 Ajustes
- Atualização da documentação do projeto para refletir as funcionalidades ativas do bot
- Organização e reforço dos módulos de finalização, monitoramento e sincronização
- Ajustes de compatibilidade para execução com uso real em servidores Discord ativos

---

## [3.0.0] - 2026-08-16
### 🚀 Evolução principal do ALTHEA

#### ✨ Novidades
- Atualização geral da documentação do projeto para a release 3.0
- Melhor organização da estrutura do bot e dos módulos de automação
- Refino no sistema de denúncias, arquivamento e finalização automática
- Melhor suporte a tópicos restritos, sincronização de nicknames e monitoramento
- Ajustes de estabilidade para produção com processamento mais robusto
- Manutenção e revisão de fluxos críticos do bot e da exportação de dados

#### 🔧 Ajustes
- Padronização de nomenclatura e documentação de módulos
- Revisão do fluxo de finalização e exportação de tópicos
- Redução de riscos operacionais em rotinas automáticas do sistema

---

## [1.2.1] - 2026-06-27
### 📝 Documentação e preparação de release

#### ✨ Atualizações
- Ajuste de documentação de fluxo, botões e modelos para a release 1.2.1
- Organização do repositório para publicação no GitHub
- Preparação do projeto para versionamento e distribuição consistentes

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
- Redução de avisos de depreciação
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