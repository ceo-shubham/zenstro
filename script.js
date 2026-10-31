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
    var rawAdmin = localStorage.getItem('zenstro_admin_session') || sessionStorage.getItem('zenstro_admin_session');
    var rawClient = localStorage.getItem('zenstro_client_session') || sessionStorage.getItem('zenstro_client_session');
    var rawUser = localStorage.getItem('zenstro_user_session') || sessionStorage.getItem('zenstro_user_session');

    var adminUser = null;
    var clientUser = null;

    try {
      if (rawAdmin) adminUser = JSON.parse(rawAdmin);
    } catch (e) {}

    try {
      if (rawClient) {
        clientUser = JSON.parse(rawClient);
      } else if (rawUser) {
        var parsedUser = JSON.parse(rawUser);
        if (parsedUser) {
          if (parsedUser.isAdmin) {
            if (!adminUser) adminUser = parsedUser;
          } else {
            clientUser = parsedUser;
          }
        }
      }
    } catch (e) {}

    var loginBtn = document.getElementById('global-login-btn');
    if (!loginBtn) return;

    var SOLE_ADMIN_EMAIL = "ceo.shubhampathak@gmail.com";
    var adminEmails = (window.ZENSTRO_CONFIG && window.ZENSTRO_CONFIG.adminEmails) || [
      SOLE_ADMIN_EMAIL
    ];

    /* ----- MQLeads Visitor Identification ----- */
    function identifyMQLeadsUser(u, viaMethod) {
      if (!u || !u.email) return;
      var doIdentify = function () {
        try {
          if (window.MQLeads && typeof window.MQLeads.identify === 'function') {
            window.MQLeads.identify({
              name: u.name || u.email.split('@')[0],
              email: u.email,
              handle: u.email.split('@')[0],
              via: viaMethod || "login"
            });
          }
        } catch (e) {}
      };
      if (window.MQLeads) {
        doIdentify();
      } else {
        window.addEventListener('load', function () {
          setTimeout(doIdentify, 800);
        });
      }
    }

    // 1. Admin Logged In: "Admin Dashboard ↗" (no profile pic)
    if (adminUser && adminUser.email) {
      var adminEmail = String(adminUser.email || '').trim().toLowerCase();
      var isAdmin = (adminEmail === SOLE_ADMIN_EMAIL) || 
        (adminEmails.map(function(e) { return e.toLowerCase(); }).indexOf(adminEmail) !== -1);

      if (isAdmin) {
        identifyMQLeadsUser(adminUser, "login");
        loginBtn.innerHTML = 
          '<span class="nav-auth-name">Admin Dashboard</span> <span class="nav-auth-arrow">↗</span>';
        loginBtn.href = 'admin.html';
        loginBtn.className = 'nav-auth-pill nav-auth-admin';
        return;
      }
    }

    // 2. Regular User / Client Logged In: "Dashboard ↗" (no profile pic)
    if (clientUser && clientUser.email) {
      identifyMQLeadsUser(clientUser, "login");
      var targetUrl = 'portal.html';
      if (clientUser.clientId) {
        targetUrl = 'portal.html?client=' + encodeURIComponent(clientUser.clientId);
      }
      loginBtn.innerHTML = 
        '<span class="nav-auth-name">Dashboard</span> <span class="nav-auth-arrow">↗</span>';
      loginBtn.href = targetUrl;
      loginBtn.className = 'nav-auth-pill nav-auth-admin';
      return;
    }
  }

  // Run on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateNavAuthState);
  } else {
    updateNavAuthState();
  }
})();
