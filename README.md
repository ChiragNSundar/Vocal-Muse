# Vocal Muse (VoxScript) — 100% Fully Local Setup Guide

Vocal Muse is a modern studio workspace for songwriters and vocalists. It supports **100% offline local-only operation** with zero cloud dependencies, zero external network requests, and zero required Supabase keys.

---

## Smart 1-Click Launch ([start-local.bat](file:///d:/GitHub/Vocal%20Muse/start-local.bat))

Simply double-click `start-local.bat` in the project folder. It performs automated pre-flight checks and tells you exactly what is ready or what needs attention:

1. **Node.js Check**: Verifies Node.js is installed. If missing, displays clear instructions on how to install it.
2. **Auto-Installer**: Detects if `node_modules` is missing and automatically runs `npm install`.
3. **Local LLM Check**: Checks if LM Studio (port `1234`) or Ollama (port `11434`) is running. If not, displays a friendly notice with setup steps.
4. **Whisper STT Server**: Checks if `faster-whisper-server` is active on port `9000` and automatically starts it in the background if installed.
5. **Browser & Server Launch**: Launches **`http://localhost:8080`** in your default web browser and starts the development server.

---

## Manual Command Line Launch
```bash
# 1. Install dependencies (first time only)
npm install

# 2. Run local dev server
npm run dev
```
Then open **[http://localhost:8080](http://localhost:8080)** in your browser.

---

## Local AI Services Setup (Optional)

### 1. LM Studio (Local LLM for Lyric Assistance & Style Generation)
1. Download & open **LM Studio**.
2. Search and load your preferred model (e.g. `Qwen2.5-7B`, `Llama-3.2-3B`).
3. Click the **Developer / Local Server** tab (`< />`) on the left sidebar.
4. Set **Port** to `1234` and click **Start Server**.
5. Ensure **CORS** is **Enabled** in server settings so your browser can connect.

### 2. Live Voice Punch-In (Local Whisper Transcription)
To transcribe your vocal takes directly on your machine:
```cmd
pip install faster-whisper-server
faster-whisper-server --model Systran/faster-whisper-base.en --port 9000
```
*(When running `start-local.bat`, it will detect and launch this automatically if installed).*

### 3. Offline Rhyme & Phonetic Lookups
Phonetic rhyming lookups use a bundled offline CMUdict & Datamuse lookup engine. No API keys or extra configuration needed.

---

## In-App Connection Auto-Discovery

You can also check, scan, and test all local services directly inside the app at any time:
- Navigate to **Connect Page** (`http://localhost:8080/connect`) in the app navigation menu.
- The app will automatically scan for active local servers on your network and let you connect with one click.

---

## Local Storage & Persistence

- **Tracks & Bars**: Saved directly to **IndexedDB** (`voxscript-local`).
- **Audio Takes**: Saved directly to your browser's **Origin Private File System (OPFS)**.
- **Backup & Export**: Go to **Settings → Export Bundle** to download a single `.json` file containing all your tracks, lyrics history, and audio recordings.
