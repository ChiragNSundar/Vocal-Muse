# Vocal Muse (VoxScript) — 100% Fully Local Setup Guide

Vocal Muse is a modern studio workspace for songwriters and vocalists. It supports **100% offline local-only operation** with zero cloud dependencies, zero external network requests, and zero required Supabase keys.

---

## Quickstart (Simple 1-Click Launch)

### Windows
Double-click `start-local.bat` in the project root folder. It will:
1. Automatically launch `faster-whisper-server` (if installed) on port `9000`.
2. Open **`http://localhost:8080`** in your web browser.
3. Start the application development server.

### Manual Command Line
```bash
# 1. Install dependencies
npm install

# 2. Run the local dev server
npm run dev
```
Then open **[http://localhost:8080](http://localhost:8080)** in your browser.

---

## Local AI Features Setup (Optional)

### 1. LM Studio (Local LLM for Lyric Assistance & Style Generation)
1. Download & open **LM Studio**.
2. Search and load your preferred model (e.g. `Qwen2.5-7B`, `Llama-3.2-3B`).
3. Click the **Developer / Local Server** tab (`< />`) on the left sidebar.
4. Set **Port** to `1234` and click **Start Server**.
5. Make sure **CORS** is **Enabled** in server settings so your browser can connect.

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

## Local Storage & Persistence

- **Tracks & Bars**: Saved directly to **IndexedDB** (`voxscript-local`).
- **Audio Takes**: Saved directly to your browser's **Origin Private File System (OPFS)**.
- **Backup & Export**: Go to **Settings → Export Bundle** to download a single `.json` file containing all your tracks, lyrics history, and audio recordings.

---

## Knowledge Graph

This codebase is indexed with [Graphify](https://github.com/sponsors/safishamsi).
- Interactive Graph: `graphify-out/graph.html`
- Architecture Audit: `graphify-out/GRAPH_REPORT.md`
