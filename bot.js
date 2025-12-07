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

// ==================== MENSAJES Y BOTONES PRINCIPALES ====================

// Comando /start - Pantalla principal con todos los botones
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

        // Crear teclado principal
        const keyboard = [
            [
                { 
                    text: '📋 VER PLANES', 
                    web_app: { url: plansUrl }
                },
                {
                    text: '👑 MI ESTADO',
                    callback_data: 'check_status'
                }
            ],
            [
                {
                    text: '🆘 SOPORTE',
                    url: 'https://t.me/L0quen2'
                }
            ]
        ];

        // Si es admin, agregar botones de admin
        if (isAdmin(userId)) {
            const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true`;
            
            keyboard.push([
                { 
                    text: '🔧 PANEL ADMIN', 
                    web_app: { url: adminUrl }
                },
                {
                    text: '📢 BROADCAST',
                    callback_data: 'start_broadcast'
                }
            ]);
            
            // Agregar fila adicional para broadcast en webapp
            keyboard.push([{ 
                text: '📢 ENVIAR A TODOS (WEB)', 
                web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
            }]);
        }

        await ctx.reply(
            `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
            `*BIENVENIDO A VPN CUBA* 🚀\n\n` +
            `Ofrecemos la mejor conexión de baja latencia para gaming y navegación segura.\n\n` +
            `*Selecciona una opción:*`,
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

// Botón "MENÚ PRINCIPAL"
bot.action('main_menu', async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name;
    
    const plansUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    // Crear teclado principal
    const keyboard = [
        [
            { 
                text: '📋 VER PLANES', 
                web_app: { url: plansUrl }
            },
            {
                text: '👑 MI ESTADO',
                callback_data: 'check_status'
            }
        ],
        [
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ]
    ];

    // Si es admin, agregar botones de admin
    if (isAdmin(userId)) {
        const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true`;
        
        keyboard.push([
            { 
                text: '🔧 PANEL ADMIN', 
                web_app: { url: adminUrl }
            },
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
        
        keyboard.push([{ 
            text: '📢 ENVIAR A TODOS (WEB)', 
            web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
        }]);
    }

    await ctx.editMessageText(
        `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón "VER PLANES"
bot.action('view_plans_button', async (ctx) => {
    const userId = ctx.from.id.toString();
    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    // Crear teclado para planes
    const keyboard = [
        [
            { 
                text: '🚀 COMPRAR AHORA', 
                web_app: { url: webappUrl }
            }
        ],
        [
            {
                text: '📊 VER DETALLES',
                callback_data: 'view_detailed_plans'
            }
        ],
        [
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    // Si es admin, agregar botón de broadcast
    if (isAdmin(userId)) {
        keyboard.push([
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📋 *PLANES DISPONIBLES* 🚀\n\n` +
        `*BÁSICO (1 mes)*\n` +
        `💵 $800 CUP\n\n` +
        `*PREMIUM (2 meses)*\n` +
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
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón "MI ESTADO"
bot.action('check_status', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    try {
        const user = await userService.getUserByTelegramId(userId);
        
        if (!user) {
            await ctx.editMessageText(
                `❌ *NO ESTÁS REGISTRADO*\n\n` +
                `Usa el botón "📋 VER PLANES" para registrarte y comenzar.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '📋 VER PLANES',
                                    callback_data: 'view_plans_button'
                                }
                            ],
                            [
                                {
                                    text: '🏠 MENÚ PRINCIPAL',
                                    callback_data: 'main_menu'
                                }
                            ]
                        ]
                    }
                }
            );
            return;
        }
        
        if (user.vip) {
            const vipSince = formatearFecha(user.vip_since);
            const diasRestantes = calcularDiasRestantes(user);
            const planNombre = user.plan ? 
                (user.plan === 'basico' ? 'BÁSICO (1 mes)' : 
                 user.plan === 'premium' ? 'PREMIUM (2 meses)' : 
                 user.plan === 'vip' ? 'VIP (6 meses)' : user.plan) : 
                'No especificado';
            
            let mensajeEstado = `✅ *¡ERES USUARIO VIP!* 👑\n\n`;
            mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
            mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
            mensajeEstado += `⏳ *Días restantes:* ${diasRestantes} días\n`;
            mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
            
            if (diasRestantes <= 7) {
                mensajeEstado += `⚠️ *TU PLAN ESTÁ POR EXPIRAR PRONTO*\n`;
                mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
            } else {
                mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
            }
            
            mensajeEstado += `*SELECCIONA UNA OPCIÓN:*`;
            
            // Crear teclado dinámico
            const keyboard = [
                [
                    { 
                        text: '🆘 CONTACTAR SOPORTE', 
                        url: 'https://t.me/L0quen2'
                    }
                ],
                [
                    {
                        text: '📋 VER PLANES',
                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}` }
                    },
                    {
                        text: '🔄 RENOVAR',
                        callback_data: 'view_plans_button'
                    }
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            // Si es admin, agregar botón de broadcast
            if (isAdmin(userId)) {
                keyboard.push([
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.editMessageText(
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
            const keyboard = [
                [
                    { 
                        text: '📋 VER PLANES', 
                        web_app: { url: webappUrl }
                    },
                    {
                        text: '🆘 SOPORTE',
                        url: 'https://t.me/L0quen2'
                    }
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            // Si es admin, agregar botón de broadcast
            if (isAdmin(userId)) {
                keyboard.push([
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.editMessageText(
                `❌ *NO ERES USUARIO VIP*\n\n` +
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
        console.error('Error en botón MI ESTADO:', error);
        await ctx.editMessageText(
            `❌ Error al verificar tu estado.\n\nPor favor, intenta de nuevo.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '🔄 REINTENTAR',
                                callback_data: 'check_status'
                            },
                            {
                                text: '🏠 MENÚ PRINCIPAL',
                                callback_data: 'main_menu'
                            }
                        ]
                    ]
                }
            }
        );
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
                    `📊 *DETALLES DE PLANES* 📋\n\n` +
                    `*PLAN BÁSICO (1 mes)*\n` +
                    `• Precio: $800 CUP\n` +
                    `• Conexión de baja latencia\n` +
                    `• Ancho de banda ilimitado\n` +
                    `• Soporte prioritario\n` +
                    `• 10 servidores disponibles\n\n` +
                    `*PLAN PREMIUM (2 meses)*\n` +
                    `• Precio: $1,300 CUP\n` +
                    `• ¡Ahorras $300 CUP!\n` +
                    `• Todo lo del Básico\n` +
                    `• 2 meses de servicio\n` +
                    `• Soporte 24/7\n` +
                    `• Protección de datos avanzada\n\n` +
                    `*PLAN VIP (6 meses)*\n` +
                    `• Precio: $3,000 CUP\n` +
                    `• ¡Ahorras $1,800 CUP!\n` +
                    `• Solo $500 CUP/mes\n` +
                    `• Todo lo del Premium\n` +
                    `• 6 meses de servicio\n` +
                    `• Configuración personalizada\n` +
                    `• Soporte dedicado VIP\n` +
                    `• Velocidad máxima garantizada\n\n` +
                    `*SELECCIONA UNA OPCIÓN:*`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { 
                                        text: '🚀 COMPRAR AHORA', 
                                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}` }
                                    }
                                ],
                                [
                                    {
                                        text: '🆘 SOPORTE',
                                        url: 'https://t.me/L0quen2'
                                    }
                                ],
                                [
                                    {
                                        text: '📋 VER PLANES RESUMEN',
                                        callback_data: 'view_plans_button'
                                    }
                                ],
                                [
                                    {
                                        text: '🏠 MENÚ PRINCIPAL',
                                        callback_data: 'main_menu'
                                    }
                                ]
                            ]
                        }
                    }
                );
                break;
                
            case 'start_broadcast':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ NO AUTORIZADO');
                    return;
                }
                
                ctx.session = ctx.session || {};
                ctx.session.waitingForBroadcastMessage = true;
                
                await ctx.editMessageText(
                    `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES* 📤\n\n` +
                    `Por favor, escribe el mensaje que quieres enviar a *todos* los usuarios registrados.\n\n` +
                    `*FORMATO:* Puedes usar Markdown para formato\n` +
                    `*EJEMPLO:*\n` +
                    `¡Hola a todos! 🎉\n` +
                    `Tenemos nuevas actualizaciones disponibles...\n\n` +
                    `Escribe tu mensaje ahora:`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '❌ CANCELAR',
                                        callback_data: 'main_menu'
                                    }
                                ]
                            ]
                        }
                    }
                );
                await ctx.answerCbQuery();
                break;
                
            case 'confirm_broadcast':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ NO AUTORIZADO');
                    return;
                }
                
                const broadcastMessage = ctx.session?.pendingBroadcast;
                if (!broadcastMessage) {
                    await ctx.answerCbQuery('❌ NO HAY MENSAJE PARA ENVIAR');
                    return;
                }
                
                // Obtener todos los usuarios
                const users = await userService.getAllUsers();
                const totalUsers = users.length;
                
                await ctx.editMessageText(
                    `📢 *ENVIANDO BROADCAST* 📤\n\n` +
                    `Enviando mensaje a ${totalUsers} usuarios...\n` +
                    `Por favor, espera. Esto puede tomar unos minutos.\n\n` +
                    `⏳ *PROGRESO:* 0/${totalUsers}`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: []
                        }
                    }
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
                            `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${broadcastMessage}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte: @L0quen2_`,
                            { parse_mode: 'Markdown' }
                        );
                        successCount++;
                        
                        // Actualizar progreso cada 10 usuarios
                        if (i % 10 === 0 || i === users.length - 1) {
                            await ctx.telegram.editMessageText(
                                ctx.chat.id,
                                ctx.callbackQuery.message.message_id,
                                null,
                                `📢 *ENVIANDO BROADCAST* 📤\n\n` +
                                `Enviando mensaje a ${totalUsers} usuarios...\n` +
                                `Por favor, espera. Esto puede tomar unos minutos.\n\n` +
                                `⏳ *PROGRESO:* ${i + 1}/${totalUsers}\n` +
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
                
                let finalMessage = `✅ *BROADCAST COMPLETADO* 📤\n\n`;
                finalMessage += `📊 *ESTADÍSTICAS:*\n`;
                finalMessage += `• Total de usuarios: ${totalUsers}\n`;
                finalMessage += `• Mensajes enviados: ${successCount}\n`;
                finalMessage += `• Mensajes fallados: ${failCount}\n`;
                finalMessage += `• Tasa de éxito: ${((successCount / totalUsers) * 100).toFixed(1)}%\n\n`;
                
                if (failCount > 0) {
                    finalMessage += `❌ *Usuarios con error:*\n`;
                    finalMessage += failedUsers.slice(0, 5).map(id => `• ${id}`).join('\n');
                    if (failedUsers.length > 5) {
                        finalMessage += `\n• ... y ${failedUsers.length - 5} más`;
                    }
                    finalMessage += `\n`;
                }
                
                finalMessage += `\n*SELECCIONA UNA OPCIÓN:*`;
                
                await ctx.editMessageText(
                    finalMessage,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '🔧 PANEL ADMIN',
                                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true` }
                                    },
                                    {
                                        text: '📢 NUEVO BROADCAST',
                                        callback_data: 'start_broadcast'
                                    }
                                ],
                                [
                                    {
                                        text: '🏠 MENÚ PRINCIPAL',
                                        callback_data: 'main_menu'
                                    }
                                ]
                            ]
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
                    `El envío masivo ha sido cancelado.\n\n` +
                    `*SELECCIONA UNA OPCIÓN:*`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    {
                                        text: '📢 NUEVO BROADCAST',
                                        callback_data: 'start_broadcast'
                                    }
                                ],
                                [
                                    {
                                        text: '🏠 MENÚ PRINCIPAL',
                                        callback_data: 'main_menu'
                                    }
                                ]
                            ]
                        }
                    }
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

// ==================== MANEJAR MENSAJES DE BROADCAST ====================

// Manejar mensaje de broadcast
bot.on('text', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const message = ctx.message.text;
    
    // Verificar si es admin y está esperando mensaje de broadcast
    if (isAdmin(currentUserId) && ctx.session?.waitingForBroadcastMessage) {
        ctx.session.waitingForBroadcastMessage = false;
        ctx.session.pendingBroadcast = message;
        
        await ctx.reply(
            `📢 *CONFIRMAR ENVÍO DE BROADCAST* ✅\n\n` +
            `*MENSAJE A ENVIAR:*\n${message}\n\n` +
            `Este mensaje será enviado a *todos los usuarios registrados*.\n\n` +
            `¿Estás seguro de que quieres continuar?`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ SÍ, ENVIAR A TODOS', callback_data: 'confirm_broadcast' },
                            { text: '❌ CANCELAR', callback_data: 'cancel_broadcast' }
                        ]
                    ]
                }
            }
        );
    }
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
                caption: `🎉 *¡TU CONFIGURACIÓN DE VPN CUBA ESTÁ LISTA!* 🚀\n\n` +
                        `📁 *Archivo:* ${fileName}\n\n` +
                        `*INSTRUCCIONES DE INSTALACIÓN:*\n` +
                        `1. Descarga este archivo\n` +
                        `2. Descomprime el ZIP/RAR\n` +
                        `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                        `4. Activa la conexión\n` +
                        `5. ¡Disfruta de baja latencia! 🚀\n\n` +
                        `*SOPORTE:* Contacta con @L0quen2 si tienes problemas.`,
                parse_mode: 'Markdown'
            });
            
            await ctx.reply(
                `✅ *ARCHIVO ENVIADO EXITOSAMENTE* 📤\n\n` +
                `Al usuario: ${target}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '🏠 MENÚ PRINCIPAL',
                                    callback_data: 'main_menu'
                                }
                            ]
                        ]
                    }
                }
            );
            
        } catch (error) {
            console.error('Error al enviar archivo:', error);
            await ctx.reply(
                `❌ *ERROR AL ENVIAR ARCHIVO*\n\n` +
                `${error.message}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '🔄 REINTENTAR',
                                    callback_data: 'main_menu'
                                }
                            ]
                        ]
                    }
                }
            );
        }
        
        // Limpiar sesión
        delete ctx.session.waitingForFile;
    }
});

// ==================== COMANDOS DE TEXTO (SOLO PARA EMERGENCIA) ====================

// Comando /help - Solo como backup
bot.command('help', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    await ctx.reply(
        `🆘 *VPN CUBA - AYUDA*\n\n` +
        `Usa los botones para navegar por todas las funciones.\n\n` +
        `*BOTONES DISPONIBLES:*\n` +
        `📋 VER PLANES - Ver y comprar planes\n` +
        `👑 MI ESTADO - Ver tu estado VIP y días restantes\n` +
        `🆘 SOPORTE - Contactar con soporte técnico\n` +
        `🔧 PANEL ADMIN - Panel de administración (solo admins)\n` +
        `📢 BROADCAST - Enviar mensaje a todos (solo admins)\n\n` +
        `¡Todo está disponible en los botones! 🚀`,
        { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '🏠 MENÚ PRINCIPAL',
                            callback_data: 'main_menu'
                        }
                    ]
                ]
            }
        }
    );
});

// ==================== INICIAR BOT ====================

async function startBot() {
    try {
        await bot.launch();
        console.log('🤖 Bot de Telegram iniciado correctamente');
        console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
        console.log(`🆘 Soporte configurado: @L0quen2`);
        console.log(`📢 Funcionalidad de Broadcast activa para admins`);
        console.log(`🎯 Todo en botones - Sin comandos de texto`);
        
        // Configurar comandos del bot (solo comandos básicos)
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Iniciar el bot y ver menú principal' },
            { command: 'help', description: 'Ayuda y información' }
        ]);
        
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
