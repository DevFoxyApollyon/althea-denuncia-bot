# 📚 ALTHEA - Índice de Documentação

Bem-vindo à documentação completa do **ALTHEA**! Use este índice para navegar por todos os documentos.

---

## 🗂️ Estrutura da Documentação

```
doc/
├── INDEX.md              👈 Você está aqui
├── README.md             📖 Guia principal do projeto
├── CHANGELOG.md          📝 Histórico de versões
├── TESTING.md            🧪 Guia de testes
├── DB_MODELS.md          💾 Modelos do banco de dados
├── FLOW.md               🔄 Fluxo de denúncias
└── BUTTONS.md            🔘 Referência de botões
```

---

## 📖 Guias Principais

### 1. **[README.md](../README.md)** - Guia Principal
**Para**: Começar do zero com o projeto

**Contém**:
- ✅ O que é ALTHEA
- ✅ Recursos principais
- ✅ Pré-requisitos
- ✅ Instalação rápida
- ✅ Configuração inicial
- ✅ Comandos disponíveis
- ✅ Estrutura do projeto
- ✅ Troubleshooting básico

**Leia se**:
- Está instalando o bot
- Quer visão geral do projeto
- Precisa de setup rápido

---

### 2. **[.env.example](../.env.example)** - Configuração de Variáveis
**Para**: Configurar credenciais e conexões

**Contém**:
- ✅ Variáveis Discord (TOKEN, GUILD_ID, etc)
- ✅ Configuração MongoDB
- ✅ Como obter cada credencial
- ✅ Dicas de segurança
- ✅ Troubleshooting de conexão

**Leia se**:
- Está configurando o bot
- Tem erro de conexão
- Não sabe onde obter tokens

---

## 🧪 Testes e Qualidade

### 3. **[TESTING.md](./TESTING.md)** - Guia de Testes
**Para**: Testar todas as funcionalidades

**Contém**:
- ✅ Configuração de ambiente de testes
- ✅ Testes manuais por feature
- ✅ Testes de comandos (!denuncia, !painel, etc)
- ✅ Testes de botões interativos
- ✅ Testes de banco de dados
- ✅ Testes de performance
- ✅ Troubleshooting de testes
- ✅ Checklist de testes completos

**Leia se**:
- Quer testar o bot
- Fez alterações no código
- Quer garantir qualidade
- Está debugando um problema

---

## 💾 Banco de Dados

### 4. **[DB_MODELS.md](./DB_MODELS.md)** - Modelos de Dados
**Para**: Entender a estrutura do MongoDB

**Contém**:
- ✅ Schema de `Config` (configurações por servidor)
- ✅ Schema de `Denuncia` (denúncias)
- ✅ Schema de `ModerationAction` (ações de staff)
- ✅ Índices do banco
- ✅ Relacionamentos entre collections
- ✅ Exemplos de documentos
- ✅ Consultas úteis

**Leia se**:
- Quer entender como dados são armazenados
- Está desenvolvendo nova feature
- Precisa fazer queries no banco
- Está debugando dados

---

## 🔄 Fluxos e Workflows

### 5. **[FLOW.md](./FLOW.md)** - Fluxo de Denúncias
**Para**: Entender como denúncias são processadas

**Contém**:
- ✅ Fluxo completo de uma denúncia
- ✅ Estados e transições
- ✅ Quem pode fazer o quê
- ✅ Diagrama de workflow
- ✅ Casos especiais
- ✅ Integração com logs
- ✅ Permissões em cada etapa

**Leia se**:
- Quer entender como denúncias funcionam
- Está implementando nova lógica
- Quer visualizar o workflow completo
- Precisa documentar processo

---

## 🔘 Interface do Usuário

### 6. **[BUTTONS.md](./BUTTONS.md)** - Referência de Botões
**Para**: Documentação de botões e modais

**Contém**:
- ✅ Todos os botões disponíveis
- ✅ O que cada botão faz
- ✅ Modais e seus campos
- ✅ Respostas esperadas
- ✅ Tratamento de erros
- ✅ Permissões necessárias
- ✅ Exemplos de uso

**Leia se**:
- Quer entender interface
- Está desenvolvendo novo botão
- Precisa documentar UX
- Quer testar botões

---

## 📝 Histórico e Versões

### 7. **[CHANGELOG.md](./CHANGELOG.md)** - Histórico de Versões
**Para**: Acompanhar mudanças do projeto

**Contém**:
- ✅ Todas as versões lançadas
- ✅ Novas features por versão
- ✅ Bug fixes
- ✅ Breaking changes
- ✅ Datas de release
- ✅ Contribuidores
- ✅ Roadmap futuro

**Leia se**:
- Quer ver histórico de atualizações
- Procura quando um bug foi corrigido
- Quer entender evolução do projeto
- Está planejando upgrade

---

## 🚀 Guia Rápido por Caso de Uso

### Quero **instalar o bot**
1. Leia [README.md - Instalação Rápida](../README.md#-instalação-rápida)
2. Configure [.env.example](../.env.example)
3. Execute: `npm install && npm start`

---

### Quero **configurar no servidor Discord**
1. Leia [README.md - Configuração](../README.md#-configuração)
2. Execute: `!painel` no servidor
3. Preencha todas as seções
4. Consulte [FLOW.md](./FLOW.md) para entender fluxo

---

### Quero **testar o bot**
1. Leia [TESTING.md](./TESTING.md#configuração-de-testes)
2. Configure ambiente de testes
3. Siga checklist de testes
4. Reporte problemas no GitHub

---

### Quero **entender como funciona**
1. Leia [README.md - Recursos](../README.md#-recursos-principais)
2. Estude [FLOW.md](./FLOW.md) (fluxo)
3. Consulte [DB_MODELS.md](./DB_MODELS.md) (dados)
4. Visualize [BUTTONS.md](./BUTTONS.md) (interface)

---

### Quero **adicionar nova feature**
1. Leia [FLOW.md](./FLOW.md) (fluxo atual)
2. Consulte [DB_MODELS.md](./DB_MODELS.md) (estrutura dados)
3. Estude [BUTTONS.md](./BUTTONS.md) (interface)
4. Use [TESTING.md](./TESTING.md) (teste sua feature)
5. Atualize [CHANGELOG.md](./CHANGELOG.md)

---

### Quero **debugar um problema**
1. Verifique [README.md - Troubleshooting](../README.md#-troubleshooting)
2. Consulte [TESTING.md - Troubleshooting](./TESTING.md#troubleshooting)
3. Analise [DB_MODELS.md](./DB_MODELS.md) (se é problema de dados)
4. Revise [FLOW.md](./FLOW.md) (se é problema de lógica)
5. Abra issue no GitHub

---

### Quero **ver histórico de mudanças**
1. Consulte [CHANGELOG.md](./CHANGELOG.md)
2. Procure versão e features
3. Veja commits relacionados no GitHub

---

## 📊 Mapa Mental da Documentação

```
ALTHEA Documentation
├── Para Começar
│   ├── README.md (visão geral)
│   └── .env.example (setup)
│
├── Para Usar
│   ├── FLOW.md (como funciona)
│   ├── BUTTONS.md (o que clicais)
│   └── TESTING.md (como testar)
│
├── Para Desenvolver
│   ├── DB_MODELS.md (dados)
│   ├── FLOW.md (lógica)
│   └── TESTING.md (validar)
│
└── Para Manter
    ├── CHANGELOG.md (histórico)
    ├── TESTING.md (QA)
    └── README.md (docs)
```

---

## 🔍 Buscar Documentação

**Por Tópico**:
- **Discord/Bots**: Leia [README.md](../README.md)
- **Banco de Dados**: Consulte [DB_MODELS.md](./DB_MODELS.md)
- **Workflow**: Estude [FLOW.md](./FLOW.md)
- **Testes**: Veja [TESTING.md](./TESTING.md)
- **Botões**: Revise [BUTTONS.md](./BUTTONS.md)
- **Atualizações**: Confira [CHANGELOG.md](./CHANGELOG.md)

**Por Palavra-chave**:
| Termo | Documento |
|-------|-----------|
| MongoDB | DB_MODELS.md, README.md |
| Denúncia | FLOW.md, BUTTONS.md |
| Teste | TESTING.md |
| Configuração | .env.example, README.md |
| Erro | README.md, TESTING.md |
| Feature | CHANGELOG.md |
| Botão | BUTTONS.md |
| API | DB_MODELS.md |

---

## ❓ Perguntas Frequentes Documentadas

| Pergunta | Resposta Em |
|----------|-------------|
| Como instalar? | README.md #instalação-rápida |
| Como configurar? | README.md #configuração |
| Qual token usar? | .env.example |
| Como testar? | TESTING.md |
| Estrutura BD? | DB_MODELS.md |
| Como funciona? | FLOW.md |
| Quais botões? | BUTTONS.md |
| O que mudou? | CHANGELOG.md |

---

## 📞 Onde Pedir Ajuda

**Documentação**:
- Leia este INDEX.md primeiro
- Procure o documento relevante
- Use busca por palavra-chave

**Problemas**:
- Consulte [README.md - Troubleshooting](../README.md#-troubleshooting)
- Confira [TESTING.md - Troubleshooting](./TESTING.md#troubleshooting)

**Suporte**:
- Abra [Issue no GitHub](https://github.com/DevFoxyApollyon/althea-denuncia-bot/issues)
- Contate: [@FoxyApollyon](https://discord.com/users/657014871228940336)

---

## 🔗 Links Rápidos

**Arquivos Principais**:
- [README.md](../README.md) - Guia principal
- [package.json](../package.json) - Dependências
- [.env.example](../.env.example) - Configuração

**Código Fonte**:
- [commands/](../commands/) - Comandos do bot
- [Handlers/](../Handlers/) - Manipuladores
- [models/](../models/) - Schemas MongoDB
- [utils/](../utils/) - Utilitários

**GitHub**:
- [Repositório](https://github.com/DevFoxyApollyon/althea-denuncia-bot)
- [Issues](https://github.com/DevFoxyApollyon/althea-denuncia-bot/issues)
- [Releases](https://github.com/DevFoxyApollyon/althea-denuncia-bot/releases)

---

## 📈 Status da Documentação

| Documento | Status | Última Atualização |
|-----------|--------|-------------------|
| README.md | ✅ Completo | Jan 2026 |
| .env.example | ✅ Completo | Jan 2026 |
| TESTING.md | ✅ Completo | Jan 2026 |
| FLOW.md | ✅ Completo | Jan 2026 |
| DB_MODELS.md | ✅ Completo | Jan 2026 |
| BUTTONS.md | ✅ Completo | Jan 2026 |
| CHANGELOG.md | ✅ Completo | Jan 2026 |
| INDEX.md | ✅ Completo | Jan 2026 |

---

## 🎯 Próximos Passos

1. **Primeiro acesso?**
   → Leia [README.md](../README.md)

2. **Configurando o bot?**
   → Preencha [.env.example](../.env.example)

3. **Primeira execução?**
   → Siga [TESTING.md](./TESTING.md)

4. **Desenvolvendo?**
   → Consulte [FLOW.md](./FLOW.md) + [DB_MODELS.md](./DB_MODELS.md)

5. **Vendo histórico?**
   → Confira [CHANGELOG.md](./CHANGELOG.md)

---

**Versão da Documentação**: 1.0.0  
**Última atualização**: 25 de Janeiro de 2026  
**Responsável**: Foxy Apollyon  
**Contato**: [@FoxyApollyon](https://discord.com/users/657014871228940336)

---

**Aproveite a documentação! 🎉**

Se encontrar algo faltando ou desatualizado, abra uma [issue no GitHub](https://github.com/DevFoxyApollyon/althea-denuncia-bot/issues).
