
# 🔘 Buttons & Interactions

Este documento descreve **TODOS os botões e modais** utilizados pelo bot, seus `customId`, permissões e handlers responsáveis.

> **📝 Nota v3.1.0:** Os handlers de botões continuam organizados em módulos dedicados, com fluxo mais estável e documentação atualizada para a release 3.1 do ALTHEA.

---

## 🔌 Botões do Painel `!denuncia`

Local: mensagem enviada pelo comando `!denuncia`  
Handler: `commands/denuncia.js` (consolidado em v1.2.1)

---

### 🖥️ `denuncia_pc`
**Função:**  
Abrir modal para criação de denúncia PC.

**Fluxo:**
- Abre modal
- Cria denúncia no MongoDB
- Cria tópico/thread no canal PC
- Publica denúncia
- Adiciona botões de staff + Finalizar

---

### 📱 `denuncia_mobile`
**Função:**  
Abrir modal para criação de denúncia Mobile.

**Fluxo:**
- Mesmo fluxo que PC
- Diferencia canal de destino

---

### 📂 `minhas_denuncias`
**Função:**  
Exibir denúncias do usuário.

**Permissão:** Qualquer membro  
**Dados:**
- Status da denúncia
- Links para tópicos
- Data de criação

---

## 🎯 Botões dentro do Tópico de Denúncia

Disponíveis após criar uma denúncia.

### 📝 `reivindicar`
**Função:** Marcar denúncia como reivindicada  
**Permissão:** Role `responsavel_admin`

### 🔎 `analisar`
**Função:** Marcar denúncia como em análise  
**Permissão:** Role `responsavel_admin`
**Comportamento:** Após marcar, o botão fica desativado e novas tentativas são recusadas.

### ✅ `aceitar_denuncia`
**Função:** Aceitar denúncia (abre modal de punição)  
**Permissão:** Role `responsavel_admin`  
**Modal:** `modal_aceitar`

### ❌ `recusar_denuncia`
**Função:** Recusar denúncia  
**Permissão:** Role `responsavel_admin`

### ✅ `finalizar_denuncia`
**Função:** Exportar e fechar denúncia  
**Permissão:** Role `administrador`  
**Resultado:** Gera HTML e ZIP, envia no Discord, tranca o tópico

### 🛠️ `correcao_button`
**Função:** Abrir modal de correção  
**Permissão:** Role `responsavel_admin`  
**Modal:** `modal_correcao`

---

## 🎯 Modais

### `modal_aceitar`
**Campos:**
- ID da log do aceite (TextInput)
- Resultado (TextInput)

**Handler:** `Handlers/handlerStatusButton.js`

### `modal_recusar`
**Campos:**
- Motivo da recusa (TextInput)

**Handler:** `Handlers/handlerStatusButton.js`

### `modal_correcao`
**Campos:**
- Novo log (TextInput)
- Novo status (TextInput)

**Handler:** `commands/correcao.js`

---

## 🎮 Ponte com a gamemode

Só o cargo `responsavel_admin` usa estes botões. Regra de negócio em `services/ponteSamp/discordGm.js`
e `services/ponteSamp/incertosGm.js`; handlers em `Handlers/ponteGamemode.js` (rotas por prefixo em
`Handlers/interactionHandler.js`).

### Embed "🎮 Punição para o jogo" (Relatório de punições)
| customId | Tipo | O que faz |
|---|---|---|
| `ponte_gm_enviar:<punicaoId>` | botão | Confere os limites `gm.*`, cria um pedido por alvo e tira a punição da fila do PC |
| `ponte_gm_editar:<punicaoId>` | botão | Um alvo: abre o modal. Vários: abre o menu de alvos |
| `ponte_gm_alvo:<punicaoId>` | menu | Escolhe o alvo e abre o modal |
| `ponte_gm_modal:<punicaoId>:<alvoId>:<versao>` | modal | Tipo, tempo, avisos e motivo (trava por `versao`) |
| `ponte_gm_cancelar:<punicaoId>` | botão | Antes do envio: cancela a punição. Depois: cancela o que a gamemode ainda não buscou |

### Aviso de incerto (Log Admin)
| customId | O que faz |
|---|---|
| `ponte_gm_incerto_ok:<pedidoId>` | "✅ Foi aplicada": grava o resultado e fecha a punição se não faltar alvo |
| `ponte_gm_incerto_reenviar:<pedidoId>` | "🔁 Não foi aplicada, reenviar": cancela o pedido e cria outro (rodada + 1) |

### Modal de `/ponte gamemode limites`
| customId | Campos |
|---|---|
| `ponte_gm_limites_modal` | `maxBanDias`, `maxCadeiaMin`, `maxAvisos`, `permitirPermanente` (sim/não), `modoTeste` (sim/não) |

### Painel `/painel`
| valor do menu | O que faz |
|---|---|
| `toggle_critical_alert` | Liga/desliga a marcação do responsável em motivo crítico (zaralho, dark RP, hack, mods proibidos) |

---

## 📋 Estrutura de customId

Padrão: `[acao]_[tipo]_[id]`

Exemplo:
- `aceitar_denuncia_123456`
- `reivindicar_denuncia_789012`
- `finalizar_denuncia_345678`

---

## 🔐 Permissões

Verificadas via roles do MongoDB:

- **administrador** — Acesso total
- **responsavel_admin** — Acesso moderado
- **Qualquer membro** — Apenas visualização

Configuradas via comando `!painel`.

---

**Última atualização:** v3.1.0
