/**
 * Varsayılan yapılandırma (geliştirme).
 * Üretimde `config.local.js` kullanın; repo paylaşıyorsanız bu dosyayı örnek tutun.
 */
window.DEHLIZ_CONFIG = window.DEHLIZ_CONFIG || {
  firebase: {
    apiKey: "AIzaSyB2INNHbTyaIDNsPz_XbMql28aHinf6wIA",
    authDomain: "dehliz-a95cd.firebaseapp.com",
    databaseURL: "https://dehliz-a95cd-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "dehliz-a95cd",
    storageBucket: "dehliz-a95cd.firebasestorage.app",
    messagingSenderId: "696509910909",
    appId: "1:696509910909:web:ae3db22132006f3102c614",
    measurementId: "G-E6C092X9CP"
  },
  bunnyEmbedBase: "https://iframe.mediadelivery.net/embed",
  recoveryApiBase: "https://europe-west1-dehliz-a95cd.cloudfunctions.net",
  shopier: {
    supportEmail: "destek.dehliz@gmail.com",
    plans: {
      plus_1m: {
        label: "1 Aylık +PLUS",
        months: 1,
        priceTl: 120,
        checkoutUrl: ""
      },
      plus_2m: {
        label: "2 Aylık +PLUS",
        months: 2,
        priceTl: 200,
        checkoutUrl: ""
      },
      plus_3m: {
        label: "3 Aylık +PLUS",
        months: 3,
        priceTl: 250,
        checkoutUrl: ""
      }
    }
  }
};
