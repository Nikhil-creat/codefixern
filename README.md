# CodeFixern v2.4

**Polyglot code diagnostics, live language detection, in-browser execution, and AI healing agents — in a single cinematic static site.**

Built by **Nikhil Chary Sriramoju** — [github.com/Nikhil-creat](https://github.com/Nikhil-creat) · [LinkedIn](https://in.linkedin.com/in/nikhil-chary-sriramoju-95041b38a)

---

## What it actually does

CodeFixern is deployed as a static site on GitHub Pages, which means there is
no server of its own. Every feature below is wired to something that
genuinely runs — in your browser or against a provider you bring your own
free key for — not simulated:

| Feature | How it really works |
|---|---|
| **Live language detection** | Regex/heuristic classifier running entirely client-side, re-evaluated on every keystroke. Covers Python, JS/TS, Java, C/C++, C#, Go, Rust, Ruby, PHP, Swift, Kotlin, SQL, Bash, HTML. |
| **Inline diagnostics gutter** | The static scanner marks fault/warning lines directly in the editor gutter (hover for the message) as well as in the panel below — language name, line number, and hint together. |
| **Python execution** | [Pyodide](https://pyodide.org) — real CPython compiled to WebAssembly, runs fully in your browser. No key, no server, no rate limit. |
| **JavaScript execution** | A locked-down sandboxed `<iframe>` (`sandbox="allow-scripts"`, no same-origin) — real V8, isolated from the page and your data. |
| **SQL execution** | [sql.js](https://sql.js.org) — real SQLite compiled to WebAssembly, runs fully in your browser. |
| **Other compiled languages** (Java, C/C++, C#, Go, Rust, Ruby, PHP, Swift, Kotlin, Bash) | [Judge0 CE](https://judge0.com) via RapidAPI — opt-in "bring your own key." RapidAPI's free tier covers this at no cost. |
| **File ingestion** | Plain code files read directly; **PDF** via [pdf.js](https://mozilla.github.io/pdf.js/); **.docx** via [Mammoth](https://github.com/mwilliamson/mammoth.js); **images** OCR'd in-browser with [Tesseract.js](https://tesseract.projectnaptha.com/) — a real CNN+LSTM OCR model. |
| **AI Coder / Optimizer / Explain agents** | Opt-in BYOK — choose **Groq** (free, fast, Llama 3.3 70B) or **Gemini** (free, 2.0 Flash). Calls go straight from your browser to that provider. Without a key, everything else still works. |
| **Local retrieval ("RAG-lite")** | Before asking the AI to heal code, a small embedded per-language knowledge base is keyword-matched against the diagnostics and spliced into the prompt — genuine retrieval-then-generation, just backed by a local table instead of a hosted vector DB (there's no server here to host one). |
| **History Vault + session persistence** | Every run/heal is logged to `localStorage`, and your open streams autosave and restore across reloads — all on-device, nothing leaves your browser. |

### Why not Docker / a hosted Piston / a real backend RAG+CNN pipeline?

GitHub Pages only serves static files — there's no process to run a Docker
daemon, a vector database, or a model server. Earlier drafts of this project
called the public [Piston](https://github.com/engineer-man/piston) execution
API, which worked as a free keyless backend until its maintainer restricted
public access to manually-issued keys. Rather than depend on another
third party that can revoke access at any time, this version moved the most
common languages (Python, JS, SQL) to engines that run natively in the
visitor's own browser — Pyodide and sql.js are real WebAssembly builds of
CPython and SQLite, not mocks — so they can never 401. Less common compiled
languages still need a real sandboxed machine somewhere, so those go through
Judge0 with a key you provide yourself.

## What's new in v2.4

| Addition | What it is |
|---|---|
| **Groq/Gemini only** | Anthropic removed from the provider list entirely — just two free, no-card providers: **Groq** (Llama 3.3 70B) and **Gemini** (2.0 Flash). Simpler, and nothing to sign up for that costs money. |
| **Test key button** | Settings now has a "Test key" button that pings the provider directly and shows ✓/✗ before you save — no more guessing whether a pasted key is valid. |
| **Explain agent** | A new "✨ Explain" button next to the editor asks your configured AI to explain the active code in plain English, right in the Agent Log — a third agent alongside Coder/Optimizer. |
| **Starter templates** | A dropdown in the file-ingest row inserts a working Fibonacci example in Python, JavaScript, Java, C++, or SQL — useful for demos or just to see the tool run instantly. |
| **Toast notifications** | Key saved, key removed, history cleared, template inserted — quick non-blocking confirmations instead of silence or a native `alert()`. |
| **Haptic feedback** | A short vibration on run success/failure and on a completed Explain pass (falls back silently on devices/browsers without vibration support). |

## What's new in v2.3

| Addition | What it is |
|---|---|
| **Mobile overflow fixes** | The Settings, Command Palette, and Credentials panels are now hard-capped to `calc(100vw - 32px)` so they can never run off a narrow phone screen — a real bug from a `white-space: nowrap` rule on the credentials button that let long text overflow past the viewport edge. |
| **Credentials CTA** | The "view credentials" button now has an amber-highlighted card look instead of blending into the header. |

## Project structure

```
codefixern/
├── index.html         # markup + CDN script/style includes
├── style.css           # design system (dark diagnostic-panel aesthetic)
├── app.js               # all application logic
├── site.webmanifest     # add-to-home-screen metadata
├── 404.html              # themed not-found page
├── LICENSE                # MIT
├── .gitignore
└── README.md
```

No build step, no `npm install`, no bundler — plain HTML/CSS/JS, deploys to
GitHub Pages with zero configuration.

## Run it locally

```bash
cd codefixern
python3 -m http.server 8000
# visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this folder's contents to the root of a repository's `main` branch.
2. Repo → **Settings → Pages**.
3. **Source: Deploy from a branch** → branch **main**, folder **/ (root)** → **Save**.
4. Your site is live at `https://<your-username>.github.io/<repo>/` within a
   minute — fully static, only talking to public, CORS-enabled APIs.

## Getting free keys (all optional)

- **Groq** (AI agents, free): [console.groq.com](https://console.groq.com) → API Keys → Create key. No card required.
- **Gemini** (AI agents, free): [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → Create API key. No card required.
- **RapidAPI Judge0 CE** (compiled-language execution, free tier): [rapidapi.com/judge0-official/api/judge0-ce](https://rapidapi.com/judge0-official/api/judge0-ce) → Subscribe to the free plan → copy your `X-RapidAPI-Key`.

Paste whichever you want into the gear-icon Settings panel in the app — each
is stored only in that browser's `localStorage` and sent directly to its own
provider.

## Notes, limits & honesty

- **Python/JS/SQL run with zero setup** — no key, no rate limit, no server dependency.
- **Other compiled languages** need your own free RapidAPI key, because real compilation/execution for those needs an actual sandboxed machine somewhere, and this site has none of its own.
- **Static diagnostics are heuristics**, not a full parser/AST for every language — they catch bracket/quote/indentation issues plus a small per-language pattern list, not every possible bug.
- **The local knowledge base is small and hand-written** — it's a genuine (if modest) retrieval step, not a stand-in for a real embeddings-backed RAG pipeline.
- **History Vault and saved streams are per-browser**, not a shared cloud history — clearing site data clears them.

## Roadmap (if this becomes a backend-hosted product)

- A real FastAPI/Node gateway with provisioned Docker/MicroVM workers per language, so every language runs first-party instead of via Judge0.
- Server-side RAG over a real embeddings index of language docs/compiler error corpora, replacing the local keyword-matched knowledge base.
- A shared, authenticated History Vault instead of per-browser `localStorage`.
- LangGraph-orchestrated multi-agent diagnosis (Diagnostician → Coder → Optimizer → Verifier) instead of the current two-call pipeline.

## Credit

Architected and built by **Nikhil Chary Sriramoju** — B.Tech CSE, Vaagdevi
College of Engineering.
