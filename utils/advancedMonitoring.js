const { globalCache } = require('./smartCache');
const chalk = require('chalk');

const log = {
    info:    (msg) => console.log(`${chalk.blue('ℹ')} ${chalk.gray('[INFO]')} ${msg}`),
    success: (msg) => console.log(`${chalk.green('✔')} ${chalk.gray('[SUCESSO]')} ${msg}`),
    warn:    (msg) => console.log(`${chalk.yellow('⚠')} ${chalk.gray('[AVISO]')} ${msg}`),
    error:   (msg) => console.log(`${chalk.red('✖')} ${chalk.gray('[ERRO]')} ${msg}`),
};

class AdvancedMonitor {
  constructor() {
    // Evita criar múltiplas instâncias caso o módulo seja recarregado
    if (AdvancedMonitor._instance) {
      return AdvancedMonitor._instance;
    }

    this.metrics = {
      startTime: Date.now(),
      commands: new Map(),
      interactions: new Map(),
      errors: [],
      performance: {
        responseTimes: [],
        memoryUsage: [],
        cpuUsage: []
      },
      system: {
        uptime: 0,
        memory: {
          current: 0,
          peak: 0,
          average: 0
        },
        cpu: {
          current: 0,
          average: 0
        }
      }
    };

    this.startCollection();
    AdvancedMonitor._instance = this;
  }

  startCollection() {
    // Coleta métricas a cada 30 segundos
    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Limpa dados antigos a cada hora
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 3600000);

    // Atualiza uptime a cada minuto
    this.uptimeInterval = setInterval(() => {
      this.updateUptime();
    }, 60000);

    // Permite que o processo encerre sem esperar esses timers
    this.metricsInterval.unref?.();
    this.cleanupInterval.unref?.();
    this.uptimeInterval.unref?.();
  }

  recordCommand(commandName, responseTime, success = true, userId = null) {
    const key = commandName;
    if (!this.metrics.commands.has(key)) {
      this.metrics.commands.set(key, {
        total: 0,
        success: 0,
        errors: 0,
        avgResponseTime: 0,
        responseTimes: [],
        users: new Set()
      });
    }

    const cmd = this.metrics.commands.get(key);
    cmd.total++;
    if (success) {
      cmd.success++;
    } else {
      cmd.errors++;
    }

    if (userId) {
      cmd.users.add(userId);
    }

    cmd.responseTimes.push(responseTime);
    if (cmd.responseTimes.length > 100) {
      cmd.responseTimes.shift();
    }

    cmd.avgResponseTime = cmd.responseTimes.reduce((a, b) => a + b, 0) / cmd.responseTimes.length;
  }

  recordInteraction(interactionType, responseTime, success = true) {
    const key = interactionType;
    if (!this.metrics.interactions.has(key)) {
      this.metrics.interactions.set(key, {
        total: 0,
        success: 0,
        errors: 0,
        avgResponseTime: 0,
        responseTimes: []
      });
    }

    const interaction = this.metrics.interactions.get(key);
    interaction.total++;
    if (success) {
      interaction.success++;
    } else {
      interaction.errors++;
    }

    interaction.responseTimes.push(responseTime);
    if (interaction.responseTimes.length > 100) {
      interaction.responseTimes.shift();
    }

    interaction.avgResponseTime = interaction.responseTimes.reduce((a, b) => a + b, 0) / interaction.responseTimes.length;
  }

  recordError(error, context = 'unknown') {
    this.metrics.errors.push({
      message: error.message,
      stack: error.stack,
      context,
      timestamp: Date.now()
    });

    // Mantém apenas os últimos 100 erros
    if (this.metrics.errors.length > 100) {
      this.metrics.errors.shift();
    }
  }

  collectSystemMetrics() {
    const usage = process.memoryUsage();
    const memoryData = {
      timestamp: Date.now(),
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024),
      external: Math.round(usage.external / 1024 / 1024),
      rss: Math.round(usage.rss / 1024 / 1024)
    };

    this.metrics.performance.memoryUsage.push(memoryData);
    this.metrics.system.memory.current = memoryData.heapUsed;

    // Atualiza pico de memória
    if (memoryData.heapUsed > this.metrics.system.memory.peak) {
      this.metrics.system.memory.peak = memoryData.heapUsed;
    }

    // Calcula média de memória
    if (this.metrics.performance.memoryUsage.length > 0) {
      const total = this.metrics.performance.memoryUsage.reduce((sum, m) => sum + m.heapUsed, 0);
      this.metrics.system.memory.average = Math.round(total / this.metrics.performance.memoryUsage.length);
    }

    // Mantém apenas os últimos 100 registros
    if (this.metrics.performance.memoryUsage.length > 100) {
      this.metrics.performance.memoryUsage.shift();
    }
  }

  updateUptime() {
    this.metrics.system.uptime = Date.now() - this.metrics.startTime;
  }

  cleanupOldData() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    // Limpa erros antigos
    this.metrics.errors = this.metrics.errors.filter(error => error.timestamp > oneHourAgo);

    // Limpa métricas de performance antigas
    this.metrics.performance.memoryUsage = this.metrics.performance.memoryUsage.filter(
      m => m.timestamp > oneHourAgo
    );

    log.info('Dados antigos de monitoramento limpos.');
  }

  generateDetailedReport() {
    const uptime = this.metrics.system.uptime;
    const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));

    const report = {
      timestamp: new Date().toISOString(),
      uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      uptimeMs: uptime,
      commands: this.formatCommandsData(),
      interactions: this.formatInteractionsData(),
      system: {
        memory: this.metrics.system.memory,
        performance: this.getPerformanceStats()
      },
      health: this.calculateHealthScore(),
      cache: globalCache.getStats(),
      errors: {
        total: this.metrics.errors.length,
        recent: this.metrics.errors.slice(-5)
      }
    };

    return report;
  }

  formatCommandsData() {
    const commands = {};
    for (const [name, data] of this.metrics.commands.entries()) {
      commands[name] = {
        total: data.total,
        success: data.success,
        errors: data.errors,
        successRate: data.total > 0 ? ((data.success / data.total) * 100).toFixed(2) + '%' : '0%',
        avgResponseTime: Math.round(data.avgResponseTime) + 'ms',
        uniqueUsers: data.users.size
      };
    }
    return commands;
  }

  formatInteractionsData() {
    const interactions = {};
    for (const [type, data] of this.metrics.interactions.entries()) {
      interactions[type] = {
        total: data.total,
        success: data.success,
        errors: data.errors,
        successRate: data.total > 0 ? ((data.success / data.total) * 100).toFixed(2) + '%' : '0%',
        avgResponseTime: Math.round(data.avgResponseTime) + 'ms'
      };
    }
    return interactions;
  }

  getPerformanceStats() {
    const memory = this.metrics.performance.memoryUsage;
    const responseTimes = this.metrics.performance.responseTimes;

    return {
      memory: {
        current: this.metrics.system.memory.current,
        peak: this.metrics.system.memory.peak,
        average: this.metrics.system.memory.average
      },
      responseTime: {
        average: responseTimes.length > 0 ?
          Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0,
        min: responseTimes.length > 0 ? Math.min(...responseTimes) : 0,
        max: responseTimes.length > 0 ? Math.max(...responseTimes) : 0
      }
    };
  }

  calculateHealthScore() {
    let score = 100;

    // Penaliza por erros
    const totalCommands = Array.from(this.metrics.commands.values())
      .reduce((sum, cmd) => sum + cmd.total, 0);
    const totalErrors = Array.from(this.metrics.commands.values())
      .reduce((sum, cmd) => sum + cmd.errors, 0);

    if (totalCommands > 0) {
      const errorRate = (totalErrors / totalCommands) * 100;
      score -= errorRate * 2; // -2 pontos por % de erro
    }

    // Penaliza por uso de memória alto
    const memory = this.metrics.system.memory;
    if (memory.current > 500)  score -= 20;
    if (memory.current > 1000) score -= 30;
    if (memory.current > 1500) score -= 40;

    // Penaliza por tempo de resposta alto
    const avgResponseTime = this.getPerformanceStats().responseTime.average;
    if (avgResponseTime > 5000)  score -= 15;
    if (avgResponseTime > 10000) score -= 25;

    // Bonus por cache hit rate alto
    const cacheStats = globalCache.getStats();
    const hitRate = parseFloat(cacheStats.hitRate);
    if (hitRate > 80) score += 5;
    if (hitRate > 90) score += 10;

    return Math.max(0, Math.round(score));
  }

  getHealthStatus(score) {
    if (score >= 90) return '🟢 Excelente';
    if (score >= 80) return '🟡 Bom';
    if (score >= 60) return '🟠 Atenção';
    return '🔴 Crítico';
  }

  getTopCommands(limit = 5) {
    const commands = Array.from(this.metrics.commands.entries())
      .map(([name, data]) => ({
        name,
        total: data.total,
        successRate: data.total > 0 ? ((data.success / data.total) * 100).toFixed(2) + '%' : '0%',
        avgResponseTime: Math.round(data.avgResponseTime) + 'ms'
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    return commands;
  }

  getErrorStats() {
    const errors = this.metrics.errors;
    const errorTypes = {};

    errors.forEach(error => {
      const type = error.context || 'unknown';
      errorTypes[type] = (errorTypes[type] || 0) + 1;
    });

    return {
      total: errors.length,
      byType: errorTypes,
      recent: errors.slice(-10)
    };
  }

  // Limpa os intervalos ao encerrar o bot
  destroy() {
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.cleanupInterval)  clearInterval(this.cleanupInterval);
    if (this.uptimeInterval)   clearInterval(this.uptimeInterval);
    AdvancedMonitor._instance = null;
    log.warn('Monitor encerrado.');
  }
}

// Instância global do monitor (singleton)
const advancedMonitor = new AdvancedMonitor();

module.exports = { AdvancedMonitor, advancedMonitor };