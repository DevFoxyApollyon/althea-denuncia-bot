/*
 *  althea_sha256.inc — SHA-256 e HMAC-SHA256 em Pawn puro (sem plugin).
 *
 *  Por que não usar SHA256_PassHash: o open.mp escreve "Using unsafe hashing
 *  function SHA256_PassHash" no log a cada chamada, e ela não faz HMAC. Esta
 *  versão funciona igual no SA-MP 0.3.7 e no open.mp, sem aviso e sem plugin.
 *
 *  Strings: uma letra por célula (string comum, não compactada). Só o byte
 *  baixo de cada célula entra no hash (a ponte só usa ASCII).
 *
 *  Conferido com os vetores do FIPS 180-2 e da RFC 4231 (gamemode/teste/teste_cripto.pwn).
 */
#if defined _althea_sha256_included
	#endinput
#endif
#define _althea_sha256_included

// Contexto: [0..7] estado, [8..23] bloco atual (16 palavras), [24] bytes no bloco, [25] total de bytes.
#define ALT_SHA_CTX (26)

static const ALT_SHA_K[64] = {
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

static const ALT_HEX[] = "0123456789abcdef";

// Processa o bloco de 64 bytes guardado no contexto (rotações escritas à mão: mais rápido que chamar função).
static stock Alt_ShaBloco(ctx[])
{
	static w[64];
	new a, b, c, d, e, f, g, h, t1, t2, x, y, i;

	for (i = 0; i < 16; i++) w[i] = ctx[8 + i];
	for (i = 16; i < 64; i++)
	{
		x = w[i - 15];
		y = w[i - 2];
		w[i] = w[i - 16] + w[i - 7]
			+ (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3))
			+ (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10));
	}

	a = ctx[0]; b = ctx[1]; c = ctx[2]; d = ctx[3];
	e = ctx[4]; f = ctx[5]; g = ctx[6]; h = ctx[7];

	for (i = 0; i < 64; i++)
	{
		t1 = h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)))
			+ ((e & f) ^ (~e & g)) + ALT_SHA_K[i] + w[i];
		t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)))
			+ ((a & b) ^ (a & c) ^ (b & c));
		h = g; g = f; f = e; e = d + t1;
		d = c; c = b; b = a; a = t1 + t2;
	}

	ctx[0] += a; ctx[1] += b; ctx[2] += c; ctx[3] += d;
	ctx[4] += e; ctx[5] += f; ctx[6] += g; ctx[7] += h;

	for (i = 8; i < 24; i++) ctx[i] = 0;
	ctx[24] = 0;
}

stock Alt_Sha256_Inicio(ctx[])
{
	ctx[0] = 0x6a09e667; ctx[1] = 0xbb67ae85; ctx[2] = 0x3c6ef372; ctx[3] = 0xa54ff53a;
	ctx[4] = 0x510e527f; ctx[5] = 0x9b05688c; ctx[6] = 0x1f83d9ab; ctx[7] = 0x5be0cd19;
	for (new i = 8; i < ALT_SHA_CTX; i++) ctx[i] = 0;
}

stock Alt_Sha256_Byte(ctx[], byte)
{
	new n = ctx[24];
	ctx[8 + (n >> 2)] |= (byte & 0xFF) << (24 - ((n & 3) << 3));
	ctx[25]++;
	if (++ctx[24] == 64) Alt_ShaBloco(ctx);
}

stock Alt_Sha256_Texto(ctx[], const texto[])
{
	for (new i = 0; texto[i] != EOS; i++) Alt_Sha256_Byte(ctx, texto[i]);
}

// Fecha o hash e devolve as 8 palavras (big-endian) em digest[].
stock Alt_Sha256_Fim(ctx[], digest[8])
{
	new bits = ctx[25] << 3, i;
	Alt_Sha256_Byte(ctx, 0x80);
	while (ctx[24] != 56) Alt_Sha256_Byte(ctx, 0);
	// Tamanho em bits (64 bits): a parte alta é zero para mensagens de até 512 MB.
	for (i = 0; i < 4; i++) Alt_Sha256_Byte(ctx, 0);
	Alt_Sha256_Byte(ctx, bits >>> 24);
	Alt_Sha256_Byte(ctx, bits >>> 16);
	Alt_Sha256_Byte(ctx, bits >>> 8);
	Alt_Sha256_Byte(ctx, bits);
	for (i = 0; i < 8; i++) digest[i] = ctx[i];
}

stock Alt_DigestHex(const digest[8], saida[], tamanho = sizeof saida)
{
	if (tamanho < 65) { saida[0] = EOS; return 0; }
	for (new i = 0, p = 0, v; i < 8; i++)
	{
		v = digest[i];
		for (new s = 28; s >= 0; s -= 4) saida[p++] = ALT_HEX[(v >>> s) & 0xF];
	}
	saida[64] = EOS;
	return 1;
}

// sha256(texto) em 64 letras hexadecimais minúsculas.
stock Alt_Sha256Hex(const texto[], saida[], tamanho = sizeof saida)
{
	static ctx[ALT_SHA_CTX], digest[8];
	Alt_Sha256_Inicio(ctx);
	Alt_Sha256_Texto(ctx, texto);
	Alt_Sha256_Fim(ctx, digest);
	return Alt_DigestHex(digest, saida, tamanho);
}

// HMAC-SHA256(chave, mensagem) em 64 letras hexadecimais minúsculas (RFC 2104).
stock Alt_HmacSha256(const chave[], const mensagem[], saida[], tamanho = sizeof saida)
{
	static ctx[ALT_SHA_CTX], k[64], digest[8];
	new i, n;

	while (chave[n] != EOS) n++;
	if (n > 64)
	{
		// Chave maior que o bloco: vira sha256(chave).
		Alt_Sha256_Inicio(ctx);
		Alt_Sha256_Texto(ctx, chave);
		Alt_Sha256_Fim(ctx, digest);
		for (i = 0; i < 32; i++) k[i] = (digest[i >> 2] >>> (24 - ((i & 3) << 3))) & 0xFF;
		for (; i < 64; i++) k[i] = 0;
	}
	else
	{
		for (i = 0; i < n; i++) k[i] = chave[i] & 0xFF;
		for (; i < 64; i++) k[i] = 0;
	}

	Alt_Sha256_Inicio(ctx);
	for (i = 0; i < 64; i++) Alt_Sha256_Byte(ctx, k[i] ^ 0x36);
	Alt_Sha256_Texto(ctx, mensagem);
	Alt_Sha256_Fim(ctx, digest);

	Alt_Sha256_Inicio(ctx);
	for (i = 0; i < 64; i++) Alt_Sha256_Byte(ctx, k[i] ^ 0x5c);
	for (i = 0; i < 32; i++) Alt_Sha256_Byte(ctx, digest[i >> 2] >>> (24 - ((i & 3) << 3)));
	Alt_Sha256_Fim(ctx, digest);

	// A chave expandida não fica na memória depois do uso.
	for (i = 0; i < 64; i++) k[i] = 0;
	return Alt_DigestHex(digest, saida, tamanho);
}

// Compara dois textos de "tamanho" letras sem sair no primeiro erro (não vaza tempo).
stock bool:Alt_IgualSeguro(const a[], const b[], tamanho)
{
	new diferenca = 0;
	for (new i = 0; i < tamanho; i++)
	{
		if (a[i] == EOS || b[i] == EOS) return false;
		diferenca |= a[i] ^ b[i];
	}
	return diferenca == 0 && a[tamanho] == EOS && b[tamanho] == EOS;
}
