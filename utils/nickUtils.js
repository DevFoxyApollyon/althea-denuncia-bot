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

    const matches = [...normalizado.matchAll(/(?:^|(?<=\S)\s+)(\d+)(?![\p{L}\p{N}])/gu)];
    if (!matches.length) return null;

    const numero = matches[matches.length - 1][1];
    const idx = normalizado.lastIndexOf(numero);
    const antes = normalizado.slice(0, idx).trim();

    if (!antes) return null;

    return numero;
}
 
module.exports = { extrairContaDoNickname, normalizarNickname };