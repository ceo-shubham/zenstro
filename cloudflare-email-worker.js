/**
 * ZENSTRO — Cloudflare Email Routing Worker
 * 
 * How to activate in Cloudflare Dashboard:
 * 1. Go to your domain (zenstro.space) -> "Email Routing"
 * 2. Go to "Routing Rules" -> "Custom addresses" (or "Catch-all address")
 * 3. Set Action: "Send to a Worker"
 * 4. Paste this script into the Worker editor!
 * 
 * This Worker:
 * 1. Forwards incoming email to https://zenstro.space/api/inbound-email so it appears in your Admin Panel!
 * 2. Also forwards a copy directly to your personal email: ceo.shubhampathak@gmail.com
 */

export default {
  async email(message, env, ctx) {
    const from = message.from;
    const to = message.to;
    const headers = message.headers;
    const subject = headers.get('subject') || 'No Subject';

    // Read email text body
    let bodyText = '';
    try {
      const rawStream = message.raw;
      const reader = rawStream.getReader();
      const chunks = [];
      let done, value;
      while (!done) {
        ({ done, value } = await reader.read());
        if (value) chunks.push(value);
      }
      const totalBuffer = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        totalBuffer.set(c, offset);
        offset += c.length;
      }
      const rawText = new TextDecoder('utf-8').decode(totalBuffer);

      // Simple extraction of body (after double newline following headers)
      const splitIndex = rawText.indexOf('\r\n\r\n');
      bodyText = splitIndex !== -1 ? rawText.substring(splitIndex + 4) : rawText;
      // Truncate to reasonable size
      if (bodyText.length > 5000) bodyText = bodyText.substring(0, 5000) + '... [truncated]';
    } catch (e) {
      bodyText = '(Unable to parse raw email body)';
    }

    // 1. Post to ZENSTRO Admin Panel API
    try {
      await fetch('https://zenstro.space/api/inbound-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: from,
          to: to,
          subject: subject,
          text: bodyText
        })
      });
    } catch (err) {
      console.error('Failed to post to admin webhook:', err);
    }

    // 2. Also forward a copy to CEO personal Gmail
    try {
      await message.forward('ceo.shubhampathak@gmail.com');
    } catch (fwdErr) {
      console.warn('Forwarding error:', fwdErr);
    }
  }
};
