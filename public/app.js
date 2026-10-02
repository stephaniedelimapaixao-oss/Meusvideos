const videoInput = document.querySelector('#video-input');
const video = document.querySelector('#video-preview');
const previewEmpty = document.querySelector('#preview-empty');
const dropZone = document.querySelector('#drop-zone');
const sourceFile = document.querySelector('#source-file');
const analyzeButton = document.querySelector('#analyze-button');
const exportButton = document.querySelector('#export-button');
const startInput = document.querySelector('#trim-start');
const endInput = document.querySelector('#trim-end');
const connectionStatus = document.querySelector('#connection-status');
const analysisResults = document.querySelector('#analysis-results');
const assistantHint = document.querySelector('#assistant-hint');
const timelineSelected = document.querySelector('#timeline-selected');
const timelinePlayhead = document.querySelector('#timeline-playhead');
const toast = document.querySelector('#toast');
const motionGrid = document.querySelector('#motion-grid');
const motionEditor = document.querySelector('#motion-editor');
const motionFields = document.querySelector('#motion-fields');
const renderMotionButton = document.querySelector('#render-motion-button');
const insertNewsButton = document.querySelector('#insert-news-button');
const newsDialog = document.querySelector('#news-dialog');
const newsForm = document.querySelector('#news-form');
const newsUrlInput = document.querySelector('#news-url');
const newsImage = document.querySelector('#news-image');
const newsOverlay = document.querySelector('#news-overlay');
const removeNewsButton = document.querySelector('#remove-news-button');
const captureNewsButton = document.querySelector('#capture-news-button');

let videoUrl = null;
let videoFile = null;
let duration = 0;
let analysis = null;
let activeSegment = -1;
let toastTimer;
let selectedMotion = null;
let renderingMotion = false;
let newsClip = null;
let newsClipStart = 0;
let newsOverlayActive = false;

function formatTime(seconds, decimals = 0) {
  if (!Number.isFinite(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remaining = (seconds % 60).toFixed(decimals).padStart(decimals ? 4 : 2, '0');
  return `${minutes}:${remaining}`;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}

function setTrim(start, end) {
  const safeStart = Math.max(0, Math.min(duration, Number(start) || 0));
  const safeEnd = Math.max(safeStart + 0.1, Math.min(duration, Number(end) || duration));
  startInput.value = safeStart.toFixed(1);
  endInput.value = Math.min(duration, safeEnd).toFixed(1);
  updateTimeline();
}

function updateTimeline() {
  const start = Number(startInput.value) || 0;
  const end = Number(endInput.value) || duration;
  timelineSelected.style.left = `${duration ? (start / duration) * 100 : 0}%`;
  timelineSelected.style.width = `${duration ? ((end - start) / duration) * 100 : 100}%`;
  timelinePlayhead.style.left = `${duration ? (video.currentTime / duration) * 100 : 0}%`;
  document.querySelector('#trim-duration').textContent = `${Math.max(0, end - start).toFixed(1)} s selecionados`;
  document.querySelector('#current-time').textContent = formatTime(video.currentTime, 1);
  exportButton.disabled = !(videoUrl && end > start && end <= duration);
  document.querySelector('#set-in-button').disabled = !videoUrl;
  document.querySelector('#set-out-button').disabled = !videoUrl;
  insertNewsButton.disabled = !videoUrl;
  updateNewsPreview();
}

function updateNewsPreview() {
  const active = Boolean(newsClip && video.currentTime >= newsClip.start && video.currentTime < newsClip.start + newsClip.duration);
  removeNewsButton.hidden = !newsClip;
  if (active === newsOverlayActive) return;
  newsOverlayActive = active;
  newsOverlay.hidden = !active;
  newsOverlay.classList.remove('is-visible');
  if (active) requestAnimationFrame(() => newsOverlay.classList.add('is-visible'));
}

async function deleteNewsCapture(id) {
  await fetch(`/api/news/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

function removeNews() {
  if (!newsClip) return;
  const { id } = newsClip;
  newsClip = null;
  newsOverlayActive = false;
  newsOverlay.hidden = true;
  removeNewsButton.hidden = true;
  updateTimeline();
  deleteNewsCapture(id);
}

function insertNews() {
  if (!videoUrl) return;
  video.pause();
  newsClipStart = video.currentTime;
  document.querySelector('#news-error').hidden = true;
  newsUrlInput.value = '';
  newsDialog.showModal();
  newsUrlInput.focus();
}

async function captureNews(event) {
  event.preventDefault();
  captureNewsButton.disabled = true;
  captureNewsButton.textContent = 'Capturando página…';
  document.querySelector('#news-error').hidden = true;
  try {
    const response = await fetch('/api/news/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newsUrlInput.value.trim() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível capturar a notícia.');
    const image = new Image();
    image.src = result.imageUrl;
    await image.decode();
    const previousCapture = newsClip?.id;
    newsClip = { ...result, image, start: newsClipStart, duration: 4.5 };
    newsImage.src = result.imageUrl;
    newsImage.alt = `Captura da notícia: ${result.title}`;
    document.querySelector('#news-hostname').textContent = result.hostname;
    newsOverlayActive = false;
    updateTimeline();
    newsDialog.close();
    if (previousCapture) deleteNewsCapture(previousCapture);
    notify('Notícia inserida na linha do tempo.');
  } catch (error) {
    const errorElement = document.querySelector('#news-error');
    errorElement.textContent = error.message || 'Falha ao capturar a página.';
    errorElement.hidden = false;
  } finally {
    captureNewsButton.disabled = false;
    captureNewsButton.textContent = 'Capturar página';
  }
}

function loadVideo(file) {
  if (!file || !file.type.startsWith('video/')) {
    notify('Escolha um arquivo de vídeo válido.');
    return;
  }
  if (newsClip) removeNews();
  videoFile = file;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  video.src = videoUrl;
  video.hidden = false;
  previewEmpty.hidden = true;
  sourceFile.hidden = false;
  document.querySelector('#file-name').textContent = file.name;
  document.querySelector('#file-meta').textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  document.querySelector('#project-label').textContent = file.name.replace(/\.[^.]+$/, '');
  document.querySelector('#edit-state').textContent = 'MÍDIA CARREGADA';
  assistantHint.hidden = false;
  assistantHint.innerHTML = '<span aria-hidden="true">↖</span> Escreva o objetivo da edição e peça uma análise.';
  analysisResults.hidden = true;
  analysis = null;
  activeSegment = -1;
  analyzeButton.disabled = false;
  startInput.disabled = true;
  endInput.disabled = true;
  video.onloadedmetadata = () => {
    duration = video.duration;
    document.querySelector('#total-time').textContent = formatTime(duration, 1);
    document.querySelector('#source-duration').textContent = formatTime(duration);
    document.querySelector('#end-time').textContent = formatTime(duration);
    document.querySelector('#middle-time').textContent = formatTime(duration / 2);
    startInput.disabled = false;
    endInput.disabled = false;
    startInput.max = duration;
    endInput.max = duration;
    setTrim(0, duration);
    document.querySelector('#edit-state').textContent = 'PRONTO PARA EDITAR';
  };
  videoInput.value = '';
}

function renderAnalysis(plan) {
  analysis = plan;
  document.querySelector('#result-title').textContent = plan.title || 'Sugestão de edição';
  document.querySelector('#result-summary').textContent = plan.summary || '';
  document.querySelector('#result-script').textContent = plan.script || 'Sem sugestão de roteiro.';
  const list = document.querySelector('#segment-list');
  list.replaceChildren();
  plan.segments.forEach((segment, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment-card';
    button.innerHTML = '<span class="segment-head"><span></span><span class="segment-time"></span></span><p></p>';
    button.querySelector('.segment-head span:first-child').textContent = segment.label;
    button.querySelector('.segment-time').textContent = `${formatTime(segment.start, 1)} — ${formatTime(segment.end, 1)}`;
    button.querySelector('p').textContent = segment.reason;
    button.addEventListener('click', () => {
      activeSegment = index;
      document.querySelectorAll('.segment-card').forEach((item, itemIndex) => item.classList.toggle('is-active', itemIndex === index));
      setTrim(segment.start, segment.end);
      video.currentTime = segment.start;
    });
    list.append(button);
  });
  analysisResults.hidden = false;
  assistantHint.hidden = true;
  document.querySelector('#edit-state').textContent = `${plan.segments.length} TRECHO${plan.segments.length === 1 ? '' : 'S'} SUGERIDO${plan.segments.length === 1 ? '' : 'S'}`;
}

async function analyzeVideo() {
  if (!videoUrl || !duration) return;
  analyzeButton.disabled = true;
  document.querySelector('#analysis-error').hidden = true;
  analyzeButton.innerHTML = '<span class="sparkle" aria-hidden="true">✳</span> Enviando vídeo…';
  try {
    const formData = new FormData();
    formData.append('video', videoFile);
    formData.append('duration', String(duration));
    formData.append('direction', document.querySelector('#direction-input').value);
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível analisar o vídeo.');
    renderAnalysis(result);
  } catch (error) {
    const errorElement = document.querySelector('#analysis-error');
    errorElement.textContent = error.message || 'Falha ao analisar o vídeo.';
    errorElement.hidden = false;
  } finally {
    analyzeButton.disabled = !videoUrl;
    analyzeButton.innerHTML = '<span class="sparkle" aria-hidden="true">✳</span> Analisar com Gemini <span class="button-arrow" aria-hidden="true">↗</span>';
  }
}

function waitForSeek(time) {
  if (Math.abs(video.currentTime - time) < 0.05) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = time;
  });
}

function drawNewsFrame(context, width, height, currentTime) {
  if (!newsClip || currentTime < newsClip.start || currentTime >= newsClip.start + newsClip.duration) return;
  const progress = Math.max(0, Math.min(1, (currentTime - newsClip.start) / 0.62));
  const eased = 1 - Math.pow(1 - progress, 3);
  const cardWidth = width * 0.82;
  const cardHeight = height * 0.82;
  const scale = 0.9 + eased * 0.1;
  const cardX = (width - cardWidth * scale) / 2;
  const cardY = (height - cardHeight * scale) / 2 + (1 - eased) * height * 0.08;
  const headerHeight = height * 0.045;
  const padding = width * 0.012;
  context.save();
  context.globalAlpha = eased;
  context.fillStyle = '#111914';
  context.fillRect(cardX, cardY, cardWidth * scale, cardHeight * scale);
  context.fillStyle = '#c4e879';
  context.fillRect(cardX, cardY, cardWidth * scale, Math.max(4, height * 0.005));
  context.fillStyle = '#171f19';
  context.fillRect(cardX, cardY + height * 0.005, cardWidth * scale, headerHeight);
  context.fillStyle = '#c4e879';
  context.font = `600 ${Math.max(11, Math.round(height * 0.017))}px Arial`;
  context.fillText('NOTÍCIA', cardX + padding, cardY + headerHeight * 0.68);
  context.fillStyle = '#cad2c7';
  context.font = `${Math.max(10, Math.round(height * 0.014))}px Arial`;
  context.fillText(newsClip.hostname, cardX + padding + width * 0.075, cardY + headerHeight * 0.68);
  const availableWidth = cardWidth * scale - padding * 2;
  const availableHeight = cardHeight * scale - headerHeight - padding * 2;
  const imageScale = Math.min(availableWidth / newsClip.image.naturalWidth, availableHeight / newsClip.image.naturalHeight);
  const imageWidth = newsClip.image.naturalWidth * imageScale;
  const imageHeight = newsClip.image.naturalHeight * imageScale;
  const imageX = cardX + (cardWidth * scale - imageWidth) / 2;
  const imageY = cardY + headerHeight + (availableHeight - imageHeight) / 2;
  context.drawImage(newsClip.image, imageX, imageY, imageWidth, imageHeight);
  context.restore();
}

async function exportSelection() {
  const start = Number(startInput.value);
  const end = Number(endInput.value);
  if (!video.captureStream || !window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    notify('A exportação de vídeo exige um navegador Chromium atualizado.');
    return;
  }
  exportButton.disabled = true;
  exportButton.textContent = 'Preparando…';
  try {
    video.pause();
    await waitForSeek(start);
    const sourceStream = video.captureStream();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    sourceStream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    let drawing = true;
    const drawFrame = () => {
      if (!drawing) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawNewsFrame(context, canvas.width, canvas.height, video.currentTime);
      if (recorder.state !== 'inactive') requestAnimationFrame(drawFrame);
    };
    const finished = new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('Falha ao gravar o trecho.'));
      recorder.onstop = () => {
        drawing = false;
        sourceStream.getTracks().forEach((track) => track.stop());
        stream.getTracks().forEach((track) => track.stop());
        resolve(new Blob(chunks, { type: mimeType }));
      };
    });
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawNewsFrame(context, canvas.width, canvas.height, video.currentTime);
    recorder.start();
    requestAnimationFrame(drawFrame);
    await video.play();
    await new Promise((resolve, reject) => {
      const checkEnd = () => {
        if (video.currentTime >= end || video.ended) {
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
        }
      };
      const timeout = setTimeout(() => {
        video.pause();
        if (recorder.state !== 'inactive') recorder.stop();
        reject(new Error('Tempo esgotado durante a exportação.'));
      }, Math.max(15000, (end - start) * 3000));
      video.addEventListener('timeupdate', checkEnd);
      recorder.addEventListener('stop', () => {
        clearTimeout(timeout);
        video.removeEventListener('timeupdate', checkEnd);
      }, { once: true });
      video.addEventListener('error', () => reject(new Error('Não foi possível reproduzir o vídeo para exportação.')), { once: true });
    });
    const blob = await finished;
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${(analysis?.title || 'meusvideos').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.webm`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    notify('Trecho exportado em WebM.');
  } catch (error) {
    notify(error.message || 'Falha ao exportar o trecho.');
  } finally {
    exportButton.innerHTML = '<span aria-hidden="true">↓</span> Exportar trecho';
    updateTimeline();
  }
}

function selectMotion(motion) {
  selectedMotion = motion;
  motionGrid.querySelectorAll('.motion-card').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.motionId === motion.id);
  });
  motionFields.replaceChildren();
  motion.fields.forEach((field) => {
    const label = document.createElement('label');
    label.className = 'motion-field';
    label.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = field.id;
    input.maxLength = field.maxLength;
    input.placeholder = field.placeholder;
    input.value = field.default;
    label.append(input);
    motionFields.append(label);
  });
  motionEditor.hidden = false;
}

async function loadMotions() {
  try {
    const response = await fetch('/api/motions');
    if (!response.ok) throw new Error('Não foi possível carregar os modelos.');
    const motions = await response.json();
    motionGrid.replaceChildren();
    motions.forEach((motion, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `motion-card motion-card-${index + 1}`;
      button.dataset.motionId = motion.id;
      button.innerHTML = '<span class="motion-number"></span><strong></strong><small></small>';
      button.querySelector('.motion-number').textContent = String(index + 1).padStart(2, '0');
      button.querySelector('strong').textContent = motion.name;
      button.querySelector('small').textContent = `${motion.duration} s · ${motion.description}`;
      button.addEventListener('click', () => selectMotion(motion));
      motionGrid.append(button);
    });
    if (motions[0]) selectMotion(motions[0]);
  } catch (error) {
    motionGrid.textContent = error.message;
  }
}

async function renderMotion() {
  if (!selectedMotion || renderingMotion) return;
  renderingMotion = true;
  renderMotionButton.disabled = true;
  renderMotionButton.innerHTML = '<span class="render-spinner" aria-hidden="true"></span> Renderizando localmente…';
  try {
    const variables = Object.fromEntries([...motionFields.querySelectorAll('input')].map((input) => [input.name, input.value]));
    const response = await fetch('/api/motions/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedMotion.id, variables }),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Não foi possível renderizar o modelo.');
    }
    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${selectedMotion.id}.mp4`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    notify('Motion renderizado localmente em MP4.');
  } catch (error) {
    notify(error.message || 'Falha na renderização local.');
  } finally {
    renderingMotion = false;
    renderMotionButton.disabled = false;
    renderMotionButton.innerHTML = '<span aria-hidden="true">▶</span> Renderizar modelo';
  }
}

videoInput.addEventListener('change', (event) => loadVideo(event.target.files[0]));
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  loadVideo(event.dataTransfer.files[0]);
});
document.querySelector('#remove-video').addEventListener('click', () => {
  if (newsClip) removeNews();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  videoFile = null;
  duration = 0;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.hidden = true;
  previewEmpty.hidden = false;
  sourceFile.hidden = true;
  analyzeButton.disabled = true;
  exportButton.disabled = true;
  startInput.value = '0';
  endInput.value = '0';
  startInput.disabled = true;
  endInput.disabled = true;
  document.querySelector('#edit-state').textContent = 'AGUARDANDO MÍDIA';
  document.querySelector('#project-label').textContent = 'Projeto sem título';
  document.querySelector('#source-duration').textContent = '00:00';
  document.querySelector('#total-time').textContent = '00:00.0';
  document.querySelector('#current-time').textContent = '00:00.0';
  analysisResults.hidden = true;
  assistantHint.hidden = false;
  assistantHint.innerHTML = '<span aria-hidden="true">↖</span> Adicione um vídeo para começar a conversa.';
  updateTimeline();
});
document.querySelector('#set-in-button').addEventListener('click', () => setTrim(video.currentTime, Number(endInput.value)));
document.querySelector('#set-out-button').addEventListener('click', () => setTrim(Number(startInput.value), video.currentTime));
startInput.addEventListener('change', () => setTrim(startInput.value, endInput.value));
endInput.addEventListener('change', () => setTrim(startInput.value, endInput.value));
  video.addEventListener('timeupdate', updateTimeline);
video.addEventListener('seeked', updateTimeline);
analyzeButton.addEventListener('click', analyzeVideo);
exportButton.addEventListener('click', exportSelection);
insertNewsButton.addEventListener('click', insertNews);
removeNewsButton.addEventListener('click', removeNews);
newsForm.addEventListener('submit', captureNews);
document.querySelector('#cancel-news').addEventListener('click', () => newsDialog.close());
document.querySelector('#close-news-dialog').addEventListener('click', () => newsDialog.close());
renderMotionButton.addEventListener('click', renderMotion);
loadMotions();

fetch('/api/status').then((response) => response.json()).then((status) => {
  if (status.configured) {
    connectionStatus.classList.add('is-ready');
    connectionStatus.innerHTML = '<span class="status-dot"></span><span>Gemini conectado</span>';
  } else {
    connectionStatus.classList.add('is-offline');
    connectionStatus.innerHTML = '<span class="status-dot"></span><span>Configure a API</span>';
  }
}).catch(() => {
  connectionStatus.classList.add('is-offline');
  connectionStatus.innerHTML = '<span class="status-dot"></span><span>Servidor indisponível</span>';
});