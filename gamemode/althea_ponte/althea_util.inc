/*
 *  althea_util.inc — validações e textos da ponte, em Pawn puro (sem natives
 *  do SA-MP), para poder ser testado fora do servidor (gamemode/teste/).
 */
#if defined _althea_util_included
	#endinput
#endif
#define _althea_util_included

stock Alt_Tam(const s[])
{
	new n = 0;
	while (s[n] != EOS) n++;
	return n;
}

// Igualdade exata (o strcmp do SA-MP devolve 0 quando um dos lados é vazio).
stock bool:Alt_Igual(const a[], const b[])
{
	new i = 0;
	while (a[i] == b[i])
	{
		if (a[i] == EOS) return true;
		i++;
	}
	return false;
}

stock bool:Alt_Prefixo(const s[], const prefixo[])
{
	for (new i = 0; prefixo[i] != EOS; i++)
	{
		if (s[i] != prefixo[i]) return false;
	}
	return true;
}

// Tira espaços, \r e \n das pontas (linhas lidas de arquivo no Windows terminam em \r\n).
stock Alt_Aparar(s[])
{
	new n = Alt_Tam(s), ini = 0, i;
	while (n > 0 && (s[n - 1] == ' ' || s[n - 1] == '\r' || s[n - 1] == '\n' || s[n - 1] == '\t')) n--;
	while (ini < n && (s[ini] == ' ' || s[ini] == '\t')) ini++;
	if (ini > 0)
	{
		for (i = 0; i < n - ini; i++) s[i] = s[i + ini];
		n -= ini;
	}
	s[n] = EOS;
}

// Exatamente "tamanho" letras hexadecimais minúsculas.
stock bool:Alt_HexValido(const s[], tamanho)
{
	for (new i = 0, c; i < tamanho; i++)
	{
		c = s[i];
		if (!(('0' <= c <= '9') || ('a' <= c <= 'f'))) return false;
	}
	return s[tamanho] == EOS;
}

// Nick do SA-MP: 3 a 24 letras de [A-Za-z0-9_[].$@=()].
stock bool:Alt_NickValido(const s[])
{
	new n = 0, c;
	for (; (c = s[n]) != EOS; n++)
	{
		if (n >= 24) return false;
		if (('a' <= c <= 'z') || ('A' <= c <= 'Z') || ('0' <= c <= '9')) continue;
		switch (c)
		{
			case '_', '[', ']', '.', '$', '@', '=', '(', ')': continue;
		}
		return false;
	}
	return n >= 3;
}

// Motivo: 1 a 60 letras ASCII de um conjunto fechado. Sem %, {, }, |, aspas,
// barra invertida, quebra de linha nem "/" no começo — nada que vire cor,
// formatação, outro comando ou injeção em SQL mal escapado.
stock bool:Alt_MotivoValido(const s[])
{
	new n = 0, c;
	if (s[0] == '/' || s[0] == ' ') return false;
	for (; (c = s[n]) != EOS; n++)
	{
		if (n >= 60) return false;
		if (('a' <= c <= 'z') || ('A' <= c <= 'Z') || ('0' <= c <= '9')) continue;
		switch (c)
		{
			case ' ', '.', ',', ':', ';', '!', '?', '(', ')', '[', ']', '-', '_', '+', '#', '*', '@', '&', '/': continue;
		}
		return false;
	}
	return n >= 1;
}

// Quem aprovou no Discord: 1 a 24 letras de [A-Za-z0-9_.-].
stock bool:Alt_NomeStaffValido(const s[])
{
	new n = 0, c;
	for (; (c = s[n]) != EOS; n++)
	{
		if (n >= 24) return false;
		if (('a' <= c <= 'z') || ('A' <= c <= 'Z') || ('0' <= c <= '9') || c == '_' || c == '.' || c == '-') continue;
		return false;
	}
	return n >= 1;
}

// Copia um texto da gamemode (nick, organização) para dentro do JSON de
// resposta: o que não for seguro vira "_" e o tamanho é limitado.
stock Alt_TextoSeguro(saida[], const entrada[], tamanho = sizeof saida)
{
	new i = 0, c;
	for (; i < tamanho - 1 && (c = entrada[i]) != EOS; i++)
	{
		if (('a' <= c <= 'z') || ('A' <= c <= 'Z') || ('0' <= c <= '9')) saida[i] = c;
		else
		{
			switch (c)
			{
				case ' ', '_', '.', '-', '[', ']', '(', ')', '$', '@', '=': saida[i] = c;
				default: saida[i] = '_';
			}
		}
	}
	saida[i] = EOS;
}
