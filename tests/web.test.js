import test from "node:test";
import assert from "node:assert/strict";
import {createDashboard, safeUrl} from "../web/app.js";

function harness(responses) {
  const nodes = new Map();
  const doc = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {hidden: id === "recipe", textContent: "",
        replaceChildren(...children) { this.children = children; },
        removeAttribute(key) { delete this[key]; }});
      return nodes.get(id);
    },
    createElement() { return {}; }
  };
  const delays = [];
  const app = createDashboard(doc, async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }, (fn, delay) => delays.push(delay));
  return {app, node: doc.getElementById, delays};
}
function response(automatic = false, timestamp = "2026-09-21T08:00:00Z") {
  return {ok: true, json: async () => ({updated_at: timestamp, payload: {
    automatic, date: "2026-09-21", recipe: {title: "<script>Rice</script>",
      ingredients: ["Rice"], instructions: ["Cook"], servings: 2,
      image_url: "javascript:alert(1)", source_url: "https://example.com/recipe"}
  }})};
}
test("empty state polls after 15 seconds", async () => {
  const h = harness([{status: 404}]);
  await h.app.refresh();
  assert.equal(h.node("recipe").hidden, true);
  assert.match(h.node("status").textContent, /erste Auswahl/);
  assert.deepEqual(h.delays, [15000]);
});
test("manual selection renders plain text, automatic update replaces it", async () => {
  const h = harness([response(), response(true, "2026-09-22T08:00:00Z")]);
  await h.app.refresh();
  assert.equal(h.node("title").textContent, "<script>Rice</script>");
  assert.match(h.node("selection").textContent, /Manuell/);
  assert.equal(h.node("photo").hidden, true);
  assert.equal(h.node("instructions").children[0].textContent, "Cook");
  await h.app.refresh();
  assert.match(h.node("selection").textContent, /Automatisch/);
});
test("failed refresh and unchanged timestamp retain displayed recipe", async () => {
  const h = harness([response(), new Error("offline"), response(true)]);
  await h.app.refresh();
  const children = h.node("instructions").children;
  await h.app.refresh();
  assert.equal(h.node("recipe").hidden, false);
  assert.match(h.node("status").textContent, /nicht möglich/);
  await h.app.refresh();
  assert.equal(h.node("instructions").children, children);
  assert.match(h.node("selection").textContent, /Manuell/);
});
test("URL schemes restricted to HTTP(S)", () => {
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("https://example.com/rice"), "https://example.com/rice");
});
