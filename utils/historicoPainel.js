// Registra no histórico do painel o que mudou entre a configuração de antes e
// a de depois. Usado pelo Painel do bot (site) e pelo /painel do Discord.
const PainelHistorico = require('../models/PainelHistorico');

const CANAIS = {
  pc: 'Canal Denúncias PC', mobile: 'Canal Denúncias Mobile', logs: 'Canal Cadeia Staff', log: 'Canal Log administrativo',
  analysis: 'Canal Em análise', topDaily: 'Canal Top diário', relatorioPunicoes: 'Canal Relatório de punições', provasStaff: 'Canal Provas da staff',
  backup: 'Canal Backup', armazem: 'Canal Armazém', registro: 'Canal Registro', cloud: 'Canal Cloud', canalDenuncia: 'Canal fixo de denúncias'
};
const CARGOS = { pc: 'Cargo PC', permitido: 'Cargo Mobile', administrador: 'Cargo Staff', responsavel_admin: 'Cargo Responsável', fundador: 'Cargo Fundador' };
const OPCOES = {
  manutencaoDenuncia: 'Manutenção das denúncias',
  bloquearReivindicacaoComPendentes: 'Bloqueio de pendências anteriores',
  siteSomenteLeitura: 'Site somente leitura',
  alertaMotivoCritico: 'Alerta de motivo crítico',
  esperaEntreDenuncias: 'Espera entre denúncias',
  minutosEntreDenuncias: 'Minutos entre denúncias',
  esperaEntreReivindicacoes: 'Espera para reivindicar',
  minutosEntreReivindicacoes: 'Minutos para reivindicar',
  avisoReivindicacao: 'Aviso de reivindicação parada',
  minutosAvisoReivindicacao: 'Minutos do aviso de reivindicação',
  analiseAutomatica: 'Análise automática',
  minutosAnaliseAutomatica: 'Minutos da análise automática',
  minutosArquivarTopico: 'Arquivar tópicos após (minutos)',
  topicosPrivados: 'Tópicos privados',
  senhaCadeiaStaff: 'Senha na Cadeia Staff'
};

const texto = (valor) => {
  if (valor === true) return 'ligado';
  if (valor === false) return 'desligado';
  if (valor === undefined || valor === null || valor === '') return '(vazio)';
  return String(valor).slice(0, 300);
};

function diferencas(antes = {}, depois = {}) {
  const lista = [];
  const comparar = (campo, a, d) => {
    // Sem valor salvo antes vale o padrão; só registra se o novo valor foi gravado.
    if (d === undefined) return;
    if (texto(a) !== texto(d)) lista.push({ campo, antes: texto(a), depois: texto(d) });
  };
  for (const [chave, nome] of Object.entries(OPCOES)) comparar(nome, antes?.[chave], depois?.[chave]);
  for (const [chave, nome] of Object.entries(CANAIS)) comparar(nome, antes?.channels?.[chave], depois?.channels?.[chave]);
  for (const [chave, nome] of Object.entries(CARGOS)) comparar(nome, antes?.roles?.[chave], depois?.roles?.[chave]);
  return lista;
}

// "antes" e "depois" podem ser documentos do mongoose ou objetos simples.
async function registrarAlteracao({ guildId, por, via, antes, depois }) {
  const simples = (c) => (c?.toObject ? c.toObject() : c) || {};
  const mudancas = diferencas(simples(antes), simples(depois));
  if (!mudancas.length) return null;
  return PainelHistorico.create({ guildId: String(guildId), por: String(por || '').slice(0, 100), via, mudancas });
}

async function ultimasAlteracoes(guildId, limite = 20) {
  return PainelHistorico.find({ guildId: String(guildId) }).sort({ em: -1 }).limit(limite).lean();
}

module.exports = { registrarAlteracao, ultimasAlteracoes, diferencas };
