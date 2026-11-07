// Senha da staff para os botões Aceitar e Recusar da Cadeia Staff.
// Ligada no Painel do bot (senhaCadeiaStaff). Na primeira vez a pessoa cria a senha;
// depois, a cada 30 minutos, digita de novo. Só o hash (scrypt) fica no banco.
const crypto = require('crypto');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const SenhaStaff = require('../models/SenhaStaff');

const LIBERADO_MS = 30 * 60 * 1000;
const MAX_ERROS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const SENHA = { minimo: 4, maximo: 32 };
const MODAL_SENHA = 'senha_cadeia:';

const senhaCadeiaAtiva = (config) => config?.senhaCadeiaStaff === true;

function gerarHash(senha, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(senha), salt, 32).toString('hex') };
}

function confere(senha, registro) {
  const { hash } = gerarHash(senha, registro.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(registro.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// { liberado: true } ou { liberado: false, temSenha }.
async function situacaoDaSenha(userId, agora = Date.now()) {
  const registro = await SenhaStaff.findOne({ userId: String(userId) }).lean();
  if (!registro) return { liberado: false, temSenha: false };
  return { liberado: !!registro.liberadoAte && new Date(registro.liberadoAte).getTime() > agora, temSenha: true };
}

// Modal de criar (senha + confirmar) ou de digitar a senha. "acao" e "messageId" voltam
// no customId para a ação continuar depois da senha.
function modalDaSenha({ temSenha, acao, messageId }) {
  const campo = (id, rotulo) => new ActionRowBuilder().addComponents(new TextInputBuilder()
    .setCustomId(id).setLabel(rotulo).setStyle(TextInputStyle.Short).setRequired(true)
    .setMinLength(SENHA.minimo).setMaxLength(SENHA.maximo));
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_SENHA}${acao}:${messageId}`)
    .setTitle(temSenha ? 'Digite sua senha da Cadeia Staff' : 'Crie sua senha da Cadeia Staff');
  return temSenha
    ? modal.addComponents(campo('senha', 'Senha'))
    : modal.addComponents(campo('senha', `Nova senha (${SENHA.minimo} a ${SENHA.maximo} caracteres)`), campo('confirmar', 'Confirme a senha'));
}

// Cria a senha (primeira vez) ou confere a digitada. Acertou: libera por 30 minutos.
// Devolve { ok, criada } ou { erro }.
async function validarSenha(userId, { senha, confirmar }, agora = Date.now()) {
  userId = String(userId);
  senha = String(senha || '');
  if (senha.length < SENHA.minimo || senha.length > SENHA.maximo) return { erro: `A senha precisa ter de ${SENHA.minimo} a ${SENHA.maximo} caracteres.` };
  const registro = await SenhaStaff.findOne({ userId }).lean();
  const liberadoAte = new Date(agora + LIBERADO_MS);

  if (!registro) {
    if (confirmar === undefined) return { erro: 'Você ainda não tem senha. Clique no botão de novo para criar.' };
    if (senha !== String(confirmar)) return { erro: 'As duas senhas não são iguais. Tente de novo.' };
    await SenhaStaff.create({ userId, ...gerarHash(senha), liberadoAte });
    return { ok: true, criada: true, liberadoAte };
  }

  if (registro.bloqueadoAte && new Date(registro.bloqueadoAte).getTime() > agora) {
    return { erro: `Muitas senhas erradas. Tente de novo <t:${Math.ceil(new Date(registro.bloqueadoAte).getTime() / 1000)}:R>.` };
  }
  if (!confere(senha, registro)) {
    const erros = (registro.erros || 0) + 1;
    const bloqueia = erros >= MAX_ERROS;
    await SenhaStaff.updateOne({ userId }, { $set: bloqueia ? { erros: 0, bloqueadoAte: new Date(agora + BLOQUEIO_MS) } : { erros } });
    return { erro: bloqueia ? 'Senha errada. Muitas tentativas: espere 15 minutos.' : `Senha errada (${erros} de ${MAX_ERROS}).` };
  }
  await SenhaStaff.updateOne({ userId }, { $set: { liberadoAte, erros: 0, bloqueadoAte: null } });
  return { ok: true, criada: false, liberadoAte };
}

// Apaga a senha de alguém (esqueceu): na próxima vez a pessoa cria outra.
const apagarSenha = (userId) => SenhaStaff.deleteOne({ userId: String(userId) });

module.exports = { MODAL_SENHA, LIBERADO_MS, senhaCadeiaAtiva, situacaoDaSenha, modalDaSenha, validarSenha, apagarSenha };
