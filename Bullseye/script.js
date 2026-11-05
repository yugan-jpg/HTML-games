/* Bullseye — vanilla rhythm game. All timing is driven by the AudioContext clock. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = {
    menu: $('menuScreen'), game: $('gameScreen'), results: $('resultsScreen'), play: $('playArea'),
    start: $('startButton'), input: $('songInput'), songName: $('songName'), folder: $('folderSongs'), msg: $('menuMessage'),
    difficulty: $('difficultyPicker'), skins: $('skinPicker'), cursor: $('customCursor'), master: $('masterVolume'), music: $('musicVolume'), sfx: $('sfxVolume'),
    score: $('scoreText'), accuracy: $('accuracyText'), counts: $('countsText'), combo: $('comboText'), comboFill: $('comboFill'), progress: $('progressFill'),
    pause: $('pauseButton'), stop: $('stopButton'), pauseOverlay: $('pauseOverlay'), resume: $('resumeButton'), pauseRetry: $('pauseRetryButton'), quit: $('quitButton'), countdown: $('countdown'),
    grade: $('gradeText'), resultScore: $('resultScore'), resultCombo: $('resultCombo'), resultAccuracy: $('resultAccuracy'), resultHits: $('resultHits'), resultMisses: $('resultMisses'), retry: $('resultRetryButton'), menuButton: $('menuButton')
  };
  const DIFFICULTIES = {
    easy: { approach: 1.7, size: 110, window: .28, sensitivity: 1.70 },
    normal: { approach: 1.3, size: 90, window: .21, sensitivity: 1.55 },
    hard: { approach: .8, size: 65, window: .15, sensitivity: 1.72 }
  };
  const settings = { difficulty: 'normal', skin: 'cursor.webp', master: .8, music: .8, sfx: .7 };
  const state = { ctx: null, masterGain: null, musicGain: null, sfxGain: null, source: null, songBuffer: null, songData: null, songTitle: 'Default Synthwave Pulse', beats: [], analysedKey: null, startedAt: 0, nextBeat: 0, active: new Map(), running: false, paused: false, ended: false, raf: 0, countdownRaf: 0, score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, okay: 0, hits: 0, misses: 0, previousPosition: null };

  /* Settings and small UI helpers */
  function loadSettings() { try { Object.assign(settings, JSON.parse(localStorage.getItem('bullseye-settings') || '{}')); } catch (_) {} }
  function saveSettings() { try { localStorage.setItem('bullseye-settings', JSON.stringify(settings)); } catch (_) {} }
  function setMessage(message) { el.msg.textContent = message || ''; }
  function imageFallback(img) { img.onerror = () => { img.style.display = 'none'; }; }
  document.querySelectorAll('img').forEach(imageFallback);
  // CSS backgrounds do not expose an onerror event, so preflight the combo decoration.
  const comboArtwork = new Image();
  comboArtwork.onerror = () => { const art = document.querySelector('.combo-art'); if (art) art.style.background = 'none'; };
  comboArtwork.src = 'images/combo%20numbers.webp';
  function updateSettingsUI() {
    el.master.value = settings.master; el.music.value = settings.music; el.sfx.value = settings.sfx;
    document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.toggle('active', b.dataset.difficulty === settings.difficulty));
    document.querySelectorAll('[data-skin]').forEach(b => b.classList.toggle('active', b.dataset.skin === settings.skin));
    el.cursor.src = `images/${settings.skin}`;
  }
  function updateGains() { if (!state.ctx) return; state.masterGain.gain.value = settings.master; state.musicGain.gain.value = settings.music; state.sfxGain.gain.value = settings.sfx; }
  loadSettings(); updateSettingsUI();
  document.addEventListener('mousemove', e => { el.cursor.style.left = `${e.clientX}px`; el.cursor.style.top = `${e.clientY}px`; });
  el.cursor.onerror = () => { el.cursor.style.display = 'none'; };
  el.difficulty.addEventListener('click', e => { const b = e.target.closest('[data-difficulty]'); if (!b) return; uiClick(); settings.difficulty = b.dataset.difficulty; saveSettings(); updateSettingsUI(); state.analysedKey = null; });
  el.skins.addEventListener('click', e => { const b = e.target.closest('[data-skin]'); if (!b) return; uiClick(); settings.skin = b.dataset.skin; saveSettings(); updateSettingsUI(); });
  [el.master, el.music, el.sfx].forEach(input => input.addEventListener('input', () => { settings.master = +el.master.value; settings.music = +el.music.value; settings.sfx = +el.sfx.value; saveSettings(); updateGains(); }));
  document.querySelectorAll('button').forEach(b => { b.addEventListener('mouseenter', () => hoverTick()); });

  /* Audio / procedural SFX */
  async function ensureAudio() {
    if (!state.ctx) {
      state.ctx = new (window.AudioContext || window.webkitAudioContext)();
      state.masterGain = state.ctx.createGain(); state.musicGain = state.ctx.createGain(); state.sfxGain = state.ctx.createGain();
      state.musicGain.connect(state.masterGain); state.sfxGain.connect(state.masterGain); state.masterGain.connect(state.ctx.destination); updateGains();
    }
    if (state.ctx.state !== 'running') await state.ctx.resume();
  }
  function tone({ frequency = 440, endFrequency = frequency, duration = .08, volume = .15, type = 'sine', when = 0 }) {
    if (!state.ctx || !settings.sfx) return;
    const t = state.ctx.currentTime + when, osc = state.ctx.createOscillator(), gain = state.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), t + duration);
    gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(volume, t + .008); gain.gain.exponentialRampToValueAtTime(.0001, t + duration);
    osc.connect(gain).connect(state.sfxGain); osc.start(t); osc.stop(t + duration + .02);
  }
  function uiClick() { tone({ frequency: 620, endFrequency: 760, duration: .045, volume: .08, type: 'triangle' }); }
  function hoverTick() { tone({ frequency: 900, duration: .025, volume: .025, type: 'sine' }); }
  function hitSfx(combo) { tone({ frequency: Math.min(980, 410 + combo * 11), endFrequency: Math.min(1300, 700 + combo * 11), duration: .075, volume: .18, type: 'square' }); }
  function missSfx() { tone({ frequency: 150, endFrequency: 56, duration: .16, volume: .18, type: 'sawtooth' }); }
  function milestoneSfx() { tone({ frequency: 660, endFrequency: 1140, duration: .25, volume: .16, type: 'sine' }); tone({ frequency: 880, endFrequency: 1320, duration: .32, volume: .1, type: 'triangle', when: .08 }); }
  function startSfx() { tone({ frequency: 240, endFrequency: 920, duration: .34, volume: .18, type: 'sine' }); }
  function finishSfx() { tone({ frequency: 523, endFrequency: 784, duration: .22, volume: .15, type: 'triangle' }); tone({ frequency: 659, endFrequency: 988, duration: .35, volume: .12, type: 'sine', when: .12 }); }

  /* Beat analyser: energy onsets vs local moving average, with adaptive threshold. */
  function analyseBeats(buffer, difficulty) {
    const cfg = DIFFICULTIES[difficulty];
    // A target is introduced before its hit moment, so selected beats must be far enough
    // apart for that target to resolve before the next one begins.
    const minGap = cfg.approach + cfg.window + .12;
    if (buffer._bullseyeDefault) {
      const beats = [], musicalBeat = .5, spacing = Math.ceil(minGap / musicalBeat) * musicalBeat;
      for (let time = 2; time < buffer.duration - .5; time += spacing) beats.push(+time.toFixed(3));
      return beats;
    }
    const channels = buffer.numberOfChannels, sampleRate = buffer.sampleRate, hop = 1024, windowSize = 2048, energies = [];
    for (let start = 0; start + windowSize < buffer.length; start += hop) {
      let sum = 0;
      for (let i = 0; i < windowSize; i += 2) { let sample = 0; for (let c = 0; c < channels; c++) sample += buffer.getChannelData(c)[start + i]; sample /= channels; sum += sample * sample; }
      energies.push(sum / (windowSize / 2));
    }
    const beats = [], multiplier = cfg.sensitivity;
    for (let i = 5; i < energies.length - 5; i++) {
      let avg = 0; for (let j = i - 5; j <= i + 5; j++) avg += energies[j]; avg /= 11;
      const flux = Math.max(0, energies[i] - energies[i - 1]);
      let avgFlux = 0; for (let j = Math.max(1, i - 8); j < i; j++) avgFlux += Math.max(0, energies[j] - energies[j - 1]); avgFlux /= Math.min(8, i - 1);
      const time = i * hop / sampleRate;
      if (time > 1.5 && energies[i] > avg * multiplier && flux > avgFlux * .75 && (!beats.length || time - beats[beats.length - 1] >= minGap)) beats.push(time);
    }
    return beats;
  }

  /* Song loading. Default is a generated synthwave buffer, so it needs no downloaded asset. */
  function createDefaultTrack(ctx) {
    const rate = ctx.sampleRate, duration = 48, length = rate * duration, buffer = ctx.createBuffer(2, length, rate), left = buffer.getChannelData(0), right = buffer.getChannelData(1), bpm = 120;
    const notes = [55, 55, 65.41, 73.42, 55, 49, 65.41, 82.41]; let noise = 123456;
    const rand = () => { noise = (noise * 16807) % 2147483647; return noise / 2147483647 * 2 - 1; };
    for (let i = 0; i < length; i++) {
      const t = i / rate, beat = t * bpm / 60, phase = beat % 1, eighth = Math.floor(beat * 2), note = notes[Math.floor(beat / 4) % notes.length];
      const kickEnv = Math.exp(-phase * 11), kick = Math.sin(2 * Math.PI * (125 - phase * 82) * t) * kickEnv * .66;
      const snarePhase = (beat + .5) % 1, snare = snarePhase < .18 ? rand() * Math.exp(-snarePhase * 24) * .2 : 0;
      const bass = Math.sin(2 * Math.PI * note * t) * (phase < .82 ? .18 : .05);
      const arpFreq = note * (eighth % 4 === 3 ? 4 : eighth % 2 ? 2 : 3), arpPhase = (beat * 2) % 1, arp = Math.sin(2 * Math.PI * arpFreq * t) * Math.exp(-arpPhase * 5) * .09;
      const pad = Math.sin(2 * Math.PI * note * 2 * t) * .035 + Math.sin(2 * Math.PI * note * 3 * t) * .018;
      const sample = Math.tanh(kick + snare + bass + arp + pad);
      left[i] = sample * .83; right[i] = sample * .83 + Math.sin(t * 2) * arp * .05;
    }
    buffer._bullseyeDefault = true; return buffer;
  }
  async function loadSelectedSong() {
    await ensureAudio();
    if (!state.songData) { state.songBuffer = createDefaultTrack(state.ctx); state.songTitle = 'Default Synthwave Pulse'; }
    else {
      try { const data = state.songData instanceof File ? await state.songData.arrayBuffer() : await fetch(state.songData).then(r => { if (!r.ok) throw new Error('file'); return r.arrayBuffer(); }); state.songBuffer = await state.ctx.decodeAudioData(data.slice(0)); }
      catch (_) { state.songBuffer = null; throw new Error('Could not read this audio file'); }
    }
    const key = `${state.songTitle}:${settings.difficulty}:${state.songBuffer.duration}`;
    if (state.analysedKey !== key) { state.beats = analyseBeats(state.songBuffer, settings.difficulty); state.analysedKey = key; }
    if (!state.beats.length) throw new Error('No playable beats were found in this song');
  }
  function selectSong(data, title) { state.songData = data; state.songTitle = title; state.songBuffer = null; state.analysedKey = null; el.songName.textContent = title; setMessage(''); document.querySelectorAll('.folder-song').forEach(b => b.classList.toggle('selected', b.dataset.title === title)); }
  el.input.addEventListener('change', () => { const f = el.input.files && el.input.files[0]; if (f) { uiClick(); selectSong(f, f.name); } });
  fetch('songs/songs.json').then(r => r.ok ? r.json() : Promise.reject()).then(items => {
    if (!Array.isArray(items) || !items.length) return;
    el.folder.hidden = false; items.forEach(item => { if (!item || !item.file) return; const b = document.createElement('button'), icon = document.createElement('img'); b.className = 'folder-song'; b.dataset.title = item.title || item.file; icon.src = 'images/radioicon.png'; imageFallback(icon); b.append(icon, document.createTextNode(item.title || item.file)); b.addEventListener('click', () => { uiClick(); selectSong(`songs/${encodeURIComponent(item.file)}`, item.title || item.file); }); el.folder.appendChild(b); });
  }).catch(() => {});

  /* Game state, circles, scoring, and the requestAnimationFrame loop. */
  function gameTime() { return state.ctx ? Math.max(0, state.ctx.currentTime - state.startedAt) : 0; }
  function resetStats() { Object.assign(state, { score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, okay: 0, hits: 0, misses: 0, nextBeat: 0, previousPosition: null, ended: false }); updateHud(); }
  function clearCircles() { state.active.forEach(c => c.node.remove()); state.active.clear(); el.play.querySelectorAll('.judgement,.miss-effect').forEach(n => n.remove()); }
  function updateHud() {
    const total = state.perfect + state.good + state.okay + state.misses;
    const accuracy = total ? ((state.perfect * 100 + state.good * 66 + state.okay * 33) / (total * 100) * 100) : 100;
    el.score.textContent = state.score.toLocaleString(); el.combo.textContent = state.combo; el.comboFill.style.width = `${(state.combo % 25) * 4}%`;
    el.accuracy.textContent = `${accuracy.toFixed(2)}%`; el.counts.textContent = `${state.hits} Hits · ${state.misses} Miss`;
  }
  function randomPosition(size) {
    const bounds = el.play.getBoundingClientRect(), edge = Math.max(60, size / 2 + 15); let x, y, tries = 0;
    do { x = edge + Math.random() * (bounds.width - edge * 2); y = edge + Math.random() * (bounds.height - edge * 2); tries++; } while (state.previousPosition && Math.hypot(x - state.previousPosition.x, y - state.previousPosition.y) < size * 1.65 && tries < 15);
    state.previousPosition = { x, y }; return { x, y };
  }
  function spawnCircle(index) {
    const cfg = DIFFICULTIES[settings.difficulty], beat = state.beats[index], pos = randomPosition(cfg.size), node = document.createElement('div');
    node.className = 'circle'; node.style.setProperty('--size', `${cfg.size}px`); node.style.setProperty('--approach', `${Math.max(20, cfg.size * .48)}px`); node.style.left = `${pos.x}px`; node.style.top = `${pos.y}px`;
    node.innerHTML = '<div class="approach"></div><div class="target"></div>'; node.style.setProperty('--ring-scale', '2.1'); const circle = { index, beat, node, x: pos.x, y: pos.y, judged: false };
    node.addEventListener('click', event => { event.stopPropagation(); judgeCircle(circle); }); el.play.appendChild(node); state.active.set(index, circle);
  }
  function showJudgement(text, x, y, kind) { const n = document.createElement('div'); n.className = `judgement ${kind}`; n.textContent = text; n.style.left = `${x}px`; n.style.top = `${y}px`; el.play.appendChild(n); n.addEventListener('animationend', () => n.remove(), { once: true }); }
  function showMiss(circle) { const img = document.createElement('img'); img.className = 'miss-effect'; img.src = `images/miss_variation${Math.random() < .5 ? 1 : 2}.webp`; img.alt = ''; img.style.left = `${circle.x}px`; img.style.top = `${circle.y}px`; imageFallback(img); el.play.appendChild(img); img.addEventListener('animationend', () => img.remove(), { once: true }); }
  function removeCircle(circle) { if (!state.active.has(circle.index)) return; state.active.delete(circle.index); circle.node.remove(); }
  function judgeCircle(circle) {
    if (!state.running || state.paused || circle.judged) return;
    const dt = gameTime() - circle.beat, window = DIFFICULTIES[settings.difficulty].window;
    if (dt < -window) return; // deliberately ignore early clicks
    if (Math.abs(dt) > window) { miss(circle); return; }
    circle.judged = true; let kind, points;
    if (Math.abs(dt) <= .06) { kind = 'perfect'; points = 300; state.perfect++; }
    else if (Math.abs(dt) <= .12) { kind = 'good'; points = 100; state.good++; }
    else { kind = 'okay'; points = 50; state.okay++; }
    state.score += Math.floor(points * (1 + state.combo / 25)); state.combo++; state.maxCombo = Math.max(state.maxCombo, state.combo); state.hits++;
    const label = kind === 'okay' ? 'OKAY' : kind.toUpperCase(); showJudgement(label, circle.x, circle.y, kind); circle.node.classList.add('hit'); hitSfx(state.combo);
    if (state.combo % 25 === 0) milestoneSfx(); el.combo.classList.remove('pulse'); void el.combo.offsetWidth; el.combo.classList.add('pulse'); updateHud();
    state.active.delete(circle.index); circle.node.addEventListener('animationend', () => circle.node.remove(), { once: true });
  }
  function miss(circle) { if (circle.judged || !state.active.has(circle.index)) return; circle.judged = true; state.misses++; state.combo = 0; showJudgement('MISS', circle.x, circle.y, 'miss'); showMiss(circle); missSfx(); el.combo.classList.remove('break'); void el.combo.offsetWidth; el.combo.classList.add('break'); removeCircle(circle); updateHud(); }
  function loop() {
    if (!state.running) return; if (!state.paused) {
      const t = gameTime(), cfg = DIFFICULTIES[settings.difficulty];
      while (state.nextBeat < state.beats.length && state.beats[state.nextBeat] <= t + cfg.approach) spawnCircle(state.nextBeat++);
      state.active.forEach(circle => { const ratio = Math.max(0, (circle.beat - t) / cfg.approach); circle.node.style.setProperty('--ring-scale', `${1 + ratio * 1.1}`); if (t > circle.beat + cfg.window) miss(circle); });
      el.progress.style.width = `${Math.min(100, t / state.songBuffer.duration * 100)}%`;
      if (state.ended && state.active.size === 0 && t >= state.songBuffer.duration + 1.5) finishGame();
    } state.raf = requestAnimationFrame(loop);
  }
  function startSource() {
    if (state.source) { try { state.source.stop(); } catch (_) {} }
    state.source = state.ctx.createBufferSource(); state.source.buffer = state.songBuffer; state.source.connect(state.musicGain); state.source.onended = () => { state.ended = true; }; state.startedAt = state.ctx.currentTime; state.source.start(); state.running = true; state.paused = false; startSfx(); state.raf = requestAnimationFrame(loop);
  }
  function stopSource() { if (state.source) { state.source.onended = null; try { state.source.stop(); } catch (_) {} state.source.disconnect(); state.source = null; } }

  /* Screens and controls */
  function showScreen(name) { el.menu.hidden = name !== 'menu'; el.game.hidden = name !== 'game'; el.results.hidden = name !== 'results'; }
  function countdown(done) {
    cancelAnimationFrame(state.countdownRaf); const began = performance.now(), seconds = 3; el.countdown.textContent = '3';
    function frame(now) { const left = seconds - Math.floor((now - began) / 1000); if (left <= 0) { el.countdown.textContent = 'GO!'; el.countdown.classList.remove('pop'); void el.countdown.offsetWidth; el.countdown.classList.add('pop'); requestAnimationFrame(() => { el.countdown.textContent = ''; done(); }); return; } if (el.countdown.textContent !== String(left)) { el.countdown.textContent = left; el.countdown.classList.remove('pop'); void el.countdown.offsetWidth; el.countdown.classList.add('pop'); } state.countdownRaf = requestAnimationFrame(frame); } state.countdownRaf = requestAnimationFrame(frame);
  }
  async function startGame() {
    uiClick(); setMessage(''); el.start.disabled = true; showScreen('game');
    el.countdown.textContent = 'ANALYSING\nBEATS…'; el.countdown.classList.add('analysing');
    try { await loadSelectedSong(); resetStats(); clearCircles(); el.countdown.classList.remove('analysing'); el.countdown.textContent = ''; countdown(startSource); }
    catch (error) { el.countdown.classList.remove('analysing'); el.countdown.textContent = ''; showScreen('menu'); setMessage(error.message || 'Could not read this audio file'); }
    finally { el.start.disabled = false; }
  }
  async function pauseGame() { if (!state.running || state.paused) return; uiClick(); state.paused = true; await state.ctx.suspend(); el.pauseOverlay.hidden = false; }
  function resumeGame() { if (!state.paused) return; uiClick(); el.pauseOverlay.hidden = true; countdown(async () => { await state.ctx.resume(); state.paused = false; }); }
  function quitToMenu() { uiClick(); cancelAnimationFrame(state.countdownRaf); cancelAnimationFrame(state.raf); state.running = false; state.paused = false; stopSource(); clearCircles(); el.pauseOverlay.hidden = true; el.progress.style.width = '0'; showScreen('menu'); }
  function stopGame() { if (!state.running || window.confirm('Stop this song and return to the menu?')) quitToMenu(); }
  function retryGame() { uiClick(); quitToMenu(); startGame(); }
  function finishGame() { if (!state.running) return; state.running = false; cancelAnimationFrame(state.raf); clearCircles(); finishSfx(); const total = state.perfect + state.good + state.okay + state.misses, acc = total ? ((state.perfect * 100 + state.good * 66 + state.okay * 33) / total) : 100; const grade = acc >= 95 ? 'S' : acc >= 90 ? 'A' : acc >= 80 ? 'B' : acc >= 70 ? 'C' : 'D'; el.grade.textContent = grade; el.resultScore.textContent = state.score.toLocaleString(); el.resultCombo.textContent = state.maxCombo; el.resultAccuracy.textContent = `${acc.toFixed(2)}%`; el.resultHits.textContent = state.hits; el.resultMisses.textContent = state.misses; stopSource(); showScreen('results'); }
  el.start.addEventListener('click', startGame); el.pause.addEventListener('click', pauseGame); el.stop.addEventListener('click', stopGame); el.resume.addEventListener('click', resumeGame); el.pauseRetry.addEventListener('click', retryGame); el.quit.addEventListener('click', quitToMenu); el.retry.addEventListener('click', retryGame); el.menuButton.addEventListener('click', quitToMenu);
  window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); state.paused ? resumeGame() : pauseGame(); } if (e.key === 'Escape') pauseGame(); if (e.key.toLowerCase() === 'r' && (state.running || !el.results.hidden)) retryGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); }); el.play.addEventListener('contextmenu', e => e.preventDefault());
})();
