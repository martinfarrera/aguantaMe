(() => {
  'use strict';

  const STORE = 'aguantame.v1';
  const defaults = { theme: 'light', noiseAuto: true, sound: 'rain', timers: [], globalRecord: 0 };
  let state = loadState();
  let audio = { ctx: null, master: null, source: null, type: null, preview: false };
  let miniTimerId = null;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  if (repairState(state)) save();

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE));
      return { ...defaults, ...stored, timers: Array.isArray(stored?.timers) ? stored.timers : [] };
    } catch {
      return { ...defaults, timers: [] };
    }
  }

  function save() { localStorage.setItem(STORE, JSON.stringify(state)); }

  function repairState(current) {
    let changed = repairLegacySessions(current.timers);
    current.timers.forEach(timer => {
      if (timer.type === 'switch') changed = ensureSwitchData(timer) || changed;
    });
    return changed;
  }

  function repairLegacySessions(timers) {
    let changed = false;
    (timers || []).forEach(timer => {
      const sessions = Array.isArray(timer.sessions) ? timer.sessions.slice().sort((a, b) => (a.end || 0) - (b.end || 0)) : [];
      let previousEnd = null;
      sessions.forEach(session => {
        if (!session.id) { session.id = uid(); changed = true; }
        const end = Number(session.end), start = Number(session.start), duration = Number(session.duration);
        if (Number.isFinite(end) && Number.isFinite(start) && previousEnd !== null && start < previousEnd && end > previousEnd) {
          const corrected = end - previousEnd;
          if (corrected > 0 && Math.abs(corrected - duration) > 1) {
            session.start = previousEnd;
            session.duration = corrected;
            changed = true;
          }
        }
        if (Number.isFinite(end)) previousEnd = previousEnd === null ? end : Math.max(previousEnd, end);
      });
    });
    return changed;
  }

  function uid() { return crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function fmt(ms, compact = false) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (compact && h) return `${h}h ${m}m`;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function isSwitch(t) { return t.type === 'switch'; }
  function modeLabel(mode) { return mode === 'desfocus' ? 'Desfocus' : 'Focus'; }
  function otherMode(mode) { return mode === 'focus' ? 'desfocus' : 'focus'; }
  function ensureSwitchData(t) {
    let changed = false;
    if (t.type !== 'switch') return false;
    if (!['focus', 'desfocus'].includes(t.activeMode)) { t.activeMode = 'focus'; changed = true; }
    if (!t.modes || typeof t.modes !== 'object') { t.modes = {}; changed = true; }
    ['focus', 'desfocus'].forEach(mode => {
      const before = t.modes[mode];
      const data = before && typeof before === 'object' ? before : {};
      const normalized = {
        elapsed: Number(data.elapsed) || 0,
        record: Number(data.record) || 0,
        running: false,
        startedAt: null,
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        deletedDuration: Number(data.deletedDuration) || 0,
        lastPR: !!data.lastPR
      };
      if (!before || JSON.stringify(before) !== JSON.stringify(normalized)) { t.modes[mode] = normalized; changed = true; }
    });
    if (!Object.prototype.hasOwnProperty.call(t, 'running')) { t.running = false; changed = true; }
    if (!Object.prototype.hasOwnProperty.call(t, 'startedAt')) { t.startedAt = null; changed = true; }
    return changed;
  }

  function modeData(t, mode) {
    if (!isSwitch(t)) return t;
    ensureSwitchData(t);
    return t.modes[mode] || t.modes.focus;
  }

  function timerElapsed(t, now = Date.now()) {
    return (Number(t.elapsed) || 0) + (t.running && t.startedAt ? now - t.startedAt : 0);
  }

  function modeElapsed(t, mode, now = Date.now()) {
    const data = modeData(t, mode);
    return (Number(data.elapsed) || 0) + (t.running && t.activeMode === mode && t.startedAt ? now - t.startedAt : 0);
  }

  function activeElapsed(t, now = Date.now()) { return isSwitch(t) ? modeElapsed(t, t.activeMode, now) : timerElapsed(t, now); }
  function currentElapsed(t, now = Date.now()) { return t.running && t.startedAt ? now - t.startedAt : 0; }
  function recordsTotal(t) { return (t.sessions || []).reduce((sum, session) => sum + (Number(session.duration) || 0), 0) + (Number(t.deletedDuration) || 0); }
  function modeRecordsTotal(data) { return (data.sessions || []).reduce((sum, session) => sum + (Number(session.duration) || 0), 0) + (Number(data.deletedDuration) || 0); }

  function render() {
    renderTimers();
    renderDailyBest();
    renderDashboard();
    document.body.classList.toggle('dark', state.theme === 'dark');
    if ($('#theme-toggle')) $('#theme-toggle').checked = state.theme === 'dark';
    if ($('#noise-auto')) $('#noise-auto').checked = !!state.noiseAuto;
    $$('.sound-option').forEach(button => button.classList.toggle('active', button.dataset.sound === state.sound));
  }

  function renderTimers() {
    const grid = $('#timers-grid'), empty = $('#empty-state');
    if (!grid || !empty) return;
    grid.innerHTML = '';
    empty.hidden = state.timers.length > 0;
    state.timers.forEach(timer => grid.appendChild(timerCard(timer)));
  }

  function refreshClocks() {
    const now = Date.now();
    state.timers.forEach(timer => {
      const card = document.querySelector(`.timer-card[data-id="${CSS.escape(timer.id)}"]`);
      if (!card) return;
      if (isSwitch(timer)) {
        const active = timer.activeMode;
        const activeTime = card.querySelector('.switch-active-time');
        const current = card.querySelector('.current-time strong');
        if (activeTime) activeTime.textContent = fmt(modeElapsed(timer, active, now));
        if (current) current.textContent = fmt(currentElapsed(timer, now));
        card.querySelectorAll('.switch-mode-time strong').forEach(value => {
          value.textContent = fmt(modeElapsed(timer, value.closest('[data-mode]').dataset.mode, now));
        });
      } else {
        const total = card.querySelector('.time-total'), current = card.querySelector('.current-time strong');
        if (total) total.textContent = fmt(timerElapsed(timer, now));
        if (current) current.textContent = fmt(currentElapsed(timer, now));
      }
    });
  }

  function mixHex(a, b, p) {
    const ah = a.slice(1), bh = b.slice(1);
    const ar = parseInt(ah.slice(0, 2), 16), ag = parseInt(ah.slice(2, 4), 16), ab = parseInt(ah.slice(4, 6), 16);
    const br = parseInt(bh.slice(0, 2), 16), bg = parseInt(bh.slice(2, 4), 16), bb = parseInt(bh.slice(4, 6), 16);
    const clamp = Math.max(0, Math.min(1, p));
    return `#${[ar + (br - ar) * clamp, ag + (bg - ag) * clamp, ab + (bb - ab) * clamp].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  }

  function timerPalette(ratio) {
    const p = Math.min(1.2, Math.max(0, ratio));
    if (p <= .6) {
      const q = p / .6;
      return [mixHex('#1E9E97', '#F7941D', q), mixHex('#7FD4CE', '#FBC784', q)];
    }
    const q = Math.min(1, (p - .6) / .4);
    return [mixHex('#F7941D', '#F4B942', q), mixHex('#FBC784', '#F4B942', q)];
  }

  function timerCard(t) {
    return isSwitch(t) ? switchCard(t) : normalCard(t);
  }

  function normalCard(t) {
    const el = document.createElement('article');
    el.className = `timer-card${t.running ? ' running' : ''}`;
    const ms = timerElapsed(t), rec = t.record || 0, ratio = Math.min(1.2, ms / Math.max(rec || 1800000, 1));
    const [timerColor, timerSoft] = timerPalette(ratio);
    el.style.setProperty('--timer-color', timerColor); el.style.setProperty('--timer-soft', timerSoft); el.dataset.id = t.id;
    const records = (t.sessions || []).slice().sort((a, b) => b.end - a.end).map(session => `<div class="record-item${session.duration === rec ? ' best' : ''}"><span>${fmt(session.duration)}</span><button class="record-delete" data-record-id="${session.id}" aria-label="Delete record ${fmt(session.duration)}" title="Delete record">×</button></div>`).join('');
    el.innerHTML = `<div class="card-head"><input class="name-input" value="${esc(t.name)}" aria-label="Timer name"><div class="card-tools"><button class="move-btn" data-dir="up" title="Move up">↑</button><button class="move-btn" data-dir="down" title="Move down">↓</button><button class="popup-btn" title="Open compact popup">↗</button><button class="reset-btn" title="Reset timer">↺</button><button class="delete-btn" aria-label="Delete ${esc(t.name)}">×</button></div></div><div class="clock-wrap"><div><div class="clock timer-counter" tabindex="0" role="button" aria-label="${t.running ? 'Pause timer' : 'Start timer'}"><span class="time-total">${fmt(ms)}</span></div><div class="current-time">Current: <strong>${fmt(currentElapsed(t))}</strong></div></div></div><div class="records-list" aria-label="Concentration records">${records}</div><div class="card-actions"><button class="control-btn main" aria-label="${t.running ? 'Pause timer' : 'Start timer'}" title="${t.running ? 'Pause timer' : 'Start timer'}">${t.running ? '⏸' : '▶'}</button></div>`;
    bindCommonCardEvents(el, t);
    bindToggleSurface(el.querySelector('.timer-counter'), t.id);
    return el;
  }

  function switchCard(t) {
    ensureSwitchData(t);
    const el = document.createElement('article');
    el.className = `timer-card switch-card${t.running ? ' running' : ''}`;
    const active = t.activeMode, activeData = modeData(t, active), total = modeElapsed(t, active), ratio = Math.min(1.2, total / Math.max(activeData.record || 1800000, 1));
    const [timerColor, timerSoft] = timerPalette(ratio);
    el.style.setProperty('--timer-color', timerColor); el.style.setProperty('--timer-soft', timerSoft); el.dataset.id = t.id;
    const records = ['focus', 'desfocus'].flatMap(mode => (modeData(t, mode).sessions || []).map(session => ({ ...session, mode }))).sort((a, b) => b.end - a.end).map(session => `<div class="record-item"><span>${modeLabel(session.mode)} · ${fmt(session.duration)}</span><button class="record-delete" data-mode="${session.mode}" data-record-id="${session.id}" aria-label="Delete ${modeLabel(session.mode)} record ${fmt(session.duration)}" title="Delete record">×</button></div>`).join('');
    el.innerHTML = `<div class="card-head"><input class="name-input" value="${esc(t.name)}" aria-label="Switch timer name"><span class="switch-badge">Switch · ${modeLabel(active)}</span><div class="card-tools"><button class="move-btn" data-dir="up" title="Move up">↑</button><button class="move-btn" data-dir="down" title="Move down">↓</button><button class="popup-btn" title="Open compact popup">↗</button><button class="reset-btn" title="Reset timer">↺</button><button class="delete-btn" aria-label="Delete ${esc(t.name)}">×</button></div></div><div class="clock-wrap"><div class="switch-display"><div class="switch-mode-label">${modeLabel(active)} time</div><div class="clock switch-active-clock" tabindex="0" role="button" aria-label="${t.running ? 'Pause Switch timer' : 'Start Switch timer'}"><span class="switch-active-time">${fmt(total)}</span></div><div class="current-time">Current: <strong>${fmt(currentElapsed(t))}</strong></div><div class="switch-mode-times"><div class="switch-mode-time${active === 'focus' ? ' active' : ''}" data-mode="focus"><span>Focus</span><strong>${fmt(modeElapsed(t, 'focus'))}</strong></div><div class="switch-mode-time${active === 'desfocus' ? ' active' : ''}" data-mode="desfocus"><span>Desfocus</span><strong>${fmt(modeElapsed(t, 'desfocus'))}</strong></div></div></div></div><div class="records-list" aria-label="Switch session records">${records}</div><div class="card-actions switch-actions"><button class="control-btn switch-action" title="Switch between Focus and Desfocus">Switch</button><button class="control-btn main" aria-label="${t.running ? 'Pause Switch timer' : 'Start Switch timer'}" title="${t.running ? 'Pause Switch timer' : 'Start Switch timer'}">${t.running ? '⏸' : '▶'}</button></div>`;
    bindCommonCardEvents(el, t);
    bindToggleSurface(el.querySelector('.switch-active-clock'), t.id);
    el.querySelector('.switch-action').addEventListener('click', () => switchTimer(t.id));
    return el;
  }

  function bindCommonCardEvents(el, t) {
    el.querySelector('.name-input').addEventListener('change', event => { t.name = event.target.value.trim() || 'Untitled timer'; save(); renderTimers(); });
    el.querySelector('.delete-btn').addEventListener('click', () => deleteTimer(t.id));
    el.querySelector('.reset-btn').addEventListener('click', () => resetTimer(t.id));
    el.querySelector('.popup-btn').addEventListener('click', () => openPopup(t.id));
    el.querySelectorAll('.move-btn').forEach(button => button.addEventListener('click', () => moveTimer(t.id, button.dataset.dir)));
    el.querySelector('.main').addEventListener('click', () => toggleTimer(t.id));
    el.querySelectorAll('.record-delete').forEach(button => button.addEventListener('click', () => deleteRecord(t.id, button.dataset.recordId, button.dataset.mode)));
  }

  function bindToggleSurface(element, id) {
    if (!element) return;
    element.addEventListener('click', () => toggleTimer(id));
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleTimer(id); }
    });
  }

  function esc(s) { return String(s || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }

  function addTimer() {
    const n = state.timers.filter(timer => !isSwitch(timer)).length + 1;
    state.timers.push({ id: uid(), type: 'normal', name: `Focus ${n}`, elapsed: 0, record: 0, running: false, startedAt: null, sessions: [], deletedDuration: 0, lastPR: false });
    save(); render(); focusLastName();
  }

  function addSwitchTimer() {
    const n = state.timers.filter(isSwitch).length + 1;
    const now = Date.now();
    state.timers.push({ id: uid(), type: 'switch', name: `Switch ${n}`, activeMode: 'focus', running: true, startedAt: now, sessionStartedAt: now, modes: { focus: emptyMode(), desfocus: emptyMode() } });
    save(); render(); updateNoise(); focusLastName();
  }

  function emptyMode() { return { elapsed: 0, record: 0, sessions: [], deletedDuration: 0, lastPR: false }; }
  function focusLastName() { setTimeout(() => { const input = $$('.name-input').at(-1); input?.focus(); input?.select(); }, 20); }

  function deleteTimer(id) {
    const t = state.timers.find(timer => timer.id === id); if (!t) return;
    if (!confirm(`Delete “${t.name}” and all its sessions?`)) return;
    const records = isSwitch(t) ? ['focus', 'desfocus'].flatMap(mode => modeData(t, mode).sessions.map(session => session.duration)) : (t.sessions || []).map(session => session.duration);
    state.globalRecord = Math.max(state.globalRecord || 0, t.record || 0, ...records.map(duration => Number(duration) || 0));
    state.timers = state.timers.filter(timer => timer.id !== id);
    save(); render(); updateNoise();
  }

  function resetTimer(id) {
    const t = state.timers.find(timer => timer.id === id); if (!t || !confirm(`Reset “${t.name}” timer? Its accumulated time and records will be cleared.`)) return;
    if (isSwitch(t)) {
      t.activeMode = 'focus'; t.running = false; t.startedAt = null; t.sessionStartedAt = null; t.modes = { focus: emptyMode(), desfocus: emptyMode() };
    } else {
      t.elapsed = 0; t.running = false; t.startedAt = null; t.sessions = []; t.deletedDuration = 0; t.record = 0; t.lastPR = false;
    }
    save(); render(); updateNoise();
  }

  function moveTimer(id, dir) {
    const i = state.timers.findIndex(timer => timer.id === id), j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= state.timers.length) return;
    [state.timers[i], state.timers[j]] = [state.timers[j], state.timers[i]];
    save(); renderTimers();
  }

  function openPopup(id) {
    const win = window.open(`${location.pathname}?popup=${encodeURIComponent(id)}`, 'aguantame-popup', 'popup,width=300,height=230,resizable=yes');
    if (win) win.focus(); else toast('Allow popups to open the timer popup.');
  }

  function openAOD(id) { window.open(`${location.pathname}?aod=${encodeURIComponent(id)}`, 'aguantame-aod', 'popup,width=300,height=180,resizable=yes'); }

  function updateMiniWindow() {
    if (!miniTimerId) return;
    const t = state.timers.find(timer => timer.id === miniTimerId);
    if (!t) { closeMiniWindow(); return; }
    $('#mini-name').textContent = isSwitch(t) ? `${t.name} · ${modeLabel(t.activeMode)}` : t.name;
    $('#mini-time').textContent = fmt(activeElapsed(t));
    $('#mini-current').textContent = `Current: ${fmt(currentElapsed(t))}`;
    const button = $('#mini-toggle'); button.textContent = t.running ? '⏸' : '▶'; button.setAttribute('aria-label', t.running ? 'Pause timer' : 'Start timer');
  }

  function closeMiniWindow() { miniTimerId = null; const mini = $('#mini-window'); if (mini) { mini.hidden = true; mini.classList.remove('visible'); } }

  function toggleTimer(id) {
    const t = state.timers.find(timer => timer.id === id); if (!t) return;
    if (t.running) pauseTimer(t); else startTimer(t);
    save(); if ($('#timers-grid')) render(); updateNoise();
  }

  function startTimer(t) {
    if (isSwitch(t)) {
      ensureSwitchData(t); t.running = true; t.startedAt = Date.now(); t.sessionStartedAt = t.sessionStartedAt || t.startedAt; t.modes[t.activeMode].lastPR = false;
    } else {
      const recorded = recordsTotal(t);
      if ((Number(t.elapsed) || 0) < recorded) t.elapsed = recorded;
      t.running = true; t.startedAt = Date.now(); t.lastPR = false;
    }
    if (state.noiseAuto) startNoise();
  }

  function pauseTimer(t, announce = true) {
    const now = Date.now();
    if (isSwitch(t)) {
      pauseSwitch(t, now, announce);
      return;
    }
    const totalDuration = timerElapsed(t, now), previousRecords = recordsTotal(t), sessionDuration = Math.max(0, totalDuration - previousRecords);
    t.sessions = t.sessions || [];
    if (sessionDuration > 0) {
      t.sessions.push({ id: uid(), start: t.startedAt || now - sessionDuration, end: now, duration: sessionDuration });
      if (sessionDuration > (t.record || 0)) { t.record = sessionDuration; t.lastPR = true; if (announce) celebrate(t); } else { t.lastPR = false; if (announce) boo(); }
    }
    t.elapsed = totalDuration; t.running = false; t.startedAt = null;
  }

  function pauseSwitch(t, now = Date.now(), announce = false) {
    const mode = t.activeMode, data = modeData(t, mode), totalDuration = modeElapsed(t, mode, now), previousRecords = modeRecordsTotal(data), sessionDuration = Math.max(0, totalDuration - previousRecords);
    if (sessionDuration > 0) {
      data.sessions.push({ id: uid(), mode, start: t.startedAt || now - sessionDuration, end: now, duration: sessionDuration });
      if (sessionDuration > (data.record || 0)) { data.record = sessionDuration; data.lastPR = true; if (announce) celebrate(t); } else { data.lastPR = false; if (announce) boo(); }
    }
    data.elapsed = totalDuration; t.running = false; t.startedAt = null; t.sessionStartedAt = null;
  }

  function switchTimer(id) {
    const t = state.timers.find(timer => timer.id === id); if (!t || !isSwitch(t)) return;
    ensureSwitchData(t);
    const now = Date.now(), target = otherMode(t.activeMode);
    if (t.running) {
      pauseSwitch(t, now, false);
      t.activeMode = target; t.running = true; t.startedAt = now; t.sessionStartedAt = t.sessionStartedAt || now;
    } else {
      t.activeMode = target;
    }
    save(); render(); updateNoise();
  }

  function deleteRecord(timerId, recordId, mode) {
    const t = state.timers.find(timer => timer.id === timerId); if (!t) return;
    const data = isSwitch(t) ? modeData(t, mode || 'focus') : t;
    const record = data.sessions?.find(session => session.id === recordId); if (!record) return;
    data.sessions = data.sessions.filter(session => session.id !== recordId);
    data.deletedDuration = (data.deletedDuration || 0) + (Number(record.duration) || 0);
    data.record = data.sessions.reduce((best, session) => Math.max(best, Number(session.duration) || 0), 0);
    data.lastPR = false;
    save(); render();
  }

  function updateNoise() { if (state.timers.some(timer => timer.running)) { if (state.noiseAuto) startNoise(); } else stopNoise(); }
  function ensureAudio() { if (!audio.ctx) { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); audio.master = audio.ctx.createGain(); audio.master.gain.value = .12; audio.master.connect(audio.ctx.destination); } if (audio.ctx.state === 'suspended') audio.ctx.resume(); }
  function startNoise() { try { ensureAudio(); if (audio.source && audio.type === state.sound) return; stopNoise(); const ctx = audio.ctx, gain = ctx.createGain(); gain.gain.value = .36; gain.connect(audio.master); let src; if (state.sound === 'static') { const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(gain); src.start(); } else { const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0); let last = 0; for (let i = 0; i < data.length; i++) { const white = Math.random() * 2 - 1; last = state.sound === 'waves' ? last * .985 + white * .015 : last * .92 + white * .08; data[i] = last * 3; } src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(gain); src.start(); } audio.source = { src, gain }; audio.type = state.sound; } catch (error) {} }
  function stopNoise() { if (audio.source) { try { audio.source.src.stop(); audio.source.src.disconnect(); } catch {} audio.source = null; audio.type = null; } }
  function beep(freq, dur, when = 0) { try { ensureAudio(); const oscillator = audio.ctx.createOscillator(), gain = audio.ctx.createGain(); oscillator.frequency.value = freq; oscillator.type = 'sine'; gain.gain.setValueAtTime(.0001, audio.ctx.currentTime + when); gain.gain.exponentialRampToValueAtTime(.18, audio.ctx.currentTime + when + .02); gain.gain.exponentialRampToValueAtTime(.0001, audio.ctx.currentTime + when + dur); oscillator.connect(gain); gain.connect(audio.master); oscillator.start(audio.ctx.currentTime + when); oscillator.stop(audio.ctx.currentTime + when + dur + .03); } catch {} }
  function celebrate(t) { beep(523, .12); beep(659, .12, .12); beep(784, .22, .24); toast(`New record in ${t.name}.`); const layer = $('#celebration-layer'); if (!layer) return; for (let i = 0; i < 24; i++) { const confetti = document.createElement('i'); confetti.className = 'confetti'; confetti.style.setProperty('--x', Math.random() * 100); confetti.style.setProperty('--y', Math.random() * 80 - 10); confetti.style.background = `hsl(${Math.random() * 360},75%,60%)`; layer.appendChild(confetti); setTimeout(() => confetti.remove(), 1300); } }
  function boo() { beep(180, .18); beep(130, .25, .13); toast('Back to it.'); }
  function toast(message) { const region = $('#toast-region'); if (!region) return; const element = document.createElement('div'); element.className = 'toast'; element.textContent = message; region.appendChild(element); setTimeout(() => element.remove(), 3200); }

  function allSessions() {
    const sessions = [];
    state.timers.forEach(timer => {
      if (isSwitch(timer)) ['focus', 'desfocus'].forEach(mode => modeData(timer, mode).sessions.forEach(session => sessions.push({ ...session, name: `${timer.name} · ${modeLabel(mode)}` })));
      else (timer.sessions || []).forEach(session => sessions.push({ ...session, name: timer.name }));
    });
    return sessions;
  }

  function renderDailyBest() {
    const start = new Date(); start.setHours(0, 0, 0, 0); const dayStart = start.getTime();
    let best = state.globalRecord || 0;
    allSessions().forEach(session => { if (session.end >= dayStart) best = Math.max(best, session.duration); });
    const element = $('#daily-best'); if (element) element.textContent = best ? fmt(best) : '—';
  }

  function renderDashboard() {
    const all = allSessions().sort((a, b) => b.end - a.end);
    const total = all.reduce((sum, session) => sum + session.duration, 0), longest = all.reduce((max, session) => Math.max(max, session.duration), 0);
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const today = all.filter(session => session.end >= todayStart.getTime()).reduce((sum, session) => sum + session.duration, 0);
    const stats = $('#stats-grid'); if (!stats) return;
    stats.innerHTML = [['◷', fmt(total, true), 'Total tracked'], ['★', longest ? fmt(longest) : '—', 'Longest session'], ['✦', all.length, 'Sessions'], ['☀', today ? fmt(today, true) : '—', 'Today']].map(item => `<div class="stat-card"><span class="stat-icon">${item[0]}</span><div class="stat-value">${item[1]}</div><div class="stat-label">${item[2]}</div></div>`).join('');
    const days = []; for (let i = 6; i >= 0; i--) { const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - i); const next = day.getTime() + 86400000; days.push({ label: day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), value: all.filter(session => session.end >= day.getTime() && session.end < next).reduce((sum, session) => sum + session.duration, 0) }); }
    const max = Math.max(...days.map(day => day.value), 1); $('#week-chart').innerHTML = days.map(day => `<div class="bar-col"><span class="bar-value">${day.value ? fmt(day.value, true) : ''}</span><div class="bar" style="height:${Math.max(3, day.value / max * 100)}%"></div><span class="bar-label">${day.label}</span></div>`).join('');
    $('#session-count').textContent = all.length ? `${all.length} total` : '';
    $('#history-list').innerHTML = all.length ? all.slice(0, 12).map(session => `<div class="history-item"><div><div class="history-name">${esc(session.name)}</div><div class="history-date">${new Date(session.end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div><span class="history-duration">${fmt(session.duration)}</span></div>`).join('') : '<p class="muted">Your sessions will show up here.</p>';
  }

  function switchView(view) { $$('.nav-tab').forEach(button => button.classList.toggle('active', button.dataset.view === view)); $$('.view').forEach(section => section.classList.toggle('active-view', section.id === `${view}-view`)); if (view === 'dashboard') renderDashboard(); }

  function popupMode() {
    const params = new URLSearchParams(location.search), id = params.get('popup') || params.get('aod'); if (!id) return false;
    const aod = params.has('aod'); document.body.className = aod ? 'aod-mode' : 'popup-mode';
    document.body.innerHTML = `<main class="${aod ? 'aod-shell' : 'popup-shell'}"><div id="popup-name"></div><div id="popup-mode"></div><div id="popup-time" class="popup-time">00:00</div>${aod ? '' : '<div id="popup-current" class="popup-current">Current: 00:00</div><button id="popup-toggle" class="control-btn main">▶</button>'}</main>`;
    const tick = () => {
      state = loadState();
      const timer = state.timers.find(item => item.id === id);
      if (!timer) { $('#popup-name').textContent = 'Timer deleted'; return; }
      const switchTimerMode = isSwitch(timer) ? timer.activeMode : null;
      $('#popup-name').textContent = timer.name;
      $('#popup-mode').textContent = switchTimerMode ? `Switch · ${modeLabel(switchTimerMode)}` : '';
      $('#popup-time').textContent = fmt(activeElapsed(timer));
      $('#popup-time').onclick = () => toggleTimer(id);
      if (!aod) {
        $('#popup-current').textContent = `Current: ${fmt(currentElapsed(timer))}`;
        const button = $('#popup-toggle'); button.textContent = timer.running ? '⏸' : '▶'; button.onclick = () => toggleTimer(id);
      }
    };
    tick(); setInterval(tick, 250); return true;
  }

  function init() {
    if (popupMode()) return;
    document.body.classList.toggle('dark', state.theme === 'dark');
    $('#add-timer').onclick = addTimer; $('#add-switch').onclick = addSwitchTimer; $('#empty-add').onclick = addTimer;
    $$('.nav-tab').forEach(button => button.onclick = () => switchView(button.dataset.view));
    $('#settings-open').onclick = () => $('#settings-panel').classList.add('open'); $('#settings-close').onclick = () => $('#settings-panel').classList.remove('open'); $$('[data-close-settings]').forEach(element => element.onclick = () => $('#settings-panel').classList.remove('open'));
    $('#mini-close').onclick = closeMiniWindow; $('#mini-toggle').onclick = () => { if (miniTimerId) toggleTimer(miniTimerId); };
    $('#theme-toggle').onchange = event => { state.theme = event.target.checked ? 'dark' : 'light'; save(); render(); };
    $('#noise-auto').onchange = event => { state.noiseAuto = event.target.checked; save(); if (!state.noiseAuto) stopNoise(); else updateNoise(); };
    $$('.sound-option').forEach(button => button.onclick = () => { state.sound = button.dataset.sound; save(); $$('.sound-option').forEach(item => item.classList.toggle('active', item === button)); if (state.timers.some(timer => timer.running)) startNoise(); });
    $('#sound-test').onclick = () => { if (audio.source) { stopNoise(); $('#sound-test').textContent = '▶ Preview sound'; } else { startNoise(); $('#sound-test').textContent = '■ Stop preview'; setTimeout(() => { if (audio.source && !state.timers.some(timer => timer.running)) { stopNoise(); $('#sound-test').textContent = '▶ Preview sound'; } }, 5000); } };
    $('#clear-data').onclick = () => { if (confirm('Reset all Aguantame data?')) { state = { ...defaults, timers: [] }; save(); stopNoise(); render(); $('#settings-panel').classList.remove('open'); } };
    render(); setInterval(() => { refreshClocks(); updateMiniWindow(); }, 250);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshClocks(); updateMiniWindow(); } });
    window.addEventListener('pageshow', refreshClocks);
    window.addEventListener('storage', event => { if (event.key === STORE) { state = loadState(); render(); updateNoise(); } });
  }

  init();
})();

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
