/**
 * Cloudflare Pages Function: /api/send-email
 * Sends custom emails and client replies directly from the Admin Panel via Resend API.
 * Supports sending from:
 * - ceo@zenstro.space
 * - admin@zenstro.space
 * - support@zenstro.space
 * - help@zenstro.space
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const to = String(data.to || '').trim();
    const from = String(data.from || 'ZENSTRO CEO <ceo@zenstro.space>').trim();
    const subject = String(data.subject || '').trim();
    const message = String(data.message || '').trim();
    const inquiryId = data.inquiryId ? String(data.inquiryId).trim() : null;

    if (!to || !subject || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject, or message.' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const resendApiKey = (env && env.RESEND_API_KEY) || '';

    // Build professional HTML and Plain Text payload with official company logo & email profile
    const formattedHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0; padding:24px 12px; background:#f1f5f9; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; box-shadow:0 4px 6px -1px rgba(15,23,42,0.05);">
          <!-- Header with Company Logo and Brand Identity -->
          <tr>
            <td style="background:#0f172a; padding:24px 28px; border-bottom:1px solid #1e293b;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <img src="https://zenstro.space/white_logo.png" alt="ZENSTRO" width="140" style="display:block; height:auto; max-height:42px; border:0; outline:none;" />
                    <p style="color:#94a3b8; margin:6px 0 0; font-size:11px; font-family:-apple-system,BlinkMacSystemFont,'SF Mono',Consolas,monospace; text-transform:uppercase; letter-spacing:0.08em;">
                      Enterprise Software &bull; Cloud &bull; AI Automation
                    </p>
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block; background:rgba(37,99,235,0.18); border:1px solid rgba(59,130,246,0.4); color:#93c5fd; font-size:10px; font-family:-apple-system,BlinkMacSystemFont,monospace; padding:4px 9px; border-radius:20px; text-transform:uppercase; letter-spacing:0.06em;">
                      &check; Verified Domain
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message Body -->
          <tr>
            <td style="padding:32px 28px; color:#1e293b; font-size:15px; line-height:1.7; white-space:pre-wrap; word-break:break-word;">
${escapeHtml(message)}
            </td>
          </tr>

          <!-- Executive Email Profile & Verification Signature -->
          <tr>
            <td style="background:#f8fafc; padding:24px 28px; border-top:1px solid #e2e8f0;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="48" valign="top" style="padding-right:14px;">
                    <img src="https://zenstro.space/logo.png" alt="ZENSTRO Profile" width="44" height="44" style="display:block; border-radius:8px; border:1px solid #cbd5e1;" />
                  </td>
                  <td valign="top">
                    <div style="font-size:14px; font-weight:700; color:#0f172a;">ZENSTRO Technology Studio</div>
                    <div style="font-size:12px; color:#64748b; margin-top:2px;">Official Client Communications &bull; domain: <strong>zenstro.space</strong></div>
                    <div style="font-size:12px; color:#2563eb; margin-top:6px;">
                      <a href="https://zenstro.space" style="color:#2563eb; text-decoration:none; font-weight:600;">zenstro.space</a>
                      <span style="color:#cbd5e1; margin:0 6px;">&bull;</span>
                      <a href="mailto:ceo@zenstro.space" style="color:#2563eb; text-decoration:none;">ceo@zenstro.space</a>
                      <span style="color:#cbd5e1; margin:0 6px;">&bull;</span>
                      <a href="mailto:support@zenstro.space" style="color:#2563eb; text-decoration:none;">support@zenstro.space</a>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:16px; padding-top:14px; border-top:1px solid #e2e8f0; font-size:11px; color:#94a3b8; line-height:1.5;">
                7-Day MVP Delivery Guarantee &bull; Milestone-Driven Escrow (30/30/40) &bull; Confidential &amp; Protected Communication
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: from,
        to: [to],
        subject: subject,
        text: message,
        html: formattedHtml
      })
    });

    const resData = await resendRes.json();

    if (!resendRes.ok) {
      return new Response(
        JSON.stringify({ error: resData.message || 'Resend API dispatch failed', details: resData }),
        { status: resendRes.status, headers: CORS_HEADERS }
      );
    }

    const sentRecord = {
      id: 'sent_' + (resData.id || Date.now()),
      to: to,
      from: from,
      subject: subject,
      message: message,
      inquiryId: inquiryId,
      emailId: resData.id,
      sentAt: new Date().toISOString()
    };

    // If Cloudflare KV is bound, record the sent email and update inquiry status
    if (env && env.ZENSTRO_KV) {
      try {
        // 1. Save to sent outbox with deduplication
        const rawSent = await env.ZENSTRO_KV.get('zenstro_sent_emails');
        let sentList = rawSent ? JSON.parse(rawSent) : [];
        sentList = sentList.filter(s => s.emailId !== resData.id && s.id !== sentRecord.id);
        sentList.unshift(sentRecord);
        if (sentList.length > 500) sentList = sentList.slice(0, 500);
        await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));

        // 2. If this was a reply to an existing inquiry, update inquiry to replied
        if (inquiryId) {
          const rawInq = await env.ZENSTRO_KV.get('zenstro_inquiries');
          if (rawInq) {
            let inqList = JSON.parse(rawInq);
            inqList = inqList.map(item => {
              if (item.id === inquiryId) {
                const replies = item.replies || [];
                replies.push(sentRecord);
                return Object.assign({}, item, { status: 'replied', replies: replies });
              }
              return item;
            });
            await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(inqList));
          }
        }
      } catch (kvErr) {
        console.warn('KV update error during send-email:', kvErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailId: resData.id,
        sentRecord: sentRecord
      }),
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
