# LocalSheets — Local AI (Ollama) setup

The AI panel in LocalSheets talks to a [local Ollama](https://ollama.com) instance running on your own machine. **No data ever leaves your computer.** But because LocalSheets runs from a `file://` URL (you open `localsheets.html` directly from disk), Ollama needs to be configured to accept connections from any origin — otherwise it rejects the request before the browser ever sees a response.

This is a one-time setup. Follow your OS below.

---

## 1. Install Ollama and pull a model

1. Install from [ollama.com](https://ollama.com).
2. Pull at least one model. Recommended:

   ```bash
   ollama pull llama3.2          # fast, good for freeform text replies
   ollama pull qwen2.5-coder:7b  # better for the JSON-patch mode
   ```

---

## 2. Configure `OLLAMA_ORIGINS=*` and restart Ollama

### 🪟 Windows (persistent — recommended)

1. Right-click the **Ollama icon in the system tray** → **Quit Ollama**. *(This is the step everyone forgets. The tray service ignores env vars set after it started.)*
2. Open the Start Menu → search **"Environment Variables"** → click **Edit the system environment variables** → **Environment Variables…** button.
3. Under **User variables for [you]** → **New…**
   - **Variable name:** `OLLAMA_ORIGINS`
   - **Variable value:** `*`
4. Click OK on all dialogs.
5. Relaunch **Ollama** from the Start Menu.

**Verify:** open PowerShell and run `echo $env:OLLAMA_ORIGINS` — should print `*`.

#### Windows alternative (one terminal session only)

```powershell
# In PowerShell — runs Ollama in the foreground; closing the window kills it
$env:OLLAMA_ORIGINS = "*"
ollama serve
```

### 🍏 macOS (persistent — recommended)

The single most reliable command on macOS is `launchctl setenv`. Prefixing `open -a Ollama` with an env var does **not** work — `open` hands off to launchd, which uses its own environment and silently drops your var.

1. Quit Ollama: menu bar icon → **Quit Ollama**.
2. In Terminal:

   ```bash
   launchctl setenv OLLAMA_ORIGINS "*"
   ```

3. Relaunch Ollama (from Applications or Spotlight).

**Verify:** in Terminal, `launchctl getenv OLLAMA_ORIGINS` should print `*`.

**Note:** `launchctl setenv` persists until the next reboot. To make it survive reboots, add the same line to a launchd plist or to a startup script (e.g. `~/.zshrc` if you always start your day from a terminal).

#### macOS alternative (one terminal session only)

```bash
OLLAMA_ORIGINS="*" ollama serve
```

Runs Ollama in the foreground; closing the terminal kills it.

### 🐧 Linux (systemd — typical install)

```bash
sudo systemctl edit ollama.service
```

In the editor that opens, add these lines under the blank section:

```ini
[Service]
Environment="OLLAMA_ORIGINS=*"
```

Save and exit, then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

**Verify:** `systemctl show ollama.service | grep OLLAMA_ORIGINS` should include `OLLAMA_ORIGINS=*`.

#### Linux alternative (one terminal session only)

```bash
OLLAMA_ORIGINS="*" ollama serve
```

---

## 3. Use the AI panel

1. Open `localsheets.html` in Chrome, Edge, Brave, or Safari.
2. Click **AI** in the toolbar.
3. Pick a model from the dropdown. If you see "Cannot reach Ollama" instead, see *Troubleshooting* below.
4. Choose a mode:
   - **Text reply** — freeform response (optionally with your selection as TSV context). Insert into the active cell or paste as TSV below the selection.
   - **JSON patch** — model returns `{"A1": "=SUM(B1:B10)", ...}` style structured cell mutations. Panel validates each cell key, shows a preview, applies as a single undoable bulk action.

---

## Troubleshooting

### "Cannot reach Ollama" in the panel
- Confirm Ollama is actually running: `curl http://localhost:11434/api/tags` should return JSON. If it times out, Ollama isn't running.
- If `curl` works but the panel says "Cannot reach", the env var didn't take. Re-do step 2 and **make sure you fully quit the tray/menu-bar app before relaunching**.

### "Cannot reach Ollama" only after you fix CORS
Open DevTools (F12) → Network tab → click **AI** in the toolbar. If you see a request to `localhost:11434` with a CORS error, `OLLAMA_ORIGINS` is unset for the Ollama process. The tray/launchd-managed instance didn't inherit your env. Quit it from the tray/menu and restart through the OS-specific method above.

### Model dropdown is empty
You installed Ollama but haven't pulled any models. `ollama pull llama3.2`.

### Responses look like garbage
Some small models (1B–3B) struggle with structured JSON output. For the JSON-patch mode specifically, `qwen2.5-coder:7b` produces much cleaner results than `llama3.2:3b`. For freeform text replies, `llama3.2:3b` is fine and 10× faster.

### "Why am I going through this just to get AI working?"
LocalSheets is air-gapped by default — the only outbound network calls the entire app can make are to `localhost:11434`, and they only fire when you click the **AI** button. The CORS setup is the price of that guarantee: no data ever silently leaves your machine because the AI feature requires explicit opt-in *and* explicit setup. If you don't want or need local AI, you can ignore this entirely.
