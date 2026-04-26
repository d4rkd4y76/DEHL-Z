# DEHLIZ Cloud Functions

Bu klasor su fonksiyonlari icerir:

- `accountRecovery`: Gizli soru ile tek kullanimlik sifre uretir.
- `myListToggle`: My List ekle/cikar islemini backend rate-limit ile yapar.
- `paddleWebhook`: Paddle abonelik event'leri ile `isPro/subscription` alanlarini senkronlar.

## Kurulum

1. Firebase CLI kurulu degilse:
   - `npm i -g firebase-tools`
2. Proje kokunde giris yapin:
   - `firebase login`
3. Proje secin:
   - `firebase use dehliz-a95cd`
4. Fonksiyon bagimliliklarini kurun:
   - `cd functions && npm install`
5. Paddle webhook imza dogrulamasi icin secret ayarlayin:
   - `firebase functions:secrets:set PADDLE_WEBHOOK_SECRET`
6. Deploy edin:
   - `firebase deploy --only functions:accountRecovery,functions:myListToggle,functions:paddleWebhook`

Fonksiyon URL'leri:
- `https://europe-west1-dehliz-a95cd.cloudfunctions.net/accountRecovery`
- `https://europe-west1-dehliz-a95cd.cloudfunctions.net/myListToggle`
- `https://europe-west1-dehliz-a95cd.cloudfunctions.net/paddleWebhook`

