/* MarathonIndia - static race calendar. Data: races.json (community-maintained, agent-refreshed). */
(function () {
  'use strict';

  var state = { city: 'Pune', zone: '', st: '', dist: '', certOnly: false, q: '' };
  var races = [];

  var el = {
    races: document.getElementById('races'),
    count: document.getElementById('count'),
    empty: document.getElementById('empty'),
    fState: document.getElementById('f-state'),
    fCity: document.getElementById('f-city'),
    fDist: document.getElementById('f-dist'),
    fCert: document.getElementById('f-cert'),
    fSearch: document.getElementById('f-search')
  };

  function isCertified(r) {
    return /AIMS|World Athletics|WA |ITRA/i.test(r.certification || '');
  }

  function matches(r) {
    if (state.city === 'Pune' && r.scope.indexOf('pune') !== 0 && r.scope.indexOf('near-pune') !== 0) return false;
    if (state.zone && r.zone !== state.zone) return false;
    if (state.st && r.state !== state.st) return false;
    if (state.citySel && r.city !== state.citySel) return false;
    if (state.dist && (r.distances || []).indexOf(state.dist) === -1) return false;
    if (state.certOnly && !isCertified(r)) return false;
    if (state.q) {
      var hay = (r.name + ' ' + r.city + ' ' + r.state + ' ' + (r.certification || '')).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function optionList(select, values, label) {
    select.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = label;
    select.appendChild(first);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      select.appendChild(o);
    });
  }

  function refreshFilterOptions() {
    var states = [], cities = [];
    races.forEach(function (r) {
      if (state.zone && r.zone !== state.zone) return;
      if (r.state && states.indexOf(r.state) === -1) states.push(r.state);
      if (r.city && cities.indexOf(r.city) === -1) cities.push(r.city);
    });
    states.sort(); cities.sort();
    optionList(el.fState, states, 'Every state');
    optionList(el.fCity, cities, 'Every city');
  }

  function certTag(cert) {
    // Explicit per-race tag in the data wins: certification expiry is never
    // derived from the first or last year appearing in prose.
    if (/AIMS member/i.test(cert) && !/WA course cert/i.test(cert)) return 'AIMS member';
    var m = cert.match(/^WA course cert: (.+?) to (\d{4})/);
    if (m) return 'WA course cert: ' + m[1].replace(/"/g, '').replace(/\s+/g, ' ') + ' to ' + m[2];
    if (/ITRA listed/i.test(cert) && !/WA/i.test(cert)) return 'ITRA listed';
    return '';
  }

  function render() {
    var list = races.filter(matches);
    el.races.innerHTML = '';
    list.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'card';
      var url = r.url || '';
      if (url.charAt(0) === '/') url = 'https://punerunners.com' + url;

      var html = '';
      html += '<div class="card__date">' + (r.dateText || 'Date to be confirmed') + '</div>';
      html += '<div class="card__name"></div>';
      html += '<div class="card__place"></div>';
      var ct = r.certTag || (r.certification ? certTag(r.certification) : '');
      if ((r.distances || []).length || ct) {
        html += '<div class="tags">';
        (r.distances || []).forEach(function (d) { html += '<span class="tag">' + d + '</span>'; });
        if (ct) html += '<span class="tag tag--cert">' + ct + '</span>';
        html += '</div>';
      }
      if (r.certification) html += '<p class="card__cert"></p>';
      if ((r.fees || []).length) html += '<p class="card__fees">Fees: ' + r.fees.join(' · ') + '</p>';
      if (r.gstNote) html += '<p class="card__gst"></p>';
      if (r.requirements) html += '<p class="card__req"></p>';
      if (r.hasDiscount) html += '<p class="card__discount">Club discount listed - see race page</p>';
      if (r.lastChecked) html += '<p class="card__checked"></p>';
      if (url) html += '<div class="card__actions"><span class="action">Official site and registration</span></div>';
      card.innerHTML = html;
      card.querySelector('.card__name').textContent = r.name;
      card.querySelector('.card__place').textContent = [r.city, r.state].filter(Boolean).join(', ');
      var certEl = card.querySelector('.card__cert');
      if (certEl) certEl.textContent = r.certification;
      var gstEl = card.querySelector('.card__gst');
      if (gstEl) gstEl.textContent = r.gstNote;
      var reqEl = card.querySelector('.card__req');
      if (reqEl) reqEl.textContent = 'Requirements: ' + r.requirements;
      var chkEl = card.querySelector('.card__checked');
      if (chkEl) chkEl.textContent = r.lastChecked;
      if (url) {
        var link = card.querySelector('.action');
        link.addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });
      }
      el.races.appendChild(card);
    });
    el.empty.hidden = list.length > 0;
    el.count.textContent = list.length + (list.length === 1 ? ' race' : ' races') +
      (state.city === 'Pune' ? ' in and near Pune' : state.zone ? ' in ' + state.zone + ' India' : ' across India');
  }

  document.querySelectorAll('[data-zone]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-zone]').forEach(function (b) { b.classList.remove('is-on'); });
      btn.classList.add('is-on');
      state.zone = btn.getAttribute('data-zone');
      state.st = ''; state.citySel = '';
      refreshFilterOptions();
      render();
    });
  });
  document.querySelectorAll('[data-city]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-city]').forEach(function (b) { b.classList.remove('is-on'); });
      btn.classList.add('is-on');
      state.city = btn.getAttribute('data-city');
      render();
    });
  });
  el.fState.addEventListener('change', function () { state.st = el.fState.value; render(); });
  el.fCity.addEventListener('change', function () { state.citySel = el.fCity.value; render(); });
  el.fDist.addEventListener('change', function () { state.dist = el.fDist.value; render(); });
  el.fCert.addEventListener('change', function () { state.certOnly = el.fCert.checked; render(); });
  el.fSearch.addEventListener('input', function () { state.q = el.fSearch.value.trim().toLowerCase(); render(); });

  fetch('meta.json', { cache: 'no-cache' }).then(function (res) { return res.ok ? res.json() : null; }).then(function (m) {
    if (!m) return;
    var el = document.getElementById('data-status');
    if (!el) return;
    var d = new Date(m.fetchedAt);
    var when = isNaN(d) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    el.textContent = '';
    var dot = document.createElement('span');
    dot.className = 'data-status__dot';
    el.appendChild(dot);
    el.appendChild(document.createTextNode('Updated automatically ' + when + ' from live sources (' + m.races + ' races). '));
    if (m.runUrl) {
      var a = document.createElement('a');
      a.href = m.runUrl; a.textContent = 'Latest fetch run'; a.target = '_blank'; a.rel = 'noopener';
      el.appendChild(a);
    }
  }).catch(function () {});

  fetch('races.json', { cache: 'no-cache' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      races = data;
      refreshFilterOptions();
      render();
    })
    .catch(function () {
      el.count.textContent = 'Race data could not load right now.';
    });
})();
