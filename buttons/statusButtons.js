const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function createStatusButtons() {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('reivindicar')
        .setLabel('Reivindicar')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('analiser')
        .setLabel('Analisar')
        .setEmoji('🔎')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('status_aceitar')
        .setLabel('Aceitar')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('status_recusar')
        .setLabel('Recusar')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger)
    );
  
  return row;
}

module.exports = { createStatusButtons };