const { getCachedConfig } = require('./performance');
const Config = require('../models/Config');

class TemplateProcessor {
  constructor() {
    this.defaultTemplates = {
      denuncia_aceita: '➥ Denúncia aceita Acusado ({acusadoId}) tomará punição por ({motivo}) Data {dataPunicao} Link: {messageUrl}',
      denuncia_analise: '🔎 Esta denúncia está em análise por {user} Acusado: ({acusado}) Motivo: ({motivo}) Link: {messageUrl}',
      denuncia_recusada: '❌ Denúncia recusada por {user}'
    };
  }

  async processTemplate(guildId, templateType, variables = {}) {
    try {
      const config = await getCachedConfig(guildId, Config);
      let template = this.defaultTemplates[templateType];
      
      // Se existe template personalizado no banco, usa ele
      if (config?.templates?.[templateType]) {
        template = config.templates[templateType];
      }
      
      // Substitui as variáveis no template
      let processedTemplate = template;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{${key}}`;
        processedTemplate = processedTemplate.replace(new RegExp(placeholder, 'g'), value || '');
      }
      
      return processedTemplate;
    } catch (error) {
      console.error('Erro ao processar template:', error);
      // Retorna template padrão em caso de erro
      return this.processDefaultTemplate(templateType, variables);
    }
  }

  processDefaultTemplate(templateType, variables = {}) {
    let template = this.defaultTemplates[templateType];
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      template = template.replace(new RegExp(placeholder, 'g'), value || '');
    }
    
    return template;
  }

  getAvailableVariables(templateType) {
    const variables = {
      denuncia_aceita: [
        'acusadoId',
        'motivo', 
        'dataPunicao',
        'messageUrl',
        'user',
        'guildId',
        'channelId'
      ],
      denuncia_analise: [
        'user',
        'acusado',
        'motivo',
        'messageUrl',
        'guildId',
        'channelId'
      ],
      denuncia_recusada: [
        'user',
        'guildId',
        'channelId'
      ]
    };
    
    return variables[templateType] || [];
  }

  validateTemplate(template, templateType) {
    const requiredVariables = this.getAvailableVariables(templateType);
    const missingVariables = [];
    
    for (const variable of requiredVariables) {
      if (!template.includes(`{${variable}}`)) {
        missingVariables.push(variable);
      }
    }
    
    return {
      isValid: missingVariables.length === 0,
      missingVariables,
      warnings: this.getTemplateWarnings(template, templateType)
    };
  }

  getTemplateWarnings(template, templateType) {
    const warnings = [];
    
    // Verifica se tem variáveis não utilizadas
    const availableVariables = this.getAvailableVariables(templateType);
    const usedVariables = template.match(/\{([^}]+)\}/g) || [];
    const unusedVariables = availableVariables.filter(v => 
      !usedVariables.includes(`{${v}}`)
    );
    
    if (unusedVariables.length > 0) {
      warnings.push(`Variáveis não utilizadas: ${unusedVariables.join(', ')}`);
    }
    
    // Verifica se tem variáveis inválidas
    const invalidVariables = usedVariables.filter(v => 
      !availableVariables.includes(v.replace(/[{}]/g, ''))
    );
    
    if (invalidVariables.length > 0) {
      warnings.push(`Variáveis inválidas: ${invalidVariables.join(', ')}`);
    }
    
    return warnings;
  }

  getTemplatePreview(template, templateType) {
    const sampleData = this.getSampleData(templateType);
    return this.processDefaultTemplate(templateType, sampleData);
  }

  getSampleData(templateType) {
    const sampleData = {
      denuncia_aceita: {
        acusadoId: '12345',
        motivo: 'Exemplo de motivo',
        dataPunicao: '25/12/2024',
        messageUrl: 'https://discord.com/channels/123456789/987654321/111222333',
        user: '<@123456789>',
        guildId: '123456789',
        channelId: '987654321'
      },
      denuncia_analise: {
        user: '<@123456789>',
        acusado: 'Jogador123',
        motivo: 'Exemplo de motivo',
        messageUrl: 'https://discord.com/channels/123456789/987654321/111222333',
        guildId: '123456789',
        channelId: '987654321'
      },
      denuncia_recusada: {
        user: '<@123456789>',
        guildId: '123456789',
        channelId: '987654321'
      }
    };
    
    return sampleData[templateType] || {};
  }
}

module.exports = {
  TemplateProcessor
};
