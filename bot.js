const { Telegraf } = require('telegraf');
const { userService, configFileService, paymentService } = require('./supabase');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// IDs de administradores
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
            duracionDias = 30;
    }
    
    const fechaExpiracion = new Date(fechaInicio);
    fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
    
    const diferenciaMs = fechaExpiracion - fechaActual;
    const diasRestantes = Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));
    
    return diasRestantes;
}

// Función para calcular tiempo restante detallado (días, horas, minutos)
function calcularTiempoRestante(user) {
    if (!user.vip || !user.vip_since || !user.plan) {
        return { dias: 0, horas: 0, minutos: 0 };
    }

    const fechaInicio = new Date(user.vip_since);
    const fechaActual = new Date();
    
    let duracionDias;
    switch(user.plan.toLowerCase()) {
        case 'basico': duracionDias = 30; break;
        case 'premium': duracionDias = 60; break;
        case 'vip': duracionDias = 180; break;
        default: duracionDias = 30;
    }
    
    const fechaExpiracion = new Date(fechaInicio);
    fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
    
    const diferenciaMs = fechaExpiracion - fechaActual;
    
    if (diferenciaMs <= 0) {
        return { dias: 0, horas: 0, minutos: 0 };
    }
    
    const dias = Math.floor(diferenciaMs / (1000 * 60 * 60 * 24));
    const horas = Math.floor((diferenciaMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutos = Math.floor((diferenciaMs % (1000 * 60 * 60)) / (1000 * 60));
    
    return { dias, horas, minutos };
}

// Función para formatear fecha
function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== KEEP ALIVE ====================

function startBotKeepAlive() {
  const keepAliveInterval = 5 * 60 * 1000;
  
  setInterval(() => {
    console.log(`🤖 Bot activo y escuchando a las ${new Date().toLocaleTimeString()}`);
    
    try {
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

// ==================== COMANDO /START ====================

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    const firstName = ctx.from.first_name;
    
    const plansUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
    try {
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
                }
            ]);
            
            // Botón de broadcast siempre visible para admins
            keyboard.push([
                { 
                    text: '📢 ENVIAR MENSAJE A TODOS', 
                    web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
                }
            ]);
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

// ==================== MENÚ PRINCIPAL ====================

bot.action('main_menu', async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name;
    
    const plansUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
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

    if (isAdmin(userId)) {
        const adminUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/admin.html?userId=${userId}&admin=true`;
        
        keyboard.push([
            { 
                text: '🔧 PANEL ADMIN', 
                web_app: { url: adminUrl }
            }
        ]);
        
        keyboard.push([
            { 
                text: '📢 ENVIAR MENSAJE A TODOS', 
                web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
            }
        ]);
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

// ==================== BOTÓN "MI ESTADO" CON CUENTA REGRESIVA ====================

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
            const tiempoRestante = calcularTiempoRestante(user);
            const diasRestantes = calcularDiasRestantes(user);
            const planNombre = user.plan ? 
                (user.plan === 'basico' ? 'BÁSICO (1 mes)' : 
                 user.plan === 'premium' ? 'PREMIUM (2 meses)' : 
                 user.plan === 'vip' ? 'VIP (6 meses)' : user.plan) : 
                'No especificado';
            
            // Calcular fecha de expiración
            const fechaInicio = new Date(user.vip_since);
            let duracionDias;
            switch(user.plan.toLowerCase()) {
                case 'basico': duracionDias = 30; break;
                case 'premium': duracionDias = 60; break;
                case 'vip': duracionDias = 180; break;
                default: duracionDias = 30;
            }
            const fechaExpiracion = new Date(fechaInicio);
            fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
            const fechaExpiracionStr = fechaExpiracion.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            let mensajeEstado = `✅ *¡ERES USUARIO VIP!* 👑\n\n`;
            mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
            mensajeEstado += `📅 *Expira:* ${fechaExpiracionStr}\n`;
            mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
            mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
            
            mensajeEstado += `⏳ *CUENTA REGRESIVA:*\n`;
            
            if (diasRestantes > 0) {
                mensajeEstado += `• *Días:* ${tiempoRestante.dias}\n`;
                mensajeEstado += `• *Horas:* ${tiempoRestante.horas}\n`;
                mensajeEstado += `• *Minutos:* ${tiempoRestante.minutos}\n\n`;
                
                if (diasRestantes <= 7) {
                    mensajeEstado += `⚠️ *¡ATENCIÓN! TU PLAN EXPIRA PRONTO*\n`;
                    mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
                } else {
                    mensajeEstado += `✅ Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
                }
            } else {
                mensajeEstado += `❌ *TU PLAN HA EXPIRADO*\n`;
                mensajeEstado += `Renueva ahora para recuperar tu acceso VIP.\n\n`;
            }
            
            mensajeEstado += `*SELECCIONA UNA OPCIÓN:*`;
            
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
            
            if (isAdmin(userId)) {
                keyboard.push([
                    { 
                        text: '📢 ENVIAR A TODOS', 
                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
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
            
            const keyboard = [
                [
                    { 
                        text: '📋 VER PLANES', 
                        web_app: { url: webappUrl }
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
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            if (isAdmin(userId)) {
                keyboard.push([
                    { 
                        text: '📢 ENVIAR A TODOS', 
                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
                    }
                ]);
            }
            
            await ctx.editMessageText(
                `❌ *NO ERES USUARIO VIP*\n\n` +
                `Actualmente no tienes acceso a los servicios premium.\n\n` +
                `Haz clic en "📋 VER PLANES" para comprar tu plan VIP y disfrutar de:\n` +
                `✅ Baja latencia para gaming\n` +
                `✅ Navegación segura\n` +
                `✅ Ancho de banda ilimitado\n` +
                `✅ Soporte prioritario\n\n` +
                `*Selecciona una opción:*`,
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

// ==================== BOTÓN "VER PLANES" ====================

bot.action('view_plans_button', async (ctx) => {
    const userId = ctx.from.id.toString();
    const webappUrl = `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}`;
    
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
                text: '👑 MI ESTADO',
                callback_data: 'check_status'
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
    
    if (isAdmin(userId)) {
        keyboard.push([
            { 
                text: '📢 ENVIAR A TODOS', 
                web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
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

// ==================== CALLBACK QUERY HANDLER ====================

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();
    
    try {
        switch (data) {
            case 'view_detailed_plans':
                const keyboardDetailed = [
                    [
                        { 
                            text: '🚀 COMPRAR AHORA', 
                            web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/plans.html?userId=${userId}` }
                        }
                    ],
                    [
                        {
                            text: '👑 MI ESTADO',
                            callback_data: 'check_status'
                        },
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
                ];
                
                if (isAdmin(userId)) {
                    keyboardDetailed.push([
                        { 
                            text: '📢 ENVIAR A TODOS', 
                            web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
                        }
                    ]);
                }
                
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
                            inline_keyboard: keyboardDetailed
                        }
                    }
                );
                break;
                
            // Eliminamos el handler de broadcast antiguo ya que ahora usamos webapp
            case 'start_broadcast':
                if (!isAdmin(userId)) {
                    await ctx.answerCbQuery('❌ NO AUTORIZADO');
                    return;
                }
                
                // Redirigir a la webapp de broadcast
                await ctx.editMessageText(
                    `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES* 📤\n\n` +
                    `Usa el panel web para enviar mensajes a todos los usuarios.\n\n` +
                    `*SELECCIONA UNA OPCIÓN:*`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { 
                                        text: '📢 ABRIR PANEL DE BROADCAST', 
                                        web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
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

// ==================== COMANDO /HELP ====================

bot.command('help', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    const keyboard = [
        [
            {
                text: '📋 VER PLANES',
                callback_data: 'view_plans_button'
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
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    if (isAdmin(userId)) {
        keyboard.push([
            { 
                text: '📢 ENVIAR A TODOS', 
                web_app: { url: `${process.env.WEBAPP_URL || 'http://localhost:3000'}/broadcast.html?userId=${userId}&admin=true` }
            }
        ]);
    }
    
    await ctx.reply(
        `🆘 *VPN CUBA - AYUDA*\n\n` +
        `*BOTONES DISPONIBLES:*\n` +
        `📋 VER PLANES - Ver y comprar planes\n` +
        `👑 MI ESTADO - Ver tu estado VIP y días restantes\n` +
        `🆘 SOPORTE - Contactar con soporte técnico (@L0quen2)\n\n` +
        `*PARA ADMINS:*\n` +
        `🔧 PANEL ADMIN - Panel de administración\n` +
        `📢 ENVIAR A TODOS - Enviar mensaje a todos los usuarios\n\n` +
        `¡Todo está disponible en los botones! 🚀`,
        { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
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
        
        // Configurar comandos del bot
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Iniciar el bot y ver menú principal' },
            { command: 'help', description: 'Ayuda y información' },
            { command: 'status', description: 'Verificar estado VIP' }
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
    calcularTiempoRestante,
    formatearFecha
};
