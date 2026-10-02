import { GoogleGenAI } from '@google/genai';
import { chromium as playwright } from 'playwright-core';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import chromium from '@sparticuz/chromium';
import { access, chmod, mkdir, mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import path, { delimiter } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const appPassword = process.env.APP_PASSWORD;
const maxUploadBytes = 200 * 1024 * 1024;
const requestsPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
if (!appPassword) throw new Error('Configure APP_PASSWORD antes de iniciar o servidor.');
if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute < 1) {
  throw new Error('RATE_LIMIT_PER_MINUTE deve ser um número inteiro positivo.');
}
const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(projectDirectory, 'public');
const newsDirectory = path.join(publicDirectory, 'news');
const hyperframesCli = path.join(projectDirectory, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
const ffmpegDirectory = path.join(projectDirectory, 'node_modules', '@ffmpeg-installer', 'linux-x64');
const ffprobeDirectory = path.join(projectDirectory, 'node_modules', '@ffprobe-installer', 'linux-x64');
const ffmpegBinary = path.join(ffmpegDirectory, 'ffmpeg');
const ffprobeBinary = path.join(ffprobeDirectory, 'ffprobe');
const execFileAsync = promisify(execFile);
const motionTemplates = [
  {
    id: 'titulo-animado', name: 'Título animado', description: 'Tipografia em foco com entrada ascendente e acento gráfico.', duration: 5,
    file: '../index.html', fields: [
      { id: 'eyebrow', label: 'Chamada', placeholder: 'UMA IDEIA EM MOVIMENTO', default: 'UMA IDEIA EM MOVIMENTO', maxLength: 60 },
      { id: 'title', label: 'Título', placeholder: 'Sua mensagem', default: 'Sua mensagem', maxLength: 70 },
    ],
  },
  {
    id: 'lower-third', name: 'Faixa de identificação', description: 'Identificação elegante para entrevistas e vídeos de apresentação.', duration: 6,
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
let motionRenderActive = false;
let newsCaptureActive = false;
let videoRenderActive = false;
const upload = multer({
  dest: tmpdir(),
  limits: { fileSize: maxUploadBytes, files: 1, fields: 8, fieldSize: 20 * 1024, parts: 9 },
  fileFilter: (_request, file, callback) => callback(null, file.mimetype.startsWith('video/')),
});

function requirePassword(request, response, next) {
  const authorization = request.get('authorization') || '';
  const [scheme, encodedCredentials] = authorization.split(' ', 2);
  if (scheme?.toLowerCase() === 'basic' && encodedCredentials) {
    const credentials = Buffer.from(encodedCredentials, 'base64').toString('utf8');
    const separator = credentials.indexOf(':');
    const candidate = Buffer.from(separator < 0 ? '' : credentials.slice(separator + 1));
    const expected = Buffer.from(appPassword);
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) return next();
  }

  response.set('WWW-Authenticate', 'Basic realm="Meusvídeos", charset="UTF-8"');
  return response.status(401).send('Autenticação necessária.');
}

async function browserExecutablePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (process.env.NODE_ENV === 'production') return playwright.executablePath();
  return chromium.executablePath();
}

function isPublicAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [first, second, third] = address.split('.').map(Number);
    return first !== 0 && first !== 10 && first !== 127 && first < 224
      && !(first === 100 && second >= 64 && second <= 127)
      && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31)
      && !(first === 192 && (second === 0 || second === 168))
      && !(first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
      && !(first === 203 && second === 0 && third === 113);
  }
  if (version === 6) {
    const value = address.toLowerCase();
    const firstGroup = Number.parseInt(value.split(':').find(Boolean) || '0', 16);
    return value !== '::' && value !== '::1' && !value.startsWith('::ffff:')
      && !value.startsWith('2001:db8:')
      && (firstGroup & 0xfe00) !== 0xfc00
      && (firstGroup & 0xffc0) !== 0xfe80
      && (firstGroup & 0xff00) !== 0xff00;
  }
  return false;
}

async function validatePublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Cole um link válido de notícia.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new Error('Use um link HTTP ou HTTPS público, sem portas personalizadas.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Links locais ou internos não podem ser capturados.');
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('O link precisa apontar apenas para endereços públicos.');
  }
  return url;
}

app.set('trust proxy', 1);
app.use(rateLimit({
  windowMs: 60_000,
  limit: requestsPerMinute,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Limite de requisições atingido. Aguarde um minuto e tente novamente.' },
}));
app.use(requirePassword);
app.use(express.static(publicDirectory));
app.use(express.json({ limit: '20kb' }));

app.get('/api/motions', (_request, response) => {
  response.json(motionTemplates.map(({ id, name, description, duration, fields }) => ({ id, name, description, duration, fields })));
});

app.post('/api/motions/render', async (request, response) => {
  if (motionRenderActive) return response.status(409).json({ error: 'Já existe um motion sendo renderizado.' });
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
    motionRenderActive = true;
    await chmod(ffmpegBinary, 0o755);
    await chmod(ffprobeBinary, 0o755);
    const browserPath = await browserExecutablePath();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        hyperframesCli, 'render', projectDirectory,
        '--composition', path.join('motions', template.file),
        '--output', outputFile,
        '--fps', '30', '--quality', 'draft', '--workers', '1', '--low-memory-mode', '--no-browser-gpu',
        '--variables', JSON.stringify(variables), '--strict',
      ], {
        cwd: projectDirectory,
        env: {
          ...process.env,
          PATH: `${ffmpegDirectory}${delimiter}${ffprobeDirectory}${delimiter}${process.env.PATH || ''}`,
          HYPERFRAMES_FFMPEG_PATH: ffmpegBinary,
          HYPERFRAMES_FFPROBE_PATH: ffprobeBinary,
          HYPERFRAMES_BROWSER_PATH: browserPath,
        },
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

    motionRenderActive = false;
    response.download(outputFile, `${template.id}.mp4`, async (error) => {
      await rm(renderDirectory, { recursive: true, force: true });
      if (error && !response.headersSent) response.status(500).json({ error: 'Não foi possível enviar o vídeo renderizado.' });
    });
  } catch (error) {
    motionRenderActive = false;
    console.error('Falha no render HyperFrames:', error.message);
    await rm(renderDirectory, { recursive: true, force: true });
    return response.status(500).json({ error: 'A renderização local falhou. Verifique se o HyperFrames e o Chromium foram instalados.' });
  }
});

app.post('/api/news/capture', async (request, response) => {
  if (newsCaptureActive) return response.status(409).json({ error: 'Uma página já está sendo capturada.' });
  let pageUrl;
  try {
    pageUrl = await validatePublicUrl(request.body?.url);
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }

  newsCaptureActive = true;
  let browser;
  let screenshotPath;
  try {
    const browserPath = await browserExecutablePath();
    browser = await playwright.launch({
      executablePath: browserPath,
      args: process.env.NODE_ENV === 'production' ? undefined : chromium.args,
      headless: true,
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.setDefaultNavigationTimeout(20000);
    await page.route('**/*', async (route) => {
      try {
        const resourceUrl = new URL(route.request().url());
        if (['data:', 'blob:', 'about:'].includes(resourceUrl.protocol)) return route.continue();
        await validatePublicUrl(resourceUrl.href);
        return route.continue();
      } catch {
        return route.abort('blockedbyclient');
      }
    });

    const pageResponse = await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!pageResponse || !pageResponse.ok()) {
      return response.status(422).json({ error: `A página respondeu com ${pageResponse?.status() || 'erro de navegação'}.` });
    }
    await page.waitForTimeout(900);
    const title = (await page.title()).trim().slice(0, 160) || pageUrl.hostname;
    const id = randomUUID();
    await mkdir(newsDirectory, { recursive: true });
    screenshotPath = path.join(newsDirectory, `${id}.png`);
    await page.screenshot({ path: screenshotPath, type: 'png' });
    return response.json({ id, title, hostname: pageUrl.hostname, url: pageUrl.href, imageUrl: `/news/${id}.png` });
  } catch (error) {
    console.error('Falha ao capturar a notícia:', error.message);
    if (screenshotPath) await unlink(screenshotPath).catch(() => {});
    return response.status(502).json({ error: 'Não foi possível capturar a página. Confira o link e tente novamente.' });
  } finally {
    await browser?.close().catch(() => {});
    newsCaptureActive = false;
  }
});

app.delete('/api/news/:id', async (request, response) => {
  if (!/^[\da-f-]{36}$/i.test(request.params.id)) return response.status(400).json({ error: 'Identificador inválido.' });
  await unlink(path.join(newsDirectory, `${request.params.id}.png`)).catch(() => {});
  return response.status(204).end();
});

app.post('/api/video/render', upload.single('video'), async (request, response) => {
  if (videoRenderActive) {
    if (request.file?.path) await unlink(request.file.path).catch(() => {});
    return response.status(409).json({ error: 'Já existe um vídeo sendo renderizado.' });
  }

  const captureId = request.body?.captureId;
  const hasNews = typeof captureId === 'string' && captureId.length > 0;
  if (!request.file || (hasNews && !/^[\da-f-]{36}$/i.test(captureId))) {
    if (request.file?.path) await unlink(request.file.path).catch(() => {});
    return response.status(400).json({ error: 'Envie um vídeo e, se houver, uma captura de notícia válida.' });
  }
  const screenshotPath = hasNews ? path.join(newsDirectory, `${captureId}.png`) : null;
  const trimStart = Number(request.body.start);
  const trimEnd = Number(request.body.end);
  const newsStart = hasNews ? Number(request.body.newsStart) : 0;
  const newsDuration = hasNews ? Number(request.body.newsDuration) : 0;
  const clipDuration = trimEnd - trimStart;
  if (![trimStart, trimEnd].every(Number.isFinite) || trimStart < 0 || clipDuration <= 0 || clipDuration > 300
    || (hasNews && (![newsStart, newsDuration].every(Number.isFinite) || newsStart < 0 || newsDuration <= 0))) {
    await unlink(request.file.path).catch(() => {});
    return response.status(400).json({ error: 'Os tempos de corte ou da notícia são inválidos.' });
  }
  if (hasNews) {
    try {
      await access(screenshotPath);
    } catch {
      await unlink(request.file.path).catch(() => {});
      return response.status(404).json({ error: 'A captura da notícia não está mais disponível.' });
    }
  }

  const renderDirectory = await mkdtemp(path.join(tmpdir(), 'meusvideos-news-render-'));
  const outputFile = path.join(renderDirectory, 'meusvideos-noticia.mp4');
  videoRenderActive = true;
  try {
    await chmod(ffmpegBinary, 0o755);
    const ffmpegArguments = [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', trimStart.toFixed(3), '-i', request.file.path,
    ];
    if (hasNews) {
      await chmod(ffprobeBinary, 0o755);
      const { stdout } = await execFileAsync(ffprobeBinary, [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=s=x:p=0', request.file.path,
      ], { timeout: 10000, maxBuffer: 4096 });
      const [videoWidth, videoHeight] = stdout.trim().split('x').map(Number);
      if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) throw new Error('Não foi possível ler as dimensões do vídeo.');

      const cardWidth = Math.max(2, Math.floor(videoWidth * 0.82 / 2) * 2);
      const cardHeight = Math.max(2, Math.floor(videoHeight * 0.72 / 2) * 2);
      const imageWidth = Math.max(2, cardWidth - Math.floor(videoWidth * 0.035 / 2) * 2);
      const imageHeight = Math.max(2, cardHeight - Math.floor(videoHeight * 0.08 / 2) * 2);
      const overlayStart = Math.max(0, newsStart - trimStart);
      const overlayEnd = Math.min(clipDuration, overlayStart + newsDuration);
      if (overlayEnd <= overlayStart) throw new Error('A captura da notícia está fora do trecho selecionado.');
      const entrance = `(1-min(max((t-${overlayStart.toFixed(3)})/0.62,0),1))`;
      const filter = `[0:v]setpts=PTS-STARTPTS[base];[1:v]scale=${imageWidth}:${imageHeight}:force_original_aspect_ratio=decrease,pad=${cardWidth}:${cardHeight}:(ow-iw)/2:(oh-ih)/2:color=0x111914,format=rgba,fade=t=in:st=0:d=0.62:alpha=1[card];[base][card]overlay=x='(W-w)/2':y='(H-h)/2+${entrance}*H*0.08':eval=frame:enable='between(t,${overlayStart.toFixed(3)},${overlayEnd.toFixed(3)})'[outv]`;
      ffmpegArguments.push('-loop', '1', '-framerate', '30', '-i', screenshotPath, '-filter_complex', filter, '-map', '[outv]');
    } else {
      ffmpegArguments.push('-map', '0:v:0');
    }
    ffmpegArguments.push('-map', '0:a?', '-t', clipDuration.toFixed(3), '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', outputFile);

    await new Promise((resolve, reject) => {
      const child = spawn(ffmpegBinary, ffmpegArguments, { stdio: ['ignore', 'ignore', 'pipe'] });
      let logs = '';
      child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-6000); });
      const timeout = setTimeout(() => child.kill('SIGTERM'), Math.max(60000, clipDuration * 10000));
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(logs || `FFmpeg encerrou com código ${code}.`));
      });
    });

    videoRenderActive = false;
    response.download(outputFile, 'meusvideos.mp4', async (error) => {
      await rm(renderDirectory, { recursive: true, force: true });
      await unlink(request.file.path).catch(() => {});
      if (error && !response.headersSent) response.status(500).json({ error: 'Não foi possível enviar o vídeo renderizado.' });
    });
  } catch (error) {
    videoRenderActive = false;
    console.error('Falha ao exportar o vídeo:', error.message);
    await rm(renderDirectory, { recursive: true, force: true });
    await unlink(request.file.path).catch(() => {});
    return response.status(500).json({ error: 'Não foi possível compor o vídeo localmente.' });
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
    return response.status(413).json({ error: `O vídeo excede o limite de ${maxUploadBytes / (1024 * 1024)} MB.` });
  }
  console.error('Falha ao receber o vídeo:', error.message);
  return response.status(400).json({ error: 'Não foi possível receber o arquivo de vídeo.' });
});

app.listen(port, () => {
  console.log(`Meusvídeos disponível em http://localhost:${port}`);
});