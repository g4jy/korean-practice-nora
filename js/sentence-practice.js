/* === Sentence Practice === */

(async () => {
  'use strict';

  /* --- Load sentence data --- */
  let sentenceData = null;
  try {
    const resp = await fetch('data/sentences.json');
    sentenceData = await resp.json();
  } catch (e) {
    console.error('Failed to load sentences.json:', e);
    document.getElementById('sentence-kr').textContent = 'No sentence data found';
    return;
  }

  /* --- Build sentence list from chapters --- */
  const allSentences = [];
  const chapters = new Map();
  const patterns = new Map();

  (sentenceData.chapters || []).forEach(ch => {
    const chapterSentences = [];
    (ch.sentences || []).forEach(s => {
      const sentence = {
        kr: s.kr || '',
        rom: s.rom || '',
        en: s.en || '',
        pattern: s.pattern || '',
        vocab: s.vocab || [],
        difficulty: s.difficulty || 1,
        chapter: ch.title || '',
        chapterId: ch.id,
        lesson: ch.lesson || 0
      };
      allSentences.push(sentence);
      chapterSentences.push(sentence);

      // Group by pattern
      if (sentence.pattern) {
        if (!patterns.has(sentence.pattern)) {
          patterns.set(sentence.pattern, []);
        }
        patterns.get(sentence.pattern).push(sentence);
      }
    });
    if (chapterSentences.length > 0) {
      chapters.set(ch.id, {
        title: ch.title,
        id: ch.id,
        sentences: chapterSentences
      });
    }
  });

  if (allSentences.length === 0) {
    document.getElementById('sentence-kr').textContent = 'No sentences available';
    return;
  }

  /* --- State --- */
  let currentSentences = [...allSentences];
  let currentIdx = 0;
  let isFlipped = false;
  let mode = 'chapter'; // 'chapter' | 'pattern' | 'random'
  let activeFilter = null;

  // Auto-play state
  let isPlaying = false;
  let isPaused = false;
  let playSpeed = 1.0;
  let playGap = 4000;
  let playTimer = null;
  let ttsFinished = false;

  /* --- DOM Elements --- */
  const cardEl = document.getElementById('sentence-card');
  const innerEl = document.getElementById('sentence-inner');
  const krEl = document.getElementById('sentence-kr');
  const romEl = document.getElementById('sentence-rom');
  const enEl = document.getElementById('sentence-en');
  const vocabListEl = document.getElementById('vocab-list');
  const patternTagEl = document.getElementById('pattern-tag');
  const progressEl = document.getElementById('progress');
  const ttsBtn = document.getElementById('card-tts');
  const masteryStatsEl = document.getElementById('mastery-stats');

  const modeTabsEl = document.getElementById('mode-tabs');
  const filterPanelEl = document.getElementById('filter-panel');
  const chapterFiltersEl = document.getElementById('chapter-filters');
  const patternFiltersEl = document.getElementById('pattern-filters');

  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const respContainer = document.getElementById('response-buttons');

  const playBtn = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  const autoplayProgressEl = document.getElementById('autoplay-progress');
  const autoplayStatusEl = document.getElementById('autoplay-status');

  /* --- Sort by mastery (weak first) --- */
  function masteryOrder(sentence) {
    const mastery = App.getWordMastery();
    const m = mastery[sentence.kr];
    if (!m) return 2; // unrated in middle
    if (m.status === 'dont_know') return 0;
    if (m.status === 'unsure') return 1;
    return 3; // know last
  }

  /* --- Mode switching --- */
  function setMode(newMode) {
    mode = newMode;
    activeFilter = null;

    // Update tabs
    modeTabsEl.querySelectorAll('.mode-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Show/hide filter panels
    if (mode === 'chapter') {
      chapterFiltersEl.classList.remove('hidden');
      patternFiltersEl.classList.add('hidden');
      currentSentences = [...allSentences];
    } else if (mode === 'pattern') {
      chapterFiltersEl.classList.add('hidden');
      patternFiltersEl.classList.remove('hidden');
      currentSentences = [...allSentences];
    } else if (mode === 'random') {
      chapterFiltersEl.classList.add('hidden');
      patternFiltersEl.classList.add('hidden');
      shuffleAll();
    }

    // Clear active filter buttons
    filterPanelEl.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    currentIdx = 0;
    isFlipped = false;
    render();
  }

  /* --- Filter sentences --- */
  function filterBy(type, value) {
    activeFilter = { type, value };

    if (type === 'chapter') {
      const chapter = chapters.get(value);
      currentSentences = chapter ? [...chapter.sentences] : [];
    } else if (type === 'pattern') {
      currentSentences = patterns.has(value) ? [...patterns.get(value)] : [];
    }

    // Sort by mastery
    currentSentences.sort((a, b) => masteryOrder(a) - masteryOrder(b));

    currentIdx = 0;
    isFlipped = false;
    render();
  }

  /* --- Shuffle all sentences --- */
  function shuffleAll() {
    currentSentences = [...allSentences];
    for (let i = currentSentences.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [currentSentences[i], currentSentences[j]] = [currentSentences[j], currentSentences[i]];
    }
  }

  /* --- Build filter buttons --- */
  function buildChapterList() {
    chapterFiltersEl.innerHTML = '';
    const sortedChapters = Array.from(chapters.entries()).sort((a, b) => a[0] - b[0]);
    sortedChapters.forEach(([chId, ch]) => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.textContent = `Ch.${chId}: ${ch.title} (${ch.sentences.length})`;
      btn.addEventListener('click', () => {
        chapterFiltersEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterBy('chapter', chId);
      });
      chapterFiltersEl.appendChild(btn);
    });
  }

  // Build pattern id → display name map
  const patternNames = new Map();
  (sentenceData.patterns || []).forEach(p => {
    patternNames.set(p.id, p.name || p.id);
  });

  function getPatternName(patternId) {
    return patternNames.get(patternId) || patternId;
  }

  function buildPatternList() {
    patternFiltersEl.innerHTML = '';
    // Sort patterns by the order defined in data
    const patternOrder = (sentenceData.patterns || []).map(p => p.id);
    const sortedPatterns = Array.from(patterns.keys()).sort((a, b) => {
      const ai = patternOrder.indexOf(a);
      const bi = patternOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    sortedPatterns.forEach(pat => {
      const btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.textContent = `${getPatternName(pat)} (${patterns.get(pat).length})`;
      btn.addEventListener('click', () => {
        patternFiltersEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterBy('pattern', pat);
      });
      patternFiltersEl.appendChild(btn);
    });
  }

  /* --- Mastery Stats --- */
  function updateMasteryStats() {
    const mastery = App.getWordMastery();
    let know = 0, unsure = 0, dontKnow = 0;
    for (const sentence of currentSentences) {
      const m = mastery[sentence.kr];
      if (!m) continue;
      if (m.status === 'know') know++;
      else if (m.status === 'unsure') unsure++;
      else if (m.status === 'dont_know') dontKnow++;
    }
    if (masteryStatsEl) {
      masteryStatsEl.innerHTML =
        '<span class="stat-know">&#10003;' + know + '</span>' +
        '&nbsp;&nbsp;<span class="stat-unsure">?' + unsure + '</span>' +
        '&nbsp;&nbsp;<span class="stat-dont-know">&#10007;' + dontKnow + '</span>';
    }
  }

  /* --- Card Status Badge --- */
  function updateCardBadge() {
    const existing = cardEl.querySelector('.card-badge');
    if (existing) existing.remove();

    if (currentSentences.length === 0) return;
    const sentence = currentSentences[currentIdx];
    const mastery = App.getWordMastery();
    const m = mastery[sentence.kr];
    if (!m) return;

    const badge = document.createElement('div');
    badge.className = 'card-badge ' + m.status.replace('_', '-');
    const frontEl = cardEl.querySelector('.sentence-front');
    if (frontEl) frontEl.appendChild(badge);
  }

  /* --- Render current sentence --- */
  function render() {
    if (currentSentences.length === 0) {
      krEl.textContent = 'No sentences';
      romEl.textContent = '';
      enEl.textContent = '';
      vocabListEl.innerHTML = '';
      patternTagEl.textContent = '';
      progressEl.textContent = '0 / 0';
      updateMasteryStats();
      return;
    }

    const sentence = currentSentences[currentIdx];
    krEl.textContent = sentence.kr;
    romEl.textContent = sentence.rom;
    enEl.textContent = sentence.en;
    patternTagEl.textContent = getPatternName(sentence.pattern) || '';

    // Build vocab list (vocab is array of strings like ["학생", "공부하다"])
    vocabListEl.innerHTML = '';
    if (sentence.vocab && sentence.vocab.length > 0) {
      sentence.vocab.forEach(v => {
        const tag = document.createElement('span');
        tag.className = 'sentence-vocab-tag';
        tag.textContent = typeof v === 'string' ? v : (v.kr || v);
        vocabListEl.appendChild(tag);
      });
    }

    progressEl.textContent = (currentIdx + 1) + ' / ' + currentSentences.length;
    innerEl.classList.toggle('flipped', isFlipped);
    updateCardBadge();
    updateMasteryStats();
  }

  /* --- Navigation --- */
  function nextCard() {
    if (currentSentences.length === 0) return;
    currentIdx = (currentIdx + 1) % currentSentences.length;
    isFlipped = false;
    render();
  }

  function prevCard() {
    if (currentSentences.length === 0) return;
    currentIdx = (currentIdx - 1 + currentSentences.length) % currentSentences.length;
    isFlipped = false;
    render();
  }

  /* --- Flip card --- */
  function flipCard() {
    isFlipped = !isFlipped;
    render();
  }

  /* --- TTS --- */
  function playCurrentSentence() {
    if (currentSentences.length > 0) {
      App.speak(currentSentences[currentIdx].kr);
    }
  }

  /* --- Response tracking --- */
  function handleResponse(status) {
    if (currentSentences.length === 0) return;
    const sentence = currentSentences[currentIdx];
    App.trackResponse(sentence.kr, sentence.en, status, 'sentence', 'sentence');

    // Re-queue dont_know cards 5 positions later
    if (status === 'dont_know') {
      const reinsertIdx = Math.min(currentIdx + 6, currentSentences.length);
      currentSentences.splice(reinsertIdx, 0, { ...sentence });
    }

    // Visual feedback
    const btns = respContainer.querySelectorAll('.resp-btn');
    btns.forEach(b => b.classList.add('resp-used'));
    setTimeout(() => {
      btns.forEach(b => b.classList.remove('resp-used'));
      nextCard();
    }, 400);
  }

  /* --- Auto-Play --- */
  function startAutoPlay() {
    if (currentSentences.length === 0) return;
    isPlaying = true;
    isPaused = false;

    playBtn.classList.add('hidden');
    pauseBtn.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
    autoplayProgressEl.classList.remove('hidden');

    playNextSentence();
  }

  function playNextSentence() {
    if (!isPlaying || isPaused || currentSentences.length === 0) return;

    const sentence = currentSentences[currentIdx];
    autoplayStatusEl.textContent = `Playing ${currentIdx + 1} of ${currentSentences.length}...`;

    // Show front (Korean)
    if (isFlipped) {
      isFlipped = false;
      render();
    }

    // Play TTS
    ttsFinished = false;
    App.speak(sentence.kr);

    // Wait for TTS duration + gap, then flip and move to next
    // Since we don't have TTS duration callback, estimate based on sentence length
    const estimatedDuration = Math.max(2000, sentence.kr.length * 100);

    playTimer = setTimeout(() => {
      if (!isPlaying || isPaused) return;

      // Briefly show English
      isFlipped = true;
      render();

      // Wait gap duration, then move to next
      playTimer = setTimeout(() => {
        if (!isPlaying || isPaused) return;

        currentIdx = (currentIdx + 1) % currentSentences.length;

        // Stop if we've cycled through all
        if (currentIdx === 0) {
          stopAutoPlay();
          return;
        }

        playNextSentence();
      }, playGap);

    }, estimatedDuration);
  }

  function pauseAutoPlay() {
    isPaused = !isPaused;
    if (isPaused) {
      pauseBtn.textContent = '▶ Resume';
      if (playTimer) clearTimeout(playTimer);
    } else {
      pauseBtn.textContent = '⏸ Pause';
      playNextSentence();
    }
  }

  function stopAutoPlay() {
    isPlaying = false;
    isPaused = false;
    if (playTimer) clearTimeout(playTimer);

    playBtn.classList.remove('hidden');
    pauseBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
    autoplayProgressEl.classList.add('hidden');
    pauseBtn.textContent = '⏸ Pause';
  }

  /* --- Event Listeners --- */

  // Mode tabs
  modeTabsEl.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  // Card flip
  cardEl.addEventListener('click', (e) => {
    if (e.target === ttsBtn || e.target.closest('#card-tts')) return;
    flipCard();
  });

  // TTS button
  ttsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playCurrentSentence();
  });

  // Navigation
  prevBtn.addEventListener('click', prevCard);
  nextBtn.addEventListener('click', nextCard);

  // Response buttons
  if (respContainer) {
    respContainer.querySelector('[data-resp="know"]').addEventListener('click', () => handleResponse('know'));
    respContainer.querySelector('[data-resp="unsure"]').addEventListener('click', () => handleResponse('unsure'));
    respContainer.querySelector('[data-resp="dont_know"]').addEventListener('click', () => handleResponse('dont_know'));
  }

  // Auto-play controls
  playBtn.addEventListener('click', startAutoPlay);
  pauseBtn.addEventListener('click', pauseAutoPlay);
  stopBtn.addEventListener('click', stopAutoPlay);

  // Speed settings
  document.querySelectorAll('[data-speed]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      playSpeed = parseFloat(btn.dataset.speed);
    });
  });

  // Gap settings
  document.querySelectorAll('[data-gap]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-gap]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      playGap = parseInt(btn.dataset.gap);
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prevCard();
    if (e.key === 'ArrowRight') nextCard();
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flipCard();
    }
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      if (isPlaying) {
        pauseAutoPlay();
      } else {
        startAutoPlay();
      }
    }
    if (e.key === 'Escape') {
      stopAutoPlay();
    }
    // Response keys
    if (respContainer) {
      if (e.key === '1') respContainer.querySelector('[data-resp="know"]').click();
      if (e.key === '2') respContainer.querySelector('[data-resp="unsure"]').click();
      if (e.key === '3') respContainer.querySelector('[data-resp="dont_know"]').click();
    }
  });

  // Touch swipe
  let touchStartX = 0;
  cardEl.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  cardEl.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) prevCard();
      else nextCard();
    }
  });

  /* --- Initialize --- */
  if (typeof App.initRomToggle === 'function') App.initRomToggle();
  if (typeof App.initEnToggle === 'function') App.initEnToggle();
  buildChapterList();
  buildPatternList();
  setMode('chapter');
  render();
})();
