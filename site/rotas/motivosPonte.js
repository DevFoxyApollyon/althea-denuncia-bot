// Motivos de punição da ponte com o jogo, pelo site: a tabela é a mesma em todos os
// servidores. Administradores e responsáveis veem; só o responsável (e o dono do bot) altera.
const express = require('express');
const { acessoAoServidor } = require('../acesso');
const { ErroHttp, assincrono } = require('./comum');
const motivos = require('../../services/ponteSamp/motivos');
const { reclassificarFila } = require('../../services/ponteSamp/aceite');
const PonteUso = require('../../models/PonteUso');
const { ehDono } = require('../../services/ponteSamp/gestao');

const paraTela = ({ tabela, propria }, podeApagar, podeEditar) => ({
  propria,
  podeEditar,
  // Só o dono do bot apaga motivos; os outros mudam e adicionam.
  podeApagar,
  tabela: tabela.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.filter(s => s !== t.nome), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos, texto: t.texto || '', grupo: t.grupo }))
});

function registrarRotasDeMotivosDaPonte(router, { client }) {
  async function acessoDaStaff(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso?.papeis.staff) throw new ErroHttp(403, 'Os motivos de punição são da staff (administrador ou responsável).');
    return acesso;
  }
  const podeEditar = (req, acesso) => Boolean(acesso.papeis.responsavel || ehDono(req.usuario.id));

  router.get('/motivos-ponte', assincrono(async (req, res) => {
    const acesso = await acessoDaStaff(req, req.query.guildId);
    res.json(paraTela(await motivos.obterTabela(), ehDono(req.usuario.id), podeEditar(req, acesso)));
  }));

  router.post('/motivos-ponte', express.json({ limit: '64kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDaStaff(req, req.body?.guildId);
    if (!podeEditar(req, acesso)) throw new ErroHttp(403, 'Só o responsável adiciona e muda os motivos de punição.');
    const podeApagar = ehDono(req.usuario.id);
    const salvo = await motivos.salvarTabela(req.body?.tabela, `${req.usuario.nome} (site, ${acesso.guild.name})`, { podeApagar });
    if (salvo.erro) throw new ErroHttp(400, salvo.erro);
    // Denúncias que esperavam por um motivo novo saem do "aguardando" (não segura a resposta).
    reclassificarFila({ client, tabela: salvo.tabela }).catch(() => {});
    require('../../commands/provaStaff').atualizarProvasForaDaTabela({ client, tabela: salvo.tabela }).catch(() => {});
    await PonteUso.create({
      guildId: acesso.guild.id, acao: 'regras',
      detalhes: { por: req.usuario.id, nome: req.usuario.nome, motivos: salvo.tabela.length, propria: salvo.propria }
    }).catch(() => {});
    res.json({ ok: true, mensagem: salvo.propria ? 'Motivos salvos para todos os servidores.' : 'Tabela padrão restaurada.', ...paraTela(salvo, podeApagar, true) });
  }));
}

module.exports = { registrarRotasDeMotivosDaPonte };
