const { Telegraf } = require('telegraf');
const { userService, configFileService, paymentService } = require('./supabase');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// IDs de administradores (separados por comas)
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604'];

// Verificar si es administrador
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId.toString());
}

// ==================== KEEP ALIVE ====================

// Función para mantener activa la conexión del bot (ping cada 5 minutos)
function startBotKeepAlive() {
  const keepAliveInterval = 5 * 60 * 1000; // 5 minutos en milisegundos
  
  setInterval(() => {
    // Simplemente registramos que el bot está activo
    console.log(`🤖 Bot activo y escuchando a las ${new Date().toLocaleTimeString()}`);
    
    // También podemos verificar conexión con Telegram
    try {
      // Opcional: Hacer una llamada simple para verificar que el bot sigue conectado
      bot.telegram.getMe()
        .then(() => {
          console.log('✅ Conexión con Telegram estable');
        })
        .catch(error => {
          console.error('❌ Error en conexión con Telegram:', error.message);
        });
    } catch (error) {
      console.error('❌ Error en keep-alive del bot:', error.message);
    }
  }, keepAliveInterval);

  console.log(`🔄 Keep-alive del bot iniciado. Verificación cada 5 minutos`);
}

// Comando /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    
    const plansUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    try {
        // Registrar usuario si no existe
        await userService.upsertUser(userId.toString(), {
            username: username,
            first_name: firstName,
            created_at: new Date().toISOString()
        });

        // Crear teclado dinámico según si es admin o no
        const keyboard = [[
            { 
                text: '📋 Ver Planes', 
                web_app: { url: plansUrl }
            }
        ]];

        // Si es admin, agregar botón de admin
        if (isAdmin(userId)) {
            keyboard.push([{ 
                text: '🔧 Panel Admin', 
                web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true` }
            }]);
        }

        await ctx.reply(
            `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
            `Bienvenido a *VPN Cuba* 🚀\n\n` +
            `Ofrecemos la mejor conexión de baja latencia para tu experiencia gaming y navegación segura.\n\n` +
            `Para ver nuestros planes y realizar tu compra, haz clic en el botón de abajo:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    } catch (error) {
        console.error('Error en comando /start:', error);
        await ctx.reply('❌ Hubo un error al procesar tu solicitud. Por favor, intenta de nuevo.');
    }
});

// Comando /plans para ver planes (disponible para todos)
bot.command('plans', async (ctx) => {
    const userId = ctx.from.id;
    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    await ctx.reply(
        `📋 *Planes Disponibles*\n\n` +
        `*Básico (1 mes)*\n` +
        `💵 $800 CUP\n\n` +
        `*Premium (2 meses)*\n` +
        `💵 $1,300 CUP\n` +
        `💰 ¡Ahorras $300 CUP!\n\n` +
        `*VIP (6 meses)*\n` +
        `💵 $3,000 CUP\n` +
        `👑 ¡MEJOR OFERTA!\n` +
        `💰 ¡Ahorras $1,800 CUP!\n` +
        `📅 Solo $500 CUP/mes\n\n` +
        `✅ Baja Latencia\n` +
        `✅ Ancho de Banda Ilimitado\n` +
        `✅ Soporte Prioritario\n\n` +
        `Para comprar, haz clic en el botón de abajo:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { 
                        text: '🚀 Comprar Ahora', 
                        web_app: { url: webappUrl }
                    },
                    {
                        text: '📊 Ver Detalles',
                        callback_data: 'view_detailed_plans'
                    }
                ]]
            }
        }
    );
});

// Comando /status para verificar estado VIP (disponible para todos)
bot.command('status', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    try {
        const user = await userService.getUserByTelegramId(userId);
        
        if (!user) {
            await ctx.reply('❌ No estás registrado. Usa /start para comenzar.');
            return;
        }
        
        if (user.vip) {
            const vipSince = new Date(user.vip_since).toLocaleDateString('es-ES');
            await ctx.reply(
                `✅ *¡Eres usuario VIP!*\n\n` +
                `📅 Desde: ${vipSince}\n` +
                `📋 Plan: ${user.plan || 'No especificado'}\n` +
                `💰 Precio: $${user.plan_price || '0'} CUP\n\n` +
                `Tu acceso está activo. Si necesitas ayuda, contacta con soporte.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
            
            await ctx.reply(
                `❌ *No eres usuario VIP*\n\n` +
                `Actualmente no tienes acceso a los servicios premium.\n\n` +
                `Haz clic en el botón para ver nuestros planes:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { 
                                text: '📋 Ver Planes', 
                                web_app: { url: webappUrl }
                            }
                        ]]
                    }
                }
            );
        }
    } catch (error) {
        console.error('Error en comando /status:', error);
        await ctx.reply('❌ Hubo un error al verificar tu estado. Por favor, intenta de nuevo.');
    }
});

// Callback Query Handler
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();
    
    try {
        switch (data) {
            case 'view_detailed_plans':
                await ctx.editMessageText(
                    `📊 *Detalles de Planes*\n\n` +
                    `*Plan Básico (1 mes)*\n` +
                    `• Precio: $800 CUP\n` +
                    `• Conexión de baja latencia\n` +
                    `• Ancho de banda ilimitado\n` +
                    `• Soporte prioritario\n` +
                    `• 10 servidores disponibles\n\n` +
                    `*Plan Premium (2 meses)*\n` +
                    `• Precio: $1,300 CUP\n` +
                    `• ¡Ahorras $300 CUP!\n` +
                    `• Todo lo del Básico\n` +
                    `• 2 meses de servicio\n` +
                    `• Soporte 24/7\n` +
                    `• Protección de datos avanzada\n\n` +
                    `*Plan VIP (6 meses)*\n` +
                    `• Precio: $3,000 CUP\n` +
                    `• ¡Ahorras $1,800 CUP!\n` +
                    `• Solo $500 CUP/mes\n` +
                    `• Todo lo del Premium\n` +
                    `• 6 meses de servicio\n` +
                    `• Configuración personalizada\n` +
                    `• Soporte dedicado VIP\n` +
                    `• Velocidad máxima garantizada\n\n` +
                    `Haz clic en Comprar Ahora para seleccionar tu plan:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { 
                                    text: '🚀 Comprar Ahora', 
                                    web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}` }
                                }
                            ]]
                        }
                    }
                );
                break;
                
            case 'admin_panel':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true`;
                await ctx.editMessageText(
                    `🔧 *Panel de Administración*\n\n` +
                    `Selecciona una opción:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ 
                                    text: '🔧 Abrir Panel Web', 
                                    web_app: { url: adminUrl }
                                }]
                            ]
                        }
                    }
                );
                break;
        }
        
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Error en callback_query:', error);
        await ctx.answerCbQuery('❌ Error al procesar la solicitud');
    }
});

// Comando /admin para panel de administración
bot.command('admin', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    
    if (!isAdmin(currentUserId)) {
        await ctx.reply('❌ No tienes permisos para acceder al panel de administración.');
        return;
    }
    
    const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${currentUserId}&admin=true`;
    
    await ctx.reply(
        `🔧 *Panel de Administración*\n\n` +
        `Accede al panel completo desde:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { 
                        text: '🔧 Abrir Panel Admin', 
                        web_app: { url: adminUrl }
                    }
                ]]
            }
        }
    );
});

// Manejar archivos enviados por administrador
bot.on('document', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    
    // Verificar si es administrador
    if (!isAdmin(currentUserId)) {
        return; // Solo administradores pueden enviar archivos
    }
    
    if (ctx.session?.waitingForFile) {
        const { target, paymentId } = ctx.session.waitingForFile;
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name;
        
        try {
            // Registrar envío en la base de datos
            await configFileService.saveConfigFile({
                telegram_id: target,
                file_id: fileId,
                file_name: fileName,
                sent_by: ctx.from.username || 'admin',
                sent_at: new Date().toISOString(),
                payment_id: paymentId
            });
            
            // Actualizar pago como configurado
            await paymentService.updatePayment(paymentId, {
                config_sent: true,
                config_sent_at: new Date().toISOString()
            });
            
            // Enviar archivo al usuario objetivo
            await ctx.telegram.sendDocument(target, fileId, {
                caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                        `📁 *Archivo:* ${fileName}\n\n` +
                        `*Instrucciones de instalación:*\n` +
                        `1. Descarga este archivo\n` +
                        `2. Descomprime el ZIP/RAR\n` +
                        `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                        `4. Activa la conexión\n` +
                        `5. ¡Disfruta de baja latencia! 🚀\n\n` +
                        `*Soporte:* Contacta con @${ctx.from.username || 'admin'} si tienes problemas.`,
                parse_mode: 'Markdown'
            });
            
            await ctx.reply(`✅ Archivo enviado exitosamente al usuario ${target}`);
            
        } catch (error) {
            console.error('Error al enviar archivo:', error);
            await ctx.reply(`❌ Error al enviar archivo: ${error.message}`);
        }
        
        // Limpiar sesión
        delete ctx.session.waitingForFile;
    }
});

// Comando /help
bot.command('help', async (ctx) => {
    await ctx.reply(
        `📚 *Ayuda - VPN Cuba*\n\n` +
        `*Comandos disponibles:*\n` +
        `/start - Iniciar el bot\n` +
        `/plans - Ver planes disponibles\n` +
        `/status - Verificar tu estado VIP\n` +
        `/help - Mostrar esta ayuda\n\n` +
        `*Para comprar:*\n` +
        `1. Usa /plans o haz clic en "Ver Planes"\n` +
        `2. Selecciona tu plan\n` +
        `3. Realiza el pago\n` +
        `4. Envía la captura de pantalla\n` +
        `5. Espera la aprobación\n` +
        `6. Recibirás tu configuración\n\n` +
        `*Soporte:*\n` +
        `Para problemas, contacta a un administrador.`,
        { parse_mode: 'Markdown' }
    );
});

// Manejar errores del bot
bot.catch((err, ctx) => {
    console.error(`Error en el bot para ${ctx.updateType}:`, err);
    
    // Intentar notificar al usuario sobre el error
    if (ctx.message) {
        ctx.reply('❌ Ocurrió un error al procesar tu solicitud. Por favor, intenta de nuevo.');
    }
});

// Iniciar bot
async function startBot() {
    try {
        await bot.launch();
        console.log('🤖 Bot de Telegram iniciado correctamente');
        console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
        
        // Configurar comandos del bot
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'plans', description: 'Ver planes disponibles' },
            { command: 'status', description: 'Verificar estado VIP' },
            { command: 'help', description: 'Mostrar ayuda' }
        ]);
        
        // Si hay administradores, agregar comandos de admin
        if (ADMIN_IDS.length > 0) {
            console.log('✅ Comandos de admin disponibles para usuarios autorizados');
        }

        // Iniciar keep-alive del bot
        startBotKeepAlive();
        
    } catch (error) {
        console.error('Error al iniciar el bot:', error);
    }
}

module.exports = {
    bot,
    startBot,
    isAdmin,
    ADMIN_IDS
};
