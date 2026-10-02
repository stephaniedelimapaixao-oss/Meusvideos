import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

app.use(express.json({ limit: '18mb' }));
app.use(express.static(publicDirectory));

app.get('/api/status', (_request, response) => {
  response.json({ configured: Boolean(process.env.ANTHROPIC_API_KEY), model });
});

app.post('/api/analyze', async (request, response) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return response.status(503).json({ error: 'Configure ANTHROPIC_API_KEY no arquivo .env.' });
  }

  const { duration, frames, direction } = request.body ?? {};
  if (!Number.isFinite(duration) || duration <= 0 || !Array.isArray(frames) || frames.length === 0 || frames.length > 8) {
    return response.status(400).json({ error: 'Envie a duração do vídeo e de 1 a 8 quadros.' });
  }

  const imageBlocks = [];
  for (const frame of frames) {
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(frame.image || '');
    if (!match || !Number.isFinite(frame.time)) {
      return response.status(400).json({ error: 'Um dos quadros enviados está inválido.' });
    }

    imageBlocks.push({ type: 'text', text: `Quadro capturado em ${frame.time.toFixed(1)} segundos.` });
    imageBlocks.push({
      type: 'image',
      source: { type: 'base64', media_type: `image/${match[1]}`, data: match[2] },
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const result = await client.messages.create({
      model,
      max_tokens: 1800,
      system: 'Você é um editor de vídeo. Analise os quadros amostrados e crie um plano prático com trechos cronológicos. Não invente detalhes visuais que não aparecem nos quadros. Responda somente JSON válido, sem markdown, no formato: {"summary":"resumo curto","title":"título sugerido","segments":[{"start":0,"end":10,"label":"nome curto","reason":"motivo da seleção"}],"script":"sugestão curta de estrutura ou narração"}. Os tempos devem estar em segundos, começar em 0 ou depois, terminar até a duração informada, e ter pelo menos um segmento com duração positiva. Prefira poucos trechos úteis, sem sobreposição.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Duração total: ${duration.toFixed(1)} segundos. Direção do usuário: ${String(direction || 'Selecione os momentos mais fortes para um vídeo conciso.').slice(0, 1000)}\nSugira uma edição e uma estrutura de roteiro com base nestes quadros:` },
          ...imageBlocks,
        ],
      }],
    });

    const text = result.content.find((block) => block.type === 'text')?.text ?? '';
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonText) throw new Error('O Claude não retornou um plano em JSON.');

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

    if (!segments.length) throw new Error('O Claude não encontrou trechos válidos para sugerir.');
    return response.json({
      summary: String(plan.summary || '').slice(0, 500),
      title: String(plan.title || '').slice(0, 120),
      script: String(plan.script || '').slice(0, 1000),
      segments,
    });
  } catch (error) {
    console.error('Falha na análise do Claude:', error.message);
    return response.status(502).json({ error: 'Não foi possível analisar o vídeo. Confira a chave, o modelo configurado e tente novamente.' });
  }
});

app.listen(port, () => {
  console.log(`Meusvídeos disponível em http://localhost:${port}`);
});