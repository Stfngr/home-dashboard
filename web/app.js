export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function validateConfig(config) {
  if (!config || typeof config.recipe_state_url !== "string" || !config.recipe_state_url
      || typeof config.tasks_state_url !== "string" || !config.tasks_state_url
      || typeof config.demo !== "boolean") throw new Error("Invalid dashboard configuration");
  return config;
}

export function createDashboard(doc, fetcher, schedule = setTimeout, config = {
  recipe_state_url: "/api/v1/state/recipe-bot/current-recipe",
  tasks_state_url: "/api/v1/state/household-agent/current-tasks", demo: false
}) {
  validateConfig(config);
  const el = (id) => doc.getElementById(id);
  let recipeTimestamp = null;
  let tasksTimestamp = null;

  function renderRecipe(state) {
    const {recipe, automatic, date} = state.payload;
    if (!recipe || typeof recipe.title !== "string" || !Array.isArray(recipe.ingredients)
        || !Array.isArray(recipe.instructions)) throw new Error("Invalid recipe");
    el("title").textContent = recipe.title;
    el("selection").textContent = `${automatic ? "Automatisch" : "Manuell"} ausgewählt · ${date} · ${new Date(state.updated_at).toLocaleString("de-DE")}`;
    const facts = [["Portionen", recipe.servings], ["Gesamtzeit", recipe.ready_minutes],
      ["Vorbereitung", recipe.prep_minutes], ["Kochzeit", recipe.cooking_minutes]]
      .filter(([, value]) => Number.isInteger(value) && value >= 0)
      .map(([label, value]) => `${label}: ${value}${label === "Portionen" ? "" : " Min."}`);
    el("facts").textContent = facts.join(" · ");
    el("facts").hidden = !facts.length;
    for (const key of ["ingredients", "instructions"]) {
      el(key).replaceChildren(...recipe[key].map((text) => {
        const item = doc.createElement("li");
        item.textContent = text;
        return item;
      }));
    }
    const image = safeUrl(recipe.image_url);
    el("photo").hidden = !image;
    el("photo").onerror = () => { el("photo").hidden = true; };
    if (image) { el("photo").src = image; el("photo").alt = recipe.title; }
    else el("photo").removeAttribute("src");
    const source = safeUrl(recipe.source_url);
    el("source").hidden = !source;
    if (source) el("source").href = source;
    else el("source").removeAttribute("href");
    el("credits").textContent = [recipe.source_name, recipe.license].filter(Boolean).join(" · ");
    el("empty").hidden = true;
    el("recipe").hidden = false;
  }

  function renderTasks(state) {
    const {date, residents} = state.payload;
    if (typeof date !== "string" || !Array.isArray(residents)) throw new Error("Invalid tasks");
    const cards = residents.map((resident) => {
      if (!resident || typeof resident.name !== "string" || typeof resident.off_day !== "boolean"
          || !Array.isArray(resident.tasks)) throw new Error("Invalid resident tasks");
      const card = doc.createElement("article");
      card.className = "card task-card";
      const name = doc.createElement("h2");
      name.textContent = resident.name;
      const list = doc.createElement("ul");
      if (resident.off_day || !resident.tasks.length) {
        const message = doc.createElement("p");
        message.className = "task-state";
        message.textContent = resident.off_day ? "Fester freier Tag" : "Keine Aufgabe heute";
        card.replaceChildren(name, message);
      } else {
        list.replaceChildren(...resident.tasks.map((task) => {
          const item = doc.createElement("li");
          item.textContent = task;
          return item;
        }));
        card.replaceChildren(name, list);
      }
      return card;
    });
    el("tasks").replaceChildren(...cards);
    el("tasks").setAttribute("aria-label", `Haushaltsaufgaben für ${date}, aktualisiert ${new Date(state.updated_at).toLocaleString("de-DE")}`);
    el("tasks-empty").hidden = true;
    el("tasks").hidden = false;
  }

  async function refreshRecipe() {
    try {
      const response = await fetcher(config.recipe_state_url, {
        cache: "no-store", signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404 && recipeTimestamp === null) {
        el("status").textContent = "Verbunden · Warte auf die erste Auswahl.";
        return;
      }
      if (!response.ok) throw new Error("Fetch failed");
      const state = await response.json();
      if (state.updated_at !== recipeTimestamp) { renderRecipe(state); recipeTimestamp = state.updated_at; }
      el("status").textContent = `Aktuell · Zuletzt geprüft: ${new Date().toLocaleTimeString("de-DE")}`;
    } catch {
      el("status").textContent = "Aktualisierung nicht möglich. Nächster Versuch in 15 Sekunden.";
    } finally { schedule(refreshRecipe, 15000); }
  }

  async function refreshTasks() {
    try {
      const response = await fetcher(config.tasks_state_url, {
        cache: "no-store", signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404 && tasksTimestamp === null) {
        el("tasks-status").textContent = "Verbunden · Warte auf erste Aufgaben.";
        return;
      }
      if (!response.ok) throw new Error("Fetch failed");
      const state = await response.json();
      if (state.updated_at !== tasksTimestamp) { renderTasks(state); tasksTimestamp = state.updated_at; }
      el("tasks-status").textContent = `Aufgaben für ${state.payload.date} · Aktualisiert: ${new Date(state.updated_at).toLocaleString("de-DE")}`;
    } catch {
      el("tasks-status").textContent = "Aufgabenaktualisierung nicht möglich. Nächster Versuch in 15 Sekunden.";
    } finally { schedule(refreshTasks, 15000); }
  }

  function selectTab(name) {
    const recipe = name === "recipe";
    el("recipe-tab").setAttribute("aria-selected", String(recipe));
    el("recipe-tab").tabIndex = recipe ? 0 : -1;
    el("recipe-panel").hidden = !recipe;
    el("tasks-tab").setAttribute("aria-selected", String(!recipe));
    el("tasks-tab").tabIndex = recipe ? -1 : 0;
    el("tasks-panel").hidden = recipe;
  }

  for (const name of ["recipe", "tasks"]) {
    const tab = el(`${name}-tab`);
    if (!tab || !tab.addEventListener) continue;
    tab.addEventListener("click", () => selectTab(name));
    tab.addEventListener("keydown", (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const next = name === "recipe" ? "tasks" : "recipe";
      selectTab(next);
      el(`${next}-tab`).focus();
    });
  }
  return {refresh: refreshRecipe, refreshRecipe, refreshTasks, selectTab};
}

export async function startDashboard(doc, fetcher, schedule = setTimeout) {
  const configResponse = await fetcher("./dashboard-config.json", {
    cache: "no-store", signal: AbortSignal.timeout(10000)
  });
  if (!configResponse.ok) throw new Error("Dashboard configuration unavailable");
  const config = validateConfig(await configResponse.json());
  doc.getElementById("demo").hidden = !config.demo;
  const dashboard = createDashboard(doc, fetcher, schedule, config);
  await Promise.all([dashboard.refreshRecipe(), dashboard.refreshTasks()]);
  return dashboard;
}

if (typeof document !== "undefined") {
  startDashboard(document, window.fetch.bind(window)).catch(() => {
    document.getElementById("status").textContent = "Dashboard-Konfiguration nicht verfügbar.";
  });
}
