// Valores fixos da ponte com o jogo (SA-MP).

// Comandos do Brasil RolePlay. Marcadores: {cmd}, {id}, {tempo} e {motivo}.
// Banimento em dias (0 = permanente); cadeia em minutos (0 = retira a cadeia).
// Todos valem com o jogador online ou offline.
//  - ban e cadeia: punição (a staff escolhe entre os dois no jogo);
//  - aviso: aviso extra (o /tempban já dá um; com 2 motivos vai mais um);
//  - blackban: banimento permanente, no nick da conta (lido no /vercontaid).
// Desbanir não é comando: o jogo usa /vercontaid > Checar > Desbanir Conta.
const TEMPLATES_PADRAO = Object.freeze({
  ban: '/tempban {id} {tempo} {motivo}',
  cadeia: '/agendacadeia {id} {tempo} {motivo}',
  aviso: '/agendaaviso {id} {motivo}',
  blackban: '/blackban {nick} {motivo}'
});

// Só estes viram tipo de punição; os outros templates são auxiliares.
const CMDS_PUNICAO = Object.freeze(['ban', 'cadeia']);

// Templates provisórios da primeira versão: guilds ativadas com eles passam aos atuais.
const TEMPLATES_ANTIGOS = Object.freeze({
  jail: '/prender {id} {tempo} {motivo}',
  ban: '/ban {id} {tempo} {motivo}',
  kick: '/kick {id} {motivo}'
});

// Todo motivo enviado ao jogo termina com esta marca (punição vinda do Discord).
const SUFIXO_MOTIVO = '[DC]';

// Tabela de punições. Cada motivo pode ter sinônimos separados por "|" (o primeiro é o nome).
// Com mais de um motivo na denúncia: banimentos somam dias e avisos (SAAV + RUSH = 6 dias,
// 2 avisos); permanente vence tudo; banimento vence cadeia; só cadeias somam minutos.
const REGRAS_PUNICAO = Object.freeze([
  {
    grupo: 'Banimento permanente (BlackBan)', cmd: 'ban', tempo: 0, avisos: 0,
    motivos: ['NEGAR INFO', 'VENDA DE ITENS', 'COMPRA DE DINHEIRO', 'OFENSA STAFF', 'GOLPE DE COINS', 'ASSEDIO',
      'OFENSAS DISCRIMINATORIAS|OFENSA DISCRIMINATORIA', 'GOLPE EM PLAYERS|GOLPE EM PLAYER', 'VENDA DE CONTA',
      'FARMS ILEGAIS|FARM ILEGAL', 'JOGANDO BANIDO', 'ABUSO DE FUNCOES|FLOOD DE MULTA|FLOOD DE ATO']
  },
  { grupo: 'Banimento de 30 dias', cmd: 'ban', tempo: 30, avisos: 0, motivos: ['HK', 'DB', 'MONEY FARM|MF'] },
  {
    grupo: 'Banimento de 5 dias + aviso', cmd: 'ban', tempo: 5, avisos: 1,
    motivos: ['DM', 'RK', 'KOS', 'ADB', 'BUG DE PIXEL', 'FLODAR ESTRELA|FLOOD DE ESTRELA', 'C-BUG|CBUG']
  },
  {
    grupo: 'Banimento de 3 dias + aviso', cmd: 'ban', tempo: 3, avisos: 1,
    motivos: ['ATP', 'SAAV', 'RUSH', 'PK', 'CL', 'ACC|MORTE PERTO DE PM', 'ACB', 'FORCAR RP', 'SK', 'CORRER SAFE', 'TK',
      'QRR SOLO', 'CORTE DE ANIM', 'ABORDAGEM SOLO', 'ASSALTO SOLO', 'ASSALTO SEM ORG',
      'ACOES EM SAFEZONE|ACAO EM SAFEZONE|ACOES EM SAFE', 'APAGAR DENUNCIA|EDITAR DENUNCIA']
  },
  {
    grupo: 'Banimento de 1 dia + aviso', cmd: 'ban', tempo: 1, avisos: 1,
    motivos: ['MG', 'PG', 'ZZ', 'VDM', 'CB', 'MAL USO /EU|MAL USO DO /EU', 'SAMU ARMADO', 'VENDA DE ARMAS',
      'CARRO DE INV|BRINQUEDOS|BQGG|CONE|JETPACK']
  },
  { grupo: 'Cadeia de 120 minutos', cmd: 'cadeia', tempo: 120, avisos: 0, motivos: ['MIX', 'CJ', 'BH', 'ANUNCIO INDEVIDO'] }
]);

// Sem motivo reconhecido: entra como banimento de 1 dia para a staff conferir no jogo.
const CMD_PADRAO = 'ban';
const TEMPO_PADRAO = 1;

// PCs ativos ao mesmo tempo por guild, se o código não disser outro valor.
const LIMITE_PCS_PADRAO = 3;

const STATUS_PUNICAO = ['aceita', 'executando', 'aplicada', 'cancelada'];
const STATUS_INSTALACAO = ['ativa', 'revogada', 'bloqueada'];
const ACOES_USO = ['fila', 'editar', 'executar', 'aplicar', 'cancelar', 'auth_falhou', 'hwid_diferente', 'guild_inativa', 'ping', 'codigo_negado', 'retirar', 'remover', 'limpar', 'regras', 'nota', 'relatorio',
  'gm_busca', 'gm_resultado', 'gm_auth_falhou', 'gm_selo_invalido', 'gm_enviar', 'gm_cancelar',
  'gm_incerto_ok', 'gm_incerto_reenviar', 'gm_credencial', 'gm_config'];

// Ponte com a gamemode (protocolo gm/v1, doc/PONTE_GAMEMODE.md).
const EXECUTORES = ['pc', 'gamemode', 'ambos'];
const TIPOS_GM = ['ban', 'cadeia', 'desbanir', 'soltar'];
const STATUS_CONEXAO_GM = ['ativa', 'revogada'];
const STATUS_PEDIDO_GM = ['aprovado', 'entregue', 'aplicada', 'simulada', 'recusada', 'erro', 'incerto', 'cancelado'];
const LIMITES_GM_PADRAO = Object.freeze({
  pausado: false,
  maxBanDias: 30,
  // Decisão do JV: ban permanente pelo bot liberado, com um responsável só (sem dupla confirmação).
  permitirPermanente: true,
  maxCadeiaMin: 300,
  maxAvisos: 3,
  modoTeste: true
});

// Versão mais nova do mod Lua (ponte_denuncias.lua). O mod compara com a dele e avisa a staff quando está atrás.
const VERSAO_MOD_ATUAL = '1.8.4';

module.exports = {
  TEMPLATES_PADRAO,
  CMDS_PUNICAO,
  TEMPLATES_ANTIGOS,
  SUFIXO_MOTIVO,
  REGRAS_PUNICAO,
  CMD_PADRAO,
  TEMPO_PADRAO,
  LIMITE_PCS_PADRAO,
  STATUS_PUNICAO,
  STATUS_INSTALACAO,
  ACOES_USO,
  EXECUTORES,
  TIPOS_GM,
  STATUS_CONEXAO_GM,
  STATUS_PEDIDO_GM,
  LIMITES_GM_PADRAO,
  VERSAO_MOD_ATUAL
};
