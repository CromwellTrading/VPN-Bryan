const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
let bot = null; // Lo inicializaremos después
let db = null;

// Inicializar el bot
function initializeBot() {
    try {
        if (bot) {
            try {
                bot.stop();
                console.log('🤖 Bot detenido antes de reiniciar');
            } catch (e) {
                console.log('⚠️ Error deteniendo bot anterior:', e.message);
            }
        }
        
        bot = new Telegraf(process.env.BOT_TOKEN);
        db = require('./supabase');
        
        console.log('🤖 Bot inicializado');
        return true;
    } catch (error) {
        console.error('❌ Error inicializando bot:', error);
        return false;
    }
}

// Inicializar bot por primera vez
initializeBot();

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604'];

const USDT_CONFIG = {
    WALLET_ADDRESS: '0x9065C7d2cC04134A55F6Abf2B4118C11A8A01ff2',
    BSCSCAN_API_KEY: '',
    USDT_CONTRACT_ADDRESS: '0x55d398326f99059ff775485246999027b3197955',
    CHECK_INTERVAL: 0,
    MIN_CONFIRMATIONS: 3
};

const USDT_PRICES = {
    'basico': '1.6',
    'avanzado': '2.7',
    'premium': '2.5',
    'anual': '30'
};

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId.toString());
}

async function canSendMessageToUser(telegramId) {
    try {
        if (!bot) return { canSend: false, reason: 'Bot no inicializado' };
        await bot.telegram.sendChatAction(telegramId, 'typing');
        return { canSend: true, reason: 'Usuario disponible' };
    } catch (error) {
        console.log(`❌ Usuario ${telegramId} no disponible: ${error.description || error.message}`);
        return { 
            canSend: false, 
            reason: error.description || error.message,
            errorCode: error.response?.error_code || 400
        };
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { 
        fileSize: 20 * 1024 * 1024,
        files: 1 
    },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'screenshot') {
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            if (allowedTypes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error('Solo se permiten imágenes JPG, PNG, GIF o WebP'));
            }
        } else if (file.fieldname === 'configFile' || file.fieldname === 'trialConfigFile' || file.fieldname === 'planFile') {
            const allowedExtensions = ['.conf', '.zip', '.rar'];
            const allowedMimeTypes = [
                'application/zip', 
                'application/x-rar-compressed', 
                'application/x-zip-compressed',
                'application/octet-stream',
                'text/plain',
                'application/x-conf'
            ];
            const fileExt = path.extname(file.originalname).toLowerCase();
            const fileMime = file.mimetype.toLowerCase();
            
            if (allowedExtensions.includes(fileExt) || allowedMimeTypes.includes(fileMime)) {
                cb(null, true);
            } else {
                cb(new Error('Solo se permiten archivos .conf, .zip o .rar'));
            }
        } else {
            cb(null, true);
        }
    }
});

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });

function getPlanName(planType) {
    const plans = {
        'basico': 'Básico (1 mes)',
        'avanzado': 'Avanzado (2 meses)',
        'premium': 'Premium (1 mes)',
        'anual': 'Anual (12 meses)',
        'trial': 'Prueba Gratuita'
    };
    return plans[planType] || planType;
}

function generateUniqueUsdtAddress() {
    return USDT_CONFIG.WALLET_ADDRESS;
}

function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function crearMenuPrincipal(userId, firstName = 'usuario', esAdmin = false) {
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;
    
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
                text: '💻 DESCARGAR WIREGUARD',
                callback_data: 'download_wireguard'
            },
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '🤝 REFERIDOS',
                callback_data: 'referral_info'
            }
        ]
    ];

    if (esAdmin) {
        keyboard.push([
            { 
                text: '🔧 PANEL ADMIN', 
                web_app: { url: adminUrl }
            },
            {
                text: '🔄 REINICIAR BOT',
                callback_data: 'restart_bot'
            }
        ]);
    }

    return keyboard;
}

// ==================== FUNCIÓN PARA REINICIAR EL BOT ====================
async function restartBot(adminId = null) {
    try {
        console.log('🔄 Reiniciando bot...');
        
        if (adminId) {
            await bot.telegram.sendMessage(adminId, '🔄 *Reiniciando bot...*', { parse_mode: 'Markdown' });
        }
        
        // Detener el bot actual
        try {
            bot.stop();
            console.log('✅ Bot detenido');
        } catch (stopError) {
            console.log('⚠️ Error deteniendo bot:', stopError.message);
        }
        
        // Esperar un momento
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Reinicializar el bot
        const success = initializeBot();
        
        if (success) {
            // Configurar handlers y lanzar
            await setupBotHandlers();
            await bot.launch();
            console.log('✅ Bot reiniciado exitosamente');
            
            if (adminId) {
                await bot.telegram.sendMessage(adminId, '✅ *Bot reiniciado exitosamente*', { parse_mode: 'Markdown' });
            }
            
            return { success: true, message: 'Bot reiniciado exitosamente' };
        } else {
            throw new Error('Error al reinicializar bot');
        }
        
    } catch (error) {
        console.error('❌ Error reiniciando bot:', error);
        
        // Intentar reinicializar de nuevo
        try {
            const success = initializeBot();
            if (success) {
                await setupBotHandlers();
                await bot.launch();
                console.log('✅ Bot recuperado después de error');
                
                if (adminId) {
                    await bot.telegram.sendMessage(adminId, '⚠️ *Bot reiniciado con recuperación de error*', { parse_mode: 'Markdown' });
                }
                
                return { success: true, message: 'Bot recuperado después de error' };
            }
        } catch (retryError) {
            console.error('❌ Error crítico al recuperar bot:', retryError);
        }
        
        return { success: false, error: error.message };
    }
}

async function setupBotHandlers() {
    if (!bot) return;
    
    // Comando /start
    bot.start(async (ctx) => {
        const userId = ctx.from.id;
        const firstName = ctx.from.first_name;
        const esAdmin = isAdmin(userId);
        
        const startPayload = ctx.startPayload;
        let referrerId = null;
        let referrerUsername = null;
        
        if (startPayload && startPayload.startsWith('ref')) {
            referrerId = startPayload.replace('ref', '');
            console.log(`🔗 Usuario ${userId} referido por ${referrerId}`);
            
            try {
                const referrer = await db.getUser(referrerId);
                if (referrer) {
                    referrerUsername = referrer.username;
                    console.log(`✅ Referidor encontrado: ${referrer.first_name} (@${referrer.username})`);
                }
            } catch (error) {
                console.log('❌ Error obteniendo información del referidor:', error.message);
            }
        }
        
        try {
            const userData = {
                telegram_id: userId.toString(),
                username: ctx.from.username,
                first_name: firstName,
                last_name: ctx.from.last_name,
                created_at: new Date().toISOString(),
                is_active: true
            };
            
            if (referrerId) {
                userData.referrer_id = referrerId;
                userData.referrer_username = referrerUsername;
                
                try {
                    await db.createReferral(referrerId, userId.toString(), ctx.from.username, firstName);
                    console.log(`✅ Referido creado: ${referrerId} -> ${userId}`);
                } catch (refError) {
                    console.log('⚠️ Error creando referido, continuando...', refError.message);
                }
            }
            
            await db.saveUser(userId.toString(), userData);
        } catch (error) {
            console.error('❌ Error guardando usuario:', error);
        }
        
        const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
        
        let welcomeMessage = `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
            `Conéctate con la mejor latencia para gaming y navegación.\n\n`;
        
        if (referrerId) {
            welcomeMessage += `👥 *¡Te invitó un amigo!*\n` +
                `Obtendrás beneficios especiales por ser referido.\n\n`;
        }
        
        welcomeMessage += `${esAdmin ? '🔧 *Eres Administrador* - Tienes acceso a funciones especiales\n\n' : ''}` +
            `*Selecciona una opción:*`;
        
        await ctx.reply(
            welcomeMessage,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    });

    // Botón: Menú Principal
    bot.action('main_menu', async (ctx) => {
        const userId = ctx.from.id.toString();
        const firstName = ctx.from.first_name;
        const esAdmin = isAdmin(userId);
        
        const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
        
        try {
            await ctx.editMessageText(
                `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
                `Selecciona una opción:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } catch (error) {
            if (error.response && error.response.description && 
                error.response.description.includes('message is not modified')) {
                return;
            }
            throw error;
        }
    });

    // Botón: Descargar WireGuard
    bot.action('download_wireguard', async (ctx) => {
        const userId = ctx.from.id.toString();
        const esAdmin = isAdmin(userId);
        
        const keyboard = [
            [
                {
                    text: '💻 WINDOWS',
                    url: 'https://www.wireguard.com/install/'
                },
                {
                    text: '📱 ANDROID',
                    url: 'https://play.google.com/store/apps/details?id=com.wireguard.android'
                }
            ],
            [
                {
                    text: '🏠 MENÚ PRINCIPAL',
                    callback_data: 'main_menu'
                }
            ]
        ];
        
        try {
            await ctx.editMessageText(
                `💻 *DESCARGAR WIREGUARD* 📱\n\n` +
                `*Para Windows*\n` +
                `Aplicación Oficial de WireGuard para Windows:\n` +
                `Enlace: https://www.wireguard.com/install/\n\n` +
                `*Para Android*\n` +
                `Aplicación Oficial de WireGuard en Google Play Store:\n` +
                `Enlace: https://play.google.com/store/apps/details?id=com.wireguard.android\n\n` +
                `*Selecciona tu sistema operativo:*`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } catch (error) {
            if (error.response && error.response.description && 
                error.response.description.includes('message is not modified')) {
                return;
            }
            throw error;
        }
    });

    // Botón: Ver Planes
    bot.action('view_plans', async (ctx) => {
        const userId = ctx.from.id.toString();
        const esAdmin = isAdmin(userId);
        const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
        
        const keyboard = [
            [
                { 
                    text: '🚀 VER PLANES EN WEB', 
                    web_app: { url: webappUrl }
                }
            ],
            [
                {
                    text: '💻 DESCARGAR WIREGUARD',
                    callback_data: 'download_wireguard'
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
        
        try {
            await ctx.editMessageText(
                `📋 *NUESTROS PLANES* 🚀\n\n` +
                `*PRUEBA GRATIS (1 hora)*\n` +
                `💵 $0 CUP\n` +
                `🎁 ¡Prueba completamente gratis!\n\n` +
                `*BÁSICO (1 mes)*\n` +
                `💵 $800 CUP\n` +
                `💰 1.6 USDT\n\n` +
                `*AVANZADO (2 meses)*\n` +
                `💵 $1,300 CUP\n` +
                `💰 2.7 USDT\n` +
                `🎯 ¡Recomendado!\n\n` +
                `*PREMIUM (1 mes)*\n` +
                `💵 $1,200 CUP\n` +
                `💰 2.5 USDT\n` +
                `👑 Servidor privado\n\n` +
                `*ANUAL (12 meses)*\n` +
                `💵 $15,000 CUP\n` +
                `💰 30 USDT\n` +
                `🏆 ¡El mejor valor!\n\n` +
                `Selecciona una opción:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } catch (error) {
            if (error.response && error.response.description && 
                error.response.description.includes('message is not modified')) {
                return;
            }
            throw error;
        }
    });

    // Botón: Mi Estado
    bot.action('check_status', async (ctx) => {
        const userId = ctx.from.id.toString();
        const esAdmin = isAdmin(userId);
        
        try {
            const user = await db.getUser(userId);
            
            if (!user) {
                const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
                try {
                    await ctx.editMessageText(
                        `❌ *NO ESTÁS REGISTRADO*\n\n` +
                        `Usa el botón "📋 VER PLANES" para registrarte y comenzar.`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: keyboard
                            }
                        }
                    );
                } catch (editError) {
                    if (!editError.response || !editError.response.description || 
                        !editError.response.description.includes('message is not modified')) {
                        throw editError;
                    }
                }
                return;
            }
            
            if (user?.vip) {
                const vipSince = formatearFecha(user.vip_since);
                const diasRestantes = calcularDiasRestantes(user);
                const planNombre = user.plan ? getPlanName(user.plan) : 'No especificado';
                
                let mensajeEstado = `✅ *¡ERES USUARIO VIP!* 👑\n\n`;
                mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
                mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
                mensajeEstado += `⏳ *Días restantes:* ${diasRestantes} días\n`;
                mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
                
                if (user.referrer_id) {
                    const referralStats = await db.getReferralStats(userId);
                    if (referralStats.discount_percentage > 0) {
                        mensajeEstado += `👥 *Descuento por referidos:* ${referralStats.discount_percentage}%\n`;
                    }
                }
                
                if (diasRestantes <= 7) {
                    mensajeEstado += `⚠️ *TU PLAN ESTÁ POR EXPIRAR PRONTO*\n`;
                    mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
                } else {
                    mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
                }
                
                const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
                const keyboard = [
                    [
                        { 
                            text: '📋 VER PLANES',
                            web_app: { url: webappUrl }
                        },
                        {
                            text: '💻 DESCARGAR WIREGUARD',
                            callback_data: 'download_wireguard'
                        }
                    ],
                    [
                        {
                            text: '🆘 CONTACTAR SOPORTE', 
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
                
                try {
                    await ctx.editMessageText(
                        mensajeEstado,
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: keyboard
                            }
                        }
                    );
                } catch (error) {
                    if (error.response && error.response.description && 
                        error.response.description.includes('message is not modified')) {
                        return;
                    }
                    throw error;
                }
            } else if (user?.trial_requested) {
                let trialMessage = `🎁 *SOLICITASTE UNA PRUEBA GRATUITA*\n\n`;
                
                if (user.trial_received) {
                    const trialSentAt = formatearFecha(user.trial_sent_at);
                    trialMessage += `✅ *Prueba recibida:* ${trialSentAt}\n`;
                    trialMessage += `⏰ *Duración:* ${user.trial_plan_type || '1h'}\n`;
                    trialMessage += `📋 *Estado:* Completada\n\n`;
                    trialMessage += `Si quieres acceso ilimitado, adquiere uno de nuestros planes.`;
                } else {
                    trialMessage += `⏳ *Estado:* Pendiente de envío\n`;
                    trialMessage += `⏰ *Duración:* ${user.trial_plan_type || '1h'}\n`;
                    trialMessage += `📋 *Solicitada:* ${formatearFecha(user.trial_requested_at)}\n\n`;
                    trialMessage += `Recibirás la configuración por este chat en minutos.`;
                }
                
                const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
                const keyboard = [
                    [
                        { 
                            text: '📋 VER PLANES',
                            web_app: { url: webappUrl }
                        }
                    ],
                    [
                        {
                            text: '💻 DESCARGAR WIREGUARD',
                            callback_data: 'download_wireguard'
                        }
                    ],
                    [
                        {
                            text: '🆘 CONTACTAR SOPORTE', 
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
                
                try {
                    await ctx.editMessageText(
                        trialMessage,
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: keyboard
                            }
                        }
                    );
                } catch (error) {
                    if (error.response && error.response.description && 
                        error.response.description.includes('message is not modified')) {
                        return;
                    }
                    throw error;
                }
            } else {
                const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
                const keyboard = [
                    [
                        { 
                            text: '📋 VER PLANES', 
                            web_app: { url: webappUrl }
                        },
                        {
                            text: '💻 DESCARGAR WIREGUARD',
                            callback_data: 'download_wireguard'
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
                
                try {
                    await ctx.editMessageText(
                        `❌ *NO ERES USUARIO VIP*\n\n` +
                        `Actualmente no tienes acceso a los servicios premium.\n\n` +
                        `Haz clic en los botones para ver nuestros planes o descargar WireGuard:`,
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: keyboard
                            }
                        }
                    );
                } catch (error) {
                    if (error.response && error.response.description && 
                        error.response.description.includes('message is not modified')) {
                        return;
                    }
                    throw error;
                }
            }
        } catch (error) {
            console.error('❌ Error en check_status:', error);
            
            if (error.response && error.response.description && 
                error.response.description.includes('message is not modified')) {
                return;
            }
            
            const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
            try {
                await ctx.editMessageText(
                    `❌ Error al verificar tu estado.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    }
                );
            } catch (editError) {
                if (!editError.response || !editError.response.description || 
                    !editError.response.description.includes('message is not modified')) {
                    console.error('❌ Error al editar mensaje de error:', editError);
                }
            }
        }
    });

    // Botón: Reiniciar Bot (solo admin)
    bot.action('restart_bot', async (ctx) => {
        const userId = ctx.from.id.toString();
        
        if (!isAdmin(userId)) {
            await ctx.answerCbQuery('❌ Solo administradores pueden reiniciar el bot');
            return;
        }
        
        await ctx.answerCbQuery('🔄 Reiniciando bot...');
        
        try {
            // Enviar mensaje de confirmación
            await ctx.reply('🔄 *Iniciando reinicio del bot...*\n\nEl bot se reiniciará en 5 segundos.', { 
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.callbackQuery.message?.message_id 
            });
            
            // Esperar un momento y reiniciar
            setTimeout(async () => {
                await restartBot(userId);
            }, 2000);
            
        } catch (error) {
            console.error('❌ Error en restart_bot:', error);
            await ctx.reply('❌ Error al reiniciar el bot');
        }
    });

    // Comando /restart (solo admin)
    bot.command('restart', async (ctx) => {
        const userId = ctx.from.id.toString();
        
        if (!isAdmin(userId)) {
            return ctx.reply('❌ Solo administradores pueden usar este comando');
        }
        
        await ctx.reply('🔄 *Iniciando reinicio del bot...*\n\nEl bot se reiniciará en 5 segundos.', { 
            parse_mode: 'Markdown' 
        });
        
        // Esperar y reiniciar
        setTimeout(async () => {
            await restartBot(userId);
        }, 2000);
    });

    // Botón: Información de Referidos
    bot.action('referral_info', async (ctx) => {
        const userId = ctx.from.id.toString();
        const userName = ctx.from.first_name;
        
        const user = await db.getUser(userId);
        let referralStats = null;
        if (user) {
            referralStats = await db.getReferralStats(userId);
        }
        
        const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
        
        let message = `🤝 *SISTEMA DE REFERIDOS* 🚀\n\n`;
        message += `¡Comparte tu enlace y gana descuentos en tus próximas compras!\n\n`;
        message += `*Tu enlace único:*\n\`${referralLink}\`\n\n`;
        message += `*Cómo funciona:*\n`;
        message += `1. Comparte este enlace con amigos\n`;
        message += `2. Cuando alguien se registra con tu enlace, se convierte en tu referido\n`;
        message += `3. Por cada referido que pague un plan, obtienes un descuento:\n`;
        message += `   • Nivel 1 (referido directo): 20% de descuento\n`;
        message += `   • Nivel 2 (referido de tu referido): 10% de descuento\n\n`;
        
        if (referralStats) {
            message += `*Tus estadísticas:*\n`;
            message += `• Referidos directos (Nivel 1): ${referralStats.level1.total} (${referralStats.level1.paid} pagados)\n`;
            message += `• Referidos nivel 2: ${referralStats.level2.total} (${referralStats.level2.paid} pagados)\n`;
            message += `• Descuento total acumulado: ${referralStats.discount_percentage}%\n\n`;
        }
        
        message += `¡Cada vez que un referido pague, tu descuento aumentará! 🎉`;
        
        const keyboard = [
            [
                {
                    text: '📋 COPIAR ENLACE',
                    callback_data: 'copy_referral_link'
                }
            ],
            [
                {
                    text: '🏠 MENÚ PRINCIPAL',
                    callback_data: 'main_menu'
                }
            ]
        ];
        
        try {
            await ctx.editMessageText(
                message,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } catch (error) {
            if (error.response && error.response.description && 
                error.response.description.includes('message is not modified')) {
                return;
            }
            throw error;
        }
    });

    // Botón: Copiar enlace de referido
    bot.action('copy_referral_link', async (ctx) => {
        try {
            const userId = ctx.from.id.toString();
            const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
            
            await ctx.answerCbQuery('📋 Enlace listo para copiar');
            
            let replyToMessageId = null;
            if (ctx.callbackQuery && ctx.callbackQuery.message) {
                replyToMessageId = ctx.callbackQuery.message.message_id;
            }
            
            await ctx.reply(
                `📋 *Enlace de referido:*\n\n\`${referralLink}\`\n\n` +
                `Para copiar, mantén presionado el enlace y selecciona "Copiar".`,
                { 
                    parse_mode: 'Markdown',
                    reply_to_message_id: replyToMessageId
                }
            );
            
        } catch (error) {
            console.error('❌ Error en copy_referral_link:', error);
            
            try {
                await ctx.answerCbQuery('❌ Error, intenta nuevamente');
            } catch (e) {
            }
        }
    });

    // Comando /referidos
    bot.command('referidos', async (ctx) => {
        const userId = ctx.from.id.toString();
        const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
        
        const user = await db.getUser(userId);
        let referralStats = null;
        if (user) {
            referralStats = await db.getReferralStats(userId);
        }
        
        let message = `🤝 *TU ENLACE DE REFERIDOS*\n\n`;
        message += `\`${referralLink}\`\n\n`;
        message += `*Instrucciones:*\n`;
        message += `1. Comparte este enlace con amigos\n`;
        message += `2. Cuando se registren, serán tus referidos\n`;
        message += `3. Ganas descuentos cuando paguen\n\n`;
        
        if (referralStats) {
            message += `*Tus estadísticas:*\n`;
            message += `• Referidos totales: ${referralStats.total_referrals}\n`;
            message += `• Referidos que han pagado: ${referralStats.total_paid}\n`;
            message += `• Descuento actual: ${referralStats.discount_percentage}%\n`;
        }
        
        await ctx.reply(
            message,
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

    // Comando /admin solo para admins
    bot.command('admin', async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) {
            return ctx.reply('❌ Solo el administrador puede usar este comando.');
        }

        const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${ctx.from.id}&admin=true`;
        
        const keyboard = [
            [
                { 
                    text: '🔧 ABRIR PANEL WEB', 
                    web_app: { url: adminUrl }
                },
                {
                    text: '🔄 REINICIAR BOT',
                    callback_data: 'restart_bot'
                }
            ],
            [
                {
                    text: '💻 DESCARGAR WIREGUARD',
                    callback_data: 'download_wireguard'
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
        
        await ctx.reply(
            `🔧 *PANEL DE ADMINISTRACIÓN*\n\n` +
            `Selecciona una opción:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    });

    // Comando /help
    bot.command('help', async (ctx) => {
        const userId = ctx.from.id.toString();
        const esAdmin = isAdmin(userId);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
        
        await ctx.reply(
            `🆘 *AYUDA - VPN CUBA* 🚀\n\n` +
            `Usa los botones para navegar por todas las funciones.\n\n` +
            `*BOTONES DISPONIBLES:*\n` +
            `📋 VER PLANES - Ver y comprar planes\n` +
            `👑 MI ESTADO - Ver tu estado VIP y días restantes\n` +
            `💻 DESCARGAR WIREGUARD - Instrucciones de instalación\n` +
            `🤝 REFERIDOS - Obtener tu enlace de referidos\n` +
            `🆘 SOPORTE - Contactar con soporte técnico\n` +
            `${esAdmin ? '🔧 PANEL ADMIN - Panel de administración\n' : ''}` +
            `${esAdmin ? '🔄 REINICIAR BOT - Reiniciar el bot (admin)\n' : ''}` +
            `\n*COMANDOS DISPONIBLES:*\n` +
            `/start - Iniciar el bot\n` +
            `/referidos - Obtener tu enlace de referidos\n` +
            `/trialstatus - Ver estado de prueba gratuita\n` +
            `/help - Mostrar esta ayuda\n` +
            `${esAdmin ? '/admin - Panel de administración\n' : ''}` +
            `${esAdmin ? '/restart - Reiniciar el bot (admin)\n' : ''}` +
            `${esAdmin ? '/enviar - Enviar configuración (admin)\n' : ''}` +
            `\n¡Todo está disponible en los botones! 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    });

    // Comando /trialstatus
    bot.command('trialstatus', async (ctx) => {
        const userId = ctx.from.id.toString();
        
        try {
            const user = await db.getUser(userId);
            
            if (!user) {
                return ctx.reply('❌ No estás registrado. Usa /start para comenzar.');
            }
        
            if (!user.trial_requested) {
                return ctx.reply('🎯 *Estado de prueba:* No has solicitado prueba gratuita.\n\nUsa "🎁 PRUEBA GRATIS" en la web para solicitar.', { parse_mode: 'Markdown' });
            }
        
            if (user.trial_received) {
                const sentDate = user.trial_sent_at ? new Date(user.trial_sent_at).toLocaleDateString('es-ES') : 'No disponible';
                return ctx.reply(
                    `✅ *Prueba gratuita recibida*\n\n` +
                    `📅 Enviada: ${sentDate}\n` +
                    `⏰ Duración: ${user.trial_plan_type || '1h'}\n` +
                    `🎮 Juego/Servidor: ${user.trial_game_server || 'No especificado'}\n` +
                    `📡 Conexión: ${user.trial_connection_type || 'No especificado'}\n` +
                    `📋 Estado: Activada\n\n` +
                    `Busca el archivo en este chat. Si no lo encuentras, contacta a soporte.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                const requestedDate = user.trial_requested_at ? new Date(user.trial_requested_at).toLocaleDateString('es-ES') : 'No disponible';
                return ctx.reply(
                    `⏳ *Prueba gratuita pendiente*\n\n` +
                    `📅 Solicitada: ${requestedDate}\n` +
                    `⏰ Duración: ${user.trial_plan_type || '1h'}\n` +
                    `🎮 Juego/Servidor: ${user.trial_game_server || 'No especificado'}\n` +
                    `📡 Conexión: ${user.trial_connection_type || 'No especificado'}\n` +
                    `📋 Estado: En espera de envío\n\n` +
                    `Recibirás la configuración por este chat en breve.`,
                    { parse_mode: 'Markdown' }
                );
            }
        } catch (error) {
            console.error('❌ Error en trialstatus:', error);
            return ctx.reply('❌ Error al verificar estado de prueba.');
        }
    });

    // Comando /enviar para administrador
    bot.command('enviar', async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) {
            return ctx.reply('❌ Solo el administrador puede usar este comando.');
        }

        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            return ctx.reply('Uso: /enviar <ID de usuario>\nEjemplo: /enviar 123456789');
        }

        const telegramId = args[1];
        
        await ctx.reply(
            `📤 *ENVIAR CONFIGURACIÓN A USUARIO*\n\n` +
            `Usuario: ${telegramId}\n\n` +
            `Por favor, envía el archivo .conf, .zip o .rar ahora:`,
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '❌ CANCELAR', callback_data: 'main_menu' }
                        ]
                    ]
                }
            }
        );
        
        ctx.session = { waitingToSendTo: telegramId };
    });

    // Manejar archivos enviados por admin
    bot.on('document', async (ctx) => {
        const adminId = ctx.from.id.toString();
        
        if (!isAdmin(adminId)) return;
        
        if (ctx.session?.waitingToSendTo) {
            const telegramId = ctx.session.waitingToSendTo;
            const fileId = ctx.message.document.file_id;
            const fileName = ctx.message.document.file_name;

            try {
                const fileNameLower = fileName.toLowerCase();
                if (!fileNameLower.endsWith('.zip') && !fileNameLower.endsWith('.rar') && !fileNameLower.endsWith('.conf')) {
                    await ctx.reply('❌ El archivo debe tener extensión .conf, .zip o .rar');
                    return;
                }
                
                if (!telegramId || telegramId === 'undefined' || telegramId === 'null' || telegramId === '') {
                    await ctx.reply('❌ ID de usuario inválido');
                    return;
                }
                
                const chatId = telegramId.toString().trim();
                
                const canSend = await canSendMessageToUser(chatId);
                if (!canSend.canSend) {
                    await ctx.reply(`❌ No se puede enviar al usuario: ${canSend.reason}`);
                    return;
                }
                
                const payments = await db.getUserPayments(chatId);
                let paymentId = null;
                let approvedPayment = null;
                
                if (payments && payments.length > 0) {
                    approvedPayment = payments.find(p => p.status === 'approved' && !p.config_sent);
                    if (approvedPayment) {
                        paymentId = approvedPayment.id;
                    }
                }
                
                await bot.telegram.sendDocument(chatId, fileId, {
                    caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                            `📁 *Archivo:* ${fileName}\n\n` +
                            `*Instrucciones:*\n` +
                            `1. Descarga este archivo\n` +
                            `2. ${fileNameLower.endsWith('.conf') ? 'Importa el archivo .conf directamente' : 'Descomprime el ZIP/RAR'}\n` +
                            `3. Importa el archivo .conf en WireGuard\n` +
                            `4. Activa la conexión\n` +
                            `5. ¡Disfruta de baja latencia! 🚀\n\n` +
                            `*Soporte:* Contacta con @L0quen2 si tienes problemas.`,
                    parse_mode: 'Markdown'
                });

                if (paymentId) {
                    await db.updatePayment(paymentId, {
                        config_sent: true,
                        config_sent_at: new Date().toISOString(),
                        config_file: fileName,
                        config_sent_by: adminId
                    });
                    
                    const user = await db.getUser(chatId);
                    if (user && !user.vip && approvedPayment) {
                        await db.makeUserVIP(chatId, {
                            plan: approvedPayment.plan,
                            plan_price: approvedPayment.price,
                            vip_since: new Date().toISOString()
                        });
                    }
                }

                await ctx.reply(`✅ Archivo enviado al usuario ${chatId}`);
                
                await bot.telegram.sendMessage(
                    chatId,
                    '✅ *Configuración recibida*\n\n' +
                    'El administrador te ha enviado la configuración.\n' +
                    'Busca el archivo en este chat.\n' +
                    '¡Disfruta de baja latencia! 🚀',
                    { parse_mode: 'Markdown' }
                );
                
            } catch (error) {
                console.error('❌ Error enviando archivo:', error);
                await ctx.reply(`❌ Error enviando archivo: ${error.message}`);
            }

            delete ctx.session.waitingToSendTo;
        }
    });

    // Comando /status del bot (para admin)
    bot.command('botstatus', async (ctx) => {
        if (!isAdmin(ctx.from.id.toString())) {
            return ctx.reply('❌ Solo administradores pueden usar este comando');
        }
        
        try {
            const botInfo = await bot.telegram.getMe();
            const webhookInfo = await bot.telegram.getWebhookInfo();
            
            let statusMessage = `🤖 *ESTADO DEL BOT*\n\n`;
            statusMessage += `*Nombre:* ${botInfo.first_name}\n`;
            statusMessage += `*Username:* @${botInfo.username}\n`;
            statusMessage += `*ID:* ${botInfo.id}\n`;
            statusMessage += `*Webhook URL:* ${webhookInfo.url || 'No configurado'}\n`;
            statusMessage += `*Webhook pendiente:* ${webhookInfo.pending_update_count || 0}\n`;
            statusMessage += `*Fecha:* ${new Date().toLocaleString('es-ES')}\n\n`;
            statusMessage += `*Comandos disponibles:*\n`;
            statusMessage += `/start - Iniciar bot\n`;
            statusMessage += `/admin - Panel admin\n`;
            statusMessage += `/restart - Reiniciar bot\n`;
            statusMessage += `/botstatus - Ver este mensaje\n`;
            statusMessage += `/enviar - Enviar archivo\n`;
            
            await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
        } catch (error) {
            await ctx.reply(`❌ Error obteniendo estado: ${error.message}`);
        }
    });
}

// ==================== FUNCIONES AUXILIARES ====================

function calcularDiasRestantes(user) {
    if (!user.vip || !user.vip_since || !user.plan) {
        return 0;
    }

    const fechaInicio = new Date(user.vip_since);
    const fechaActual = new Date();
    
    let duracionDias;
    switch(user.plan.toLowerCase()) {
        case 'basico':
            duracionDias = 30;
            break;
        case 'avanzado':
            duracionDias = 60;
            break;
        case 'premium':
            duracionDias = 30;
            break;
        case 'anual':
            duracionDias = 365;
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

// ==================== RUTAS DE LA API ====================

const PORT = process.env.PORT || 3000;

// Ruta para reiniciar el bot desde la web (API)
app.post('/api/admin/restart-bot', async (req, res) => {
    try {
        const { adminId } = req.body;
        
        if (!isAdmin(adminId)) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        
        console.log(`🔄 Solicitud de reinicio desde admin ${adminId}`);
        
        // Enviar mensaje de confirmación al admin
        if (bot) {
            await bot.telegram.sendMessage(adminId, '🔄 *Reiniciando bot desde panel web...*', { parse_mode: 'Markdown' });
        }
        
        // Ejecutar reinicio en segundo plano
        setTimeout(async () => {
            await restartBot(adminId);
        }, 1000);
        
        res.json({ 
            success: true, 
            message: 'Reinicio del bot iniciado. Recibirás confirmación por Telegram.' 
        });
        
    } catch (error) {
        console.error('❌ Error en reinicio desde API:', error);
        res.status(500).json({ error: 'Error reiniciando el bot: ' + error.message });
    }
});

// Ruta para verificar estado del bot
app.get('/api/bot-status', async (req, res) => {
    try {
        if (!bot) {
            return res.json({ 
                status: 'stopped',
                message: 'Bot no inicializado',
                timestamp: new Date().toISOString()
            });
        }
        
        try {
            const botInfo = await bot.telegram.getMe();
            const webhookInfo = await bot.telegram.getWebhookInfo();
            
            res.json({
                status: 'running',
                botInfo: {
                    id: botInfo.id,
                    username: botInfo.username,
                    first_name: botInfo.first_name
                },
                webhookInfo: {
                    url: webhookInfo.url,
                    pending_updates: webhookInfo.pending_update_count,
                    last_error_date: webhookInfo.last_error_date,
                    last_error_message: webhookInfo.last_error_message
                },
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        } catch (botError) {
            res.json({
                status: 'error',
                message: botError.message,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        res.status(500).json({ 
            status: 'error',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// [Todas las demás rutas API permanecen igual...]
// (Mantén todas las rutas API existentes desde la línea 1 hasta el final del archivo original)

// Solo necesitas agregar las funciones y rutas nuevas arriba y asegurarte de que
// las rutas existentes se mantengan. El resto del código de rutas (aproximadamente
// 2000 líneas) debe permanecer igual.

// ==================== INICIALIZACIÓN ====================

async function initializeServer() {
    try {
        // Inicializar buckets
        console.log('📦 Inicializando buckets de almacenamiento...');
        const { createStorageBucket } = require('./supabase');
        const buckets = ['payments-screenshots', 'plan-files', 'trial-files'];
        
        for (const bucket of buckets) {
            try {
                const result = await createStorageBucket(bucket, true);
                if (result.success) {
                    console.log(`✅ Bucket ${bucket} listo`);
                } else {
                    console.log(`⚠️ Bucket ${bucket}: ${result.error}`);
                }
            } catch (error) {
                console.log(`⚠️ Error con bucket ${bucket}:`, error.message);
            }
        }
        
        // Inicializar bot
        console.log('🤖 Configurando handlers del bot...');
        await setupBotHandlers();
        
        // Lanzar bot
        await bot.launch();
        console.log('✅ Bot lanzado exitosamente');
        
        // Configurar comandos
        const commands = [
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'help', description: 'Mostrar ayuda' },
            { command: 'referidos', description: 'Obtener enlace de referidos' },
            { command: 'trialstatus', description: 'Ver estado de prueba gratuita' },
            { command: 'admin', description: 'Panel de administración (solo admins)' },
            { command: 'enviar', description: 'Enviar configuración (solo admins)' },
            { command: 'restart', description: 'Reiniciar el bot (solo admins)' },
            { command: 'botstatus', description: 'Ver estado del bot (solo admins)' }
        ];
        
        await bot.telegram.setMyCommands(commands);
        console.log('📝 Comandos del bot configurados');
        
        return true;
    } catch (error) {
        console.error('❌ Error inicializando servidor:', error);
        return false;
    }
}

// Iniciar servidor Express
app.listen(PORT, async () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🌐 Supabase URL: ${process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔑 Supabase Key: ${process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔐 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
    
    // Inicializar servidor
    const success = await initializeServer();
    
    if (success) {
        console.log('\n✅ Servidor completamente inicializado');
        console.log(`💰 Sistema USDT: MODO MANUAL`);
        console.log(`   • Dirección: ${USDT_CONFIG.WALLET_ADDRESS}`);
        console.log(`🔧 Funciones de admin mejoradas:`);
        console.log(`   • /restart - Reinicia el bot`);
        console.log(`   • Botón "🔄 REINICIAR BOT" en menú admin`);
        console.log(`   • Ruta API /api/admin/restart-bot`);
        console.log(`   • /botstatus - Ver estado del bot`);
        console.log(`🔄 Sistema de reinicio automático activo`);
    } else {
        console.log('❌ Error inicializando servidor');
    }
    
    // Iniciar keep-alive
    startKeepAlive();
});

// Función keep-alive
function startKeepAlive() {
    const keepAliveInterval = 5 * 60 * 1000;
    const healthCheckUrl = `http://localhost:${PORT}/api/health`;

    setInterval(async () => {
        try {
            const response = await fetch(healthCheckUrl);
            if (response.ok) {
                console.log(`✅ Keep-alive ping exitoso a las ${new Date().toLocaleTimeString()}`);
            }
        } catch (error) {
            console.error('❌ Error en keep-alive ping:', error.message);
            
            // Intentar reiniciar el bot si hay error
            if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
                console.log('⚠️ Servidor no responde, intentando recuperar...');
                setTimeout(() => {
                    initializeServer().then(success => {
                        if (success) {
                            console.log('✅ Servidor recuperado después de error');
                        }
                    });
                }, 10000);
            }
        }
    }, keepAliveInterval);

    console.log(`🔄 Keep-alive iniciado. Ping cada 5 minutos a ${healthCheckUrl}`);
}

// Manejar errores no capturados
process.on('uncaughtException', async (error) => {
    console.error('❌ Error no capturado:', error);
    
    try {
        console.log('🔄 Intentando reiniciar bot después de error no capturado...');
        await restartBot();
    } catch (restartError) {
        console.error('❌ No se pudo reiniciar el bot:', restartError);
    }
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

// Manejar cierre
process.on('SIGINT', () => {
    console.log('\n👋 Cerrando aplicación...');
    if (bot) {
        bot.stop();
    }
    process.exit(0);
});

// Exportar para pruebas
module.exports = {
    app,
    bot,
    isAdmin,
    ADMIN_IDS,
    restartBot,
    initializeBot
};
