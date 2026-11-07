// Notificações do navegador: avisam de mensagens e decisões mesmo com o site
// fechado. Cada aparelho é ativado separadamente, pelo painel do sino.
import { desenhar } from './desenho.js';
import { estado } from './estado.js';
import { api, avisar, el, enviarJson, icone } from './util.js';

const suportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// A chave pública vem em base64 "de URL"; o navegador pede em bytes.
function chaveEmBytes(chave) {
  const base64 = (chave + '='.repeat((4 - chave.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), letra => letra.charCodeAt(0));
}

async function inscricaoAtual() {
  const registro = await navigator.serviceWorker.getRegistration();
  return registro ? registro.pushManager.getSubscription() : null;
}

// Descobre em que pé está este aparelho: ativo, inativo, bloqueado ou indisponível.
export async function iniciarPush() {
  if (!suportado()) {
    estado.push = 'indisponivel';
    return;
  }
  try {
    await navigator.serviceWorker.register('/sw.js');
    const inscricao = await inscricaoAtual();
    estado.push = Notification.permission === 'denied' ? 'bloqueado' : inscricao ? 'ativo' : 'inativo';
    // Reenvia a inscrição: se o servidor a perdeu, ela volta a valer.
    if (inscricao) enviarJson('/api/push/inscricao', inscricao.toJSON()).catch(() => {});
  } catch {
    estado.push = 'indisponivel';
  }
  desenhar();
}

export async function ativarPush(botao) {
  botao.disabled = true;
  try {
    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') {
      estado.push = permissao === 'denied' ? 'bloqueado' : 'inativo';
      return desenhar();
    }

    const { chave } = await api('/api/push/chave');
    if (!chave) throw new Error('As notificações não estão disponíveis neste endereço.');

    const registro = await navigator.serviceWorker.ready;
    const opcoes = { userVisibleOnly: true, applicationServerKey: chaveEmBytes(chave) };
    let inscricao;
    try {
      inscricao = await registro.pushManager.subscribe(opcoes);
    } catch {
      // Inscrição antiga, feita com outra chave: descarta e cria de novo.
      await (await registro.pushManager.getSubscription())?.unsubscribe();
      inscricao = await registro.pushManager.subscribe(opcoes);
    }

    await enviarJson('/api/push/inscricao', inscricao.toJSON());
    estado.push = 'ativo';
    avisar('ok', 'Notificações ativadas neste aparelho.');
  } catch (erro) {
    // "push service error": o navegador não conseguiu falar com o serviço de
    // notificações dele. Acontece no Brave (vem desligado), no Opera GX e em
    // navegadores embutidos em outros programas.
    const semServico = /push service/i.test(erro.message);
    avisar('erro', semServico
      ? 'Este navegador não conseguiu registrar as notificações. No Brave, ligue "Usar os serviços do Google para mensagens push" em Configurações > Privacidade e segurança e tente de novo. Se não der, use Chrome, Edge ou Firefox.'
      : `Não foi possível ativar as notificações. ${erro.message}`);
  }
  desenhar();
}

// Também é chamado ao sair, para o aparelho não continuar recebendo avisos da conta.
export async function desativarPush() {
  if (!suportado()) return;
  const inscricao = await inscricaoAtual().catch(() => null);
  if (!inscricao) return;
  await api('/api/push/inscricao', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: inscricao.endpoint })
  }).catch(() => {});
  await inscricao.unsubscribe().catch(() => {});
  estado.push = 'inativo';
}

export function blocoDoPush() {
  if (!estado.push) return null;

  const conteudo = {
    ativo: [
      el('span', null, icone('visto'), 'Avisos ativados neste aparelho.'),
      el('button', { class: 'ver-tudo', type: 'button', onclick: () => desativarPush().then(desenhar) }, 'Desativar')
    ],
    inativo: [
      el('span', null, 'Receba um aviso mesmo com o site fechado.'),
      el('button', { class: 'primario', type: 'button', id: 'ativar-push', onclick: (evento) => ativarPush(evento.currentTarget) }, icone('sino'), 'Ativar avisos')
    ],
    bloqueado: [el('span', null, 'As notificações estão bloqueadas nas permissões do navegador para este site.')],
    indisponivel: [el('span', null, 'Este navegador não aceita notificações. No iPhone, adicione o site à tela de início e abra por lá.')]
  }[estado.push];

  return el('footer', { class: `push-bloco ${estado.push}` }, conteudo);
}
