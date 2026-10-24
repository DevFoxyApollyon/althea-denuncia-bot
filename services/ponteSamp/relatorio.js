// Relatório da ponte com o jogo: quem aceitou, quem aplicou (por PC) e quanto demorou.
// Função pura sobre os documentos de PontePunicao, para poder ser testada sem banco.

const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_LINHAS = 15;

// punicoes: documentos com aceitoPor, aceitoEm, aplicadaEm, status, resultado[]. "dias" conta para trás de agora.
function montarRelatorio(punicoes, dias, agora = Date.now()) {
  const desde = agora - dias * DIA_MS;
  const aceitantes = new Map();
  const pcs = new Map();
  let aceitas = 0;
  let aplicados = 0;
  let falhas = 0;
  let naFila = 0;
  let somaEspera = 0;
  let comEspera = 0;

  for (const p of punicoes || []) {
    const aceitoEm = new Date(p.aceitoEm || p.criadoEm || 0).getTime();
    if (aceitoEm >= desde) {
      aceitas += 1;
      const nome = String(p.aceitoPor?.nome || 'Não registrado');
      aceitantes.set(nome, (aceitantes.get(nome) || 0) + 1);
    }
    if (p.status === 'aceita' || p.status === 'executando') naFila += 1;

    const aplicadaEm = p.aplicadaEm ? new Date(p.aplicadaEm).getTime() : 0;
    if (aplicadaEm >= desde && aplicadaEm && aceitoEm) {
      somaEspera += Math.max(0, aplicadaEm - aceitoEm);
      comEspera += 1;
    }

    for (const r of p.resultado || []) {
      const quando = new Date(r.em || p.aplicadaEm || 0).getTime();
      if (!quando || quando < desde) continue;
      const pc = String(r.pc || p.aplicadaPor?.nomePc || 'PC desconhecido');
      const linha = pcs.get(pc) || { pc, aplicados: 0, falhas: 0 };
      if (r.ok && !r.erro) { linha.aplicados += 1; aplicados += 1; }
      else if (!r.ok) { linha.falhas += 1; falhas += 1; }
      pcs.set(pc, linha);
    }
  }

  const ordenar = (lista, chave) => lista.sort((a, b) => b[chave] - a[chave]).slice(0, MAX_LINHAS);
  return {
    dias,
    total: {
      aceitas,
      aplicados,
      falhas,
      naFila,
      esperaMediaMin: comEspera ? Math.round(somaEspera / comEspera / 60000) : null
    },
    porAceitante: ordenar([...aceitantes].map(([nome, total]) => ({ nome, total })), 'total'),
    porPc: ordenar([...pcs.values()], 'aplicados')
  };
}

module.exports = { montarRelatorio, DIA_MS };
