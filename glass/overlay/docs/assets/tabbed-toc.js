/**
 * Synchronises the right-sidebar TOC with the active content tab.
 *
 * Pages in this site are tiered: the whole body sits in one pymdownx.tabbed set with
 * "Quick", "Standard" and "Deep Dive" blocks. Markdown does not know about tabs, so the
 * `toc` extension emits headings from ALL THREE tiers into a single sidebar list — a reader
 * on the 3-minute Quick tab would otherwise be looking at a contents list mostly made of
 * headings that are not on screen and cannot be scrolled to.
 *
 * This hides the TOC entries whose anchors live in an inactive tab, so the sidebar always
 * describes what is actually being read.
 *
 * Ported from /Users/…/Agentic/_work/rapid-automations/docs/javascripts/tabbed-toc.js, which
 * has been serving the same purpose for that site's 2-tier pages. Changed on the way in:
 * the href fragment is now decoded before it is compared to the heading id, because Material
 * percent-encodes non-ASCII anchors in the TOC while the id attribute itself is literal.
 */
(function () {
  "use strict";

  function updateToc() {
    var tocs = document.querySelectorAll(".md-nav--secondary");
    if (!tocs.length) return;

    var tabbedSets = document.querySelectorAll(".tabbed-set");
    if (!tabbedSets.length) return;

    // A heading is hidden if it lives in an unchecked tab. It is visible if it lives in a
    // checked one, or in no tab at all. Both sets are collected because a page may hold
    // several tabbed sets, and an id that is visible anywhere must stay visible.
    var hiddenIds = new Set();
    var visibleIds = new Set();

    tabbedSets.forEach(function (set) {
      var inputs = set.querySelectorAll(':scope > input[type="radio"]');
      var blocks = set.querySelectorAll(":scope > .tabbed-content > .tabbed-block");

      inputs.forEach(function (input, idx) {
        var block = blocks[idx];
        if (!block) return;

        block.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(function (h) {
          if (!h.id) return;
          (input.checked ? visibleIds : hiddenIds).add(h.id);
        });
      });
    });

    // Material renders the TOC twice — once for the desktop sidebar, once for the mobile
    // drawer. Updating only the first leaves the drawer showing every tier.
    tocs.forEach(function (toc) {
      toc.querySelectorAll("a.md-nav__link").forEach(function (link) {
        var href = link.getAttribute("href");
        if (!href || href.charAt(0) !== "#") return;

        var id = href.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch (e) {
          // Malformed escape sequence — compare the raw fragment rather than throwing and
          // leaving the rest of the TOC unprocessed.
        }

        var li = link.closest("li");
        if (!li) return;

        li.style.display = hiddenIds.has(id) && !visibleIds.has(id) ? "none" : "";
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateToc);
  } else {
    updateToc();
  }

  // Delegated, because the radio inputs are replaced whenever Material swaps page content.
  document.addEventListener("change", function (e) {
    if (e.target && e.target.matches && e.target.matches('.tabbed-set > input[type="radio"]')) {
      requestAnimationFrame(updateToc);
    }
  });

  // content.tabs.link syncs the tier across every tabbed set on the page and persists the
  // choice between pages; it navigates by hash rather than firing `change` on each input.
  window.addEventListener("hashchange", function () {
    requestAnimationFrame(updateToc);
  });
})();
