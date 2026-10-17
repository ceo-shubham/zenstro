/**
 * Cloudflare Pages Function: /api/projects
 * Dynamically fetches and manages:
 * 1. Public GitHub repositories and profile for @ceo-shubham
 * 2. Live Cloudflare Pages projects, deployments, and custom domains
 * 3. Supports Admin customization: show/hide toggles, 2-line descriptions, display count limits
 * 4. Caches at the Edge via Cloudflare KV for lightning fast sub-50ms responses
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const DEFAULT_CONFIG = {
  githubMaxDisplay: 12,
  cloudflareMaxDisplay: 12,
  repoOverrides: {},
  cfOverrides: {}
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Fetch GitHub Profile and Public Repos
async function fetchGitHubData(token) {
  const headers = {
    'User-Agent': 'ZENSTRO-Studio',
    'Accept': 'application/vnd.github.v3+json'
  };
  if (token) headers['Authorization'] = `token ${token}`;

  let profile = {
    login: 'ceo-shubham',
    name: 'Shubham Pathak',
    bio: 'Founder & Lead Systems Architect at ZENSTRO. Building high-performance web applications, AI automation, and cloud platforms.',
    avatar_url: 'https://github.com/ceo-shubham.png',
    html_url: 'https://github.com/ceo-shubham',
    public_repos: 41
  };

  try {
    const profRes = await fetch('https://api.github.com/users/ceo-shubham', { headers });
    if (profRes.ok) {
      profile = await profRes.json();
    }
  } catch (e) {
    console.warn('GitHub profile fetch error:', e);
  }

  let repos = [];
  try {
    const repoRes = await fetch('https://api.github.com/users/ceo-shubham/repos?sort=updated&per_page=100', { headers });
    if (repoRes.ok) {
      const allRepos = await repoRes.json();
      if (Array.isArray(allRepos)) {
        repos = allRepos
          .filter(r => !r.private && !r.fork && !r.archived)
          .map(r => ({
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            html_url: r.html_url,
            description: r.description || '',
            stars: r.stargazers_count || 0,
            forks: r.forks_count || 0,
            language: r.language || 'Code',
            updated_at: r.updated_at,
            created_at: r.created_at,
            homepage: r.homepage || ''
          }));
      }
    }
  } catch (e) {
    console.warn('GitHub repos fetch error:', e);
  }

  return { profile, repos };
}

// Fetch Cloudflare Pages Projects AND Cloudflare Workers Deployments
async function fetchCloudflareData(accountId, apiKey, email) {
  if (!accountId || !apiKey || !email) {
    return [];
  }

  const cfHeaders = {
    'User-Agent': 'ZENSTRO-Studio',
    'X-Auth-Email': email,
    'X-Auth-Key': apiKey,
    'Content-Type': 'application/json'
  };

  const results = [];

  // 1. Fetch Cloudflare Pages Projects
  try {
    const pagesRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
      headers: cfHeaders
    });

    if (pagesRes.ok) {
      const data = await pagesRes.json();
      if (data.success && Array.isArray(data.result)) {
        data.result.forEach(p => {
          const customDomains = (p.domains || []).filter(d => !d.endsWith('.pages.dev'));
          const primaryDomain = customDomains[0] || (p.domains && p.domains[0]) || p.subdomain;
          const primaryUrl = primaryDomain.startsWith('http') ? primaryDomain : `https://${primaryDomain}`;

          results.push({
            name: p.name,
            type: 'pages',
            subdomain: p.subdomain,
            domains: p.domains || [],
            primary_url: primaryUrl,
            status: p.canonical_deployment ? (p.canonical_deployment.latest_stage?.status === 'success' ? 'active' : 'deploying') : 'active',
            latest_deployment: p.canonical_deployment ? {
              url: p.canonical_deployment.url,
              created_on: p.canonical_deployment.created_on
            } : null,
            created_on: p.created_on
          });
        });
      }
    }
  } catch (e) {
    console.warn('Cloudflare Pages fetch error:', e);
  }

  // 2. Fetch Cloudflare Workers and Custom Worker Domains
  try {
    const [scriptsRes, domainsRes] = await Promise.all([
      fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, { headers: cfHeaders }),
      fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains`, { headers: cfHeaders })
    ]);

    let domainMap = {};
    if (domainsRes.ok) {
      const domData = await domainsRes.json();
      if (domData.success && Array.isArray(domData.result)) {
        domData.result.forEach(d => {
          if (!domainMap[d.service]) domainMap[d.service] = [];
          domainMap[d.service].push(d.hostname);
        });
      }
    }

    if (scriptsRes.ok) {
      const scData = await scriptsRes.json();
      if (scData.success && Array.isArray(scData.result)) {
        scData.result.forEach(s => {
          const workerDomains = domainMap[s.id] || [];
          const primaryHost = workerDomains[0] || `${s.id}.workers.dev`;
          const primaryUrl = primaryHost.startsWith('http') ? primaryHost : `https://${primaryHost}`;

          results.push({
            name: s.id,
            type: 'worker',
            subdomain: `${s.id}.workers.dev`,
            domains: workerDomains,
            primary_url: primaryUrl,
            status: 'active',
            created_on: s.created_on,
            modified_on: s.modified_on
          });
        });
      }
    }
  } catch (e) {
    console.warn('Cloudflare Workers fetch error:', e);
  }

  return results;
}

export async function onRequestGet(context) {
  const { env } = context;

  let config = DEFAULT_CONFIG;
  let cache = null;

  if (env && env.ZENSTRO_KV) {
    try {
      const rawCfg = await env.ZENSTRO_KV.get('zenstro_projects_config');
      if (rawCfg) config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(rawCfg));

      const rawCache = await env.ZENSTRO_KV.get('zenstro_projects_cache');
      if (rawCache) cache = JSON.parse(rawCache);
    } catch (e) {
      console.warn('KV read error:', e);
    }
  }

  // Check if cache is fresh (less than 15 minutes old)
  const isCacheFresh = cache && cache.lastSyncedAt && (Date.now() - new Date(cache.lastSyncedAt).getTime() < 15 * 60 * 1000);

  if (isCacheFresh) {
    return new Response(
      JSON.stringify({
        success: true,
        source: 'edge_cache',
        githubProfile: cache.githubProfile,
        githubRepos: cache.githubRepos,
        cloudflareProjects: cache.cloudflareProjects,
        config: config,
        lastSyncedAt: cache.lastSyncedAt
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  // Otherwise, refresh from Upstream APIs
  const ghToken = (env && env.GITHUB_TOKEN) || '';
  const cfAccountId = (env && env.CLOUDFLARE_ACCOUNT_ID) || '3c62fd7b101cb45266bcca6237c80f58';
  const cfKey = (env && env.CLOUDFLARE_API_KEY) || '';
  const cfEmail = (env && env.CLOUDFLARE_EMAIL) || 'ceo.shubhampathak@gmail.com';

  const [ghData, cfProjects] = await Promise.all([
    fetchGitHubData(ghToken),
    fetchCloudflareData(cfAccountId, cfKey, cfEmail)
  ]);

  const newCache = {
    githubProfile: ghData.profile,
    githubRepos: ghData.repos,
    cloudflareProjects: cfProjects,
    lastSyncedAt: new Date().toISOString()
  };

  if (env && env.ZENSTRO_KV) {
    try {
      await env.ZENSTRO_KV.put('zenstro_projects_cache', JSON.stringify(newCache), { expirationTtl: 86400 });
    } catch (e) {}
  }

  return new Response(
    JSON.stringify({
      success: true,
      source: 'live_synced',
      githubProfile: newCache.githubProfile,
      githubRepos: newCache.githubRepos,
      cloudflareProjects: newCache.cloudflareProjects,
      config: config,
      lastSyncedAt: newCache.lastSyncedAt
    }),
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const action = body.action || '';

    // 1. Save Config (Description overrides, visibility toggles, display limits)
    if (action === 'save_config') {
      const newConfig = {
        githubMaxDisplay: Number(body.githubMaxDisplay) || 12,
        cloudflareMaxDisplay: Number(body.cloudflareMaxDisplay) || 8,
        repoOverrides: body.repoOverrides || {},
        cfOverrides: body.cfOverrides || {}
      };

      if (env && env.ZENSTRO_KV) {
        await env.ZENSTRO_KV.put('zenstro_projects_config', JSON.stringify(newConfig));
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Settings saved successfully.', config: newConfig }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 2. Force Sync Fresh Data from GitHub and Cloudflare
    if (action === 'sync') {
      const ghToken = (env && env.GITHUB_TOKEN) || '';
      const cfAccountId = (env && env.CLOUDFLARE_ACCOUNT_ID) || '3c62fd7b101cb45266bcca6237c80f58';
      const cfKey = (env && env.CLOUDFLARE_API_KEY) || '';
      const cfEmail = (env && env.CLOUDFLARE_EMAIL) || 'ceo.shubhampathak@gmail.com';

      const [ghData, cfProjects] = await Promise.all([
        fetchGitHubData(ghToken),
        fetchCloudflareData(cfAccountId, cfKey, cfEmail)
      ]);

      const newCache = {
        githubProfile: ghData.profile,
        githubRepos: ghData.repos,
        cloudflareProjects: cfProjects,
        lastSyncedAt: new Date().toISOString()
      };

      let config = DEFAULT_CONFIG;
      if (env && env.ZENSTRO_KV) {
        await env.ZENSTRO_KV.put('zenstro_projects_cache', JSON.stringify(newCache), { expirationTtl: 86400 });
        const rawCfg = await env.ZENSTRO_KV.get('zenstro_projects_config');
        if (rawCfg) config = Object.assign({}, DEFAULT_CONFIG, JSON.parse(rawCfg));
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Synced fresh projects from GitHub and Cloudflare.',
          githubProfile: newCache.githubProfile,
          githubRepos: newCache.githubRepos,
          cloudflareProjects: newCache.cloudflareProjects,
          config: config,
          lastSyncedAt: newCache.lastSyncedAt
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action.' }),
      { status: 400, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
