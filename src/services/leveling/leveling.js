// leveling.js

import { EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../config/guildConfig.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getUserLevelKey, getGuildLevelKey } from '../../utils/database/keys.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;
const MAX_LEVEL = 1000;
const MIN_LEVEL = 0;

// Pre-computed XP thresholds for O(1) level lookup (optional optimization)
const XP_CACHE = new Map();
const MAX_CACHE_LEVEL = 200;

// ─── XP Formula Functions ────────────────────────────────────────────────────

/**
 * Calculate XP required to reach a specific level from the previous level.
 * Formula: 5n² + 50n + 50
 */
export function getXpForLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError(
      `Invalid level: ${level}. Must be between ${MIN_LEVEL} and ${MAX_LEVEL}`,
      ErrorTypes.VALIDATION,
      'The level must be a valid number.'
    );
  }
  
  // Use cache for common levels
  if (level <= MAX_CACHE_LEVEL && XP_CACHE.has(level)) {
    return XP_CACHE.get(level);
  }
  
  const xp = 5 * Math.pow(level, 2) + 50 * level + 50;
  
  if (level <= MAX_CACHE_LEVEL) {
    XP_CACHE.set(level, xp);
  }
  
  return xp;
}

/**
 * Optimized O(1) level lookup using quadratic formula.
 * Solves: totalXp = Σ(5i² + 50i + 50) for i=0 to n-1
 *        = (5/3)n³ + 27.5n² + (155/6)n
 * Approximate inverse for large n, then refine.
 */
export function getLevelFromXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new TitanBotError(
      `Invalid XP: ${xp}`,
      ErrorTypes.VALIDATION,
      'XP must be a non-negative number.'
    );
  }

  // Binary search for O(log n) instead of O(n)
  let low = 0, high = MAX_LEVEL;
  let level = 0;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const totalForMid = calculateTotalXp(mid);
    
    if (totalForMid <= xp) {
      level = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  const totalXpForLevel = calculateTotalXp(level);
  const currentXp = xp - totalXpForLevel;
  const xpNeeded = getXpForLevel(level);
  
  return {
    level: Math.min(level, MAX_LEVEL),
    currentXp,
    xpNeeded,
    totalXp: xp,
    progressPercent: level >= MAX_LEVEL ? 100 : Math.min(100, Math.floor((currentXp / xpNeeded) * 100))
  };
}

/**
 * Calculate total XP required to reach a level.
 */
export function calculateTotalXp(level, currentXp = 0) {
  if (level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError('Level out of bounds', ErrorTypes.VALIDATION);
  }
  
  // Use closed-form formula: Σ(5i² + 50i + 50) = (5/3)n³ + (55/2)n² + (155/6)n
  // But for precision with integers, we'll use the loop for small values
  if (level <= 100) {
    let total = currentXp;
    for (let i = 0; i < level; i++) {
      total += getXpForLevel(i);
    }
    return total;
  }
  
  // Closed form for large levels to avoid loop overhead
  const n = BigInt(level);
  // (10n³ + 165n² + 155n) / 6
  const total = (10n * n * n + 165n * n + 155n) / 6n;
  return Number(total) + currentXp;
}

// ─── Leaderboard Functions ───────────────────────────────────────────────────

/**
 * Get leaderboard using database-first approach for performance.
 * Falls back to member fetch only when necessary.
 */
export async function getLeaderboard(client, guildId, limit = 10, options = {}) {
  const { 
    includeBots = false, 
    timeRange = null, // 'daily', 'weekly', 'monthly', 'all'
    page = 1 
  } = options;
  
  try {
    if (!guildId || typeof guildId !== 'string') {
      throw new TitanBotError('Invalid guild ID', ErrorTypes.VALIDATION);
    }

    limit = Math.min(Math.max(Number(limit) || 10, 1), 100);
    const offset = (Math.max(1, Number(page)) - 1) * limit;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Guild ${guildId} not found in cache`);
      return { entries: [], total: 0, page, totalPages: 0 };
    }

    // Try database-optimized query first (if supported by your DB adapter)
    let leaderboard = [];
    
    if (client.db?.scan || client.db?.zRange) {
      // Redis-style sorted set approach
      const keyPattern = getUserLevelKey(guildId, '*');
      const keys = await client.db.keys(keyPattern);
      
      const pipeline = keys.map(async (key) => {
        const data = await client.db.get(key);
        if (!data || (data.totalXp <= 0 && data.level <= 0)) return null;
        
        const userId = key.split(':').pop();
        return { userId, ...data };
      });
      
      const results = await Promise.all(pipeline);
      leaderboard = results.filter(Boolean);
    } else {
      // Fallback: Fetch members and check individually (expensive!)
      logger.warn('Using fallback leaderboard method - consider implementing DB indexing');
      
      const members = await guild.members.fetch({ limit: 1000 }).catch(error => {
        logger.error(`Failed to fetch members for guild ${guildId}:`, error);
        return new Map();
      });

      const promises = [];
      for (const [userId, member] of members) {
        if (!includeBots && member.user.bot) continue;
        
        promises.push(
          getUserLevelData(client, guildId, userId).then(data => {
            if (data && (data.totalXp > 0 || data.level > 0)) {
              return {
                userId,
                username: member.user.username,
                displayName: member.displayName,
                avatarURL: member.user.displayAvatarURL({ size: 128 }),
                ...data
              };
            }
            return null;
          }).catch(() => null)
        );
      }
      
      const results = await Promise.all(promises);
      leaderboard = results.filter(Boolean);
    }

    // Sort by total XP descending
    leaderboard.sort((a, b) => b.totalXp - a.totalXp);
    
    const total = leaderboard.length;
    const totalPages = Math.ceil(total / limit);
    
    // Assign ranks and paginate
    const entries = leaderboard.slice(offset, offset + limit).map((entry, index) => ({
      ...entry,
      rank: offset + index + 1
    }));

    return { entries, total, page, totalPages };

  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch leaderboard: ${error.message}`,
      ErrorTypes.DATABASE,
      'Could not fetch the leaderboard at this time.'
    );
  }
}

/**
 * Create a rich leaderboard embed with pagination support.
 */
export function createLeaderboardEmbed(leaderboardData, guild, options = {}) {
  const { entries, page = 1, totalPages = 1 } = leaderboardData;
  const { compact = false } = options;
  
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${guild.name} Leaderboard`)
    .setColor('#2ecc71')
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setTimestamp();

  if (!entries || entries.length === 0) {
    embed.setDescription('No users on the leaderboard yet! Start chatting to earn XP.');
    return embed;
  }

  // Medal emojis for top 3
  const medals = ['🥇', '🥈', '🥉'];
  
  if (compact) {
    // Compact mode: Just list
    const description = entries.map((user, index) => {
      const prefix = user.rank <= 3 ? medals[user.rank - 1] : `\`#${user.rank.toString().padStart(2, '0')}\``;
      return `${prefix} **${user.displayName || user.username}** — Level ${user.level} • ${user.totalXp.toLocaleString()} XP`;
    }).join('\n');
    
    embed.setDescription(description);
  } else {
    // Rich mode: Separate top 3 with styling
    const top3 = entries.filter(u => u.rank <= 3);
    const rest = entries.filter(u => u.rank > 3);

    const top3Text = top3.map((user) => {
      const medal = medals[user.rank - 1];
      const progress = user.xpNeeded > 0 
        ? Math.floor((user.currentXp / user.xpNeeded) * 100) 
        : 0;
      
      return [
        `${medal} **#${user.rank}** ${user.displayName || user.username}`,
        `┗ Level ${user.level} • ${user.totalXp.toLocaleString()} XP ${progress > 0 ? `(${progress}%)` : ''}`
      ].join('\n');
    }).join('\n\n');

    const restText = rest.map(user => {
      return `\`#${user.rank.toString().padStart(2, '0')}\` **${user.displayName || user.username}** — Level ${user.level} • ${user.totalXp.toLocaleString()} XP`;
    }).join('\n');

    embed.setDescription(
      top3Text + (restText ? '\n\n' + '─'.repeat(30) + '\n\n' + restText : '')
    );
  }

  if (totalPages > 1) {
    embed.setFooter({ text: `Page ${page}/${totalPages} • Use /leaderboard page:${page + 1}` });
  }

  return embed;
}

// ─── Configuration Functions ───────────────────────────────────────────────

export async function getLevelingConfig(client, guildId) {
  const defaults = {
    enabled: true,
    xpPerMessage: { min: 15, max: 25 },
    xpCooldown: 20,
    levelUpMessage: '{user} has leveled up to level {level}!',
    levelUpChannel: null,
    ignoredChannels: [],
    ignoredRoles: [],
    blacklistedUsers: [],
    roleRewards: {}, // { level: roleId }
    announceLevelUp: true,
    xpMultiplier: 1,
    stackRoles: false, // If true, keep previous role rewards
    maxXpPerMinute: 200, // Anti-spam cap
    voiceXpEnabled: false,
    voiceXpPerMinute: 5
  };

  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return { ...defaults, ...(guildConfig.leveling || {}) };
  } catch (error) {
    logger.error(`Error getting leveling config for guild ${guildId}:`, error);
    return defaults;
  }
}

export async function saveLevelingConfig(client, guildId, config) {
  try {
    if (!guildId || !config || typeof config !== 'object') {
      throw new TitanBotError('Guild ID and config object are required', ErrorTypes.VALIDATION);
    }

    // Validation
    if (config.xpCooldown !== undefined && (config.xpCooldown < 0 || config.xpCooldown > 3600)) {
      throw new TitanBotError('XP cooldown must be between 0 and 3600 seconds', ErrorTypes.VALIDATION);
    }

    if (config.xpPerMessage) {
      const { min, max } = config.xpPerMessage;
      if (min < 1 || max < 1 || min > max) {
        throw new TitanBotError('Invalid XP range', ErrorTypes.VALIDATION, 'min must be ≤ max, both ≥ 1');
      }
    }

    if (config.roleRewards) {
      for (const [level, roleId] of Object.entries(config.roleRewards)) {
        if (!/^\d{17,20}$/.test(roleId)) {
          throw new TitanBotError(`Invalid role ID: ${roleId}`, ErrorTypes.VALIDATION);
        }
        if (Number(level) < 1 || Number(level) > MAX_LEVEL) {
          throw new TitanBotError(`Invalid reward level: ${level}`, ErrorTypes.VALIDATION);
        }
      }
    }

    const guildConfig = await getGuildConfig(client, guildId);
    guildConfig.leveling = { ...guildConfig.leveling, ...config };
    await setGuildConfig(client, guildId, guildConfig);
    
    logger.info(`Leveling config updated for guild ${guildId}`);
    return guildConfig.leveling;
  } catch (error) {
    logger.error(`Error saving leveling config for guild ${guildId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save config: ${error.message}`,
      ErrorTypes.DATABASE
    );
  }
}

// ─── User Data Functions ─────────────────────────────────────────────────────

export async function getUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError('Guild ID and User ID are required', ErrorTypes.VALIDATION);
    }

    const key = getUserLevelKey(guildId, userId);
    const data = await client.db.get(key);
    
    if (!data) {
      return {
        xp: 0,
        level: 0,
        totalXp: 0,
        lastMessage: 0,
        rank: 0,
        messageCount: 0,
        voiceMinutes: 0,
        joinedAt: Date.now()
      };
    }
    
    return {
      xp: Math.max(0, data.xp || 0),
      level: Math.max(0, Math.min(data.level || 0, MAX_LEVEL)),
      totalXp: Math.max(0, data.totalXp || 0),
      lastMessage: data.lastMessage || 0,
      rank: data.rank || 0,
      messageCount: data.messageCount || 0,
      voiceMinutes: data.voiceMinutes || 0,
      joinedAt: data.joinedAt || Date.now()
    };
  } catch (error) {
    logger.error(`Error getting user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch user data: ${error.message}`,
      ErrorTypes.DATABASE
    );
  }
}

export async function saveUserLevelData(client, guildId, userId, data) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError('Guild ID and User ID are required', ErrorTypes.VALIDATION);
    }

    if (!data || typeof data !== 'object') {
      throw new TitanBotError('Invalid user level data', ErrorTypes.VALIDATION);
    }

    const sanitizedData = {
      xp: Math.max(0, Number(data.xp) || 0),
      level: Math.max(0, Math.min(Number(data.level) || 0, MAX_LEVEL)),
      totalXp: Math.max(0, Number(data.totalXp) || 0),
      lastMessage: Number(data.lastMessage) || 0,
      rank: Number(data.rank) || 0,
      messageCount: Math.max(0, Number(data.messageCount) || 0),
      voiceMinutes: Math.max(0, Number(data.voiceMinutes) || 0),
      joinedAt: Number(data.joinedAt) || Date.now(),
      updatedAt: Date.now()
    };

    const key = getUserLevelKey(guildId, userId);
    await client.db.set(key, sanitizedData);
    
    // Update sorted set for leaderboard if using Redis
    if (client.db?.zAdd) {
      await client.db.zAdd(getGuildLevelKey(guildId), {
        score: sanitizedData.totalXp,
        value: userId
      });
    }
    
    return sanitizedData;
  } catch (error) {
    logger.error(`Error saving user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save user data: ${error.message}`,
      ErrorTypes.DATABASE
    );
  }
}

// ─── Core XP/Level Management ────────────────────────────────────────────────

/**
 * Add XP to a user with level-up handling, role rewards, and cooldown checks.
 */
export async function addXpToUser(client, guildId, userId, xpAmount, options = {}) {
  const { 
    bypassCooldown = false,
    source = 'message', // 'message', 'voice', 'command', 'admin'
    channelId = null 
  } = options;

  try {
    const config = await getLevelingConfig(client, guildId);
    if (!config.enabled) {
      throw new TitanBotError('Leveling is disabled', ErrorTypes.CONFIGURATION);
    }

    if (!Number.isInteger(xpAmount) || xpAmount < 0) {
      throw new TitanBotError('Invalid XP amount', ErrorTypes.VALIDATION);
    }

    // Check blacklist
    if (config.blacklistedUsers.includes(userId)) {
      return { added: 0, leveledUp: false, newLevel: null };
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const now = Date.now();

    // Cooldown check (unless bypassed)
    if (!bypassCooldown && config.xpCooldown > 0) {
      const cooldownMs = config.xpCooldown * 1000;
      if (now - userData.lastMessage < cooldownMs) {
        return { added: 0, leveledUp: false, newLevel: null, cooldownRemaining: cooldownMs - (now - userData.lastMessage) };
      }
    }

    // Apply multiplier
    const finalXp = Math.floor(xpAmount * config.xpMultiplier);
    
    // Calculate new totals
    const oldLevel = userData.level;
    const newTotalXp = userData.totalXp + finalXp;
    const levelInfo = getLevelFromXp(newTotalXp);
    
    userData.xp = levelInfo.currentXp;
    userData.level = levelInfo.level;
    userData.totalXp = newTotalXp;
    userData.lastMessage = now;
    
    if (source === 'message') userData.messageCount++;
    if (source === 'voice') userData.voiceMinutes += (options.voiceMinutes || 1);

    const leveledUp = userData.level > oldLevel;
    const levelUps = [];

    // Handle level-ups and role rewards
    if (leveledUp) {
      for (let lvl = oldLevel + 1; lvl <= userData.level; lvl++) {
        levelUps.push(lvl);
        
        // Check role rewards
        if (config.roleRewards[lvl]) {
          await assignRoleReward(client, guildId, userId, config.roleRewards[lvl], config.stackRoles);
        }
      }
    }

    await saveUserLevelData(client, guildId, userId, userData);

    return {
      added: finalXp,
      leveledUp,
      newLevel: userData.level,
      oldLevel,
      levelUps,
      currentXp: userData.xp,
      xpNeeded: levelInfo.xpNeeded,
      progressPercent: levelInfo.progressPercent
    };

  } catch (error) {
    logger.error(`Error adding XP for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(`Failed to add XP: ${error.message}`, ErrorTypes.DATABASE);
  }
}

/**
 * Assign role reward to user.
 */
async function assignRoleReward(client, guildId, userId, roleId, stackRoles = false) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      logger.warn(`Role reward ${roleId} not found in guild ${guildId}`);
      return false;
    }

    // Remove previous role rewards if not stacking
    if (!stackRoles) {
      const config = await getLevelingConfig(client, guildId);
      const currentRoles = member.roles.cache;
      for (const [level, rid] of Object.entries(config.roleRewards)) {
        if (rid !== roleId && currentRoles.has(rid)) {
          await member.roles.remove(rid).catch(err => 
            logger.warn(`Failed to remove role ${rid}: ${err.message}`)
          );
        }
      }
    }

    await member.roles.add(role).catch(err => {
      logger.error(`Failed to assign role ${roleId} to ${userId}:`, err);
      return false;
    });

    return true;
  } catch (error) {
    logger.error(`Error assigning role reward:`, error);
    return false;
  }
}

// ─── Admin Commands ──────────────────────────────────────────────────────────

export async function addLevels(client, guildId, userId, levels) {
  try {
    const config = await getLevelingConfig(client, guildId);
    if (!config?.enabled) {
      throw new TitanBotError('Leveling system is disabled', ErrorTypes.CONFIGURATION);
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError('Must add a positive number of levels', ErrorTypes.VALIDATION);
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = Math.min(userData.level + levels, MAX_LEVEL);

    const newTotalXp = calculateTotalXp(newLevel);
    
    userData.level = newLevel;
    userData.xp = 0;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    // Apply role rewards for skipped levels
    for (let lvl = userData.level - levels + 1; lvl <= newLevel; lvl++) {
      if (config.roleRewards[lvl]) {
        await assignRoleReward(client, guildId, userId, config.roleRewards[lvl], config.stackRoles);
      }
    }

    logger.info(`Added ${levels} levels to user ${userId} in guild ${guildId}`);
    return { ...userData, levelsAdded: levels };
  } catch (error) {
    logger.error(`Error adding levels for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(`Failed to add levels: ${error.message}`, ErrorTypes.DATABASE);
  }
}

export async function removeLevels(client, guildId, userId, levels) {
  try {
    const config = await getLevelingConfig(client, guildId);
    if (!config?.enabled) {
      throw new TitanBotError('Leveling system is disabled', ErrorTypes.CONFIGURATION);
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError('Must remove a positive number of levels', ErrorTypes.VALIDATION);
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = Math.max(MIN_LEVEL, userData.level - levels);
    
    const newTotalXp = calculateTotalXp(newLevel);

    userData.level = newLevel;
    userData.xp = 0;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    // Remove role rewards if above new level
    if (!config.stackRoles) {
      const guild = client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      if (member) {
        for (const [lvl, rid] of Object.entries(config.roleRewards)) {
          if (Number(lvl) > newLevel && member.roles.cache.has(rid)) {
            await member.roles.remove(rid).catch(() => {});
          }
        }
      }
    }

    logger.info(`Removed ${levels} levels from user ${userId} in guild ${guildId}`);
    return { ...userData, levelsRemoved: levels };
  } catch (error) {
    logger.error(`Error removing levels for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(`Failed to remove levels: ${error.message}`, ErrorTypes.DATABASE);
  }
}

export async function setUserLevel(client, guildId, userId, level) {
  try {
    const config = await getLevelingConfig(client, guildId);
    if (!config?.enabled) {
      throw new TitanBotError('Leveling system is disabled', ErrorTypes.CONFIGURATION);
    }

    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new TitanBotError(`Level must be between ${MIN_LEVEL} and ${MAX_LEVEL}`, ErrorTypes.VALIDATION);
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const oldLevel = userData.level;
    
    const newTotalXp = calculateTotalXp(level);

    userData.level = level;
    userData.xp = 0;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);

    // Handle role rewards
    if (level > oldLevel) {
      for (let lvl = oldLevel + 1; lvl <= level; lvl++) {
        if (config.roleRewards[lvl]) {
          await assignRoleReward(client, guildId, userId, config.roleRewards[lvl], config.stackRoles);
        }
      }
    } else if (level < oldLevel && !config.stackRoles) {
      const guild = client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      if (member) {
        for (const [lvl, rid] of Object.entries(config.roleRewards)) {
          if (Number(lvl) > level && member.roles.cache.has(rid)) {
            await member.roles.remove(rid).catch(() => {});
          }
        }
      }
    }

    logger.info(`Set level for user ${userId} to ${level} in guild ${guildId}`);
    return { ...userData, oldLevel };
  } catch (error) {
    logger.error(`Error setting level for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(`Failed to set level: ${error.message}`, ErrorTypes.DATABASE);
  }
}

export async function resetUserLevel(client, guildId, userId) {
  return setUserLevel(client, guildId, userId, 0);
}

export async function deleteUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError('Guild ID and User ID are required', ErrorTypes.VALIDATION);
    }

    // Remove from sorted set if using Redis
    if (client.db?.zRem) {
      await client.db.zRem(getGuildLevelKey(guildId), userId);
    }

    const key = getUserLevelKey(guildId, userId);
    await client.db.delete(key);
    
    logger.debug(`Deleted level data for user ${userId} in guild ${guildId}`);
    return true;
  } catch (error) {
    logger.error(`Error deleting level data for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    return false;
  }
}

// ─── Utility Functions ───────────────────────────────────────────────────────

export function formatLevelUpMessage(template, user, level, guild) {
  return template
    .replace(/{user}/g, `<@${user.id}>`)
    .replace(/{username}/g, user.username)
    .replace(/{displayname}/g, user.displayName || user.username)
    .replace(/{level}/g, level)
    .replace(/{guild}/g, guild.name);
}

export function createRankCard(userData, member, guild) {
  const { level, currentXp, xpNeeded, rank, totalXp } = userData;
  const progress = xpNeeded > 0 ? (currentXp / xpNeeded) * 100 : 0;
  
  const embed = new EmbedBuilder()
    .setTitle(`${member.displayName}'s Rank`)
    .setColor(member.displayColor || '#2ecc71')
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Rank', value: rank ? `#${rank}` : 'Unranked', inline: true },
      { name: 'Level', value: level.toString(), inline: true },
      { name: 'Total XP', value: totalXp.toLocaleString(), inline: true },
      { name: 'Progress', value: `${currentXp.toLocaleString()} / ${xpNeeded.toLocaleString()} XP\n\`${'█'.repeat(Math.floor(progress / 10))}${'░'.repeat(10 - Math.floor(progress / 10))}\` ${Math.floor(progress)}%`, inline: false }
    )
    .setFooter({ text: guild.name, iconURL: guild.iconURL() })
    .setTimestamp();

  return embed;
}

// ─── Export Defaults ─────────────────────────────────────────────────────────

export default {
  getXpForLevel,
  getLevelFromXp,
  calculateTotalXp,
  getLeaderboard,
  createLeaderboardEmbed,
  getLevelingConfig,
  saveLevelingConfig,
  getUserLevelData,
  saveUserLevelData,
  addXpToUser,
  addLevels,
  removeLevels,
  setUserLevel,
  resetUserLevel,
  deleteUserLevelData,
  formatLevelUpMessage,
  createRankCard
};
