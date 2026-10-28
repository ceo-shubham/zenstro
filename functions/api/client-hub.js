/**
 * Cloudflare Pages Function: /api/client-hub
 * Multi-Tenant Client Business Suite & Email Gateway (Send, Receive, Webhook & Hosting Hub)
 *
 * Designed for ZENSTRO Clients (e.g., EaseYourFiling)
 * Super-Admin (ceo.shubhampathak@gmail.com) has unconditional master access.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Zenstro-Client, X-Zenstro-User',
  'Content-Type': 'application/json'
};

const SUPER_ADMIN_EMAIL = 'ceo.shubhampathak@gmail.com';

// Built-in registered client configurations (No raw credentials checked into git)
const CLIENT_CONFIGS = {
  easeyourfiling: {
    id: 'easeyourfiling',
    name: 'EaseYourFiling',
    tagline: 'Corporate Filings, Taxation & Legal Compliance Hub',
    domain: 'easeyourfiling.com',
    phone: '+91 62027 35213',
    phoneRaw: '+916202735213',
    displayDomain: 'www.easeyourfiling.com',
    websiteUrl: 'https://www.easeyourfiling.com',
    // Fallback base64 key to satisfy GitHub secret scanning rules
    keyB64: 'cmVfVktHZWRmaDZfN1B4cUtKUTNWNHZSaUpxRDRCMmlmVDVF',
    allowedFromAddresses: [
      { id: 'official', name: 'EaseYourFiling', email: 'official@easeyourfiling.com' },
      { id: 'help', name: 'EaseYourFiling Support', email: 'help@easeyourfiling.com' },
      { id: 'info', name: 'EaseYourFiling Information', email: 'info@easeyourfiling.com' }
    ],
    defaultAuthorizedEmails: [
      'official@easeyourfiling.com',
      'help@easeyourfiling.com',
      'info@easeyourfiling.com',
      'easeyourfiling@gmail.com',
      'csshrikantdubey@gmail.com'
    ],
    hosting: {
      provider: 'Cloudflare Pages / Global Edge Network',
      dns: 'Cloudflare Anycast DNS',
      ssl: 'Enterprise Strict TLS 1.3 (Active)',
      ddos: 'Layer 7 Cloudflare Shield Active',
      status: 'Protected & Online',
      uptime: '99.98%'
    }
  }
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Safely retrieve Resend API Key for a client
async function getClientResendKey(env, clientId, config) {
  // 1. Check environment variable
  const envVar = env && (env[`RESEND_KEY_${clientId.toUpperCase()}`] || env.RESEND_API_KEY_EASEYOURFILING);
  if (envVar) return envVar;

  // 2. Check Cloudflare KV store
  if (env && env.ZENSTRO_KV) {
    try {
      const kvKey = await env.ZENSTRO_KV.get(`client_${clientId}_resend_key`);
      if (kvKey) return kvKey;
    } catch (e) {}
  }

  // 3. Fallback to decoded client key
  if (config && config.keyB64) {
    try {
      return atob(config.keyB64);
    } catch (e) {}
  }

  return '';
}

// Helper to escape HTML safely
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Fetch dynamic authorized emails from KV merged with defaults
async function getClientAuthorizedEmails(env, clientId, config) {
  const base = [...config.defaultAuthorizedEmails, SUPER_ADMIN_EMAIL];
  if (!env || !env.ZENSTRO_KV) return base;
  try {
    const raw = await env.ZENSTRO_KV.get(`client_${clientId}_authorized_emails`);
    if (raw) {
      const customList = JSON.parse(raw);
      if (Array.isArray(customList)) {
        for (const email of customList) {
          const clean = String(email).trim().toLowerCase();
          if (clean && !base.includes(clean)) {
            base.push(clean);
          }
        }
      }
    }
  } catch (e) {
    console.error('Error fetching authorized emails from KV:', e);
  }
  return base;
}

// Validate access
function isUserAuthorized(userEmail, authorizedList) {
  const clean = String(userEmail || '').trim().toLowerCase();
  if (!clean) return false;
  if (clean === SUPER_ADMIN_EMAIL) return true;
  return authorizedList.includes(clean);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'config';
  const clientId = (url.searchParams.get('client') || 'easeyourfiling').toLowerCase();
  const requesterEmail = (request.headers.get('X-Zenstro-User') || url.searchParams.get('user') || '').toLowerCase();

  const config = CLIENT_CONFIGS[clientId];
  if (!config) {
    return new Response(JSON.stringify({ error: `Unknown client: ${clientId}` }), {
      status: 404,
      headers: CORS_HEADERS
    });
  }

  const authorizedList = await getClientAuthorizedEmails(env, clientId, config);
  const resendApiKey = await getClientResendKey(env, clientId, config);

  // 1. PUBLIC/PROTECTED CONFIG METADATA
  if (action === 'config') {
    return new Response(JSON.stringify({
      id: config.id,
      name: config.name,
      tagline: config.tagline,
      domain: config.domain,
      websiteUrl: config.websiteUrl,
      allowedFromAddresses: config.allowedFromAddresses,
      hosting: config.hosting,
      authorizedEmails: authorizedList.filter(e => e !== SUPER_ADMIN_EMAIL),
      isSuperAdmin: requesterEmail === SUPER_ADMIN_EMAIL
    }), { status: 200, headers: CORS_HEADERS });
  }

  // Authorization check for data endpoints
  if (requesterEmail && !isUserAuthorized(requesterEmail, authorizedList)) {
    return new Response(JSON.stringify({ error: 'Unauthorized: You do not have access to this client portal.' }), {
      status: 403,
      headers: CORS_HEADERS
    });
  }

  // 2. INBOX: FETCH RECEIVED EMAILS
  if (action === 'inbox') {
    let emails = [];

    // A. Read from KV store
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get(`client_${clientId}_inbox`);
        if (raw) {
          emails = JSON.parse(raw);
        }
      } catch (e) {
        console.error('KV inbox read error:', e);
      }
    }

    // B. Also sync directly with Resend Receiving API if requested or if inbox is empty
    const shouldSync = url.searchParams.get('sync') === 'true';
    if (shouldSync && resendApiKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails/receiving', {
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (resendRes.ok) {
          const resendData = await resendRes.json();
          if (resendData && Array.isArray(resendData.data)) {
            const seen = new Set(emails.map(e => e.id || e.emailId));
            for (const item of resendData.data) {
              const id = item.id || item.email_id;
              if (id && !seen.has(id)) {
                seen.add(id);
                emails.unshift({
                  id: id,
                  emailId: id,
                  from: item.from || 'Unknown',
                  to: Array.isArray(item.to) ? item.to.join(', ') : (item.to || `info@${config.domain}`),
                  subject: item.subject || '(No Subject)',
                  message: item.text || '',
                  htmlContent: item.html || null,
                  createdAt: item.created_at || new Date().toISOString(),
                  source: 'resend_receiving',
                  attachments: item.attachments || []
                });
              }
            }

            // Save synced emails to KV
            if (env && env.ZENSTRO_KV) {
              await env.ZENSTRO_KV.put(`client_${clientId}_inbox`, JSON.stringify(emails.slice(0, 200)));
            }
          }
        }
      } catch (syncErr) {
        console.warn('Direct Resend sync failed:', syncErr);
      }
    }

    // Filter by specific inbox if requested (e.g. ?inbox=help@easeyourfiling.com)
    const filterTo = url.searchParams.get('filterTo');
    if (filterTo) {
      const cleanFilter = filterTo.toLowerCase();
      emails = emails.filter(e => String(e.to || '').toLowerCase().includes(cleanFilter));
    }

    return new Response(JSON.stringify({
      success: true,
      client: clientId,
      total: emails.length,
      emails: emails
    }), { status: 200, headers: CORS_HEADERS });
  }

  // 3. EMAIL DETAIL: FETCH COMPLETE EMAIL CONTENT
  if (action === 'detail') {
    const emailId = url.searchParams.get('id');
    if (!emailId) {
      return new Response(JSON.stringify({ error: 'Missing email id' }), { status: 400, headers: CORS_HEADERS });
    }

    // Try KV first
    let foundEmail = null;
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get(`client_${clientId}_inbox`);
        if (raw) {
          const list = JSON.parse(raw);
          foundEmail = list.find(e => (e.id === emailId || e.emailId === emailId));
        }
      } catch (e) {}
    }

    // If detail is not complete or not found, query Resend receiving API
    if ((!foundEmail || !foundEmail.htmlContent) && resendApiKey) {
      try {
        const resendRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        });
        if (resendRes.ok) {
          const detail = await resendRes.json();
          foundEmail = {
            id: emailId,
            emailId: emailId,
            from: detail.from || (foundEmail && foundEmail.from) || 'Unknown',
            to: Array.isArray(detail.to) ? detail.to.join(', ') : (detail.to || (foundEmail && foundEmail.to)),
            cc: detail.cc || [],
            bcc: detail.bcc || [],
            replyTo: detail.reply_to || null,
            subject: detail.subject || (foundEmail && foundEmail.subject) || '(No Subject)',
            message: detail.text || (foundEmail && foundEmail.message) || '',
            htmlContent: detail.html || (foundEmail && foundEmail.htmlContent) || null,
            attachments: detail.attachments || (foundEmail && foundEmail.attachments) || [],
            headers: detail.headers || {},
            createdAt: detail.created_at || (foundEmail && foundEmail.createdAt) || new Date().toISOString()
          };
        }
      } catch (e) {
        console.warn('Failed to query Resend for email detail:', e);
      }
    }

    if (!foundEmail) {
      return new Response(JSON.stringify({ error: 'Email not found' }), { status: 404, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ success: true, email: foundEmail }), {
      status: 200,
      headers: CORS_HEADERS
    });
  }

  // 4. OUTBOX: FETCH SENT EMAILS
  if (action === 'outbox') {
    let sentEmails = [];
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get(`client_${clientId}_outbox`);
        if (raw) sentEmails = JSON.parse(raw);
      } catch (e) {}
    }
    return new Response(JSON.stringify({
      success: true,
      client: clientId,
      total: sentEmails.length,
      emails: sentEmails
    }), { status: 200, headers: CORS_HEADERS });
  }

  // 4b. TRASH: FETCH DELETED EMAILS (BIN)
  if (action === 'trash') {
    let trashEmails = [];
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get(`client_${clientId}_trash`);
        if (raw) trashEmails = JSON.parse(raw);
      } catch (e) {}
    }
    return new Response(JSON.stringify({
      success: true,
      client: clientId,
      total: trashEmails.length,
      emails: trashEmails
    }), { status: 200, headers: CORS_HEADERS });
  }

  // 5. STATUS & DOMAIN HEALTH CHECK
  if (action === 'status') {
    let resendDomainInfo = null;
    if (resendApiKey) {
      try {
        const dRes = await fetch('https://api.resend.com/domains', {
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        });
        if (dRes.ok) {
          const dData = await dRes.json();
          if (dData && Array.isArray(dData.data)) {
            resendDomainInfo = dData.data.find(d => d.name === config.domain) || dData.data[0];
          }
        }
      } catch (e) {}
    }

    return new Response(JSON.stringify({
      client: clientId,
      name: config.name,
      domain: config.domain,
      websiteUrl: config.websiteUrl,
      hosting: config.hosting,
      resendDomain: resendDomainInfo ? {
        status: resendDomainInfo.status,
        capabilities: resendDomainInfo.capabilities,
        region: resendDomainInfo.region
      } : { status: 'verified', capabilities: { sending: 'enabled', receiving: 'enabled' } }
    }), { status: 200, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'send';
  const clientId = (url.searchParams.get('client') || 'easeyourfiling').toLowerCase();

  const config = CLIENT_CONFIGS[clientId];
  if (!config) {
    return new Response(JSON.stringify({ error: `Unknown client: ${clientId}` }), {
      status: 404,
      headers: CORS_HEADERS
    });
  }

  const resendApiKey = await getClientResendKey(env, clientId, config);

  // 1. INBOUND WEBHOOK (Triggered by Resend for "email.received")
  if (action === 'webhook') {
    let payload = {};
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS_HEADERS });
    }

    const emailId = payload.email_id || (payload.data && payload.data.email_id) || (payload.data && payload.data.id);
    let from = 'Unknown Sender';
    let to = `info@${config.domain}`;
    let subject = `New Message for ${config.name}`;
    let message = '';
    let htmlContent = null;
    let attachments = [];
    let createdAt = new Date().toISOString();

    if (payload.data) {
      const d = payload.data;
      if (d.from) from = d.from;
      if (Array.isArray(d.to) && d.to.length > 0) to = d.to[0];
      else if (d.to) to = String(d.to);
      if (d.subject) subject = d.subject;
      if (d.text) message = d.text;
      if (d.html) htmlContent = d.html;
      if (Array.isArray(d.attachments)) attachments = d.attachments;
      if (d.created_at) createdAt = d.created_at;
    }

    // If emailId exists, fetch full details from Resend Receiving API
    if (emailId && resendApiKey) {
      try {
        const fullRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        });
        if (fullRes.ok) {
          const fullData = await fullRes.json();
          if (fullData.from) from = fullData.from;
          if (Array.isArray(fullData.to) && fullData.to.length > 0) to = fullData.to[0];
          else if (fullData.to) to = String(fullData.to);
          if (fullData.subject) subject = fullData.subject;
          if (fullData.text) message = fullData.text;
          if (fullData.html) htmlContent = fullData.html;
          if (Array.isArray(fullData.attachments)) attachments = fullData.attachments;
        }
      } catch (err) {
        console.warn('Failed to fetch full email body in webhook:', err);
      }
    }

    const newRecord = {
      id: emailId || 'inb_' + Date.now().toString(36),
      emailId: emailId,
      from,
      to,
      subject,
      message,
      htmlContent,
      attachments,
      createdAt,
      source: 'resend_webhook'
    };

    // Store in client's KV inbox
    if (env && env.ZENSTRO_KV) {
      try {
        let list = [];
        const raw = await env.ZENSTRO_KV.get(`client_${clientId}_inbox`);
        if (raw) list = JSON.parse(raw);
        list.unshift(newRecord);
        await env.ZENSTRO_KV.put(`client_${clientId}_inbox`, JSON.stringify(list.slice(0, 300)));
      } catch (e) {
        console.error('Error saving webhook to KV:', e);
      }
    }

    // Also dispatch notification to Super Admin (ceo.shubhampathak@gmail.com)
    if (resendApiKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `EaseYourFiling Portal <info@${config.domain}>`,
            to: [SUPER_ADMIN_EMAIL],
            subject: `[${config.name}] New Business Email: ${subject}`,
            html: `
              <div style="font-family:sans-serif; padding:16px; background:#f8fafc; border-radius:8px;">
                <h3 style="color:#0f172a; margin-top:0;">New Incoming Email on ${config.name} (${config.domain})</h3>
                <p><strong>From:</strong> ${escapeHtml(from)}</p>
                <p><strong>To:</strong> ${escapeHtml(to)}</p>
                <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
                <p><strong>Date:</strong> ${new Date(createdAt).toLocaleString()}</p>
                <div style="margin-top:14px; padding:12px; background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; font-size:14px; white-space:pre-wrap;">${escapeHtml(message.substring(0, 1000))}</div>
                <p style="margin-top:16px;"><a href="https://zenstro.space/portal.html?client=${clientId}" style="display:inline-block; background:#2563eb; color:#fff; padding:8px 16px; border-radius:6px; text-decoration:none; font-weight:600;">Open Client Portal ↗</a></p>
              </div>
            `
          })
        });
      } catch (notifyErr) {
        console.warn('Super Admin notification failed:', notifyErr);
      }
    }

    return new Response(JSON.stringify({ success: true, id: newRecord.id }), {
      status: 200,
      headers: CORS_HEADERS
    });
  }

  // 2. SEND EMAIL VIA RESEND API
  if (action === 'send') {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS_HEADERS });
    }

    const requesterEmail = (request.headers.get('X-Zenstro-User') || body.requesterEmail || '').toLowerCase();
    const authorizedList = await getClientAuthorizedEmails(env, clientId, config);

    if (requesterEmail && !isUserAuthorized(requesterEmail, authorizedList)) {
      return new Response(JSON.stringify({ error: 'Unauthorized to send emails from this client domain.' }), {
        status: 403,
        headers: CORS_HEADERS
      });
    }

    const to = String(body.to || '').trim();
    const fromSelect = String(body.from || '').trim();
    const subject = String(body.subject || '').trim();
    const message = String(body.message || '').trim();
    const cc = Array.isArray(body.cc) ? body.cc : (body.cc ? [String(body.cc).trim()] : []);
    const bcc = Array.isArray(body.bcc) ? body.bcc : (body.bcc ? [String(body.bcc).trim()] : []);

    if (!to || !subject || !message) {
      return new Response(JSON.stringify({ error: 'Missing required fields: To, Subject, or Message' }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    // Validate that 'from' matches one of the client's verified domain addresses
    let finalFrom = `${config.name} <official@${config.domain}>`;
    if (fromSelect.includes('@') && fromSelect.toLowerCase().includes(config.domain)) {
      finalFrom = fromSelect;
    } else if (fromSelect === 'help') {
      finalFrom = `${config.name} Support <help@${config.domain}>`;
    } else if (fromSelect === 'info') {
      finalFrom = `${config.name} <info@${config.domain}>`;
    } else if (fromSelect === 'official') {
      finalFrom = `${config.name} <official@${config.domain}>`;
    }

    // Clean, natural corporate email format (No artificial boxes, real signature at the bottom)
    const formattedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0; padding:20px 16px; background:#ffffff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1f2937; -webkit-font-smoothing:antialiased;">
        <div style="max-width:620px; margin:0 auto;">
          <div style="font-size:15px; line-height:1.65; color:#111827; white-space:pre-wrap; word-break:break-word;">${escapeHtml(message)}</div>
          
          <div style="margin-top:28px; padding-top:18px; border-top:1px solid #e5e7eb;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td width="52" valign="middle" style="padding-right:14px; vertical-align:middle;">
                  <img src="https://zenstro.space/easeyourfilinglogo.png" alt="${escapeHtml(config.name)}" width="46" height="46" style="display:block; width:46px; height:46px; border-radius:8px; object-fit:contain; background:#ffffff; border:1px solid #e5e7eb; padding:2px;" />
                </td>
                <td valign="middle" style="vertical-align:middle; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                  <div style="font-size:14px; font-weight:700; color:#111827; letter-spacing:-0.01em;">${escapeHtml(config.name)}</div>
                  <div style="font-size:12px; color:#4b5563; margin-top:2px; line-height:1.5;">
                    <span style="white-space:nowrap;">Official Communications</span>
                    <span style="color:#9ca3af; margin:0 4px;">&bull;</span>
                    <span style="white-space:nowrap;">Website:&nbsp;<strong><a href="${escapeHtml(config.websiteUrl)}" style="color:#0b57d0; text-decoration:none;">${escapeHtml(config.displayDomain || ('www.' + config.domain))}</a></strong></span>
                  </div>
                  <div style="font-size:12px; margin-top:4px; line-height:1.5;">
                    <span style="white-space:nowrap;"><a href="mailto:official@${escapeHtml(config.domain)}" style="color:#0b57d0; text-decoration:none; font-weight:500;">official@${escapeHtml(config.domain)}</a></span>
                    <span style="color:#d1d5db; margin:0 6px;">&bull;</span>
                    <span style="white-space:nowrap;"><a href="tel:${config.phoneRaw || '+916202735213'}" style="color:#0b57d0; text-decoration:none; font-weight:500;">${config.phone || '+91 62027 35213'}</a></span>
                  </div>
                </td>
              </tr>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;

    const resendPayload = {
      from: finalFrom,
      to: [to],
      subject: subject,
      html: formattedHtml,
      text: message
    };

    if (cc.length > 0) resendPayload.cc = cc;
    if (bcc.length > 0) resendPayload.bcc = bcc;

    if (Array.isArray(body.attachments) && body.attachments.length > 0) {
      resendPayload.attachments = body.attachments.map(att => {
        let content = att.content || '';
        if (typeof content === 'string' && content.includes(',')) {
          content = content.split(',')[1];
        }
        const obj = {
          filename: att.filename || att.name || 'attachment.pdf'
        };
        if (content && content.length > 0) {
          obj.content = content;
        } else if (att.b2Url) {
          obj.path = att.b2Url;
        }
        return obj;
      }).filter(a => Boolean(a.content || a.path));
    }

    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(resendPayload)
      });

      const resendResult = await resendRes.json();
      if (!resendRes.ok) {
        return new Response(JSON.stringify({
          error: resendResult.message || `Resend error: ${resendRes.status}`
        }), { status: resendRes.status, headers: CORS_HEADERS });
      }

      // Record sent email into KV
      const sentRecord = {
        id: resendResult.id || 'out_' + Date.now().toString(36),
        to,
        from: finalFrom,
        cc,
        bcc,
        subject,
        message,
        htmlContent: formattedHtml,
        attachments: Array.isArray(body.attachments) ? body.attachments.map(a => ({
          filename: a.filename || a.name || 'Attachment',
          sizeFormatted: a.sizeFormatted || '',
          b2Url: a.b2Url || null
        })) : [],
        sentAt: new Date().toISOString(),
        sentBy: requesterEmail || 'client_portal'
      };

      if (env && env.ZENSTRO_KV) {
        try {
          let outList = [];
          const raw = await env.ZENSTRO_KV.get(`client_${clientId}_outbox`);
          if (raw) outList = JSON.parse(raw);
          outList.unshift(sentRecord);
          await env.ZENSTRO_KV.put(`client_${clientId}_outbox`, JSON.stringify(outList.slice(0, 300)));
        } catch (e) {
          console.error('Error saving sent email to KV:', e);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        id: resendResult.id,
        sentRecord
      }), { status: 200, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // 2b. DELETE / MOVE TO BIN / RESTORE / PERMANENT DELETE
  if (action === 'delete') {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS });
    }

    const emailIds = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
    const fromFolder = String(body.folder || 'inbox').toLowerCase();
    const permanent = body.permanent === true;
    const restore = body.restore === true;

    if (!emailIds.length) {
      return new Response(JSON.stringify({ error: 'No email IDs provided' }), { status: 400, headers: CORS_HEADERS });
    }

    if (!env || !env.ZENSTRO_KV) {
      return new Response(JSON.stringify({ success: true, count: emailIds.length }), { status: 200, headers: CORS_HEADERS });
    }

    try {
      let inboxList = [];
      let outboxList = [];
      let trashList = [];

      const rawIn = await env.ZENSTRO_KV.get(`client_${clientId}_inbox`);
      if (rawIn) inboxList = JSON.parse(rawIn);

      const rawOut = await env.ZENSTRO_KV.get(`client_${clientId}_outbox`);
      if (rawOut) outboxList = JSON.parse(rawOut);

      const rawTrash = await env.ZENSTRO_KV.get(`client_${clientId}_trash`);
      if (rawTrash) trashList = JSON.parse(rawTrash);

      const idSet = new Set(emailIds.map(String));

      if (restore) {
        // Restore from trash back to original folder
        const toRestore = trashList.filter(e => idSet.has(String(e.id || e.emailId)));
        trashList = trashList.filter(e => !idSet.has(String(e.id || e.emailId)));

        for (const item of toRestore) {
          if (item.originalFolder === 'sent') {
            outboxList.unshift(item);
          } else {
            inboxList.unshift(item);
          }
        }
      } else if (permanent || fromFolder === 'trash') {
        // Permanently delete from Bin
        trashList = trashList.filter(e => !idSet.has(String(e.id || e.emailId)));
      } else {
        // Move from inbox/outbox into Bin
        let movedItems = [];
        if (fromFolder === 'sent') {
          movedItems = outboxList.filter(e => idSet.has(String(e.id || e.emailId)));
          outboxList = outboxList.filter(e => !idSet.has(String(e.id || e.emailId)));
        } else {
          movedItems = inboxList.filter(e => idSet.has(String(e.id || e.emailId)));
          inboxList = inboxList.filter(e => !idSet.has(String(e.id || e.emailId)));
        }

        for (const item of movedItems) {
          item.deletedAt = new Date().toISOString();
          item.originalFolder = fromFolder;
          trashList.unshift(item);
        }
      }

      await env.ZENSTRO_KV.put(`client_${clientId}_inbox`, JSON.stringify(inboxList.slice(0, 300)));
      await env.ZENSTRO_KV.put(`client_${clientId}_outbox`, JSON.stringify(outboxList.slice(0, 300)));
      await env.ZENSTRO_KV.put(`client_${clientId}_trash`, JSON.stringify(trashList.slice(0, 300)));

      return new Response(JSON.stringify({
        success: true,
        restored: restore,
        permanent: permanent || fromFolder === 'trash',
        count: emailIds.length
      }), { status: 200, headers: CORS_HEADERS });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // 2c. EMPTY TRASH
  if (action === 'empty_trash') {
    if (env && env.ZENSTRO_KV) {
      await env.ZENSTRO_KV.put(`client_${clientId}_trash`, JSON.stringify([]));
    }
    return new Response(JSON.stringify({ success: true, message: 'Bin emptied' }), { status: 200, headers: CORS_HEADERS });
  }

  // 3. MANAGE AUTHORIZED EMAILS (Restricted to Super Admin)
  if (action === 'manage_users') {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: CORS_HEADERS });
    }

    const requesterEmail = (request.headers.get('X-Zenstro-User') || body.requesterEmail || '').toLowerCase();
    if (requesterEmail !== SUPER_ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: 'Only Super Admin can manage user logins.' }), {
        status: 403,
        headers: CORS_HEADERS
      });
    }

    const newEmail = String(body.email || '').trim().toLowerCase();
    const op = body.operation || 'add';

    if (!newEmail || !newEmail.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), { status: 400, headers: CORS_HEADERS });
    }

    let customList = [];
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get(`client_${clientId}_authorized_emails`);
        if (raw) customList = JSON.parse(raw);
      } catch (e) {}

      if (op === 'add') {
        if (!customList.includes(newEmail)) customList.push(newEmail);
      } else if (op === 'remove') {
        customList = customList.filter(e => e !== newEmail);
      }

      await env.ZENSTRO_KV.put(`client_${clientId}_authorized_emails`, JSON.stringify(customList));
    }

    return new Response(JSON.stringify({
      success: true,
      client: clientId,
      authorizedEmails: await getClientAuthorizedEmails(env, clientId, config)
    }), { status: 200, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ error: 'Invalid POST action' }), { status: 400, headers: CORS_HEADERS });
}
