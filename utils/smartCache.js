class SmartCache {
  constructor() {
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0
    };
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Limpa a cada 5 minutos
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return item.data;
  }

  set(key, data, ttl = 300000) { // 5 minutos padrão
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
    this.stats.sets++;
  }

  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }
    
    return true;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Cache com invalidação inteligente por padrão
  invalidatePattern(pattern) {
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    this.stats.evictions += deleted;
    return deleted;
  }

  // Cache com TTL dinâmico baseado no tipo de dados
  setWithDynamicTTL(key, data, dataType = 'default') {
    const ttlMap = {
      'config': 10 * 60 * 1000,      // 10 minutos para configurações
      'denuncia': 2 * 60 * 1000,     // 2 minutos para denúncias
      'user': 5 * 60 * 1000,         // 5 minutos para dados de usuário
      'guild': 15 * 60 * 1000,       // 15 minutos para dados de servidor
      'default': 5 * 60 * 1000       // 5 minutos padrão
    };

    const ttl = ttlMap[dataType] || ttlMap['default'];
    this.set(key, data, ttl);
  }

  // Estatísticas do cache
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
      size: this.cache.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  // Estimativa de uso de memória
  estimateMemoryUsage() {
    let totalSize = 0;
    for (const [key, value] of this.cache.entries()) {
      totalSize += key.length * 2; // String length * 2 bytes
      totalSize += JSON.stringify(value.data).length * 2;
      totalSize += 24; // Overhead do objeto (timestamp, ttl)
    }
    return Math.round(totalSize / 1024); // KB
  }

  // Limpeza de itens expirados
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > value.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    this.stats.evictions += cleaned;
    
    if (cleaned > 0) {
      console.log(`🧹 Cache cleanup: ${cleaned} itens removidos`);
    }
  }

  // Cache com compressão para dados grandes
  setCompressed(key, data, ttl = 300000) {
    try {
      const compressed = JSON.stringify(data);
      this.set(key, { compressed: true, data: compressed }, ttl);
    } catch (error) {
      console.error('Erro ao comprimir dados para cache:', error);
      this.set(key, data, ttl);
    }
  }

  getCompressed(key) {
    const item = this.get(key);
    if (!item) return null;
    
    if (item.compressed) {
      try {
        return JSON.parse(item.data);
      } catch (error) {
        console.error('Erro ao descomprimir dados do cache:', error);
        return null;
      }
    }
    
    return item;
  }

  // Destruir o cache e limpar intervalos
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// Instância global do cache
const globalCache = new SmartCache();

module.exports = { SmartCache, globalCache };
