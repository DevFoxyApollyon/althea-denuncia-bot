// Todas as listas de palavras bloqueadas do bot ficam aqui. Para liberar ou
// bloquear um termo, edite só este arquivo.
//
// As listas têm usos diferentes e por isso não foram misturadas:
//  - formulário de denúncia: termos recusados nos campos Acusado, Motivo e Provas;
//  - chat: termos que geram strike nas mensagens dos canais.

// ---------- formulário de denúncia (commands/denuncia.js) ----------

const PALAVRAS_BLOQUEADAS = [
    'mtfe7',
    'virada de saldo',
    'equipe mtfe',
    'entra no grupo',
    'vem aprender',
    'trampo do',
    'trampo ',
    'saldo equipe',
    't.me/',
    'telegram.me/',
    'ADM',
    'TOMA NO CU',
    'FILHO DA PUTA',
    'raposa',
    'mcc',
];

const PALAVROES = [
    'fdp', 'filho da puta', 'filha da puta','ADM',
    'TOMA NO CU','raposa',
    'viado', 'viadão', 'viadinho',
    'cuzao', 'cuzão', 'cu','chores',
    'porra', 'puta merda', 'puta que pariu',
    'vai se foder', 'vai tomar no cu', 'vai tomar no',
    'foder', 'fodase', 'foda-se', 'foda se',
    'otario', 'otário', 'otaria', 'otária',
    'idiota', 'imbecil', 'retardado', 'retardada',
    'burro', 'burra', 'animal',
    'lixo humano', 'escoria', 'escória',
    'vagabundo', 'vagabunda',
    'prostituta', 'puta', 'piranha',
    'corno', 'corna',
    'babaca', 'baba ovo', 'babaovo',
    'arrombado', 'arrombada','mcc',
    'merda','preto',
    'inútil',
    'desgraçado', 'desgraçado', 'desgraca',
    'maldito', 'maldita',
    'lázaro', 'lazarento', 'lazarenta',
    'peste',
    'sua mãe', 'tua mãe',
    'cala boca', 'cala a boca',
    'bosta',
    'cagão',
    'covarde',
    'lixo',
];

const CONTEUDO_INVALIDO = [
    'fdp', 'filho da puta', 'filha da puta',
    'adm', 'admin', 'staff', 'suporte', 'moderador', 'mod', 'dono',
    'líder', 'sub líder', 'sublíder','ADM',
    'TOMA NO CU','raposa',
    'princesa', 'lixo',
    'vai tomar no cu', 'fdp','macacada','macaco',
];

// ---------- chat (utils/strikeWords.js) ----------

const PALAVRAS_PROIBIDAS_NO_CHAT = [
  'animal', 'anta', 'arrombada', 'arrombado', 'chorão', 'mds', 'mds',
  'babaca', 'besta', 'bobalhão', 'bobalhona', 'bocó', 'bosta', 'burra', 'burrice', 'burro',
  'canalha', 'caralho', 'corna', 'corno', 'cretina', 'cretino', 'crápula', 'cuzão', 'cuzona',
  'desgraçado', 'doente', 'doida', 'doido', 'PCD', 'deficiente', 'deficiente mental', 'deficiente físico',
  'energúmeno', 'escrota', 'escroto',
  'fdp', 'v conta', 'vendo conta', 'Choro',
  'galinha','mds', 'seu buraquinho','mrd',
  'idiota', 'idiotice', 'imbecil','Chora n','Desgracado','vacilão','vacilão',
  'jegue', 'jumento',
  'lambe botas', 'lixo',
  'maluca', 'maluco', 'mané', 'merda', 'mongoloide', 'mongol', 'mula',
  'noob',
  'otaria', 'otário', 'otária',
  'palhaça', 'palhaço', 'panaca', 'passa pano', 'piranha', 'pnc', 'porra', 'prostituta', 'puta', 'puto', 'puxa saco',
  'retardada', 'retardado',
  'tanso', 'tapada', 'tapado', 'traste', 'trouxa',
  'vadia', 'vagabunda', 'vagabundo', 'viado',
  'zé ninguém', 'zé povinho', 'zé ruela',
  'chorao',
];

const PALAVRAS_INTEIRAS_PROIBIDAS_NO_CHAT = [
  /\bk+\b/i,
];

module.exports = {
  PALAVRAS_BLOQUEADAS,
  PALAVROES,
  CONTEUDO_INVALIDO,
  PALAVRAS_PROIBIDAS_NO_CHAT,
  PALAVRAS_INTEIRAS_PROIBIDAS_NO_CHAT
};
