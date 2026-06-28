// DB_MODELS.md

# 📗 Modelos do Banco de Dados (MongoDB)

> **📝 v1.2.1:** Nenhuma alteração nos modelos. Estrutura consolidada para v1.2.1.

---
 
## 📄 Config

Collection responsável por **configurar o bot por servidor**.

### Campos principais:
```javascript
{
  guildId: String,           // ID do servidor Discord
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
- `!rank` — ranking mensal
- `!semana` — ranking semanal
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

**Última atualização:** v1.2.1
