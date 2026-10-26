(function () {
  "use strict";

  window.AdExplorer = window.AdExplorer || {};

  window.AdExplorer.Utils = {
    generateUUID: function () {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        function (c) {
          var r = (Math.random() * 16) | 0,
            v = c == "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        },
      );
    },

    findStableParent: function (el) {
      let parent = el.parentElement;

      const stableSelectors = [
        "creative-preview",
        "creative",
        ".creative-preview",
        ".creative-container",
        "div.creative-bounding-box",
        "div.xpd",
        "c-wiz[data-p]",
        "div[data-hveid]",
        'a[href*="/creative/"]',
        ".gws-plugins-ads-cards-jslayout__highlight-overlay",
      ];

      let current = parent;
      let range = 0;
      while (current && current !== document.body && range < 15) {
        if (
          current.tagName === "BODY" ||
          current.tagName === "HTML" ||
          current.id === "main-content"
        )
          break;

        for (const selector of stableSelectors) {
          if (current.matches(selector)) return current;
        }

        if (current.classList.contains("xpd")) return current;

        current = current.parentElement;
        range++;
      }

      if (parent && (parent.tagName === "SPAN" || parent.tagName === "A")) {
        let blockParent = parent.parentElement;
        while (
          blockParent &&
          (blockParent.tagName === "SPAN" || blockParent.tagName === "A")
        ) {
          blockParent = blockParent.parentElement;
        }
        if (blockParent && blockParent !== document.body) return blockParent;
      }

      return parent || document.body;
    },

    invalidAndroid: new Set([
      "class",
      "d.value",
      "c.toString",
      "toString",
      "value",
      "prototype",
      "constructor",
      "return",
      "function",
      "this.slotid",
      "Math.random",
      "a.pointer",
      "pointer.id",
      "window.location",
      "document.location",
      "location.href",
      "Element.prototype",
      "DocumentType.prototype",
      "Symbol.iterator",
      "Symbol.dispose",
      "Number.isFinite",
      "Number.MAX_SAFE_INTEGER",
      "Number.MIN_SAFE_INTEGER",
      "Number.isNaN",
      "Object.create",
      "Object.defineProperty",
      "Object.defineProperties",
      "Object.assign",
      "Array.from",
      "Array.isArray",
      "Promise.resolve",
      "Promise.reject",
      "JSON.parse",
      "console.log",
      "console.error",
      "navigator.userAgent",
      "String.prototype.includes",
      "Array.prototype.includes",
      "String.prototype",
      "Array.prototype",
      "data.id",
      "event.target",
      "element.id",
      "node.value",
      "item.id",
    ]),

    isValidPackageId: function (id) {
      if (!id || typeof id !== "string") return false;
      if (id.length < 5 || id.length > 100) return false;

      const parts = id.split(".");
      if (parts.length < 2) return false;

      const lowerID = id.toLowerCase();
      if (lowerID.startsWith("caase") || lowerID.startsWith("camk"))
        return false;
      if (lowerID.startsWith("google.") || lowerID.startsWith("android."))
        return false;
      if (
        lowerID.startsWith("com.google.ads") ||
        lowerID.startsWith("com.google.search") ||
        lowerID.startsWith("com.google.gws")
      )
        return false;
      if (lowerID.startsWith("www.")) return false;
      if (lowerID.startsWith("this.") || lowerID.startsWith("math."))
        return false;
      if (lowerID.startsWith("gapi.")) return false;
      if (lowerID.startsWith("gbar_.")) return false;
      if (lowerID.startsWith("wiz_global_data")) return false;
      if (lowerID.startsWith("es_plusone_gc")) return false;
      if (lowerID.startsWith("og.qtm")) return false;
      if (
        lowerID.includes("googlesyndication") ||
        lowerID.includes("doubleclick")
      )
        return false;
      if (lowerID.includes("gstatic") || lowerID.includes("adservice"))
        return false;
      if (id === "itunes.apple.com" || id === "play.google.com") return false;

      // FIX: Block all internal Google subdomains (e.g. myaccount.google.com, aa.google.com)
      if (lowerID.endsWith(".google.com") || lowerID.endsWith(".android.com"))
        return false;

      const blockedDomains = [
        "ogs.google.com",
        "apis.google.com",
        "accounts.google.com",
        "support.google.com",
        "policies.google.com",
        "mail.google.com",
        "docs.google.com",
        "drive.google.com",
        "calendar.google.com",
        "maps.google.com",
        "photos.google.com",
        "news.google.com",
        "myaccount.google.com",
        "aa.google.com",
        "www.google.com",
      ];
      if (blockedDomains.includes(lowerID)) return false;
      if (
        lowerID.includes("function") ||
        lowerID.includes("window.") ||
        lowerID.includes(".prototype")
      )
        return false;
      if (lowerID.startsWith("os.")) return false;
      if (lowerID.startsWith("css.") || lowerID.startsWith("r.")) return false;

      if (this.invalidAndroid.has(id)) return false;

      if (id.includes("_")) return false;
      if (id.startsWith("_")) return false;

      if (/^[a-z]\.[a-z]/i.test(id)) return false;

      if (id.includes("..")) return false;
      if (id.endsWith(".")) return false;

      if (!/^[a-z0-9]/i.test(id)) return false;

      if (/[A-Z]/.test(id)) {
        return false;
      }

      for (let i = 0; i < parts.length - 1; i++) {
        if (parts[i].length < 2) return false;
      }

      return true;
    },
  };
})();
