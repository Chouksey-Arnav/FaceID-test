import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast, { Toaster } from 'react-hot-toast';
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement,
  Filler, Tooltip, Legend, CategoryScale, LinearScale, BarElement, ArcElement
} from 'chart.js';
import { Radar, Line, Doughnut } from 'react-chartjs-2';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { ALL_QUIZZES } from './data/quizzes';
import { ELIB } from './data/elib';
import { PATHS, FLASH_DECKS, SCHOOL_DATA, MMI_QS, COMPETITIONS, DIAG_QS } from './data/constants';

import * as DB from './lib/db';
import { scheduleCard, getDueCards, sortForStudy, nextReviewLabel, getRetainability } from './lib/fsrs';
import { buildQuizSearch, buildLibrarySearch, fuseSearch } from './lib/search';
import { play, setSFX } from './lib/sounds';
import { celebrateXP, celebrateLevelUp, celebratePerfect, celebrateAchievement, celebrateMastery, celebrateStreak } from './lib/celebrate';
import { renderMarkdown } from './lib/renderMarkdown';
import { exportQuizResult, exportSchoolList, exportFlashDeck } from './lib/exportPDF';
import { ACHIEVEMENTS, checkAchievements } from './lib/achievements';

import FaceEnroll from './components/FaceEnroll';
import FaceLogin  from './components/FaceLogin';

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend, CategoryScale, LinearScale, BarElement, ArcElement);

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:'#04060b', s0:'#060a15', s1:'#0a1020', s2:'#0f1828', s3:'#162032', s4:'#1d2a40', s5:'#253350',
  b0:'rgba(255,255,255,0.04)', b1:'rgba(255,255,255,0.07)', b2:'rgba(255,255,255,0.11)', b3:'rgba(255,255,255,0.18)',
  t1:'#eef2ff', t2:'#94a3c0', t3:'#506080', t4:'#2d3f58',
  blue:'#2d7fff', blueL:'#5da0ff', blueLL:'#93c5fd', blueD:'#1d5fd9',
  blueDim:'rgba(45,127,255,0.10)', blueGlow:'rgba(45,127,255,0.28)',
  blueGrad:'linear-gradient(135deg,#2d7fff 0%,#1d5fd9 100%)',
  green:'#10b981', greenL:'#34d399', greenDim:'rgba(16,185,129,0.10)',
  amber:'#f59e0b', amberL:'#fbbf24', amberDim:'rgba(245,158,11,0.10)',
  rose:'#f43f5e', roseL:'#fb7185', roseDim:'rgba(244,63,94,0.10)',
  violet:'#8b5cf6', violetL:'#a78bfa', violetDim:'rgba(139,92,246,0.10)',
  cyan:'#06b6d4', cyanDim:'rgba(6,182,212,0.10)', orange:'#f97316',
  FD:"'Bricolage Grotesque',-apple-system,sans-serif",
  FB:"'Onest',-apple-system,BlinkMacSystemFont,sans-serif",
  FM:"'JetBrains Mono','SF Mono',monospace",
};

// ── Style helpers ─────────────────────────────────────────────────────────────
const glass  = (x={}) => ({ background:'rgba(255,255,255,0.03)', border:`1px solid ${C.b1}`, borderRadius:16, padding:24, boxShadow:'0 2px 12px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.04)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', ...x });
const glass2 = (x={}) => ({ background:'rgba(255,255,255,0.025)', border:`1px solid ${C.b1}`, borderRadius:10, padding:14, ...x });
const btn    = (bg=C.blueGrad,x={}) => ({ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 20px', borderRadius:9, border:'none', background:bg, color:'#fff', fontWeight:600, fontSize:13, fontFamily:C.FB, cursor:'pointer', letterSpacing:'.01em', boxShadow:bg===C.blueGrad?'0 4px 16px rgba(45,127,255,0.35),inset 0 1px 0 rgba(255,255,255,0.12)':'0 2px 8px rgba(0,0,0,0.3)', transition:'all .18s cubic-bezier(.16,1,.3,1)', ...x });
const btnSm  = (bg='rgba(255,255,255,0.08)',x={}) => ({ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:4, padding:'6px 14px', borderRadius:7, border:`1px solid ${C.b1}`, background:bg, color:'#fff', fontWeight:600, fontSize:12, fontFamily:C.FB, cursor:'pointer', transition:'all .15s', ...x });
const btnG   = (x={}) => ({ display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6, padding:'9px 18px', borderRadius:9, border:`1px solid rgba(255,255,255,0.1)`, background:'transparent', color:C.t2, fontWeight:500, fontSize:13, fontFamily:C.FB, cursor:'pointer', transition:'all .15s', ...x });
const inp    = (x={}) => ({ background:'rgba(255,255,255,0.04)', border:`1px solid rgba(255,255,255,0.1)`, borderRadius:10, padding:'10px 14px', color:C.t1, fontSize:13, fontFamily:C.FB, outline:'none', width:'100%', transition:'border-color .15s,box-shadow .15s', ...x });
const lbl    = (x={}) => ({ fontSize:10, fontWeight:700, color:C.t3, letterSpacing:'.1em', textTransform:'uppercase', display:'block', marginBottom:7, ...x });
const R      = (x={}) => ({ display:'flex', alignItems:'center', gap:12, ...x });
const CC     = (x={}) => ({ display:'flex', flexDirection:'column', gap:12, ...x });
const G      = (cols=2,gap=14,x={}) => ({ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gap, ...x });
const pill   = (bg,color,x={}) => ({ display:'inline-flex', alignItems:'center', padding:'3px 11px', borderRadius:20, fontSize:11, fontWeight:600, letterSpacing:'.04em', background:bg, color, ...x });

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtT   = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const scCol  = p => p>=80?C.green:p>=60?C.blue:C.amber;
const tierC  = t => ({Likely:C.green,Target:C.blue,Reach:C.amber,Stretch:C.rose}[t]||C.t2);
const AI_MSG = 'AI features require an OpenAI API key. Set OPENAI_KEY in your Vercel environment variables.';
const scoreToSection = p => p>=90?131:p>=80?129:p>=70?127:p>=60?125:p>=50?123:120;

function scoreSchool(s,gpa,mcat,res,clin,vol,st){
  let sc=100;const gN=parseFloat(gpa)||0,mN=parseInt(mcat)||0,gd=gN-s.gpa,md=mN-s.mcat;
  if(gd>=0)sc+=15;else if(gd>=-0.1)sc-=5;else if(gd>=-0.2)sc-=15;else if(gd>=-0.3)sc-=25;else sc-=40;
  if(md>=0)sc+=15;else if(md>=-2)sc-=5;else if(md>=-4)sc-=15;else if(md>=-6)sc-=25;else sc-=40;
  sc+=Math.min((parseInt(res)||0)*3,10);const c=parseInt(clin)||0;sc+=c>=500?10:c>=200?6:c>=100?3:0;
  const v=parseInt(vol)||0;sc+=v>=200?5:v>=100?3:0;
  if(s.type==='Public'&&st&&s.state===st)sc+=10;
  return{...s,tier:sc>=110?'Likely':sc>=92?'Target':sc>=72?'Reach':'Stretch',score:sc};
}

const NAV = [
  {id:'home',ic:'⌂',label:'Home'},{id:'diagnostic',ic:'◎',label:'Diagnostic'},
  {id:'pathway',ic:'▸',label:'Pathway'},{id:'quizzes',ic:'◈',label:'Quiz Library'},
  {id:'coach',ic:'✦',label:'AI Coach'},{id:'flashcards',ic:'◧',label:'Flashcards'},
  {id:'library',ic:'≡',label:'E-Library'},{id:'portfolio',ic:'◉',label:'Portfolio'},
  {id:'interview',ic:'◑',label:'Interview Sim'},{id:'calc',ic:'⊞',label:'Admissions'},
  {id:'analytics',ic:'↗',label:'Analytics'},{id:'settings',ic:'⊙',label:'Settings'},
];
const QUICK_P = [
  'Explain Michaelis-Menten kinetics simply','What is the TCA cycle and why does it matter?',
  'How do I approach CARS passages on test day?','Most high-yield topics for MCAT Psych/Soc?',
  'Give me a 2-week study schedule for Bio/Biochem','Explain Henderson-Hasselbalch with an example',
];
const ACT_TYPES = ['Clinical','Research','Volunteering','Leadership','Shadowing','Teaching','Work Experience','Other'];
const LIB_CATS  = ['All','Bio/Biochem','Chem/Phys','Psych/Soc','Research Methods','MCAT Prep','Clinical & Career'];
const MMI_TYPES = ['All','Ethics','Professionalism','Personal','Motivation','Policy','Cultural Competency','Communication','Situational'];

// ── KaTeX math renderer ───────────────────────────────────────────────────────
function MathText({ text, style }) {
  if (!text) return null;
  const parts = String(text).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return (
    <span style={style}>
      {parts.map((p, i) => {
        try {
          if (p.startsWith('$$') && p.endsWith('$$')) return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(p.slice(2,-2), { displayMode:true, throwOnError:false }) }} />;
          if (p.startsWith('$') && p.endsWith('$') && p.length > 2) return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(p.slice(1,-1), { displayMode:false, throwOnError:false }) }} />;
        } catch { }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(p){super(p);this.state={err:false,msg:''};}
  static getDerivedStateFromError(e){return{err:true,msg:e?.message||'Unexpected error'};}
  componentDidCatch(e,i){console.error('MSP:',e,i);}
  render(){
    if(this.state.err) return(
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,fontFamily:C.FB,flexDirection:'column',gap:20,padding:40}}>
        <div style={{width:60,height:60,borderRadius:'50%',background:C.roseDim,border:`1px solid ${C.rose}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24}}>⚠</div>
        <h2 style={{fontSize:20,fontWeight:700,color:C.t1,fontFamily:C.FD}}>Something went wrong</h2>
        <p style={{color:C.t2,textAlign:'center',maxWidth:400,lineHeight:1.7,fontSize:14}}>{this.state.msg}</p>
        <button style={btn()} onClick={()=>this.setState({err:false})}>Try Again</button>
      </div>
    );
    return this.props.children;
  }
}

// ── Loading Screen ────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:C.bg,fontFamily:C.FB,gap:20}}>
      <div style={{width:56,height:56,borderRadius:16,background:C.blueDim,border:`1px solid ${C.blue}30`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,animation:'spin 2s linear infinite'}}>🧬</div>
      <div style={{fontSize:14,color:C.t3,letterSpacing:'.05em'}}>Loading MedSchoolPrep…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function Arc({pct=0,size=52,stroke=4,color=C.blue,label='',sub=''}){
  const r=(size-stroke*2)/2,circ=2*Math.PI*r,off=circ-(Math.min(100,Math.max(0,pct))/100)*circ;
  return(
    <div style={{position:'relative',width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.s4} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" style={{transition:'stroke-dashoffset .6s cubic-bezier(.16,1,.3,1)',filter:`drop-shadow(0 0 4px ${color}80)`}}/>
      </svg>
      {label&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
        <span style={{fontSize:size>60?14:10,fontWeight:700,color,fontFamily:C.FM,lineHeight:1}}>{label}</span>
        {sub&&<span style={{fontSize:9,color:C.t3,lineHeight:1,marginTop:1}}>{sub}</span>}
      </div>}
    </div>
  );
}

function Bar({pct=0,color=C.blue,h=4,glow=false}){
  return(
    <div style={{height:h,background:'rgba(255,255,255,0.06)',borderRadius:h,overflow:'hidden'}}>
      <div style={{height:'100%',width:`${Math.min(100,Math.max(0,pct))}%`,background:color,borderRadius:h,transition:'width .6s cubic-bezier(.16,1,.3,1)',boxShadow:glow?`0 0 12px ${color}70`:undefined}}/>
    </div>
  );
}

function Dot({state='locked'}){
  const cfg={done:{bg:C.green,ic:'✓',c:'#fff'},available:{bg:'transparent',ic:'○',c:C.blueL,brd:C.blueL},locked:{bg:'transparent',ic:'·',c:C.t4,brd:C.t4}};
  const d=cfg[state]||cfg.locked;
  return<span style={{width:22,height:22,borderRadius:'50%',background:d.bg,border:`1.5px solid ${d.brd||C.green}`,display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:state==='done'?10:14,color:d.c,flexShrink:0,fontWeight:700,boxShadow:state==='done'?`0 0 8px ${C.green}60`:undefined}}>{d.ic}</span>;
}

function Stat({label,value,icon,color=C.blue,sub,onClick}){
  return(
    <div onClick={onClick} style={{...glass({padding:20}),position:'relative',overflow:'hidden',cursor:onClick?'pointer':undefined,transition:'all .2s'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${color},transparent)`}}/>
      <div style={R({gap:12,alignItems:'flex-start'})}>
        <div style={{width:36,height:36,borderRadius:10,background:`${color}18`,border:`1px solid ${color}25`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0,boxShadow:`0 4px 12px ${color}20`}}>{icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:26,fontWeight:800,fontFamily:C.FM,lineHeight:1,marginBottom:4,background:`linear-gradient(135deg,${color},${color}aa)`,WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',backgroundClip:'text'}}>{value}</div>
          <div style={{fontSize:12,color:C.t2,fontWeight:600}}>{label}</div>
          {sub&&<div style={{fontSize:10,color:C.t3,marginTop:2}}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function VideoModal({ytId,title,onClose}){
  useEffect(()=>{const h=e=>{if(e.key==='Escape')onClose();};document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h);},[onClose]);
  return(
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.93)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:24,backdropFilter:'blur(8px)'}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <motion.div initial={{scale:.95,y:10}} animate={{scale:1,y:0}} exit={{scale:.95,y:10}} style={{width:'100%',maxWidth:920,...glass({padding:0,overflow:'hidden',borderRadius:20,border:`1px solid ${C.b2}`,boxShadow:'0 40px 100px rgba(0,0,0,0.9)'})}}>
        <div style={{...R({justifyContent:'space-between'}),padding:'14px 20px',borderBottom:`1px solid ${C.b1}`,background:C.s1}}>
          <div style={R({gap:10})}>
            <span style={pill('rgba(239,68,68,0.2)','#f87171',{fontSize:10})}>▶ YouTube</span>
            <span style={{fontSize:14,fontWeight:600,color:C.t1,fontFamily:C.FB}}>{title}</span>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:C.t3,fontSize:20,cursor:'pointer',width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:8}} onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>✕</button>
        </div>
        <div style={{position:'relative',paddingBottom:'56.25%',height:0}}>
          <iframe style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',border:'none'}} src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0&modestbranding=1`} title={title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/>
        </div>
      </motion.div>
    </motion.div>
  );
}

function QuizEngine({quiz,onFinish,onClose,accent=C.blue}){
  const scoreRef=useRef(0);
  const [qi,setQi]=useState(0);const [sel,setSel]=useState(null);const [conf,setConf]=useState(false);
  const [answers,setAnswers]=useState([]);const [phase,setPhase]=useState('quiz');const [ri,setRi]=useState(0);
  const tot=quiz.qs.length,q=quiz.qs[qi],prog=Math.round(((qi+(conf?1:0))/tot)*100);
  function confirm(){if(sel===null||conf)return;const ok=sel===q.ans;if(ok){scoreRef.current++;play('correct');}else play('wrong');setAnswers(a=>[...a,{q:q.q,choices:q.ch,sel,correct:q.ans,exp:q.exp,ok}]);setConf(true);}
  function next(){if(qi<tot-1){setQi(i=>i+1);setSel(null);setConf(false);}else setPhase('review');}
  if(phase==='review'){
    const pct=tot>0?Math.round((scoreRef.current/tot)*100):0;const sc=scCol(pct);const a=answers[ri];
    if(pct===100)setTimeout(()=>celebratePerfect(),100);
    return(
      <div style={{padding:28}}>
        <div style={{...glass({padding:32,background:`${sc}08`,border:`1px solid ${sc}20`,marginBottom:24,textAlign:'center'})}}>
          <Arc pct={pct} size={96} stroke={7} color={sc} label={`${pct}%`} sub="SCORE"/>
          <div style={{fontSize:22,fontWeight:800,fontFamily:C.FM,marginBottom:4,color:sc,marginTop:12}}>{scoreRef.current}/{tot} correct</div>
          <div style={{fontSize:13,color:C.t2}}>{quiz.title}</div>
          <div style={R({justifyContent:'center',gap:10,marginTop:20})}>
            <button style={btn(`linear-gradient(135deg,${sc},${sc}cc)`)} onClick={()=>onFinish(scoreRef.current,tot)}>Save & Exit →</button>
            <button style={btnG()} onClick={()=>exportQuizResult(quiz,answers,scoreRef.current,tot)}>📄 Export PDF</button>
          </div>
        </div>
        <div style={R({justifyContent:'space-between',marginBottom:16})}>
          <span style={{fontSize:10,fontWeight:700,color:C.t3,letterSpacing:'.1em',textTransform:'uppercase'}}>Review · Q {ri+1} / {tot}</span>
          <div style={R({gap:8})}>
            <button style={btnSm(C.s3,{color:C.t2})} onClick={()=>setRi(i=>Math.max(0,i-1))} disabled={ri===0}>← Prev</button>
            <button style={btnSm(C.s3,{color:C.t2})} onClick={()=>setRi(i=>Math.min(tot-1,i+1))} disabled={ri===tot-1}>Next →</button>
          </div>
        </div>
        {a&&<div style={glass()}>
          <MathText text={a.q} style={{fontSize:15,fontWeight:600,lineHeight:1.7,color:C.t1,fontFamily:C.FB,display:'block',marginBottom:18}}/>
          <div style={CC({gap:8})}>
            {a.choices.map((ch,ci)=>{const ok=ci===a.correct,bad=ci===a.sel&&!a.ok;return(
              <div key={ci} style={{...glass2({background:ok?C.greenDim:bad?C.roseDim:'rgba(255,255,255,0.02)',border:`1px solid ${ok?`${C.green}40`:bad?`${C.rose}40`:C.b1}`,padding:'12px 16px'}),display:'flex',gap:12,alignItems:'center'}}>
                <span style={{width:26,height:26,borderRadius:8,background:ok?`${C.green}20`:bad?`${C.rose}20`:C.s3,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:ok?C.green:bad?C.rose:C.t3,flexShrink:0,fontFamily:C.FM,border:`1px solid ${ok?`${C.green}40`:bad?`${C.rose}40`:C.b1}`}}>{ok?'✓':bad?'✕':String.fromCharCode(65+ci)}</span>
                <span style={{fontSize:13,color:ok?C.green:bad?C.rose:C.t2,lineHeight:1.5}}>{ch}</span>
              </div>
            );})}
          </div>
          <div style={{marginTop:16,background:C.blueDim,border:`1px solid rgba(45,127,255,0.2)`,borderRadius:10,padding:16}}>
            <div style={{fontSize:10,fontWeight:700,color:C.blueL,letterSpacing:'.1em',marginBottom:8}}>EXPLANATION</div>
            <MathText text={a.exp} style={{fontSize:13,color:C.t1,lineHeight:1.75,display:'block'}}/>
          </div>
        </div>}
        <div style={R({flexWrap:'wrap',gap:5,marginTop:16})}>
          {answers.map((ans,i)=><button key={i} onClick={()=>setRi(i)} style={{width:28,height:28,borderRadius:6,background:ans.ok?C.green:C.rose,border:'none',cursor:'pointer',fontSize:10,color:'#fff',fontWeight:700,fontFamily:C.FM,outline:ri===i?'2px solid white':undefined,outlineOffset:2,opacity:ri===i?1:.55,transition:'opacity .15s'}}>{i+1}</button>)}
        </div>
      </div>
    );
  }
  return(
    <div style={{padding:28}}>
      <div style={R({marginBottom:26})}>
        <div style={{flex:1}}>
          <div style={R({gap:8,marginBottom:10})}>
            <span style={pill(C.blueDim,C.blueL,{fontSize:10})}>{quiz.cat}</span>
            <span style={{fontSize:11,color:C.t3,fontFamily:C.FM}}>{qi+1} / {tot}</span>
          </div>
          <Bar pct={prog} color={accent} h={3} glow/>
        </div>
        <button onClick={onClose} style={btnG({padding:'6px 14px',marginLeft:16,fontSize:12})}>✕ Exit</button>
      </div>
      <MathText text={q.q} style={{fontSize:17,fontWeight:600,lineHeight:1.75,marginBottom:24,color:C.t1,fontFamily:C.FB,display:'block'}}/>
      <div style={CC({gap:10})}>
        {q.ch.map((ch,ci)=>{
          let bg='rgba(255,255,255,0.025)',brd=C.b1,tc=C.t2;
          if(sel===ci&&!conf){bg=C.blueDim;brd=`${C.blue}60`;tc=C.t1;}
          if(conf){if(ci===q.ans){bg=C.greenDim;brd=`${C.green}50`;tc=C.green;}else if(ci===sel){bg=C.roseDim;brd=`${C.rose}50`;tc=C.rose;}}
          return(
            <motion.div key={ci} whileHover={!conf?{scale:1.01}:{}} whileTap={!conf?{scale:.99}:{}} onClick={()=>{if(!conf){setSel(ci);play('select');}}}
              style={{...glass2({background:bg,border:`1px solid ${brd}30`,padding:'14px 18px'}),cursor:conf?'default':'pointer',display:'flex',alignItems:'center',gap:14,transition:'background .15s,border-color .15s'}}>
              <span style={{width:28,height:28,borderRadius:8,background:conf&&ci===q.ans?`${C.green}20`:conf&&ci===sel?`${C.rose}20`:sel===ci?C.blueDim:C.s4,border:`1px solid ${conf&&ci===q.ans?`${C.green}40`:conf&&ci===sel?`${C.rose}40`:sel===ci?`${C.blue}50`:C.b1}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:tc,flexShrink:0,fontFamily:C.FM}}>{String.fromCharCode(65+ci)}</span>
              <span style={{fontSize:14,lineHeight:1.6,color:conf?tc:sel===ci?C.t1:C.t2,fontFamily:C.FB}}>{ch}</span>
              {conf&&ci===q.ans&&<motion.span initial={{scale:0}} animate={{scale:1}} style={{marginLeft:'auto',color:C.green,fontSize:18}}>✓</motion.span>}
              {conf&&ci===sel&&ci!==q.ans&&<motion.span initial={{scale:0}} animate={{scale:1}} style={{marginLeft:'auto',color:C.rose,fontSize:18}}>✕</motion.span>}
            </motion.div>
          );
        })}
      </div>
      {conf&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} style={{marginTop:18,background:C.blueDim,border:`1px solid rgba(45,127,255,0.2)`,borderRadius:10,padding:16}}>
        <div style={{fontSize:10,fontWeight:700,color:C.blueL,letterSpacing:'.1em',marginBottom:8}}>EXPLANATION</div>
        <MathText text={q.exp} style={{fontSize:13,color:C.t1,lineHeight:1.75,display:'block'}}/>
      </motion.div>}
      <div style={{marginTop:22,...R({justifyContent:'flex-end',gap:10})}}>
        {!conf&&sel!==null&&<button style={btn()} onClick={confirm}>Confirm Answer →</button>}
        {conf&&<button style={btn()} onClick={next}>{qi<tot-1?'Next Question →':'View Results'}</button>}
      </div>
    </div>
  );
}

function FlipCard({card,flipped,onClick}){
  const ret=getRetainability(card);const nxt=card.due?nextReviewLabel(card):null;
  return(
    <div onClick={()=>{onClick();play('flip');}} style={{perspective:1200,cursor:'pointer',width:'100%',minHeight:260}}>
      <motion.div animate={{rotateY:flipped?180:0}} transition={{duration:.55,ease:[.16,1,.3,1]}} style={{position:'relative',width:'100%',minHeight:260,transformStyle:'preserve-3d'}}>
        <div style={{position:'absolute',inset:0,backfaceVisibility:'hidden',WebkitBackfaceVisibility:'hidden',...glass({display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',flexDirection:'column',gap:16,padding:36})}}>
          {nxt&&<div style={{...pill(C.blueDim,C.blueL,{fontSize:10,position:'absolute',top:16,right:16})}}>{`Next: ${nxt}`}</div>}
          <div style={{fontSize:10,fontWeight:700,color:C.t3,letterSpacing:'.14em',textTransform:'uppercase'}}>QUESTION · Tap to reveal</div>
          <MathText text={card.front} style={{fontSize:18,fontWeight:600,lineHeight:1.65,color:C.t1,fontFamily:C.FD,display:'block'}}/>
          <div style={R({gap:5,justifyContent:'center',marginTop:4})}>{[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:'50%',background:C.s5}}/>)}</div>
        </div>
        <div style={{position:'absolute',inset:0,backfaceVisibility:'hidden',WebkitBackfaceVisibility:'hidden',transform:'rotateY(180deg)',background:`linear-gradient(135deg,${C.blueDim},rgba(6,182,212,0.08))`,border:`1px solid rgba(45,127,255,0.2)`,borderRadius:16,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',flexDirection:'column',gap:16,padding:36}}>
          <div style={{fontSize:10,fontWeight:700,color:C.blueL,letterSpacing:'.14em',textTransform:'uppercase'}}>ANSWER</div>
          <MathText text={card.back} style={{fontSize:16,lineHeight:1.8,color:C.t1,fontFamily:C.FB,display:'block'}}/>
          {ret!==null&&<div style={{...pill(C.greenDim,C.greenL,{fontSize:10,marginTop:4})}}>Retention: {ret}%</div>}
        </div>
      </motion.div>
    </div>
  );
}

function showAchievementToast(achievement) {
  play('achieve');
  celebrateAchievement();
  toast.custom((t) => (
    <motion.div initial={{scale:.8,opacity:0,y:-20}} animate={{scale:1,opacity:1,y:0}} exit={{scale:.8,opacity:0}} style={{background:C.s1,border:`1px solid ${C.amber}40`,borderRadius:14,padding:'14px 18px',display:'flex',alignItems:'center',gap:14,boxShadow:`0 8px 32px rgba(0,0,0,0.6),0 0 0 1px ${C.amber}20`,maxWidth:320,fontFamily:C.FB,cursor:'pointer'}} onClick={()=>toast.dismiss(t.id)}>
      <div style={{fontSize:30}}>{achievement.icon}</div>
      <div>
        <div style={{fontSize:12,fontWeight:700,color:C.amberL,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:2}}>Achievement Unlocked!</div>
        <div style={{fontSize:14,fontWeight:700,color:C.t1}}>{achievement.name}</div>
        <div style={{fontSize:12,color:C.t2,marginTop:2}}>{achievement.desc}</div>
        <div style={{...pill(C.amberDim,C.amberL,{fontSize:10,marginTop:6})}}>+{achievement.xp} XP</div>
      </div>
    </motion.div>
  ), { duration:5000 });
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [dbReady, setDbReady] = useState(false);

  // ── Core state ──────────────────────────────────────────────────────────────
  const [user,     setUser_]    = useState(null);
  const [pathway,  setPathway_] = useState({});
  const [qScores,  setQScores_] = useState({});
  const [qHistory, setQHistory] = useState([]);
  const [cDecks,   setCDecks_]  = useState({});
  const [port,     setPort_]    = useState([]);
  const [catPerf,  setCatPerf_] = useState({});
  const [achiev,   setAchiev_]  = useState(new Set());
  const [streak,   setStreak]   = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [mmiCount, setMmiCount] = useState(0);
  const [aiChatCount, setAiChatCount] = useState(0);

  // ── Face ID state ───────────────────────────────────────────────────────────
  const [faceDescriptor, setFaceDescriptor] = useState(null);
  const [hasFaceId,      setHasFaceId]      = useState(false);
  const [faceLoginMode,  setFaceLoginMode]  = useState(false);
  // FIX: pendingUser holds new-user data while face setup is in progress.
  // We do NOT call saveUser() until face enrollment succeeds or is skipped,
  // so `user` stays null during onboarding face setup. This prevents the
  // settings re-enroll overlay from stealing the render.
  const [pendingUser,    setPendingUser]    = useState(null);
  const [onboardStep,    setOnboardStep]    = useState('name'); // 'name' | 'faceSetup'

  // ── UI state ────────────────────────────────────────────────────────────────
  const [tab,   setTab]   = useState('home');
  const [uname, setUname] = useState('');
  const [vidM,  setVM]    = useState(null);

  // ── Diagnostic ──────────────────────────────────────────────────────────────
  const [dStep,setDS]=useState(0);const [dAns,setDA]=useState([]);const [dDone,setDD]=useState(false);const [dRes,setDR]=useState(null);

  // ── Quiz ────────────────────────────────────────────────────────────────────
  const [aQuiz,setAQ]=useState(null);const [qSrch,setQSrch]=useState('');const [qCat,setQC]=useState('All');const [qDiff,setQD]=useState('All');

  // ── AI Coach ────────────────────────────────────────────────────────────────
  const [msgs,setMsgs]=useState([]);const [ci,setCi]=useState('');const [cLoad,setCLoad]=useState(false);const chatEnd=useRef(null);

  // ── Flashcards ──────────────────────────────────────────────────────────────
  const [activeDeck,setAD]=useState(null);const [cIdx,setCIdx]=useState(0);const [flip,setFlip]=useState(false);const [notes,setNotes]=useState('');const [gLoad,setGL]=useState(false);const [dSrch,setDS2]=useState('');const [studyMode,setStudyMode]=useState('all');

  // ── Library ─────────────────────────────────────────────────────────────────
  const [lSrch,setLS]=useState('');const [lCat,setLC]=useState('All');

  // ── Portfolio ───────────────────────────────────────────────────────────────
  const [aN,setAN]=useState('');const [aT,setAT]=useState('Clinical');const [aH,setAH]=useState('');const [aDate,setADate]=useState('');const [cF,setCF]=useState('All');

  // ── Interview ───────────────────────────────────────────────────────────────
  const [mIdx,setMI]=useState(0);const [mAns,setMA]=useState('');const [mFb,setMF]=useState('');const [mLoad,setML]=useState(false);const [mTimer,setMT]=useState(0);const [mRun,setMR]=useState(false);const [mTF,setMTF]=useState('All');

  // ── Calc ────────────────────────────────────────────────────────────────────
  const [cGPA,setCGPA]=useState('');const [cMCAT,setCMCAT]=useState('');const [cRes,setCR]=useState('0');const [cClin,setCC]=useState('0');const [cVol,setCV]=useState('0');const [cSt,setCST]=useState('');const [sType,setST]=useState('All');

  // ── Settings ────────────────────────────────────────────────────────────────
  const [sName,setSN]=useState('');const [sSpec,setSS]=useState('');const [sfxOn,setSfxOn]=useState(true);

  // ── Pomodoro ────────────────────────────────────────────────────────────────
  const [pomT,setPT]=useState(25*60);const [pomR,setPR]=useState(false);const [pomM,setPomM]=useState('focus');const [pomSessions,setPomSessions]=useState(0);

  // ── DB Init ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    async function init(){
      try{
        const [u,pw,qs,qh,decks,portfolio,cp,ach,str,rev,mmi,hasId,desc] = await Promise.all([
          DB.getUser(), DB.getPathway(), DB.getQuizScores(), DB.getQuizHistory(),
          DB.getFlashDecks(), DB.getPortfolio(), DB.getCatPerf(),
          DB.getAchievements(), DB.getStreak(), DB.getTotalCardReviews(), DB.getMMICount(),
          DB.hasFaceDescriptor(), DB.getFaceDescriptor(),
        ]);
        if(u){setUser_(u);}
        setPathway_(pw||{});
        setQScores_(qs||{});
        setQHistory(qh||[]);
        const allDecks={};
        Object.entries(decks||{}).forEach(([name,cards])=>{allDecks[name]=cards;});
        setCDecks_(allDecks);
        setPort_(portfolio||[]);
        setCatPerf_(cp||{});
        setAchiev_(ach||new Set());
        setStreak(str||0);
        setTotalReviews(rev||0);
        setMmiCount(mmi||0);
        setHasFaceId(hasId||false);
        setFaceDescriptor(desc||null);
        if(hasId && !u){setFaceLoginMode(true);}
        await DB.recordStudyToday();
      }catch(e){console.error('DB init error:',e);}
      setDbReady(true);
    }
    init();
  },[]);

  // ── Optimistic save helpers ──────────────────────────────────────────────────
  const saveUser = useCallback((u)=>{ setUser_(u); DB.saveUser(u).catch(console.error); },[]);
  const saveLesson = useCallback((lessonId)=>{ setPathway_(pw=>({...pw,[lessonId]:Date.now()})); DB.setLessonDone(lessonId).catch(console.error); },[]);
  const saveQuizScore = useCallback(async(quizId,score)=>{ setQScores_(q=>({...q,[quizId]:score})); await DB.saveQuizScore(quizId,score); const h=await DB.getQuizHistory(); setQHistory(h); },[]);
  const saveDeck = useCallback(async(name,cards)=>{ setCDecks_(d=>({...d,[name]:cards})); await DB.saveDeck(name,cards); },[]);
  const deleteDeck_ = useCallback(async(name)=>{ setCDecks_(d=>{const nd={...d};delete nd[name];return nd;}); await DB.deleteDeck(name); },[]);
  const saveCatPerf = useCallback((cat,score)=>{ setCatPerf_(cp=>({...cp,[cat]:{ total:(cp[cat]?.total||0)+score, count:(cp[cat]?.count||0)+1 }})); DB.updateCatPerf(cat,score).catch(console.error); },[]);

  // ── Timers ───────────────────────────────────────────────────────────────────
  useEffect(()=>{if(!pomR)return;const id=setInterval(()=>setPT(t=>t>0?t-1:0),1000);return()=>clearInterval(id);},[pomR]);
  useEffect(()=>{if(pomT===0&&pomR){setPR(false);play('bell');const n=pomM==='focus'?'break':'focus';setPomM(n);setPT(n==='focus'?25*60:5*60);if(pomM==='focus')setPomSessions(s=>s+1);toast.success(pomM==='focus'?'Focus session complete! Take a break ☕':'Break over. Back to studying! 📚');}},[ pomT,pomR,pomM]);
  useEffect(()=>{if(!mRun)return;const id=setInterval(()=>setMT(t=>t+1),1000);return()=>clearInterval(id);},[mRun]);
  useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:'smooth'});},[msgs]);

  // ── Computed values ──────────────────────────────────────────────────────────
  const eSpec   = user?.specialty||'surgeon';
  const curPath = PATHS[eSpec]||PATHS['surgeon'];
  const accent  = curPath?.accent||C.blue;
  const allL    = Object.values(PATHS).flatMap(p=>(p.units||[]).flatMap(u=>u.lessons||[]));
  const doneL   = allL.filter(l=>pathway[l.id]).length;
  const mastery = allL.length>0?Math.round((doneL/allL.length)*100):0;
  const lvl     = user?Math.floor((user.xp||0)/250)+1:1;
  const xpIn    = user?(user.xp||0)%250:0;
  const qTaken  = Object.keys(qScores).length;
  const avgSc   = qTaken>0?Math.round(Object.values(qScores).reduce((a,b)=>a+b,0)/qTaken):0;
  const cats3   = ['Bio/Biochem','Chem/Phys','Psych/Soc'];
  const secAvgs = cats3.map(cat=>{const cQ=ALL_QUIZZES.filter(q=>q.cat===cat);const tk=cQ.filter(q=>qScores[q.id]!==undefined);return tk.length?Math.round(tk.reduce((s,q)=>s+qScores[q.id],0)/tk.length):null;});
  const predMCAT = secAvgs.every(v=>v!==null) ? secAvgs.reduce((s,v)=>s+scoreToSection(v),0) : null;
  const allCards = useMemo(()=>Object.values(cDecks).flat(),[cDecks]);
  const dueCards = useMemo(()=>getDueCards(allCards).length,[allCards]);

  const unitM = (unit)=>unit?.lessons?.length?Math.round(unit.lessons.filter(l=>pathway[l.id]).length/unit.lessons.length*100):0;
  const lessonState = (lesson,ui,units)=>{if(pathway[lesson.id])return'done';if(ui===0)return'available';const prev=units[ui-1];if(!prev)return'available';return prev.lessons.every(l=>pathway[l.id])?'available':'locked';};

  function doneLesson(lesson){
    if(pathway[lesson.id])return;
    saveLesson(lesson.id);
    const xpGain=25;
    const newUser={...user,xp:(user?.xp||0)+xpGain};
    saveUser(newUser);
    play('xp');celebrateXP();
    toast.success(`+${xpGain} XP — ${lesson.title}`,{icon:'📚',duration:2500});
    const units=curPath?.units||[];
    const unit=units.find(u=>u.lessons.some(l=>l.id===lesson.id));
    if(unit){const allDone=unit.lessons.every(l=>l.id===lesson.id?true:pathway[l.id]);if(allDone){setTimeout(()=>celebrateMastery(),400);toast.success(`Unit mastered: ${unit.title}! 🎓`,{duration:4000});}}
    checkAndUnlockAchievements({...user,xp:(user?.xp||0)+xpGain},Object.keys(qScores).length,qHistory.filter(q=>q.score===100).length,streak,totalReviews,mmiCount,mastery,aiChatCount);
  }

  function switchPath(sp){if(!PATHS[sp]||!user)return;saveUser({...user,specialty:sp});toast(`Switched to ${PATHS[sp]?.label} pathway`,{icon:'🔄'});}

  function signOut(){
    DB.clearAllData().then(()=>{
      setUser_(null);setPathway_({});setQScores_({});setCDecks_({});setPort_([]);
      setCatPerf_({});setAchiev_(new Set());setStreak(0);setTab('home');
      setFaceDescriptor(null);setHasFaceId(false);setFaceLoginMode(false);
      // FIX: also clear pendingUser and onboardStep on sign-out
      setPendingUser(null);setOnboardStep('name');
    });
    toast('Signed out. See you next time!');
  }

  const checkAndUnlockAchievements = useCallback(async(u,qCount,perfect,str,reviews,mmiC,mast,aiC)=>{
    const unlocked = await DB.getAchievements();
    const toUnlock = checkAchievements({level:u?Math.floor((u.xp||0)/250)+1:1,quizCount:qCount,perfectScores:perfect,streak:str,cardReviews:reviews,mmiCount:mmiC,mastery:mast,aiChats:aiC,unlocked});
    for(const achievement of toUnlock){
      const isNew = await DB.unlockAchievement(achievement.key);
      if(isNew){
        setAchiev_(prev=>new Set([...prev,achievement.key]));
        const bonusXP=achievement.xp||0;
        if(u&&bonusXP>0){const nu={...u,xp:(u.xp||0)+bonusXP};saveUser(nu);}
        showAchievementToast(achievement);
      }
    }
  },[saveUser]);

  const prevLvlRef = useRef(1);
  useEffect(()=>{
    if(!user)return;
    const curLvl=Math.floor((user.xp||0)/250)+1;
    if(curLvl>prevLvlRef.current){celebrateLevelUp();play('levelUp');toast.success(`Level ${curLvl} reached! 🏆 You're on fire!`,{duration:4000,icon:'⭐'});}
    prevLvlRef.current=curLvl;
  },[user?.xp]);

  // ── AI ────────────────────────────────────────────────────────────────────────
  async function callAI(sys,msg,toks=700,hist=null){
    const r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({system:sys,message:msg,messages:hist,maxTokens:toks})});
    const d=await r.json();
    if(!r.ok){const m=d?.error||'';if(r.status===429)throw new Error('Rate limit reached. Please wait a moment.');if(r.status===500&&m.includes('not configured'))throw new Error(AI_MSG);throw new Error(m||`Error ${r.status}`);}
    return d.content||'';
  }

  async function sendChat(message){
    if(!message.trim()||cLoad)return;
    const um={role:'user',content:message};const next=[...msgs,um];
    setMsgs(next);setCi('');setCLoad(true);
    const newCount=aiChatCount+1;setAiChatCount(newCount);
    try{
      const r=await callAI(`You are MetaBrain, an expert MCAT tutor and medical school admissions coach. The student is interested in ${curPath?.label||'medicine'}. Be concise, accurate, and encouraging. Format responses with markdown — use **bold** for key terms, bullet lists for steps, and code blocks for formulas when helpful.`,message,700,next.filter(m=>m.role!=='error'));
      setMsgs(m=>[...m,{role:'assistant',content:r}]);
      checkAndUnlockAchievements(user,qTaken,qHistory.filter(q=>q.score===100).length,streak,totalReviews,mmiCount,mastery,newCount);
    }catch(e){setMsgs(m=>[...m,{role:'error',content:e.message}]);toast.error(e.message.slice(0,80));}
    setCLoad(false);
  }

  async function genDeck(){
    if(!notes.trim()||gLoad)return;setGL(true);
    const tid=toast.loading('Generating AI flashcards…');
    try{
      const raw=await callAI(`You are an MCAT flashcard generator. Return ONLY a JSON array of objects with "front" (question) and "back" (answer) string properties. No markdown, no preamble, no code blocks. Generate 10-14 high-yield MCAT flashcards.`,`Generate MCAT flashcards from these notes:\n\n${notes}`,1200);
      const cards=JSON.parse(raw.replace(/```json|```/g,'').trim());
      if(!Array.isArray(cards)||cards.length<3)throw new Error('Invalid response — try again');
      const deckName=`AI Deck — ${new Date().toLocaleDateString()}`;
      await saveDeck(deckName,cards);
      setNotes('');setAD({name:deckName,cards,builtin:false});setCIdx(0);setFlip(false);
      toast.dismiss(tid);toast.success(`Generated ${cards.length} flashcards!`);
    }catch(e){toast.dismiss(tid);toast.error(`Generation failed: ${e.message.slice(0,80)}`);}
    setGL(false);
  }

  async function getMMIFb(){
    if(!mAns.trim()||mLoad)return;setML(true);setMF('');
    const q=fMmi[mIdx];const tid=toast.loading('Analyzing your response…');
    try{
      const fb=await callAI(`You are an experienced medical school admissions interviewer and MMI coach. Evaluate this MMI response on 5 dimensions. Format EXACTLY as:\n**Structure:** X/10 — [one line]\n**Content:** X/10 — [one line]\n**Empathy:** X/10 — [one line]\n**Communication:** X/10 — [one line]\n**Overall:** X/10 — [one line]\n\n[2-3 sentence overall feedback paragraph with specific improvement suggestion]`,`MMI Question Type: ${q.type}\nQuestion: ${q.q}\n\nStudent Response (${fmtT(mTimer)} elapsed):\n${mAns}`,700);
      setMF(fb);
      await DB.recordMMISession(mIdx);
      const newMmi=mmiCount+1;setMmiCount(newMmi);
      checkAndUnlockAchievements(user,qTaken,qHistory.filter(q=>q.score===100).length,streak,totalReviews,newMmi,mastery,aiChatCount);
      toast.dismiss(tid);toast.success('AI feedback ready!');
    }catch(e){toast.dismiss(tid);toast.error(e.message.slice(0,80));setMF(`AI feedback unavailable: ${e.message}`);}
    setML(false);
  }

  async function finishQuiz(score,total){
    const pct=total>0?Math.round((score/total)*100):0;
    await saveQuizScore(aQuiz.id,pct);
    saveCatPerf(aQuiz.cat,pct);
    const xpGain=Math.round(pct*0.5);
    const newUser={...user,xp:(user?.xp||0)+xpGain};
    saveUser(newUser);
    toast.success(`${pct}% · +${xpGain} XP`,{icon:pct>=80?'🌟':pct>=60?'📊':'💪',duration:3000});
    checkAndUnlockAchievements(newUser,qTaken+1,qHistory.filter(q=>q.score===100).length+(pct===100?1:0),streak,totalReviews,mmiCount,mastery,aiChatCount);
    if(pct===100)setTimeout(()=>celebratePerfect(),300);
    setAQ(null);
  }

  function finalizeDiag(answers){
    const counts={surgeon:0,internist:0,psychiatrist:0,researcher:0,pediatrician:0,emergency_doc:0};
    const pm={biochem:['surgeon','pediatrician'],chemphys:['internist','emergency_doc'],psychsoc:['psychiatrist','pediatrician'],research:['researcher','internist']};
    answers.forEach((ans,i)=>{const q=DIAG_QS[i];const k=q?.map?.[ans];if(k&&pm[k])pm[k].forEach(sp=>{if(counts[sp]!==undefined)counts[sp]++;});});
    setDR(Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'internist');setDD(true);
  }

  const quizFuse = useMemo(()=>buildQuizSearch(ALL_QUIZZES),[]);
  const libFuse  = useMemo(()=>buildLibrarySearch(ELIB),[]);
  const fQuiz    = useMemo(()=>{ const s=fuseSearch(quizFuse,qSrch)||ALL_QUIZZES; return s.filter(q=>(qCat==='All'||q.cat===qCat)&&(qDiff==='All'||q.diff===qDiff)); },[quizFuse,qSrch,qCat,qDiff]);
  const fLib     = useMemo(()=>{ const res=fuseSearch(libFuse,lSrch)||ELIB; return lCat==='All'?res:res.filter(r=>r.cat===lCat); },[libFuse,lSrch,lCat]);
  const fMmi     = useMemo(()=>mTF==='All'?MMI_QS:MMI_QS.filter(q=>q.type===mTF),[mTF]);
  const mmiQ     = fMmi[mIdx]||MMI_QS[0];
  const fComp    = useMemo(()=>cF==='All'?COMPETITIONS:COMPETITIONS.filter(c=>c.type===cF||c.level===cF),[cF]);
  const hasCalc  = cGPA&&cMCAT;
  const calcR    = useMemo(()=>hasCalc?SCHOOL_DATA.filter(s=>sType==='All'||s.type===sType).map(s=>scoreSchool(s,cGPA,cMCAT,cRes,cClin,cVol,cSt)).sort((a,b)=>b.score-a.score):[],[cGPA,cMCAT,cRes,cClin,cVol,cSt,sType,hasCalc]);
  const allDecksList = useMemo(()=>[
    ...Object.entries(FLASH_DECKS).map(([n,c])=>({name:n,cards:c,builtin:true})),
    ...Object.entries(cDecks).map(([n,c])=>({name:n,cards:c,builtin:false})),
  ].filter(d=>!dSrch||d.name.toLowerCase().includes(dSrch.toLowerCase())),[cDecks,dSrch]);
  const deckCards = useMemo(()=>{
    if(!activeDeck)return[];
    const cards=activeDeck.builtin?FLASH_DECKS[activeDeck.name]||(cDecks[activeDeck.name]||[]):cDecks[activeDeck.name]||[];
    return studyMode==='due'?sortForStudy(getDueCards(cards)):cards;
  },[activeDeck,cDecks,studyMode]);
  const currentCard = deckCards[cIdx];

  // ── Face ID handlers ──────────────────────────────────────────────────────────

  // FIX: createUserAndProceed no longer calls saveUser() immediately.
  // Instead it stores the user object in pendingUser so `user` stays null,
  // keeping the onboarding face-setup render path reachable.
  function createUserAndProceed() {
    if (!uname.trim()) return;
    const u = { name:uname.trim(), specialty:'internist', xp:0, streak:1, lastActive:Date.now() };
    setPendingUser(u);
    setOnboardStep('faceSetup');
    toast.success(`Great to meet you, ${uname.trim()}! Let's set up Face ID…`);
  }

  // FIX: commit pendingUser to DB when face enrollment succeeds
  async function handleFaceEnrollSuccess(descriptor) {
    if (pendingUser) {
      saveUser(pendingUser);
      setPendingUser(null);
    }
    setFaceDescriptor(descriptor);
    setHasFaceId(true);
    setOnboardStep('name');
    setTab('diagnostic');
    toast.success('Face ID enabled! You can now log in instantly 👤', { duration:4000 });
  }

  // FIX: commit pendingUser to DB when face enrollment is skipped
  function handleFaceEnrollSkip() {
    if (pendingUser) {
      saveUser(pendingUser);
      setPendingUser(null);
    }
    setOnboardStep('name');
    setTab('diagnostic');
    toast('No problem! You can set up Face ID anytime in Settings.');
  }

  async function handleFaceLoginSuccess() {
    const u = await DB.getUser();
    if (u) {
      setUser_(u);
      await DB.recordStudyToday();
      toast.success(`Welcome back, ${u.name}! 👤`, { duration:3000 });
    } else {
      setFaceLoginMode(false);
      setHasFaceId(false);
    }
  }

  async function handleRemoveFaceId() {
    await DB.clearFaceDescriptor();
    setFaceDescriptor(null);
    setHasFaceId(false);
    toast('Face ID removed. You can re-enroll at any time.');
  }

  // ═══ TAB RENDERS ══════════════════════════════════════════════════════════════
  const SL = ({children,extra={}}) => <div style={{fontSize:10,fontWeight:700,color:C.t3,letterSpacing:'.12em',textTransform:'uppercase',marginBottom:16,...extra}}>{children}</div>;

  function tHome(){
    const units=curPath?.units||[];
    return(
      <div style={CC({gap:22})}>
        <div style={{...glass({padding:28}),background:'linear-gradient(135deg,rgba(45,127,255,0.08),rgba(6,182,212,0.04))',border:`1px solid rgba(45,127,255,0.15)`,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',right:-60,top:-60,width:200,height:200,borderRadius:'50%',background:`radial-gradient(circle,${accent}10,transparent 70%)`,pointerEvents:'none'}}/>
          <div style={{position:'absolute',right:20,top:20,opacity:.08,fontSize:80,lineHeight:1,pointerEvents:'none'}}>🧬</div>
          <div style={{position:'relative'}}>
            <div style={{fontSize:11,fontWeight:700,color:C.blueL,letterSpacing:'.12em',textTransform:'uppercase',marginBottom:10}}>Welcome back</div>
            <h1 style={{fontSize:30,fontWeight:800,color:C.t1,margin:'0 0 12px',letterSpacing:'-.03em',fontFamily:C.FD,lineHeight:1.15}}>{user.name}</h1>
            <div style={R({gap:8,flexWrap:'wrap'})}>
              <span style={pill(`${accent}22`,accent)}>{curPath?.label}</span>
              <span style={pill(C.s3,C.t2,{fontFamily:C.FM})}>Level {lvl}</span>
              {streak>0&&<span style={pill(C.amberDim,C.amberL)}>🔥 {streak} day streak</span>}
              {dueCards>0&&<span style={pill(C.violetDim,C.violetL)}>📚 {dueCards} cards due</span>}
              {predMCAT&&<span style={pill(C.greenDim,C.greenL,{fontFamily:C.FM})}>~{predMCAT} predicted</span>}
              {hasFaceId&&<span style={pill(`${C.blue}18`,C.blueL,{fontSize:10})}>👤 Face ID On</span>}
            </div>
          </div>
        </div>
        <div style={G(4,14)}>
          <Stat label="Total XP" value={(user.xp||0).toLocaleString()} icon="⭐" color={C.amber} sub={`${250-xpIn} to Level ${lvl+1}`}/>
          <Stat label="Level" value={lvl} icon="🏆" color={C.violet} sub={`${Math.floor((xpIn/250)*100)}% to next`}/>
          <Stat label="Quizzes Done" value={qTaken} icon="✅" color={C.green} sub={`${ALL_QUIZZES.length-qTaken} remaining`}/>
          <Stat label="Mastery" value={`${mastery}%`} icon="📈" color={accent} sub={`${doneL}/${allL.length} lessons`}/>
        </div>
        <div style={glass({padding:18})}>
          <div style={R({justifyContent:'space-between',marginBottom:10})}>
            <div><span style={{fontSize:13,fontWeight:700,color:C.t1,fontFamily:C.FD}}>Level {lvl}</span><span style={{fontSize:12,color:C.t3,marginLeft:8}}>→ Level {lvl+1}</span></div>
            <span style={{fontSize:12,fontFamily:C.FM,color:C.blueL,fontWeight:600}}>{xpIn} / 250 XP</span>
          </div>
          <Bar pct={(xpIn/250)*100} color={accent} h={8} glow/>
        </div>
        <div>
          <SL>Quick Actions</SL>
          <div style={G(3,14)}>
            {[
              {ic:'🧭',lbl:'Diagnostic',sub:'Find your specialty',tab:'diagnostic',col:C.violet},
              {ic:'📚',lbl:'Pathway',sub:`${doneL}/${allL.length} lessons`,tab:'pathway',col:accent},
              {ic:'❓',lbl:'Quiz Library',sub:`${qTaken}/${ALL_QUIZZES.length} taken`,tab:'quizzes',col:C.green},
              {ic:'🤖',lbl:'AI Coach',sub:'MetaBrain tutor',tab:'coach',col:C.cyan},
              {ic:'🃏',lbl:'Flashcards',sub:`${dueCards>0?`${dueCards} due now`:`${Object.keys(FLASH_DECKS).length+Object.keys(cDecks).length} decks`}`,tab:'flashcards',col:dueCards>0?C.violet:C.orange},
              {ic:'🏥',lbl:'Admissions',sub:'School list builder',tab:'calc',col:C.rose},
            ].map((a,i)=>(
              <motion.div key={i} whileHover={{y:-3,boxShadow:`0 12px 40px rgba(0,0,0,0.5),0 0 0 1px ${a.col}30`}} whileTap={{scale:.98}}
                onClick={()=>{setTab(a.tab);play('click');}}
                style={{...glass({padding:20}),cursor:'pointer',transition:'border-color .2s',position:'relative',overflow:'hidden'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=`${a.col}35`}
                onMouseLeave={e=>e.currentTarget.style.borderColor=C.b1}>
                <div style={{position:'absolute',top:-20,right:-20,width:60,height:60,borderRadius:'50%',background:`${a.col}08`,pointerEvents:'none'}}/>
                <div style={{width:40,height:40,borderRadius:10,background:`${a.col}15`,border:`1px solid ${a.col}20`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19,marginBottom:12,boxShadow:`0 4px 12px ${a.col}20`}}>{a.ic}</div>
                <div style={{fontSize:14,fontWeight:700,color:C.t1,fontFamily:C.FD,marginBottom:3}}>{a.lbl}</div>
                <div style={{fontSize:11,color:C.t3}}>{a.sub}</div>
              </motion.div>
            ))}
          </div>
        </div>
        {achiev.size>0&&<div style={glass({padding:18})}>
          <SL extra={{marginBottom:12}}>Achievements Unlocked ({achiev.size}/{Object.keys(ACHIEVEMENTS).length})</SL>
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            {Object.values(ACHIEVEMENTS).map(a=>{const has=achiev.has(a.key);return<div key={a.key} title={`${a.name}: ${a.desc}`} style={{width:40,height:40,borderRadius:10,background:has?`${C.amber}18`:'rgba(255,255,255,0.04)',border:`1px solid ${has?`${C.amber}30`:C.b1}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,opacity:has?1:.3,cursor:'default',transition:'all .2s'}}>{a.icon}</div>;})}
          </div>
        </div>}
        {predMCAT&&<div style={{...glass({padding:20}),background:`linear-gradient(135deg,${C.greenDim},${C.blueDim})`,border:`1px solid ${C.green}20`}}>
          <div style={R({gap:14})}>
            <div style={{width:52,height:52,borderRadius:12,background:`${C.green}15`,border:`1px solid ${C.green}25`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <div style={{fontSize:18,fontWeight:800,fontFamily:C.FM,color:C.green,lineHeight:1}}>{predMCAT}</div>
              <div style={{fontSize:9,color:C.greenL,letterSpacing:'.05em'}}>MCAT</div>
            </div>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.t1,fontFamily:C.FD,marginBottom:3}}>Predicted MCAT Score</div>
              <div style={{fontSize:12,color:C.t2,lineHeight:1.5}}>Based on your quiz performance across all 3 sections.</div>
              <div style={{...R({gap:8,marginTop:8})}}>
                {cats3.map((cat,i)=>secAvgs[i]!==null&&<span key={cat} style={pill(`${scCol(secAvgs[i])}18`,scCol(secAvgs[i]),{fontSize:10})}>{cat.split('/')[0]}: {scoreToSection(secAvgs[i])}</span>)}
              </div>
            </div>
          </div>
        </div>}
        <div style={glass()}>
          <div style={R({justifyContent:'space-between',marginBottom:18})}>
            <div><SL extra={{marginBottom:4}}>Current Pathway</SL><div style={{fontSize:17,fontWeight:700,color:C.t1,fontFamily:C.FD}}>{curPath?.label}</div></div>
            <Arc pct={mastery} size={60} stroke={5} color={accent} label={`${mastery}%`}/>
          </div>
          <div style={CC({gap:10})}>
            {units.map((u)=>{const p=unitM(u);return(
              <div key={u.id} style={R({gap:12})}>
                <div style={{width:8,height:8,borderRadius:'50%',background:p===100?C.green:p>0?accent:C.s4,flexShrink:0,boxShadow:p>0?`0 0 6px ${p===100?C.green:accent}`:undefined}}/>
                <div style={{flex:1}}>
                  <div style={R({justifyContent:'space-between',marginBottom:5})}>
                    <span style={{fontSize:12,color:p===100?C.green:C.t2,fontWeight:p===100?700:400}}>{u.title}</span>
                    <span style={{fontSize:11,fontFamily:C.FM,color:C.t3}}>{p}%</span>
                  </div>
                  <Bar pct={p} color={p===100?C.green:accent} h={3} glow={p>40}/>
                </div>
              </div>
            );})}
          </div>
          <button onClick={()=>setTab('pathway')} style={btnG({marginTop:18,width:'100%',justifyContent:'center'})}>View Full Pathway →</button>
        </div>
      </div>
    );
  }

  function tDiag(){
    if(dDone&&dRes){const path=PATHS[dRes];return(
      <div style={CC({gap:22})}>
        <div><div style={lbl()}>Specialty Diagnostic</div><h2 style={{fontSize:26,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>Your Match</h2></div>
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} style={{...glass({padding:40,textAlign:'center',background:`linear-gradient(135deg,${C.blueDim},rgba(6,182,212,0.05))`,border:`1px solid rgba(45,127,255,0.2)`})}}>
          <div style={{width:80,height:80,borderRadius:'50%',background:`${accent}18`,border:`2px solid ${accent}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,margin:'0 auto 20px',boxShadow:`0 0 30px ${accent}30`}}>🩺</div>
          <h2 style={{fontSize:30,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:'0 0 14px'}}>{path?.label}</h2>
          <p style={{color:C.t2,maxWidth:460,margin:'0 auto 28px',lineHeight:1.75,fontSize:14}}>Your interests and academic strengths align with the <strong style={{color:C.t1}}>{path?.label}</strong> path.</p>
          <div style={R({justifyContent:'center',gap:12})}>
            <button style={btn(C.blueGrad,{padding:'12px 32px',fontSize:14})} onClick={()=>{saveUser({...user,specialty:dRes});setDD(false);setDS(0);setDA([]);setTab('pathway');toast.success(`${path?.label} pathway activated!`);}}>Accept & Start Pathway →</button>
            <button style={btnG({padding:'12px 24px'})} onClick={()=>{setDD(false);setDS(0);setDA([]);}}>Retake</button>
          </div>
        </motion.div>
        <div style={glass({padding:18})}>
          <SL>Explore Other Paths</SL>
          <div style={G(3,10)}>
            {Object.entries(PATHS).filter(([k])=>k!==dRes).map(([key,p])=>(
              <motion.div key={key} whileHover={{borderColor:`${p.accent}40`,background:`${p.accent}08`}} onClick={()=>{saveUser({...user,specialty:key});setDD(false);setDS(0);setDA([]);setTab('pathway');}} style={{...glass2({cursor:'pointer',textAlign:'center',padding:14,transition:'background .15s'})}}>
                <div style={{fontSize:13,fontWeight:700,color:p.accent,fontFamily:C.FD}}>{p.label}</div>
                <div style={{fontSize:11,color:C.t3,marginTop:3}}>{p.units.length} units</div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );}
    const q=DIAG_QS[dStep];if(!q)return null;
    return(
      <div style={CC({gap:22})}>
        <div style={R()}>
          <div><div style={lbl()}>Specialty Diagnostic</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>Q{dStep+1} <span style={{color:C.t3,fontWeight:400}}>/ {DIAG_QS.length}</span></h2></div>
          <div style={{marginLeft:'auto'}}><Arc pct={(dStep/DIAG_QS.length)*100} size={52} stroke={4} color={accent} label={`${dStep+1}/${DIAG_QS.length}`}/></div>
        </div>
        <Bar pct={(dStep/DIAG_QS.length)*100} color={accent} h={3}/>
        <motion.div key={dStep} initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} style={glass({padding:28})}>
          <p style={{fontSize:16,fontWeight:600,lineHeight:1.75,marginBottom:22,color:C.t1,fontFamily:C.FB}}>{q.q}</p>
          <div style={CC({gap:10})}>
            {q.ch.map((ch,ci)=>(
              <motion.div key={ci} whileHover={{background:C.blueDim,borderColor:`${C.blue}40`}} whileTap={{scale:.98}}
                onClick={()=>{const next=[...dAns,ci];setDA(next);play('select');if(dStep<DIAG_QS.length-1)setDS(s=>s+1);else finalizeDiag(next);}}
                style={{...glass2({padding:'15px 18px',cursor:'pointer',transition:'all .15s'}),display:'flex',alignItems:'center',gap:14}}>
                <span style={{width:28,height:28,borderRadius:8,background:C.s4,border:`1px solid ${C.b2}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:C.t3,flexShrink:0,fontFamily:C.FM}}>{String.fromCharCode(65+ci)}</span>
                <span style={{fontSize:14,color:C.t1,fontFamily:C.FB}}>{ch}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
        {dStep>0&&<button style={btnG({alignSelf:'flex-start'})} onClick={()=>{setDS(s=>s-1);setDA(a=>a.slice(0,-1));}}>← Back</button>}
      </div>
    );
  }

  function tPath(){
    const units=curPath?.units||[];
    return(
      <div style={CC({gap:22})}>
        <div style={R()}>
          <div><div style={lbl()}>Learning Pathway</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>{curPath?.label}</h2></div>
          <div style={{marginLeft:'auto',...R({gap:12})}}>
            <div style={{textAlign:'right'}}><div style={{fontSize:12,color:C.t2,fontFamily:C.FM}}>{doneL}/{allL.length}</div><div style={{fontSize:10,color:C.t3}}>lessons</div></div>
            <Arc pct={mastery} size={60} stroke={5} color={accent} label={`${mastery}%`}/>
          </div>
        </div>
        <Bar pct={mastery} color={accent} h={5} glow/>
        {units.map((unit,ui)=>{
          const p=unitM(unit);const done=p===100;
          return(
            <motion.div key={unit.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:ui*.05}} style={glass()}>
              <div style={R({marginBottom:20})}>
                <Arc pct={p} size={50} stroke={4} color={done?C.green:accent} label={`${p}%`}/>
                <div style={{flex:1}}>
                  <div style={R({gap:8,marginBottom:3})}>
                    <span style={{fontSize:10,fontWeight:700,color:C.t3,fontFamily:C.FM,letterSpacing:'.08em'}}>UNIT {ui+1}</span>
                    {done&&<span style={pill(C.greenDim,C.greenL,{fontSize:10})}>✓ Mastered</span>}
                  </div>
                  <div style={{fontSize:15,fontWeight:700,color:C.t1,fontFamily:C.FD}}>{unit.title}</div>
                  <div style={{fontSize:11,color:C.t3,marginTop:2}}>{unit.lessons.length} lessons · {unit.quizCat}</div>
                </div>
              </div>
              <div style={CC({gap:8})}>
                {unit.lessons.map((lesson)=>{
                  const state=lessonState(lesson,ui,units);const isDone=state==='done';const avail=state==='available';
                  return(
                    <div key={lesson.id} style={{...glass2({padding:'12px 16px',opacity:state==='locked'?.4:1}),display:'flex',alignItems:'center',gap:12}}>
                      <Dot state={state}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:isDone?700:400,color:isDone?C.green:C.t1,fontFamily:C.FB}}>{lesson.title}</div>
                        <div style={{fontSize:11,color:C.t3,marginTop:1}}>{lesson.src}</div>
                      </div>
                      {avail&&<a href={lesson.url} target="_blank" rel="noreferrer" style={{...btnSm(C.s4,{color:C.t2,textDecoration:'none',fontSize:11})}}>Study ↗</a>}
                      {avail&&<motion.button whileHover={{scale:1.04}} whileTap={{scale:.96}} style={btnSm(`linear-gradient(135deg,${C.green},#059669)`,{fontSize:11,boxShadow:`0 2px 8px ${C.green}30`})} onClick={()=>doneLesson(lesson)}>✓ Done</motion.button>}
                      {isDone&&<span style={{fontSize:12,color:C.green,fontWeight:700}}>✓</span>}
                      {state==='locked'&&<span style={{fontSize:11,color:C.t4}}>🔒</span>}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          );
        })}
        <div style={glass({padding:18})}>
          <SL>Switch Specialty Path</SL>
          <div style={G(3,10)}>
            {Object.entries(PATHS).map(([key,p])=>(
              <motion.div key={key} whileHover={{borderColor:`${p.accent}40`}} onClick={()=>switchPath(key)} style={{...glass2({padding:14,cursor:'pointer',border:eSpec===key?`1px solid ${p.accent}50`:undefined,transition:'all .15s'})}}>
                <div style={{fontSize:12,fontWeight:700,color:eSpec===key?p.accent:C.t2,fontFamily:C.FD}}>{p.label}</div>
                {eSpec===key&&<div style={{fontSize:10,color:C.t3,marginTop:2}}>Current</div>}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function tQuizzes(){
    const dColors={Medium:C.cyan,Hard:C.amber,Expert:C.rose};
    return(
      <div style={CC({gap:22})}>
        <div style={R()}>
          <div><div style={lbl()}>Quiz Library</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>{ALL_QUIZZES.length} Quizzes · {ALL_QUIZZES.length*15} Questions</h2></div>
          <div style={{marginLeft:'auto',...R({gap:8})}}>{qTaken>0&&<span style={pill(C.greenDim,C.greenL)}>{qTaken}/{ALL_QUIZZES.length} done</span>}{avgSc>0&&<span style={pill(`${scCol(avgSc)}18`,scCol(avgSc),{fontFamily:C.FM})}>{avgSc}% avg</span>}</div>
        </div>
        <div style={R({flexWrap:'wrap',gap:10})}>
          <div style={{flex:1,minWidth:180,position:'relative'}}>
            <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:C.t3,fontSize:14,pointerEvents:'none'}}>⌕</span>
            <input style={inp({paddingLeft:36})} placeholder="Fuzzy search quizzes…" value={qSrch} onChange={e=>setQSrch(e.target.value)}/>
          </div>
          <select style={inp({width:'auto'})} value={qCat} onChange={e=>setQC(e.target.value)}>{['All','Bio/Biochem','Chem/Phys','Psych/Soc'].map(c=><option key={c}>{c}</option>)}</select>
          <select style={inp({width:'auto'})} value={qDiff} onChange={e=>setQD(e.target.value)}>{['All','Medium','Hard','Expert'].map(d=><option key={d}>{d}</option>)}</select>
        </div>
        {secAvgs.some(v=>v!==null&&v<60)&&<div style={{...glass({padding:16,background:C.amberDim,border:`1px solid ${C.amber}25`})}}>
          <div style={R({gap:10})}><span style={{fontSize:20}}>⚡</span><div><div style={{fontSize:13,fontWeight:700,color:C.amberL,fontFamily:C.FD}}>Focus Area Detected</div><div style={{fontSize:12,color:C.t2,marginTop:2}}>Your scores suggest focusing on: {cats3.filter((_,i)=>secAvgs[i]!==null&&secAvgs[i]<60).join(', ')}.</div></div></div>
        </div>}
        <div style={G(2,14)}>
          {fQuiz.map((q,qi)=>{
            const sc=qScores[q.id];const taken=sc!==undefined;const dc=dColors[q.diff]||C.t2;const scc=taken?scCol(sc):null;
            return(
              <motion.div key={q.id} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:qi*.03}} whileHover={{y:-2,boxShadow:`0 12px 40px rgba(0,0,0,0.6),0 0 0 1px ${dc}20`}} style={{...glass({padding:0,overflow:'hidden'}),transition:'box-shadow .2s'}}>
                {taken&&<div style={{height:3,background:`linear-gradient(90deg,${scc},${scc}88)`}}/>}
                <div style={{padding:22}}>
                  <div style={R({marginBottom:14})}>
                    <span style={pill(`${dc}18`,dc,{fontSize:10})}>{q.diff}</span>
                    <span style={{marginLeft:'auto',fontSize:11,color:C.t3}}>{q.cat}</span>
                  </div>
                  <div style={{fontSize:15,fontWeight:700,color:C.t1,marginBottom:4,lineHeight:1.4,fontFamily:C.FD}}>{q.title}</div>
                  <div style={{fontSize:11,color:C.t3,marginBottom:18,fontFamily:C.FM}}>{q.qs.length} questions</div>
                  <div style={R()}>
                    <motion.button whileHover={{scale:1.02}} whileTap={{scale:.98}} style={btn(C.blueGrad,{flex:1,fontSize:12})} onClick={()=>{setAQ(q);play('click');}}>{taken?'Retake Quiz':'Start Quiz'}</motion.button>
                    {taken&&<div style={{fontSize:18,fontWeight:800,color:scc,fontFamily:C.FM,minWidth:52,textAlign:'right'}}>{sc}%</div>}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
        {fQuiz.length===0&&<div style={{textAlign:'center',color:C.t3,padding:60,fontSize:14}}>No quizzes match your search.</div>}
      </div>
    );
  }

  function tCoach(){
    return(
      <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 64px)'}}>
        <div style={R({justifyContent:'space-between',paddingBottom:18,borderBottom:`1px solid ${C.b1}`,marginBottom:18,flexShrink:0})}>
          <div><div style={lbl()}>AI Coach</div><h2 style={{fontSize:22,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>MetaBrain ✦</h2></div>
          <div style={R({gap:8})}>
            {aiChatCount>0&&<span style={pill(C.violetDim,C.violetL,{fontSize:10,fontFamily:C.FM})}>{aiChatCount} messages</span>}
            <span style={pill(`${accent}22`,accent)}>{curPath?.label} focus</span>
          </div>
        </div>
        {msgs.length===0&&(
          <div style={{flexShrink:0,marginBottom:20}}>
            <div style={lbl({marginBottom:12})}>Try asking</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              {QUICK_P.map((p,i)=>(<motion.button key={i} whileHover={{borderColor:`${accent}50`,color:C.t1}} onClick={()=>sendChat(p)} style={btnG({padding:'7px 16px',fontSize:12,borderRadius:20})}>{p}</motion.button>))}
            </div>
          </div>
        )}
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:14,paddingRight:2}}>
          <AnimatePresence>
            {msgs.map((m,i)=>(
              <motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',alignItems:'flex-end',gap:10}}>
                {m.role==='assistant'&&<div style={{width:30,height:30,borderRadius:'50%',background:`linear-gradient(135deg,${accent}30,${C.cyan}20)`,border:`1px solid ${accent}30`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0}}>✦</div>}
                <div style={{maxWidth:'78%',padding:'13px 18px',borderRadius:m.role==='user'?'18px 18px 4px 18px':'18px 18px 18px 4px',background:m.role==='user'?`linear-gradient(135deg,${accent},${C.blueD})`:m.role==='error'?C.roseDim:C.s2,border:m.role==='user'?'none':m.role==='error'?`1px solid ${C.rose}30`:`1px solid ${C.b1}`,fontSize:14,lineHeight:1.75,color:C.t1,fontFamily:C.FB,boxShadow:m.role==='user'?`0 4px 16px ${accent}30`:'0 2px 8px rgba(0,0,0,0.3)'}}>
                  {m.role==='assistant'?<div dangerouslySetInnerHTML={{__html:renderMarkdown(m.content)}}/>:m.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {cLoad&&<motion.div initial={{opacity:0}} animate={{opacity:1}} style={{display:'flex',alignItems:'flex-end',gap:10}}>
            <div style={{width:30,height:30,borderRadius:'50%',background:`linear-gradient(135deg,${accent}30,${C.cyan}20)`,border:`1px solid ${accent}30`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12}}>✦</div>
            <div style={{padding:'13px 18px',background:C.s2,border:`1px solid ${C.b1}`,borderRadius:'18px 18px 18px 4px',fontSize:14,color:C.t3}}>Thinking…</div>
          </motion.div>}
          <div ref={chatEnd}/>
        </div>
        <div style={R({marginTop:14,flexShrink:0,gap:10})}>
          <textarea style={{...inp({resize:'none',minHeight:52,maxHeight:120,lineHeight:1.6,fontFamily:C.FB,borderRadius:14}),flex:1}} placeholder="Ask MetaBrain about MCAT content, admissions, or study strategies…" value={ci} onChange={e=>setCi(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat(ci);}}}/>
          <motion.button whileHover={{scale:1.05}} whileTap={{scale:.95}} style={btn(C.blueGrad,{padding:'0 22px',alignSelf:'flex-end',height:52,flexShrink:0,borderRadius:14,boxShadow:`0 4px 16px ${accent}35`,fontSize:18})} onClick={()=>sendChat(ci)} disabled={cLoad}>↑</motion.button>
        </div>
        {msgs.length>0&&<button style={btnG({marginTop:8,fontSize:11,padding:'5px 14px',alignSelf:'flex-start',borderRadius:20})} onClick={()=>setMsgs([])}>Clear conversation</button>}
      </div>
    );
  }

  function tFlash(){
    if(activeDeck){
      if(!currentCard)return(
        <div style={CC({gap:16})}>
          <button style={btnG({alignSelf:'flex-start'})} onClick={()=>{setAD(null);setCIdx(0);setFlip(false);}}>← All Decks</button>
          <div style={{...glass({padding:40,textAlign:'center'})}}>
            <div style={{fontSize:48,marginBottom:16}}>🎉</div>
            <div style={{fontSize:18,fontWeight:700,color:C.t1,fontFamily:C.FD,marginBottom:8}}>{studyMode==='due'?'All due cards reviewed!':'Deck complete!'}</div>
            <div style={{fontSize:14,color:C.t2,marginBottom:24}}>{studyMode==='due'?'Check back later for more cards to review.':'You have reviewed all cards in this deck.'}</div>
            {studyMode==='due'&&<button style={btn()} onClick={()=>setStudyMode('all')}>Browse All Cards</button>}
          </div>
        </div>
      );
      const dueCount=getDueCards(activeDeck.builtin?(FLASH_DECKS[activeDeck.name]||[]):(cDecks[activeDeck.name]||[])).length;
      return(
        <div style={CC({gap:16})}>
          <div style={R()}>
            <button style={btnG({padding:'7px 16px',fontSize:12})} onClick={()=>{setAD(null);setCIdx(0);setFlip(false);}}>← All Decks</button>
            <div style={{flex:1,textAlign:'center'}}>
              <div style={{fontSize:14,fontWeight:700,color:C.t1,fontFamily:C.FD}}>{activeDeck.name}</div>
              <div style={{fontSize:11,color:C.t3,fontFamily:C.FM,marginTop:2}}>{cIdx+1} / {deckCards.length} · {dueCount} due</div>
            </div>
            <div style={R({gap:6})}>
              <button style={btnSm(studyMode==='due'?C.blueGrad:C.s4,{fontSize:11,color:studyMode==='due'?'#fff':C.t2,border:`1px solid ${studyMode==='due'?'transparent':C.b1}`})} onClick={()=>{setStudyMode('due');setCIdx(0);setFlip(false);}}>Due ({dueCount})</button>
              <button style={btnSm(studyMode==='all'?C.blueGrad:C.s4,{fontSize:11,color:studyMode==='all'?'#fff':C.t2,border:`1px solid ${studyMode==='all'?'transparent':C.b1}`})} onClick={()=>{setStudyMode('all');setCIdx(0);setFlip(false);}}>All</button>
              {!activeDeck.builtin&&<button style={btnSm(C.roseDim,{color:C.rose,border:`1px solid ${C.rose}30`,fontSize:11})} onClick={()=>{deleteDeck_(activeDeck.name);setAD(null);toast('Deck deleted');}}>Delete</button>}
            </div>
          </div>
          <Bar pct={((cIdx+1)/deckCards.length)*100} color={accent} h={3} glow/>
          <FlipCard card={currentCard} flipped={flip} onClick={()=>setFlip(f=>!f)}/>
          <div style={R({justifyContent:'space-between'})}>
            <motion.button whileHover={{scale:1.04}} style={btnG({padding:'9px 20px'})} onClick={()=>{setCIdx(i=>Math.max(0,i-1));setFlip(false);}} disabled={cIdx===0}>← Prev</motion.button>
            {flip&&(
              <div style={R({gap:8})}>
                {[['Again',0,C.rose],['Hard',1,C.amber],['Good',2,C.blue],['Easy',3,C.green]].map(([label,q,col])=>(
                  <motion.button key={label} whileHover={{scale:1.06}} whileTap={{scale:.94}}
                    style={btnSm(`${col}20`,{color:col,border:`1px solid ${col}30`,fontSize:11})}
                    onClick={async()=>{
                      const updated=scheduleCard(currentCard,label);
                      const deckName=activeDeck.name;
                      const allCards=activeDeck.builtin?[...(FLASH_DECKS[deckName]||[])]:[...(cDecks[deckName]||[])];
                      const idx=allCards.findIndex(c=>c.front===currentCard.front&&c.back===currentCard.back);
                      if(idx>=0)allCards[idx]=updated;
                      if(!activeDeck.builtin)await saveDeck(deckName,allCards);
                      await DB.recordCardReview(currentCard.id||cIdx);
                      const newTotal=totalReviews+1;setTotalReviews(newTotal);
                      checkAndUnlockAchievements(user,qTaken,qHistory.filter(q=>q.score===100).length,streak,newTotal,mmiCount,mastery,aiChatCount);
                      setCIdx(i=>Math.min(deckCards.length-1,i+1));setFlip(false);
                    }}>{label}</motion.button>
                ))}
              </div>
            )}
            <motion.button whileHover={{scale:1.04}} style={btnG({padding:'9px 20px'})} onClick={()=>{setCIdx(i=>Math.min(deckCards.length-1,i+1));setFlip(false);}} disabled={cIdx===deckCards.length-1}>Next →</motion.button>
          </div>
          <button style={btnG({alignSelf:'flex-start',fontSize:11,padding:'6px 14px'})} onClick={()=>exportFlashDeck(activeDeck.name,deckCards)}>📄 Export Deck PDF</button>
        </div>
      );
    }
    return(
      <div style={CC({gap:22})}>
        <div style={R()}>
          <div><div style={lbl()}>Flashcards</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>Study Decks</h2></div>
          <div style={{marginLeft:'auto',...R({gap:8})}}>
            {dueCards>0&&<span style={pill(C.violetDim,C.violetL,{fontFamily:C.FM})}>{dueCards} due</span>}
            <span style={pill(C.blueDim,C.blueL)}>{Object.keys(FLASH_DECKS).length+Object.keys(cDecks).length} decks</span>
          </div>
        </div>
        <div style={{position:'relative'}}>
          <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:C.t3,fontSize:14,pointerEvents:'none'}}>⌕</span>
          <input style={inp({paddingLeft:36})} placeholder="Search decks…" value={dSrch} onChange={e=>setDS2(e.target.value)}/>
        </div>
        <div style={{...glass({background:`${C.violetDim}`,border:`1px solid rgba(139,92,246,0.2)`})}}>
          <div style={R({marginBottom:14})}>
            <div style={{width:36,height:36,borderRadius:10,background:C.violetDim,border:`1px solid ${C.violet}30`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:`0 4px 12px ${C.violet}20`}}>✨</div>
            <div><div style={{fontSize:13,fontWeight:700,color:C.t1,fontFamily:C.FD}}>Generate AI Deck</div><div style={{fontSize:11,color:C.t2,marginTop:1}}>Paste your notes — AI creates 10–14 high-yield cards</div></div>
          </div>
          <textarea style={{...inp({minHeight:80,resize:'vertical',fontFamily:C.FB,lineHeight:1.6,marginBottom:12})}} placeholder="Paste your MCAT study notes, lecture slides, or any text here…" value={notes} onChange={e=>setNotes(e.target.value)}/>
          <motion.button whileHover={{scale:1.02}} whileTap={{scale:.98}} style={btn(`linear-gradient(135deg,${C.violet},#7c3aed)`,{fontSize:12,boxShadow:`0 4px 16px ${C.violet}30`})} onClick={genDeck} disabled={gLoad||!notes.trim()}>{gLoad?'Generating…':'✨ Generate Flashcards'}</motion.button>
        </div>
        <div style={G(3,12)}>
          {allDecksList.map(deck=>{
            const deckCardsAll=deck.builtin?(FLASH_DECKS[deck.name]||[]):(cDecks[deck.name]||[]);
            const dc=getDueCards(deckCardsAll).length;
            return(
              <motion.div key={deck.name} whileHover={{y:-2,borderColor:`${accent}35`,boxShadow:`0 8px 32px rgba(0,0,0,0.5),0 0 0 1px ${accent}20`}} onClick={()=>{setAD(deck);setCIdx(0);setFlip(false);setStudyMode(dc>0?'due':'all');}} style={{...glass({padding:20,cursor:'pointer',transition:'border-color .2s'})}}>
                <div style={{fontSize:28,marginBottom:10}}>🃏</div>
                <div style={{fontSize:13,fontWeight:700,color:C.t1,marginBottom:4,lineHeight:1.35,fontFamily:C.FD}}>{deck.name}</div>
                <div style={{fontSize:11,color:C.t3,fontFamily:C.FM}}>{deckCardsAll.length} cards</div>
                {dc>0&&<div style={{...pill(C.violetDim,C.violetL,{marginTop:8,fontSize:10,fontFamily:C.FM})}}>{dc} due now</div>}
                {!deck.builtin&&<div style={{...pill(C.violetDim,C.violetL,{marginTop:8,fontSize:10})}}>AI-generated</div>}
              </motion.div>
            );
          })}
        </div>
        {allDecksList.length===0&&<div style={{textAlign:'center',color:C.t3,padding:60}}>No decks found.</div>}
      </div>
    );
  }

  function tLib(){
    const yt=fLib.filter(r=>r.type==='YouTube');const reg=fLib.filter(r=>r.type!=='YouTube');
    const tc={Article:C.blue,Book:C.amber,Course:C.violet,App:C.green,Community:'#ec4899',Podcast:C.cyan};
    return(
      <div style={CC({gap:22})}>
        <div style={R()}><div><div style={lbl()}>E-Library</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>{ELIB.length} Resources</h2></div></div>
        <div style={R({flexWrap:'wrap',gap:10})}>
          <div style={{flex:1,minWidth:200,position:'relative'}}>
            <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:C.t3,fontSize:14,pointerEvents:'none'}}>⌕</span>
            <input style={inp({paddingLeft:36})} placeholder="Fuzzy search videos, books, courses…" value={lSrch} onChange={e=>setLS(e.target.value)}/>
          </div>
          <select style={inp({width:'auto'})} value={lCat} onChange={e=>setLC(e.target.value)}>{LIB_CATS.map(c=><option key={c}>{c}</option>)}</select>
        </div>
        {yt.length>0&&<div>
          <SL>Video Resources ({yt.length})</SL>
          <div style={G(2,14)}>
            {yt.map((r,i)=>(
              <motion.div key={i} whileHover={{y:-2,boxShadow:'0 12px 40px rgba(0,0,0,0.6)'}} style={glass({padding:0,overflow:'hidden',cursor:'pointer'})}>
                <div style={{position:'relative',paddingBottom:'52%',background:C.s2,overflow:'hidden'}} onClick={()=>setVM({ytId:r.ytId,title:r.title})}>
                  <img src={`https://img.youtube.com/vi/${r.ytId}/mqdefault.jpg`} alt={r.title} loading="lazy" style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',objectFit:'cover',transition:'transform .4s'}} onError={e=>{e.target.style.display='none';}} onMouseEnter={e=>e.target.style.transform='scale(1.05)'} onMouseLeave={e=>e.target.style.transform='scale(1)'}/>
                  <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(4,6,11,0.85) 0%,transparent 55%)'}}/>
                  <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <motion.div whileHover={{scale:1.12,background:'rgba(255,255,255,0.22)'}} style={{width:52,height:52,borderRadius:'50%',background:'rgba(255,255,255,0.12)',backdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,border:'1.5px solid rgba(255,255,255,0.25)'}}>▶</motion.div>
                  </div>
                  <span style={pill('rgba(239,68,68,0.85)','white',{position:'absolute',top:10,right:10,fontSize:10,borderRadius:5})}>YouTube</span>
                </div>
                <div style={{padding:'14px 18px'}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.t1,lineHeight:1.4,marginBottom:5,fontFamily:C.FD}}>{r.title}</div>
                  <div style={{fontSize:11,color:C.t3,lineHeight:1.55,marginBottom:12}}>{r.desc}</div>
                  <div style={R({justifyContent:'space-between'})}>
                    <span style={pill(C.blueDim,C.blueL,{fontSize:10})}>{r.cat}</span>
                    <button style={btnSm('rgba(239,68,68,0.15)',{color:'#f87171',border:'1px solid rgba(239,68,68,0.3)',fontSize:11})} onClick={()=>setVM({ytId:r.ytId,title:r.title})}>▶ Watch</button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>}
        {reg.length>0&&<div>
          {yt.length>0&&<SL>Articles, Books & Courses ({reg.length})</SL>}
          <div style={G(2,12)}>
            {reg.map((r,i)=>{const col=tc[r.type]||C.t2;return(
              <motion.div key={i} whileHover={{y:-1,borderColor:`${col}30`}} style={glass({padding:18,transition:'border-color .15s'})}>
                <div style={R({justifyContent:'space-between',marginBottom:12})}>
                  <span style={pill(`${col}18`,col,{fontSize:10})}>{r.type}</span>
                  <div style={R({gap:6})}>
                    {r.free?<span style={pill(C.greenDim,C.greenL,{fontSize:10})}>FREE</span>:<span style={pill(C.amberDim,C.amberL,{fontSize:10})}>Paid</span>}
                    <span style={{fontSize:10,color:C.t3}}>{r.cat}</span>
                  </div>
                </div>
                <div style={{fontSize:14,fontWeight:700,color:C.t1,marginBottom:6,lineHeight:1.4,fontFamily:C.FD}}>{r.title}</div>
                <div style={{fontSize:12,color:C.t2,lineHeight:1.65,marginBottom:14}}>{r.desc}</div>
                <a href={r.url} target="_blank" rel="noreferrer" style={{...btnSm(C.blueDim,{color:C.blueL,border:`1px solid ${C.blue}30`,textDecoration:'none',fontSize:11})}}>Open ↗</a>
              </motion.div>
            );})}
          </div>
        </div>}
        {fLib.length===0&&<div style={{textAlign:'center',color:C.t3,padding:60}}>No resources match your search.</div>}
      </div>
    );
  }

  function tPort(){
    const totH=port.reduce((s,a)=>s+(parseInt(a.hours)||0),0);
    const clinH=port.filter(a=>a.type==='Clinical').reduce((s,a)=>s+(parseInt(a.hours)||0),0);
    const resH=port.filter(a=>a.type==='Research').reduce((s,a)=>s+(parseInt(a.hours)||0),0);
    const volH=port.filter(a=>a.type==='Volunteering').reduce((s,a)=>s+(parseInt(a.hours)||0),0);
    const actColors={Clinical:C.green,Research:C.amber,Volunteering:C.violet,Leadership:C.blue,Shadowing:C.cyan,Teaching:C.orange,'Work Experience':C.rose,Other:C.t3};
    return(
      <div style={CC({gap:22})}>
        <div><div style={lbl()}>Portfolio Builder</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>Activity Tracker</h2></div>
        <div style={G(4,14)}>
          <Stat label="Total Hours" value={totH} icon="⏱" color={accent}/>
          <Stat label="Clinical" value={clinH} icon="🏥" color={C.green} sub="Rec: 200+"/>
          <Stat label="Research" value={resH} icon="🔬" color={C.amber} sub="Rec: 1+ yr"/>
          <Stat label="Volunteer" value={volH} icon="🤝" color={C.violet} sub="Rec: 150+"/>
        </div>
        <div style={glass({padding:18})}>
          <SL>Progress Toward Med School Requirements</SL>
          {[{l:'Clinical Hours',val:clinH,target:200,col:C.green},{l:'Research Hours',val:resH,target:1000,col:C.amber},{l:'Volunteer Hours',val:volH,target:150,col:C.violet}].map(({l,val,target,col})=>(
            <div key={l} style={{marginBottom:14}}>
              <div style={R({justifyContent:'space-between',marginBottom:6})}><span style={{fontSize:12,color:C.t2,fontFamily:C.FB}}>{l}</span><span style={{fontSize:11,fontFamily:C.FM,color:val>=target?C.green:C.t3}}>{val} / {target}{val>=target?' ✓':''}</span></div>
              <Bar pct={Math.min((val/target)*100,100)} color={val>=target?C.green:col} h={6} glow={val>=target}/>
            </div>
          ))}
        </div>
        <div style={glass()}>
          <SL>Add New Activity</SL>
          <div style={G(2,12)}>
            {[{l:'Activity Name',p:'e.g., ER Volunteering at Duke Medical',v:aN,s:setAN,t:'text'},{l:'Type',v:aT,s:setAT,sel:ACT_TYPES},{l:'Hours',p:'100',v:aH,s:setAH,t:'number'},{l:'Start Date',v:aDate,s:setADate,t:'date'}].map(f=>(
              <div key={f.l} style={CC({gap:4})}>
                <span style={lbl()}>{f.l}</span>
                {f.sel?<select style={inp()} value={f.v} onChange={e=>f.s(e.target.value)}>{f.sel.map(t=><option key={t}>{t}</option>)}</select>:<input type={f.t||'text'} style={inp()} placeholder={f.p||''} value={f.v} onChange={e=>f.s(e.target.value)}/>}
              </div>
            ))}
          </div>
          <motion.button whileHover={{scale:1.02}} whileTap={{scale:.98}} style={{...btn(),marginTop:16}} onClick={async()=>{
            if(!aN.trim())return;
            const item={name:aN,type:aT,hours:aH,date:aDate,addedAt:Date.now()};
            const id=await DB.addPortfolioItem(item);
            setPort_(p=>[...p,{...item,id}]);
            setAN('');setAH('');setADate('');
            toast.success(`Added: ${aN.slice(0,40)}`);
          }}>+ Add to Portfolio</motion.button>
        </div>
        {port.length>0&&<div style={CC({gap:8})}>
          <SL>My Activities ({port.length})</SL>
          <AnimatePresence>
            {port.map((act)=>{const col=actColors[act.type]||C.blue;return(
              <motion.div key={act.id||act.name} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} exit={{opacity:0,x:10}} style={{...glass2({display:'flex',alignItems:'center',gap:14,padding:'14px 18px'})}}>
                <div style={{width:4,height:44,borderRadius:2,background:`linear-gradient(180deg,${col},${col}60)`,flexShrink:0,boxShadow:`0 0 8px ${col}40`}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.t1,fontFamily:C.FD,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{act.name}</div>
                  <div style={{fontSize:11,color:C.t3,marginTop:2,fontFamily:C.FM}}>{act.type} · {act.hours||'?'}h{act.date?` · ${act.date}`:''}</div>
                </div>
                <button style={btnSm(C.roseDim,{color:C.rose,border:`1px solid ${C.rose}30`,fontSize:11})} onClick={async()=>{await DB.deletePortfolioItem(act.id);setPort_(p=>p.filter(a=>a.id!==act.id));toast('Removed');}}>Remove</button>
              </motion.div>
            );})}
          </AnimatePresence>
          <button style={btnG({alignSelf:'flex-start',fontSize:11,padding:'6px 14px'})} onClick={()=>exportSchoolList([],{note:'Portfolio export'})}>📄 Export Portfolio PDF</button>
        </div>}
        <div>
          <div style={R({marginBottom:16})}>
            <SL extra={{margin:0}}>Opportunities & Competitions</SL>
            <select style={{...inp({width:'auto',marginLeft:'auto'})}} value={cF} onChange={e=>setCF(e.target.value)}>
              {['All','Competition','Research','Scholarship','Clinical','Volunteering','Conference','Organization','National','State'].map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <div style={G(2,12)}>
            {fComp.map((c,i)=>{const ec={Elite:C.rose,Competitive:C.amber,Open:C.green}[c.effort]||C.t2;return(
              <motion.div key={i} whileHover={{borderColor:`${ec}30`,y:-1}} style={glass({padding:18,transition:'border-color .15s'})}>
                <div style={R({marginBottom:10})}><span style={pill(`${ec}18`,ec,{fontSize:10})}>{c.effort}</span><span style={{marginLeft:'auto',fontSize:10,color:C.t3}}>{c.type} · {c.level}</span></div>
                <div style={{fontSize:13,fontWeight:700,color:C.t1,fontFamily:C.FD,marginBottom:5}}>{c.name}</div>
                <div style={{fontSize:12,color:C.t2,lineHeight:1.6,marginBottom:12}}>{c.desc}</div>
                <button style={btnSm(C.blueDim,{color:C.blueL,border:`1px solid ${C.blue}25`,fontSize:11})} onClick={async()=>{const item={name:c.name,type:c.type,hours:'0',date:'',addedAt:Date.now()};const id=await DB.addPortfolioItem(item);setPort_(p=>[...p,{...item,id}]);toast.success(`Added: ${c.name.slice(0,30)}`);}} >+ Add to Portfolio</button>
              </motion.div>
            );})}
          </div>
        </div>
      </div>
    );
  }

  function tInterview(){
    return(
      <div style={CC({gap:22})}>
        <div style={R()}>
          <div><div style={lbl()}>Interview Simulator</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>MMI Practice</h2></div>
          <div style={{marginLeft:'auto',...R({gap:8})}}>
            {mmiCount>0&&<span style={pill(C.greenDim,C.greenL,{fontFamily:C.FM})}>{mmiCount} practiced</span>}
            <span style={pill(C.s3,C.t2)}>{MMI_QS.length} Stations</span>
          </div>
        </div>
        <div style={R({flexWrap:'wrap',gap:10})}>
          <select style={inp({width:'auto'})} value={mTF} onChange={e=>{setMTF(e.target.value);setMI(0);setMA('');setMF('');setMR(false);setMT(0);}}>{MMI_TYPES.map(t=><option key={t}>{t}</option>)}</select>
          <div style={{marginLeft:'auto',...R({gap:8})}}>
            <span style={{fontSize:12,color:C.t3,fontFamily:C.FM}}>Station {mIdx+1} / {fMmi.length}</span>
            <button style={btnG({padding:'7px 14px',fontSize:12})} onClick={()=>{setMI(i=>Math.max(0,i-1));setMA('');setMF('');setMR(false);setMT(0);}} disabled={mIdx===0}>←</button>
            <button style={btnG({padding:'7px 14px',fontSize:12})} onClick={()=>{setMI(i=>Math.min(fMmi.length-1,i+1));setMA('');setMF('');setMR(false);setMT(0);}} disabled={mIdx===fMmi.length-1}>→</button>
          </div>
        </div>
        {mmiQ&&<motion.div key={mIdx} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} style={glass()}>
          <div style={R({marginBottom:18})}>
            <span style={pill(C.blueDim,C.blueL,{fontSize:11})}>{mmiQ.type}</span>
            <div style={{marginLeft:'auto',...R({gap:12})}}>
              <span style={{fontSize:20,fontWeight:700,fontFamily:C.FM,color:mRun?C.green:mTimer>0?C.amber:C.t3,transition:'color .3s'}}>{fmtT(mTimer)}</span>
              {!mRun?<motion.button whileHover={{scale:1.04}} whileTap={{scale:.96}} style={btn(`linear-gradient(135deg,${C.green},#059669)`,{fontSize:12,padding:'8px 18px',boxShadow:`0 4px 12px ${C.green}30`})} onClick={()=>{setMT(0);setMR(true);}}>▶ Start Timer</motion.button>
              :<motion.button whileHover={{scale:1.04}} style={btn(`linear-gradient(135deg,${C.rose},#dc2626)`,{fontSize:12,padding:'8px 18px'})} onClick={()=>setMR(false)}>⏸ Pause</motion.button>}
            </div>
          </div>
          <p style={{fontSize:16,fontWeight:700,lineHeight:1.75,marginBottom:18,color:C.t1,fontFamily:C.FD}}>{mmiQ.q}</p>
          <div style={{marginBottom:18,background:C.amberDim,border:`1px solid ${C.amber}25`,borderRadius:12,padding:16}}>
            <div style={{fontSize:10,fontWeight:700,color:C.amberL,letterSpacing:'.1em',marginBottom:10}}>KEY CONSIDERATIONS</div>
            {mmiQ.points.map((pt,pi)=>(<div key={pi} style={{fontSize:13,color:C.t2,lineHeight:1.7,marginBottom:4,display:'flex',gap:8}}><span style={{color:C.amberL,flexShrink:0,fontWeight:700}}>›</span>{pt}</div>))}
          </div>
          <textarea style={{...inp({minHeight:140,resize:'vertical',fontFamily:C.FB,lineHeight:1.7,marginBottom:14})}} placeholder="Structure your response: Brief intro → Address key considerations → Conclude with your position or action." value={mAns} onChange={e=>setMA(e.target.value)}/>
          <div style={R({gap:10})}>
            <motion.button whileHover={{scale:1.02}} whileTap={{scale:.98}} style={btn(C.blueGrad,{fontSize:13,boxShadow:`0 4px 16px ${accent}30`})} onClick={getMMIFb} disabled={mLoad||!mAns.trim()}>{mLoad?'Analyzing response…':'✦ Get AI Feedback'}</motion.button>
            {mAns.trim()&&<button style={btnG({fontSize:12,padding:'10px 18px'})} onClick={()=>{setMA('');setMF('');setMT(0);setMR(false);}}>Reset</button>}
          </div>
          <AnimatePresence>
            {mFb&&<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} style={{marginTop:18,background:C.greenDim,border:`1px solid ${C.green}25`,borderRadius:12,padding:18}}>
              <div style={{fontSize:10,fontWeight:700,color:C.greenL,letterSpacing:'.1em',marginBottom:12}}>AI FEEDBACK</div>
              <div dangerouslySetInnerHTML={{__html:renderMarkdown(mFb)}} style={{fontSize:14,color:C.t1,fontFamily:C.FB}}/>
            </motion.div>}
          </AnimatePresence>
        </motion.div>}
        <div style={glass({padding:18})}>
          <SL>Station Types — Practice Distribution</SL>
          <div style={G(4,8)}>
            {['Ethics','Professionalism','Personal','Motivation','Policy','Cultural Competency','Communication','Situational'].map(type=>{
              const count=MMI_QS.filter(q=>q.type===type).length;
              return<div key={type} style={{...glass2({padding:10,textAlign:'center',cursor:'pointer',transition:'border-color .15s'}),border:mTF===type?`1px solid ${C.blue}50`:undefined}} onClick={()=>{setMTF(type);setMI(0);setMA('');setMF('');setMR(false);setMT(0);}}>
                <div style={{fontSize:12,fontWeight:600,color:mTF===type?C.blueL:C.t2,fontFamily:C.FD,marginBottom:2}}>{type}</div>
                <div style={{fontSize:10,color:C.t3,fontFamily:C.FM}}>{count} q</div>
              </div>;
            })}
          </div>
        </div>
      </div>
    );
  }

  function tCalc(){
    return(
      <div style={CC({gap:22})}>
        <div><div style={lbl()}>Admissions Calculator</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>School List Builder</h2></div>
        <div style={glass()}>
          <SL>Your Profile</SL>
          <div style={G(2,14)}>
            {[
              {l:'Cumulative GPA',p:'3.75',t:'number',step:'0.01',min:'2',max:'4',v:cGPA,s:setCGPA},
              {l:'MCAT Score (472–528)',p:'510',t:'number',min:'472',max:'528',v:cMCAT,s:setCMCAT},
              {l:'Research Experience (years)',p:'1',t:'number',min:'0',v:cRes,s:setCR},
              {l:'Clinical Hours',p:'200',t:'number',min:'0',v:cClin,s:setCC},
              {l:'Volunteer Hours',p:'100',t:'number',min:'0',v:cVol,s:setCV},
              {l:'State (2-letter)',p:'NC',t:'text',maxLength:2,v:cSt,s:(v)=>setCST(v.toUpperCase())},
            ].map(f=>(
              <div key={f.l} style={CC({gap:4})}>
                <span style={lbl()}>{f.l}</span>
                <input type={f.t} step={f.step} min={f.min} max={f.max} maxLength={f.maxLength} style={inp()} placeholder={f.p} value={f.v} onChange={e=>f.s(e.target.value)}/>
              </div>
            ))}
          </div>
          <div style={R({gap:8,marginTop:16})}>
            <span style={{fontSize:12,color:C.t2,fontWeight:500}}>School type:</span>
            {['All','Public','Private'].map(t=>(<motion.button key={t} whileHover={{scale:1.04}} whileTap={{scale:.96}} style={btnSm(sType===t?C.blueGrad:C.s4,{color:sType===t?'#fff':C.t2,border:sType===t?'none':`1px solid ${C.b1}`})} onClick={()=>setST(t)}>{t}</motion.button>))}
          </div>
        </div>
        {!hasCalc&&<div style={{textAlign:'center',color:C.t3,padding:60,fontSize:14}}>Enter your GPA and MCAT score above to see your personalized school list.</div>}
        {calcR.length>0&&<div style={G(4,10)}>
          {['Likely','Target','Reach','Stretch'].map(tier=>{const n=calcR.filter(s=>s.tier===tier).length;const col=tierC(tier);return<div key={tier} style={{...glass2({textAlign:'center',padding:14})}}><div style={{fontSize:22,fontWeight:800,fontFamily:C.FM,color:col,marginBottom:3}}>{n}</div><div style={{fontSize:11,color:C.t3,fontWeight:600}}>{tier}</div></div>;})}
        </div>}
        {calcR.length>0&&<div style={R({gap:10})}><button style={btnG({fontSize:12,padding:'9px 18px'})} onClick={()=>exportSchoolList(calcR,{gpa:cGPA,mcat:cMCAT})}>📄 Export School List PDF</button></div>}
        {calcR.length>0&&['Likely','Target','Reach','Stretch'].map(tier=>{
          const schools=calcR.filter(s=>s.tier===tier);if(!schools.length)return null;
          const col=tierC(tier);
          return(
            <div key={tier}>
              <div style={R({marginBottom:12})}><div style={{width:10,height:10,borderRadius:'50%',background:col,boxShadow:`0 0 8px ${col}70`}}/><span style={{fontSize:13,fontWeight:700,color:col,fontFamily:C.FD}}>{tier}</span><span style={{fontSize:12,color:C.t3}}>({schools.length} schools)</span></div>
              <div style={CC({gap:6})}>
                {schools.map((s,i)=>(
                  <motion.div key={i} initial={{opacity:0,x:-5}} animate={{opacity:1,x:0}} transition={{delay:i*.02}} style={{...glass2({display:'flex',alignItems:'center',gap:14,padding:'14px 18px'})}}>
                    <div style={{width:4,height:44,borderRadius:2,background:`linear-gradient(180deg,${col},${col}55)`,flexShrink:0,boxShadow:`0 0 8px ${col}30`}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:C.t1,fontFamily:C.FD,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</div>
                      <div style={{fontSize:11,color:C.t3,marginTop:2,fontFamily:C.FM}}>GPA {s.gpa} · MCAT {s.mcat} · {s.accept}% acceptance · {s.type} · {s.state}</div>
                    </div>
                    <span style={pill(`${col}18`,col,{fontSize:11,flexShrink:0})}>{s.tier}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function tAnalytics(){
    const recentScores=qHistory.slice(-12);
    const catStats=cats3.map((cat,i)=>{const cQ=ALL_QUIZZES.filter(q=>q.cat===cat);const taken=cQ.filter(q=>qScores[q.id]!==undefined);const avg=taken.length?Math.round(taken.reduce((s,q)=>s+qScores[q.id],0)/taken.length):null;return{cat,avg,taken:taken.length,total:cQ.length,predicted:avg!==null?scoreToSection(avg):null};});
    const radarData={labels:cats3.map(c=>c.split('/')[0]),datasets:[{label:'Performance %',data:catStats.map(c=>c.avg||0),backgroundColor:'rgba(45,127,255,0.15)',borderColor:'rgba(45,127,255,0.8)',borderWidth:2,pointBackgroundColor:catStats.map(c=>scCol(c.avg||0)),pointBorderColor:'transparent',pointRadius:6}]};
    const radarOpts={responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:100,ticks:{color:'rgba(255,255,255,0.3)',backdropColor:'transparent',stepSize:20},grid:{color:'rgba(255,255,255,0.08)'},pointLabels:{color:C.t2,font:{size:12,family:C.FB}}}},plugins:{legend:{display:false},tooltip:{backgroundColor:C.s2,titleColor:C.t1,bodyColor:C.t2,borderColor:C.b2,borderWidth:1}}};
    const lineData={labels:recentScores.map((_,i)=>`Q${i+1}`),datasets:[{label:'Score %',data:recentScores.map(r=>r.score),borderColor:'rgba(45,127,255,0.9)',backgroundColor:'rgba(45,127,255,0.08)',borderWidth:2.5,pointBackgroundColor:recentScores.map(r=>scCol(r.score)),pointRadius:5,tension:0.4,fill:true}]};
    const lineOpts={responsive:true,maintainAspectRatio:false,scales:{y:{min:0,max:100,grid:{color:'rgba(255,255,255,0.05)'},ticks:{color:C.t3,font:{size:11}}},x:{grid:{display:false},ticks:{color:C.t3,font:{size:11}}}},plugins:{legend:{display:false},tooltip:{backgroundColor:C.s2,titleColor:C.t1,bodyColor:C.t2,borderColor:C.b2,borderWidth:1}}};
    const doughnutData={labels:['Completed','Remaining'],datasets:[{data:[doneL,allL.length-doneL],backgroundColor:[accent,C.s4],borderWidth:0,hoverOffset:4}]};
    const doughnutOpts={responsive:true,maintainAspectRatio:false,cutout:'72%',plugins:{legend:{display:false},tooltip:{backgroundColor:C.s2,titleColor:C.t1,bodyColor:C.t2,borderColor:C.b2,borderWidth:1}}};
    return(
      <div style={CC({gap:22})}>
        <div><div style={lbl()}>Analytics</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>Performance Dashboard</h2></div>
        <div style={G(4,14)}>
          <Stat label="Total XP" value={(user.xp||0).toLocaleString()} icon="⭐" color={C.amber}/>
          <Stat label="Level" value={lvl} icon="🏆" color={C.violet}/>
          <Stat label="Avg Score" value={`${avgSc}%`} icon="📊" color={scCol(avgSc)}/>
          <Stat label="Study Streak" value={`${streak}d`} icon="🔥" color={C.orange}/>
        </div>
        {predMCAT&&<div style={{...glass({padding:20}),background:`linear-gradient(135deg,${C.greenDim},${C.blueDim})`,border:`1px solid ${C.green}20`}}>
          <SL extra={{marginBottom:12}}>Predicted MCAT Score</SL>
          <div style={R({gap:20,flexWrap:'wrap'})}>
            <div style={{textAlign:'center'}}><div style={{fontSize:48,fontWeight:800,fontFamily:C.FM,color:C.green,lineHeight:1}}>{predMCAT}</div><div style={{fontSize:12,color:C.t3,marginTop:4}}>Total Score</div></div>
            <div style={{flex:1,minWidth:200}}>
              {catStats.map(({cat,predicted,avg})=>predicted&&(<div key={cat} style={{marginBottom:10}}><div style={R({justifyContent:'space-between',marginBottom:5})}><span style={{fontSize:12,color:C.t2}}>{cat}</span><span style={{fontSize:13,fontFamily:C.FM,fontWeight:700,color:scCol(avg||0)}}>{predicted}</span></div><Bar pct={((predicted-118)/14)*100} color={scCol(avg||0)} h={5} glow/></div>))}
            </div>
          </div>
        </div>}
        <div style={G(2,14)}>
          <div style={glass({padding:20})}>
            <SL>Section Performance</SL>
            <div style={{height:220,position:'relative'}}><Radar data={radarData} options={radarOpts}/></div>
            <div style={{marginTop:14,...CC({gap:8})}}>
              {catStats.map(({cat,avg,taken,total})=>(<div key={cat} style={R({gap:10})}><span style={{fontSize:11,color:C.t2,flex:1,fontFamily:C.FB}}>{cat.split('/')[0]}</span><span style={{fontSize:11,fontFamily:C.FM,color:C.t3}}>{taken}/{total}</span><span style={{fontSize:13,fontWeight:700,fontFamily:C.FM,color:avg!==null?scCol(avg):C.t3,minWidth:36,textAlign:'right'}}>{avg!==null?`${avg}%`:'—'}</span></div>))}
            </div>
          </div>
          <div style={glass({padding:20})}>
            <SL>Course Mastery</SL>
            <div style={{position:'relative',height:160,display:'flex',alignItems:'center',justifyContent:'center'}}>
              <Doughnut data={doughnutData} options={doughnutOpts}/>
              <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}><span style={{fontSize:26,fontWeight:800,fontFamily:C.FM,color:accent}}>{mastery}%</span><span style={{fontSize:10,color:C.t3}}>complete</span></div>
            </div>
            <div style={{marginTop:16,...CC({gap:8})}}>
              {(curPath?.units||[]).map(unit=>{const p=unitM(unit);return(<div key={unit.id} style={{marginBottom:2}}><div style={R({justifyContent:'space-between',marginBottom:5})}><span style={{fontSize:11,color:C.t2,fontFamily:C.FB}}>{unit.title}</span><span style={{fontSize:11,fontFamily:C.FM,color:p===100?C.green:accent}}>{p}%</span></div><Bar pct={p} color={p===100?C.green:accent} h={4} glow={p===100}/></div>);})}
            </div>
          </div>
        </div>
        {recentScores.length>=2&&<div style={glass({padding:20})}><SL>Score Trend (last {recentScores.length} quizzes)</SL><div style={{height:180,position:'relative'}}><Line data={lineData} options={lineOpts}/></div></div>}
        {recentScores.length>0&&<div style={glass()}><SL>Recent Quiz Scores</SL><div style={CC({gap:8})}>{recentScores.slice().reverse().map((record,i)=>{const quiz=ALL_QUIZZES.find(q=>q.id===record.quizId);const sc=scCol(record.score);return(<div key={i} style={{...glass2({padding:'12px 16px'}),...R()}}><div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:C.t1,fontFamily:C.FD,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{quiz?.title||record.quizId}</div><div style={{fontSize:11,color:C.t3,marginTop:1}}>{quiz?.cat} · {new Date(record.completedAt).toLocaleDateString()}</div></div><div style={R({gap:12})}><div style={{width:90,height:5,background:C.s4,borderRadius:3,overflow:'hidden',alignSelf:'center'}}><div style={{height:'100%',width:`${record.score}%`,background:sc,borderRadius:3,boxShadow:`0 0 6px ${sc}60`}}/></div><span style={{fontSize:15,fontWeight:800,fontFamily:C.FM,color:sc,minWidth:44,textAlign:'right'}}>{record.score}%</span></div></div>);})}</div></div>}
        <div style={G(3,14)}>
          <Stat label="Cards Reviewed" value={totalReviews} icon="🃏" color={C.violet} sub="Total all-time"/>
          <Stat label="Due Now" value={dueCards} icon="📅" color={dueCards>0?C.amber:C.green} sub={dueCards>0?'Review these today':'All caught up!'}/>
          <Stat label="MMI Practice" value={mmiCount} icon="🎙️" color={C.cyan} sub="Stations answered"/>
        </div>
        {achiev.size>0&&<div style={glass({padding:18})}><SL>Achievements ({achiev.size}/{Object.keys(ACHIEVEMENTS).length})</SL><div style={G(4,10)}>{Object.values(ACHIEVEMENTS).map(a=>{const has=achiev.has(a.key);return(<div key={a.key} title={`${a.name}: ${a.desc}${has?` (+${a.xp} XP)`:''}`} style={{...glass2({padding:12,textAlign:'center',opacity:has?1:.35,border:has?`1px solid ${C.amber}30`:undefined,transition:'opacity .2s'})}}><div style={{fontSize:24,marginBottom:4}}>{a.icon}</div><div style={{fontSize:10,fontWeight:600,color:has?C.amberL:C.t3,lineHeight:1.3,fontFamily:C.FD}}>{a.name}</div>{has&&<div style={{...pill(C.amberDim,C.amberL,{fontSize:9,marginTop:6,fontFamily:C.FM})}}>+{a.xp}xp</div>}</div>);})}</div></div>}
      </div>
    );
  }

  function tSettings(){
    return(
      <div style={CC({gap:22})}>
        <div><div style={lbl()}>Settings</div><h2 style={{fontSize:24,fontWeight:800,color:C.t1,fontFamily:C.FD,letterSpacing:'-.03em',margin:0}}>Account & Preferences</h2></div>
        <div style={glass()}>
          <SL>Profile</SL>
          <div style={{...R({gap:14,marginBottom:18})}}>
            <div style={{width:52,height:52,borderRadius:14,background:`linear-gradient(135deg,${accent}50,${accent}25)`,border:`2px solid ${accent}40`,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:22,color:'#fff',boxShadow:`0 6px 20px ${accent}30`}}>
              {user.name[0].toUpperCase()}
            </div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:C.t1,fontFamily:C.FD}}>{user.name}</div>
              <div style={{fontSize:12,color:C.t3,marginTop:2}}>Level {lvl} · {curPath?.label} · {(user.xp||0).toLocaleString()} XP total</div>
              <div style={R({gap:8,marginTop:6})}>
                {streak>0&&<span style={pill(C.amberDim,C.amberL,{fontSize:10})}>🔥 {streak} day streak</span>}
                <span style={pill(C.greenDim,C.greenL,{fontSize:10})}>{achiev.size} achievements</span>
                {hasFaceId&&<span style={pill(`${C.blue}18`,C.blueL,{fontSize:10})}>👤 Face ID</span>}
              </div>
            </div>
          </div>
          <div style={CC({gap:4,marginBottom:14})}><span style={lbl()}>Display Name</span><input style={inp()} placeholder={user.name} value={sName} onChange={e=>setSN(e.target.value)}/></div>
          <button style={btn()} onClick={()=>{if(!sName.trim())return;saveUser({...user,name:sName.trim()});setSN('');toast.success('Name updated!');}}>Save Name</button>
        </div>

        <div style={{...glass({border:hasFaceId?`1px solid ${C.blue}25`:undefined})}}>
          <SL>Face ID Login</SL>
          {hasFaceId ? (
            <div>
              <div style={R({gap:14,marginBottom:18})}>
                <div style={{width:44,height:44,borderRadius:12,background:`${C.blue}18`,border:`1px solid ${C.blue}25`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:`0 4px 12px ${C.blue}20`}}>👤</div>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:C.t1,fontFamily:C.FD}}>Face ID Enabled</div>
                  <div style={{fontSize:12,color:C.t3,marginTop:3,lineHeight:1.55}}>You can log in instantly by looking at the camera. Your face data never leaves this device.</div>
                </div>
              </div>
              <div style={R({gap:10,flexWrap:'wrap'})}>
                <motion.button whileHover={{scale:1.02}} whileTap={{scale:.97}}
                  style={btn(`linear-gradient(135deg,${C.blue},${C.blueD})`,{fontSize:12,padding:'9px 20px'})}
                  onClick={()=>setOnboardStep('faceSetup')}>
                  ↺ Re-enroll Face ID
                </motion.button>
                <button style={btnSm(C.roseDim,{color:C.rose,border:`1px solid ${C.rose}30`,fontSize:12,padding:'9px 18px'})}
                  onClick={()=>{if(window.confirm('Remove Face ID? You can re-enroll at any time.'))handleRemoveFaceId();}}>
                  🗑 Remove Face ID
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p style={{fontSize:13,color:C.t2,marginBottom:14,lineHeight:1.65}}>
                Enable Face ID to log in instantly without typing your name. Your face data is stored locally and never shared.
              </p>
              <motion.button whileHover={{scale:1.02}} whileTap={{scale:.97}}
                style={btn(C.blueGrad,{fontSize:13,padding:'10px 24px'})}
                onClick={()=>setOnboardStep('faceSetup')}>
                👤 Set Up Face ID
              </motion.button>
            </div>
          )}
        </div>

        <div style={glass({padding:18})}>
          <SL>Preferences</SL>
          <div style={R({justifyContent:'space-between'})}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:C.t1,fontFamily:C.FD}}>Sound Effects</div>
              <div style={{fontSize:11,color:C.t3,marginTop:2}}>Audio feedback for correct answers, level-ups, and achievements</div>
            </div>
            <div onClick={()=>{const v=!sfxOn;setSfxOn(v);setSFX(v);}} style={{width:44,height:24,borderRadius:12,background:sfxOn?accent:C.s4,cursor:'pointer',position:'relative',transition:'background .2s',flexShrink:0,border:`1px solid ${sfxOn?accent:C.b2}`}}>
              <div style={{width:18,height:18,borderRadius:'50%',background:'#fff',position:'absolute',top:2,left:sfxOn?22:2,transition:'left .2s',boxShadow:'0 1px 4px rgba(0,0,0,0.4)'}}/>
            </div>
          </div>
        </div>

        <div style={glass()}>
          <SL>Specialty Path</SL>
          <p style={{fontSize:13,color:C.t2,marginBottom:16}}>Current: <span style={{color:accent,fontWeight:700,fontFamily:C.FD}}>{curPath?.label}</span></p>
          <div style={G(2,10)}>
            {Object.entries(PATHS).map(([key,p])=>(
              <motion.div key={key} whileHover={{borderColor:`${p.accent}40`}} onClick={()=>setSS(sSpec===key?'':key)} style={{...glass2({padding:16,cursor:'pointer',border:sSpec===key?`1px solid ${p.accent}60`:eSpec===key?`1px solid ${p.accent}30`:undefined,transition:'border-color .15s'})}}>
                <div style={{fontSize:13,fontWeight:700,color:sSpec===key?p.accent:eSpec===key?p.accent:C.t2,fontFamily:C.FD}}>{p.label}</div>
                <div style={{fontSize:11,color:C.t3,marginTop:3}}>{p.units.length} units · {p.units.reduce((s,u)=>s+u.lessons.length,0)} lessons</div>
                {eSpec===key&&<div style={{fontSize:10,color:p.accent,marginTop:4,fontWeight:700}}>✓ Current</div>}
              </motion.div>
            ))}
          </div>
          {sSpec&&sSpec!==eSpec&&<motion.button whileHover={{scale:1.02}} whileTap={{scale:.98}} style={{...btn(),marginTop:16}} onClick={()=>{switchPath(sSpec);setSS('');}}>Switch to {PATHS[sSpec]?.label}</motion.button>}
        </div>

        <div style={glass({padding:18})}>
          <SL>Data & Backup</SL>
          <p style={{fontSize:13,color:C.t2,marginBottom:14,lineHeight:1.65}}>Export all your progress data as a JSON file. Face ID data is excluded from exports for privacy.</p>
          <button style={btnG({fontSize:12,padding:'9px 18px'})} onClick={()=>{DB.exportAllData();toast.success('Export started — check your Downloads folder');}}>📦 Export All Data</button>
        </div>

        <div style={{...glass({border:`1px solid rgba(244,63,94,0.2)`})}}>
          <SL extra={{color:C.rose}}>Danger Zone</SL>
          <p style={{fontSize:13,color:C.t2,marginBottom:16,lineHeight:1.65}}>These actions are permanent and cannot be undone.</p>
          <div style={R({gap:10,flexWrap:'wrap'})}>
            <button style={btnSm(C.roseDim,{color:C.rose,border:`1px solid ${C.rose}30`,fontSize:12})} onClick={()=>{if(window.confirm('Reset all quiz scores and lesson progress?')){DB.resetPathway();DB.resetQuizScores();DB.resetCatPerf();setPathway_({});setQScores_({});setQHistory([]);setCatPerf_({});toast.success('Progress reset successfully.');}}} >Reset Progress</button>
            <button style={btnSm(C.roseDim,{color:C.rose,border:`1px solid ${C.rose}30`,fontSize:12})} onClick={()=>{if(window.confirm('Sign out and permanently delete all local data? This cannot be undone.'))signOut();}}>Sign Out & Clear All</button>
          </div>
        </div>

        <div style={glass({padding:18})}>
          <div style={{fontSize:11,color:C.t3,lineHeight:1.9,fontFamily:C.FM}}>
            MedSchoolPrep v2.0 &nbsp;·&nbsp; {ALL_QUIZZES.length*15} questions &nbsp;·&nbsp; {ELIB.length} resources &nbsp;·&nbsp; {Object.keys(FLASH_DECKS).length} decks &nbsp;·&nbsp; {MMI_QS.length} MMI stations<br/>
            Face ID: face-api.js (TensorFlow.js) · 100% local · zero biometric upload<br/>
            Powered by: ts-fsrs · Fuse.js · Dexie.js · KaTeX · Chart.js · Framer Motion · react-hot-toast · canvas-confetti · jsPDF · marked<br/>
            All data stored locally in your browser via IndexedDB · No account required
          </div>
        </div>
      </div>
    );
  }

  // ═══ FACE ID RE-ENROLL OVERLAY (Settings — existing logged-in user only) ════
  // This block fires when user is already logged in and triggers re-enrollment.
  // Because pendingUser is null here, the onboarding path below is not confused.
  if (onboardStep === 'faceSetup' && user) {
    return (
      <ErrorBoundary>
        <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:20,fontFamily:C.FB,position:'relative',overflow:'hidden'}}>
          <Toaster position="bottom-right"/>
          <div style={{position:'absolute',top:'-15%',right:'-5%',width:'45vw',height:'45vw',borderRadius:'50%',background:`radial-gradient(circle,rgba(45,127,255,0.1),transparent 65%)`,pointerEvents:'none'}}/>
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
            style={{width:'100%',maxWidth:500,position:'relative',zIndex:1,...glass({padding:0,overflow:'hidden',borderRadius:24})}}>
            <FaceEnroll
              accent={C.blue}
              mode="settings"
              onSuccess={async (descriptor) => {
                setFaceDescriptor(descriptor);
                setHasFaceId(true);
                setOnboardStep('name');
                toast.success('Face ID updated successfully! 👤', { duration:3500 });
              }}
              onCancel={() => setOnboardStep('name')}
              onSkip={() => setOnboardStep('name')}
            />
          </motion.div>
        </div>
      </ErrorBoundary>
    );
  }

  // ═══ FACE ID SETUP — new-user onboarding ═════════════════════════════════════
  // FIX: This block was previously unreachable because the old code called
  // saveUser() inside createUserAndProceed(), setting `user` before this render.
  // Now we use pendingUser so `user` stays null until face setup completes.
  if (onboardStep === 'faceSetup' && pendingUser) {
    return (
      <ErrorBoundary>
        <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:20,fontFamily:C.FB,position:'relative',overflow:'hidden'}}>
          <Toaster position="bottom-right"/>
          <div style={{position:'absolute',top:'-15%',right:'-5%',width:'45vw',height:'45vw',borderRadius:'50%',background:`radial-gradient(circle,rgba(45,127,255,0.1),transparent 65%)`,pointerEvents:'none'}}/>
          <div style={{position:'absolute',bottom:'-10%',left:'-5%',width:'35vw',height:'35vw',borderRadius:'50%',background:`radial-gradient(circle,rgba(6,182,212,0.07),transparent 65%)`,pointerEvents:'none'}}/>
          <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
            style={{width:'100%',maxWidth:500,position:'relative',zIndex:1,...glass({padding:0,overflow:'hidden',borderRadius:24})}}>
            <FaceEnroll
              accent={C.blue}
              mode="onboarding"
              onSuccess={handleFaceEnrollSuccess}
              onSkip={handleFaceEnrollSkip}
            />
          </motion.div>
        </div>
      </ErrorBoundary>
    );
  }

  // ═══ ONBOARDING ════════════════════════════════════════════════════════════
  if (!dbReady) return <LoadingScreen/>;

  if (!user) {
    // ── Returning user: Face ID scanner ──────────────────────────────────────
    if (faceLoginMode && faceDescriptor) {
      return (
        <ErrorBoundary>
          <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:20,fontFamily:C.FB,position:'relative',overflow:'hidden'}}>
            <Toaster position="bottom-right"/>
            <div style={{position:'absolute',top:'-15%',right:'-5%',width:'45vw',height:'45vw',borderRadius:'50%',background:`radial-gradient(circle,rgba(45,127,255,0.1),transparent 65%)`,pointerEvents:'none'}}/>
            <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
              style={{width:'100%',maxWidth:460,position:'relative',zIndex:1}}>
              <div style={{textAlign:'center',marginBottom:24}}>
                <div style={{width:56,height:56,borderRadius:16,background:`linear-gradient(135deg,rgba(45,127,255,0.25),rgba(6,182,212,0.15))`,border:`1px solid rgba(45,127,255,0.3)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,margin:'0 auto 14px',boxShadow:`0 0 40px rgba(45,127,255,0.25)`}}>🧬</div>
                <h1 style={{fontSize:22,fontWeight:800,color:C.t1,margin:'0 0 4px',fontFamily:C.FD}}>MedSchoolPrep</h1>
                <p style={{fontSize:12,color:C.t3,margin:0}}>Face ID Login</p>
              </div>
              <div style={{...glass({padding:0,overflow:'hidden',borderRadius:20})}}>
                <FaceLogin
                  storedDescriptor={faceDescriptor}
                  userName=""
                  accent={C.blue}
                  onSuccess={handleFaceLoginSuccess}
                  onFallback={() => setFaceLoginMode(false)}
                />
              </div>
            </motion.div>
          </div>
        </ErrorBoundary>
      );
    }

    // ── Name entry (standard onboarding) ──────────────────────────────────────
    return (
      <ErrorBoundary>
        <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg,padding:20,fontFamily:C.FB,position:'relative',overflow:'hidden'}}>
          <Toaster position="bottom-right"/>
          <div style={{position:'absolute',top:'-15%',right:'-5%',width:'45vw',height:'45vw',borderRadius:'50%',background:`radial-gradient(circle,rgba(45,127,255,0.1),transparent 65%)`,pointerEvents:'none'}}/>
          <div style={{position:'absolute',bottom:'-10%',left:'-5%',width:'35vw',height:'35vw',borderRadius:'50%',background:`radial-gradient(circle,rgba(6,182,212,0.07),transparent 65%)`,pointerEvents:'none'}}/>
          <motion.div initial={{opacity:0,y:24}} animate={{opacity:1,y:0}} transition={{duration:.6,ease:[.16,1,.3,1]}} style={{width:'100%',maxWidth:460,position:'relative',zIndex:1}}>
            <div style={{textAlign:'center',marginBottom:36}}>
              <motion.div initial={{scale:.8,rotate:-10}} animate={{scale:1,rotate:0}} transition={{delay:.2,type:'spring',stiffness:200}} style={{width:72,height:72,borderRadius:20,background:`linear-gradient(135deg,rgba(45,127,255,0.25),rgba(6,182,212,0.15))`,border:`1px solid rgba(45,127,255,0.3)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,margin:'0 auto 22px',boxShadow:`0 0 40px rgba(45,127,255,0.25),0 0 80px rgba(45,127,255,0.1)`}}>🧬</motion.div>
              <h1 style={{fontSize:36,fontWeight:800,color:C.t1,margin:'0 0 10px',letterSpacing:'-.04em',fontFamily:C.FD}}>MedSchoolPrep</h1>
              <p style={{fontSize:14,color:C.t2,lineHeight:1.7,maxWidth:340,margin:'0 auto'}}>The complete AI-powered ecosystem for MCAT preparation and medical school admissions.</p>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8,justifyContent:'center',marginBottom:32}}>
              {['180 MCAT Questions','FSRS Flashcards','AI Coach','MMI Practice','Admissions Calc','Face ID Login'].map(f=>(
                <span key={f} style={pill(C.s2,C.t2,{border:`1px solid ${C.b1}`,fontSize:11})}>{f}</span>
              ))}
            </div>
            {hasFaceId && faceDescriptor && (
              <motion.div whileHover={{borderColor:`${C.blue}40`,background:`rgba(45,127,255,0.06)`}}
                onClick={()=>setFaceLoginMode(true)}
                style={{...glass({padding:'16px 20px',marginBottom:16,cursor:'pointer',border:`1px solid ${C.blue}25`,transition:'all .2s'})}}>
                <div style={R({justifyContent:'space-between'})}>
                  <div style={R({gap:12})}>
                    <div style={{width:40,height:40,borderRadius:10,background:`${C.blue}18`,border:`1px solid ${C.blue}25`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>👤</div>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:C.t1,fontFamily:C.FD}}>Continue with Face ID</div>
                      <div style={{fontSize:11,color:C.t3,marginTop:2}}>Log in instantly — just look at the camera</div>
                    </div>
                  </div>
                  <span style={{fontSize:18,color:C.blueL}}>→</span>
                </div>
              </motion.div>
            )}
            <div style={glass({padding:32})}>
              <span style={lbl()}>Your first name</span>
              <input
                style={{...inp({fontSize:15,padding:'13px 18px',marginBottom:16})}}
                placeholder="e.g., Alex"
                value={uname}
                onChange={e=>setUname(e.target.value)}
                autoFocus
                onKeyDown={e=>{if(e.key==='Enter'&&uname.trim())createUserAndProceed();}}
              />
              <motion.button whileHover={{scale:1.02,boxShadow:`0 8px 30px rgba(45,127,255,0.5)`}} whileTap={{scale:.97}}
                style={{...btn(C.blueGrad),width:'100%',padding:'14px',fontSize:15,boxShadow:`0 6px 24px rgba(45,127,255,0.4)`}}
                onClick={createUserAndProceed}>
                Get Started →
              </motion.button>
              <p style={{textAlign:'center',fontSize:12,color:C.t3,marginTop:16,lineHeight:1.6}}>No account required · Data stored locally · Works offline</p>
            </div>
          </motion.div>
        </div>
      </ErrorBoundary>
    );
  }

  // ═══ ACTIVE QUIZ FULLSCREEN ════════════════════════════════════════════════
  if (aQuiz) {
    return (
      <ErrorBoundary>
        <div style={{minHeight:'100vh',background:C.bg,color:C.t1,fontFamily:C.FB}}>
          <Toaster position="top-right"/>
          <div style={{maxWidth:780,margin:'0 auto',padding:'24px 24px 60px'}}>
            <div style={{...glass({padding:'14px 22px',marginBottom:18}),...R()}}>
              <span style={pill(C.blueDim,C.blueL,{fontSize:11})}>{aQuiz.cat}</span>
              <span style={{fontSize:14,fontWeight:700,color:C.t1,fontFamily:C.FD,marginLeft:4}}>{aQuiz.title}</span>
              <span style={{marginLeft:'auto',...pill(C.s3,C.t3,{fontSize:10})}}>{aQuiz.diff}</span>
            </div>
            <div style={glass()}>
              <QuizEngine quiz={aQuiz} onFinish={finishQuiz} onClose={()=>setAQ(null)} accent={accent}/>
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  // ═══ MAIN LAYOUT ═══════════════════════════════════════════════════════════
  const tRenders={home:tHome,diagnostic:tDiag,pathway:tPath,quizzes:tQuizzes,coach:tCoach,flashcards:tFlash,library:tLib,portfolio:tPort,interview:tInterview,calc:tCalc,analytics:tAnalytics,settings:tSettings};

  return (
    <ErrorBoundary>
      <Toaster position="bottom-right" toastOptions={{style:{background:C.s1,color:C.t1,border:`1px solid ${C.b2}`,fontFamily:C.FB,fontSize:13,boxShadow:`0 8px 32px rgba(0,0,0,0.6)`},success:{iconTheme:{primary:C.green,secondary:C.s1}},error:{iconTheme:{primary:C.rose,secondary:C.s1}}}}/>
      <AnimatePresence>
        {vidM&&<VideoModal key="vidmodal" ytId={vidM.ytId} title={vidM.title} onClose={()=>setVM(null)}/>}
      </AnimatePresence>
      <div style={{display:'flex',height:'100vh',overflow:'hidden',background:C.bg,color:C.t1,fontFamily:C.FB,position:'relative'}}>

        {/* SIDEBAR */}
        <aside style={{width:236,flexShrink:0,display:'flex',flexDirection:'column',overflow:'hidden',borderRight:`1px solid ${C.b1}`,background:`linear-gradient(180deg,${C.s0} 0%,${C.bg} 100%)`,position:'relative',zIndex:10}}>
          <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${accent}60,transparent)`}}/>
          <div style={{padding:'20px 18px 16px',borderBottom:`1px solid ${C.b1}`}}>
            <div style={R({gap:11})}>
              <div style={{width:34,height:34,borderRadius:9,background:`linear-gradient(135deg,rgba(45,127,255,0.3),rgba(6,182,212,0.15))`,border:`1px solid rgba(45,127,255,0.25)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,boxShadow:`0 4px 12px rgba(45,127,255,0.2)`}}>🧬</div>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:C.t1,letterSpacing:'-.02em',fontFamily:C.FD}}>MedSchoolPrep</div>
                <div style={{fontSize:9,color:C.t3,letterSpacing:'.1em',textTransform:'uppercase',marginTop:1}}>MCAT + ADMISSIONS</div>
              </div>
            </div>
          </div>
          <div style={{padding:'14px 18px',borderBottom:`1px solid ${C.b1}`}}>
            <div style={R({gap:11,marginBottom:12})}>
              <div style={{width:36,height:36,borderRadius:11,background:`linear-gradient(135deg,${accent}55,${accent}28)`,border:`1.5px solid ${accent}45`,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:14,color:'#fff',flexShrink:0,boxShadow:`0 4px 12px ${accent}30,0 0 0 3px ${accent}10`}}>
                {user.name[0].toUpperCase()}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:C.t1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:C.FD}}>{user.name}</div>
                <div style={{fontSize:11,color:C.t3,marginTop:1}}>Lv.{lvl} · {curPath?.label}</div>
              </div>
            </div>
            <div style={R({justifyContent:'space-between',marginBottom:6})}>
              <span style={{fontSize:10,color:C.t3,fontFamily:C.FM}}>{xpIn} / 250 XP</span>
              <span style={{fontSize:10,color:accent,fontFamily:C.FM,fontWeight:600}}>{Math.round((xpIn/250)*100)}%</span>
            </div>
            <Bar pct={(xpIn/250)*100} color={accent} h={3} glow/>
            <div style={{...R({gap:6,marginTop:8,flexWrap:'wrap'})}}>
              {streak>0&&<span style={pill(C.amberDim,C.amberL,{fontSize:10})}>🔥 {streak}d</span>}
              {dueCards>0&&<span style={pill(C.violetDim,C.violetL,{fontSize:10,fontFamily:C.FM})}>{dueCards} due</span>}
              {hasFaceId&&<span style={pill(`${C.blue}18`,C.blueL,{fontSize:9})}>👤</span>}
            </div>
          </div>
          <div style={{padding:'13px 18px',borderBottom:`1px solid ${C.b1}`}}>
            <div style={{fontSize:9,fontWeight:700,color:C.t3,letterSpacing:'.1em',textTransform:'uppercase',marginBottom:10}}>
              {pomM==='focus'?'🎯 Focus Session':'☕ Break Time'}{pomSessions>0&&<span style={{marginLeft:6,fontFamily:C.FM,color:C.amber}}>×{pomSessions}</span>}
            </div>
            <div style={R({gap:10})}>
              <Arc pct={pomM==='focus'?(pomT/(25*60))*100:(pomT/(5*60))*100} size={50} stroke={4} color={pomM==='focus'?accent:C.green} label={fmtT(pomT)}/>
              <div style={CC({gap:6,flex:1})}>
                <button style={btnSm(pomR?C.roseDim:C.greenDim,{color:pomR?C.rose:C.greenL,border:`1px solid ${pomR?C.rose:C.green}30`,padding:'5px 0',width:'100%',fontSize:11})} onClick={()=>setPR(r=>!r)}>{pomR?'⏸ Pause':'▶ Start'}</button>
                <button style={btnSm(C.s4,{color:C.t3,border:`1px solid ${C.b1}`,padding:'5px 0',width:'100%',fontSize:11})} onClick={()=>{setPR(false);setPT(pomM==='focus'?25*60:5*60);}}>↺ Reset</button>
              </div>
            </div>
          </div>
          <nav style={{flex:1,padding:'8px 10px',overflowY:'auto'}}>
            {NAV.map(n=>{
              const active=tab===n.id;
              return(
                <motion.div key={n.id} onClick={()=>{setTab(n.id);play('click');}}
                  whileHover={!active?{background:C.s2,color:C.t1}:{}}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:9,cursor:'pointer',marginBottom:1,
                    background:active?`linear-gradient(90deg,${accent}18,${accent}05)`:undefined,
                    color:active?'#fff':C.t2,fontWeight:active?700:400,fontSize:13,fontFamily:C.FB,
                    borderLeft:active?`2px solid ${accent}`:'2px solid transparent',transition:'color .12s,background .12s'}}>
                  <span style={{fontSize:15,width:20,textAlign:'center',flexShrink:0,filter:active?`drop-shadow(0 0 4px ${accent})`:'none'}}>{n.ic}</span>
                  <span style={{flex:1}}>{n.label}</span>
                  {n.id==='flashcards'&&dueCards>0&&<span style={{fontSize:10,fontFamily:C.FM,background:C.violet,color:'#fff',borderRadius:10,padding:'1px 7px',fontWeight:700}}>{dueCards}</span>}
                  {n.id==='quizzes'&&qTaken>0&&<span style={{fontSize:10,fontFamily:C.FM,background:C.blueGrad,color:'#fff',borderRadius:10,padding:'1px 7px',fontWeight:700}}>{qTaken}</span>}
                </motion.div>
              );
            })}
          </nav>
          <div style={{position:'absolute',bottom:0,left:0,right:0,height:1,background:`linear-gradient(90deg,transparent,${accent}30,transparent)`}}/>
        </aside>

        {/* MAIN CONTENT */}
        <main style={{flex:1,overflowY:'auto',position:'relative',background:C.bg}}>
          <div style={{position:'sticky',top:0,left:0,right:0,height:1,background:`linear-gradient(90deg,${accent}50,${C.cyan}20,transparent)`,zIndex:5}}/>
          <div style={{maxWidth:960,margin:'0 auto',padding:'30px 30px 70px'}}>
            <AnimatePresence mode="wait">
              <motion.div key={tab} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:.22,ease:[.16,1,.3,1]}}>
                {(tRenders[tab]||tHome)()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </ErrorBoundary>
  );
}
