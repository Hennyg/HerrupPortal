{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": [
      "/admin.html",
      "/guide.html",
      "/assets/*",
      "/manifest.json",
      "/sw.js",
      "/icons/*",
      "/.auth/*",
      "/api/*"
    ]
  },
  "routes": [
    { "route": "/login",  "redirect": "/.auth/login/aad?post_login_redirect_uri=.referrer", "statusCode": 302 },
    { "route": "/logout", "redirect": "/.auth/logout?post_logout_redirect_uri=/", "statusCode": 302 },
    { "route": "/.auth/login/github", "statusCode": 404 },

    { "route": "/assets/*", "allowedRoles": ["anonymous", "authenticated"] },
    { "route": "/icons/*",  "allowedRoles": ["anonymous", "authenticated"] },
    { "route": "/sw.js",    "allowedRoles": ["anonymous", "authenticated"] },
    { "route": "/manifest.json", "allowedRoles": ["anonymous", "authenticated"] },

    { "route": "/*", "allowedRoles": ["authenticated"] }
  ],
  "responseOverrides": {
    "401": {
      "redirect": "/.auth/login/aad?post_login_redirect_uri=.referrer",
      "statusCode": 302
    }
  }
}
