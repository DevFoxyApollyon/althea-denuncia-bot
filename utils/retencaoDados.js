// Por quanto tempo cada coleção do banco guarda seus registros.
//
// Há três tipos de coleção:
//  - permanente: nunca é apagada sozinha (configurações e cadastros);
//  - com prazo: cada registro recebe uma data de validade ao ser criado e o
//    banco o apaga quando ela chega (campo "dataRetencaoAte");
//  - com regra própria: o prazo é contado de outro jeito, definido no próprio
//    modelo, e este arquivo não mexe nela.

const MESES_RETENCAO = 6;
const CAMPO_RETENCAO = 'dataRetencaoAte';
const INDICE_RETENCAO = `${CAMPO_RETENCAO}_1`;
const PREFIXO_GRIDFS = 'chatArquivos.';
const DIA_MS = 24 * 60 * 60 * 1000;

// Nunca são apagadas sozinhas.
const COLECOES_PERMANENTES = [
  'configs',          // configuração do bot em cada servidor (canais, cargos)
  'globalconfigs',    // usuários isentos
  'configsites',      // categorias, prazos e respostas prontas do site
  'chatsalas',        // modo lento, chat fechado e música do chat
  'chatfixadas',      // aviso fixado do chat
  'chatbanimentos',   // banidos do chat
  'chavepushes',      // chave das notificações do navegador
  'inscricaopushes',  // aparelhos com notificação ativada
  'staffprofiles',    // nota de atendimento acumulada de cada staff
  'testestaffs',      // teste da staff montado pelo responsável
  'metastaffs',       // meta de atendimentos da staff
  'usuarios',         // vínculo entre a conta do Discord e o ID do jogo
  'ponteservidores',  // guilds com a ponte do jogo ativada
  'pontecodigos',     // códigos de ativação da ponte
  'ponteinstalacoes', // PCs autorizados na ponte (hash do token)
  'pontemotivos',     // tabela de motivos da ponte (a mesma para todos os servidores)
  'ponteconexoesgm'   // credenciais da ponte com a gamemode (segredo cifrado)
];

// Prazo em dias, contado da criação do registro. O que não está aqui (nem nas
// outras listas) dura seis meses.
const PRAZOS_EM_DIAS = {
  denunciamensagems: 45,   // mensagens das denúncias (mesmo tempo da denúncia)
  moderationactions: 30,   // ações da staff (rank e auditoria)
  acessocasos: 15,         // quem abriu cada caso pelo site
  loginsites: 30,          // entradas no site (quem, quando e de qual IP)
  rascunhodenuncias: 15,   // denúncia começada e não enviada
  pontepunicoes: 45,       // fila de punições do jogo (mesmo tempo da denúncia)
  ponteusos: 90,           // auditoria da ponte do jogo
  pontepedidosgm: 90       // pedidos enviados à gamemode (um por alvo)
};

// O prazo fica no próprio modelo:
//  - strikes: 24 horas depois da última atualização (campo "updatedAt");
//  - denuncias: 45 dias depois de abertas (campo "dataExpiracao").
const COLECOES_COM_REGRA_PROPRIA = ['strikes', 'denuncias'];

function adicionarMeses(data, meses = MESES_RETENCAO) {
  const resultado = new Date(data);
  const diaOriginal = resultado.getDate();
  resultado.setMonth(resultado.getMonth() + meses);
  if (resultado.getDate() !== diaOriginal) resultado.setDate(0);
  return resultado;
}

// Data de validade de um registro criado em "agora" na coleção indicada.
function validadePara(colecao, agora = new Date()) {
  const dias = PRAZOS_EM_DIAS[colecao];
  return dias ? new Date(new Date(agora).getTime() + dias * DIA_MS) : adicionarMeses(agora);
}

function aplicarRetencaoAoSchema(schema, colecao) {
  if (!schema.path(CAMPO_RETENCAO)) {
    schema.add({
      [CAMPO_RETENCAO]: {
        type: Date,
        default: () => validadePara(colecao)
      }
    });
  }
  const jaConfigurado = schema.indexes().some(([campos, opcoes]) =>
    campos[CAMPO_RETENCAO] === 1 && opcoes.expireAfterSeconds === 0);
  if (!jaConfigurado) schema.index({ [CAMPO_RETENCAO]: 1 }, { expireAfterSeconds: 0 });
}

// Tira o prazo de uma coleção permanente: remove o índice de apagamento e a
// data de validade dos registros que já a tinham recebido.
async function liberarColecaoPermanente(colecao) {
  const indices = await colecao.indexes().catch(() => []);
  if (indices.some(indice => indice.name === INDICE_RETENCAO)) await colecao.dropIndex(INDICE_RETENCAO);
  await colecao.updateMany({ [CAMPO_RETENCAO]: { $exists: true } }, { $unset: { [CAMPO_RETENCAO]: '' } });
}

// Garante que nenhuma coleção permanente de um banco esteja com apagamento ligado.
async function liberarPermanentesDoBanco(db) {
  const existentes = (await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name);
  for (const nome of COLECOES_PERMANENTES.filter(item => existentes.includes(item))) {
    await liberarColecaoPermanente(db.collection(nome));
  }
}

// Deixa as coleções de um banco de acordo com as regras acima. Roda quando o
// bot liga. Registros que ainda não têm validade passam a contar a partir de agora.
async function prepararRetencaoNoBanco(db, agora = new Date(), { reiniciarPrazo = false } = {}) {
  const colecoes = await db.listCollections({}, { nameOnly: true }).toArray();

  for (const { name, type } of colecoes) {
    if (name.startsWith('system.') || type === 'view') continue;
    if (COLECOES_COM_REGRA_PROPRIA.includes(name)) continue;

    const colecao = db.collection(name);
    if (COLECOES_PERMANENTES.includes(name)) {
      await liberarColecaoPermanente(colecao);
      continue;
    }
    const gridFs = name.startsWith(PREFIXO_GRIDFS);
    if (gridFs && name.endsWith('.chunks')) continue;

    // Sai qualquer apagamento antigo que não seja o da validade.
    const indices = await colecao.indexes();
    for (const indice of indices) {
      if (indice.expireAfterSeconds !== undefined && indice.name !== INDICE_RETENCAO) {
        await colecao.dropIndex(indice.name);
      }
    }

    const validade = validadePara(name, agora);
    await colecao.updateMany(
      reiniciarPrazo ? {} : { [CAMPO_RETENCAO]: { $exists: false } },
      { $set: { [CAMPO_RETENCAO]: validade } }
    );
    // Quando o prazo de uma coleção diminui, quem tinha validade mais longa é trazido para o prazo novo.
    if (PRAZOS_EM_DIAS[name]) {
      await colecao.updateMany({ [CAMPO_RETENCAO]: { $gt: validade } }, { $set: { [CAMPO_RETENCAO]: validade } });
    }

    if (!gridFs) {
      await colecao.createIndex({ [CAMPO_RETENCAO]: 1 }, { expireAfterSeconds: 0 });
    }
  }
}

module.exports = {
  COLECOES_PERMANENTES,
  COLECOES_COM_REGRA_PROPRIA,
  PRAZOS_EM_DIAS,
  CAMPO_RETENCAO,
  INDICE_RETENCAO,
  adicionarMeses,
  validadePara,
  aplicarRetencaoAoSchema,
  liberarPermanentesDoBanco,
  prepararRetencaoNoBanco
};
