package com.mywallet.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = "https://preview-chat-d940a26d-ab97-42dc-b29b-53491e59517a.space-z.ai/";
    private static final String OFFLINE_HTML = "<!DOCTYPE html><html lang='ar' dir='rtl'><head><meta charset='UTF-8'>"
        + "<meta name='viewport' content='width=device-width, initial-scale=1.0, maximum-scale=1.0'>"
        + "<style>"
        + "body{font-family:-apple-system,'Segoe UI',Tahoma,sans-serif;background:#0F172A;color:#fff;margin:0;padding:0;"
        + "height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}"
        + ".icon{font-size:80px;margin-bottom:20px}"
        + "h1{font-size:22px;font-weight:700;margin:0 0 10px 0}"
        + "p{font-size:14px;color:#94A3B8;margin:0 0 20px 0;line-height:1.6;max-width:280px}"
        + "button{background:#2563EB;color:#fff;border:none;padding:12px 24px;border-radius:12px;"
        + "font-size:14px;font-weight:600;cursor:pointer}"
        + "</style></head><body>"
        + "<div class='icon'>📡</div>"
        + "<h1>لا يوجد اتصال بالإنترنت</h1>"
        + "<p>تأكد من اتصالك بالإنترنت ثم اضغط زر إعادة المحاولة</p>"
        + "<button onclick='location.reload()'>إعادة المحاولة</button>"
        + "</body></html>";

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private boolean doubleBackToExitPressedOnce = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen edge-to-edge
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#2563EB"));
        window.setNavigationBarColor(Color.parseColor("#FFFFFF"));
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(window, window.getDecorView());
        controller.setAppearanceLightNavigationBars(true);
        controller.setAppearanceLightStatusBars(false);

        // SwipeRefreshLayout as root
        swipeRefresh = new SwipeRefreshLayout(this);
        swipeRefresh.setOnRefreshListener(() -> {
            webView.reload();
        });
        swipeRefresh.setColorSchemeColors(Color.parseColor("#2563EB"));

        // WebView config
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(settings.getUserAgentString() + " MyWallet/1.0 (Android Native)");

        // Enable cookies
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WalletWebViewClient());
        webView.setWebChromeClient(new WalletChromeClient());

        // Add views
        swipeRefresh.addView(webView);
        setContentView(swipeRefresh);

        // Back press handler (exit on double-press)
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    if (doubleBackToExitPressedOnce) {
                        setEnabled(false);
                        finish();
                        return;
                    }
                    doubleBackToExitPressedOnce = true;
                    Toast.makeText(MainActivity.this, R.string.back_to_exit, Toast.LENGTH_SHORT).show();
                    new android.os.Handler().postDelayed(() -> doubleBackToExitPressedOnce = false, 2000);
                }
            }
        });

        // Load URL or restore state
        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(APP_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            CookieManager.getInstance().flush();
        }
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            swipeRefresh.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private class WalletWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            // Keep internal URLs inside the WebView
            if (url.contains("space-z.ai") || url.contains("localhost") || url.startsWith("about:")) {
                return false;
            }
            // External links open in browser
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, request.getUrl());
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception e) {
                // ignore
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            super.onReceivedError(view, errorCode, description, failingUrl);
            view.loadData(OFFLINE_HTML, "text/html; charset=utf-8", "UTF-8");
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            swipeRefresh.setRefreshing(false);
            CookieManager.getInstance().flush();
        }
    }

    private class WalletChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            super.onProgressChanged(view, newProgress);
            if (newProgress >= 100) {
                swipeRefresh.setRefreshing(false);
            }
        }
    }
}
