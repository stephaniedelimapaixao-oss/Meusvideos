import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith('video/')),
});

app.use(express.static(publicDirectory));

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