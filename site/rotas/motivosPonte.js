// Motivos de punição da ponte com o jogo, pelo site: a tabela é a mesma em todos os
// servidores. Administradores e responsáveis veem e alteram.
const express = require('express');
const { acessoAoServidor } = require('../acesso');
const { ErroHttp, assincrono } = require('./comum');
const motivos = require('../../services/ponteSamp/motivos');
const { reclassificarFila } = require('../../services/ponteSamp/aceite');
const PonteUso = require('../../models/PonteUso');

const paraTela = ({ tabela, propria }) => ({
  propria,
  tabela: tabela.map(t => ({ nome: t.nome, sinonimos: t.sinonimos.filter(s => s !== t.nome), cmd: t.cmd, tempo: t.tempo, avisos: t.avisos, grupo: t.grupo }))
});

function registrarRotasDeMotivosDaPonte(router, { client }) {
  async function acessoDaStaff(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso?.papeis.staff) throw new ErroHttp(403, 'Os motivos de punição são da staff (administrador ou responsável).');
    return acesso;
  }

  router.get('/motivos-ponte', assincrono(async (req, res) => {
    await acessoDaStaff(req, req.query.guildId);
    res.json(paraTela(await motivos.obterTabela()));
  }));

  router.post('/motivos-ponte', express.json({ limit: '64kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDaStaff(req, req.body?.guildId);
    const salvo = await motivos.salvarTabela(req.body?.tabela, `${req.usuario.nome} (site, ${acesso.guild.name})`);
    if (salvo.erro) throw new ErroHttp(400, salvo.erro);
    // Denúncias que esperavam por um motivo novo saem do "aguardando" (não segura a resposta).
    reclassificarFila({ client, tabela: salvo.tabela }).catch(() => {});
    await PonteUso.create({
      guildId: acesso.guild.id, acao: 'regras',
      detalhes: { por: req.usuario.id, nome: req.usuario.nome, motivos: salvo.tabela.length, propria: salvo.propria }
    }).catch(() => {});
    res.json({ ok: true, mensagem: salvo.propria ? 'Motivos salvos para todos os servidores.' : 'Tabela padrão restaurada.', ...paraTela(salvo) });
  }));
}

module.exports = { registrarRotasDeMotivosDaPonte };
