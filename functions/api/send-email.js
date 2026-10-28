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
      <body style="margin:0; padding:24px 16px; background:#ffffff; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1f2937;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 24px; color:#111827; font-size:15px; line-height:1.7; white-space:pre-wrap; word-break:break-word;">
${escapeHtml(message)}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb; padding:20px 28px; border-top:1px solid #e5e7eb;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td width="50" valign="middle" style="padding-right:14px;">
                    <img src="https://zenstro.space/logo.png" alt="ZENSTRO Profile" width="46" height="46" style="display:block; border-radius:8px; border:1px solid #e5e7eb;" />
                  </td>
                  <td valign="middle">
                    <div style="font-size:14px; font-weight:700; color:#111827; letter-spacing:-0.01em;">ZENSTRO Technology Studio</div>
                    <div style="font-size:12px; color:#4b5563; margin-top:2px; line-height:1.5;">
                      <span style="white-space:nowrap;">Official Client Communications</span>
                      <span style="color:#9ca3af; margin:0 4px;">&bull;</span>
                      <span style="white-space:nowrap;">Website:&nbsp;<strong><a href="https://zenstro.space" style="color:#0b57d0; text-decoration:none;">zenstro.space</a></strong></span>
                    </div>
                    <div style="font-size:12px; margin-top:4px; line-height:1.5;">
                      <span style="white-space:nowrap;"><a href="mailto:ceo@zenstro.space" style="color:#0b57d0; text-decoration:none;">ceo@zenstro.space</a></span>
                      <span style="color:#d1d5db; margin:0 5px;">&bull;</span>
                      <span style="white-space:nowrap;"><a href="mailto:support@zenstro.space" style="color:#0b57d0; text-decoration:none;">support@zenstro.space</a></span>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:14px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af; line-height:1.4;">
                <span style="white-space:nowrap;">7-Day MVP Delivery Guarantee</span> &bull; <span style="white-space:nowrap;">Milestone-Driven Escrow (30/30/40)</span> &bull; <span style="white-space:nowrap;">Confidential Communication</span>
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
