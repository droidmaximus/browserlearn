# BrowserLearn Chrome extension

Records a browser task and sends it to the local app started with `npx browserlearn`. Recordings never leave your machine.

## Build (from git)

```bash
npm run build --workspace @browserlearn/extension
```

Output is `packages/extension/dist` (manifest, service worker, content script, popup).

## Load unpacked

1. Start the local app: `npx browserlearn` (or `npm start --workspace browserlearn` from the monorepo).
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, and choose `packages/extension/dist`.
3. Open the BrowserLearn dashboard → **Settings** and copy the pairing code.
4. Click the extension icon, paste the code, **Save pairing**.
5. Open the site you want to record, type a name, press **Record**, do the task, press **Stop**.

Chrome asks for permission to the current site when you press Record. The extension does not request access to all sites at install. `http://127.0.0.1` and `http://localhost` are allowed for local fixtures.

If the icon shows **!**, the local app is not running: start it with `npx browserlearn`.

## License

MIT
