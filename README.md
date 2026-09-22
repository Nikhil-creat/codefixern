# CodeFixern v2

**Polyglot code diagnostics, live language detection, and sandboxed execution — in a single cinematic static site.**

Built by **Nikhil Chary Sriramoju** — [github.com/Nikhil-creat](https://github.com/Nikhil-creat) · [LinkedIn](https://in.linkedin.com/in/nikhil-chary-sriramoju-95041b38a)

v2 adds a cinematic boot sequence, an animated diagnostic-grid background, a
command palette (⌘K), a live session-uptime readout, animated vault
counters, a two-mode "scan" theme (amber / cyan), and an "Operator Profile"
drawer that surfaces education, certifications, internships, and shipped
projects — all built to respect `prefers-reduced-motion` and stay keyboard-
accessible.

---

## What it actually does

CodeFixern is deployed as a static site on GitHub Pages, which means there is no
server of its own — no Docker daemon, no persistent database, no background
agents. Rather than fake that infrastructure, every feature below is wired to
something real that genuinely runs in the browser or against a public API:

| Feature | How it really works |
|---|---|
| **Live language detection** | Regex/heuristic classifier running entirely client-side, re-evaluated on every keystroke (debounced ~200ms). Covers Python, JS/TS, Java, C/C++, C#, Go, Rust, Ruby, PHP, Swift, Kotlin, SQL, Bash, HTML. |
| **Multi-field input** | Tabbed "input streams" — add, close, and switch between multiple independent code buffers, each with its own detected language. |
| **File ingestion** | Plain code files read directly; **PDF** text pulled with [pdf.js](https://mozilla.github.io/pdf.js/); **.docx** text pulled with [Mammoth](https://github.com/mwilliamson/mammoth.js); **images** (`.png/.jpg/.webp`) OCR'd in-browser with [Tesseract.js](https://tesseract.projectnaptha.com/) — a real CNN/LSTM OCR model, not a mock. |
| **Static diagnostics** | Bracket/quote balance checker, unterminated-string detection, Python colon/indentation heuristics — all local, always on, no key required. |
| **Execution** | Dispatched to [Piston](https://github.com/engineer-man/piston) (`emkc.org/api/v2/piston`), a free, keyless, genuinely sandboxed multi-language execution API. Real `stdout`/`stderr`/exit codes come back — nothing is simulated. |
| **AI Coder / Optimizer agents** | Opt-in "bring your own key." If you add an Anthropic API key (Settings → gear icon), the app calls `api.anthropic.com/v1/messages` **directly from your browser** to produce a healed rewrite and an optimized rewrite, then renders a unified diff. The key lives only in your browser's `localStorage` and is never sent anywhere but Anthropic. Without a key, everything else still works. |
| **History Vault** | Every run/heal is logged to `localStorage` on your machine — timestamp, language, and a snapshot of the code — so you can reopen or roll back to an earlier version. Nothing leaves your browser. |

This is a deliberate design choice: a portfolio project should demonstrate what
you actually built, not dress up a static page as a production multi-agent
backend it can't be. The original brief's Docker/MicroVM/RAG/LangGraph
architecture is the natural next step once this ships behind a real backend
(see **Roadmap** below) — the UI, tab system, and diagnostics contract are
already built to slot a real backend in without a rewrite.

## What's new in v2

| Addition | What it is |
|---|---|
| **Boot sequence** | A typed-out terminal boot log on first load each session (`sessionStorage`-gated so return visits skip it), skippable, and fully disabled under `prefers-reduced-motion`. |
| **Animated diagnostic grid** | A `<canvas>` background of slowly pulsing dots, drawn from the live `--amber`/`--amber-dim` theme tokens so it follows the scan-mode toggle. |
| **Command palette (⌘K / Ctrl+K)** | Fuzzy-filterable command list — run, new stream, open vault, view credentials, configure the AI key, switch scan mode, jump between output panes — all keyboard-navigable. |
| **Operator Profile drawer** | A slide-over panel ("view credentials" in the hero strip) with education, certifications, internships, shipped projects (DistWorkspace, TrustGuard AI, CircleUp, Codelint, the surveillance and multi-agent platforms), and stack tags — all facts already on record, laid out for a recruiter skim. |
| **Scan-mode toggle** | Swaps the amber signal accent for cyan across the whole UI via a single CSS custom-property override, persisted in `localStorage`. |
| **Live session readout** | A `session mm:ss` uptime chip and animated count-up vault stats (runs / heals / distinct languages) driven by real `localStorage` history, not placeholder numbers. |

None of this changes the honesty of the underlying architecture — it's the
same real Piston execution, real OCR/PDF/DOCX parsing, and opt-in BYOK AI
agents as before, just with a UI that reads as a finished product rather
than a first pass.

## Project structure

```
codefixern/
├── index.html     # markup + CDN script/style includes
├── style.css       # design system (dark diagnostic-panel aesthetic)
├── app.js          # all application logic
└── README.md
```

No build step, no `npm install`, no bundler. It's plain HTML/CSS/JS on purpose,
so it deploys to GitHub Pages with zero configuration.

## Run it locally

Just open `index.html` in a browser, or serve the folder to avoid any
file:// quirks:

```bash
cd codefixern
python3 -m http.server 8000
# visit http://localhost:8000
```

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `codefixern`) and push this folder's
   contents to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "CodeFixern: initial release"
   git branch -M main
   git remote add origin https://github.com/<your-username>/codefixern.git
   git push -u origin main
   ```
2. On GitHub, open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick **`main`** and the **`/ (root)`** folder, then **Save**.
5. GitHub publishes the site at `https://<your-username>.github.io/codefixern/`
   within a minute or two — no further configuration needed, since the app is
   fully static and only talks to public, CORS-enabled APIs.

## Notes, limits & honesty

- **Execution sandboxing** happens on Piston's servers, not "your" Docker — that's
  the tradeoff of a backend-less deploy. It's real isolation, just not infrastructure
  you're hosting.
- **Piston coverage**: not every language in the detector has a runnable slot in
  Piston (e.g. plain HTML has nothing to "execute"). The Run button explains
  which languages are runnable if you hit one that isn't.
- **AI agents require your own key** and therefore your own Anthropic usage/cost —
  this is intentional so the public site never needs a secret of its own.
- **Static diagnostics are heuristics**, not a full parser/AST for every language —
  they catch bracket/quote/indentation issues, not every possible bug.
- **History Vault is per-browser**, not a shared cloud history — clearing site
  data clears it.

## Roadmap (if this becomes a backend-hosted product)

- A real FastAPI/Node gateway holding provisioned Docker/MicroVM workers per
  language, replacing the Piston call with first-party sandboxing.
- Server-side RAG over language docs/compiler error corpora instead of a single
  prompt per agent call.
- A shared, authenticated History Vault instead of per-browser `localStorage`.
- LangGraph-orchestrated multi-agent diagnosis (Diagnostician → Coder →
  Optimizer → Verifier) instead of the current two-call pipeline.

## Credit

Architected and built by **Nikhil Chary Sriramoju** — B.Tech CSE, Vaagdevi
College of Engineering.
