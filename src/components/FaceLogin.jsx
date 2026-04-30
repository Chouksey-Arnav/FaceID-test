// src/components/FaceLogin.jsx
// Real-time face login scanner.  Auto-starts on mount.
// No button press required — just look at the camera.
//
// Props:
//   storedDescriptor (number[])  from DB.getFaceDescriptor()
//   userName         (string)    greeting text
//   onSuccess()                  called when face matches
//   onFallback()                 user wants name login instead
//   accent           (string)    colour token

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  loadModels, startCamera, stopCamera,
  recognizeFace, detectFaceBox, distanceToConfidence,
} from '../lib/faceAuth';

const C = {
  bg:'#04060b', s1:'#0a1020', s2:'#0f1828', s3:'#162032', s4:'#1d2a40',
  b1:'rgba(255,255,255,0.07)', b2:'rgba(255,255,255,0.11)',
  t1:'#eef2ff', t2:'#94a3c0', t3:'#506080',
  blue:'#2d7fff', blueL:'#5da0ff',
  green:'#10b981', greenL:'#34d399',
  amber:'#f59e0b', amberL:'#fbbf24',
  rose:'#f43f5e',
  FD:"'Bricolage Grotesque',-apple-system,sans-serif",
  FB:"'Onest',-apple-system,BlinkMacSystemFont,sans-serif",
  FM:"'JetBrains Mono','SF Mono',monospace",
};

const S = {
  INIT:    'init',     // loading models + camera
  SCAN:    'scan',     // actively scanning
  MATCHED: 'matched',  // verified ✓
  FAILED:  'failed',   // max attempts exhausted
  ERROR:   'error',    // camera / model error
};

const MAX_ATTEMPTS = 25;   // ~10 s at 400 ms intervals

// ── Face bounding-box overlay ──────────────────────────────────────────────────
function FaceBox({ faceBox, videoEl, confidence, accent }) {
  if (!faceBox) return null;
  const vw = videoEl?.videoWidth  || 640;
  const vh = videoEl?.videoHeight || 480;
  const sx = 280 / vw;
  const sy = 210 / vh;
  const color = confidence > 70 ? C.green : confidence > 40 ? C.amber : accent;
  return (
    <div style={{
      position:'absolute',
      left:   faceBox.x * sx,   top:    faceBox.y * sy,
      width:  faceBox.width*sx, height: faceBox.height*sy,
      border: `2px solid ${color}`,
      borderRadius: 8,
      boxShadow: `0 0 20px ${color}55`,
      pointerEvents: 'none',
      transition: 'border-color .2s, box-shadow .2s',
    }}>
      {/* Corner ticks */}
      {[[0,0],[1,0],[0,1],[1,1]].map(([cx,cy], i) => (
        <div key={i} style={{
          position:'absolute', width:10, height:10,
          borderTop:    cy===0 ? `3px solid ${color}` : 'none',
          borderBottom: cy===1 ? `3px solid ${color}` : 'none',
          borderLeft:   cx===0 ? `3px solid ${color}` : 'none',
          borderRight:  cx===1 ? `3px solid ${color}` : 'none',
          top:cy===0?-2:'auto', bottom:cy===1?-2:'auto',
          left:cx===0?-2:'auto', right:cx===1?-2:'auto',
        }}/>
      ))}
      {/* Confidence badge */}
      {confidence > 0 && (
        <div style={{
          position:'absolute', top:-28, left:'50%', transform:'translateX(-50%)',
          background:`${color}22`, border:`1px solid ${color}40`,
          borderRadius:6, padding:'2px 10px',
          fontSize:10, fontWeight:700, color, fontFamily:C.FM,
          whiteSpace:'nowrap',
        }}>
          {confidence}% match
        </div>
      )}
    </div>
  );
}

// ── Scanning pulse dots ────────────────────────────────────────────────────────
function ScanDots({ attempt, accent }) {
  return (
    <div style={{ display:'flex', gap:6, justifyContent:'center' }}>
      {Array.from({ length:5 }).map((_, i) => (
        <motion.div key={i}
          animate={{ opacity:[0.2, 1, 0.2], scale:[.75, 1, .75] }}
          transition={{ repeat:Infinity, duration:1.3, delay:i * 0.18 }}
          style={{
            width:7, height:7, borderRadius:'50%',
            background: i < Math.floor((attempt / MAX_ATTEMPTS) * 5) ? accent : C.s4,
          }}/>
      ))}
    </div>
  );
}

export default function FaceLogin({
  storedDescriptor,
  userName    = '',
  onSuccess,
  onFallback,
  accent      = C.blue,
}) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const scanTimer = useRef(null);

  const [status,     setStatus]     = useState(S.INIT);
  const [confidence, setConfidence] = useState(0);
  const [faceBox,    setFaceBox]    = useState(null);
  const [attempt,    setAttempt]    = useState(0);
  const [error,      setError]      = useState(null);
  const [modelPct,   setModelPct]   = useState(0);

  useEffect(() => {
    initialize();
    return () => {
      clearTimeout(scanTimer.current);
      stopCamera(streamRef.current, videoRef.current);
    };
  }, []);

  // ── Init: models → camera → scan ──────────────────────────────────────────
  const initialize = useCallback(async () => {
    setStatus(S.INIT);
    setError(null);
    setAttempt(0);
    setConfidence(0);
    setFaceBox(null);

    let fake = 0;
    const tick = setInterval(() => {
      fake = Math.min(fake + (fake < 60 ? 3.5 : 0.9), 93);
      setModelPct(Math.round(fake));
    }, 110);

    try {
      await loadModels();
      clearInterval(tick);
      setModelPct(100);
      await new Promise(r => setTimeout(r, 180));
      const stream = await startCamera(videoRef.current);
      streamRef.current = stream;
      setStatus(S.SCAN);
      startScanLoop();
    } catch (err) {
      clearInterval(tick);
      setError(err.message);
      setStatus(S.ERROR);
    }
  }, []);

  // ── Scan loop ──────────────────────────────────────────────────────────────
  const startScanLoop = useCallback(() => {
    let count = 0;

    const scan = async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        scanTimer.current = setTimeout(scan, 300);
        return;
      }

      // Update face box overlay
      const box = await detectFaceBox(video).catch(() => null);
      setFaceBox(box);

      count++;
      setAttempt(count);

      if (box) {
        // Face visible — attempt recognition
        try {
          const result = await recognizeFace(video, storedDescriptor);
          setConfidence(result.confidence);

          if (result.matched) {
            stopCamera(streamRef.current, videoRef.current);
            streamRef.current = null;
            setStatus(S.MATCHED);
            setTimeout(() => onSuccess(), 900);
            return;
          }
        } catch { /* ignore per-frame errors */ }
      }

      if (count >= MAX_ATTEMPTS) {
        stopCamera(streamRef.current, videoRef.current);
        setStatus(S.FAILED);
        return;
      }

      scanTimer.current = setTimeout(scan, 400);
    };

    // Warmup delay for camera
    scanTimer.current = setTimeout(scan, 600);
  }, [storedDescriptor, onSuccess]);

  const handleRetry = useCallback(() => {
    clearTimeout(scanTimer.current);
    stopCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    initialize();
  }, [initialize]);

  const handleFallback = useCallback(() => {
    clearTimeout(scanTimer.current);
    stopCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    onFallback();
  }, [onFallback]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const firstName   = userName ? userName.split(' ')[0] : '';
  const showCamera  = status === S.SCAN || status === S.MATCHED;
  const statusIcon  = status === S.MATCHED ? '✓' : status === S.FAILED ? '😕' : '👤';

  const heading = {
    [S.INIT]:    'Starting Face ID…',
    [S.SCAN]:    firstName ? `Welcome back, ${firstName}!` : 'Scanning…',
    [S.MATCHED]: 'Verified ✓',
    [S.FAILED]:  'Not Recognised',
    [S.ERROR]:   'Camera Error',
  }[status];

  const subtext = {
    [S.INIT]:    `Loading… ${modelPct}%`,
    [S.SCAN]:    faceBox ? 'Face detected — hold still…' : 'Position your face in the frame',
    [S.MATCHED]: `Welcome back${firstName ? `, ${firstName}` : ''}!`,
    [S.FAILED]:  'Face not recognised after multiple attempts.',
    [S.ERROR]:   error,
  }[status];

  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center',
      gap:18, padding:'32px 24px', width:'100%', maxWidth:400, margin:'0 auto',
    }}>

      {/* ── Logo + heading ── */}
      <div style={{ textAlign:'center' }}>
        <motion.div
          animate={status === S.MATCHED ? { scale:[1,1.18,1] } : {}}
          transition={{ duration:.6 }}
          style={{
            width:52, height:52, borderRadius:14,
            background: status === S.MATCHED ? `${C.green}22` : `${accent}22`,
            border:`1px solid ${status === S.MATCHED ? C.green : accent}35`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:24, margin:'0 auto 12px',
          }}>
          {statusIcon}
        </motion.div>
        <h2 style={{ fontSize:20, fontWeight:800, color:C.t1, fontFamily:C.FD,
          letterSpacing:'-.02em', margin:'0 0 5px' }}>{heading}</h2>
        <p style={{ fontSize:12, color:C.t2, margin:0, fontFamily:C.FB, lineHeight:1.6 }}>
          {subtext}
        </p>
      </div>

      {/* ── Model load bar ── */}
      {status === S.INIT && (
        <div style={{ width:'100%', maxWidth:280 }}>
          <div style={{ height:3, background:C.s4, borderRadius:3, overflow:'hidden' }}>
            <div style={{
              height:'100%', width:`${modelPct}%`,
              background:`linear-gradient(90deg,${accent},${C.green})`,
              borderRadius:3, transition:'width .3s ease',
            }}/>
          </div>
        </div>
      )}

      {/* ── Camera viewport ── */}
      <AnimatePresence>
        {showCamera && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            style={{
              position:'relative', width:280, height:210, borderRadius:14,
              overflow:'hidden', background:C.s2, flexShrink:0,
              border:`2px solid ${status === S.MATCHED ? C.green : accent}40`,
              boxShadow:`0 0 40px ${status === S.MATCHED ? C.green : accent}15`,
              transition:'border-color .3s, box-shadow .3s',
            }}>
            <video ref={videoRef}
              style={{ width:'100%', height:'100%', objectFit:'cover',
                transform:'scaleX(-1)', display:'block' }}
              muted playsInline autoPlay />

            <FaceBox faceBox={faceBox} videoEl={videoRef.current}
              confidence={confidence} accent={accent} />

            {/* Sweep when no face */}
            {status === S.SCAN && !faceBox && (
              <motion.div animate={{ y:[-210, 210] }}
                transition={{ repeat:Infinity, duration:2.2, ease:'linear' }}
                style={{
                  position:'absolute', left:0, right:0, height:2,
                  background:`linear-gradient(90deg,transparent,${accent}65,transparent)`,
                  boxShadow:`0 0 10px ${accent}45`,
                }}/>
            )}

            {/* Match success overlay */}
            {status === S.MATCHED && (
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
      {!showCamera && (
        <video ref={videoRef} style={{ display:'none' }} muted playsInline autoPlay />
      )}

      {/* ── Scan indicator ── */}
      {status === S.SCAN && (
        <ScanDots attempt={attempt} accent={accent} />
      )}

      {/* ── Confidence bar ── */}
      {status === S.SCAN && faceBox && confidence > 0 && (
        <div style={{ width:'100%', maxWidth:280 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
            <span style={{ fontSize:10, color:C.t3, fontFamily:C.FM, letterSpacing:'.08em' }}>
              MATCH CONFIDENCE
            </span>
            <span style={{
              fontSize:11, fontWeight:700, fontFamily:C.FM,
              color: confidence > 70 ? C.green : confidence > 40 ? C.amber : C.rose,
            }}>{confidence}%</span>
          </div>
          <div style={{ height:4, background:C.s4, borderRadius:4, overflow:'hidden' }}>
            <motion.div animate={{ width:`${confidence}%` }}
              transition={{ duration:.25 }}
              style={{
                height:'100%',
                background:`linear-gradient(90deg,${accent},${confidence>70?C.green:accent})`,
                borderRadius:4, boxShadow:`0 0 8px ${accent}60`,
              }}/>
          </div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:8,
        width:'100%', maxWidth:280 }}>

        {(status === S.FAILED || status === S.ERROR) && (
          <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:.97 }}
            style={{
              padding:'11px', borderRadius:10, border:'none',
              background:`linear-gradient(135deg,${accent},#1d5fd9)`,
              color:'#fff', fontWeight:700, fontSize:13,
              fontFamily:C.FB, cursor:'pointer',
              boxShadow:`0 4px 16px ${accent}35`,
            }}
            onClick={handleRetry}>
            ↺ Try Again
          </motion.button>
        )}

        {/* Fallback — always visible unless already matched */}
        {status !== S.MATCHED && (
          <button
            style={{
              padding:'10px', borderRadius:10,
              border:'1px solid rgba(255,255,255,0.1)',
              background:'transparent', color:C.t2,
              fontWeight:600, fontSize:13, fontFamily:C.FB, cursor:'pointer',
            }}
            onClick={handleFallback}>
            Use name login instead →
          </button>
        )}
      </div>

      {/* ── Privacy note ── */}
      {status === S.SCAN && (
        <p style={{ fontSize:10, color:C.t3, textAlign:'center',
          fontFamily:C.FB, margin:0 }}>
          🔒 Face scan is 100% local — nothing leaves your device
        </p>
      )}
    </div>
  );
}
