/* ===========================================================
   CODEFIXERN — application logic
   Author: Nikhil Chary Sriramoju

   Honest architecture note (read this before extending):
   This is a static site (GitHub Pages has no server), so every
   piece of real, non-simulated capability below is wired to
   something that genuinely runs, not faked:
     - Python execution    -> Pyodide (CPython compiled to WASM),
       runs for real, fully in-browser, free forever, no key.
     - JavaScript execution -> a sandboxed, locked-down iframe
       (scripts only, no same-origin) — real V8, in your browser.
     - SQL execution        -> sql.js (SQLite compiled to WASM),
       a real embedded database, in-browser, no key.
     - Compiled languages (Java, C/C++, C#, Go, Rust, Ruby, PHP,
       Swift, Kotlin, Bash) -> Judge0 CE via RapidAPI, opt-in
       "bring your own key" (RapidAPI's free tier covers this).
     - OCR        -> Tesseract.js, a real CNN+LSTM OCR model,
       runs in-browser.
     - PDF/DOCX   -> pdf.js / mammoth.js, parsed in-browser.
     - AI Coder/Optimizer agents -> opt-in BYOK against Anthropic,
       Groq, or Gemini (your choice) — requests go straight from
       your browser to that provider, nowhere else.
   Note for future maintainers: the public Piston API (emkc.org)
   that earlier builds used now requires a manually-issued key
   from its maintainer (not self-serve), so it was replaced with
   the engines above rather than left silently returning 401.
   =========================================================== */

(() => {
"use strict";

/* ---------------- language detection ---------------- */
/* engine: "pyodide" | "iframe-js" | "sqljs" | "judge0" | null (no runner) */

const LANGS = [
  { id: "python", label: "Python", cm: "python", engine: "pyodide", judge0: 71, ext: ["py"],
    test: c => /^\s*(def |import |from .+ import |class .+:|print\()/m.test(c) || /:\s*$/m.test(c) && /\bdef\b|\bfor\b|\bif\b/.test(c) },
  { id: "javascript", label: "JavaScript", cm: "javascript", engine: "iframe-js", judge0: 63, ext: ["js","jsx"],
    test: c => /\b(const|let|var)\b.+=|function\s*\(|=>|console\.log|require\(|document\.|import .+ from ['"]/.test(c) },
  { id: "typescript", label: "TypeScript", cm: "javascript", engine: "judge0", judge0: 74, ext: ["ts","tsx"],
    test: c => /:\s*(string|number|boolean|any|void)\b/.test(c) || /interface\s+\w+/.test(c) },
  { id: "java", label: "Java", cm: "text/x-java", engine: "judge0", judge0: 62, ext: ["java"],
    test: c => /\b(public|private|protected)\s+(static\s+)?(class|void|int|String)\b/.test(c) || /System\.out\.print/.test(c) },
  { id: "cpp", label: "C++", cm: "text/x-c++src", engine: "judge0", judge0: 54, ext: ["cpp","cc","hpp"],
    test: c => /#include\s*<\w+>/.test(c) && /(std::|cout|cin|using namespace)/.test(c) },
  { id: "c", label: "C", cm: "text/x-csrc", engine: "judge0", judge0: 50, ext: ["c","h"],
    test: c => /#include\s*<\w+\.h>/.test(c) || (/#include\s*<\w+>/.test(c) && /\bprintf\(/.test(c)) },
  { id: "csharp", label: "C#", cm: "text/x-csharp", engine: "judge0", judge0: 51, ext: ["cs"],
    test: c => /\busing System\b/.test(c) || /Console\.WriteLine/.test(c) },
  { id: "go", label: "Go", cm: "go", engine: "judge0", judge0: 60, ext: ["go"],
    test: c => /^\s*package\s+\w+/m.test(c) && /func\s+\w*\(/.test(c) },
  { id: "rust", label: "Rust", cm: "rust", engine: "judge0", judge0: 73, ext: ["rs"],
    test: c => /\bfn\s+\w+\(/.test(c) && /(let mut|println!|->\s*\w)/.test(c) },
  { id: "ruby", label: "Ruby", cm: "ruby", engine: "judge0", judge0: 72, ext: ["rb"],
    test: c => /\bdef\s+\w+/.test(c) && /\bend\b/.test(c) && /puts\s/.test(c) },
  { id: "php", label: "PHP", cm: "php", engine: "judge0", judge0: 68, ext: ["php"],
    test: c => /<\?php/.test(c) || /\$\w+\s*=/.test(c) },
  { id: "swift", label: "Swift", cm: "swift", engine: "judge0", judge0: 83, ext: ["swift"],
    test: c => /\bfunc\s+\w+\(/.test(c) && /\b(var|let)\b/.test(c) && /print\(/.test(c) },
  { id: "kotlin", label: "Kotlin", cm: "kotlin", engine: "judge0", judge0: 78, ext: ["kt"],
    test: c => /\bfun\s+main\s*\(/.test(c) || /\bval\s+\w+\s*=/.test(c) },
  { id: "sql", label: "SQL", cm: "sql", engine: "sqljs", judge0: 82, ext: ["sql"],
    test: c => /\b(SELECT|INSERT INTO|CREATE TABLE|UPDATE .+ SET)\b/i.test(c) },
  { id: "bash", label: "Shell", cm: "shell", engine: "judge0", judge0: 46, ext: ["sh"],
    test: c => /^#!\/bin\/(ba)?sh/.test(c) || /\becho\b.+\$/.test(c) },
  { id: "html", label: "HTML", cm: "htmlmixed", engine: null, judge0: null, ext: ["html"],
    test: c => /<\/?(html|div|body|head)[\s>]/i.test(c) },
];

function detectLanguage(code) {
  if (!code || !code.trim()) return { id: "plaintext", label: "Plain text", cm: "null", engine: null, judge0: null, confidence: 0 };
  for (const lang of LANGS) {
    try { if (lang.test(code)) return { ...lang, confidence: 0.8 }; } catch (e) {}
  }
  return { id: "plaintext", label: "Plain text", cm: "null", engine: null, judge0: null, confidence: 0 };
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
        rows.push({ tag: "fault", msg: `Unmatched "${ch}"`, loc: `line ${line}`, line });
      }
    }
  }
  if (inStr) rows.push({ tag: "fault", msg: `Unterminated string literal (${inStr})`, loc: `near end of file` });
  stack.forEach(s => rows.push({ tag: "fault", msg: `Unclosed "${s.ch}"`, loc: `line ${s.line}`, line: s.line }));

  if (lang.id === "python") {
    const lines = code.split("\n");
    lines.forEach((l, idx) => {
      const trimmed = l.trim();
      if (/^(def|class|if|elif|else|for|while|try|except|finally|with)\b.*[^:]\s*$/.test(trimmed) && trimmed.length > 2 && !trimmed.endsWith(":") && !trimmed.endsWith("\\")) {
        rows.push({ tag: "warn", msg: "Block header may be missing a trailing colon", loc: `line ${idx + 1}`, line: idx + 1 });
      }
    });
    if (/\t/.test(code) && / {2,}/.test(code)) {
      rows.push({ tag: "warn", msg: "Mixed tabs and spaces detected — Python is sensitive to this", loc: "file-wide" });
    }
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
  markEditorGutter(rows);
}

function markEditorGutter(rows) {
  if (!cm) return;
  cm.clearGutter("diag-gutter");
  cm.eachLine(l => cm.removeLineClass(l, "background", "diag-line-fault"));
  rows.forEach(r => {
    if (!r.line || r.line < 1) return;
    const lineIdx = r.line - 1;
    if (lineIdx >= cm.lineCount()) return;
    const marker = document.createElement("div");
    marker.className = `gutter-mark gutter-${r.tag}`;
    marker.title = `[${r.tag}] ${r.msg}`;
    marker.textContent = r.tag === "fault" ? "●" : r.tag === "warn" ? "●" : "";
    if (marker.textContent) cm.setGutterMarker(lineIdx, "diag-gutter", marker);
    if (r.tag === "fault") cm.addLineClass(lineIdx, "background", "diag-line-fault");
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- tab / editor state ---------------- */

let cm = null;
let tabs = [];
let activeTabId = null;
let tabCounter = 0;

const TABS_KEY = "codefixern_tabs_v1";
let saveTabsTimer = null;

function saveTabsToStorage() {
  clearTimeout(saveTabsTimer);
  saveTabsTimer = setTimeout(() => {
    const cur = activeTab();
    if (cur && cm) cur.code = cm.getValue();
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTabId, tabCounter }));
    } catch (e) { /* storage full or unavailable — session just won't persist */ }
  }, 300);
}

function restoreTabsFromStorage() {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return false;
    tabs = data.tabs;
    activeTabId = data.activeTabId || tabs[0].id;
    tabCounter = data.tabCounter || tabs.length;
    if (!tabs.find(t => t.id === activeTabId)) activeTabId = tabs[0].id;
    return true;
  } catch (e) { return false; }
}

function newTab(name, code, forcedLangId) {
  tabCounter++;
  const id = "t" + tabCounter;
  tabs.push({ id, name: name || `stream-${tabCounter}`, code: code || "", langId: forcedLangId || null });
  saveTabsToStorage();
  return id;
}

function activeTab() { return tabs.find(t => t.id === activeTabId); }

function switchTab(id) {
  const cur = activeTab();
  if (cur && cm) cur.code = cm.getValue();
  activeTabId = id;
  renderTabs();
  loadEditorFor(activeTab());
  saveTabsToStorage();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  tabs.splice(idx, 1);
  if (tabs.length === 0) newTabAndFocus();
  else if (activeTabId === id) switchTab(tabs[Math.max(0, idx - 1)].id);
  else renderTabs();
  saveTabsToStorage();
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

/* ---------------- execution engines ---------------- */
/* Each returns a normalized { stdout, stderr, exitCode, engineLabel } */

// -- Python, via Pyodide (real CPython-on-WASM, in-browser, free, no key) --
let pyodideInstance = null;
let pyodideLoading = null;

function loadPyodideOnce() {
  if (pyodideInstance) return Promise.resolve(pyodideInstance);
  if (pyodideLoading) return pyodideLoading;
  pyodideLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";
    script.onload = async () => {
      try {
        pyodideInstance = await window.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
        resolve(pyodideInstance);
      } catch (e) { reject(e); }
    };
    script.onerror = () => reject(new Error("Could not load the Python runtime (Pyodide) — check your connection."));
    document.head.appendChild(script);
  });
  return pyodideLoading;
}

async function runPython(code) {
  const py = await loadPyodideOnce();
  py.setStdout({ batched: () => {} });
  py.setStderr({ batched: () => {} });
  let stdout = "", stderr = "";
  py.setStdout({ batched: (s) => { stdout += s + "\n"; } });
  py.setStderr({ batched: (s) => { stderr += s + "\n"; } });
  let exitCode = 0;
  try {
    await py.runPythonAsync(code);
  } catch (e) {
    stderr += String(e.message || e);
    exitCode = 1;
  }
  return { stdout, stderr, exitCode, engineLabel: "Pyodide (CPython → WASM, in-browser)" };
}

// -- JavaScript, via a locked-down sandboxed iframe (real V8, in-browser) --
function runJavaScript(code) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts";
    iframe.style.display = "none";
    const reqId = "cf" + Math.random().toString(36).slice(2);
    let settled = false;

    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      iframe.remove();
    };
    const onMsg = (ev) => {
      if (!ev.data || ev.data.reqId !== reqId) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: ev.data.stdout || "", stderr: ev.data.stderr || "", exitCode: ev.data.stderr ? 1 : 0, engineLabel: "sandboxed iframe (real V8, in-browser)" });
      cleanup();
    };
    window.addEventListener("message", onMsg);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ stdout: "", stderr: "Execution timed out after 6s (possible infinite loop).", exitCode: 1, engineLabel: "sandboxed iframe" });
      cleanup();
    }, 6000);

    const userCode = String(code).replace(/<\/script>/gi, "<\\/script>");
    iframe.srcdoc = `<!DOCTYPE html><html><body><script>
      const logs = [], errs = [];
      const send = () => parent.postMessage({ reqId: ${JSON.stringify(reqId)}, stdout: logs.join("\\n"), stderr: errs.join("\\n") }, "*");
      console.log = (...a) => logs.push(a.map(x => typeof x === "object" ? JSON.stringify(x) : String(x)).join(" "));
      console.error = (...a) => errs.push(a.map(String).join(" "));
      window.onerror = (msg) => { errs.push(String(msg)); send(); };
      try {
        ${userCode}
      } catch (e) { errs.push(e && e.stack ? e.stack : String(e)); }
      send();
    <\/script></body></html>`;
    document.body.appendChild(iframe);
  });
}

// -- SQL, via sql.js (real SQLite compiled to WASM, in-browser) --
let sqlJsInstance = null;
function loadSqlJsOnce() {
  if (sqlJsInstance) return Promise.resolve(sqlJsInstance);
  return initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` })
    .then(SQL => { sqlJsInstance = SQL; return SQL; });
}

async function runSql(code) {
  const SQL = await loadSqlJsOnce();
  const db = new SQL.Database();
  let stdout = "", stderr = "";
  try {
    const results = db.exec(code); // returns [{ columns, values }] for the last SELECT-producing statements
    if (results.length === 0) {
      stdout = "(no rows returned — statement(s) executed successfully)";
    } else {
      results.forEach(r => {
        stdout += r.columns.join(" | ") + "\n" + r.columns.map(() => "---").join("-|-") + "\n";
        r.values.forEach(row => { stdout += row.join(" | ") + "\n"; });
        stdout += "\n";
      });
    }
  } catch (e) {
    stderr = e.message || String(e);
  } finally {
    db.close();
  }
  return { stdout: stdout.trim(), stderr, exitCode: stderr ? 1 : 0, engineLabel: "sql.js (SQLite → WASM, in-browser)" };
}

// -- Compiled languages, via Judge0 CE on RapidAPI (opt-in BYOK) --
async function runJudge0(langDef, code) {
  const key = getRapidApiKey();
  if (!key) {
    throw new Error(`${langDef.label} needs a compiled-language runtime that can't run in a browser sandbox. Add a free RapidAPI "Judge0 CE" key in Settings to enable it — Python, JavaScript, and SQL already run with no key at all.`);
  }
  const submitRes = await fetch("https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=true&wait=true&fields=stdout,stderr,compile_output,status,message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": key,
      "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
    },
    body: JSON.stringify({
      language_id: langDef.judge0,
      source_code: b64(code),
    }),
  });
  if (submitRes.status === 401 || submitRes.status === 403) throw new Error("RapidAPI rejected the Judge0 key — check it in Settings.");
  if (!submitRes.ok) throw new Error(`Judge0 returned ${submitRes.status}.`);
  const data = await submitRes.json();
  const stdout = data.stdout ? atobUtf8(data.stdout) : "";
  const compileOut = data.compile_output ? atobUtf8(data.compile_output) : "";
  const stderr = [data.stderr ? atobUtf8(data.stderr) : "", compileOut].filter(Boolean).join("\n");
  const status = (data.status && data.status.description) || "done";
  return { stdout, stderr, exitCode: status === "Accepted" ? 0 : 1, engineLabel: `Judge0 CE (${status})` };
}

function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
function atobUtf8(str) { try { return decodeURIComponent(escape(atob(str))); } catch (e) { return atob(str); } }

async function runCode(langId, code) {
  const langDef = LANGS.find(l => l.id === langId);
  if (!langDef || !langDef.engine) {
    throw new Error(`${langDef ? langDef.label : "This language"} has no runnable engine wired up — try Python, JavaScript, SQL (run instantly, no key), or a compiled language with a RapidAPI Judge0 key added in Settings.`);
  }
  if (langDef.engine === "pyodide") return runPython(code);
  if (langDef.engine === "iframe-js") return runJavaScript(code);
  if (langDef.engine === "sqljs") return runSql(code);
  if (langDef.engine === "judge0") return runJudge0(langDef, code);
  throw new Error("Unknown execution engine.");
}

function renderTerminal(html) {
  document.getElementById("terminal").innerHTML = html;
  const t = document.getElementById("terminal");
  t.scrollTop = t.scrollHeight;
}

/* ---------------- BYOK: AI Coder/Optimizer/Explain agents (Groq / Gemini — both free) ---------------- */

function getApiKey(provider) {
  const p = provider || getAiProvider();
  return localStorage.getItem(`codefixern_key_${p}`) || "";
}
function getAiProvider() { return localStorage.getItem("codefixern_ai_provider") || "groq"; }
function getRapidApiKey() { return localStorage.getItem("codefixern_rapidapi_key") || ""; }

async function callGroq(systemPrompt, userPrompt, key) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`Groq error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(systemPrompt, userPrompt, key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
}

async function callAI(systemPrompt, userPrompt) {
  const provider = getAiProvider();
  const key = getApiKey(provider);
  if (!key) throw new Error("No AI agent key configured. Add a free Groq or Gemini key in Settings.");
  if (provider === "gemini") return callGemini(systemPrompt, userPrompt, key);
  return callGroq(systemPrompt, userPrompt, key);
}

// Quick, cheap ping used by the "Test key" button — confirms the key is accepted
// without spending a full generation call.
async function testApiKey(provider, key) {
  if (provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`Gemini rejected the key (${res.status}).`);
    return true;
  }
  const res = await fetch("https://api.groq.com/openai/v1/models", { headers: { "Authorization": `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Groq rejected the key (${res.status}).`);
  return true;
}

/* ---------------- lightweight local retrieval (RAG-style context for the Coder agent) ----------------
   A small embedded knowledge base of common per-language pitfalls. We keyword-match the
   static diagnostics + the code against it and splice the matched snippets into the prompt —
   genuine retrieval-then-generation, just backed by a local table instead of a hosted vector DB
   (there's no server here to host one). */

const KNOWLEDGE_BASE = {
  python: [
    { k: ["indent", "colon", "unexpected indent"], doc: "Python blocks are delimited purely by indentation; every compound statement (def/if/for/while/class/try) must end its header line with a colon and the body must be indented consistently (spaces XOR tabs, not mixed)." },
    { k: ["nameerror", "undefined"], doc: "NameError means a variable/function is referenced before assignment or outside its scope — check for typos and that the definition executes before the call site." },
    { k: ["indexerror", "list index"], doc: "IndexError means the code accessed a list/tuple position ≥ its length — guard with len() checks or use .get() for dicts." },
  ],
  javascript: [
    { k: ["undefined is not a function", "typeerror"], doc: "TypeError usually means a value is null/undefined where a method call was expected — add a guard or optional chaining (?.)." },
    { k: ["semicolon", "unexpected token"], doc: "JS statements should generally end in a semicolon or a newline ASI-safe boundary; unexpected token errors often trace back one line from the reported position." },
  ],
  java: [
    { k: ["cannot find symbol", "class"], doc: "Java requires the public class name to exactly match the file name, and every statement must end in a semicolon inside a properly braced block." },
  ],
  cpp: [
    { k: ["expected", ";"], doc: "C++ requires a semicolon after every statement and a matching #include for anything from std:: (e.g. <iostream> for cout/cin)." },
  ],
  c: [
    { k: ["implicit declaration", "undeclared"], doc: "C requires every function to be declared (via header or prototype) before its first use, and every statement to end in a semicolon." },
  ],
};

function retrieveContext(langId, diagnostics, code) {
  const bank = KNOWLEDGE_BASE[langId] || [];
  const haystack = (diagnostics.map(d => d.msg).join(" ") + " " + code).toLowerCase();
  const hits = bank.filter(entry => entry.k.some(kw => haystack.includes(kw.toLowerCase())));
  return hits.map(h => "- " + h.doc).join("\n");
}

async function runAgentPipeline(langLabel, langId, code, diagnostics) {
  const log = document.getElementById("agentsLog");
  const append = (name, text) => {
    const row = document.createElement("div");
    row.className = "agent-row";
    row.innerHTML = `<div class="agent-name">${name}</div><div class="agent-text">${text}</div>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  };

  const context = retrieveContext(langId, diagnostics, code);
  if (context) append("RETRIEVAL", "Matched local knowledge-base notes for this language, added to the Coder's prompt:<br><code>" + escapeHtml(context).replace(/\n/g, "<br>") + "</code>");

  const providerLabel = { groq: "Groq (Llama 3.3)", gemini: "Gemini 2.0 Flash" }[getAiProvider()] || "the configured model";
  append("CODER", `Requesting a healed version from ${providerLabel}…`);
  const healPrompt = `You are fixing broken ${langLabel} code.${context ? `\n\nRelevant notes:\n${context}` : ""}\n\nReturn ONLY the corrected, complete source code with no explanation, no markdown fences.\n\nCODE:\n${code}`;
  const healed = (await callAI("You are a precise code-repair engine. Output only raw corrected source code, nothing else — no markdown fences, no commentary.", healPrompt)).trim();
  append("CODER", "Healed version received (" + healed.split("\n").length + " lines).");

  append("OPTIMIZER", "Requesting a concise optimized rewrite…");
  const optPrompt = `Rewrite this corrected ${langLabel} code to be more concise and idiomatic WITHOUT changing its behavior. Return ONLY the code, no explanation, no markdown fences.\n\nCODE:\n${healed}`;
  const optimized = (await callAI("You are a code-optimization engine. Output only raw optimized source code, nothing else.", optPrompt)).trim();
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
  { t: "linking execution engines (pyodide · sandboxed js · sql.js)…", cls: "line-ok" },
  { t: "linking OCR / PDF / DOCX ingestion…", cls: "line-ok" },
  { t: "checking for AI agent key…", cls: "line-ok" },
  { t: "no server — python/js/sql run natively in this browser", cls: "line-ok" },
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
    { label: "Explain active stream", hint: "✨", run: () => onExplain() },
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

let lastHealedCode = "";
let lastOptimizedCode = "";
let lastLangExt = "txt";

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function flashLinkBtn(id, text) {
  const btn = document.getElementById(id);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1400);
}

function toast(message, kind) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = "toast" + (kind ? ` ${kind}` : "");
  el.textContent = message;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, 3000);
}

function haptic(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms || 20); } catch (e) {} }
}

/* ---------------- starter templates ---------------- */

const TEMPLATES = {
  python: `# starter — python\ndef fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nfor i in range(10):\n    print(fib(i))\n`,
  javascript: `// starter — javascript\nfunction fib(n) {\n  let a = 0, b = 1;\n  for (let i = 0; i < n; i++) [a, b] = [b, a + b];\n  return a;\n}\n\nfor (let i = 0; i < 10; i++) console.log(fib(i));\n`,
  java: `// starter — java\npublic class Main {\n    static int fib(int n) {\n        int a = 0, b = 1;\n        for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; }\n        return a;\n    }\n    public static void main(String[] args) {\n        for (int i = 0; i < 10; i++) System.out.println(fib(i));\n    }\n}\n`,
  cpp: `// starter — c++\n#include <iostream>\nusing namespace std;\n\nint fib(int n) {\n    int a = 0, b = 1;\n    for (int i = 0; i < n; i++) { int t = a + b; a = b; b = t; }\n    return a;\n}\n\nint main() {\n    for (int i = 0; i < 10; i++) cout << fib(i) << endl;\n    return 0;\n}\n`,
  sql: `-- starter — sql\nCREATE TABLE fruits (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER);\nINSERT INTO fruits (name, qty) VALUES ('apple', 5), ('banana', 3), ('cherry', 12);\nSELECT * FROM fruits ORDER BY qty DESC;\n`,
};

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
    gutters: ["diag-gutter", "CodeMirror-linenumbers"],
    extraKeys: { "Tab": cm => cm.replaceSelection("    ") },
  });

  const restored = restoreTabsFromStorage();
  if (!restored) {
    const seedId = newTab("main", `# Type or paste code — CodeFixern detects the language live.\ndef greet(name):\n    print("Hello, " + name)\n\ngreet("world")\n`);
    activeTabId = seedId;
  } else {
    const banner = document.getElementById("restoreBanner");
    document.getElementById("restoreBannerText").textContent =
      `Restored ${tabs.length} stream${tabs.length === 1 ? "" : "s"} from your last session on this browser.`;
    banner.style.display = "flex";
    document.getElementById("restoreBannerDismiss").addEventListener("click", () => { banner.style.display = "none"; });
  }
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
      saveTabsToStorage();
    }, 220);
  });

  // Ctrl/Cmd+Enter to run
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      const cmdkOpen = document.getElementById("cmdkScrim").classList.contains("open");
      if (!cmdkOpen) { e.preventDefault(); onRun(); }
    }
  });

  // download current stream
  document.getElementById("downloadTabBtn").addEventListener("click", () => {
    const tab = activeTab();
    const code = cm.getValue();
    const lang = tab.langId ? LANGS.find(l => l.id === tab.langId) : detectLanguage(code);
    const ext = (lang && lang.ext && lang.ext[0]) || "txt";
    downloadText(code, `${tab.name.replace(/\.[a-z0-9]+$/i, "")}.${ext}`);
  });

  // copy terminal output
  document.getElementById("copyTerminalBtn").addEventListener("click", async () => {
    const text = document.getElementById("terminal").innerText;
    try {
      await navigator.clipboard.writeText(text);
      flashLinkBtn("copyTerminalBtn", "copied ✓");
    } catch (e) { flashLinkBtn("copyTerminalBtn", "copy failed"); }
  });

  // download healed / optimized (populated after an AI heal pass)
  document.getElementById("downloadHealedBtn").addEventListener("click", () => {
    if (lastHealedCode) downloadText(lastHealedCode, `healed.${lastLangExt || "txt"}`);
  });
  document.getElementById("downloadOptimizedBtn").addEventListener("click", () => {
    if (lastOptimizedCode) downloadText(lastOptimizedCode, `optimized.${lastLangExt || "txt"}`);
  });

  // starter templates
  document.getElementById("templateSelect").addEventListener("change", (e) => {
    const key = e.target.value;
    e.target.value = "";
    if (!key || !TEMPLATES[key]) return;
    const langDef = LANGS.find(l => l.id === key);
    const id = newTab(`${langDef ? langDef.label.toLowerCase() : key}-starter`, TEMPLATES[key], key);
    switchTab(id);
    toast(`Inserted ${langDef ? langDef.label : key} starter template.`, "ok");
  });

  // explain agent
  document.getElementById("explainBtn").addEventListener("click", onExplain);

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
  const openSettings = () => {
    document.getElementById("aiProviderSelect").value = getAiProvider();
    document.getElementById("apiKeyInput").value = getApiKey(document.getElementById("aiProviderSelect").value);
    document.getElementById("rapidApiKeyInput").value = getRapidApiKey();
    document.getElementById("keyTestStatus").textContent = "";
    document.getElementById("keyTestStatus").className = "key-test-status";
    updateProviderHint();
    scrim.classList.add("open");
  };
  function updateProviderHint() {
    const p = document.getElementById("aiProviderSelect").value;
    const hints = {
      groq: "Free key: console.groq.com → API Keys → Create. No card needed.",
      gemini: "Free key: aistudio.google.com/apikey → Create API key. No card needed.",
    };
    document.getElementById("providerHint").textContent = hints[p] || "";
    document.getElementById("apiKeyInput").value = getApiKey(p);
  }
  document.getElementById("aiProviderSelect").addEventListener("change", updateProviderHint);
  document.getElementById("settingsBtn").addEventListener("click", openSettings);
  document.getElementById("byokInlineBtn").addEventListener("click", openSettings);
  document.getElementById("settingsCancel").addEventListener("click", () => scrim.classList.remove("open"));
  scrim.addEventListener("click", e => { if (e.target === scrim) scrim.classList.remove("open"); });

  document.getElementById("testKeyBtn").addEventListener("click", async () => {
    const provider = document.getElementById("aiProviderSelect").value;
    const key = document.getElementById("apiKeyInput").value.trim();
    const statusEl = document.getElementById("keyTestStatus");
    if (!key) { statusEl.textContent = "Paste a key first."; statusEl.className = "key-test-status fail"; return; }
    statusEl.textContent = "Testing…";
    statusEl.className = "key-test-status";
    try {
      await testApiKey(provider, key);
      statusEl.textContent = "✓ Key works";
      statusEl.className = "key-test-status ok";
    } catch (e) {
      statusEl.textContent = "✗ " + e.message;
      statusEl.className = "key-test-status fail";
    }
  });

  document.getElementById("settingsSave").addEventListener("click", () => {
    const provider = document.getElementById("aiProviderSelect").value;
    const val = document.getElementById("apiKeyInput").value.trim();
    const rapid = document.getElementById("rapidApiKeyInput").value.trim();
    localStorage.setItem("codefixern_ai_provider", provider);
    if (val) localStorage.setItem(`codefixern_key_${provider}`, val);
    if (rapid) localStorage.setItem("codefixern_rapidapi_key", rapid);
    else localStorage.removeItem("codefixern_rapidapi_key");
    scrim.classList.remove("open");
    updateByokNote();
    toast(`${provider === "gemini" ? "Gemini" : "Groq"} key saved.`, "ok");
  });
  document.getElementById("settingsRemove").addEventListener("click", () => {
    const provider = document.getElementById("aiProviderSelect").value;
    localStorage.removeItem(`codefixern_key_${provider}`);
    document.getElementById("apiKeyInput").value = "";
    updateByokNote();
    toast("Key removed.", "ok");
  });

  function updateByokNote() {
    const note = document.getElementById("byokNote");
    const provider = getAiProvider();
    const label = { groq: "Groq", gemini: "Gemini" }[provider];
    note.innerHTML = getApiKey(provider)
      ? `AI agent key configured (${label}). <button id="byokInlineBtn2">Change or remove</button>`
      : `No AI agent key configured. <button id="byokInlineBtn2">Add a free Groq or Gemini key</button> to enable real fix, optimize &amp; explain passes.`;
    document.getElementById("byokInlineBtn2").addEventListener("click", openSettings);
  }
  updateByokNote();

  // clear vault
  document.getElementById("clearVaultBtn").addEventListener("click", () => {
    if (confirm("Clear all archived sessions from this browser?")) {
      localStorage.removeItem(VAULT_KEY);
      renderVault();
      toast("History vault cleared.", "ok");
    }
  });
  renderVault();

  // RUN
  document.getElementById("runBtn").addEventListener("click", onRun);
}

async function onExplain() {
  const tab = activeTab();
  const code = cm.getValue();
  const lang = tab.langId ? LANGS.find(l => l.id === tab.langId) : detectLanguage(code);

  if (!getApiKey()) {
    toast("Add a free Groq or Gemini key in Settings to use Explain.", "fail");
    document.getElementById("settingsBtn").click();
    return;
  }
  if (!code.trim()) { toast("Nothing to explain yet.", "fail"); return; }

  switchOutputPane("agents");
  const log = document.getElementById("agentsLog");
  const row = document.createElement("div");
  row.className = "agent-row";
  row.innerHTML = `<div class="agent-name">EXPLAIN</div><div class="agent-text">Thinking…</div>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;

  try {
    const explanation = await callAI(
      "You are a friendly code-explanation engine. Explain what the given code does in plain English, in 3-6 short sentences. No markdown fences, no code repetition, just the explanation.",
      `Explain this ${lang.label} code:\n\n${code}`
    );
    row.querySelector(".agent-text").innerHTML = escapeHtml(explanation.trim()).replace(/\n/g, "<br>");
    haptic(15);
  } catch (e) {
    row.querySelector(".agent-text").textContent = "Error: " + e.message;
    toast("Explain failed: " + e.message, "fail");
  }
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
  renderTerminal(`<span class="meta">$ dispatching ${escapeHtml(lang.label)} to its execution engine…</span>`);

  try {
    const result = await runCode(lang.id, code);
    let html = "";
    html += `<div class="meta">--- stdout ---</div>${escapeHtml(result.stdout || "(empty)")}\n`;
    if (result.stderr) html += `\n<div class="meta">--- stderr ---</div><span class="stderr">${escapeHtml(result.stderr)}</span>\n`;
    html += `\n<div class="meta">exit code: ${result.exitCode} · engine: ${escapeHtml(result.engineLabel || "")}</div>`;
    renderTerminal(html);
    setEngineStatus("runtime: idle", false);
    haptic(result.exitCode === 0 ? 15 : [10, 40, 10]);

    saveVaultEntry({ id: "v" + Date.now(), ts: Date.now(), lang: lang.label, name: tab.name, action: "ran", code });

    // Static diagnostics refresh (also updates the editor gutter)
    const diagRows = runStaticDiagnostics(code, lang);
    renderDiagnostics(diagRows);

    // Optional AI agent pass
    if (getApiKey()) {
      switchOutputPane("agents");
      try {
        const { healed, optimized } = await runAgentPipeline(lang.label, lang.id, code, diagRows);
        renderDiff(code, healed);
        lastHealedCode = healed;
        lastOptimizedCode = optimized;
        lastLangExt = (lang.ext && lang.ext[0]) || "txt";
        document.getElementById("diffToolbar").style.display = "flex";
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
