import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { Camera } from './camera';
import { ANALYSIS_WIDTH, detectPage, type Detection } from './cv/detect';
import { loadOpenCV, type CV } from './cv/loader';
import { FOCUS_THRESHOLD, centerCrop, laplacianVariance, samplePatch } from './cv/sharpness';
import { StabilityTracker, curvedOutline, type Quad } from './geometry';
import { downscale, fileToImageData, imageDataToBlob } from './image';
import { onOcrProgress, preloadOcr, type OcrLang } from './ocr';
import { processFrame, type ScanOutput } from './pipeline';
import { clearScans, deleteScan, getScan, listScans, saveScan, updateScanText, type ScanRecord } from './store';

registerSW({ immediate: true });

const app = document.getElementById('app')!;
app.innerHTML = `
  <section id="setup" class="screen active">
    <div class="setup-body">
      <div style="font-size:64px">📖</div>
      <h2>V-Flat Scanner</h2>
      <p>책을 바닥에 펼쳐 두고 카메라를 비추기만 하세요. 페이지를 자동으로 찾아 굴곡을 펴고, 기기 안에서 바로 글자를 인식합니다.</p>
      <p id="setup-status">엔진 준비 중…</p>
      <button id="start" class="big" disabled>카메라 시작</button>
      <label class="link" for="file-setup">사진에서 가져오기</label>
      <input type="file" id="file-setup" accept="image/*" />
    </div>
  </section>

  <section id="scan" class="screen">
    <div class="topbar">
      <button id="auto" class="pill on">● 자동 촬영</button>
      <select id="lang" class="lang" aria-label="OCR 언어">
        <option value="kor+eng">한국어+영어</option>
        <option value="kor">한국어</option>
        <option value="eng">English</option>
      </select>
      <button id="torch" class="icon-btn" title="손전등">🔦</button>
      <button id="to-history" class="icon-btn" title="기록">🗂️</button>
    </div>
    <div class="viewport">
      <video playsinline muted autoplay></video>
      <canvas class="overlay"></canvas>
      <div class="hint"><span class="badge" id="hint">페이지를 찾는 중…</span></div>
    </div>
    <div class="bottombar">
      <label class="icon-btn" for="file-scan" title="사진에서 가져오기">🖼️</label>
      <input type="file" id="file-scan" accept="image/*" />
      <button id="shutter" class="shutter" aria-label="촬영"></button>
      <button id="last" class="thumb" title="마지막 결과">📄</button>
    </div>
  </section>

  <section id="result" class="screen">
    <div class="header">
      <button id="back-scan" class="icon-btn">←</button>
      <h1>인식 결과</h1>
      <button id="delete-result" class="icon-btn" title="삭제">🗑️</button>
    </div>
    <div class="content">
      <div class="preview">
        <img id="result-img" alt="평탄화된 페이지" />
        <button id="toggle-view" class="pill toggle">보정본</button>
      </div>
      <div class="meta" id="result-meta"></div>
      <textarea id="result-text" class="ocr" spellcheck="false" placeholder="인식된 텍스트가 여기에 표시됩니다"></textarea>
    </div>
    <div class="actions">
      <button id="copy"><span class="ic">📋</span>복사</button>
      <button id="share"><span class="ic">📤</span>공유</button>
      <button id="save-img"><span class="ic">🖼️</span>이미지</button>
      <button id="rescan" class="primary"><span class="ic">📷</span>다음 페이지</button>
    </div>
  </section>

  <section id="history" class="screen">
    <div class="header">
      <button id="back-history" class="icon-btn">←</button>
      <h1>스캔 기록</h1>
      <button id="export-all" class="pill">전체 텍스트 내보내기</button>
      <button id="clear-all" class="icon-btn" title="전체 삭제">🗑️</button>
    </div>
    <div class="content"><div id="history-list" class="list"></div></div>
  </section>

  <div id="busy"><div class="spinner"></div><div id="busy-text">처리 중…</div><div class="progress"><div id="busy-bar"></div></div></div>
  <div id="toast" class="toast"></div>
`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const screens = ['setup', 'scan', 'result', 'history'] as const;
type Screen = (typeof screens)[number];

function show(name: Screen) {
  for (const s of screens) document.getElementById(s)!.classList.toggle('active', s === name);
  if (name === 'scan') startLoop();
  else stopLoop();
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

function busy(on: boolean, text = '', progress = 0) {
  $('#busy').classList.toggle('active', on);
  $('#busy-text').textContent = text;
  $('#busy-bar').style.width = `${Math.round(progress * 100)}%`;
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------
let cv: CV | null = null;
const setupStatus = $('#setup-status');
const startBtn = $<HTMLButtonElement>('#start');

async function initEngines() {
  try {
    setupStatus.textContent = '영상 처리 엔진 로딩 중…';
    cv = await loadOpenCV();
    setupStatus.textContent = 'OCR 언어 데이터 로딩 중…';
    onOcrProgress((status, p) => {
      if (status.includes('loading') || status.includes('initializing')) setupStatus.textContent = `OCR 준비 중… ${Math.round(p * 100)}%`;
    });
    await preloadOcr();
    setupStatus.textContent = '준비 완료. 책을 바닥에 두고 시작하세요.';
    startBtn.disabled = false;
  } catch (e) {
    setupStatus.textContent = `초기화 실패: ${(e as Error).message}`;
  }
}
initEngines();

// ---------------------------------------------------------------------------
// Live scanning
// ---------------------------------------------------------------------------
const video = $<HTMLVideoElement>('#scan video');
const overlay = $<HTMLCanvasElement>('#scan canvas.overlay');
const hint = $('#hint');
const camera = new Camera(video);
let autoCapture = true;
let torchOn = false;
let loopId = 0;
let tracker: StabilityTracker | null = null;
let lastDetection: Detection | null = null;
let processing = false;
let analysisBusy = false;
/** Latest focus measure of the page centre (Laplacian variance). */
let sharpness = 0;
let sharpSince = 0;
let softSince = 0;
let lastRefocus = 0;

function startLoop() {
  if (loopId) return;
  const tick = () => {
    loopId = requestAnimationFrame(tick);
    analyseFrame();
  };
  loopId = requestAnimationFrame(tick);
}
function stopLoop() {
  if (loopId) cancelAnimationFrame(loopId);
  loopId = 0;
}

let lastAnalysis = 0;
function analyseFrame() {
  if (!cv || !camera.running || processing || analysisBusy) return;
  const now = performance.now();
  if (now - lastAnalysis < 70) return; // ~14 fps analysis is plenty for a hand-held page
  lastAnalysis = now;
  analysisBusy = true;
  try {
    const { data, scale } = downscale(video, ANALYSIS_WIDTH);
    if (!tracker) tracker = new StabilityTracker(data.width);
    const det = detectPage(cv, data, scale);
    lastDetection = det;
    const quad: Quad | null = det ? det.page.corners : null;
    let progress = tracker.push(quad);

    // Focus gate: measure crispness at native resolution in the middle of
    // the page. Auto-capture waits until the text is actually sharp, and a
    // page that stays soft while held still gets a forced refocus.
    let focused = true;
    if (det) {
      const c = det.page.corners;
      const cx = ((c[0].x + c[1].x + c[2].x + c[3].x) / 4) * det.scale;
      const cy = ((c[0].y + c[1].y + c[2].y + c[3].y) / 4) * det.scale;
      sharpness = laplacianVariance(cv, samplePatch(video, cx, cy));
      focused = sharpness >= FOCUS_THRESHOLD;
      if (focused) { sharpSince ||= now; softSince = 0; }
      else { softSince ||= now; sharpSince = 0; }
      if (!focused && progress >= 0.6 && now - softSince > 900 && now - lastRefocus > 2500) {
        lastRefocus = now;
        void camera.refocus();
      }
      if (!focused) progress = Math.min(progress, 0.85);
    } else {
      sharpness = 0; sharpSince = 0; softSince = 0;
    }

    drawOverlay(det, progress);
    if (!det) hint.textContent = '페이지를 찾는 중… 책 전체가 화면에 들어오게 해주세요';
    else if (!focused) hint.textContent = '초점 맞추는 중… 화면을 탭하면 그 위치에 초점을 맞춥니다';
    else if (progress < 1) hint.textContent = autoCapture ? '잠시 멈춰 주세요…' : '페이지 감지됨';
    else hint.textContent = autoCapture ? '촬영!' : '페이지 감지됨 · 셔터를 누르세요';
    if (autoCapture && focused && now - sharpSince > 250 && tracker.shouldCapture(progress, quad)) {
      tracker.markCaptured(quad!);
      void capture(det);
    }
  } finally {
    analysisBusy = false;
  }
}

function drawOverlay(det: Detection | null, progress: number) {
  const rect = overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (overlay.width !== Math.round(rect.width * dpr) || overlay.height !== Math.round(rect.height * dpr)) {
    overlay.width = Math.round(rect.width * dpr);
    overlay.height = Math.round(rect.height * dpr);
  }
  const ctx = overlay.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!det) return;
  // The video is object-fit: cover, so map analysis coords → displayed coords.
  const vw = det.width, vh = det.height;
  const s = Math.max(rect.width / vw, rect.height / vh);
  const ox = (rect.width - vw * s) / 2, oy = (rect.height - vh * s) / 2;
  const outline = curvedOutline(det.page, 32);
  ctx.beginPath();
  outline.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, ox + p.x * s, oy + p.y * s));
  ctx.closePath();
  const color = progress >= 1 ? '#35d07f' : '#ffb84d';
  ctx.fillStyle = progress >= 1 ? 'rgba(53,208,127,.18)' : 'rgba(255,184,77,.12)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.stroke();
  for (const c of det.page.corners) {
    ctx.beginPath();
    ctx.arc(ox + c.x * s, oy + c.y * s, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (autoCapture && progress > 0 && progress < 1) {
    const cx = rect.width / 2, cy = rect.height - 40;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

/**
 * Captures the sharpest image we can get: a full-resolution still from the
 * camera (with its own focus cycle) when the platform supports it, otherwise
 * the preview frame. Whichever candidate is crisper wins, and a capture that
 * is still soft is retried once after a forced refocus.
 */
async function acquireFrame(): Promise<{ frame: ImageData; fromStill: boolean }> {
  const preview = camera.grabFrame();
  const previewScore = laplacianVariance(cv, centerCrop(preview));
  let best = { frame: preview, score: previewScore, fromStill: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const still = await camera.takePhoto();
    if (!still) break;
    // Compare at the same pixel scale so resolution does not bias the score.
    const f = preview.width / still.width;
    const stillScore = laplacianVariance(cv, centerCrop(still, Math.round(600 / f)));
    if (stillScore >= best.score * 0.9 || still.width > preview.width * 1.3) best = { frame: still, score: stillScore, fromStill: true };
    if (best.score >= FOCUS_THRESHOLD) break;
    busy(true, '초점 다시 맞추는 중…', 0.05);
    await camera.refocus();
  }
  return { frame: best.frame, fromStill: best.fromStill };
}

async function capture(det: Detection | null) {
  if (!cv || processing) return;
  processing = true;
  try {
    if (navigator.vibrate) navigator.vibrate(30);
    busy(true, '촬영 중…', 0.03);
    const { frame, fromStill } = await acquireFrame();
    // A still photo has its own resolution/field of view, so the live
    // detection cannot be reused; the pipeline re-detects on the photo.
    await runPipeline(frame, fromStill ? null : det);
  } catch (e) {
    busy(false);
    toast(`실패: ${(e as Error).message}`);
    console.error(e);
  } finally {
    processing = false;
  }
}

async function runPipeline(frame: ImageData, det: Detection | null) {
  if (!cv) throw new Error('엔진이 아직 준비되지 않았습니다');
  busy(true, '페이지 분석 중…', 0.1);
  onOcrProgress((status, p) => {
    if (status === 'recognizing text') busy(true, `글자 인식 중… ${Math.round(p * 100)}%`, 0.5 + p * 0.5);
  });
  const out = await processFrame(
    cv,
    frame,
    (stage) => {
      const label = { detect: '페이지 찾는 중…', dewarp: '굴곡 펴는 중…', enhance: '이미지 보정 중…', ocr: '글자 인식 중…' }[stage];
      const p = { detect: 0.15, dewarp: 0.3, enhance: 0.45, ocr: 0.5 }[stage];
      busy(true, label, p);
    },
    det,
  );
  busy(true, '저장 중…', 0.98);
  const image = await imageDataToBlob(out.flat, 'image/jpeg', 0.85);
  const thumb = await imageDataToBlob(out.flat, 'image/jpeg', 0.7, 240);
  const id = await saveScan({ createdAt: Date.now(), text: out.ocr.text, confidence: out.ocr.confidence, image, thumb });
  busy(false);
  showResult({ id, createdAt: Date.now(), text: out.ocr.text, confidence: out.ocr.confidence, image, thumb }, out);
}

// ---------------------------------------------------------------------------
// Result screen
// ---------------------------------------------------------------------------
let current: ScanRecord | null = null;
let currentOut: ScanOutput | null = null;
let showEnhanced = false;
const resultImg = $<HTMLImageElement>('#result-img');
const resultText = $<HTMLTextAreaElement>('#result-text');
let objectUrls: string[] = [];
function url(b: Blob) {
  const u = URL.createObjectURL(b);
  objectUrls.push(u);
  return u;
}
function revokeUrls() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

async function showResult(rec: ScanRecord, out: ScanOutput | null) {
  current = rec;
  currentOut = out;
  showEnhanced = false;
  revokeUrls();
  resultImg.src = url(rec.image);
  resultText.value = rec.text;
  const parts = [`신뢰도 ${Math.round(rec.confidence)}%`, new Date(rec.createdAt).toLocaleString('ko-KR')];
  if (out) {
    parts.push(`${out.pageFound ? '페이지 감지·평탄화됨' : '전체 이미지 사용'}`);
    parts.push(`OCR ${(out.timings.ocr / 1000).toFixed(1)}s`);
  }
  $('#result-meta').textContent = parts.join(' · ');
  $('#toggle-view').style.display = out ? '' : 'none';
  $('#toggle-view').textContent = '보정본 보기';
  updateLastThumb(rec.thumb);
  show('result');
  resultText.dispatchEvent(new Event('ready'));
}

function updateLastThumb(thumb: Blob) {
  const last = $('#last');
  last.innerHTML = '';
  const img = document.createElement('img');
  img.src = url(thumb);
  last.appendChild(img);
}

$('#toggle-view').addEventListener('click', async () => {
  if (!currentOut || !current) return;
  showEnhanced = !showEnhanced;
  if (showEnhanced) {
    const b = await imageDataToBlob(currentOut.enhanced, 'image/png');
    resultImg.src = url(b);
    $('#toggle-view').textContent = '원본 보기';
  } else {
    resultImg.src = url(current.image);
    $('#toggle-view').textContent = '보정본 보기';
  }
});

let saveTimer = 0;
resultText.addEventListener('input', () => {
  if (!current) return;
  current.text = resultText.value;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => current && updateScanText(current.id, current.text), 400);
});

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultText.value);
    toast('복사했습니다');
  } catch {
    resultText.select();
    document.execCommand('copy');
    toast('복사했습니다');
  }
});

$('#share').addEventListener('click', async () => {
  const text = resultText.value;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'V-Flat Scanner', text });
    } catch {
      /* cancelled */
    }
  } else {
    await navigator.clipboard.writeText(text);
    toast('공유를 지원하지 않아 복사했습니다');
  }
});

$('#save-img').addEventListener('click', async () => {
  if (!current) return;
  const file = new File([current.image], `vflat-${current.id}.jpg`, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'V-Flat Scanner' });
      return;
    } catch {
      /* fall through to download */
    }
  }
  const a = document.createElement('a');
  a.href = url(current.image);
  a.download = file.name;
  a.click();
});

$('#rescan').addEventListener('click', () => {
  show('scan');
  tracker?.reset();
});
$('#back-scan').addEventListener('click', () => show('scan'));
$('#delete-result').addEventListener('click', async () => {
  if (!current) return;
  if (!confirm('이 스캔을 삭제할까요?')) return;
  await deleteScan(current.id);
  current = null;
  toast('삭제했습니다');
  show('scan');
});

// ---------------------------------------------------------------------------
// History screen
// ---------------------------------------------------------------------------
async function renderHistory() {
  const list = $('#history-list');
  const scans = await listScans();
  list.innerHTML = '';
  if (!scans.length) {
    list.innerHTML = '<div class="empty">아직 스캔한 페이지가 없습니다.</div>';
    return;
  }
  for (const s of scans) {
    const card = document.createElement('button');
    card.className = 'card';
    const img = document.createElement('img');
    img.src = url(s.thumb);
    img.alt = '';
    const t = document.createElement('div');
    t.className = 't';
    const p = document.createElement('p');
    p.textContent = s.text.split('\n').find((l) => l.trim()) || '(텍스트 없음)';
    const small = document.createElement('small');
    small.textContent = `${new Date(s.createdAt).toLocaleString('ko-KR')} · ${s.text.length}자`;
    t.append(p, small);
    card.append(img, t);
    card.addEventListener('click', async () => {
      const rec = await getScan(s.id);
      if (rec) showResult(rec, null);
    });
    list.appendChild(card);
  }
}

$('#to-history').addEventListener('click', async () => {
  await renderHistory();
  show('history');
});
$('#back-history').addEventListener('click', () => show('scan'));
$('#last').addEventListener('click', async () => {
  const [latest] = await listScans();
  if (latest) showResult(latest, null);
  else toast('아직 결과가 없습니다');
});
$('#clear-all').addEventListener('click', async () => {
  if (!confirm('모든 스캔 기록을 삭제할까요?')) return;
  await clearScans();
  await renderHistory();
});
$('#export-all').addEventListener('click', async () => {
  const scans = await listScans();
  if (!scans.length) return toast('내보낼 기록이 없습니다');
  const text = scans
    .slice()
    .reverse()
    .map((s, i) => `===== ${i + 1} · ${new Date(s.createdAt).toLocaleString('ko-KR')} =====\n${s.text}`)
    .join('\n\n');
  const file = new File([text], 'vflat-scans.txt', { type: 'text/plain' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'V-Flat 스캔 텍스트' });
      return;
    } catch {
      /* fall through */
    }
  }
  const a = document.createElement('a');
  a.href = url(file);
  a.download = file.name;
  a.click();
});

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
startBtn.addEventListener('click', async () => {
  try {
    await camera.start();
    show('scan');
  } catch (e) {
    toast(`카메라를 열 수 없습니다: ${(e as Error).message}`);
  }
});

$('#shutter').addEventListener('click', () => capture(lastDetection));

// Tap-to-focus: forward the tapped point to the camera and show a ring.
const viewport = $('#scan .viewport');
viewport.addEventListener('pointerdown', (e) => {
  if (processing || !camera.running) return;
  const r = viewport.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  lastRefocus = performance.now();
  void camera.refocus(x, y);
  const ring = document.createElement('div');
  ring.className = 'focus-ring';
  ring.style.left = `${e.clientX - r.left}px`;
  ring.style.top = `${e.clientY - r.top}px`;
  viewport.appendChild(ring);
  setTimeout(() => ring.remove(), 900);
});

$('#auto').addEventListener('click', () => {
  autoCapture = !autoCapture;
  const b = $('#auto');
  b.classList.toggle('on', autoCapture);
  b.textContent = autoCapture ? '● 자동 촬영' : '○ 수동 촬영';
  tracker?.reset();
});

$('#torch').addEventListener('click', async () => {
  torchOn = !torchOn;
  const ok = await camera.toggleTorch(torchOn);
  if (!ok) {
    torchOn = false;
    toast('이 기기는 손전등 제어를 지원하지 않습니다');
  }
  $('#torch').classList.toggle('on', torchOn);
});

$<HTMLSelectElement>('#lang').addEventListener('change', async (e) => {
  const lang = (e.target as HTMLSelectElement).value as OcrLang;
  busy(true, '언어 데이터 전환 중…', 0.3);
  try {
    await preloadOcr(lang);
    toast('언어를 변경했습니다');
  } finally {
    busy(false);
  }
});

async function importFile(file: File | undefined) {
  if (!file || processing) return;
  processing = true;
  try {
    busy(true, '이미지 불러오는 중…', 0.05);
    const img = await fileToImageData(file);
    await runPipeline(img, null);
  } catch (e) {
    busy(false);
    toast(`실패: ${(e as Error).message}`);
    console.error(e);
  } finally {
    processing = false;
  }
}
for (const id of ['#file-setup', '#file-scan']) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    void importFile(input.files?.[0]);
    input.value = '';
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (document.getElementById('scan')!.classList.contains('active')) startLoop();
});
