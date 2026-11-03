# Secure notes API: functional routes

A security test target: `controller()` routes on the native MongoDB driver, with cookie sessions, CSRF, roles, uploads and static files. Its twin, `07-secure-oop`, is the same API with class controllers and Mongoose.

The app is written the way a careful developer would write it, with no planted bugs, so that `scripts/security/attack.mjs` tests the framework. It needs MongoDB on `localhost:27017`.

```sh
npm run build
NODE_ENV=production PORT=4706 INSECURE_COOKIES=1 node .exis/server/main.js
node ../../scripts/security/attack.mjs http://127.0.0.1:4706
```

`INSECURE_COOKIES=1` is for this local HTTP test only. Never set it on a deployed server.
