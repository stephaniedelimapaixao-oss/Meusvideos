# Meusvídeos

Editor de vídeo local com análise do Gemini e quatro modelos de animação renderizados pelo HyperFrames. O vídeo completo, incluindo o áudio, é enviado à API do Google para obter sugestões de trechos, título e roteiro. O arquivo temporário local e o arquivo remoto de análise são removidos após o processamento. É possível ajustar entrada e saída e exportar o trecho selecionado em MP4.

## Requisitos

- Node.js 22 ou superior
- Uma chave gratuita do Google AI Studio

## Configuração

1. Instale as dependências com `npm install`. Isso inclui HyperFrames, GSAP, FFmpeg, FFprobe e Chromium portáteis para render local.
2. Copie `.env.example` para `.env` e preencha `GEMINI_API_KEY` com uma chave criada no Google AI Studio.
3. Inicie com `npm start` e abra `http://localhost:3000`.

`GEMINI_MODEL` pode ser definido no `.env`; o padrão é `gemini-2.5-flash`. A chave é usada apenas pelo servidor e não é enviada ao navegador. O modelo tem cota gratuita sujeita aos limites vigentes do Google AI Studio. O arquivo `.env` está listado no `.gitignore`.

## Limites desta versão

- O vídeo inteiro é enviado ao Google Gemini para análise visual e de áudio; não envie material sensível.
- A exportação gera um único trecho contínuo em MP4 e mantém o áudio original quando disponível.
- As animações são compostas e renderizadas localmente pelo HyperFrames em MP4, sem conta ou renderização paga.

## Inserir notícia

Com um vídeo carregado, pause no ponto desejado e selecione **Inserir notícia**. O Playwright captura a área visível (1280 × 720) de um link HTTP(S) público. A imagem entra por 4,5 segundos com animação e também é incluída na exportação MP4 do trecho selecionado. Links para localhost, redes privadas, portas personalizadas e protocolos que não sejam HTTP(S) são bloqueados.

## Modelos de animação

- Título animado
- Faixa de identificação
- Legenda palavra por palavra
- Abertura

Edite os campos do modelo na área **Animação** e selecione **Renderizar modelo**. A primeira renderização inicia o Chromium e o FFmpeg incluídos nas dependências locais.