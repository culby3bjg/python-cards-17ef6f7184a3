/* Test (quiz) mode for Python Cards: pure helpers + UI. */
(function (root) {
  'use strict';

  // ---------- pure helpers (unit-tested in Node) ----------
  /** Normalise typed code: curly quotes -> straight, " -> ' as string delimiters,
   *  whitespace dropped only OUTSIDE string literals (so 'Hi Ken' keeps its space). Case-sensitive. */
  function key(s) {
    s = String(s == null ? '' : s).replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u2033]/g, '"');
    let out = '', q = null;
    for (const ch of s) {
      if (q) { if (ch === q) { out += "'"; q = null; } else out += ch; }
      else if (ch === "'" || ch === '"') { q = ch; out += "'"; }
      else if (!/\s/.test(ch)) out += ch;
    }
    return out;
  }

  /** 'read' = cards where you work out a result (eval / output / error); 'write' = you write the code. */
  function family(card) { return card.kind === 'write' ? 'write' : 'eval'; }
  function correctText(card) { return card.kind === 'write' ? card.code : card.value; }
  function acceptable(card) {
    const list = card.kind === 'write' ? [card.code].concat(card.accept || []) : [card.value];
    return new Set(list.map(key));
  }
  /** Printed output: curly quotes -> straight, trim, collapse runs of spaces (print output has no quotes). */
  function okey(s) {
    return String(s == null ? '' : s).replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').trim();
  }

  function checkTyped(input, card) {
    if (!String(input || '').trim()) return false;
    if (card.kind === 'output') return okey(input) === okey(card.value);
    if (card.kind === 'error') return okey(input).toLowerCase() === card.value.toLowerCase();
    return acceptable(card).has(key(input));
  }

  /** A friendly hint for common near-misses (still marked wrong). */
  function typedHint(input, card) {
    if (card.kind === 'output') {
      const t = okey(input);
      if (/^(['"]).*\1$/.test(t) && okey(t.slice(1, -1)) === okey(card.value)) return 'Close! print() shows text WITHOUT quotes.';
      if (t.toLowerCase() === okey(card.value).toLowerCase()) return 'Close! Check upper/lower case.';
      return '';
    }
    if (card.kind !== 'eval') return '';
    const k = key(input), v = card.value;
    if (/^'.*'$/.test(v) && k === key(v.slice(1, -1))) return 'Close! The answer is a string, so it needs quotes.';
    if (/^'.*'$/.test(k) && key(k.slice(1, -1)) === key(v)) return 'Close! The answer is a number/value, not a string, so no quotes.';
    if (k.toLowerCase() === key(v).toLowerCase()) return 'Close! Python is case-sensitive (True, False, None start with a capital).';
    if (/^-?\d+$/.test(key(v)) && k === key(v) + '.0') return 'Close! The answer is an int (no .0).';
    if (/^-?\d+\.0$/.test(key(v)) && k + '.0' === key(v)) return 'Close! / and floats give a float, so it needs the .0.';
    return '';
  }

  function shuffle(a, rnd) {
    rnd = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /** Long code (e.g. comprehensions) is painful to type on a phone: use multiple choice for it. */
  function typeable(card) { const t = correctText(card); return t.indexOf('\n') < 0 && t.length <= 30; }

  /** Options: the right answer + the card's 3 hand-written (verified-wrong) distractors. */
  /** Key used to tell options apart: printed output keeps inner spaces; multi-line code keeps indentation. */
  function optKey(card, t) {
    if (card.kind === 'output') return t.split('\n').map(okey).join('\n');
    if (t.indexOf('\n') >= 0) return t.split('\n').map(l => l.replace(/\s+$/, '')).join('\n');
    return key(t);
  }
  function makeOptions(card, rnd) {
    const key = (t) => optKey(card, t);
    const right = correctText(card);
    const seen = new Set([key(right)]);
    const opts = [{ text: right, right: true }];
    for (const d of card.distractors || []) {
      if (opts.length >= 4) break;
      if (seen.has(key(d))) continue;
      seen.add(key(d)); opts.push({ text: d, right: false });
    }
    return shuffle(opts, rnd);
  }

  /** opts: {kind:'eval'|'write'|'mixed', qtype:'mc'|'typed'|'mixed', count:number|'all'} */
  function buildQuestions(cards, opts, rnd) {
    rnd = rnd || Math.random;
    const pool = shuffle(cards.filter(c => opts.kind === 'mixed' || !opts.kind || family(c) === opts.kind), rnd);
    const n = opts.count === 'all' ? pool.length : Math.min(+opts.count, pool.length);
    return pool.slice(0, n).map(card => {
      let type = opts.qtype === 'mixed' ? (rnd() < 0.5 ? 'mc' : 'typed') : opts.qtype;
      if (type === 'typed' && !typeable(card)) type = 'mc';
      const q = { card, type, answer: correctText(card) };
      if (type === 'mc') q.options = makeOptions(card, rnd);
      return q;
    });
  }

  const api = { key, okey, family, checkTyped, typedHint, typeable, makeOptions, buildQuestions, correctText };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.Quiz = api;

  // ---------- UI ----------
  const $ = (id) => document.getElementById(id);
  let A = null;                 // app API
  let T = null;                 // current test session
  const setup = { kind: 'mixed', qtype: 'mc', count: 10, cats: null };

  function esc(s) { return A.esc(s); }

  function initUI(app) {
    A = app;
    const saved = A.progress().settings.testSetup;
    if (saved) Object.assign(setup, saved);
    $('testBtn').onclick = () => A.showView('testSetup');
    for (const segId of ['tKind', 'tType', 'tCount']) {
      $(segId).onclick = (e) => {
        const b = e.target.closest('button[data-v]'); if (!b) return;
        const field = { tKind: 'kind', tType: 'qtype', tCount: 'count' }[segId];
        setup[field] = field === 'count' && b.dataset.v !== 'all' ? +b.dataset.v : b.dataset.v;
        renderSetup();
      };
    }
    $('tCatAll').onclick = () => { setup.cats = null; renderSetup(); };
    $('tCatNone').onclick = () => { setup.cats = []; renderSetup(); };
    $('tCatList').onchange = () => {
      const on = [...$('tCatList').querySelectorAll('input:checked')].map(i => i.dataset.cat);
      setup.cats = on.length === A.deck().categories.length ? null : on;
      renderSetup();
    };
    $('tStart').onclick = () => startTest(null);
    $('tOptions').onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) answerMC(+b.dataset.i); };
    $('tTypedForm').onsubmit = (e) => { e.preventDefault(); answerTyped(); };
    $('tOverride').onclick = override;
    $('tNext').onclick = next;
    $('tRetake').onclick = () => startTest(T.missed.map(m => m.card));
    $('tAgain').onclick = () => A.showView('testSetup');
    $('tHome').onclick = () => A.showView('home');
  }

  function catsSelected() {
    return setup.cats ? new Set(setup.cats) : new Set(A.deck().categories);
  }
  function candidates() {
    const sel = catsSelected();
    return A.deck().cards.filter(c => sel.has(c.category) && (setup.kind === 'mixed' || family(c) === setup.kind));
  }

  function renderSetup() {
    const mark = (segId, val) => {
      for (const b of $(segId).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(val));
    };
    mark('tKind', setup.kind); mark('tType', setup.qtype); mark('tCount', setup.count);
    const sel = catsSelected();
    const deck = A.deck();
    $('tCatList').innerHTML = deck.categories.map(cat => {
      const n = deck.cards.filter(c => c.category === cat).length;
      return '<label><input type="checkbox" data-cat="' + esc(cat) + '"' + (sel.has(cat) ? ' checked' : '') + '> <span>' + esc(cat) + '</span><span class="n">' + n + '</span></label>';
    }).join('');
    const avail = candidates().length;
    const n = setup.count === 'all' ? avail : Math.min(setup.count, avail);
    $('tCatSummary').textContent = sel.size === deck.categories.length ? 'All categories (' + avail + ' cards)' : sel.size + ' categories · ' + avail + ' cards';
    $('tStart').disabled = avail === 0;
    $('tStart').textContent = avail ? 'Start test · ' + n + ' question' + (n === 1 ? '' : 's') : 'Pick at least one category';
    renderHistory($('tHistory'));
  }

  function history() { return A.progress().tests || []; }

  function bestResult() {
    let best = null;
    for (const h of history()) if (!best || h.pct > best.pct || (h.pct === best.pct && h.total > best.total)) best = h;
    return best;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const KIND_LABEL = { eval: 'Read code', write: 'Write code', mixed: 'Mixed' };
  const TYPE_LABEL = { mc: 'Multiple choice', typed: 'Typed', mixed: 'Mixed' };

  function renderHistory(el) {
    const h = history();
    if (!h.length) { el.innerHTML = '<p class="muted small">No tests yet.</p>'; return; }
    const best = bestResult();
    el.innerHTML = '<p class="small"><b>Best:</b> ' + best.score + '/' + best.total + ' (' + best.pct + '%) · ' + esc(fmtDate(best.date)) + '</p>' +
      '<ul class="list hist">' + h.slice(-5).reverse().map(r =>
        '<li><div class="b">' + r.score + '/' + r.total + ' · ' + r.pct + '%' + (r.retake ? ' <span class="tag">retake</span>' : '') + '</div>' +
        '<div class="e small">' + esc(fmtDate(r.date)) + ' · ' + KIND_LABEL[r.settings.kind] + ' · ' + TYPE_LABEL[r.settings.qtype] +
        ' · ' + (r.settings.categories ? r.settings.categories.length + ' categories' : 'all categories') + '</div></li>').join('') + '</ul>';
  }

  function homeSummary() {
    const h = history();
    if (!h.length) return 'No tests yet';
    const last = h[h.length - 1], best = bestResult();
    return 'Last ' + last.score + '/' + last.total + ' (' + last.pct + '%) · Best ' + best.pct + '%';
  }

  // ---------- running a test ----------
  function startTest(retakeCards) {
    let qs;
    if (retakeCards) {
      qs = buildQuestions(retakeCards, { kind: 'mixed', qtype: setup.qtype, count: 'all' });
    } else {
      A.progress().settings.testSetup = Object.assign({}, setup);
      A.save();
      qs = buildQuestions(candidates(), setup);
    }
    if (!qs.length) { A.toast('No cards to test'); return; }
    T = { qs, i: 0, score: 0, missed: [], answered: false, retake: !!retakeCards, settings: Object.assign({}, setup) };
    A.showView('test');
    renderQuestion();
  }

  function renderQuestion() {
    window.scrollTo(0, 0);
    const q = T.qs[T.i];
    T.answered = false; T.correct = null; T.snapshot = undefined;
    $('tProgress').textContent = 'Question ' + (T.i + 1) + ' of ' + T.qs.length;
    $('tScore').textContent = T.score + ' correct';
    $('tBar').style.width = (100 * T.i / T.qs.length) + '%';
    $('tDirLabel').textContent = A.kindLabel(q.card);
    $('tCat').textContent = q.card.category;
    $('tPrompt').innerHTML = A.frontHTML(q.card);
    $('tFeedback').hidden = true;
    $('tFeedback').className = 'feedback';
    $('tNext').hidden = true;
    $('tOverride').hidden = true;
    if (q.type === 'mc') {
      $('tTypedForm').hidden = true;
      $('tOptions').hidden = false;
      $('tOptions').innerHTML = q.options.map((o, i) => '<button class="opt' + (o.text.indexOf('\n') >= 0 ? ' multi' : '') + '" data-i="' + i + '">' +
        (q.card.kind === 'output' ? '<pre class="out">' + esc(o.text) + '</pre>' : '<code>' + esc(o.text) + '</code>') + '</button>').join('');
    } else {
      $('tOptions').hidden = true;
      $('tTypedForm').hidden = false;
      const inp = $('tInput');
      inp.value = ''; inp.disabled = false; inp.className = '';
      inp.placeholder = ({ eval: 'Type the result…', output: 'Type what it prints…', error: 'Type the error name…' })[q.card.kind] || 'Type the Python code…';
      $('tSubmit').disabled = false;
      setTimeout(() => inp.focus(), 50);
    }
  }

  function answerMC(i) {
    if (T.answered) return;
    const q = T.qs[T.i];
    const correct = q.options[i].right;
    const btns = $('tOptions').querySelectorAll('.opt');
    btns.forEach((b, j) => {
      b.disabled = true;
      if (q.options[j].right) b.classList.add('right');
      else if (j === i) b.classList.add('wrong');
    });
    finish(correct, q.options[i].text, '');
  }

  function answerTyped() {
    if (T.answered) return;
    const q = T.qs[T.i];
    const val = $('tInput').value;
    if (!val.trim()) { $('tInput').focus(); return; }
    const correct = checkTyped(val, q.card);
    $('tInput').disabled = true;
    $('tSubmit').disabled = true;
    $('tInput').className = correct ? 'right' : 'wrong';
    finish(correct, val, correct ? '' : typedHint(val, q.card));
    if (!correct) $('tOverride').hidden = false;
  }

  function finish(correct, given, hint) {
    const q = T.qs[T.i];
    T.answered = true; T.correct = correct; T.given = given;
    if (correct) T.score++;
    else {
      T.missed.push({ card: q.card, given });
      T.snapshot = penalize(q.card);
    }
    const fb = $('tFeedback');
    fb.hidden = false;
    fb.className = 'feedback ' + (correct ? 'ok' : 'bad');
    fb.innerHTML = '<div class="verdict">' + (correct ? '✓ Correct' : '✗ Not quite') + '</div>' +
      (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') +
      A.answerHTML(q.card) +
      (!correct && q.type === 'typed' ? '<div class="small">You typed: <code>' + esc(given) + '</code></div>' : '');
    $('tScore').textContent = T.score + ' correct';
    $('tNext').hidden = false;
    $('tNext').textContent = T.i + 1 < T.qs.length ? 'Next →' : 'See results';
    A.save();
    requestAnimationFrame(() => $('tNext').scrollIntoView({ block: 'end', behavior: 'smooth' }));
  }

  function override() {
    if (!T.answered || T.correct) return;
    const q = T.qs[T.i];
    T.correct = true; T.score++;
    T.missed = T.missed.filter(m => m.card.id !== q.card.id);
    const s = A.sid(q.card.id);
    if (T.snapshot === null) delete A.progress().cards[s];
    else if (T.snapshot) A.progress().cards[s] = T.snapshot;
    A.save();
    $('tOverride').hidden = true;
    $('tInput').className = 'right';
    $('tFeedback').className = 'feedback ok';
    $('tFeedback').querySelector('.verdict').textContent = '✓ Counted as correct';
    $('tScore').textContent = T.score + ' correct';
  }

  /** Missed card → its flashcard becomes due now (gentle lapse); new cards jump the queue. Returns previous state. */
  function penalize(card) {
    const now = Date.now();
    const s = A.sid(card.id);
    const cards = A.progress().cards;
    const prev = cards[s] ? JSON.parse(JSON.stringify(cards[s])) : null;
    const st = Object.assign(A.SRS.newState(), cards[s] || {});
    const today = A.SRS.dayKey(now);
    const already = st.testMissedAt && A.SRS.dayKey(st.testMissedAt) === today;
    if (st.state === 'new') {
      st.priority = now;
    } else if (st.state === 'review') {
      if (!already) {
        st.interval = Math.max(1, Math.round(st.interval / 2));
        st.ease = Math.max(A.SRS.CFG.minEase, st.ease - 0.1);
      }
      st.due = now;
    } else {
      st.due = Math.min(st.due, now);
    }
    st.testMissedAt = now;
    cards[s] = st;
    return prev;
  }

  function next() {
    if (!T.answered) return;
    T.i++;
    if (T.i < T.qs.length) { renderQuestion(); return; }
    showResults();
  }

  function showResults() {
    const total = T.qs.length, pct = Math.round(100 * T.score / total);
    const p = A.progress();
    p.tests = p.tests || [];
    p.tests.push({
      date: new Date().toISOString(), score: T.score, total, pct, retake: T.retake,
      settings: { kind: T.retake ? 'mixed' : T.settings.kind, qtype: T.settings.qtype, count: T.retake ? total : T.settings.count, categories: T.settings.cats }
    });
    if (p.tests.length > 200) p.tests = p.tests.slice(-200);
    A.save();
    A.showView('testResults');
    $('rScore').textContent = T.score + ' / ' + total;
    $('rPct').textContent = pct + '%';
    $('rMsg').textContent = pct === 100 ? 'Perfect! 🐍🎉' : pct >= 80 ? 'Great job!' : pct >= 50 ? 'Good progress — keep going.' : 'Keep practising — missed cards are now due in your flashcards.';
    $('rMissedWrap').hidden = !T.missed.length;
    $('tRetake').hidden = !T.missed.length;
    $('tRetake').textContent = 'Retake missed (' + T.missed.length + ')';
    $('rMissed').innerHTML = T.missed.map(m => A.listItemHTML(m.card,
      '<span class="tag due">you: ' + esc(m.given) + '</span>')).join('');
    renderHistory($('rHistory'));
  }

  root.QuizUI = { initUI, renderSetup, homeSummary, get session() { return T; } };
})(this);
