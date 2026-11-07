export function bloquearOrientacaoPaisagem() {
  const orientacao = globalThis.screen?.orientation;
  if (typeof orientacao?.lock !== 'function') return;
  orientacao.lock('landscape').catch(() => {});
}

export function liberarOrientacao() {
  globalThis.screen?.orientation?.unlock?.();
}
