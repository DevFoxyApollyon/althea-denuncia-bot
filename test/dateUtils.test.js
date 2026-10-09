const test = require('node:test');
const assert = require('node:assert/strict');
const dateUtils = require('../utils/dateUtils');

test('formata data e hora no fuso de Brasília', () => {
  const instante = new Date('2026-01-01T02:30:05Z'); // 23:30:05 do dia 31/12 em Brasília
  assert.equal(dateUtils.formatDateBR(instante), '31/12/2025');
  assert.equal(dateUtils.formatTimeBR(instante), '23:30:05');
});

test('getBrasiliaDate preserva o instante recebido', () => {
  const instante = new Date('2020-05-05T12:00:00Z');
  assert.equal(dateUtils.getBrasiliaDate(instante).getTime(), instante.getTime());
  assert.notEqual(dateUtils.getBrasiliaDate(instante), instante, 'deve devolver uma cópia');
});

test('getBrasiliaDate sem argumento devolve o momento atual', () => {
  const antes = Date.now();
  const agora = dateUtils.getBrasiliaDate().getTime();
  assert.ok(agora >= antes && agora <= Date.now());
});

test('getDiscordTimestamp usa segundos desde a época', () => {
  assert.equal(dateUtils.getDiscordTimestamp(new Date(1_700_000_000_000), 'R'), '<t:1700000000:R>');
});

test('getWeekDates vai de segunda 00:00 a domingo 23:59', () => {
  const { weekStart, weekEnd } = dateUtils.getWeekDates();
  assert.equal(weekStart.getDay(), 1);
  assert.equal(weekStart.getHours(), 0);
  assert.equal(weekEnd.getDay(), 0);
  assert.equal(weekEnd.getHours(), 23);
  assert.ok(weekStart <= new Date() && new Date() <= weekEnd);
});
