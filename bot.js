const { Telegraf } = require('telegraf');
const { userService, configFileService } = require('./supabase');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// IDs de administradores (separados por comas)
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    [];

// Verificar si es administrador
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId.toString());
}

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

        // Crear teclado dinámico según si es admin o no
        const keyboard = [[
            { 
                text: '🚀 Abrir WebApp', 
                web_app: { url: webappUrl }
            }
        ]];

        // Si es admin, agregar botón de admin
        if (isAdmin(userId)) {
            keyboard.push([{ 
                text: '🔧 Panel Admin', 
                callback_data: 'admin_panel' 
            }]);
        }

        await ctx.reply(
            `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
            `Bienvenido a *VPN Cuba* 🚀\n\n` +
            `Ofrecemos la mejor conexión de baja latencia para tu experiencia gaming y navegación segura.\n\n` +
            `Para ver nuestros planes y realizar tu compra, abre nuestra WebApp:`,
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
                `💰 Precio: $${user.plan_price || '0'}\n\n` +
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
                                text: '🚀 Ver Planes', 
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

// Comando /enviar para administradores
bot.command('enviar', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    
    // Verificar si es administrador
    if (!isAdmin(currentUserId)) {
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
    const currentUserId = ctx.from.id.toString();
    
    // Verificar si es administrador
    if (!isAdmin(currentUserId)) {
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
    const currentUserId = ctx.from.id.toString();
    
    if (!isAdmin(currentUserId)) {
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
                    },
                    {
                        text: '📊 Ver Detalles Aquí',
                        callback_data: 'admin_dashboard'
                    }
                ]]
            }
        }
    );
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
                    `• Soporte prioritario\n\n` +
                    `*Plan Premium (2 meses)*\n` +
                    `• Precio: $1,300 CUP\n` +
                    `• ¡Ahorras $300 CUP!\n` +
                    `• Todo lo del Básico\n` +
                    `• 2 meses de servicio\n` +
                    `• Soporte 24/7\n\n` +
                    `*Plan VIP (6 meses)*\n` +
                    `• Precio: $3,000 CUP\n` +
                    `• ¡Ahorras $1,800 CUP!\n` +
                    `• Solo $500 CUP/mes\n` +
                    `• Todo lo del Premium\n` +
                    `• 6 meses de servicio\n` +
                    `• Configuración personalizada\n` +
                    `• Soporte dedicado VIP\n\n` +
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
                
                const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html`;
                await ctx.editMessageText(
                    `🔧 *Panel de Administración*\n\n` +
                    `Selecciona una opción:`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔧 Abrir Panel Web', web_app: { url: adminUrl } }],
                                [{ text: '📊 Ver Estadísticas', callback_data: 'view_stats' }],
                                [{ text: '👑 Ver Usuarios VIP', callback_data: 'view_vip_users' }],
                                [{ text: '⏳ Ver Pagos Pendientes', callback_data: 'view_pending_payments' }]
                            ]
                        }
                    }
                );
                break;
                
            case 'admin_dashboard':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                await ctx.editMessageText(
                    `🔧 *Dashboard de Administración*\n\n` +
                    `Comandos disponibles:\n` +
                    `/admin - Panel de administración\n` +
                    `/enviar <id> - Enviar configuración\n` +
                    `/stats - Ver estadísticas\n\n` +
                    `También puedes usar la WebApp para más funciones.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { 
                                    text: '🔧 Abrir Panel Web', 
                                    web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html` }
                                }
                            ]]
                        }
                    }
                );
                break;
                
            case 'view_stats':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                // Aquí deberías obtener estadísticas reales de tu base de datos
                const stats = await userService.getStats();
                
                await ctx.editMessageText(
                    `📊 *Estadísticas*\n\n` +
                    `👥 Total usuarios: ${stats.totalUsers || 0}\n` +
                    `👑 Usuarios VIP: ${stats.vipUsers || 0}\n` +
                    `💰 Ingresos totales: $${stats.totalRevenue || 0} CUP\n` +
                    `📅 Usuarios hoy: ${stats.todayUsers || 0}`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '« Volver', callback_data: 'admin_dashboard' }
                            ]]
                        }
                    }
                );
                break;
                
            case 'view_vip_users':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                const vipUsers = await userService.getVIPUsers();
                
                if (vipUsers.length === 0) {
                    await ctx.editMessageText(
                        `👑 *Usuarios VIP*\n\n` +
                        `No hay usuarios VIP actualmente.`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '« Volver', callback_data: 'admin_dashboard' }
                                ]]
                            }
                        }
                    );
                    return;
                }
                
                let vipList = `👑 *Usuarios VIP (${vipUsers.length})*\n\n`;
                vipUsers.forEach((user, index) => {
                    vipList += `${index + 1}. ${user.first_name || 'Usuario'} (@${user.username || 'sin_usuario'})\n`;
                    vipList += `   Plan: ${user.plan || 'VIP'}\n`;
                    vipList += `   Desde: ${new Date(user.vip_since).toLocaleDateString('es-ES')}\n\n`;
                });
                
                await ctx.editMessageText(
                    vipList,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '« Volver', callback_data: 'admin_dashboard' }
                            ]]
                        }
                    }
                );
                break;
                
            case 'view_pending_payments':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                // Aquí deberías obtener pagos pendientes reales
                const pendingPayments = await userService.getPendingPayments();
                
                if (pendingPayments.length === 0) {
                    await ctx.editMessageText(
                        `⏳ *Pagos Pendientes*\n\n` +
                        `No hay pagos pendientes actualmente.`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '« Volver', callback_data: 'admin_dashboard' }
                                ]]
                            }
                        }
                    );
                    return;
                }
                
                let paymentsList = `⏳ *Pagos Pendientes (${pendingPayments.length})*\n\n`;
                pendingPayments.forEach((payment, index) => {
                    paymentsList += `${index + 1}. Usuario: ${payment.telegram_id}\n`;
                    paymentsList += `   Plan: ${payment.plan}\n`;
                    paymentsList += `   Monto: $${payment.price} CUP\n`;
                    paymentsList += `   Fecha: ${new Date(payment.created_at).toLocaleDateString('es-ES')}\n\n`;
                });
                
                await ctx.editMessageText(
                    paymentsList,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '« Volver', callback_data: 'admin_dashboard' }
                            ]]
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

// Comando /help
bot.command('help', async (ctx) => {
    const keyboard = [[
        { text: '📋 Ver Planes', callback_data: 'view_detailed_plans' },
        { text: '👑 Mi Estado', callback_data: 'check_status' }
    ]];
    
    if (isAdmin(ctx.from.id.toString())) {
        keyboard.push([{ text: '🔧 Panel Admin', callback_data: 'admin_panel' }]);
    }
    
    await ctx.reply(
        `🆘 *Ayuda - VPN Cuba*\n\n` +
        `Comandos disponibles:\n` +
        `/start - Iniciar el bot\n` +
        `/plans - Ver planes disponibles\n` +
        `/status - Verificar tu estado VIP\n` +
        `/help - Mostrar esta ayuda\n\n` +
        `También puedes usar los botones:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
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
            { command: 'help', description: 'Mostrar ayuda' }
        ]);
        
        // Si hay administradores, agregar comandos de admin
        if (ADMIN_IDS.length > 0) {
            // No podemos tener comandos diferentes para diferentes usuarios,
            // pero podemos mantener /admin y /enviar aunque solo funcionen para admins
            console.log('Administradores configurados:', ADMIN_IDS);
        }
        
    } catch (error) {
        console.error('Error al iniciar el bot:', error);
    }
}

module.exports = {
    bot,
    startBot
};
