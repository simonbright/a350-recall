import { GROUPS, ITEMS, ITEM_BY_ID } from "./items.js";

export const APP_VERSION = "1.4.0";

const TRAINING_PDF_VIEW = "./pdf.html";

const STORAGE = {
  username: "a350.username",
  onboarded: "a350.onboarded",
  history: "a350.history",
  session: "a350.session.v2",
  mastery: "a350.mastery.v1",
};

const SUMMARY_SECTIONS = [
  { id: "limitations", label: "FCOM Limitations", groups: ["limitations"] },
  {
    id: "memory",
    label: "Memory Items",
    groups: ["braking", "descent", "uas", "stall"],
  },
  { id: "evac", label: "Evacuation", groups: ["evac"] },
];

const state = {
  tab: "practice",
  username: "",
  history: [],
  filter: "all",
  order: [],
  index: 0,
  results: {},
  phase: "ask",
  lastGrade: "",
  draft: "",
  startedAt: "",
  expandedId: "",
  flags: {},
  sessionId: "",
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shuffleIds(ids) {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function idsForFilter(filter) {
  if (filter === "all") return ITEMS.map((item) => item.id);
  if (filter === "memory") {
    return ITEMS.filter((item) =>
      ["braking", "descent", "uas", "stall", "evac"].includes(item.group),
    ).map((item) => item.id);
  }
  return ITEMS.filter((item) => item.group === filter).map((item) => item.id);
}

function groupLabel(id) {
  return GROUPS.find((group) => group.id === id)?.label ?? "All";
}

function practiceToolbar(showDone = true) {
  return `
    <div class="toolbar">
      <a class="tool-link" href="${TRAINING_PDF_VIEW}">PDF</a>
      ${
        showDone
          ? `<button class="tool-link" data-action="done-now" type="button">Done for now</button>`
          : `<span></span>`
      }
      <button class="tool-link reset" data-action="reset" type="button">Reset</button>
    </div>
  `;
}

function normalize(value) {
  return value
    .toUpperCase()
    .replace(/°/g, " ")
    .replace(/A\/P/g, "AP")
    .replace(/A\/THR/g, "ATHR")
    .replace(/L\/G/g, "LG")
    .replace(/A\s*-?\s*SKID/g, "ASKID")
    .replace(/\bGEAR UP\b/g, "LG UP")
    .replace(/,/g, " ")
    .replace(/[^A-Z0-9. ]/g, " ")
    .replace(/\bFEET\b/g, "FT")
    .replace(/\bKNOTS\b/g, "KT")
    .replace(/\bKNOT\b/g, "KT")
    .replace(/\bCONFIGURATION\b/g, "CONF")
    .replace(/\bCONFIG\b/g, "CONF")
    .replace(/\bDEGREES?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCorrect(input, item) {
  const typed = normalize(input);
  if (!typed) return false;
  if (typed === normalize(item.answer)) return true;
  const keys = item.keys.map(normalize);
  if (item.ordered || item.kind === "sequence") {
    let from = 0;
    for (const key of keys) {
      const at = typed.indexOf(key, from);
      if (at < 0) return false;
      from = at + key.length;
    }
    return true;
  }
  return keys.every((key) => typed.includes(key));
}

function officialHtml(item) {
  if (item.kind !== "sequence" || !item.steps) {
    return escapeHtml(item.answer);
  }
  const list = item.steps
    .map((step) => {
      const line = [step.item, step.action].filter(Boolean).join(" — ");
      return `<li>${escapeHtml(line)}</li>`;
    })
    .join("");
  return `<p class="recite">${escapeHtml(item.answer)}</p><ol class="steps">${list}</ol>`;
}

function deck() {
  return state.order.map((id) => ITEM_BY_ID[id]).filter(Boolean);
}

function persistSession() {
  writeJson(STORAGE.session, {
    filter: state.filter,
    order: state.order,
    index: state.index,
    results: state.results,
    phase: state.phase,
    lastGrade: state.lastGrade,
    startedAt: state.startedAt,
    flags: state.flags,
    sessionId: state.sessionId,
  });
}

function flagEntry(id) {
  return state.flags[id] ?? { flagged: false, note: "" };
}

function setFlag(id, patch) {
  state.flags = {
    ...state.flags,
    [id]: { ...flagEntry(id), ...patch },
  };
  persistSession();
}

function flaggedItems(items) {
  return items.filter((item) => {
    const entry = flagEntry(item.id);
    return entry.flagged || entry.note.trim();
  });
}

function displayName() {
  return state.username.trim() || "Guest";
}

function newSessionId() {
  return crypto.randomUUID();
}

function loadMastery() {
  return readJson(STORAGE.mastery, {});
}

function saveMastery(all) {
  writeJson(STORAGE.mastery, all);
}

function recordAttempt(itemId, grade) {
  const all = loadMastery();
  const user = displayName();
  const byItem = all[user] ?? {};
  const list = (byItem[itemId] ?? []).filter(
    (attempt) => attempt.sessionId !== state.sessionId,
  );
  list.push({
    grade,
    at: new Date().toISOString(),
    sessionId: state.sessionId,
  });
  byItem[itemId] = list;
  all[user] = byItem;
  saveMastery(all);
}

function dropSessionAttempts(sessionId) {
  if (!sessionId) return;
  const all = loadMastery();
  const user = displayName();
  const byItem = all[user];
  if (!byItem) return;
  for (const id of Object.keys(byItem)) {
    byItem[id] = byItem[id].filter((attempt) => attempt.sessionId !== sessionId);
    if (!byItem[id].length) delete byItem[id];
  }
  all[user] = byItem;
  saveMastery(all);
}

function attemptsFromEntry(entry) {
  if (entry.attempts?.length) return entry.attempts;
  const missIds = new Set((entry.misses ?? []).map((item) => item.id));
  const deckIds = idsForFilter(entry.deck || "all");
  if (entry.total === deckIds.length) {
    return deckIds.map((id) => ({
      id,
      grade: missIds.has(id) ? "missed" : "correct",
    }));
  }
  return (entry.misses ?? []).map((item) => ({ id: item.id, grade: "missed" }));
}

function backfillMasteryFromHistory() {
  const all = loadMastery();
  let changed = false;
  for (const entry of state.history) {
    const user = entry.username || "Guest";
    const byItem = all[user] ?? {};
    const already = Object.values(byItem).some((list) =>
      list.some((attempt) => attempt.sessionId === entry.id),
    );
    if (already) {
      all[user] = byItem;
      continue;
    }
    for (const attempt of attemptsFromEntry(entry)) {
      if (!ITEM_BY_ID[attempt.id]) continue;
      byItem[attempt.id] = [
        ...(byItem[attempt.id] ?? []),
        {
          grade: attempt.grade,
          at: entry.finishedAt,
          sessionId: entry.id,
        },
      ];
      changed = true;
    }
    all[user] = byItem;
  }
  if (changed) saveMastery(all);
}

function tallyAttempts(list) {
  const attempts = list.length;
  const correct = list.filter((attempt) => attempt.grade === "correct").length;
  const recent = list.slice(-5);
  const recentCorrect = recent.filter((attempt) => attempt.grade === "correct").length;
  const recentAttempts = recent.length;
  const recentPct = recentAttempts
    ? Math.round((recentCorrect / recentAttempts) * 100)
    : 0;
  return {
    attempts,
    correct,
    missed: attempts - correct,
    pct: attempts ? Math.round((correct / attempts) * 100) : 0,
    recentAttempts,
    recentCorrect,
    recentPct,
    last: list.length ? list[list.length - 1].grade : "",
  };
}

function strength(stat) {
  if (!stat.attempts) return "none";
  const pct = stat.recentAttempts ? stat.recentPct : stat.pct;
  if (pct >= 80) return "good";
  if (pct >= 50) return "ok";
  return "weak";
}

function itemStatsForUser() {
  const byItem = loadMastery()[displayName()] ?? {};
  return Object.fromEntries(
    ITEMS.map((item) => [item.id, tallyAttempts(byItem[item.id] ?? [])]),
  );
}

function sectionStats(groups) {
  const items = ITEMS.filter((item) => groups.includes(item.group));
  const byItem = loadMastery()[displayName()] ?? {};
  const combined = items.flatMap((item) => byItem[item.id] ?? []);
  return {
    items,
    tally: tallyAttempts(combined),
  };
}

function load() {
  state.username = localStorage.getItem(STORAGE.username) ?? "";
  state.history = readJson(STORAGE.history, []);
  const saved = readJson(STORAGE.session, null);
  const valid =
    saved?.order?.length && saved.order.every((id) => ITEM_BY_ID[id]);
  if (valid) {
    Object.assign(state, saved, {
      draft: "",
      flags: saved.flags ?? {},
      sessionId: saved.sessionId || newSessionId(),
    });
  } else {
    startRound("all", idsForFilter("all"), false);
  }
  backfillMasteryFromHistory();
}

function startRound(filter, ids, resetStart = true) {
  state.filter = filter;
  state.order = shuffleIds(ids);
  state.index = 0;
  state.results = {};
  state.phase = "ask";
  state.lastGrade = "";
  state.draft = "";
  state.flags = {};
  state.sessionId = newSessionId();
  if (resetStart || !state.startedAt) {
    state.startedAt = new Date().toISOString();
  }
  persistSession();
}

function saveHistory(entry) {
  state.history = [entry, ...state.history].slice(0, 100);
  writeJson(STORAGE.history, state.history);
}

function finishRound() {
  const items = deck();
  const attempted = items.filter((item) => state.results[item.id]);
  if (!attempted.length) return false;
  const misses = attempted
    .filter((item) => state.results[item.id] === "missed")
    .map((item) => ({
      id: item.id,
      prompt: item.prompt,
      context: item.context ?? "",
      answer: item.answer,
    }));
  const correct = attempted.filter((item) => state.results[item.id] === "correct").length;
  const flagged = flaggedItems(attempted).map((item) => ({
    id: item.id,
    prompt: item.prompt,
    answer: item.answer,
    note: flagEntry(item.id).note.trim(),
  }));
  saveHistory({
    id: crypto.randomUUID(),
    username: displayName(),
    deck: state.filter,
    deckLabel: groupLabel(state.filter),
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    total: attempted.length,
    correct,
    missed: misses.length,
    complete: attempted.length === items.length,
    misses,
    flagged,
    attempts: attempted.map((item) => ({
      id: item.id,
      grade: state.results[item.id],
    })),
  });
  state.phase = "done";
  persistSession();
  return true;
}

function formatWhen(iso) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function durationLabel(start, end) {
  const ms = new Date(end) - new Date(start);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function renderChrome() {
  document.getElementById("user-chip").textContent = displayName();
  document.getElementById("app-version").textContent = `v${APP_VERSION}`;
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.tab);
  });
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.dataset.page === state.tab);
  });
}

function renderPractice() {
  const items = deck();
  const current = items[state.index];
  const correct = items.filter((item) => state.results[item.id] === "correct").length;
  const missed = items.filter((item) => state.results[item.id] === "missed").length;
  const answered = correct + missed;
  const remaining = Math.max(items.length - answered, 0);
  const roundComplete =
    state.phase === "done" ||
    (state.phase === "ask" && items.length > 0 && answered >= items.length);

  document.getElementById("chips").innerHTML = GROUPS.map(
    (group) => `
      <button class="chip ${state.filter === group.id ? "active" : ""}" data-filter="${group.id}">
        ${escapeHtml(group.label)}
      </button>`,
  ).join("");

  document.getElementById("stats").innerHTML = `
    <div class="stat"><b>${remaining}</b><span>Remaining</span></div>
    <div class="stat good"><b>${correct}</b><span>Correct</span></div>
    <div class="stat ${missed ? "bad" : ""}"><b>${missed}</b><span>Missed</span></div>
  `;

  const okPct = items.length ? (correct / items.length) * 100 : 0;
  const missPct = items.length ? (missed / items.length) * 100 : 0;
  document.getElementById("progress").innerHTML = `
    <i class="ok" style="width:${okPct}%"></i>
    <i class="miss" style="width:${missPct}%"></i>
  `;

  const body = document.getElementById("practice-body");
  if (roundComplete) {
    const missRows = items
      .filter((item) => state.results[item.id] === "missed")
      .map(
        (item) => `
          <p>
            <span class="q">${escapeHtml(item.prompt)}</span><br />
            <span class="a">${escapeHtml(item.answer)}</span>
          </p>`,
      )
      .join("");
    const flaggedRows = flaggedItems(items)
      .map((item) => {
        const note = flagEntry(item.id).note.trim();
        return `
          <p>
            <span class="q">${escapeHtml(item.prompt)}</span><br />
            <span class="a">${escapeHtml(item.answer)}</span>
            ${note ? `<br /><span class="flag-note">${escapeHtml(note)}</span>` : ""}
          </p>`;
      })
      .join("");
    body.innerHTML = `
      ${practiceToolbar(false)}
      <div class="card">
        <p class="kicker">Round complete</p>
        <h2>${missed === 0 ? "All values recalled" : `${correct} of ${items.length} correct`}</h2>
        <p class="note">${missed === 0 ? "Shuffle again so the values do not go stale." : "Restudy shuffles only the items you missed."}</p>
        ${
          missed
            ? `<div class="miss-list">${missRows}</div>`
            : ""
        }
        ${
          flaggedRows
            ? `<div class="flagged-list"><h3>Flagged items</h3>${flaggedRows}</div>`
            : ""
        }
        <div class="actions" style="margin-top:16px">
          <button class="btn primary" data-action="new-round">New shuffled round</button>
          ${missed ? `<button class="btn secondary" data-action="restudy">Restudy misses</button>` : ""}
        </div>
      </div>
    `;
    return;
  }

  if (!current) {
    body.innerHTML = `<div class="empty">No items in this deck.</div>`;
    return;
  }

  const sequence = current.kind === "sequence";
  const field =
    sequence
      ? `<textarea id="answer-input" rows="7" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Item action, item action, …">${escapeHtml(state.draft)}</textarea>`
      : `<input id="answer-input" type="text" inputmode="text" enterkeyhint="done" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Type the value" value="${escapeHtml(state.draft)}" />`;
  const askHtml =
    state.phase === "ask"
      ? `
        <form id="answer-form">
          <label class="field">
            <span>${sequence ? "Comma-separated sequence" : "Your answer"}</span>
            ${field}
          </label>
          <div class="row-actions">
            <button class="btn primary" type="submit">Check</button>
            <button class="btn secondary" type="button" data-action="reveal">Reveal</button>
          </div>
        </form>`
      : `
        <button class="btn primary" data-action="next">${
          state.index + 1 >= items.length ? "See results" : "Next item"
        }</button>
        <div class="banner ${state.lastGrade === "correct" ? "ok" : "bad"}">
          <strong>${
            state.lastGrade === "correct"
              ? "Correct"
              : sequence
                ? "Official sequence"
                : "Official value"
          }</strong>
          ${officialHtml(current)}
        </div>
        ${
          state.draft.trim() && state.lastGrade === "missed"
            ? `<p class="typed">You entered: ${escapeHtml(state.draft.trim())}</p>`
            : ""
        }
      `;

  const flagged = flagEntry(current.id);
  body.innerHTML = `
    ${practiceToolbar()}
    <div class="card">
      <p class="kicker">${escapeHtml(current.section)} · ${state.index + 1} of ${items.length}</p>
      ${current.context ? `<p class="context">${escapeHtml(current.context)}</p>` : ""}
      <div class="q-head">
        <h2>${escapeHtml(current.prompt)}</h2>
        <button
          class="flag-btn ${flagged.flagged ? "active" : ""}"
          type="button"
          data-action="flag"
          aria-pressed="${flagged.flagged ? "true" : "false"}"
        >${flagged.flagged ? "Flagged" : "Flag"}</button>
      </div>
      <p class="ask">${escapeHtml(
        current.ask ?? (sequence ? "Say the steps in order" : "What is the value?"),
      )}</p>
      ${askHtml}
      <label class="field note-field">
        <span>Note (optional)</span>
        <input id="item-note" type="text" maxlength="200" autocomplete="off" placeholder="Add a note" value="${escapeHtml(flagged.note)}" />
      </label>
    </div>
    <p class="note">${
      sequence
        ? "Recite each item and its action, in order, separated by commas."
        : "Matching is lenient on units and punctuation."
    } Training use only — DAL/2442.</p>
  `;

  const input = document.getElementById("answer-input");
  if (input) input.focus({ preventScroll: true });
}

function lifetimeStats() {
  const mine = state.history.filter((entry) => entry.username === displayName());
  const total = mine.reduce((sum, entry) => sum + entry.total, 0);
  const correct = mine.reduce((sum, entry) => sum + entry.correct, 0);
  return {
    rounds: mine.length,
    total,
    correct,
    pct: total ? Math.round((correct / total) * 100) : 0,
  };
}

function renderSummary() {
  const stats = itemStatsForUser();
  const practiced = Object.values(stats).filter((stat) => stat.attempts).length;
  const overall = tallyAttempts(
    ITEMS.flatMap((item) => (loadMastery()[displayName()] ?? {})[item.id] ?? []),
  );
  const root = document.getElementById("summary-body");
  root.innerHTML = `
    <p class="kicker">For ${escapeHtml(displayName())}</p>
    <h2 style="margin-bottom: 6px">Summary</h2>
    <p class="note" style="margin-top:0">Updates after every check, including Done for now. Colors use your last 5 attempts.</p>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><b>${practiced}/${ITEMS.length}</b><span>Items practiced</span></div>
      <div class="stat ${
        strength(overall) === "good" ? "good" : strength(overall) === "ok" ? "warn" : strength(overall) === "weak" ? "bad" : ""
      }"><b>${overall.attempts ? `${overall.pct}%` : "—"}</b><span>All-time</span></div>
      <div class="stat"><b>${overall.attempts}</b><span>Attempts</span></div>
    </div>
    <div class="summary-legend">
      <span><i class="good"></i> Strong ≥80%</span>
      <span><i class="ok"></i> Mixed 50–79%</span>
      <span><i class="weak"></i> Weak &lt;50%</span>
      <span><i class="none"></i> Not yet</span>
    </div>
    ${SUMMARY_SECTIONS.map((section) => {
      const { items, tally } = sectionStats(section.groups);
      const band = strength(tally);
      const rows = items
        .map((item) => {
          const stat = stats[item.id];
          const itemBand = strength(stat);
          const meta = stat.attempts
            ? `${stat.attempts}× · ${stat.pct}%${
                stat.recentAttempts && stat.recentAttempts < stat.attempts
                  ? ` · recent ${stat.recentPct}%`
                  : ""
              }`
            : "Not yet";
          return `
            <div class="summary-row ${itemBand}">
              <span class="q">${escapeHtml(item.prompt)}</span>
              <span class="summary-meta">${meta}</span>
            </div>`;
        })
        .join("");
      const sectionMeta = tally.attempts
        ? `${tally.attempts}× · ${tally.pct}%`
        : "Not yet";
      return `
        <section class="summary-section ${band}">
          <header>
            <div>
              <h3>${escapeHtml(section.label)}</h3>
              <p class="summary-meta">${sectionMeta}</p>
            </div>
            <button class="tool-link" data-filter="${section.id}" type="button">Practice</button>
          </header>
          ${rows}
        </section>`;
    }).join("")}
  `;
}

function renderHistory() {
  const root = document.getElementById("history-body");
  if (!state.history.length) {
    root.innerHTML = `<div class="empty">No activity yet. Finish a round to save it here.</div>`;
    return;
  }

  root.innerHTML = `
    <div class="list">
      ${state.history
        .map((entry) => {
          const open = state.expandedId === entry.id;
          const missHtml = entry.misses
            .map(
              (item) => `
                <p>
                  <span class="q">${escapeHtml(item.prompt)}</span><br />
                  <span class="a">${escapeHtml(item.answer)}</span>
                </p>`,
            )
            .join("");
          const flaggedHtml = (entry.flagged ?? [])
            .map(
              (item) => `
                <p>
                  <span class="q">${escapeHtml(item.prompt)}</span><br />
                  <span class="a">${escapeHtml(item.answer)}</span>
                  ${
                    item.note
                      ? `<br /><span class="flag-note">${escapeHtml(item.note)}</span>`
                      : ""
                  }
                </p>`,
            )
            .join("");
          return `
            <button class="session" data-expand="${entry.id}">
              <div class="session-top">
                <strong>${escapeHtml(entry.username)}</strong>
                <span class="score">${entry.correct}/${entry.total}</span>
              </div>
              <p class="meta">${escapeHtml(entry.deckLabel)}${
                entry.complete === false ? " · stopped early" : ""
              } · ${formatWhen(entry.finishedAt)}${
                durationLabel(entry.startedAt, entry.finishedAt)
                  ? ` · ${durationLabel(entry.startedAt, entry.finishedAt)}`
                  : ""
              }${
                (entry.flagged ?? []).length
                  ? ` · ${entry.flagged.length} flagged`
                  : ""
              }</p>
              ${
                open
                  ? `<div class="miss-list">${
                      entry.misses.length
                        ? missHtml
                        : "<p class='a'>No misses this round.</p>"
                    }${
                      flaggedHtml
                        ? `<h3>Flagged items</h3>${flaggedHtml}`
                        : ""
                    }</div>`
                  : ""
              }
            </button>`;
        })
        .join("")}
    </div>
  `;
}

function renderYou() {
  const stats = lifetimeStats();
  const lanUrl = `${location.protocol}//${location.host}/`;
  document.getElementById("you-body").innerHTML = `
    <div class="card">
      <p class="kicker">Profile</p>
      <h2>Saved on this device</h2>
      <p class="note">No login. Your name and history stay in this browser.</p>
      <form id="name-form" style="margin-top:16px">
        <label class="field">
          <span>Username</span>
          <input id="username-input" type="text" maxlength="40" autocapitalize="words" autocomplete="username" placeholder="e.g. Simon" value="${escapeHtml(state.username)}" />
        </label>
        <button class="btn primary" type="submit">Save name</button>
      </form>
    </div>
    <p class="note">On a phone or iPad on this Wi-Fi, open <strong>${escapeHtml(lanUrl)}</strong>. On iOS: Share → Add to Home Screen.</p>
    <div class="stats" style="margin-top:16px">
      <div class="stat"><b>${stats.rounds}</b><span>Rounds</span></div>
      <div class="stat good"><b>${stats.pct}%</b><span>Lifetime</span></div>
      <div class="stat"><b>${stats.correct}</b><span>Correct</span></div>
    </div>
    <p class="note">Lifetime stats are for ${escapeHtml(displayName())} on this device.</p>
    <div class="card" style="margin-top:16px">
      <p class="kicker">Training aid</p>
      <h2>DAL/2442 PDF</h2>
      <p class="note">The source memory-items pages for this trainer. Training use only.</p>
      <a class="btn primary" href="${TRAINING_PDF_VIEW}" style="margin-top:16px">View PDF</a>
    </div>
    <p class="note">Version ${escapeHtml(APP_VERSION)}</p>
    ${
      state.history.length
        ? `<button class="btn danger" data-action="clear-history" style="margin-top:16px;width:100%">Clear activity history</button>`
        : ""
    }
  `;
}

function render() {
  renderChrome();
  if (state.tab === "practice") renderPractice();
  if (state.tab === "summary") renderSummary();
  if (state.tab === "history") renderHistory();
  if (state.tab === "you") renderYou();
}

function submitAnswer(forceMiss) {
  const items = deck();
  const current = items[state.index];
  if (!current || state.phase !== "ask") return;
  const input = document.getElementById("answer-input");
  if (input) state.draft = input.value;
  const noteEl = document.getElementById("item-note");
  if (noteEl) setFlag(current.id, { note: noteEl.value });
  const grade = !forceMiss && isCorrect(state.draft, current) ? "correct" : "missed";
  state.results = { ...state.results, [current.id]: grade };
  state.lastGrade = grade;
  state.phase = "feedback";
  recordAttempt(current.id, grade);
  persistSession();
  render();
}

function goNext() {
  const items = deck();
  const current = items[state.index];
  const noteEl = document.getElementById("item-note");
  if (current && noteEl) setFlag(current.id, { note: noteEl.value });
  if (state.index + 1 >= items.length) {
    finishRound();
    render();
    return;
  }
  state.index += 1;
  state.phase = "ask";
  state.lastGrade = "";
  state.draft = "";
  persistSession();
  render();
}

function setUsername(value, onboard = false) {
  state.username = value.trim().slice(0, 40);
  localStorage.setItem(STORAGE.username, state.username);
  if (onboard) localStorage.setItem(STORAGE.onboarded, "1");
  render();
}

function showOnboarding() {
  const sheet = document.getElementById("onboard");
  if (localStorage.getItem(STORAGE.onboarded)) {
    sheet.hidden = true;
    return;
  }
  sheet.hidden = false;
  sheet.classList.add("open");
  document.getElementById("onboard-name").value = state.username;
}

document.addEventListener("click", (event) => {
  const tabBtn = event.target.closest("[data-tab]");
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    render();
    return;
  }

  const filterBtn = event.target.closest("[data-filter]");
  if (filterBtn) {
    const filter = filterBtn.dataset.filter;
    startRound(filter, idsForFilter(filter));
    state.tab = "practice";
    render();
    return;
  }

  const expand = event.target.closest("[data-expand]");
  if (expand) {
    const id = expand.dataset.expand;
    state.expandedId = state.expandedId === id ? "" : id;
    render();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "reveal") submitAnswer(true);
  if (action === "next") goNext();
  if (action === "flag") {
    const current = deck()[state.index];
    if (!current) return;
    const noteEl = document.getElementById("item-note");
    if (noteEl) setFlag(current.id, { note: noteEl.value });
    setFlag(current.id, { flagged: !flagEntry(current.id).flagged });
    render();
  }
  if (action === "reset") {
    const items = deck();
    const answered = items.filter((item) => state.results[item.id]).length;
    const hasFlags = flaggedItems(items).length > 0;
    if (
      (answered === 0 && !hasFlags) ||
      confirm("Reset this round? Answers, flags, and notes will be cleared.")
    ) {
      if (state.phase !== "done") dropSessionAttempts(state.sessionId);
      startRound(state.filter, idsForFilter(state.filter));
      render();
    }
  }
  if (action === "done-now") {
    const noteEl = document.getElementById("item-note");
    const current = deck()[state.index];
    if (current && noteEl) setFlag(current.id, { note: noteEl.value });
    finishRound();
    startRound(state.filter, idsForFilter(state.filter));
    state.tab = "summary";
    render();
  }
  if (action === "shuffle" || action === "new-round") {
    startRound(state.filter, idsForFilter(state.filter));
    render();
  }
  if (action === "restudy") {
    const ids = deck()
      .filter((item) => state.results[item.id] === "missed")
      .map((item) => item.id);
    startRound(state.filter, ids);
    render();
  }
  if (action === "skip-onboard") {
    localStorage.setItem(STORAGE.onboarded, "1");
    const sheet = document.getElementById("onboard");
    sheet.classList.remove("open");
    sheet.hidden = true;
    render();
  }
  if (action === "clear-history" && confirm("Clear all saved activity on this device?")) {
    state.history = [];
    writeJson(STORAGE.history, []);
    localStorage.removeItem(STORAGE.mastery);
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "answer-input") {
    state.draft = event.target.value;
  }
  if (event.target.id === "item-note") {
    const current = deck()[state.index];
    if (current) setFlag(current.id, { note: event.target.value });
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "answer-form") {
    submitAnswer(false);
  }
  if (event.target.id === "name-form") {
    setUsername(document.getElementById("username-input").value);
  }
  if (event.target.id === "onboard-form") {
    setUsername(document.getElementById("onboard-name").value, true);
    const sheet = document.getElementById("onboard");
    sheet.classList.remove("open");
    sheet.hidden = true;
  }
});

if (
  "serviceWorker" in navigator &&
  location.hostname !== "127.0.0.1" &&
  location.hostname !== "localhost"
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

load();
render();
showOnboarding();
