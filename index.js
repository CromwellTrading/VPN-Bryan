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

const PORT = process.env.PORT || 3000;

// Cliente Supabase Admin para crear buckets (usando service_role)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// IDs de administradores (AGREGADO NUEVO ID)
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604', '6974850309'];  // NUEVO ID AÑADIDO

// ==================== CONFIGURACIÓN USDT (MODIFICADA) ====================
const USDT_CONFIG = {
    // Dirección fija USDT (BEP20)
    WALLET_ADDRESS: '0x55B81bD7df1b0c6Db33fD532207CF2Bf137C1519',
    // API Key de BSCScan - DESACTIVADA PARA FLUJO MANUAL
    BSCSCAN_API_KEY: '', // Vacía para desactivar verificación automática
    // Contrato USDT en BSC (BEP20)
    USDT_CONTRACT_ADDRESS: '0x55d398326f99059ff775485246999027b3197955',
    // Tiempo de verificación (desactivado)
    CHECK_INTERVAL: 0, // 0 para desactivar
    // Mínimo de confirmaciones requeridas
    MIN_CONFIRMATIONS: 3
};

// Precios USDT por plan
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
        // Intentar enviar un mensaje silencioso de prueba
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

// Configurar multer para subir imágenes y archivos
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

// Crear carpetas necesarias
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });

// Función auxiliar para nombres de planes
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

// Función para generar dirección USDT fija
function generateUniqueUsdtAddress() {
    return USDT_CONFIG.WALLET_ADDRESS;
}

// Función para formatear fecha
function formatearFecha(fecha) {
    if (!fecha) return 'N/A';
    
    // Intentar diferentes formatos de fecha
    try {
        const date = new Date(fecha);
        
        // Verificar si es una fecha válida
        if (isNaN(date.getTime())) {
            console.log(`⚠️ Fecha inválida: ${fecha}`);
            return 'Fecha inválida';
        }
        
        // Formatear con múltiples formatos para compatibilidad
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
        console.error(`❌ Error formateando fecha ${fecha}:`, error);
        return 'Error fecha';
    }
}

// ==================== FUNCIONES DE VERIFICACIÓN USDT (MODIFICADAS) ====================

// Función para verificar transacciones USDT en BSCScan (DESACTIVADA)
async function checkUsdtTransactions() {
    console.log('⚠️ Verificación automática USDT desactivada - Flujo manual activado');
    return { success: true, message: 'Verificación automática desactivada - Flujo manual' };
}

// Inicializar sistema USDT (DESACTIVADO)
async function initializeUsdtSystem() {
    console.log('💸 Sistema USDT inicializado en modo MANUAL');
    console.log('📝 Todos los pagos USDT requieren captura y aprobación manual');
    
    // Informar sobre el modo manual
    if (!USDT_CONFIG.BSCSCAN_API_KEY) {
        console.log('✅ Sistema USDT en modo manual - No se requiere API Key');
    }
    
    if (!USDT_CONFIG.WALLET_ADDRESS) {
        console.log('⚠️ Dirección USDT no configurada.');
    }
    
    console.log('✅ Sistema USDT inicializado en modo manual');
}

// ==================== CREACIÓN DE BUCKETS ====================
async function createStorageBucket(bucketName, isPublic = true) {
  try {
    console.log(`📦 Intentando crear bucket: ${bucketName}`);
    
    // Verificar si el bucket ya existe
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
    
    // Crear el nuevo bucket
    const { data, error } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: isPublic,
      allowedMimeTypes: null, // Permitir todos los tipos
      fileSizeLimit: 20971520, // 20MB
      avifAutodetection: false
    });
    
    if (error) {
      console.error(`❌ Error creando bucket ${bucketName}:`, error.message);
      
      // Intentar método alternativo usando fetch directo
      return await createBucketViaAPI(bucketName, isPublic);
    }
    
    console.log(`✅ Bucket ${bucketName} creado exitosamente`);
    return { success: true, data };
    
  } catch (error) {
    console.error(`❌ Error en createStorageBucket para ${bucketName}:`, error.message);
    return { success: false, error: error.message };
  }
}

// Función para verificar y crear buckets automáticamente
async function verifyStorageBuckets() {
  try {
    console.log('🔍 Verificando buckets de almacenamiento...');
    
    const buckets = ['payments-screenshots', 'plan-files', 'trial-files'];
    
    for (const bucketName of buckets) {
      try {
        // Intentar listar archivos para verificar si el bucket existe
        const { data, error } = await supabaseAdmin.storage
          .from(bucketName)
          .list();
        
        if (error && error.message.includes('not found')) {
          console.log(`📦 Bucket ${bucketName} no existe, creando...`);
          
          // Intentar crear el bucket
          const { data: bucketData, error: createError } = await supabaseAdmin.storage
            .createBucket(bucketName, {
              public: true,
              allowedMimeTypes: null,
              fileSizeLimit: 20971520 // 20MB
            });
          
          if (createError) {
            console.error(`❌ Error creando bucket ${bucketName}:`, createError.message);
          } else {
            console.log(`✅ Bucket ${bucketName} creado exitosamente`);
          }
        } else if (error) {
          console.error(`⚠️ Error verificando bucket ${bucketName}:`, error.message);
        } else {
          console.log(`✅ Bucket ${bucketName} existe y es accesible`);
        }
      } catch (bucketError) {
        console.error(`⚠️ Error procesando bucket ${bucketName}:`, bucketError.message);
      }
    }
  } catch (error) {
    console.error('❌ Error en verifyStorageBuckets:', error.message);
  }
}

// Método alternativo usando API REST directa
async function createBucketViaAPI(bucketName, isPublic = true) {
  try {
    console.log(`🔄 Intentando crear bucket via API REST: ${bucketName}`);
    
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
    console.error(`❌ Error en createBucketViaAPI:`, error.message);
    return { success: false, error: error.message };
  }
}

// Función para inicializar todos los buckets necesarios
async function initializeStorageBuckets() {
  console.log('🚀 Inicializando buckets de almacenamiento...');
  
  const buckets = [
    { name: 'payments-screenshots', public: true },
    { name: 'plan-files', public: true },
    { name: 'trial-files', public: true }
  ];
  
  for (const bucket of buckets) {
    const result = await createStorageBucket(bucket.name, bucket.public);
    
    if (result.success) {
      console.log(`✅ Bucket ${bucket.name} listo`);
    } else {
      console.log(`⚠️ Bucket ${bucket.name} no pudo crearse: ${result.error}`);
    }
  }
  
  console.log('✅ Inicialización de buckets completada');
}

// ==================== FUNCIONES AUXILIARES DEL BOT ====================

// Función para calcular días restantes según el plan
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

// ==================== FUNCIONES DE ENVÍO MEJORADAS ====================

// Función mejorada para enviar pruebas pendientes
async function sendTrialToValidUsers(adminId) {
  try {
    console.log('🎯 Enviando pruebas solo a usuarios disponibles...');
    
    // Obtener pruebas pendientes
    const pendingTrials = await db.getPendingTrials();
    
    if (!pendingTrials || pendingTrials.length === 0) {
      console.log('📭 No hay pruebas pendientes');
      return { success: true, message: 'No hay pruebas pendientes' };
    }
    
    console.log(`📋 ${pendingTrials.length} pruebas pendientes encontradas`);
    
    let sentCount = 0;
    let failedCount = 0;
    let unavailableCount = 0;
    
    for (let i = 0; i < pendingTrials.length; i++) {
      const user = pendingTrials[i];
      
      try {
        if (!user.telegram_id) {
          console.log(`⚠️ Usuario sin telegram_id, saltando`);
          failedCount++;
          continue;
        }
        
        console.log(`🎁 Procesando prueba para ${user.telegram_id} (${i+1}/${pendingTrials.length})`);
        
        // Verificar si el usuario puede recibir mensajes
        const canSend = await canSendMessageToUser(user.telegram_id);
        
        if (!canSend.canSend) {
          console.log(`❌ Usuario ${user.telegram_id} no disponible para prueba: ${canSend.reason}`);
          unavailableCount++;
          failedCount++;
          
          // Marcar como inactivo si es error permanente
          if (canSend.reason.includes('chat not found') || 
              canSend.reason.includes('blocked')) {
            try {
              await db.updateUser(user.telegram_id, {
                is_active: false,
                last_error: canSend.reason,
                updated_at: new Date().toISOString()
              });
            } catch (updateError) {
              console.log(`⚠️ Error actualizando usuario ${user.telegram_id}:`, updateError.message);
            }
          }
          continue;
        }
        
        // Usuario disponible, enviar prueba
        await sendTrialConfigToUser(user.telegram_id, adminId);
        sentCount++;
        
        // Pequeña pausa
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        failedCount++;
        console.error(`❌ Error procesando prueba para ${user.telegram_id}:`, error.message);
      }
    }
    
    console.log(`✅ Envío de pruebas completado: ${sentCount} enviadas, ${failedCount} fallidas, ${unavailableCount} no disponibles`);
    
    return {
      success: true,
      sent: sentCount,
      failed: failedCount,
      unavailable: unavailableCount,
      total: pendingTrials.length
    };
    
  } catch (error) {
    console.error('❌ Error en sendTrialToValidUsers:', error);
    return { success: false, error: error.message };
  }
}

// Función auxiliar para enviar prueba a un usuario específico
async function sendTrialConfigToUser(telegramId, adminId) {
  try {
    const user = await db.getUser(telegramId);
    
    if (!user) {
      throw new Error(`Usuario ${telegramId} no encontrado`);
    }
    
    // Buscar archivo de prueba
    const planFile = await db.getPlanFile('trial');
    
    if (planFile && planFile.public_url) {
      const fileName = planFile.original_name || 'config_trial.conf';
      const gameServer = user.trial_game_server || 'No especificado';
      const connectionType = user.trial_connection_type || 'No especificado';
      
      await bot.telegram.sendDocument(
        telegramId,
        planFile.public_url,
        {
          caption: `🎁 *¡Tu prueba gratuita de VPN Cuba está lista!*\n\n` +
                  `📁 *Archivo de configuración para 1 hora de prueba*\n\n` +
                  `🎮 *Juego/Servidor:* ${gameServer}\n` +
                  `📡 *Conexión:* ${connectionType}\n\n` +
                  `*Instrucciones de instalación:*\n` +
                  `1. Descarga este archivo\n` +
                  `2. Importa el archivo .conf en tu cliente WireGuard\n` +
                  `3. Activa la conexión\n` +
                  `4. ¡Disfruta de 1 hora de prueba gratis! 🎉\n\n` +
                  `⏰ *Duración:* 1 hora\n` +
                  `*Importante:* Esta configuración expirará en 1 hora.`,
          parse_mode: 'Markdown'
        }
      );
      
      await db.markTrialAsSent(telegramId, adminId);
      
      console.log(`✅ Prueba enviada a ${telegramId}`);
      return true;
    } else {
      console.log(`❌ No hay archivo de prueba disponible para ${telegramId}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error enviando prueba a ${telegramId}:`, error.message);
    throw error;
  }
}

// ==================== RUTAS DE LA API ====================

// 1. Verificar si es administrador
app.get('/api/check-admin/:telegramId', (req, res) => {
  const isAdminUser = isAdmin(req.params.telegramId);
  res.json({ isAdmin: isAdminUser });
});

// 2. Aceptar términos
app.post('/api/accept-terms', async (req, res) => {
  try {
    const { telegramId, username, firstName, referrerId, referrerUsername } = req.body;
    
    const userData = {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      accepted_terms: true,
      terms_date: new Date().toISOString(),
      is_active: true // Por defecto activo al registrarse
    };

    // Si hay referidor, guardarlo
    if (referrerId) {
      userData.referrer_id = referrerId;
      userData.referrer_username = referrerUsername;
      
      // Crear registro de referido
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

// 3. Verificar términos aceptados
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

// 4. Procesar pago - MODIFICADO PARA REQUERIR CAPTURA EN TODOS LOS MÉTODOS
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

    // REQUERIR CAPTURA PARA TODOS LOS MÉTODOS, INCLUIDO USDT
    if (!req.file) {
      return res.status(400).json({ error: 'Captura de pantalla requerida para todos los métodos de pago' });
    }

    let screenshotUrl = '';
    if (req.file) {
      // Subir imagen a Supabase Storage
      try {
        screenshotUrl = await db.uploadImage(req.file.path, telegramId);
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('❌ Error eliminando archivo local:', err);
        });
      } catch (uploadError) {
        screenshotUrl = `/uploads/${req.file.filename}`;
      }
    }

    // Obtener información del usuario
    const user = await db.getUser(telegramId);
    const username = user?.username ? `@${user.username}` : 'Sin usuario';
    const firstName = user?.first_name || 'Usuario';

    // Verificar cupón si se proporcionó
    let couponUsed = false;
    let couponDiscount = 0;
    let finalPrice = parseFloat(price);
    let appliedCoupon = null;
    
    if (couponCode && couponCode.trim() !== '') {
      try {
        console.log(`🎫 Verificando cupón: ${couponCode.toUpperCase()}`);
        const coupon = await db.getCoupon(couponCode.toUpperCase());
        
        if (coupon) {
          console.log(`🔍 Cupón encontrado: ${JSON.stringify(coupon, null, 2)}`);
          
          // Verificar si el cupón está activo
          if (coupon.status !== 'active') {
            console.log(`⚠️ Cupón no activo: ${couponCode}, estado: ${coupon.status}`);
          } 
          // Verificar si ha expirado
          else if (coupon.expiry && new Date(coupon.expiry) < new Date()) {
            console.log(`⚠️ Cupón expirado: ${couponCode}, expiry: ${coupon.expiry}`);
            await db.updateCouponStatus(couponCode.toUpperCase(), 'expired', 'system');
          } 
          // Verificar si hay stock disponible
          else if (coupon.stock <= 0) {
            console.log(`⚠️ Cupón agotado: ${couponCode}, stock: ${coupon.stock}`);
          } 
          // Verificar si el usuario ya usó este cupón
          else if (await db.hasUserUsedCoupon(telegramId, couponCode.toUpperCase())) {
            console.log(`⚠️ Usuario ya usó este cupón: ${couponCode}`);
          } 
          // Cupón válido
          else {
            couponUsed = true;
            couponDiscount = coupon.discount;
            appliedCoupon = coupon;
            
            // Calcular precio con descuento
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

    // Guardar pago en base de datos - Asegurándonos de incluir telegram_id y datos del cupón
    const payment = await db.createPayment({
      telegram_id: telegramId, // ¡IMPORTANTE: Incluir telegram_id!
      plan: plan,
      price: finalPrice,
      original_price: parseFloat(price), // Guardar precio original
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

    // Notificar a admins - MENSAJE UNIFICADO PARA TODOS LOS MÉTODOS
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

    // Si es pago USDT, informar sobre flujo manual
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
        
        // NO crear pago USDT separado - Solo el pago regular con screenshot
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

// 5. Obtener pagos pendientes
app.get('/api/payments/pending', async (req, res) => {
  try {
    const payments = await db.getPendingPayments();
    
    const paymentsWithUsers = await Promise.all(payments.map(async (payment) => {
      const user = await db.getUser(payment.telegram_id);
      return {
        ...payment,
        user: user || null
      };
    }));
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pagos pendientes:', error);
    res.status(500).json({ error: 'Error obteniendo pagos pendientes' });
  }
});

// 6. Obtener pagos aprobados - ACTUALIZADO PARA INCLUIR INFORMACIÓN DE CUPONES
app.get('/api/payments/approved', async (req, res) => {
  try {
    const payments = await db.getApprovedPayments();
    
    const paymentsWithUsers = await Promise.all(payments.map(async (payment) => {
      const user = await db.getUser(payment.telegram_id);
      return {
        ...payment,
        user: user || null
      };
    }));
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pagos aprobados:', error);
    res.status(500).json({ error: 'Error obteniendo pagos aprobados' });
  }
});

// 7. Aprobar pago - MODIFICADO PARA NO ENVIAR CONFIGURACIÓN AUTOMÁTICAMENTE
app.post('/api/payments/:id/approve', async (req, res) => {
  try {
    const payment = await db.approvePayment(req.params.id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    console.log(`✅ Pago aprobado: ${payment.id}, telegram_id: ${payment.telegram_id}`);

    // Verificar que el pago tenga telegram_id
    if (!payment.telegram_id) {
      console.error(`❌ Pago ${payment.id} no tiene telegram_id`);
      return res.status(400).json({ error: 'El pago no tiene un usuario asociado (telegram_id)' });
    }

    // Aplicar cupón si se usó y tiene stock disponible
    if (payment.coupon_used && payment.coupon_code) {
      try {
        console.log(`🎫 Aplicando cupón ${payment.coupon_code} al pago ${payment.id}`);
        const coupon = await db.getCoupon(payment.coupon_code);
        
        if (coupon && coupon.stock > 0) {
          const applied = await db.applyCouponToPayment(payment.coupon_code, payment.telegram_id, payment.id);
          
          if (applied) {
            // Reducir stock del cupón
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

    // Notificar al usuario - NO ENVIAR ARCHIVO AUTOMÁTICO
    try {
      let userMessage = '🎉 *¡Tu pago ha sido aprobado!*\n\n' +
        'Ahora eres usuario VIP de VPN Cuba.\n' +
        'El administrador te enviará manualmente el archivo de configuración por este mismo chat en breve.\n\n';
      
      if (payment.coupon_used && payment.coupon_discount) {
        userMessage += `🎫 *Cupón aplicado:* ${payment.coupon_code} (${payment.coupon_discount}% descuento)\n`;
      }
      
      userMessage += '*Nota:* Sistema de envío automático desactivado.';
      
      await bot.telegram.sendMessage(
        payment.telegram_id,
        userMessage,
        { parse_mode: 'Markdown' }
      );
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    // Marcar usuario como VIP
    const user = await db.getUser(payment.telegram_id);
    if (!user.vip) {
      await db.makeUserVIP(payment.telegram_id, {
        plan: payment.plan,
        plan_price: payment.price,
        vip_since: new Date().toISOString()
      });
    }

    // Verificar si el usuario fue referido y actualizar referidos pagados
    if (user.referrer_id) {
      try {
        await db.markReferralAsPaid(payment.telegram_id);
        console.log(`✅ Referido ${payment.telegram_id} marcado como pagado`);
      } catch (refError) {
        console.log('⚠️ Error marcando referido como pagado:', refError.message);
      }
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error aprobando pago:', error);
    res.status(500).json({ error: 'Error aprobando pago' });
  }
});

// 8. Rechazar pago
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

    // Verificar que el pago tenga telegram_id
    if (!payment.telegram_id) {
      console.error(`❌ Pago ${payment.id} no tiene telegram_id`);
      return res.status(400).json({ error: 'El pago no tiene un usuario asociado (telegram_id)' });
    }

    // Notificar al usuario
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

// 9. Obtener estadísticas generales
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    
    // Obtener estadísticas adicionales de broadcasts
    const broadcasts = await db.getBroadcasts();
    const completedBroadcasts = broadcasts.filter(b => b.status === 'completed').length;
    
    // Agregar estadísticas de broadcasts a las estadísticas generales
    stats.broadcasts = {
      total: broadcasts.length,
      completed: completedBroadcasts,
      pending: broadcasts.filter(b => b.status === 'pending').length,
      sending: broadcasts.filter(b => b.status === 'sending').length,
      failed: broadcasts.filter(b => b.status === 'failed').length
    };
    
    // Información USDT - modo manual
    stats.usdt = {
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      verification_enabled: false,
      mode: 'manual',
      message: 'Todos los pagos USDT requieren captura y aprobación manual'
    };
    
    // Estadísticas de usuarios activos/inactivos
    const allUsers = await db.getAllUsers();
    const activeUsers = allUsers.filter(u => u.is_active !== false).length;
    const inactiveUsers = allUsers.filter(u => u.is_active === false).length;
    
    stats.users.active = activeUsers;
    stats.users.inactive = inactiveUsers;
    
    // Obtener estadísticas de cupones
    const coupons = await db.getCouponsStats();
    stats.coupons = coupons || { total: 0, active: 0, expired: 0, used: 0 };
    
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      error: 'Error obteniendo estadísticas',
      users: { total: 0, vip: 0, trial_requests: 0, trial_pending: 0, active: 0, inactive: 0 },
      payments: { pending: 0, approved: 0 },
      revenue: { total: 0 },
      broadcasts: { completed: 0 },
      coupons: { total: 0, active: 0, expired: 0, used: 0 }
    });
  }
});

// 10. Obtener usuarios VIP
app.get('/api/vip-users', async (req, res) => {
  try {
    const users = await db.getVIPUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios VIP:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios VIP' });
  }
});

// 11. Obtener todos los usuarios
app.get('/api/all-users', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios' });
  }
});

// 12. Obtener información de un pago específico
app.get('/api/payments/:id', async (req, res) => {
  try {
    const payment = await db.getPayment(req.params.id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    const user = await db.getUser(payment.telegram_id);
    
    res.json({
      ...payment,
      user: user || null
    });
  } catch (error) {
    console.error('❌ Error obteniendo pago:', error);
    res.status(500).json({ error: 'Error obteniendo pago' });
  }
});

// 13. Enviar archivo de configuración (para pagos aprobados) - CORREGIDO CON VALIDACIÓN DE chat_id
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
    
    // Obtener el pago usando el ID
    console.log(`🔍 Buscando pago con ID: ${paymentId}`);
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
    
    // Verificar que el pago esté aprobado
    if (payment.status !== 'approved') {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      console.error(`❌ Pago no está aprobado, estado: ${payment.status}`);
      return res.status(400).json({ error: 'El pago no está aprobado' });
    }
    
    // Obtener telegramId del pago - CORREGIDO: VALIDACIÓN COMPLETA
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
    
    // Convertir a string si es necesario
    const chatId = telegramId.toString().trim();
    console.log(`📤 Chat ID para envío: ${chatId}`);
    
    // Verificar si el usuario existe en la base de datos
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
      
      // Enviar archivo por Telegram
      await bot.telegram.sendDocument(
        chatId,
        { source: req.file.path, filename: req.file.originalname },
        {
          caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                  `📁 *Archivo:* ${req.file.originalname}\n` +
                  `📋 *Plan:* ${getPlanName(payment.plan)}\n` +
                  `${payment.coupon_used ? `🎫 *Cupón aplicado:* ${payment.coupon_code} (${payment.coupon_discount}% descuento)\n` : ''}` +
                  `\n*Instrucciones de instalación:*\n` +
                  `1. Descarga este archivo\n` +
                  `2. ${fileName.endsWith('.conf') ? 'Importa el archivo .conf directamente' : 'Descomprime el ZIP/RAR en tu dispositivo'}\n` +
                  `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                  `4. Activa la conexión\n` +
                  `5. ¡Disfruta de baja latencia! 🚀\n\n` +
                  `*Soporte:* Contacta con soporte si tienes problemas.`,
          parse_mode: 'Markdown'
        }
      );
      
      // Actualizar pago en la base de datos
      await db.updatePayment(paymentId, {
        config_sent: true,
        config_sent_at: new Date().toISOString(),
        config_file: req.file.filename,
        config_sent_by: adminId
      });
      
      // Verificar si el usuario ya es VIP, si no, hacerlo VIP
      if (user && !user.vip) {
        await db.makeUserVIP(chatId, {
          plan: payment.plan,
          plan_price: payment.price,
          vip_since: new Date().toISOString()
        });
        console.log(`✅ Usuario ${chatId} marcado como VIP`);
      }
      
      // Eliminar archivo temporal
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
      
      // Verificar si el error es específico de chat_id
      if (telegramError.message.includes('chat_id') || telegramError.message.includes('chat id') || 
          telegramError.message.includes('chat not found') || telegramError.message.includes('chat not exist')) {
        console.error(`❌ Error específico de chat_id para usuario ${chatId}:`, telegramError.message);
        
        // Marcar usuario como inactivo
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

// 14. Servir archivos subidos
app.use('/uploads', express.static(UPLOADS_DIR));

// 15. Obtener información del usuario
app.get('/api/user-info/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    const admin = isAdmin(req.params.telegramId);
    
    // Obtener estadísticas de referidos
    let referralStats = null;
    if (user.referrer_id) {
      referralStats = await db.getReferralStats(req.params.telegramId);
    }
    
    res.json({
      ...user,
      isAdmin: admin,
      referral_stats: referralStats
    });
  } catch (error) {
    console.error('❌ Error obteniendo información del usuario:', error);
    res.status(500).json({ error: 'Error obteniendo información del usuario' });
  }
});

// 16. Enviar mensaje a usuario (admin)
app.post('/api/send-message', async (req, res) => {
  try {
    const { telegramId, message, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    // Validar que telegramId sea válido
    if (!telegramId || telegramId === 'undefined' || telegramId === 'null' || telegramId === '') {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const chatId = telegramId.toString().trim();
    
    // Verificar si el usuario puede recibir mensajes
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

// 17. Remover VIP de usuario (admin) - CORREGIDO: Ruta específica
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
      // Verificar si el usuario puede recibir mensajes
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

// 18. Solicitar prueba gratuita (1 hora)
app.post('/api/request-trial', async (req, res) => {
  try {
    const { telegramId, username, firstName, trialType = '1h', gameServer, connectionType } = req.body;
    
    // Verificar elegibilidad para prueba
    const eligibility = await db.checkTrialEligibility(telegramId);
    
    if (!eligibility.eligible) {
      return res.status(400).json({ 
        error: `No puedes solicitar una prueba en este momento: ${eligibility.reason}` 
      });
    }
    
    // Guardar/actualizar usuario con solicitud de prueba
    const updatedUser = await db.saveUser(telegramId, {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      trial_requested: true,
      trial_requested_at: new Date().toISOString(),
      trial_plan_type: trialType,
      trial_game_server: gameServer || '',
      trial_connection_type: connectionType || '',
      is_active: true // Marcar como activo al solicitar prueba
    });
    
    // Notificar a TODOS los administradores
    const adminMessage = `🎯 *NUEVA SOLICITUD DE PRUEBA ${trialType.toUpperCase()}*\n\n` +
      `👤 *Usuario:* ${firstName}\n` +
      `📱 *Telegram:* ${username ? `@${username}` : 'Sin usuario'}\n` +
      `🆔 *ID:* ${telegramId}\n` +
      `🎮 *Juego/Servidor:* ${gameServer || 'No especificado'}\n` +
      `📡 *Conexión:* ${connectionType || 'No especificado'}\n` +
      `⏰ *Duración:* 1 hora\n` +
      `📅 *Fecha:* ${new Date().toLocaleString('es-ES')}`;
    
    for (const adminId of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, adminMessage, { 
          parse_mode: 'Markdown'
        });
      } catch (adminError) {
        console.log(`❌ No se pudo notificar al admin ${adminId}:`, adminError.message);
      }
    }
    
    // Enviar confirmación al usuario
    try {
      // Verificar si el usuario puede recibir mensajes
      const canSend = await canSendMessageToUser(telegramId);
      if (canSend.canSend) {
        await bot.telegram.sendMessage(
          telegramId,
          '✅ *Solicitud de prueba recibida*\n\n' +
          'Tu solicitud de prueba gratuita de 1 hora ha sido recibida.\n\n' +
          '📋 *Proceso:*\n' +
          '1. Un administrador revisará tu solicitud\n' +
          '2. Recibirás la configuración por este chat\n' +
          '3. Tendrás 1 hora de acceso completo\n\n' +
          '⏰ *Tiempo estimado:* Minutos\n\n' +
          '¡Gracias por probar VPN Cuba! 🚀',
          { parse_mode: 'Markdown' }
        );
      } else {
        console.log(`⚠️ Usuario ${telegramId} no disponible para notificación: ${canSend.reason}`);
      }
    } catch (userError) {
      console.log('❌ No se pudo notificar al usuario:', userError.message);
    }
    
    res.json({ 
      success: true, 
      message: 'Solicitud de prueba enviada. Recibirás la configuración por Telegram en minutos.',
      trialType: trialType,
      user: updatedUser
    });
  } catch (error) {
    console.error('❌ Error en solicitud de prueba:', error);
    res.status(500).json({ error: 'Error procesando solicitud de prueba: ' + error.message });
  }
});

// 19. Estadísticas de pruebas
app.get('/api/trial-stats', async (req, res) => {
  try {
    const stats = await db.getTrialStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de prueba:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de prueba' });
  }
});

// 20. Pruebas pendientes
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

// 21. Marcar prueba como enviada
app.post('/api/trials/:telegramId/mark-sent', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const user = await db.markTrialAsSent(req.params.telegramId, adminId);
    
    // Notificar al usuario
    try {
      // Verificar si el usuario puede recibir mensajes
      const canSend = await canSendMessageToUser(req.params.telegramId);
      if (canSend.canSend) {
        await bot.telegram.sendMessage(
          req.params.telegramId,
          '🎉 *¡Tu prueba gratuita está lista!*\n\n' +
          'Has recibido la configuración de prueba de 1 hora.\n' +
          '¡Disfruta de baja latencia! 🚀\n\n' +
          '*Nota:* Esta prueba expirará en 1 hora.',
          { parse_mode: 'Markdown' }
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

// 22. Enviar archivo de configuración de prueba
app.post('/api/send-trial-config', async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    // Validar que telegramId sea válido
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
    
    // Verificar si el usuario puede recibir mensajes
    const canSend = await canSendMessageToUser(chatId);
    if (!canSend.canSend) {
      // Marcar como inactivo si no puede recibir
      await db.updateUser(chatId, {
        is_active: false,
        last_error: canSend.reason
      });
      
      return res.status(400).json({ 
        error: `El usuario no puede recibir mensajes: ${canSend.reason}. Marcado como inactivo.` 
      });
    }
    
    // Buscar si hay archivo de prueba disponible
    const planFile = await db.getPlanFile('trial');
    
    if (planFile && planFile.public_url) {
      // Enviar archivo automáticamente
      const fileName = planFile.original_name || 'config_trial.conf';
      const gameServer = user.trial_game_server || 'No especificado';
      const connectionType = user.trial_connection_type || 'No especificado';
      
      await bot.telegram.sendDocument(
        chatId,
        planFile.public_url,
        {
          caption: `🎁 *¡Tu prueba gratuita de VPN Cuba está lista!*\n\n` +
                  `📁 *Archivo de configuración para 1 hora de prueba*\n\n` +
                  `🎮 *Juego/Servidor:* ${gameServer}\n` +
                  `📡 *Conexión:* ${connectionType}\n\n` +
                  `*Instrucciones de instalación:*\n` +
                  `1. Descarga este archivo\n` +
                  `2. Importa el archivo .conf en tu cliente WireGuard\n` +
                  `3. Activa la conexión\n` +
                  `4. ¡Disfruta de 1 hora de prueba gratis! 🎉\n\n` +
                  `⏰ *Duración:* 1 hora\n` +
                  `*Importante:* Esta configuración expirará en 1 hora.`,
          parse_mode: 'Markdown'
        }
      );
      
      await db.markTrialAsSent(chatId, adminId);
      
      res.json({ 
        success: true, 
        message: 'Configuración de prueba enviada automáticamente',
        filename: fileName,
        trialType: '1h',
        gameServer: gameServer,
        connectionType: connectionType
      });
      
    } else {
      // Notificar al admin que no hay archivo de prueba disponible
      res.status(404).json({ 
        error: 'No hay archivo de prueba disponible. Sube uno primero en "Archivos de Planes".' 
      });
    }
    
  } catch (error) {
    console.error('❌ Error en send-trial-config:', error);
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

// 23. Health check
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

// 24. Obtener imagen directa
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

// 25. Obtener estado de almacenamiento
app.get('/api/storage-status', async (req, res) => {
  try {
    const buckets = [];
    
    // Verificar payments-screenshots
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
    
    // Verificar plan-files
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

// 26. Crear broadcast
app.post('/api/broadcast/send', async (req, res) => {
  try {
    const { message, target, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    // Validar que el mensaje no esté vacío
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    
    // Validar que target sea válido
    const validTargets = ['all', 'vip', 'non_vip', 'trial_pending', 'trial_received', 'active', 'with_referrals', 'usdt_payers'];
    if (!validTargets.includes(target)) {
      return res.status(400).json({ error: 'Target de broadcast inválido' });
    }
    
    console.log(`📢 Creando broadcast para ${target} usuarios...`);
    
    // Crear broadcast en la base de datos
    const broadcast = await db.createBroadcast(message, target, adminId);
    
    if (!broadcast || !broadcast.id) {
      throw new Error('No se pudo crear el broadcast');
    }
    
    console.log(`✅ Broadcast creado con ID: ${broadcast.id}`);
    
    // Obtener usuarios según el target
    const users = await db.getUsersForBroadcast(target);
    
    console.log(`👥 ${users.length} usuarios encontrados para el broadcast`);
    
    // Actualizar broadcast con el total de usuarios
    await db.updateBroadcastStatus(broadcast.id, 'pending', {
      total_users: users.length
    });
    
    // Iniciar el envío en segundo plano
    setTimeout(() => {
      sendBroadcastToUsers(broadcast.id, message, users, adminId);
    }, 100);
    
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

// Función auxiliar para enviar broadcast a usuarios
async function sendBroadcastToUsers(broadcastId, message, users, adminId) {
  try {
    // Validar que broadcastId existe
    if (!broadcastId) {
      console.error('❌ ID de broadcast no proporcionado');
      return;
    }
    
    console.log(`🚀 Iniciando envío de broadcast ${broadcastId} a ${users.length} usuarios`);
    
    // Actualizar estado a "enviando"
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
          console.log(`⚠️ Usuario sin telegram_id, saltando`);
          failedCount++;
          continue;
        }
        
        console.log(`📨 Enviando a ${user.telegram_id} (${i+1}/${users.length})`);
        
        // Verificar si el usuario puede recibir mensajes
        const canSend = await canSendMessageToUser(user.telegram_id);
        
        if (!canSend.canSend) {
          console.log(`❌ Usuario ${user.telegram_id} no disponible: ${canSend.reason}`);
          unavailableCount++;
          failedCount++;
          
          // Marcar usuario como no disponible si es error permanente
          if (canSend.reason.includes('chat not found') || 
              canSend.reason.includes('blocked') || 
              canSend.reason.includes('kicked') ||
              canSend.reason.includes('user is deactivated')) {
            
            try {
              await db.updateUser(user.telegram_id, {
                is_active: false,
                last_error: canSend.reason,
                updated_at: new Date().toISOString()
              });
            } catch (updateError) {
              console.log(`⚠️ Error actualizando usuario ${user.telegram_id}:`, updateError.message);
            }
          }
          
          continue;
        }
        
        // Si puede recibir, enviar el mensaje
        await bot.telegram.sendMessage(
          user.telegram_id,
          `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${message}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte: @L0quen2_`,
          { parse_mode: 'Markdown' }
        );
        sentCount++;
        
        // Actualizar progreso cada 10 usuarios
        if ((i + 1) % 10 === 0 || i === users.length - 1) {
          console.log(`📊 Progreso: ${sentCount} enviados, ${failedCount} fallidos, ${unavailableCount} no disponibles`);
          await db.updateBroadcastStatus(broadcastId, 'sending', {
            sent_count: sentCount,
            failed_count: failedCount,
            unavailable_count: unavailableCount,
            total_users: users.length
          });
        }
        
        // Pequeña pausa para no saturar
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        failedCount++;
        failedUsers.push({
          telegram_id: user.telegram_id,
          error: error.message
        });
        
        // Si el usuario bloqueó al bot, continuar
        if (error.description && (
            error.description.includes('blocked') || 
            error.description.includes('chat not found') ||
            error.description.includes('kicked') ||
            error.description.includes('user is deactivated'))) {
          console.log(`❌ Usuario ${user.telegram_id} no disponible: ${error.description}`);
          
          // Marcar como inactivo en la base de datos
          try {
            await db.updateUser(user.telegram_id, {
              is_active: false,
              last_error: error.description,
              updated_at: new Date().toISOString()
            });
          } catch (updateError) {
            console.log(`⚠️ Error actualizando usuario ${user.telegram_id}:`, updateError.message);
          }
          continue;
        }
        
        console.error(`❌ Error enviando a ${user.telegram_id}:`, error.message);
      }
    }
    
    // Actualizar estado final
    console.log(`✅ Broadcast ${broadcastId} completado: ${sentCount} enviados, ${failedCount} fallidos, ${unavailableCount} no disponibles`);
    await db.updateBroadcastStatus(broadcastId, 'completed', {
      sent_count: sentCount,
      failed_count: failedCount,
      unavailable_count: unavailableCount,
      total_users: users.length
    });
    
  } catch (error) {
    console.error(`❌ Error crítico en broadcast ${broadcastId}:`, error);
    
    // Intentar actualizar el estado a fallido
    try {
      await db.updateBroadcastStatus(broadcastId, 'failed', {
        sent_count: 0,
        failed_count: users.length || 0,
        unavailable_count: 0,
        total_users: users.length || 0
      });
    } catch (updateError) {
      console.error('❌ Error actualizando estado de broadcast a fallido:', updateError);
    }
  }
}

// 27. Obtener todos los broadcasts
app.get('/api/broadcasts', async (req, res) => {
  try {
    const broadcasts = await db.getBroadcasts();
    res.json(broadcasts);
  } catch (error) {
    console.error('❌ Error obteniendo broadcasts:', error);
    res.status(500).json({ error: 'Error obteniendo broadcasts' });
  }
});

// 28. Obtener estado de un broadcast
app.get('/api/broadcast/status/:id', async (req, res) => {
  try {
    const broadcastId = req.params.id;
    
    // Validar que broadcastId sea un número
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

// 29. Reintentar broadcast fallido
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
    
    // Obtener usuarios para el broadcast
    const users = await db.getUsersForBroadcast(broadcast.target_users);
    
    // Iniciar el envío en segundo plano
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

// 30. Obtener usuarios activos
app.get('/api/users/active', async (req, res) => {
  try {
    const users = await db.getActiveUsers(30);
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios activos:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios activos' });
  }
});

// 31. Obtener un broadcast específico
app.get('/api/broadcast/:id', async (req, res) => {
  try {
    const broadcastId = req.params.id;
    
    // Validar que broadcastId sea un número
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

// 32. Obtener estadísticas generales de referidos
app.get('/api/referrals/stats', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de referidos:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de referidos' });
  }
});

// 33. Obtener top referidores
app.get('/api/referrals/top', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const topReferrers = stats.top_referrers || [];
    
    // Obtener información de usuario para cada referidor
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

// 34. Obtener lista de referidos con información
app.get('/api/referrals/list', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const referrals = stats.recent_referrals || [];
    
    // Obtener información de usuario para cada referido
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

// 35. Obtener estadísticas de referidos por usuario
app.get('/api/referrals/user/:telegramId', async (req, res) => {
  try {
    const stats = await db.getReferralStats(req.params.telegramId);
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de referidos por usuario:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de referidos por usuario' });
  }
});

// 36. Obtener usuarios con referidos
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

// 37. Obtener usuarios sin referidos
app.get('/api/users/without-referrals', async (req, res) => {
  try {
    const stats = await db.getAllReferralsStats();
    const allUsers = await db.getAllUsers();
    
    // Usuarios con referidos
    const usersWithReferrals = new Set(stats.top_referrers?.map(u => u.referrer_id) || []);
    
    // Filtrar usuarios sin referidos
    const usersWithoutReferrals = allUsers.filter(user => {
      return !usersWithReferrals.has(user.telegram_id.toString());
    });
    
    res.json(usersWithoutReferrals);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios sin referidos:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios sin referidos' });
  }
});

// 38. RUTAS API PARA USDT (MODIFICADAS)

// Verificar estado de wallet USDT
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

// Verificar transacción específica
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

// Forzar verificación de transacciones (para admins)
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

// Obtener transacciones no asignadas
app.get('/api/usdt/unassigned-transactions', async (req, res) => {
  try {
    res.json([]); // No hay transacciones no asignadas en modo manual
  } catch (error) {
    console.error('❌ Error obteniendo transacciones no asignadas:', error);
    res.status(500).json({ error: 'Error obteniendo transacciones no asignadas' });
  }
});

// 39. Subir archivo de plan
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
    
    // Leer archivo
    const fileBuffer = fs.readFileSync(req.file.path);
    
    // Subir archivo a Supabase Storage
    const uploadResult = await db.uploadPlanFile(fileBuffer, plan, req.file.originalname);
    
    // Eliminar archivo local
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('❌ Error al eliminar archivo local:', err);
    });
    
    // Guardar información del archivo en la base de datos
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

// 40. Subir archivo de prueba
app.post('/api/upload-trial-file', upload.single('file'), async (req, res) => {
  try {
    const { plan, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    // Validar que sea archivo de prueba
    if (plan !== 'trial') {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'Solo se permite subir archivos de prueba aquí' });
    }
    
    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar') && !fileName.endsWith('.conf')) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .conf, .zip o .rar' });
    }
    
    // Leer archivo
    const fileBuffer = fs.readFileSync(req.file.path);
    
    // Subir archivo a Supabase Storage
    const uploadResult = await db.uploadPlanFile(fileBuffer, 'trial', req.file.originalname);
    
    // Eliminar archivo local
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('❌ Error al eliminar archivo local:', err);
    });
    
    // Guardar información del archivo en la base de datos
    const planFileData = {
      plan: 'trial',
      storage_filename: uploadResult.filename,
      original_name: uploadResult.originalName,
      public_url: uploadResult.publicUrl,
      uploaded_by: adminId,
      uploaded_at: new Date().toISOString()
    };
    
    const savedFile = await db.savePlanFile(planFileData);
    
    res.json({ 
      success: true, 
      message: `Archivo de prueba subido correctamente`,
      file: savedFile
    });
    
  } catch (error) {
    console.error('❌ Error subiendo archivo de prueba:', error);
    
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error subiendo archivo de prueba: ' + error.message });
  }
});
  
// 41. Obtener todos los archivos de planes
app.get('/api/plan-files', async (req, res) => {
  try {
    const planFiles = await db.getAllPlanFiles();
    res.json(planFiles);
  } catch (error) {
    console.error('❌ Error obteniendo archivos de planes:', error);
    res.status(500).json({ error: 'Error obteniendo archivos de planes' });
  }
});

// 42. Obtener archivo de plan específico
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

// 43. Obtener archivo de prueba
app.get('/api/plan-files/trial', async (req, res) => {
  try {
    const planFile = await db.getPlanFile('trial');
    
    if (!planFile) {
      return res.status(404).json({ error: 'Archivo de prueba no encontrado' });
    }
    
    res.json(planFile);
  } catch (error) {
    console.error('❌ Error obteniendo archivo de prueba:', error);
    res.status(500).json({ error: 'Error obteniendo archivo de prueba' });
  }
});

// 44. Eliminar archivo de plan
app.delete('/api/plan-files/:plan', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const deletedFile = await db.deletePlanFile(req.params.plan);
    
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

// 45. Obtener estadísticas de juegos/servidores
app.get('/api/games-stats', async (req, res) => {
  try {
    const stats = await db.getGamesStatistics();
    res.json(stats.games || []);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de juegos:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de juegos' });
  }
});

// 46. Obtener detalles de usuario (para admin)
app.get('/api/user/:telegramId/details', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Obtener estadísticas de referidos
    const referralStats = await db.getReferralStats(req.params.telegramId);
    
    // Obtener pagos del usuario
    const payments = await db.getUserPayments(req.params.telegramId);
    
    // Obtener referidos del usuario
    const referrals = await db.getReferralsByReferrer(req.params.telegramId);
    
    res.json({
      user: user,
      referral_stats: referralStats,
      payments: payments || [],
      referrals: referrals || [],
      level1_referrals: referrals?.filter(r => r.level === 1).length || 0,
      level2_referrals: referrals?.filter(r => r.level === 2).length || 0,
      level1_paid: referrals?.filter(r => r.level === 1 && r.has_paid).length || 0,
      level2_paid: referrals?.filter(r => r.level === 2 && r.has_paid).length || 0
    });
  } catch (error) {
    console.error('❌ Error obteniendo detalles de usuario:', error);
    res.status(500).json({ error: 'Error obteniendo detalles de usuario' });
  }
});

// 47. Mensaje directo a usuario desde admin
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
    
    // Validar que userId sea válido
    if (!userId || userId === 'undefined' || userId === 'null' || userId === '') {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }
    
    const chatId = userId.toString().trim();
    
    // Verificar si el usuario puede recibir mensajes
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

// 48. Ruta mejorada para enviar pruebas a usuarios disponibles
app.post('/api/send-trials-to-valid', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`🚀 Iniciando envío de pruebas solo a usuarios disponibles...`);
    
    // Usar la función mejorada
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

// 49. Crear un nuevo cupón
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
    
    // Validar código
    if (!/^[A-Z0-9]+$/.test(code)) {
      console.log('❌ CÓDIGO INVÁLIDO:', code);
      return res.status(400).json({ error: 'El código solo puede contener letras mayúsculas y números' });
    }
    
    // Validar descuento
    const discountNum = parseFloat(discount);
    if (isNaN(discountNum) || discountNum < 1 || discountNum > 100) {
      console.log('❌ DESCUENTO INVÁLIDO:', discount);
      return res.status(400).json({ error: 'El descuento debe estar entre 1% y 100%' });
    }
    
    // Validar stock
    const stockNum = parseInt(stock);
    if (isNaN(stockNum) || stockNum < 1) {
      console.log('❌ STOCK INVÁLIDO:', stock);
      return res.status(400).json({ error: 'El stock debe ser mayor a 0' });
    }
    
    // Validar fecha de expiración si se proporciona
    let expiryDate = null;
    if (expiry) {
      // Intentar diferentes formatos de fecha
      const dateFormats = [
        expiry, // Formato original
        expiry.replace('T', ' '), // Para fechas ISO con T
        new Date(expiry).toISOString().split('T')[0], // Solo fecha YYYY-MM-DD
        new Date(expiry).toISOString() // ISO completo
      ];
      
      for (const dateStr of dateFormats) {
        expiryDate = new Date(dateStr);
        if (!isNaN(expiryDate.getTime())) {
          break;
        }
      }
      
      if (isNaN(expiryDate.getTime())) {
        console.log('❌ FECHA DE EXPIRACIÓN INVÁLIDA:', expiry);
        return res.status(400).json({ error: 'Fecha de expiración inválida' });
      }
      
      // Asegurar que la fecha de expiración sea en el futuro
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
    
    // Crear cupón
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

// 50. Obtener todos los cupones
app.get('/api/coupons', async (req, res) => {
  try {
    const coupons = await db.getCoupons();
    res.json(coupons);
  } catch (error) {
    console.error('❌ Error obteniendo cupones:', error);
    res.status(500).json({ error: 'Error obteniendo cupones' });
  }
});

// 51. Obtener estadísticas de cupones
app.get('/api/coupons/stats', async (req, res) => {
  try {
    const stats = await db.getCouponsStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de cupones:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de cupones' });
  }
});

// 52. Obtener un cupón específico
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

// 53. Actualizar cupón
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
    
    // Validar stock si se proporciona
    let stockNum = coupon.stock;
    if (stock !== undefined) {
      stockNum = parseInt(stock);
      if (isNaN(stockNum) || stockNum < 0) {
        return res.status(400).json({ error: 'Stock inválido' });
      }
    }
    
    // Validar estado si se proporciona
    let newStatus = coupon.status;
    if (status && ['active', 'inactive', 'expired'].includes(status)) {
      newStatus = status;
    }
    
    // Actualizar cupón
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

// 54. Cambiar estado de cupón
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
    
    // Actualizar estado
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

// 55. Eliminar cupón
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
    
    // Verificar si el cupón ha sido usado
    if (coupon.used && coupon.used > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar un cupón que ha sido usado. Puedes desactivarlo en su lugar.' 
      });
    }
    
    // Eliminar cupón
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

// 56. Verificar cupón (para uso en pagos)
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
    
    // Verificar si el cupón está activo
    if (coupon.status !== 'active') {
      console.log(`⚠️ Cupón no activo: ${coupon.status}`);
      return res.json({ 
        success: false, 
        error: `Cupón ${coupon.status === 'expired' ? 'expirado' : 'inactivo'}` 
      });
    }
    
    // Verificar si ha expirado
    if (coupon.expiry) {
      const expiryDate = new Date(coupon.expiry);
      const now = new Date();
      
      console.log(`📅 Expiración: ${expiryDate}, Ahora: ${now}`);
      
      if (expiryDate < now) {
        console.log(`⚠️ Cupón expirado`);
        // Actualizar estado a expirado
        await db.updateCouponStatus(code, 'expired', 'system');
        return res.json({ 
          success: false, 
          error: 'Cupón expirado' 
        });
      }
    }
    
    // Verificar si hay stock disponible
    if (coupon.stock <= 0) {
      console.log(`⚠️ Cupón agotado, stock: ${coupon.stock}`);
      return res.json({ 
        success: false, 
        error: 'Cupón agotado' 
      });
    }
    
    // Verificar si el usuario ya usó este cupón
    const hasUsed = await db.hasUserUsedCoupon(telegramId, code);
    if (hasUsed) {
      console.log(`⚠️ Usuario ya usó este cupón`);
      return res.json({ 
        success: false, 
        error: 'Ya has usado este cupón' 
      });
    }
    
    // Cupón válido
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

// 57. Aplicar cupón a un pago
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
    
    // Verificar si el cupón está activo
    if (coupon.status !== 'active') {
      return res.status(400).json({ 
        error: `Cupón ${coupon.status === 'expired' ? 'expirado' : 'inactivo'}` 
      });
    }
    
    // Verificar si ha expirado
    if (coupon.expiry && new Date(coupon.expiry) < new Date()) {
      await db.updateCouponStatus(code, 'expired', 'system');
      return res.status(400).json({ error: 'Cupón expirado' });
    }
    
    // Verificar si hay stock disponible
    if (coupon.stock <= 0) {
      return res.status(400).json({ error: 'Cupón agotado' });
    }
    
    // Verificar si el usuario ya usó este cupón
    const hasUsed = await db.hasUserUsedCoupon(telegramId, code);
    if (hasUsed) {
      return res.status(400).json({ error: 'Ya has usado este cupón' });
    }
    
    // Aplicar cupón al pago
    const applied = await db.applyCouponToPayment(code, telegramId, paymentId);
    
    if (!applied) {
      return res.status(400).json({ error: 'No se pudo aplicar el cupón al pago' });
    }
    
    // Reducir stock del cupón
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

// 58. Obtener historial de uso de cupones
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

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Ruta para planes
app.get('/plans.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/plans.html'));
});

// Ruta para pago
app.get('/payment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/payment.html'));
});

// Ruta para admin
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// ==================== BOT DE TELEGRAM ====================

// Manejador global de errores del bot
bot.catch((err, ctx) => {
  console.error('❌ Error no manejado en el bot:', err);
  // Aquí podrías notificar a los admins, pero no interrumpimos el flujo
});

// ==================== ACCIONES INLINE ====================

// Acción: mostrar soporte con dos contactos
bot.action('show_support', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply(
      `🆘 *SOPORTE TÉCNICO*\n\n` +
      `Para cualquier duda o problema, contacta con nuestro soporte:\n\n` +
      `👉 @L0quen2\n` +
      `👉 @ErenJeager129182\n\n` +
      `Responde rápido y te ayudaremos.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💬 IR AL SOPORTE (L0quen2)', url: 'https://t.me/L0quen2' },
              { text: '💬 IR AL SOPORTE (Eren)', url: 'https://t.me/ErenJeager129182' }
            ],
            [
              { text: '💬 IR AL SOPORTE WHATSAPP', url: 'https://wa.me/message/3LUGXYGD55UBO1' }
            ],
            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Error en show_support:', error);
    await ctx.answerCbQuery('❌ Error al abrir soporte.');
  }
});

// Acción: ver estado (mi perfil)
bot.action('check_status', async (ctx) => {
  const userId = ctx.from.id.toString();
  const firstName = ctx.from.first_name;
  const esAdmin = isAdmin(userId);
  
  try {
    const user = await db.getUser(userId);
    
    if (!user) {
      await ctx.reply(
        `❌ *NO ESTÁS REGISTRADO*\n\n` +
        `Usa el botón "VER PLANES" para registrarte y comenzar.`,
        { parse_mode: 'Markdown' }
      );
      await ctx.answerCbQuery();
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
      
      if (diasRestantes <= 7) {
        mensajeEstado += `⚠️ *TU PLAN ESTÁ POR EXPIRAR PRONTO*\n`;
        mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
      } else {
        mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
      }
      
      const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
      await ctx.reply(
        mensajeEstado,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 VER PLANES', web_app: { url: webappUrl } }],
              [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
            ]
          }
        }
      );
    } else {
      const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
      await ctx.reply(
        `❌ *NO ERES USUARIO VIP*\n\n` +
        `Actualmente no tienes acceso a los servicios premium.\n\n` +
        `Haz clic en el botón para ver nuestros planes.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 VER PLANES', web_app: { url: webappUrl } }],
              [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
            ]
          }
        }
      );
    }
    await ctx.answerCbQuery();
  } catch (error) {
    console.error('❌ Error en check_status:', error);
    await ctx.reply(`❌ Error al verificar tu estado.`);
    await ctx.answerCbQuery();
  }
});

// Acción: descargar WireGuard
bot.action('download_wireguard', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
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
        inline_keyboard: [
          [
            { text: '💻 WINDOWS', url: 'https://www.wireguard.com/install/' },
            { text: '📱 ANDROID', url: 'https://play.google.com/store/apps/details?id=com.wireguard.android' }
          ],
          [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
        ]
      }
    }
  );
});

// Acción: información de referidos
bot.action('referral_info', async (ctx) => {
  const userId = ctx.from.id.toString();
  const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
  
  try {
    const user = await db.getUser(userId);
    let referralStats = null;
    
    if (user) {
      try {
        referralStats = await db.getReferralStats(userId);
      } catch (statsError) {
        console.error('❌ Error obteniendo estadísticas de referidos:', statsError);
      }
    }
    
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
      message += `• Referidos directos (Nivel 1): ${referralStats.level1?.total || 0} (${referralStats.level1?.paid || 0} pagados)\n`;
      message += `• Referidos nivel 2: ${referralStats.level2?.total || 0} (${referralStats.level2?.paid || 0} pagados)\n`;
      message += `• Descuento total acumulado: ${referralStats.discount_percentage || 0}%\n\n`;
    } else {
      message += `*Tus estadísticas:*\n`;
      message += `• Aún no tienes referidos. ¡Comparte tu enlace y empieza a ganar!\n\n`;
    }
    
    message += `¡Cada vez que un referido pague, tu descuento aumentará! 🎉`;
    
    await ctx.answerCbQuery();
    await ctx.reply(
      message,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 COPIAR ENLACE', callback_data: 'copy_referral_link' }],
            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Error en referral_info:', error);
    await ctx.answerCbQuery();
    await ctx.reply(
      `🤝 *SISTEMA DE REFERIDOS*\n\n` +
      `Tu enlace de referido:\n\`${referralLink}\`\n\n` +
      `Comparte este enlace con tus amigos y obtén descuentos.\n\n` +
      `*Nota:* No se pudieron cargar las estadísticas en este momento, pero el enlace sigue activo.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 COPIAR ENLACE', callback_data: 'copy_referral_link' }],
            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  }
});

// Acción: cómo funciona
bot.action('how_it_works', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🚀 *¡OPTIMIZA TU CONEXIÓN AL MÁXIMO NIVEL!*\n\n` +
    `Nuestras configuraciones Wireguard crean un túnel ultra rápido y directo hacia los servidores del juego, eliminando los saltos innecesarios que causan el lag. ⚡\n\n` +
    `*¿Cómo lo logramos?*\n\n` +
    `1️⃣ *Rutas VIP*: Tu tráfico viaja por una 'vía rápida' privada, evitando la saturación de tu proveedor de internet.\n` +
    `2️⃣ *Tecnología Wireguard*: Es el protocolo más veloz del mundo; procesa datos casi al instante sin calentar tu celular.\n\n` +
    `⚠️ *REQUISITO IMPORTANTE:*\n` +
    `Para que esta configuración haga su magia, necesitas tener una conexión a internet estable. 📶\n` +
    `Wireguard optimiza y estabiliza tu ping, pero no puede arreglar un internet que se desconecta o que tiene una velocidad base excesivamente baja.\n\n` +
    `Si tu internet es decente pero el juego te va mal, ¡nosotros somos la pieza que te falta para llegar a los 50-70ms constantes! 🏎️💨\n\n` +
    `¡Mejora tu respuesta en las Teamfights hoy mismo! Dale al botón de Ver planes y elige tu plan.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
        ]
      }
    }
  );
});

// Acción: menú principal
bot.action('main_menu', async (ctx) => {
  const userId = ctx.from.id.toString();
  const firstName = ctx.from.first_name;
  const esAdmin = isAdmin(userId);
  
  const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
  
  // Enviamos un nuevo mensaje con el inline keyboard
  await ctx.reply(
    `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
    `Selecciona una opción:`,
    {
      parse_mode: 'Markdown',
      ...keyboard
    }
  );
  await ctx.answerCbQuery();
});

// Acción: copiar enlace de referido
bot.action('copy_referral_link', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
    
    await ctx.answerCbQuery('📋 Enlace listo para copiar');
    
    await ctx.reply(
      `📋 *Enlace de referido:*\n\n\`${referralLink}\`\n\n` +
      `Para copiar, mantén presionado el enlace y selecciona "Copiar".`,
      { 
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.callbackQuery.message.message_id
      }
    );
  } catch (error) {
    console.error('❌ Error en copy_referral_link:', error);
    await ctx.answerCbQuery('❌ Error, intenta nuevamente');
  }
});

// Acción: Políticas (ya existente, la mantenemos)
bot.action('politicas', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
    
    await ctx.answerCbQuery('📜 Abriendo políticas del servicio...');
    
    const inlineKeyboard = [
      [
        { 
          text: '📜 TÉRMINOS DE SERVICIO', 
          web_app: { url: `${webappUrl}/politicas.html?section=terminos` }
        }
      ],
      [
        { 
          text: '💳 POLÍTICA DE REEMBOLSO', 
          web_app: { url: `${webappUrl}/politicas.html?section=reembolso` }
        }
      ],
      [
        { 
          text: '🔒 POLÍTICA DE PRIVACIDAD', 
          web_app: { url: `${webappUrl}/politicas.html?section=privacidad` }
        }
      ],
      [
        { text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }
      ]
    ];

    // Editar el mensaje actual si existe, o enviar uno nuevo
    if (ctx.callbackQuery.message) {
      await ctx.editMessageText(
        '📜 *Políticas de VPN Cuba*\n\n' +
        'Selecciona una sección para ver los detalles completos en nuestra Web App:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        }
      );
    } else {
      await ctx.reply(
        '📜 *Políticas de VPN Cuba*\n\n' +
        'Selecciona una sección para ver los detalles completos en nuestra Web App:',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: inlineKeyboard
          }
        }
      );
    }
  } catch (error) {
    console.error('❌ Error en action de políticas:', error);
    await ctx.answerCbQuery('❌ Error al abrir políticas. Intenta de nuevo.');
  }
});

// Acción: FAQ (ya existente, la mantenemos)
bot.action('faq', async (ctx) => {
  try {
    const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
    
    await ctx.answerCbQuery('❓ Abriendo preguntas frecuentes...');
    
    await ctx.reply(
      '❓ *PREGUNTAS FRECUENTES (FAQ)*\n\n' +
      'Encuentra respuestas a las dudas más comunes sobre nuestros servicios, pagos, instalación y más.\n\n' +
      'Haz clic en el botón para abrir la sección de preguntas frecuentes:',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { 
                text: '❓ VER PREGUNTAS FRECUENTES', 
                web_app: { url: `${webappUrl}/faq.html` }
              }
            ],
            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Error en action de FAQ:', error);
    await ctx.answerCbQuery('❌ Error al abrir FAQ.');
  }
});

// ==================== COMANDOS DEL BOT ====================

// Comando /start con sistema de referido.

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
        } catch (error) {
            console.error('Error obteniendo referidor:', error);
        }
        if (referrerId) {
            try {
                await db.createReferral(referrerId, userId.toString(), ctx.from.username, firstName);
            } catch (refError) {
                console.error('Error creando referido:', refError);
            }
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
        }
        await db.saveUser(userId.toString(), userData);
    } catch (error) {
        console.error('Error guardando usuario:', error);
    }
    
    // Eliminar teclado reply persistente (con texto no vacío)
    await ctx.telegram.sendMessage(ctx.chat.id, '⌛', {
        reply_markup: { remove_keyboard: true }
    });
    
    // Construir menú principal
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;

    const inlineKeyboard = [
        [
            { text: "VER PLANES", icon_custom_emoji_id: "6005986106703613755", web_app: { url: plansUrl } },
            { text: "MI PERFIL", icon_custom_emoji_id: "6021659919835469581", callback_data: "check_status" }
        ],
        [
            { text: "DESCARGAR WIREGUARD", icon_custom_emoji_id: "5899757765743615694", callback_data: "download_wireguard" },
            { text: "SOPORTE", icon_custom_emoji_id: "6019320644422867543", callback_data: "show_support" }
        ],
        [
            { text: "REFERIDOS", icon_custom_emoji_id: "5944970130554359187", callback_data: "referral_info" },
            { text: "CÓMO FUNCIONA", icon_custom_emoji_id: "5873121512445187130", callback_data: "how_it_works" }
        ],
        [
            { text: "VPN CANAL", icon_custom_emoji_id: "5771695636411847302", url: "https://t.me/vpncubaw" },
            { text: "POLÍTICAS", icon_custom_emoji_id: "6021738534916854774", callback_data: "politicas" }
        ],
        [
            { text: "WHATSAPP", icon_custom_emoji_id: "5884179047482659474", url: "https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9?mode=gi_t" },
            { text: "FAQ", icon_custom_emoji_id: "5879501875341955281", callback_data: "faq" }
        ]
    ];

    if (esAdmin) {
        inlineKeyboard.push([
            { text: "PANEL ADMIN", icon_custom_emoji_id: "5839116473951328489", web_app: { url: adminUrl } }
        ]);
    }

    const welcomeMessage = `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Conéctate con la mejor latencia para gaming y navegación.\n\n` +
        (referrerId ? `👥 *¡Te invitó un amigo!*\nObtendrás beneficios especiales por ser referido.\n\n` : '') +
        (esAdmin ? `🔧 *Eres Administrador* - Tienes acceso a funciones especiales\n\n` : '') +
        `*Selecciona una opción:*`;

    // Enviar con API cruda
    await bot.telegram.callApi('sendMessage', {
        chat_id: ctx.chat.id,
        text: welcomeMessage,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard }
    });
});
   
// Mantener los handlers de texto para compatibilidad con el menú anterior
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    console.log(`📨 Mensaje de texto recibido: "${text}" de ${userId}`);
    
    // Opción: ⎙ VER PLANES
    if (text === '📁 VER PLANES') {
        const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
        await ctx.reply(
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
            `Puedes ver los planes y adquirirlos en la web:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 ABRIR WEB DE PLANES', web_app: { url: webappUrl } }],
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
    
    // Opción: ♕ MI ESTADO (compatibilidad con nombre anterior)
    else if (text === '👑 MI ESTADO') {
        // Llamar a la acción check_status
        await ctx.answerCbQuery();
        // Simular la acción
        await checkStatusHandler(ctx, userId);
    }
    
    // Opción: ☄ DESCARGAR WIREGUARD
    else if (text === '💻 DESCARGAR WIREGUARD') {
        await ctx.reply(
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
                    inline_keyboard: [
                        [
                            { text: '💻 WINDOWS', url: 'https://www.wireguard.com/install/' },
                            { text: '📱 ANDROID', url: 'https://play.google.com/store/apps/details?id=com.wireguard.android' }
                        ],
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
    
    // Opción: ☏ SOPORTE
    else if (text === '🆘 SOPORTE') {
        await ctx.reply(
            `🆘 *SOPORTE TÉCNICO*\n\n` +
            `Para cualquier duda o problema, contacta con nuestro soporte:\n\n` +
            `👉 @L0quen2\n` +
            `👉 @ErenJeager129182\n\n` +
            `Responde rápido y te ayudaremos.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '💬 IR AL SOPORTE (L0quen2)', url: 'https://t.me/L0quen2' },
                            { text: '💬 IR AL SOPORTE (Eren)', url: 'https://t.me/ErenJeager129182' }
                        ],
                        [
                            { text: '💬 IR AL SOPORTE WHATSAPP', url: 'https://wa.me/message/3LUGXYGD55UBO1' }
                        ],
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }

    // Opción: ♻️ REFERIDOS
    else if (text === '♻️ REFERIDOS') {
        const referralLink = `https://t.me/vpncubaw_bot?start=ref${userId}`;
        
        try {
            const user = await db.getUser(userId);
            let referralStats = null;
            
            if (user) {
                try {
                    referralStats = await db.getReferralStats(userId);
                } catch (statsError) {
                    console.error('❌ Error obteniendo estadísticas de referidos:', statsError);
                }
            }
            
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
                message += `• Referidos directos (Nivel 1): ${referralStats.level1?.total || 0} (${referralStats.level1?.paid || 0} pagados)\n`;
                message += `• Referidos nivel 2: ${referralStats.level2?.total || 0} (${referralStats.level2?.paid || 0} pagados)\n`;
                message += `• Descuento total acumulado: ${referralStats.discount_percentage || 0}%\n\n`;
            } else {
                message += `*Tus estadísticas:*\n`;
                message += `• Aún no tienes referidos. ¡Comparte tu enlace y empieza a ganar!\n\n`;
            }
            
            message += `¡Cada vez que un referido pague, tu descuento aumentará! 🎉`;
            
            await ctx.reply(
                message,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 COPIAR ENLACE', callback_data: 'copy_referral_link' }],
                            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
        } catch (error) {
            console.error('❌ Error en handler de referidos:', error);
            
            await ctx.reply(
                `🤝 *SISTEMA DE REFERIDOS*\n\n` +
                `Tu enlace de referido:\n\`${referralLink}\`\n\n` +
                `Comparte este enlace con tus amigos y obtén descuentos.\n\n` +
                `*Nota:* No se pudieron cargar las estadísticas en este momento, pero el enlace sigue activo.`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 COPIAR ENLACE', callback_data: 'copy_referral_link' }],
                            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
        }
    }
    
    // Opción: ✎ CÓMO FUNCIONA
    else if (text === '❓ CÓMO FUNCIONA') {
        await ctx.reply(
            `🚀 *¡OPTIMIZA TU CONEXIÓN AL MÁXIMO NIVEL!*\n\n` +
            `Nuestras configuraciones Wireguard crean un túnel ultra rápido y directo hacia los servidores del juego, eliminando los saltos innecesarios que causan el lag. ⚡\n\n` +
            `*¿Cómo lo logramos?*\n\n` +
            `1️⃣ *Rutas VIP*: Tu tráfico viaja por una 'vía rápida' privada, evitando la saturación de tu proveedor de internet.\n` +
            `2️⃣ *Tecnología Wireguard*: Es el protocolo más veloz del mundo; procesa datos casi al instante sin calentar tu celular.\n\n` +
            `⚠️ *REQUISITO IMPORTANTE:*\n` +
            `Para que esta configuración haga su magia, necesitas tener una conexión a internet estable. 📶\n` +
            `Wireguard optimiza y estabiliza tu ping, pero no puede arreglar un internet que se desconecta o que tiene una velocidad base excesivamente baja.\n\n` +
            `Si tu internet es decente pero el juego te va mal, ¡nosotros somos la pieza que te falta para llegar a los 50-70ms constantes! 🏎️💨\n\n` +
            `¡Mejora tu respuesta en las Teamfights hoy mismo! Dale al botón de Ver planes y elige tu plan.`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
    
    // Opción: ❏ VPN CANAL
    else if (text === '🔈 VPN CANAL') {
        await ctx.reply(
            `📢 *CANAL OFICIAL DE VPN CUBA*\n\n` +
            `Únete a nuestro canal de Telegram para estar al tanto de las últimas novedades, ofertas y actualizaciones.\n\n` +
            `👉 https://t.me/vpncubaw`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📢 IR AL CANAL', url: 'https://t.me/vpncubaw' }],
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
    
    // Opción: 📲 WHATSAPP
    else if (text === '📲 WHATSAPP') {
        try {
            await ctx.reply(
                '📱 *GRUPO DE WHATSAPP*\n\n' +
                'Únete a nuestra comunidad en WhatsApp para interactuar con otros usuarios y recibir soporte rápido.\n\n' +
                '👉 [Haz clic aquí para unirte al grupo](https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9?mode=gi_t)',
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📱 ABRIR WHATSAPP', url: 'https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9?mode=gi_t' }],
                            [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
        } catch (error) {
            console.error('❌ Error en handler de WhatsApp:', error);
            await ctx.reply('❌ Error al abrir WhatsApp. Intenta más tarde o contacta a soporte.');
        }
    }
    
    // Opción: 📜 Politicas
    else if (text === '📜 Politicas') {
        const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
        
        const inlineKeyboard = [
            [
                { 
                    text: '📜 TÉRMINOS DE SERVICIO', 
                    web_app: { url: `${webappUrl}/politicas.html?section=terminos` }
                }
            ],
            [
                { 
                    text: '💳 POLÍTICA DE REEMBOLSO', 
                    web_app: { url: `${webappUrl}/politicas.html?section=reembolso` }
                }
            ],
            [
                { 
                    text: '🔒 POLÍTICA DE PRIVACIDAD', 
                    web_app: { url: `${webappUrl}/politicas.html?section=privacidad` }
                }
            ],
            [
                { text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }
            ]
        ];

        await ctx.reply(
            '📜 *Políticas de VPN Cuba*\n\n' +
            'Selecciona una sección para ver los detalles completos en nuestra Web App:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            }
        );
    }
    
    // Opción: ❓ FAQ
    else if (text === '❓ FAQ') {
        const webappUrl = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
        
        await ctx.reply(
            '❓ *PREGUNTAS FRECUENTES (FAQ)*\n\n' +
            'Encuentra respuestas a las dudas más comunes sobre nuestros servicios, pagos, instalación y más.\n\n' +
            'Haz clic en el botón para abrir la sección de preguntas frecuentes:',
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { 
                                text: '❓ VER PREGUNTAS FRECUENTES', 
                                web_app: { url: `${webappUrl}/faq.html` }
                            }
                        ],
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
    
    // Opción: ⌨ PANEL ADMIN (solo admin)
    else if (text === '⌨ PANEL ADMIN' && esAdmin) {
        const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${userId}&admin=true`;
        await ctx.reply(
            `🔧 *PANEL DE ADMINISTRACIÓN*\n\n` +
            `Haz clic para abrir el panel web:`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔧 ABRIR PANEL WEB', web_app: { url: adminUrl } }],
                        [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
    
    // Si no coincide con ninguna opción, ignoramos (o podríamos mostrar un mensaje de ayuda)
});

// Función auxiliar para manejar check_status desde el handler de texto
async function checkStatusHandler(ctx, userId) {
  try {
    const user = await db.getUser(userId);
    
    if (!user) {
      await ctx.reply(
        `❌ *NO ESTÁS REGISTRADO*\n\n` +
        `Usa el botón "VER PLANES" para registrarte y comenzar.`,
        { parse_mode: 'Markdown' }
      );
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
      
      if (diasRestantes <= 7) {
        mensajeEstado += `⚠️ *TU PLAN ESTÁ POR EXPIRAR PRONTO*\n`;
        mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
      } else {
        mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
      }
      
      const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
      await ctx.reply(
        mensajeEstado,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 VER PLANES', web_app: { url: webappUrl } }],
              [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
            ]
          }
        }
      );
    } else {
      const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
      await ctx.reply(
        `❌ *NO ERES USUARIO VIP*\n\n` +
        `Actualmente no tienes acceso a los servicios premium.\n\n` +
        `Haz clic en el botón para ver nuestros planes.`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 VER PLANES', web_app: { url: webappUrl } }],
              [{ text: '🏠 MENÚ PRINCIPAL', callback_data: 'main_menu' }]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error('❌ Error en checkStatusHandler:', error);
    await ctx.reply(`❌ Error al verificar tu estado.`);
  }
}

// ==================== CONFIGURACIÓN DEL WEBHOOK ====================

// Ruta para recibir actualizaciones de Telegram
app.post('/webhook', (req, res) => {
    // Pasar la solicitud al bot para que la procese
    bot.handleUpdate(req.body, res);
});

// Función para establecer el webhook
async function setWebhook() {
    const webhookUrl = `${process.env.WEBAPP_URL}/webhook`; // Usamos la misma URL base de la webapp
    try {
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`✅ Webhook establecido en: ${webhookUrl}`);
        
        // Obtener información del webhook para verificar
        const webhookInfo = await bot.telegram.getWebhookInfo();
        console.log(`📡 Información del webhook:`, webhookInfo);
    } catch (error) {
        console.error('❌ Error estableciendo webhook:', error);
        // Si falla, intentar con polling como fallback
        console.log('⚠️ Usando polling como fallback...');
        await bot.launch();
    }
}

// ==================== SERVIDOR ====================

app.listen(PORT, async () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🌐 Supabase URL: ${process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔑 Supabase Key: ${process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔐 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
    
    console.log('🔍 Verificando buckets de almacenamiento...');
    await verifyStorageBuckets();
    
    console.log('📦 Inicializando buckets de almacenamiento...');
    await initializeStorageBuckets();
    
    console.log('💸 Inicializando sistema USDT en modo MANUAL...');
    await initializeUsdtSystem();
    
    await setWebhook();
    
    try {
        const commands = [
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'help', description: 'Mostrar ayuda' },
            { command: 'referidos', description: 'Obtener enlace de referidos' },
            { command: 'cupon', description: 'Verificar cupón de descuento' },
            { command: 'trialstatus', description: 'Ver estado de prueba gratuita' },
            { command: 'admin', description: 'Panel de administración (solo admins)' },
            { command: 'enviar', description: 'Enviar configuración (solo admins)' }
        ];
        
        await bot.telegram.setMyCommands(commands);
        console.log('📝 Comandos del bot configurados');
    } catch (error) {
        console.error('❌ Error configurando comandos:', error);
    }

    startKeepAlive();
    
    console.log(`🎯 Prueba gratuita: Disponible desde webapp (1 hora)`);
    console.log(`📊 Estadísticas completas: /api/stats`);
    console.log(`🎫 Sistema de cupones: Habilitado`);
    console.log(`💰 Sistema USDT: MODO MANUAL`);
    console.log(`   • Dirección: ${USDT_CONFIG.WALLET_ADDRESS}`);
    console.log(`   • Verificación: DESACTIVADA - Flujo manual`);
    console.log(`   • Todos los pagos requieren captura`);
    console.log(`👥 Sistema de referidos: Habilitado`);
    console.log(`📁 Archivos automáticos: DESACTIVADO - Envío manual`);
    console.log(`📦 Buckets de almacenamiento: Verificados`);
    console.log(`👤 Sistema mejorado de envío: Usuarios inactivos marcados automáticamente`);
});

// Manejar errores no capturados
process.on('uncaughtException', async (error) => {
    console.error('❌ Error no capturado:', error);
});

process.on('unhandledRejection', async (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

process.on('SIGINT', () => {
    console.log('\n👋 Cerrando aplicación...');
    bot.telegram.deleteWebhook().catch(() => {});
    process.exit(0);
});

function startKeepAlive() {
    const keepAliveInterval = 4 * 60 * 1000;
    const healthCheckUrl = `http://localhost:${PORT}/api/health`;

    setInterval(async () => {
        try {
            const response = await fetch(healthCheckUrl);
            if (response.ok) {
                console.log(`✅ Keep-alive ping exitoso a las ${new Date().toLocaleTimeString()}`);
            }
        } catch (error) {
            console.error('❌ Error en keep-alive ping:', error.message);
        }
    }, keepAliveInterval);

    console.log(`🔄 Keep-alive iniciado. Ping cada 5 minutos a ${healthCheckUrl}`);
}

module.exports = {
    app,
    isAdmin,
    ADMIN_IDS,
    initializeStorageBuckets,
    initializeUsdtSystem,
    sendTrialToValidUsers
};
