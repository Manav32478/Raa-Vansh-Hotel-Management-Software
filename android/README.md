# Raa Vansh Hotel — Android APK build files
- RaaVansh-Hotel.apk  → the installable app (workspace root: /home/user/RaaVansh-Hotel.apk)
- rv.keystore         → the signing key (KEEP THIS SAFE — password: raavansh / alias: raavansh).
  Updates must be signed with this same key or the phone won't accept them.
  (Do NOT upload this file to a public GitHub repo.)
- Main.java           → the app's one Java file. Key points:
    • The bundled app is served from a secure local origin (https://app.raavansh.local)
      instead of file:// — this is what makes PDF/JSON downloads, the photo picker,
      the service worker and the OCR web worker work inside the app.
    • Subscription verification and first payment submission require the hotel's server.
      Set REMOTE_URL in Main.java to that server before building the APK. A standalone
      offline copy cannot verify its license and remains on the subscription screen.
      Once active, phone and laptop share the same hotel's database.
