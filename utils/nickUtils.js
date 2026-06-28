// nickUtils.js
const SUPERSCRIPT_MAP = {
    'â°':'0','Â¹':'1','Â²':'2','Â³':'3','â´':'4',
    'âµ':'5','â¶':'6','â·':'7','â¸':'8','â¹':'9'
};

function normalizarNickname(nick) {
    return nick
        .split('')
        .map(c => SUPERSCRIPT_MAP[c] ?? c)
        .join('');
}

function extrairContaDoNickname(nickname) {
    if (!nickname) return null;
    const normalizado = normalizarNickname(nickname);

    const matches = normalizado.match(/\d{3,}/g);
    if (!matches || matches.length !== 1) return null;

    const numero = matches[0];
    const idx = normalizado.lastIndexOf(numero);

    const antes = normalizado.slice(0, idx);
    if (!antes.endsWith(' ')) return null;

    const depois = normalizado.slice(idx + numero.length);
    if (/[a-zA-Z]/i.test(depois)) return null;

    return numero;
}

module.exports = { extrairContaDoNickname, normalizarNickname };