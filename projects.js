/* ZENSTRO — live GitHub repositories.
   One request per 100 repos (second page only if the first is full),
   sorted by stars then recency, top nine shown. */
(function () {
  'use strict';

  var config = window.ZENSTRO_CONFIG || {};
  var grid = document.getElementById('repo-grid');
  var status = document.getElementById('repo-status');
  if (!grid || !config.githubUsername) {
    if (status) status.textContent = 'Public repositories will appear here soon.';
    return;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char];
    });
  }

  function fetchPage(page) {
    var username = encodeURIComponent(config.githubUsername);
    return fetch('https://api.github.com/users/' + username + '/repos?sort=updated&per_page=100&page=' + page)
      .then(function (response) { return response.ok ? response.json() : []; });
  }

  fetchPage(1)
    .then(function (first) {
      if (!Array.isArray(first)) first = [];
      if (first.length < 100) return first;
      return fetchPage(2).then(function (second) { return first.concat(Array.isArray(second) ? second : []); });
    })
    .then(function (repos) {
      var shown = repos
        .filter(function (repo) { return repo && !repo.fork && !repo.archived; })
        .sort(function (a, b) {
          return (b.stargazers_count - a.stargazers_count) ||
                 (new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0));
        })
        .slice(0, 9);

      if (status) {
        status.textContent = shown.length
          ? 'Live from @' + config.githubUsername + ' on GitHub — updated automatically.'
          : 'Public repositories are on the way — check back soon.';
      }
      if (!shown.length) return;

      grid.innerHTML = shown.map(function (repo) {
        return '<a class="repo-card" href="' + escapeHtml(repo.html_url) + '" target="_blank" rel="noopener">' +
          '<span>' + escapeHtml(repo.language || 'Code') + '</span>' +
          '<h2>' + escapeHtml(repo.name) + '</h2>' +
          '<p>' + escapeHtml(repo.description || 'A public ZENSTRO project.') + '</p>' +
          '<span class="repo-meta"><small>★ ' + Number(repo.stargazers_count || 0) + '</small><b aria-hidden="true">↗</b></span>' +
          '</a>';
      }).join('');
    })
    .catch(function () {
      if (status) status.textContent = 'GitHub is temporarily unreachable — please try again soon.';
    });
})();
