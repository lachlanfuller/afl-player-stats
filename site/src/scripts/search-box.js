// Type-ahead player search. The player list (about 0.2 MB compressed) loads the first time the
// box is used, then every keystroke is answered in the browser.
import { prepare, search } from "../lib/search.js";

const MAX_RESULTS = 12;
const number = new Intl.NumberFormat("en-AU");

let loading; // one shared request, even if the page has more than one search box

function fetchJson(url) {
  return fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  });
}

function loadPlayers(base) {
  loading ??= Promise.all([fetchJson(`${base}data/players-index.json`), fetchJson(`${base}data/franchises.json`)])
    .then(([players, franchises]) => ({
      entries: prepare(players),
      clubName: Object.fromEntries(franchises.map((f) => [f.id, f.name])),
    }))
    .catch((error) => {
      loading = undefined; // let the next keystroke try again
      throw error;
    });
  return loading;
}

const years = (p) => (p.first === p.last ? `${p.first}` : `${p.first}–${p.last}`);

function describe(player, clubName) {
  const clubs = Object.keys(player.clubs).map((id) => clubName[id] ?? id);
  const shown = clubs.length > 3 ? `${clubs.slice(0, 3).join(", ")} and ${clubs.length - 3} more` : clubs.join(", ");
  const games = `${number.format(player.games)} ${player.games === 1 ? "game" : "games"}`;
  return `${years(player)} · ${games} · ${shown}`;
}

function setUp(root) {
  const input = root.querySelector("input");
  const list = root.querySelector(".search-list");
  const status = root.querySelector(".search-status");
  const base = root.dataset.base;

  let options = [];
  let active = -1;
  let latest = 0; // a slow load must not overwrite the results for a newer query

  function setActive(index) {
    active = index;
    options.forEach((option, i) => option.setAttribute("aria-selected", String(i === index)));
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", options[index].id);
      options[index].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  }

  function open() {
    if (!options.length) return;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function render(found, query, clubName) {
    options = found.results.map((player, i) => {
      const link = document.createElement("a");
      link.href = `${base}players/${player.id}/`;
      link.id = `${list.id}-${i}`;
      link.tabIndex = -1;
      link.setAttribute("role", "option");
      link.setAttribute("aria-selected", "false");

      const name = document.createElement("span");
      name.className = "search-name";
      name.textContent = player.name;
      const meta = document.createElement("span");
      meta.className = "search-meta";
      meta.textContent = describe(player, clubName);
      link.append(name, meta);
      return link;
    });

    list.replaceChildren(
      ...options.map((link) => {
        const item = document.createElement("li");
        item.setAttribute("role", "presentation");
        item.append(link);
        return item;
      }),
    );

    if (!found.total) {
      status.textContent = `No players found for “${query.trim()}”.`;
      close();
      return;
    }
    status.textContent =
      found.total > found.results.length
        ? `Showing ${found.results.length} of ${number.format(found.total)} matches. Keep typing to narrow the list.`
        : `${found.total} ${found.total === 1 ? "match" : "matches"}.`;
    setActive(-1);
    open();
  }

  function update() {
    const query = input.value;
    const ticket = ++latest;
    if (!query.trim()) {
      options = [];
      list.replaceChildren();
      status.textContent = "";
      close();
      return;
    }
    loadPlayers(base).then(
      ({ entries, clubName }) => {
        if (ticket === latest) render(search(entries, query, MAX_RESULTS), query, clubName);
      },
      () => {
        if (ticket === latest) status.textContent = "Couldn't load the player list. Check your connection and keep typing to try again.";
      },
    );
  }

  input.addEventListener("input", update);

  input.addEventListener("focus", () => {
    loadPlayers(base).catch(() => {}); // start loading before the first keystroke
    if (input.value.trim() && options.length) open();
  });

  input.addEventListener("keydown", (event) => {
    const isOpen = !list.hidden && options.length > 0;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!isOpen) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // From nothing selected, Down picks the first result and Up the last; otherwise wrap around.
      const next = active === -1 ? (step === 1 ? 0 : options.length - 1) : (active + step + options.length) % options.length;
      setActive(next);
    } else if (event.key === "Enter") {
      if (!isOpen) return;
      event.preventDefault();
      window.location.assign(options[active >= 0 ? active : 0].href);
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        close();
      } else if (input.value) {
        input.value = "";
        update();
      }
    }
  });

  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) close();
  });
}

document.querySelectorAll("[data-search]").forEach(setUp);
