// Carregado antes dos testes (npm test usa --import): dentro dos processos de teste, os logs
// do bot ficam calados. Muitos logs coloridos ao mesmo tempo se misturam com a comunicação do
// executor de testes do Node, que às vezes falha com "Unable to deserialize cloned data" e
// derruba o arquivo inteiro. Para ver os logs: DEBUG_TESTES=1 npm test.
if (process.env.NODE_TEST_CONTEXT && process.env.DEBUG_TESTES !== '1') {
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug']) console[metodo] = () => {};
}
