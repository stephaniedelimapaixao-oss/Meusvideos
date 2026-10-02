# Meusvídeos

Editor de vídeo local com análise do Gemini e quatro modelos de animação renderizados pelo HyperFrames. O vídeo completo, incluindo o áudio, é enviado à API do Google para obter sugestões de trechos, título e roteiro. O arquivo temporário local e o arquivo remoto de análise são removidos após o processamento. É possível ajustar entrada e saída e exportar o trecho selecionado em MP4.

## Requisitos

- Node.js 22 ou superior
- Uma chave do Google AI Studio
- Uma senha definida para proteger o aplicativo

## Configuração

1. Instale as dependências com `npm install`. Isso inclui HyperFrames, GSAP, FFmpeg, FFprobe e Chromium portáteis para render local.
2. Copie `.env.example` para `.env` e preencha `GEMINI_API_KEY` com sua chave do Google AI Studio e `APP_PASSWORD` com uma senha longa.
3. Inicie com `npm start` e abra `http://localhost:3000`.

O navegador solicitará usuário e senha via autenticação HTTP Basic; o nome de usuário pode ser qualquer um, e a senha é `APP_PASSWORD`. O servidor não inicia sem essa variável. `GEMINI_MODEL` pode ser definido no `.env`; o padrão é `gemini-2.5-flash`. A chave do Gemini é usada apenas pelo servidor e não é enviada ao navegador. O uso da API está sujeito aos limites vigentes do Google AI Studio.

Uploads de vídeo são limitados a 200 MB por arquivo e o servidor aceita até 60 requisições por minuto por IP. O limite de requisições pode ser ajustado com `RATE_LIMIT_PER_MINUTE`.

## Publicar no Google Cloud Run

O projeto já inclui um `Dockerfile` com Node.js, FFmpeg e Chromium, então pode ser publicado como contêiner no Cloud Run sem reconstruir os motions do HyperFrames. Configure `GEMINI_API_KEY` e `APP_PASSWORD` como secrets do serviço; não coloque esses valores no repositório. O Cloud Run fornece uma URL HTTPS estável e injeta a variável `PORT` automaticamente. A página continua protegida pela senha `APP_PASSWORD`.

O Cloud Run exige uma conta Google Cloud com faturamento habilitado; o custo depende do uso e da região. O Gemini continua sujeito à própria cota e cobrança, independentemente da hospedagem. Há também limites a considerar antes de usar com vídeos grandes: o endpoint atual aceita até 200 MB, mas requisições HTTP do Cloud Run têm limite de 32 MiB. Para manter uploads maiores, será necessário enviar o vídeo diretamente a um bucket do Cloud Storage e adaptar o servidor para processá-lo. Arquivos temporários e capturas de notícias ficam no disco efêmero da instância, não em armazenamento permanente.

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