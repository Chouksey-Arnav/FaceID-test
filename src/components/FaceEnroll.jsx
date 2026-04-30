// src/components/FaceEnroll.jsx
// Face ID enrollment wizard — camera preview, liveness, 5-frame capture,
// animated progress ring, error/retry state machine.
//
// Props:
//   onSuccess(descriptor: number[])  called when enrollment succeeds
//   onSkip()                         user skips Face ID (onboarding)
//   onCancel()                       user cancels (settings mode)
//   accent   (string)                accent colour from parent
//   mode     ('onboarding'|'settings')

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadModels, startCamera, stopCamera, enrollFace, detectFaceBox } from '../lib/faceAuth';
import { saveFaceDescriptor } from '../lib/db';

const C = {
  bg:'#04060b', s1:'#0a1020', s2:'#0f1828', s3:'#162032', s4:'#1d2a40',
  b1:'rgba(255,255,255,0.07)', b2:'rgba(255,255,255,0.11)',
  t1:'#eef2ff', t2:'#94a3c0', t3:'#506080',
  blue:'#2d7fff', blueD:'#1d5fd9', blueL:'#5da0ff',
  green:'#10b981', greenL:'#34d399',
  amber:'#f59e0b',
  rose:'#f43f5e',
  FD:"'Bricolage Grotesque',-apple-system,sans-serif",
  FB:"'Onest',-apple-system,BlinkMacSystemFont,sans-serif",
  FM:"'JetBrains Mono','SF Mono',monospace",
};

const S = {
  IDLE:      'idle',
  LOADING:   'loading',
  CAMERA:    'camera',
  CAPTURING: 'capturing',
  SUCCESS:   'success',
  ERROR:     'error',
};

// ── Progress ring SVG ─────────────────────────────────────────────────────────
function ProgressRing({ pct = 0, color, size = 72, stroke = 6 }) {
  const r    = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <div style={{ position:'relative', width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.s4} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition:'stroke-dashoffset .4s ease', filter:`drop-shadow(0 0 5px ${color}80)` }} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
        justifyContent:'center', fontSize:13, fontWeight:700, color, fontFamily:C.FM }}>
        {Math.round(pct)}%
      </div>
    </div>
  );
}

// ── Face bounding-box overlay ──────────────────────────────────────────────────
function FaceBoxOverlay({ faceBox, videoEl, status, accent }) {
  if (!faceBox || (status !== S.CAMERA && status !== S.CAPTURING)) return null;
  const vw = videoEl?.videoWidth  || 640;
  const vh = videoEl?.videoHeight || 480;
  const sx = 320 / vw;
  const sy = 240 / vh;
  const color = status === S.CAPTURING ? C.green : accent;
  const corners = [[0,0],[1,0],[0,1],[1,1]];
  return (
    <div style={{
      position:'absolute',
      left:   faceBox.x * sx,   top:    faceBox.y * sy,
      width:  faceBox.width*sx, height: faceBox.height*sy,
      border: `2px solid ${color}`,
      borderRadius: 8,
      boxShadow: `0 0 18px ${color}50`,
      pointerEvents: 'none',
      transition: 'border-color .2s, box-shadow .2s',
    }}>
      {corners.map(([cx,cy], i) => (
        <div key={i} style={{
          position:'absolute', width:12, height:12,
          borderTop:    cy===0 ? `3px solid ${color}` : 'none',
          borderBottom: cy===1 ? `3px solid ${color}` : 'none',
          borderLeft:   cx===0 ? `3px solid ${color}` : 'none',
          borderRight:  cx===1 ? `3px solid ${color}` : 'none',
          top:cy===0?-2:'auto', bottom:cy===1?-2:'auto',
          left:cx===0?-2:'auto', right:cx===1?-2:'auto',
        }}/>
      ))}
    </div>
  );
}

export default function FaceEnroll({
  onSuccess,
  onSkip,
  onCancel,
  accent = C.blue,
  mode   = 'onboarding',
}) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const timerRef  = useRef(null);

  const [status,    setStatus]    = useState(S.IDLE);
  const [progress,  setProgress]  = useState(0);
  const [error,     setError]     = useState(null);
  const [faceBox,   setFaceBox]   = useState(null);
  const [modelPct,  setModelPct]  = useState(0);

  // Cleanup on unmount
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    stopCamera(streamRef.current, videoRef.current);
  }, []);

  // ── Load models ───────────────────────────────────────────────────────────
  const handleLoadModels = useCallback(async () => {
    setStatus(S.LOADING);
    setError(null);
    setModelPct(0);

    let fake = 0;
    const tick = setInterval(() => {
      fake = Math.min(fake + (fake < 60 ? 2.5 : 0.6), 93);
      setModelPct(Math.round(fake));
    }, 140);

    try {
      await loadModels();
      clearInterval(tick);
      setModelPct(100);
      await new Promise(r => setTimeout(r, 280));
      await openCamera();
    } catch (err) {
      clearInterval(tick);
      setError(err.message);
      setStatus(S.ERROR);
    }
  }, []);

  // ── Open camera ───────────────────────────────────────────────────────────
  const openCamera = useCallback(async () => {
    setStatus(S.CAMERA);
    setFaceBox(null);
    try {
      const stream = await startCamera(videoRef.current);
      streamRef.current = stream;
      startTracking();
    } catch (err) {
      setError(err.message);
      setStatus(S.ERROR);
    }
  }, []);

  // ── Live face tracking (3fps overlay) ─────────────────────────────────────
  const startTracking = useCallback(() => {
    const tick = async () => {
      if (videoRef.current?.readyState >= 2) {
        const box = await detectFaceBox(videoRef.current).catch(() => null);
        setFaceBox(box);
      }
      timerRef.current = setTimeout(tick, 320);
    };
    timerRef.current = setTimeout(tick, 320);
  }, []);

  // ── Capture ───────────────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (status !== S.CAMERA || !faceBox) return;
    clearTimeout(timerRef.current);
    setStatus(S.CAPTURING);
    setProgress(0);
    setError(null);

    try {
      const descriptor = await enrollFace(videoRef.current, pct => setProgress(pct));
      await saveFaceDescriptor(descriptor);
      stopCamera(streamRef.current, videoRef.current);
      streamRef.current = null;
      setStatus(S.SUCCESS);
      setTimeout(() => onSuccess(descriptor), 1100);
    } catch (err) {
      setError(err.message);
      setStatus(S.CAMERA);  // allow retry without reopening camera
      startTracking();
    }
  }, [status, faceBox, onSuccess]);

  const handleRetry = useCallback(() => {
    stopCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    setError(null);
    setStatus(S.IDLE);
  }, []);

  const handleCancel = useCallback(() => {
    clearTimeout(timerRef.current);
    stopCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    if (mode === 'settings') onCancel?.();
    else onSkip?.();
  }, [mode, onCancel, onSkip]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const stateIcon = { [S.SUCCESS]:'✓', [S.ERROR]:'⚠' }[status] ?? '👤';

  const stateTitle = {
    [S.IDLE]:      mode === 'onboarding' ? 'Set Up Face ID' : 'Face ID Setup',
    [S.LOADING]:   'Loading AI Models…',
    [S.CAMERA]:    faceBox ? '✓ Face detected — tap Capture' : 'Position Your Face',
    [S.CAPTURING]: 'Capturing…',
    [S.SUCCESS]:   'Face ID Enabled!',
    [S.ERROR]:     'Something Went Wrong',
  }[status];

  const stateSub = {
    [S.IDLE]:      'Log in instantly — your face data never leaves this device.',
    [S.LOADING]:   `Downloading recognition models… ${modelPct}%`,
    [S.CAMERA]:    faceBox ? 'Hold still for best results.' : 'Face the camera in good lighting.',
    [S.CAPTURING]: progress < 15 ? 'Checking liveness…' : progress < 90 ? 'Scanning frames…' : 'Finalising…',
    [S.SUCCESS]:   mode === 'onboarding' ? "You'll be recognised next time you open the app." : 'Face ID updated successfully.',
    [S.ERROR]:     error,
  }[status];

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      gap:22, padding:'32px 28px', maxWidth:480, width:'100%', margin:'0 auto' }}>

      {/* ── Icon + heading ── */}
      <div style={{ textAlign:'center' }}>
        <motion.div initial={{ scale:.85 }} animate={{ scale:1 }}
          transition={{ type:'spring', stiffness:220 }}
          style={{
            width:56, height:56, borderRadius:16,
            background: status === S.SUCCESS ? `${C.green}22` : `${accent}22`,
            border: `1px solid ${status === S.SUCCESS ? C.green : accent}35`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:26, margin:'0 auto 14px',
            boxShadow: `0 0 28px ${status === S.SUCCESS ? C.green : accent}20`,
          }}>
          {stateIcon}
        </motion.div>
        <h2 style={{ fontSize:20, fontWeight:800, color:C.t1, fontFamily:C.FD,
          letterSpacing:'-.02em', margin:'0 0 6px' }}>{stateTitle}</h2>
        <p style={{ fontSize:12, color:C.t2, margin:0, fontFamily:C.FB,
          lineHeight:1.65, maxWidth:320 }}>{stateSub}</p>
      </div>

      {/* ── Model loading bar ── */}
      <AnimatePresence>
        {status === S.LOADING && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            style={{ width:'100%', maxWidth:320 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
              <span style={{ fontSize:10, color:C.t3, fontFamily:C.FM }}>TensorFlow Models</span>
              <span style={{ fontSize:10, color:accent, fontFamily:C.FM, fontWeight:700 }}>{modelPct}%</span>
            </div>
            <div style={{ height:4, background:C.s4, borderRadius:4, overflow:'hidden' }}>
              <div style={{
                height:'100%', width:`${modelPct}%`,
                background:`linear-gradient(90deg,${accent},${C.green})`,
                borderRadius:4, transition:'width .3s ease',
                boxShadow:`0 0 8px ${accent}60`,
              }}/>
            </div>
            <p style={{ fontSize:10, color:C.t3, marginTop:6, textAlign:'center', fontFamily:C.FB }}>
              ~6 MB · cached after first load
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Camera viewport ── */}
      <AnimatePresence>
        {(status === S.CAMERA || status === S.CAPTURING || status === S.SUCCESS) && (
          <motion.div initial={{ opacity:0, scale:.96 }} animate={{ opacity:1, scale:1 }}
            exit={{ opacity:0 }}
            style={{
              position:'relative', width:320, height:240, borderRadius:14,
              overflow:'hidden', background:C.s2, flexShrink:0,
              border:`2px solid ${status === S.SUCCESS ? C.green : status === S.CAPTURING ? C.green : accent}40`,
              boxShadow:`0 0 40px ${status === S.SUCCESS ? C.green : accent}18`,
              transition:'border-color .3s, box-shadow .3s',
            }}>
            <video ref={videoRef}
              style={{ width:'100%', height:'100%', objectFit:'cover',
                transform:'scaleX(-1)', display:'block' }}
              muted playsInline autoPlay />

            {/* Face detection overlay */}
            <FaceBoxOverlay faceBox={faceBox} videoEl={videoRef.current}
              status={status} accent={accent} />

            {/* Scanning sweep (when no face) */}
            {status === S.CAMERA && !faceBox && (
              <motion.div animate={{ y:[-240, 240] }}
                transition={{ repeat:Infinity, duration:2.2, ease:'linear' }}
                style={{
                  position:'absolute', left:0, right:0, height:2,
                  background:`linear-gradient(90deg,transparent,${accent}70,transparent)`,
                  boxShadow:`0 0 10px ${accent}50`,
                }}/>
            )}

            {/* Capture progress overlay */}
            {status === S.CAPTURING && (
              <div style={{
                position:'absolute', inset:0, background:'rgba(4,6,11,0.72)',
                display:'flex', flexDirection:'column',
                alignItems:'center', justifyContent:'center', gap:12,
              }}>
                <ProgressRing pct={progress} color={accent} size={80} stroke={7} />
                <span style={{ fontSize:12, color:C.t1, fontFamily:C.FM }}>{stateSub}</span>
              </div>
            )}

            {/* Success overlay */}
            {status === S.SUCCESS && (
              <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }}
                style={{
                  position:'absolute', inset:0, background:'rgba(16,185,129,0.22)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:80, lineHeight:1,
                }}>
                ✓
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden video for non-camera states */}
      {status !== S.CAMERA && status !== S.CAPTURING && status !== S.SUCCESS && (
        <video ref={videoRef} style={{ display:'none' }} muted playsInline autoPlay />
      )}

      {/* ── Tips panel ── */}
      {(status === S.CAMERA) && (
        <div style={{
          background:C.s2, border:`1px solid ${C.b1}`, borderRadius:12,
          padding:'12px 18px', width:'100%', maxWidth:320,
        }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.t3, letterSpacing:'.1em', marginBottom:8 }}>
            TIPS FOR BEST RESULTS
          </div>
          {[
            '💡 Face a light source — avoid backlighting',
            '😐 Look straight at the camera, neutral expression',
            '📏 Keep face 30–60 cm from the screen',
          ].map((tip, i) => (
            <div key={i} style={{ fontSize:12, color:C.t2, marginBottom:3,
              lineHeight:1.55, fontFamily:C.FB }}>{tip}</div>
          ))}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:10,
        width:'100%', maxWidth:320 }}>

        {status === S.IDLE && (
          <>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}
              style={btnPrimary(accent)}
              onClick={handleLoadModels}>
              👤 Enable Face ID
            </motion.button>
            <button style={btnGhost()} onClick={handleCancel}>
              {mode === 'onboarding' ? 'Skip for now →' : 'Cancel'}
            </button>
          </>
        )}

        {status === S.CAMERA && (
          <>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}
              disabled={!faceBox}
              style={btnPrimary(faceBox ? C.green : C.s4, {
                opacity: faceBox ? 1 : 0.55,
                boxShadow: faceBox ? `0 4px 20px ${C.green}40` : 'none',
              })}
              onClick={handleCapture}>
              {faceBox ? '📸 Capture Face' : 'Waiting for face…'}
            </motion.button>
            <button style={btnGhost()} onClick={handleCancel}>Cancel</button>
          </>
        )}

        {status === S.ERROR && (
          <>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}
              style={btnPrimary(accent)}
              onClick={handleRetry}>
              ↺ Try Again
            </motion.button>
            <button style={btnGhost()} onClick={handleCancel}>
              {mode === 'onboarding' ? 'Skip Face ID' : 'Cancel'}
            </button>
          </>
        )}
      </div>

      {/* ── Privacy note ── */}
      {(status === S.IDLE || status === S.CAMERA) && (
        <p style={{ fontSize:11, color:C.t3, textAlign:'center',
          maxWidth:300, lineHeight:1.7, fontFamily:C.FB, margin:0 }}>
          🔒 Face data is stored only in your browser's local storage — never uploaded or shared.
        </p>
      )}
    </div>
  );
}

// ── Button helpers ─────────────────────────────────────────────────────────────
function btnPrimary(bg, extra = {}) {
  return {
    display:'inline-flex', alignItems:'center', justifyContent:'center',
    gap:8, padding:'12px 24px', borderRadius:10, border:'none',
    background: bg === '#10b981' ? 'linear-gradient(135deg,#10b981,#059669)'
      : bg === '#1d2a40' ? '#1d2a40'
      : `linear-gradient(135deg,${bg},#1d5fd9)`,
    color:'#fff', fontWeight:700, fontSize:14,
    fontFamily:"'Onest',-apple-system,BlinkMacSystemFont,sans-serif",
    cursor:'pointer', transition:'all .18s', width:'100%',
    boxShadow:`0 4px 20px ${bg}35`,
    ...extra,
  };
}

function btnGhost() {
  return {
    display:'inline-flex', alignItems:'center', justifyContent:'center',
    padding:'11px 24px', borderRadius:10,
    border:'1px solid rgba(255,255,255,0.1)',
    background:'transparent', color:'#94a3c0', fontWeight:600, fontSize:13,
    fontFamily:"'Onest',-apple-system,BlinkMacSystemFont,sans-serif",
    cursor:'pointer', width:'100%', transition:'all .15s',
  };
}
