# AGENTS.md

Project Shongrokhon is an MFS wallet with an AI financial coach. It is a **web app**: Expo SDK 57 renders it with react-native-web, expo-router builds it as a single-page app, and Supabase is the backend.
- **Full project guide:** `CLAUDE.md` covers layout, commands, backend rules and testing gotchas. Read it first; this file covers what applies to any coding agent.
- **Spec:** `unified_mfs_ai_financial_coach_prd.md`.
- **Test plan:** `testcase.md`.
- **Phase 1 results:** `docs/phase1-test-matrix.md`.

## Platform
- **Web only.** Do not add iOS/Android code, `ios/` or `android/` directories, native config plugins, EAS builds, Expo Go workflows, or Maestro.
- **Write cross-platform React Native primitives** (`View`, `Text`, `Pressable`, `TextInput`). react-native-web renders them in the browser.
- **Browser APIs** such as `navigator`, `window` and `localStorage` are allowed. Guard any top-level access with `typeof window !== 'undefined'`.
- **Layout is mobile-first:** a single column, capped at 480px wide and centered.
- **The camera** (`expo-camera` on web) needs HTTPS or `localhost`. Always keep the QR image upload path working as the fallback.

## Expo has changed: do not trust your training data
Expo ships breaking changes every SDK release. Before writing code that touches an Expo or React Native API:
1. Check the `expo` major version in `package.json` (currently 57).
2. Read the matching versioned docs at `https://docs.expo.dev/versions/v57.0.0/`, or the package's `.d.ts` in `node_modules`.
3. For anything else, start from https://docs.expo.dev/llms.txt and follow its links. Never answer from memory.

## Commands
```bash
npx expo install <package>   # add Expo/RN packages (resolves SDK-compatible versions)
npm start                    # web dev server
npm run lint                 # expo lint (includes React Compiler rules)
npm run typecheck            # tsc --noEmit
npm test                     # Jest unit + component tests
npm run test:db              # pgTAP database tests + migration idempotency
npm run test:integration     # HTTP tests against local Supabase (resets the DB)
npm run test:e2e             # Playwright browser tests (resets the DB, builds + serves dist/)
npm run build                # production web export -> dist/
```
- **Before declaring a task done:** run lint, typecheck and `npm test`. If you touched SQL, run `npm run test:db`. If you touched flows, run the integration and E2E suites, one after the other.

## Routing
- **Expo Router** handles all navigation. Every file in `src/app/` is a route, and `_layout.tsx` files define the navigators.
- **Auth gating** lives in `src/app/_layout.tsx` via `Stack.Protected`. A new screen must be registered in the correct guard group.
- **Non-route code** goes elsewhere: logic in `src/lib/`, UI in `src/components/`, hooks in `src/hooks/`.

## Non-negotiables
- **Clients never write database tables.** Money moves only through `SECURITY DEFINER` functions that post balanced ledger entries. Details are in `CLAUDE.md` under "Backend rules".
- **Never expose the service-role key or `sb_secret_*` keys.** Don't put them in `.env`, an `EXPO_PUBLIC_*` variable, or any file the app imports. `npm run check:secrets` must pass.
- **Every user-facing error code needs a message** in `src/lib/messages.ts`.
- **Interactive elements need a `testID`.** On web it becomes `data-testid`, which the tests depend on.
- **When you add or change behavior covered by `testcase.md`,** add or update the test and its row in `docs/phase1-test-matrix.md`.
