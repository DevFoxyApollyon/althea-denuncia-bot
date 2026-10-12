// Rotas da API do site. A lógica fica em site/rotas/, separada por assunto.
const express = require('express');
const mongoose = require('mongoose');
const Denuncia = require('../models/Denuncia');
const { acessoAoServidor, relacaoComDenuncia, acompanharPedido } = require('./acesso');
const comum = require('./rotas/comum');
const { garantirConfigDoSite } = require('./configSite');
const { registrarRotasDeDenuncias } = require('./rotas/denuncias');
const { registrarRotasDaStaff } = require('./rotas/staff');
const { registrarRotasDeSugestoes } = require('./rotas/sugestoes');
const { registrarRotasDeIdentificacao, faltaIdentificar } = require('./rotas/identificacao');
const { registrarRotasDeJogadores } = require('./rotas/jogadores');
const { registrarRotasDoChat } = require('./rotas/chat');
const { registrarRotasDaSala } = require('./rotas/chatSala');
const { registrarRotasDoTeste } = require('./rotas/teste');
const { registrarRotasDeAvisos } = require('./rotas/avisos');
const { registrarRotasDoPainelDoBot } = require('./rotas/painelBot');
const { registrarRotasDeGestao } = require('./rotas/gestao');
const { registrarRotasDeRascunho } = require('./rotas/rascunho');
const { registrarRotasDeSessoes } = require('./sessoes');

const { ErroHttp, criarLimitador } = comum;

function criarRotas({ client }) {
  const router = express.Router();
  const podeEscrever = criarLimitador(20, 60 * 1000);
  const podeEnviarArquivo = criarLimitador(10, 5 * 60 * 1000);
  const podeAbrirDenuncia = criarLimitador(5, 10 * 60 * 1000);
  const podeFinalizar = criarLimitador(3, 60 * 1000);
  const finalizandoDenuncias = new Set();

  // Método e caminho do pedido ficam à mão para o modo somente leitura.
  router.use(acompanharPedido);

  router.use((req, res, next) => {
    if (!req.usuario) return next(new ErroHttp(401, 'Entre com sua conta do Discord para continuar.'));
    res.set('Cache-Control', 'no-store');
    // Categorias e prazos salvos pelo responsável precisam estar em memória.
    garantirConfigDoSite().then(() => next(), next);
  });

  // Carrega a denúncia e confere se quem pediu pode vê-la.
  async function carregarDenuncia(req) {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ErroHttp(404, 'Denúncia não encontrada.');

    const denuncia = await Denuncia.findById(req.params.id);
    if (!denuncia) throw new ErroHttp(404, 'Denúncia não encontrada.');

    const acesso = await acessoAoServidor(client, req.usuario.id, denuncia.guildId);
    // Igual ao Discord: enquanto nem todos os acusados estão ligados a uma conta,
    // o tópico não é restrito e qualquer membro do servidor pode ver e falar.
    const relacao = acesso && (relacaoComDenuncia(denuncia, req.usuario.id, acesso.papeis)
      || (denuncia.restritoParticipacao && !faltaIdentificar(denuncia) ? null : 'participante'));
    // 404 também para quem não tem acesso, para não revelar que a denúncia existe.
    if (!relacao) throw new ErroHttp(404, 'Denúncia não encontrada.');

    return { denuncia, acesso, relacao };
  }

  async function buscarTopico(denuncia) {
    const topico = await client.channels.fetch(denuncia.threadId).catch(() => null);
    if (!topico?.isTextBased?.()) throw new ErroHttp(410, 'O tópico desta denúncia não está mais disponível no Discord.');
    return topico;
  }

  const contexto = { client, carregarDenuncia, buscarTopico, podeEscrever, podeEnviarArquivo, podeAbrirDenuncia, podeFinalizar, finalizandoDenuncias };
  registrarRotasDeDenuncias(router, contexto);
  registrarRotasDaStaff(router, contexto);
  registrarRotasDeSugestoes(router, contexto);
  registrarRotasDeIdentificacao(router, contexto);
  registrarRotasDeJogadores(router, contexto);
  registrarRotasDaSala(router, contexto);
  registrarRotasDoChat(router, contexto);
  registrarRotasDoTeste(router, contexto);
  registrarRotasDeAvisos(router, contexto);
  registrarRotasDoPainelDoBot(router, contexto);
  registrarRotasDeGestao(router, contexto);
  registrarRotasDeRascunho(router, contexto);
  registrarRotasDeSessoes(router);

  return router;
}

module.exports = { criarRotas, ...comum };
