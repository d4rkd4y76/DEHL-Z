# DEHLIZ Cloud Functions

Bu klasor su fonksiyonlari icerir:

- `accountRecovery`: Gizli soru ile tek kullanimlik sifre uretir.
- `myListToggle`: My List ekle/cikar islemini backend rate-limit ile yapar.
- `shopierWebhook`: Shopier odeme bildirimi ile kullanicinin +PLUS suresini otomatik aktive eder.

## Kurulum

1. Firebase CLI kurulu degilse:
   - `npm i -g firebase-tools`
2. Proje kokunde giris yapin:
   - `firebase login`
3. Proje secin:
   - `firebase use dehliz-a95cd`
4. Fonksiyon bagimliliklarini kurun:
   - `cd functions && npm install`
5. Shopier webhook guvenlik anahtari (onerilir):
   - `firebase functions:secrets:set SHOPIER_WEBHOOK_SECRET`
6. Shopier hash dogrulamasi icin imza anahtari (onerilir):
   - `firebase functions:secrets:set SHOPIER_WEBHOOK_HASH_SECRET`
7. Deploy edin:
   - `firebase deploy --only functions:accountRecovery,functions:myListToggle,functions:shopierWebhook`

Fonksiyon URL'leri:
- `https://europe-west1-dehliz-a95cd.cloudfunctions.net/accountRecovery`
- `https://europe-west1-dehliz-a95cd.cloudfunctions.net/myListToggle`
- `https://europe-west1-dehliz-a95cd.cloudfunctions.net/shopierWebhook`

