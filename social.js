/* ZENSTRO — insights page feed.
   If a server-side /api/social-feed endpoint returns authorised posts it is used;
   otherwise the official profile cards from config.js are shown. */
(function () {
  'use strict';

  var config = window.ZENSTRO_CONFIG || {};
  var statusEl = document.getElementById('social-status');
  var grid = document.getElementById('social-grid');
  if (!grid) return;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char];
    });
  }

  var profiles = [
    ['Instagram', config.instagramUrl, 'Visual updates, milestones and behind-the-scenes moments.'],
    ['LinkedIn — ZENSTRO', config.linkedinCompanyUrl, 'Company news, expertise, announcements and business perspectives.'],
    ['LinkedIn — Shubham Pathak', config.linkedinProfileUrl, 'Founder updates and professional insights from the CEO.']
  ].filter(function (profile) { return profile[1]; });

  function showProfiles() {
    if (statusEl) statusEl.textContent = profiles.length
      ? 'Follow ZENSTRO on our official channels.'
      : 'Official channels will be listed here soon.';
    grid.innerHTML = profiles.map(function (profile) {
      return '<a class="social-card" href="' + escapeHtml(profile[1]) + '" target="_blank" rel="noopener">' +
        '<span>' + escapeHtml(profile[0]) + '</span>' +
        '<h3>' + escapeHtml(profile[2]) + '</h3>' +
        '<b aria-hidden="true">↗</b></a>';
    }).join('');
  }

  /* Production social connector: tokens stay on the server, never in config.js. */
  fetch('/api/social-feed')
    .then(function (response) { return response.ok ? response.json() : Promise.reject(); })
    .then(function (posts) {
      if (!Array.isArray(posts) || !posts.length) return showProfiles();
      if (statusEl) statusEl.textContent = 'Latest updates from ZENSTRO.';
      grid.innerHTML = posts.map(function (post) {
        var text = post.title || post.text || 'Latest update from ZENSTRO.';
        return '<a class="social-card" href="' + escapeHtml(post.url || '#') + '" target="_blank" rel="noopener">' +
          '<span>' + escapeHtml(post.platform || 'Update') + '</span>' +
          '<h3>' + escapeHtml(String(text).slice(0, 140)) + '</h3>' +
          '<b aria-hidden="true">↗</b></a>';
      }).join('');
    })
    .catch(showProfiles);
})();
