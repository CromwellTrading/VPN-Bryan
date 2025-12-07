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

// Función para calcular días restantes según el plan
function calcularDiasRestantes(user) {
    if (!user.vip || !user.vip_since || !user.plan) {
        return 0;
    }

    const fechaInicio = new Date(user.vip_since);
    const fechaActual = new Date();
    
    // Determinar duración del plan en días
    let duracionDias;
    switch(user.plan.toLowerCase()) {
        case 'basico':
            duracionDias = 30; // 1 mes
            break;
        case 'premium':
            duracionDias = 60; // 2 meses
            break;
        case 'vip':
            duracionDias = 180; // 6 meses
            break;
        default:
            duracionDias = 30; // Por defecto 30 días
    }
    
    // Calcular fecha de expiración
    const fechaExpiracion = new Date(fechaInicio);
    fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
    
    // Calcular diferencia en días
    const diferenciaMs = fechaExpiracion - fechaActual;
    const diasRestantes = Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));
    
    return diasRestantes;
}

// Función para formatear fecha
function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
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

// ==================== BROADCAST FUNCIONALIDAD ====================

// Comando para enviar mensaje a todos los usuarios (solo admin)
bot.command('broadcast', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    
    if (!isAdmin(currentUserId)) {
        await ctx.reply('❌ No tienes permisos para usar este comando.');
        return;
    }
    
    ctx.session = ctx.session || {};
    ctx.session.waitingForBroadcastMessage = true;
    
    await ctx.reply(
        `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES*\n\n` +
        `Por favor, escribe el mensaje que quieres enviar a todos los usuarios registrados.\n\n` +
        `*Formato:* Puedes usar Markdown para formato\n` +
        `*Ejemplo:*\n` +
        `¡Hola a todos! 🎉\n` +
        `Tenemos nuevas actualizaciones disponibles...`,
        { parse_mode: 'Markdown' }
    );
});

// Manejar mensaje de broadcast
bot.on('text', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const message = ctx.message.text;
    
    // Verificar si es admin y está esperando mensaje de broadcast
    if (isAdmin(currentUserId) && ctx.session?.waitingForBroadcastMessage) {
        ctx.session.waitingForBroadcastMessage = false;
        ctx.session.pendingBroadcast = message;
        
        await ctx.reply(
            `📢 *CONFIRMAR ENVÍO DE BROADCAST*\n\n` +
            `*Mensaje a enviar:*\n${message}\n\n` +
            `Este mensaje será enviado a *todos los usuarios registrados*.\n\n` +
            `¿Estás seguro de que quieres continuar?`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Sí, enviar a todos', callback_data: 'confirm_broadcast' },
                            { text: '❌ Cancelar', callback_data: 'cancel_broadcast' }
                        ]
                    ]
                }
            }
        );
    }
});

// ==================== COMANDO /START ====================

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

        // Si es admin, agregar botón de admin y broadcast
        if (isAdmin(userId)) {
            const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true`;
            
            keyboard.push([
                { 
                    text: '🔧 Panel Admin', 
                    web_app: { url: adminUrl }
                },
                {
                    text: '📢 Broadcast',
                    callback_data: 'start_broadcast'
                }
            ]);
            
            // Agregar fila adicional para broadcast en webapp
            keyboard.push([{ 
                text: '📢 Enviar a Todos (Web)', 
                web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
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

// ==================== COMANDO /PLANS ====================

bot.command('plans', async (ctx) => {
    const userId = ctx.from.id;
    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    // Crear teclado dinámico
    const keyboard = [[
        { 
            text: '🚀 Comprar Ahora', 
            web_app: { url: webappUrl }
        },
        {
            text: '📊 Ver Detalles',
            callback_data: 'view_detailed_plans'
        }
    ]];
    
    // Si es admin, agregar botón de broadcast
    if (isAdmin(userId)) {
        keyboard.push([
            {
                text: '📢 Broadcast',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    keyboard.push([
        {
            text: '🆘 Soporte',
            url: 'https://t.me/L0quen2'
        }
    ]);
    
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
                inline_keyboard: keyboard
            }
        }
    );
});

// ==================== COMANDO /STATUS ====================

bot.command('status', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    try {
        const user = await userService.getUserByTelegramId(userId);
        
        if (!user) {
            await ctx.reply('❌ No estás registrado. Usa /start para comenzar.');
            return;
        }
        
        if (user.vip) {
            const vipSince = formatearFecha(user.vip_since);
            const diasRestantes = calcularDiasRestantes(user);
            const planNombre = user.plan ? 
                (user.plan === 'basico' ? 'Básico (1 mes)' : 
                 user.plan === 'premium' ? 'Premium (2 meses)' : 
                 user.plan === 'vip' ? 'VIP (6 meses)' : user.plan) : 
                'No especificado';
            
            let mensajeEstado = `✅ *¡Eres usuario VIP!*\n\n`;
            mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
            mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
            mensajeEstado += `⏳ *Días restantes:* ${diasRestantes} días\n`;
            mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
            
            if (diasRestantes <= 7) {
                mensajeEstado += `⚠️ *Tu plan está por expirar pronto.*\n`;
                mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
            } else {
                mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
            }
            
            mensajeEstado += `Para problemas técnicos, contacta a nuestro soporte:`;
            
            // Crear teclado dinámico
            const keyboard = [[
                { 
                    text: '🆘 Contactar Soporte', 
                    url: 'https://t.me/L0quen2'
                }
            ], [
                {
                    text: '📋 Ver Planes',
                    web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}` }
                }
            ]];
            
            // Si es admin, agregar botón de broadcast
            if (isAdmin(userId)) {
                keyboard.push([
                    {
                        text: '📢 Broadcast',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.reply(
                mensajeEstado,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } else {
            const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
            
            // Crear teclado dinámico
            const keyboard = [[
                { 
                    text: '📋 Ver Planes', 
                    web_app: { url: webappUrl }
                },
                {
                    text: '🆘 Soporte',
                    url: 'https://t.me/L0quen2'
                }
            ]];
            
            // Si es admin, agregar botón de broadcast
            if (isAdmin(userId)) {
                keyboard.push([
                    {
                        text: '📢 Broadcast',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.reply(
                `❌ *No eres usuario VIP*\n\n` +
                `Actualmente no tienes acceso a los servicios premium.\n\n` +
                `Haz clic en los botones para ver nuestros planes o contactar soporte:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        }
    } catch (error) {
        console.error('Error en comando /status:', error);
        await ctx.reply('❌ Hubo un error al verificar tu estado. Por favor, intenta de nuevo.');
    }
});

// ==================== CALLBACK QUERY HANDLER ====================

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
                            ], [
                                {
                                    text: '🆘 Soporte',
                                    url: 'https://t.me/L0quen2'
                                }
                            ]]
                        }
                    }
                );
                break;
                
            case 'check_status':
                const user = await userService.getUserByTelegramId(userId);
                
                if (!user) {
                    await ctx.answerCbQuery('❌ No estás registrado');
                    return;
                }
                
                if (user.vip) {
                    const vipSince = formatearFecha(user.vip_since);
                    const diasRestantes = calcularDiasRestantes(user);
                    const planNombre = user.plan ? 
                        (user.plan === 'basico' ? 'Básico (1 mes)' : 
                         user.plan === 'premium' ? 'Premium (2 meses)' : 
                         user.plan === 'vip' ? 'VIP (6 meses)' : user.plan) : 
                        'No especificado';
                    
                    let mensajeEstado = `✅ *¡Eres usuario VIP!*\n\n`;
                    mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
                    mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
                    mensajeEstado += `⏳ *Días restantes:* ${diasRestantes} días\n`;
                    mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
                    
                    if (diasRestantes <= 7) {
                        mensajeEstado += `⚠️ *Tu plan está por expirar pronto.*\n`;
                        mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
                    } else {
                        mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
                    }
                    
                    mensajeEstado += `Para problemas técnicos, contacta a nuestro soporte:`;
                    
                    await ctx.editMessageText(
                        mensajeEstado,
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { 
                                        text: '🆘 Contactar Soporte', 
                                        url: 'https://t.me/L0quen2'
                                    }
                                ], [
                                    {
                                        text: '📋 Ver Planes',
                                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}` }
                                    }
                                ]]
                            }
                        }
                    );
                } else {
                    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
                    
                    await ctx.editMessageText(
                        `❌ *No eres usuario VIP*\n\n` +
                        `Actualmente no tienes acceso a los servicios premium.\n\n` +
                        `Haz clic en los botones para ver nuestros planes o contactar soporte:`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [[
                                    { 
                                        text: '📋 Ver Planes', 
                                        web_app: { url: webappUrl }
                                    },
                                    {
                                        text: '🆘 Soporte',
                                        url: 'https://t.me/L0quen2'
                                    }
                                ]]
                            }
                        }
                    );
                }
                await ctx.answerCbQuery();
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
                                }],
                                [
                                    {
                                        text: '📢 Enviar Broadcast',
                                        callback_data: 'start_broadcast'
                                    }
                                ],
                                [{
                                    text: '🆘 Soporte',
                                    url: 'https://t.me/L0quen2'
                                }]
                            ]
                        }
                    }
                );
                break;
                
            case 'start_broadcast':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                ctx.session = ctx.session || {};
                ctx.session.waitingForBroadcastMessage = true;
                
                await ctx.editMessageText(
                    `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES*\n\n` +
                    `Por favor, escribe el mensaje que quieres enviar a todos los usuarios registrados.\n\n` +
                    `*Formato:* Puedes usar Markdown para formato\n` +
                    `*Ejemplo:*\n` +
                    `¡Hola a todos! 🎉\n` +
                    `Tenemos nuevas actualizaciones disponibles...`,
                    { parse_mode: 'Markdown' }
                );
                await ctx.answerCbQuery();
                break;
                
            case 'confirm_broadcast':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ No autorizado');
                    return;
                }
                
                const broadcastMessage = ctx.session?.pendingBroadcast;
                if (!broadcastMessage) {
                    await ctx.answerCbQuery('❌ No hay mensaje para enviar');
                    return;
                }
                
                // Obtener todos los usuarios
                const users = await userService.getAllUsers();
                const totalUsers = users.length;
                
                await ctx.editMessageText(
                    `📢 *ENVIANDO BROADCAST*\n\n` +
                    `Enviando mensaje a ${totalUsers} usuarios...\n` +
                    `Por favor, espera.`,
                    { parse_mode: 'Markdown' }
                );
                
                let successCount = 0;
                let failCount = 0;
                const failedUsers = [];
                
                // Enviar mensaje a cada usuario con un pequeño delay para evitar límites de Telegram
                for (let i = 0; i < users.length; i++) {
                    const user = users[i];
                    
                    try {
                        await bot.telegram.sendMessage(
                            user.telegram_id,
                            `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${broadcastMessage}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte._`,
                            { parse_mode: 'Markdown' }
                        );
                        successCount++;
                        
                        // Actualizar progreso cada 10 usuarios
                        if (i % 10 === 0 || i === users.length - 1) {
                            await ctx.telegram.editMessageText(
                                ctx.chat.id,
                                ctx.callbackQuery.message.message_id,
                                null,
                                `📢 *ENVIANDO BROADCAST*\n\n` +
                                `Progreso: ${i + 1}/${totalUsers} usuarios\n` +
                                `✅ Enviados: ${successCount}\n` +
                                `❌ Fallados: ${failCount}`,
                                { parse_mode: 'Markdown' }
                            );
                        }
                        
                        // Pequeño delay para evitar ser bloqueado por Telegram
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (error) {
                        console.error(`Error enviando broadcast a ${user.telegram_id}:`, error.message);
                        failCount++;
                        failedUsers.push(user.telegram_id);
                    }
                }
                
                delete ctx.session.pendingBroadcast;
                
                let finalMessage = `✅ *BROADCAST COMPLETADO*\n\n`;
                finalMessage += `📊 *Estadísticas:*\n`;
                finalMessage += `• Total de usuarios: ${totalUsers}\n`;
                finalMessage += `• Mensajes enviados: ${successCount}\n`;
                finalMessage += `• Mensajes fallados: ${failCount}\n`;
                finalMessage += `• Tasa de éxito: ${((successCount / totalUsers) * 100).toFixed(1)}%\n\n`;
                
                if (failCount > 0) {
                    finalMessage += `❌ *Usuarios con error:*\n`;
                    finalMessage += failedUsers.slice(0, 10).map(id => `• ${id}`).join('\n');
                    if (failedUsers.length > 10) {
                        finalMessage += `\n• ... y ${failedUsers.length - 10} más`;
                    }
                }
                
                await ctx.editMessageText(
                    finalMessage,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [[
                                {
                                    text: '📊 Ver Panel Admin',
                                    web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true` }
                                }
                            ]]
                        }
                    }
                );
                
                break;
                
            case 'cancel_broadcast':
                if (ctx.session?.pendingBroadcast) {
                    delete ctx.session.pendingBroadcast;
                }
                
                await ctx.editMessageText(
                    `❌ *BROADCAST CANCELADO*\n\n` +
                    `El envío masivo ha sido cancelado.`,
                    { parse_mode: 'Markdown' }
                );
                await ctx.answerCbQuery();
                break;
        }
        
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Error en callback_query:', error);
        await ctx.answerCbQuery('❌ Error al procesar la solicitud');
    }
});

// ==================== COMANDO /ADMIN ====================

bot.command('admin', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    
    if (!isAdmin(currentUserId)) {
        await ctx.reply('❌ No tienes permisos para acceder al panel de administración.');
        return;
    }
    
    const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${currentUserId}&admin=true`;
    const broadcastUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${currentUserId}&admin=true`;
    
    await ctx.reply(
        `🔧 *Panel de Administración*\n\n` +
        `Accede al panel completo desde:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: '🔧 Abrir Panel Admin', 
                            web_app: { url: adminUrl }
                        }
                    ],
                    [
                        {
                            text: '📢 Enviar Broadcast',
                            callback_data: 'start_broadcast'
                        },
                        {
                            text: '📢 Web Broadcast',
                            web_app: { url: broadcastUrl }
                        }
                    ],
                    [
                        {
                            text: '🆘 Soporte',
                            url: 'https://t.me/L0quen2'
                        }
                    ]
                ]
            }
        }
    );
});

// ==================== MANEJAR ARCHIVOS ====================

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
                        `*Soporte:* Contacta con @L0quen2 si tienes problemas.`,
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

// ==================== COMANDO /SOPORTE ====================

bot.command(['soporte', 'support'], async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // Crear teclado dinámico
    const keyboard = [[
        { 
            text: '🆘 Contactar Soporte', 
            url: 'https://t.me/L0quen2'
        }
    ]];
    
    // Si es admin, agregar botón de broadcast
    if (isAdmin(userId)) {
        keyboard.push([
            {
                text: '📢 Broadcast',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.reply(
        `🆘 *Soporte VPN Cuba*\n\n` +
        `Para cualquier problema o consulta, contacta a nuestro equipo de soporte:\n\n` +
        `📱 *Telegram:* @L0quen2\n\n` +
        `Nuestro equipo está disponible para ayudarte con:\n` +
        `• Problemas de conexión\n` +
        `• Configuración de la VPN\n` +
        `• Renovación de plan\n` +
        `• Consultas generales\n\n` +
        `¡Estamos aquí para ayudarte! 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// ==================== COMANDO /HELP ====================

bot.command('help', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    // Crear teclado dinámico
    const keyboard = [[
        {
            text: '🆘 Soporte',
            url: 'https://t.me/L0quen2'
        }
    ]];
    
    // Si es admin, agregar botón de broadcast
    if (isAdmin(userId)) {
        keyboard.push([
            {
                text: '📢 Broadcast',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.reply(
        `📚 *Ayuda - VPN Cuba*\n\n` +
        `*Comandos disponibles:*\n` +
        `/start - Iniciar el bot\n` +
        `/plans - Ver planes disponibles\n` +
        `/status - Verificar tu estado VIP\n` +
        `/soporte - Contactar con soporte\n` +
        `/help - Mostrar esta ayuda\n\n` +
        `${isAdmin(userId) ? '/broadcast - Enviar mensaje a todos los usuarios (solo admin)\n' : ''}` +
        `*Para comprar:*\n` +
        `1. Usa /plans o haz clic en "Ver Planes"\n` +
        `2. Selecciona tu plan\n` +
        `3. Realiza el pago\n` +
        `4. Envía la captura de pantalla\n` +
        `5. Espera la aprobación\n` +
        `6. Recibirás tu configuración\n\n` +
        `*Soporte:*\n` +
        `Para problemas, contacta a @L0quen2\n\n` +
        `¡Gracias por elegir VPN Cuba! 🚀`,
        { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// ==================== MANEJAR ERRORES ====================

bot.catch((err, ctx) => {
    console.error(`Error en el bot para ${ctx.updateType}:`, err);
    
    // Intentar notificar al usuario sobre el error
    if (ctx.message) {
        ctx.reply('❌ Ocurrió un error al procesar tu solicitud. Por favor, intenta de nuevo.');
    }
});

// ==================== INICIAR BOT ====================

async function startBot() {
    try {
        await bot.launch();
        console.log('🤖 Bot de Telegram iniciado correctamente');
        console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
        console.log(`🆘 Soporte configurado: @L0quen2`);
        console.log(`📢 Funcionalidad de Broadcast activa para admins`);
        
        // Configurar comandos del bot
        const commands = [
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'plans', description: 'Ver planes disponibles' },
            { command: 'status', description: 'Verificar estado VIP y días restantes' },
            { command: 'soporte', description: 'Contactar con soporte' },
            { command: 'help', description: 'Mostrar ayuda' }
        ];
        
        // Agregar comando broadcast solo para admins (opcional, puede comentarse para que no sea visible)
        // commands.push({ command: 'broadcast', description: 'Enviar mensaje a todos (solo admin)' });
        
        await bot.telegram.setMyCommands(commands);
        
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
    ADMIN_IDS,
    calcularDiasRestantes,
    formatearFecha
};
