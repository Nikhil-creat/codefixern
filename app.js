/* ===========================================================
   CODEFIXERN — application logic
   Author: Nikhil Chary Sriramoju

   Honest architecture note (read this before extending):
   This is a static site (GitHub Pages has no server), so three
   pieces of real, non-simulated capability are wired to public
   services instead of being faked:
     - Execution  -> Piston (emkc.org public API), a genuinely
       sandboxed multi-language runtime, free & keyless.
     - OCR        -> Tesseract.js, runs the OCR model in-browser.
     - PDF/DOCX   -> pdf.js / mammoth.js, parsed in-browser.
   The one piece that truly needs a large model — AI-authored
   fixes & optimized rewrites — is opt-in "bring your own key":
   with a key, requests go straight from the visitor's browser to
   Anthropic's API and nowhere else. Without a key, CodeFixern still
   fully works for detection, static diagnostics, execution and history.
   =========================================================== */

(() => {
"use strict";

/* ---------------- language detection ---------------- */

const LANGS = [
  { id: "python", label: "Python", cm: "python", piston: "python", ext: ["py"],
    test: c => /^\s*(def |import |from .+ import |class .+:|print\()/m.test(c) || /:\s*$/m.test(c) && /\bdef\b|\bfor\b|\bif\b/.test(c) },
  { id: "javascript", label: "JavaScript", cm: "javascript", piston: "javascript", ext: ["js","jsx"],
    test: c => /\b(const|let|var)\b.+=|function\s*\(|=>|console\.log|require\(|document\.|import .+ from ['"]/.test(c) },
  { id: "typescript", label: "TypeScript", cm: "javascript", piston: "typescript", ext: ["ts","tsx"],
    test: c => /:\s*(string|number|boolean|any|void)\b/.test(c) || /interface\s+\w+/.test(c) },
  { id: "java", label: "Java", cm: "text/x-java", piston: "java", ext: ["java"],
    test: c => /\b(public|private|protected)\s+(static\s+)?(class|void|int|String)\b/.test(c) || /System\.out\.print/.test(c) },
  { id: "cpp", label: "C++", cm: "text/x-c++src", piston: "c++", ext: ["cpp","cc","hpp"],
    test: c => /#include\s*<\w+>/.test(c) && /(std::|cout|cin|using namespace)/.test(c) },
  { id: "c", label: "C", cm: "text/x-csrc", piston: "c", ext: ["c","h"],
    test: c => /#include\s*<\w+\.h>/.test(c) || (/#include\s*<\w+>/.test(c) && /\bprintf\(/.test(c)) },
  { id: "csharp", label: "C#", cm: "text/x-csharp", piston: "csharp", ext: ["cs"],
    test: c => /\busing System\b/.test(c) || /Console\.WriteLine/.test(c) },
  { id: "go", label: "Go", cm: "go", piston: "go", ext: ["go"],
    test: c => /^\s*package\s+\w+/m.test(c) && /func\s+\w*\(/.test(c) },
  { id: "rust", label: "Rust", cm: "rust", piston: "rust", ext: ["rs"],
    test: c => /\bfn\s+\w+\(/.test(c) && /(let mut|println!|->\s*\w)/.test(c) },
  { id: "ruby", label: "Ruby", cm: "ruby", piston: "ruby", ext: ["rb"],
    test: c => /\bdef\s+\w+/.test(c) && /\bend\b/.test(c) && /puts\s/.test(c) },
  { id: "php", label: "PHP", cm: "php", piston: "php", ext: ["php"],
    test: c => /<\?php/.test(c) || /\$\w+\s*=/.test(c) },
  { id: "swift", label: "Swift", cm: "swift", piston: "swift", ext: ["swift"],
    test: c => /\bfunc\s+\w+\(/.test(c) && /\b(var|let)\b/.test(c) && /print\(/.test(c) },
  { id: "kotlin", label: "Kotlin", cm: "kotlin", piston: "kotlin", ext: ["kt"],
    test: c => /\bfun\s+main\s*\(/.test(c) || /\bval\s+\w+\s*=/.test(c) },
  { id: "sql", label: "SQL", cm: "sql", piston: "sqlite3", ext: ["sql"],
    test: c => /\b(SELECT|INSERT INTO|CREATE TABLE|UPDATE .+ SET)\b/i.test(c) },
  { id: "bash", label: "Shell", cm: "shell", piston: "bash", ext: ["sh"],
    test: c => /^#!\/bin\/(ba)?sh/.test(c) || /\becho\b.+\$/.test(c) },
  { id: "html", label: "HTML", cm: "htmlmixed", piston: null, ext: ["html"],
    test: c => /<\/?(html|div|body|head)[\s>]/i.test(c) },
];

function detectLanguage(code) {
  if (!code || !code.trim()) return { id: "plaintext", label: "Plain text", cm: "null", piston: null, confidence: 0 };
  for (const lang of LANGS) {
    try { if (lang.test(code)) return { ...lang, confidence: 0.8 }; } catch (e) {}
  }
  return { id: "plaintext", label: "Plain text", cm: "null", piston: null, confidence: 0 };
}

function langByExt(ext) {
  ext = (ext || "").toLowerCase();
  return LANGS.find(l => l.ext.includes(ext)) || null;
}

/* ---------------- static diagnostician (always on, local) ---------------- */

function runStaticDiagnostics(code, lang) {
  const rows = [];
  if (!code.trim()) return [{ tag: "ok", msg: "Nothing to scan yet." }];

  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closers = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  let inStr = null;
  let line = 1;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "\n") line++;
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (pairs[ch]) stack.push({ ch, line });
    else if (closers[ch]) {
      const top = stack.pop();
      if (!top || top.ch !== closers[ch]) {
        rows.push({ tag: "fault", msg: `Unmatched "${ch}"`, loc: `line ${line}` });
      }
    }
  }
  if (inStr) rows.push({ tag: "fault", msg: `Unterminated string literal (${inStr})`, loc: `near end of file` });
  stack.forEach(s => rows.push({ tag: "fault", msg: `Unclosed "${s.ch}"`, loc: `line ${s.line}` }));

  if (lang.id === "python") {
    const lines = code.split("\n");
    lines.forEach((l, idx) => {
      const trimmed = l.trim();
      if (/^(def|class|if|elif|else|for|while|try|except|finally|with)\b.*[^:]\s*$/.test(trimmed) && trimmed.length > 2 && !trimmed.endsWith(":") && !trimmed.endsWith("\\")) {
        rows.push({ tag: "warn", msg: "Block header may be missing a trailing colon", loc: `line ${idx + 1}` });
      }
    });
    if (/\t/.test(code) && / {2,}/.test(code)) {
      rows.push({ tag: "warn", msg: "Mixed tabs and spaces detected — Python is sensitive to this", loc: "file-wide" });
    }
  }

  if (["javascript", "typescript", "java", "csharp", "cpp", "c"].includes(lang.id)) {
    const lines = code.split("\n");
    lines.forEach((l, idx) => {
      const t = l.trim();
      if (t && !t.endsWith("{") && !t.endsWith("}") && !t.endsWith(";") && !t.endsWith(":")
          && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("#")
          && !/^(if|else|for|while|do|switch|try|catch|finally)\b/.test(t)
          && !/[\(\[,&&|\|\|\?:]$/.test(t) && t.length > 3) {
        // soft heuristic only — flagged as info-level, easy to be wrong here
      }
    });
  }

  if (rows.length === 0) rows.push({ tag: "ok", msg: "No structural faults found by the static scan." });
  return rows;
}

function renderDiagnostics(rows) {
  const el = document.getElementById("diagnosticsPanel");
  el.innerHTML = rows.map(r => `
    <div class="diag-row">
      <span class="diag-tag ${r.tag}">${r.tag}</span>
      <span class="diag-msg">${escapeHtml(r.msg)}</span>
      ${r.loc ? `<span class="diag-loc">${escapeHtml(r.loc)}</span>` : ""}
    </div>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- tab / editor state ---------------- */

let cm = null;
let tabs = [];
let activeTabId = null;
let tabCounter = 0;

function newTab(name, code, forcedLangId) {
  tabCounter++;
  const id = "t" + tabCounter;
  tabs.push({ id, name: name || `stream-${tabCounter}`, code: code || "", langId: forcedLangId || null });
  return id;
}

function activeTab() { return tabs.find(t => t.id === activeTabId); }

function switchTab(id) {
  const cur = activeTab();
  if (cur && cm) cur.code = cm.getValue();
  activeTabId = id;
  renderTabs();
  loadEditorFor(activeTab());
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (tabs.length === 0) newTabAndFocus();
  else if (activeTabId === id) switchTab(tabs[Math.max(0, idx - 1)].id);
  else renderTabs();
}

function newTabAndFocus() {
  const id = newTab();
  switchTab(id);
}

function renderTabs() {
  const bar = document.getElementById("tabbar");
  bar.innerHTML = "";
  tabs.forEach(t => {
    const lang = t.langId ? LANGS.find(l => l.id === t.langId) : detectLanguage(t.id === activeTabId ? cm.getValue() : t.code);
    const div = document.createElement("div");
    div.className = "tab" + (t.id === activeTabId ? " active" : "");
    div.innerHTML = `<span>${escapeHtml(t.name)}</span><span class="tab-lang">${lang.label}</span><span class="tab-close" data-close="${t.id}">×</span>`;
    div.addEventListener("click", (e) => {
      if (e.target.dataset.close) { e.stopPropagation(); closeTab(t.id); return; }
      switchTab(t.id);
    });
    bar.appendChild(div);
  });
  const add = document.createElement("div");
  add.className = "tab-add";
  add.textContent = "+";
  add.title = "New input stream";
  add.addEventListener("click", newTabAndFocus);
  bar.appendChild(add);
}

function loadEditorFor(tab) {
  if (!tab) return;
  cm.setValue(tab.code || "");
  const lang = tab.langId ? LANGS.find(l => l.id === tab.langId) : detectLanguage(tab.code);
  cm.setOption("mode", lang.cm || "null");
  updateHud(tab.code || "", lang);
  renderDiagnostics(runStaticDiagnostics(tab.code || "", lang));
}

function updateHud(code, lang) {
  document.getElementById("hudLang").innerHTML = `<span class="pulse"></span>${escapeHtml(lang.label)}${lang.confidence ? "" : " (unrecognized)"}`;
  const lines = code.split("\n").length;
  document.getElementById("hudMeta").textContent = `${lines} lines · ${code.length} chars`;
}

/* ---------------- Piston execution ---------------- */

const PISTON_BASE = "https://emkc.org/api/v2/piston";
let runtimeCache = null;

async function getRuntimes() {
  if (runtimeCache) return runtimeCache;
  const res = await fetch(`${PISTON_BASE}/runtimes`);
  if (!res.ok) throw new Error("Could not reach the execution service.");
  runtimeCache = await res.json();
  return runtimeCache;
}

async function runOnPiston(langId, code) {
  const langDef = LANGS.find(l => l.id === langId);
  if (!langDef || !langDef.piston) {
    throw new Error(`${langDef ? langDef.label : "This language"} has no runnable interpreter wired up — try Python, JS, Java, C/C++, Go, Rust, Ruby, PHP, C#, Kotlin, Swift, SQL (sqlite) or Bash.`);
  }
  const runtimes = await getRuntimes();
  const match = runtimes.find(r => r.language === langDef.piston || (r.aliases || []).includes(langDef.piston));
  if (!match) throw new Error(`No runtime currently available for ${langDef.label}.`);
  const fileExt = (match.language === "java") ? "java" : (langDef.ext[0] || "txt");
  const res = await fetch(`${PISTON_BASE}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: match.language,
      version: match.version,
      files: [{ name: `main.${fileExt}`, content: code }],
    }),
  });
  if (!res.ok) throw new Error(`Execution service returned ${res.status}.`);
  return res.json();
}

function renderTerminal(html) {
  document.getElementById("terminal").innerHTML = html;
  const t = document.getElementById("terminal");
  t.scrollTop = t.scrollHeight;
}

/* ---------------- BYOK: Anthropic-powered Coder/Optimizer agents ---------------- */

function getApiKey() { return localStorage.getItem("codefixern_api_key") || ""; }

async function callClaude(systemPrompt, userPrompt) {
  const key = getApiKey();
  if (!key) throw new Error("No API key configured.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content || []).map(b => b.text || "").join("\n");
}

async function runAgentPipeline(langLabel, code) {
  const log = document.getElementById("agentsLog");
  const append = (name, text) => {
    const row = document.createElement("div");
    row.className = "agent-row";
    row.innerHTML = `<div class="agent-name">${name}</div><div class="agent-text">${text}</div>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  };

  append("CODER", "Requesting a healed version from Claude…");
  const healPrompt = `You are fixing broken ${langLabel} code. Return ONLY the corrected, complete source code with no explanation, no markdown fences.\n\nCODE:\n${code}`;
  const healed = (await callClaude("You are a precise code-repair engine. Output only raw corrected source code, nothing else — no markdown fences, no commentary.", healPrompt)).trim();
  append("CODER", "Healed version received (" + healed.split("\n").length + " lines).");

  append("OPTIMIZER", "Requesting a concise optimized rewrite…");
  const optPrompt = `Rewrite this corrected ${langLabel} code to be more concise and idiomatic WITHOUT changing its behavior. Return ONLY the code, no explanation, no markdown fences.\n\nCODE:\n${healed}`;
  const optimized = (await callClaude("You are a code-optimization engine. Output only raw optimized source code, nothing else.", optPrompt)).trim();
  append("OPTIMIZER", "Optimized version received (" + optimized.split("\n").length + " lines).");

  return { healed, optimized };
}

function renderDiff(original, healed) {
  const body = document.getElementById("diffBody");
  if (!window.Diff) { body.innerHTML = `<div class="diff-empty">Diff library unavailable.</div>`; return; }
  const parts = Diff.diffLines(original, healed);
  let html = "";
  parts.forEach(p => {
    const cls = p.added ? "diff-add" : p.removed ? "diff-del" : "diff-ctx";
    const prefix = p.added ? "+ " : p.removed ? "- " : "  ";
    p.value.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === "")).forEach(line => {
      html += `<div class="diff-line ${cls}">${prefix}${escapeHtml(line)}</div>`;
    });
  });
  body.innerHTML = html || `<div class="diff-empty">No differences.</div>`;
}

/* ---------------- history vault ---------------- */

const VAULT_KEY = "codefixern_vault";

function loadVault() {
  try { return JSON.parse(localStorage.getItem(VAULT_KEY) || "[]"); } catch (e) { return []; }
}

function saveVaultEntry(entry) {
  const vault = loadVault();
  vault.unshift(entry);
  while (vault.length > 60) vault.pop();
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  renderVault();
}

function renderVault() {
  const vault = loadVault();
  const list = document.getElementById("vaultList");
  const countText = `${vault.length} session${vault.length === 1 ? "" : "s"} logged`;
  document.getElementById("vaultCount").textContent = countText;
  const chip = document.getElementById("statVaultChip");
  if (chip) chip.textContent = countText;

  animateCount("statRuns", vault.filter(v => v.action === "ran").length);
  animateCount("statHeals", vault.filter(v => v.action === "healed").length);
  animateCount("statLangs", new Set(vault.map(v => v.lang)).size);

  if (vault.length === 0) {
    list.innerHTML = `<div class="vault-empty">Nothing archived yet. Every diagnose or run is logged here, in this browser only, so you can roll back to an earlier version.</div>`;
    return;
  }
  list.innerHTML = vault.map(v => `
    <div class="vault-item" data-id="${v.id}">
      <div class="vault-item-top">
        <span class="vault-item-lang">${escapeHtml(v.lang)}</span>
        <span class="vault-item-time">${new Date(v.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div class="vault-item-name">${escapeHtml(v.name)} · ${v.action}</div>
    </div>`).join("");
  list.querySelectorAll(".vault-item").forEach(el => {
    el.addEventListener("click", () => {
      const v = vault.find(x => x.id === el.dataset.id);
      if (!v) return;
      const id = newTab(v.name + " (restored)", v.code, null);
      switchTab(id);
      closeVaultDrawer();
    });
  });
}

function animateCount(elId, target) {
  const el = document.getElementById(elId);
  if (!el) return;
  const from = parseInt(el.textContent, 10) || 0;
  if (from === target) { el.textContent = target; return; }
  const start = performance.now();
  const dur = 420;
  function step(now) {
    const t = Math.min(1, (now - start) / dur);
    const val = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)));
    el.textContent = val;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------------- file ingestion ---------------- */

async function ingestFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const statusEl = document.getElementById("dropzoneStatus");
  statusEl.textContent = `reading ${file.name}…`;
  try {
    let text = "";
    if (ext === "pdf") {
      text = await extractPdf(file);
    } else if (ext === "docx") {
      text = await extractDocx(file);
    } else if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
      statusEl.textContent = `running OCR on ${file.name}…`;
      text = await extractImage(file);
    } else {
      text = await file.text();
    }
    const forced = langByExt(ext);
    const id = newTab(file.name, text, forced ? forced.id : null);
    switchTab(id);
    statusEl.textContent = `loaded ${file.name}`;
    setTimeout(() => { statusEl.textContent = ""; }, 3000);
  } catch (e) {
    statusEl.textContent = `failed to read ${file.name}: ${e.message}`;
  }
}

async function extractPdf(file) {
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map(it => it.str).join(" ") + "\n";
  }
  return out.trim();
}

async function extractDocx(file) {
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value.trim();
}

async function extractImage(file) {
  const { data } = await Tesseract.recognize(file, "eng");
  return data.text.trim();
}

/* ---------------- boot sequence ---------------- */

const BOOT_LINES = [
  { t: "codefixern v2.0 — cinematic build", cls: "line-dim" },
  { t: "operator: Nikhil Chary Sriramoju", cls: "line-dim" },
  { t: "mounting diagnostics engine…", cls: "line-ok" },
  { t: "linking execution runtime (piston)…", cls: "line-ok" },
  { t: "linking OCR / PDF / DOCX ingestion…", cls: "line-ok" },
  { t: "checking for AI agent key…", cls: "line-ok" },
  { t: "no local Docker daemon — using sandboxed public runtime", cls: "line-fault" },
  { t: "history vault: local storage online", cls: "line-ok" },
  { t: "all systems nominal — launching interface", cls: "line-ok" },
];

function initBoot() {
  const overlay = document.getElementById("bootOverlay");
  const linesEl = document.getElementById("bootLines");
  const fill = document.getElementById("bootProgressFill");
  const skipBtn = document.getElementById("bootSkip");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduced || sessionStorage.getItem("codefixern_booted")) {
    overlay.classList.add("hidden");
    return;
  }

  let i = 0;
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    sessionStorage.setItem("codefixern_booted", "1");
    overlay.classList.add("hidden");
  }
  skipBtn.addEventListener("click", finish);

  function typeLine() {
    if (done) return;
    if (i >= BOOT_LINES.length) { setTimeout(finish, 260); return; }
    const row = document.createElement("div");
    row.className = BOOT_LINES[i].cls;
    linesEl.appendChild(row);
    const text = "> " + BOOT_LINES[i].t;
    let c = 0;
    fill.style.width = `${Math.round(((i + 1) / BOOT_LINES.length) * 100)}%`;
    const typer = setInterval(() => {
      row.textContent = text.slice(0, c) + " ";
      c++;
      if (c > text.length) {
        clearInterval(typer);
        row.textContent = text;
        i++;
        setTimeout(typeLine, 90);
      }
    }, 12);
  }
  typeLine();
  setTimeout(finish, 4200); // hard cap so it never blocks a real visitor
}

/* ---------------- animated background grid ---------------- */

function initBgCanvas() {
  const canvas = document.getElementById("bgCanvas");
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h, dots = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const spacing = 46;
    dots = [];
    for (let x = spacing / 2; x < w; x += spacing) {
      for (let y = spacing / 2; y < h; y += spacing) {
        dots.push({ x, y, phase: Math.random() * Math.PI * 2 });
      }
    }
  }
  window.addEventListener("resize", resize);
  resize();

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(document.body).getPropertyValue("--amber").trim() || "#e8a33d";
    dots.forEach(d => {
      const a = reduced ? 0.14 : 0.06 + 0.10 * (0.5 + 0.5 * Math.sin(t / 1800 + d.phase));
      ctx.fillStyle = hexToRgba(accent, a);
      ctx.fillRect(d.x, d.y, 1.4, 1.4);
    });
    if (!reduced) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}

function hexToRgba(hex, alpha) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ---------------- hero typed tagline ---------------- */

const HERO_LINES = [
  "Full-Stack Systems & AI/ML Builder — B.Tech CSE, Vaagdevi College of Engineering, class of 2027.",
  "3× NASSCOM / IBM / Reliance Foundation certified in AI, data engineering & cloud infrastructure.",
  "Shipped: DistWorkspace (Raft + CRDT), TrustGuard AI (PR-AUC 0.839), CircleUp, Codelint.",
  "ML Engineer Intern @ Yuva Intern (NSDC) · Data Analytics Intern @ Thiranex.",
];

function initHeroTyped() {
  const el = document.getElementById("heroTyped");
  if (!el) return;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) { el.textContent = HERO_LINES[0]; return; }
  let li = 0, ci = 0, deleting = false;
  function tick() {
    const full = HERO_LINES[li];
    el.textContent = deleting ? full.slice(0, ci--) : full.slice(0, ci++);
    let delay = deleting ? 16 : 26;
    if (!deleting && ci > full.length) { deleting = true; delay = 1400; }
    else if (deleting && ci < 0) { deleting = false; ci = 0; li = (li + 1) % HERO_LINES.length; delay = 300; }
    setTimeout(tick, delay);
  }
  tick();
}

/* ---------------- session uptime ---------------- */

function startUptimeTicker() {
  const start = Date.now();
  const el = document.getElementById("uptimeChip");
  setInterval(() => {
    const s = Math.floor((Date.now() - start) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    el.textContent = `session ${mm}:${ss}`;
  }, 1000);
}

/* ---------------- accent / scan-mode toggle ---------------- */

function initAccentToggle() {
  const saved = localStorage.getItem("codefixern_scan_mode");
  if (saved) document.body.setAttribute("data-scan", saved);
  document.getElementById("accentToggle").addEventListener("click", () => {
    const cur = document.body.getAttribute("data-scan") === "cyan" ? "amber" : "cyan";
    document.body.setAttribute("data-scan", cur);
    localStorage.setItem("codefixern_scan_mode", cur);
  });
}

/* ---------------- credentials drawer ---------------- */

function initCredentials() {
  const scrim = document.getElementById("credScrim");
  const open = () => scrim.classList.add("open");
  const close = () => scrim.classList.remove("open");
  document.getElementById("openCredentials").addEventListener("click", open);
  document.getElementById("credClose").addEventListener("click", close);
  scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
  return { open, close };
}

/* ---------------- hero strip collapse ---------------- */

function initHeroCollapse() {
  const strip = document.getElementById("heroStrip");
  const btn = document.getElementById("heroCollapse");
  btn.addEventListener("click", () => {
    strip.classList.toggle("collapsed");
    btn.textContent = strip.classList.contains("collapsed") ? "﹀" : "︿";
  });
}

/* ---------------- command palette ---------------- */

function buildCommands(handles) {
  return [
    { label: "Run active stream", hint: "⏎", run: () => onRun() },
    { label: "New input stream", hint: "+", run: () => newTabAndFocus() },
    { label: "Open history vault", hint: "☰", run: () => openVaultDrawer() },
    { label: "View credentials", hint: "◎", run: () => handles.cred.open() },
    { label: "Configure AI agent key", hint: "⚙", run: () => document.getElementById("settingsBtn").click() },
    { label: "Toggle scan mode (amber / cyan)", hint: "◐", run: () => document.getElementById("accentToggle").click() },
    { label: "Clear history vault", hint: "⌫", run: () => document.getElementById("clearVaultBtn").click() },
    { label: "Switch to Terminal output", hint: "1", run: () => switchOutputPane("terminal") },
    { label: "Switch to Agent Log output", hint: "2", run: () => switchOutputPane("agents") },
    { label: "Switch to Diff output", hint: "3", run: () => switchOutputPane("diff") },
  ];
}

function initCommandPalette(handles) {
  const scrim = document.getElementById("cmdkScrim");
  const input = document.getElementById("cmdkInput");
  const list = document.getElementById("cmdkList");
  const commands = buildCommands(handles);
  let filtered = commands;
  let sel = 0;

  function render() {
    list.innerHTML = filtered.length
      ? filtered.map((c, idx) => `<div class="cmdk-item${idx === sel ? " sel" : ""}" data-idx="${idx}"><span>${escapeHtml(c.label)}</span><span class="cmdk-item-hint">${escapeHtml(c.hint)}</span></div>`).join("")
      : `<div class="cmdk-empty">No matching command.</div>`;
    list.querySelectorAll(".cmdk-item").forEach(el => {
      el.addEventListener("click", () => { runSelected(parseInt(el.dataset.idx, 10)); });
    });
  }

  function runSelected(idx) {
    const cmd = filtered[idx];
    close();
    if (cmd) cmd.run();
  }

  function open() {
    scrim.classList.add("open");
    input.value = "";
    filtered = commands;
    sel = 0;
    render();
    setTimeout(() => input.focus(), 20);
  }
  function close() { scrim.classList.remove("open"); }

  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    filtered = commands.filter(c => c.label.toLowerCase().includes(q));
    sel = 0;
    render();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(filtered.length - 1, sel + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); runSelected(sel); }
    else if (e.key === "Escape") { close(); }
  });
  scrim.addEventListener("click", e => { if (e.target === scrim) close(); });
  document.getElementById("cmdkBtn").addEventListener("click", open);

  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      scrim.classList.contains("open") ? close() : open();
    }
  });

  return { open, close };
}

/* ---------------- wiring ---------------- */

function setEngineStatus(text, live) {
  document.getElementById("engineStatusText").textContent = text;
  document.getElementById("engineDot").classList.toggle("live", !!live);
}

function openVaultDrawer() {
  document.getElementById("vault").classList.add("open");
  document.getElementById("vaultScrim").classList.add("open");
}
function closeVaultDrawer() {
  document.getElementById("vault").classList.remove("open");
  document.getElementById("vaultScrim").classList.remove("open");
}

function switchOutputPane(name) {
  document.querySelectorAll(".outputs-tab").forEach(t => t.classList.toggle("active", t.dataset.pane === name));
  document.querySelectorAll(".output-pane").forEach(p => p.classList.toggle("active", p.dataset.pane === name));
}

function init() {
  initBoot();
  initBgCanvas();
  initHeroTyped();
  initHeroCollapse();
  startUptimeTicker();
  initAccentToggle();
  const credHandles = initCredentials();
  initCommandPalette({ cred: credHandles });

  cm = CodeMirror.fromTextArea(document.getElementById("editorHost"), {
    lineNumbers: true,
    theme: "dracula",
    mode: "python",
    indentUnit: 4,
    tabSize: 4,
    viewportMargin: Infinity,
    extraKeys: { "Tab": cm => cm.replaceSelection("    ") },
  });

  const seedId = newTab("main", `# Type or paste code — CodeFixern detects the language live.\ndef greet(name):\n    print("Hello, " + name)\n\ngreet("world")\n`);
  activeTabId = seedId;
  renderTabs();
  loadEditorFor(activeTab());

  let debounce = null;
  cm.on("change", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const code = cm.getValue();
      const tab = activeTab();
      tab.code = code;
      const lang = detectLanguage(code);
      cm.setOption("mode", lang.cm || "null");
      updateHud(code, lang);
      renderDiagnostics(runStaticDiagnostics(code, lang));
      renderTabs();
    }, 220);
  });

  // drawer
  document.getElementById("drawerToggle").addEventListener("click", openVaultDrawer);
  document.getElementById("vaultScrim").addEventListener("click", closeVaultDrawer);

  // output tab switching
  document.querySelectorAll(".outputs-tab").forEach(t => t.addEventListener("click", () => switchOutputPane(t.dataset.pane)));

  // file ingestion
  const dz = document.getElementById("dropzone");
  document.getElementById("fileInput").addEventListener("change", e => {
    [...e.target.files].forEach(ingestFile);
    e.target.value = "";
  });
  ["dragover"].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.remove("dragover"); }));
  dz.addEventListener("drop", e => { [...e.dataTransfer.files].forEach(ingestFile); });

  // settings modal
  const scrim = document.getElementById("settingsScrim");
  const openSettings = () => { document.getElementById("apiKeyInput").value = getApiKey(); scrim.classList.add("open"); };
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("byokInlineBtn").addEventListener("click", openSettings);
  document.getElementById("settingsCancel").addEventListener("click", () => scrim.classList.remove("open"));
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.classList.remove("open"); });
  document.getElementById("settingsSave").addEventListener("click", () => {
    const val = document.getElementById("apiKeyInput").value.trim();
    if (val) localStorage.setItem("codefixern_api_key", val);
    scrim.classList.remove("open");
    updateByokNote();
  });
  document.getElementById("settingsRemove").addEventListener("click", () => {
    localStorage.removeItem("codefixern_api_key");
    document.getElementById("apiKeyInput").value = "";
    updateByokNote();
  });

  function updateByokNote() {
    const note = document.getElementById("byokNote");
    note.innerHTML = getApiKey()
      ? `AI agent key configured. <button id="byokInlineBtn2">Change or remove</button>`
      : `No AI agent key configured. <button id="byokInlineBtn2">Add your API key</button> to enable real fix &amp; optimize passes.`;
    document.getElementById("byokInlineBtn2").addEventListener("click", openSettings);
  }
  updateByokNote();

  // clear vault
  document.getElementById("clearVaultBtn").addEventListener("click", () => {
    if (confirm("Clear all archived sessions from this browser?")) {
      localStorage.removeItem(VAULT_KEY);
      renderVault();
    }
  });
  renderVault();

  // RUN
  document.getElementById("runBtn").addEventListener("click", onRun);
}

async function onRun() {
  const tab = activeTab();
  const code = cm.getValue();
  tab.code = code;
  const lang = tab.langId ? LANGS.find(l => l.id === tab.langId) : detectLanguage(code);

  const runBtn = document.getElementById("runBtn");
  runBtn.disabled = true;
  runBtn.classList.add("running");
  runBtn.textContent = "Running…";
  setEngineStatus("runtime: executing", true);
  switchOutputPane("terminal");
  renderTerminal(`<span class="meta">$ dispatching ${escapeHtml(lang.label)} to sandboxed runtime…</span>`);

  try {
    const result = await runOnPiston(lang.id, code);
    const run = result.run || {};
    const compile = result.compile;
    let html = "";
    if (compile && compile.stderr) {
      html += `<div class="meta">--- compile ---</div><span class="stderr">${escapeHtml(compile.stderr)}</span>\n\n`;
    }
    html += `<div class="meta">--- stdout ---</div>${escapeHtml(run.stdout || "(empty)")}\n`;
    if (run.stderr) html += `\n<div class="meta">--- stderr ---</div><span class="stderr">${escapeHtml(run.stderr)}</span>\n`;
    html += `\n<div class="meta">exit code: ${run.code === undefined ? "n/a" : run.code} · runtime: ${escapeHtml(result.version || "")}</div>`;
    renderTerminal(html);
    setEngineStatus("runtime: idle", false);

    saveVaultEntry({ id: "v" + Date.now(), ts: Date.now(), lang: lang.label, name: tab.name, action: "ran", code });

    // Static diagnostics refresh
    renderDiagnostics(runStaticDiagnostics(code, lang));

    // Optional AI agent pass
    if (getApiKey()) {
      switchOutputPane("agents");
      try {
        const { healed } = await runAgentPipeline(lang.label, code);
        renderDiff(code, healed);
        saveVaultEntry({ id: "v" + (Date.now() + 1), ts: Date.now(), lang: lang.label, name: tab.name, action: "healed", code: healed });
      } catch (e) {
        const log = document.getElementById("agentsLog");
        const row = document.createElement("div");
        row.className = "agent-row";
        row.innerHTML = `<div class="agent-name">ERROR</div><div class="agent-text">${escapeHtml(e.message)}</div>`;
        log.appendChild(row);
      }
    }
  } catch (e) {
    renderTerminal(`<span class="stderr">${escapeHtml(e.message)}</span>`);
    setEngineStatus("runtime: error", false);
  } finally {
    runBtn.disabled = false;
    runBtn.classList.remove("running");
    runBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Run`;
  }
}

document.addEventListener("DOMContentLoaded", init);
})();
