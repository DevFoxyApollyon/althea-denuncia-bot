# Integração Althea ⇄ gamemode (para os devs do servidor)

A especificação completa está em `doc/PONTE_GAMEMODE.md`. Este arquivo é só o mapa da pasta.

| arquivo | o que é |
|---|---|
| `althea_ponte/althea_ponte.inc` | o include: busca, valida, chama `Althea_Aplicar()` e devolve o resultado |
| `althea_ponte/althea_sha256.inc` | SHA-256 e HMAC-SHA256 em Pawn puro (sem plugin e sem o aviso do `SHA256_PassHash` no open.mp) |
| `althea_ponte/althea_util.inc` | validações (nick, motivo, hex), também em Pawn puro |
| `exemplo/exemplo_gamemode.pwn` | exemplo completo com MySQL R41-4, assíncrono, sem aplicar duas vezes |
| `teste/teste_cripto.pwn` | confere o SHA-256/HMAC com os vetores oficiais (rode como filterscript no servidor de teste) |
| `teste/vetores_protocolo.json` | assinaturas e selos de exemplo, os mesmos que o bot precisa produzir |

## O que vocês precisam escrever

Só uma função, usando as funções que a gamemode já tem:

```pawn
ALTHEA_RES:Althea_Aplicar(const pedido[], ALTHEA_TIPO:tipo, conta, const nick[],
    tempo, avisos, bool:somar, const motivo[], const aprovadoPor[])
```

Ela devolve `ALTHEA_OK`, um motivo de recusa (`ALTHEA_CONTA_PROTEGIDA`, `ALTHEA_JA_BANIDO`…) ou `ALTHEA_AGUARDAR`. No caso de `ALTHEA_AGUARDAR`, a função responde depois com `Althea_Concluir()`, que é o caminho para consultas assíncronas ao banco.

## Regras de ouro

1. **Comece em modo teste** (`#define ALTHEA_MODO_TESTE (true)`).
2. Grave o `pedido` no banco **antes** de aplicar, com chave primária. Se ele já existir, devolva `ALTHEA_DUPLICADO`.
3. Nunca use o `motivo` como texto de formatação. Use sempre `%s` (ou `%e` no `mysql_format`).
4. As credenciais ficam em `scriptfiles/althea_credenciais.txt`, fora do git.
5. Para pausar tudo na hora, use `rcon althea pausar`.

Testado com o `pawncc` 3.10.10 (sem nenhum aviso, com `-E`), o pawn-requests (`requests.inc` do repositório oficial) e o MySQL R41-4.
