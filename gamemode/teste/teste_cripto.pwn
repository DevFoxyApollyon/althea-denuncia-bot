/*
 *  teste_cripto.pwn — confere o SHA-256 e o HMAC-SHA256 do althea_sha256.inc
 *  com os vetores oficiais (FIPS 180-2 / RFC 4231) e com tamanhos que cruzam
 *  a borda do bloco (55, 56, 63, 64, 65 bytes).
 *
 *  Pode rodar como filterscript no servidor de teste: imprime "OK" ou "FALHOU"
 *  em cada linha e o total no fim. Não usa nenhum native do SA-MP.
 */
#include <core>
#include <console>
#include "../althea_ponte/althea_sha256"

static g_ok, g_falhas;

static Conferir(const nome[], const obtido[], const esperado[])
{
	if (Alt_IgualSeguro(obtido, esperado, 64))
	{
		g_ok++;
		printf("OK      %s", nome);
	}
	else
	{
		g_falhas++;
		printf("FALHOU  %s", nome);
		printf("        obtido:   %s", obtido);
		printf("        esperado: %s", esperado);
	}
}

static Repetir(saida[], letra, n)
{
	for (new i = 0; i < n; i++) saida[i] = letra;
	saida[n] = EOS;
}

main()
{
	static texto[1100], chave[140], hex[65];

	Alt_Sha256Hex("", hex);
	Conferir("sha256 vazio", hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	Alt_Sha256Hex("abc", hex);
	Conferir("sha256 abc", hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	Alt_Sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", hex);
	Conferir("sha256 448 bits", hex, "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");

	Repetir(texto, 'a', 55);   Alt_Sha256Hex(texto, hex); Conferir("sha256 a*55", hex, "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
	Repetir(texto, 'a', 56);   Alt_Sha256Hex(texto, hex); Conferir("sha256 a*56", hex, "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
	Repetir(texto, 'a', 63);   Alt_Sha256Hex(texto, hex); Conferir("sha256 a*63", hex, "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34");
	Repetir(texto, 'a', 64);   Alt_Sha256Hex(texto, hex); Conferir("sha256 a*64", hex, "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
	Repetir(texto, 'a', 65);   Alt_Sha256Hex(texto, hex); Conferir("sha256 a*65", hex, "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0");
	Repetir(texto, 'a', 119);  Alt_Sha256Hex(texto, hex); Conferir("sha256 a*119", hex, "31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb");
	Repetir(texto, 'a', 1000); Alt_Sha256Hex(texto, hex); Conferir("sha256 a*1000", hex, "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");

	Repetir(chave, 0x0b, 20);
	Alt_HmacSha256(chave, "Hi There", hex);
	Conferir("hmac RFC 4231 caso 1", hex, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
	Alt_HmacSha256("Jefe", "what do ya want for nothing?", hex);
	Conferir("hmac RFC 4231 caso 2", hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
	Repetir(chave, 0xaa, 131);
	Alt_HmacSha256(chave, "Test Using Larger Than Block-Size Key - Hash Key First", hex);
	Conferir("hmac RFC 4231 caso 6 (chave > bloco)", hex, "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");
	// Chave de 64 letras, como o segredo da ponte (exatamente um bloco).
	Alt_HmacSha256("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "pedido\nabc", hex);
	Conferir("hmac chave de 64 letras", hex, "63b39a38e4ff75767464dcb9516e3b25d96af31a5b6085f056cd82a631e4bccd");

	printf("---- %d OK, %d FALHOU", g_ok, g_falhas);
	return g_falhas;
}
