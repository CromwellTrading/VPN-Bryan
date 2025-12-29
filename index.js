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

// IDs de administradores
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604'];

// ==================== CONFIGURACIÓN USDT ====================
const USDT_CONFIG = {
    // Dirección fija USDT (BEP20)
    WALLET_ADDRESS: '0x9065C7d2cC04134A55F6Abf2B4118C11A8A01ff2',
    // API Key de BSCScan
    BSCSCAN_API_KEY: 'WS9VPU5VY7M9B7S3HFBKUMDHQ6QK5ESG5D',
    // Contrato USDT en BSC (BEP20)
    USDT_CONTRACT_ADDRESS: '0x55d398326f99059ff775485246999027b3197955',
    // Tiempo de verificación (5 minutos)
    CHECK_INTERVAL: 5 * 60 * 1000,
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
    'anual': 'Anual (12 meses)'
  };
  return plans[planType] || planType;
}

// Función para generar dirección USDT fija
function generateUniqueUsdtAddress() {
    return USDT_CONFIG.WALLET_ADDRESS;
}

// Función para formatear fecha
function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// En la función crearMenuPrincipal, agregar botón de referidos
function crearMenuPrincipal(userId, firstName = 'usuario', esAdmin = false) {
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;
    
    // Crear teclado BASE para TODOS los usuarios
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

    // Si es ADMIN, agregar botón de panel admin
    if (esAdmin) {
        keyboard.push([
            { 
                text: '🔧 PANEL ADMIN', 
                web_app: { url: adminUrl }
            }
        ]);
    }

    return keyboard;
}

// ==================== FUNCIONES DE VERIFICACIÓN USDT ====================

// Función para verificar transacciones USDT en BSCScan
async function checkUsdtTransactions() {
    console.log('🔍 Verificando transacciones USDT en BSCScan...');
    
    try {
        const apiKey = USDT_CONFIG.BSCSCAN_API_KEY;
        const walletAddress = USDT_CONFIG.WALLET_ADDRESS;
        
        // URL para obtener transacciones de tokens (USDT)
        const apiUrl = `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${USDT_CONFIG.USDT_CONTRACT_ADDRESS}&address=${walletAddress}&page=1&offset=100&sort=desc&apikey=${apiKey}`;
        
        console.log(`📡 Consultando BSCScan: ${apiUrl}`);
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.status === "1" && data.message === "OK") {
            const transactions = data.result;
            console.log(`📊 ${transactions.length} transacciones USDT encontradas`);
            
            // Procesar cada transacción
            for (const tx of transactions) {
                await processUsdtTransaction(tx);
            }
            
            return { success: true, transactions: transactions.length };
        } else {
            console.error('❌ Error en respuesta de BSCScan:', data.message);
            return { success: false, error: data.message };
        }
    } catch (error) {
        console.error('❌ Error verificando transacciones USDT:', error.message);
        return { success: false, error: error.message };
    }
}

// Función para procesar una transacción USDT
async function processUsdtTransaction(tx) {
    try {
        // Verificar si es una transacción entrante (TO nuestra dirección)
        const isIncoming = tx.to.toLowerCase() === USDT_CONFIG.WALLET_ADDRESS.toLowerCase();
        
        if (!isIncoming) {
            return; // Solo procesar transacciones entrantes
        }
        
        console.log(`💰 Transacción USDT detectada:`, {
            hash: tx.hash,
            from: tx.from,
            value: tx.value,
            timestamp: tx.timeStamp
        });
        
        // Convertir valor de Wei a USDT (USDT tiene 18 decimales)
        const amountUsdt = (parseInt(tx.value) / 10**18).toFixed(2);
        const transactionHash = tx.hash;
        const senderAddress = tx.from;
        const timestamp = new Date(parseInt(tx.timeStamp) * 1000);
        
        // Verificar si ya procesamos esta transacción
        const existingPayment = await db.getUsdtPaymentByHash(transactionHash);
        if (existingPayment) {
            console.log(`⏭️ Transacción ${transactionHash} ya procesada, saltando...`);
            return;
        }
        
        // Buscar pagos USDT pendientes por monto
        const pendingPayments = await db.getPendingUsdtPayments();
        const matchingPayment = pendingPayments.find(p => {
            const expectedAmount = parseFloat(p.usdt_amount);
            const receivedAmount = parseFloat(amountUsdt);
            // Comparar con margen de 0.01 USDT
            return Math.abs(expectedAmount - receivedAmount) <= 0.01;
        });
        
        if (matchingPayment) {
            console.log(`✅ Pago encontrado para transacción ${transactionHash}: Usuario ${matchingPayment.telegram_id}, Plan ${matchingPayment.plan}`);
            
            // Procesar el pago encontrado
            await processMatchingUsdtPayment(matchingPayment, transactionHash, senderAddress, amountUsdt);
        } else {
            console.log(`⚠️ Transacción ${transactionHash} no coincide con ningún pago pendiente`);
            console.log(`   Monto recibido: ${amountUsdt} USDT`);
            
            // Crear registro de transacción no asignada
            await db.createUnassignedUsdtTransaction({
                transaction_hash: transactionHash,
                sender_address: senderAddress,
                amount: amountUsdt,
                timestamp: timestamp.toISOString(),
                raw_data: JSON.stringify(tx)
            });
            
            // Notificar a admins sobre transacción no asignada
            notifyAdminsUnassignedTransaction(tx, amountUsdt);
        }
    } catch (error) {
        console.error(`❌ Error procesando transacción ${tx.hash}:`, error.message);
    }
}

// Función para procesar pago USDT coincidente
async function processMatchingUsdtPayment(usdtPayment, transactionHash, senderAddress, amountUsdt) {
    try {
        // Actualizar pago USDT
        await db.updateUsdtPaymentStatus(
            usdtPayment.id,
            'completed',
            transactionHash,
            senderAddress,
            amountUsdt
        );
        
        // Buscar pago regular correspondiente
        const regularPayment = await db.getUserUsdtPayment(usdtPayment.telegram_id, usdtPayment.plan);
        
        if (regularPayment) {
            // Aprobar pago regular
            await db.approvePayment(regularPayment.id);
            
            // Enviar archivo automáticamente si está disponible
            await sendUsdtPaymentConfiguration(
                usdtPayment.telegram_id,
                usdtPayment.plan,
                transactionHash,
                senderAddress,
                amountUsdt
            );
            
            // Marcar usuario como VIP
            const user = await db.getUser(usdtPayment.telegram_id);
            if (!user.vip) {
                await db.makeUserVIP(usdtPayment.telegram_id, {
                    plan: usdtPayment.plan,
                    plan_price: amountUsdt,
                    vip_since: new Date().toISOString(),
                    payment_method: 'usdt'
                });
            }
            
            // Verificar referidos
            if (user.referrer_id) {
                await db.markReferralAsPaid(usdtPayment.telegram_id);
            }
            
            console.log(`✅ Pago USDT procesado exitosamente para usuario ${usdtPayment.telegram_id}`);
            
            // Notificar a admins
            notifyAdminsUsdtPaymentSuccess(usdtPayment, transactionHash, amountUsdt);
        }
    } catch (error) {
        console.error(`❌ Error procesando pago USDT:`, error.message);
    }
}

// Función para enviar configuración automáticamente
async function sendUsdtPaymentConfiguration(telegramId, plan, transactionHash, senderAddress, amountUsdt) {
    try {
        const planFile = await db.getPlanFile(plan);
        
        if (planFile && planFile.public_url) {
            const fileName = planFile.original_name || `config_${plan}.conf`;
            const shortHash = transactionHash.substring(0, 20) + '...';
            const shortSender = senderAddress.substring(0, 10) + '...' + senderAddress.substring(senderAddress.length - 8);
            
            await bot.telegram.sendDocument(
                telegramId,
                planFile.public_url,
                {
                    caption: `🎉 *¡Tu pago USDT ha sido confirmado automáticamente!*\n\n` +
                            `📁 *Archivo:* ${fileName}\n` +
                            `📋 *Plan:* ${getPlanName(plan)}\n` +
                            `💰 *Monto:* ${amountUsdt} USDT\n` +
                            `🏦 *Transacción:* \`${shortHash}\`\n` +
                            `👤 *Remitente:* \`${shortSender}\`\n\n` +
                            `*¡Tu configuración está lista!* 🚀\n\n` +
                            `1. Descarga este archivo\n` +
                            `2. Importa el archivo .conf en WireGuard\n` +
                            `3. Activa la conexión\n` +
                            `4. ¡Disfruta de baja latencia!\n\n` +
                            `*Verificar en BSCScan:*\n` +
                            `https://bscscan.com/tx/${transactionHash}\n\n` +
                            `*Soporte:* @L0quen2`,
                    parse_mode: 'Markdown'
                }
            );
            
            // Actualizar pago con configuración enviada
            const payments = await db.getUserPayments(telegramId);
            const payment = payments?.find(p => p.method === 'usdt' && p.status === 'approved');
            
            if (payment) {
                await db.updatePayment(payment.id, {
                    config_sent: true,
                    config_sent_at: new Date().toISOString(),
                    config_file: fileName,
                    config_sent_by: 'auto-usdt-system'
                });
            }
            
            console.log(`✅ Configuración enviada automáticamente a ${telegramId}`);
            return true;
        } else {
            // Notificar al usuario que el pago fue aprobado pero hay que enviar manualmente
            await bot.telegram.sendMessage(
                telegramId,
                `🎉 *¡Tu pago USDT ha sido confirmado!*\n\n` +
                `💰 *Monto:* ${amountUsdt} USDT\n` +
                `🏦 *Transacción:* \`${transactionHash.substring(0, 20)}...\`\n` +
                `👤 *Remitente:* \`${senderAddress.substring(0, 10)}...\`\n\n` +
                `El administrador te enviará el archivo de configuración en breve.\n\n` +
                `*Verificar en BSCScan:*\n` +
                `https://bscscan.com/tx/${transactionHash}`,
                { parse_mode: 'Markdown' }
            );
            return false;
        }
    } catch (error) {
        console.error(`❌ Error enviando configuración USDT:`, error.message);
        return false;
    }
}

// Notificar a admins sobre pago USDT exitoso
async function notifyAdminsUsdtPaymentSuccess(usdtPayment, transactionHash, amountUsdt) {
    const user = await db.getUser(usdtPayment.telegram_id);
    const username = user?.username ? `@${user.username}` : 'Sin usuario';
    const firstName = user?.first_name || 'Usuario';
    
    const adminMessage = `✅ *PAGO USDT CONFIRMADO AUTOMÁTICAMENTE*\n\n` +
        `👤 *Usuario:* ${firstName}\n` +
        `📱 *Telegram:* ${username}\n` +
        `🆔 *ID:* ${usdtPayment.telegram_id}\n` +
        `📋 *Plan:* ${getPlanName(usdtPayment.plan)}\n` +
        `💰 *Monto:* ${amountUsdt} USDT\n` +
        `🏦 *Transacción:* \`${transactionHash}\`\n` +
        `👤 *Remitente:* \`${usdtPayment.sender_address}\`\n` +
        `⏰ *Fecha:* ${new Date().toLocaleString('es-ES')}\n` +
        `📁 *Configuración:* Enviada automáticamente ✅`;
    
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
        } catch (adminError) {
            console.log(`❌ No se pudo notificar al admin ${adminId}`);
        }
    }
}

// Notificar a admins sobre transacción no asignada
async function notifyAdminsUnassignedTransaction(tx, amountUsdt) {
    const adminMessage = `⚠️ *TRANSACCIÓN USDT NO ASIGNADA*\n\n` +
        `💰 *Monto:* ${amountUsdt} USDT\n` +
        `👤 *Remitente:* \`${tx.from}\`\n` +
        `🏦 *Transacción:* \`${tx.hash}\`\n` +
        `⏰ *Fecha:* ${new Date(parseInt(tx.timeStamp) * 1000).toLocaleString('es-ES')}\n\n` +
        `Esta transacción no coincide con ningún pago pendiente.\n` +
        `*Verificar en BSCScan:*\n` +
        `https://bscscan.com/tx/${tx.hash}`;
    
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
        } catch (adminError) {
            console.log(`❌ No se pudo notificar al admin ${adminId}`);
        }
    }
}

// Verificar saldo de dirección USDT
async function checkUsdtWalletBalance() {
    try {
        const apiKey = USDT_CONFIG.BSCSCAN_API_KEY;
        const walletAddress = USDT_CONFIG.WALLET_ADDRESS;
        const usdtContract = USDT_CONFIG.USDT_CONTRACT_ADDRESS;
        
        const apiUrl = `https://api.bscscan.com/api?module=account&action=tokenbalance&contractaddress=${usdtContract}&address=${walletAddress}&tag=latest&apikey=${apiKey}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.status === "1" && data.message === "OK") {
            const balanceWei = data.result;
            const balanceUsdt = (parseInt(balanceWei) / 10**18).toFixed(2);
            return { success: true, balance: balanceUsdt };
        } else {
            return { success: false, error: data.message };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Verificar detalles de una transacción específica
async function verifyUsdtTransaction(transactionHash) {
    try {
        const apiKey = USDT_CONFIG.BSCSCAN_API_KEY;
        const apiUrl = `https://api.bscscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${transactionHash}&apikey=${apiKey}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        if (data.status === "1") {
            return {
                success: true,
                status: data.result.status === "1" ? "success" : "failed",
                confirmations: "N/A"
            };
        } else {
            return { success: false, error: data.message };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Iniciar verificación periódica de pagos USDT
function startUsdtPaymentVerification() {
    console.log('🚀 Iniciando verificación automática de pagos USDT...');
    
    // Ejecutar inmediatamente al inicio
    setTimeout(() => checkUsdtTransactions(), 10000);
    
    // Configurar intervalo periódico (5 minutos)
    setInterval(() => {
        checkUsdtTransactions();
    }, USDT_CONFIG.CHECK_INTERVAL);
    
    console.log(`✅ Verificación USDT programada cada ${USDT_CONFIG.CHECK_INTERVAL / 60000} minutos`);
}

// Inicializar sistema USDT
async function initializeUsdtSystem() {
    console.log('💸 Inicializando sistema USDT...');
    
    // Verificar configuración
    if (!USDT_CONFIG.BSCSCAN_API_KEY) {
        console.log('⚠️ API Key de BSCScan no configurada. La verificación automática no funcionará.');
    }
    
    if (!USDT_CONFIG.WALLET_ADDRESS) {
        console.log('⚠️ Dirección USDT no configurada.');
    }
    
    // Verificar conexión con BSCScan
    try {
        const balance = await checkUsdtWalletBalance();
        if (balance.success) {
            console.log(`💰 Saldo USDT en wallet: ${balance.balance} USDT`);
        } else {
            console.log(`⚠️ No se pudo verificar saldo USDT: ${balance.error}`);
        }
    } catch (error) {
        console.log('⚠️ Error inicializando sistema USDT:', error.message);
    }
    
    // Iniciar verificación periódica
    startUsdtPaymentVerification();
    
    console.log('✅ Sistema USDT inicializado');
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
      terms_date: new Date().toISOString()
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

// 4. Procesar pago
app.post('/api/payment', upload.single('screenshot'), async (req, res) => {
  try {
    console.log('📥 Pago recibido:', {
      telegramId: req.body.telegramId,
      plan: req.body.plan,
      price: req.body.price,
      method: req.body.method
    });
    
    const { telegramId, plan, price, notes, method } = req.body;
    
    if (!telegramId || !plan || !price) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Para métodos que no sean USDT, requerir captura
    if (method !== 'usdt' && !req.file) {
      return res.status(400).json({ error: 'Captura de pantalla requerida' });
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

    // Guardar pago en base de datos
    const payment = await db.createPayment({
      telegram_id: telegramId,
      plan: plan,
      price: parseFloat(price),
      method: method || 'transfer',
      screenshot_url: screenshotUrl,
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    if (!payment) {
      throw new Error('No se pudo crear el pago en la base de datos');
    }

    // Notificar a admins
    try {
      const adminMessage = `💰 *NUEVO PAGO RECIBIDO*\n\n` +
        `👤 *Usuario:* ${firstName}\n` +
        `📱 *Telegram:* ${username}\n` +
        `🆔 *ID:* ${telegramId}\n` +
        `📋 *Plan:* ${getPlanName(plan)}\n` +
        `💰 *Monto:* $${price} ${method === 'usdt' ? 'USDT' : 'CUP'}\n` +
        `💳 *Método:* ${method === 'usdt' ? 'USDT (BEP20)' : (method === 'transfer' ? 'BPA' : method === 'metropolitan' ? 'Metropolitana' : method === 'mitransfer' ? 'MITRANSFER' : 'Saldo Móvil')}\n` +
        `⏰ *Fecha:* ${new Date().toLocaleString('es-ES')}\n` +
        `📝 *Estado:* ⏳ Pendiente`;
      
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

    // Si es pago USDT, usar la nueva lógica
    if (method === 'usdt') {
      try {
        // Usar dirección fija
        const usdtAddress = USDT_CONFIG.WALLET_ADDRESS;
        const usdtAmount = USDT_PRICES[plan] || '1.6';
        
        await bot.telegram.sendMessage(
          telegramId,
          `💸 *INFORMACIÓN DE PAGO USDT*\n\n` +
          `📋 *Plan:* ${getPlanName(plan)}\n` +
          `💰 *Monto exacto:* ${usdtAmount} USDT\n` +
          `🏦 *Dirección:* \`${usdtAddress}\`\n` +
          `🌐 *Red:* BEP20 (Binance Smart Chain)\n` +
          `🔍 *Verificar en BSCScan:* https://bscscan.com/address/${usdtAddress}\n\n` +
          `*Instrucciones importantes:*\n` +
          `1. Envía *exactamente* ${usdtAmount} USDT\n` +
          `2. Usa *solo* la red BEP20\n` +
          `3. No envíes desde exchanges (Binance, etc.)\n` +
          `4. Usa una wallet personal (Trust Wallet, MetaMask)\n` +
          `5. El sistema detectará automáticamente en 5-15 minutos\n` +
          `6. Recibirás la configuración automáticamente\n\n` +
          `*Verificación automática habilitada* ✅\n` +
          `No necesitas enviar comprobante.`,
          { parse_mode: 'Markdown' }
        );
        
        // Guardar pago USDT en base de datos
        const usdtPayment = await db.createUsdtPayment({
          telegram_id: telegramId,
          plan: plan,
          usdt_amount: usdtAmount,
          usdt_address: usdtAddress,
          status: 'pending',
          created_at: new Date().toISOString()
        });
        
        // Actualizar pago regular con referencia al pago USDT
        await db.updatePayment(payment.id, {
          usdt_payment_id: usdtPayment.id,
          notes: 'Pago USDT pendiente - Verificación automática'
        });
        
      } catch (usdtError) {
        console.log('❌ Error enviando información USDT:', usdtError.message);
      }
    }

    res.json({ 
      success: true, 
      message: method === 'usdt' ? 
        'Información de pago USDT enviada. El sistema detectará automáticamente tu pago en 5-15 minutos.' : 
        'Pago recibido. Te notificaremos cuando sea aprobado.',
      payment 
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

// 6. Obtener pagos aprobados
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

// 7. Aprobar pago
app.post('/api/payments/:id/approve', async (req, res) => {
  try {
    const payment = await db.approvePayment(req.params.id);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // Notificar al usuario
    try {
      await bot.telegram.sendMessage(
        payment.telegram_id,
        '🎉 *¡Tu pago ha sido aprobado!*\n\n' +
        'Ahora eres usuario VIP de VPN Cuba.\n' +
        'En breve recibirás tu archivo de configuración por este mismo chat.',
        { parse_mode: 'Markdown' }
      );
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    // Verificar si hay archivo de plan disponible para enviar automáticamente
    try {
      const planFile = await db.getPlanFile(payment.plan);
      if (planFile && planFile.public_url) {
        // Enviar archivo automáticamente
        const fileName = planFile.original_name || `config_${payment.plan}.conf`;
        
        await bot.telegram.sendDocument(
          payment.telegram_id,
          planFile.public_url,
          {
            caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                    `📁 *Archivo:* ${fileName}\n` +
                    `📋 *Plan:* ${getPlanName(payment.plan)}\n\n` +
                    `*Instrucciones:*\n` +
                    `1. Descarga este archivo\n` +
                    `2. Importa el archivo .conf en tu cliente WireGuard\n` +
                    `3. Activa la conexión\n` +
                    `4. ¡Disfruta de baja latencia! 🚀\n\n` +
                    `*Soporte:* Contacta con @L0quen2 si tienes problemas.`,
            parse_mode: 'Markdown'
          }
        );

        // Actualizar pago con configuración enviada
        await db.updatePayment(payment.id, {
          config_sent: true,
          config_sent_at: new Date().toISOString(),
          config_file: fileName,
          config_sent_by: 'auto-system'
        });

        console.log(`✅ Archivo de plan enviado automáticamente a ${payment.telegram_id}`);
      }
    } catch (fileError) {
      console.log('⚠️ No se pudo enviar archivo automáticamente:', fileError.message);
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
    
    // Verificar saldo USDT
    const usdtBalance = await checkUsdtWalletBalance();
    
    // Agregar estadísticas de broadcasts a las estadísticas generales
    stats.broadcasts = {
      total: broadcasts.length,
      completed: completedBroadcasts,
      pending: broadcasts.filter(b => b.status === 'pending').length,
      sending: broadcasts.filter(b => b.status === 'sending').length,
      failed: broadcasts.filter(b => b.status === 'failed').length
    };
    
    // Agregar información USDT
    stats.usdt = {
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      balance: usdtBalance.success ? `${usdtBalance.balance} USDT` : 'Error obteniendo saldo',
      verification_enabled: !!USDT_CONFIG.BSCSCAN_API_KEY,
      check_interval: `${USDT_CONFIG.CHECK_INTERVAL / 60000} minutos`
    };
    
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ 
      error: 'Error obteniendo estadísticas',
      users: { total: 0, vip: 0, trial_requests: 0, trial_pending: 0 },
      payments: { pending: 0, approved: 0 },
      revenue: { total: 0 },
      broadcasts: { completed: 0 }
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

// 13. Enviar archivo de configuración (para pagos aprobados)
app.post('/api/send-config', upload.single('configFile'), async (req, res) => {
  try {
    const { paymentId, telegramId, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
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
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    if (payment.status !== 'approved') {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El pago no está aprobado' });
    }
    
    try {
      await bot.telegram.sendDocument(
        telegramId,
        { source: req.file.path, filename: req.file.originalname },
        {
          caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                  `📁 *Archivo:* ${req.file.originalname}\n\n` +
                  `*Instrucciones de instalación:*\n` +
                  `1. Descarga este archivo\n` +
                  `2. ${fileName.endsWith('.conf') ? 'Importa el archivo .conf directamente' : 'Descomprime el ZIP/RAR en tu dispositivo'}\n` +
                  `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                  `4. Activa la conexión\n` +
                  `5. ¡Disfruta de baja latencia! 🚀\n\n` +
                  `*Soporte:* Contacta con soporte si tienes problemas.`,
          parse_mode: 'Markdown'
        }
      );
      
      await db.updatePayment(paymentId, {
        config_sent: true,
        config_sent_at: new Date().toISOString(),
        config_file: req.file.filename,
        config_sent_by: adminId
      });
      
      const user = await db.getUser(telegramId);
      if (!user.vip) {
        await db.makeUserVIP(telegramId, {
          plan: payment.plan,
          plan_price: payment.price,
          vip_since: new Date().toISOString()
        });
      }
      
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo después de enviar:', err);
      });
      
      res.json({ 
        success: true, 
        message: 'Configuración enviada correctamente',
        filename: req.file.filename 
      });
      
    } catch (telegramError) {
      console.error('❌ Error enviando archivo por Telegram:', telegramError);
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      res.status(500).json({ error: 'Error enviando archivo por Telegram: ' + telegramError.message });
    }
    
  } catch (error) {
    console.error('❌ Error en send-config:', error);
    
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
    
    await bot.telegram.sendMessage(telegramId, `📨 *Mensaje del Administrador:*\n\n${message}`, { 
      parse_mode: 'Markdown' 
    });
    
    res.json({ success: true, message: 'Mensaje enviado' });
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error enviando mensaje: ' + error.message });
  }
});

// 17. Remover VIP de usuario (admin)
app.post('/api/remove-vip', async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    const user = await db.removeVIP(telegramId);
    
    try {
      await bot.telegram.sendMessage(
        telegramId,
        '⚠️ *Tu acceso VIP ha sido removido*\n\n' +
        'Tu suscripción VIP ha sido cancelada.\n' +
        'Si crees que es un error, contacta con soporte.',
        { parse_mode: 'Markdown' }
      );
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
      trial_connection_type: connectionType || ''
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
      await bot.telegram.sendMessage(
        req.params.telegramId,
        '🎉 *¡Tu prueba gratuita está lista!*\n\n' +
        'Has recibido la configuración de prueba de 1 hora.\n' +
        '¡Disfruta de baja latencia! 🚀\n\n' +
        '*Nota:* Esta prueba expirará en 1 hora.',
        { parse_mode: 'Markdown' }
      );
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
    
    const user = await db.getUser(telegramId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    if (!user.trial_requested) {
      return res.status(400).json({ error: 'El usuario no solicitó prueba' });
    }
    
    if (user.trial_received) {
      return res.status(400).json({ error: 'El usuario ya recibió la prueba' });
    }
    
    // Buscar si hay archivo de prueba disponible
    const planFile = await db.getPlanFile('trial');
    
    if (planFile && planFile.public_url) {
      // Enviar archivo automáticamente
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
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      bscscan_api_key: USDT_CONFIG.BSCSCAN_API_KEY ? '✅ Configurado' : '❌ No configurado',
      verification_interval: `${USDT_CONFIG.CHECK_INTERVAL / 60000} minutos`
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
        
        await bot.telegram.sendMessage(
          user.telegram_id,
          `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${message}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte: @L0quen2_`,
          { parse_mode: 'Markdown' }
        );
        sentCount++;
        
        // Actualizar progreso cada 10 usuarios
        if ((i + 1) % 10 === 0 || i === users.length - 1) {
          console.log(`📊 Progreso: ${sentCount} enviados, ${failedCount} fallidos`);
          await db.updateBroadcastStatus(broadcastId, 'sending', {
            sent_count: sentCount,
            failed_count: failedCount,
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
        if (error.description && error.description.includes('blocked')) {
          console.log(`❌ Usuario ${user.telegram_id} bloqueó al bot`);
          continue;
        }
        
        console.error(`❌ Error enviando a ${user.telegram_id}:`, error.message);
      }
    }
    
    // Actualizar estado final
    console.log(`✅ Broadcast ${broadcastId} completado: ${sentCount} enviados, ${failedCount} fallidos`);
    await db.updateBroadcastStatus(broadcastId, 'completed', {
      sent_count: sentCount,
      failed_count: failedCount,
      total_users: users.length
    });
    
  } catch (error) {
    console.error(`❌ Error crítico en broadcast ${broadcastId}:`, error);
    
    // Intentar actualizar el estado a fallido
    try {
      await db.updateBroadcastStatus(broadcastId, 'failed', {
        sent_count: 0,
        failed_count: users.length || 0,
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

// 36. RUTAS API PARA USDT

// Verificar estado de wallet USDT
app.get('/api/usdt/wallet-status', async (req, res) => {
  try {
    const balance = await checkUsdtWalletBalance();
    const lastCheck = new Date().toISOString();
    
    res.json({
      success: true,
      wallet_address: USDT_CONFIG.WALLET_ADDRESS,
      network: 'BEP20 (Binance Smart Chain)',
      usdt_contract: USDT_CONFIG.USDT_CONTRACT_ADDRESS,
      balance: balance.success ? `${balance.balance} USDT` : 'Error obteniendo saldo',
      bscscan_url: `https://bscscan.com/address/${USDT_CONFIG.WALLET_ADDRESS}`,
      last_check: lastCheck,
      check_interval: `${USDT_CONFIG.CHECK_INTERVAL / 60000} minutos`
    });
  } catch (error) {
    console.error('❌ Error verificando estado de wallet:', error);
    res.status(500).json({ error: 'Error verificando estado de wallet' });
  }
});

// Verificar transacción específica
app.get('/api/usdt/verify-transaction/:hash', async (req, res) => {
  try {
    const verification = await verifyUsdtTransaction(req.params.hash);
    res.json(verification);
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
    
    const result = await checkUsdtTransactions();
    
    res.json({
      success: true,
      message: 'Verificación forzada completada',
      result: result
    });
  } catch (error) {
    console.error('❌ Error en verificación forzada:', error);
    res.status(500).json({ error: 'Error en verificación forzada' });
  }
});

// Obtener transacciones no asignadas
app.get('/api/usdt/unassigned-transactions', async (req, res) => {
  try {
    const transactions = await db.getUnassignedUsdtTransactions();
    res.json(transactions);
  } catch (error) {
    console.error('❌ Error obteniendo transacciones no asignadas:', error);
    res.status(500).json({ error: 'Error obteniendo transacciones no asignadas' });
  }
});

// Asignar transacción manualmente (para admins)
app.post('/api/usdt/assign-transaction', async (req, res) => {
  try {
    const { adminId, transactionHash, telegramId, plan } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    // Obtener transacción no asignada
    const unassignedTx = await db.getUnassignedTransaction(transactionHash);
    
    if (!unassignedTx) {
      return res.status(404).json({ error: 'Transacción no encontrada' });
    }
    
    // Verificar usuario
    const user = await db.getUser(telegramId);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Crear pago USDT
    const usdtAmount = parseFloat(unassignedTx.amount);
    const usdtPayment = await db.createUsdtPayment({
      telegram_id: telegramId,
      plan: plan,
      usdt_amount: usdtAmount.toFixed(2),
      usdt_address: USDT_CONFIG.WALLET_ADDRESS,
      status: 'completed',
      transaction_hash: transactionHash,
      sender_address: unassignedTx.sender_address,
      created_at: unassignedTx.timestamp
    });
    
    // Crear pago regular
    const payment = await db.createPayment({
      telegram_id: telegramId,
      plan: plan,
      price: usdtAmount,
      method: 'usdt',
      screenshot_url: '',
      notes: `Pago USDT asignado manualmente desde transacción ${transactionHash}`,
      status: 'approved',
      created_at: unassignedTx.timestamp
    });
    
    // Enviar configuración
    const configSent = await sendUsdtPaymentConfiguration(
      telegramId,
      plan,
      transactionHash,
      unassignedTx.sender_address,
      usdtAmount.toFixed(2)
    );
    
    // Marcar usuario como VIP
    if (!user.vip) {
      await db.makeUserVIP(telegramId, {
        plan: plan,
        plan_price: usdtAmount,
        vip_since: new Date().toISOString(),
        payment_method: 'usdt'
      });
    }
    
    // Marcar transacción como asignada
    await db.markTransactionAsAssigned(transactionHash, adminId);
    
    // Verificar referidos
    if (user.referrer_id) {
      await db.markReferralAsPaid(telegramId);
    }
    
    res.json({
      success: true,
      message: 'Transacción asignada exitosamente',
      payment: payment,
      usdtPayment: usdtPayment,
      config_sent: configSent
    });
    
  } catch (error) {
    console.error('❌ Error asignando transacción:', error);
    res.status(500).json({ error: 'Error asignando transacción: ' + error.message });
  }
});

// 37. Subir archivo de plan
app.post('/api/upload-plan-file', upload.single('file'), async (req, res) => {
  try {
    const { plan, adminId } = req.body;
    
    if (!isAdmin(adminId)) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    if (!plan || !['basico', 'avanzado', 'premium', 'anual', 'trial'].includes(plan)) {
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
  
// 38. Obtener todos los archivos de planes
app.get('/api/plan-files', async (req, res) => {
  try {
    const planFiles = await db.getAllPlanFiles();
    res.json(planFiles);
  } catch (error) {
    console.error('❌ Error obteniendo archivos de planes:', error);
    res.status(500).json({ error: 'Error obteniendo archivos de planes' });
  }
});

// 39. Obtener archivo de plan específico
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

// 40. Eliminar archivo de plan
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

// 41. Obtener estadísticas de juegos/servidores
app.get('/api/games-stats', async (req, res) => {
  try {
    const stats = await db.getGamesStatistics();
    res.json(stats.games || []);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de juegos:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de juegos' });
  }
});

// 42. Obtener detalles de usuario (para admin)
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

// Comando /start con sistema de referidos
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    // Verificar si hay referidor en el comando (ej: /start ref123456)
    const startPayload = ctx.startPayload;
    let referrerId = null;
    let referrerUsername = null;
    
    if (startPayload && startPayload.startsWith('ref')) {
        referrerId = startPayload.replace('ref', '');
        console.log(`🔗 Usuario ${userId} referido por ${referrerId}`);
        
        // Obtener información del referidor
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
    
    // Guardar/actualizar usuario en la base de datos
    try {
        const userData = {
            telegram_id: userId.toString(),
            username: ctx.from.username,
            first_name: firstName,
            last_name: ctx.from.last_name,
            created_at: new Date().toISOString()
        };
        
        // Si hay referidor, guardarlo
        if (referrerId) {
            userData.referrer_id = referrerId;
            userData.referrer_username = referrerUsername;
            
            // Crear registro de referido
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
    
    // Informar sobre referido si aplica
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
        // Ignorar error de "message not modified"
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
                // Si el mensaje no cambió, no hacer nada
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
            
            // Mostrar información de referidos si tiene
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
        
        // Solo reenviar mensaje si no es el error de "message not modified"
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

// Botón: Información de Referidos
bot.action('referral_info', async (ctx) => {
    const userId = ctx.from.id.toString();
    const userName = ctx.from.first_name;
    
    // Obtener información del usuario para ver si ya tiene referidos
    const user = await db.getUser(userId);
    let referralStats = null;
    if (user) {
        referralStats = await db.getReferralStats(userId);
    }
    
    const referralLink = `https://t.me/CromwellTradingBot?start=ref${userId}`;
    
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
        const referralLink = `https://t.me/CromwellTradingBot?start=ref${userId}`;
        
        // Primero responder a la callback query
        await ctx.answerCbQuery('📋 Enlace listo para copiar');
        
        // Determinar el message_id de manera segura
        let replyToMessageId = null;
        if (ctx.callbackQuery && ctx.callbackQuery.message) {
            replyToMessageId = ctx.callbackQuery.message.message_id;
        }
        
        // Enviar mensaje con el enlace
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
        
        // Intentar respuesta alternativa
        try {
            await ctx.answerCbQuery('❌ Error, intenta nuevamente');
        } catch (e) {
            // Ignorar error secundario
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
        `\n*COMANDOS DISPONIBLES:*\n` +
        `/start - Iniciar el bot\n` +
        `/referidos - Obtener tu enlace de referidos\n` +
        `/trialstatus - Ver estado de prueba gratuita\n` +
        `/help - Mostrar esta ayuda\n` +
        `${esAdmin ? '/admin - Panel de administración\n/enviar - Enviar configuración\n' : ''}` +
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
            
            // Buscar si hay un pago aprobado para este usuario
            const payments = await db.getUserPayments(telegramId);
            let paymentId = null;
            let approvedPayment = null;
            
            if (payments && payments.length > 0) {
                approvedPayment = payments.find(p => p.status === 'approved' && !p.config_sent);
                if (approvedPayment) {
                    paymentId = approvedPayment.id;
                }
            }
            
            // Enviar archivo al usuario
            await bot.telegram.sendDocument(telegramId, fileId, {
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

            // Actualizar pago si existe
            if (paymentId) {
                await db.updatePayment(paymentId, {
                    config_sent: true,
                    config_sent_at: new Date().toISOString(),
                    config_file: fileName,
                    config_sent_by: adminId
                });
                
                // Marcar usuario como VIP si aún no lo está
                const user = await db.getUser(telegramId);
                if (user && !user.vip && approvedPayment) {
                    await db.makeUserVIP(telegramId, {
                        plan: approvedPayment.plan,
                        plan_price: approvedPayment.price,
                        vip_since: new Date().toISOString()
                    });
                }
            }

            await ctx.reply(`✅ Archivo enviado al usuario ${telegramId}`);
            
            // Notificar al usuario
            await bot.telegram.sendMessage(
                telegramId,
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

// ==================== SERVIDOR ====================

// Iniciar servidor
app.listen(PORT, async () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🌐 Supabase URL: ${process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔑 Supabase Key: ${process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔐 Supabase Service Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
    
    // Verificar buckets primero
    console.log('🔍 Verificando buckets de almacenamiento...');
    await verifyStorageBuckets();
    
    // Inicializar buckets de almacenamiento
    console.log('📦 Inicializando buckets de almacenamiento...');
    await initializeStorageBuckets();
    
    // Iniciar sistema USDT
    console.log('💸 Inicializando sistema USDT...');
    await initializeUsdtSystem();
    
    // Iniciar bot
    try {
        await bot.launch();
        console.log('🤖 Bot de Telegram iniciado');
        
        // Configurar comandos del bot
        const commands = [
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'help', description: 'Mostrar ayuda' },
            { command: 'referidos', description: 'Obtener enlace de referidos' },
            { command: 'trialstatus', description: 'Ver estado de prueba gratuita' },
            { command: 'admin', description: 'Panel de administración (solo admins)' },
            { command: 'enviar', description: 'Enviar configuración (solo admins)' }
        ];
        
        await bot.telegram.setMyCommands(commands);
        console.log('📝 Comandos del bot configurados');
        
    } catch (error) {
        console.error('❌ Error iniciando bot:', error);
    }

    // Iniciar keep-alive
    startKeepAlive();
    
    console.log(`🎯 Prueba gratuita: Disponible desde webapp (1 hora)`);
    console.log(`📊 Estadísticas completas: /api/stats`);
    console.log(`💰 Sistema USDT: Habilitado`);
    console.log(`   • Dirección: ${USDT_CONFIG.WALLET_ADDRESS}`);
    console.log(`   • Verificación cada: ${USDT_CONFIG.CHECK_INTERVAL / 60000} minutos`);
    console.log(`👥 Sistema de referidos: Habilitado`);
    console.log(`📁 Archivos automáticos: Habilitado`);
    console.log(`📦 Buckets de almacenamiento: Verificados`);
});

// Manejar errores no capturados para reiniciar el bot
process.on('uncaughtException', async (error) => {
    console.error('❌ Error no capturado:', error);
    
    try {
        // Intentar reiniciar el bot
        bot.stop();
        await bot.launch();
        console.log('🤖 Bot reiniciado después de error no capturado');
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
    bot.stop();
    process.exit(0);
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
        }
    }, keepAliveInterval);

    console.log(`🔄 Keep-alive iniciado. Ping cada 5 minutos a ${healthCheckUrl}`);
}

// Exportar para pruebas
module.exports = {
    app,
    isAdmin,
    ADMIN_IDS,
    initializeStorageBuckets,
    initializeUsdtSystem,
    checkUsdtTransactions
};
