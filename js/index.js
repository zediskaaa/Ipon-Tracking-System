(async function () {
  'use strict';

  // 1. Silky Smooth Scroll Engine using requestAnimationFrame (easeInOutCubic)
  // Eliminates browser snapping / teleportation when clicking navigation shortcut tabs.
  const navHeader = document.querySelector('.l-nav');
  const mobileTabs = document.querySelector('.l-mobile-tabs');
  const backToTopBtn = document.getElementById('back-to-top');

  let currentScrollAnimation = null;

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function getHeaderOffset() {
    return (navHeader ? navHeader.offsetHeight : 70) + 14;
  }

  function smoothScrollTo(targetY, duration, callback) {
    if (currentScrollAnimation) {
      cancelAnimationFrame(currentScrollAnimation);
      currentScrollAnimation = null;
    }

    const startY = window.pageYOffset || document.documentElement.scrollTop;
    const distance = targetY - startY;
    if (Math.abs(distance) < 2) {
      window.scrollTo(0, targetY);
      if (typeof callback === 'function') callback();
      return;
    }

    const animDuration = duration || Math.min(850, Math.max(520, Math.abs(distance) * 0.42));
    let startTime = null;

    function frame(now) {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / animDuration, 1);
      const eased = easeInOutCubic(progress);

      window.scrollTo(0, startY + (distance * eased));

      if (progress < 1) {
        currentScrollAnimation = requestAnimationFrame(frame);
      } else {
        window.scrollTo(0, targetY);
        currentScrollAnimation = null;
        if (typeof callback === 'function') callback();
      }
    }

    currentScrollAnimation = requestAnimationFrame(frame);
  }

  // Bind smooth scroll to all anchor links
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (event) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;

      if (href === '#top') {
        event.preventDefault();
        smoothScrollTo(0, 650, () => {
          if (history.replaceState) history.replaceState(null, '', '#top');
        });
        return;
      }

      const targetEl = document.querySelector(href);
      if (targetEl) {
        event.preventDefault();
        const elementTop = targetEl.getBoundingClientRect().top + window.pageYOffset;
        const targetPosition = Math.max(0, elementTop - getHeaderOffset());
        smoothScrollTo(targetPosition, 720, () => {
          if (history.replaceState) history.replaceState(null, '', href);
        });
      }
    });
  });

  // Back to top floating button
  if (backToTopBtn) {
    backToTopBtn.addEventListener('click', () => {
      smoothScrollTo(0, 650, () => {
        if (history.replaceState) history.replaceState(null, '', '#top');
      });
    });
  }

  // 2. ScrollSpy & Sticky Shadow with non-conflicting mobile tab alignment
  const sections = [
    { id: 'top', el: document.getElementById('top') },
    { id: 'features', el: document.getElementById('features') },
    { id: 'how', el: document.getElementById('how') },
    { id: 'roles', el: document.getElementById('roles') },
    { id: 'security', el: document.getElementById('security') },
    { id: 'faq', el: document.getElementById('faq') }
  ].filter((item) => Boolean(item.el));

  const desktopLinks = document.querySelectorAll('.l-links a');
  const mobileLinks = document.querySelectorAll('.l-mobile-tab');
  const ctaSection = document.querySelector('.l-cta');

  function updateActiveNav() {
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    if (navHeader) {
      navHeader.classList.toggle('is-scrolled', scrollY > 24);
    }
    if (backToTopBtn) {
      backToTopBtn.classList.toggle('is-visible', scrollY > 340);
    }

    // Hide fixed header smoothly when bottom CTA card enters viewport;
    // smoothly restore it as soon as user scrolls back up.
    if (ctaSection) {
      const ctaRect = ctaSection.getBoundingClientRect();
      const isCtaInView = ctaRect.top <= (window.innerHeight - 80);
      if (navHeader) navHeader.classList.toggle('is-hidden', isCtaInView);
    }

    const offset = getHeaderOffset() + 60;
    let currentId = 'top';

    for (let i = sections.length - 1; i >= 0; i -= 1) {
      const sec = sections[i];
      if (sec.el.offsetTop - offset <= scrollY) {
        currentId = sec.id;
        break;
      }
    }

    desktopLinks.forEach((link) => {
      const href = link.getAttribute('href');
      link.classList.toggle('is-active', href === `#${currentId}`);
    });

    mobileLinks.forEach((link) => {
      const href = link.getAttribute('href');
      const active = href === `#${currentId}`;
      link.classList.toggle('is-active', active);
      if (active && mobileTabs && !currentScrollAnimation) {
        const linkLeft = link.offsetLeft;
        const linkWidth = link.offsetWidth;
        const tabsWidth = mobileTabs.clientWidth;
        mobileTabs.scrollTo({
          left: Math.max(0, linkLeft - (tabsWidth / 2) + (linkWidth / 2)),
          behavior: 'smooth'
        });
      }
    });
  }

  let navScrollTicking = false;
  function handleScroll() {
    if (!navScrollTicking) {
      window.requestAnimationFrame(() => {
        updateActiveNav();
        navScrollTicking = false;
      });
      navScrollTicking = true;
    }
  }

  window.addEventListener('scroll', handleScroll, { passive: true });
  updateActiveNav();

  // 3. Hero Count-Up Number Ticker (₱0 -> ₱48,250.00)
  const heroTotalEl = document.getElementById('hero-total');
  if (heroTotalEl) {
    const targetAmount = 48250;
    const tickerDuration = 1400;
    const startTime = performance.now();

    function formatPeso(val) {
      return '₱' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function animateTotal(time) {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / tickerDuration, 1);
      const eased = easeInOutCubic(progress);
      const current = Math.round(targetAmount * eased * 100) / 100;
      heroTotalEl.textContent = formatPeso(current);

      if (progress < 1) {
        requestAnimationFrame(animateTotal);
      } else {
        heroTotalEl.textContent = formatPeso(targetAmount);
      }
    }

    requestAnimationFrame(animateTotal);
  }

  // 4. Interactive Approval Simulator
  const demoApprovalActions = document.getElementById('demo-approval-actions');
  const demoApprovalStatus = document.getElementById('demo-approval-status');
  const btnApprove = document.getElementById('demo-btn-approve');
  const btnDecline = document.getElementById('demo-btn-decline');

  function showApprovalResult(text, color, bg, border) {
    if (!demoApprovalActions || !demoApprovalStatus) return;
    demoApprovalActions.style.display = 'none';
    demoApprovalStatus.textContent = text;
    demoApprovalStatus.style.color = color;
    demoApprovalStatus.style.background = bg;
    demoApprovalStatus.style.borderColor = border;
    demoApprovalStatus.style.display = 'block';

    setTimeout(() => {
      demoApprovalStatus.style.display = 'none';
      demoApprovalActions.style.display = 'flex';
    }, 4500);
  }

  if (btnApprove) {
    btnApprove.addEventListener('click', () => {
      showApprovalResult('✓ Confirmed · Added to tracked savings', '#155e43', '#e6f3eb', '#b5dec6');
    });
  }
  if (btnDecline) {
    btnDecline.addEventListener('click', () => {
      showApprovalResult('✕ Rejected (Reason: Invalid receipt) · Logged to audit', '#ae3934', '#fbebe9', '#f0b8b5');
    });
  }

  // 5. Interactive Group Workspace Switcher
  const groupSelect = document.getElementById('demo-group-select');
  const grpAvatar = document.getElementById('demo-grp-avatar');
  const grpName = document.getElementById('demo-grp-name');
  const grpRole = document.getElementById('demo-grp-role');
  const grpMeta = document.getElementById('demo-grp-meta');

  const groupsData = {
    barkada: { name: 'Barkada Savings', avatar: 'BS', role: 'ADMIN', meta: '12 active contributors · Monthly' },
    family: { name: 'Family House Fund', avatar: 'FH', role: 'ADMIN', meta: '6 active contributors · Bi-weekly' },
    office: { name: 'Office Emergency Pot', avatar: 'OE', role: 'TREASURER', meta: '18 active contributors · Monthly' }
  };

  if (groupSelect) {
    groupSelect.addEventListener('change', () => {
      const selected = groupsData[groupSelect.value];
      if (!selected) return;
      if (grpAvatar) grpAvatar.textContent = selected.avatar;
      if (grpName) grpName.textContent = selected.name;
      if (grpRole) grpRole.textContent = selected.role;
      if (grpMeta) grpMeta.textContent = selected.meta;
    });
  }

  // 6. Interactive Dark / Light Theme Preview Switch in Feature Showcase
  const demoThemeBtn = document.getElementById('demo-theme-toggle');
  function syncDemoThemeButton() {
    if (!demoThemeBtn || !window.Ipon?.isDarkTheme) return;
    const isDark = Ipon.isDarkTheme();
    demoThemeBtn.setAttribute('aria-pressed', String(isDark));
    demoThemeBtn.textContent = isDark ? '☀ Switch back to Warm Light' : '☾ Preview Forest Dark Mode';
  }
  if (demoThemeBtn) {
    syncDemoThemeButton();
    demoThemeBtn.addEventListener('click', () => {
      if (window.Ipon?.toggleTheme) Ipon.toggleTheme();
      syncDemoThemeButton();
    });
    window.addEventListener('ipon:themechange', syncDemoThemeButton);
  }

  // 7. Subtle 3D tilt on hero card (desktop only)
  const mockContainer = document.querySelector('.l-mock');
  const mockCard = document.querySelector('.l-mock-card');
  if (mockContainer && mockCard && window.matchMedia('(hover: hover) and (min-width: 900px)').matches) {
    mockContainer.addEventListener('mousemove', (event) => {
      const rect = mockContainer.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -5;
      const rotateY = ((x - centerX) / centerX) * 5;
      mockCard.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px)`;
    });

    mockContainer.addEventListener('mouseleave', () => {
      mockCard.style.transform = '';
    });
  }

  // 8. Smooth Accordion with Auto-Close of Previous Items
  const faqDetails = document.querySelectorAll('.l-faq details');

  function animateFaqClose(detail, content, callback) {
    const startHeight = content.offsetHeight;
    content.style.overflow = 'hidden';
    content.style.height = `${startHeight}px`;
    content.style.opacity = '1';
    content.style.transition = 'height 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.28s ease';

    void content.offsetHeight;

    content.style.height = '0px';
    content.style.opacity = '0';

    const onEnd = () => {
      detail.open = false;
      content.style.height = '';
      content.style.opacity = '';
      content.style.overflow = '';
      content.style.transition = '';
      content.removeEventListener('transitionend', onEnd);
      if (typeof callback === 'function') callback();
    };
    content.addEventListener('transitionend', onEnd);
  }

  function animateFaqOpen(detail, content) {
    detail.open = true;
    content.style.overflow = 'hidden';
    content.style.height = 'auto';
    const targetHeight = content.scrollHeight;
    content.style.height = '0px';
    content.style.opacity = '0';
    content.style.transition = 'height 0.38s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.32s ease';

    void content.offsetHeight;

    content.style.height = `${targetHeight}px`;
    content.style.opacity = '1';

    const onEnd = () => {
      content.style.height = '';
      content.style.opacity = '';
      content.style.overflow = '';
      content.style.transition = '';
      content.removeEventListener('transitionend', onEnd);
    };
    content.addEventListener('transitionend', onEnd);
  }

  faqDetails.forEach((detail) => {
    const summary = detail.querySelector('summary');
    const content = detail.querySelector('.l-faq-content');
    if (!summary || !content) return;

    summary.addEventListener('click', (event) => {
      event.preventDefault();

      if (detail.open) {
        animateFaqClose(detail, content);
      } else {
        // Automatically close any other open FAQ cards smoothly
        faqDetails.forEach((otherDetail) => {
          if (otherDetail !== detail && otherDetail.open) {
            const otherContent = otherDetail.querySelector('.l-faq-content');
            if (otherContent) {
              animateFaqClose(otherDetail, otherContent);
            } else {
              otherDetail.open = false;
            }
          }
        });
        animateFaqOpen(detail, content);
      }
    });
  });

  // 9. Scroll-reveal engine
  const revealItems = document.querySelectorAll('.l-reveal');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px 120px 0px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-in'));
  }

  // Safety timer: ensure all sections become visible even if IntersectionObserver is throttled on low-power mobile devices
  setTimeout(() => {
    revealItems.forEach((item) => item.classList.add('is-in'));
  }, 1200);

  // 9. Fast session check for returning users (bypasses landing page for active users)
  let hasStoredSession = false;
  try { hasStoredSession = Object.keys(localStorage).some((key) => /^sb-.+-auth-token$/.test(key)); } catch {}
  if (!hasStoredSession) return;
  try {
    const state = await Ipon.init({ requireAuth: false, allowPending: true });
    if (!state.failed && state.session && state.profile?.status === 'ACTIVE') {
      location.replace(Ipon.homeForRole(state.profile.role));
    }
  } catch (err) {
    console.warn('Landing session check failed:', err);
  }
})();