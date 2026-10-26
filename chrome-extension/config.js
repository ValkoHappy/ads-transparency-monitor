/**
 * Configuration constants for Ad Explorer Chrome Extension
 * Centralized location for all magic numbers and strings
 */

const CONFIG = {
  // Feature Flags
  ECONOMY_MODE: true, // If true: Deletes ads from DOM after parsing to save memory. Disables badges.
  ECONOMY_SCROLL_ONLY: false, // If true: Economy mode only activates when auto-scroll is running.

  // Badge Configuration
  BADGE: {
    MIN_ELEMENT_SIZE: 10, // Minimum element size (px) to be considered for badging
    Z_INDEX: 999999, // Z-index for badge overlay
    INIT_DELAY_MS: 2000, // Delay before initializing auto-scroll UI
    OFFSET_SPACING: 40, // Vertical spacing between multiple badges (px)
    ID_MAX_LENGTH: 35, // Max characters for app ID display
    ID_TRUNCATE_LENGTH: 32, // Characters to show before '...'
    SCALE_MIN: 0.1, // Minimum scale factor
    SCALE_MAX: 1.0, // Maximum scale factor
  },

  // Retry & Resilience
  RETRY: {
    MAX_ATTEMPTS: 10, // Max retries for URL resolution
    DELAY_MS: 500, // Delay between retry attempts
    BATCH_DELAY_MS: 200, // Delay before flushing ad report queue
  },

  // Scanning & Performance
  SCAN: {
    HEARTBEAT_MS: 2000, // Interval for periodic scans
    MAX_STRING_LENGTH: 500000, // Max string length for scanning (prevent DoS)
    MAX_IFRAME_SRCDOC: 5000000, // Max iframe srcdoc length to scan
    DEBOUNCE_MS: 100, // Debounce delay for mutation observer
  },

  // ID Validation
  VALIDATION: {
    MIN_PACKAGE_SEGMENTS: 3, // Min segments in Android package (com.x.y)
    MIN_SEGMENT_LENGTH: 2, // Min length of each segment
    APPLE_ID_MIN_DIGITS: 9, // Min digits for Apple ID
    APPLE_ID_MAX_DIGITS: 10, // Max digits for Apple ID
  },

  // URLs
  URLS: {
    GOOGLE_PLAY: "https://play.google.com/store/apps/details?id=",
    APP_STORE: "https://apps.apple.com/app/id",
    GOOGLE_SEARCH: "https://www.google.com/search?q=",
    ADS_TRANSPARENCY: "https://adstransparency.google.com",
  },

  // Colors (Brand)
  COLORS: {
    GOOGLE_PLAY: "#34a853", // Google Play green
    APP_STORE: "#007aff", // Apple blue
    UNKNOWN: "#636e72", // Gray for unknown types
    GOOGLE_PLAY_ALT: "#3dda84", // Alternative green
  },

  // Confidence Scoring
  CONFIDENCE: {
    HIGH: 3, // High confidence (from adData, structure)
    MEDIUM: 2, // Medium confidence (from redirect)
    LOW: 1, // Low confidence (other sources)
  },

  // Message Types
  MESSAGE_TYPES: {
    AD_FOUND: "AD_DATA_FOUND",
    AD_BATCH: "AD_BATCH_FOUND",
    SCROLL_STATE: "SCROLL_STATE_CHANGE",
    UPDATE_SETTINGS: "UPDATE_SETTINGS",
    TOGGLE_SCROLL: "TOGGLE_SCROLL_REQUEST",
    READY: "READY_FOR_STATE",
  },

  // Storage Keys
  STORAGE: {
    ADS_GLOBAL: "ads_global",
    SCROLL_SETTINGS: "scrollSettings",
    IS_SCROLLING: "is_scrolling",
    POPUP_SEARCH: "popup_search_state",
    ACTIVE_AD_PREFIX: "active_ad_", // + tabId
  },

  // Invalid Package Names (Blacklist)
  INVALID_ANDROID: new Set([
    "class",
    "d.value",
    "c.toString",
    "toString",
    "value",
    "prototype",
    "constructor",
    "return",
    "function",
    "google",
    "text.",
    "image.",
  ]),

  // Allowed Origins (for postMessage security)
  ALLOWED_ORIGINS: [
    "https://adstransparency.google.com",
    "https://googleusercontent.com",
  ],
};

// Apply to global scope if available (since this script is injected in MAIN and ISOLATED)
if (typeof window !== "undefined") {
  window.AdExplorer = window.AdExplorer || {};
  window.AdExplorer.CONFIG = CONFIG;
}

// Export for use in modules (if using ES6 modules in future)
if (typeof module !== "undefined" && module.exports) {
  module.exports = CONFIG;
}
