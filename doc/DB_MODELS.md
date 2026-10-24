// DB_MODELS.md

# 📗 Modelos do Banco de Dados (MongoDB)

> O model `Config` usa `MONGODB_URI` (banco principal); os demais models usam
> `SECONDARY_DB_URI`. Consulte a seção de retenção antes de publicar esta alteração.

---
 
## 📄 Config

Collection responsável por **configurar o bot por servidor**.

`bloquearReivindicacaoComPendentes` é ativado por padrão e pode ser ligado ou desligado individualmente no painel de cada servidor.

### Campos principais:
```javascript
{
  guildId: String,           // ID do servidor Discord
  bloquearReivindicacaoComPendentes: Boolean, // Bloqueia reivindicações enquanto houver denúncias anteriores pendentes
  roles: {
    administrador: String,   // ID do cargo admin
    responsavel_admin: String // ID do cargo responsável
  },
  channels: {
    pc: String,              // ID do canal de denúncias PC
    mobile: String,          // ID do canal de denúncias Mobile
    logs: String,            // ID do canal de logs
    analysis: String         // ID do canal de análise
  }
}
```

**Usado em:**
- Permissões de acesso
- Envio de logs
- Criação de denúncias
- Configuração do painel

---

## 📄 Denuncia

Collection principal que armazena **denúncias**.

### Campos principais:
```javascript
{
  _id: ObjectId,
  guildId: String,           // Servidor
  userId: String,            // ID de quem criou
  username: String,          // Nome do autor
  plataforma: String,        // "PC" ou "Mobile"
  conteudo: String,          // Descrição
  status: String,            // "reivindicada", "em_analise", "aceita", "recusada"
  threadId: String,          // ID do tópico
  logMessage: String,        // ID da mensagem de log
  data_criacao: Date,
  data_atualizacao: Date,
  responsavel: String,       // ID de quem analisou
  resultado: String,         // Resultado final
  punicao: String            // Tipo de punição aplicada
}
```

---

## 📄 ModerationAction

Collection que registra **ações de moderação** para ranking.

### Campos principais:
```javascript
{
  _id: ObjectId,
  guildId: String,
  moderatorId: String,       // ID do staff
  moderatorName: String,
  action: String,            // "aceitar", "recusar", "analisar"
  denunciaId: ObjectId,
  timestamp: Date
}
```

**Usado em:**
- `!rank` — ranking principal
- `rankService.js` — lógica de cálculo

---

## 📄 Usuario

Collection que armazena **dados de usuários**.

### Campos principais:
```javascript
{
  _id: ObjectId,
  userId: String,            // ID Discord
  username: String,
  guildId: String,
  nickname: String,          // Nickname do servidor
  createdAt: Date,
  updatedAt: Date,
  strikes: Number            // Contador de infrações
}
```

---

## 📄 Strike

Collection que registra **infrações/strikes**.

### Campos principais:
```javascript
{
  _id: ObjectId,
  userId: String,
  guildId: String,
  motivo: String,
  data: Date,
  moderador: String          // ID de quem aplicou
}
```

---

## 📄 DenunciaMensagem

Collection com as **mensagens dos tópicos de denúncia** (uma por documento).
Substitui o array `mensagens` que ficava dentro de `Denuncia`; denúncias criadas
antes da mudança continuam com o array embutido e são lidas dele.

### Campos principais:
```javascript
{
  denunciaId: ObjectId,      // referência à Denuncia
  guildId: String,
  threadId: String,
  mensagemId: String,        // único por thread
  autorId: String,
  autorNome: String,
  conteudo: String,
  dataCriacao: Date,
  editadaEm: Date,
  apagadaEm: Date,
  anexos: [{ id, nome, url, tipo, tamanho }],
  embeds: Array,
  espelhos: [{ threadId, messageId }],
  expiraEm: Date             // prazo funcional; a retenção geral usa dataRetencaoAte
}
```

---

## 📄 moderationactions_arquivo

Cópia das ações de `ModerationAction` dos meses anteriores. É preenchida pelo
reset mensal do ranking (dia 1, 00:05), que move as ações antigas para cá.

---

## 📄 FeedbackTemp

Collection que armazena **feedback temporário** de denúncias.

### Campos principais:
```javascript
{
  _id: ObjectId,
  denunciaId: ObjectId,
  userId: String,
  rating: Number,            // 1-10
  comentario: String,
  timestamp: Date
}
```

---

## 🎮 Ponte com a gamemode (banco secundário)

Protocolo em [`PONTE_GAMEMODE.md`](PONTE_GAMEMODE.md). Retenção em `utils/retencaoDados.js`.

### 📄 PonteConexaoGm (`ponteconexoesgm`, permanente)
Credencial de uma gamemode. Criada só pelo dono (`/ponte gamemode criar`).
```javascript
{
  guildId: String,
  nome: String,
  segredoCifrado: { iv, tag, dados },  // AES-256-GCM com PONTE_CHAVE_MESTRA; o texto do segredo nunca é guardado
  ultimos4: String,                    // final do segredo, para reconhecer no painel
  ipsPermitidos: [String],             // vazio = qualquer IP (o painel avisa)
  status: 'ativa' | 'revogada',
  pausada: Boolean,                    // selo inválido pausa; /ponte gamemode retomar solta
  criadoPor: String, criadoEm: Date,
  ultimoContatoEm: Date, ultimoIp: String, versaoInclude: String, modoTesteInformado: Boolean,
  revogadoEm: Date, revogadoPor: String
}
// Índice: { guildId: 1, status: 1 }
```

### 📄 PontePedidoGm (`pontepedidosgm`, 90 dias)
Um pedido por alvo enviado à gamemode. "Reenviar" um incerto cria outro com `rodada + 1`.
```javascript
{
  punicaoId, alvoId, rodada: Number, denunciaId, guildId, conexaoId,
  tipo: 'ban' | 'cadeia' | 'desbanir' | 'soltar',
  conta: Number, nick: String, tempo: Number, avisos: Number, somar: Boolean,
  motivo: String,          // ASCII, termina com " [DC]"
  aprovadoPor: String,     // nome de quem clicou em "Enviar ao jogo" (sem acento)
  teste: Boolean,          // gm.modoTeste da guild no envio
  confirmadoPor: [{ id, nome, em }],
  status: 'aprovado' | 'entregue' | 'aplicada' | 'simulada' | 'recusada' | 'erro' | 'incerto' | 'cancelado',
  codigo: String,          // código da gamemode (OK, JA_BANIDO, TIMEOUT_GAMEMODE...)
  emitidoEm: Number,       // unix (s) da entrega; entra no selo
  entregueEm: Date, leaseAte: Date, entregas: Number, devolucoes: Number,
  resultado: { nome, organizacao, conta },
  alertaIncertoEm: Date, mensagemIncerto: { canalId, msgId },
  resolvidoPor: { id, nome, em },
  criadoEm: Date
}
// Índices: único { punicaoId, alvoId, rodada }; { guildId, status, criadoEm }; { status, leaseAte }
```

### Campos novos em models existentes
- **PonteServidor:** `executor` (`pc` | `gamemode` | `ambos`, padrão `pc`) e
  `gm: { pausado, maxBanDias (30), permitirPermanente (true), maxCadeiaMin (300), maxAvisos (3), modoTeste (true) }`.
- **PontePunicao:** `executor` (`''` | `pc` | `gamemode`) e `mensagemGm: { canalId, msgId }` (embed "🎮 Punição para o jogo").
- **PonteUso.acao:** `gm_busca`, `gm_resultado`, `gm_auth_falhou`, `gm_selo_invalido`, `gm_enviar`, `gm_cancelar`,
  `gm_incerto_ok`, `gm_incerto_reenviar`, `gm_credencial`, `gm_config`.
- **Config:** `alertaMotivoCritico` (padrão `true`): marca o responsável no tópico em zaralho, dark RP, hack e mods proibidos.

---

## 🔄 Relações entre Collections

```
Config (1) ──→ (n) Denuncia
  └─ guildId

Denuncia (1) ──→ (n) ModerationAction
  └─ denunciaId

Usuario (1) ──→ (n) Strike
  └─ userId

Denuncia (1) ──→ (1) FeedbackTemp
  └─ denunciaId
```

---

## 🧹 Limpeza de Dados

As collections são criadas automaticamente na primeira execução.

Todos os documentos têm `dataRetencaoAte` e expiram seis meses após a migração
(para dados já existentes) ou após a criação (para dados novos). Isso inclui
configurações, usuários, denúncias, auditorias e dados do site. Os anexos GridFS
do chat são eliminados pelo bucket para remover também seus chunks.

Antes do primeiro deploy com esta mudança, mantenha o bot desligado e rode:

```bash
npm run db:migrar
npm run db:migrar -- --aplicar
```

A primeira execução só simula e detecta conflitos. A segunda copia as
collections (exceto `configs`) e índices não TTL, verifica os dados no destino e
preserva a origem sem apagá-la. A collection `configs` continua no banco
principal (`MONGODB_URI`); mantenha essa variável configurada na hospedagem.
Só inicie a nova versão depois de confirmar a mensagem de verificação da
migração. O MongoDB pode demorar até cerca de um minuto para remover documentos vencidos.
O MongoDB pode demorar até cerca de um minuto para remover documentos vencidos.

Para resetar:
```bash
# Conectar ao MongoDB e executar:
db.denuncias.deleteMany({})
db.configs.deleteMany({})
db.moderationactions.deleteMany({})
```

---

## 📊 Índices Recomendados

```javascript
// Para melhor performance:
db.denuncias.createIndex({ guildId: 1, status: 1 })
db.denuncias.createIndex({ userId: 1 })
db.moderationactions.createIndex({ guildId: 1, timestamp: -1 })
db.usuarios.createIndex({ userId: 1, guildId: 1 })
```

---

**Última atualização:** v3.1.0
