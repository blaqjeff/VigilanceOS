const fs = require('fs');
const path = require('path');

const pageFile = path.join(__dirname, 'src/app/page.tsx');
let content = fs.readFileSync(pageFile, 'utf8');

// 1. Inject Toggle Button
const targetHeader = `          <div className="flex items-center gap-3">
            {/* Stats badges */}
            {stats && (`;

const newHeader = `          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTheme(t => t === 'jarvis' ? 'hacker' : 'jarvis')}
              className="hidden md:block rounded-xl border border-[var(--color-panel-border)] bg-[var(--color-panel-bg)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:text-[var(--color-accent-cyan)] transition shadow-lg z-50 cursor-pointer"
            >
              {theme === 'jarvis' ? 'HACKER MODE' : 'JARVIS MODE'}
            </button>
            {/* Stats badges */}
            {stats && (`;

if (content.includes(targetHeader)) {
  content = content.replace(targetHeader, newHeader);
  console.log("Toggle button injected.");
} else {
  // Try CRLF agnostic
  const re = /<div className="flex items-center gap-3">\s*{\/\* Stats badges \*\/}\s*{stats && \(/;
  if (re.test(content)) {
    content = content.replace(re, newHeader);
    console.log("Toggle button injected via regex fallback.");
  }
}

// 2. Fix cramped spacing on the main candidate card
// `rounded-2xl border border-white/10 bg-slate-900/70 p-4` -> `md:p-6 p-4`
content = content.replace(/bg-slate-900\/70 p-4/g, 'bg-slate-900/70 p-4 md:p-6');


fs.writeFileSync(pageFile, content, 'utf8');
console.log("Done updating spacing and toggle.");
