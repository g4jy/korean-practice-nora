/* === Vocabulary Flashcard === */

(async () => {
  const data = await App.loadVocab();

  /* --- Build card list from all vocab data --- */
  const allCards = [];
  const categories = new Map();
  const seen = new Set();

  function catLabel(cat) {
    const map = {
      food: 'Food', drink: 'Drinks', weather: 'Weather',
      activity: 'Activities', person: 'People', thing: 'Things'
    };
    return map[cat] || 'Other';
  }

  function addCard(kr, rom, en, category) {
    if (!kr || seen.has(kr)) return;
    seen.add(kr);
    const card = { kr, rom: rom || '', en: en || '', category };
    allCards.push(card);
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(card);
  }

  /* --- Extract from action data --- */
  const action = data.action || {};

  (action.times || []).forEach(t => addCard(t.kr, t.rom, t.en, 'Time'));

  (action.places || []).forEach(p => addCard(p.kr, p.rom, p.en, 'Places'));

  (action.objects || []).forEach(o => {
    addCard(o.kr, o.rom, o.en, catLabel(o.category));
  });

  (action.verbs || []).forEach(v => {
    addCard(v.present, v.presentRom, v.en + ' (present)', 'Verbs');
    addCard(v.past, v.pastRom, v.pastEn + ' (past)', 'Verbs');
    addCard(v.future, v.futureRom, v.futureEn + ' (future)', 'Verbs');
  });

  /* --- Extract from describe data --- */
  const desc = data.describe || {};

  (desc.subjects || []).forEach(s => addCard(s.kr, s.rom, s.en, catLabel(s.category)));

  (desc.adjectives || []).forEach(a => addCard(a.kr, a.rom, a.en, 'Adjectives'));

  (desc.adverbs || []).forEach(a => addCard(a.kr, a.rom, a.en, 'Adverbs'));

  /* --- Extra flashcard data from vocab.json --- */
  const fc = data.flashcards || {};
  (fc.categories || []).forEach(cat => {
    (cat.cards || []).forEach(c => addCard(c.kr, c.rom, c.en, cat.name));
  });

  /* --- Sort cards by mastery (weak first) --- */
  function masteryOrder(card) {
    const mastery = App.getWordMastery();
    const m = mastery[card.kr];
    if (!m) return 2; // unrated in middle
    if (m.status === 'dont_know') return 0;
    if (m.status === 'unsure') return 1;
    return 3; // know last
  }

  allCards.sort((a, b) => masteryOrder(a) - masteryOrder(b));

  /* --- State --- */
  let currentCards = [...allCards];
  let currentIdx = 0;
  let isFlipped = false;
  let cardDirection = localStorage.getItem('flashcardDirection') || 'kr-en';
  let reviewMode = false;

  /* --- DOM --- */
  const flashcardEl = document.getElementById('flashcard');
  const innerEl = document.getElementById('flashcard-inner');
  const koreanEl = document.getElementById('card-korean');
  const englishEl = document.getElementById('card-english');
  const romEl = document.getElementById('card-romanization');
  const progressEl = document.getElementById('progress');
  const ttsBtn = document.getElementById('card-tts');
  const masteryStatsEl = document.getElementById('mastery-stats');
  const reviewBanner = document.getElementById('review-banner');
  const reviewWeakBtn = document.getElementById('review-weak-btn');
  const reviewExitBtn = document.getElementById('review-exit-btn');


  /* --- Instant flip reset (no animation leak on navigation) --- */
  function resetFlipInstant() {
    isFlipped = false;
    innerEl.classList.add('no-transition');
    innerEl.classList.remove('flipped');
    void innerEl.offsetWidth;          // force reflow
    innerEl.classList.remove('no-transition');
  }

  /* --- Build category tabs --- */
  const tabContainer = document.getElementById('category-tabs');
  const catNames = ['All', ...categories.keys()];

  catNames.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (cat === 'All' ? ' active' : '');
    const count = cat === 'All' ? allCards.length : (categories.get(cat) || []).length;
    btn.textContent = cat + ' (' + count + ')';
    btn.addEventListener('click', () => {
      exitReviewMode();
      currentCards = cat === 'All' ? [...allCards] : [...(categories.get(cat) || [])];
      currentIdx = 0;
      resetFlipInstant();
      tabContainer.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
    tabContainer.appendChild(btn);
  });

  /* --- Mastery Stats --- */
  function updateMasteryStats() {
    const mastery = App.getWordMastery();
    let know = 0, unsure = 0, dontKnow = 0;
    for (const card of currentCards) {
      const m = mastery[card.kr];
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
    // Update review weak button count
    const weakCount = allCards.filter(c => {
      const m = mastery[c.kr];
      return m && (m.status === 'dont_know' || m.status === 'unsure');
    }).length;
    if (reviewWeakBtn) {
      reviewWeakBtn.textContent = 'Review Weak (' + weakCount + ')';
    }
  }

  /* --- Card Status Badge --- */
  function updateCardBadge() {
    // Remove existing badge
    const existing = flashcardEl.querySelector('.card-badge');
    if (existing) existing.remove();

    if (currentCards.length === 0) return;
    const card = currentCards[currentIdx];
    const mastery = App.getWordMastery();
    const m = mastery[card.kr];
    if (!m) return;

    const badge = document.createElement('div');
    badge.className = 'card-badge ' + m.status.replace('_', '-');
    flashcardEl.querySelector('.flashcard-front').appendChild(badge);
  }

  /* --- Render current card --- */
  function render() {
    if (currentCards.length === 0) {
      koreanEl.textContent = reviewMode ? 'All clear!' : 'No cards';
      englishEl.textContent = '';
      romEl.textContent = '';
      progressEl.textContent = '0 / 0';
      updateMasteryStats();
      return;
    }
    const card = currentCards[currentIdx];
    if (cardDirection === 'en-kr') {
      koreanEl.textContent = card.en;
      englishEl.textContent = card.kr;
      romEl.textContent = card.rom;
    } else {
      koreanEl.textContent = card.kr;
      englishEl.textContent = card.en;
      romEl.textContent = card.rom;
    }
    progressEl.textContent = (currentIdx + 1) + ' / ' + currentCards.length;
    innerEl.classList.toggle('flipped', isFlipped);
    updateCardBadge();
    updateMasteryStats();
  }

  /* --- Review Weak Mode --- */
  function enterReviewMode() {
    const mastery = App.getWordMastery();
    const weakCards = allCards.filter(c => {
      const m = mastery[c.kr];
      return m && (m.status === 'dont_know' || m.status === 'unsure');
    });
    if (weakCards.length === 0) {
      koreanEl.textContent = 'All clear!';
      englishEl.textContent = '';
      romEl.textContent = '';
      progressEl.textContent = '0 / 0';
      return;
    }
    reviewMode = true;
    currentCards = weakCards;
    currentIdx = 0;
    resetFlipInstant();
    if (reviewBanner) reviewBanner.classList.remove('hidden');
    render();
  }

  function exitReviewMode() {
    reviewMode = false;
    if (reviewBanner) reviewBanner.classList.add('hidden');
  }

  if (reviewWeakBtn) {
    reviewWeakBtn.addEventListener('click', enterReviewMode);
  }
  if (reviewExitBtn) {
    reviewExitBtn.addEventListener('click', () => {
      exitReviewMode();
      currentCards = [...allCards];
      currentIdx = 0;
      resetFlipInstant();
      tabContainer.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      const allTab = tabContainer.querySelector('.cat-tab');
      if (allTab) allTab.classList.add('active');
      render();
    });
  }

  /* --- Flip on tap --- */
  flashcardEl.addEventListener('click', (e) => {
    if (e.target === ttsBtn || e.target.closest('#card-tts')) return;
    isFlipped = !isFlipped;
    render();
  });

  /* --- TTS --- */
  ttsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentCards.length > 0) {
      App.speak(currentCards[currentIdx].kr);
    }
  });

  /* --- Direction toggle --- */
  const dirBtn = document.getElementById('direction-btn');
  function updateDirBtn() {
    if (dirBtn) dirBtn.innerHTML = cardDirection === 'kr-en' ? 'EN &rarr; KR' : 'KR &rarr; EN';
  }
  updateDirBtn();
  if (dirBtn) {
    dirBtn.addEventListener('click', () => {
      cardDirection = cardDirection === 'kr-en' ? 'en-kr' : 'kr-en';
      localStorage.setItem('flashcardDirection', cardDirection);
      resetFlipInstant();
      updateDirBtn();
      render();
    });
  }

  /* --- Navigation --- */
  document.getElementById('prev-btn').addEventListener('click', () => {
    if (currentCards.length === 0) return;
    currentIdx = (currentIdx - 1 + currentCards.length) % currentCards.length;
    resetFlipInstant();
    render();
  });

  document.getElementById('next-btn').addEventListener('click', () => {
    if (currentCards.length === 0) return;
    currentIdx = (currentIdx + 1) % currentCards.length;
    resetFlipInstant();
    render();
  });

  /* --- Shuffle --- */
  document.getElementById('shuffle-btn').addEventListener('click', () => {
    for (let i = currentCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [currentCards[i], currentCards[j]] = [currentCards[j], currentCards[i]];
    }
    currentIdx = 0;
    resetFlipInstant();
    render();
  });

  /* --- Response Tracking Buttons --- */
  const respContainer = document.getElementById('response-buttons');
  if (respContainer) {
    function handleResponse(status) {
      if (currentCards.length === 0) return;
      const card = currentCards[currentIdx];
      App.trackResponse(card.kr, card.en, status, card.category, 'flashcard');

      // Re-queue dont_know cards 5 positions later
      if (status === 'dont_know') {
        const reinsertIdx = Math.min(currentIdx + 6, currentCards.length);
        currentCards.splice(reinsertIdx, 0, { ...card });
      }

      // Visual feedback
      const btns = respContainer.querySelectorAll('.resp-btn');
      btns.forEach(b => b.classList.add('resp-used'));
      setTimeout(() => {
        btns.forEach(b => b.classList.remove('resp-used'));
        // Auto-advance to next card
        if (status !== 'dont_know') {
          currentIdx = (currentIdx + 1) % currentCards.length;
        } else {
          // For dont_know, move past current (card was reinserted ahead)
          currentIdx = (currentIdx + 1) % currentCards.length;
        }
        resetFlipInstant();
        render();
      }, 400);
    }

    respContainer.querySelector('[data-resp="know"]').addEventListener('click', () => handleResponse('know'));
    respContainer.querySelector('[data-resp="unsure"]').addEventListener('click', () => handleResponse('unsure'));
    respContainer.querySelector('[data-resp="dont_know"]').addEventListener('click', () => handleResponse('dont_know'));
  }

  /* --- Export button --- */
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => App.exportResponses());
  }

  /* --- Keyboard --- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') document.getElementById('prev-btn').click();
    if (e.key === 'ArrowRight') document.getElementById('next-btn').click();
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      isFlipped = !isFlipped;
      render();
    }
    // 1/2/3 for response buttons
    if (respContainer) {
      if (e.key === '1') respContainer.querySelector('[data-resp="know"]').click();
      if (e.key === '2') respContainer.querySelector('[data-resp="unsure"]').click();
      if (e.key === '3') respContainer.querySelector('[data-resp="dont_know"]').click();
    }
  });

  /* --- Touch swipe --- */
  let touchStartX = 0;
  flashcardEl.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });

  flashcardEl.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) document.getElementById('prev-btn').click();
      else document.getElementById('next-btn').click();
    }
  });

  /* --- Initial render --- */
  render();
})();
