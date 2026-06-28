const SUPERSCRIPT_MAP = {
    '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4',
    '⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9'
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