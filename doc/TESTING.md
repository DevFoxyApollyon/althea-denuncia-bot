# 🧪 ALTHEA - Guia de Testes

## Índice

- [Configuração de Testes](#configuração-de-testes)
- [Testes Manuais](#testes-manuais)
- [Testes de Comandos](#testes-de-comandos)
- [Testes de Botões](#testes-de-botões)
- [Testes de Banco de Dados](#testes-de-banco-de-dados)
- [Testes de Performance](#testes-de-performance)
- [Troubleshooting](#troubleshooting)

---

## Configuração de Testes

### Ambiente de Teste

```bash
# 1. Criar um servidor Discord de testes
# - Crie um novo servidor no Discord
# - Configure com um número pequeno de canais
# - Adicione seu bot com permissões completas

# 2. Variáveis de Ambiente para Testes
NODE_ENV=development
DEBUG=*

# 3. Usar banco de dados separado
MONGODB_URI=mongodb+srv://usuario:senha@seu-cluster.mongodb.net/althea-test
```

### Requisitos

- Bot Discord com todas as permissões
- Servidor de testes com canais configurados
- MongoDB com database separada para testes (`althea-test`)
- Node.js 18+ instalado

---

## Testes Manuais

### 1️⃣ Teste de Conexão

**Objetivo**: Verificar se o bot conecta corretamente

**Passos**:
1. Inicie o bot: `npm run dev`
2. Verifique se o bot aparece online no Discord
3. Verifique se não há erros no console
4. Confirme conexão com MongoDB

**Resultado Esperado**:
```
✅ Bot conectado com sucesso!
✅ Conectado aos servidores
🔄 Comandos carregados
```

---

### 2️⃣ Teste de Painel de Configuração

**Objetivo**: Configurar o bot para funcionamento básico

**Passos**:
1. Execute `!painel` no servidor de testes
2. Configure todos os campos:
   - Cargos administrativos
   - Cargos responsáveis
   - Canal PC
   - Canal Mobile
   - Canal de Logs
   - Canal de Análise
3. Salve a configuração

**Resultado Esperado**:
- Painel aparece sem erros
- Todos os fields estão editáveis
- Confirmação de salvamento aparece
- Dados aparecem no MongoDB

---

## Testes de Comandos

### Comando: `!denuncia`

**Objetivo**: Testar abertura do painel de denúncias

| Teste | Passos | Esperado |
|-------|--------|----------|
| **Painel Abre** | Execute `!denuncia` | Painel com botões aparece |
| **Botões Visíveis** | Visualize o painel | PC, Mobile, Minhas Denúncias visíveis |
| **Clique PC** | Clique em "Denúncia PC" | Modal de denúncia abre |
| **Clique Mobile** | Clique em "Denúncia Mobile" | Modal de denúncia abre |
| **Clique Minhas** | Clique em "Minhas Denúncias" | Lista de denúncias (ou vazio) |

---

### Comando: `!painel`

**Objetivo**: Testar configuração do servidor

| Teste | Passos | Esperado |
|-------|--------|----------|
| **Admin Only** | Use sem ser admin | Erro "Você não tem permissão" |
| **Como Admin** | Execute sendo admin | Painel de configuração abre |
| **Salvar Config** | Configure e salve | Dados salvos no banco |
| **Persistência** | Reinicie bot | Configuração mantém-se |

---

### Comando: `!rank`

**Objetivo**: Testar ranking mensal

| Teste | Passos | Esperado |
|-------|--------|----------|
| **Sem Dados** | Execute sem ações | Mensagem "Nenhum dado" |
| **Com Dados** | Crie ações e execute | Top 10 mostra com ranking |
| **Formatação** | Visualize output | Rankings bem formatados |

---

### Comando: `!semana`

**Objetivo**: Testar ranking semanal

| Teste | Passos | Esperado |
|-------|--------|----------|
| **Sem Dados** | Execute sem ações | Mensagem "Nenhum dado" |
| **Com Dados** | Crie ações e execute | Top 10 semanal |
| **Diferença** | Compare com `!rank` | `!semana` mostra dados diferentes |

---

## Testes de Botões

### Botão: Denúncia PC

**Objetivo**: Testar criação de denúncia de PC

**Passos**:
1. Clique em "Denúncia PC"
2. Preencha o modal:
   - Plataforma: PC
   - Descrição: Teste de denúncia
   - Evidências: Descrição de evidências
3. Envie o modal

**Resultado Esperado**:
- Tópico criado no canal PC
- Título inclui ID da denúncia
- Mensagens embarcadas aparecem
- Denúncia registrada no MongoDB

---

### Botão: Denúncia Mobile

**Objetivo**: Testar criação de denúncia de Mobile

**Passos**:
1. Clique em "Denúncia Mobile"
2. Preencha com dados válidos
3. Envie

**Resultado Esperado**:
- Tópico criado no canal Mobile
- Status: "Pendente"
- Criador identificado
- Campo plataforma = "Mobile"

---

### Botão: Reivindicar

**Objetivo**: Testar reivindicação de denúncia

**Passos**:
1. Crie uma denúncia
2. Clique em "Reivindicar" no tópico
3. Confirme ação

**Resultado Esperado**:
- Status muda para "Reivindicada"
- Seu nome aparece como responsável
- Log registra a ação
- Embed atualiza

---

### Botão: Aceitar

**Objetivo**: Testar aceitação de denúncia

**Passos**:
1. Reivindicar uma denúncia
2. Clique em "Aceitar"
3. Preencha modal com punição
4. Confirme

**Resultado Esperado**:
- Status muda para "Aceita"
- Embed mostra resultado
- Log registra: quem aceitou, quando, motivo
- Tópico archiva (opcional)

---

### Botão: Recusar

**Objetivo**: Testar recusa de denúncia

**Passos**:
1. Reivindicar uma denúncia
2. Clique em "Recusar"
3. Preencha motivo
4. Confirme

**Resultado Esperado**:
- Status muda para "Recusada"
- Motivo aparece no embed
- Log registra ação
- Notificação enviada ao denunciante

---

### Botão: Corrigir

**Objetivo**: Testar correção de denúncia

**Passos**:
1. Abra uma denúncia existente
2. Clique em "Corrigir"
3. Altere informações
4. Salve

**Resultado Esperado**:
- Denúncia atualiza com novas info
- Histórico de edições mantém-se
- Log registra quem e quando editou
- Sem criação de duplicata

---

### Botão: Finalizar

**Objetivo**: Testar exportação e arquivamento

**Passos**:
1. Complete uma denúncia
2. Clique em "Finalizar"
3. Escolha formato (ZIP/HTML)
4. Envie

**Resultado Esperado**:
- Arquivo gerado com sucesso
- Download disponível
- Tópico archivado
- Denúncia marcada como finalizada
- Log registra exportação

---

## Testes de Banco de Dados

### Teste: Conectividade MongoDB

**Comando**:
```bash
# Testar conexão
mongosh "mongodb+srv://usuario:senha@cluster.mongodb.net/althea-test"
```

**Esperado**:
```
> Successfully connected to MongoDB
```

---

### Teste: Collections Criadas

**Verificar**:
1. Database: `althea-test`
2. Collections esperadas:
   - `configs` - Configurações por servidor
   - `denuncias` - Denúncias criadas
   - `moderationactions` - Ações de staff

**Comando**:
```bash
show collections
```

---

### Teste: Dados Persistem

**Passos**:
1. Crie uma denúncia
2. Reinicie o bot
3. Verifique se denúncia aparece em `!minhas-denuncias`

**Esperado**:
- Denúncia visível após reinicialização
- Dados íntegros no banco

---

## Testes de Performance

### Teste: Latência de Comandos

**Objetivo**: Medir tempo de resposta

**Método**:
1. Execute comando
2. Anote timestamp inicial
3. Resposta aparece
4. Anote timestamp final
5. Calcule diferença

**Esperado**:
- `!rank`: < 2 segundos
- `!denuncia`: < 1 segundo
- `!painel`: < 1 segundo
- Criar denúncia: < 3 segundos

---

### Teste: Carga Alta

**Objetivo**: Testar com muitas denúncias

**Passos**:
1. Crie 50+ denúncias rapidamente
2. Execute `!rank`
3. Monitore memória e CPU

**Esperado**:
- Bot não trava
- Respostas ainda rápidas
- Sem memory leaks
- Sem erro de timeout

---

## Troubleshooting

### Bot não responde aos comandos

**Causas possíveis**:
1. Token inválido
2. Intents não configurados
3. Bot sem permissões

**Solução**:
```bash
# Verificar intents no Developer Portal
# Restartar bot: npm run dev
# Verificar logs: console.log()
```

---

### Modal não abre

**Causas possíveis**:
1. Timeout de interação (3 segundos)
2. Erro em handler
3. DM bloqueada

**Solução**:
```bash
# Verifique logs
# Tente novamente em 3 segundos
# Desbloqueie DMs do bot
```

---

### Denúncia não cria tópico

**Causas possíveis**:
1. Canal não configurado
2. Bot sem permissão `CREATE_PUBLIC_THREADS`
3. Limite de threads atingido

**Solução**:
```bash
# Configurar canal: !painel
# Verificar permissões
# Usar outro canal
```

---

### Erro de Banco de Dados

**Causas possíveis**:
1. Conexão perdida
2. IP não na whitelist
3. Credenciais inválidas

**Solução**:
```bash
# Testar URI: mongosh "URI"
# Adicionar IP à whitelist
# Regenerar credenciais
```

---

## Checklist de Testes Completos

- [ ] Bot conecta ao Discord
- [ ] Painel de configuração funciona
- [ ] `!denuncia` abre painel
- [ ] Criar denúncia PC
- [ ] Criar denúncia Mobile
- [ ] Visualizar minhas denúncias
- [ ] Reivindicar denúncia
- [ ] Aceitar denúncia
- [ ] Recusar denúncia
- [ ] Corrigir denúncia
- [ ] Finalizar denúncia
- [ ] `!rank` funciona
- [ ] `!semana` funciona
- [ ] Dados persistem no banco
- [ ] Performance adequada
- [ ] Logs registram ações
- [ ] Sem erros não tratados
- [ ] Rate limiting funciona

---

**Última atualização**: Janeiro de 2026  
**Versão**: 1.0.0  
**Responsável**: Foxy Apollyon
