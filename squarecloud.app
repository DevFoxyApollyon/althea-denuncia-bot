DISPLAY_NAME=Althea
DESCRIPTION=bot de denuncia
MEMORY=5000
VERSION=recommended
AUTORESTART=true
MAIN=index.js
START=node --expose-gc --max-old-space-size=2048 index.js