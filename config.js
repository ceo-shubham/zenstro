/* Public configuration only.
   Never put private API tokens in this file. */
window.ZENSTRO_CONFIG = {
  githubUsername: "ceo-shubham",
  instagramUrl: "https://www.instagram.com/ceo_shubham/",
  linkedinCompanyUrl: "https://www.linkedin.com/company/134694292",
  linkedinProfileUrl: "https://www.linkedin.com/in/ceo-shubham/",

  /* Authorized Admin Emails for Google Login (Admin Panel) - strictly ceo.shubhampathak@gmail.com */
  adminEmails: [
    "ceo.shubhampathak@gmail.com"
  ],

  /* Google OAuth 2.0 Client ID for Google Identity Services */
  googleClientId: "193810371236-jli2ml7qh8qedqmat8o0hrms8uavhr6s.apps.googleusercontent.com",

  /* Admin Notification Email:
     When an inquiry is submitted, an automated email notification is sent to this address. */
  notificationEmail: "ceo.shubhampathak@gmail.com",

  /* Resend Email Configuration (Handled securely via Cloudflare Pages API / env.RESEND_API_KEY) */
  resendApiKey: "",
  resendFrom: "ZENSTRO Admin <admin@zenstro.space>",
  resendSubdomainFrom: "ZENSTRO Admin <admin@mail.zenstro.space>",

  /* Custom Formspree / Webhook endpoint (optional) */
  formspreeEndpoint: "",

  /* Registered Clients for Portal Access */
  clients: [
    {
      id: "easeyourfiling",
      name: "EaseYourFiling",
      tagline: "Corporate Filings, Taxation & Legal Compliance Suite",
      domain: "easeyourfiling.com",
      websiteUrl: "https://www.easeyourfiling.com",
      phone: "+91 62027 35213",
      businessEmails: [
        "official@easeyourfiling.com",
        "help@easeyourfiling.com",
        "info@easeyourfiling.com"
      ],
      authorizedEmails: [
        "official@easeyourfiling.com",
        "help@easeyourfiling.com",
        "info@easeyourfiling.com",
        "easeyourfiling@gmail.com",
        "csshrikantdubey@gmail.com"
      ]
    }
  ]
};
