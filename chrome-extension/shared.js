/**
 * Shared utilities used by popup, background, and content scripts
 */
(function (global) {
  "use strict";

  function getSourcePriority(source) {
    if (!source) return 0;
    if (source === "adData_structure") return 20;
    if (source.includes("structure")) return 18;
    if (source === "dom_data_p") return 12;
    if (source.includes("dom_asoch_meta")) return 10;
    if (source.startsWith("adData_")) return 9;
    if (source.includes("redirect")) return 8;
    if (source.includes("href")) return 6;
    if (source === "dom_script_text") return 1;
    return 5;
  }

  if (typeof global !== "undefined") {
    global.getSourcePriority = getSourcePriority;
  }
  if (typeof window !== "undefined") {
    window.AdExplorer = window.AdExplorer || {};
    window.AdExplorer.getSourcePriority = getSourcePriority;
  }
})(
  typeof self !== "undefined"
    ? self
    : typeof window !== "undefined"
      ? window
      : this,
);
