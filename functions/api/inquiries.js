/**
 * Cloudflare Pages Function: /api/inquiries
 * Reads and updates inquiries, received emails, sent outbox, and delete bin (trash) stored in Cloudflare KV (ZENSTRO_KV)
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
        receivedEmails: [],
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

    const rawRec = await env.ZENSTRO_KV.get('zenstro_received_emails');
    let recList = rawRec ? JSON.parse(rawRec) : [];

    const rawSent = await env.ZENSTRO_KV.get('zenstro_sent_emails');
    let sentList = rawSent ? JSON.parse(rawSent) : [];

    const rawTrash = await env.ZENSTRO_KV.get('zenstro_trash');
    let trashList = rawTrash ? JSON.parse(rawTrash) : [];

    // Merge any received emails into inquiries if not already present
    const seenInq = new Set(list.map(i => i.emailId || i.id));
    for (const r of recList) {
      const key = r.emailId || r.id;
      if (!seenInq.has(key)) {
        seenInq.add(key);
        list.unshift(r);
      }
    }

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
        receivedEmails: recList,
        sentEmails: dedupedSent,
        trash: trashList,
        storage: 'cloudflare_kv'
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, inquiries: [], receivedEmails: [], sentEmails: [], trash: [] }),
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

    const rawRec = await env.ZENSTRO_KV.get('zenstro_received_emails');
    let recList = rawRec ? JSON.parse(rawRec) : [];

    const rawSent = await env.ZENSTRO_KV.get('zenstro_sent_emails');
    let sentList = rawSent ? JSON.parse(rawSent) : [];

    const rawTrash = await env.ZENSTRO_KV.get('zenstro_trash');
    let trashList = rawTrash ? JSON.parse(rawTrash) : [];

    // 1. ADD NEW INQUIRY / LEAD
    if (action === 'add' && enquiry) {
      list.unshift(enquiry);
      if (list.length > 1000) list = list.slice(0, 1000);
      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      return new Response(JSON.stringify({ success: true, inquiries: list }), { status: 200, headers: CORS_HEADERS });
    }

    // 2. UPDATE STATUS (new / read / replied)
    if (action === 'update_status' || action === 'mark_read') {
      const targetStatus = status || 'read';
      list = list.map(item => {
        if (item.id === id || (emailId && item.emailId === emailId)) {
          return Object.assign({}, item, { status: targetStatus });
        }
        return item;
      });
      recList = recList.map(item => {
        if (item.id === id || (emailId && item.emailId === emailId)) {
          return Object.assign({}, item, { status: targetStatus });
        }
        return item;
      });
      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
      return new Response(JSON.stringify({ success: true, inquiries: list, receivedEmails: recList }), {
        status: 200,
        headers: CORS_HEADERS
      });
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
        const foundIdx = list.findIndex(item => item.id === id || (emailId && item.emailId === emailId));
        if (foundIdx !== -1) {
          targetItem = list.splice(foundIdx, 1)[0];
        }
        const recIdx = recList.findIndex(item => item.id === id || (emailId && item.emailId === emailId));
        if (recIdx !== -1) {
          recList.splice(recIdx, 1);
        }
      }

      if (targetItem) {
        targetItem.trashedAt = new Date().toISOString();
        targetItem.originalType = originalType;
        // Avoid duplicate in trash
        trashList = trashList.filter(t => t.id !== targetItem.id && (!emailId || t.emailId !== emailId));
        trashList.unshift(targetItem);
        if (trashList.length > 500) trashList = trashList.slice(0, 500);

        await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
        await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
        await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
        await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));
      }

      return new Response(
        JSON.stringify({ success: true, inquiries: list, receivedEmails: recList, sentEmails: sentList, trash: trashList }),
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
          if (item.source === 'email_inbound') {
            recList.unshift(item);
          }
        }

        await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
        await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
        await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
        await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));
      }

      return new Response(
        JSON.stringify({ success: true, inquiries: list, receivedEmails: recList, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 5. PERMANENT DELETE (from trash or by id)
    if (action === 'permanent_delete') {
      trashList = trashList.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));
      list = list.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));
      recList = recList.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));
      sentList = sentList.filter(item => item.id !== id && (!emailId || item.emailId !== emailId));

      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
      await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
      await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));

      return new Response(
        JSON.stringify({ success: true, inquiries: list, receivedEmails: recList, sentEmails: sentList, trash: trashList }),
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
      recList = recList.filter(item => !isFakeItem(item));
      sentList = sentList.filter(item => !isFakeItem(item));
      trashList = trashList.filter(item => !isFakeItem(item));

      await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
      await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
      await env.ZENSTRO_KV.put('zenstro_sent_emails', JSON.stringify(sentList));
      await env.ZENSTRO_KV.put('zenstro_trash', JSON.stringify(trashList));

      return new Response(
        JSON.stringify({ success: true, inquiries: list, receivedEmails: recList, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 8. SYNC INBOUND EMAILS FROM RESEND RECEIVING API
    if (action === 'sync_resend' || action === 'sync') {
      const resendApiKey = (env && env.RESEND_API_KEY) || '';
      if (!resendApiKey) {
        return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured in environment' }), {
          status: 500,
          headers: CORS_HEADERS
        });
      }

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
            const alreadyExists = list.some(i => i.emailId === emailId || i.id === 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 14)) ||
                                  trashList.some(t => t.emailId === emailId || t.id === 'inbound_' + String(emailId).replace(/-/g, '').slice(0, 14));

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

              list.unshift(newInbound);
              recList.unshift(newInbound);
              addedCount++;
            }
          }

          if (addedCount > 0) {
            if (list.length > 1000) list = list.slice(0, 1000);
            if (recList.length > 1000) recList = recList.slice(0, 1000);
            await env.ZENSTRO_KV.put('zenstro_inquiries', JSON.stringify(list));
            await env.ZENSTRO_KV.put('zenstro_received_emails', JSON.stringify(recList));
          }
        }
      } catch (syncErr) {
        console.warn('Sync error:', syncErr);
      }

      return new Response(
        JSON.stringify({ success: true, inquiries: list, receivedEmails: recList, sentEmails: sentList, trash: trashList }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: CORS_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}
