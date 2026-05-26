/* ================================================
   MAJESTY WEB DESIGN — Fast Navigation
   AJAX page swapping + progress bar + transitions
   Eliminates full page reloads on internal links
   ================================================ */
(function () {
  'use strict';

  /* ─── Skip if browser doesn't support what we need ─── */
  if (!window.history || !window.fetch) return;

  /* ─── Progress bar ─── */
  var bar = document.createElement('div');
  bar.id = 'nav-progress';
  bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;width:0%;background:linear-gradient(90deg,#7c3aed,#0ea5e9);z-index:99999;transition:width 0.2s ease,opacity 0.3s ease;pointer-events:none;opacity:0';
  document.body.appendChild(bar);

  var barTimer;
  function startBar() {
    bar.style.opacity = '1';
    bar.style.width = '0%';
    bar.style.transition = 'width 0.2s ease';
    clearTimeout(barTimer);
    // Simulate progress
    var w = 0;
    function step() {
      w = w < 70 ? w + Math.random() * 15 : w + 1;
      if (w > 90) w = 90;
      bar.style.width = w + '%';
      if (w < 90) barTimer = setTimeout(step, 150);
    }
    step();
  }

  function finishBar() {
    clearTimeout(barTimer);
    bar.style.transition = 'width 0.15s ease, opacity 0.3s ease 0.15s';
    bar.style.width = '100%';
    setTimeout(function () { bar.style.opacity = '0'; bar.style.width = '0%'; }, 500);
  }

  /* ─── Page cache ─── */
  var cache = {};

  /* ─── Elements to swap on navigation ─── */
  function getMain(doc) {
    return doc.querySelector('main') || doc.querySelector('#main') || doc.body;
  }

  /* ─── Re-run page init after swap ─── */
  function reinit() {
    // Navbar active state
    var path = window.location.pathname;
    document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(function (a) {
      a.classList.remove('active');
      var href = a.getAttribute('href');
      if (href === path || (path === '/' && href === '/')) {
        a.classList.add('active');
      }
    });

    // Re-observe reveal elements
    var reveals = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');
    reveals.forEach(function (el) { el.classList.remove('visible'); });
    if (reveals.length && 'IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
      reveals.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight - 60 && r.bottom > 0) { el.classList.add('visible'); }
        else { obs.observe(el); }
      });
    }

    // Re-init counters
    var counters = document.querySelectorAll('[data-counter]');
    if (counters.length && 'IntersectionObserver' in window) {
      var cObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            animateCounter(e.target);
            cObs.unobserve(e.target);
          }
        });
      }, { threshold: 0.5 });
      counters.forEach(function (el) {
        el.textContent = (el.dataset.prefix || '') + '0' + (el.dataset.suffix || '');
        cObs.observe(el);
      });
    }

    // Re-init FAQ accordion
    document.querySelectorAll('.faq-trigger').forEach(function (trigger) {
      trigger.addEventListener('click', function () {
        var item = trigger.closest('.faq-item');
        var body = item.querySelector('.faq-body');
        var isOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function (o) {
          o.classList.remove('open');
          o.querySelector('.faq-body').classList.remove('open');
        });
        if (!isOpen) { item.classList.add('open'); body.classList.add('open'); }
      });
    });

    // Re-init reading progress
    var prog = document.getElementById('reading-progress');
    if (prog) {
      window.addEventListener('scroll', function () {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        prog.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
      }, { passive: true });
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }

  function animateCounter(el) {
    var target = parseInt(el.dataset.target, 10);
    var suffix = el.dataset.suffix || '';
    var prefix = el.dataset.prefix || '';
    var duration = 2000;
    var start = performance.now();
    function update(now) {
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(eased * target).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  /* ─── Navigate to a URL via AJAX ─── */
  function navigate(url, push) {
    if (url === window.location.href) return;
    startBar();

    // Fade out main
    var currentMain = getMain(document);
    currentMain.style.transition = 'opacity 0.15s ease';
    currentMain.style.opacity = '0.4';

    var fetcher = cache[url]
      ? Promise.resolve(cache[url])
      : fetch(url).then(function (r) { return r.text(); }).then(function (html) {
          cache[url] = html;
          return html;
        });

    fetcher.then(function (html) {
      var parser = new DOMParser();
      var newDoc = parser.parseFromString(html, 'text/html');
      var newMain = getMain(newDoc);
      var newTitle = newDoc.title;

      // Swap title
      document.title = newTitle;

      // Swap meta description
      var newMeta = newDoc.querySelector('meta[name="description"]');
      var curMeta = document.querySelector('meta[name="description"]');
      if (newMeta && curMeta) curMeta.setAttribute('content', newMeta.getAttribute('content'));

      // Swap main content
      currentMain.innerHTML = newMain.innerHTML;
      currentMain.style.opacity = '1';

      // Update URL
      if (push !== false) history.pushState({ url: url }, newTitle, url);

      finishBar();
      reinit();

      // Run any inline scripts in new content
      currentMain.querySelectorAll('script').forEach(function (oldScript) {
        var newScript = document.createElement('script');
        Array.from(oldScript.attributes).forEach(function (a) { newScript.setAttribute(a.name, a.value); });
        newScript.textContent = oldScript.textContent;
        oldScript.parentNode.replaceChild(newScript, oldScript);
      });

    }).catch(function () {
      // Fallback to normal navigation on error
      window.location.href = url;
    });
  }

  /* ─── Intercept link clicks ─── */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;

    // Skip: external, hash-only, mailto, tel, download, target=_blank
    if (a.hostname !== location.hostname) return;
    if (href.startsWith('#')) return;
    if (a.target === '_blank') return;
    if (a.hasAttribute('download')) return;
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;

    e.preventDefault();
    navigate(a.href);
  }, { passive: false });

  /* ─── Handle browser back/forward ─── */
  window.addEventListener('popstate', function (e) {
    navigate(window.location.href, false);
  });

  /* ─── Prefetch on hover (supplement to instant.page) ─── */
  var prefetched = {};
  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest('a');
    if (!a || a.hostname !== location.hostname) return;
    var url = a.href;
    if (prefetched[url] || cache[url]) return;
    prefetched[url] = true;
    // Pre-load into cache
    fetch(url).then(function (r) { return r.text(); }).then(function (html) {
      cache[url] = html;
    }).catch(function () {});
  }, { passive: true });

})();
