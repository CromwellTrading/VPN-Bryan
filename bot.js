const { Telegraf } = require('telegraf');
const { userService, configFileService } = require('./supabase');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Comando /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    
    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}?userId=${userId}`;
    
    try {
        // Registrar usuario si no existe
        await userService.upsertUser(userId.toString(), {
            username: username,
            first_name: firstName,
            created_at: new Date().toISOString()
        });

        await ctx.reply(
            `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
            `Bienvenido a *VPN Cuba* 🚀\n\n` +
            `Ofrecemos la mejor conexión de baja latencia para tu experiencia gaming y navegación segura.\n\n` +
            `Para ver nuestros planes y realizar tu compra, abre nuestra WebApp:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { 
                            text: '🚀 Abrir WebApp', 
                            web_app: { url: webappUrl }
                        }
                    ]]
                }
            }
        );
    } catch (error) {
        console.error('Error en comando /start:', error);
        await ctx.reply('❌ Hubo un error al procesar tu solicitud. Por favor, intenta de nuevo.');
    }
});

// Comando /plans para ver planes
bot.command('plans', async (ctx) => {
    const userId = ctx.from.id;
    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    await ctx.reply(
        `📋 *Planes Disponibles*\n\n` +
        `1️⃣ *Plan Mensual* - $10/mes\n` +
        `2️⃣ *Plan Trimestral* - $27/3 meses (¡Ahorras $3!)\n` +
        `3️⃣ *Plan Anual* - $90/año (¡Ahorras $30!)\n\n` +
        `Para ver más detalles y realizar tu compra:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { 
                        text: '📊 Ver Planes Detallados', 
                        web_app: { url: webappUrl }
                    }
                ]]
            }
        }
    );
});

// Comando /status para verificar estado VIP
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
                `💰 Precio: $${user.plan_price || '0'}\n\n` +
                `Tu acceso está activo. Si necesitas ayuda, contacta con soporte.`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply(
                `❌ *No eres usuario VIP*\n\n` +
                `Actualmente no tienes acceso a los servicios premium.\n\n` +
                `Usa /plans para ver nuestros planes y realizar tu compra.`,
                { parse_mode: 'Markdown' }
            );
        }
    } catch (error) {
        console.error('Error en comando /status:', error);
        await ctx.reply('❌ Hubo un error al verificar tu estado. Por favor, intenta de nuevo.');
    }
});

// Comando /enviar para administradores
bot.command('enviar', async (ctx) => {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    const currentUserId = ctx.from.id.toString();
    
    // Verificar si es administrador
    if (currentUserId !== adminId) {
        await ctx.reply('❌ No tienes permisos para usar este comando.');
        return;
    }
    
    const args = ctx.message.text.split(' ');
    const target = args[1]; // ID o @usuario
    
    if (!target) {
        await ctx.reply('Uso: /enviar <ID o @usuario>\n\nEjemplo:\n/enviar 123456789\n/enviar @usuario');
        return;
    }
    
    // Guardar en sesión que estamos esperando un archivo
    ctx.session = ctx.session || {};
    ctx.session.waitingForFile = {
        target: target,
        command: 'enviar'
    };
    
    await ctx.reply(
        `📤 *Enviar configuración a:* ${target}\n\n` +
        `Por favor, envía el archivo de configuración (.conf) ahora:`,
        { parse_mode: 'Markdown' }
    );
});

// Manejar archivos enviados por administrador
bot.on('document', async (ctx) => {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    const currentUserId = ctx.from.id.toString();
    
    // Verificar si es administrador
    if (currentUserId !== adminId) {
        return; // Solo administradores pueden enviar archivos
    }
    
    if (ctx.session?.waitingForFile) {
        const { target, command } = ctx.session.waitingForFile;
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name;
        
        try {
            // Registrar envío en la base de datos
            await configFileService.saveConfigFile({
                telegram_id: target.replace('@', ''),
                file_id: fileId,
                file_name: fileName,
                sent_by: ctx.from.username || 'admin',
                sent_at: new Date().toISOString()
            });
            
            // Enviar archivo al usuario objetivo
            await ctx.telegram.sendDocument(target, fileId, {
                caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                        `📁 *Archivo:* ${fileName}\n\n` +
                        `*Instrucciones de instalación:*\n` +
                        `1. Descarga este archivo\n` +
                        `2. Importa en tu cliente WireGuard\n` +
                        `3. Activa la conexión\n` +
                        `4. ¡Disfruta de baja latencia! 🚀\n\n` +
                        `*Soporte:* Contacta con @${ctx.from.username || 'admin'} si tienes problemas.`,
                parse_mode: 'Markdown'
            });
            
            await ctx.reply(`✅ Archivo enviado exitosamente a ${target}`);
            
        } catch (error) {
            console.error('Error al enviar archivo:', error);
            await ctx.reply(`❌ Error al enviar archivo: ${error.message}`);
        }
        
        // Limpiar sesión
        delete ctx.session.waitingForFile;
    }
});

// Comando /admin para panel de administración
bot.command('admin', async (ctx) => {
    const adminId = process.env.ADMIN_TELEGRAM_ID;
    const currentUserId = ctx.from.id.toString();
    
    if (currentUserId !== adminId) {
        await ctx.reply('❌ No tienes permisos para acceder al panel de administración.');
        return;
    }
    
    const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html`;
    
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
        
        // Configurar comandos del bot
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'plans', description: 'Ver planes disponibles' },
            { command: 'status', description: 'Verificar estado VIP' },
            { command: 'admin', description: 'Panel de administración (solo admin)' },
            { command: 'enviar', description: 'Enviar configuración (solo admin)' }
        ]);
        
    } catch (error) {
        console.error('Error al iniciar el bot:', error);
    }
}

module.exports = {
    bot,
    startBot
};
