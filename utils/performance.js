// performance.js
const { RateLimiter } = require('limiter');
const Config = require('../models/Config');

const rateLimiters = {
  textCommands: new RateLimiter({ tokensPerInterval: 5, interval: 'minute' }),
  buttonInteractions: new RateLimiter({ tokensPerInterval: 20, interval: 'minute' }),
  modalSubmissions: new RateLimiter({ tokensPerInterval: 10, interval: 'minute' }),
  databaseOperations: new RateLimiter({ tokensPerInterval: 30, interval: 'minute' })
};

const configCache = new Map();
const CONFIG_CACHE_TTL = 5 * 60 * 1000;

const denunciaCache = new Map();
const DENUNCIA_CACHE_TTL = 2 * 60 * 1000;

class OperationQueue {
  constructor() {
    this.queues = new Map();
    this.processing = new Map();
  }

  async add(userId, operation, priority = 'normal') {
    if (!this.queues.has(userId)) {
      this.queues.set(userId, []);
      this.processing.set(userId, false);
    }

    const queue = this.queues.get(userId);
    queue.push({ operation, priority, timestamp: Date.now() });

    queue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    if (!this.processing.get(userId)) {
      this.processing.set(userId, true);
      this.processQueue(userId);
    }
  }

  async processQueue(userId) {
    const queue = this.queues.get(userId);
    if (!queue || queue.length === 0) {
      this.processing.set(userId, false);
      return;
    }

    const { operation } = queue.shift();

    try {
      await operation();
    } catch (error) {
      console.error(`Erro na operaÃ§Ã£o do usuÃ¡rio ${userId}:`, error);
    }

    setTimeout(() => this.processQueue(userId), 100);
  }
}

const operationQueue = new OperationQueue();

async function checkRateLimit(userId, type) {
  const limiter = rateLimiters[type];
  if (!limiter) return true;

  const remainingRequests = await limiter.tryRemoveTokens(1);
  return remainingRequests >= 0;
}

async function getCachedConfig(guildId) {
  const cacheKey = `config_${guildId}`;
  const cached = configCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CONFIG_CACHE_TTL) {
    return cached.data;
  }

  try {
    const config = await Config.findOne({ guildId });

    if (config) {
      configCache.set(cacheKey, {
        data: config,
        timestamp: Date.now()
      });
    }

    return config;
  } catch (error) {
    console.error('Erro ao buscar configuraÃ§Ã£o:', error);
    return null;
  }
}

async function getCachedDenuncia(query, Denuncia) {
  const cacheKey = `denuncia_${JSON.stringify(query)}`;
  const cached = denunciaCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < DENUNCIA_CACHE_TTL) {
    return cached.data;
  }

  try {
    const denuncia = await Denuncia.findOne(query);

    if (denuncia) {
      denunciaCache.set(cacheKey, {
        data: denuncia,
        timestamp: Date.now()
      });
    }

    return denuncia;
  } catch (error) {
    console.error('Erro ao buscar denÃºncia:', error);
    return null;
  }
}

function invalidateCache(type, key) {
  if (type === 'config') {
    configCache.delete(`config_${key}`);
  } else if (type === 'denuncia') {
    for (const [cacheKey] of denunciaCache.entries()) {
      if (cacheKey.includes(key)) {
        denunciaCache.delete(cacheKey);
      }
    }
  }
}

function cleanExpiredCache() {
  const now = Date.now();

  for (const [key, value] of configCache.entries()) {
    if (now - value.timestamp > CONFIG_CACHE_TTL) {
      configCache.delete(key);
    }
  }

  for (const [key, value] of denunciaCache.entries()) {
    if (now - value.timestamp > DENUNCIA_CACHE_TTL) {
      denunciaCache.delete(key);
    }
  }
}

setInterval(cleanExpiredCache, 5 * 60 * 1000);

async function queueOperation(userId, operation, priority = 'normal') {
  return new Promise((resolve, reject) => {
    operationQueue.add(userId, async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }, priority);
  });
}

async function processWithRetry(operation, maxRetries = 3, delay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay * attempt));
      }
    }
  }

  throw lastError;
}

function getPerformanceMetrics() {
  return {
    configCacheSize: configCache.size,
    denunciaCacheSize: denunciaCache.size,
    activeQueues: Array.from(operationQueue.queues.keys()).length,
    processingUsers: Array.from(operationQueue.processing.entries())
      .filter(([_, processing]) => processing).length
  };
}

module.exports = {
  checkRateLimit,
  getCachedConfig,
  getCachedDenuncia,
  invalidateCache,
  queueOperation,
  processWithRetry,
  getPerformanceMetrics,
  operationQueue
};