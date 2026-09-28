# Raa Vansh Hotel — Android APK build files
- RaaVansh-Hotel.apk  → the installable app (workspace root: /home/user/RaaVansh-Hotel.apk)
- rv.keystore         → the signing key (KEEP THIS SAFE — password: raavansh / alias: raavansh).
  Updates must be signed with this same key or the phone won't accept them.
  (Do NOT upload this file to a public GitHub repo.)
- Main.java           → the app's one Java file. Key points:
    • The bundled app is served from a secure local origin (https://app.raavansh.local)
      instead of file:// — this is what makes PDF/JSON downloads, the photo picker,
      the service worker and the OCR web worker work inside the app.
    • The phone no longer needs a rebuild to sync: open  Settings → Server connection,
      type the hotel server address (your Render URL) and tap  Connect & sync now.
      Phone and laptop then share one database (bookings, payments, ID documents,
      room occupancy) automatically.  REMOTE_URL in Main.java stays empty by design.
