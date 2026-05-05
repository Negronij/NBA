/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc 
} from 'firebase/firestore';
import { 
  Trophy, 
  Settings, 
  Star, 
  LogOut, 
  User as UserIcon, 
  ChevronRight, 
  Minus, 
  Plus, 
  Lock, 
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './lib/firebase.ts';
import { 
  Team, Match, Round, Bracket, Prediction, PredMatch, Mode, Conf, 
  ALL_TEAMS, LOGO_MAP
} from './types.ts';

// --- Constants & Helpers ---

const ADMIN_EMAILS = ['juan.ignacio.negroni@gmail.com', 'juannegroni912@gmail.com'];

const mkSlot = (): Match => ({ t: [null, null], w: [0, 0] });

const freshREAL = (): Bracket => ({
  east: {
    r1: Array(4).fill(null).map(mkSlot),
    r2: Array(2).fill(null).map(mkSlot),
    r3: [mkSlot()],
  },
  west: {
    r1: Array(4).fill(null).map(mkSlot),
    r2: Array(2).fill(null).map(mkSlot),
    r3: [mkSlot()],
  },
  finals: mkSlot(),
});

const freshPRED = (): Prediction => ({
  east: {
    r1: Array(4).fill(null).map(() => ({ w: [0, 0] })),
    r2: Array(2).fill(null).map(() => ({ w: [0, 0] })),
    r3: [{ w: [0, 0] }],
  },
  west: {
    r1: Array(4).fill(null).map(() => ({ w: [0, 0] })),
    r2: Array(2).fill(null).map(() => ({ w: [0, 0] })),
    r3: [{ w: [0, 0] }],
  },
  finals: { w: [0, 0] },
});

function winner(m: Match | null): number | null {
  if (!m) return null;
  if (m.w[0] === 4) return 0;
  if (m.w[1] === 4) return 1;
  return null;
}

function propagateREAL(bracket: Bracket): Bracket {
  const newBracket = JSON.parse(JSON.stringify(bracket)) as Bracket;
  
  (['east', 'west'] as const).forEach(c => {
    const C = newBracket[c];
    // R1 -> R2
    for (let p = 0; p < 2; p++) {
      const w0 = winner(C.r1[p * 2]);
      const w1 = winner(C.r1[p * 2 + 1]);
      const dst = C.r2[p];
      
      const prev = [dst.t[0]?.id, dst.t[1]?.id];
      dst.t[0] = w0 !== null ? { ...C.r1[p * 2].t[w0]! } : null;
      dst.t[1] = w1 !== null ? { ...C.r1[p * 2 + 1].t[w1]! } : null;
      
      if (dst.t[0] && prev[0] !== dst.t[0].id) dst.w[0] = 0;
      if (dst.t[1] && prev[1] !== dst.t[1].id) dst.w[1] = 0;
    }
    
    // R2 -> R3
    const w0 = winner(C.r2[0]);
    const w1 = winner(C.r2[1]);
    const d3 = C.r3[0];
    const prev = [d3.t[0]?.id, d3.t[1]?.id];
    d3.t[0] = w0 !== null ? { ...C.r2[0].t[w0]! } : null;
    d3.t[1] = w1 !== null ? { ...C.r2[1].t[w1]! } : null;
    
    if (d3.t[0] && prev[0] !== d3.t[0].id) d3.w[0] = 0;
    if (d3.t[1] && prev[1] !== d3.t[1].id) d3.w[1] = 0;
  });

  // R3 -> Finals
  const ew = winner(newBracket.east.r3[0]);
  const ww = winner(newBracket.west.r3[0]);
  const prev = [newBracket.finals.t[0]?.id, newBracket.finals.t[1]?.id];
  newBracket.finals.t[0] = ew !== null ? { ...newBracket.east.r3[0].t[ew]! } : null;
  newBracket.finals.t[1] = ww !== null ? { ...newBracket.west.r3[0].t[ww]! } : null;
  
  if (newBracket.finals.t[0] && prev[0] !== newBracket.finals.t[0].id) newBracket.finals.w[0] = 0;
  if (newBracket.finals.t[1] && prev[1] !== newBracket.finals.t[1].id) newBracket.finals.w[1] = 0;

  return newBracket;
}

// --- Main Component ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('r1');
  const [conf, setConf] = useState<Conf>('east');
  const [showToast, setShowToast] = useState(false);
  const [teamSelector, setTeamSelector] = useState<{ conf: 'east' | 'west', round: keyof Round, idx: number, slot: number } | null>(null);
  
  const [realBracket, setRealBracket] = useState<Bracket>(freshREAL());
  const [userPredictions, setUserPredictions] = useState<Record<string, Prediction>>({
    r1: freshPRED(), r2: freshPRED(), r3: freshPRED(), rf: freshPRED()
  });

  const isAdmin = useMemo(() => {
    return user && ADMIN_EMAILS.includes(user.email || '');
  }, [user]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Sync Real Bracket
  useEffect(() => {
    if (!user) return;
    const bracketDoc = doc(db, 'shared', 'adminResults');
    const unsub = onSnapshot(bracketDoc, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.bracket) {
          setRealBracket(data.bracket);
        }
      } else if (isAdmin) {
        // Auto-initialize if admin and document doesn't exist
        saveBracket(freshREAL());
      }
    }, (err) => {
      console.error("Bracket listener error:", err);
    });
    return unsub;
  }, [user, isAdmin]);

  // Sync User Predictions
  useEffect(() => {
    if (!user) return;
    const userDoc = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userDoc, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.predictions) {
          setUserPredictions((prev) => ({ ...prev, ...data.predictions }));
        }
      }
    }, (err) => {
      console.error("Predictions listener error:", err);
    });
    return unsub;
  }, [user]);

  const triggerToast = () => {
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  // Save changes helper
  const saveBracket = async (newBracket: Bracket) => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'shared', 'adminResults'), { bracket: newBracket });
      triggerToast();
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'shared/adminResults');
    }
  };

  const savePrediction = async (modeKey: Mode, newPred: Prediction) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'users', user.uid), { 
        email: user.email,
        predictions: { [modeKey]: newPred } 
      }, { merge: true });
      triggerToast();
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  // --- Actions ---

  const handleAdjustWins = (matchConf: Conf, round: keyof Round | 'finals', idx: number, ti: number, delta: number) => {
    if (mode === 'admin') {
      const nextBracket = JSON.parse(JSON.stringify(realBracket)) as Bracket;
      const m = matchConf === 'finals' ? nextBracket.finals : nextBracket[matchConf as 'east' | 'west'][round as keyof Round][idx];
      
      m.w[ti] = Math.max(0, Math.min(4, m.w[ti] + delta));
      if (m.w[ti] === 4) m.w[1-ti] = Math.min(3, m.w[1-ti]);
      
      const propagated = propagateREAL(nextBracket);
      setRealBracket(propagated);
      saveBracket(propagated);
    } else {
      const predLayer = mode as keyof typeof userPredictions;
      const nextPred = JSON.parse(JSON.stringify(userPredictions[predLayer])) as Prediction;
      
      const pw = matchConf === 'finals' ? nextPred.finals.w : nextPred[matchConf as 'east' | 'west'][round as keyof Round][idx].w;
      pw[ti] = Math.max(0, Math.min(4, pw[ti] + delta));
      if (pw[ti] === 4) pw[1-ti] = Math.min(3, pw[1-ti]);
      
      setUserPredictions(prev => ({ ...prev, [predLayer]: nextPred }));
      savePrediction(predLayer as Mode, nextPred);
    }
  };

  const handlePickTeam = (matchConf: 'east' | 'west', round: keyof Round, idx: number, slot: number, teamId: string) => {
    if (!isAdmin) return;
    const nextBracket = JSON.parse(JSON.stringify(realBracket)) as Bracket;
    const team = ALL_TEAMS.find(t => t.id === teamId);
    if (!team) return;
    
    const m = nextBracket[matchConf][round][idx];
    m.t[slot] = { ...team, seed: m.t[slot]?.seed || '' };
    m.w[slot] = 0;
    
    const propagated = propagateREAL(nextBracket);
    setRealBracket(propagated);
    saveBracket(propagated);
  };

  const handleSetSeed = (matchConf: 'east' | 'west', round: keyof Round, idx: number, slot: number, seed: string) => {
    if (!isAdmin) return;
    const nextBracket = JSON.parse(JSON.stringify(realBracket)) as Bracket;
    const m = nextBracket[matchConf][round][idx];
    if (m.t[slot]) {
      m.t[slot]!.seed = seed;
    }
    setRealBracket(nextBracket);
    saveBracket(nextBracket);
  };

  // --- Render Helpers ---

  if (loading) {
    return (
      <div className="min-h-screen bg-[#08090d] flex items-center justify-center text-white font-['Barlow']">
        <motion.div 
          animate={{ rotate: 360 }} 
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#08090d] flex flex-col items-center justify-center p-6 font-['Barlow'] overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,#1c2540_0%,#08090d_70%)] opacity-50 pointer-events-none" />
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative z-10 flex flex-col items-center"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 flex items-center justify-center text-black font-['Barlow_Condensed'] font-black text-3xl shadow-[0_0_50px_rgba(201,168,76,0.3)] mb-4">
            NBA
          </div>
          <h1 className="text-4xl md:text-5xl font-['Barlow_Condensed'] font-black tracking-widest text-amber-100 uppercase mb-2">
            NBAngs
          </h1>
          <p className="text-xs text-slate-500 tracking-[0.2em] uppercase mb-12">
            Playoff Bracket · 2024-25
          </p>
          
          <div className="w-full max-w-sm bg-[#0f1117] border border-white/10 rounded-2xl p-8 shadow-2xl">
            <h3 className="text-slate-400 font-['Barlow_Condensed'] font-bold text-sm tracking-wider uppercase mb-6 text-center">
              Comienza tu predicción
            </h3>
            
            <button 
              onClick={loginWithGoogle}
              className="w-full bg-[#161922] hover:bg-[#1d2130] text-white border border-white/10 rounded-xl py-3.5 px-6 font-['Barlow_Condensed'] font-bold text-lg flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <svg className="w-5 h-5" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.6 2.1 30.1 0 24 0 14.6 0 6.7 5.6 2.7 13.7l7.8 6C12.3 13.5 17.7 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.5c-.5 2.7-2.1 5-4.4 6.5l7 5.4c4-3.7 6.3-9.2 6.3-15.5z"/>
                <path fill="#FBBC05" d="M10.5 28.3A14.6 14.6 0 0 1 9.5 24c0-1.5.3-2.9.7-4.3L2.4 13.7A24 24 0 0 0 0 24c0 3.9.9 7.5 2.7 10.7l7.8-6.4z"/>
                <path fill="#34A853" d="M24 48c6 0 11.1-2 14.8-5.4l-7-5.4c-2 1.3-4.5 2.1-7.8 2.1-6.3 0-11.6-4.2-13.5-10l-7.8 6.1C6.7 42.4 14.6 48 24 48z"/>
              </svg>
              Continuar con Google
            </button>
            
            <p className="mt-8 text-center text-[10px] text-slate-600 uppercase tracking-widest leading-relaxed">
              Al continuar aceptas participar en el <br/> desafío de predicción NBAngs
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  // Bracket rendering logic
  const renderBracket = () => {
    if (mode === 'pts') return <ScoreView user={user} realBracket={realBracket} userPredictions={userPredictions} />;

    return (
      <div className="p-4 max-w-2xl mx-auto space-y-6">
        <Banner mode={mode} isAdmin={isAdmin} />
        
        {conf === 'finals' ? (
          <FinalsView 
            mode={mode} 
            isAdmin={isAdmin} 
            bracket={realBracket} 
            prediction={userPredictions[mode === 'admin' ? 'r1' : mode]}
            onAdjust={handleAdjustWins}
          />
        ) : (
          <ConferenceView 
            conf={conf} 
            mode={mode} 
            isAdmin={isAdmin} 
            bracket={realBracket} 
            prediction={userPredictions[mode === 'admin' ? 'r1' : mode]}
            onAdjust={handleAdjustWins}
            onPick={(c: any, r: any, i: any, s: any) => setTeamSelector({ conf: c, round: r, idx: i, slot: s })}
            onSeed={handleSetSeed}
          />
        )}

        <TeamSelector 
          isOpen={!!teamSelector} 
          onClose={() => setTeamSelector(null)} 
          onSelect={(id) => {
            if (teamSelector) {
              handlePickTeam(teamSelector.conf, teamSelector.round, teamSelector.idx, teamSelector.slot, id);
              setTeamSelector(null);
            }
          }}
          conf={teamSelector?.conf || 'east'}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#08090d] text-white font-['Barlow'] pb-12">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0f1117] border-b border-white/5 px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 flex items-center justify-center text-black font-black text-xs font-['Barlow_Condensed']">
            NBA
          </div>
          <div>
            <div className="font-['Barlow_Condensed'] font-black text-xl leading-none text-amber-200 uppercase">NBAngs</div>
            <div className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">
              {mode === 'admin' ? 'Panel Admin' : mode === 'pts' ? 'Estadísticas' : `Predicción ${mode.toUpperCase()}`}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isAdmin && (
            <div className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter">
              Admin
            </div>
          )}
          <div className="w-8 h-8 rounded-full overflow-hidden border border-white/20 bg-slate-800 flex items-center justify-center">
            {user.photoURL ? <img src={user.photoURL} alt="User" /> : <UserIcon className="w-4 h-4 text-slate-400" />}
          </div>
          <button onClick={logout} className="p-2 text-slate-500 hover:text-white transition-colors">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Mode Bar */}
      <nav className="bg-[#0f1117] border-b border-white/5 flex overflow-x-auto no-scrollbar scroll-smooth sticky top-[61px] z-40">
        {[
          { icon: '🟢', id: 'r1', label: 'R1' },
          { icon: '🔵', id: 'r2', label: 'R2' },
          { icon: '🩷', id: 'r3', label: 'R3' },
          { icon: '🏆', id: 'rf', label: 'Finals' },
          ...(isAdmin ? [{ icon: '⚙️', id: 'admin', label: 'Admin' }] : []),
          { icon: '⭐', id: 'pts', label: 'Score' }
        ].map(m => (
          <button
            key={m.id}
            onClick={() => setMode(m.id as Mode)}
            className={`flex-1 min-w-[72px] py-3 text-center transition-all border-b-2 flex flex-col items-center gap-1 ${
              mode === m.id 
                ? 'bg-white/5 border-amber-500 text-amber-400' 
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <span className="text-xs">{m.icon}</span>
            <span className="font-['Barlow_Condensed'] font-bold text-[11px] tracking-widest uppercase">{m.label}</span>
          </button>
        ))}
      </nav>

      {/* Conf Bar */}
      {mode !== 'pts' && (
        <nav className="bg-[#0f1117] border-b border-white/5 flex sticky top-[114px] z-40">
          {[
            { id: 'east', label: 'Este', color: 'text-blue-400', border: 'border-blue-500', bg: 'bg-blue-500/10' },
            { id: 'west', label: 'Oeste', color: 'text-red-400', border: 'border-red-500', bg: 'bg-red-500/10' },
            { id: 'finals', label: 'Finals', color: 'text-amber-400', border: 'border-amber-500', bg: 'bg-amber-500/10' }
          ].map(c => {
            const isActive = conf === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setConf(c.id as Conf)}
                className={`flex-1 py-3.5 text-center font-['Barlow_Condensed'] font-bold text-xs uppercase tracking-widest transition-all border-b-2 ${
                  isActive ? `${c.bg} ${c.color} ${c.border}` : 'border-transparent text-slate-500'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* Main Content */}
      <AnimatePresence mode="wait">
        <motion.main
          key={`${mode}-${conf}`}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2 }}
        >
          {renderBracket()}
        </motion.main>
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 right-6 z-[100] bg-green-500 text-white px-4 py-2 rounded-full font-bold text-sm shadow-xl flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Guardado
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

function Banner({ mode, isAdmin }: { mode: Mode, isAdmin: boolean }) {
  const configs = {
    r1: { bg: 'border-green-500/30 bg-green-500/5 text-green-400', icon: '🟢', txt: 'Predicción R1 — Elegí ganadores de cada ronda' },
    r2: { bg: 'border-blue-500/30 bg-blue-500/5 text-blue-400', icon: '🔵', txt: 'Predicción R2 — Equipos que avanzaron en 1ª Ronda' },
    r3: { bg: 'border-pink-500/30 bg-pink-500/5 text-pink-400', icon: '🩷', txt: 'Predicción R3 — Final de Conferencia' },
    rf: { bg: 'border-amber-500/30 bg-amber-500/5 text-amber-400', icon: '🏆', txt: 'Predicción Finals únicamente' },
    admin: { bg: 'border-red-500/30 bg-red-500/5 text-red-500', icon: '⚙️', txt: 'Admin Panel — Configura equipos y resultados reales' },
    pts: { bg: '', icon: '', txt: '' }
  };

  const cfg = configs[mode];
  if (!cfg.txt) return null;

  return (
    <div className={`flex items-center gap-3 p-3.5 rounded-xl border ${cfg.bg} text-[13px] font-['Barlow_Condensed'] font-bold leading-none`}>
      <span className="text-base">{cfg.icon}</span>
      {cfg.txt}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <span className="text-[10px] font-['Barlow_Condensed'] font-bold uppercase tracking-[0.2em] text-slate-600 whitespace-nowrap">
        {children}
      </span>
      <div className="h-px bg-white/5 w-full" />
    </div>
  );
}

function TeamSelector({ isOpen, onClose, onSelect, conf }: { isOpen: boolean, onClose: () => void, onSelect: (id: string) => void, conf: 'east' | 'west' }) {
  const teams = ALL_TEAMS.filter(t => t.conf.toLowerCase() === conf.toLowerCase());

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 z-[100]"
          />
          <motion.div 
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed inset-x-0 bottom-0 bg-[#0f1117] border-t border-white/10 rounded-t-3xl z-[101] max-h-[70vh] flex flex-col"
          >
            <div className="w-10 h-1.5 bg-white/10 rounded-full mx-auto my-3" />
            <div className="px-6 py-2 border-b border-white/5">
              <h3 className="font-['Barlow_Condensed'] font-bold text-xl uppercase text-amber-200">Elegir Equipo</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">Conferencia {conf === 'east' ? 'Este' : 'Oeste'}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {teams.map(t => (
                <button 
                  key={t.id}
                  onClick={() => onSelect(t.id)}
                  className="w-full flex items-center gap-4 p-3 hover:bg-white/5 rounded-xl transition-colors text-left"
                >
                  <Logo id={t.id} size={36} />
                  <div>
                    <div className="font-['Barlow_Condensed'] font-bold text-lg leading-none">{t.name}</div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-tighter">{t.conf}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="p-4">
              <button onClick={onClose} className="w-full bg-[#161922] py-4 rounded-xl font-['Barlow_Condensed'] font-bold text-slate-400">Cancelar</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const Logo = ({ id, size = 36 }: { id: string | null | undefined, size?: number }) => {
  if (!id) return (
    <div className="bg-[#1d2130] border border-white/5 rounded-full flex items-center justify-center font-['Barlow_Condensed'] font-bold text-slate-600 text-[10px]" style={{ width: size, height: size }}>
      ?
    </div>
  );
  
  const logoKey = LOGO_MAP[id] || id;
  // Fallback for logos
  const src = `https://www.nba.com/assets/logos/teams/primary/full/${id}.svg`;
  
  return (
    <div className="bg-white rounded-full flex items-center justify-center overflow-hidden border border-white/10" style={{ width: size, height: size }}>
      <img 
        src={src} 
        alt={id} 
        className="w-[85%] h-[85%] object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).src = `https://cdn.nba.com/logos/nba/${id}/primary/L/logo.svg`;
        }}
      />
    </div>
  );
};

interface MatchupProps {
  key?: React.Key;
  conf: Conf;
  round: string;
  idx: number;
  m: Match;
  pm?: PredMatch;
  onAdjust: (c: Conf, r: any, i: number, ti: number, d: number) => void;
  isAdminMode: boolean;
  onPick?: any;
  onSeed?: any;
}

function Matchup({ 
  conf, round, idx, m, pm, onAdjust, isAdminMode, onPick, onSeed 
}: MatchupProps) {
  const w = winner(m);
  const pw = pm ? (pm.w[0] === 4 ? 0 : pm.w[1] === 4 ? 1 : null) : null;
  const isReady = !!(m.t[0] && m.t[1]);

  return (
    <div className={`bg-[#0f1117] border rounded-xl overflow-hidden shadow-xl transition-all duration-300 ${w !== null ? 'border-white/20' : 'border-white/5'}`}>
      {[0, 1].map(ti => {
        const team = m.t[ti];
        const wins = isAdminMode ? m.w[ti] : (pm?.w[ti] || 0);
        const isWinner = isAdminMode ? (w === ti) : (pw === ti);
        const canPick = isAdminMode && round === 'r1';

        return (
          <div key={ti} className={`flex items-center gap-3 p-3 min-h-[56px] transition-colors ${isWinner ? 'bg-green-500/10' : ''} ${ti === 0 ? 'border-b border-white/5' : ''}`}>
            <Logo id={team?.id} size={34} />
            
            <div className="flex-1 flex items-center gap-2">
              {team ? (
                <div 
                  onClick={() => isAdminMode && onSeed(conf, round, idx, ti, prompt('Nuevo Seed (1-8):', team.seed) || team.seed)}
                  className="bg-[#1d2130] text-slate-400 text-[10px] font-black px-1.5 py-0.5 rounded cursor-help"
                >
                  {team.seed || '?'}
                </div>
              ) : (
                <div className="bg-[#1d2130]/50 text-slate-700 text-[10px] font-black px-1.5 py-0.5 rounded opacity-30">—</div>
              )}
              
              <div 
                onClick={() => canPick && onPick(conf, round, idx, ti)}
                className={`font-['Barlow_Condensed'] font-bold text-lg cursor-pointer ${!team ? 'text-slate-700 italic' : 'text-white'}`}
              >
                {team ? team.short : canPick ? 'Elegir equipo' : 'Por definir'}
              </div>
            </div>

            {isReady && (
              <div className="flex items-center bg-[#161922] border border-white/10 rounded-lg overflow-hidden h-9">
                <button 
                  onClick={() => onAdjust(conf, round, idx, ti, -1)}
                  className="w-8 h-full flex items-center justify-center text-slate-500 active:bg-white/5"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <div className={`w-7 text-center font-['Barlow_Condensed'] font-black text-lg ${wins === 4 ? 'text-green-400' : 'text-slate-300'}`}>
                  {wins}
                </div>
                <button 
                  onClick={() => onAdjust(conf, round, idx, ti, 1)}
                  className="w-8 h-full flex items-center justify-center text-slate-500 active:bg-white/5"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConferenceView({ 
  conf, mode, isAdmin, bracket, prediction, onAdjust, onPick, onSeed 
}: { 
  conf: 'east' | 'west', mode: Mode, isAdmin: boolean, 
  bracket: Bracket, prediction: Prediction, onAdjust: any, onPick: any, onSeed: any 
}) {
  const isAdminMode = mode === 'admin';
  const c = conf;
  const B = bracket[c];
  const P = prediction[c];

  return (
    <div className="space-y-2">
      <SectionLabel>Primera Ronda</SectionLabel>
      {B.r1.map((m, i) => (
        <Matchup 
          key={`r1-${i}`} conf={c} round="r1" idx={i} m={m} pm={P.r1[i]} 
          onAdjust={onAdjust} isAdminMode={isAdminMode} onPick={onPick} onSeed={onSeed} 
        />
      ))}

      <SectionLabel>Semifinales de Conferencia</SectionLabel>
      {B.r2.map((m, i) => (
        <Matchup 
          key={`r2-${i}`} conf={c} round="r2" idx={i} m={m} pm={P.r2[i]} 
          onAdjust={onAdjust} isAdminMode={isAdminMode} 
        />
      ))}

      <SectionLabel>Final de Conferencia</SectionLabel>
      <Matchup 
        conf={c} round="r3" idx={0} m={B.r3[0]} pm={P.r3[0]} 
        onAdjust={onAdjust} isAdminMode={isAdminMode} 
      />
    </div>
  );
}

function FinalsView({ 
  mode, isAdmin, bracket, prediction, onAdjust 
}: { 
  mode: Mode, isAdmin: boolean, bracket: Bracket, prediction: Prediction, onAdjust: any 
}) {
  const isAdminMode = mode === 'admin';
  const pw = prediction.finals.w;
  const pWinnerIdx = pw[0] === 4 ? 0 : pw[1] === 4 ? 1 : null;
  const champ = pWinnerIdx !== null ? bracket.finals.t[pWinnerIdx] : null;

  return (
    <div className="space-y-12 py-8">
      <div className="text-center space-y-4">
        <Trophy className="w-20 h-20 text-amber-500 mx-auto drop-shadow-[0_0_20px_rgba(245,158,11,0.4)]" />
        <div>
          <h2 className="text-4xl font-['Barlow_Condensed'] font-black uppercase tracking-tighter text-amber-100">NBA Finals</h2>
          <p className="text-[10px] text-slate-500 uppercase tracking-[0.4em]">The Championship</p>
        </div>
      </div>

      {champ && (
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-gradient-to-br from-amber-500/20 to-amber-900/10 border border-amber-500/30 rounded-3xl p-8 text-center"
        >
          <div className="text-[10px] font-['Barlow_Condensed'] font-black uppercase tracking-[0.3em] text-amber-500 mb-6">
            🏆 Campeón NBA
          </div>
          <div className="flex items-center justify-center gap-6">
            <Logo id={champ.id} size={72} />
            <div className="text-left">
              <div className="text-3xl font-['Barlow_Condensed'] font-black uppercase leading-none text-white">{champ.name}</div>
              <div className="text-amber-500/60 font-bold ml-1">#1 Best in the World</div>
            </div>
          </div>
        </motion.div>
      )}

      <div>
        <SectionLabel>Gran Final</SectionLabel>
        <Matchup 
          conf="finals" round="finals" idx={0} m={bracket.finals} pm={prediction.finals} 
          onAdjust={onAdjust} isAdminMode={isAdminMode} 
        />
      </div>
    </div>
  );
}

function ScoreView({ user, realBracket, userPredictions }: { user: User, realBracket: Bracket, userPredictions: any }) {
  const scoreMatch = (pk: string, conf: Conf, round: string, idx: number) => {
    const realM = conf === 'finals' ? realBracket.finals : realBracket[conf][round as keyof Round][idx];
    const realW = winner(realM);
    if (realW === null) return { status: 'pending', pts: 0 };

    const pred = userPredictions[pk] as Prediction;
    if (!pred) return { status: 'none', pts: 0 };
    
    const pw = conf === 'finals' ? pred.finals.w : pred[conf][round as keyof Round][idx].w;
    const predW = pw[0] === 4 ? 0 : pw[1] === 4 ? 1 : null;
    if (predW === null) return { status: 'none', pts: 0 };

    const realT = realM.t[realW];
    const predT = realM.t[predW];

    if (realT?.id !== predT?.id) return { status: 'miss', pts: 0 };

    const ptsMap = { r1: [4, 2], r2: [3, 1], r3: [2, 1], rf: [1, 1] } as any;
    const roundKey = round === 'finals' ? 'finals' : (round === 'r1' ? 'r1' : round === 'r2' ? 'r2' : 'r3');
    const scoreKey = round === 'finals' ? 'rf' : roundKey;
    const [exact, win] = ptsMap[scoreKey] || [1, 1];
    
    const realGames = 4 + realM.w[1 - realW];
    const predGames = 4 + pw[1 - predW];
    
    return realGames === predGames ? { status: 'exact', pts: exact } : { status: 'win', pts: win };
  };

  const getCovers = (pk: string) => {
    if (pk === 'r1') return ['r1', 'r2', 'r3', 'finals'];
    if (pk === 'r2') return ['r2', 'r3', 'finals'];
    if (pk === 'r3') return ['r3', 'finals'];
    return ['finals'];
  };

  const getLayersForRound = (round: string) => {
    if (round === 'r1') return ['r1'];
    if (round === 'r2') return ['r1', 'r2'];
    if (round === 'r3') return ['r1', 'r2', 'r3'];
    return ['r1', 'r2', 'r3', 'rf'];
  };

  const calculateTotal = () => {
    let t = 0;
    ['east', 'west', 'finals'].forEach(c => {
      const rounds = c === 'finals' ? ['finals'] : ['r1', 'r2', 'r3'];
      rounds.forEach(round => {
        const count = round === 'r1' ? 4 : round === 'r2' ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const layers = getLayersForRound(round);
          layers.forEach(pk => {
            t += scoreMatch(pk, c as any, round, i).pts;
          });
        }
      });
    });
    return t;
  };

  const total = calculateTotal();

  return (
    <div className="p-4 space-y-8 max-w-lg mx-auto">
      <div className="text-center py-10 space-y-2">
        <div className="text-[11px] font-black uppercase tracking-[0.3em] text-slate-500">Tus Puntos Totales</div>
        <motion.div 
          key={total}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-8xl font-['Barlow_Condensed'] font-black text-amber-500 drop-shadow-[0_0_30px_rgba(245,158,11,0.3)]"
        >
          {total}
        </motion.div>
        <div className="text-xs text-slate-600 font-bold">Actualizado en tiempo real</div>
      </div>

      <div className="bg-[#0f1117] border border-white/5 rounded-2xl p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#161922] p-4 rounded-xl border border-white/5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Puntos R1</div>
            <div className="text-2xl font-['Barlow_Condensed'] font-black text-green-400">4 / 2 PTS</div>
          </div>
          <div className="bg-[#161922] p-4 rounded-xl border border-white/5">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Puntos R2</div>
            <div className="text-2xl font-['Barlow_Condensed'] font-black text-blue-400">3 / 1 PTS</div>
          </div>
        </div>
        
        <p className="text-[11px] text-slate-500 text-center uppercase tracking-wider leading-relaxed">
          Los puntos son acumulativos. Acertar desde R1 <br/> vale más que esperar a que avance el bracket.
        </p>
      </div>

      <div className="space-y-4">
        <SectionLabel>Capas de Predicción</SectionLabel>
        <div className="bg-[#0f1117] border border-white/5 rounded-xl overflow-hidden divide-y divide-white/5">
          {[
            { id: 'r1', label: 'Predicción R1', color: 'text-green-400' },
            { id: 'r2', label: 'Predicción R2', color: 'text-blue-400' },
            { id: 'r3', label: 'Predicción R3', color: 'text-pink-400' },
            { id: 'rf', label: 'Predicción Finals', color: 'text-amber-500' }
          ].map(pk => (
            <div key={pk.id} className="flex items-center justify-between p-4">
               <div className="flex items-center gap-3">
                 <div className={`w-2 h-2 rounded-full ${pk.id === 'r1' ? 'bg-green-400' : pk.id === 'r2' ? 'bg-blue-400' : pk.id === 'r3' ? 'bg-pink-400' : 'bg-amber-500'}`} />
                 <span className={`font-['Barlow_Condensed'] font-bold text-sm uppercase tracking-widest ${pk.color}`}>{pk.label}</span>
               </div>
               <div className="text-xs font-bold text-slate-500">
                 {pk.id === 'r1' ? 'R1, R2, R3, Finals' : pk.id === 'r2' ? 'R2, R3, Finals' : pk.id === 'r3' ? 'R3, Finals' : 'Finals'}
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
