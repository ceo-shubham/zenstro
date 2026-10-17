/**
 * ZENSTRO — Projects & Open Source
 * Dynamically loads and renders:
 * 1. Verified GitHub Profile & Public Repositories (@ceo-shubham)
 * 2. Live Cloudflare Production Deployments & Systems
 * 3. Incorporates Admin Panel customizations (visibility, 2-line descriptions, display limits)
 */

(function () {
  'use strict';

  var profileContainer = document.getElementById('gh-profile-banner');
  var cfGrid = document.getElementById('cf-projects-grid');
  var cfStatus = document.getElementById('cf-status');
  var repoGrid = document.getElementById('repo-grid');
  var repoStatus = document.getElementById('repo-status');
  var repoSearch = document.getElementById('repo-search-input');
  var filterTagsContainer = document.getElementById('repo-filter-tags');
  var btnShowMoreRepos = document.getElementById('btn-show-more-repos');

  var allFetchedRepos = [];
  var repoConfig = { githubMaxDisplay: 12, cloudflareMaxDisplay: 8, repoOverrides: {}, cfOverrides: {} };
  var currentLanguageFilter = 'ALL';
  var showAllRepos = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char];
    });
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      var d = new Date(isoStr);
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  // Render GitHub Profile Banner
  function renderProfile(profile) {
    if (!profileContainer || !profile) return;
    profileContainer.innerHTML = 
      '<div class="gh-profile-inner">' +
        '<div class="gh-profile-avatar-wrap">' +
          '<img src="' + escapeHtml(profile.avatar_url || 'https://github.com/ceo-shubham.png') + '" alt="' + escapeHtml(profile.name || 'Shubham Pathak') + '" class="gh-profile-avatar" width="76" height="76">' +
          '<span class="gh-verified-badge" title="Verified GitHub Developer">✓</span>' +
        '</div>' +
        '<div class="gh-profile-info">' +
          '<div class="gh-profile-name-row">' +
            '<h3>' + escapeHtml(profile.name || 'Shubham Pathak') + '</h3>' +
            '<span class="gh-handle">@' + escapeHtml(profile.login || 'ceo-shubham') + '</span>' +
            '<span class="gh-status-badge">● Open Source Architect</span>' +
          '</div>' +
          '<p class="gh-profile-bio">' + escapeHtml(profile.bio || 'Founder & Lead Systems Architect at ZENSTRO. Building performant software, AI automation, and scalable cloud workflows.') + '</p>' +
          '<div class="gh-profile-stats">' +
            '<span><strong>' + Number(profile.public_repos || 41) + '+</strong> Public Repos</span>' +
            '<span>•</span>' +
            '<span><strong>Edge &amp; Cloud</strong> Systems</span>' +
            '<span>•</span>' +
            '<span><strong>Full-Stack</strong> Architecture</span>' +
          '</div>' +
        '</div>' +
        '<div class="gh-profile-action">' +
          '<a href="' + escapeHtml(profile.html_url || 'https://github.com/ceo-shubham') + '" target="_blank" rel="noopener" class="btn btn-solid" style="padding:10px 18px; font-size:12px;">' +
            'Follow on GitHub <span aria-hidden="true">↗</span>' +
          '</a>' +
        '</div>' +
      '</div>';
  }

  // Render Cloudflare Live Projects
  function renderCloudflareProjects(projects, cfOverrides, maxDisplay) {
    if (!cfGrid) return;

    var filtered = (projects || []).filter(function (p) {
      var ov = cfOverrides[p.name] || {};
      return !ov.hidden;
    });

    var limit = maxDisplay || 8;
    var displayed = filtered.slice(0, limit);

    if (cfStatus) {
      cfStatus.textContent = displayed.length
        ? 'Active edge deployments loaded from Cloudflare Pages API.'
        : 'Cloudflare deployments will appear here.';
    }

    if (!displayed.length) {
      cfGrid.innerHTML = '<div class="repo-empty" style="grid-column:1/-1; padding:24px; text-align:center;">No live deployments available right now.</div>';
      return;
    }

    cfGrid.innerHTML = displayed.map(function (p) {
      var ov = cfOverrides[p.name] || {};
      var title = ov.title || (p.name === 'zenstro' ? 'ZENSTRO — Digital Engineering Studio' : (p.name === 'typ' ? 'TYP Platform — Client Portal & Automation' : p.name.toUpperCase()));
      var desc = ov.description || (p.name === 'zenstro' 
        ? 'Official production platform for ZENSTRO. Deployed on Cloudflare Pages with Edge Workers, Cloudflare KV storage, and automated webhook routing.'
        : 'Enterprise system and client workflow automation suite deployed on Cloudflare global edge infrastructure.');
      var liveUrl = p.primary_url || ('https://' + (p.domains[0] || p.subdomain));

      return '<div class="cf-project-card">' +
        '<div class="cf-card-header">' +
          '<div class="cf-badge-row">' +
            '<span class="cf-live-badge"><span class="pulse-dot"></span> Live Edge System</span>' +
            '<span class="cf-tech-tag">Cloudflare Pages</span>' +
          '</div>' +
          '<a href="' + escapeHtml(liveUrl) + '" target="_blank" rel="noopener" class="cf-external-link" title="Open live project">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
          '</a>' +
        '</div>' +
        '<h3 class="cf-project-title">' +
          '<a href="' + escapeHtml(liveUrl) + '" target="_blank" rel="noopener">' + escapeHtml(title) + '</a>' +
        '</h3>' +
        '<p class="cf-project-desc">' + escapeHtml(desc) + '</p>' +
        '<div class="cf-card-footer">' +
          '<a href="' + escapeHtml(liveUrl) + '" target="_blank" rel="noopener" class="cf-domain-pill">' +
            '<code>' + escapeHtml(liveUrl.replace(/^https?:\/\//, '')) + '</code>' +
          '</a>' +
          '<span class="cf-global-anycast" title="Deployed across 300+ edge cities">Global CDN · KV Active</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Render Repos Grid
  function renderRepos() {
    if (!repoGrid) return;

    var query = (repoSearch && repoSearch.value || '').toLowerCase().trim();
    var repoOverrides = repoConfig.repoOverrides || {};
    var maxDisplay = repoConfig.githubMaxDisplay || 12;

    var filtered = allFetchedRepos.filter(function (repo) {
      var ov = repoOverrides[repo.name] || {};
      if (ov.hidden) return false;

      if (currentLanguageFilter !== 'ALL') {
        if ((repo.language || 'Other').toUpperCase() !== currentLanguageFilter) return false;
      }

      if (query) {
        var matchName = (repo.name || '').toLowerCase().includes(query);
        var matchDesc = (ov.description || repo.description || '').toLowerCase().includes(query);
        var matchLang = (repo.language || '').toLowerCase().includes(query);
        if (!matchName && !matchDesc && !matchLang) return false;
      }

      return true;
    });

    var totalMatches = filtered.length;
    var displayed = showAllRepos ? filtered : filtered.slice(0, maxDisplay);

    if (repoStatus) {
      repoStatus.textContent = displayed.length
        ? 'Showing ' + displayed.length + ' of ' + totalMatches + ' public repositories from @ceo-shubham.'
        : 'No repositories found matching your filter.';
    }

    if (btnShowMoreRepos) {
      if (!showAllRepos && totalMatches > maxDisplay) {
        btnShowMoreRepos.style.display = 'inline-flex';
        btnShowMoreRepos.textContent = 'View All Repositories (' + totalMatches + ') ↗';
      } else {
        btnShowMoreRepos.style.display = 'none';
      }
    }

    if (!displayed.length) {
      repoGrid.innerHTML = '<div class="repo-empty" style="grid-column:1/-1; padding:32px; text-align:center;">No repositories match your search or filter. Try a different keyword.</div>';
      return;
    }

    repoGrid.innerHTML = displayed.map(function (repo) {
      var ov = repoOverrides[repo.name] || {};
      var customDesc = ov.description || repo.description || 'Public open-source repository developed and maintained by ZENSTRO.';

      return '<a class="repo-card" href="' + escapeHtml(repo.html_url) + '" target="_blank" rel="noopener">' +
        '<div class="repo-card-top">' +
          '<span class="repo-lang-badge">' + escapeHtml(repo.language || 'Code') + '</span>' +
          '<span class="repo-star-count" title="Stars count">★ ' + Number(repo.stars || 0) + '</span>' +
        '</div>' +
        '<h2 class="repo-card-title">' + escapeHtml(repo.name) + '</h2>' +
        '<p class="repo-card-desc">' + escapeHtml(customDesc) + '</p>' +
        '<div class="repo-meta">' +
          '<small>' + (repo.updated_at ? ('Updated ' + formatDate(repo.updated_at)) : 'Active') + '</small>' +
          '<span class="repo-card-arrow" aria-hidden="true">↗</span>' +
        '</div>' +
      '</a>';
    }).join('');
  }

  // Populate dynamic language filter tags
  function setupLanguageFilters(repos) {
    if (!filterTagsContainer) return;
    var counts = { ALL: repos.length };
    repos.forEach(function (r) {
      var lang = (r.language || 'Other').toUpperCase();
      counts[lang] = (counts[lang] || 0) + 1;
    });

    var popularLangs = Object.keys(counts)
      .filter(function (l) { return l === 'ALL' || counts[l] >= 2; })
      .sort(function (a, b) { return counts[b] - counts[a]; })
      .slice(0, 6);

    filterTagsContainer.innerHTML = popularLangs.map(function (lang) {
      var activeClass = lang === currentLanguageFilter ? ' active' : '';
      return '<button type="button" class="repo-filter-btn' + activeClass + '" data-lang="' + escapeHtml(lang) + '">' +
        escapeHtml(lang) + ' (' + counts[lang] + ')' +
      '</button>';
    }).join('');

    filterTagsContainer.querySelectorAll('.repo-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        currentLanguageFilter = btn.dataset.lang;
        filterTagsContainer.querySelectorAll('.repo-filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        renderRepos();
      });
    });
  }

  // Main Initializer
  function init() {
    if (repoStatus) repoStatus.textContent = 'Loading public repositories and deployments…';

    fetch('/api/projects')
      .then(function (res) {
        if (!res.ok) throw new Error('API status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data.config) repoConfig = Object.assign({}, repoConfig, data.config);
        if (data.githubProfile) renderProfile(data.githubProfile);
        if (data.cloudflareProjects) renderCloudflareProjects(data.cloudflareProjects, repoConfig.cfOverrides || {}, repoConfig.cloudflareMaxDisplay);

        allFetchedRepos = data.githubRepos || [];
        setupLanguageFilters(allFetchedRepos);
        renderRepos();
      })
      .catch(function (err) {
        console.warn('API fetch failed, falling back to direct GitHub fetch:', err);
        // Fallback: Direct GitHub API
        var username = 'ceo-shubham';
        fetch('https://api.github.com/users/' + username + '/repos?sort=updated&per_page=100')
          .then(function (res) { return res.json(); })
          .then(function (repos) {
            allFetchedRepos = (repos || []).filter(function (r) { return !r.fork && !r.private && !r.archived; });
            setupLanguageFilters(allFetchedRepos);
            renderRepos();
          })
          .catch(function () {
            if (repoStatus) repoStatus.textContent = 'GitHub is temporarily unreachable. Please try again soon.';
          });
      });

    if (repoSearch) {
      repoSearch.addEventListener('input', renderRepos);
    }

    if (btnShowMoreRepos) {
      btnShowMoreRepos.addEventListener('click', function () {
        showAllRepos = true;
        renderRepos();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
