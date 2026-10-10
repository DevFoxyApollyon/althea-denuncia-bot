// Categorias, prioridade (SLA) e respostas prontas do site.
//
// Os valores abaixo são o padrão. O responsável pode trocá-los pelo site
// (Admin > Configurações); o que ele salvar fica no banco, por servidor, e
// passa a valer no lugar do padrão.
//
// A categoria de uma denúncia é reconhecida pelo texto do motivo: vale a
// primeira categoria que tiver um termo presente. Um termo casa no começo de
// uma palavra ("slid" casa com "slide" e "slidou"), sem diferenciar acento
// nem maiúsculas. Termos de até 2 letras (siglas como "pg" ou "db") só casam
// com a palavra inteira, para não pegar palavras comuns. "prioridade: 'alta'" marca as infrações graves: elas sobem
// para o topo da fila e têm prazo de atendimento menor.

const PADRAO = {
  // A ordem importa: vale a primeira categoria que casar, então as mais
  // específicas vêm antes das genéricas. "grupo" só organiza a lista no site.
  categorias: [
    // Infrações graves
    { nome: 'Zaralho', grupo: 'Graves', prioridade: 'alta', termos: ['zaralh'] },
    { nome: 'Slide', grupo: 'Graves', prioridade: 'alta', termos: ['slid'] },
    { nome: 'Hack', grupo: 'Graves', prioridade: 'alta', termos: ['hack', 'cheat', 'aimbot', 'wallhack', 'speed hack'] },
    { nome: 'Mods proibidos', grupo: 'Graves', prioridade: 'alta', termos: ['mod proibid', 'mods proibid', 'mod menu', 'modmenu', 'cleo'] },

    // Roleplay
    { nome: 'Dark RP', grupo: 'Roleplay', prioridade: 'normal', termos: ['dark rp', 'darkrp', 'dark-rp'] },
    { nome: 'Anti-RP', grupo: 'Roleplay', prioridade: 'normal', termos: ['anti rp', 'antirp', 'anti-rp', 'non rp', 'nonrp', 'non-rp', 'nrp', 'fail rp', 'failrp'] },
    { nome: 'Metagaming', grupo: 'Roleplay', prioridade: 'normal', termos: ['metagam', 'meta gam', 'meta-gam', 'mg'] },
    { nome: 'Power gaming', grupo: 'Roleplay', prioridade: 'normal', termos: ['powergam', 'power gam', 'power-gam', 'pg'] },
    { nome: 'Amor à vida', grupo: 'Roleplay', prioridade: 'normal', termos: ['amor a vida', 'saav', 'fear rp', 'fearrp'] },
    { nome: 'Fuga de RP', grupo: 'Roleplay', prioridade: 'normal', termos: ['fuga de rp', 'fugir do rp', 'fugiu do rp', 'fugir de rp', 'fugiu de rp', 'evadir rp'] },
    { nome: 'Combat log', grupo: 'Roleplay', prioridade: 'normal', termos: ['combat log', 'combatlog', 'combat-log', 'deslog', 'relog', 'cl'] },
    { nome: 'Quebra de imersão', grupo: 'Roleplay', prioridade: 'normal', termos: ['quebra de imersao', 'quebrar imersao', 'ooc', 'fora do personagem'] },
    { nome: 'Voltar ao local da morte', grupo: 'Roleplay', prioridade: 'normal', termos: ['nlr', 'new life', 'voltou ao local', 'voltar ao local', 'voltou no local'] },
    { nome: 'Cop bait', grupo: 'Roleplay', prioridade: 'normal', termos: ['cop bait', 'copbait', 'cop-bait', 'provocar policia', 'provocando policia'] },
    { nome: 'Algemar em ação', grupo: 'Roleplay', prioridade: 'normal', termos: ['algem'] },
    { nome: 'Roubo ou sequestro fora das regras', grupo: 'Roleplay', prioridade: 'normal', termos: ['roubo', 'roubar', 'roubou', 'assalt', 'sequestr', 'refem'] },
    { nome: 'Abuso de profissão', grupo: 'Roleplay', prioridade: 'normal', termos: ['abuso de profissao', 'abuso de cargo', 'corrup'] },

    // Combate
    { nome: 'RDM', grupo: 'Combate', prioridade: 'normal', termos: ['rdm', 'dm', 'random death', 'matou sem motivo'] },
    { nome: 'VDM', grupo: 'Combate', prioridade: 'normal', termos: ['vdm', 'atropel'] },
    { nome: 'Revenge kill', grupo: 'Combate', prioridade: 'normal', termos: ['revenge', 'rk'] },
    { nome: 'Drive-by', grupo: 'Combate', prioridade: 'normal', termos: ['drive by', 'driveby', 'drive-by', 'db'] },
    { nome: 'Spawn kill', grupo: 'Combate', prioridade: 'normal', termos: ['spawn kill', 'spawnkill', 'spawn-kill', 'sk'] },
    { nome: 'Team kill', grupo: 'Combate', prioridade: 'normal', termos: ['team kill', 'teamkill', 'team-kill', 'tk'] },
    { nome: 'Heli kill', grupo: 'Combate', prioridade: 'normal', termos: ['heli kill', 'helikill', 'heli-kill', 'hk'] },
    { nome: 'Car jack', grupo: 'Combate', prioridade: 'normal', termos: ['car jack', 'carjack', 'ninja jack', 'ninjajack', 'cj', 'nj'] },
    { nome: 'Bunny hop', grupo: 'Combate', prioridade: 'normal', termos: ['bunny', 'bh'] },
    { nome: 'Safe zone', grupo: 'Combate', prioridade: 'normal', termos: ['safe zone', 'safezone', 'safe-zone', 'area segura', 'area safe', 'safe'] },
    { nome: 'Abuso de bug', grupo: 'Combate', prioridade: 'normal', termos: ['bug', 'cbug', 'glitch', 'exploit'] },

    // Conduta
    { nome: 'Racismo ou preconceito', grupo: 'Conduta', prioridade: 'normal', termos: ['racis', 'preconceit', 'homofob', 'xenofob', 'discrimin'] },
    { nome: 'Assédio', grupo: 'Conduta', prioridade: 'normal', termos: ['assedi'] },
    { nome: 'Ameaça', grupo: 'Conduta', prioridade: 'normal', termos: ['ameac'] },
    { nome: 'Ofensa', grupo: 'Conduta', prioridade: 'normal', termos: ['ofens', 'xing', 'toxic', 'insult', 'desrespeit'] },
    { nome: 'Flood', grupo: 'Conduta', prioridade: 'normal', termos: ['flood', 'flod', 'spam'] },
    { nome: 'Divulgação', grupo: 'Conduta', prioridade: 'normal', termos: ['divulg', 'propaganda'] },
    { nome: 'Golpe', grupo: 'Conduta', prioridade: 'normal', termos: ['golpe', 'scam', 'estelionat'] },
    { nome: 'Comércio com dinheiro real', grupo: 'Conduta', prioridade: 'normal', termos: ['dinheiro real', 'rmt', 'venda de conta', 'vender conta', 'vendendo conta'] },
    { nome: 'Conta falsa', grupo: 'Conduta', prioridade: 'normal', termos: ['conta fake', 'conta falsa', 'multi conta', 'multiconta', 'fake'] },
    { nome: 'Atrapalhar staff ou evento', grupo: 'Conduta', prioridade: 'normal', termos: ['atrapalh'] },
    { nome: 'Conduta de staff', grupo: 'Conduta', prioridade: 'normal', termos: ['abuso de poder', 'conduta de staff', 'abuso de staff'] }
  ],
  // Prazo, em horas, para a staff reivindicar a denúncia depois de aberta.
  slaHoras: { alta: 2, normal: 24 },
  respostasProntas: [
    { titulo: 'Pedir mais provas', texto: 'Para seguir com a análise, precisamos de mais provas. Envie o vídeo completo do ocorrido, sem cortes, mostrando o momento da infração.' },
    { titulo: 'Pedir contraprova', texto: 'O acusado tem 24 horas para enviar a contraprova neste tópico. Sem ela, a análise segue com as provas já apresentadas.' },
    { titulo: 'Vídeo sem som ou ilegível', texto: 'O vídeo enviado está sem som ou com qualidade que impede a análise. Envie novamente, de preferência pelo YouTube como não listado.' },
    { titulo: 'Em análise', texto: 'Recebemos as provas e o caso está em análise. Avisaremos por aqui assim que houver uma decisão.' },
    { titulo: 'Faltam informações', texto: 'Faltam informações para identificar o ocorrido. Informe o horário aproximado, o local e o que aconteceu antes do trecho gravado.' }
  ]
};

const OUTROS = 'Outros';

// Configuração salva de cada servidor, mantida em memória (ver site/configSite.js).
const porServidor = new Map();

// Minúsculas e sem acento, para "Amor à vida" casar com "amor a vida".
function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

const escaparRegex = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Prepara as categorias para a busca: um regex por categoria, com todos os termos.
function compilar(config) {
  return {
    ...config,
    categorias: config.categorias.map(categoria => {
      const termos = categoria.termos.map(termo => normalizar(termo).trim()).filter(Boolean)
        .map(termo => escaparRegex(termo) + (termo.length <= 2 ? '(?![a-z0-9])' : ''));
      return {
        ...categoria,
        regex: termos.length ? new RegExp(`(?:^|[^a-z0-9])(?:${termos.join('|')})`) : null
      };
    })
  };
}

const padraoCompilado = compilar(PADRAO);

function definirConfigDoServidor(guildId, config) {
  if (config) porServidor.set(guildId, compilar(config));
  else porServidor.delete(guildId);
}

const configDoServidor = (guildId) => porServidor.get(guildId) || padraoCompilado;

function acharCategoria(motivo, guildId) {
  const texto = normalizar(motivo);
  return configDoServidor(guildId).categorias.find(categoria => categoria.regex?.test(texto)) || null;
}

const categoriaDoMotivo = (motivo, guildId) => acharCategoria(motivo, guildId)?.nome || OUTROS;
const prioridadeDoMotivo = (motivo, guildId) => acharCategoria(motivo, guildId)?.prioridade || 'normal';
const slaHorasDoServidor = (guildId) => configDoServidor(guildId).slaHoras;

function prazoDoSla(motivo, dataCriacao, guildId) {
  const horas = slaHorasDoServidor(guildId)[prioridadeDoMotivo(motivo, guildId)];
  return new Date(new Date(dataCriacao).getTime() + horas * 60 * 60 * 1000);
}

const nomesDasCategorias = (guildId) => configDoServidor(guildId).categorias.map(categoria => categoria.nome);

// O que o site mostra e edita: sem o regex interno.
function configVisivel(guildId) {
  const config = configDoServidor(guildId);
  return {
    personalizada: porServidor.has(guildId),
    categorias: config.categorias.map(({ nome, grupo, prioridade, termos }) => ({ nome, grupo: grupo || '', prioridade, termos })),
    slaHoras: { ...config.slaHoras },
    respostasProntas: config.respostasProntas.map(({ titulo, texto }) => ({ titulo, texto }))
  };
}

module.exports = {
  PADRAO,
  OUTROS,
  SLA_HORAS: PADRAO.slaHoras,
  categoriaDoMotivo,
  prioridadeDoMotivo,
  prazoDoSla,
  nomesDasCategorias,
  slaHorasDoServidor,
  configVisivel,
  definirConfigDoServidor
};
