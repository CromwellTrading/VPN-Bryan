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
const bot = new Telegraf(process.env.BOT_TOKEN);
const db = require('./supabase');

// Métodos stub para trial_files — funcionan sin la tabla en BD todavía.
// Cuando el usuario cree la tabla en Supabase, estos se pueden mover a supabase.js.
if (!db.getTrialFiles) {
  db.getTrialFiles = async () => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
      const { data, error } = await sb.from('trial_files').select('*').order('uploaded_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch(e) { console.warn('⚠️ trial_files tabla no existe aún:', e.message); return []; }
  };
}

if (!db.getTrialFile) {
  db.getTrialFile = async (id) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
      const { data, error } = await sb.from('trial_files').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    } catch(e) { return null; }
  };
}

if (!db.saveTrialFile) {
  db.saveTrialFile = async (fileData) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
      const { data, error } = await sb.from('trial_files').insert([fileData]).select().single();
      if (error) throw error;
      return data;
    } catch(e) { console.warn('⚠️ saveTrialFile falló (tabla puede no existir):', e.message); return fileData; }
  };
}

if (!db.updateTrialFile) {
  db.updateTrialFile = async (id, updateData) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
      const { data, error } = await sb.from('trial_files').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    } catch(e) { return null; }
  };
}

if (!db.deleteTrialFile) {
  db.deleteTrialFile = async (id) => {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
      const { error } = await sb.from('trial_files').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch(e) { return false; }
  };
}

const PORT = process.env.PORT || 3000;

// Cliente Supabase Admin para crear buckets (usando service_role)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// IDs de administradores
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604', '6974850309', '5985313284'];

// ==================== CONFIGURACIÓN USDT (MANUAL) ====================
const USDT_CONFIG = {
    WALLET_ADDRESS: '0x55B81bD7df1b0c6Db33fD532207CF2Bf137C1519',
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

// Verificar si es administrador
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId.toString());
}

// Función para verificar si un usuario puede recibir mensajes
async function canSendMessageToUser(telegramId) {
    try {
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

// ==================== MAPA DE ICONOS PERSONALIZADOS ====================
const BUTTON_ICONS = {
    'VER PLANES': '5983399041197675256',
    'MI PERFIL': '6021659919835469581',
    'DESCARGAR WIREGUARD': '5899757765743615694',
    'SOPORTE': '6019320644422867543',
    'REFERIDOS': '5944970130554359187',
    'CÓMO FUNCIONA': '5873121512445187130',
    'VPN CANAL': '5771695636411847302',
    'POLÍTICAS': '6021738534916854774',
    'WHATSAPP': '5884179047482659474',
    'FAQ': '5879501875341955281',
    'PANEL ADMIN': '5839116473951328489',
    'WINDOWS': '5933679370202778681',
    'ANDROID': '5931415565955503486',
    'IOS': '5931415565955503486',
    'CEO': '6021659919835469581',
    'ADMIN': '5839116473951328489',
    'MOD': '6021401276904905698',
    'COPIAR ENLACE': '5877465816030515018',
    'VER GUÍA COMPLETA': '6028435952299413210',
    'TÉRMINOS DE SERVICIO': '6021744990252702234',
    'POLÍTICA DE REEMBOLSO': '6021435576513730578',
    'POLÍTICA DE PRIVACIDAD': '6021745995275048956',
    'VER PREGUNTAS FRECUENTES': '5873121512445187130'
};

function createButton(text, options) {
    const button = { text };
    const iconId = BUTTON_ICONS[text.toUpperCase()];
    if (iconId) {
        button.icon_custom_emoji_id = iconId;
    }
    Object.assign(button, options);
    return button;
}

function getVipStatusHtml(user) {
    const vipSince = formatearFecha(user.vip_since);
    const diasRestantes = calcularDiasRestantes(user);
    const planNombre = user.plan ? getPlanName(user.plan) : 'No especificado';
    
    let html = `<tg-emoji emoji-id="6019175208240289774">👑</tg-emoji> <b>¡ERES USUARIO VIP!</b>\n\n`;
    html += `<tg-emoji emoji-id="6023880246128810031">📅</tg-emoji> <b>Activado:</b> ${vipSince}\n`;
    html += `<tg-emoji emoji-id="6021435576513730578">📋</tg-emoji> <b>Plan:</b> ${planNombre}\n`;
    html += `<tg-emoji emoji-id="5778202206922608769">⏳</tg-emoji> <b>Días restantes:</b> ${diasRestantes} días\n`;
    html += `<tg-emoji emoji-id="5992430854909989581">💰</tg-emoji> <b>Precio:</b> $${user.plan_price || '0'} CUP\n\n`;
    
    if (diasRestantes <= 7) {
        html += `<tg-emoji emoji-id="6019102674832595118">⚠️</tg-emoji> <b>TU PLAN ESTÁ POR EXPIRAR PRONTO</b>\nRenueva ahora para mantener tu acceso VIP.\n\n`;
    } else {
        html += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
    }
    return html;
}

function getDownloadWireguardHtml() {
    return `<tg-emoji emoji-id="6019168392127190964">💻</tg-emoji> <b>DESCARGAR WIREGUARD</b> <tg-emoji emoji-id="6019099814384378473">📱</tg-emoji>\n\n` +
           `<b>Para Windows</b>\nAplicación Oficial de WireGuard para Windows:\nEnlace: https://www.wireguard.com/install/\n\n` +
           `<b>Para Android</b>\nAplicación Oficial de WireGuard en Google Play Store:\nEnlace: https://play.google.com/store/apps/details?id=com.wireguard.android\n\n` +
           `<b>Para iOS (iPhone / iPad)</b>\nAplicación Oficial de WireGuard en App Store:\nEnlace: https://apps.apple.com/app/id1441195209\n\n` +
           `Selecciona tu sistema operativo:`;
}

function getSupportHtml() {
    return `<tg-emoji emoji-id="5886412370347036129">🆘</tg-emoji> <b>SOPORTE TÉCNICO</b>\n\n` +
           `Para cualquier duda o problema, contacta con nuestro soporte:\n\n` +
           `<tg-emoji emoji-id="5807453545548487345">👉</tg-emoji> @L0quen2 (CEO)\n` +
           `<tg-emoji emoji-id="5807453545548487345">👉</tg-emoji> @ErenJeager129182 (Admin)\n` +
           `<tg-emoji emoji-id="5807453545548487345">👉</tg-emoji> @rov3r777 (Mod)\n\n` +
           `Responde rápido y te ayudaremos.`;
}

function getReferralInfoHtml(userId, referralStats) {
    const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
    let html = `<tg-emoji emoji-id="5258362837411045098">🤝</tg-emoji> <b>SISTEMA DE REFERIDOS</b> <tg-emoji emoji-id="5877410604225924969">🚀</tg-emoji>\n\n` +
               `¡Comparte tu enlace y gana descuentos en tus próximas compras!\n\n` +
               `<b>Tu enlace único:</b>\n<code>${referralLink}</code>\n\n` +
               `<b>Cómo funciona:</b>\n` +
               `1. Comparte este enlace con amigos\n` +
               `2. Cuando alguien se registra con tu enlace, se convierte en tu referido\n` +
               `3. Por cada referido que pague un plan, obtienes un descuento:\n` +
               `   • Nivel 1 (referido directo): 20% de descuento\n` +
               `   • Nivel 2 (referido de tu referido): 10% de descuento\n\n`;
    
    if (referralStats) {
        html += `<b>Tus estadísticas:</b>\n` +
                `• Referidos directos (Nivel 1): ${referralStats.level1?.total || 0} (${referralStats.level1?.paid || 0} pagados)\n` +
                `• Referidos nivel 2: ${referralStats.level2?.total || 0} (${referralStats.level2?.paid || 0} pagados)\n` +
                `• Descuento total acumulado: ${referralStats.discount_percentage || 0}%\n\n`;
    } else {
        html += `<b>Tus estadísticas:</b>\n• Aún no tienes referidos. ¡Comparte tu enlace y empieza a ganar!\n\n`;
    }
    html += `¡Cada vez que un referido pague, tu descuento aumentará! <tg-emoji emoji-id="6021793768196282527">🎉</tg-emoji>`;
    return html;
}

function getHowItWorksHtml() {
    return `<tg-emoji emoji-id="5873121512445187130">🚀</tg-emoji> <b>¿CÓMO FUNCIONA VPN CUBA?</b>\n\n` +
           `Descubre cómo optimizamos tu conexión para gaming y navegación.\n\n` +
           `Haz clic en el botón para ver la guía completa en nuestra Web App:`;
}

function getPoliticasHtml() {
    return `<tg-emoji emoji-id="5956561916573782596">📜</tg-emoji> <b>Políticas de VPN Cuba</b>\n\n` +
           `Selecciona una sección para ver los detalles completos en nuestra Web App:`;
}

function getFaqHtml() {
    return `<tg-emoji emoji-id="5873121512445187130">❓</tg-emoji> <b>PREGUNTAS FRECUENTES (FAQ)</b>\n\n` +
           `Encuentra respuestas a las dudas más comunes sobre nuestros servicios, pagos, instalación y más.\n\n` +
           `Haz clic en el botón para abrir la sección de preguntas frecuentes:`;
}

function buildMainMenuKeyboard(userId, firstName, esAdmin) {
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;

    const inlineKeyboard = [
        [
            createButton("VER PLANES", { web_app: { url: plansUrl } }),
            createButton("MI PERFIL", { callback_data: "check_status" })
        ],
        [
            createButton("DESCARGAR WIREGUARD", { callback_data: "download_wireguard" }),
            createButton("SOPORTE", { callback_data: "show_support" })
        ],
        [
            createButton("REFERIDOS", { callback_data: "referral_info" }),
            createButton("CÓMO FUNCIONA", { callback_data: "how_it_works" })
        ],
        [
            createButton("VPN CANAL", { url: "https://t.me/vpncubaw" }),
            createButton("POLÍTICAS", { callback_data: "politicas" })
        ],
        [
            createButton("WHATSAPP G1", { url: "https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9" }),
            createButton("WHATSAPP G2", { url: "https://chat.whatsapp.com/Lf3oMMKSHhY4pX5d2bE4TJ" })
        ],
        [
            createButton("FAQ", { callback_data: "faq" })
        ]
    ];

    if (esAdmin) {
        inlineKeyboard.push([
            createButton("PANEL ADMIN", { web_app: { url: adminUrl } })
        ]);
    }

    return {
        reply_markup: {
            inline_keyboard: inlineKeyboard
        }
    };
}

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
const TRIAL_FILES_DIR = path.join(__dirname, 'uploads/trial_files');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(TRIAL_FILES_DIR)) fs.mkdirSync(TRIAL_FILES_DIR, { recursive: true });
if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });

// Ruta fija para el archivo de prueba actual (sin depender de BD)
const TRIAL_CURRENT_FILE = path.join(TRIAL_FILES_DIR, 'trial_current');

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
    if (!fecha) return 'N/A';
    try {
        const date = new Date(fecha);
        if (isNaN(date.getTime())) {
            return 'Fecha inválida';
        }
        const options = { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'America/Havana'
        };
        return date.toLocaleDateString('es-ES', options);
    } catch (error) {
        return 'Error fecha';
    }
}

function calcularDiasRestantes(user) {
    if (!user.vip || !user.vip_since || !user.plan) return 0;
    const fechaInicio = new Date(user.vip_since);
    const fechaActual = new Date();
    let duracionDias;
    switch(user.plan.toLowerCase()) {
        case 'basico': duracionDias = 30; break;
        case 'avanzado': duracionDias = 60; break;
        case 'premium': duracionDias = 30; break;
        case 'anual': duracionDias = 365; break;
        default: duracionDias = 30;
    }
    const fechaExpiracion = new Date(fechaInicio);
    fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
    const diferenciaMs = fechaExpiracion - fechaActual;
    return Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));
}

async function checkUsdtTransactions() {
    console.log('⚠️ Verificación automática USDT desactivada');
    return { success: true, message: 'Flujo manual' };
}

async function initializeUsdtSystem() {
    console.log('💸 Sistema USDT en modo MANUAL');
}

async function createStorageBucket(bucketName, isPublic = true) {
  try {
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();
    if (listError) {
      console.error('❌ Error listando buckets:', listError.message);
      return { success: false, error: listError.message };
    }
    const bucketExists = buckets?.some(b => b.name === bucketName);
    if (bucketExists) {
      console.log(`✅ Bucket ${bucketName} ya existe`);
      return { success: true, exists: true };
    }
    const { data, error } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: isPublic,
      allowedMimeTypes: null,
      fileSizeLimit: 20971520,
      avifAutodetection: false
    });
    if (error) {
      console.error(`❌ Error creando bucket ${bucketName}:`, error.message);
      return await createBucketViaAPI(bucketName, isPublic);
    }
    console.log(`✅ Bucket ${bucketName} creado exitosamente`);
    return { success: true, data };
  } catch (error) {
    console.error(`❌ Error en createStorageBucket:`, error.message);
    return { success: false, error: error.message };
  }
}

async function createBucketViaAPI(bucketName, isPublic = true) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify({
        name: bucketName,
        public: isPublic,
        allowed_mime_types: null,
        file_size_limit: 20971520
      })
    });
    if (response.ok) {
      console.log(`✅ Bucket ${bucketName} creado via API REST`);
      return { success: true };
    } else {
      const errorText = await response.text();
      console.error(`❌ Error API REST para ${bucketName}:`, errorText);
      return { success: false, error: errorText };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyStorageBuckets() {
  try {
    const buckets = ['payments-screenshots', 'plan-files', 'trial-files'];
    for (const bucketName of buckets) {
      try {
        const { data, error } = await supabaseAdmin.storage.from(bucketName).list();
        if (error && error.message.includes('not found')) {
          console.log(`📦 Creando bucket ${bucketName}...`);
          await createStorageBucket(bucketName, true);
        } else if (error) {
          console.error(`⚠️ Error verificando ${bucketName}:`, error.message);
        } else {
          console.log(`✅ Bucket ${bucketName} existe`);
        }
      } catch (bucketError) {
        console.error(`⚠️ Error procesando ${bucketName}:`, bucketError.message);
      }
    }
  } catch (error) {
    console.error('❌ Error en verifyStorageBuckets:', error.message);
  }
}

async function initializeStorageBuckets() {
  console.log('🚀 Inicializando buckets...');
  const buckets = [
    { name: 'payments-screenshots', public: true },
    { name: 'plan-files', public: true },
    { name: 'trial-files', public: true }
  ];
  for (const bucket of buckets) {
    await createStorageBucket(bucket.name, bucket.public);
  }
  console.log('✅ Inicialización de buckets completada');
}

// ==================== FUNCIÓN ENVIAR PRUEBA (USANDO POOL DE ARCHIVOS) ====================
// Índice rotativo para distribuir archivos de prueba entre los disponibles
let trialFileRoundRobinIndex = 0;

async function sendTrialConfigToUser(telegramId, adminId, deleteAfterSend = true) {
  try {
    const user = await db.getUser(telegramId);
    if (!user) throw new Error(`Usuario ${telegramId} no encontrado`);

    const gameServer = user.trial_game_server || 'No especificado';
    const connectionType = user.trial_connection_type || 'No especificado';

    let filePath = null;
    let fileName = null;
    let fileId = null;

    // 1. Intentar obtener archivos de prueba activos
    try {
      const trialFiles = await db.getTrialFiles();
      const activeFiles = (trialFiles || []).filter(f => f.is_active !== false && f.local_path && fs.existsSync(f.local_path));

      if (activeFiles.length > 0) {
        // Tomar el primero disponible (y luego eliminarlo si deleteAfterSend es true)
        const chosen = activeFiles[0];
        filePath = chosen.local_path;
        fileName = chosen.original_name || path.basename(chosen.local_path);
        fileId = chosen.id;
        console.log(`📁 Usando archivo de prueba BD #${chosen.id}: ${fileName}`);
      }
    } catch (dbErr) {
      console.warn('⚠️ No se pudieron obtener archivos de prueba de BD:', dbErr.message);
    }

    // 2. Fallback: archivo local fijo
    if (!filePath) {
      const extensions = ['.conf', '.zip', '.rar'];
      for (const ext of extensions) {
        const testPath = TRIAL_CURRENT_FILE + ext;
        if (fs.existsSync(testPath)) {
          filePath = testPath;
          fileName = path.basename(testPath);
          break;
        }
      }
    }

    if (!filePath) {
      throw new Error('No hay archivo de prueba disponible. Sube uno en el panel de admin.');
    }

    // Envío con reintentos
    const MAX_RETRIES = 3;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await bot.telegram.sendDocument(
          telegramId,
          { source: filePath, filename: fileName },
          {
            caption: `<tg-emoji emoji-id="5875465628285931233">🎁</tg-emoji> <b>¡Tu prueba gratuita de VPN Cuba está lista!</b>\n\n` +
                     `<tg-emoji emoji-id="6021375494216226506">📁</tg-emoji> <b>Archivo:</b> ${fileName}\n\n` +
                     `<tg-emoji emoji-id="6021744990252702234">🎮</tg-emoji> <b>Juego/Servidor:</b> ${gameServer}\n` +
                     `<tg-emoji emoji-id="6021744990252702234">📡</tg-emoji> <b>Conexión:</b> ${connectionType}\n\n` +
                     `<b>Instrucciones de instalación:</b>\n` +
                     `1. Descarga este archivo\n` +
                     `2. Importa el archivo .conf en tu cliente WireGuard\n` +
                     `3. Activa la conexión\n` +
                     `4. ¡Disfruta de 1 hora de prueba gratis! <tg-emoji emoji-id="4978747001718966118">🎉</tg-emoji>\n\n` +
                     `<tg-emoji emoji-id="5778202206922608769">⏰</tg-emoji> <b>Duración:</b> 1 hora\n` +
                     `<b>Importante:</b> Esta configuración expirará en 1 hora.`,
            parse_mode: 'HTML'
          }
        );
        await db.markTrialAsSent(telegramId, adminId);
        console.log(`✅ Prueba enviada a ${telegramId}: ${fileName} (intento ${attempt})`);

        // Eliminar el archivo del pool si se usó uno de BD y deleteAfterSend es true
        if (deleteAfterSend && fileId) {
          const fileToDelete = await db.getTrialFile(fileId);
          if (fileToDelete && fileToDelete.local_path && fs.existsSync(fileToDelete.local_path)) {
            fs.unlinkSync(fileToDelete.local_path);
            console.log(`🗑️ Archivo de prueba eliminado del sistema: ${fileToDelete.local_path}`);
          }
          await db.deleteTrialFile(fileId);
          console.log(`🗑️ Registro de archivo de prueba ${fileId} eliminado de la BD`);
        }
        return true;
      } catch (sendError) {
        lastError = sendError;
        const errorMsg = sendError.description || sendError.message || '';
        console.warn(`⚠️ Intento ${attempt}/${MAX_RETRIES} fallido para ${telegramId}: ${errorMsg}`);
        if (errorMsg.includes('chat not found') || errorMsg.includes('bot was blocked') ||
            errorMsg.includes('user is deactivated') || errorMsg.includes('kicked') ||
            sendError.response?.error_code === 403 || sendError.response?.error_code === 400) {
          break;
        }
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 1500));
      }
    }
    throw lastError || new Error('Error desconocido al enviar prueba');
  } catch (error) {
    console.error(`❌ Error en sendTrialConfigToUser para ${telegramId}:`, error.message);
    throw error;
  }
}

async function sendTrialToValidUsers(adminId) {
  try {
    console.log('🎯 Enviando pruebas a usuarios pendientes...');
    const pendingTrials = await db.getPendingTrials();
    if (!pendingTrials || pendingTrials.length === 0) {
      console.log('📭 No hay pruebas pendientes');
      return { success: true, message: 'No hay pruebas pendientes' };
    }

    let sentCount = 0, failedCount = 0, unavailableCount = 0;
    // Obtener todos los archivos activos disponibles
    let availableFiles = await db.getTrialFiles();
    availableFiles = availableFiles.filter(f => f.is_active !== false && f.local_path && fs.existsSync(f.local_path));

    for (let i = 0; i < pendingTrials.length; i++) {
      const user = pendingTrials[i];
      try {
        if (!user.telegram_id) { failedCount++; continue; }

        // Si no hay más archivos disponibles, salir del bucle
        if (availableFiles.length === 0) {
          console.log(`⚠️ No quedan archivos de prueba para el usuario ${user.telegram_id}`);
          failedCount++;
          continue;
        }

        // Tomar el primer archivo de la lista (se eliminará después de enviar)
        const chosenFile = availableFiles.shift();
        // Enviar la prueba indicando que se debe eliminar el archivo después
        await sendTrialConfigToUser(user.telegram_id, adminId, true);
        sentCount++;
        await new Promise(resolve => setTimeout(resolve, 80));
      } catch (error) {
        failedCount++;
        const errMsg = error.description || error.message || '';
        const isPermanent = errMsg.includes('chat not found') || errMsg.includes('blocked') ||
                            errMsg.includes('user is deactivated') || errMsg.includes('kicked');
        if (isPermanent) {
          unavailableCount++;
          try {
            await db.updateUser(user.telegram_id, { is_active: false, last_error: errMsg, updated_at: new Date().toISOString() });
          } catch (e) { /* no crítico */ }
        }
        console.error(`❌ Error procesando prueba para ${user.telegram_id}:`, errMsg);
      }
    }

    console.log(`✅ Envío de pruebas completado: ${sentCount} enviadas, ${failedCount} fallidas, ${unavailableCount} no disponibles`);
    return { success: true, sent: sentCount, failed: failedCount, unavailable: unavailableCount, total: pendingTrials.length };
  } catch (error) {
    console.error('❌ Error en sendTrialToValidUsers:', error);
    return { success: false, error: error.message };
  }
}

// ==================== HELPER: OBTENER USUARIOS BROADCAST CON PAGINACIÓN ====================
async function getAllUsersForBroadcast(target) {
  try {
    if (target !== 'all' && target !== 'active') {
      const users = await db.getUsersForBroadcast(target);
      console.log(`📢 Broadcast target "${target}": ${users.length} usuarios`);
      return users;
    }

    console.log(`📢 Broadcast target "${target}": obteniendo TODOS con paginación...`);
    const allUsers = await db.getAllUsers(1000000, 0); // para broadcast puede necesitar muchos
    // pero es mejor usar getUsersForBroadcast que ya filtra. Mantenemos original.
    let filtered = allUsers;
    if (target === 'active') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filtered = allUsers.filter(u => 
        u.last_activity && new Date(u.last_activity) >= thirtyDaysAgo
      );
    }

    console.log(`📢 Broadcast target "${target}": ${filtered.length} usuarios (de ${allUsers.length} totales)`);
    return filtered;
  } catch (err) {
    console.error('❌ Error en getAllUsersForBroadcast:', err.message);
    return await db.getUsersForBroadcast(target) || [];
  }
}

// ==================== RUTAS API ====================

app.get('/api/check-admin/:telegramId', (req, res) => {
  const isAdminUser = isAdmin(req.params.telegramId);
  res.json({ isAdmin: isAdminUser });
});

app.post('/api/accept-terms', async (req, res) => {
  try {
    const { telegramId, username, firstName, referrerId, referrerUsername } = req.body;
    
    const userData = {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      accepted_terms: true,
      terms_date: new Date().toISOString(),
      is_active: true
    };

    if (referrerId) {
      userData.referrer_id = referrerId;
      userData.referrer_username = referrerUsername;
      try {
        await db.createReferral(referrerId, telegramId, username, firstName);
        console.log(`✅ Referido creado: ${referrerId} -> ${telegramId}`);
      } catch (refError) {
        console.log('⚠️ Error creando referido, continuando...', refError.message);
      }
    }

    const user = await db.saveUser(telegramId, userData);
    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ Error aceptando términos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/check-terms/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    res.json({ 
      accepted: user?.accepted_terms || false,
      user: user
    });
  } catch (error) {
    console.error('❌ Error verificando términos:', error);
    res.json({ accepted: false });
  }
});

app.post('/api/payment', upload.single('screenshot'), async (req, res) => {
  try {
    console.log('📥 Pago recibido:', {
      telegramId: req.body.telegramId,
      plan: req.body.plan,
      price: req.body.price,
      method: req.body.method,
      couponCode: req.body.couponCode
    });
    
    const { telegramId, plan, price, notes, method, couponCode } = req.body;
    
    if (!telegramId || !plan || !price) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Captura de pantalla requerida para todos los métodos de pago' });
    }

    let screenshotUrl = '';
    if (req.file) {
      try {
        screenshotUrl = await db.uploadImage(req.file.path, telegramId);
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('❌ Error eliminando archivo local:', err);
        });
      } catch (uploadError) {
        screenshotUrl = `/uploads/${req.file.filename}`;
      }
    }

    const user = await db.getUser(telegramId);
    const username = user?.username ? `@${user.username}` : 'Sin usuario';
    const firstName = user?.first_name || 'Usuario';

    let couponUsed = false;
    let couponDiscount = 0;
    let finalPrice = parseFloat(price);
    let appliedCoupon = null;
    let referralDiscountApplied = 0;
    
    if (couponCode && couponCode.trim() !== '') {
      try {
        console.log(`🎫 Verificando cupón: ${couponCode.toUpperCase()}`);
        const coupon = await db.getCoupon(couponCode.toUpperCase());
        
        if (coupon) {
          console.log(`🔍 Cupón encontrado: ${JSON.stringify(coupon, null, 2)}`);
          
          if (coupon.status !== 'active') {
            console.log(`⚠️ Cupón no activo: ${couponCode}, estado: ${coupon.status}`);
          } 
          else if (coupon.expiry && new Date(coupon.expiry) < new Date()) {
            console.log(`⚠️ Cupón expirado: ${couponCode}, expiry: ${coupon.expiry}`);
            await db.updateCouponStatus(couponCode.toUpperCase(), 'expired', 'system');
          } 
          else if (coupon.stock <= 0) {
            console.log(`⚠️ Cupón agotado: ${couponCode}, stock: ${coupon.stock}`);
          } 
          else if (await db.hasUserUsedCoupon(telegramId, couponCode.toUpperCase())) {
            console.log(`⚠️ Usuario ya usó este cupón: ${couponCode}`);
          } 
          else {
            couponUsed = true;
            couponDiscount = coupon.discount;
            appliedCoupon = coupon;
            finalPrice = finalPrice * (1 - couponDiscount / 100);
            console.log(`✅ Cupón aplicado: ${couponCode} - ${couponDiscount}% de descuento`);
            console.log(`💰 Precio original: ${price}, Precio final: ${finalPrice.toFixed(2)}`);
          }
        } else {
          console.log(`⚠️ Cupón no encontrado: ${couponCode}`);
        }
      } catch (couponError) {
        console.log('⚠️ Error verificando cupón:', couponError.message);
      }
    }

    if (!couponUsed) {
      try {
        const refStats = await db.getReferralStats(telegramId);
        if (refStats && refStats.discount_percentage > 0) {
          referralDiscountApplied = Math.min(refStats.discount_percentage, 100);
          finalPrice = finalPrice * (1 - referralDiscountApplied / 100);
          console.log(`👥 Descuento de referidos aplicado: ${referralDiscountApplied}% — Precio: ${price} → ${finalPrice.toFixed(2)}`);
        }
      } catch (refErr) {
        console.log('⚠️ No se pudo verificar descuento de referidos:', refErr.message);
      }
    }

    const payment = await db.createPayment({
      telegram_id: telegramId,
      plan: plan,
      price: finalPrice,
      original_price: parseFloat(price),
      method: method || 'transfer',
      screenshot_url: screenshotUrl,
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString(),
      coupon_used: couponUsed,
      coupon_code: couponUsed ? couponCode?.toUpperCase() : null,
      coupon_discount: couponDiscount
    });

    if (!payment) {
      throw new Error('No se pudo crear el pago en la base de datos');
    }

    console.log(`✅ Pago creado con ID: ${payment.id}, telegram_id: ${telegramId}, cupón: ${couponUsed ? 'Sí' : 'No'}`);

    try {
      const methodNames = {
        'transfer': 'BPA',
        'metropolitan': 'Metropolitana',
        'mitransfer': 'MITRANSFER',
        'mobile': 'Saldo Móvil',
        'usdt': 'USDT (BEP20)'
      };
      
      let adminMessage = `💰 *NUEVO PAGO RECIBIDO - ${method === 'usdt' ? 'USDT' : 'CUP'}*\n\n` +
        `👤 *Usuario:* ${firstName}\n` +
        `📱 *Telegram:* ${username}\n` +
        `🆔 *ID:* ${telegramId}\n` +
        `📋 *Plan:* ${getPlanName(plan)}\n` +
        `💰 *Monto original:* ${price} ${method === 'usdt' ? 'USDT' : 'CUP'}\n`;
        
      if (couponUsed) {
        adminMessage += `🎫 *Cupón:* ${couponCode} (${couponDiscount}% descuento)\n` +
          `💰 *Monto final:* ${finalPrice.toFixed(2)} ${method === 'usdt' ? 'USDT' : 'CUP'}\n`;
      } else if (referralDiscountApplied > 0) {
        adminMessage += `👥 *Descuento referidos:* ${referralDiscountApplied}%\n` +
          `💰 *Monto final:* ${finalPrice.toFixed(2)} ${method === 'usdt' ? 'USDT' : 'CUP'}\n`;
      }
      
      adminMessage += `💳 *Método:* ${methodNames[method] || method}\n` +
        `⏰ *Fecha:* ${new Date().toLocaleString('es-ES')}\n` +
        `📝 *Estado:* ⏳ Pendiente de revisión manual\n` +
        `📸 *Captura:* Requerida ✅\n` +
        `📁 *Archivo:* Envío manual requerido`;
      
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
        } catch (adminError) {
          console.log(`❌ No se pudo notificar al admin ${adminId}`);
        }
      }
    } catch (adminError) {
      console.log('❌ Error al notificar a los admins:', adminError.message);
    }

    if (method === 'usdt') {
      try {
        const usdtAddress = USDT_CONFIG.WALLET_ADDRESS;
        const usdtAmount = USDT_PRICES[plan] || '1.6';
        
        await bot.telegram.sendMessage(
          telegramId,
          `💸 *PAGO USDT RECIBIDO - REVISIÓN MANUAL*\n\n` +
          `📋 *Plan:* ${getPlanName(plan)}\n` +
          `💰 *Monto exacto:* ${usdtAmount} USDT\n` +
          `🏦 *Dirección:* \`${usdtAddress}\`\n` +
          `🌐 *Red:* BEP20 (Binance Smart Chain)\n` +
          `📸 *Captura enviada:* Sí\n` +
          `${couponUsed ? `🎫 *Cupón aplicado:* ${couponCode} (${couponDiscount}% descuento)\n` : ''}` +
          `\n*Instrucciones importantes:*\n` +
          `1. El administrador revisará manualmente tu captura\n` +
          `2. Una vez aprobado, recibirás la confirmación\n` +
          `3. El administrador te enviará el archivo manualmente\n\n` +
          `*Verificar en BSCScan:* https://bscscan.com/address/${usdtAddress}\n\n` +
          `*Nota:* Sistema de detección automática desactivado.`,
          { parse_mode: 'Markdown' }
        );
        
        await db.updatePayment(payment.id, {
          notes: 'Pago USDT pendiente - Revisión manual con captura'
        });
        
      } catch (usdtError) {
        console.log('❌ Error enviando información USDT:', usdtError.message);
      }
    }

    res.json({ 
      success: true, 
      message: method === 'usdt' ? 
        'Pago USDT recibido con captura. El administrador revisará manualmente.' : 
        'Pago recibido. El administrador revisará la captura y te notificará.',
      payment,
      couponApplied: couponUsed,
      discount: couponDiscount,
      finalPrice: finalPrice
    });
  } catch (error) {
    console.error('❌ Error procesando pago:', error);
    
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error procesando pago: ' + error.message });
  }
});

app.get('/api/payments/pending', async (req, res) => {
  try {
    const payments = await db.getPendingPayments();

    if (!payments || payments.length === 0) {
      return res.json([]);
    }

    const uniqueIds = [...new Set(payments.map(p => p.telegram_id).filter(Boolean))];
    const userResults = await Promise.allSettled(uniqueIds.map(id => db.getUser(id)));
    const userMap = {};
    uniqueIds.forEach((id, i) => {
      if (userResults[i].status === 'fulfilled') userMap[id] = userResults[i].value;
    });

    const paymentsWithUsers = payments.map(payment => ({
      ...payment,
      user: userMap[payment.telegram_id] || null
    }));
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pagos pendientes:', error);
    res.status(500).json({ error: 'Error obteniendo pagos pendientes' });
  }
});

app.get('/api/payments/approved', async (req, res) => {
  try {
    const payments = await db.getApprovedPayments();
    
    if (!payments || payments.length === 0) {
      return res.json([]);
    }

    const uniqueIds = [...new Set(payments.map(p => p.telegram_id).filter(Boolean))];
    const userResults = await Promise.allSettled(uniqueIds.map(id => db.getUser(id)));
    
    const userMap = {};
    uniqueIds.forEach((id, i) => {
      if (userResults[i].status === 'fulfilled') {
        userMap[id] = userResults[i].value;
      }
    });

    const paymentsWithUsers = payments.map(payment => ({
      ...payment,
      user: userMap[payment.telegram_id] || null
    }));
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pagos aprobados:', error);
    res.status(500).json({ error: 'Error obteniendo pagos aprobados' });
  }
});

app.post('/api/payments/:id/approve', async (req, res) => {
  try {
    const payment = await db.approvePayment(req.params.id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    console.log(`✅ Pago aprobado: ${payment.id}, telegram_id: ${payment.telegram_id}`);

    if (!payment.telegram_id) {
      console.error(`❌ Pago ${payment.id} no tiene telegram_id`);
      return res.status(400).json({ error: 'El pago no tiene un usuario asociado (telegram_id)' });
    }

    if (payment.coupon_used && payment.coupon_code) {
      try {
        console.log(`🎫 Aplicando cupón ${payment.coupon_code} al pago ${payment.id}`);
        const coupon = await db.getCoupon(payment.coupon_code);
        
        if (coupon && coupon.stock > 0) {
          const applied = await db.applyCouponToPayment(payment.coupon_code, payment.telegram_id, payment.id);
          
          if (applied) {
            const newStock = coupon.stock - 1;
            await db.updateCoupon(payment.coupon_code, {
              stock: newStock,
              used: (coupon.used || 0) + 1,
              updated_at: new Date().toISOString(),
              updated_by: payment.config_sent_by || 'system'
            });
            
            console.log(`✅ Cupón ${payment.coupon_code} aplicado. Stock actualizado: ${newStock}`);
          }
        } else {
          console.log(`⚠️ Cupón ${payment.coupon_code} no disponible o sin stock`);
        }
      } catch (couponError) {
        console.error('❌ Error aplicando cupón:', couponError.message);
      }
    }

    try {
      let userMessage = '<tg-emoji emoji-id="6019175208240289774">🎉</tg-emoji> <b>¡Tu pago ha sido aprobado!</b>\n\n' +
        'Ahora eres usuario VIP de VPN Cuba.\n' +
        'El administrador te enviará manualmente el archivo de configuración por este mismo chat en breve.\n\n';
      
      if (payment.coupon_used && payment.coupon_discount) {
        userMessage += `<tg-emoji emoji-id="6021793768196282527">🎫</tg-emoji> <b>Cupón aplicado:</b> ${payment.coupon_code} (${payment.coupon_discount}% descuento)\n`;
      }
      
      userMessage += '<b>Nota:</b> Sistema de envío automático desactivado.';
      
      await bot.telegram.sendMessage(
        payment.telegram_id,
        userMessage,
        { parse_mode: 'HTML' }
      );
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    const user = await db.getUser(payment.telegram_id);
    if (!user.vip) {
      await db.makeUserVIP(payment.telegram_id, {
        plan: payment.plan,
        plan_price: payment.price,
        vip_since: new Date().toISOString()
      });
    }

    if (user.referrer_id) {
      try {
        await db.markReferralAsPaid(payment.telegram_id);
        console.log(`✅ Referido nivel 1 marcado como pagado: ${payment.telegram_id} -> referidor: ${user.referrer_id}`);

        try {
          const referrerUser = await db.getUser(user.referrer_id);
          if (referrerUser && referrerUser.referrer_id) {
            await db.markReferralAsPaid(user.referrer_id, 2);
            console.log(`✅ Referido nivel 2 marcado como pagado: ${user.referrer_id} -> referidor nivel2: ${referrerUser.referrer_id}`);
          }
        } catch (level2Err) {
          console.log('⚠️ Error actualizando referido nivel 2 (no crítico):', level2Err.message);
        }
      } catch (refError) {
        console.error('❌ Error marcando referido como pagado:', refError.message);
      }
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error aprobando pago:', error);
    res.status(500).json({ error: 'Error aprobando pago' });
  }
});

app.post('/api/payments/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Se requiere un motivo de rechazo' });
    }

    const payment = await db.rejectPayment(req.params.id, reason);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    if (!payment.telegram_id) {
      console.error(`❌ Pago ${payment.id} no tiene telegram_id`);
      return res.status(400).json({ error: 'El pago no tiene un usuario asociado (telegram_id)' });
    }

    try {
      await bot.telegram.sendMessage(
        payment.telegram_id,
        `❌ *Tu pago ha sido rechazado*\n\nMotivo: ${reason}\n\nPor favor, contacta con soporte si necesitas más información.`,
        { parse_mode: 'Markdown' }
      );
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error rechazando pago:', error);
    res.status(500).json({ error: 'Error rechazando pago' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();

    try {
      const broadcasts = await db.getBroadcasts();
      stats.broadcasts = {
        total: broadcasts.length,
        completed: broadcasts.filter(b => b.status === 'completed').length,
        pending:   broadcasts.filter(b => b.status === 'pending').length,
        sending:   broadcasts.filter(b => b.status === 'sending').length,
        failed:    broadcasts.filter(b => b.status === 'failed').length
      };
    } catch(e) {
      stats.broadcasts = stats.broadcasts || { total: 0, completed: 0 };
    }

    stats.usdt = {
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      verification_enabled: false,
      mode: 'manual'
    };

    if (!stats.referrals) {
      try {
        const refStats = await db.getAllReferralsStats();
        stats.referrals = {
          total: refStats.total_referrals || 0,
          paid:  refStats.paid_referrals  || 0,
          level1: refStats.level1_referrals || 0,
          level2: refStats.level2_referrals || 0
        };
      } catch(e) {
        stats.referrals = { total: 0, paid: 0, level1: 0, level2: 0 };
      }
    }

    if (!stats.coupons) {
      try { stats.coupons = await db.getCouponsStats(); } catch(e) { stats.coupons = { total:0, active:0, expired:0, used:0 }; }
    }

    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      error: 'Error obteniendo estadísticas',
      users: { total: 0, vip: 0, trial_requests: 0, trial_pending: 0, active: 0, inactive: 0 },
      payments: { pending: 0, approved: 0 },
      revenue: { total: 0 },
      broadcasts: { total: 0, completed: 0 },
      coupons: { total: 0, active: 0, expired: 0, used: 0 },
      referrals: { total: 0, paid: 0, level1: 0, level2: 0 }
    });
  }
});

app.get('/api/vip-users', async (req, res) => {
  try {
    const users = await db.getVIPUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios VIP:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios VIP' });
  }
});

// Endpoint paginado para usuarios
app.get('/api/all-users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200); // máximo 200 por página
    const offset = (page - 1) * limit;
    
    const users = await db.getAllUsers(limit, offset);
    const total = await db.getTotalUsersCount();
    
    console.log(`✅ /api/all-users: página ${page}, ${users.length} usuarios (total ${total})`);
    
    res.json({
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios: ' + error.message });
  }
});

app.get('/api/payments/:id', async (req, res) => {
  try {
    const payment = await db.getPayment(req.params.id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    const user = await db.getUser(payment.telegram_id);
    res.json({ ...payment, user: user || null });
  } catch (error) {
    console.error('❌ Error obteniendo pago:', error);
    res.status(500).json({ error: 'Error obteniendo pago' });
  }
});

app.post('/api/send-config', upload.single('configFile'), async (req, res) => {
  try {
    const { paymentId, adminId } = req.body;
    
    console.log('📤 Recibiendo solicitud de envío de configuración:', { paymentId, adminId });
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!paymentId) {
      return res.status(400).json({ error: 'ID de pago requerido' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar') && !fileName.endsWith('.conf')) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .conf, .zip o .rar' });
    }
    
    const payment = await db.getPayment(paymentId);
    
    if (!payment) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      console.error(`❌ Pago no encontrado: ${paymentId}`);
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    console.log('📄 Pago encontrado:', {
      id: payment.id,
      telegram_id: payment.telegram_id,
      status: payment.status,
      plan: payment.plan,
      coupon_used: payment.coupon_used,
      coupon_code: payment.coupon_code
    });
    
    if (payment.status !== 'approved') {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      console.error(`❌ Pago no está aprobado, estado: ${payment.status}`);
      return res.status(400).json({ error: 'El pago no está aprobado' });
    }
    
    const telegramId = payment.telegram_id;
    
    console.log(`🔍 Telegram ID del pago: ${telegramId}, tipo: ${typeof telegramId}`);
    
    if (!telegramId || telegramId === 'undefined' || telegramId === 'null' || telegramId === '') {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      console.error('❌ El pago no tiene un telegram_id válido:', telegramId);
      return res.status(400).json({ 
        error: 'El pago no tiene un usuario asociado (telegram_id). Por favor, verifica la base de datos.' 
      });
    }
    
    const chatId = telegramId.toString().trim();
    console.log(`📤 Chat ID para envío: ${chatId}`);
    
    const user = await db.getUser(chatId);
    if (!user) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      console.error(`❌ Usuario ${chatId} no encontrado en la base de datos`);
      return res.status(400).json({ 
        error: `El usuario ${chatId} no está registrado en el sistema.` 
      });
    }
    
    console.log(`✅ Usuario encontrado: ${user.first_name || user.username || chatId}`);
    
    try {
      console.log(`📤 Intentando enviar archivo a ${chatId}...`);
      
      const MAX_RETRIES = 3;
      let lastTelegramError = null;
      let sent = false;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          await bot.telegram.sendDocument(
            chatId,
            { source: req.file.path, filename: req.file.originalname },
            {
              caption: `<tg-emoji emoji-id="5875465628285931233">🎉</tg-emoji> <b>¡Tu configuración VPN Cuba está lista!</b>\n\n` +
                       `<tg-emoji emoji-id="6021375494216226506">📁</tg-emoji> <b>Archivo:</b> ${req.file.originalname}\n` +
                       `<tg-emoji emoji-id="6021744990252702234">📋</tg-emoji> <b>Plan:</b> ${getPlanName(payment.plan)}\n` +
                       `${payment.coupon_used ? `<tg-emoji emoji-id="6021793768196282527">🎫</tg-emoji> <b>Cupón aplicado:</b> ${payment.coupon_code} (${payment.coupon_discount}% descuento)\n` : ''}` +
                       `\n<b>Instrucciones de instalación:</b>\n` +
                       `1. Descarga este archivo\n` +
                       `2. ${fileName.endsWith('.conf') ? 'Importa el archivo .conf directamente' : 'Descomprime el ZIP/RAR en tu dispositivo'}\n` +
                       `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                       `4. Activa la conexión\n` +
                       `5. ¡Disfruta de baja latencia! <tg-emoji emoji-id="4978747001718966118">🚀</tg-emoji>\n\n` +
                       `<b>Soporte:</b> Contacta con soporte si tienes problemas.`,
              parse_mode: 'HTML'
            }
          );
          sent = true;
          break;
        } catch (retryErr) {
          lastTelegramError = retryErr;
          const errMsg = retryErr.description || retryErr.message || '';
          console.warn(`⚠️ Intento ${attempt}/${MAX_RETRIES} fallido al enviar config a ${chatId}: ${errMsg}`);
          if (
            errMsg.includes('chat not found') || errMsg.includes('chat not exist') ||
            errMsg.includes('bot was blocked') || errMsg.includes('user is deactivated') ||
            errMsg.includes('kicked') ||
            retryErr.response?.error_code === 403 || retryErr.response?.error_code === 400
          ) {
            break;
          }
          if (attempt < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, attempt * 1500));
          }
        }
      }

      if (!sent) {
        throw lastTelegramError || new Error('No se pudo enviar el archivo tras varios intentos');
      }
      
      await db.updatePayment(paymentId, {
        config_sent: true,
        config_sent_at: new Date().toISOString(),
        config_file: req.file.filename,
        config_sent_by: adminId
      });
      
      if (user && !user.vip) {
        await db.makeUserVIP(chatId, {
          plan: payment.plan,
          plan_price: payment.price,
          vip_since: new Date().toISOString()
        });
        console.log(`✅ Usuario ${chatId} marcado como VIP`);
      }
      
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo después de enviar:', err);
      });
      
      console.log(`✅ Configuración enviada al usuario ${chatId}`);
      
      res.json({ 
        success: true, 
        message: 'Configuración enviada manualmente',
        filename: req.file.filename,
        telegramId: chatId
      });
      
    } catch (telegramError) {
      console.error('❌ Error enviando archivo por Telegram:', telegramError.message);
      console.error('❌ Stack trace:', telegramError.stack);
      
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      
      if (telegramError.message.includes('chat_id') || telegramError.message.includes('chat id') || 
          telegramError.message.includes('chat not found') || telegramError.message.includes('chat not exist')) {
        console.error(`❌ Error específico de chat_id para usuario ${chatId}:`, telegramError.message);
        
        try {
          await db.updateUser(chatId, {
            is_active: false,
            last_error: telegramError.message,
            updated_at: new Date().toISOString()
          });
        } catch (updateError) {
          console.error(`⚠️ Error actualizando usuario ${chatId}:`, updateError.message);
        }
        
        return res.status(400).json({ 
          error: `Error: El usuario ${chatId} no ha iniciado el bot o lo ha bloqueado. Chat_id inválido.` 
        });
      }
      
      res.status(500).json({ error: 'Error enviando archivo por Telegram: ' + telegramError.message });
    }
    
  } catch (error) {
    console.error('❌ Error en send-config:', error);
    console.error('❌ Stack trace:', error.stack);
    
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/user-info/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const admin = isAdmin(req.params.telegramId);

    let referralStats = null;
    try {
      referralStats = await db.getReferralStats(req.params.telegramId);
    } catch (e) {
      console.warn('⚠️ No se pudieron obtener stats de referidos:', e.message);
    }

    const discountPct = referralStats ? Math.min(referralStats.discount_percentage || 0, 100) : 0;
    
    res.json({
      ...user,
      isAdmin: admin,
      referral_stats: referralStats,
      referral_discount: discountPct
    });
  } catch (error) {
    console.error('❌ Error obteniendo información del usuario:', error);
    res.status(500).json({ error: 'Error obteniendo información del usuario' });
  }
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { telegramId, message, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!telegramId || telegramId === 'undefined' || telegramId === 'null' || telegramId === '') {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const chatId = telegramId.toString().trim();
    const canSend = await canSendMessageToUser(chatId);
    if (!canSend.canSend) {
      return res.status(400).json({ 
        error: `No se puede enviar mensaje al usuario: ${canSend.reason}` 
      });
    }
    
    await bot.telegram.sendMessage(chatId, `📨 *Mensaje del Administrador:*\n\n${message}`, { 
      parse_mode: 'Markdown' 
    });
    
    res.json({ success: true, message: 'Mensaje enviado' });
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error enviando mensaje: ' + error.message });
  }
});

app.post('/api/user/:userId/remove-vip', async (req, res) => {
  try {
    const { adminId } = req.body;
    const userId = req.params.userId;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const user = await db.removeVIP(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    try {
      const canSend = await canSendMessageToUser(userId);
      if (canSend.canSend) {
        await bot.telegram.sendMessage(
          userId,
          '⚠️ *Tu acceso VIP ha sido removido*\n\n' +
          'Tu suscripción VIP ha sido cancelada.\n' +
          'Si crees que es un error, contacta con soporte.',
          { parse_mode: 'Markdown' }
        );
      } else {
        console.log(`⚠️ No se pudo notificar al usuario ${userId}: ${canSend.reason}`);
      }
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }
    
    res.json({ success: true, message: 'VIP removido', user });
  } catch (error) {
    console.error('❌ Error removiendo VIP:', error);
    res.status(500).json({ error: 'Error removiendo VIP' });
  }
});

app.get('/api/check-trial-eligibility/:telegramId', async (req, res) => {
  try {
    const eligibility = await db.checkTrialEligibility(req.params.telegramId);
    res.json(eligibility);
  } catch (error) {
    console.error('❌ Error verificando elegibilidad:', error);
    res.json({ eligible: true, reason: 'Error verificando' });
  }
});

// ==================== SOLICITUD DE PRUEBA CON ENVÍO AUTOMÁTICO ====================
app.post('/api/request-trial', async (req, res) => {
  try {
    const { telegramId, username, firstName, trialType = '1h', gameServer, connectionType } = req.body;
    
    // 1. Verificar elegibilidad (una vez al mes)
    const eligibility = await db.checkTrialEligibility(telegramId);
    
    if (!eligibility.eligible) {
      return res.status(400).json({ 
        error: `No puedes solicitar una prueba en este momento: ${eligibility.reason}` 
      });
    }
    
    // 2. Guardar la solicitud en la base de datos (trial_requested = true, pero aún no enviada)
    const updatedUser = await db.saveUser(telegramId, {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      trial_requested: true,
      trial_requested_at: new Date().toISOString(),
      trial_plan_type: trialType,
      trial_game_server: gameServer || '',
      trial_connection_type: connectionType || '',
      is_active: true
    });
    
    // 3. Notificar a los administradores (opcional, pero útil)
    const adminMessage = `🎯 *NUEVA SOLICITUD DE PRUEBA ${trialType.toUpperCase()}* (ENVÍO AUTOMÁTICO)\n\n` +
      `👤 *Usuario:* ${firstName}\n` +
      `📱 *Telegram:* ${username ? `@${username}` : 'Sin usuario'}\n` +
      `🆔 *ID:* ${telegramId}\n` +
      `🎮 *Juego/Servidor:* ${gameServer || 'No especificado'}\n` +
      `📡 *Conexión:* ${connectionType || 'No especificado'}\n` +
      `⏰ *Duración:* 1 hora\n` +
      `📅 *Fecha:* ${new Date().toLocaleString('es-ES')}`;
    
    for (const adminId of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
      } catch (adminError) {
        console.log(`❌ No se pudo notificar al admin ${adminId}:`, adminError.message);
      }
    }
    
    // 4. --- ENVÍO AUTOMÁTICO DE LA CONFIGURACIÓN ---
    let sentSuccessfully = false;
    let sendError = null;
    
    try {
      // Verificar si el usuario puede recibir mensajes (opcional, pero evita errores)
      const canSend = await canSendMessageToUser(telegramId);
      if (!canSend.canSend) {
        throw new Error(`Usuario no disponible: ${canSend.reason}`);
      }
      
      // Usar adminId = 'system' para indicar envío automático
      await sendTrialConfigToUser(telegramId, 'system');
      sentSuccessfully = true;
      console.log(`✅ Prueba enviada automáticamente a ${telegramId}`);
    } catch (error) {
      sendError = error;
      console.error(`❌ Error en envío automático a ${telegramId}:`, error.message);
      // No marcamos como recibido, queda pendiente para reintento manual
    }
    
    // 5. Responder al usuario según el resultado del envío
    if (sentSuccessfully) {
      // Envío exitoso: ya se marcó trial_received = true dentro de sendTrialConfigToUser
      await bot.telegram.sendMessage(
        telegramId,
        `<tg-emoji emoji-id="5875465628285931233">🎉</tg-emoji> <b>¡Tu prueba gratuita ya está aquí!</b>\n\n` +
        `Acabo de enviarte el archivo de configuración.\n` +
        `Revísalo en este mismo chat y actívalo en WireGuard.\n\n` +
        `<tg-emoji emoji-id="5778202206922608769">⏰</tg-emoji> <b>Duración:</b> 1 hora\n` +
        `¡Disfruta de baja latencia! <tg-emoji emoji-id="4978747001718966118">🚀</tg-emoji>`,
        { parse_mode: 'HTML' }
      );
      
      res.json({ 
        success: true, 
        message: 'Prueba gratuita enviada automáticamente. Revisa tu chat.',
        trialType: trialType,
        user: updatedUser,
        autoSent: true
      });
    } else {
      // Falló el envío automático: la solicitud queda pendiente (trial_received = false)
      // Notificar al usuario que será manual
      await bot.telegram.sendMessage(
        telegramId,
        `<tg-emoji emoji-id="6019175208240289774">✅</tg-emoji> <b>Solicitud de prueba recibida</b>\n\n` +
        'Tu solicitud ha sido registrada. En breve un administrador revisará y te enviará la configuración.\n\n' +
        `<tg-emoji emoji-id="5807879906951960923">⏰</tg-emoji> <b>Tiempo estimado:</b> Minutos\n\n` +
        '¡Gracias por probar VPN Cuba!',
        { parse_mode: 'HTML' }
      );
      
      res.json({ 
        success: true, 
        message: 'Solicitud registrada. Recibirás la configuración manualmente en breve.',
        trialType: trialType,
        user: updatedUser,
        autoSent: false,
        error: sendError?.message
      });
    }
    
  } catch (error) {
    console.error('❌ Error en solicitud de prueba:', error);
    res.status(500).json({ error: 'Error procesando solicitud de prueba: ' + error.message });
  }
});

app.get('/api/trial-stats', async (req, res) => {
  try {
    const stats = await db.getTrialStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de prueba:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de prueba' });
  }
});

app.get('/api/trials/pending', async (req, res) => {
  try {
    const trials = await db.getPendingTrials();
    
    const trialsWithUsers = await Promise.all(trials.map(async (user) => {
      return {
        ...user,
        trial_info: {
          requested_at: user.trial_requested_at,
          plan_type: user.trial_plan_type || '1h',
          game_server: user.trial_game_server || '',
          connection_type: user.trial_connection_type || '',
          days_ago: user.trial_requested_at ? 
            Math.floor((new Date() - new Date(user.trial_requested_at)) / (1000 * 60 * 60 * 24)) : 0
        }
      };
    }));
    
    res.json(trialsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pruebas pendientes:', error);
    res.status(500).json({ error: 'Error obteniendo pruebas pendientes' });
  }
});

app.post('/api/trials/:telegramId/mark-sent', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const user = await db.markTrialAsSent(req.params.telegramId, adminId);
    
    try {
      const canSend = await canSendMessageToUser(req.params.telegramId);
      if (canSend.canSend) {
        await bot.telegram.sendMessage(
          req.params.telegramId,
          '<tg-emoji emoji-id="5875465628285931233">🎉</tg-emoji> <b>¡Tu prueba gratuita está lista!</b>\n\n' +
          'Has recibido la configuración de prueba de 1 hora.\n' +
          '¡Disfruta de baja latencia! <tg-emoji emoji-id="4978747001718966118">🚀</tg-emoji>\n\n' +
          '<tg-emoji emoji-id="5778202206922608769">⏰</tg-emoji> <b>Nota:</b> Esta prueba expirará en 1 hora.',
          { parse_mode: 'HTML' }
        );
      } else {
        console.log(`⚠️ No se pudo notificar al usuario ${req.params.telegramId}: ${canSend.reason}`);
      }
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Prueba marcada como enviada',
      user 
    });
  } catch (error) {
    console.error('❌ Error marcando prueba como enviada:', error);
    res.status(500).json({ error: 'Error marcando prueba como enviada' });
  }
});

app.post('/api/trials/:telegramId/cancel', async (req, res) => {
  try {
    const { adminId } = req.body;
    const telegramId = req.params.telegramId;

    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const user = await db.getUser(telegramId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const updated = await db.updateUser(telegramId, {
      trial_requested: false,
      trial_requested_at: null,
      trial_game_server: null,
      trial_connection_type: null,
      trial_plan_type: null
    });

    console.log(`🗑️ Solicitud de prueba cancelada por admin ${adminId} para usuario ${telegramId}`);

    res.json({ success: true, message: 'Solicitud de prueba eliminada', user: updated });
  } catch (error) {
    console.error('❌ Error cancelando solicitud de prueba:', error);
    res.status(500).json({ error: 'Error cancelando solicitud: ' + error.message });
  }
});

app.post('/api/send-trial-config', async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;

    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!telegramId || telegramId === 'undefined' || telegramId === 'null' || telegramId === '') {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }

    const chatId = telegramId.toString().trim();
    const user = await db.getUser(chatId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (!user.trial_requested) {
      return res.status(400).json({ error: 'El usuario no solicitó prueba' });
    }

    if (user.trial_received) {
      return res.status(400).json({ error: 'El usuario ya recibió la prueba' });
    }

    const canSend = await canSendMessageToUser(chatId);
    if (!canSend.canSend) {
      await db.updateUser(chatId, {
        is_active: false,
        last_error: canSend.reason
      });
      return res.status(400).json({
        error: `El usuario no puede recibir mensajes: ${canSend.reason}. Marcado como inactivo.`
      });
    }

    await sendTrialConfigToUser(chatId, adminId);

    res.json({
      success: true,
      message: 'Configuración de prueba enviada correctamente',
      trialType: '1h',
      gameServer: user.trial_game_server || 'No especificado',
      connectionType: user.trial_connection_type || 'No especificado'
    });
  } catch (error) {
    console.error('❌ Error en send-trial-config:', error);
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString(),
    admins: ADMIN_IDS,
    port: PORT,
    bot_token: process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado',
    supabase_url: process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado',
    supabase_service_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Configurado' : '❌ No configurado',
    usdt_system: {
      enabled: true,
      mode: 'MANUAL',
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      bscscan_api_key: '❌ Desactivado - Flujo manual',
      verification_interval: 'Verificación automática desactivada',
      notes: 'Todos los pagos requieren captura y aprobación manual'
    }
  });
});

app.get('/api/image/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(UPLOADS_DIR, filename);
    
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'Imagen no encontrada' });
    }
  } catch (error) {
    console.error('❌ Error sirviendo imagen:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/storage-status', async (req, res) => {
  try {
    const buckets = [];
    
    try {
      const { data: screenshots } = await supabaseAdmin.storage
        .from('payments-screenshots')
        .list();
      buckets.push({
        name: 'payments-screenshots',
        status: '✅ Existe',
        fileCount: screenshots?.length || 0
      });
    } catch (e) {
      buckets.push({
        name: 'payments-screenshots', 
        status: '❌ No existe o error: ' + e.message
      });
    }
    
    try {
      const { data: planFiles } = await supabaseAdmin.storage
        .from('plan-files')
        .list();
      buckets.push({
        name: 'plan-files',
        status: '✅ Existe',
        fileCount: planFiles?.length || 0
      });
    } catch (e) {
      buckets.push({
        name: 'plan-files', 
        status: '❌ No existe o error: ' + e.message
      });
    }
    
    res.json({ 
      success: true,
      buckets,
      service_key_configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      service_key_configured: !!process.env.SUPABASE_SERVICE_ROLE_KEY
    });
  }
});

app.post('/api/broadcast/send', async (req, res) => {
  try {
    const { message, target, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    
    const validTargets = ['all', 'vip', 'non_vip', 'trial_pending', 'trial_received', 'active', 'with_referrals', 'usdt_payers'];
    if (!validTargets.includes(target)) {
      return res.status(400).json({ error: 'Target de broadcast inválido' });
    }
    
    console.log(`📢 Creando broadcast para target: ${target}...`);
    
    const broadcast = await db.createBroadcast(message, target, adminId);
    
    if (!broadcast || !broadcast.id) {
      throw new Error('No se pudo crear el broadcast');
    }
    
    console.log(`✅ Broadcast creado con ID: ${broadcast.id}`);
    
    let users = [];
    try {
      users = await getAllUsersForBroadcast(target);
    } catch (err) {
      console.error('❌ Error obteniendo usuarios para broadcast:', err.message);
      throw new Error('No se pudieron obtener los usuarios: ' + err.message);
    }
    
    console.log(`👥 ${users.length} usuarios encontrados para el broadcast`);
    
    await db.updateBroadcastStatus(broadcast.id, 'pending', {
      total_users: users.length
    });
    
    setImmediate(() => {
      sendBroadcastToUsers(broadcast.id, message, users, adminId);
    });
    
    res.json({ 
      success: true, 
      message: 'Broadcast creado y en proceso de envío',
      broadcast: {
        id: broadcast.id,
        message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        target: target,
        total_users: users.length,
        status: 'pending'
      },
      totalUsers: users.length
    });
    
  } catch (error) {
    console.error('❌ Error creando broadcast:', error);
    res.status(500).json({ error: 'Error creando broadcast: ' + error.message });
  }
});

async function sendBroadcastToUsers(broadcastId, message, users, adminId) {
  try {
    if (!broadcastId) {
      console.error('❌ ID de broadcast no proporcionado');
      return;
    }
    
    if (!users || users.length === 0) {
      console.log('⚠️ No hay usuarios para este broadcast');
      await db.updateBroadcastStatus(broadcastId, 'completed', {
        sent_count: 0, failed_count: 0, unavailable_count: 0, total_users: 0
      });
      return;
    }

    console.log(`🚀 Iniciando envío de broadcast ${broadcastId} a ${users.length} usuarios`);
    
    await db.updateBroadcastStatus(broadcastId, 'sending', {
      total_users: users.length,
      sent_count: 0
    });
    
    let sentCount = 0;
    let failedCount = 0;
    let unavailableCount = 0;
    const failedUsers = [];
    
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      
      try {
        if (!user.telegram_id) {
          failedCount++;
          continue;
        }
        
        await bot.telegram.sendMessage(
          user.telegram_id,
          `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${message}\n\n_Para consultas, contacta a soporte: @L0quen2_`,
          { parse_mode: 'Markdown' }
        );
        sentCount++;

      } catch (error) {
        failedCount++;
        const errMsg = error.description || error.message || '';

        const isPermanentError =
          errMsg.includes('blocked') ||
          errMsg.includes('chat not found') ||
          errMsg.includes('kicked') ||
          errMsg.includes('user is deactivated') ||
          error.response?.error_code === 403;

        if (isPermanentError) {
          unavailableCount++;
          console.log(`❌ Usuario ${user.telegram_id} no disponible (${errMsg}), marcando inactivo`);
          try {
            await db.updateUser(user.telegram_id, {
              is_active: false,
              last_error: errMsg,
              updated_at: new Date().toISOString()
            });
          } catch (updateErr) {
            console.log(`⚠️ No se pudo marcar inactivo ${user.telegram_id}:`, updateErr.message);
          }
        } else {
          console.error(`❌ Error enviando a ${user.telegram_id}:`, errMsg);
          failedUsers.push({ telegram_id: user.telegram_id, error: errMsg });
        }
      }

      if ((i + 1) % 25 === 0 || i === users.length - 1) {
        console.log(`📊 Broadcast ${broadcastId} progreso: ${sentCount} enviados, ${failedCount} fallidos (${i+1}/${users.length})`);
        try {
          await db.updateBroadcastStatus(broadcastId, 'sending', {
            sent_count: sentCount,
            failed_count: failedCount,
            unavailable_count: unavailableCount,
            total_users: users.length
          });
        } catch (progressErr) {
          console.warn('⚠️ Error actualizando progreso de broadcast:', progressErr.message);
        }
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`✅ Broadcast ${broadcastId} completado: ${sentCount} enviados, ${failedCount} fallidos, ${unavailableCount} no disponibles`);
    await db.updateBroadcastStatus(broadcastId, 'completed', {
      sent_count: sentCount,
      failed_count: failedCount,
      unavailable_count: unavailableCount,
      total_users: users.length
    });
    
  } catch (error) {
    console.error(`❌ Error crítico en broadcast ${broadcastId}:`, error);
    try {
      await db.updateBroadcastStatus(broadcastId, 'failed', {
        sent_count: 0,
        failed_count: users?.length || 0,
        unavailable_count: 0,
        total_users: users?.length || 0
      });
    } catch (updateError) {
      console.error('❌ Error actualizando estado de broadcast a fallido:', updateError);
    }
  }
}

app.get('/api/broadcasts', async (req, res) => {
  try {
    const broadcasts = await db.getBroadcasts();
    res.json(broadcasts);
  } catch (error) {
    console.error('❌ Error obteniendo broadcasts:', error);
    res.status(500).json({ error: 'Error obteniendo broadcasts' });
  }
});

app.get('/api/broadcast/status/:id', async (req, res) => {
  try {
    const broadcastId = req.params.id;
    
    if (!broadcastId || isNaN(parseInt(broadcastId))) {
      console.error(`❌ ID de broadcast inválido: ${broadcastId}`);
      return res.status(400).json({ error: 'ID de broadcast inválido' });
    }
    
    const broadcast = await db.getBroadcast(broadcastId);
    
    if (!broadcast) {
      console.log(`📭 Broadcast ${broadcastId} no encontrado`);
      return res.status(404).json({ error: 'Broadcast no encontrado' });
    }
    
    res.json(broadcast);
  } catch (error) {
    console.error('❌ Error obteniendo estado de broadcast:', error);
    res.status(500).json({ error: 'Error obteniendo estado de broadcast' });
  }
});

app.post('/api/broadcast/retry/:id', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const broadcast = await db.retryFailedBroadcast(req.params.id);
    
    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast no encontrado' });
    }
    
    const users = await getAllUsersForBroadcast(broadcast.target_users);
    
    setTimeout(() => {
      sendBroadcastToUsers(broadcast.id, broadcast.message, users, adminId);
    }, 100);
    
    res.json({ 
      success: true, 
      message: 'Broadcast programado para reintento',
      broadcast
    });
    
  } catch (error) {
    console.error('❌ Error reintentando broadcast:', error);
    res.status(500).json({ error: 'Error reintentando broadcast: ' + error.message });
  }
});

app.get('/api/users/active', async (req, res) => {
  try {
    const users = await db.getActiveUsers(30);
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios activos:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios activos' });
  }
});

app.get('/api/broadcast/:id', async (req, res) => {
  try {
    const broadcastId = req.params.id;
    
    if (!broadcastId || isNaN(parseInt(broadcastId))) {
      return res.status(400).json({ error: 'ID de broadcast inválido' });
    }
    
    const broadcast = await db.getBroadcast(broadcastId);
    
    if (!broadcast) {
      return res.status(404).json({ error: 'Broadcast no encontrado' });
    }
    
    res.json(broadcast);
  } catch (error) {
    console.error('❌ Error obteniendo broadcast:', error);
    res.status(500).json({ error: 'Error obteniendo broadcast' });
  }
});

app.get('/api/referrals/stats', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de referidos:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de referidos' });
  }
});

app.get('/api/referrals/top', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const topReferrers = stats.top_referrers || [];
    
    const referrersWithInfo = await Promise.all(topReferrers.map(async (referrer) => {
      const user = await db.getUser(referrer.referrer_id);
      return {
        ...referrer,
        first_name: user?.first_name || 'Usuario',
        username: user?.username || 'sin_usuario'
      };
    }));
    
    res.json(referrersWithInfo);
  } catch (error) {
    console.error('❌ Error obteniendo top referidores:', error);
    res.status(500).json({ error: 'Error obteniendo top referidores' });
  }
});

app.get('/api/referrals/list', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const referrals = stats.recent_referrals || [];
    
    const referralsWithInfo = await Promise.all(referrals.map(async (referral) => {
      const user = await db.getUser(referral.referred_id);
      const referrer = await db.getUser(referral.referrer_id);
      
      return {
        ...referral,
        user_name: user?.first_name || 'Usuario',
        user_id: user?.telegram_id,
        referrer_name: referrer?.first_name || 'Usuario',
        referrer_id: referrer?.telegram_id
      };
    }));
    
    res.json(referralsWithInfo);
  } catch (error) {
    console.error('❌ Error obteniendo lista de referidos:', error);
    res.status(500).json({ error: 'Error obteniendo lista de referidos' });
  }
});

app.get('/api/referrals/user/:telegramId', async (req, res) => {
  try {
    const stats = await db.getReferralStats(req.params.telegramId);
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de referidos por usuario:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de referidos por usuario' });
  }
});

app.get('/api/users/with-referrals', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const usersWithReferrals = stats.top_referrers || [];
    
    const usersWithInfo = await Promise.all(usersWithReferrals.map(async (user) => {
      const userInfo = await db.getUser(user.referrer_id);
      return {
        ...user,
        first_name: userInfo?.first_name || 'Usuario',
        username: userInfo?.username || 'sin_usuario',
        telegram_id: user.referrer_id
      };
    }));
    
    res.json(usersWithInfo);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios con referidos:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios con referidos' });
  }
});

app.get('/api/users/without-referrals', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const allUsers = await db.getAllUsers(10000, 0); // límite alto, pero cuidado
    const usersWithReferrals = new Set(stats.top_referrers?.map(u => u.referrer_id) || []);
    
    const usersWithoutReferrals = allUsers.filter(user => {
      return !usersWithReferrals.has(user.telegram_id.toString());
    });
    
    res.json(usersWithoutReferrals.slice(0, 200)); // limitar a 200 para no sobrecargar
  } catch (error) {
    console.error('❌ Error obteniendo usuarios sin referidos:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios sin referidos' });
  }
});

app.get('/api/usdt/wallet-status', async (req, res) => {
  try {
    res.json({
      success: true,
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      network: 'BEP20 (Binance Smart Chain)',
      usdt_contract: USDT_CONFIG.USDT_CONTRACT_ADDRESS,
      balance: 'Verificación automática desactivada',
      bscscan_url: `https://bscscan.com/address/${USDT_CONFIG.WALLET_ADDRESS}`,
      last_check: new Date().toISOString(),
      check_interval: 'Verificación automática desactivada',
      mode: 'MANUAL',
      message: 'Todos los pagos USDT requieren captura y aprobación manual'
    });
  } catch (error) {
    console.error('❌ Error verificando estado de wallet:', error);
    res.status(500).json({ error: 'Error verificando estado de wallet' });
  }
});

app.get('/api/usdt/verify-transaction/:hash', async (req, res) => {
  try {
    res.json({
      success: true,
      status: "manual_review_required",
      confirmations: "N/A",
      mode: "manual",
      message: "Verificación automática desactivada. Revisar captura manualmente."
    });
  } catch (error) {
    console.error('❌ Error verificando transacción:', error);
    res.status(500).json({ error: 'Error verificando transacción' });
  }
});

app.post('/api/usdt/force-check', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    res.json({
      success: true,
      message: 'Verificación automática desactivada. Todos los pagos USDT requieren revisión manual con captura.',
      result: { transactions: 0, mode: 'manual' }
    });
  } catch (error) {
    console.error('❌ Error en verificación forzada:', error);
    res.status(500).json({ error: 'Error en verificación forzada' });
  }
});

app.get('/api/usdt/unassigned-transactions', async (req, res) => {
  try {
    res.json([]);
  } catch (error) {
    console.error('❌ Error obteniendo transacciones no asignadas:', error);
    res.status(500).json({ error: 'Error obteniendo transacciones no asignadas' });
  }
});

// ==================== RUTAS PARA ARCHIVOS DE PLANES ====================

app.post('/api/upload-plan-file', upload.single('file'), async (req, res) => {
  try {
    const { plan, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    if (!plan || !['basico', 'avanzado', 'premium', 'anual'].includes(plan)) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'Plan inválido' });
    }
    
    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar') && !fileName.endsWith('.conf')) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .conf, .zip o .rar' });
    }
    
    const fileBuffer = fs.readFileSync(req.file.path);
    
    const uploadResult = await db.uploadPlanFile(fileBuffer, plan, req.file.originalname);
    
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('❌ Error al eliminar archivo local:', err);
    });
    
    const planFileData = {
      plan: plan,
      storage_filename: uploadResult.filename,
      original_name: uploadResult.originalName,
      public_url: uploadResult.publicUrl,
      uploaded_by: adminId,
      uploaded_at: new Date().toISOString()
    };
    
    const savedFile = await db.savePlanFile(planFileData);
    
    res.json({ 
      success: true, 
      message: `Archivo de plan ${getPlanName(plan)} subido correctamente`,
      file: savedFile
    });
    
  } catch (error) {
    console.error('❌ Error subiendo archivo de plan:', error);
    
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error subiendo archivo de plan: ' + error.message });
  }
});

// ==================== MULTI-TRIAL FILES (múltiples archivos de prueba) ====================

app.post('/api/trial-files/upload', upload.single('file'), async (req, res) => {
  try {
    const { adminId, label } = req.body;

    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Archivo requerido' });
    }

    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar') && !fileName.endsWith('.conf')) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Solo .conf, .zip o .rar' });
    }

    const ext = path.extname(req.file.originalname);
    const uniqueName = `trial_${Date.now()}${ext}`;
    const localPath = path.join(TRIAL_FILES_DIR, uniqueName);
    fs.copyFileSync(req.file.path, localPath);
    fs.unlink(req.file.path, () => {});

    let publicUrl = null;
    try {
      const buf = fs.readFileSync(localPath);
      const up = await db.uploadPlanFile(buf, 'trial', uniqueName);
      publicUrl = up.publicUrl;
    } catch (e) {
      console.warn('⚠️ Supabase backup falló (archivo local OK):', e.message);
    }

    const saved = await db.saveTrialFile({
      original_name: req.file.originalname,
      local_path: localPath,
      public_url: publicUrl,
      label: label || req.file.originalname,
      uploaded_by: adminId,
      is_active: true,
      uploaded_at: new Date().toISOString()
    });

    console.log(`✅ Archivo de prueba añadido: ${req.file.originalname} → ${localPath}`);

    res.json({ success: true, message: 'Archivo de prueba añadido al pool', file: saved });
  } catch (error) {
    console.error('❌ Error subiendo archivo de prueba:', error);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Error subiendo archivo: ' + error.message });
  }
});

app.get('/api/trial-files', async (req, res) => {
  try {
    const files = await db.getTrialFiles();
    const enriched = (files || []).map(f => ({
      ...f,
      local_exists: f.local_path ? fs.existsSync(f.local_path) : false
    }));
    res.json(enriched);
  } catch (error) {
    console.error('❌ Error obteniendo archivos de prueba:', error);
    res.status(500).json({ error: 'Error obteniendo archivos de prueba' });
  }
});

app.put('/api/trial-files/:id/toggle', async (req, res) => {
  try {
    const { adminId, is_active } = req.body;
    if (!isAdmin(adminId)) return res.status(403).json({ error: 'No autorizado' });

    const updated = await db.updateTrialFile(req.params.id, { is_active: !!is_active });
    res.json({ success: true, file: updated });
  } catch (error) {
    console.error('❌ Error actualizando archivo de prueba:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.delete('/api/trial-files/:id', async (req, res) => {
  try {
    const { adminId } = req.body;
    if (!isAdmin(adminId)) return res.status(403).json({ error: 'No autorizado' });

    const file = await db.getTrialFile(req.params.id);
    if (!file) return res.status(404).json({ error: 'Archivo no encontrado' });

    if (file.local_path && fs.existsSync(file.local_path)) {
      fs.unlinkSync(file.local_path);
    }

    await db.deleteTrialFile(req.params.id);
    res.json({ success: true, message: 'Archivo eliminado' });
  } catch (error) {
    console.error('❌ Error eliminando archivo de prueba:', error);
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.post('/api/upload-trial-file', upload.single('file'), async (req, res) => {
  try {
    const { adminId } = req.body;
    if (!isAdmin(adminId)) return res.status(403).json({ error: 'No autorizado' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });

    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar') && !fileName.endsWith('.conf')) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Solo .conf, .zip o .rar' });
    }

    const ext = path.extname(req.file.originalname);
    const targetPath = TRIAL_CURRENT_FILE + ext;
    fs.copyFileSync(req.file.path, targetPath);

    const uniqueName = `trial_${Date.now()}${ext}`;
    const poolPath = path.join(TRIAL_FILES_DIR, uniqueName);
    fs.copyFileSync(req.file.path, poolPath);
    fs.unlink(req.file.path, () => {});

    let publicUrl = null;
    try {
      const buf = fs.readFileSync(targetPath);
      const up = await db.uploadPlanFile(buf, 'trial', req.file.originalname);
      publicUrl = up.publicUrl;
      await db.savePlanFile({ plan: 'trial', storage_filename: up.filename, original_name: up.originalName, public_url: up.publicUrl, uploaded_by: adminId, uploaded_at: new Date().toISOString() });
    } catch(e) { console.warn('⚠️ Supabase backup falló:', e.message); }

    try {
      await db.saveTrialFile({ original_name: req.file.originalname, local_path: poolPath, public_url: publicUrl, label: req.file.originalname, uploaded_by: adminId, is_active: true, uploaded_at: new Date().toISOString() });
    } catch(e) { console.warn('⚠️ No se pudo añadir al pool (tabla puede no existir aún):', e.message); }

    res.json({ success: true, message: 'Archivo de prueba subido', file: { local_path: targetPath } });
  } catch (error) {
    console.error('❌ Error:', error);
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: 'Error: ' + error.message });
  }
});

app.get('/api/plan-files', async (req, res) => {
  try {
    const planFiles = await db.getAllPlanFiles();
    res.json(planFiles);
  } catch (error) {
    console.error('❌ Error obteniendo archivos de planes:', error);
    res.status(500).json({ error: 'Error obteniendo archivos de planes' });
  }
});

app.get('/api/plan-files/:plan', async (req, res) => {
  try {
    const planFile = await db.getPlanFile(req.params.plan);
    
    if (!planFile) {
      return res.status(404).json({ error: 'Archivo de plan no encontrado' });
    }
    
    res.json(planFile);
  } catch (error) {
    console.error('❌ Error obteniendo archivo de plan:', error);
    res.status(500).json({ error: 'Error obteniendo archivo de plan' });
  }
});

app.get('/api/plan-files/trial', async (req, res) => {
  try {
    const planFile = await db.getPlanFile('trial');
    
    if (!planFile) {
      return res.status(404).json({ error: 'Archivo de prueba no encontrado' });
    }
    
    let localFileInfo = null;
    const extensions = ['.conf', '.zip', '.rar'];
    for (const ext of extensions) {
      const testPath = TRIAL_CURRENT_FILE + ext;
      if (fs.existsSync(testPath)) {
        localFileInfo = {
          exists: true,
          filename: path.basename(testPath),
          size: fs.statSync(testPath).size,
          modified: fs.statSync(testPath).mtime
        };
        break;
      }
    }
    
    res.json({
      ...planFile,
      local_backup: localFileInfo || { exists: false, message: 'No hay archivo local' }
    });
  } catch (error) {
    console.error('❌ Error obteniendo archivo de prueba:', error);
    res.status(500).json({ error: 'Error obteniendo archivo de prueba' });
  }
});

app.delete('/api/plan-files/:plan', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const deletedFile = await db.deletePlanFile(req.params.plan);
    
    if (req.params.plan === 'trial') {
      const extensions = ['.conf', '.zip', '.rar'];
      for (const ext of extensions) {
        const filePath = TRIAL_CURRENT_FILE + ext;
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Archivo local de prueba eliminado: ${filePath}`);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: `Archivo de plan ${getPlanName(req.params.plan)} eliminado`,
      file: deletedFile
    });
  } catch (error) {
    console.error('❌ Error eliminando archivo de plan:', error);
    res.status(500).json({ error: 'Error eliminando archivo de plan: ' + error.message });
  }
});

app.get('/api/games-stats', async (req, res) => {
  try {
    const stats = await db.getGamesStatistics();
    res.json(stats.games || []);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de juegos:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de juegos' });
  }
});

app.get('/api/user/:telegramId/details', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    let referralStats = null;
    let payments = [];
    let referrals = [];

    try { referralStats = await db.getReferralStats(req.params.telegramId); } catch(e) { console.warn('⚠️ No se pudo obtener referral stats:', e.message); }
    try { payments = await db.getUserPayments(req.params.telegramId) || []; } catch(e) { console.warn('⚠️ No se pudo obtener pagos:', e.message); }
    try { referrals = await db.getReferralsByReferrer(req.params.telegramId) || []; } catch(e) { console.warn('⚠️ No se pudo obtener referidos:', e.message); }
    
    const level1Referrals = referrals.filter(r => r.level === 1);
    const level2Referrals = referrals.filter(r => r.level === 2);
    const level1Paid = level1Referrals.filter(r => r.has_paid).length;
    const level2Paid = level2Referrals.filter(r => r.has_paid).length;

    res.json({
      ...user,
      telegram_id: user.telegram_id,
      first_name: user.first_name || 'Usuario',
      username: user.username || '',
      vip: user.vip || false,
      current_plan: user.plan || user.current_plan || null,
      plan: user.plan || user.current_plan || null,
      plan_price: user.plan_price || null,
      vip_since: user.vip_since || null,
      referrer_id: user.referrer_id || null,
      referrer_username: user.referrer_username || null,
      is_active: user.is_active !== false,
      trial_requested: user.trial_requested || false,
      trial_received: user.trial_received || false,
      created_at: user.created_at || null,
      referral_stats: referralStats,
      payments: payments,
      referrals: referrals,
      level1_referrals: level1Referrals.length,
      level2_referrals: level2Referrals.length,
      level1_paid: level1Paid,
      level2_paid: level2Paid,
      total_referrals: referrals.length,
      paid_referrals: level1Paid + level2Paid
    });
  } catch (error) {
    console.error('❌ Error obteniendo detalles de usuario:', error);
    res.status(500).json({ error: 'Error obteniendo detalles de usuario' });
  }
});

app.post('/api/user/:userId/message', async (req, res) => {
  try {
    const { adminId, message } = req.body;
    const userId = req.params.userId;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!message) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    
    if (!userId || userId === 'undefined' || userId === 'null' || userId === '') {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const chatId = userId.toString().trim();
    
    const canSend = await canSendMessageToUser(chatId);
    if (!canSend.canSend) {
      return res.status(400).json({ 
        error: `No se puede enviar mensaje al usuario: ${canSend.reason}` 
      });
    }
    
    await bot.telegram.sendMessage(chatId, `📨 *Mensaje del Administrador:*\n\n${message}`, { 
      parse_mode: 'Markdown' 
    });
    
    res.json({ success: true, message: 'Mensaje enviado' });
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error enviando mensaje: ' + error.message });
  }
});

app.post('/api/send-trials-to-valid', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`🚀 Iniciando envío de pruebas solo a usuarios disponibles...`);
    
    const result = await sendTrialToValidUsers(adminId);
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Error en send-trials-to-valid:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error interno del servidor: ' + error.message 
    });
  }
});

// ==================== RUTAS PARA CUPONES ====================

app.post('/api/coupons', async (req, res) => {
  try {
    console.log('🎫 RECIBIENDO SOLICITUD PARA CREAR CUPÓN...');
    console.log('📦 Cuerpo de la solicitud:', JSON.stringify(req.body, null, 2));
    
    const { code, discount, stock, expiry, description, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      console.log('❌ USUARIO NO ES ADMINISTRADOR:', adminId);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log('✅ USUARIO ES ADMINISTRADOR');
    
    if (!code || !discount || !stock) {
      console.log('❌ FALTAN CAMPOS REQUERIDOS:', { code, discount, stock });
      return res.status(400).json({ error: 'Faltan campos requeridos: código, descuento y stock' });
    }
    
    if (!/^[A-Z0-9]+$/.test(code)) {
      console.log('❌ CÓDIGO INVÁLIDO:', code);
      return res.status(400).json({ error: 'El código solo puede contener letras mayúsculas y números' });
    }
    
    const discountNum = parseFloat(discount);
    if (isNaN(discountNum) || discountNum < 1 || discountNum > 100) {
      console.log('❌ DESCUENTO INVÁLIDO:', discount);
      return res.status(400).json({ error: 'El descuento debe estar entre 1% y 100%' });
    }
    
    const stockNum = parseInt(stock);
    if (isNaN(stockNum) || stockNum < 1) {
      console.log('❌ STOCK INVÁLIDO:', stock);
      return res.status(400).json({ error: 'El stock debe ser mayor a 0' });
    }
    
    let expiryDate = null;
    if (expiry) {
      let expiryStr = expiry;
      if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        expiryStr = expiry + 'T23:59:59';
      }
      expiryDate = new Date(expiryStr);

      if (isNaN(expiryDate.getTime())) {
        expiryDate = new Date(expiry.replace('T', ' '));
      }
      
      if (isNaN(expiryDate.getTime())) {
        console.log('❌ FECHA DE EXPIRACIÓN INVÁLIDA:', expiry);
        return res.status(400).json({ error: 'Fecha de expiración inválida' });
      }
      
      if (expiryDate <= new Date()) {
        console.log('❌ FECHA DE EXPIRACIÓN DEBE SER FUTURA:', expiry);
        return res.status(400).json({ error: 'La fecha de expiración debe ser en el futuro' });
      }
    }
    
    console.log('📝 DATOS VALIDADOS, CREANDO CUPÓN...');
    console.log('🔍 Datos del cupón:', {
      code: code.toUpperCase(),
      discount: discountNum,
      stock: stockNum,
      expiry: expiryDate,
      description: description || '',
      status: 'active',
      created_by: adminId
    });
    
    const coupon = await db.createCoupon({
      code: code.toUpperCase(),
      discount: discountNum,
      stock: stockNum,
      expiry: expiryDate,
      description: description || '',
      status: 'active',
      created_by: adminId
    });
    
    console.log('✅ CUPÓN CREADO EXITOSAMENTE:', coupon);
    
    res.json({ 
      success: true, 
      message: 'Cupón creado exitosamente',
      coupon 
    });
    
  } catch (error) {
    console.error('❌ ERROR CRÍTICO CREANDO CUPÓN:', error);
    console.error('❌ Stack trace:', error.stack);
    
    if (error.message.includes('unique')) {
      return res.status(400).json({ error: 'Ya existe un cupón con ese código' });
    }
    
    res.status(500).json({ 
      error: 'Error creando cupón: ' + error.message,
      details: error.stack 
    });
  }
});

app.get('/api/coupons', async (req, res) => {
  try {
    const coupons = await db.getCoupons();
    res.json(coupons);
  } catch (error) {
    console.error('❌ Error obteniendo cupones:', error);
    res.status(500).json({ error: 'Error obteniendo cupones' });
  }
});

app.get('/api/coupons/stats', async (req, res) => {
  try {
    const stats = await db.getCouponsStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de cupones:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de cupones' });
  }
});

app.get('/api/coupons/:code', async (req, res) => {
  try {
    const coupon = await db.getCoupon(req.params.code.toUpperCase());
    
    if (!coupon) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    
    res.json(coupon);
  } catch (error) {
    console.error('❌ Error obteniendo cupón:', error);
    res.status(500).json({ error: 'Error obteniendo cupón' });
  }
});

app.put('/api/coupons/:code', async (req, res) => {
  try {
    const { stock, status, adminId } = req.body;
    const code = req.params.code.toUpperCase();
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const coupon = await db.getCoupon(code);
    if (!coupon) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    
    let stockNum = coupon.stock;
    if (stock !== undefined) {
      stockNum = parseInt(stock);
      if (isNaN(stockNum) || stockNum < 0) {
        return res.status(400).json({ error: 'Stock inválido' });
      }
    }
    
    let newStatus = coupon.status;
    if (status && ['active', 'inactive', 'expired'].includes(status)) {
      newStatus = status;
    }
    
    const updatedCoupon = await db.updateCoupon(code, {
      stock: stockNum,
      status: newStatus,
      updated_at: new Date().toISOString(),
      updated_by: adminId
    });
    
    res.json({ 
      success: true, 
      message: 'Cupón actualizado exitosamente',
      coupon: updatedCoupon 
    });
    
  } catch (error) {
    console.error('❌ Error actualizando cupón:', error);
    res.status(500).json({ error: 'Error actualizando cupón: ' + error.message });
  }
});

app.put('/api/coupons/:code/status', async (req, res) => {
  try {
    const { status, adminId } = req.body;
    const code = req.params.code.toUpperCase();
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!status || !['active', 'inactive', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido. Use: active, inactive, expired' });
    }
    
    const coupon = await db.getCoupon(code);
    if (!coupon) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    
    const updatedCoupon = await db.updateCouponStatus(code, status, adminId);
    
    res.json({ 
      success: true, 
      message: `Cupón ${status === 'active' ? 'activado' : 'desactivado'} exitosamente`,
      coupon: updatedCoupon 
    });
    
  } catch (error) {
    console.error('❌ Error cambiando estado de cupón:', error);
    res.status(500).json({ error: 'Error cambiando estado de cupón: ' + error.message });
  }
});

app.delete('/api/coupons/:code', async (req, res) => {
  try {
    const { adminId } = req.body;
    const code = req.params.code.toUpperCase();
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const coupon = await db.getCoupon(code);
    if (!coupon) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    
    if (coupon.used && coupon.used > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar un cupón que ha sido usado. Puedes desactivarlo en su lugar.' 
      });
    }
    
    await db.deleteCoupon(code);
    
    res.json({ 
      success: true, 
      message: 'Cupón eliminado exitosamente' 
    });
    
  } catch (error) {
    console.error('❌ Error eliminando cupón:', error);
    res.status(500).json({ error: 'Error eliminando cupón: ' + error.message });
  }
});

app.post('/api/coupons/verify/:code', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const code = req.params.code.toUpperCase();
    
    if (!telegramId) {
      return res.status(400).json({ error: 'ID de usuario requerido' });
    }
    
    console.log(`🔍 Verificando cupón ${code} para usuario ${telegramId}`);
    
    const coupon = await db.getCoupon(code);
    if (!coupon) {
      console.log(`❌ Cupón ${code} no encontrado`);
      return res.json({ 
        success: false, 
        error: 'Cupón no encontrado' 
      });
    }
    
    console.log(`✅ Cupón encontrado:`, {
      code: coupon.code,
      status: coupon.status,
      stock: coupon.stock,
      expiry: coupon.expiry,
      used: coupon.used
    });
    
    if (coupon.status !== 'active') {
      console.log(`⚠️ Cupón no activo: ${coupon.status}`);
      return res.json({ 
        success: false, 
        error: `Cupón ${coupon.status === 'expired' ? 'expirado' : 'inactivo'}` 
      });
    }
    
    if (coupon.expiry) {
      let expiryStr = coupon.expiry;
      if (/^\d{4}-\d{2}-\d{2}$/.test(expiryStr)) {
        expiryStr = expiryStr + 'T23:59:59';
      }
      const expiryDate = new Date(expiryStr);
      const now = new Date();
      
      console.log(`📅 Expiración: ${expiryDate}, Ahora: ${now}`);
      
      if (expiryDate < now) {
        console.log(`⚠️ Cupón expirado`);
        await db.updateCouponStatus(code, 'expired', 'system');
        return res.json({ 
          success: false, 
          error: 'Cupón expirado' 
        });
      }
    }
    
    if (coupon.stock <= 0) {
      console.log(`⚠️ Cupón agotado, stock: ${coupon.stock}`);
      return res.json({ 
        success: false, 
        error: 'Cupón agotado' 
      });
    }
    
    const hasUsed = await db.hasUserUsedCoupon(telegramId, code);
    if (hasUsed) {
      console.log(`⚠️ Usuario ya usó este cupón`);
      return res.json({ 
        success: false, 
        error: 'Ya has usado este cupón' 
      });
    }
    
    console.log(`✅ Cupón ${code} válido para usuario ${telegramId}`);
    res.json({ 
      success: true,
      coupon: {
        code: coupon.code,
        discount: coupon.discount,
        description: coupon.description,
        stock: coupon.stock
      },
      message: `Cupón válido. Descuento del ${coupon.discount}% aplicado.`
    });
    
  } catch (error) {
    console.error('❌ Error verificando cupón:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Error verificando cupón: ' + error.message 
    });
  }
});

app.post('/api/coupons/apply/:code', async (req, res) => {
  try {
    const { telegramId, paymentId, adminId } = req.body;
    const code = req.params.code.toUpperCase();
    
    if (!telegramId || !paymentId) {
      return res.status(400).json({ error: 'ID de usuario y pago requeridos' });
    }
    
    const coupon = await db.getCoupon(code);
    if (!coupon) {
      return res.status(404).json({ error: 'Cupón no encontrado' });
    }
    
    if (coupon.status !== 'active') {
      return res.status(400).json({ 
        error: `Cupón ${coupon.status === 'expired' ? 'expirado' : 'inactivo'}` 
      });
    }
    
    if (coupon.expiry && new Date(coupon.expiry) < new Date()) {
      await db.updateCouponStatus(code, 'expired', 'system');
      return res.status(400).json({ error: 'Cupón expirado' });
    }
    
    if (coupon.stock <= 0) {
      return res.status(400).json({ error: 'Cupón agotado' });
    }
    
    const hasUsed = await db.hasUserUsedCoupon(telegramId, code);
    if (hasUsed) {
      return res.status(400).json({ error: 'Ya has usado este cupón' });
    }
    
    const applied = await db.applyCouponToPayment(code, telegramId, paymentId);
    
    if (!applied) {
      return res.status(400).json({ error: 'No se pudo aplicar el cupón al pago' });
    }
    
    const newStock = coupon.stock - 1;
    await db.updateCoupon(code, {
      stock: newStock,
      used: (coupon.used || 0) + 1,
      updated_at: new Date().toISOString(),
      updated_by: adminId || 'system'
    });
    
    res.json({ 
      success: true, 
      message: `Cupón aplicado. Descuento del ${coupon.discount}% aplicado al pago.`,
      discount: coupon.discount,
      coupon: coupon.code
    });
    
  } catch (error) {
    console.error('❌ Error aplicando cupón:', error);
    res.status(500).json({ error: 'Error aplicando cupón: ' + error.message });
  }
});

app.get('/api/coupons/history/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    
    const history = await db.getCouponUsageHistory(code);
    
    res.json(history);
  } catch (error) {
    console.error('❌ Error obteniendo historial de cupón:', error);
    res.status(500).json({ error: 'Error obteniendo historial de cupón' });
  }
});

// ==================== SERVIR ARCHIVOS HTML ====================
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public/index.html')); });
app.get('/plans.html', (req, res) => { res.sendFile(path.join(__dirname, 'public/plans.html')); });
app.get('/payment.html', (req, res) => { res.sendFile(path.join(__dirname, 'public/payment.html')); });
app.get('/admin.html', (req, res) => { res.sendFile(path.join(__dirname, 'public/admin.html')); });
app.get('/how.html', (req, res) => { res.sendFile(path.join(__dirname, 'public/how.html')); });
app.get('/faq.html', (req, res) => { res.sendFile(path.join(__dirname, 'public/faq.html')); });
app.get('/politicas.html', (req, res) => { res.sendFile(path.join(__dirname, 'public/politicas.html')); });

// ==================== BOT DE TELEGRAM ====================

bot.catch((err, ctx) => { console.error('❌ Error no manejado en el bot:', err); });

bot.action('show_support', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply(
      getSupportHtml(),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              createButton("CEO", { url: 'https://t.me/L0quen2' }),
              createButton("ADMIN", { url: 'https://t.me/ErenJeager129182' })
            ],
            [
              createButton("MOD", { url: 'https://t.me/rov3r777' })
            ],
            [
              createButton("WHATSAPP", { url: 'https://wa.me/5363806513' })
            ],
            [
              createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })
            ]
          ]
        }
      }
    );
  } catch (error) { console.error('❌ Error en show_support:', error); await ctx.answerCbQuery('❌ Error al abrir soporte.'); }
});

bot.action('check_status', async (ctx) => {
  const userId = ctx.from.id.toString();
  const firstName = ctx.from.first_name;
  try {
    const user = await db.getUser(userId);
    if (!user) {
      await ctx.reply(`❌ *NO ESTÁS REGISTRADO*\n\nUsa el botón "VER PLANES" para registrarte y comenzar.`, { parse_mode: 'Markdown' });
      await ctx.answerCbQuery();
      return;
    }

    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;

    if (user?.vip) {
      const diasRestantes = calcularDiasRestantes(user);

      if (diasRestantes <= 0) {
        await db.removeVIP(userId);
        await ctx.answerCbQuery();
        await ctx.reply(
          `⚠️ <b>Tu plan VIP ha expirado</b>\n\n` +
          `Tu acceso VIP fue removido automáticamente porque tu plan llegó a su fin.\n\n` +
          `Renueva ahora para continuar disfrutando del servicio.`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [createButton("VER PLANES", { web_app: { url: webappUrl } })],
                [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
              ]
            }
          }
        );
        return;
      }

      await ctx.reply(getVipStatusHtml(user), {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [createButton("VER PLANES", { web_app: { url: webappUrl } })],
            [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
          ]
        }
      });

      if (diasRestantes <= 5) {
        await ctx.reply(
          `⏰ <b>RECORDATORIO: Tu plan expira pronto</b>\n\n` +
          `Te quedan <b>${diasRestantes} día${diasRestantes === 1 ? '' : 's'}</b> de acceso VIP.\n\n` +
          `Renueva antes de que expire para no perder el acceso.`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [createButton("RENOVAR AHORA", { web_app: { url: webappUrl } })]
              ]
            }
          }
        );
      }
    } else {
      await ctx.reply(`❌ *NO ERES USUARIO VIP*\n\nActualmente no tienes acceso a los servicios premium.\n\nHaz clic en el botón para ver nuestros planes.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [createButton("VER PLANES", { web_app: { url: webappUrl } })],
            [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
          ]
        }
      });
    }
    await ctx.answerCbQuery();
  } catch (error) { console.error('❌ Error en check_status:', error); await ctx.reply(`❌ Error al verificar tu estado.`); await ctx.answerCbQuery(); }
});

bot.action('download_wireguard', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    getDownloadWireguardHtml(),
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [createButton("WINDOWS", { url: 'https://www.wireguard.com/install/' }), createButton("ANDROID", { url: 'https://play.google.com/store/apps/details?id=com.wireguard.android' })],
          [createButton("IOS", { url: 'https://apps.apple.com/app/id1441195209' })],
          [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
        ]
      }
    }
  );
});

bot.action('referral_info', async (ctx) => {
  const userId = ctx.from.id.toString();
  const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
  try {
    const user = await db.getUser(userId);
    let referralStats = null;
    if (user) try { referralStats = await db.getReferralStats(userId); } catch (e) {}
    let message = getReferralInfoHtml(userId, referralStats);
    await ctx.answerCbQuery();
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [createButton("COPIAR ENLACE", { callback_data: 'copy_referral_link' })],
          [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
        ]
      }
    });
  } catch (error) {
    console.error('❌ Error en referral_info:', error);
    await ctx.answerCbQuery();
    await ctx.reply(`🤝 *SISTEMA DE REFERIDOS*\n\nTu enlace de referido:\n\`${referralLink}\`\n\nComparte este enlace con tus amigos y obtén descuentos.\n\n*Nota:* No se pudieron cargar las estadísticas en este momento, pero el enlace sigue activo.`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [createButton("COPIAR ENLACE", { callback_data: 'copy_referral_link' })],
          [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
        ]
      }
    });
  }
});

bot.action('how_it_works', async (ctx) => {
  try {
    const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
    await ctx.answerCbQuery('🔍 Abriendo guía de uso...');
    await ctx.reply(
      getHowItWorksHtml(),
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [createButton("VER GUÍA COMPLETA", { web_app: { url: `${webappUrl}/how.html` } })],
            [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Error en how_it_works:', error);
    await ctx.answerCbQuery('❌ Error al abrir guía.');
  }
});

bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const firstName = ctx.from.first_name;
  const esAdmin = isAdmin(userId);
  const keyboard = buildMainMenuKeyboard(userId, firstName, esAdmin);
  await ctx.reply(
    `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\nSelecciona una opción:`,
    {
      parse_mode: 'Markdown',
      ...keyboard
    }
  );
});

bot.action('copy_referral_link', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
    await ctx.answerCbQuery('📋 Enlace listo para copiar');
    await ctx.reply(`📋 *Enlace de referido:*\n\n\`${referralLink}\`\n\nPara copiar, mantén presionado el enlace y selecciona "Copiar".`, { parse_mode: 'Markdown', reply_to_message_id: ctx.callbackQuery.message.message_id });
  } catch (error) { console.error('❌ Error en copy_referral_link:', error); await ctx.answerCbQuery('❌ Error, intenta nuevamente'); }
});

bot.action('politicas', async (ctx) => {
  try {
    const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
    await ctx.answerCbQuery('📜 Abriendo políticas del servicio...');
    const inlineKeyboard = [
      [createButton("TÉRMINOS DE SERVICIO", { web_app: { url: `${webappUrl}/politicas.html?section=terminos` } })],
      [createButton("POLÍTICA DE REEMBOLSO", { web_app: { url: `${webappUrl}/politicas.html?section=reembolso` } })],
      [createButton("POLÍTICA DE PRIVACIDAD", { web_app: { url: `${webappUrl}/politicas.html?section=privacidad` } })],
      [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
    ];
    if (ctx.callbackQuery.message) {
      await ctx.editMessageText(getPoliticasHtml(), { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
    } else {
      await ctx.reply(getPoliticasHtml(), { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
    }
  } catch (error) { console.error('❌ Error en action de políticas:', error); await ctx.answerCbQuery('❌ Error al abrir políticas.'); }
});

bot.action('faq', async (ctx) => {
  try {
    const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
    await ctx.answerCbQuery('❓ Abriendo preguntas frecuentes...');
    await ctx.reply(getFaqHtml(), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [createButton("VER PREGUNTAS FRECUENTES", { web_app: { url: `${webappUrl}/faq.html` } })],
          [createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]
        ]
      }
    });
  } catch (error) { console.error('❌ Error en action de FAQ:', error); await ctx.answerCbQuery('❌ Error al abrir FAQ.'); }
});

bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    const startPayload = ctx.startPayload;
    let referrerId = null;
    let referrerUsername = null;
    if (startPayload && startPayload.startsWith('ref')) {
        referrerId = startPayload.replace('ref', '');
        try {
            const referrer = await db.getUser(referrerId);
            if (referrer) referrerUsername = referrer.username;
        } catch (error) { console.error('Error obteniendo referidor:', error); }
        if (referrerId) {
            try { await db.createReferral(referrerId, userId.toString(), ctx.from.username, firstName); } catch (refError) { console.error('Error creando referido:', refError); }
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
        if (referrerId) { userData.referrer_id = referrerId; userData.referrer_username = referrerUsername; }
        await db.saveUser(userId.toString(), userData);
    } catch (error) { console.error('Error guardando usuario:', error); }
    await ctx.telegram.sendMessage(ctx.chat.id, '⌛', { reply_markup: { remove_keyboard: true } });
    const keyboard = buildMainMenuKeyboard(userId.toString(), firstName, esAdmin);
    const welcomeMessage = `¡Hola ${firstName || 'usuario'}! 👋\n\n*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\nConéctate con la mejor latencia para gaming y navegación.\n\n${referrerId ? '👥 *¡Te invitó un amigo!*\nObtendrás beneficios especiales por ser referido.\n\n' : ''}${esAdmin ? '🔧 *Eres Administrador* - Tienes acceso a funciones especiales\n\n' : ''}*Selecciona una opción:*`;
    await bot.telegram.callApi('sendMessage', {
        chat_id: ctx.chat.id,
        text: welcomeMessage,
        parse_mode: 'Markdown',
        ...keyboard
    });
});

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    console.log(`📨 Mensaje de texto recibido: "${text}" de ${userId}`);
    if (text === '📁 VER PLANES') {
        const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
        await ctx.reply(`📋 *NUESTROS PLANES* 🚀\n\n*PRUEBA GRATIS (1 hora)*\n💵 $0 CUP\n🎁 ¡Prueba completamente gratis!\n\n*BÁSICO (1 mes)*\n💵 $800 CUP\n💰 1.6 USDT\n\n*AVANZADO (2 meses)*\n💵 $1,300 CUP\n💰 2.7 USDT\n🎯 ¡Recomendado!\n\n*PREMIUM (1 mes)*\n💵 $1,200 CUP\n💰 2.5 USDT\n👑 Servidor privado\n\n*ANUAL (12 meses)*\n💵 $15,000 CUP\n💰 30 USDT\n🏆 ¡El mejor valor!\n\nPuedes ver los planes y adquirirlos en la web:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[createButton("ABRIR WEB DE PLANES", { web_app: { url: webappUrl } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    } else if (text === '👑 MI ESTADO') {
        await ctx.answerCbQuery();
        await checkStatusHandler(ctx, userId);
    } else if (text === '💻 DESCARGAR WIREGUARD') {
        await ctx.reply(getDownloadWireguardHtml(), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[createButton("WINDOWS", { url: 'https://www.wireguard.com/install/' }),createButton("ANDROID", { url: 'https://play.google.com/store/apps/details?id=com.wireguard.android' })],[createButton("IOS", { url: 'https://apps.apple.com/app/id1441195209' })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    } else if (text === '🆘 SOPORTE') {
        await ctx.reply(
            getSupportHtml(),
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            createButton("CEO", { url: 'https://t.me/L0quen2' }),
                            createButton("ADMIN", { url: 'https://t.me/ErenJeager129182' })
                        ],
                        [
                            createButton("MOD", { url: 'https://t.me/rov3r777' })
                        ],
                        [
                            createButton("WHATSAPP", { url: 'https://wa.me/5363806513' })
                        ],
                        [
                            createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })
                        ]
                    ]
                }
            }
        );
    } else if (text === '♻️ REFERIDOS') {
        const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
        try {
            const user = await db.getUser(userId);
            let referralStats = null;
            if (user) try { referralStats = await db.getReferralStats(userId); } catch (e) {}
            await ctx.reply(getReferralInfoHtml(userId, referralStats), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[createButton("COPIAR ENLACE", { callback_data: 'copy_referral_link' })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
        } catch (error) {
            console.error('❌ Error en handler de referidos:', error);
            await ctx.reply(`🤝 *SISTEMA DE REFERIDOS*\n\nTu enlace de referido:\n\`${referralLink}\`\n\nComparte este enlace con tus amigos y obtén descuentos.\n\n*Nota:* No se pudieron cargar las estadísticas en este momento, pero el enlace sigue activo.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[createButton("COPIAR ENLACE", { callback_data: 'copy_referral_link' })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
        }
    } else if (text === '❓ CÓMO FUNCIONA') {
        const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
        await ctx.reply(getHowItWorksHtml(), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[createButton("VER GUÍA COMPLETA", { web_app: { url: `${webappUrl}/how.html` } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    } else if (text === '🔈 VPN CANAL') {
        await ctx.reply(`📢 *CANAL OFICIAL DE VPN CUBA*\n\nÚnete a nuestro canal de Telegram para estar al tanto de las últimas novedades, ofertas y actualizaciones.\n\n👉 https://t.me/vpncubaw`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[createButton("IR AL CANAL", { url: 'https://t.me/vpncubaw' })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    } else if (text === '📲 WHATSAPP') {
        try {
            await ctx.reply('📱 *GRUPO DE WHATSAPP*\n\nÚnete a nuestra comunidad en WhatsApp para interactuar con otros usuarios y recibir soporte rápido.\n\n👉 [Haz clic aquí para unirte al grupo](https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9?mode=gi_t)', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[createButton("ABRIR WHATSAPP", { url: 'https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9?mode=gi_t' })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
        } catch (error) { console.error('❌ Error en handler de WhatsApp:', error); await ctx.reply('❌ Error al abrir WhatsApp. Intenta más tarde o contacta a soporte.'); }
    } else if (text === '📜 Politicas') {
        const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
        const inlineKeyboard = [[createButton("TÉRMINOS DE SERVICIO", { web_app: { url: `${webappUrl}/politicas.html?section=terminos` } })],[createButton("POLÍTICA DE REEMBOLSO", { web_app: { url: `${webappUrl}/politicas.html?section=reembolso` } })],[createButton("POLÍTICA DE PRIVACIDAD", { web_app: { url: `${webappUrl}/politicas.html?section=privacidad` } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]];
        await ctx.reply(getPoliticasHtml(), { parse_mode: 'HTML', reply_markup: { inline_keyboard: inlineKeyboard } });
    } else if (text === '❓ FAQ') {
        const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
        await ctx.reply(getFaqHtml(), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[createButton("VER PREGUNTAS FRECUENTES", { web_app: { url: `${webappUrl}/faq.html` } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    } else if (text === '⌨ PANEL ADMIN' && esAdmin) {
        const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${userId}&admin=true`;
        await ctx.reply(`🔧 *PANEL DE ADMINISTRACIÓN*\n\nHaz clic para abrir el panel web:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[createButton("ABRIR PANEL WEB", { web_app: { url: adminUrl } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    }
});

async function checkStatusHandler(ctx, userId) {
  try {
    const user = await db.getUser(userId);
    if (!user) { await ctx.reply(`❌ *NO ESTÁS REGISTRADO*\n\nUsa el botón "VER PLANES" para registrarte y comenzar.`, { parse_mode: 'Markdown' }); return; }
    if (user?.vip) {
      const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
      await ctx.reply(getVipStatusHtml(user), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[createButton("VER PLANES", { web_app: { url: webappUrl } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    } else {
      const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
      await ctx.reply(`❌ *NO ERES USUARIO VIP*\n\nActualmente no tienes acceso a los servicios premium.\n\nHaz clic en el botón para ver nuestros planes.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[createButton("VER PLANES", { web_app: { url: webappUrl } })],[createButton("MENÚ PRINCIPAL", { callback_data: 'main_menu' })]] } });
    }
  } catch (error) { console.error('❌ Error en checkStatusHandler:', error); await ctx.reply(`❌ Error al verificar tu estado.`); }
}

app.post('/webhook', (req, res) => { bot.handleUpdate(req.body, res); });

async function setWebhook() {
    const webhookUrl = `${process.env.WEBAPP_URL}/webhook`;
    try {
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`✅ Webhook establecido en: ${webhookUrl}`);
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log(`📡 Información del webhook:`, webhookInfo);
    } catch (error) {
        console.error('❌ Error estableciendo webhook:', error);
        console.log('⚠️ Usando polling como fallback...');
        await bot.launch();
    }
}

app.listen(PORT, async () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅' : '❌'}`);
    console.log(`🌐 Supabase URL: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
    console.log(`🔑 Supabase Key: ${process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ? '✅' : '❌'}`);
    console.log(`🔐 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌'}`);
    console.log(`👑 Admins: ${ADMIN_IDS.join(', ')}`);
    await verifyStorageBuckets();
    await initializeStorageBuckets();
    await initializeUsdtSystem();
    await setWebhook();
    try {
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'help', description: 'Mostrar ayuda' },
            { command: 'referidos', description: 'Obtener enlace de referidos' },
            { command: 'cupon', description: 'Verificar cupón de descuento' },
            { command: 'trialstatus', description: 'Ver estado de prueba gratuita' },
            { command: 'admin', description: 'Panel de administración (solo admins)' },
            { command: 'enviar', description: 'Enviar configuración (solo admins)' }
        ]);
        console.log('📝 Comandos del bot configurados');
    } catch (error) { console.error('❌ Error configurando comandos:', error); }
    startKeepAlive();
    console.log(`🎯 Prueba gratuita: Envío automático (1 hora) desde webapp`);
    console.log(`📊 Estadísticas: /api/stats`);
    console.log(`🎫 Sistema de cupones: Habilitado`);
    console.log(`💰 Sistema USDT: MODO MANUAL - Captura requerida`);
    console.log(`👥 Sistema de referidos: Habilitado`);
    console.log(`📁 Archivos automáticos: DESACTIVADO - Envío manual`);
    console.log(`📂 Archivos de prueba guardados localmente en: ${TRIAL_FILES_DIR}`);
});

process.on('uncaughtException', async (error) => { console.error('❌ Error no capturado:', error); });
process.on('unhandledRejection', async (reason, promise) => { console.error('❌ Promesa rechazada no manejada:', reason); });
process.on('SIGINT', () => { console.log('\n👋 Cerrando...'); bot.telegram.deleteWebhook().catch(() => {}); process.exit(0); });

function startKeepAlive() {
    const PORT_LOCAL = PORT;
    const EXTERNAL_URL = process.env.WEBAPP_URL || `http://localhost:${PORT_LOCAL}`;
    const healthCheckUrl = `http://localhost:${PORT_LOCAL}/api/health`;

    setInterval(async () => {
        try {
            const response = await fetch(healthCheckUrl);
            if (response.ok) console.log(`💓 Keep-alive interno OK [${new Date().toLocaleTimeString()}]`);
        } catch (error) { console.error('⚠️ Keep-alive interno falló:', error.message); }
    }, 4 * 60 * 1000);

    setInterval(async () => {
        try {
            const response = await fetch(`${EXTERNAL_URL}/api/health`);
            if (response.ok) console.log(`🌐 Keep-alive externo OK [${new Date().toLocaleTimeString()}]`);
        } catch (error) { console.error('⚠️ Keep-alive externo falló:', error.message); }
    }, 10 * 60 * 1000);

    setInterval(async () => {
        try {
            await fetch(`${healthCheckUrl}?t=${Date.now()}`);
            console.log(`🔄 Keep-alive variado OK [${new Date().toLocaleTimeString()}]`);
        } catch (error) { /* silencioso */ }
    }, 8 * 60 * 1000);

    console.log(`🔄 Keep-alive INTENSO iniciado (capas: 4min + 8min + 10min) → ${EXTERNAL_URL}`);
}

module.exports = { app, isAdmin, ADMIN_IDS, initializeStorageBuckets, initializeUsdtSystem, sendTrialToValidUsers };
