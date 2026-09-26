// Played for two clubs. The player list and franchise names (about 0.2 MB compressed) load the
// first time a club is chosen, then every change is answered in the browser.
import { playersForBothClubs } from "../lib/two-clubs.js";
import { makeSortable } from "./sortable.js";

let loading;

function fetchJson(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  });
}

function loadPlayers(base) {
  loading ??= fetchJson(`${base}data/players-index.json`);
  return loading;
}

const number = new Intl.NumberFormat("en-AU");
const years = (p) => (p.first === p.last ? `${p.first}` : `${p.first}–${p.last}`);

function setUp(root) {
  const [selectA, selectB] = root.querySelectorAll("select");
  const status = root.querySelector(".two-clubs-status");
  const resultWrap = root.querySelector(".two-clubs-result");
  const base = root.dataset.base;

  function nameOf(select) {
    return select.options[select.selectedIndex]?.text ?? "";
  }

  function render(players) {
    const nameA = nameOf(selectA);
    const nameB = nameOf(selectB);

    if (!selectA.value || !selectB.value) {
      status.textContent = "Choose two clubs to see who has played for both.";
      clearResult();
      return;
    }
    if (selectA.value === selectB.value) {
      status.textContent = "Choose two different clubs.";
      clearResult();
      return;
    }
    if (!players.length) {
      status.textContent = `No one has played a game for both ${nameA} and ${nameB}.`;
      clearResult();
      return;
    }

    status.textContent = `${plural(players.length)} played for both ${nameA} and ${nameB}.`;

    const table = document.createElement("table");
    table.dataset.sortable = "";

    const heading = (text, sort, numeric = false) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.dataset.sort = sort;
      if (numeric) th.className = "num";
      th.textContent = text;
      return th;
    };
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.append(heading("Player", "text"), heading("Career", "number"), heading(`${nameA} games`, "number", true), heading(`${nameB} games`, "number", true));
    thead.append(headRow);

    const body = document.createElement("tbody");
    table.append(thead, body);
    body.replaceChildren(
      ...players.map((player) => {
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        const link = document.createElement("a");
        link.href = `${base}players/${player.id}/`;
        link.textContent = player.name;
        nameCell.append(link);
        const careerCell = document.createElement("td");
        careerCell.dataset.value = String(player.first);
        careerCell.textContent = years(player);
        const gamesA = document.createElement("td");
        gamesA.className = "num";
        gamesA.textContent = number.format(player.gamesA);
        const gamesB = document.createElement("td");
        gamesB.className = "num";
        gamesB.textContent = number.format(player.gamesB);
        row.append(nameCell, careerCell, gamesA, gamesB);
        return row;
      }),
    );
    resultWrap.className = "two-clubs-result table-wrap";
    resultWrap.replaceChildren(table);
    makeSortable(table);
  }

  function clearResult() {
    resultWrap.className = "two-clubs-result";
    resultWrap.replaceChildren();
  }

  function plural(n) {
    return `${number.format(n)} ${n === 1 ? "player has" : "players have"}`;
  }

  function update() {
    if (!selectA.value || !selectB.value || selectA.value === selectB.value) {
      render([]);
      return;
    }
    status.textContent = "Loading…";
    loadPlayers(base).then(
      (players) => render(playersForBothClubs(players, selectA.value, selectB.value)),
      () => {
        status.textContent = "Couldn't load the player list. Check your connection and try again.";
      },
    );
  }

  selectA.addEventListener("change", update);
  selectB.addEventListener("change", update);
  render([]);
}

document.querySelectorAll("[data-two-clubs]").forEach(setUp);
