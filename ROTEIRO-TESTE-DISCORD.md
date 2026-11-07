# Roteiro de teste no Discord

Rodar depois de subir um zip novo. Use duas contas: **A** (denunciante, sem cargo de staff) e **B** (acusado, com ID cadastrado no banco). Uma terceira conta **S** com cargo de administrador ou responsável faz a parte da staff.

## 1. Denúncia com tópico privado

- [ ] A abre `/denuncia` acusando o ID de B. A resposta mostra o link do site primeiro e o tópico por último.
- [ ] O tópico criado é privado (cadeado). A e B estão nele; ninguém mais entra sem ser adicionado.
- [ ] A mensagem do canal tem `➱ **Tópico**: #...` antes do Status e uma linha em branco no fim.
- [ ] O botão cinza "🔒 Entrar no tópico" aparece. Clicado por A: recusa. Clicado por S: entra e recebe o botão "Abrir tópico".
- [ ] Com "Staff entra nos tópicos privados" ligado no Painel do bot, S já está no tópico sem clicar.
- [ ] A segunda denúncia de A em menos de 1 minuto é bloqueada (se a espera estiver ligada).

## 2. Acusado que não vê o canal

- [ ] Denúncia contra alguém sem acesso ao canal: o tópico continua privado, o console mostra `Acusado <id> não entrou no tópico privado`.
- [ ] Essa pessoa vê o caso no site (Minhas denúncias) e consegue responder por lá.

## 3. Staff

- [ ] S reivindica. Outra reivindicação dentro do tempo configurado é bloqueada.
- [ ] S usa Add Player com um ID cadastrado: a pessoa entra no tópico privado.
- [ ] S aceita: a mensagem do aceite menciona cada acusado cadastrado (`1268670 @fulano + 2471`).
- [ ] Aceite com um ID que não está no banco: abre o tópico público "Denúncia: X (decisão)" na mensagem do canal.
- [ ] Mensagem escrita no tópico público aparece copiada no privado (com anexo).
- [ ] Mudar o status de um tópico arquivado não gera `Thread is archived` no console.

## 4. Site

- [ ] O caso mostra a linha do tempo, os avatares e o perfil do Discord ao clicar num nome.
- [ ] O sininho mostra a novidade quando o status muda.
- [ ] Admin › Saúde do bot: "Backup do banco" mostra a data da última cópia (sai 1 minuto depois de ligar).

## 5. Fechamento

- [ ] Ao finalizar (ou depois de 7 dias), o tópico privado e o público da decisão fecham juntos.

## Backup

`npm run backup` lista as cópias. `npm run backup -- <nome>` mostra o que a cópia tem, sem gravar. Com `--confirmar` no fim, devolve ao banco principal só os registros que sumiram; nada existente é alterado ou apagado.
