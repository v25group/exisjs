# Secure notes API: class controllers

A security test target: `@Controller()` classes on Mongoose, with cookie sessions, CSRF, roles, uploads and static files. Its twin, `06-secure-functional`, is the same API with functional routes and the native driver.

The app is written the way a careful developer would write it, with no planted bugs, so that `scripts/security/attack.mjs` tests the framework. It needs MongoDB on `localhost:27017`.

```sh
npm run build
NODE_ENV=production PORT=4706 INSECURE_COOKIES=1 node .exis/server/main.js
node ../../scripts/security/attack.mjs http://127.0.0.1:4706
```

`INSECURE_COOKIES=1` is for this local HTTP test only. Never set it on a deployed server.
