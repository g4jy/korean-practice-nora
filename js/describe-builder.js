/* === Describe Sentence Builder === */

(async () => {
  const data = await App.loadVocab();
  const { subjects, adjectives, adverbs } = data.describe;

  const state = {
    adjectiveIdx: 0,
    subjectIdx: 0,
    adverbIdx: 0,
    showAdverb: false
  };

  const blocks = {
    subject: document.getElementById('block-subject'),
    adverb: document.getElementById('block-adverb'),
    adjective: document.getElementById('block-adjective')
  };

  /* --- Filter subjects compatible with current adjective --- */
  function compatibleSubjects() {
    const adj = adjectives[state.adjectiveIdx];
    return subjects.filter(s => adj.compatibleSubjects.includes(s.category));
  }

  /* --- Get subject with particle --- */
  function subjectWithParticle(subj) {
    const particle = App.particleIGa(subj.kr);
    return {
      kr: subj.kr + particle,
      rom: subj.rom,
      en: subj.en
    };
  }

  /* --- Render a block --- */
  function renderBlock(blockEl, kr, rom, en) {
    blockEl.querySelector('.block-kr').textContent = kr;
    blockEl.querySelector('.block-rom').textContent = rom;
    blockEl.querySelector('.block-en').textContent = en;
  }

  /* --- Update all blocks --- */
  function update() {
    const adj = adjectives[state.adjectiveIdx];
    const compat = compatibleSubjects();

    // Clamp subject index
    if (state.subjectIdx >= compat.length) state.subjectIdx = 0;
    const subj = compat[state.subjectIdx];
    const sp = subjectWithParticle(subj);

    renderBlock(blocks.subject, sp.kr, sp.rom, sp.en);
    renderBlock(blocks.adjective, adj.kr, adj.rom, adj.en);

    // Adverb
    if (state.showAdverb && adverbs.length > 0) {
      const adv = adverbs[state.adverbIdx];
      renderBlock(blocks.adverb, adv.kr, adv.rom, adv.en);
      blocks.adverb.classList.remove('hidden');
      document.getElementById('adverb-label').classList.remove('hidden');
    } else {
      blocks.adverb.classList.add('hidden');
      document.getElementById('adverb-label').classList.add('hidden');
    }

    updateSentence();
  }

  /* --- Build full sentence --- */
  function updateSentence() {
    const adj = adjectives[state.adjectiveIdx];
    const compat = compatibleSubjects();
    const subj = compat[state.subjectIdx] || compat[0];
    const sp = subjectWithParticle(subj);

    let krParts = [sp.kr];
    let enParts = [subj.en, 'is'];

    if (state.showAdverb && adverbs.length > 0) {
      const adv = adverbs[state.adverbIdx];
      krParts.push(adv.kr);
      enParts = [subj.en, 'is', adv.en];
    }

    krParts.push(adj.kr);
    enParts.push(adj.sentenceEn || adj.en);

    document.getElementById('full-sentence').textContent = krParts.join(' ');
    document.getElementById('translation').textContent = enParts.join(' ');
  }

  /* --- Block click handlers --- */
  blocks.subject.addEventListener('click', () => {
    const compat = compatibleSubjects();
    if (compat.length <= 1) return;
    state.subjectIdx = (state.subjectIdx + 1) % compat.length;
    App.pulseBlock(blocks.subject);
    update();
  });

  blocks.adjective.addEventListener('click', () => {
    // Save current subject before adjective change
    const prevCompat = compatibleSubjects();
    const prevSubj = prevCompat[state.subjectIdx];

    state.adjectiveIdx = (state.adjectiveIdx + 1) % adjectives.length;
    App.pulseBlock(blocks.adjective);
    // Keep current subject if still compatible, otherwise reset
    const newCompat = compatibleSubjects();
    if (prevSubj) {
      const kept = newCompat.findIndex(s => s.kr === prevSubj.kr);
      state.subjectIdx = kept >= 0 ? kept : 0;
    } else {
      state.subjectIdx = 0;
    }
    update();
  });

  blocks.adverb.addEventListener('click', () => {
    if (adverbs.length === 0) return;
    state.adverbIdx = (state.adverbIdx + 1) % adverbs.length;
    App.pulseBlock(blocks.adverb);
    update();
  });

  /* --- Add TTS buttons to blocks --- */
  function addTtsBtn(blockEl) {
    const btn = document.createElement('button');
    btn.className = 'block-tts-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.5" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const kr = blockEl.querySelector('.block-kr').textContent;
      App.speak(kr);
    });
    blockEl.appendChild(btn);
  }

  Object.values(blocks).forEach(addTtsBtn);

  /* --- Element toggle buttons (matches Action builder pattern) --- */
  document.querySelectorAll('.element-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      state.showAdverb = !state.showAdverb;
      btn.textContent = state.showAdverb ? '- Adverb' : '+ Adverb';
      btn.classList.toggle('active', state.showAdverb);
      update();
    });
  });

  /* --- Speak full sentence --- */
  document.getElementById('speak-btn').addEventListener('click', () => {
    const sentence = document.getElementById('full-sentence').textContent;
    App.speak(sentence);
  });

  /* --- Initial render --- */
  update();
})();
