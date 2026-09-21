import test from "node:test";
import assert from "node:assert/strict";
import {createDashboard, safeUrl, startDashboard, validateConfig} from "../web/app.js";

function harness(responses, config) {
  const nodes = new Map();
  const doc = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {hidden: ["recipe", "tasks"].includes(id), textContent: "",
        attributes: {}, children: [], tabIndex: 0,
        replaceChildren(...children) { this.children = children; },
        removeAttribute(key) { delete this[key]; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener() {}, focus() { this.focused = true; }});
      return nodes.get(id);
    },
    createElement() { return {replaceChildren(...children) { this.children = children; }}; }
  };
  const delays = [];
  const fetcher = async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  const app = createDashboard(doc, fetcher, (fn, delay) => delays.push(delay), config);
  return {app, fetcher, node: doc.getElementById, delays, doc};
}
function recipeResponse(automatic = false, timestamp = "2026-09-21T08:00:00Z") {
  return {ok: true, json: async () => ({updated_at: timestamp, payload: {
    automatic, date: "2026-09-21", recipe: {title: "<script>Rice</script>",
      ingredients: ["Rice"], instructions: ["Cook"], servings: 2,
      image_url: "javascript:alert(1)", source_url: "https://example.com/recipe"}
  }})};
}
function tasksResponse(timestamp = "2026-09-21T08:00:00Z") {
  return {ok: true, json: async () => ({updated_at: timestamp, payload: {
    date: "2026-09-21", residents: [
      {id: "alex", name: "Alex", off_day: false, tasks: ["Vacuum"]},
      {id: "sam", name: "Sam", off_day: true, tasks: []},
      {id: "jo", name: "Jo", off_day: false, tasks: []}
    ]
  }})};
}
test("empty recipe state polls after 15 seconds", async () => {
  const h = harness([{status: 404}]);
  await h.app.refresh();
  assert.equal(h.node("recipe").hidden, true);
  assert.match(h.node("status").textContent, /erste Auswahl/);
  assert.deepEqual(h.delays, [15000]);
});
test("manual selection renders plain text, automatic update replaces it", async () => {
  const h = harness([recipeResponse(), recipeResponse(true, "2026-09-22T08:00:00Z")]);
  await h.app.refresh();
  assert.equal(h.node("title").textContent, "<script>Rice</script>");
  assert.match(h.node("selection").textContent, /Manuell/);
  assert.equal(h.node("photo").hidden, true);
  assert.equal(h.node("instructions").children[0].textContent, "Cook");
  await h.app.refresh();
  assert.match(h.node("selection").textContent, /Automatisch/);
});
test("recipe failure retains displayed recipe", async () => {
  const h = harness([recipeResponse(), new Error("offline"), recipeResponse(true)]);
  await h.app.refresh();
  const children = h.node("instructions").children;
  await h.app.refresh();
  assert.equal(h.node("recipe").hidden, false);
  assert.match(h.node("status").textContent, /nicht möglich/);
  await h.app.refresh();
  assert.equal(h.node("instructions").children, children);
  assert.match(h.node("selection").textContent, /Manuell/);
});
test("tasks render date, update, task lists, days off, and empty assignments", async () => {
  const h = harness([tasksResponse()]);
  await h.app.refreshTasks();
  assert.equal(h.node("tasks").hidden, false);
  assert.match(h.node("tasks-status").textContent, /2026-09-21/);
  assert.match(h.node("tasks-status").textContent, /Aktualisiert/);
  assert.equal(h.node("tasks").children[0].children[1].children[0].textContent, "Vacuum");
  assert.equal(h.node("tasks").children[1].children[1].textContent, "Fester freier Tag");
  assert.equal(h.node("tasks").children[2].children[1].textContent, "Keine Aufgabe heute");
});
test("task fetch failure retains tasks and does not affect recipe", async () => {
  const h = harness([recipeResponse(), tasksResponse(), new Error("offline")]);
  await h.app.refreshRecipe();
  await h.app.refreshTasks();
  const cards = h.node("tasks").children;
  await h.app.refreshTasks();
  assert.equal(h.node("tasks").children, cards);
  assert.equal(h.node("recipe").hidden, false);
  assert.match(h.node("tasks-status").textContent, /nicht möglich/);
  assert.match(h.node("status").textContent, /Aktuell/);
});
test("tabs expose selected panel accessibly", () => {
  const h = harness([]);
  h.app.selectTab("tasks");
  assert.equal(h.node("tasks-panel").hidden, false);
  assert.equal(h.node("recipe-panel").hidden, true);
  assert.equal(h.node("tasks-tab").attributes["aria-selected"], "true");
});
test("URL schemes restricted to HTTP(S)", () => {
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://example.com/rice"), "https://example.com/rice");
});
test("explicit demo configuration loads recipe and task samples", async () => {
  const h = harness([recipeResponse(), tasksResponse()]);
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url === "./dashboard-config.json") return {ok: true, json: async () => ({
      recipe_state_url: "./demo-state.json", tasks_state_url: "./demo-tasks-state.json", demo: true
    })};
    return h.fetcher(url);
  };
  await startDashboard(h.doc, fetcher, (fn, delay) => h.delays.push(delay));
  assert.deepEqual(calls, ["./dashboard-config.json", "./demo-state.json", "./demo-tasks-state.json"]);
  assert.equal(h.node("demo").hidden, false);
});
test("invalid configuration is rejected", () => {
  assert.throws(() => validateConfig({recipe_state_url: "", tasks_state_url: "x", demo: false}));
  assert.throws(() => validateConfig({recipe_state_url: "x", demo: false}));
});
