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

/** Opens the camera full screen; resolves with the code read, or null if closed. */
export function scanWithCamera() {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'cam-back';
    back.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="cam-frame"><i></i></div>
      <div class="cam-top"><span>وجّه الكاميرا على الباركود أو الـ IMEI</span><button class="cam-close" aria-label="قفل">${icon('x')}</button></div>
      <div class="cam-msg"></div>`;
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
    const fail = (e) => {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      toast(denied ? 'لازم تسمح للسيستم يستخدم الكاميرا (من إعدادات المتصفح)' : (e?.message || 'الكاميرا مش شغالة'), 'err');
      finish(null);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
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
              if (found[0]?.rawValue) return finish(found[0].rawValue.trim());
            } catch { /* keep trying */ }
            setTimeout(loop, 120);
          };
          loop();
        } else {
          const ZXing = await loadZxing();
          if (stop) return;
          // Read one frame at a time from a canvas (works the same on every browser)
          const hints = new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]);
          const multi = new ZXing.MultiFormatReader();
          multi.setHints(hints);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const loop = () => {
            if (stop) return;
            if (video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0);
              try {
                const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)));
                const result = multi.decode(bitmap);
                if (result?.getText()) return finish(result.getText().trim());
              } catch { /* nothing found in this frame */ }
            }
            setTimeout(loop, 160);
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
