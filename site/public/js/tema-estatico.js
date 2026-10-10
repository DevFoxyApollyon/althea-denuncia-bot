// Aplica nas páginas de texto (privacidade e cookies) o tema que a pessoa
// escolheu no portal.
try {
  const tema = localStorage.getItem('althea-tema');
  if (tema === 'claro' || tema === 'escuro') document.documentElement.dataset.tema = tema;
} catch { /* sem acesso ao armazenamento: fica o tema padrão */ }
