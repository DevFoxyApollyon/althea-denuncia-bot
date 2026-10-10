// Rotas usadas por quem acompanha uma denúncia: sessão, listas, caso, anexos, envio de provas, abertura, avaliação e tempo real.
const express = require('express');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');
const Denuncia = require('../../models/Denuncia');
const DenunciaMensagem = require('../../models/DenunciaMensagem');
const NotaInterna = require('../../models/NotaInterna');
const AcessoCaso = require('../../models/AcessoCaso');
const { registrarFeedback } = require('../../utils/feedback');
const { getConfig } = require('../../utils/configCache');
const ModerationAction = require('../../models/ModerationAction');
const { avisarMudanca, ouvirMudancas } = require('../../utils/eventosDenuncia');
const { prioridadeDoMotivo, configVisivel } = require('../categorias');
const { registrarMensagens } = require('../../utils/denunciaMensagens');
const { contemPalavraProibida, contemLinkProibido } = require('../../utils/strikeWords');
const { handleDenunciaSubmit } = require('../../commands/denuncia');
const { atualizarTextoDeStatus } = require('../../utils/atualizarStatus');
const { servidoresDoUsuario, acessoAoServidor, relacaoComDenuncia } = require('../acesso');
const { criarInteracaoSite, resultadoDaInteracao } = require('../interacaoSite');
const {
  STATUS_ABERTOS,
  LIMITE_LISTA,
  SERVIDOR_OCULTO_VISAO_ADMIN,
  TAMANHO_MAX_MENSAGEM,
  EXTENSOES_PERMITIDAS,
  LIMITES_FORMULARIO,
  LIMITE_MOTIVO,
  resolverPessoas,
  atribuirAutoriaDoSite,
  extrairMencoes,
  ATALHO_DO_SITE,
  historicoDoAcusado,
  registrarAcesso,
  STATUS_DECIDIDOS,
  presencaPorTopico,
  conexoesPorUsuario,
  quemEstaVendo,
  conteudoCombinaComExtensao,
  ErroHttp,
  assincrono,
  limiteDeUploadBytes,
  exigirDenunciaAberta,
  resumoDaDenuncia,
  serializarMensagemParaSite
} = require('./comum');

// Texto de abertura de uma denúncia: tem pelo menos dois dos campos do resumo.
function ehResumoDaDenuncia(texto) {
  return ['**Denunciante**:', '**Acusado**:', '**Motivo**:', '**Prova(s)**:']
    .filter(campo => String(texto || '').includes(campo)).length >= 2;
}

function registrarRotasDeDenuncias(router, { client, carregarDenuncia, buscarTopico, podeEscrever, podeEnviarArquivo, podeAbrirDenuncia }) {
  router.get('/eu', assincrono(async (req, res) => {
    const servidores = await servidoresDoUsuario(client, req.usuario.id);
    res.json({
      usuario: req.usuario,
      visaoAdmin: servidores.some(({ guild, papeis }) =>
        papeis.responsavel && guild.id !== SERVIDOR_OCULTO_VISAO_ADMIN
      ),
      servidores: servidores.map(({ guild, member, config, papeis }) => ({
        id: guild.id,
        manutencao: Boolean(config?.manutencaoDenuncia),
        // Categorias, prazos e respostas prontas valem por servidor.
        categorias: configVisivel(guild.id).categorias.map(({ nome, grupo, prioridade, termos }) => ({ nome, grupo, prioridade, termos })),
        slaHoras: configVisivel(guild.id).slaHoras,
        respostasProntas: papeis.staff ? configVisivel(guild.id).respostasProntas : [],
        nome: guild.name,
        icone: guild.iconURL({ size: 64 }) || null,
        limiteUploadMb: Math.floor(limiteDeUploadBytes(guild) / 1024 / 1024),
        apelido: member.displayName || null,
        avatar: member.displayAvatarURL?.({ size: 128, extension: 'webp' }) || null,
        papeis
      }))
    });
  }));

  router.get('/denuncias', assincrono(async (req, res) => {
    const admin = req.query.escopo === 'admin';
    let filtro;
    let fila = false;
    let nomesServidores = new Map();
    let pagina = 1;
    let total = 0;
    let totalPaginas = 1;

    if (admin) {
      const servidores = await servidoresDoUsuario(client, req.usuario.id);
      const autorizados = servidores.filter(({ guild, papeis }) =>
        papeis.responsavel && guild.id !== SERVIDOR_OCULTO_VISAO_ADMIN
      );
      if (!autorizados.length) throw new ErroHttp(403, 'A visão administrativa exige o cargo responsável em pelo menos um servidor.');

      // A lista do responsável é a do servidor escolhido no site, não a soma de todos.
      const escolhido = autorizados.find(({ guild }) => guild.id === String(req.query.guildId || ''));
      if (!escolhido) throw new ErroHttp(403, 'Você não tem o cargo responsável neste servidor.');

      nomesServidores = new Map([[escolhido.guild.id, escolhido.guild.name]]);
      filtro = { guildId: escolhido.guild.id };
      const solicitada = Number.parseInt(String(req.query.pagina || '1'), 10);
      pagina = Number.isInteger(solicitada) && solicitada > 0 ? solicitada : 1;
      total = await Denuncia.countDocuments(filtro);
      totalPaginas = Math.max(1, Math.ceil(total / LIMITE_LISTA));
      pagina = Math.min(pagina, totalPaginas);
    } else {
      const acesso = await acessoAoServidor(client, req.usuario.id, String(req.query.guildId || ''));
      if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');

      fila = req.query.escopo === 'fila';
      if (fila && !acesso.papeis.staff) throw new ErroHttp(403, 'A fila de denúncias é restrita à staff.');

      filtro = fila
        ? { guildId: acesso.guild.id, status: 'pendente' }
        : {
          guildId: acesso.guild.id,
          $or: [
            { criadoPor: req.usuario.id },
            { acusadoUserIds: req.usuario.id },
            ...(acesso.papeis.staff ? [{ claimedBy: req.usuario.id }] : [])
          ]
        };
      nomesServidores.set(acesso.guild.id, acesso.guild.name);
    }

    let consulta = Denuncia.find(filtro)
      .sort({ dataCriacao: fila ? 1 : -1 })
      .select('guildId acusado denunciante motivo platform status dataCriacao updatedAt claimedBy claimedAt criadoPor acusadoUserIds');
    if (admin) consulta = consulta.skip((pagina - 1) * LIMITE_LISTA).limit(LIMITE_LISTA);
    else consulta = consulta.limit(fila ? LIMITE_LISTA * 3 : LIMITE_LISTA);
    let denuncias = await consulta.lean();

    // Fila por SLA: infrações de alta prioridade primeiro; dentro de cada grupo, as mais antigas.
    if (fila) {
      const peso = (denuncia) => (prioridadeDoMotivo(denuncia.motivo, denuncia.guildId) === 'alta' ? 0 : 1);
      denuncias = denuncias
        .sort((a, b) => peso(a) - peso(b) || new Date(a.dataCriacao) - new Date(b.dataCriacao))
        .slice(0, LIMITE_LISTA);
    }

    // Data da última mensagem de cada caso, para o site apontar o que tem novidade.
    const ultimas = new Map((await DenunciaMensagem.aggregate([
      { $match: { denunciaId: { $in: denuncias.map(denuncia => denuncia._id) } } },
      { $group: { _id: '$denunciaId', ultima: { $max: '$dataCriacao' } } }
    ])).map(item => [String(item._id), item.ultima]));
    const ultimaAtividade = (denuncia) => new Date(Math.max(
      new Date(denuncia.dataCriacao).getTime(),
      new Date(denuncia.updatedAt || 0).getTime(),
      new Date(ultimas.get(String(denuncia._id)) || 0).getTime()
    ));

    res.json({
      denuncias: denuncias.map(denuncia => ({
        ultimaAtividade: ultimaAtividade(denuncia),
        ...resumoDaDenuncia(denuncia, relacaoComDenuncia(denuncia, req.usuario.id, fila || admin ? { staff: true } : null) || 'staff'),
        guildNome: nomesServidores.get(denuncia.guildId) || 'Servidor'
      })),
      ...(admin ? { pagina, totalPaginas, total } : {})
    });
  }));

  router.get('/denuncias/:id', assincrono(async (req, res) => {
    const { denuncia, acesso, relacao } = await carregarDenuncia(req);
    const admin = req.query.escopo === 'admin';
    if (admin && (!acesso.papeis.responsavel || denuncia.guildId === SERVIDOR_OCULTO_VISAO_ADMIN)) {
      throw new ErroHttp(404, 'Denúncia não encontrada.');
    }

    registrarAcesso(denuncia, req.usuario.id, relacao);

    const fila = ['fila', 'admin'].includes(req.query.escopo)
      || (denuncia.claimedBy === req.usuario.id && acesso.papeis.staff);
    if (fila && !acesso.papeis.staff) throw new ErroHttp(403, 'A fila de denúncias é restrita à staff.');

    const novas = await DenunciaMensagem.find({ denunciaId: denuncia._id }).sort({ dataCriacao: 1 }).lean();
    // Denúncias anteriores à coleção própria guardam as mensagens no documento.
    const legadas = (denuncia.toObject().mensagens || []).filter(antiga => !novas.some(nova => nova.mensagemId === antiga.mensagemId));
    const botId = client.user?.id;

    const mensagens = [...legadas, ...novas]
      .sort((a, b) => new Date(a.dataCriacao) - new Date(b.dataCriacao))
      .filter(mensagem => fila || !mensagem.apagadaEm)
      .map(mensagem => serializarMensagemParaSite(mensagem, String(denuncia._id), botId))
      .map(atribuirAutoriaDoSite)
      .filter(mensagem => !(mensagem.doBot && mensagem.conteudo.startsWith(ATALHO_DO_SITE)))
      // A abertura da denúncia é publicada duas vezes (no canal e dentro do
      // tópico). O site mostra só a do canal, que é a que o bot edita.
      .filter(mensagem => !ehResumoDaDenuncia(mensagem.conteudo) || mensagem.id === denuncia.messageId)
      // O status dela muda no Discord por edição; aqui ele vem do banco.
      .map(mensagem => (mensagem.id === denuncia.messageId && ehResumoDaDenuncia(mensagem.conteudo)
        ? { ...mensagem, conteudo: atualizarTextoDeStatus(mensagem.conteudo, denuncia.status) }
        : mensagem))
      // A mensagem com os botões de controle não tem conteúdo para mostrar.
      .filter(mensagem => mensagem.conteudo || mensagem.anexos.length || mensagem.embeds.length);

    const citados = extrairMencoes([
      denuncia.provas,
      ...mensagens.flatMap(mensagem => [mensagem.conteudo, ...mensagem.embeds.map(embed => `${embed.titulo} ${embed.descricao}`)])
    ].join(' '));
    // Só o painel da staff recebe notas internas, auditoria e histórico do acusado.
    const [notas, acoes, historicoAcusado] = fila
      ? await Promise.all([
        NotaInterna.find({ denunciaId: denuncia._id }).sort({ criadaEm: 1 }).lean(),
        ModerationAction.find({ denunciaId: String(denuncia._id) }).sort({ timestamp: 1 }).select('moderatorId action timestamp').lean(),
        historicoDoAcusado(denuncia)
      ])
      : [[], [], null];

    // Só o responsável vê quem abriu o caso pelo site.
    const acessos = fila && acesso.papeis.responsavel
      ? await AcessoCaso.find({ denunciaId: denuncia._id }).sort({ em: -1 }).limit(15).select('usuarioId relacao em').lean()
      : [];

    const pessoas = await resolverPessoas(client, acesso.guild, [
      ...acessos.map(item => item.usuarioId),
      ...notas.map(nota => nota.autorId),
      ...acoes.map(acao => acao.moderatorId),
      denuncia.claimedBy,
      denuncia.criadoPor,
      ...mensagens.map(mensagem => mensagem.autorId),
      ...citados.usuarios
    ]);
    const nomes = (ids, colecao) => Object.fromEntries([...new Set(ids)]
      .map(id => [id, colecao?.cache.get(id)?.name]).filter(([, nome]) => nome));
    const responsavel = pessoas[denuncia.claimedBy]?.nome || null;

    res.json({
      denuncia: {
        ...resumoDaDenuncia(denuncia, relacao),
        provas: denuncia.provas,
        punicao: denuncia.punicao || null,
        motivoAceite: denuncia.motivoAceite || null,
        dataPunicao: denuncia.dataPunicao || null,
        responsavel,
        linkDiscord: `https://discord.com/channels/${denuncia.guildId}/${denuncia.channelId}/${denuncia.messageId}`,
        aberta: STATUS_ABERTOS.includes(denuncia.status)
      },
      mensagens,
      pessoas,
      ...(fila ? {
        notas: notas.map(nota => ({ id: String(nota._id), autorId: nota.autorId, texto: nota.texto, criadaEm: nota.criadaEm })),
        auditoria: acoes.map(acao => ({ acao: acao.action, autorId: acao.moderatorId, data: acao.timestamp })),
        historicoAcusado,
        ...(acesso.papeis.responsavel ? { acessos: acessos.map(item => ({ usuarioId: item.usuarioId, relacao: item.relacao, em: item.em })) } : {})
      } : {}),
      // A nota só aparece para quem avaliou e para a staff.
      avaliacao: {
        enviada: Boolean(denuncia.feedbackEnviado),
        podeAvaliar: denuncia.criadoPor === req.usuario.id && !denuncia.feedbackEnviado && STATUS_DECIDIDOS.includes(denuncia.status),
        ...(denuncia.feedbackEnviado && (fila || denuncia.criadoPor === req.usuario.id)
          ? { nota: denuncia.feedbackNota, comentario: denuncia.feedbackComentario || '' }
          : {})
      },
      cargos: nomes(citados.cargos, acesso.guild.roles),
      canais: nomes(citados.canais, acesso.guild.channels),
      papeis: acesso.papeis,
      limiteUploadMb: Math.floor(limiteDeUploadBytes(acesso.guild) / 1024 / 1024)
    });
  }));

  // Os links de anexo do Discord expiram; por isso o site nunca guarda o link:
  // busca a mensagem na hora e redireciona para o endereço atual.
  router.get('/denuncias/:id/anexos/:mensagemId/:anexoId', assincrono(async (req, res) => {
    if (!/^\d{15,21}$/.test(req.params.mensagemId) || !/^\d{15,21}$/.test(req.params.anexoId)) {
      throw new ErroHttp(404, 'Este arquivo não está mais disponível no Discord.');
    }
    const { denuncia } = await carregarDenuncia(req);
    const topico = await buscarTopico(denuncia);

    const mensagem = await topico.messages.fetch(req.params.mensagemId).catch(() => null);
    const anexo = mensagem?.attachments?.get(req.params.anexoId);
    if (!anexo) throw new ErroHttp(404, 'Este arquivo não está mais disponível no Discord.');

    res.redirect(302, anexo.url);
  }));

  async function publicarNoTopico(req, { texto, arquivo }) {
    const { denuncia, acesso, relacao } = await carregarDenuncia(req);
    exigirDenunciaAberta(denuncia);
    if (!podeEscrever(req.usuario.id)) throw new ErroHttp(429, 'Muitas mensagens em pouco tempo. Aguarde um minuto.');

    const conteudo = String(texto || '').trim();
    if (!conteudo && !arquivo) throw new ErroHttp(400, 'Escreva uma mensagem ou escolha um arquivo.');
    if (conteudo.length > TAMANHO_MAX_MENSAGEM) throw new ErroHttp(400, `A mensagem pode ter no máximo ${TAMANHO_MAX_MENSAGEM} caracteres.`);

    // Mesmos filtros que o bot aplica nas mensagens do tópico.
    if (relacao !== 'staff') {
      if (contemLinkProibido(conteudo)) throw new ErroHttp(400, 'A mensagem contém um link que não é permitido.');
      if (contemPalavraProibida(conteudo)) throw new ErroHttp(400, 'A mensagem contém palavras que não são permitidas.');
    }

    const topico = await buscarTopico(denuncia);
    if (topico.locked) throw new ErroHttp(409, 'Esta denúncia já foi finalizada e o tópico está trancado.');

    const cabecalho = `Enviado por <@${req.usuario.id}>`;
    let enviada;
    try {
      enviada = await topico.send({
        content: conteudo ? `${cabecalho}\n${conteudo}` : cabecalho,
        files: arquivo ? [new AttachmentBuilder(arquivo.dados, { name: arquivo.nome })] : [],
        allowedMentions: { parse: [] }
      });
    } catch (erro) {
      if (erro?.code === 40005) throw new ErroHttp(413, 'O arquivo é maior do que o servidor do Discord aceita.');
      throw new ErroHttp(502, 'O Discord não aceitou a mensagem. Tente novamente em instantes.');
    }

    // Quem escreveu foi a pessoa, não o bot: registra a autoria real.
    await registrarMensagens(denuncia, enviada).catch(() => {});
    await DenunciaMensagem.updateOne(
      { threadId: denuncia.threadId, mensagemId: enviada.id },
      { $set: { autorId: req.usuario.id, autorNome: acesso.member.displayName || req.usuario.nome, conteudo, viaSite: true } }
    ).catch(() => {});

    return { ok: true, mensagemId: enviada.id };
  }

  router.post('/denuncias/:id/mensagens', express.json({ limit: '32kb' }), assincrono(async (req, res) => {
    res.status(201).json(await publicarNoTopico(req, { texto: req.body?.conteudo }));
  }));

  // O arquivo vai como corpo bruto da requisição; nome e texto vão em cabeçalhos.
  router.post('/denuncias/:id/arquivos', express.raw({ type: () => true, limit: '100mb' }), assincrono(async (req, res) => {
    if (!podeEnviarArquivo(req.usuario.id)) throw new ErroHttp(429, 'Muitos arquivos em pouco tempo. Aguarde alguns minutos.');

    const { acesso } = await carregarDenuncia(req);
    const dados = Buffer.isBuffer(req.body) ? req.body : null;
    if (!dados?.length) throw new ErroHttp(400, 'Nenhum arquivo recebido.');

    const limite = limiteDeUploadBytes(acesso.guild);
    if (dados.length > limite) {
      throw new ErroHttp(413, `O arquivo passa do limite de ${Math.floor(limite / 1024 / 1024)} MB deste servidor. Para vídeos grandes, envie o link do YouTube.`);
    }

    const decodificar = (valor) => {
      try { return decodeURIComponent(String(valor || '')); } catch { return ''; }
    };
    const nome = path.basename(decodificar(req.get('X-Arquivo-Nome')).replace(/[\\/]/g, '_')).slice(0, 100);
    const extensao = nome.includes('.') ? nome.split('.').pop().toLowerCase() : '';
    if (!nome || !EXTENSOES_PERMITIDAS.has(extensao)) {
      throw new ErroHttp(415, `Tipo de arquivo não aceito. Use: ${[...EXTENSOES_PERMITIDAS].join(', ')}.`);
    }

    if (!conteudoCombinaComExtensao(dados, extensao)) {
      throw new ErroHttp(415, `O conteúdo do arquivo não corresponde a um .${extensao} válido.`);
    }

    res.status(201).json(await publicarNoTopico(req, { texto: decodificar(req.get('X-Mensagem')), arquivo: { dados, nome } }));
  }));

  router.post('/denuncias', express.json({ limit: '32kb' }), assincrono(async (req, res) => {
    const { guildId, platform, acusado, motivo, provas } = req.body || {};
    if (!['PC', 'Mobile'].includes(platform)) throw new ErroHttp(400, 'Escolha a plataforma: PC ou Mobile.');

    const acesso = await acessoAoServidor(client, req.usuario.id, String(guildId || ''));
    if (!acesso) throw new ErroHttp(403, 'Você não faz parte deste servidor.');

    const temCargo = platform === 'PC' ? acesso.papeis.podeDenunciarPC : acesso.papeis.podeDenunciarMobile;
    if (!temCargo) throw new ErroHttp(403, `Você não tem o cargo necessário para abrir denúncia ${platform}.`);

    const campos = {
      acusado_input: String(acusado || '').trim(),
      motivo_input: String(motivo || '').trim(),
      provas_input: String(provas || '').trim()
    };
    const limites = LIMITES_FORMULARIO[platform];
    if (!campos.acusado_input || !campos.motivo_input) throw new ErroHttp(400, 'Preencha o acusado e o motivo.');
    if (campos.acusado_input.length > limites.acusado) throw new ErroHttp(400, `O campo Acusado aceita até ${limites.acusado} caracteres.`);
    if (campos.motivo_input.length > LIMITE_MOTIVO) throw new ErroHttp(400, `O motivo aceita até ${LIMITE_MOTIVO} caracteres.`);
    if (campos.provas_input.length > limites.provas) throw new ErroHttp(400, `O campo Provas aceita até ${limites.provas} caracteres.`);

    if (!podeAbrirDenuncia(req.usuario.id)) throw new ErroHttp(429, 'Muitas tentativas em pouco tempo. Aguarde alguns minutos.');

    const canalId = platform === 'PC' ? acesso.config.channels?.pc : acesso.config.channels?.mobile;
    const canal = canalId ? await client.channels.fetch(canalId).catch(() => null) : null;
    if (!canal) throw new ErroHttp(503, `O canal de denúncias ${platform} não está configurado neste servidor.`);

    const antes = new Date();
    const user = await client.users.fetch(req.usuario.id);
    const interacao = criarInteracaoSite({
      client,
      guild: acesso.guild,
      member: acesso.member,
      user,
      // Canal onde ficam os botões de abertura: o aviso fixado aponta para ele.
      channel: { id: acesso.config.channels?.canalDenuncia || canal.id },
      campos,
      tipo: 'modal',
      customId: platform === 'PC' ? 'denuncia_pc_modal' : 'denuncia_mobile_modal'
    });

    // Mesma função que processa o formulário do Discord: validações, tópico,
    // espelhos, alertas e aviso ao acusado acontecem do mesmo jeito.
    await handleDenunciaSubmit(interacao, platform);

    const criada = await Denuncia.findOne({
      guildId: acesso.guild.id,
      criadoPor: req.usuario.id,
      dataCriacao: { $gte: antes }
    }).sort({ dataCriacao: -1 }).select('_id').lean();

    const resultado = resultadoDaInteracao(interacao, 'Denúncia criada.');
    if (!criada) throw new ErroHttp(400, resultado.ok ? 'Não foi possível criar a denúncia.' : resultado.mensagem);

    res.status(201).json({ ok: true, id: String(criada._id), mensagem: 'Denúncia criada. As provas podem ser enviadas aqui ou no tópico.' });
  }));

  // Avaliação do atendimento: mesma regra e mesmo registro do menu do Discord.
  router.post('/denuncias/:id/avaliacao', express.json({ limit: '16kb' }), assincrono(async (req, res) => {
    const { denuncia } = await carregarDenuncia(req);
    if (denuncia.criadoPor !== req.usuario.id) throw new ErroHttp(403, 'Apenas o denunciante pode avaliar o atendimento.');
    if (!STATUS_DECIDIDOS.includes(denuncia.status)) throw new ErroHttp(409, 'A avaliação abre depois que a denúncia recebe uma decisão.');
    if (!podeEscrever(req.usuario.id)) throw new ErroHttp(429, 'Muitas ações em pouco tempo. Aguarde um minuto.');

    const nota = Number(req.body?.nota);
    if (!Number.isInteger(nota) || nota < 1 || nota > 10) throw new ErroHttp(400, 'Escolha uma nota de 1 a 10.');
    const comentario = String(req.body?.comentario || '').trim();
    if (comentario.length > 500) throw new ErroHttp(400, 'O comentário aceita até 500 caracteres.');

    const config = await getConfig(denuncia.guildId).catch(() => null);
    const registrado = await registrarFeedback(client, denuncia, { nota, comentario }, config);
    if (!registrado) throw new ErroHttp(409, 'Você já avaliou esta denúncia.');

    res.status(201).json({ ok: true, mensagem: 'Avaliação enviada. Obrigado!' });
  }));

  // Tempo real: o navegador fica com esta conexão aberta e recarrega o caso
  // quando chega "mudou". "presenca" lista a staff que está com o caso aberto.
  router.get('/denuncias/:id/eventos', assincrono(async (req, res) => {
    const { denuncia, acesso } = await carregarDenuncia(req);
    const abertas = conexoesPorUsuario.get(req.usuario.id) || 0;
    if (abertas >= 6) throw new ErroHttp(429, 'Muitas abas abertas com o site. Feche algumas e tente de novo.');
    conexoesPorUsuario.set(req.usuario.id, abertas + 1);

    const staff = Boolean(acesso.papeis.staff) && req.query.escopo !== 'minhas';
    const topico = denuncia.threadId;
    const conexao = Symbol('conexao');

    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();

    const enviar = (evento, dados = {}) => res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    const enviarPresenca = () => { if (staff) enviar('presenca', { nomes: quemEstaVendo(topico, req.usuario.id) }); };
    const pararDeOuvir = ouvirMudancas(topico, () => enviar('mudou'));
    const pararPresenca = ouvirMudancas(`presenca:${topico}`, enviarPresenca);

    if (staff) {
      if (!presencaPorTopico.has(topico)) presencaPorTopico.set(topico, new Map());
      presencaPorTopico.get(topico).set(conexao, { id: req.usuario.id, nome: acesso.member.displayName || req.usuario.nome });
      avisarMudanca(`presenca:${topico}`);
    }
    enviarPresenca();

    // Comentário periódico: mantém a conexão viva atrás de proxies.
    const pulso = setInterval(() => res.write(': ok\n\n'), 25 * 1000);

    req.on('close', () => {
      const restantes = (conexoesPorUsuario.get(req.usuario.id) || 1) - 1;
      if (restantes > 0) conexoesPorUsuario.set(req.usuario.id, restantes);
      else conexoesPorUsuario.delete(req.usuario.id);
      clearInterval(pulso);
      pararDeOuvir();
      pararPresenca();
      const presentes = presencaPorTopico.get(topico);
      if (presentes?.delete(conexao)) {
        if (!presentes.size) presencaPorTopico.delete(topico);
        avisarMudanca(`presenca:${topico}`);
      }
    });
  }));
}

module.exports = { registrarRotasDeDenuncias, ehResumoDaDenuncia };
