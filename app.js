/* Python expression flashcards — SM-2, PWA, localStorage. Based on Bisaya Cards. */
(function () {
  'use strict';
  const LS_KEY = 'pyCards.v1';
  const VERSION = '1.0.0';

  let deck = null;           // {title, categories, cards}
  let progress = null;       // {settings, cards: {sid: state}, tests, version}
  let queue = [];            // current study session queue of {sid, card}
  let current = null;
  let flipped = false;
  let lastAction = null;     // for undo
  let view = 'home';

  const $ = (id) => document.getElementById(id);
  const views = {
    home: $('view-home'), study: $('view-study'), browse: $('view-browse'), settings: $('view-settings'),
    testSetup: $('view-testSetup'), test: $('view-test'), testResults: $('view-testResults')
  };

  // ---------- storage ----------
  function defaultSettings() {
    return {
      newPerDay: 10,
      kinds: 'both',              // both | eval | write
      enabledCategories: null,    // null = all
      newIntroducedOn: {},        // dayKey -> count
      reviewsToday: 0,
      reviewsDay: '',
      streak: 0,
      lastStudyDay: '',
      studyDays: []
    };
  }

  function fresh() { return { settings: defaultSettings(), cards: {}, tests: [], version: VERSION }; }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return fresh();
      const p = JSON.parse(raw);
      p.settings = Object.assign(defaultSettings(), p.settings || {});
      p.cards = p.cards || {};
      p.tests = Array.isArray(p.tests) ? p.tests : [];
      p.version = VERSION;
      return p;
    } catch (e) {
      console.warn('progress load failed', e);
      return fresh();
    }
  }

  function saveProgress() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(progress)); }
    catch (e) { toast('Could not save progress (storage full?)'); }
  }

  // ---------- deck helpers ----------
  function sid(cardId) { return cardId; }
  function getState(s) { return progress.cards[s] || SRS.newState(); }

  function activeCategories() {
    const en = progress.settings.enabledCategories;
    return new Set(en || deck.categories);
  }

  function kindOk(c) { const k = progress.settings.kinds; return k === 'both' || c.kind === k; }

  function sourceCards() {
    const cats = activeCategories();
    return deck.cards.filter(c => cats.has(c.category) && kindOk(c));
  }

  function allStudyItems() { return sourceCards().map(c => ({ sid: sid(c.id), card: c })); }

  function bumpDayCounters(now) {
    const key = SRS.dayKey(now);
    const s = progress.settings;
    if (s.reviewsDay !== key) { s.reviewsDay = key; s.reviewsToday = 0; }
    if (s.newIntroducedOn[key] == null) s.newIntroducedOn[key] = 0;
    for (const k of Object.keys(s.newIntroducedOn)) {
      if (k < key && Object.keys(s.newIntroducedOn).length > 14) delete s.newIntroducedOn[k];
    }
  }

  function buildQueue(now) {
    bumpDayCounters(now);
    const learning = [], review = [], news = [];
    for (const it of allStudyItems()) {
      const st = getState(it.sid);
      if (st.state === 'new') news.push(it);
      else if (st.due <= now) {
        if (st.state === 'learning' || st.state === 'relearning') learning.push(it);
        else review.push(it);
      }
    }
    learning.sort((a, b) => getState(a.sid).due - getState(b.sid).due);
    shuffle(review);
    // New cards: deck order, but cards missed in a test jump the line
    news.sort((a, b) => (getState(b.sid).priority || 0) - (getState(a.sid).priority || 0));

    const key = SRS.dayKey(now);
    const used = progress.settings.newIntroducedOn[key] || 0;
    const room = Math.max(0, progress.settings.newPerDay - used);
    const takeNew = news.slice(0, room);

    const rest = [];
    let i = 0, j = 0;
    while (i < review.length || j < takeNew.length) {
      if (j < takeNew.length && (i >= review.length || (i + j) % 3 === 2)) rest.push(takeNew[j++]);
      else if (i < review.length) rest.push(review[i++]);
      else rest.push(takeNew[j++]);
    }
    return learning.concat(rest);
  }

  function newAvailable(now) {
    return buildQueue(now).filter(it => getState(it.sid).state === 'new').length;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function counts(now) {
    bumpDayCounters(now);
    let due = 0, learning = 0, review = 0, news = 0, learned = 0;
    for (const it of allStudyItems()) {
      const st = getState(it.sid);
      if (st.state === 'new') news++;
      else if (st.state === 'learning' || st.state === 'relearning') { learning++; if (st.due <= now) due++; }
      else { learned++; if (st.due <= now) { review++; due++; } }
    }
    const newAvail = newAvailable(now);
    return {
      dueNow: due + newAvail, learning, review, news: newAvail, newsTotal: news,
      learned, reviewsToday: progress.settings.reviewsToday, streak: progress.settings.streak
    };
  }

  // ---------- card rendering (shared with quiz.js) ----------
  function kindLabel(card) { return card.kind === 'eval' ? 'What does this evaluate to?' : 'Write the expression'; }

  function frontHTML(card) {
    if (card.kind === 'eval') {
      return (card.given ? '<div class="given-label">Given</div><pre class="code given">' + esc(card.given) + '</pre>' : '') +
        '<pre class="code expr">' + esc(card.code) + '</pre>';
    }
    return '<div class="desc">' + esc(card.prompt) + '</div>';
  }

  function answerHTML(card) {
    if (card.kind === 'eval') {
      return '<pre class="code answer">' + esc(card.value) + '</pre>' +
        '<p class="explain">' + esc(card.explain) + '</p>';
    }
    let h = '<pre class="code answer">' + esc(card.code) + '</pre>';
    h += '<p class="explain">' + esc(card.explain) + '</p>';
    h += '<div class="example"><span>Example:</span> ' + (card.given ? 'with <code>' + esc(card.given.replace(/\n/g, '; ')) + '</code>, ' : '') +
      'it gives <code>' + esc(card.value) + '</code></div>';
    if (card.accept && card.accept.length)
      h += '<div class="also"><span>Also correct:</span> ' + card.accept.map(a => '<code>' + esc(a) + '</code>').join(' ') + '</div>';
    return h;
  }

  function listItemHTML(card, extraTags) {
    const top = card.kind === 'eval'
      ? (card.given ? '<pre class="code mini muted">' + esc(card.given) + '</pre>' : '') + '<pre class="code mini b">' + esc(card.code) + '</pre>'
      : '<div class="b">' + esc(card.prompt) + '</div>';
    const ans = card.kind === 'eval' ? card.value : card.code;
    return '<li>' + top + '<div class="e">→ <code>' + esc(ans) + '</code></div>' +
      '<div class="small muted">' + esc(card.explain) + '</div>' +
      '<div class="m"><span class="tag">' + esc(card.category) + '</span><span class="tag">' + (card.kind === 'eval' ? 'evaluate' : 'write') + '</span>' + (extraTags || '') + '</div></li>';
  }

  // ---------- study ----------
  function startStudy() {
    queue = buildQueue(Date.now());
    if (!queue.length) { toast('Nothing due right now'); return; }
    lastAction = null;
    showView('study');
    nextCard();
  }

  function nextCard() {
    const now = Date.now();
    while (queue.length) {
      const st = getState(queue[0].sid);
      if (st.state === 'review' && st.due > now) queue.shift(); else break;
    }
    current = queue.shift() || null;
    flipped = false;
    if (!current) { toast('Session done'); updateHome(); showView('home'); return; }
    renderCard();
  }

  function renderCard() {
    const { card } = current;
    $('dirLabel').textContent = kindLabel(card);
    $('cardCat').textContent = card.category;
    $('qLeft').textContent = (queue.length + 1) + ' left';
    $('front').innerHTML = frontHTML(card);
    $('back').innerHTML = answerHTML(card);
    $('back').hidden = true;
    $('tapHint').hidden = false;
    $('grades').hidden = true;
    $('showBtn').hidden = false;
    $('undoBtn').hidden = !lastAction;
    const now = Date.now();
    const st = getState(current.sid);
    for (const btn of $('grades').querySelectorAll('.grade')) {
      const next = SRS.schedule(st, +btn.dataset.g, now);
      btn.querySelector('small').textContent = SRS.fmtInterval(next, now);
    }
  }

  function flip() {
    if (!current || flipped) return;
    flipped = true;
    $('back').hidden = false;
    $('tapHint').hidden = true;
    $('grades').hidden = false;
    $('showBtn').hidden = true;
  }

  function grade(g) {
    if (!current || !flipped) return;
    const now = Date.now();
    bumpDayCounters(now);
    const prev = getState(current.sid);
    const wasNew = prev.state === 'new';
    const next = SRS.schedule(prev, g, now);
    progress.cards[current.sid] = next;
    if (wasNew) {
      next.firstSeen = now;
      const key = SRS.dayKey(now);
      progress.settings.newIntroducedOn[key] = (progress.settings.newIntroducedOn[key] || 0) + 1;
    }
    progress.settings.reviewsToday += 1;
    touchStreak(now);
    lastAction = { sid: current.sid, prev, item: current, wasNew };
    if ((next.state === 'learning' || next.state === 'relearning') && next.due - now < 20 * SRS.MIN) queue.push(current);
    saveProgress();
    nextCard();
  }

  function undo() {
    if (!lastAction) return;
    const a = lastAction;
    progress.cards[a.sid] = a.prev;
    if (a.wasNew) {
      const key = SRS.dayKey(Date.now());
      progress.settings.newIntroducedOn[key] = Math.max(0, (progress.settings.newIntroducedOn[key] || 1) - 1);
    }
    progress.settings.reviewsToday = Math.max(0, progress.settings.reviewsToday - 1);
    queue = queue.filter(it => it.sid !== a.sid);
    if (current && current.sid !== a.sid) queue.unshift(current);
    queue.unshift(a.item);
    lastAction = null;
    saveProgress();
    nextCard();
  }

  function touchStreak(now) {
    const key = SRS.dayKey(now);
    const s = progress.settings;
    if (s.lastStudyDay === key) return;
    const yesterday = SRS.dayKey(now - SRS.DAY);
    s.streak = s.lastStudyDay === yesterday ? (s.streak || 0) + 1 : 1;
    s.lastStudyDay = key;
    s.studyDays = (s.studyDays || []).filter(d => d !== key).concat(key).slice(-60);
  }

  // ---------- UI ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showView(name) {
    view = name;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
    $('backBtn').hidden = name === 'home';
    $('title').textContent = ({ home: 'Python Cards', study: 'Study', browse: 'Browse', settings: 'Settings', testSetup: 'Test', test: 'Test', testResults: 'Test results' })[name];
    if (name === 'testSetup') QuizUI.renderSetup();
    if (name === 'browse') renderBrowse();
    if (name === 'settings') renderSettings();
    if (name === 'home') updateHome();
    window.scrollTo(0, 0);
  }

  function updateHome() {
    const now = Date.now();
    const c = counts(now);
    $('dueCount').textContent = c.dueNow;
    $('newCount').textContent = c.news;
    $('reviewCount').textContent = c.review;
    $('learnCount').textContent = learningDue(now);
    $('statLearned').textContent = c.learned;
    $('statDueToday').textContent = c.dueNow;
    $('statStreak').textContent = c.streak;
    $('statReviewsToday').textContent = c.reviewsToday;
    $('startBtn').disabled = c.dueNow === 0;
    $('testSummary').textContent = QuizUI.homeSummary();
    $('doneMsg').hidden = c.dueNow !== 0;
    for (const b of $('kindSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.kind === progress.settings.kinds);
    const cats = activeCategories(), n = deck.categories.length;
    $('filterNote').textContent = (cats.size < n ? 'Studying ' + cats.size + ' of ' + n + ' categories · ' : '') +
      sourceCards().length + ' of ' + deck.cards.length + ' cards selected';
  }

  function learningDue(now) {
    let n = 0;
    for (const it of allStudyItems()) {
      const st = getState(it.sid);
      if ((st.state === 'learning' || st.state === 'relearning') && st.due <= now) n++;
    }
    return n;
  }

  function renderBrowse() {
    const sel = $('browseCat');
    if (!sel.dataset.ready) {
      sel.innerHTML = '<option value="">All categories</option>' +
        deck.categories.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
      sel.dataset.ready = '1';
    }
    const q = ($('search').value || '').trim().toLowerCase();
    const cat = sel.value;
    const items = deck.cards.filter(c => {
      if (cat && c.category !== cat) return false;
      if (!q) return true;
      return [c.code, c.value, c.prompt, c.given, c.explain].join(' ').toLowerCase().includes(q);
    });
    $('browseCount').textContent = items.length + ' cards';
    const now = Date.now();
    $('list').innerHTML = items.map(c => {
      const st = getState(sid(c.id));
      let tag;
      if (st.state === 'new') tag = '<span class="tag">new</span>';
      else if (st.due <= now) tag = '<span class="tag due">due</span>';
      else if (st.state === 'review') tag = '<span class="tag learned">learned · next ' + SRS.fmtInterval(st, now) + '</span>';
      else tag = '<span class="tag">learning</span>';
      return listItemHTML(c, tag);
    }).join('');
  }

  function renderSettings() {
    $('npd').value = progress.settings.newPerDay;
    $('kindSelect').value = progress.settings.kinds;
    const en = activeCategories();
    $('catList').innerHTML = deck.categories.map(cat => {
      const n = deck.cards.filter(c => c.category === cat).length;
      return '<label><input type="checkbox" data-cat="' + esc(cat) + '"' + (en.has(cat) ? ' checked' : '') + '> <span>' + esc(cat) + '</span><span class="n">' + n + '</span></label>';
    }).join('');
    $('versionInfo').textContent = 'v' + VERSION + ' · ' + deck.cards.length + ' cards · every answer checked by running it in Python';
  }

  function readCategoriesFromUI() {
    const on = [...$('catList').querySelectorAll('input[type=checkbox]')].filter(b => b.checked).map(b => b.dataset.cat);
    progress.settings.enabledCategories = on.length === deck.categories.length ? null : on;
    saveProgress();
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- backup ----------
  function exportProgress() {
    const blob = new Blob([JSON.stringify({ type: 'python-cards-progress', version: VERSION, exportedAt: new Date().toISOString(), progress }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'python-cards-progress-' + SRS.dayKey(Date.now()) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('backupMsg').textContent = 'Exported. Save the file in Files / iCloud Drive.';
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const p = data.progress || data;
        if (!p.settings || !p.cards) throw new Error('Missing settings/cards');
        progress = { settings: Object.assign(defaultSettings(), p.settings), cards: p.cards, tests: Array.isArray(p.tests) ? p.tests : [], version: VERSION };
        saveProgress(); updateHome(); renderSettings();
        $('backupMsg').textContent = 'Imported ' + Object.keys(progress.cards).length + ' card states and ' + progress.tests.length + ' test results.';
        toast('Progress imported');
      } catch (e) {
        $('backupMsg').textContent = 'Import failed: ' + e.message;
      }
    };
    reader.readAsText(file);
  }

  // ---------- wiring ----------
  function wire() {
    $('startBtn').onclick = startStudy;
    $('backBtn').onclick = () => showView('home');
    document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => showView(b.dataset.go));
    $('card').onclick = (e) => { if (!e.target.closest('details')) flip(); };
    $('card').onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } };
    $('showBtn').onclick = flip;
    $('grades').onclick = (e) => { const b = e.target.closest('.grade'); if (b) grade(+b.dataset.g); };
    $('undoBtn').onclick = undo;
    $('kindSeg').onclick = (e) => {
      const b = e.target.closest('button[data-kind]');
      if (!b) return;
      progress.settings.kinds = b.dataset.kind;
      saveProgress(); updateHome();
    };
    $('search').oninput = renderBrowse;
    $('browseCat').onchange = renderBrowse;
    $('npd').onchange = () => {
      progress.settings.newPerDay = Math.max(0, Math.min(500, +$('npd').value || 0));
      saveProgress(); updateHome();
    };
    $('npdMinus').onclick = () => { $('npd').value = Math.max(0, (+$('npd').value || 0) - 1); $('npd').dispatchEvent(new Event('change')); };
    $('npdPlus').onclick = () => { $('npd').value = Math.min(500, (+$('npd').value || 0) + 1); $('npd').dispatchEvent(new Event('change')); };
    $('kindSelect').onchange = () => { progress.settings.kinds = $('kindSelect').value; saveProgress(); updateHome(); };
    $('catList').onchange = readCategoriesFromUI;
    $('catAll').onclick = () => { $('catList').querySelectorAll('input').forEach(i => i.checked = true); readCategoriesFromUI(); updateHome(); };
    $('catNone').onclick = () => { $('catList').querySelectorAll('input').forEach(i => i.checked = false); readCategoriesFromUI(); updateHome(); };
    $('exportBtn').onclick = exportProgress;
    $('importFile').onchange = (e) => { if (e.target.files[0]) importProgress(e.target.files[0]); e.target.value = ''; };
    $('resetBtn').onclick = () => {
      if (!confirm('Erase all study progress on this device? This cannot be undone unless you exported a backup.')) return;
      progress = fresh();
      saveProgress(); updateHome(); renderSettings(); toast('Progress reset');
    };
  }

  // ---------- boot ----------
  async function boot() {
    progress = loadProgress();
    const res = await fetch('cards.json', { cache: 'no-cache' });
    deck = await res.json();
    wire();
    QuizUI.initUI({
      deck: () => deck, progress: () => progress, save: saveProgress, showView, sid, toast, esc, SRS,
      kindLabel, frontHTML, answerHTML, listItemHTML
    });
    updateHome();
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn(e); }
    }
  }

  window.__py = {
    get progress() { return progress; }, get deck() { return deck; }, get queue() { return queue; }, get current() { return current; },
    counts, buildQueue, grade, flip, startStudy, sid, getState, showView, saveProgress, LS_KEY
  };

  boot().catch(e => {
    document.body.innerHTML = '<p style="padding:24px">Failed to load cards.json: ' + esc(e.message) + '</p>';
  });
})();
