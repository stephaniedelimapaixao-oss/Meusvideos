import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { chmod, mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(projectDirectory, 'public');
const hyperframesCli = path.join(projectDirectory, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
const ffmpegDirectory = path.join(projectDirectory, 'node_modules', '@ffmpeg-installer', 'linux-x64');
const ffmpegBinary = path.join(ffmpegDirectory, 'ffmpeg');
const motionTemplates = [
  {
    id: 'titulo-animado', name: 'Título animado', description: 'Tipografia em foco com entrada ascendente e acento gráfico.', duration: 5,
    file: '../index.html', fields: [
      { id: 'eyebrow', label: 'Chamada', placeholder: 'UMA IDEIA EM MOVIMENTO', default: 'UMA IDEIA EM MOVIMENTO', maxLength: 60 },
      { id: 'title', label: 'Título', placeholder: 'Sua mensagem', default: 'Sua mensagem', maxLength: 70 },
    ],
  },
  {
    id: 'lower-third', name: 'Lower third', description: 'Identificação elegante para entrevistas e vídeos de apresentação.', duration: 6,
    file: 'lower-third.html', fields: [
      { id: 'name', label: 'Nome', placeholder: 'Nome da pessoa', default: 'Marina Costa', maxLength: 60 },
      { id: 'role', label: 'Identificação', placeholder: 'Cargo ou contexto', default: 'Diretora criativa', maxLength: 80 },
    ],
  },
  {
    id: 'legenda-palavra', name: 'Legenda palavra por palavra', description: 'Destaque sequencial para uma frase curta ou chamada.', duration: 8,
    file: 'legenda-palavra.html', fields: [
      { id: 'caption', label: 'Texto', placeholder: 'Escreva até 14 palavras', default: 'Toda boa história começa com uma ideia', maxLength: 120 },
    ],
  },
  {
    id: 'abertura', name: 'Abertura', description: 'Vinheta de marca com título, assinatura e formas em movimento.', duration: 8,
    file: 'abertura.html', fields: [
      { id: 'brand', label: 'Marca', placeholder: 'Nome da marca', default: 'MEUSVÍDEOS', maxLength: 40 },
      { id: 'title', label: 'Título', placeholder: 'Título do vídeo', default: 'Novos caminhos', maxLength: 70 },
      { id: 'subtitle', label: 'Complemento', placeholder: 'Uma linha de contexto', default: 'Histórias que merecem ser vistas', maxLength: 90 },
    ],
  },
];
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith('video/')),
});

app.use(express.static(publicDirectory));
app.use(express.json({ limit: '20kb' }));

app.get('/api/motions', (_request, response) => {
  response.json(motionTemplates.map(({ id, name, description, duration, fields }) => ({ id, name, description, duration, fields })));
});

app.post('/api/motions/render', async (request, response) => {
  const template = motionTemplates.find((item) => item.id === request.body?.id);
  if (!template) return response.status(400).json({ error: 'Escolha um modelo de motion válido.' });
  if (request.body?.variables === null || typeof request.body.variables !== 'object' || Array.isArray(request.body.variables)) {
    return response.status(400).json({ error: 'Os campos do modelo estão inválidos.' });
  }

  const variables = Object.fromEntries(template.fields.map((field) => {
    const value = request.body.variables[field.id];
    return [field.id, typeof value === 'string' ? value.trim().slice(0, field.maxLength) : field.default];
  }));
  const renderDirectory = await mkdtemp(path.join(tmpdir(), 'meusvideos-motion-'));
  const outputFile = path.join(renderDirectory, `${template.id}.mp4`);

  try {
    await chmod(ffmpegBinary, 0o755);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        hyperframesCli, 'render', projectDirectory,
        '--composition', path.join('motions', template.file),
        '--output', outputFile,
        '--fps', '30', '--quality', 'draft', '--workers', '1', '--low-memory-mode', '--no-browser-gpu',
        '--variables', JSON.stringify(variables), '--strict',
      ], {
        cwd: projectDirectory,
        env: { ...process.env, PATH: `${ffmpegDirectory}${delimiter}${process.env.PATH || ''}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let logs = '';
      const collect = (chunk) => { logs = `${logs}${chunk}`.slice(-8000); };
      const timeout = setTimeout(() => child.kill('SIGTERM'), 5 * 60 * 1000);
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(logs || `HyperFrames encerrou com código ${code}.`));
      });
    });

    response.download(outputFile, `${template.id}.mp4`, async (error) => {
      await rm(renderDirectory, { recursive: true, force: true });
      if (error && !response.headersSent) response.status(500).json({ error: 'Não foi possível enviar o vídeo renderizado.' });
    });
  } catch (error) {
    console.error('Falha no render HyperFrames:', error.message);
    await rm(renderDirectory, { recursive: true, force: true });
    return response.status(500).json({ error: 'A renderização local falhou. Verifique se o HyperFrames e o Chromium foram instalados.' });
  }
});

app.get('/api/status', (_request, response) => {
  response.json({ configured: Boolean(process.env.GEMINI_API_KEY), model });
});

app.post('/api/analyze', upload.single('video'), async (request, response) => {
  let uploadedFile;
  try {
    if (!process.env.GEMINI_API_KEY) {
      return response.status(503).json({ error: 'Configure GEMINI_API_KEY no arquivo .env.' });
    }
    if (!request.file) {
      return response.status(400).json({ error: 'Selecione um arquivo de vídeo para analisar.' });
    }

    const duration = Number(request.body.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return response.status(400).json({ error: 'A duração do vídeo é inválida.' });
    }

    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    uploadedFile = await client.files.upload({
      file: request.file.path,
      config: { mimeType: request.file.mimetype, displayName: request.file.originalname },
    });

    for (let attempt = 0; uploadedFile.state === 'PROCESSING' && attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      uploadedFile = await client.files.get({ name: uploadedFile.name });
    }
    if (uploadedFile.state !== 'ACTIVE') {
      throw new Error(`O Gemini não conseguiu processar o vídeo (estado: ${uploadedFile.state}).`);
    }

    const result = await client.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { fileData: { fileUri: uploadedFile.uri, mimeType: uploadedFile.mimeType } },
          { text: `Você é um editor de vídeo. Analise o vídeo completo, incluindo imagem e áudio. Duração: ${duration.toFixed(1)} segundos. Direção: ${String(request.body.direction || 'Selecione os momentos mais fortes para um vídeo conciso.').slice(0, 1000)}. Sugira trechos cronológicos com base no conteúdo visual e falado, sem inventar informações. Responda somente JSON válido no formato {"summary":"resumo curto","title":"título sugerido","segments":[{"start":0,"end":10,"label":"nome curto","reason":"motivo da seleção"}],"script":"sugestão curta de estrutura ou narração"}. Os tempos devem estar em segundos, dentro da duração informada, e cada trecho deve ter duração positiva. Prefira poucos trechos úteis, sem sobreposição.` },
        ],
      }],
      config: { responseMimeType: 'application/json' },
    });

    const text = result.text ?? '';
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) throw new Error('O Gemini não retornou um plano em JSON.');

    const plan = JSON.parse(jsonText);
    const segments = Array.isArray(plan.segments) ? plan.segments
      .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end))
      .map((segment) => ({
        start: Math.max(0, Math.min(duration, segment.start)),
        end: Math.max(0, Math.min(duration, segment.end)),
        label: String(segment.label || 'Trecho sugerido').slice(0, 100),
        reason: String(segment.reason || '').slice(0, 400),
      }))
      .filter((segment) => segment.end > segment.start)
      .slice(0, 12) : [];

    if (!segments.length) throw new Error('O Gemini não encontrou trechos válidos para sugerir.');
    return response.json({
      summary: String(plan.summary || '').slice(0, 500),
      title: String(plan.title || '').slice(0, 120),
      script: String(plan.script || '').slice(0, 1000),
      segments,
    });
  } catch (error) {
    console.error('Falha na análise do Gemini:', error.message);
    return response.status(502).json({ error: 'Não foi possível analisar o vídeo. Confira a chave, o limite gratuito e tente novamente.' });
  } finally {
    if (uploadedFile?.name && process.env.GEMINI_API_KEY) {
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      await client.files.delete({ name: uploadedFile.name }).catch((error) => {
        console.error('Falha ao remover o vídeo remoto:', error.message);
      });
    }
    if (request.file?.path) {
      await unlink(request.file.path).catch(() => {});
    }
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'O vídeo excede o limite local de 200 MB.' });
  }
  console.error('Falha ao receber o vídeo:', error.message);
  return response.status(400).json({ error: 'Não foi possível receber o arquivo de vídeo.' });
});

app.listen(port, () => {
  console.log(`Meusvídeos disponível em http://localhost:${port}`);
});