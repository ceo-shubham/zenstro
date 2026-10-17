/**
 * Cloudflare Pages Function: /api/inbound-email
 * Receives incoming emails from Resend Inbound Webhook (email.received)
 * and Cloudflare Email Routing for:
 * - ceo@zenstro.space
 * - admin@zenstro.space
 * - support@zenstro.space
 * - help@zenstro.space
 *
 * Saves them into Cloudflare KV (ZENSTRO_KV) and alerts ceo.shubhampathak@gmail.com
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const RESEND_API_KEY_DEFAULT = '';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      status: 'active',
      service: 'ZENSTRO Inbound Email Webhook',
      domain: 'zenstro.space',
      webhookUrl: 'https://zenstro.space/api/inbound-email',
      supportedEvents: ['email.received'],
      message: 'Configure this URL in Resend Dashboard -> Webhooks -> Add Webhook with event "email.received".'
    }),
    { status: 200, headers: CORS_HEADERS }
  );
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const rawBody = await request.json();
    const resendApiKey = (env && env.RESEND_API_KEY) || RESEND_API_KEY_DEFAULT;
    const notificationEmail = (env && env.ADMIN_NOTIFICATION_EMAIL) || 'ceo.shubhampathak@gmail.com';

    let emailId = null;
    let from = 'Unknown Sender';
    let to = 'ceo@zenstro.space';
    let subject = 'Direct Email to zenstro.space';
    let message = '';
    let htmlContent = null;
    let createdAt = new Date().toISOString();

    // 1. Check if this is a Resend Webhook event (type: "email.received")
    if (rawBody.type === 'email.received' && rawBody.data) {
      emailId = rawBody.data.email_id || rawBody.data.id;
      from = rawBody.data.from || from;
      if (Array.isArray(rawBody.data.to) && rawBody.data.to.length > 0) {
        to = rawBody.data.to[0];
      } else if (rawBody.data.to) {
        to = String(rawBody.data.to);
      }
      subject = rawBody.data.subject || subject;
      if (rawBody.data.created_at) createdAt = rawBody.data.created_at;
    } else if (rawBody.email_id || (rawBody.data && rawBody.data.email_id)) {
      emailId = rawBody.email_id || rawBody.data.email_id;
      from = rawBody.from || (rawBody.data && rawBody.data.from) || from;
      const rawTo = rawBody.to || (rawBody.data && rawBody.data.to);
      if (Array.isArray(rawTo) && rawTo.length > 0) to = rawTo[0];
      else if (rawTo) to = String(rawTo);
      subject = rawBody.subject || (rawBody.data && rawBody.data.subject) || subject;
    } else {
      // Direct payload from custom worker or test trigger
      from = String(rawBody.from || rawBody.sender || from).trim();
      to = String(rawBody.to || rawBody.recipient || to).trim();
      subject = String(rawBody.subject || subject).trim();
      message = String(rawBody.text || rawBody.body || rawBody.message || '').trim();
      htmlContent = rawBody.html || null;
    }

    // 2. If we have a Resend emailId, fetch the full email body and details from Resend Received Emails API
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
          if (detail.subject) subject = detail.subject;
          if (detail.text) message = detail.text;
          else if (detail.html) {
            // Strip tags for plain text preview if text is absent
            message = detail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }
          if (detail.html) htmlContent = detail.html;
          if (detail.created_at) createdAt = detail.created_at;
        } else {
          console.warn(`Resend receiving lookup returned ${resendRes.status} for ${emailId}`);
        }
      } catch (fetchErr) {
        console.warn('Error fetching received email from Resend API:', fetchErr);
      }
    }

    if (!message) {
      message = rawBody.text || rawBody.message || '(Empty message body received)';
    }

    // 3. Extract sender display name and clean email
    let senderEmail = from;
    let senderName = from;
    const emailMatch = from.match(/<([^>]+)>/);
    if (emailMatch) {
      senderEmail = emailMatch[1];
      senderName = from.replace(/<[^>]+>/, '').trim() || senderEmail.split('@')[0];
    } else if (from.includes('@')) {
      senderName = from.split('@')[0];
    }

    const inboundItem = {
      id: 'inbound_' + (emailId ? emailId.replace(/-/g, '').slice(0, 12) : Date.now()),
      emailId: emailId || null,
      name: senderName,
      email: senderEmail,
      company: 'Direct Inbound Sender',
      topic: 'Direct Email to ' + to,
      source: 'email_inbound',
      recipientInbox: to,
      subject: subject,
      message: message,
      html: htmlContent,
      createdAt: createdAt,
      status: 'new',
      replies: []
    };

    // 4. Save into Cloudflare KV
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get('zenstro_inquiries');
        let list = raw ? JSON.parse(raw) : [];

        // Check deduplication by id or emailId
        const exists = list.some(item =>
          item.id === inboundItem.id ||
          (emailId && item.emailId === emailId) ||
          (item.email === senderEmail && item.subject === subject && Math.abs(new Date(item.createdAt) - new Date(createdAt)) < 60000)
        );

        if (!exists) {
          list.unshift(inboundItem);
          if (list.length > 500) list = list.slice(0, 500);
          await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
        }
      } catch (kvErr) {
        console.error('KV write error in inbound-email:', kvErr);
      }
    }

    // 5. Send automated notification alert to CEO Gmail via Resend
    if (resendApiKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'ZENSTRO Inbound Alert <admin@zenstro.space>',
            to: [notificationEmail],
            subject: `[ZENSTRO Inbound] ${to}: ${subject}`,
            html: `
              <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; max-width:620px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
                <div style="background:#0f172a; padding:20px 24px;">
                  <img src="https://zenstro.space/white_logo.png" alt="ZENSTRO" width="130" style="display:block; height:auto; margin-bottom:12px;">
                  <h3 style="color:#ffffff; margin:0; font-size:16px; font-weight:700;">Incoming Email Received on ${escapeHtml(to)}</h3>
                </div>
                <div style="padding:24px;">
                  <p style="margin:0 0 16px; font-size:13px; color:#64748b;">
                    <strong>From:</strong> ${escapeHtml(from)}<br>
                    <strong>Subject:</strong> ${escapeHtml(subject)}<br>
                    <strong>Received At:</strong> ${new Date(createdAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} IST
                  </p>
                  <div style="background:#f8fafc; border-left:4px solid #2563eb; padding:16px; border-radius:4px; font-size:14px; line-height:1.6; color:#1e293b; white-space:pre-wrap;">${escapeHtml(message)}</div>
                  <div style="margin-top:24px;">
                    <a href="https://zenstro.space/admin.html" style="display:inline-block; background:#2563eb; color:#ffffff; padding:10px 20px; border-radius:6px; font-weight:700; text-decoration:none; font-size:13px;">Open in Admin Console ↗</a>
                  </div>
                </div>
              </div>
            `,
            text: [
              `Hi Shubham,`,
              ``,
              `A new email was received on your custom address: ${to}`,
              ``,
              `From:    ${from}`,
              `Subject: ${subject}`,
              `Date:    ${new Date(createdAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} IST`,
              ``,
              `Message:`,
              message,
              ``,
              `View and reply directly from your Admin Console:`,
              `https://zenstro.space/admin.html`
            ].join('\n')
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
