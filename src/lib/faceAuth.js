// ─────────────────────────────────────────────────────────────────────────────
// src/lib/faceAuth.js — Face Recognition Engine for MedSchoolPrep
//
// 100% client-side via face-api.js (TensorFlow.js).
// Zero biometric data ever leaves the device.
// Stores only a 128-float descriptor vector in IndexedDB.
//
// Pipeline:
//   loadModels()        → downloads 3 TF models (~6.7 MB, browser-cached)
//   startCamera()       → opens webcam, attaches stream to <video>
//   enrollFace()        → liveness check + 5-frame capture + descriptor average
//   recognizeFace()     → single-frame match against stored descriptor
//   continuousScan()    → polling loop, resolves on first match
//
// Match threshold: 0.55  (face-api default is 0.6 — tightened for security)
// ─────────────────────────────────────────────────────────────────────────────
import * as faceapi from 'face-api.js';

// ── Constants ──────────────────────────────────────────────────────────────────
export const MATCH_THRESHOLD = 0.55;

const MODEL_CDNS = [
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights',
  'https://unpkg.com/face-api.js@0.22.2/weights',
];
const MODEL_LOCAL    = '/models';
const ENROLL_FRAMES  = 5;
const ENROLL_MIN     = 3;
const MIN_SCORE      = 0.62;
const MIN_FACE_PX    = 80;

// ── Module state ───────────────────────────────────────────────────────────────
let modelsLoaded   = false;
let loadingPromise = null;

const DETECTOR_OPTS = new faceapi.TinyFaceDetectorOptions({
  inputSize: 320, scoreThreshold: MIN_SCORE,
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL LOADING
// ═══════════════════════════════════════════════════════════════════════════════

export async function loadModels() {
  if (modelsLoaded)   return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const sources = [...MODEL_CDNS, MODEL_LOCAL];
    let lastErr;
    for (const src of sources) {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(src),
          faceapi.nets.faceLandmark68Net.loadFromUri(src),
          faceapi.nets.faceRecognitionNet.loadFromUri(src),
        ]);
        modelsLoaded = true;
        loadingPromise = null;
        return;
      } catch (err) {
        lastErr = err;
        console.warn(`[faceAuth] source "${src}" failed:`, err.message);
      }
    }
    loadingPromise = null;
    throw new Error(
      `Face ID models could not load. Check your internet connection.\n(${lastErr?.message})`
    );
  })();

  return loadingPromise;
}

export function areModelsLoaded() { return modelsLoaded; }

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA
// ═══════════════════════════════════════════════════════════════════════════════

export async function startCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available. Open MedSchoolPrep over HTTPS.');
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'user', width:{ideal:640,max:1280}, height:{ideal:480,max:720}, frameRate:{ideal:30} },
      audio: false,
    });
  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      throw new Error('Camera permission denied. Allow camera access in your browser settings.');
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')
      throw new Error('No camera found on this device.');
    if (err.name === 'NotReadableError')
      throw new Error('Camera is in use by another application. Close it and try again.');
    throw new Error(`Camera error: ${err.message}`);
  }
  videoEl.srcObject = stream;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Camera timed out.')), 12000);
    videoEl.onloadedmetadata = () => { clearTimeout(timeout); videoEl.play().then(resolve).catch(reject); };
    videoEl.onerror = (e) => { clearTimeout(timeout); reject(new Error(`Video error: ${e?.message || 'unknown'}`)); };
  });
  return stream;
}

export function stopCamera(stream, videoEl) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (videoEl) videoEl.srcObject = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETECTION PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════════

export async function extractDescriptor(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  const det = await faceapi.detectSingleFace(videoEl, DETECTOR_OPTS).withFaceLandmarks().withFaceDescriptor();
  if (!det) return null;
  if (det.detection.score < MIN_SCORE) return null;
  const { width, height } = det.detection.box;
  if (width < MIN_FACE_PX || height < MIN_FACE_PX) return null;
  return det.descriptor;
}

export async function detectFaceBox(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return null;
  const det = await faceapi.detectSingleFace(videoEl, DETECTOR_OPTS);
  if (!det) return null;
  const { x, y, width, height } = det.box;
  return { x, y, width, height, score: det.score };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVENESS CHECK
// ═══════════════════════════════════════════════════════════════════════════════

async function livenessCheck(videoEl) {
  const W = 160, H = 120;
  const c1 = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const c2 = Object.assign(document.createElement('canvas'), { width: W, height: H });
  c1.getContext('2d').drawImage(videoEl, 0, 0, W, H);
  await new Promise(res => setTimeout(res, 500));
  c2.getContext('2d').drawImage(videoEl, 0, 0, W, H);
  const d1 = c1.getContext('2d').getImageData(0, 0, W, H).data;
  const d2 = c2.getContext('2d').getImageData(0, 0, W, H).data;
  let diff = 0;
  for (let i = 0; i < d1.length; i += 4) diff += Math.abs(d1[i] - d2[i]);
  return (diff / (d1.length / 4)) > 0.9;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENROLLMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function enrollFace(videoEl, onProgress = () => {}) {
  await loadModels();
  onProgress(5);
  const isLive = await livenessCheck(videoEl);
  if (!isLive) throw new Error('Liveness check failed — please use your live face. Static photos are not accepted.');
  onProgress(12);
  const descriptors = [];
  const maxAttempts = ENROLL_FRAMES * 4;
  for (let attempt = 0; attempt < maxAttempts && descriptors.length < ENROLL_FRAMES; attempt++) {
    await new Promise(res => setTimeout(res, 380));
    const d = await extractDescriptor(videoEl);
    if (d) {
      descriptors.push(d);
      onProgress(12 + Math.round((descriptors.length / ENROLL_FRAMES) * 83));
    }
  }
  if (descriptors.length < ENROLL_MIN) {
    throw new Error(
      `Only detected your face in ${descriptors.length} frames. ` +
      'Ensure good lighting and face the camera directly.'
    );
  }
  const len = descriptors[0].length;
  const avg = new Float32Array(len);
  for (const d of descriptors) for (let i = 0; i < len; i++) avg[i] += d[i];
  for (let i = 0; i < len; i++) avg[i] /= descriptors.length;
  onProgress(100);
  return Array.from(avg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECOGNITION
// ═══════════════════════════════════════════════════════════════════════════════

export function descriptorDistance(a, b) {
  return faceapi.euclideanDistance(a, b);
}

export async function recognizeFace(videoEl, storedDescriptor) {
  await loadModels();
  const live = await extractDescriptor(videoEl);
  if (!live) return { matched: false, distance: Infinity, confidence: 0 };
  const distance   = descriptorDistance(live, storedDescriptor);
  const matched    = distance < MATCH_THRESHOLD;
  const confidence = distanceToConfidence(distance);
  return { matched, distance, confidence };
}

export async function continuousScan(videoEl, storedDescriptor, {
  maxAttempts = 25, intervalMs = 400, onAttempt = () => {},
} = {}) {
  await loadModels();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(res => setTimeout(res, intervalMs));
    const result = await recognizeFace(videoEl, storedDescriptor);
    onAttempt({ attempt, ...result });
    if (result.matched) return result;
  }
  return { matched: false, distance: Infinity, confidence: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function distanceToConfidence(distance) {
  if (!Number.isFinite(distance) || distance <= 0) return 100;
  if (distance >= 0.8) return 0;
  return Math.round((1 - distance / 0.8) * 100);
}

export function matchLabel(distance) {
  if (distance < 0.35) return 'Excellent match';
  if (distance < 0.45) return 'Good match';
  if (distance < 0.55) return 'Match';
  if (distance < 0.65) return 'Weak match';
  return 'No match';
}
