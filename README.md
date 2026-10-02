# Meusvídeos

Editor de vídeo local com assistência do Claude. O navegador mantém o arquivo de vídeo no dispositivo e envia à API da Anthropic apenas até 8 quadros amostrados para obter sugestões de trechos, título e roteiro. É possível ajustar entrada e saída e exportar o trecho selecionado em WebM.

## Requisitos

- Node.js 20 ou superior
- Uma chave de API da Anthropic
- Navegador Chromium atualizado para exportar trechos

## Configuração

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env` e preencha `ANTHROPIC_API_KEY`.
3. Inicie com `npm start` e abra `http://localhost:3000`.

`ANTHROPIC_MODEL` pode ser definido no `.env` para escolher outro modelo habilitado na sua conta. A chave é usada apenas pelo servidor e não é enviada ao navegador.

## Limites desta versão

- A análise visual usa quadros amostrados; o Claude não recebe nem transcreve o áudio do vídeo.
- A exportação gera um único trecho contínuo, com áudio quando o navegador disponibiliza a faixa na captura. O arquivo de saída é WebM.
- A exportação acontece em tempo real no navegador; deixe a aba aberta até o download começar.