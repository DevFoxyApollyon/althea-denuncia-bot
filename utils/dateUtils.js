function getBrasiliaDate() {
    const now = new Date();
    const BRASILIA_OFFSET = -3; 
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    return new Date(utcTime + (3600000 * BRASILIA_OFFSET));
}

function toBrasiliaDate(dateInput) {
    if (!dateInput) return getBrasiliaDate();
    const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utcTime + (3600000 * -3));
}

function formatDateBR(dateInput = getBrasiliaDate()) {
    const d = toBrasiliaDate(dateInput);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatTimeBR(dateInput = getBrasiliaDate()) {
    const d = toBrasiliaDate(dateInput);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function getBrasiliaTime() {
    return formatTimeBR(getBrasiliaDate());
}

function getBrasiliaDateTime() {
    const d = getBrasiliaDate();
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
    getBrasiliaDate,
    toBrasiliaDate,
    formatDateBR,
    formatTimeBR,
    getBrasiliaTime,
    getBrasiliaDateTime,
    getDiscordTimestamp,
    getWeekDates
};