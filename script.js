/* ZENSTRO — global behaviour: mobile menu, scroll reveals, footer year. */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ----- Mobile menu ----- */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('nav-links');

  function closeMenu() {
    if (!nav) return;
    nav.classList.remove('open');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Menu';
    }
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close' : 'Menu';
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) closeMenu();
    });
    document.addEventListener('click', function (event) {
      if (nav && nav.classList.contains('open')) {
        if (!nav.contains(event.target) && !toggle.contains(event.target)) {
          closeMenu();
        }
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
    });
  }

  /* ----- Scroll reveals ----- */
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!('IntersectionObserver' in window) || reduceMotion) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { observer.observe(el); });
  }

  /* ----- Footer year ----- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  /* ----- Privacy & Cookie Notice (Zero Ad Tracking) ----- */
  try {
    var acknowledged = localStorage.getItem('zenstro_privacy_acknowledged');
    if (!acknowledged) {
      var banner = document.createElement('aside');
      banner.className = 'cookie-banner';
      banner.setAttribute('role', 'region');
      banner.setAttribute('aria-label', 'Privacy and Cookies Notice');
      banner.innerHTML =
        '<div class="cookie-banner-inner">' +
          '<p><strong>Privacy &amp; Data Notice:</strong> ZENSTRO uses essential storage only. We do not use intrusive advertising trackers or sell your personal data. Read our <a href="privacy.html">Privacy Policy</a> to learn more.</p>' +
          '<div class="cookie-banner-actions">' +
            '<button type="button" class="cookie-btn-primary" id="cookie-accept">Understood</button>' +
            '<a href="privacy.html" class="cookie-btn-secondary">Learn more</a>' +
          '</div>' +
        '</div>';
      document.body.appendChild(banner);

      // Trigger reveal animation after short delay
      setTimeout(function () { banner.classList.add('show'); }, 600);

      var acceptBtn = document.getElementById('cookie-accept');
      if (acceptBtn) {
        acceptBtn.addEventListener('click', function () {
          localStorage.setItem('zenstro_privacy_acknowledged', 'true');
          banner.classList.remove('show');
          setTimeout(function () {
            if (banner.parentNode) banner.parentNode.removeChild(banner);
          }, 400);
        });
      }
    }
  } catch (e) {
    /* localStorage disabled in strict privacy mode; fail silently */
  }

  /* ----- Global Navigation Auth State ----- */
  function updateNavAuthState() {
    var rawAdmin = localStorage.getItem('zenstro_admin_session');
    var rawUser = localStorage.getItem('zenstro_user_session');
    var user = null;
    try {
      if (rawAdmin) user = JSON.parse(rawAdmin);
      else if (rawUser) user = JSON.parse(rawUser);
    } catch (e) {}

    var loginBtn = document.getElementById('global-login-btn');
    if (!loginBtn) return;

    var adminEmails = (window.ZENSTRO_CONFIG && window.ZENSTRO_CONFIG.adminEmails) || [
      "sub08pathak@gmail.com",
      "officialzyanix@gmail.com",
      "shubhamowen@gmail.com",
      "anshikashar1008@gmail.com",
      "ceo.shubhampathak@gmail.com"
    ];

    if (user && user.email) {
      var isAdmin = user.isAdmin || adminEmails.some(function(a){ return a.toLowerCase() === (user.email||'').toLowerCase(); });
      if (isAdmin) {
        loginBtn.innerHTML = '<span class="nav-auth-avatar">' + (user.name ? user.name.charAt(0).toUpperCase() : 'A') + '</span><span class="nav-auth-name">Admin Console</span> <span class="nav-auth-arrow">↗</span>';
        loginBtn.href = 'admin.html';
        loginBtn.className = 'nav-auth-pill nav-auth-admin';
      } else {
        loginBtn.innerHTML = '<span class="nav-auth-avatar">' + (user.name ? user.name.charAt(0).toUpperCase() : 'U') + '</span><span class="nav-auth-name">' + (user.name || user.email.split('@')[0]) + '</span> <span class="nav-auth-logout" id="nav-btn-logout" title="Sign out">&times;</span>';
        loginBtn.href = 'javascript:void(0);';
        loginBtn.className = 'nav-auth-pill nav-auth-member';

        var logoutBtn = document.getElementById('nav-btn-logout');
        if (logoutBtn) {
          logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            localStorage.removeItem('zenstro_user_session');
            sessionStorage.removeItem('zenstro_user_session');
            localStorage.removeItem('zenstro_admin_session');
            sessionStorage.removeItem('zenstro_admin_session');
            window.location.reload();
          });
        }
      }
    }
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateNavAuthState);
  } else {
    updateNavAuthState();
  }
})();
