/**
 * Cloudflare Pages Function: /api/inquiries
 * Reads and updates inquiries, sent outbox, and delete bin (trash) stored in Cloudflare KV (ZENSTRO_KV)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

const FAKE_PATTERNS = [
  'techscale.io',
  'venturescale.co',
  'novaaistudio.com',
  'example.com',
  'test.com',
  'sample.com',
  'acme.com',
  'mailinator.com',
  'Rajesh Sharma',
  'David Miller',
  'Emily Vance'
];

function isFakeItem(item) {
  if (!item) return false;
  const str = JSON.stringify(item).toLowerCase();
  return FAKE_PATTERNS.some(pat => str.includes(pat.toLowerCase()));
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet(context) {
  const { env } = context;

  if (!env || !env.ZENSTRO_KV) {
    return new Response(
      JSON.stringify({
        inquiries: [],
        sentEmails: [],
        trash: [],
        storage: 'local_fallback',
        message: 'Cloudflare KV (ZENSTRO_KV) not yet bound. Inquiries will use browser local storage.'
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  try {
    const raw = await env.ZENSTRO_KV.get('zenstro_inquiries');
    let list = raw ? JSON.parse(raw) : [];

    const rawSent = await env.ZENSTRO_KV.get('zenstro_sent_emails');
    let sentList = rawSent ? JSON.parse(rawSent) : [];

    const rawTrash = await env.ZENSTRO_KV.get('zenstro_trash');
    let trashList = rawTrash ? JSON.parse(rawTrash) : [];

    // Deduplicate sent emails by unique Resend ID or record ID
    const seenSent = new Set();
    const dedupedSent = [];
    for (const s of sentList) {
      if (!s) continue;
      const key = s.emailId ? ('resend_' + s.emailId) : ('id_' + s.id);
      if (!seenSent.has(key)) {
        seenSent.add(key);
        dedupedSent.push(s);
      }
    }
    if (dedupedSent.length !== sentList.length) {
      try {
        await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(dedupedSent));
      } catch (e) {}
    }

    return new Response(
      JSON.stringify({
        inquiries: list,
        sentEmails: dedupedSent,
        trash: trashList,
        storage: 'cloudflare_kv'
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, inquiries: [], sentEmails: [], trash: [] }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env || !env.ZENSTRO_KV) {
    return new Response(
      JSON.stringify({ success: false, message: 'KV not configured' }),
      { status: 200, headers: CORS_HEADERS }
    );
  }

  try {
    const body = await request.json();
    const { action, id, emailId, status, enquiry, type } = body;

    const rawInq = await env.ZENSTRO_KV.get('zenstro_inquiries');
    let list = rawInq ? JSON.parse(rawInq) : [];

    const rawSent = await env.ZENSTRO_KV.get('zenstro_sent_emails');
    let sentList = rawSent ? JSON.parse(rawSent) : [];

    const rawTrash = await env.ZENSTRO_KV.get('zenstro_trash');
    let trashList = rawTrash ? JSON.parse(rawTrash) : [];

    // 1. ADD NEW INQUIRY / LEAD
    if (action === 'add' && enquiry) {
      list.unshift(enquiry);
      if (list.length > 500) list = list.slice(0, 500);
      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      return new Response(JSON.stringify({ success: true, inquiries: list }), { status: 200, headers: CORS_HEADERS });
    }

    // 2. UPDATE STATUS (new / replied)
    if (action === 'update_status') {
      list = list.map(item => {
        if (item.id === id) {
          return Object.assign({}, item, { status: status || (item.status === 'replied' ? 'new' : 'replied') });
        }
        return item;
      });
      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      return new Response(JSON.stringify({ success: true, inquiries: list }), { status: 200, headers: CORS_HEADERS });
    }

    // 3. MOVE TO TRASH / DELETE BIN
    if (action === 'trash') {
      let targetItem = null;
      let originalType = type || 'inquiry';

      if (originalType === 'sent' || String(id).startsWith('sent_')) {
        originalType = 'sent';
        const foundIdx = sentList.findIndex(item => item.id === id || (emailId && item.emailId === emailId));
        if (foundIdx !== -1) {
          targetItem = sentList.splice(foundIdx, 1)[0];
        }
      } else {
        const foundIdx = list.findIndex(item => item.id === id);
        if (foundIdx !== -1) {
          targetItem = list.splice(foundIdx, 1)[0];
        }
      }

      if (targetItem) {
        targetItem.trashedAt = new Date().toISOString();
        targetItem.originalType = originalType;
        // Avoid duplicate in trash
        trashList = trashList.filter(t => t.id !== targetItem.id);
        trashList.unshift(targetItem);
        if (trashList.length > 500) trashList = trashList.slice(0, 500);

        await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
        await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
        await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));
      }

      return new Response(
        JSON.stringify({ success: true, inquiries: list, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 4. RESTORE FROM TRASH
    if (action === 'restore') {
      const foundIdx = trashList.findIndex(item => item.id === id);
      if (foundIdx !== -1) {
        const item = trashList.splice(foundIdx, 1)[0];
        const origType = item.originalType || (item.to ? 'sent' : 'inquiry');
        delete item.trashedAt;
        delete item.originalType;

        if (origType === 'sent') {
          sentList.unshift(item);
        } else {
          list.unshift(item);
        }

        await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
        await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
        await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));
      }

      return new Response(
        JSON.stringify({ success: true, inquiries: list, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 5. PERMANENT DELETE (from trash or by id)
    if (action === 'permanent_delete') {
      trashList = trashList.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));
      list = list.filter(item => item.id !== id);
      sentList = sentList.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));

      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
      await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));

      return new Response(
        JSON.stringify({ success: true, inquiries: list, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 6. EMPTY TRASH / DELETE BIN
    if (action === 'empty_trash') {
      trashList = [];
      await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify([]));
      return new Response(
        JSON.stringify({ success: true, trash: [] }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 7. PURGE ALL FAKE / DUMMY EMAILS
    if (action === 'purge_fakes') {
      list = list.filter(item => !isFakeItem(item));
      sentList = sentList.filter(item => !isFakeItem(item));
      trashList = trashList.filter(item => !isFakeItem(item));

      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
      await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));

      return new Response(
        JSON.stringify({ success: true, inquiries: list, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 8. SYNC INBOUND EMAILS FROM RESEND API
    if (action === 'sync_resend') {
      const resendApiKey = (env && env.RESEND_API_KEY) || '';
      try {
        const resList = await fetch('https://api.resend.com/emails/receiving', {
          headers: { 'Authorization': `Bearer ${resendApiKey}` }
        });
        if (resList.ok) {
          const listData = await resList.json();
          const items = listData.data || [];
          let addedCount = 0;

          for (const item of items) {
            const emailId = item.id;
            const alreadyExists = list.some(i => i.emailId === emailId || i.id === 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 12)) ||
                                  trashList.some(t => t.emailId === emailId || t.id === 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 12));

            if (!alreadyExists) {
              let bodyText = '';
              let bodyHtml = null;
              let from = item.from || 'Unknown Sender';
              let to = Array.isArray(item.to) ? item.to[0] : (item.to || 'ceo@zenstro.space');
              let subject = item.subject || 'Direct Email';
              let createdAt = item.created_at || new Date().toISOString();

              try {
                const detailRes = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
                  headers: { 'Authorization': `Bearer ${resendApiKey}` }
                });
                if (detailRes.ok) {
                  const detail = await detailRes.json();
                  if (detail.from) from = detail.from;
                  if (Array.isArray(detail.to) && detail.to.length > 0) to = detail.to[0];
                  if (detail.subject) subject = detail.subject;
                  if (detail.text) bodyText = detail.text;
                  else if (detail.html) bodyText = detail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                  bodyHtml = detail.html || null;
                }
              } catch (e) {}

              let senderEmail = from;
              let senderName = from;
              const emailMatch = from.match(/<([^>]+)>/);
              if (emailMatch) {
                senderEmail = emailMatch[1];
                senderName = from.replace(/<[^>]+>/, '').trim() || senderEmail.split('@')[0];
              } else if (from.includes('@')) {
                senderName = from.split('@')[0];
              }

              const newInbound = {
                id: 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 12),
                emailId: emailId,
                name: senderName,
                email: senderEmail,
                company: 'Direct Inbound Sender',
                topic: 'Direct Email to ' + to,
                source: 'email_inbound',
                recipientInbox: to,
                subject: subject,
                message: bodyText || '(Empty message body)',
                html: bodyHtml,
                createdAt: createdAt,
                status: 'new',
                replies: []
              };

              list.unshift(newInbound);
              addedCount++;
            }
          }

          if (addedCount > 0) {
            if (list.length > 500) list = list.slice(0, 500);
            await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
          }
        }
      } catch (syncErr) {
        console.warn('Sync error:', syncErr);
      }

      return new Response(
        JSON.stringify({ success: true, inquiries: list, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Backward compatibility: old delete actions
    if (action === 'delete') {
      // Default to moving to trash instead of silent hard-delete if requested
      list = list.filter(item => item.id !== id);
      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      return new Response(JSON.stringify({ success: true, inquiries: list }), { status: 200, headers: CORS_HEADERS });
    }

    if (action === 'delete_sent') {
      sentList = sentList.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));
      await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
      return new Response(JSON.stringify({ success: true, sentEmails: sentList }), { status: 200, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}
