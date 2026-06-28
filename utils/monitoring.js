const { getPerformanceMetrics } = require('./performance');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      startTime: Date.now(),
      totalCommands: 0,
      totalInteractions: 0,
      errors: 0,
      averageResponseTime: 0,
      peakMemoryUsage: 0,
      currentMemoryUsage: 0
    };
    
    this.responseTimes = [];
    this.maxResponseTimeHistory = 100; 
  }

  recordCommand() {
    this.metrics.totalCommands++;
  }

  recordInteraction() {
    this.metrics.totalInteractions++;
  }

  recordError() {
    this.metrics.errors++;
  }

  recordResponseTime(responseTime) {
    this.responseTimes.push(responseTime);
    
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }
    
    this.metrics.averageResponseTime = 
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  updateMemoryUsage() {
    const usage = process.memoryUsage();
    this.metrics.currentMemoryUsage = Math.round(usage.heapUsed / 1024 / 1024); 
    
    if (this.metrics.currentMemoryUsage > this.metrics.peakMemoryUsage) {
      this.metrics.peakMemoryUsage = this.metrics.currentMemoryUsage;
    }
  }

  getMetrics() {
    this.updateMemoryUsage();
    const performanceMetrics = getPerformanceMetrics();
    
    const uptime = Date.now() - this.metrics.startTime;
    const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
      ...this.metrics,
      ...performanceMetrics,
      uptime: `${uptimeHours}h ${uptimeMinutes}m`,
      uptimeMs: uptime,
      errorRate: this.metrics.totalCommands > 0 ? 
        ((this.metrics.errors / this.metrics.totalCommands) * 100).toFixed(2) + '%' : '0%',
      commandsPerMinute: this.metrics.totalCommands > 0 ? 
        Math.round((this.metrics.totalCommands / (uptime / 60000)) * 100) / 100 : 0,
      interactionsPerMinute: this.metrics.totalInteractions > 0 ? 
        Math.round((this.metrics.totalInteractions / (uptime / 60000)) * 100) / 100 : 0
    };
  }

  generateReport() {
    const metrics = this.getMetrics();
    
    return {
      timestamp: new Date().toISOString(),
      status: this.getSystemStatus(metrics),
      summary: {
        uptime: metrics.uptime,
        totalCommands: metrics.totalCommands,
        totalInteractions: metrics.totalInteractions,
        errors: metrics.errors,
        errorRate: metrics.errorRate,
        averageResponseTime: Math.round(metrics.averageResponseTime) + 'ms',
        memoryUsage: metrics.currentMemoryUsage + 'MB',
        peakMemoryUsage: metrics.peakMemoryUsage + 'MB'
      },
      performance: {
        commandsPerMinute: metrics.commandsPerMinute,
        interactionsPerMinute: metrics.interactionsPerMinute,
        cacheHitRate: this.calculateCacheHitRate(metrics),
        queueStatus: {
          activeQueues: metrics.activeQueues,
          processingUsers: metrics.processingUsers
        }
      },
      recommendations: this.generateRecommendations(metrics)
    };
  }

  getSystemStatus(metrics) {
    if (metrics.errorRate > 10) return 'CRITICAL';
    if (metrics.errorRate > 5) return 'WARNING';
    if (metrics.currentMemoryUsage > 500) return 'WARNING';
    if (metrics.averageResponseTime > 5000) return 'WARNING';
    return 'HEALTHY';
  }

  calculateCacheHitRate(metrics) {
    const totalCacheRequests = metrics.configCacheSize + metrics.denunciaCacheSize;
    if (totalCacheRequests === 0) return 'N/A';
    
    const estimatedHitRate = Math.min(95, Math.max(60, 100 - (totalCacheRequests / 10)));
    return estimatedHitRate.toFixed(1) + '%';
  }

  generateRecommendations(metrics) {
    const recommendations = [];
    
    if (metrics.errorRate > 5) {
      recommendations.push('Alta taxa de erro detectada. Verifique logs para identificar problemas.');
    }
    
    if (metrics.currentMemoryUsage > 300) {
      recommendations.push('Alto uso de memória. Considere reiniciar o bot periodicamente.');
    }
    
    if (metrics.averageResponseTime > 3000) {
      recommendations.push('Tempo de resposta alto. Verifique se há gargalos no banco de dados.');
    }
    
    if (metrics.activeQueues > 10) {
      recommendations.push('Muitas filas ativas. Considere aumentar a capacidade de processamento.');
    }
    
    if (metrics.commandsPerMinute > 50) {
      recommendations.push('Alto volume de comandos. Sistema está funcionando bem sob carga.');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Sistema funcionando normalmente. Nenhuma ação necessária.');
    }
    
    return recommendations;
  }

  cleanup() {
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes = this.responseTimes.slice(-this.maxResponseTimeHistory);
    }
  }
}

const monitor = new PerformanceMonitor();
 
setInterval(() => {
  monitor.cleanup();
}, 30 * 60 * 1000);

setInterval(() => {
  monitor.updateMemoryUsage();
}, 5 * 60 * 1000);

module.exports = {
  monitor,
  PerformanceMonitor
};
