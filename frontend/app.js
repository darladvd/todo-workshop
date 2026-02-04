(() => {
  const cfg = window.APP_CONFIG || {};

  // UI column codes (match your index.html data-drop / data-count)
  const STATUS_ORDER = ["NOT_STARTED", "IN_PROGRESS", "DONE"];

  // Mapping between backend labels and UI codes
  const STATUS_LABEL_FROM_CODE = {
    NOT_STARTED: "Not Started",
    IN_PROGRESS: "In Progress",
    DONE: "Done",
  };

  const STATUS_CODE_FROM_LABEL = {
    "Not Started": "NOT_STARTED",
    "In Progress": "IN_PROGRESS",
    "Done": "DONE",
  };

  const state = {
    tasks: [],
    dragTaskId: null,
  };

  const $ = (id) => document.getElementById(id);

  // ---------- Utils ----------
  function nowIso() {
    return new Date().toISOString();
  }

  function safeStr(v) {
    return (v ?? "").toString();
  }

  function escapeHtml(str) {
    return safeStr(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeHtmlAttr(str) {
    return escapeHtml(str).replaceAll("`", "&#096;");
  }

  function setTitle() {
    const name = (cfg.STUDENT_NAME || "Student").trim();
    $("pageTitle").textContent = `${name}'s To Do List`;
  }

  function apiUrl(path) {
    const base = (cfg.API_BASE_URL || "").replace(/\/$/, "");
    return base + path;
  }

  function tasksPath() {
    return cfg.TASKS_PATH || "/tasks";
  }

  function taskByIdPath(id) {
    // Supports "/tasks/{id}" template if provided
    const tpl = cfg.TASK_BY_ID_PATH || "/tasks/{id}";
    return tpl.replace("{id}", encodeURIComponent(id));
  }

  function categoriesPath() {
    return cfg.CATEGORIES_PATH || "/categories";
  }

  function formatDue(dateStr) {
    if (!dateStr) return "No due";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "No due";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function isOverdue(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr + "T23:59:59");
    if (Number.isNaN(d.getTime())) return false;
    return d.getTime() < Date.now();
  }

  function toStatusCode(anyStatus) {
    const s = safeStr(anyStatus).trim();
    if (STATUS_ORDER.includes(s)) return s; // already a code
    if (STATUS_CODE_FROM_LABEL[s]) return STATUS_CODE_FROM_LABEL[s]; // label -> code
    return "NOT_STARTED";
  }

  function toStatusLabel(anyStatus) {
    const s = safeStr(anyStatus).trim();
    if (STATUS_LABEL_FROM_CODE[s]) return STATUS_LABEL_FROM_CODE[s]; // code -> label
    if (STATUS_CODE_FROM_LABEL[s]) return s; // already a label we know
    return "Not Started";
  }

  // Normalize task from API into UI-friendly shape
  function normalizeTask(raw) {
    const id = raw.id ?? raw.taskId ?? raw._id ?? raw.pk ?? raw.SK;
    const dueDate = raw.due_date ?? raw.dueDate ?? raw.due ?? "";
    const createdAt = raw.created_at ?? raw.createdAt ?? "";
    const updatedAt = raw.updated_at ?? raw.updatedAt ?? "";

    const statusCode = toStatusCode(raw.status || "Not Started");

    return {
      id: safeStr(id),
      title: safeStr(raw.title || raw.taskTitle || raw.name || "Untitled Task"),
      status: statusCode, // <-- UI CODE stored here
      category: safeStr(raw.category || ""),
      due_date: safeStr(dueDate || ""),
      description: safeStr(raw.description || ""),
      createdAt: safeStr(createdAt || ""),
      updatedAt: safeStr(updatedAt || ""),
    };
  }

  function sortTasks(list) {
    const sortMode = $("sortSelect").value;
    const copy = [...list];

    if (sortMode === "dueSoon") {
      copy.sort((a, b) => {
        const ad = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;

        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
    } else {
      // recent
      copy.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }

    return copy;
  }

  function filterTasks() {
    const q = safeStr($("searchInput").value).trim().toLowerCase();
    const cat = $("categoryFilter").value;

    let list = [...state.tasks];

    if (q) {
      list = list.filter((t) => t.title.toLowerCase().includes(q));
    }

    if (cat) {
      list = list.filter((t) => t.category === cat);
    }

    return sortTasks(list);
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, isError = false) {
    clearTimeout(toastTimer);

    let box = document.getElementById("toastBox");
    if (!box) {
      box = document.createElement("div");
      box.id = "toastBox";
      box.style.position = "fixed";
      box.style.top = "18px";
      box.style.right = "18px";
      box.style.padding = "10px 12px";
      box.style.borderRadius = "12px";
      box.style.border = "1px solid #e5e7eb";
      box.style.background = "white";
      box.style.boxShadow = "0 18px 45px rgba(0,0,0,0.12)";
      box.style.fontSize = "13px";
      box.style.zIndex = "9999";
      document.body.appendChild(box);
    }

    box.textContent = msg;
    box.style.color = isError ? "#b91c1c" : "#111827";
    box.style.borderColor = isError ? "#fecaca" : "#e5e7eb";
    box.style.background = isError ? "#fff1f2" : "white";
    box.style.display = "block";

    toastTimer = setTimeout(() => {
      box.style.display = "none";
    }, 2500);
  }

  function setLoading(on) {
    const btn = $("btnRefresh");
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? "Loading..." : "↻ Refresh";
  }

  // ---------- API ----------
  async function apiFetch(path, options = {}) {
    const res = await fetch(apiUrl(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      const msg =
        data && (data.message || data.error)
          ? data.message || data.error
          : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    return data;
  }

  async function loadTasks() {
    try {
      setLoading(true);
      const data = await apiFetch(tasksPath(), { method: "GET" });

      const arr = Array.isArray(data) ? data : data?.items || data?.tasks || [];
      state.tasks = arr.map(normalizeTask).filter((t) => t.id);

      // Ensure createdAt exists for sorting
      state.tasks = state.tasks.map((t) => ({
        ...t,
        createdAt: t.createdAt || nowIso(),
      }));

      render();
      toast("Loaded tasks ✅");
    } catch (err) {
      console.error(err);
      toast(`Load failed: ${err.message}`, true);
    } finally {
      setLoading(false);
    }
  }

  async function createTask(payload) {
    const data = await apiFetch(tasksPath(), {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // If API returns created object
    if (data && typeof data === "object") {
      const created = normalizeTask(data);
      if (created.id) {
        state.tasks.unshift({ ...created, createdAt: created.createdAt || nowIso() });
        return created;
      }
    }

    // Otherwise reload
    await loadTasks();
    return null;
  }

  async function updateTask(id, payload) {
    await apiFetch(taskByIdPath(id), {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    // Update local best-effort
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      const merged = { ...state.tasks[idx], ...payload };
      state.tasks[idx] = normalizeTask(merged);
      state.tasks[idx].createdAt = state.tasks[idx].createdAt || nowIso();
    } else {
      await loadTasks();
    }
  }

  async function deleteTask(id) {
    await apiFetch(taskByIdPath(id), { method: "DELETE" });
    state.tasks = state.tasks.filter((t) => t.id !== id);
  }

  // ---------- Categories ----------
  function normalizeCategoryResponse(data) {
    // supports: ["School","Work"] OR {items:[...]} OR {categories:[...]}
    const arr = Array.isArray(data) ? data : data?.items || data?.categories || [];
    return arr
      .map((x) => (typeof x === "string" ? x : x?.name || x?.category || ""))
      .map((s) => safeStr(s).trim())
      .filter(Boolean);
  }

  async function loadCategories() {
    try {
      const data = await apiFetch(categoriesPath(), { method: "GET" });
      const cats = normalizeCategoryResponse(data);
      fillCategorySelect(cats);
    } catch (err) {
      console.warn("Categories load failed:", err);
      fillCategorySelect([]);
    }
  }

  function fillCategorySelect(cats) {
    const select = $("categorySelect");
    if (!select) return;

    const current = select.value;
    const uniq = Array.from(new Set(cats)).sort((a, b) => a.localeCompare(b));
    const options = ['<option value="">Select category...</option>'].concat(
      uniq.map((c) => `<option value="${escapeHtmlAttr(c)}">${escapeHtml(c)}</option>`)
    );

    select.innerHTML = options.join("");

    if (uniq.includes(current)) select.value = current;
  }

  function addCategoryToSelect(name) {
    const select = $("categorySelect");
    if (!select) return;

    const n = (name || "").trim();
    if (!n) return;

    const exists = Array.from(select.options).some((o) => o.value === n);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      select.appendChild(opt);
    }
    select.value = n;
  }

  // Also fill the FILTER dropdown (top bar) based on tasks
  function fillCategoryFilterFromTasks() {
    const select = $("categoryFilter");
    if (!select) return;

    const current = select.value;
    const cats = Array.from(
      new Set(state.tasks.map((t) => t.category).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const options = ['<option value="">All</option>'].concat(
      cats.map((c) => `<option value="${escapeHtmlAttr(c)}">${escapeHtml(c)}</option>`)
    );

    select.innerHTML = options.join("");

    if (cats.includes(current)) select.value = current;
  }

  // ---------- Render ----------
  function render() {
    const list = filterTasks();

    // clear columns + reset counts
    for (const statusCode of STATUS_ORDER) {
      const body = document.querySelector(`.column__body[data-drop="${cssEscape(statusCode)}"]`);
      if (body) body.innerHTML = "";

      const count = document.querySelector(`.count[data-count="${cssEscape(statusCode)}"]`);
      if (count) count.textContent = "0";
    }

    const counts = {
      NOT_STARTED: 0,
      IN_PROGRESS: 0,
      DONE: 0,
    };

    for (const t of list) {
      t.status = toStatusCode(t.status); // ensure valid code
      counts[t.status]++;

      const body = document.querySelector(`.column__body[data-drop="${cssEscape(t.status)}"]`);
      if (!body) continue;

      body.appendChild(renderCard(t));
    }

    // update counts
    for (const k of Object.keys(counts)) {
      const countEl = document.querySelector(`.count[data-count="${cssEscape(k)}"]`);
      if (countEl) countEl.textContent = String(counts[k]);
    }

    fillCategoryFilterFromTasks();
  }

  function renderCard(t) {
    const card = document.createElement("div");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = t.id;

    const categoryBadge = t.category
      ? `<span class="badge">${escapeHtml(t.category)}</span>`
      : `<span class="badge">Uncategorized</span>`;

    const overdue = isOverdue(t.due_date);
    const dueText = formatDue(t.due_date);
    const dueHtml = `<span class="due" title="${overdue ? "Overdue" : "Due"}">${overdue ? "⚠︎" : "📅"} ${escapeHtml(
      dueText
    )}</span>`;

    const hasDesc = safeStr(t.description).trim().length > 0;
    const descIcon = hasDesc ? `<span class="badge" title="Has description">?</span>` : "";

    card.innerHTML = `
      <div class="card__top">
        ${categoryBadge}
        <button class="card__menu" type="button" title="Edit" aria-label="Edit">⋯</button>
      </div>

      <div class="card__title">${escapeHtml(t.title)}</div>

      <div class="card__footer">
        ${dueHtml}
        <div class="avatars">
          ${descIcon}
        </div>
      </div>
    `;

    // edit
    card.querySelector(".card__menu").addEventListener("click", (e) => {
      e.stopPropagation();
      openModalForEdit(t.id);
    });

    card.addEventListener("click", () => openModalForEdit(t.id));

    // drag
    card.addEventListener("dragstart", (e) => {
      state.dragTaskId = t.id;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", t.id);
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      state.dragTaskId = null;
    });

    return card;
  }

  // ---------- Drag & Drop ----------
  function initDnD() {
    document.querySelectorAll(".droppable").forEach((zone) => {
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      });

      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));

      zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");

        const newStatusCode = zone.dataset.drop; // NOT_STARTED / IN_PROGRESS / DONE
        const id = e.dataTransfer.getData("text/plain") || state.dragTaskId;
        if (!id) return;

        const task = state.tasks.find((t) => t.id === id);
        if (!task) return;

        if (task.status === newStatusCode) return;

        const prevStatus = task.status;
        task.status = newStatusCode; // optimistic (UI)
        render();

        try {
          // Backend expects LABELS
          await updateTask(id, { status: toStatusLabel(newStatusCode) });
          toast(`Moved to ${toStatusLabel(newStatusCode)} ✅`);
        } catch (err) {
          console.error(err);
          task.status = prevStatus; // rollback
          render();
          toast(`Move failed: ${err.message}`, true);
        }
      });
    });
  }

  // ---------- Modal + Rich Text ----------
  function openModal() {
    const m = $("modal");
    m.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const m = $("modal");
    m.setAttribute("aria-hidden", "true");
    $("taskForm").reset();
    $("taskId").value = "";
    $("btnDelete").style.display = "none";

    // Clear rich editor
    const ed = $("descriptionEditor");
    if (ed) ed.innerHTML = "";
    const hidden = $("descriptionInput");
    if (hidden) hidden.value = "";

    // Clear category add box
    if ($("categoryNew")) $("categoryNew").value = "";
  }

  function openModalForNew() {
    $("modalTitle").textContent = "Add New Task";
    $("btnDelete").style.display = "none";
    $("taskId").value = "";

    $("titleInput").value = "";
    $("statusInput").value = "Not Started"; // label (modal)
    $("dueInput").value = "";
    $("categorySelect").value = "";
    $("categoryNew").value = "";

    $("descriptionEditor").innerHTML = "";
    $("descriptionInput").value = "";

    openModal();
    $("titleInput").focus();
  }

  function openModalForEdit(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;

    $("modalTitle").textContent = "Edit Task";
    $("btnDelete").style.display = "inline-block";

    $("taskId").value = t.id;
    $("titleInput").value = t.title || "";
    $("statusInput").value = toStatusLabel(t.status); // code -> label
    $("dueInput").value = t.due_date || "";

    addCategoryToSelect(t.category || "");

    const desc = t.description || "";
    $("descriptionEditor").innerHTML = desc;
    $("descriptionInput").value = desc;

    openModal();
    $("titleInput").focus();
  }

  function initModal() {
    $("btnNew").addEventListener("click", openModalForNew);
    $("btnCancel").addEventListener("click", closeModal);
    $("modalClose").addEventListener("click", closeModal);
    $("modalBackdrop").addEventListener("click", closeModal);

    // Add category button
    $("btnAddCategory").addEventListener("click", () => {
      const v = $("categoryNew").value.trim();
      if (!v) return;
      addCategoryToSelect(v);
      $("categoryNew").value = "";
    });

    // Enter key in "Add new..." input
    $("categoryNew").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("btnAddCategory").click();
      }
    });

    // Rich text toolbar
    document.querySelectorAll(".rte__btn[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cmd = btn.getAttribute("data-cmd");
        document.execCommand(cmd, false, null);
        $("descriptionEditor").focus();
      });
    });

    // Keep hidden input in sync (store HTML)
    $("descriptionEditor").addEventListener("input", () => {
      $("descriptionInput").value = $("descriptionEditor").innerHTML;
    });

    // Delete
    $("btnDelete").addEventListener("click", async () => {
      const id = $("taskId").value;
      if (!id) return;

      const ok = confirm("Delete this task?");
      if (!ok) return;

      try {
        await deleteTask(id);
        closeModal();
        render();
        toast("Deleted ✅");
      } catch (err) {
        console.error(err);
        toast(`Delete failed: ${err.message}`, true);
      }
    });

    // Submit
    $("taskForm").addEventListener("submit", async (e) => {
      e.preventDefault();

      const id = $("taskId").value;

      const categoryValue = $("categorySelect").value || $("categoryNew").value.trim();
      const descriptionHtml = $("descriptionInput").value || $("descriptionEditor").innerHTML || "";

      // Backend expects LABELS
      const payload = {
        title: $("titleInput").value.trim(),
        category: categoryValue,
        due_date: $("dueInput").value,
        status: $("statusInput").value, // label from select
        description: descriptionHtml,
      };

      if (!payload.title) return toast("Title is required", true);
      if (!payload.category) return toast("Category is required", true);

      try {
        if (!id) {
          payload.createdAt = nowIso(); // harmless if backend ignores
          await createTask(payload);
          toast("Created ✅");
        } else {
          await updateTask(id, payload);
          toast("Updated ✅");
        }

        closeModal();
        render();
      } catch (err) {
        console.error(err);
        toast(`Save failed: ${err.message}`, true);
      }
    });
  }

  // ---------- Controls ----------
  function initControls() {
    $("searchInput").addEventListener("input", render);
    $("categoryFilter").addEventListener("change", render);
    $("sortSelect").addEventListener("change", render);
    $("btnRefresh").addEventListener("click", loadTasks);
  }

  // ---------- CSS escape for attribute selectors ----------
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return safeStr(value).replace(/"/g, '\\"');
  }

  // ---------- Init ----------
  function init() {
    setTitle();
    initControls();
    initDnD();
    initModal();
    loadCategories();
    loadTasks();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
