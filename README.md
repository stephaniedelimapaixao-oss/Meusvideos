---
title: Meus Vídeos
sdk: docker
app_port: 7860
---

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

## Publicar no Hugging Face Spaces

1. Crie um Space e escolha o SDK **Docker**. Envie os arquivos deste projeto para o repositório do Space.
2. Em **Settings → Variables and secrets**, crie estes dois itens como **Secrets**:
	- `GEMINI_API_KEY`: chave criada no Google AI Studio.
	- `APP_PASSWORD`: senha longa para acessar o editor.
3. Aguarde o Space construir a imagem. O `Dockerfile` instala Node.js, FFmpeg e o Chromium do Playwright e usa a porta `7860`, padrão do Spaces; não é necessário configurar `PORT` manualmente.
4. Abra a URL do Space. O navegador pedirá autenticação; use qualquer nome de usuário e informe o valor de `APP_PASSWORD` como senha.

Não coloque os valores dos Secrets no repositório, em arquivos rastreados ou no histórico Git. O `.gitignore` exclui arquivos `.env` e arquivos comuns de chaves; `.env.example` contém apenas valores de exemplo e permanece versionado. Os Spaces gratuitos podem suspender o aplicativo após um período sem uso; disponibilidade contínua pode exigir um plano/hardware que não suspenda o Space.

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