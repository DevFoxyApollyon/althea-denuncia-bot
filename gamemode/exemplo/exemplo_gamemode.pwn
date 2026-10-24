/*
 *  exemplo_gamemode.pwn — como ligar o althea_ponte.inc numa gamemode com MySQL (R41-4).
 *
 *  É um EXEMPLO: as tabelas e as funções marcadas com "TROQUE" são de mentira.
 *  Troque pelas da gamemode de vocês (banir, prender, dar aviso etc. já existem aí).
 *
 *  O que este exemplo garante:
 *    1. Nenhum pedido é aplicado duas vezes: o ID do pedido é gravado ANTES de
 *       aplicar, numa tabela com chave primária (INSERT IGNORE).
 *    2. Conta inexistente ou protegida (admin/staff) nunca é punida.
 *    3. Tudo é assíncrono (mysql_tquery): o servidor não trava esperando o banco.
 *    4. Strings sempre com %e no mysql_format (sem injeção de SQL).
 *
 *  Tabela de controle (rodar uma vez no banco):
 *
 *    CREATE TABLE althea_pedidos (
 *      pedido_id    CHAR(24)    NOT NULL PRIMARY KEY,
 *      conta        INT         NOT NULL,
 *      nick         VARCHAR(24) NOT NULL DEFAULT '',
 *      tipo         VARCHAR(10) NOT NULL,
 *      tempo        INT         NOT NULL,
 *      avisos       INT         NOT NULL,
 *      motivo       VARCHAR(64) NOT NULL,
 *      aprovado_por VARCHAR(24) NOT NULL,
 *      resultado    VARCHAR(24) NOT NULL DEFAULT 'EM_ANDAMENTO',
 *      criado_em    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
 *    );
 */
#include <a_samp>
#include <a_mysql>
#include <requests>

// Comece SEMPRE em modo teste: o Althea manda os pedidos, a gamemode valida
// tudo e só escreve no console. Desligue com "rcon althea teste 0" depois de conferir.
#define ALTHEA_MODO_TESTE (true)
// Limites desta gamemode (o Althea tem os dele; aqui é a última palavra).
#define ALTHEA_MAX_BAN_DIAS (30)
#define ALTHEA_PERMITIR_BAN_PERMANENTE (true)
#define ALTHEA_MAX_CADEIA_MIN (300)
#define ALTHEA_MAX_POR_HORA (30)
// Esta gamemode não tem OnRequestFailure próprio: o include cria um.
#define ALTHEA_DEFINIR_ONREQUESTFAILURE
#include "../althea_ponte/althea_ponte"

new MySQL:g_SQL; // A gamemode de vocês já tem a conexão: use a mesma.

// Nomes gravados na tabela de controle.
static const EX_TIPOS[_:ALTHEA_TIPO][] = { "?", "ban", "cadeia", "desbanir", "soltar" };
static const EX_RESULTADOS[_:ALTHEA_RES][] = {
	"OK", "AGUARDAR", "DUPLICADO", "CONTA_INEXISTENTE", "CONTA_PROTEGIDA",
	"JA_BANIDO", "NAO_BANIDO", "NAO_PRESO", "RECUSADO", "ERRO"
};

// Funções da gamemode usadas abaixo (definidas no fim do arquivo).
forward ALTHEA_RES:Gm_Banir(conta, dias, bool:somar, const motivo[]);
forward ALTHEA_RES:Gm_Prender(conta, minutos, const motivo[]);
forward ALTHEA_RES:Gm_Desbanir(conta);
forward ALTHEA_RES:Gm_Soltar(conta);

main() {}

public OnGameModeInit()
{
	// g_SQL = mysql_connect(...);  // já existe na gamemode
	Althea_Iniciar();
	return 1;
}

public OnGameModeExit()
{
	Althea_Encerrar();
	return 1;
}

public OnRconCommand(cmd[])
{
	// rcon althea status | pausar | retomar | teste 1 | teste 0
	if (Althea_ComandoRcon(cmd)) return 1;
	return 0;
}

// ---------------------------------------------------------------------------
// Chamada pelo include para cada pedido que passou em todas as validações.
// ---------------------------------------------------------------------------
ALTHEA_RES:Althea_Aplicar(const pedido[], ALTHEA_TIPO:tipo, conta, const nick[], tempo, avisos, bool:somar, const motivo[], const aprovadoPor[])
{
	static q[400];
	// 1) Grava o pedido primeiro. Se ele já existe, a chave primária impede a
	//    segunda aplicação (mesmo depois de reiniciar o servidor).
	mysql_format(g_SQL, q, sizeof q,
		"INSERT IGNORE INTO althea_pedidos (pedido_id, conta, nick, tipo, tempo, avisos, motivo, aprovado_por) VALUES ('%e', %d, '%e', '%e', %d, %d, '%e', '%e')",
		pedido, conta, nick, EX_TIPOS[_:tipo], tempo, avisos, motivo, aprovadoPor);
	mysql_tquery(g_SQL, q, "Ex_PedidoRegistrado", "sdsdddsds", pedido, _:tipo, nick, conta, tempo, avisos, motivo, _:somar, aprovadoPor);
	// 2) A resposta vem depois, por Althea_Concluir().
	return ALTHEA_AGUARDAR;
}

forward Ex_PedidoRegistrado(const pedido[], tipo, const nick[], conta, tempo, avisos, const motivo[], somar, const aprovadoPor[]);
public Ex_PedidoRegistrado(const pedido[], tipo, const nick[], conta, tempo, avisos, const motivo[], somar, const aprovadoPor[])
{
	if (mysql_errno(g_SQL) != 0)
	{
		Althea_Concluir(pedido, ALTHEA_ERRO);
		return 1;
	}
	if (cache_affected_rows() == 0)
	{
		// Já estava gravado: foi aplicado antes. Não aplica de novo.
		Althea_Concluir(pedido, ALTHEA_DUPLICADO);
		return 1;
	}

	// TROQUE: tabela e colunas de contas da gamemode.
	static q[200];
	if (conta > 0) mysql_format(g_SQL, q, sizeof q, "SELECT id, nome, admin, organizacao FROM contas WHERE id = %d LIMIT 1", conta);
	else mysql_format(g_SQL, q, sizeof q, "SELECT id, nome, admin, organizacao FROM contas WHERE nome = '%e' LIMIT 1", nick);
	mysql_tquery(g_SQL, q, "Ex_ContaCarregada", "sdddds", pedido, tipo, tempo, avisos, somar, motivo);
	#pragma unused aprovadoPor
	return 1;
}

forward Ex_ContaCarregada(const pedido[], tipo, tempo, avisos, somar, const motivo[]);
public Ex_ContaCarregada(const pedido[], tipo, tempo, avisos, somar, const motivo[])
{
	if (mysql_errno(g_SQL) != 0) return Ex_Fechar(pedido, ALTHEA_ERRO, "", "", 0);

	new linhas;
	cache_get_row_count(linhas);
	if (linhas == 0) return Ex_Fechar(pedido, ALTHEA_CONTA_INEXISTENTE, "", "", 0);

	new contaId, admin;
	static nome[25], organizacao[33];
	cache_get_value_name_int(0, "id", contaId);
	cache_get_value_name_int(0, "admin", admin);
	cache_get_value_name(0, "nome", nome);
	cache_get_value_name(0, "organizacao", organizacao);

	// Staff nunca é punida pelo bot (punição em staff é decisão humana, no jogo).
	if (admin > 0) return Ex_Fechar(pedido, ALTHEA_CONTA_PROTEGIDA, nome, organizacao, contaId);

	new ALTHEA_RES:res;
	switch (ALTHEA_TIPO:tipo)
	{
		case ALTHEA_BAN:
		{
			res = Gm_Banir(contaId, tempo, bool:somar, motivo);
			if (res == ALTHEA_OK && avisos > 0) Gm_DarAvisos(contaId, avisos, motivo);
		}
		case ALTHEA_CADEIA:
		{
			res = Gm_Prender(contaId, tempo, motivo);
			if (res == ALTHEA_OK && avisos > 0) Gm_DarAvisos(contaId, avisos, motivo);
		}
		case ALTHEA_DESBANIR: res = Gm_Desbanir(contaId);
		case ALTHEA_SOLTAR: res = Gm_Soltar(contaId);
		default: res = ALTHEA_RECUSADO;
	}
	return Ex_Fechar(pedido, res, nome, organizacao, contaId);
}

// Grava o resultado na tabela de controle e responde ao Althea.
static Ex_Fechar(const pedido[], ALTHEA_RES:res, const nome[], const organizacao[], conta)
{
	static q[160];
	mysql_format(g_SQL, q, sizeof q, "UPDATE althea_pedidos SET resultado = '%e' WHERE pedido_id = '%e'", EX_RESULTADOS[_:res], pedido);
	mysql_tquery(g_SQL, q);
	Althea_Concluir(pedido, res, nome, organizacao, conta);
	return 1;
}

// ---------------------------------------------------------------------------
// TROQUE: funções da gamemode. Devem funcionar com o jogador online (aplica
// na hora) e offline (grava no banco para valer quando ele logar).
// ---------------------------------------------------------------------------

// dias = 0 é permanente (só chega aqui com ALTHEA_PERMITIR_BAN_PERMANENTE).
// somar = true: se a conta já está banida, soma os dias ao ban atual.
stock ALTHEA_RES:Gm_Banir(conta, dias, bool:somar, const motivo[])
{
	printf("[exemplo] banir conta %d por %d dia(s) (somar=%d): %s", conta, dias, somar, motivo);
	return ALTHEA_OK;
}

stock ALTHEA_RES:Gm_Prender(conta, minutos, const motivo[])
{
	printf("[exemplo] prender conta %d por %d minuto(s): %s", conta, minutos, motivo);
	return ALTHEA_OK;
}

stock Gm_DarAvisos(conta, quantidade, const motivo[])
{
	printf("[exemplo] %d aviso(s) na conta %d: %s", quantidade, conta, motivo);
}

stock ALTHEA_RES:Gm_Desbanir(conta)
{
	printf("[exemplo] desbanir conta %d", conta);
	return ALTHEA_OK;
}

stock ALTHEA_RES:Gm_Soltar(conta)
{
	printf("[exemplo] soltar conta %d", conta);
	return ALTHEA_OK;
}
