// Scan a barcode / IMEI with the phone or laptop camera.
// Uses the browser's own barcode reader when there is one (Android Chrome), otherwise ZXing (iPhone, desktop).
import { icon, toast } from './core.js';

export const cameraAvailable = () => !!navigator.mediaDevices?.getUserMedia && (window.isSecureContext || location.hostname === 'localhost');

let zxingLoading = null;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/zxing/index.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => { zxingLoading = null; reject(new Error('مقدرناش نحمّل قارئ الباركود — اتأكد من النت')); };
    document.head.append(s);
  });
  return zxingLoading;
}

const FORMATS = ['CODE_128', 'EAN_13', 'EAN_8', 'UPC_A', 'UPC_E', 'CODE_39', 'ITF', 'QR_CODE'];
function zxReader(ZXing) {
  const hints = new Map([
    [ZXing.DecodeHintType.TRY_HARDER, true],
    [ZXing.DecodeHintType.POSSIBLE_FORMATS, FORMATS.map((f) => ZXing.BarcodeFormat[f]).filter((f) => f !== undefined)],
  ]);
  const r = new ZXing.MultiFormatReader();
  r.setHints(hints);
  return r;
}
/**
 * Try to read a code from part of an image. `thr` cleans the picture first (0 = as is, 0.3 / 0.5 = make
 * everything lighter than that share of the dark-to-light range white): a label stuck on a darker box
 * otherwise confuses the reader. `turn` reads it sideways.
 */
function decodeRegion(ZXing, reader, source, sx, sy, sw, sh, maxW = 1600, { thr = 0, turn = 0 } = {}) {
  const k = Math.min(2, maxW / sw); // small codes in the middle get enlarged
  const w = Math.round(sw * k), h = Math.round(sh * k);
  const c = document.createElement('canvas');
  c.width = turn ? h : w;
  c.height = turn ? w : h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (turn) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  if (thr) {
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const a = d.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < a.length; i += 4) hist[(a[i] * 77 + a[i + 1] * 151 + a[i + 2] * 28) >> 8]++;
    const n = a.length / 4;
    const at = (q) => { let sum = 0; for (let v = 0; v < 256; v++) { sum += hist[v]; if (sum >= n * q) return v; } return 255; };
    const dark = at(0.02), light = at(0.98);
    const t = dark + (light - dark) * thr;
    for (let i = 0; i < a.length; i += 4) {
      const v = ((a[i] * 77 + a[i + 1] * 151 + a[i + 2] * 28) >> 8) < t ? 0 : 255;
      a[i] = a[i + 1] = a[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
  }
  try {
    const res = reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c))));
    if (res?.getText()) return res.getText();
  } catch { /* not in this one */ }
  reader.reset?.();
  return null;
}

const LIVE_TRIES = [['mid', {}], ['mid', { thr: 0.35 }], ['full', {}], ['mid', { thr: 0.55 }], ['full', { thr: 0.35 }], ['core', { thr: 0.35 }], ['mid', { turn: 90 }]];

/** Read a code from a still photo (the phone's own camera focuses close up much better than live video). */
export async function decodePhoto(file) {
  const ZXing = await loadZxing();
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const reader = zxReader(ZXing);
    // Whole photo, then the middle (where people aim); as is, then cleaned up; then sideways
    const regions = [[0, 0, W, H, Math.min(W, 1600)], [W * 0.1, H * 0.25, W * 0.8, H * 0.5, 1600], [W * 0.25, H * 0.3, W * 0.5, H * 0.4, 1600], [0, 0, W, H, 1000]];
    for (const turn of [0, 90]) {
      for (const [x, y, w, h, m] of regions) {
        for (const thr of [0, 0.35, 0.55]) {
          const t = decodeRegion(ZXing, reader, img, x, y, w, h, m, { thr, turn });
          if (t) return t.trim();
        }
      }
    }
    return null;
  } finally { URL.revokeObjectURL(url); }
}

/** Opens the camera full screen; resolves with the code read, or null if closed. */
export function scanWithCamera() {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'cam-back';
    back.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="cam-frame"><i></i></div>
      <div class="cam-top"><span>وجّه الكاميرا على الباركود أو الـ IMEI</span><button class="cam-close" aria-label="قفل">${icon('x')}</button></div>
      <div class="cam-msg"></div>
      <div class="cam-bottom"><label class="cam-shot">${icon('camera')} صوّر الباركود
        <input type="file" accept="image/*" capture="environment" class="visually-hidden-file"></label></div>`;
    document.body.append(back);
    const video = back.querySelector('video');
    let stream = null, stop = false;
    const finish = (code) => {
      if (stop) return;
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      back.remove();
      window.removeEventListener('hashchange', onNav);
      if (code) navigator.vibrate?.(60);
      resolve(code || null);
    };
    const onNav = () => finish(null);
    window.addEventListener('hashchange', onNav);
    back.querySelector('.cam-close').addEventListener('click', () => finish(null));
    // Live reading struggles close up on some phones: a still photo from the phone's camera app is sharper
    const msg = back.querySelector('.cam-msg');
    const hintTimer = setTimeout(() => { if (!stop) msg.textContent = 'مش بيقرا؟ بعّد الموبايل شوية عن الباركود، أو دوس "صوّر الباركود"'; }, 6000);
    back.querySelector('.cam-shot input').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      msg.textContent = 'بيقرا الصورة…';
      try {
        const code = await decodePhoto(f);
        if (code) { clearTimeout(hintTimer); return finish(code); }
        msg.textContent = 'مقدرش يقرا الباركود من الصورة — قرّب عليه أكتر ويكون واضح وفي نور، وجرب تاني';
      } catch (err) { msg.textContent = err.message; }
    });
    const fail = (e) => {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      toast(denied ? 'لازم تسمح للسيستم يستخدم الكاميرا (من إعدادات المتصفح)' : (e?.message || 'الكاميرا مش شغالة'), 'err');
      finish(null);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        // Keep focusing (close-up labels) where the camera allows it
        stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        const formats = window.BarcodeDetector ? await window.BarcodeDetector.getSupportedFormats().catch(() => []) : [];
        if (formats.includes('code_128') || formats.includes('ean_13')) {
          const detector = new window.BarcodeDetector({ formats: formats.filter((f) => ['code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'qr_code', 'itf'].includes(f)) });
          const loop = async () => {
            if (stop) return;
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) { clearTimeout(hintTimer); return finish(found[0].rawValue.trim()); }
            } catch { /* keep trying */ }
            setTimeout(loop, 120);
          };
          loop();
        } else {
          const ZXing = await loadZxing();
          if (stop) return;
          // One frame at a time: mostly the middle strip (where the frame is), sometimes the whole picture
          const reader = zxReader(ZXing);
          let tick = 0;
          const loop = () => {
            if (stop) return;
            const W = video.videoWidth, H = video.videoHeight;
            if (W) {
              // Take turns: the middle strip as is / cleaned up, the whole picture, sideways
              const [region, opts] = LIVE_TRIES[tick++ % LIVE_TRIES.length];
              const [x, y, w, h] = region === 'mid' ? [W * 0.08, H * 0.3, W * 0.84, H * 0.4] : region === 'core' ? [W * 0.25, H * 0.35, W * 0.5, H * 0.3] : [0, 0, W, H];
              const text = decodeRegion(ZXing, reader, video, x, y, w, h, region === 'full' ? Math.min(W, 1280) : 1280, opts);
              if (text) { clearTimeout(hintTimer); return finish(text.trim()); }
            }
            setTimeout(loop, 120);
          };
          loop();
        }
      } catch (e) { fail(e); }
    })();
  });
}

/**
 * Adds a camera button inside a search box. When something is read, it's typed into the
 * input and Enter is pressed — the same as a USB scanner.
 */
export function addCameraButton(input) {
  if (!input || !cameraAvailable() || input.parentElement.querySelector('.cam-btn')) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cam-btn';
  b.title = 'امسح بالكاميرا';
  b.innerHTML = icon('camera');
  input.after(b);
  input.parentElement.classList.add('has-cam');
  b.addEventListener('click', async () => {
    const code = await scanWithCamera();
    if (!code) return;
    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}
