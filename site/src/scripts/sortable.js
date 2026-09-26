// Makes a table sortable by clicking its column headings. Mark the table with data-sortable and
// each sortable heading with data-sort="number" or data-sort="text". A cell can carry data-value
// when what should be sorted differs from what is shown (for example "2002–2020" sorts by 2002).

function valueOf(row, column, type) {
  const cell = row.cells[column];
  const raw = cell.dataset.value ?? cell.textContent.trim();
  return type === "number" ? Number(raw) : raw.toLowerCase();
}

export function makeSortable(table) {
  const body = table.tBodies[0];
  const headings = [...table.tHead.rows[0].cells];
  [...body.rows].forEach((row, i) => (row.dataset.order = String(i)));

  headings.forEach((heading, column) => {
    const type = heading.dataset.sort;
    if (!type) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "sort";
    button.append(...heading.childNodes);
    heading.append(button);

    button.addEventListener("click", () => {
      const current = heading.getAttribute("aria-sort");
      // Numbers start with the biggest, words with A to Z; clicking again reverses.
      const direction = current ? (current === "ascending" ? "descending" : "ascending") : type === "number" ? "descending" : "ascending";
      const sign = direction === "ascending" ? 1 : -1;

      const rows = [...body.rows].sort((a, b) => {
        const x = valueOf(a, column, type);
        const y = valueOf(b, column, type);
        const order = type === "number" ? x - y : x.localeCompare(y);
        return sign * order || Number(a.dataset.order) - Number(b.dataset.order);
      });
      body.append(...rows);

      headings.forEach((h) => h.removeAttribute("aria-sort"));
      heading.setAttribute("aria-sort", direction);
    });
  });
}

document.querySelectorAll("table[data-sortable]").forEach(makeSortable);
