# Meusvídeos

Editor de vídeo local com análise do Gemini. O vídeo completo, incluindo o áudio, é enviado à API do Google para obter sugestões de trechos, título e roteiro. O arquivo temporário local e o arquivo remoto de análise são removidos após o processamento. É possível ajustar entrada e saída e exportar o trecho selecionado em WebM.

## Requisitos

- Node.js 20 ou superior
- Uma chave gratuita do Google AI Studio
- Navegador Chromium atualizado para exportar trechos

## Configuração

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env` e preencha `GEMINI_API_KEY` com uma chave criada no Google AI Studio.
3. Inicie com `npm start` e abra `http://localhost:3000`.

`GEMINI_MODEL` pode ser definido no `.env`; o padrão é `gemini-2.5-flash`. A chave é usada apenas pelo servidor e não é enviada ao navegador. O modelo tem cota gratuita sujeita aos limites vigentes do Google AI Studio. O arquivo `.env` está listado no `.gitignore`.

## Limites desta versão

- O vídeo inteiro é enviado ao Google Gemini para análise visual e de áudio; não envie material sensível.
- A exportação gera um único trecho contínuo, com áudio quando o navegador disponibiliza a faixa na captura. O arquivo de saída é WebM.
- A exportação acontece em tempo real no navegador; deixe a aba aberta até o download começar.