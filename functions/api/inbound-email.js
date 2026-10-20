/**
 * Cloudflare Pages Function: /api/inbound-email
 * Universal Inbound Email Gateway for ZENSTRO (*@zenstro.space)
 *
 * Handles:
 * 1. Resend Inbound Webhook (type: "email.received")
 * 2. Complete email extraction (Plain Text, HTML, Attachments, CC, BCC, Headers)
 * 3. On-Demand & Automated Sync with Resend Receiving API (GET /api/inbound-email?action=sync)
 * 4. List all received emails (GET /api/inbound-email?action=list)
 * 5. Secure attachment proxy & download (GET /api/inbound-email?action=attachment)
 * 6. Cloudflare KV persistent storage (zenstro_received_emails & zenstro_inquiries)
 * 7. Instant notification dispatch to ceo.shubhampathak@gmail.com
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'status';
  const resendApiKey = (env && env.RESEND_API_KEY) || '';

  // 1. ATTACHMENT PROXY DOWNLOAD
  if (action === 'attachment') {
    const emailId = url.searchParams.get('emailId');
    const attachmentId = url.searchParams.get('attachmentId');

    if (!emailId || !attachmentId) {
      return new Response(JSON.stringify({ error: 'Missing emailId or attachmentId' }), {
        status: 400,
        headers: CORS_HEADERS
      });
    }

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY is not configured in environment.' }), {
        status: 500,
        headers: CORS_HEADERS
      });
    }

    try {
      const attachRes = await fetch(
        `https://api.resend.com/emails/receiving/${emailId}/attachments/${attachmentId}`,
        {
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        }
      );

      if (!attachRes.ok) {
        return new Response(JSON.stringify({ error: `Resend attachment API error: ${attachRes.status}` }), {
          status: attachRes.status,
          headers: CORS_HEADERS
        });
      }

      const attachData = await attachRes.json();
      if (attachData.download_url) {
        return Response.redirect(attachData.download_url, 302);
      }

      return new Response(JSON.stringify(attachData), { status: 200, headers: CORS_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  }

  // 2. SYNC INBOUND EMAILS DIRECTLY FROM RESEND RECEIVING API
  if (action === 'sync' || action === 'sync_resend') {
    return await syncResendInbound(env);
  }

  // 3. LIST ALL RECEIVED EMAILS STORED IN KV
  if (action === 'list') {
    let emails = [];
    if (env && env.ZENSTRO_KV) {
      try {
        const rawRec = await env.ZENSTRO_KV.get('zenstro_received_emails');
        if (rawRec) emails = JSON.parse(rawRec);

        // Also merge any from zenstro_inquiries that are email_inbound
        const rawInq = await env.ZENSTRO_KV.get('zenstro_inquiries');
        if (rawInq) {
          const inqList = JSON.parse(rawInq).filter(i => i.source === 'email_inbound');
          const seen = new Set(emails.map(e => e.emailId || e.id));
          for (const item of inqList) {
            const key = item.emailId || item.id;
            if (!seen.has(key)) {
              seen.add(key);
              emails.push(item);
            }
          }
        }
      } catch (e) {}
    }

    // Sort newest first
    emails.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    return new Response(JSON.stringify({ success: true, count: emails.length, emails }), {
      status: 200,
      headers: CORS_HEADERS
    });
  }

  // 4. DEFAULT STATUS ENDPOINT
  let totalStored = 0;
  if (env && env.ZENSTRO_KV) {
    try {
      const rawRec = await env.ZENSTRO_KV.get('zenstro_received_emails');
      if (rawRec) totalStored = JSON.parse(rawRec).length;
    } catch (e) {}
  }

  return new Response(
    JSON.stringify({
      status: 'active',
      service: 'ZENSTRO Inbound Email Receiving Gateway',
      domain: 'zenstro.space',
      webhookUrl: 'https://zenstro.space/api/inbound-email',
      supportedEvents: ['email.received'],
      totalReceivedEmails: totalStored,
      endpoints: {
        sync: 'https://zenstro.space/api/inbound-email?action=sync',
        list: 'https://zenstro.space/api/inbound-email?action=list',
        attachment: 'https://zenstro.space/api/inbound-email?action=attachment&emailId={emailId}&attachmentId={attachmentId}'
      },
      message: 'Configure webhook URL https://zenstro.space/api/inbound-email in Resend -> Webhooks with event email.received.'
    }),
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const rawBody = await request.json();
    const resendApiKey = (env && env.RESEND_API_KEY) || '';
    const notificationEmail = (env && env.ADMIN_NOTIFICATION_EMAIL) || 'ceo.shubhampathak@gmail.com';

    // Check if this is an explicit manual sync trigger
    if (rawBody.action === 'sync' || rawBody.action === 'sync_resend') {
      return await syncResendInbound(env);
    }

    let emailId = null;
    let from = 'Unknown Sender';
    let to = 'ceo@zenstro.space';
    let cc = [];
    let bcc = [];
    let replyTo = null;
    let subject = 'Direct Email to zenstro.space';
    let message = '';
    let htmlContent = null;
    let attachments = [];
    let headers = {};
    let createdAt = new Date().toISOString();

    // 1. PARSE RESEND WEBHOOK (type: "email.received")
    if (rawBody.type === 'email.received' && rawBody.data) {
      const d = rawBody.data;
      emailId = d.email_id || d.id;
      if (d.from) from = d.from;
      if (Array.isArray(d.to) && d.to.length > 0) to = d.to[0];
      else if (d.to) to = String(d.to);
      if (Array.isArray(d.cc)) cc = d.cc;
      if (Array.isArray(d.bcc)) bcc = d.bcc;
      if (d.reply_to) replyTo = Array.isArray(d.reply_to) ? d.reply_to[0] : d.reply_to;
      if (d.subject) subject = d.subject;
      if (d.text) message = d.text;
      if (d.html) htmlContent = d.html;
      if (Array.isArray(d.attachments)) attachments = d.attachments;
      if (d.created_at) createdAt = d.created_at;
    } else if (rawBody.email_id || (rawBody.data && rawBody.data.email_id)) {
      emailId = rawBody.email_id || rawBody.data.email_id;
      from = rawBody.from || (rawBody.data && rawBody.data.from) || from;
      const rawTo = rawBody.to || (rawBody.data && rawBody.data.to);
      if (Array.isArray(rawTo) && rawTo.length > 0) to = rawTo[0];
      else if (rawTo) to = String(rawTo);
      subject = rawBody.subject || (rawBody.data && rawBody.data.subject) || subject;
      if (rawBody.created_at) createdAt = rawBody.created_at;
    } else {
      // Direct raw JSON payload (custom worker / test trigger)
      from = String(rawBody.from || rawBody.sender || from).trim();
      to = String(rawBody.to || rawBody.recipient || to).trim();
      subject = String(rawBody.subject || subject).trim();
      message = String(rawBody.text || rawBody.body || rawBody.message || '').trim();
      htmlContent = rawBody.html || null;
      if (Array.isArray(rawBody.attachments)) attachments = rawBody.attachments;
    }

    // 2. IF WE HAVE A RESEND EMAIL_ID, QUERY RESEND RECEIVING API FOR COMPLETE BODY & ATTACHMENTS
    if (emailId && resendApiKey) {
      try {
        const resendRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (resendRes.ok) {
          const detail = await resendRes.json();
          if (detail.from) from = detail.from;
          if (Array.isArray(detail.to) && detail.to.length > 0) to = detail.to[0];
          else if (detail.to) to = String(detail.to);
          if (Array.isArray(detail.cc)) cc = detail.cc;
          if (Array.isArray(detail.bcc)) bcc = detail.bcc;
          if (detail.reply_to) replyTo = Array.isArray(detail.reply_to) ? detail.reply_to[0] : detail.reply_to;
          if (detail.subject) subject = detail.subject;
          if (detail.text) message = detail.text;
          if (detail.html) htmlContent = detail.html;
          if (Array.isArray(detail.attachments) && detail.attachments.length > 0) {
            attachments = detail.attachments;
          }
          if (detail.headers) headers = detail.headers;
          if (detail.created_at) createdAt = detail.created_at;
        }
      } catch (fetchErr) {
        console.warn('Error fetching received email from Resend API:', fetchErr);
      }
    }

    // Fallback: If text message is empty but HTML exists, strip tags for preview
    if (!message && htmlContent) {
      message = htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!message) {
      message = '(No text content in received email)';
    }

    // 3. PARSE SENDER DETAILS
    let senderEmail = from;
    let senderName = from;
    const emailMatch = from.match(/<([^>]+)>/);
    if (emailMatch) {
      senderEmail = emailMatch[1];
      senderName = from.replace(/<[^>]+>/, '').trim() || senderEmail.split('@')[0];
    } else if (from.includes('@')) {
      senderName = from.split('@')[0];
    }

    // Format uniform attachment list
    const cleanAttachments = attachments.map(att => ({
      id: att.id || att.attachment_id || null,
      filename: att.filename || att.name || 'attachment',
      size: att.size || att.file_size || 0,
      contentType: att.content_type || att.contentType || 'application/octet-stream',
      downloadUrl: emailId && att.id ? `https://zenstro.space/api/inbound-email?action=attachment&emailId=${emailId}&attachmentId=${att.id}` : null
    }));

    const inboundItem = {
      id: 'inbound_' + (emailId ? emailId.replace(/-/g, '').slice(0, 14) : Date.now()),
      emailId: emailId || null,
      name: senderName,
      email: senderEmail,
      from: from,
      to: to,
      cc: cc,
      bcc: bcc,
      replyTo: replyTo,
      company: 'Direct Inbound Sender',
      topic: 'Direct Email to ' + to,
      source: 'email_inbound',
      recipientInbox: to,
      subject: subject,
      message: message,
      html: htmlContent,
      attachments: cleanAttachments,
      headers: headers,
      createdAt: createdAt,
      status: 'new',
      replies: []
    };

    // 4. SAVE INTO CLOUDFLARE KV (Both dedicated received list and unified inquiries)
    if (env && env.ZENSTRO_KV) {
      try {
        // A. Dedicated Received Emails Store
        const rawRec = await env.ZENSTRO_KV.get('zenstro_received_emails');
        let recList = rawRec ? JSON.parse(rawRec) : [];

        const existsInRec = recList.some(item =>
          item.id === inboundItem.id ||
          (emailId && item.emailId === emailId) ||
          (item.email === senderEmail && item.subject === subject && Math.abs(new Date(item.createdAt) - new Date(createdAt)) < 60000)
        );

        if (!existsInRec) {
          recList.unshift(inboundItem);
          if (recList.length > 1000) recList = recList.slice(0, 1000);
          await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
        }

        // B. Unified Inquiries Store
        const rawInq = await env.ZENSTRO_KV.get('zenstro_inquiries');
        let inqList = rawInq ? JSON.parse(rawInq) : [];

        const existsInInq = inqList.some(item =>
          item.id === inboundItem.id ||
          (emailId && item.emailId === emailId) ||
          (item.email === senderEmail && item.subject === subject && Math.abs(new Date(item.createdAt) - new Date(createdAt)) < 60000)
        );

        if (!existsInInq) {
          inqList.unshift(inboundItem);
          if (inqList.length > 1000) inqList = inqList.slice(0, 1000);
          await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(inqList));
        }
      } catch (kvErr) {
        console.error('KV write error in inbound-email:', kvErr);
      }
    }

    // 5. SEND INSTANT NOTIFICATION EMAIL TO CEO GMAIL VIA RESEND
    if (resendApiKey) {
      try {
        const attachmentSummary = cleanAttachments.length > 0
          ? `<p style="margin:8px 0 0; font-size:12px; color:#475569;">📎 <strong>${cleanAttachments.length} Attachment(s):</strong> ${cleanAttachments.map(a => escapeHtml(a.filename)).join(', ')}</p>`
          : '';

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'ZENSTRO Mail System <admin@zenstro.space>',
            to: [notificationEmail],
            subject: `[ZENSTRO Received] ${to}: ${subject}`,
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; max-width:620px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
                <div style="background:#0f172a; padding:22px 26px;">
                  <img src="https://zenstro.space/white_logo.png" alt="ZENSTRO" width="130" style="display:block; height:auto; margin-bottom:12px;">
                  <h3 style="color:#ffffff; margin:0; font-size:16px; font-weight:700;">Incoming Email Received on ${escapeHtml(to)}</h3>
                </div>
                <div style="padding:24px;">
                  <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:16px;">
                    <p style="margin:0 0 8px; font-size:13px; color:#334155;"><strong>From:</strong> ${escapeHtml(from)}</p>
                    <p style="margin:0 0 8px; font-size:13px; color:#334155;"><strong>To (Inbox):</strong> ${escapeHtml(to)}</p>
                    <p style="margin:0 0 8px; font-size:13px; color:#334155;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
                    <p style="margin:0; font-size:12px; color:#64748b;"><strong>Received:</strong> ${new Date(createdAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} IST</p>
                    ${attachmentSummary}
                  </div>

                  <div style="background:#ffffff; border:1px solid #e2e8f0; border-left:4px solid #2563eb; padding:16px; border-radius:4px; font-size:14px; line-height:1.6; color:#1e293b; white-space:pre-wrap; max-height:400px; overflow-y:auto;">${escapeHtml(message)}</div>

                  <div style="margin-top:24px; display:flex; gap:12px;">
                    <a href="https://zenstro.space/admin.html" style="display:inline-block; background:#2563eb; color:#ffffff; padding:10px 22px; border-radius:6px; font-weight:700; text-decoration:none; font-size:13px;">Open Received Email in Admin ↗</a>
                  </div>
                </div>
              </div>
            `,
            text: [
              `Hi Shubham,`,
              ``,
              `A new email was received on: ${to}`,
              ``,
              `From:    ${from}`,
              `Subject: ${subject}`,
              `Date:    ${new Date(createdAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} IST`,
              cleanAttachments.length > 0 ? `Attachments: ${cleanAttachments.map(a => a.filename).join(', ')}` : '',
              ``,
              `Message:`,
              message,
              ``,
              `View and reply directly from your Admin Console:`,
              `https://zenstro.space/admin.html`
            ].filter(Boolean).join('\n')
          })
        });
      } catch (alertErr) {
        console.warn('Alert dispatch failed:', alertErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, id: inboundItem.id, emailId: emailId }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * Universal Sync function: fetches all received emails from Resend Receiving API
 */
async function syncResendInbound(env) {
  const resendApiKey = (env && env.RESEND_API_KEY) || '';
  if (!resendApiKey) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY is not configured in environment.' }), {
      status: 500,
      headers: CORS_HEADERS
    });
  }

  try {
    const resList = await fetch('https://api.resend.com/emails/receiving', {
      headers: { 'Authorization': `Bearer ${resendApiKey}` }
    });

    if (!resList.ok) {
      return new Response(JSON.stringify({ error: `Resend API returned status ${resList.status}` }), {
        status: resList.status,
        headers: CORS_HEADERS
      });
    }

    const listData = await resList.json();
    const items = listData.data || [];

    let recList = [];
    let inqList = [];
    if (env && env.ZENSTRO_KV) {
      try {
        const rawRec = await env.ZENSTRO_KV.get('zenstro_received_emails');
        if (rawRec) recList = JSON.parse(rawRec);

        const rawInq = await env.ZENSTRO_KV.get('zenstro_inquiries');
        if (rawInq) inqList = JSON.parse(rawInq);
      } catch (e) {}
    }

    let addedCount = 0;

    for (const item of items) {
      const emailId = item.id;
      const alreadyExists = recList.some(r => r.emailId === emailId || r.id === 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 14));

      if (!alreadyExists) {
        let bodyText = '';
        let bodyHtml = null;
        let from = item.from || 'Unknown Sender';
        let to = Array.isArray(item.to) ? item.to[0] : (item.to || 'ceo@zenstro.space');
        let cc = Array.isArray(item.cc) ? item.cc : [];
        let bcc = Array.isArray(item.bcc) ? item.bcc : [];
        let replyTo = item.reply_to || null;
        let subject = item.subject || 'Direct Email';
        let createdAt = item.created_at || new Date().toISOString();
        let attachments = Array.isArray(item.attachments) ? item.attachments : [];
        let headers = {};

        try {
          const detailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
            headers: { 'Authorization': `Bearer ${resendApiKey}` }
          });
          if (detailRes.ok) {
            const detail = await detailRes.json();
            if (detail.from) from = detail.from;
            if (Array.isArray(detail.to) && detail.to.length > 0) to = detail.to[0];
            else if (detail.to) to = String(detail.to);
            if (Array.isArray(detail.cc)) cc = detail.cc;
            if (Array.isArray(detail.bcc)) bcc = detail.bcc;
            if (detail.reply_to) replyTo = Array.isArray(detail.reply_to) ? detail.reply_to[0] : detail.reply_to;
            if (detail.subject) subject = detail.subject;
            if (detail.text) bodyText = detail.text;
            if (detail.html) bodyHtml = detail.html;
            if (Array.isArray(detail.attachments) && detail.attachments.length > 0) {
              attachments = detail.attachments;
            }
            if (detail.headers) headers = detail.headers;
          }
        } catch (e) {}

        if (!bodyText && bodyHtml) {
          bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }
        if (!bodyText) bodyText = '(Empty message body)';

        let senderEmail = from;
        let senderName = from;
        const emailMatch = from.match(/<([^>]+)>/);
        if (emailMatch) {
          senderEmail = emailMatch[1];
          senderName = from.replace(/<[^>]+>/, '').trim() || senderEmail.split('@')[0];
        } else if (from.includes('@')) {
          senderName = from.split('@')[0];
        }

        const cleanAttachments = attachments.map(att => ({
          id: att.id || att.attachment_id || null,
          filename: att.filename || att.name || 'attachment',
          size: att.size || att.file_size || 0,
          contentType: att.content_type || att.contentType || 'application/octet-stream',
          downloadUrl: `https://zenstro.space/api/inbound-email?action=attachment&emailId=${emailId}&attachmentId=${att.id}`
        }));

        const newInbound = {
          id: 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 14),
          emailId: emailId,
          name: senderName,
          email: senderEmail,
          from: from,
          to: to,
          cc: cc,
          bcc: bcc,
          replyTo: replyTo,
          company: 'Direct Inbound Sender',
          topic: 'Direct Email to ' + to,
          source: 'email_inbound',
          recipientInbox: to,
          subject: subject,
          message: bodyText,
          html: bodyHtml,
          attachments: cleanAttachments,
          headers: headers,
          createdAt: createdAt,
          status: 'new',
          replies: []
        };

        recList.unshift(newInbound);
        inqList.unshift(newInbound);
        addedCount++;
      }
    }

    if (addedCount > 0 && env && env.ZENSTRO_KV) {
      if (recList.length > 1000) recList = recList.slice(0, 1000);
      if (inqList.length > 1000) inqList = inqList.slice(0, 1000);
      await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(inqList));
    }

    return new Response(
      JSON.stringify({
        success: true,
        addedCount,
        totalReceived: recList.length,
        emails: recList
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
