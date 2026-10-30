# Dependency audit (2026-10-30)

`npm audit --omit=dev`:

- **server/** (the AI proxy Worker): 0 vulnerabilities.
- **app**: 12 advisories (5 low, 3 moderate, 4 high), all in **build tooling**, none in code that ships
  inside the app bundle:
  - `@expo/cli`, `@expo/config`, `@expo/metro-config`, `@expo/prebuild-config`, `@expo/config-plugins`,
    `@expo/local-build-cache-provider` → transitive `zod` 3.x (memory exhaustion on oversized input),
    `deepmerge` (prototype poisoning), `node-forge` (signature verification), `uuid` via `xcode`.
  - They run on the developer machine / CI during prebuild, bundling and `expo start`, on our own config
    files — not on user input, and not on the phone.
  - npm's suggested fix (`npm audit fix --force`) downgrades to Expo 51: not applied. They are resolved
    by Expo SDK patch releases; take them with the next `expo` patch update (versions from
    `node_modules/expo/bundledNativeModules.json`).

Re-run before a store submission: `npm audit --omit=dev` (app) and `cd server && npm audit --omit=dev`.
