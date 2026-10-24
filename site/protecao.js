// Proteção do site contra enxurrada de acessos (ataque DDoS na camada do site).
//
// O que dá para fazer aqui dentro: recusar cedo e barato quem pede demais, para
// o bot e o banco não pararem. Um ataque que entope a rede antes de chegar no
// site só é segurado pela hospedagem (a SquareCloud fica atrás da Cloudflare).
//
// Como funciona, por endereço IP:
//   1. limite de pedidos por minuto: passou, recebe 429 até a janela virar;
//   2. insistiu muito além do limite: fica bloqueado por alguns minutos;
//   3. limite de pedidos ao mesmo tempo (conexões abertas);
//   4. com o site sobrecarregado, quem não está logado é recusado primeiro.
const net = require('node:net');

const PADRAO = {
  janelaMs: 60 * 1000,
  // Abrir o site carrega uns 40 arquivos; 600 por minuto sobra para uso normal,
  // inclusive várias pessoas na mesma rede.
  maximoPorJanela: 600,
  // Acima disto na mesma janela não é uso normal: bloqueio temporário.
  maximoAntesDoBloqueio: 1500,
  bloqueioMs: 10 * 60 * 1000,
  // Conta também as conexões de tempo real (cada aba aberta mantém duas ou três).
  simultaneosPorIp: 120,
  // Pedidos em andamento no site inteiro a partir dos quais ele se considera sobrecarregado.
  simultaneosNoSite: 400,
  maximoDeIps: 20000,
  tamanhoMaximoDoEndereco: 2048
};

const METODOS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

// Faixas de IP da Cloudflare (https://www.cloudflare.com/ips/).
const FAIXAS_CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];

function montarFaixas(lista) {
  const faixas = new net.BlockList();
  for (const item of lista) {
    const [endereco, prefixo] = String(item).trim().split('/');
    const tipo = net.isIP(endereco) === 6 ? 'ipv6' : net.isIP(endereco) === 4 ? 'ipv4' : null;
    if (!tipo) continue;
    faixas.addSubnet(endereco, Number(prefixo ?? (tipo === 'ipv4' ? 32 : 128)), tipo);
  }
  return faixas;
}

const faixasCloudflare = montarFaixas(FAIXAS_CLOUDFLARE);
let extrasLidos = null;
let faixasExtras = null;

// "::ffff:1.2.3.4" é o mesmo IP que "1.2.3.4".
const semPrefixoV6 = (ip) => String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');

// Quem pode informar o IP do visitante no cabeçalho: a Cloudflare e, se houver,
// os endereços de SITE_PROXIES_CONFIAVEIS (IPs ou faixas separados por vírgula).
function proxyConfiavel(ip) {
  const extras = String(process.env.SITE_PROXIES_CONFIAVEIS || '');
  if (extras !== extrasLidos) {
    extrasLidos = extras;
    faixasExtras = montarFaixas(extras.split(',').filter(Boolean));
  }
  const tipo = net.isIP(ip) === 6 ? 'ipv6' : net.isIP(ip) === 4 ? 'ipv4' : null;
  return Boolean(tipo) && (faixasCloudflare.check(ip, tipo) || faixasExtras.check(ip, tipo));
}

// O cf-connecting-ip só vale quando o pedido chegou de fato pela Cloudflare: quem
// acessa direto poderia mandar qualquer IP nele e fugir do limite e do bloqueio.
// Fora disso vale o IP da conexão (req.ip, já com o "trust proxy" da hospedagem).
function ipDoCliente(req) {
  const conexao = semPrefixoV6(req.ip || req.socket?.remoteAddress || '');
  const repassado = String(req.headers['cf-connecting-ip'] || '').trim();
  if (proxyConfiavel(conexao) && net.isIP(repassado)) return semPrefixoV6(repassado);
  return conexao || 'desconhecido';
}

function criarProtecao(opcoes = {}, { agora = () => Date.now(), log = null } = {}) {
  const config = { ...PADRAO, ...opcoes };
  const porIp = new Map();
  let emAndamento = 0;
  const numeros = { recusados: 0, bloqueios: 0 };

  const registro = (ip, instante) => {
    let item = porIp.get(ip);
    if (!item) {
      // Memória limitada: num ataque com muitos IPs, saem os mais antigos que não estão bloqueados.
      if (porIp.size >= config.maximoDeIps) {
        for (const [chave, valor] of porIp) {
          if (valor.bloqueadoAte <= instante && valor.abertos === 0) porIp.delete(chave);
          if (porIp.size < config.maximoDeIps * 0.8) break;
        }
      }
      item = { inicio: instante, pedidos: 0, abertos: 0, bloqueadoAte: 0 };
      porIp.set(ip, item);
    }
    if (instante - item.inicio >= config.janelaMs) {
      item.inicio = instante;
      item.pedidos = 0;
    }
    return item;
  };

  // Decide o que fazer com um pedido. Separado do Express para poder ser testado.
  function avaliar(ip, { logado = false } = {}) {
    const instante = agora();
    const item = registro(ip, instante);

    if (item.bloqueadoAte > instante) return { permitido: false, status: 429, esperarMs: item.bloqueadoAte - instante, motivo: 'bloqueado' };

    item.pedidos += 1;
    if (item.pedidos > config.maximoAntesDoBloqueio) {
      item.bloqueadoAte = instante + config.bloqueioMs;
      numeros.bloqueios += 1;
      log?.warn?.(`[Proteção] IP ${ip} bloqueado por ${Math.round(config.bloqueioMs / 60000)} min: ${item.pedidos} pedidos em menos de um minuto.`);
      return { permitido: false, status: 429, esperarMs: config.bloqueioMs, motivo: 'bloqueado' };
    }
    if (item.pedidos > config.maximoPorJanela) {
      return { permitido: false, status: 429, esperarMs: item.inicio + config.janelaMs - instante, motivo: 'limite' };
    }
    if (item.abertos >= config.simultaneosPorIp) return { permitido: false, status: 429, esperarMs: 5000, motivo: 'simultaneos' };
    if (!logado && emAndamento >= config.simultaneosNoSite) return { permitido: false, status: 503, esperarMs: 10000, motivo: 'sobrecarga' };

    return { permitido: true, item };
  }

  function middleware(req, res, next) {
    if (!METODOS.includes(req.method) || (req.originalUrl || req.url || '').length > config.tamanhoMaximoDoEndereco) {
      numeros.recusados += 1;
      return res.status(400).end();
    }

    const resultado = avaliar(ipDoCliente(req), { logado: Boolean(req.usuario) });
    if (!resultado.permitido) {
      numeros.recusados += 1;
      // Resposta curta e sem corpo grande: recusar tem que custar quase nada.
      res.set({ 'Retry-After': String(Math.max(1, Math.ceil(resultado.esperarMs / 1000))), 'Cache-Control': 'no-store', Connection: 'close' });
      return res.status(resultado.status).json({ erro: resultado.status === 503
        ? 'O site está sobrecarregado. Tente de novo em instantes.'
        : 'Muitos acessos em pouco tempo. Aguarde um pouco e tente de novo.' });
    }

    const { item } = resultado;
    // As conexões de tempo real ficam abertas o tempo todo: contam por IP, mas
    // não entram na medida de sobrecarga do site.
    const tempoReal = String(req.headers.accept || '').includes('text/event-stream');
    item.abertos += 1;
    if (!tempoReal) emAndamento += 1;
    let liberado = false;
    const liberar = () => {
      if (liberado) return;
      liberado = true;
      item.abertos = Math.max(0, item.abertos - 1);
      if (!tempoReal) emAndamento = Math.max(0, emAndamento - 1);
    };
    res.once('finish', liberar);
    res.once('close', liberar);
    next();
  }

  // De tempos em tempos: esquece quem parou de acessar e resume no log o que foi barrado.
  const limpeza = setInterval(() => {
    const instante = agora();
    for (const [ip, item] of porIp) {
      if (item.abertos === 0 && item.bloqueadoAte <= instante && instante - item.inicio >= config.janelaMs * 2) porIp.delete(ip);
    }
    if (numeros.recusados) {
      log?.warn?.(`[Proteção] ${numeros.recusados} pedido(s) recusado(s) e ${numeros.bloqueios} IP(s) bloqueado(s) nos últimos 5 minutos.`);
      numeros.recusados = 0;
      numeros.bloqueios = 0;
    }
  }, 5 * 60 * 1000);
  limpeza.unref?.();

  return { middleware, avaliar, estado: () => ({ ips: porIp.size, emAndamento }) };
}

// Conexões lentas de propósito (slowloris) seguram o servidor sem mandar nada:
// quem não termina de enviar os cabeçalhos ou o pedido a tempo é desconectado.
function ajustarServidor(servidor) {
  servidor.headersTimeout = 15 * 1000;
  // Envio de provas grandes pode demorar; 5 minutos cobre com folga.
  servidor.requestTimeout = 5 * 60 * 1000;
  servidor.maxHeadersCount = 100;
  return servidor;
}

module.exports = { criarProtecao, ajustarServidor, ipDoCliente, PADRAO };
