/**
 * Cloudflare Pages Function: /api/contact
 * Handles form submissions:
 * 1. Saves inquiry into Cloudflare KV (if bound as ZENSTRO_KV)
 * 2. Sends automated notification email to ceo.shubhampathak@gmail.com via Resend API
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
    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim();
    const company = String(data.company || '').trim() || 'Individual';
    const topic = String(data.topic || '').trim() || 'General Inquiry';
    const message = String(data.message || '').trim();

    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: name, email, or message.' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const enquiry = {
      id: 'enq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name,
      email,
      company,
      topic,
      message,
      createdAt: new Date().toISOString(),
      status: 'new'
    };

    // 1. Save to Cloudflare KV if bound
    let kvSaved = false;
    if (env && env.ZENSTRO_KV) {
      try {
        const raw = await env.ZENSTRO_KV.get('zenstro_inquiries');
        let list = [];
        if (raw) {
          try { list = JSON.parse(raw); } catch (e) { list = []; }
        }
        list.unshift(enquiry);
        if (list.length > 500) list = list.slice(0, 500);
        await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
        kvSaved = true;
      } catch (kvErr) {
        console.error('KV Error:', kvErr);
      }
    }

    // 2. Send automated notification to admin via Resend
    const resendApiKey = (env && env.RESEND_API_KEY) || '';
    const notificationEmail = (env && env.ADMIN_NOTIFICATION_EMAIL) || 'ceo.shubhampathak@gmail.com';
    
    // Resend verified domain is zenstro.space
    const fromAddress = (env && env.RESEND_FROM) || 'ZENSTRO Alerts <admin@zenstro.space>';

    const emailSubject = `[ZENSTRO Enquiry] ${name} (${topic})`;
    const emailBody = [
      'Hi Shubham,',
      '',
      'You have received a new client enquiry on your ZENSTRO Admin Console.',
      '',
      '========================================',
      'CLIENT DETAILS',
      '========================================',
      `• Name:    ${name}`,
      `• Email:   ${email}`,
      `• Company: ${company}`,
      `• Service: ${topic}`,
      `• Time:    ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })} IST`,
      '',
      '========================================',
      'PROJECT MESSAGE',
      '========================================',
      message,
      '',
      '========================================',
      'ACTION REQUIRED',
      '========================================',
      'To review, mark status, or reply directly to the client, visit your Admin Console:',
      'https://zenstro.space/admin.html',
      '',
      '--',
      'ZENSTRO Automation System (zenstro.space)'
    ].join('\n');

    let emailSent = false;
    let emailId = null;

    if (resendApiKey) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [notificationEmail],
            subject: emailSubject,
            text: emailBody
          })
        });

        if (resendRes.ok) {
          const resData = await resendRes.json();
          emailSent = true;
          emailId = resData.id;
        } else {
          // If configured from address failed, retry with verified fallback admin@zenstro.space
          const errData = await resendRes.text();
          console.warn('Resend primary dispatch failed:', errData);
          if (fromAddress !== 'ZENSTRO Alerts <admin@zenstro.space>') {
            const fallbackRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'ZENSTRO Alerts <admin@zenstro.space>',
                to: [notificationEmail],
                subject: emailSubject,
                text: emailBody
              })
            });
            if (fallbackRes.ok) {
              const fbData = await fallbackRes.json();
              emailSent = true;
              emailId = fbData.id;
            }
          }
        }
      } catch (sendErr) {
        console.error('Email send error:', sendErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        enquiry: enquiry,
        kvSaved,
        emailSent,
        emailId
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Server error processing enquiry: ' + err.message }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
