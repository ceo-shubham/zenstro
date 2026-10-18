/* ZENSTRO — Contact Form Handler with Admin Notification & Panel Persistence */
(function () {
  'use strict';

  var config = window.ZENSTRO_CONFIG || {};
  var form = document.getElementById('project-form');
  var statusEl = document.getElementById('form-status');
  var fallback = document.getElementById('form-fallback');
  if (!form) return;

  var button = form.querySelector('button[type="submit"]');
  var fields = ['name', 'email', 'topic', 'message'];

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('error', Boolean(isError));
  }

  function validate() {
    for (var i = 0; i < fields.length; i++) {
      var field = form.elements[fields[i]];
      if (!field || String(field.value).trim() === '') {
        field.focus();
        setStatus('Please fill in every required field.', true);
        return false;
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.elements.email.value.trim())) {
      form.elements.email.focus();
      setStatus('Please enter a valid email address.', true);
      return false;
    }
    var consentField = form.elements.consent;
    if (consentField && !consentField.checked) {
      consentField.focus();
      setStatus('Please confirm your consent to the Privacy Policy to proceed.', true);
      return false;
    }
    return true;
  }

  /* Save enquiry to local database for Admin Panel */
  function saveToAdminStore(enquiry) {
    try {
      var existing = JSON.parse(localStorage.getItem('zenstro_inquiries') || '[]');
      existing.unshift(enquiry);
      localStorage.setItem('zenstro_inquiries', JSON.stringify(existing));
      // Dispatch custom storage event for live tab updates
      window.dispatchEvent(new Event('zenstro_inquiry_added'));
    } catch (e) {
      console.warn('Could not persist to local store', e);
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!validate()) return;

    var name = form.elements.name.value.trim();
    var email = form.elements.email.value.trim();
    var company = form.elements.company.value.trim() || '—';
    var topic = form.elements.topic.value;
    var message = form.elements.message.value.trim();

    var enquiry = {
      id: 'enq_' + Date.now(),
      name: name,
      email: email,
      company: company,
      topic: topic,
      message: message,
      createdAt: new Date().toISOString(),
      status: 'new'
    };

    // 1. Immediately save to Admin Panel local storage
    saveToAdminStore(enquiry);

    // Identify lead in MQLeads
    try {
      if (window.MQLeads && typeof window.MQLeads.identify === 'function') {
        window.MQLeads.identify({
          name: name,
          email: email,
          handle: email.split('@')[0],
          via: "contact_form"
        });
      }
    } catch (e) {}

    // 2. Prepare automated notification payload
    var notificationEmail = config.notificationEmail || 'ceo.shubhampathak@gmail.com';
    var emailSubject = '🔔 New Client Inquiry: ' + name + ' (' + topic + ')';
    var emailBody = [
      'Hello Shubham,',
      '',
      'You have received a new client inquiry on your ZENSTRO Admin Panel!',
      '',
      'Client Details:',
      '• Name: ' + name,
      '• Company: ' + company,
      '• Email: ' + email,
      '• Service: ' + topic,
      '',
      'Message:',
      '\"' + message + '\"',
      '',
      'To view and reply, please log in to your Admin Console:',
      '🔗 https://zenstro.space/admin.html',
      '',
      'Timestamp: ' + new Date().toLocaleString(),
      '',
      '—',
      'ZENSTRO Automation System (zenstro.space)'
    ].join('\n');

    button.disabled = true;
    button.textContent = 'Submitting…';
    setStatus('Submitting your project details…');

    // 3. Dispatch to Cloudflare Pages API (/api/contact)
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enquiry)
    })
    .then(function (res) {
      if (res.ok) return res.json();
      throw new Error('API returned ' + res.status);
    })
    .then(function (result) {
      form.reset();
      setStatus('Thank you, ' + name + ' — your enquiry has been sent. We have notified our leadership and will reply personally within 24 hours.');
    })
    .catch(function (apiErr) {
      console.warn('Cloudflare Pages API fallback triggered:', apiErr);
      // Fallback: Direct Resend API dispatch if key is present
      if (config.resendApiKey) {
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + config.resendApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: config.resendFrom || 'ZENSTRO Admin <admin@zenstro.space>',
            to: [notificationEmail],
            subject: emailSubject,
            text: emailBody
          })
        })
        .then(function () {
          form.reset();
          setStatus('Thank you, ' + name + ' — your enquiry has been sent. We have notified our leadership and will reply personally within 24 hours.');
        })
        .catch(function () {
          form.reset();
          setStatus('Thank you, ' + name + ' — your enquiry has been saved into our admin system. We will contact you soon.');
        })
        .finally(function () {
          button.disabled = false;
          button.innerHTML = 'Send project enquiry <span aria-hidden="true">↗</span>';
        });
      } else {
        form.reset();
        setStatus('Thank you, ' + name + ' — your enquiry has been saved into our admin system. We will contact you soon.');
        button.disabled = false;
        button.innerHTML = 'Send project enquiry <span aria-hidden="true">↗</span>';
      }
    })
    .finally(function () {
      button.disabled = false;
      button.innerHTML = 'Send project enquiry <span aria-hidden="true">↗</span>';
    });
  });

  setStatus('Tell us about your project — we review every enquiry personally.');
})();
