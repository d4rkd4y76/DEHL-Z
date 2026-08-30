# DEHLİZ auth mail

Markalı Türkçe üyelik onayı + şifre sıfırlama mailleri.

## Çalışan yol (önerilen): Firebase Function `authMail`

Kod: `functions/auth-mail.js` + `functions/index.js` → `exports.authMail`

İstemci: `js/auth-mail.js` → `DEHLIZ_CONFIG.mailApiBase`

```
https://europe-west1-dehliz-a95cd.cloudfunctions.net/authMail
```

### Secrets (`functions/.env` — gitignore)

```
RESEND_API_KEY=re_...
AUTH_MAIL_LINK_SECRET=uzun-rastgele-metin
```

### Resend

1. Domain: `dehliz.tv` (DNS: DKIM TXT + `send` MX/TXT SPF)
2. From: `DEHLİZ ekibi <noreply@dehliz.tv>`

### Deploy

```bash
cd functions && npm i
cd ..
firebase deploy --only functions:authMail,hosting
```

Hosting yayınlar: `auth-action.html`, `mail/assets/dehliz-mail-hero.jpg`

## Opsiyonel: Cloudflare Worker

`mail/cloudflare-worker.js` Harfim ile aynı model. Secrets: `RESEND_API_KEY`, `GOOGLE_SA_JSON`.
Worker deploy sonrası `mailApiBase` = `https://api.dehliz.tv/auth-mail` yapılabilir.
