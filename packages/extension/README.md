# BrowserLearn Chrome extension

Records a browser task and sends it to the local app started with `npx browserlearn`. Recordings never leave your machine.

## Load unpacked

1. Start the local app: `npx browserlearn`
2. In Chrome, open `chrome://extensions`, enable **Developer mode**, **Load unpacked**, and choose `packages/extension/dist` (run `npm run build --workspace @browserlearn/extension` first if you are developing from git).
3. Open the BrowserLearn dashboard → **Settings** and copy the pairing code.
4. Click the extension icon, paste the code, **Save pairing**.
5. Open the site you want to record, type a name, press **Record**, do the task, press **Stop**.

Chrome will ask for permission to the current site when you press Record. The extension does not request access to all sites at install.

If the icon shows **!**, the local app is not running: `npx browserlearn`.
