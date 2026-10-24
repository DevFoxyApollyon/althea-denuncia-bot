/*
 *  althea_ponte.inc — Integração Althea (bot de denúncias) ⇄ gamemode
 *  Protocolo gm/v1 · versão do include 1.0.0
 *
 *  O que faz
 *    A gamemode BUSCA no Althea as punições já aprovadas por um responsável
 *    no Discord, valida cada uma e chama Althea_Aplicar() (que vocês escrevem
 *    com as funções que a gamemode já tem). O resultado volta ao Althea, que
 *    atualiza a denúncia no Discord.
 *
 *    Nenhuma porta é aberta no servidor: só sai HTTPS para o Althea.
 *
 *  Segurança (detalhes em doc/PONTE_GAMEMODE.md do Althea)
 *    - Cada requisição é assinada com HMAC-SHA256; o segredo nunca trafega.
 *    - Cada pedido vem com um "selo" HMAC: qualquer campo alterado = recusado
 *      e a integração se PAUSA sozinha até um admin conferir.
 *    - Lista fechada de tipos, limites de tempo e de avisos, validade de 10
 *      minutos por pedido, limite de punições por hora e modo teste.
 *    - Um pedido repetido nunca é aplicado duas vezes (memória + registro
 *      que a gamemode guarda no banco, ver Althea_Aplicar).
 *
 *  Requisitos
 *    - SA-MP 0.3.7 ou open.mp
 *    - pawn-requests (Southclaws) — plugin + #include <requests>
 *
 *  Uso (resumo; exemplo completo em gamemode/exemplo/exemplo_gamemode.pwn)
 *
 *    #include <a_samp>
 *    #include <requests>
 *    #define ALTHEA_MODO_TESTE (true)        // comece SEMPRE em modo teste
 *    #include "althea_ponte/althea_ponte"
 *
 *    public OnGameModeInit() { Althea_Iniciar(); ... }
 *    public OnGameModeExit() { Althea_Encerrar(); ... }
 *    public OnRconCommand(cmd[]) { if (Althea_ComandoRcon(cmd)) return 1; ... }
 *
 *    ALTHEA_RES:Althea_Aplicar(const pedido[], ALTHEA_TIPO:tipo, conta, const nick[],
 *        tempo, avisos, bool:somar, const motivo[], const aprovadoPor[])
 *    { ... return ALTHEA_OK; }
 *
 *  Credenciais: scriptfiles/althea_credenciais.txt (gerado pelo Althea, uma vez):
 *    id=<24 letras>
 *    segredo=<64 letras>
 *  Não coloque o segredo no código nem no git.
 */
#if defined _althea_ponte_included
	#endinput
#endif
#define _althea_ponte_included

#if !defined _requests_included
	#include <requests>
#endif

#include "althea_sha256"
#include "althea_util"

#define ALTHEA_VERSAO "1.0.0"

// ---------------------------------------------------------------------------
// Configuração: defina antes do #include para mudar.
// ---------------------------------------------------------------------------

// Endereço do Althea (só esquema + domínio, sem barra no fim).
#if !defined ALTHEA_URL
	#define ALTHEA_URL "https://althea-denuncias.squareweb.app"
#endif
#if !defined ALTHEA_ARQUIVO_CREDENCIAIS
	#define ALTHEA_ARQUIVO_CREDENCIAIS "althea_credenciais.txt"
#endif
// Modo teste: valida tudo e responde "simulada", sem chamar Althea_Aplicar.
#if !defined ALTHEA_MODO_TESTE
	#define ALTHEA_MODO_TESTE (true)
#endif
// Limites que a gamemode impõe, mesmo que o Althea mande outra coisa.
#if !defined ALTHEA_MAX_BAN_DIAS
	#define ALTHEA_MAX_BAN_DIAS (30)
#endif
#if !defined ALTHEA_PERMITIR_BAN_PERMANENTE
	#define ALTHEA_PERMITIR_BAN_PERMANENTE (false)
#endif
#if !defined ALTHEA_MAX_CADEIA_MIN
	#define ALTHEA_MAX_CADEIA_MIN (300)
#endif
#if !defined ALTHEA_MAX_AVISOS
	#define ALTHEA_MAX_AVISOS (3)
#endif
// Punições reais por hora; passou disso, a integração pausa e avisa no log.
#if !defined ALTHEA_MAX_POR_HORA
	#define ALTHEA_MAX_POR_HORA (30)
#endif
// Pedidos por busca.
#if !defined ALTHEA_LOTE
	#define ALTHEA_LOTE (10)
#endif
// Intervalo entre buscas: com fila vazia / logo depois de receber pedidos.
#if !defined ALTHEA_INTERVALO_OCIOSO_S
	#define ALTHEA_INTERVALO_OCIOSO_S (10)
#endif
#if !defined ALTHEA_INTERVALO_ATIVO_S
	#define ALTHEA_INTERVALO_ATIVO_S (2)
#endif
// Pedido mais velho que isto (desde que o Althea o entregou) é recusado.
#if !defined ALTHEA_VALIDADE_PEDIDO_S
	#define ALTHEA_VALIDADE_PEDIDO_S (600)
#endif
// Tempo para a gamemode responder um pedido que devolveu ALTHEA_AGUARDAR.
#if !defined ALTHEA_TIMEOUT_GAMEMODE_S
	#define ALTHEA_TIMEOUT_GAMEMODE_S (60)
#endif
// Requisição HTTP sem resposta por mais que isto conta como falha.
#if !defined ALTHEA_TIMEOUT_HTTP_S
	#define ALTHEA_TIMEOUT_HTTP_S (30)
#endif

// Tamanhos internos (não precisa mexer).
#define ALT_TICK_MS        (2000)
#define ALT_BASE           "/ponte/gm/v1"
#define ALT_MAX_RESULTADOS (64)
#define ALT_MAX_PENDENTES  (32)
#define ALT_MEMORIA        (128)
#define ALT_TAM_ID         (25)

// ---------------------------------------------------------------------------
// Tipos e respostas
// ---------------------------------------------------------------------------

enum ALTHEA_TIPO
{
	ALTHEA_TIPO_INVALIDO,
	ALTHEA_BAN,       // tempo em dias (0 = permanente, só com ALTHEA_PERMITIR_BAN_PERMANENTE)
	ALTHEA_CADEIA,    // tempo em minutos
	ALTHEA_DESBANIR,  // retira um ban aplicado antes (tempo 0)
	ALTHEA_SOLTAR     // retira uma cadeia aplicada antes (tempo 0)
}

enum ALTHEA_RES
{
	ALTHEA_OK,                // aplicada (ou gravada para quando o jogador logar)
	ALTHEA_AGUARDAR,          // a gamemode responde depois com Althea_Concluir()
	ALTHEA_DUPLICADO,         // este pedido já tinha sido aplicado (registro da gamemode)
	ALTHEA_CONTA_INEXISTENTE,
	ALTHEA_CONTA_PROTEGIDA,   // admin, staff ou conta que o bot não pode punir
	ALTHEA_JA_BANIDO,         // ban sem "somar" e a conta já está banida
	ALTHEA_NAO_BANIDO,        // desbanir: a conta não estava banida
	ALTHEA_NAO_PRESO,         // soltar: a conta não estava presa
	ALTHEA_RECUSADO,          // outra regra da gamemode recusou
	ALTHEA_ERRO               // falha técnica (banco fora do ar etc.)
}

// A gamemode escreve esta função. "pedido" é o ID único (24 letras): grave-o
// no banco junto com a punição e devolva ALTHEA_DUPLICADO se ele já existir.
// conta = ID da conta (0 quando a denúncia trouxe só o nick).
forward ALTHEA_RES:Althea_Aplicar(const pedido[], ALTHEA_TIPO:tipo, conta, const nick[], tempo, avisos, bool:somar, const motivo[], const aprovadoPor[]);

// ---------------------------------------------------------------------------
// Estado interno
// ---------------------------------------------------------------------------

enum ALT_COD
{
	ALT_C_OK,
	ALT_C_SIMULADA,
	ALT_C_DUPLICADO,
	ALT_C_CONTA_INEXISTENTE,
	ALT_C_CONTA_PROTEGIDA,
	ALT_C_JA_BANIDO,
	ALT_C_NAO_BANIDO,
	ALT_C_NAO_PRESO,
	ALT_C_RECUSADO,
	ALT_C_ERRO_GAMEMODE,
	ALT_C_SELO_INVALIDO,
	ALT_C_EXPIRADO,
	ALT_C_DADOS_INVALIDOS,
	ALT_C_LIMITE_HORA,
	ALT_C_TIMEOUT_GAMEMODE,
	ALT_C_PAUSADO
}

static const ALT_COD_TEXTO[ALT_COD][] = {
	"OK", "SIMULADA", "DUPLICADO", "CONTA_INEXISTENTE", "CONTA_PROTEGIDA", "JA_BANIDO",
	"NAO_BANIDO", "NAO_PRESO", "RECUSADO", "ERRO_GAMEMODE", "SELO_INVALIDO", "EXPIRADO",
	"DADOS_INVALIDOS", "LIMITE_HORA", "TIMEOUT_GAMEMODE", "PAUSADO"
};

// Situação que o Althea grava para cada código. "devolvida" = com certeza NÃO
// aplicada: o Althea pode recolocar na fila sozinho quando a integração voltar.
static const ALT_COD_STATUS[ALT_COD][] = {
	"aplicada", "simulada", "aplicada", "recusada", "recusada", "recusada",
	"recusada", "recusada", "recusada", "erro", "recusada", "recusada",
	"recusada", "devolvida", "erro", "devolvida"
};

// Resposta da gamemode -> código enviado ao Althea.
static const ALT_RES_PARA_COD[_:ALTHEA_RES] = {
	_:ALT_C_OK, _:ALT_C_ERRO_GAMEMODE, _:ALT_C_DUPLICADO, _:ALT_C_CONTA_INEXISTENTE, _:ALT_C_CONTA_PROTEGIDA,
	_:ALT_C_JA_BANIDO, _:ALT_C_NAO_BANIDO, _:ALT_C_NAO_PRESO, _:ALT_C_RECUSADO, _:ALT_C_ERRO_GAMEMODE
};

static RequestsClient:s_cliente = RequestsClient:-1;
static s_timer = -1;
static bool:s_iniciado, bool:s_pausado, bool:s_modoTeste = ALTHEA_MODO_TESTE;
static s_id[ALT_TAM_ID], s_segredo[65];

static Request:s_reqBusca = Request:-1, Request:s_reqEnvio = Request:-1;
static bool:s_buscando, bool:s_enviando, s_buscaDesde, s_envioDesde;
static s_proximaBusca, s_esperarAte, s_falhas, s_seq;
static s_horaInicio, s_horaQtd;
static s_totalAplicadas, s_totalRecusadas;

// Fila de resultados a enviar (anel).
static s_resId[ALT_MAX_RESULTADOS][ALT_TAM_ID], ALT_COD:s_resCod[ALT_MAX_RESULTADOS];
static s_resNome[ALT_MAX_RESULTADOS][25], s_resOrg[ALT_MAX_RESULTADOS][33], s_resConta[ALT_MAX_RESULTADOS];
static s_resIni, s_resQtd;

// Pedidos esperando Althea_Concluir().
static s_pendId[ALT_MAX_PENDENTES][ALT_TAM_ID], s_pendDesde[ALT_MAX_PENDENTES];

// Últimos pedidos processados e o código devolvido (pedido repetido recebe a mesma resposta).
static s_memId[ALT_MEMORIA][ALT_TAM_ID], ALT_COD:s_memCod[ALT_MEMORIA], s_memProx;

// Buffers reaproveitados (nada de array grande na pilha a cada chamada).
static s_caminho[96], s_url[320], s_auth[200], s_corpo[256], s_log[200];

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

static Alt_Log(const texto[])
{
	printf("[Althea] %s", texto);
}

static ALTHEA_TIPO:Alt_TipoDeTexto(const s[])
{
	if (Alt_Igual(s, "ban")) return ALTHEA_BAN;
	if (Alt_Igual(s, "cadeia")) return ALTHEA_CADEIA;
	if (Alt_Igual(s, "desbanir")) return ALTHEA_DESBANIR;
	if (Alt_Igual(s, "soltar")) return ALTHEA_SOLTAR;
	return ALTHEA_TIPO_INVALIDO;
}

static bool:Alt_LerCredenciais()
{
	new File:arquivo = fopen(ALTHEA_ARQUIVO_CREDENCIAIS, io_read);
	if (!arquivo)
	{
		Alt_Log("Arquivo de credenciais nao encontrado em scriptfiles/" ALTHEA_ARQUIVO_CREDENCIAIS ". Integracao desligada.");
		return false;
	}
	static linha[160];
	s_id[0] = EOS;
	s_segredo[0] = EOS;
	while (fread(arquivo, linha))
	{
		Alt_Aparar(linha);
		if (linha[0] == EOS || linha[0] == '#') continue;
		if (Alt_Prefixo(linha, "id=")) strmid(s_id, linha, 3, strlen(linha), sizeof s_id);
		else if (Alt_Prefixo(linha, "segredo=")) strmid(s_segredo, linha, 8, strlen(linha), sizeof s_segredo);
	}
	fclose(arquivo);
	for (new i = 0; i < sizeof linha; i++) linha[i] = EOS;

	if (!Alt_HexValido(s_id, 24) || !Alt_HexValido(s_segredo, 64))
	{
		s_segredo[0] = EOS;
		Alt_Log("Credenciais invalidas (esperado id= com 24 letras e segredo= com 64). Integracao desligada.");
		return false;
	}
	return true;
}

// Confere o SHA-256 antes de usar: se o compilador ou a AMX se comportarem
// diferente do esperado, a integração não liga (melhor parar que assinar errado).
static bool:Alt_AutoTeste()
{
	static hex[65];
	Alt_HmacSha256("Jefe", "what do ya want for nothing?", hex);
	if (!Alt_IgualSeguro(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", 64)) return false;
	Alt_Sha256Hex("abc", hex);
	return Alt_IgualSeguro(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 64);
}

// Monta s_auth = "id=...&ts=...&nonce=...&sig=..." para METODO + caminho + corpo.
// Assinatura: HMAC-SHA256(segredo, METODO\nCAMINHO\nTS\nNONCE\nsha256(corpo)).
static Alt_Assinar(const metodo[], const caminho[], const corpo[], agora)
{
	static nonce[65], hashCorpo[65], canonico[300], assinatura[65];

	// Nonce imprevisível e único: hash de relógio, contador e aleatório.
	format(canonico, sizeof canonico, "%d:%d:%d:%d:%s", agora, GetTickCount(), random(2147483647), ++s_seq, s_id);
	Alt_Sha256Hex(canonico, nonce);
	nonce[32] = EOS;

	Alt_Sha256Hex(corpo, hashCorpo);
	format(canonico, sizeof canonico, "%s\n%s\n%d\n%s\n%s", metodo, caminho, agora, nonce, hashCorpo);
	Alt_HmacSha256(s_segredo, canonico, assinatura);
	format(s_auth, sizeof s_auth, "id=%s&ts=%d&nonce=%s&sig=%s", s_id, agora, nonce, assinatura);
}

static Alt_Falhou(status, const detalhe[])
{
	new espera;
	if (status == 401 || status == 403)
	{
		// Credencial, relógio, IP ou conexão revogada: não adianta insistir logo.
		espera = 300;
	}
	else
	{
		if (s_falhas < 6) s_falhas++;
		espera = 5 << (s_falhas - 1);   // 5, 10, 20, 40, 80, 160 s
	}
	s_esperarAte = gettime() + espera;
	if (detalhe[0] != EOS) format(s_log, sizeof s_log, "Falha na comunicacao (HTTP %d, %s). Nova tentativa em %d s.", status, detalhe, espera);
	else format(s_log, sizeof s_log, "Falha na comunicacao (HTTP %d). Nova tentativa em %d s.", status, espera);
	Alt_Log(s_log);
}

// ---------------------------------------------------------------------------
// Memória, pendentes e fila de resultados
// ---------------------------------------------------------------------------

static Alt_MemoriaBuscar(const id[])
{
	for (new i = 0; i < ALT_MEMORIA; i++)
	{
		if (s_memId[i][0] != EOS && Alt_Igual(s_memId[i], id)) return i;
	}
	return -1;
}

static Alt_MemoriaGuardar(const id[], ALT_COD:cod)
{
	new i = Alt_MemoriaBuscar(id);
	if (i == -1)
	{
		i = s_memProx;
		s_memProx = (s_memProx + 1) % ALT_MEMORIA;
	}
	strmid(s_memId[i], id, 0, ALT_TAM_ID - 1, ALT_TAM_ID);
	s_memCod[i] = cod;
}

static Alt_PendenteBuscar(const id[])
{
	for (new i = 0; i < ALT_MAX_PENDENTES; i++)
	{
		if (s_pendId[i][0] != EOS && Alt_Igual(s_pendId[i], id)) return i;
	}
	return -1;
}

static bool:Alt_PendenteGuardar(const id[])
{
	for (new i = 0; i < ALT_MAX_PENDENTES; i++)
	{
		if (s_pendId[i][0] == EOS)
		{
			strmid(s_pendId[i], id, 0, ALT_TAM_ID - 1, ALT_TAM_ID);
			s_pendDesde[i] = gettime();
			return true;
		}
	}
	return false;
}

static Alt_Enfileirar(const id[], ALT_COD:cod, const nome[], const organizacao[], conta)
{
	if (s_resQtd >= ALT_MAX_RESULTADOS)
	{
		// Não deve acontecer (a busca para antes de encher), mas nunca sobrescreve.
		format(s_log, sizeof s_log, "Fila de resultados cheia: resultado do pedido %s (%s) nao sera enviado. Confira no Althea.", id, ALT_COD_TEXTO[cod]);
		Alt_Log(s_log);
		return;
	}
	new i = (s_resIni + s_resQtd) % ALT_MAX_RESULTADOS;
	strmid(s_resId[i], id, 0, ALT_TAM_ID - 1, ALT_TAM_ID);
	s_resCod[i] = cod;
	Alt_TextoSeguro(s_resNome[i], nome, 25);
	Alt_TextoSeguro(s_resOrg[i], organizacao, 33);
	s_resConta[i] = (0 <= conta <= 999999999) ? conta : 0;
	s_resQtd++;
}

// Fecha um pedido: guarda na memória, registra no log e põe o resultado na fila.
static Alt_Fechar(const id[], ALT_COD:cod, const nome[] = "", const organizacao[] = "", conta = 0)
{
	Alt_MemoriaGuardar(id, cod);
	Alt_Enfileirar(id, cod, nome, organizacao, conta);
	if (cod == ALT_C_OK || cod == ALT_C_DUPLICADO) s_totalAplicadas++;
	else if (cod != ALT_C_SIMULADA && cod != ALT_C_LIMITE_HORA) s_totalRecusadas++;
	format(s_log, sizeof s_log, "Pedido %s: %s (%s).", id, ALT_COD_STATUS[cod], ALT_COD_TEXTO[cod]);
	Alt_Log(s_log);
	Alt_EnviarProximo();
}

static Alt_VerificarPendentes(agora)
{
	for (new i = 0; i < ALT_MAX_PENDENTES; i++)
	{
		if (s_pendId[i][0] != EOS && agora - s_pendDesde[i] > ALTHEA_TIMEOUT_GAMEMODE_S)
		{
			// O Althea marca como "incerto" e pede conferência humana: nunca reenvia sozinho.
			static id[ALT_TAM_ID];
			strmid(id, s_pendId[i], 0, ALT_TAM_ID - 1, ALT_TAM_ID);
			s_pendId[i][0] = EOS;
			Alt_Fechar(id, ALT_C_TIMEOUT_GAMEMODE);
		}
	}
}

// ---------------------------------------------------------------------------
// Comunicação
// ---------------------------------------------------------------------------

static Alt_Buscar(agora)
{
	format(s_caminho, sizeof s_caminho, ALT_BASE "/pedidos");
	Alt_Assinar("GET", s_caminho, "", agora);
	format(s_url, sizeof s_url, "%s?limite=%d&versao=" ALTHEA_VERSAO "&teste=%d&%s", s_caminho, ALTHEA_LOTE, s_modoTeste ? 1 : 0, s_auth);

	// Sem cabeçalhos por requisição: no pawn-requests cada RequestHeaders()
	// fica na memória do plugin para sempre. A autenticação vai na URL.
	new Request:req = RequestJSON(s_cliente, s_url, HTTP_METHOD_GET, "Althea_AoReceberPedidos");
	if (!IsValidRequest(req))
	{
		Alt_Falhou(0, "nao foi possivel criar a requisicao");
		return;
	}
	s_reqBusca = req;
	s_buscando = true;
	s_buscaDesde = agora;
}

static Alt_EnviarProximo()
{
	if (!s_iniciado || s_enviando || s_resQtd == 0) return;
	new agora = gettime();
	if (agora < s_esperarAte) return;

	new i = s_resIni;
	format(s_corpo, sizeof s_corpo, "{\"status\":\"%s\",\"codigo\":\"%s\",\"nome\":\"%s\",\"organizacao\":\"%s\",\"conta\":%d}",
		ALT_COD_STATUS[s_resCod[i]], ALT_COD_TEXTO[s_resCod[i]], s_resNome[i], s_resOrg[i], s_resConta[i]);
	format(s_caminho, sizeof s_caminho, ALT_BASE "/resultados/%s", s_resId[i]);
	Alt_Assinar("POST", s_caminho, s_corpo, agora);
	format(s_url, sizeof s_url, "%s?%s", s_caminho, s_auth);

	new Request:req = Request(s_cliente, s_url, HTTP_METHOD_POST, "Althea_AoEnviarResultado", s_corpo);
	if (!IsValidRequest(req))
	{
		Alt_Falhou(0, "nao foi possivel criar a requisicao");
		return;
	}
	s_reqEnvio = req;
	s_enviando = true;
	s_envioDesde = agora;
}

// Integração pausada no meio de um lote: o pedido volta para o Althea sem ser
// aplicado. Não entra na memória (quando voltar, é processado normalmente).
static Alt_Devolver(Node:p)
{
	static id[ALT_TAM_ID];
	if (JsonGetString(p, "id", id) || !Alt_HexValido(id, 24)) return;
	new mem = Alt_MemoriaBuscar(id);
	if (mem != -1) Alt_Enfileirar(id, s_memCod[mem], "", "", 0);
	else if (Alt_PendenteBuscar(id) == -1) Alt_Enfileirar(id, ALT_C_PAUSADO, "", "", 0);
	Alt_EnviarProximo();
}

// Valida um pedido e chama Althea_Aplicar.
static Alt_Processar(Node:p, agora)
{
	static id[ALT_TAM_ID], tipoTxt[12], nick[25], motivo[72], aprovador[25], selo[72], canonico[300], esperado[65];
	new conta, tempo, avisos, emitido, bool:somar, bool:teste;

	if (JsonGetString(p, "id", id) || !Alt_HexValido(id, 24))
	{
		Alt_Log("Pedido sem ID valido ignorado.");
		return;
	}

	// Repetido: devolve a mesma resposta, sem aplicar de novo.
	new mem = Alt_MemoriaBuscar(id);
	if (mem != -1)
	{
		Alt_Enfileirar(id, s_memCod[mem], "", "", 0);
		return;
	}
	// Ainda esperando a gamemode responder.
	if (Alt_PendenteBuscar(id) != -1) return;

	if (JsonGetString(p, "tipo", tipoTxt) || JsonGetInt(p, "conta", conta) || JsonGetString(p, "nick", nick)
		|| JsonGetInt(p, "tempo", tempo) || JsonGetInt(p, "avisos", avisos) || JsonGetBool(p, "somar", somar)
		|| JsonGetString(p, "motivo", motivo) || JsonGetString(p, "aprovadoPor", aprovador)
		|| JsonGetInt(p, "emitidoEm", emitido) || JsonGetBool(p, "teste", teste) || JsonGetString(p, "selo", selo))
	{
		Alt_Fechar(id, ALT_C_DADOS_INVALIDOS);
		return;
	}

	// 1) Selo: confere TODOS os campos antes de confiar em qualquer um.
	format(canonico, sizeof canonico, "pedido\n%s|%s|%d|%s|%d|%d|%d|%s|%s|%d|%d",
		id, tipoTxt, conta, nick, tempo, avisos, somar ? 1 : 0, motivo, aprovador, emitido, teste ? 1 : 0);
	Alt_HmacSha256(s_segredo, canonico, esperado);
	if (!Alt_IgualSeguro(selo, esperado, 64))
	{
		s_pausado = true;
		format(s_log, sizeof s_log, "ALERTA: pedido %s com selo invalido. Integracao PAUSADA. Confira e use: rcon althea retomar", id);
		Alt_Log(s_log);
		Alt_Fechar(id, ALT_C_SELO_INVALIDO);
		return;
	}

	// 2) Validade: pedido velho (ou do futuro) não vale.
	if (emitido > agora + 60 || agora - emitido > ALTHEA_VALIDADE_PEDIDO_S)
	{
		Alt_Fechar(id, ALT_C_EXPIRADO);
		return;
	}

	// 3) Campos e limites da gamemode.
	new ALTHEA_TIPO:tipo = Alt_TipoDeTexto(tipoTxt);
	new bool:valido = (tipo != ALTHEA_TIPO_INVALIDO)
		&& (0 <= conta <= 999999999)
		&& (conta > 0 || Alt_NickValido(nick))
		&& (nick[0] == EOS || Alt_NickValido(nick))
		&& (0 <= avisos <= ALTHEA_MAX_AVISOS)
		&& Alt_MotivoValido(motivo)
		&& Alt_NomeStaffValido(aprovador);
	if (valido)
	{
		switch (tipo)
		{
			case ALTHEA_BAN: valido = (tempo == 0) ? ALTHEA_PERMITIR_BAN_PERMANENTE : (1 <= tempo <= ALTHEA_MAX_BAN_DIAS);
			case ALTHEA_CADEIA: valido = (1 <= tempo <= ALTHEA_MAX_CADEIA_MIN) && !somar;
			default: valido = (tempo == 0 && avisos == 0 && !somar);
		}
	}
	if (!valido)
	{
		Alt_Fechar(id, ALT_C_DADOS_INVALIDOS);
		return;
	}

	// 4) Modo teste (da gamemode ou do Althea): só registra.
	if (s_modoTeste || teste)
	{
		format(s_log, sizeof s_log, "[TESTE] %s conta=%d nick=%s tempo=%d avisos=%d somar=%d motivo=\"%s\" aprovado por %s",
			tipoTxt, conta, nick, tempo, avisos, somar ? 1 : 0, motivo, aprovador);
		Alt_Log(s_log);
		Alt_Fechar(id, ALT_C_SIMULADA);
		return;
	}

	// 5) Limite por hora.
	if (agora - s_horaInicio >= 3600)
	{
		s_horaInicio = agora;
		s_horaQtd = 0;
	}
	if (s_horaQtd >= ALTHEA_MAX_POR_HORA)
	{
		s_pausado = true;
		Alt_Log("ALERTA: limite de punicoes por hora atingido. Integracao PAUSADA. Confira e use: rcon althea retomar");
		// Não entra na memória: depois de retomar, o mesmo pedido pode voltar e ser aplicado.
		Alt_Enfileirar(id, ALT_C_LIMITE_HORA, "", "", 0);
		Alt_EnviarProximo();
		return;
	}
	s_horaQtd++;

	// 6) A gamemode aplica. Reserva o pendente ANTES de chamar: se a gamemode
	//    chamar Althea_Concluir() lá dentro, ele já existe.
	if (!Alt_PendenteGuardar(id))
	{
		Alt_Fechar(id, ALT_C_ERRO_GAMEMODE);
		return;
	}
	new ALTHEA_RES:res = Althea_Aplicar(id, tipo, conta, nick, tempo, avisos, somar, motivo, aprovador);
	if (res == ALTHEA_AGUARDAR) return;

	new pend = Alt_PendenteBuscar(id);
	if (pend == -1) return;   // já concluído lá dentro
	s_pendId[pend][0] = EOS;
	Alt_Fechar(id, ALT_COD:ALT_RES_PARA_COD[_:res]);
}

// ---------------------------------------------------------------------------
// Callbacks (públicas)
// ---------------------------------------------------------------------------

forward Althea_Tick();
public Althea_Tick()
{
	if (!s_iniciado) return 1;
	new agora = gettime();

	if (s_buscando && agora - s_buscaDesde > ALTHEA_TIMEOUT_HTTP_S)
	{
		s_buscando = false;
		s_reqBusca = Request:-1;
		Alt_Falhou(0, "busca sem resposta");
	}
	if (s_enviando && agora - s_envioDesde > ALTHEA_TIMEOUT_HTTP_S)
	{
		s_enviando = false;
		s_reqEnvio = Request:-1;
		Alt_Falhou(0, "envio sem resposta");
	}

	Alt_VerificarPendentes(agora);
	if (agora < s_esperarAte) return 1;

	Alt_EnviarProximo();

	// Só busca se couber o lote inteiro na fila de resultados.
	if (s_pausado || s_buscando || agora < s_proximaBusca) return 1;
	if (s_resQtd > ALT_MAX_RESULTADOS - ALTHEA_LOTE) return 1;
	Alt_Buscar(agora);
	return 1;
}

forward Althea_AoReceberPedidos(Request:id, E_HTTP_STATUS:status, Node:node);
public Althea_AoReceberPedidos(Request:id, E_HTTP_STATUS:status, Node:node)
{
	if (id != s_reqBusca) return 1;
	s_reqBusca = Request:-1;
	s_buscando = false;
	new agora = gettime();

	if (status != HTTP_STATUS_OK)
	{
		static codigo[32];
		codigo[0] = EOS;
		JsonGetString(node, "codigo", codigo);
		Alt_Falhou(_:status, codigo);
		return 1;
	}
	s_falhas = 0;
	s_proximaBusca = agora + ALTHEA_INTERVALO_OCIOSO_S;

	// Pausa pelo Discord (/ponte gamemode pausar): não processa nada.
	new bool:pausadoNoAlthea;
	if (!JsonGetBool(node, "pausado", pausadoNoAlthea) && pausadoNoAlthea) return 1;

	new Node:lista = Node:-1, total;
	if (JsonGetArray(node, "pedidos", lista) || JsonArrayLength(lista, total))
	{
		Alt_Log("Resposta do Althea sem a lista de pedidos.");
		return 1;
	}
	if (total > ALTHEA_LOTE) total = ALTHEA_LOTE;

	for (new i = 0; i < total; i++)
	{
		new Node:pedido = Node:-1;
		if (JsonArrayObject(lista, i, pedido)) continue;
		// Selo inválido ou limite por hora pausam no meio do lote: o resto volta sem aplicar.
		if (s_pausado) Alt_Devolver(pedido);
		else Alt_Processar(pedido, agora);
	}
	if (total > 0) s_proximaBusca = agora + ALTHEA_INTERVALO_ATIVO_S;
	return 1;
}

forward Althea_AoEnviarResultado(Request:id, E_HTTP_STATUS:status, data[], dataLen);
public Althea_AoEnviarResultado(Request:id, E_HTTP_STATUS:status, data[], dataLen)
{
	#pragma unused data, dataLen
	if (id != s_reqEnvio) return 1;
	s_reqEnvio = Request:-1;
	s_enviando = false;

	new codigo = _:status;
	// 404/409/410: o Althea já tem uma resposta final para este pedido. Não insiste.
	if (codigo == 200 || codigo == 404 || codigo == 409 || codigo == 410)
	{
		if (codigo != 200)
		{
			format(s_log, sizeof s_log, "Resultado do pedido %s recusado pelo Althea (HTTP %d); descartado.", s_resId[s_resIni], codigo);
			Alt_Log(s_log);
		}
		s_resIni = (s_resIni + 1) % ALT_MAX_RESULTADOS;
		s_resQtd--;
		s_falhas = 0;
		Alt_EnviarProximo();
		return 1;
	}
	Alt_Falhou(codigo, "envio de resultado");
	return 1;
}

// ---------------------------------------------------------------------------
// API para a gamemode
// ---------------------------------------------------------------------------

stock bool:Althea_Iniciar()
{
	if (s_iniciado) return true;
	if (!Alt_AutoTeste())
	{
		Alt_Log("Auto-teste do SHA-256 falhou. Integracao desligada.");
		return false;
	}
	if (!Alt_LerCredenciais()) return false;

	s_cliente = RequestsClient(ALTHEA_URL, RequestHeaders("Content-Type", "application/json", "User-Agent", "AltheaPonte"));
	if (!IsValidRequestsClient(s_cliente))
	{
		Alt_Log("Nao foi possivel criar o cliente HTTP (pawn-requests). Integracao desligada.");
		return false;
	}

	s_horaInicio = gettime();
	s_proximaBusca = s_horaInicio + 5;
	s_timer = SetTimer("Althea_Tick", ALT_TICK_MS, true);
	s_iniciado = true;
	static inicio[7];
	strmid(inicio, s_id, 0, 6, sizeof inicio);
	if (s_modoTeste) format(s_log, sizeof s_log, "Integracao ligada (versao " ALTHEA_VERSAO ", conexao %s..., modo teste LIGADO).", inicio);
	else format(s_log, sizeof s_log, "Integracao ligada (versao " ALTHEA_VERSAO ", conexao %s..., modo teste desligado).", inicio);
	Alt_Log(s_log);
	return true;
}

stock Althea_Encerrar()
{
	if (s_timer != -1) KillTimer(s_timer);
	s_timer = -1;
	s_iniciado = false;
	if (s_resQtd > 0)
	{
		format(s_log, sizeof s_log, "Encerrando com %d resultado(s) sem enviar: o Althea vai marca-los como incertos.", s_resQtd);
		Alt_Log(s_log);
	}
}

// Responde um pedido que devolveu ALTHEA_AGUARDAR (consulta assíncrona ao banco etc.).
// nome/organizacao/contaResolvida são opcionais e aparecem no Discord.
stock bool:Althea_Concluir(const pedido[], ALTHEA_RES:res, const nome[] = "", const organizacao[] = "", contaResolvida = 0)
{
	if (res == ALTHEA_AGUARDAR) return false;
	new i = Alt_PendenteBuscar(pedido);
	if (i != -1) s_pendId[i][0] = EOS;
	else
	{
		// Resposta atrasada (já deu TIMEOUT): ainda vale, o Althea resolve o "incerto".
		new mem = Alt_MemoriaBuscar(pedido);
		if (mem == -1 || s_memCod[mem] != ALT_C_TIMEOUT_GAMEMODE)
		{
			Alt_Log("Althea_Concluir: pedido desconhecido ou ja respondido.");
			return false;
		}
	}
	Alt_Fechar(pedido, ALT_COD:ALT_RES_PARA_COD[_:res], nome, organizacao, contaResolvida);
	return true;
}

// Chame no OnRequestFailure da gamemode (se ela tiver um): acelera a detecção de falha.
stock Althea_FalhaRequisicao(Request:id)
{
	if (id == s_reqBusca && s_buscando)
	{
		s_buscando = false;
		s_reqBusca = Request:-1;
		Alt_Falhou(0, "falha de rede na busca");
	}
	else if (id == s_reqEnvio && s_enviando)
	{
		s_enviando = false;
		s_reqEnvio = Request:-1;
		Alt_Falhou(0, "falha de rede no envio");
	}
}

stock bool:Althea_Pausada()
{
	return s_pausado;
}
stock bool:Althea_ModoTeste()
{
	return s_modoTeste;
}

stock Althea_Pausar(bool:pausar)
{
	s_pausado = pausar;
	Alt_Log(pausar ? "Integracao PAUSADA." : "Integracao retomada.");
}

stock Althea_DefinirModoTeste(bool:ligado)
{
	s_modoTeste = ligado;
	Alt_Log(ligado ? "Modo teste LIGADO: nada sera aplicado." : "Modo teste DESLIGADO: punicoes serao aplicadas.");
}

// rcon althea status | pausar | retomar | teste 1 | teste 0 | recarregar
stock Althea_ComandoRcon(const cmd[])
{
	if (!Alt_Prefixo(cmd, "althea")) return 0;
	if (cmd[6] != EOS && cmd[6] != ' ') return 0;

	if (Alt_Igual(cmd, "althea recarregar"))
	{
		// Lê de novo o arquivo de credenciais (troca de segredo sem reiniciar).
		if (Alt_LerCredenciais()) Alt_Log("Credenciais recarregadas.");
		else
		{
			s_pausado = true;
			Alt_Log("Credenciais invalidas: integracao PAUSADA ate corrigir o arquivo e recarregar.");
		}
	}
	else if (Alt_Igual(cmd, "althea pausar")) Althea_Pausar(true);
	else if (Alt_Igual(cmd, "althea retomar")) Althea_Pausar(false);
	else if (Alt_Igual(cmd, "althea teste 1")) Althea_DefinirModoTeste(true);
	else if (Alt_Igual(cmd, "althea teste 0")) Althea_DefinirModoTeste(false);
	else
	{
		format(s_log, sizeof s_log, "ligada=%d pausada=%d teste=%d | aplicadas %d | recusadas %d | resultados na fila %d | aguardando gamemode %d | falhas seguidas %d",
			s_iniciado, s_pausado, s_modoTeste, s_totalAplicadas, s_totalRecusadas, s_resQtd, Alt_ContarPendentes(), s_falhas);
		Alt_Log(s_log);
	}
	return 1;
}

static Alt_ContarPendentes()
{
	new n = 0;
	for (new i = 0; i < ALT_MAX_PENDENTES; i++) if (s_pendId[i][0] != EOS) n++;
	return n;
}

#if defined ALTHEA_DEFINIR_ONREQUESTFAILURE
	// Só para gamemodes que NÃO têm OnRequestFailure próprio.
	public OnRequestFailure(Request:id, errorCode, errorMessage[], len)
	{
		#pragma unused errorCode, errorMessage, len
		Althea_FalhaRequisicao(id);
		return 1;
	}
#endif
