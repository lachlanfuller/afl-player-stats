// Builds links that work whether the site is served from the root or from a sub-path
// (see SITE_BASE in astro.config.mjs).
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

/** url() is the home page, url("about/") the About page, url("players/1105/") a player. */
export const url = (path = "") => `${base}/${path.replace(/^\//, "")}`;
