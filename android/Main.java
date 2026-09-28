package com.raavansh.hotel;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.File;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Raa Vansh Hotel - Android wrapper.
 * Loads the hotel billing app. If REMOTE_URL is set and reachable, uses the
 * hotel server (shared database with the laptop). Otherwise runs the bundled
 * offline copy (data stored on this phone, never lost).
 *
 * The bundled app is served from a secure local origin (https://app.raavansh.local)
 * instead of file:// — this makes PDF/JSON downloads, the photo picker, the
 * service worker and the OCR web worker behave exactly like the live website.
 */
public class Main extends Activity {
    private WebView wv;
    private boolean remoteReady = false;
    // Put your public server URL here (e.g. "https://raavansh.onrender.com/") to share data with the laptop.
    // Leave empty to run fully on the phone.
    static final String REMOTE_URL = "";
    static final String ASSET_HOST = "app.raavansh.local";
    static final String LOCAL_URL = "https://" + ASSET_HOST + "/index.html";

    private String mimeFor(String path){
        if(path.endsWith(".html")) return "text/html";
        if(path.endsWith(".js")) return "application/javascript";
        if(path.endsWith(".css")) return "text/css";
        if(path.endsWith(".png")) return "image/png";
        if(path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if(path.endsWith(".webmanifest") || path.endsWith(".json")) return "application/json";
        if(path.endsWith(".txt")) return "text/plain";
        if(path.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        wv = new WebView(this);
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);

        // Native bridge: lets the web app hand the bill PDF straight to WhatsApp
        // (chat opens by number, bill already attached, thank-you text typed).
        wv.addJavascriptInterface(new NativeBridge(), "RVNative");

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                String u = null;
                if (resultMsg != null && resultMsg.getData() != null) u = resultMsg.getData().getString("url");
                return openExternal(u);
            }
            @Override
            public void onPermissionRequest(final PermissionRequest req) {
                runOnUiThread(new Runnable() {
                    public void run() {
                        String[] grant = new String[req.getResources().length];
                        int n = 0;
                        for (String r : req.getResources()) {
                            if ((r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                                    || r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                                    && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                grant[n++] = r;
                            }
                        }
                        String[] out = new String[n];
                        System.arraycopy(grant, 0, out, 0, n);
                        req.grant(out);
                    }
                });
            }
        });

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("https://wa.me") || url.startsWith("https://api.whatsapp.com")
                        || url.startsWith("tel:") || url.startsWith("sms:")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { }
                    return true;
                }
                return false;
            }
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("https".equals(u.getScheme()) && ASSET_HOST.equals(u.getHost())) {
                    String path = u.getPath();
                    if (path == null || path.equals("/") || path.equals("/index.html")) path = "/index.html";
                    if (path.startsWith("/")) path = path.substring(1);
                    try {
                        InputStream in = getAssets().open(path);
                        String mime = mimeFor(path);
                        boolean isText = mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript");
                        WebResourceResponse resp = new WebResourceResponse(mime, isText ? "UTF-8" : null, in);
                        Map<String, String> headers = new HashMap<String, String>();
                        headers.put("Cache-Control", "no-cache, no-store, must-revalidate");
                        resp.setResponseHeaders(headers);
                        return resp;
                    } catch (Exception ignored) {
                        try {
                            return new WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream("404 Not Found".getBytes("UTF-8")));
                        } catch (Exception ignored2) {
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                if (REMOTE_URL.length() > 0 && url.startsWith(REMOTE_URL)) remoteReady = true;
            }
        });

        if (REMOTE_URL.length() > 0) {
            wv.loadUrl(REMOTE_URL);
            final WebView self = wv;
            new Thread(new Runnable() {
                public void run() {
                    try { Thread.sleep(9000); } catch (Exception e) { }
                    runOnUiThread(new Runnable() {
                        public void run() {
                            if (!remoteReady) self.loadUrl(LOCAL_URL);
                        }
                    });
                }
            }).start();
        } else {
            wv.loadUrl(LOCAL_URL);
        }

        setContentView(wv);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{ Manifest.permission.CAMERA }, 1);
        }
    }

    /* ---------------- native WhatsApp bridge ---------------- */

    /** Called from JavaScript as window.RVNative.<method>(...). */
    public class NativeBridge {
        @JavascriptInterface
        public boolean available() { return true; }

        @JavascriptInterface
        public boolean hasWhatsApp() {
            try { getPackageManager().getPackageInfo("com.whatsapp", 0); return true; }
            catch (Exception e) { return false; }
        }

        /** Plain direct chat: opens the guest's WhatsApp DM with the text pre-typed. */
        @JavascriptInterface
        public boolean openChat(final String phone, final String text) {
            final String url = "https://api.whatsapp.com/send/?phone=" + digits(phone)
                    + "&text=" + android.net.Uri.encode(text == null ? "" : text);
            return launch(new Runnable() {
                public void run() { openExternal(url); }
            });
        }

        /**
         * Chat + attached bill in one shot. The PDF arrives as base64 from the web app,
         * is written to private storage and handed to WhatsApp through a content:// URI
         * together with the "jid" (chat) extra — so WhatsApp opens that guest's chat with
         * the bill already attached and the thank-you message typed.
         * Returns false if anything fails, so the web app can fall back to openChat().
         */
        @JavascriptInterface
        public boolean attachAndChat(final String phone, final String text, final String b64,
                                     final String filename, final boolean autoAttach) {
            if (b64 == null || b64.length() == 0 || !autoAttach) return openChat(phone, text);
            final File f;
            try {
                byte[] bytes = android.util.Base64.decode(b64, android.util.Base64.DEFAULT);
                String safe = (filename == null || filename.length() == 0) ? "RaaVansh-Bill.pdf" : filename;
                safe = safe.replaceAll("[^A-Za-z0-9 ._-]", "_");
                File dir = getCacheDir();
                f = new File(dir, safe);
                java.io.FileOutputStream out = new java.io.FileOutputStream(f);
                out.write(bytes); out.flush(); out.close();
            } catch (Exception e) { return openChat(phone, text); }

            return launch(new Runnable() {
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("application/pdf");
                        i.putExtra(Intent.EXTRA_STREAM, RvFileProvider.uriFor(f));
                        i.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                        i.putExtra("jid", digits(phone) + "@s.whatsapp.net");
                        i.setPackage("com.whatsapp");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(i);
                    } catch (Exception e) {
                        openExternal("https://api.whatsapp.com/send/?phone=" + digits(phone)
                                + "&text=" + android.net.Uri.encode(text == null ? "" : text));
                    }
                }
            });
        }
    }

    /** Keep digits only, defaulting to India's 91 country code for bare 10-digit numbers. */
    private static String digits(String phone) {
        String d = phone == null ? "" : phone.replaceAll("[^0-9]", "");
        if (d.length() == 10) d = "91" + d;
        return d;
    }

    private boolean launch(Runnable r) {
        try { runOnUiThread(r); return true; } catch (Exception e) { return false; }
    }

    private boolean openExternal(String url) {
        if (url == null) return false;
        if (url.startsWith("https://wa.me") || url.startsWith("https://api.whatsapp.com")
                || url.startsWith("tel:") || url.startsWith("sms:")) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) {}
            return true;
        }
        return false;
    }

    @Override
    public void onBackPressed() {
        if (wv.canGoBack()) wv.goBack();
        else super.onBackPressed();
    }
}
