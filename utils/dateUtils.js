// Todo o bot trabalha no horário de Brasília. Fixar o fuso aqui garante que os
// getters locais de Date (getHours, getDate...) batam com Brasília mesmo quando
// um script é executado sem passar pelo index.js.
const TIMEZONE = 'America/Sao_Paulo';
process.env.TZ = TIMEZONE;

function toDate(dateInput) {
    if (!dateInput) return new Date();
    const date = (dateInput instanceof Date) ? new Date(dateInput.getTime()) : new Date(dateInput);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

// Retorna o instante real (UTC correto no banco); sem argumento, o momento atual.
function getBrasiliaDate(dateInput) {
    return toDate(dateInput);
}

function toBrasiliaDate(dateInput) {
    return toDate(dateInput);
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE, day: '2-digit', month: '2-digit', year: 'numeric'
});

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function formatDateBR(dateInput) {
    return dateFormatter.format(toDate(dateInput));
}

function formatTimeBR(dateInput) {
    return timeFormatter.format(toDate(dateInput));
}

function getBrasiliaTime() {
    return formatTimeBR();
}

function getBrasiliaDateTime() {
    const d = new Date();
    return `${formatDateBR(d)} ${formatTimeBR(d)}`;
}

function getDiscordTimestamp(dateInput, format = 'f') {
    const d = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    return `<t:${Math.floor(d.getTime() / 1000)}:${format}>`;
}

function getWeekDates() {
    const now = getBrasiliaDate();
    const day = now.getDay();
    const diffToMonday = (day === 0) ? -6 : 1 - day;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() + diffToMonday);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return { weekStart, weekEnd };
}

module.exports = {
    TIMEZONE,
    getBrasiliaDate,
    toBrasiliaDate,
    formatDateBR,
    formatTimeBR,
    getBrasiliaTime,
    getBrasiliaDateTime,
    getDiscordTimestamp,
    getWeekDates
};
