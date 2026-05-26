/* ================================================
   MAJESTY WEB DESIGN — MAIN JAVASCRIPT
   Handles: Nav, Animations, Counters, Carousel, FAQs
   Squarespace-Compatible: Vanilla JS, no dependencies
   ================================================ */

(function () {
  'use strict';

  /* ─── NAVBAR ─── */
  const navbar = document.getElementById('navbar');
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 40) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    }, { passive: true });
  }

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
      hamburger.setAttribute('aria-expanded', isOpen);
    });

    // Close on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
        document.body.style.overflow = '';
        hamburger.setAttribute('aria-expanded', false);
      });
    });
  }

  // Active nav link
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ─── SCROLL REVEAL ─── */
  const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');

  if (revealElements.length && 'IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -60px 0px'
    });

    revealElements.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight - 60 && rect.bottom > 0) {
        el.classList.add('visible');
      } else {
        revealObserver.observe(el);
      }
    });
  } else {
    // Fallback: show all immediately
    revealElements.forEach(el => el.classList.add('visible'));
  }

  /* ─── COUNTER ANIMATION ─── */
  function animateCounter(el) {
    const target = parseInt(el.dataset.target, 10);
    const suffix = el.dataset.suffix || '';
    const prefix = el.dataset.prefix || '';
    const duration = 2000;
    const start = performance.now();

    function update(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);
      el.textContent = prefix + current.toLocaleString() + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
  }

  const counterEls = document.querySelectorAll('[data-counter]');
  if (counterEls.length && 'IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    counterEls.forEach(el => {
      el.textContent = (el.dataset.prefix || '') + '0' + (el.dataset.suffix || '');
      counterObserver.observe(el);
    });
  }

  /* ─── FAQ ACCORDION ─── */
  document.querySelectorAll('.faq-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const item = trigger.closest('.faq-item');
      const body = item.querySelector('.faq-body');
      const icon = trigger.querySelector('.faq-icon');
      const isOpen = item.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-item.open').forEach(openItem => {
        openItem.classList.remove('open');
        openItem.querySelector('.faq-body').classList.remove('open');
      });

      // Open clicked (if it wasn't open)
      if (!isOpen) {
        item.classList.add('open');
        body.classList.add('open');
      }
    });
  });

  /* ─── TESTIMONIAL SLIDER ─── */
  const slider = document.querySelector('.testimonial-slider');
  if (slider) {
    const track = slider.querySelector('.testimonial-track');
    const slides = slider.querySelectorAll('.testimonial-slide');
    const dotsContainer = slider.querySelector('.testimonial-dots');
    const prevBtn = slider.querySelector('.slider-prev');
    const nextBtn = slider.querySelector('.slider-next');

    if (!slides.length) return;

    let current = 0;
    let autoplayTimer;

    // Create dots
    if (dotsContainer) {
      slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'slider-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Go to testimonial ${i + 1}`);
        dot.addEventListener('click', () => goTo(i));
        dotsContainer.appendChild(dot);
      });
    }

    function goTo(index) {
      current = (index + slides.length) % slides.length;
      if (track) track.style.transform = `translateX(-${current * 100}%)`;

      // Update dots
      slider.querySelectorAll('.slider-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === current);
      });

      // Update slides aria
      slides.forEach((slide, i) => {
        slide.setAttribute('aria-hidden', i !== current);
      });
    }

    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    function startAutoplay() {
      autoplayTimer = setInterval(next, 5000);
    }

    function stopAutoplay() {
      clearInterval(autoplayTimer);
    }

    if (prevBtn) prevBtn.addEventListener('click', () => { stopAutoplay(); prev(); startAutoplay(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { stopAutoplay(); next(); startAutoplay(); });

    // Touch/swipe support
    let touchStartX = 0;
    slider.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
    slider.addEventListener('touchend', e => {
      const diff = touchStartX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 40) {
        stopAutoplay();
        diff > 0 ? next() : prev();
        startAutoplay();
      }
    }, { passive: true });

    startAutoplay();
    goTo(0);
  }

  /* ─── PORTFOLIO FILTER ─── */
  const filterBtns = document.querySelectorAll('.filter-btn');
  const portfolioItems = document.querySelectorAll('.portfolio-item[data-category], .portfolio-item-lg[data-category]');

  if (filterBtns.length && portfolioItems.length) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;

        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        portfolioItems.forEach(item => {
          const show = filter === 'all' || item.dataset.category === filter;
          item.style.opacity = show ? '1' : '0.25';
          item.style.pointerEvents = show ? 'auto' : 'none';
          item.style.transform = show ? '' : 'scale(0.97)';
          item.style.transition = 'all 0.3s ease';
        });
      });
    });
  }

  /* ─── SMOOTH SCROLL FOR ANCHOR LINKS ─── */
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      const href = anchor.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'), 10) || 80;
        const top = target.getBoundingClientRect().top + window.scrollY - offset - 20;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });

  /* ─── FORM SUBMISSION (Web3Forms → majestywebdesign@gmail.com) ───
   * Get your free access key at: https://web3forms.com
   * Enter majestywebdesign@gmail.com, copy the key, paste below.
   * ─────────────────────────────────────────────────────────────── */
  const WEB3FORMS_KEY = '06b09dba-d741-4e7f-8598-774131fcbfe6';

  async function submitToWeb3Forms(form, subject) {
    const data = Object.fromEntries(new FormData(form));
    data.access_key  = WEB3FORMS_KEY;
    data.subject     = subject;
    data.botcheck    = '';          // honeypot — leave empty

    const res  = await fetch('https://api.web3forms.com/submit', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(data)
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Submission failed');
    return json;
  }

  /* ─── CONTACT FORM ─── */
  const contactForm = document.getElementById('contact-form');
  if (contactForm) {
    contactForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn         = contactForm.querySelector('[type="submit"]');
      const originalHTML = btn.innerHTML;

      btn.innerHTML = 'Sending&hellip;';
      btn.disabled  = true;

      try {
        await submitToWeb3Forms(contactForm, 'New Quote Request — Majesty Web Design');
        btn.textContent       = 'Message Sent! ✓';
        btn.style.background  = 'linear-gradient(135deg, #10B981, #059669)';
        contactForm.reset();
      } catch (err) {
        btn.textContent      = 'Error — Please Try Again';
        btn.style.background = 'linear-gradient(135deg, #EF4444, #DC2626)';
        console.error('Contact form error:', err);
      }

      setTimeout(() => {
        btn.innerHTML        = originalHTML;
        btn.disabled         = false;
        btn.style.background = '';
      }, 4000);
    });
  }

  /* ─── FREE PREVIEW FORM ─── */
  const previewForm = document.getElementById('preview-form');
  if (previewForm) {
    previewForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn          = previewForm.querySelector('[type="submit"]');
      const originalHTML = btn.innerHTML;

      btn.innerHTML = 'Sending&hellip;';
      btn.disabled  = true;

      try {
        await submitToWeb3Forms(previewForm, 'Free Homepage Preview Request — Majesty Web Design');
        btn.textContent       = 'Request Received! ✓';
        btn.style.background  = 'linear-gradient(135deg, #10B981, #059669)';
        previewForm.reset();
      } catch (err) {
        btn.textContent      = 'Error — Please Try Again';
        btn.style.background = 'linear-gradient(135deg, #EF4444, #DC2626)';
        console.error('Preview form error:', err);
      }

      setTimeout(() => {
        btn.innerHTML        = originalHTML;
        btn.disabled         = false;
        btn.style.background = '';
      }, 4000);
    });
  }

  /* ─── NAV SCROLL INDICATOR ─── */
  const progressBar = document.getElementById('read-progress');
  if (progressBar) {
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.body.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      progressBar.style.width = progress + '%';
    }, { passive: true });
  }

  /* ─── PRICING TOGGLE (Monthly/Annual) ─── */
  const pricingToggle = document.getElementById('pricing-toggle');
  if (pricingToggle) {
    const monthlyLabel = document.getElementById('toggle-label-monthly');
    const annualLabel  = document.getElementById('toggle-label-annual');

    pricingToggle.addEventListener('change', () => {
      const isAnnual = pricingToggle.checked;

      // Update all prices that carry a data-monthly attribute
      document.querySelectorAll('[data-monthly]').forEach(el => {
        const monthly = parseInt(el.dataset.monthly, 10);
        const annual  = Math.round(monthly * 0.8);
        el.textContent = isAnnual ? annual : monthly;
      });

      // Update every /mo period label on the page
      document.querySelectorAll('.pricing-period').forEach(el => {
        el.textContent = isAnnual ? '/mo (billed annually)' : '/mo';
      });

      // Show/hide annual billing total notes
      document.querySelectorAll('.pricing-billed-note').forEach(el => {
        el.style.display = isAnnual ? 'block' : 'none';
        const totalEl = el.querySelector('.annual-total');
        if (totalEl) {
          const monthly = parseInt(totalEl.dataset.monthly, 10);
          totalEl.textContent = (Math.round(monthly * 0.8) * 12).toLocaleString();
        }
      });

      // Highlight active billing label
      if (monthlyLabel) monthlyLabel.classList.toggle('active', !isAnnual);
      if (annualLabel)  annualLabel.classList.toggle('active',  isAnnual);
    });
  }

  /* ─── FLOATING ELEMENTS PARALLAX ─── */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (parallaxEls.length) {
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      parallaxEls.forEach(el => {
        const speed = parseFloat(el.dataset.parallax) || 0.3;
        el.style.transform = `translateY(${scrollY * speed}px)`;
      });
    }, { passive: true });
  }

})();

/* ─── HERO PARTICLE SYSTEM ─── */
(function () {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const hero = canvas.closest('.hero');

  const COLORS = ['0,212,255', '139,92,246', '59,130,246'];
  const isMobile = window.innerWidth < 768;
  const COUNT = isMobile ? 25 : 80;
  const CONNECT_DIST = isMobile ? 0 : 150;
  const MOUSE_RADIUS = 140;
  const MOUSE_STRENGTH = 6;

  let W, H, raf;
  let mouse = { x: -9999, y: -9999 };
  let particles = [];

  function resize() {
    W = canvas.width = hero.offsetWidth;
    H = canvas.height = hero.offsetHeight;
  }

  function Particle() {
    this.x = Math.random() * W;
    this.y = Math.random() * H;
    this.ox = this.x;
    this.oy = this.y;
    this.vx = (Math.random() - 0.5) * 0.45;
    this.vy = (Math.random() - 0.5) * 0.45;
    this.r  = Math.random() * 1.5 + 0.7;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.alpha = isMobile ? Math.random() * 0.12 + 0.06 : Math.random() * 0.3 + 0.3;
  }

  Particle.prototype.update = function () {
    const dx = this.x - mouse.x;
    const dy = this.y - mouse.y;
    const d2 = dx * dx + dy * dy;

    if (d2 < MOUSE_RADIUS * MOUSE_RADIUS) {
      const d = Math.sqrt(d2) || 1;
      const force = (MOUSE_RADIUS - d) / MOUSE_RADIUS;
      this.x += (dx / d) * force * MOUSE_STRENGTH;
      this.y += (dy / d) * force * MOUSE_STRENGTH;
    }

    this.x += this.vx;
    this.y += this.vy;

    if (this.x < 0)  this.x = W;
    if (this.x > W)  this.x = 0;
    if (this.y < 0)  this.y = H;
    if (this.y > H)  this.y = 0;
  };

  Particle.prototype.draw = function () {
    // Glow halo
    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.r * 2.8);
    gradient.addColorStop(0,   'rgba(' + this.color + ',' + (this.alpha * 0.45) + ')');
    gradient.addColorStop(1,   'rgba(' + this.color + ',0)');
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r * 2.8, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    // Core dot
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + this.color + ',' + this.alpha + ')';
    ctx.fill();
  };

  function init() {
    resize();
    particles = Array.from({ length: COUNT }, () => new Particle());
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECT_DIST) {
          const alpha = (1 - dist / CONNECT_DIST) * 0.28;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = 'rgba(0,212,255,' + alpha + ')';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    }

    // Update & draw particles
    particles.forEach(p => { p.update(); p.draw(); });

    raf = requestAnimationFrame(loop);
  }

  // Mouse tracking relative to hero section
  hero.addEventListener('mousemove', e => {
    const rect = hero.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
  }, { passive: true });

  hero.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  }, { passive: true });

  // Pause when scrolled out of view (performance)
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        if (!raf) loop();
      } else {
        cancelAnimationFrame(raf);
        raf = null;
      }
    });
  }, { threshold: 0 });
  observer.observe(hero);

  window.addEventListener('resize', () => { resize(); }, { passive: true });

  init();
  loop();
})();

/* ================================================
   READING PROGRESS BAR
   ================================================ */
(function initReadingProgress() {
  var bar = document.getElementById('reading-progress');
  if (!bar) return;

  function updateProgress() {
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var pct = docHeight > 0 ? (window.scrollY / docHeight) * 100 : 0;
    bar.style.width = Math.min(pct, 100) + '%';
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();
})();

/* ================================================
   TYPING / ROTATING HERO TEXT
   ================================================ */
(function initTypingAnimation() {
  var el = document.getElementById('typed-industry');
  if (!el) return;

  var words = [
    'Plumbers', 'Salons', 'Restaurants', 'Contractors',
    'Roofers', 'Realtors', 'Gyms', 'Dentists',
    'Lawyers', 'Your Business'
  ];
  var wordIndex = 0;
  var charIndex = 0;
  var isDeleting = false;
  var timer;

  function getDelay() {
    if (isDeleting) return 45;
    if (!isDeleting && charIndex === words[wordIndex].length) {
      return wordIndex === words.length - 1 ? 3500 : 1800;
    }
    return 85;
  }

  function type() {
    var current = words[wordIndex];

    if (isDeleting) {
      charIndex--;
      el.textContent = current.substring(0, charIndex);
    } else {
      charIndex++;
      el.textContent = current.substring(0, charIndex);
    }

    var delay = getDelay();

    if (!isDeleting && charIndex === current.length) {
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      wordIndex = (wordIndex + 1) % words.length;
      delay = 280;
    }

    timer = setTimeout(type, delay);
  }

  // Start with the initial text, begin cycling after 2s
  setTimeout(function() {
    el.textContent = '';
    isDeleting = false;
    charIndex = 0;
    wordIndex = 0;
    type();
  }, 2000);
})();

/* ================================================
   FLOATING CTA STRIP
   ================================================ */
(function initFloatingCTA() {
  var strip = document.getElementById('floating-cta');
  if (!strip) return;

  if (sessionStorage.getItem('mwd-cta-dismissed')) return;

  var closeBtn = document.getElementById('floating-cta-close');
  var ctaBtn   = document.getElementById('floating-cta-btn');
  var hero     = document.querySelector('.hero');
  var shown    = false;

  function onScroll() {
    if (shown) return;
    var heroBottom = hero ? hero.getBoundingClientRect().bottom : 300;
    if (heroBottom < 0) {
      strip.classList.add('visible');
      shown = true;
      window.removeEventListener('scroll', onScroll);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });

  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      strip.classList.remove('visible');
      sessionStorage.setItem('mwd-cta-dismissed', '1');
    });
  }

  if (ctaBtn) {
    ctaBtn.addEventListener('click', function() {
      strip.classList.remove('visible');
    });
  }
})();

/* ================================================
   EXIT-INTENT POPUP
   ================================================ */
(function initExitIntent() {
  var popup     = document.getElementById('exit-popup');
  if (!popup) return;
  if (sessionStorage.getItem('mwd-exit-dismissed')) return;

  var closeBtn  = document.getElementById('exit-popup-close');
  var form      = document.getElementById('exit-popup-form');
  var submitBtn = document.getElementById('exit-popup-submit');
  var shown     = false;
  var delayPassed = false;

  // Don't show immediately — wait until user has had time to read the page
  setTimeout(function() { delayPassed = true; }, 8000);

  function openPopup() {
    if (shown || !delayPassed) return;
    shown = true;
    popup.classList.add('active');
    document.body.style.overflow = 'hidden';
    // Trap focus inside popup
    setTimeout(function() {
      var firstInput = popup.querySelector('input');
      if (firstInput) firstInput.focus();
    }, 350);
  }

  function closePopup() {
    popup.classList.remove('active');
    document.body.style.overflow = '';
    sessionStorage.setItem('mwd-exit-dismissed', '1');
  }

  // Trigger: cursor exits viewport toward top (address bar)
  document.addEventListener('mouseleave', function(e) {
    if (e.clientY <= 5) openPopup();
  });

  if (closeBtn) closeBtn.addEventListener('click', closePopup);

  // Dismiss on overlay click
  popup.addEventListener('click', function(e) {
    if (e.target === popup) closePopup();
  });

  // Dismiss on ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && popup.classList.contains('active')) closePopup();
  });

  // Form submission via fetch
  if (form && submitBtn) {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      submitBtn.textContent = 'Sending…';
      submitBtn.disabled = true;

      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: new FormData(form)
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          form.innerHTML =
            '<div style="text-align:center;padding:1.5rem 0">' +
            '<div style="font-size:2rem;margin-bottom:0.75rem">🎉</div>' +
            '<p style="color:var(--cyan);font-size:1.1rem;font-weight:700;margin-bottom:0.5rem">You\'re on the list!</p>' +
            '<p style="color:var(--gray-300);font-size:0.9rem">Expect your free mockup in your inbox within 48 hours.</p>' +
            '</div>';
          setTimeout(closePopup, 3500);
        } else {
          submitBtn.textContent = 'Try Again';
          submitBtn.disabled = false;
        }
      })
      .catch(function() {
        submitBtn.textContent = 'Try Again';
        submitBtn.disabled = false;
      });
    });
  }
})();
