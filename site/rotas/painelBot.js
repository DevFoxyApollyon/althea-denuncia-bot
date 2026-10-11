// O /painel do bot, pelo site: canais, cargos, manutenção, bloqueio de
// pendências e usuários isentos. Só o responsável do servidor vê e altera.
const express = require('express');
const { ChannelType } = require('discord.js');
const Config = require('../../models/Config');
const { atualizarMensagemDenuncia } = require('../../commands/denuncia');
const { cachePanelConfig, bloqueioPendentesAtivo } = require('../../commands/painel');
const { getUsuariosIsentos, salvarUsuariosIsentos, normalizarIds } = require('../../utils/usuariosIsentos');
const { acessoAoServidor, limparCacheDeAcesso } = require('../acesso');
const { resolverPessoas, ErroHttp, assincrono } = require('./comum');

// Canais do próprio servidor (escolhidos numa lista) e de outros servidores (pelo ID).
const CANAIS_LOCAIS = ['pc', 'mobile', 'logs', 'log', 'backup', 'armazem', 'analysis', 'topDaily'];
const CANAIS_EXTERNOS = ['registro', 'cloud', 'canalDenuncia'];
const CANAIS_OBRIGATORIOS = ['pc', 'mobile', 'logs'];
const CARGOS = ['permitido', 'pc', 'administrador', 'responsavel_admin'];
const CARGOS_OBRIGATORIOS = ['permitido', 'pc', 'responsavel_admin'];
const MAX_ISENTOS = 200;

const TIPOS_DE_CANAL = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia];
const ehId = (valor) => /^\d{15,21}$/.test(valor);

// Confere o que veio do formulário. "atual" é o que está salvo: um valor que não
// mudou é sempre aceito, para não travar quem só quer trocar outra coisa.
// canais/cargos são os IDs do servidor; canaisVisiveis, todos os que o bot enxerga.
function validarPainel(entrada, { atual = {}, canais, cargos, canaisVisiveis, cargosDeQuemSalva }) {
  const channels = {};
  const roles = {};
  const texto = (valor) => String(valor ?? '').trim();

  for (const chave of [...CANAIS_LOCAIS, ...CANAIS_EXTERNOS]) {
    const valor = texto(entrada?.channels?.[chave]);
    const salvo = texto(atual.channels?.[chave]);
    if (!valor && CANAIS_OBRIGATORIOS.includes(chave)) throw new Error('Escolha os três canais principais: PC, Mobile e Cadeia Staff.');
    if (valor && valor !== salvo) {
      if (!ehId(valor)) throw new Error('ID de canal inválido. Use só os números do ID.');
      if (CANAIS_LOCAIS.includes(chave) && !canais.has(valor)) throw new Error('Um dos canais escolhidos não existe mais neste servidor.');
      if (CANAIS_EXTERNOS.includes(chave) && !canaisVisiveis.has(valor)) throw new Error(`O bot não enxerga o canal ${valor}. Confira o ID e se o bot está nesse servidor.`);
    }
    channels[chave] = valor;
  }

  for (const chave of CARGOS) {
    const valor = texto(entrada?.roles?.[chave]);
    const salvo = texto(atual.roles?.[chave]);
    if (!valor && CARGOS_OBRIGATORIOS.includes(chave)) throw new Error('Escolha os cargos de denúncia PC, de denúncia Mobile e de responsável.');
    if (valor && valor !== salvo && !cargos.has(valor)) throw new Error('Um dos cargos escolhidos não existe mais neste servidor.');
    roles[chave] = valor;
  }

  // Quem salva precisa continuar sendo responsável, senão perde esta tela.
  if (!cargosDeQuemSalva.has(roles.responsavel_admin)) {
    throw new Error('Você não tem o cargo escolhido como responsável e ficaria sem acesso a esta tela. Pegue o cargo no Discord antes de trocar.');
  }

  const bruto = Array.isArray(entrada?.isentos) ? entrada.isentos.join(' ') : texto(entrada?.isentos);
  const isentos = normalizarIds(bruto);
  if (bruto.trim() && !isentos.length) throw new Error('Nenhum ID de usuário válido na lista de isentos.');
  if (isentos.length > MAX_ISENTOS) throw new Error(`A lista de isentos aceita até ${MAX_ISENTOS} usuários.`);

  return {
    channels,
    roles,
    manutencaoDenuncia: entrada?.manutencao === true,
    bloquearReivindicacaoComPendentes: entrada?.bloqueio !== false,
    isentos
  };
}

function registrarRotasDoPainelDoBot(router, { client }) {
  async function acessoDoResponsavel(req, guildId) {
    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso?.papeis.responsavel) throw new ErroHttp(403, 'O painel do bot é restrito ao responsável.');
    return acesso;
  }

  async function montar(guild) {
    const [config, isentos] = await Promise.all([Config.findOne({ guildId: guild.id }).lean(), getUsuariosIsentos(true)]);
    const pessoas = await resolverPessoas(client, guild, isentos);

    return {
      valores: {
        channels: Object.fromEntries([...CANAIS_LOCAIS, ...CANAIS_EXTERNOS].map(chave => [chave, config?.channels?.[chave] || ''])),
        roles: Object.fromEntries(CARGOS.map(chave => [chave, config?.roles?.[chave] || ''])),
        manutencao: Boolean(config?.manutencaoDenuncia),
        bloqueio: bloqueioPendentesAtivo(config),
        isentos: isentos.map(id => ({ id, nome: pessoas[id]?.nome || null }))
      },
      canais: [...guild.channels.cache.values()]
        .filter(canal => TIPOS_DE_CANAL.includes(canal.type))
        .sort((a, b) => (a.parent?.rawPosition ?? -1) - (b.parent?.rawPosition ?? -1) || a.rawPosition - b.rawPosition)
        .map(canal => ({ id: canal.id, nome: canal.name, categoria: canal.parent?.name || '' })),
      cargos: [...guild.roles.cache.values()]
        .filter(cargo => cargo.id !== guild.id && !cargo.managed)
        .sort((a, b) => b.rawPosition - a.rawPosition)
        .map(cargo => ({ id: cargo.id, nome: cargo.name })),
      // Canais de outros servidores: o nome aparece ao lado do ID, quando o bot enxerga.
      externos: Object.fromEntries(CANAIS_EXTERNOS.map(chave => {
        const canal = client.channels.cache.get(config?.channels?.[chave]);
        return [chave, canal ? `#${canal.name} em ${canal.guild?.name || 'outro servidor'}` : null];
      })),
      atualizado: config ? { em: config.lastUpdated || null, por: config.updatedBy || null } : null
    };
  }

  router.get('/painel-bot', assincrono(async (req, res) => {
    const acesso = await acessoDoResponsavel(req, req.query.guildId);
    res.json(await montar(acesso.guild));
  }));

  router.post('/painel-bot', express.json({ limit: '32kb' }), assincrono(async (req, res) => {
    const acesso = await acessoDoResponsavel(req, req.body?.guildId);
    const { guild, member } = acesso;
    const atual = await Config.findOne({ guildId: guild.id }).lean();

    let novo;
    try {
      novo = validarPainel(req.body, {
        atual: atual || {},
        canais: new Set(guild.channels.cache.keys()),
        cargos: new Set(guild.roles.cache.keys()),
        canaisVisiveis: new Set(client.channels.cache.keys()),
        cargosDeQuemSalva: new Set(member.roles.cache.keys())
      });
    } catch (erro) {
      throw new ErroHttp(400, erro.message);
    }

    const quem = member.user?.tag || req.usuario.id;
    const ajustes = { manutencaoDenuncia: novo.manutencaoDenuncia, bloquearReivindicacaoComPendentes: novo.bloquearReivindicacaoComPendentes, lastUpdated: new Date(), updatedBy: `${quem} (site)` };
    for (const [chave, valor] of Object.entries(novo.channels)) ajustes[`channels.${chave}`] = valor;
    for (const [chave, valor] of Object.entries(novo.roles)) ajustes[`roles.${chave}`] = valor;

    const salvo = await Config.findOneAndUpdate({ guildId: guild.id }, { $set: ajustes }, { new: true, upsert: true });
    cachePanelConfig(guild.id, salvo);
    // Os cargos podem ter mudado: o acesso de todo mundo é conferido de novo.
    limparCacheDeAcesso();

    // A lista de isentos vale para todos os servidores: só mexe se mudou.
    const isentosAntes = await getUsuariosIsentos(true);
    if (isentosAntes.length !== novo.isentos.length || novo.isentos.some(id => !isentosAntes.includes(id))) {
      await salvarUsuariosIsentos(novo.isentos, `${quem} (site)`);
    }

    // A mensagem do /denuncia mostra a manutenção e mora no canal fixo: refaz se um dos dois mudou.
    let aviso = '';
    if (Boolean(atual?.manutencaoDenuncia) !== novo.manutencaoDenuncia || (atual?.channels?.canalDenuncia || '') !== novo.channels.canalDenuncia) {
      await atualizarMensagemDenuncia(client, guild, salvo).catch((erro) => {
        console.error('[PainelBot] Falha ao atualizar a mensagem do /denuncia:', erro?.message || erro);
        aviso = ' A mensagem do /denuncia no Discord não pôde ser atualizada agora; use /denuncia para refazer.';
      });
    }

    res.json({ ok: true, mensagem: `Painel do bot salvo.${aviso}`, ...await montar(guild) });
  }));
}

module.exports = { registrarRotasDoPainelDoBot, validarPainel };
