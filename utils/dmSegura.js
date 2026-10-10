// Cuidado com as mensagens diretas (DMs) do bot.
//
// Quando um bot abre DMs demais, o Discord passa a recusar com o erro 340002
// ("Access to sending DMs has been limited"). Insistir piora o bloqueio, então
// depois desse erro o bot para de mandar DMs por uma hora.
//
// Se continuar, o Discord coloca o bot em quarentena (erro 20026) e nenhuma DM
// nova é aceita até a apelação em https://dis.gd/app-quarantine. Nesse caso o
// bot fica 6 horas sem tentar.

const LIMITE_DE_DMS = 340002;
const QUARENTENA = 20026;
// Erros esperados ao mandar DM, que não são falha do bot: DM fechada pelo
// usuário (50007), sem servidor em comum (50278) e o limite acima.
const CODIGOS_ESPERADOS = [50007, 50278, LIMITE_DE_DMS, QUARENTENA];
const PAUSA_MS = { [LIMITE_DE_DMS]: 60 * 60 * 1000, [QUARENTENA]: 6 * 60 * 60 * 1000 };

let pausadoAte = 0;

const dmPausada = (agora = Date.now()) => agora < pausadoAte;

// Avisos por DM que não são essenciais (mensagem nova no tópico, denúncia
// reivindicada, punição ao acusado). Ficam desligados por padrão, porque
// multiplicam o número de DMs; ligue com DM_AVISOS_EXTRAS=1 no .env. Quem usa o
// site recebe esses avisos por lá.
const avisosExtrasLigados = () => ['1', 'true', 'sim'].includes(String(process.env.DM_AVISOS_EXTRAS || '').trim().toLowerCase());

// Chamar em todo erro de DM. Devolve true quando o erro foi um bloqueio do Discord.
function registrarErroDeDM(erro, agora = Date.now()) {
  const pausa = PAUSA_MS[erro?.code];
  if (!pausa) return false;
  pausadoAte = Math.max(pausadoAte, agora + pausa);
  return true;
}

// Texto para mostrar à staff quando uma DM não pôde ser enviada.
function motivoDaFalha(erro) {
  if (erro?.code === 50007) return 'O usuário bloqueou o bot ou desativou as DMs.';
  if (erro?.code === 50278) return 'O usuário não está mais em um servidor em comum com o bot.';
  if (erro?.code === LIMITE_DE_DMS) return 'O Discord limitou temporariamente as DMs enviadas pelo bot.';
  if (erro?.code === QUARENTENA) return 'O bot está em quarentena no Discord e não pode abrir DMs até a apelação ser aceita.';
  return `Erro do Discord (${erro?.code ?? erro?.message ?? 'desconhecido'}).`;
}

module.exports = { LIMITE_DE_DMS, QUARENTENA, avisosExtrasLigados, CODIGOS_ESPERADOS, dmPausada, registrarErroDeDM, motivoDaFalha };
