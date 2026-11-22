import { botConfig as BotConfig, getCommandPrefix, getBotMessage } from '../bot.js';
import { DEFAULT_GUILD_CONFIG } from '../../utils/constants.js';

// ─── Validation ───────────────────────────────────────────────────────────────

if (!DEFAULT_GUILD_CONFIG || typeof DEFAULT_GUILD_CONFIG !== 'object') {
  throw new Error('DEFAULT_GUILD_CONFIG must be a valid object imported from constants.js');
}

// ─── Guild Config Defaults ───────────────────────────────────────────────────

/**
 * Single source of truth for guild config default values.
 * Used by the guild config service and database read path.
 *
 * All values are eagerly resolved at import time for performance.
 * Use deepClone() when mutating to prevent accidental shared references.
 */
export const GUILD_CONFIG_DEFAULTS = Object.freeze({
  ...DEFAULT_GUILD_CONFIG,

  // ─── Core ───────────────────────────────────────────────────────────────────
  prefix: getCommandPrefix(),

  // ─── Welcome ────────────────────────────────────────────────────────────────
  welcomeMessage: BotConfig.welcome?.defaultWelcomeMessage || getBotMessage('welcomeDefault', {
    user: '{user}',
    server: '{server}',
    memberCount: '{memberCount}',
  }),

  // ─── Tickets ────────────────────────────────────────────────────────────────
  dmOnClose: true,

  // ─── Command Gating ───────────────────────────────────────────────────────────
  disabledCommands: Object.freeze({}),
  disabledCategories: Object.freeze({}),

  // ─── Logging ──────────────────────────────────────────────────────────────────
  logChannelId: null,
  auditLogEnabled: true,

  // ─── Economy ──────────────────────────────────────────────────────────────────
  economyEnabled: BotConfig.features?.economy ?? true,
  currencySymbol: BotConfig.economy?.currency?.symbol || '$',

  // ─── Leveling ─────────────────────────────────────────────────────────────────
  levelingEnabled: BotConfig.features?.leveling ?? true,
  xpMultiplier: 1.0,

  // ─── Moderation ─────────────────────────────────────────────────────────────────
  modLogChannelId: null,
  muteRoleId: null,

  // ─── Auto-roles ─────────────────────────────────────────────────────────────────
  autoRoleIds: Object.freeze([]),

  // ─── Verification ─────────────────────────────────────────────────────────────
  verificationEnabled: BotConfig.features?.verification ?? false,
  verificationChannelId: null,
  verificationRoleId: null,

  // ─── Birthdays ──────────────────────────────────────────────────────────────────
  birthdayEnabled: BotConfig.features?.birthday ?? false,
  birthdayChannelId: null,
  birthdayRoleId: null,

  // ─── Giveaways ──────────────────────────────────────────────────────────────────
  giveawayManagerRoleIds: Object.freeze([]),

  // ─── Music ──────────────────────────────────────────────────────────────────────
  musicEnabled: BotConfig.features?.music ?? true,
  musicChannelId: null,
  djRoleIds: Object.freeze([]),

  // ─── Server Stats ───────────────────────────────────────────────────────────────
  serverStatsEnabled: BotConfig.features?.counter ?? false,
  counterChannels: Object.freeze([]),

  // ─── Anti-raid ──────────────────────────────────────────────────────────────────
  antiRaidEnabled: false,
  joinGate: Object.freeze({
    minAccountAgeDays: 0,
    requireVerifiedEmail: false,
    maxJoinsPerMinute: 0,
  }),
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a deep clone of the defaults for safe mutation.
 * @returns {Record<string, unknown>} Deep-cloned defaults
 */
export function createGuildConfigDefaults() {
  return structuredClone(GUILD_CONFIG_DEFAULTS);
}

/**
 * Get a specific default value by key path.
 * @param {string} path - Dot-notation path (e.g., 'joinGate.minAccountAgeDays')
 * @param {unknown} fallback - Value if path not found
 * @returns {unknown}
 */
export function getDefaultValue(path, fallback = undefined) {
  return path.split('.').reduce((obj, key) => {
    if (obj === null || obj === undefined) return fallback;
    return obj[key] ?? fallback;
  }, GUILD_CONFIG_DEFAULTS);
}

/**
 * Check if a feature is enabled by default for new guilds.
 * @param {string} featureKey - Feature key matching botConfig.features
 * @returns {boolean}
 */
export function isFeatureEnabledByDefault(featureKey) {
  const featureMap = {
    economy: 'economyEnabled',
    leveling: 'levelingEnabled',
    verification: 'verificationEnabled',
    birthday: 'birthdayEnabled',
    music: 'musicEnabled',
    counter: 'serverStatsEnabled',
  };
  const configKey = featureMap[featureKey];
  if (!configKey) return false;
  return GUILD_CONFIG_DEFAULTS[configKey] === true;
}
