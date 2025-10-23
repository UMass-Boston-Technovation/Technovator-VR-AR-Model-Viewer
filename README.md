# Babylon.js AR/VR Model Viewer

This small project shows how to use Babylon.js to view GLB models and enter AR/VR (WebXR) from a browser.

Files
- `index.html` — the viewer page. Update `MODEL_FILE` inside the script if your file name differs.
- `3D_Models/` — place your `.glb` files here (e.g. `Maxwell.glb`).

Quick notes
- Many browsers require a secure context (HTTPS) or localhost for WebXR. Run a local HTTP server and open `http://localhost:8000`.
- Some devices/browsers don't support AR; the page will enable the appropriate buttons when available.
- If your folder name contains spaces, the browser may encode them; consider renaming `3D Models` to `3D_Models` and update `MODEL_PATH` in `index.html`.

Run locally (PowerShell)
Using Python 3 (built-in):

```powershell
# from the project root
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

Using Node (http-server):

```powershell
# install once
npm install -g http-server
# from project root
http-server -p 8000 -c-1
# then open http://localhost:8000
```

Or use the npm script included in `package.json` (requires running `npm install` first):

```powershell
npm install
npm start
```

Tips
- For AR, test on a device with WebXR support (modern Android with Chrome or other WebXR-enabled browsers). Desktop browsers typically only support immersive VR via a headset.
- If the model doesn't appear, check the browser console for loader errors and ensure the model filename in `index.html` matches the file in `3D Models/`.

Enjoy!
