/**
 * ZENSTRO — Projects & Open Source
 * Dynamically loads and renders:
 * 1. Live Cloudflare Production Deployments & Web Applications
 * 2. Verified GitHub Profile & 42 Public Repositories (@ceo-shubham)
 * 3. Segmented Tab Navigation (#live and #github)
 * 4. Admin Panel customizations (visibility, descriptions, limits)
 */

(function () {
  'use strict';

  // DOM Elements - Tabs
  var tabBtnLive = document.getElementById('tab-btn-live');
  var tabBtnGithub = document.getElementById('tab-btn-github');
  var viewLive = document.getElementById('view-live');
  var viewGithub = document.getElementById('view-github');
  var badgeCfCount = document.getElementById('badge-cf-count');
  var badgeGhCount = document.getElementById('badge-gh-count');
  var switchToGithub = document.getElementById('switch-to-github');
  var switchToLive = document.getElementById('switch-to-live');

  // DOM Elements - Cloudflare Live
  var cfGrid = document.getElementById('cf-projects-grid');
  var cfStatus = document.getElementById('cf-status');

  // DOM Elements - GitHub
  var profileContainer = document.getElementById('gh-profile-banner');
  var repoGrid = document.getElementById('repo-grid');
  var repoStatus = document.getElementById('repo-status');
  var repoSearch = document.getElementById('repo-search-input');
  var filterTagsContainer = document.getElementById('repo-filter-tags');
  var btnShowMoreRepos = document.getElementById('btn-show-more-repos');

  var allFetchedRepos = [];
  var repoConfig = { githubMaxDisplay: 12, cloudflareMaxDisplay: 12, repoOverrides: {}, cfOverrides: {} };
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

  // Tab Switching
  function switchTab(targetTab) {
    var isLive = targetTab !== 'github';

    if (tabBtnLive) {
      tabBtnLive.classList.toggle('active', isLive);
      tabBtnLive.setAttribute('aria-selected', isLive ? 'true' : 'false');
    }
    if (tabBtnGithub) {
      tabBtnGithub.classList.toggle('active', !isLive);
      tabBtnGithub.setAttribute('aria-selected', !isLive ? 'true' : 'false');
    }

    if (viewLive) {
      viewLive.style.display = isLive ? 'block' : 'none';
      viewLive.classList.toggle('active', isLive);
    }
    if (viewGithub) {
      viewGithub.style.display = !isLive ? 'block' : 'none';
      viewGithub.classList.toggle('active', !isLive);
    }

    // Update URL hash smoothly without jump
    var targetHash = isLive ? '#live' : '#github';
    if (window.location.hash !== targetHash && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', targetHash);
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
            '<span><strong>' + Number(profile.public_repos || 42) + '+</strong> Public Repos</span>' +
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

    var limit = maxDisplay || 12;
    var displayed = filtered.slice(0, limit);

    if (badgeCfCount) {
      badgeCfCount.textContent = displayed.length + ' Live';
    }

    if (cfStatus) {
      cfStatus.textContent = displayed.length
        ? 'Showing ' + displayed.length + ' production applications running globally on Cloudflare Edge.'
        : 'Cloudflare deployments will appear here.';
    }

    if (!displayed.length) {
      cfGrid.innerHTML = '<div class="repo-empty" style="grid-column:1/-1; padding:32px; text-align:center;">No live deployments available right now.</div>';
      return;
    }

    var DEFAULT_CF_META = {
      'zenstro': {
        title: 'ZENSTRO — Digital Engineering Studio',
        desc: 'Official production platform for ZENSTRO. Deployed on Cloudflare Pages with Edge Workers, Cloudflare KV storage, and automated webhook routing.'
      },
      'typ': {
        title: 'TYP Platform — Client Portal & Automation',
        desc: 'Enterprise system and client workflow automation suite deployed on Cloudflare global edge infrastructure.'
      },
      'unoplay': {
        title: 'UnoPlay — Interactive Streaming & Media Platform',
        desc: 'Real-time media and entertainment engine powered by serverless Cloudflare Workers with ultra-low latency edge routing.'
      },
      'moplay': {
        title: 'MoPlay — Digital Entertainment Portal',
        desc: 'Next-generation entertainment portal and interactive delivery system deployed globally on Cloudflare edge infrastructure.'
      },
      'weplay': {
        title: 'WePlay — Multiplayer Interactive Space',
        desc: 'Collaborative real-time application suite featuring multi-route Anycast edge routing and instant responsiveness.'
      },
      'vyvia': {
        title: 'VYVIA — Ultra-Clean Digital Architecture',
        desc: 'Minimalist luxury web experience with performance-first engineering and serverless edge delivery.'
      },
      'coup-le': {
        title: 'Coup-le — Discovery & Connectivity Network',
        desc: 'Modern social connection and discovery engine deployed with high availability across 300+ edge locations.'
      },
      'typ-ans': {
        title: 'TYP Answers — Intelligent Knowledge Engine',
        desc: 'Automated query resolution and intelligent workflow assistant deployed on Cloudflare global serverless infrastructure.'
      }
    };

    cfGrid.innerHTML = displayed.map(function (p) {
      var ov = cfOverrides[p.name] || {};
      var defaultMeta = DEFAULT_CF_META[p.name] || {
        title: p.name.toUpperCase() + ' — Live Edge Deployment',
        desc: 'Production serverless application deployed and running globally on Cloudflare edge infrastructure.'
      };
      var title = ov.title || defaultMeta.title;
      var desc = ov.description || defaultMeta.desc;
      var liveUrl = p.primary_url || ('https://' + (p.domains[0] || p.subdomain));
      var cleanDomain = liveUrl.replace(/^https?:\/\//, '');
      var techLabel = p.type === 'worker' ? 'Cloudflare Worker' : 'Cloudflare Pages';

      return '<div class="cf-project-card">' +
        '<div class="cf-card-header">' +
          '<div class="cf-badge-row">' +
            '<span class="cf-live-badge"><span class="pulse-dot"></span> Live Production</span>' +
            '<span class="cf-tech-tag">' + escapeHtml(techLabel) + '</span>' +
          '</div>' +
          '<span class="cf-edge-status">Anycast Edge</span>' +
        '</div>' +
        '<h3 class="cf-project-title">' +
          '<a href="' + escapeHtml(liveUrl) + '" target="_blank" rel="noopener">' + escapeHtml(title) + '</a>' +
        '</h3>' +
        '<p class="cf-project-desc">' + escapeHtml(desc) + '</p>' +
        '<div class="cf-card-footer">' +
          '<a href="' + escapeHtml(liveUrl) + '" target="_blank" rel="noopener" class="cf-launch-btn">' +
            '<span>Visit Live Application</span>' +
            '<span class="cf-launch-arrow" aria-hidden="true">↗</span>' +
          '</a>' +
          '<a href="' + escapeHtml(liveUrl) + '" target="_blank" rel="noopener" class="cf-domain-pill" title="Open ' + escapeHtml(cleanDomain) + '">' +
            '<code>' + escapeHtml(cleanDomain) + '</code>' +
          '</a>' +
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

    if (badgeGhCount) {
      badgeGhCount.textContent = (allFetchedRepos.length || 42) + ' Repos';
    }

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
        '<h3 class="repo-card-title">' + escapeHtml(repo.name) + '</h3>' +
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
    // Setup tab clicks
    if (tabBtnLive) {
      tabBtnLive.addEventListener('click', function () { switchTab('live'); });
    }
    if (tabBtnGithub) {
      tabBtnGithub.addEventListener('click', function () { switchTab('github'); });
    }
    if (switchToGithub) {
      switchToGithub.addEventListener('click', function () { switchTab('github'); });
    }
    if (switchToLive) {
      switchToLive.addEventListener('click', function () { switchTab('live'); });
    }

    // Check initial hash (e.g. #github or #live)
    var hash = (window.location.hash || '').toLowerCase();
    if (hash === '#github' || hash === '#repos') {
      switchTab('github');
    } else {
      switchTab('live');
    }

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
        if (badgeGhCount) badgeGhCount.textContent = (allFetchedRepos.length || 42) + ' Repos';
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
            if (badgeGhCount) badgeGhCount.textContent = (allFetchedRepos.length || 42) + ' Repos';
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
