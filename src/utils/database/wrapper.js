import { pgDb } from '../postgresDatabase.js';
import { MemoryStorage } from '../memoryStorage.js';
import { logger } from '../logger.js';
import { validateGuildConfigOrThrow } from '../schemas.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const GUILD_CONFIG_KEY_PATTERN = /^guild:[^:]+:config$/;
const SCHEMA_MISMATCH_CODE = 'SCHEMA_VERSION_MISMATCH';
const DEGRADED_REASON = 'POSTGRES_UNAVAILABLE';

// ─── DatabaseWrapper ───────────────────────────────────────────────────────────

class DatabaseWrapper {
  constructor() {
    this.initialized = false;
    this.db = null;
    this.useFallback = false;
    this.connectionType = 'none';
    this.degradedModeWarningShown = false;
    this.degradedReason = null;
    this._operationQueue = [];
    this._queueDraining = false;
  }

  // ─── Initialization ───────────────────────────────────────────────────────────

  async initialize() {
    if (this.initialized) {
      logger.debug('Database already initialized, skipping');
      return;
    }

    try {
      logger.info('Connecting to PostgreSQL...', { event: 'db.init.start' });
      const pgConnected = await pgDb.connect();

      if (pgConnected) {
        this.db = pgDb;
        this.connectionType = 'postgresql';
        this.degradedReason = null;
        this.initialized = true;
        logger.info('PostgreSQL connected', { event: 'db.init.success', connectionType: 'postgresql' });
        return;
      }

      const pgFailure = pgDb.getLastFailure?.();
      if (pgFailure?.reason === SCHEMA_MISMATCH_CODE) {
        const schemaError = new Error(
          `Schema version mismatch (${pgFailure.message}). Run migrations: node scripts/migrate.js apply`
        );
        schemaError.code = SCHEMA_MISMATCH_CODE;
        throw schemaError;
      }
    } catch (error) {
      if (error.code === SCHEMA_MISMATCH_CODE) {
        throw error;
      }
      logger.warn('PostgreSQL connection failed', { event: 'db.init.pg_failed', error: error.message });
    }

    this._enableFallback();
  }

  _enableFallback() {
    this.db = new MemoryStorage();
    this.useFallback = true;
    this.connectionType = 'memory';
    this.degradedReason = DEGRADED_REASON;
    this.initialized = true;

    if (!this.degradedModeWarningShown) {
      logger.warn('Database degraded: using in-memory storage', {
        event: 'db.degraded',
        reason: DEGRADED_REASON,
        dataLossWarning: true,
      });
      this.degradedModeWarningShown = true;
    }
  }

  // ─── Core Operations ──────────────────────────────────────────────────────────

  async set(key, value, ttl = null) {
    this._ensureInitialized();

    if (this.useFallback) {
      logger.debug('Memory write', { event: 'db.degraded.write', key });
    }

    if (GUILD_CONFIG_KEY_PATTERN.test(key)) {
      const guildId = key.split(':')[1];
      validateGuildConfigOrThrow(value, { guildId, errorCode: 'VALIDATION_FAILED' });
    }

    return this.db.set(key, value, ttl);
  }

  async get(key, defaultValue = null) {
    this._ensureInitialized();
    return this.db.get(key, defaultValue);
  }

  async delete(key) {
    this._ensureInitialized();

    if (this.useFallback) {
      logger.debug('Memory delete', { event: 'db.degraded.delete', key });
    }

    return this.db.delete(key);
  }

  async list(prefix) {
    this._ensureInitialized();
    return this.db.list(prefix);
  }

  async exists(key) {
    this._ensureInitialized();

    if (this.db.exists) {
      return this.db.exists(key);
    }

    const value = await this.db.get(key);
    return value !== null;
  }

  async increment(key, amount = 1) {
    this._ensureInitialized();

    if (this.useFallback) {
      logger.debug('Memory increment', { event: 'db.degraded.increment', key, amount });
    }

    if (this.db.increment) {
      return this.db.increment(key, amount);
    }

    const current = await this.db.get(key, 0);
    const newValue = current + amount;
    await this.db.set(key, newValue);
    return newValue;
  }

  async decrement(key, amount = 1) {
    this._ensureInitialized();

    if (this.useFallback) {
      logger.debug('Memory decrement', { event: 'db.degraded.decrement', key, amount });
    }

    if (this.db.decrement) {
      return this.db.decrement(key, amount);
    }

    const current = await this.db.get(key, 0);
    const newValue = current - amount;
    await this.db.set(key, newValue);
    return newValue;
  }

  // ─── Batch Operations ─────────────────────────────────────────────────────────

  async mget(keys, defaultValue = null) {
    this._ensureInitialized();

    if (this.db.mget) {
      return this.db.mget(keys, defaultValue);
    }

    const results = await Promise.all(keys.map((key) => this.db.get(key, defaultValue)));
    return Object.fromEntries(keys.map((key, i) => [key, results[i]]));
  }

  async mset(entries, ttl = null) {
    this._ensureInitialized();

    if (this.db.mset) {
      return this.db.mset(entries, ttl);
    }

    await Promise.all(Object.entries(entries).map(([key, value]) => this.db.set(key, value, ttl)));
    return true;
  }

  async mdel(keys) {
    this._ensureInitialized();

    if (this.db.mdel) {
      return this.db.mdel(keys);
    }

    await Promise.all(keys.map((key) => this.db.delete(key)));
    return true;
  }

  // ─── Queue / Replay (for degraded → recovered transitions) ─────────────────────

  async enqueueOperation(type, key, value) {
    this._operationQueue.push({ type, key, value, timestamp: Date.now() });
    if (this._operationQueue.length > 1000) {
      this._operationQueue = this._operationQueue.slice(-500);
      logger.warn('Operation queue trimmed', { event: 'db.queue.trimmed', size: 500 });
    }
  }

  async drainQueue() {
    if (this._queueDraining || this._operationQueue.length === 0 || this.useFallback) {
      return;
    }

    this._queueDraining = true;
    logger.info('Draining operation queue to PostgreSQL', { event: 'db.queue.drain', count: this._operationQueue.length });

    try {
      for (const op of this._operationQueue) {
        if (op.type === 'set') {
          await this.db.set(op.key, op.value);
        } else if (op.type === 'delete') {
          await this.db.delete(op.key);
        }
      }
      this._operationQueue = [];
      logger.info('Queue drained successfully', { event: 'db.queue.drain.done' });
    } catch (error) {
      logger.error('Queue drain failed', { event: 'db.queue.drain.error', error: error.message });
    } finally {
      this._queueDraining = false;
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────────

  isDegraded() {
    return this.useFallback;
  }

  isAvailable() {
    return this.db !== null && !this.useFallback;
  }

  getStatus() {
    return {
      initialized: this.initialized,
      connectionType: this.connectionType,
      isDegraded: this.useFallback,
      isAvailable: this.isAvailable(),
      degradedReason: this.degradedReason,
      queueSize: this._operationQueue.length,
    };
  }

  getConnectionType() {
    return this.connectionType;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
    }
  }
}

// ─── Singleton Export ───────────────────────────────────────────────────────────

export const db = new DatabaseWrapper();

// ─── Initialization ─────────────────────────────────────────────────────────────

export async function initializeDatabase() {
  try {
    logger.info('Initializing database...', { event: 'db.init' });
    await db.initialize();
    logger.info('Database ready', { event: 'db.init.done', connectionType: db.getConnectionType() });
    return { db };
  } catch (error) {
    if (error.code === SCHEMA_MISMATCH_CODE) {
      logger.error('Schema mismatch — migration required', { event: 'db.init.schema_mismatch', error: error.message });
      throw error;
    }

    logger.error('Database initialization failed', { event: 'db.init.failed', error: error.message });
    return { db };
  }
}

// ─── Convenience Helpers ──────────────────────────────────────────────────────

export async function getFromDb(key, defaultValue = null) {
  try {
    const value = await db.get(key);
    return value === null ? defaultValue : value;
  } catch (error) {
    logger.error('DB get failed', { event: 'db.get.error', key, error: error.message });
    return defaultValue;
  }
}

export async function setInDb(key, value, ttl = null) {
  try {
    await db.set(key, value, ttl);
    return true;
  } catch (error) {
    logger.error('DB set failed', { event: 'db.set.error', key, error: error.message });
    return false;
  }
}

export async function deleteFromDb(key) {
  try {
    await db.delete(key);
    return true;
  } catch (error) {
    logger.error('DB delete failed', { event: 'db.delete.error', key, error: error.message });
    return false;
  }
}

// ─── Batch Convenience ──────────────────────────────────────────────────────────

export async function mgetFromDb(keys, defaultValue = null) {
  try {
    return await db.mget(keys, defaultValue);
  } catch (error) {
    logger.error('DB mget failed', { event: 'db.mget.error', keys: keys.length, error: error.message });
    return Object.fromEntries(keys.map((k) => [k, defaultValue]));
  }
}

export async function msetInDb(entries, ttl = null) {
  try {
    return await db.mset(entries, ttl);
  } catch (error) {
    logger.error('DB mset failed', { event: 'db.mset.error', count: Object.keys(entries).length, error: error.message });
    return false;
  }
}
