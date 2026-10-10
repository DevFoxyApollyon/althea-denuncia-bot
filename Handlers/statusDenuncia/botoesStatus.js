// Deixa os botões da denúncia de acordo com a situação dela: o que já foi feito
// fica desativado, para ninguém clicar duas vezes na mesma ação.
const { Logger } = require('../../utils/logger');

const log = new Logger({ tag: 'BotoesStatus', debug: false });

const BOTOES_DE_STATUS = ['reivindicar', 'analiser', 'aceitar', 'recusar'];

// Quais botões ficam desativados em cada situação. "analiser" também continua
// desativado depois que a análise já aconteceu (ver abaixo).
function botoesDesativados(status) {
  return {
    pendente: [],
    reivindicacao: ['reivindicar'],
    analise: ['reivindicar', 'analiser'],
    aceita: ['reivindicar', 'aceitar'],
    recusada: ['reivindicar', 'recusar'],
    finalizada: BOTOES_DE_STATUS
  }[status] || [];
}

const temBotoesDeStatus = (mensagem) =>
  Boolean(mensagem?.components?.some(linha => linha.components?.some(botao => botao.customId === 'reivindicar')));

// A mensagem dos botões é uma das primeiras do tópico. Quando a ação não veio
// de um clique nela (site, recusa por palavra-chave, análise automática), é
// procurada ali.
async function buscarMensagemDosBotoes(canal, mensagem) {
  if (temBotoesDeStatus(mensagem)) return mensagem;
  if (!canal?.messages?.fetch) return null;
  const primeiras = await canal.messages.fetch({ after: canal.id, limit: 10 }).catch(() => null);
  return primeiras?.find(temBotoesDeStatus) || null;
}

async function sincronizarBotoes(canal, status, mensagemClicada = null) {
  try {
    const mensagem = await buscarMensagemDosBotoes(canal, mensagemClicada);
    if (!mensagem) return false;

    const desativar = botoesDesativados(status);
    let mudou = false;
    const components = mensagem.components.map((linha) => ({
      ...linha.toJSON(),
      components: linha.components.map((botao) => {
        const dados = botao.toJSON();
        if (!BOTOES_DE_STATUS.includes(botao.customId)) return dados;

        // Depois de analisada, a denúncia não volta a poder ser "analisada".
        const jaAnalisada = botao.customId === 'analiser' && dados.disabled && status !== 'pendente';
        const desativado = desativar.includes(botao.customId) || jaAnalisada;
        if (Boolean(dados.disabled) !== desativado) mudou = true;
        return { ...dados, disabled: desativado };
      })
    }));

    if (mudou) await mensagem.edit({ components });
    return mudou;
  } catch (erro) {
    log.warn('Falha ao atualizar os botões da denúncia', erro?.message);
    return false;
  }
}

module.exports = { sincronizarBotoes, botoesDesativados };
