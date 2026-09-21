export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function validateConfig(config) {
  if (!config || typeof config.state_url !== "string" || !config.state_url
      || typeof config.demo !== "boolean") throw new Error("Invalid dashboard configuration");
  return config;
}

export function createDashboard(doc, fetcher, schedule = setTimeout, config = {
  state_url: "/api/v1/state/recipe-bot/current-recipe", demo: false
}) {
  validateConfig(config);
  const el = (id) => doc.getElementById(id);
  let timestamp = null;
  function render(state) {
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
  async function refresh() {
    try {
      const response = await fetcher(config.state_url, {
        cache: "no-store", signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404 && timestamp === null) {
        el("status").textContent = "Verbunden · Warte auf die erste Auswahl.";
        return;
      }
      if (!response.ok) throw new Error("Fetch failed");
      const state = await response.json();
      if (state.updated_at !== timestamp) { render(state); timestamp = state.updated_at; }
      el("status").textContent = `Aktuell · Zuletzt geprüft: ${new Date().toLocaleTimeString("de-DE")}`;
    } catch {
      el("status").textContent = "Aktualisierung nicht möglich. Nächster Versuch in 15 Sekunden.";
    } finally { schedule(refresh, 15000); }
  }
  return {refresh};
}

export async function startDashboard(doc, fetcher, schedule = setTimeout) {
  const configResponse = await fetcher("./dashboard-config.json", {
    cache: "no-store", signal: AbortSignal.timeout(10000)
  });
  if (!configResponse.ok) throw new Error("Dashboard configuration unavailable");
  const config = validateConfig(await configResponse.json());
  doc.getElementById("demo").hidden = !config.demo;
  const dashboard = createDashboard(doc, fetcher, schedule, config);
  await dashboard.refresh();
  return dashboard;
}

if (typeof document !== "undefined") {
  startDashboard(document, window.fetch.bind(window)).catch(() => {
    document.getElementById("status").textContent = "Dashboard-Konfiguration nicht verfügbar.";
  });
}
