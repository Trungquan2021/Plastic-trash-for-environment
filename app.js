const STORAGE_KEY = 'pte_github_v10';
const DB_NAME = 'pte_media_v10';
const DB_STORE = 'media';
const LEVELS = [
  {id:1, need:15, title:'Level 1 · 15 mảnh'},
  {id:2, need:35, title:'Level 2 · 35 mảnh'},
  {id:3, need:50, title:'Level 3 · 50 mảnh'}
];

const WASTE_OBJECTS = ['bottle','cup','wine glass','bowl','fork','knife','spoon','handbag','backpack'];
const NEAR_BIN_OBJECTS = ['bucket','barrel','potted plant','chair','bench','dining table'];
const BIN_TERMS = ['trash can','garbage can','dustbin','recycling bin','wastebasket','waste bin','ashcan','ash-bin','bin','bucket','barrel'];
const WASTE_TERMS = ['bottle','water bottle','plastic bottle','cup','mug','paper cup','wine bottle','beer bottle','soda bottle','can','tin can','carton','package','plastic bag','shopping bag','bag','box','food container','lunch box','tray','fork','knife','spoon','straw','napkin','paper towel'];
const CONTEXT_TERMS = ['street','park','campus','school','corridor','sidewalk','restaurant','cafeteria','office','room'];

const state = loadState();
let currentPage = 'home';
let currentMode = 'photo';
let detector = null;
let classifier = null;
let modelsReady = false;
let cameraStream = null;
let liveLoopTimer = null;
let lastCaptureCanvas = null;
let recordedBlob = null;
let recordingUrl = null;
let mediaRecorder = null;
let recordChunks = [];
let recordStartTime = 0;
let currentPuzzleLevel = 1;
let mediaDB = null;
const els = {};

document.addEventListener('DOMContentLoaded', init);

async function init(){
  cacheEls();
  bindEvents();
  await initMediaDB();
  renderAll();
  setTimeout(()=>{
    els.splashText.textContent = 'Đang tải model AI trên trình duyệt...';
    loadModels();
  }, 350);
  setTimeout(()=>{
    document.getElementById('splash').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  }, 1200);
}

function cacheEls(){
  ['splashText','topPuzzle','topVerified','statPuzzle','statPhoto','statVideo','statHistory','aiReadyBadge','aiReadyText','modeBadge','previewEmpty','liveVideo','photoPreview','videoPreview','drawLayer','liveChips','btnOpenCamera','btnCapture','btnStartRecord','btnStopRecord','btnDownloadCurrent','btnAnalyze','btnResetMedia','cameraNotice','resultStatus','resultMeta','resultScore','resultSummary','criteriaBox','detectedObjects','metricBox','puzzleBadge','puzzleSvg','puzzleProgressBar','puzzleText','historyBadge','historyList','toast','btnExportData','btnResetAll']
    .forEach(id=>els[id]=document.getElementById(id));
}

function bindEvents(){
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>switchPage(btn.dataset.go)));
  document.querySelectorAll('.mode-btn').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  document.querySelectorAll('.puzzle-tab').forEach(btn=>btn.addEventListener('click',()=>setPuzzleLevel(Number(btn.dataset.level))));
  els.btnOpenCamera.addEventListener('click', openCamera);
  els.btnCapture.addEventListener('click', capturePhoto);
  els.btnStartRecord.addEventListener('click', startRecording);
  els.btnStopRecord.addEventListener('click', stopRecording);
  els.btnDownloadCurrent.addEventListener('click', downloadCurrentVideo);
  els.btnAnalyze.addEventListener('click', analyzeCurrentMedia);
  els.btnResetMedia.addEventListener('click', resetMedia);
  els.btnExportData.addEventListener('click', exportData);
  els.btnResetAll.addEventListener('click', resetAllData);
  window.addEventListener('beforeunload', stopCamera);
}

async function initMediaDB(){
  mediaDB = await new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, {keyPath:'id'});
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(err=>{ console.warn('IndexedDB unavailable', err); return null; });
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      return {
        puzzle: Number(parsed.puzzle || 0),
        verifiedPhoto: Number(parsed.verifiedPhoto || 0),
        verifiedVideo: Number(parsed.verifiedVideo || 0),
        history: Array.isArray(parsed.history) ? parsed.history : [],
        hashes: Array.isArray(parsed.hashes) ? parsed.hashes : []
      };
    }
  }catch(err){ console.warn('state load', err); }
  return { puzzle:0, verifiedPhoto:0, verifiedVideo:0, history:[], hashes:[] };
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function loadModels(){
  try{
    updateAIStatus('Đang tải COCO-SSD...','Đang tải model nhận diện vật thể phổ biến...');
    detector = await cocoSsd.load({base:'mobilenet_v2'});
    updateAIStatus('Đang tải MobileNet...','Đang tải model phân loại khung cảnh và vật thể phụ...');
    classifier = await mobilenet.load({version:2, alpha:1});
    modelsReady = true;
    updateAIStatus('AI sẵn sàng','AI đã sẵn sàng: nhận diện vật thể phổ biến xung quanh, phân loại khung cảnh, chấm chất lượng và quét video nhiều khung hình.');
    toast('AI đã sẵn sàng để quét');
  }catch(err){
    console.error(err);
    updateAIStatus('AI tải lỗi','Không tải được model AI từ CDN. Ứng dụng vẫn mở được, nhưng tính năng quét sẽ chưa hoạt động cho tới khi có mạng.');
    toast('Không tải được model AI');
  }
}

function updateAIStatus(badge, text){
  els.aiReadyBadge.textContent = badge;
  els.aiReadyText.textContent = text;
}

function switchPage(page){
  currentPage = page;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn=>btn.classList.toggle('active', btn.dataset.go === page));
  if(page === 'history') renderHistory();
  if(page === 'puzzle') renderPuzzle();
}

function setMode(mode){
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn=>btn.classList.toggle('active', btn.dataset.mode === mode));
  els.modeBadge.textContent = 'Chế độ: ' + (mode === 'video' ? 'Quay video' : 'Chụp ảnh');
  els.btnStartRecord.classList.toggle('hidden', mode !== 'video');
  els.btnStopRecord.classList.toggle('hidden', mode !== 'video');
  els.btnDownloadCurrent.classList.toggle('hidden', mode !== 'video');
  els.btnCapture.classList.toggle('hidden', mode === 'video');
  resetMedia(false);
}

async function openCamera(){
  try{
    stopCamera();
    const constraints = {video:{facingMode:{ideal:'environment'}, width:{ideal:1280}, height:{ideal:720}}, audio:false};
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    els.liveVideo.srcObject = cameraStream;
    await els.liveVideo.play();
    showStage('live');
    els.btnCapture.disabled = false;
    els.btnStartRecord.disabled = false;
    if(modelsReady) startLiveLoop();
    toast('Camera đã sẵn sàng');
  }catch(err){
    console.error(err);
    toast('Không mở được camera');
    els.cameraNotice.textContent = 'Không mở được camera. Hãy cấp quyền camera và dùng HTTPS hoặc localhost.';
  }
}

function stopCamera(){
  if(liveLoopTimer){ clearInterval(liveLoopTimer); liveLoopTimer = null; }
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream = null; }
  els.liveVideo.srcObject = null;
}

function showStage(type){
  els.previewEmpty.classList.add('hidden');
  els.liveVideo.classList.add('hidden');
  els.photoPreview.classList.add('hidden');
  els.videoPreview.classList.add('hidden');
  els.drawLayer.classList.add('hidden');
  if(type === 'live'){ els.liveVideo.classList.remove('hidden'); els.drawLayer.classList.remove('hidden'); }
  if(type === 'photo'){ els.photoPreview.classList.remove('hidden'); els.drawLayer.classList.remove('hidden'); }
  if(type === 'video'){ els.videoPreview.classList.remove('hidden'); }
  if(type === 'empty'){ els.previewEmpty.classList.remove('hidden'); }
}

function capturePhoto(){
  if(!cameraStream){ toast('Hãy mở camera trước'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = els.liveVideo.videoWidth || 1280;
  canvas.height = els.liveVideo.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(els.liveVideo, 0, 0, canvas.width, canvas.height);
  lastCaptureCanvas = canvas;
  const url = canvas.toDataURL('image/jpeg', 0.92);
  els.photoPreview.src = url;
  showStage('photo');
  els.btnAnalyze.disabled = false;
  drawOverlay([], canvas.width, canvas.height);
  toast('Đã chụp ảnh');
}

async function startRecording(){
  if(!cameraStream) await openCamera();
  if(!cameraStream) return;
  try{
    recordChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
    mediaRecorder = new MediaRecorder(cameraStream, {mimeType});
    mediaRecorder.ondataavailable = e => { if(e.data && e.data.size) recordChunks.push(e.data); };
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start(250);
    recordStartTime = Date.now();
    els.btnStopRecord.disabled = false;
    els.btnStartRecord.disabled = true;
    els.btnAnalyze.disabled = true;
    els.btnDownloadCurrent.disabled = true;
    toast('Đang quay video...');
  }catch(err){
    console.error(err);
    toast('Không bắt đầu quay được');
  }
}

function stopRecording(){
  if(mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function handleRecordingStop(){
  const duration = (Date.now() - recordStartTime) / 1000;
  recordedBlob = new Blob(recordChunks, {type: recordChunks[0]?.type || 'video/webm'});
  if(recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(recordedBlob);
  els.videoPreview.src = recordingUrl;
  els.videoPreview.currentTime = 0;
  showStage('video');
  els.btnAnalyze.disabled = false;
  els.btnStopRecord.disabled = true;
  els.btnStartRecord.disabled = false;
  els.btnDownloadCurrent.disabled = false;
  toast('Đã quay xong ' + duration.toFixed(1) + ' giây');
}

function downloadCurrentVideo(){
  if(!recordedBlob || !recordingUrl){ toast('Chưa có video để tải'); return; }
  downloadBlob(recordedBlob, 'plastic-trash-video-' + formatTimestampForFile(Date.now()) + '.webm');
}

function resetMedia(resetResult = true){
  if(recordingUrl){ URL.revokeObjectURL(recordingUrl); recordingUrl = null; }
  recordedBlob = null;
  lastCaptureCanvas = null;
  els.photoPreview.src = '';
  els.videoPreview.src = '';
  els.btnAnalyze.disabled = true;
  els.btnDownloadCurrent.disabled = true;
  drawOverlay([], 1, 1);
  els.liveChips.innerHTML = '';
  showStage(cameraStream ? 'live' : 'empty');
  if(resetResult) resetResultBox();
}

function resetResultBox(){
  els.resultStatus.textContent = 'Chưa quét';
  els.resultMeta.textContent = 'Chụp ảnh hoặc quay video rồi bấm “Quét & chấm điểm”.';
  els.resultScore.textContent = 'Điểm 0/100';
  els.resultSummary.textContent = 'Kết quả sẽ cho biết có thấy thùng rác rõ hay không, có vật thể phù hợp hay không, chất lượng khung hình, chuyển động video và mức độ trùng lặp media.';
  els.criteriaBox.innerHTML = '';
  els.detectedObjects.innerHTML = '';
  els.metricBox.innerHTML = '';
}

function startLiveLoop(){
  if(liveLoopTimer) clearInterval(liveLoopTimer);
  liveLoopTimer = setInterval(async ()=>{
    if(!modelsReady || !cameraStream || els.liveVideo.readyState < 2) return;
    try{
      const temp = makeCanvasFromSource(els.liveVideo, 640);
      const preds = await detector.detect(temp.canvas, 12);
      const classes = await classifier.classify(temp.canvas, 4);
      renderLiveChips(preds, classes);
      drawOverlay(preds, temp.canvas.width, temp.canvas.height);
    }catch(err){
      console.warn('live detect', err);
    }
  }, 1800);
}

function renderLiveChips(preds, classes=[]){
  const labels = [];
  preds.slice(0,5).forEach(p=>labels.push(`${mapLabel(p.class)} ${Math.round((p.score || 0) * 100)}%`));
  classes.slice(0,3).forEach(c=>labels.push(`${compactClass(c.className)} ${Math.round((c.probability || 0) * 100)}%`));
  const uniq = [...new Set(labels)].slice(0,8);
  els.liveChips.innerHTML = uniq.length ? uniq.map(t=>`<div class="live-chip">${escapeHtml(t)}</div>`).join('') : '<div class="live-chip">Chưa thấy vật thể nổi bật</div>';
}

function drawOverlay(preds, srcW, srcH){
  const stage = document.getElementById('previewStage');
  const canvas = els.drawLayer;
  const rect = stage.getBoundingClientRect();
  canvas.width = Math.max(1, rect.width * devicePixelRatio);
  canvas.height = Math.max(1, rect.height * devicePixelRatio);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if(!preds || !preds.length || !srcW || !srcH) return;
  const stageRatio = rect.width / rect.height;
  const srcRatio = srcW / srcH;
  let drawW, drawH, offsetX, offsetY;
  if(srcRatio > stageRatio){ drawH = rect.height; drawW = drawH * srcRatio; offsetX = (rect.width - drawW) / 2; offsetY = 0; }
  else{ drawW = rect.width; drawH = drawW / srcRatio; offsetX = 0; offsetY = (rect.height - drawH) / 2; }
  preds.slice(0,8).forEach(pred=>{
    const [x, y, w, h] = pred.bbox;
    const bx = offsetX + (x / srcW) * drawW;
    const by = offsetY + (y / srcH) * drawH;
    const bw = (w / srcW) * drawW;
    const bh = (h / srcH) * drawH;
    ctx.strokeStyle = 'rgba(34,197,94,.95)';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);
    const label = `${mapLabel(pred.class)} ${Math.round(pred.score * 100)}%`;
    ctx.font = '700 13px Quicksand';
    const tw = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(16,34,21,.88)';
    ctx.fillRect(bx, Math.max(0, by - 28), tw, 24);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, bx + 8, Math.max(15, by - 11));
  });
}

async function analyzeCurrentMedia(){
  if(!modelsReady){ toast('AI chưa sẵn sàng'); return; }
  els.btnAnalyze.disabled = true;
  try{
    let result;
    if(currentMode === 'video'){
      if(!recordedBlob) throw new Error('Chưa có video');
      result = await analyzeVideo(recordedBlob);
    }else if(lastCaptureCanvas){
      result = await analyzeImage(lastCaptureCanvas, 'camera-photo');
    }else if(cameraStream && !els.liveVideo.classList.contains('hidden')){
      const temp = makeCanvasFromSource(els.liveVideo, 960).canvas;
      result = await analyzeImage(temp, 'live-frame');
    }else{
      throw new Error('Chưa có ảnh hoặc video để quét');
    }
    renderResult(result);
    if(result.accepted){
      await awardPuzzle(result);
      toast('Được duyệt +1 mảnh ghép');
    }else{
      toast('Chưa đạt, thử lại nhé');
    }
    await addHistory(result);
    renderAll();
  }catch(err){
    console.error(err);
    toast(err.message || 'Không thể quét media');
  }finally{
    els.btnAnalyze.disabled = false;
  }
}

async function analyzeImage(source, sourceType){
  const prepared = makeCanvasFromSource(source, 960);
  const canvas = prepared.canvas;
  const quality = measureQuality(canvas);
  const detectionRuns = await detectMultiPass(canvas);
  const preds = mergePredictions(detectionRuns.flat());
  const classes = await classifier.classify(canvas, 8);
  const fp = await fingerprintCanvas(canvas);
  const duplicate = state.hashes.includes(fp);
  const evalResult = evaluateMedia({kind:'image', sourceType, canvas, preds, classes, quality, duplicate, fingerprint:fp});
  evalResult.preview = canvas.toDataURL('image/jpeg', 0.82);
  drawOverlay(preds, canvas.width, canvas.height);
  return evalResult;
}

async function analyzeVideo(blob){
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  const url = URL.createObjectURL(blob);
  video.src = url;
  await once(video, 'loadedmetadata');
  const duration = Math.max(video.duration || 0, 2.0);
  const sampleTimes = sampleVideoTimes(duration);
  const frames = [];
  let prevFrame = null;
  const motionValues = [];
  for(const t of sampleTimes){
    await seekVideo(video, t);
    const capture = makeCanvasFromSource(video, 800);
    frames.push(capture.canvas);
    if(prevFrame) motionValues.push(compareFrames(prevFrame, capture.canvas));
    prevFrame = capture.canvas;
  }
  const frameResults = [];
  for(const frame of frames){
    const predRuns = await detectMultiPass(frame);
    const preds = mergePredictions(predRuns.flat());
    const classes = await classifier.classify(frame, 5);
    frameResults.push({preds, classes, quality:measureQuality(frame)});
  }
  const comboFp = await fingerprintFrames(frames);
  const duplicate = state.hashes.includes(comboFp);
  URL.revokeObjectURL(url);
  const result = evaluateVideo({frames, frameResults, motionValues, duration, duplicate, fingerprint:comboFp});
  result.preview = frames[0].toDataURL('image/jpeg', 0.82);
  result.videoBlob = blob;
  return result;
}

async function detectMultiPass(canvas){
  const runs = [];
  runs.push(await detector.detect(canvas, 15));
  const crop1 = cropCanvas(canvas, 0.12);
  runs.push(await detector.detect(crop1, 12));
  const crop2 = cropCanvas(canvas, 0.2);
  runs.push(await detector.detect(crop2, 10));
  return runs;
}

function cropCanvas(canvas, insetRatio){
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const insetX = Math.round(canvas.width * insetRatio);
  const insetY = Math.round(canvas.height * insetRatio);
  c.getContext('2d').drawImage(canvas, insetX, insetY, canvas.width - insetX * 2, canvas.height - insetY * 2, 0, 0, c.width, c.height);
  return c;
}

function mergePredictions(preds){
  const byClass = new Map();
  preds.forEach(p=>{
    const current = byClass.get(p.class);
    if(!current || (p.score || 0) > (current.score || 0)) byClass.set(p.class, p);
  });
  return [...byClass.values()].sort((a,b)=>(b.score||0)-(a.score||0));
}

function evaluateMedia({kind, sourceType, canvas, preds, classes, quality, duplicate, fingerprint}){
  const waste = pickWaste(preds, classes);
  const bin = pickBin(classes, preds);
  const context = pickContext(preds, classes);
  const brightnessScore = clamp(Math.round(mapRange(quality.brightness, 35, 190, 0, 16)), 0, 16);
  const sharpnessScore = clamp(Math.round(mapRange(quality.edge, 6, 22, 0, 12)), 0, 12);
  const wasteScore = waste.score;
  const binScore = bin.score;
  const contextScore = context.score;
  const duplicatePenalty = duplicate ? 30 : 0;
  const total = clamp(brightnessScore + sharpnessScore + wasteScore + binScore + contextScore - duplicatePenalty, 0, 100);
  const accepted = !duplicate && bin.pass && waste.pass && quality.pass && total >= 60;
  return {
    kind, sourceType, accepted, total, fingerprint, duplicate, preview:'', preds, classes, quality, waste, bin, context,
    motion:{pass:true, value:0, label:'Ảnh tĩnh'},
    summary: buildSummary({accepted, duplicate, waste, bin, quality, total, modeLabel:'ảnh'})
  };
}

function evaluateVideo({frames, frameResults, motionValues, duration, duplicate, fingerprint}){
  const aggregatePreds = mergePredictions(frameResults.flatMap(fr=>fr.preds));
  const aggregateClasses = mergeClassifications(frameResults.flatMap(fr=>fr.classes));
  let wasteHits = 0, binHits = 0, contextHits = 0;
  let wasteTop = {pass:false, score:0, labels:[]};
  let binTop = {pass:false, score:0, labels:[]};
  let contextTop = {pass:false, score:0, labels:[]};
  const qualityAvg = {brightness:0, edge:0};
  frameResults.forEach(fr=>{
    const waste = pickWaste(fr.preds, fr.classes);
    const bin = pickBin(fr.classes, fr.preds);
    const context = pickContext(fr.preds, fr.classes);
    if(waste.pass) wasteHits += 1;
    if(bin.pass) binHits += 1;
    if(context.pass) contextHits += 1;
    if(waste.score > wasteTop.score) wasteTop = waste;
    if(bin.score > binTop.score) binTop = bin;
    if(context.score > contextTop.score) contextTop = context;
    qualityAvg.brightness += fr.quality.brightness;
    qualityAvg.edge += fr.quality.edge;
  });
  qualityAvg.brightness /= frameResults.length;
  qualityAvg.edge /= frameResults.length;
  qualityAvg.pass = qualityAvg.brightness >= 35 && qualityAvg.brightness <= 210 && qualityAvg.edge >= 6;
  const motionValue = motionValues.length ? average(motionValues) : 0;
  const motionPass = motionValue >= 10;
  const motionScore = clamp(Math.round(mapRange(motionValue, 6, 24, 0, 18)), 0, 18);
  const brightnessScore = clamp(Math.round(mapRange(qualityAvg.brightness, 35, 190, 0, 14)), 0, 14);
  const sharpnessScore = clamp(Math.round(mapRange(qualityAvg.edge, 6, 20, 0, 10)), 0, 10);
  const wasteScore = clamp(wasteTop.score + wasteHits * 4, 0, 30);
  const binScore = clamp(binTop.score + binHits * 5, 0, 26);
  const contextScore = clamp(contextTop.score + contextHits * 2, 0, 12);
  const duplicatePenalty = duplicate ? 30 : 0;
  const total = clamp(brightnessScore + sharpnessScore + wasteScore + binScore + contextScore + motionScore - duplicatePenalty, 0, 100);
  const accepted = !duplicate && motionPass && wasteHits >= 2 && binHits >= 1 && total >= 62;
  return {
    kind:'video', sourceType:'video', accepted, total, fingerprint, duplicate, preview:'', preds:aggregatePreds, classes:aggregateClasses,
    quality:qualityAvg, waste:{...wasteTop, hitCount:wasteHits}, bin:{...binTop, hitCount:binHits}, context:{...contextTop, hitCount:contextHits},
    motion:{pass:motionPass, value:motionValue, label: motionPass ? 'Có chuyển động thật' : 'Chuyển động quá ít'}, duration,
    summary: buildSummary({accepted, duplicate, waste:{...wasteTop, hitCount:wasteHits}, bin:{...binTop, hitCount:binHits}, quality:qualityAvg, total, motionPass, modeLabel:'video'})
  };
}

function buildSummary({accepted, duplicate, waste, bin, quality, total, motionPass = true, modeLabel}){
  if(duplicate) return `AI từ chối ${modeLabel} này vì dấu vân tay media trùng với nội dung đã từng được duyệt trước đó trên thiết bị hiện tại.`;
  if(!bin.pass) return `AI chưa tự tin rằng ${modeLabel} này có thùng rác hoặc khu vực bỏ rác nhìn rõ. Hãy đưa camera gần hơn và giữ thùng rác nổi bật hơn trong khung hình.`;
  if(!waste.pass) return `AI chưa thấy đủ rõ vật thể phù hợp như chai, ly, cốc, hộp hoặc đồ dùng bỏ đi. Hãy để vật thể xuất hiện rõ hơn.`;
  if(!quality.pass) return `AI đánh giá ${modeLabel} này còn hơi tối hoặc hơi mờ. Hãy tăng sáng, đứng vững hơn hoặc đổi góc chụp.`;
  if(!motionPass) return `Video chưa có đủ chuyển động thật để tăng độ tin cậy. Hãy quay một đoạn có thay đổi góc hoặc hành động rõ hơn.`;
  if(accepted) return `AI chấp nhận ${modeLabel} này vì đã thấy rõ thùng rác/khu vực bỏ rác, có vật thể phù hợp và chất lượng hình ảnh đạt yêu cầu. Bạn được cộng 1 mảnh ghép.`;
  return `AI ghi nhận một phần nội dung nhưng tổng điểm ${total}/100 chưa đủ cao. Hãy chụp hoặc quay gần hơn và giữ khung hình rõ hơn.`;
}

function pickWaste(preds, classes){
  const predMatched = preds.filter(p => WASTE_OBJECTS.includes(p.class));
  const classMatched = classes.filter(c => termMatch(c.className, WASTE_TERMS));
  const labels = predMatched.map(p => `${mapLabel(p.class)} ${Math.round((p.score || 0) * 100)}%`)
    .concat(classMatched.map(c => `${compactClass(c.className)} ${Math.round((c.probability || 0) * 100)}%`));
  let score = 0;
  if(predMatched.length) score += clamp(Math.round(predMatched[0].score * 24) + predMatched.length * 4, 0, 28);
  if(classMatched.length) score += clamp(Math.round((classMatched[0].probability || 0) * 14) + classMatched.length * 2, 0, 16);
  return {pass: predMatched.length > 0 || classMatched.length >= 1 || score >= 16, score: clamp(score, 0, 32), labels: unique(labels)};
}

function pickBin(classes, preds){
  const classMatched = classes.filter(c => termMatch(c.className, BIN_TERMS));
  const predMatched = preds.filter(p => NEAR_BIN_OBJECTS.includes(p.class));
  const labels = classMatched.map(c => `${compactClass(c.className)} ${Math.round((c.probability || 0) * 100)}%`)
    .concat(predMatched.map(p => `${mapLabel(p.class)} ${Math.round((p.score || 0) * 100)}%`));
  let score = 0;
  if(classMatched.length) score += clamp(Math.round((classMatched[0].probability || 0) * 22) + classMatched.length * 4, 0, 26);
  if(predMatched.length) score += clamp(Math.round((predMatched[0].score || 0) * 6), 0, 8);
  return {pass: classMatched.length > 0 || score >= 18, score: clamp(score, 0, 28), labels: unique(labels)};
}

function pickContext(preds, classes){
  const person = preds.find(p=>p.class === 'person');
  const contextTerms = classes.filter(c=>termMatch(c.className, CONTEXT_TERMS));
  const labels = [];
  let score = 0;
  if(person){ labels.push(`Người ${Math.round((person.score || 0) * 100)}%`); score += clamp(Math.round(person.score * 8), 0, 8); }
  if(contextTerms.length){ labels.push(...contextTerms.slice(0,2).map(c=>`${compactClass(c.className)} ${Math.round((c.probability || 0) * 100)}%`)); score += clamp(Math.round((contextTerms[0].probability || 0) * 8), 0, 8); }
  return {pass: score >= 5, score: clamp(score, 0, 12), labels: unique(labels)};
}

function renderResult(result){
  const title = result.accepted ? '✅ Đạt yêu cầu' : '⚠️ Chưa đạt';
  const meta = result.kind === 'video' ? `Video • ${result.duration.toFixed(1)} giây` : 'Ảnh camera';
  els.resultStatus.textContent = title;
  els.resultMeta.textContent = meta;
  els.resultScore.textContent = `Điểm ${result.total}/100`;
  els.resultSummary.textContent = result.summary;
  const crits = [
    {title:'Thùng rác / khu vực bỏ rác', pass:result.bin.pass, labels:result.bin.labels},
    {title:'Vật thể phù hợp', pass:result.waste.pass, labels:result.waste.labels},
    {title:'Chất lượng khung hình', pass:result.quality.pass, labels:[`Độ sáng ${result.quality.brightness.toFixed(1)}`, `Độ nét ${result.quality.edge.toFixed(1)}`]},
    {title:'Chuyển động', pass:result.motion.pass, labels:[result.motion.label]}
  ];
  els.criteriaBox.innerHTML = crits.map(c=>`
    <div class="criterion">
      <div>
        <b class="${c.pass ? 'ok' : 'bad'}">${c.pass ? '●' : '●'} ${escapeHtml(c.title)}</b>
        <small>${escapeHtml((c.labels || []).slice(0,3).join(' • ') || 'Chưa có bằng chứng đủ mạnh')}</small>
      </div>
      <div class="${c.pass ? 'ok' : 'bad'}">${c.pass ? 'Đạt' : 'Chưa đạt'}</div>
    </div>`).join('');
  const labels = unique([
    ...result.preds.slice(0,8).map(p=>`${mapLabel(p.class)} ${Math.round((p.score || 0) * 100)}%`),
    ...result.classes.slice(0,6).map(c=>`${compactClass(c.className)} ${Math.round((c.probability || 0) * 100)}%`)
  ]).slice(0,14);
  els.detectedObjects.innerHTML = labels.map(t=>`<div class="object-pill">${escapeHtml(t)}</div>`).join('');
  const metrics = [
    {name:'Thùng rác', value:Math.min(100, result.bin.score * 4)},
    {name:'Vật thể', value:Math.min(100, result.waste.score * 4)},
    {name:'Chất lượng', value:Math.min(100, Math.round(result.quality.edge * 4 + result.quality.brightness / 3))},
    {name:'Tổng điểm', value:result.total}
  ];
  els.metricBox.innerHTML = metrics.map(m=>`
    <div class="metric">
      <div class="metric-top"><span>${escapeHtml(m.name)}</span><span>${m.value}/100</span></div>
      <div class="metric-bar"><span style="width:${m.value}%"></span></div>
    </div>`).join('');
}

async function awardPuzzle(result){
  state.puzzle += 1;
  if(result.kind === 'video') state.verifiedVideo += 1; else state.verifiedPhoto += 1;
  if(!state.hashes.includes(result.fingerprint)) state.hashes.push(result.fingerprint);
  saveState();
}

async function addHistory(result){
  const id = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  let mediaKey = null;
  if(result.kind === 'video' && result.videoBlob && mediaDB){
    mediaKey = 'm_' + id;
    await putMediaBlob(mediaKey, result.videoBlob, 'video/webm');
  }
  const entry = {
    id,
    kind: result.kind,
    accepted: result.accepted,
    total: result.total,
    summary: result.summary,
    time: new Date().toISOString(),
    preview: result.preview,
    labels: unique([...result.bin.labels, ...result.waste.labels, ...result.context.labels]).slice(0,5),
    mediaKey
  };
  state.history.unshift(entry);
  if(state.history.length > 60){
    const removed = state.history.pop();
    if(removed && removed.mediaKey) await deleteMediaBlob(removed.mediaKey);
  }
  saveState();
}

function renderAll(){
  const verified = state.verifiedPhoto + state.verifiedVideo;
  els.topPuzzle.textContent = state.puzzle;
  els.topVerified.textContent = verified;
  els.statPuzzle.textContent = state.puzzle;
  els.statPhoto.textContent = state.verifiedPhoto;
  els.statVideo.textContent = state.verifiedVideo;
  els.statHistory.textContent = state.history.length;
  renderPuzzle();
  renderHistory();
}

function setPuzzleLevel(level){
  currentPuzzleLevel = level;
  document.querySelectorAll('.puzzle-tab').forEach(btn=>btn.classList.toggle('active', Number(btn.dataset.level) === level));
  renderPuzzle();
}

function renderPuzzle(){
  const cfg = LEVELS.find(l=>l.id === currentPuzzleLevel) || LEVELS[0];
  const fillCount = Math.min(state.puzzle, cfg.need);
  const pct = Math.round((fillCount / cfg.need) * 100);
  els.puzzleBadge.textContent = `${fillCount} / ${cfg.need} mảnh`;
  els.puzzleText.textContent = `${fillCount} / ${cfg.need} mảnh`;
  els.puzzleProgressBar.style.width = pct + '%';
  els.puzzleSvg.innerHTML = buildPuzzleSvg(fillCount, cfg.need);
}

function buildPuzzleSvg(fillCount, total){
  const cols = 5, rows = 5;
  const pieces = cols * rows;
  const shown = Math.round((fillCount / total) * pieces);
  const scene = [
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8fd3ff"/><stop offset="100%" stop-color="#d9f7ff"/></linearGradient><linearGradient id="hill" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#7ed957"/><stop offset="100%" stop-color="#39b54a"/></linearGradient><linearGradient id="road" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d3d7dc"/><stop offset="100%" stop-color="#a3aab4"/></linearGradient></defs>',
    '<rect width="600" height="600" fill="url(#sky)"/>',
    '<circle cx="500" cy="110" r="48" fill="#ffd84d" opacity=".95"/>',
    '<path d="M0 360 C120 290, 180 320, 280 360 S470 430, 600 350 L600 600 L0 600 Z" fill="url(#hill)"/>',
    '<path d="M160 600 L265 380 L365 380 L470 600 Z" fill="#9fd97e" opacity=".95"/>',
    '<rect x="0" y="470" width="600" height="130" fill="#78c257"/>',
    '<path d="M100 600 C170 505, 220 490, 300 600 Z" fill="url(#road)" opacity=".95"/>',
    '<g><rect x="430" y="300" width="74" height="110" rx="16" fill="#3f4a59"/><rect x="442" y="318" width="50" height="66" rx="10" fill="#6ee7b7"/><rect x="448" y="286" width="38" height="18" rx="7" fill="#2d3748"/></g>',
    '<g><rect x="88" y="250" width="18" height="120" fill="#6b4f3a"/><circle cx="97" cy="230" r="42" fill="#3bb45e"/><circle cx="125" cy="252" r="26" fill="#43c76a"/></g>',
    '<g><rect x="516" y="250" width="14" height="88" fill="#6b4f3a"/><circle cx="523" cy="232" r="34" fill="#33aa56"/></g>',
    '<g><rect x="320" y="245" width="80" height="70" rx="10" fill="#ffffff"/><polygon points="360,205 308,245 412,245" fill="#f87171"/><rect x="340" y="270" width="18" height="45" fill="#9ca3af"/><rect x="366" y="270" width="18" height="28" fill="#93c5fd"/></g>'
  ].join('');
  let cover = '';
  let i = 0;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const x = c * 120;
      const y = r * 120;
      const filled = i < shown;
      cover += `<rect x="${x}" y="${y}" width="120" height="120" fill="${filled ? 'transparent' : '#d6ded9'}" opacity="${filled ? 0 : .92}" stroke="#ffffff" stroke-width="3"/>`;
      i++;
    }
  }
  return scene + cover;
}

async function renderHistory(){
  els.historyBadge.textContent = `${state.history.length} lượt`;
  if(!state.history.length){
    els.historyList.innerHTML = '<div class="card"><div class="small">Chưa có lượt quét nào. Hãy mở camera và bắt đầu.</div></div>';
    return;
  }
  const items = await Promise.all(state.history.map(async entry=>{
    const mediaButton = entry.kind === 'video' && entry.mediaKey ? `<button class="mini-btn" data-download="${entry.mediaKey}">⬇️ Tải video</button>` : '';
    return `<div class="history-item">
      <div class="history-thumb">${entry.preview ? `<img src="${entry.preview}" alt="preview">` : (entry.kind === 'video' ? '🎥' : '📷')}</div>
      <div>
        <div class="history-title">${entry.accepted ? '✅ Đã duyệt' : '⚠️ Chưa duyệt'} · ${entry.kind === 'video' ? 'Video' : 'Ảnh'}</div>
        <div class="history-meta">${formatTime(entry.time)} • Điểm ${entry.total}/100</div>
        <div class="history-desc">${escapeHtml(entry.summary)}</div>
        <div class="objects">${(entry.labels || []).map(l=>`<div class="object-pill">${escapeHtml(l)}</div>`).join('')}</div>
        <div class="history-actions">${mediaButton}<button class="mini-btn danger" data-remove="${entry.id}">🗑️ Xóa</button></div>
      </div>
    </div>`;
  }));
  els.historyList.innerHTML = items.join('');
  els.historyList.querySelectorAll('[data-download]').forEach(btn=>btn.addEventListener('click', async ()=>{
    const key = btn.dataset.download;
    const blob = await getMediaBlob(key);
    if(!blob){ toast('Không tìm thấy video đã lưu'); return; }
    downloadBlob(blob, 'plastic-trash-history-' + key + '.webm');
  }));
  els.historyList.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click', ()=>removeHistory(btn.dataset.remove)));
}

async function removeHistory(id){
  const idx = state.history.findIndex(x=>x.id === id);
  if(idx < 0) return;
  const entry = state.history[idx];
  if(entry.mediaKey) await deleteMediaBlob(entry.mediaKey);
  state.history.splice(idx, 1);
  saveState();
  renderAll();
  toast('Đã xóa lượt này');
}

function exportData(){
  const payload = JSON.stringify({
    exportedAt: new Date().toISOString(),
    state
  }, null, 2);
  downloadBlob(new Blob([payload], {type:'application/json'}), 'plastic-trash-data-' + formatTimestampForFile(Date.now()) + '.json');
}

async function resetAllData(){
  const ok = confirm('Xóa toàn bộ puzzle, lịch sử, video đã lưu và dấu vân tay media?');
  if(!ok) return;
  stopCamera();
  resetMedia(true);
  state.puzzle = 0;
  state.verifiedPhoto = 0;
  state.verifiedVideo = 0;
  state.history = [];
  state.hashes = [];
  saveState();
  await clearMediaDB();
  renderAll();
  toast('Đã reset toàn bộ');
}

async function putMediaBlob(id, blob, mime){
  if(!mediaDB) return;
  await new Promise((resolve,reject)=>{
    const tx = mediaDB.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({id, blob, mime, time:Date.now()});
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }).catch(err=>console.warn('put blob', err));
}

async function getMediaBlob(id){
  if(!mediaDB) return null;
  return new Promise((resolve,reject)=>{
    const tx = mediaDB.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(id);
    req.onsuccess = ()=>resolve(req.result ? req.result.blob : null);
    req.onerror = ()=>reject(req.error);
  }).catch(err=>{ console.warn('get blob', err); return null; });
}

async function deleteMediaBlob(id){
  if(!mediaDB) return;
  await new Promise((resolve,reject)=>{
    const tx = mediaDB.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }).catch(err=>console.warn('delete blob', err));
}

async function clearMediaDB(){
  if(!mediaDB) return;
  await new Promise((resolve,reject)=>{
    const tx = mediaDB.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  }).catch(err=>console.warn('clear db', err));
}

function makeCanvasFromSource(source, maxSide){
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const scale = maxSide ? Math.min(1, maxSide / Math.max(width, height)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return {canvas};
}

function measureQuality(canvas){
  const small = document.createElement('canvas');
  const maxSide = 180;
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  const sctx = small.getContext('2d', {willReadFrequently:true});
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  const data = sctx.getImageData(0, 0, small.width, small.height).data;
  let sum = 0;
  let edge = 0;
  const w = small.width;
  const h = small.height;
  const gray = new Uint8ClampedArray(w * h);
  for(let i=0, p=0; i<data.length; i+=4, p++){
    const g = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
    gray[p] = g;
    sum += g;
  }
  const brightness = sum / gray.length;
  for(let y=1; y<h-1; y++){
    for(let x=1; x<w-1; x++){
      const idx = y*w + x;
      const gx = -gray[idx-w-1] - 2*gray[idx-1] - gray[idx+w-1] + gray[idx-w+1] + 2*gray[idx+1] + gray[idx+w+1];
      const gy = -gray[idx-w-1] - 2*gray[idx-w] - gray[idx-w+1] + gray[idx+w-1] + 2*gray[idx+w] + gray[idx+w+1];
      edge += Math.sqrt(gx*gx + gy*gy);
    }
  }
  edge /= Math.max(1, (w-2)*(h-2));
  return {brightness, edge, pass: brightness >= 35 && brightness <= 210 && edge >= 6};
}

function compareFrames(a, b){
  const w = 96, h = 54;
  const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
  const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
  const ax = ca.getContext('2d', {willReadFrequently:true});
  const bx = cb.getContext('2d', {willReadFrequently:true});
  ax.drawImage(a, 0, 0, w, h); bx.drawImage(b, 0, 0, w, h);
  const da = ax.getImageData(0, 0, w, h).data;
  const db = bx.getImageData(0, 0, w, h).data;
  let diff = 0;
  for(let i=0;i<da.length;i+=4){
    diff += Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2]);
  }
  return diff / (w*h*3);
}

async function fingerprintCanvas(canvas){
  const data = canvas.toDataURL('image/jpeg', 0.55);
  const encoded = new TextEncoder().encode(data.slice(0, 8000));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function fingerprintFrames(frames){
  const sample = frames.slice(0, 4).map(f=>f.toDataURL('image/jpeg', 0.4).slice(0, 2500)).join('|');
  const encoded = new TextEncoder().encode(sample);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].slice(0,16).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function sampleVideoTimes(duration){
  const count = duration < 3 ? 5 : duration < 6 ? 7 : 9;
  const times = [];
  for(let i=0;i<count;i++){
    const t = Math.min(duration - 0.1, 0.2 + (duration - 0.4) * (i / Math.max(1, count - 1)));
    times.push(Math.max(0, t));
  }
  return times;
}

function seekVideo(video, time){
  return new Promise((resolve,reject)=>{
    const onSeek = ()=>{ cleanup(); resolve(); };
    const onError = ()=>{ cleanup(); reject(video.error || new Error('seek error')); };
    const cleanup = ()=>{ video.removeEventListener('seeked', onSeek); video.removeEventListener('error', onError); };
    video.addEventListener('seeked', onSeek, {once:true});
    video.addEventListener('error', onError, {once:true});
    try{ video.currentTime = time; }catch(err){ cleanup(); reject(err); }
  });
}

function once(el, event){
  return new Promise((resolve,reject)=>{
    const onEvent = ()=>{ cleanup(); resolve(); };
    const onError = ()=>{ cleanup(); reject(el.error || new Error(event + ' failed')); };
    const cleanup = ()=>{ el.removeEventListener(event, onEvent); el.removeEventListener('error', onError); };
    el.addEventListener(event, onEvent, {once:true});
    el.addEventListener('error', onError, {once:true});
  });
}

function termMatch(text, terms){
  const low = String(text || '').toLowerCase();
  return terms.some(term => low.includes(term));
}

function mergeClassifications(items){
  const map = new Map();
  items.forEach(item=>{
    const key = compactClass(item.className);
    const prev = map.get(key);
    if(!prev || item.probability > prev.probability) map.set(key, item);
  });
  return [...map.values()].sort((a,b)=>(b.probability||0)-(a.probability||0));
}

function compactClass(name){
  return String(name || '').split(',')[0].trim();
}

function mapLabel(label){
  const map = {
    'person':'Người','bottle':'Chai','cup':'Cốc','wine glass':'Ly','bowl':'Bát','fork':'Nĩa','knife':'Dao','spoon':'Muỗng','handbag':'Túi xách','backpack':'Ba lô',
    'chair':'Ghế','bench':'Ghế dài','dining table':'Bàn','cell phone':'Điện thoại','book':'Sách','barrel':'Thùng tròn','bucket':'Xô','potted plant':'Chậu cây'
  };
  return map[label] || label;
}

function unique(arr){
  return [...new Set((arr || []).filter(Boolean))];
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function average(arr){ return arr.reduce((a,b)=>a+b,0) / Math.max(1, arr.length); }
function mapRange(value, inMin, inMax, outMin, outMax){
  if(inMax === inMin) return outMin;
  const t = (value - inMin) / (inMax - inMin);
  return outMin + clamp(t, 0, 1) * (outMax - outMin);
}
function formatTime(iso){ return new Date(iso).toLocaleString('vi-VN'); }
function formatTimestampForFile(t){
  const d = new Date(t);
  const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function escapeHtml(str){ return String(str).replace(/[&<>'"]/g, s=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[s])); }
function toast(text){
  els.toast.textContent = text;
  els.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>els.toast.classList.remove('show'), 2200);
}
function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1200);
}
