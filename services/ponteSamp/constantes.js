// Valores fixos da ponte com o jogo (SA-MP).

// Tipos de punição que vão para o jogo.
const CMDS_PUNICAO = Object.freeze(['ban', 'cadeia']);

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

const STATUS_PUNICAO = ['aceita', 'executando', 'aplicada', 'cancelada'];
const ACOES_USO = ['editar', 'codigo_negado', 'regras', 'ativar', 'apagar',
  'gm_busca', 'gm_resultado', 'gm_auth_falhou', 'gm_selo_invalido', 'gm_enviar', 'gm_cancelar',
  'gm_incerto_ok', 'gm_incerto_reenviar', 'gm_credencial', 'gm_config'];

// Ponte com a gamemode (protocolo gm/v1, doc/PONTE_GAMEMODE.md).
const TIPOS_GM = ['ban', 'cadeia', 'desbanir', 'soltar', 'consultar'];
const STATUS_CONEXAO_GM = ['ativa', 'revogada'];
const STATUS_PEDIDO_GM = ['aprovado', 'entregue', 'aplicada', 'simulada', 'recusada', 'erro', 'incerto', 'cancelado'];
const LIMITES_GM_PADRAO = Object.freeze({
  pausado: false,
  maxBanDias: 90,
  // Decisão do JV: ban permanente pelo bot liberado, com um responsável só (sem dupla confirmação).
  permitirPermanente: true,
  maxCadeiaMin: 300,
  maxAvisos: 3,
  modoTeste: true
});

// Versão do include da gamemode (ALTHEA_VERSAO em althea_ponte/althea_ponte.inc).
// O include fica fora do bot (pasta althea-gamemode); ao lançar versão nova dele, atualize aqui.
const VERSAO_INCLUDE_GM = '1.0.1';

module.exports = {
  CMDS_PUNICAO,
  SUFIXO_MOTIVO,
  REGRAS_PUNICAO,
  CMD_PADRAO,
  TEMPO_PADRAO,
  STATUS_PUNICAO,
  ACOES_USO,
  TIPOS_GM,
  STATUS_CONEXAO_GM,
  STATUS_PEDIDO_GM,
  LIMITES_GM_PADRAO,
  VERSAO_INCLUDE_GM
};
