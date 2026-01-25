const { EmbedBuilder } = require('discord.js');

class NotificationService {
  constructor(client) {
    this.client = client;
    this.userPreferences = new Map();
    this.notificationQueue = [];
    this.isProcessing = false;
  }

  async sendUserNotification(userId, type, data) {
    const user = await this.client.users.fetch(userId).catch(() => null);
    if (!user) {
      console.log(`Usuário ${userId} não encontrado para notificação`);
      return false;
    }

    const embed = this.createNotificationEmbed(type, data);
    
    try {
      await user.send({ embeds: [embed] });
      console.log(`✅ Notificação enviada para ${user.tag} (${type})`);
      return true;
    } catch (error) {
      console.log(`❌ Usuário ${user.tag} não permite DMs ou erro: ${error.message}`);
      return false;
    }
  }

  createNotificationEmbed(type, data) {
    const embeds = {
      denuncia_aceita: new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Denúncia Aceita')
        .setDescription(`Sua denúncia contra **${data.acusado}** foi aceita!`)
        .addFields(
          { name: '🎯 Acusado', value: data.acusadoId || data.acusado, inline: true },
          { name: '⚖️ Motivo da Punição', value: data.motivoAceite || 'Não informado', inline: true },
          { name: '📅 Data da Punição', value: data.dataPunicao || 'Não informada', inline: true },
          { name: '🔗 Link da Denúncia', value: `[Ver Denúncia](${data.messageLink})`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Denúncias - Brasil RolePlay' }),

      denuncia_recusada: new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('❌ Denúncia Recusada')
        .setDescription(`Sua denúncia contra **${data.acusado}** foi recusada.`)
        .addFields(
          { name: '🎯 Acusado', value: data.acusado, inline: true },
          { name: '📝 Motivo', value: data.motivoRecusa || 'Evidências insuficientes', inline: true },
          { name: '👤 Staff Responsável', value: `<@${data.staffId}>`, inline: true },
          { name: '🔗 Link da Denúncia', value: `[Ver Denúncia](${data.messageLink})`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Denúncias - Brasil RolePlay' }),

      denuncia_analise: new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🔍 Denúncia em Análise')
        .setDescription(`Sua denúncia contra **${data.acusado}** está sendo analisada pela equipe.`)
        .addFields(
          { name: '🎯 Acusado', value: data.acusado, inline: true },
          { name: '📝 Motivo', value: data.motivo, inline: true },
          { name: '👤 Staff Responsável', value: `<@${data.staffId}>`, inline: true },
          { name: '🔗 Link da Denúncia', value: `[Ver Denúncia](${data.messageLink})`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Denúncias - Brasil RolePlay' }),

      denuncia_corrigida: new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('✏️ Denúncia Corrigida')
        .setDescription(`Sua denúncia foi corrigida pela equipe.`)
        .addFields(
          { name: '📝 Motivo da Correção', value: data.motivoEdicao || 'Correção de dados', inline: true },
          { name: '👤 Staff Responsável', value: `<@${data.staffId}>`, inline: true },
          { name: '🔗 Link da Denúncia', value: `[Ver Denúncia](${data.messageLink})`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Denúncias - Brasil RolePlay' }),

      sistema_manutencao: new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🔧 Manutenção do Sistema')
        .setDescription('O sistema de denúncias estará em manutenção.')
        .addFields(
          { name: '⏰ Início', value: data.inicio, inline: true },
          { name: '⏰ Fim Estimado', value: data.fim, inline: true },
          { name: '📝 Motivo', value: data.motivo || 'Manutenção programada', inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Denúncias - Brasil RolePlay' }),

      ranking_atualizado: new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🏆 Ranking Atualizado')
        .setDescription('O ranking semanal de denúncias foi atualizado!')
        .addFields(
          { name: '📊 Sua Posição', value: data.posicao ? `#${data.posicao}` : 'Não participou', inline: true },
          { name: '📈 Suas Ações', value: data.acoes || '0', inline: true },
          { name: '🔗 Ver Ranking', value: `[Clique aqui](${data.rankingLink})`, inline: false }
        )
        .setTimestamp()
        .setFooter({ text: 'Sistema de Denúncias - Brasil RolePlay' })
    };

    return embeds[type] || new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📢 Notificação do Sistema')
      .setDescription('Você recebeu uma notificação do sistema de denúncias.')
      .setTimestamp();
  }

  // Adicionar notificação à fila
  addToQueue(userId, type, data, priority = 'normal') {
    this.notificationQueue.push({
      userId,
      type,
      data,
      priority,
      timestamp: Date.now()
    });

    // Ordena por prioridade
    this.notificationQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // Processa a fila se não estiver processando
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  // Processar fila de notificações
  async processQueue() {
    if (this.isProcessing || this.notificationQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.notificationQueue.length > 0) {
      const notification = this.notificationQueue.shift();
      
      try {
        await this.sendUserNotification(
          notification.userId,
          notification.type,
          notification.data
        );
        
        // Delay entre notificações para evitar rate limit
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Erro ao processar notificação:', error);
      }
    }

    this.isProcessing = false;
  }

  // Enviar notificação para múltiplos usuários
  async broadcastNotification(userIds, type, data) {
    const promises = userIds.map(userId => 
      this.addToQueue(userId, type, data, 'normal')
    );
    
    await Promise.allSettled(promises);
  }

  // Enviar notificação para staff
  async notifyStaff(guildId, type, data) {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const Config = require('../models/Config');
      const config = await Config.findOne({ guildId });
      
      if (!config?.roles?.administrador) return;

      const staffRole = await guild.roles.fetch(config.roles.administrador);
      if (!staffRole) return;

      const embed = this.createStaffNotificationEmbed(type, data);
      
      // Envia para canal de logs se configurado
      if (config.channels.log) {
        const logChannel = await guild.channels.fetch(config.channels.log);
        if (logChannel) {
          await logChannel.send({ 
            content: `<@&${config.roles.administrador}>`,
            embeds: [embed] 
          });
        }
      }
    } catch (error) {
      console.error('Erro ao notificar staff:', error);
    }
  }

  createStaffNotificationEmbed(type, data) {
    const embeds = {
      denuncia_nova: new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📝 Nova Denúncia')
        .setDescription('Uma nova denúncia foi criada e precisa de análise.')
        .addFields(
          { name: '👤 Denunciante', value: data.denunciante, inline: true },
          { name: '🎯 Acusado', value: data.acusado, inline: true },
          { name: '💻 Plataforma', value: data.platform, inline: true },
          { name: '📝 Motivo', value: data.motivo, inline: false },
          { name: '🔗 Link', value: `[Ver Denúncia](${data.messageLink})`, inline: false }
        )
        .setTimestamp(),

      sistema_erro: new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('🚨 Erro no Sistema')
        .setDescription('Ocorreu um erro crítico no sistema de denúncias.')
        .addFields(
          { name: '📝 Erro', value: data.error, inline: false },
          { name: '📍 Contexto', value: data.context, inline: true },
          { name: '⏰ Timestamp', value: new Date().toLocaleString('pt-BR'), inline: true }
        )
        .setTimestamp()
    };

    return embeds[type] || new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('📢 Notificação Staff')
      .setDescription('Notificação para a equipe de moderação.')
      .setTimestamp();
  }

  // Configurar preferências do usuário
  setUserPreferences(userId, preferences) {
    this.userPreferences.set(userId, {
      ...this.userPreferences.get(userId),
      ...preferences
    });
  }

  // Verificar se usuário quer receber notificações
  shouldNotifyUser(userId, type) {
    const prefs = this.userPreferences.get(userId);
    if (!prefs) return true; // Notifica por padrão
    
    return prefs[type] !== false;
  }

  // Estatísticas de notificações
  getNotificationStats() {
    return {
      queueLength: this.notificationQueue.length,
      isProcessing: this.isProcessing,
      userPreferences: this.userPreferences.size
    };
  }
}

module.exports = { NotificationService };
