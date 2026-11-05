// Checagem de permissões para o Painel do bot (site): em cada canal configurado,
// o que o bot precisa e o que está faltando. Também confere se o cargo de
// responsável vê os tópicos privados dos canais de denúncia ("Gerenciar tópicos").
const { PermissionFlagsBits: P } = require('discord.js');

// Nome de cada permissão como aparece no Discord em português.
const NOMES = new Map([
  [P.ViewChannel, 'Ver canal'],
  [P.SendMessages, 'Enviar mensagens'],
  [P.EmbedLinks, 'Inserir links'],
  [P.AttachFiles, 'Anexar arquivos'],
  [P.ReadMessageHistory, 'Ver histórico de mensagens'],
  [P.ManageMessages, 'Gerenciar mensagens'],
  [P.CreatePublicThreads, 'Criar tópicos públicos'],
  [P.CreatePrivateThreads, 'Criar tópicos privados'],
  [P.SendMessagesInThreads, 'Enviar mensagens em tópicos'],
  [P.ManageThreads, 'Gerenciar tópicos'],
  [P.ManageRoles, 'Gerenciar permissões']
]);

const BASE = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
const TOPICOS = [P.CreatePublicThreads, P.SendMessagesInThreads, P.ManageThreads];

// O que o bot precisa em cada canal e por quê (aparece no site).
const NECESSARIAS = {
  pc: { perms: [...BASE, P.AttachFiles, P.ManageMessages, ...TOPICOS, P.CreatePrivateThreads, P.ManageRoles], para: 'Abrir os tópicos (públicos e privados), apagar mensagens proibidas e liberar os tópicos privados para o responsável.' },
  mobile: { perms: [...BASE, P.AttachFiles, P.ManageMessages, ...TOPICOS, P.CreatePrivateThreads, P.ManageRoles], para: 'Abrir os tópicos (públicos e privados), apagar mensagens proibidas e liberar os tópicos privados para o responsável.' },
  logs: { perms: BASE, para: 'Publicar cada denúncia que entra.' },
  log: { perms: BASE, para: 'Registrar as ações da staff.' },
  analysis: { perms: BASE, para: 'Listar as denúncias em análise.' },
  topDaily: { perms: BASE, para: 'Enviar o ranking diário.' },
  relatorioPunicoes: { perms: BASE, para: 'Publicar as punições para o jogo.' },
  provasStaff: { perms: [...BASE, P.AttachFiles, P.ManageMessages, P.CreatePublicThreads, P.SendMessagesInThreads], para: 'Painel do /provastaff, registros e tópicos com as provas.' },
  backup: { perms: [...BASE, P.AttachFiles], para: 'Enviar o arquivo da denúncia finalizada.' },
  armazem: { perms: [...BASE, P.AttachFiles, ...TOPICOS], para: 'Criar a cópia (tópico espelho) de cada denúncia.' },
  registro: { perms: [...BASE, P.AttachFiles, ...TOPICOS], para: 'Criar a cópia (tópico espelho) de cada denúncia.' },
  cloud: { perms: [...BASE, P.AttachFiles], para: 'Enviar o arquivo da denúncia finalizada.' },
  canalDenuncia: { perms: [...BASE, P.ManageMessages], para: 'Manter a mensagem do /denuncia com os botões.' }
};

// Cada canal configurado: { chave, canalId, nome, situacao: 'ok'|'falta'|'sumiu', faltando: [nomes], para }.
// "client" acha canais de outros servidores (Registro, Cloud, Canal fixo).
function verificarPermissoes(client, guild, config) {
  const canais = [];
  for (const [chave, { perms, para }] of Object.entries(NECESSARIAS)) {
    const canalId = config?.channels?.[chave];
    if (!canalId) continue;
    const canal = guild.channels.cache.get(canalId) || client?.channels?.cache?.get(canalId);
    const eu = canal?.guild?.members?.me;
    if (!canal || !eu) {
      canais.push({ chave, canalId, nome: null, situacao: 'sumiu', faltando: [], para });
      continue;
    }
    const tem = canal.permissionsFor(eu);
    const faltando = tem?.has(P.Administrator) ? [] : perms.filter(flag => !tem?.has(flag)).map(flag => NOMES.get(flag));
    canais.push({
      chave, canalId, para,
      nome: canal.guild.id === guild.id ? `#${canal.name}` : `#${canal.name} em ${canal.guild.name}`,
      situacao: faltando.length ? 'falta' : 'ok',
      faltando
    });
  }

  // O responsável abre os tópicos privados sem entrar neles só com "Gerenciar tópicos".
  const cargoId = config?.roles?.responsavel_admin;
  const cargo = cargoId ? guild.roles.cache.get(cargoId) : null;
  const responsavel = cargo
    ? ['pc', 'mobile'].map(chave => guild.channels.cache.get(config?.channels?.[chave])).filter(Boolean).map(canal => {
      const tem = canal.permissionsFor(cargo);
      const ok = Boolean(tem?.has(P.Administrator) || (tem?.has(P.ViewChannel) && tem?.has(P.ManageThreads)));
      return { canalId: canal.id, nome: `#${canal.name}`, situacao: ok ? 'ok' : 'falta' };
    })
    : [];

  return { canais, responsavel: { cargo: cargo ? cargo.name : null, canais: responsavel } };
}

module.exports = { verificarPermissoes, NECESSARIAS };
