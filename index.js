const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const db = require('./supabase');

const PORT = process.env.PORT || 3000;

// IDs de administradores (separados por comas)
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604'];

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
    fileSize: 20 * 1024 * 1024, // 20MB para todos los archivos
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
    } else if (file.fieldname === 'configFile' || file.fieldname === 'trialConfigFile') {
      // Permitir archivos .conf, .zip y .rar
      const allowedExtensions = ['.conf', '.zip', '.rar'];
      const allowedMimeTypes = [
        'application/zip', 
        'application/x-rar-compressed', 
        'application/x-zip-compressed',
        'application/octet-stream',
        'text/plain', // Para .conf
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
    'premium': 'Premium (2 meses)',
    'vip': 'VIP (6 meses)'
  };
  return plans[planType] || planType;
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
        case 'premium':
            duracionDias = 60;
            break;
        case 'vip':
            duracionDias = 180;
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

// Función para formatear fecha
function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Función para crear menú principal (SIN BOTÓN DE PRUEBA GRATIS)
function crearMenuPrincipal(userId, firstName = 'usuario', esAdmin = false) {
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;
    
    // Crear teclado BASE para TODOS los usuarios (SIN PRUEBA GRATIS)
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
        ]
    ];

    // Si es ADMIN, agregar botones adicionales
    if (esAdmin) {
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
    }

    return keyboard;
}

// ==================== RUTAS DE LA API ====================

// 1. Verificar si es administrador
app.get('/api/check-admin/:telegramId', (req, res) => {
  const isAdminUser = isAdmin(req.params.telegramId);
  console.log(`🔍 Verificando admin para ${req.params.telegramId}: ${isAdminUser}`);
  res.json({ isAdmin: isAdminUser });
});

// 2. Aceptar términos (usamos localStorage, pero mantenemos para compatibilidad)
app.post('/api/accept-terms', async (req, res) => {
  try {
    const { telegramId, username, firstName } = req.body;
    
    console.log(`✅ Usuario ${telegramId} acepta términos`);
    
    const user = await db.saveUser(telegramId, {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ Error aceptando términos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 3. Verificar términos aceptados (usamos localStorage, pero mantenemos API)
app.get('/api/check-terms/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    console.log(`🔍 Verificando términos para ${req.params.telegramId}: ${user?.accepted_terms || false}`);
    res.json({ 
      accepted: user?.accepted_terms || false,
      user: user
    });
  } catch (error) {
    console.error('❌ Error verificando términos:', error);
    res.json({ accepted: false });
  }
});

// 4. Procesar pago (CON SUPABASE STORAGE)
app.post('/api/payment', upload.single('screenshot'), async (req, res) => {
  try {
    console.log('📥 Pago recibido - Datos recibidos:', {
      telegramId: req.body.telegramId,
      plan: req.body.plan,
      price: req.body.price,
      file: req.file ? req.file.filename : 'No file'
    });
    
    const { telegramId, plan, price, notes } = req.body;
    
    if (!telegramId || !plan || !price) {
      console.log('❌ Datos incompletos:', { telegramId, plan, price });
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    if (!req.file) {
      console.log('❌ No se recibió captura de pantalla');
      return res.status(400).json({ error: 'Captura de pantalla requerida' });
    }

    // 1. Subir imagen a Supabase Storage
    let screenshotUrl = '';
    try {
      screenshotUrl = await db.uploadImage(req.file.path, telegramId);
      console.log('✅ Imagen subida a Supabase Storage:', screenshotUrl);
      
      // Eliminar archivo local después de subir exitosamente
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error eliminando archivo local:', err);
      });
    } catch (uploadError) {
      console.error('❌ Error subiendo imagen:', uploadError);
      
      // Si falla el upload, usar ruta local como fallback
      screenshotUrl = `/uploads/${req.file.filename}`;
      console.log('⚠️ Usando ruta local como fallback:', screenshotUrl);
    }

    // 2. Obtener información del usuario
    const user = await db.getUser(telegramId);
    const username = user?.username ? `@${user.username}` : 'Sin usuario';
    const firstName = user?.first_name || 'Usuario';

    // 3. Guardar pago en base de datos
    const payment = await db.createPayment({
      telegram_id: telegramId,
      plan: plan,
      price: parseFloat(price),
      screenshot_url: screenshotUrl,
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    if (!payment) {
      throw new Error('No se pudo crear el pago en la base de datos');
    }

    console.log('✅ Pago guardado exitosamente:', {
      paymentId: payment?.id,
      telegramId: telegramId,
      plan: plan
    });

    // 4. 🔥 ENVIAR NOTIFICACIÓN A TODOS LOS ADMINS
    try {
      const adminMessage = `💰 *NUEVO PAGO RECIBIDO*\n\n` +
        `👤 *Usuario:* ${firstName}\n` +
        `📱 *Telegram:* ${username}\n` +
        `🆔 *ID:* ${telegramId}\n` +
        `📋 *Plan:* ${getPlanName(plan)}\n` +
        `💰 *Monto:* $${price} CUP\n` +
        `⏰ *Fecha:* ${new Date().toLocaleString('es-ES')}\n` +
        `📝 *Estado:* ⏳ Pendiente\n\n` +
        `Para revisar, visita el panel de administración.`;
      
      // Enviar a todos los admins
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
          console.log(`✅ Notificación enviada al admin ${adminId}`);
        } catch (adminError) {
          console.log(`❌ No se pudo notificar al admin ${adminId}:`, adminError.message);
        }
      }
    } catch (adminError) {
      console.log('❌ Error al notificar a los admins:', adminError.message);
    }

    res.json({ 
      success: true, 
      message: 'Pago recibido. Te notificaremos cuando sea aprobado.',
      payment 
    });
  } catch (error) {
    console.error('❌ Error procesando pago:', error);
    
    // Eliminar archivo si hubo error
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
    console.log('🔍 Buscando pagos pendientes...');
    const payments = await db.getPendingPayments();
    
    console.log(`📊 Encontrados ${payments.length} pagos pendientes`);
    
    // Obtener información de usuarios para cada pago
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
    console.log('🔍 Buscando pagos aprobados...');
    const payments = await db.getApprovedPayments();
    
    console.log(`📊 Encontrados ${payments.length} pagos aprobados`);
    
    // Obtener información de usuarios para cada pago
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
    console.log(`✅ Aprobando pago ${req.params.id}...`);
    
    const payment = await db.approvePayment(req.params.id);
    
    if (!payment) {
      console.log(`❌ Pago ${req.params.id} no encontrado`);
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // Obtener usuario
    const user = await db.getUser(payment.telegram_id);
    
    // Notificar al usuario
    try {
      await bot.telegram.sendMessage(
        payment.telegram_id,
        '🎉 *¡Tu pago ha sido aprobado!*\n\n' +
        'Ahora eres usuario VIP de VPN Cuba.\n' +
        'En breve recibirás tu archivo de configuración por este mismo chat.',
        { parse_mode: 'Markdown' }
      );
      console.log(`✅ Usuario ${payment.telegram_id} notificado de aprobación`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    res.json({ success: true, payment, user });
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

    console.log(`❌ Rechazando pago ${req.params.id} con motivo: ${reason}`);
    
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
      console.log(`✅ Usuario ${payment.telegram_id} notificado del rechazo`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error rechazando pago:', error);
    res.status(500).json({ error: 'Error rechazando pago' });
  }
});

// 9. Obtener estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    console.log('📊 Obteniendo estadísticas...');
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// 10. Obtener usuarios VIP
app.get('/api/vip-users', async (req, res) => {
  try {
    console.log('👑 Obteniendo usuarios VIP...');
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
    console.log('👥 Obteniendo todos los usuarios...');
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
    console.log(`🔍 Buscando pago ${req.params.id}...`);
    const payment = await db.getPayment(req.params.id);
    
    if (!payment) {
      console.log(`❌ Pago ${req.params.id} no encontrado`);
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

// 13. ENVIAR ARCHIVO DE CONFIGURACIÓN (ZIP/RAR/CONF) - ACTUALIZADO
app.post('/api/send-config', upload.single('configFile'), async (req, res) => {
  try {
    console.log('📤 Recibiendo archivo de configuración...', {
      body: req.body,
      file: req.file ? req.file.filename : 'No file'
    });
    
    const { paymentId, telegramId, adminId } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de enviar configuración por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    // Verificar que el archivo sea .zip o .rar
    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar') && !fileName.endsWith('.conf')) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .conf, .zip o .rar' });
    }
    
    // Obtener información del pago
    const payment = await db.getPayment(paymentId);
    
    if (!payment) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    // Verificar que el pago esté aprobado
    if (payment.status !== 'approved') {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El pago no está aprobado' });
    }
    
    try {
      console.log(`📤 Enviando configuración a ${telegramId} (Pago: ${paymentId})`);
      
      // Enviar archivo por Telegram
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
      
      // Actualizar pago con información del archivo enviado
      await db.updatePayment(paymentId, {
        config_sent: true,
        config_sent_at: new Date().toISOString(),
        config_file: req.file.filename,
        config_sent_by: adminId
      });
      
      // Marcar usuario como VIP si aún no lo está
      const user = await db.getUser(telegramId);
      if (!user.vip) {
        await db.makeUserVIP(telegramId, {
          plan: payment.plan,
          plan_price: payment.price,
          vip_since: new Date().toISOString()
        });
        console.log(`👑 Usuario ${telegramId} marcado como VIP`);
      }
      
      // Eliminar archivo local después de enviar
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo después de enviar:', err);
      });
      
      console.log(`✅ Configuración enviada a ${telegramId}`);
      
      res.json({ 
        success: true, 
        message: 'Configuración enviada correctamente',
        filename: req.file.filename 
      });
      
    } catch (telegramError) {
      console.error('❌ Error enviando archivo por Telegram:', telegramError);
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      res.status(500).json({ error: 'Error enviando archivo por Telegram: ' + telegramError.message });
    }
    
  } catch (error) {
    console.error('❌ Error en send-config:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

// 14. Servir archivos subidos (para fallback si no usa Supabase Storage)
app.use('/uploads', express.static(UPLOADS_DIR));

// 15. Ruta para obtener información del usuario actual
app.get('/api/user-info/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    
    if (!user) {
      console.log(`❌ Usuario ${req.params.telegramId} no encontrado`);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Verificar si es admin
    const admin = isAdmin(req.params.telegramId);
    
    res.json({
      ...user,
      isAdmin: admin
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
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de enviar mensaje por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`📨 Enviando mensaje a ${telegramId}: ${message.substring(0, 50)}...`);
    
    // Enviar mensaje por Telegram
    await bot.telegram.sendMessage(telegramId, `📨 *Mensaje del Administrador:*\n\n${message}`, { 
      parse_mode: 'Markdown' 
    });
    
    console.log(`✅ Mensaje enviado a ${telegramId}`);
    
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
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de remover VIP por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`👑 Removiendo VIP de ${telegramId}...`);
    
    // Remover VIP
    const user = await db.removeVIP(telegramId);
    
    // Notificar al usuario
    try {
      await bot.telegram.sendMessage(
        telegramId,
        '⚠️ *Tu acceso VIP ha sido removido*\n\n' +
        'Tu suscripción VIP ha sido cancelada.\n' +
        'Si crees que es un error, contacta con soporte.',
        { parse_mode: 'Markdown' }
      );
      console.log(`✅ Usuario ${telegramId} notificado de remoción de VIP`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }
    
    console.log(`✅ VIP removido de ${telegramId}`);
    
    res.json({ success: true, message: 'VIP removido', user });
  } catch (error) {
    console.error('❌ Error removiendo VIP:', error);
    res.status(500).json({ error: 'Error removiendo VIP' });
  }
});

// 18. Solicitar prueba gratuita (1 hora) - ACTUALIZADO CON CAMPOS ADICIONALES
app.post('/api/request-trial', async (req, res) => {
  try {
    const { telegramId, username, firstName, trialType = '1h', gameServer, connectionType } = req.body;
    
    console.log(`🎯 Solicitud de prueba (${trialType}) de ${telegramId} (${username})`);
    console.log(`🎮 Juego/Servidor: ${gameServer}`);
    console.log(`📡 Tipo de conexión: ${connectionType}`);
    
    // Verificar elegibilidad para prueba
    const eligibility = await db.checkTrialEligibility(telegramId);
    
    if (!eligibility.eligible) {
      return res.status(400).json({ 
        error: `No puedes solicitar una prueba en este momento: ${eligibility.reason}` 
      });
    }
    
    // Guardar/actualizar usuario con solicitud de prueba y la información adicional
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
    
    // Notificar a TODOS los administradores con la información adicional
    const adminMessage = `🎯 *NUEVA SOLICITUD DE PRUEBA ${trialType.toUpperCase()}*\n\n` +
      `👤 *Usuario:* ${firstName}\n` +
      `📱 *Telegram:* ${username ? `@${username}` : 'Sin usuario'}\n` +
      `🆔 *ID:* ${telegramId}\n` +
      `🎮 *Juego/Servidor:* ${gameServer || 'No especificado'}\n` +
      `📡 *Conexión:* ${connectionType || 'No especificado'}\n` +
      `⏰ *Duración:* 1 hora\n` +
      `📅 *Fecha:* ${new Date().toLocaleString('es-ES')}\n\n` +
      `*Acciones disponibles:*\n` +
      `1. Enviar configuración de prueba\n` +
      `2. Contactar al usuario\n\n` +
      `*Para gestionar:* Ve al panel de administración.`;
    
    // Enviar notificación a cada admin
    for (const adminId of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(adminId, adminMessage, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '📤 Enviar Configuración',
                  callback_data: `send_trial_${telegramId}_${trialType}`
                },
                {
                  text: '💬 Contactar Usuario',
                  url: `https://t.me/${username || telegramId}`
                }
              ],
              [
                {
                  text: '🔧 Panel Admin',
                  web_app: { 
                    url: `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${adminId}&admin=true`
                  }
                }
              ]
            ]
          }
        });
        console.log(`✅ Notificación de prueba enviada al admin ${adminId}`);
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

// 19. Ruta para obtener estadísticas de pruebas
app.get('/api/trial-stats', async (req, res) => {
  try {
    console.log('🎯 Obteniendo estadísticas de pruebas...');
    const stats = await db.getTrialStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de prueba:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de prueba' });
  }
});

// 20. Ruta para obtener pruebas pendientes
app.get('/api/trials/pending', async (req, res) => {
  try {
    console.log('⏳ Obteniendo pruebas pendientes...');
    const trials = await db.getPendingTrials();
    
    // Obtener información completa de usuarios
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

// 21. Ruta para marcar prueba como enviada
app.post('/api/trials/:telegramId/mark-sent', async (req, res) => {
  try {
    const { adminId } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de marcar prueba como enviada por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`✅ Marcando prueba como enviada para ${req.params.telegramId}...`);
    
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
      console.log(`✅ Usuario ${req.params.telegramId} notificado de envío de prueba`);
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

// 22. ENVIAR ARCHIVO DE CONFIGURACIÓN DE PRUEBA (desde web admin) - NUEVA RUTA
app.post('/api/send-trial-config', upload.single('trialConfigFile'), async (req, res) => {
  try {
    console.log('🎁 Recibiendo archivo de configuración de prueba...', {
      body: req.body,
      file: req.file ? req.file.filename : 'No file'
    });
    
    const { telegramId, adminId, trialType = '1h' } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de enviar configuración de prueba por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    // Verificar que el archivo sea .conf, .zip o .rar
    const fileName = req.file.originalname.toLowerCase();
    const isValidFile = fileName.endsWith('.conf') || fileName.endsWith('.zip') || fileName.endsWith('.rar');
    
    if (!isValidFile) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .conf, .zip o .rar' });
    }
    
    // Obtener información del usuario
    const user = await db.getUser(telegramId);
    
    if (!user) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Verificar que el usuario haya solicitado prueba
    if (!user.trial_requested) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El usuario no solicitó prueba' });
    }
    
    // Verificar que no haya recibido ya la prueba
    if (user.trial_received) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El usuario ya recibió la prueba' });
    }
    
    // Obtener información adicional del juego/servidor
    const gameServer = user.trial_game_server || 'No especificado';
    const connectionType = user.trial_connection_type || 'No especificado';
    
    try {
      console.log(`🎁 Enviando configuración de prueba (${trialType}) a ${telegramId}`);
      console.log(`🎮 Juego/Servidor: ${gameServer}`);
      console.log(`📡 Conexión: ${connectionType}`);
      
      // Enviar archivo por Telegram
      await bot.telegram.sendDocument(
        telegramId,
        { source: req.file.path, filename: req.file.originalname },
        {
          caption: `🎁 *¡Tu prueba gratuita de VPN Cuba está lista!*\n\n` +
                  `📁 *Archivo de configuración para ${trialType} de prueba*\n\n` +
                  `🎮 *Juego/Servidor:* ${gameServer}\n` +
                  `📡 *Conexión:* ${connectionType}\n\n` +
                  `*Instrucciones de instalación:*\n` +
                  `1. Descarga este archivo\n` +
                  `2. ${fileName.endsWith('.conf') ? 'Importa el archivo .conf directamente' : 'Descomprime el ZIP/RAR en tu dispositivo'}\n` +
                  `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                  `4. Activa la conexión\n` +
                  `5. ¡Disfruta de ${trialType} de prueba gratis! 🎉\n\n` +
                  `⏰ *Duración:* ${trialType}\n` +
                  `📋 *Tipo:* Prueba gratuita\n` +
                  `👑 *Estado:* Acceso temporal\n\n` +
                  `*Importante:* Esta configuración expirará en ${trialType}.\n` +
                  `Para continuar usando el servicio después de la prueba, adquiere uno de nuestros planes.\n\n` +
                  `*Soporte:* Contacta con @L0quen2 si tienes problemas.`,
          parse_mode: 'Markdown'
        }
      );
      
      // Marcar usuario como que recibió prueba
      await db.markTrialAsSent(telegramId, adminId);
      
      // Actualizar tipo de prueba si es diferente
      if (trialType && trialType !== user.trial_plan_type) {
        await db.updateUserTrial(telegramId, {
          trial_plan_type: trialType
        });
      }
      
      // Eliminar archivo local después de enviar
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo después de enviar:', err);
      });
      
      console.log(`✅ Configuración de prueba enviada a ${telegramId}`);
      
      res.json({ 
        success: true, 
        message: 'Configuración de prueba enviada correctamente',
        filename: req.file.filename,
        trialType: trialType,
        gameServer: gameServer,
        connectionType: connectionType
      });
      
    } catch (telegramError) {
      console.error('❌ Error enviando archivo de prueba por Telegram:', telegramError);
      
      // Verificar si el error es porque el usuario bloqueó al bot
      if (telegramError.description && telegramError.description.includes('blocked')) {
        console.log(`⚠️ Usuario ${telegramId} bloqueó al bot`);
        
        // Eliminar archivo subido
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('❌ Error al eliminar archivo:', err);
        });
        
        return res.status(400).json({ 
          error: 'No se puede enviar mensaje al usuario. Posiblemente el usuario bloqueó al bot.' 
        });
      }
      
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      
      res.status(500).json({ error: 'Error enviando archivo por Telegram: ' + telegramError.message });
    }
    
  } catch (error) {
    console.error('❌ Error en send-trial-config:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

// 23. Ruta de prueba para verificar que el servidor funciona
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString(),
    admins: ADMIN_IDS,
    port: PORT,
    bot_token: process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado',
    supabase_url: process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'
  });
});

// 24. Ruta para obtener imagen directa (si está guardada localmente)
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

// ==================== BOT DE TELEGRAM - ACTUALIZADO (SIN PRUEBA DESDE BOT) ====================

// Comando /start con todos los botones visibles (SIN PRUEBA GRATIS)
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    console.log(`🤖 Comando /start de ${userId} (Admin: ${esAdmin})`);
    
    // Guardar/actualizar usuario en la base de datos
    try {
        await db.saveUser(userId.toString(), {
            telegram_id: userId.toString(),
            username: ctx.from.username,
            first_name: firstName,
            last_name: ctx.from.last_name,
            created_at: new Date().toISOString()
        });
        console.log(`✅ Usuario ${userId} guardado/actualizado`);
    } catch (error) {
        console.error('❌ Error guardando usuario:', error);
    }
    
    const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
    
    await ctx.reply(
        `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Conéctate con la mejor latencia para gaming y navegación.\n\n` +
        `${esAdmin ? '🔧 *Eres Administrador* - Tienes acceso a funciones especiales\n\n' : ''}` +
        `*Selecciona una opción:*`,
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
    
    if (esAdmin) {
        keyboard.splice(1, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `💻 *DESCARGAR WIREGUARD* 📱\n\n` +
        `*Para Windows*\n` +
        `Aplicación Oficial de WireGuard para Windows:\n` +
        `Descargue el instalador (archivo .msi) directamente desde la web oficial.\n` +
        `Enlace: https://www.wireguard.com/install/\n` +
        `(Busque la sección de Windows en el enlace para el archivo de descarga más reciente).\n\n` +
        `*Para Android*\n` +
        `Aplicación Oficial de WireGuard en Google Play Store:\n` +
        `Instálela directamente desde la tienda de aplicaciones de Google.\n` +
        `Enlace: https://play.google.com/store/apps/details?id=com.wireguard.android\n\n` +
        `*Selecciona tu sistema operativo:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Ver Planes (callback)
bot.action('view_plans', async (ctx) => {
    console.log(`📋 Usuario ${ctx.from.id} solicita ver planes`);
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
    
    // Crear teclado específico para planes
    const keyboard = [
        [
            { 
                text: '🚀 VER PLANES EN WEB', 
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
    
    // Si es admin, agregar botón de broadcast
    if (esAdmin) {
        keyboard.splice(3, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📋 *NUESTROS PLANES* 🚀\n\n` +
        `*PRUEBA GRATIS (1 hora)*\n` +
        `💵 $0 CUP\n` +
        `🎁 ¡Prueba completamente gratis!\n\n` +
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

// Botón: Ver Detalles de Planes
bot.action('view_detailed_plans', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
    
    const keyboard = [
        [
            { 
                text: '🚀 COMPRAR AHORA', 
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
                text: '📋 VER PLANES RESUMEN',
                callback_data: 'view_plans'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    if (esAdmin) {
        keyboard.splice(3, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📊 *DETALLES DE PLANES* 📋\n\n` +
        `*PRUEBA GRATIS (1 hora)*\n` +
        `• Precio: $0 CUP\n` +
        `• Conexión completa por 1 hora\n` +
        `• Ancho de banda ilimitado\n` +
        `• Misma seguridad que planes pagos\n` +
        `• Configuración en minutos\n\n` +
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
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Mi Estado (con días restantes)
bot.action('check_status', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    
    console.log(`👑 Usuario ${userId} verifica estado VIP`);
    
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
            await ctx.editMessageText(
                `❌ *NO ESTÁS REGISTRADO*\n\n` +
                `Usa el botón "📋 VER PLANES" para registrarte y comenzar.\n\n` +
                `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
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
            
            if (esAdmin) {
                keyboard.splice(2, 0, [
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
            
            await ctx.editMessageText(
                trialMessage,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
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
            
            if (esAdmin) {
                keyboard.splice(2, 0, [
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
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
        }
    } catch (error) {
        console.error('❌ Error en check_status:', error);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
        await ctx.editMessageText(
            `❌ Error al verificar tu estado.\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    }
});

// Botón: Iniciar Broadcast (solo admin) - CORREGIDO Y MEJORADO
bot.action('start_broadcast', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ NO AUTORIZADO');
        return;
    }
    
    // Iniciar el proceso de broadcast
    try {
        await ctx.editMessageText(
            `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES* 📤\n\n` +
            `Por favor, escribe el mensaje que quieres enviar a *todos* los usuarios registrados.\n\n` +
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
        
        // Esperar el mensaje de texto del admin
        ctx.session = ctx.session || {};
        ctx.session.waitingForBroadcastMessage = true;
        
    } catch (error) {
        console.error('❌ Error iniciando broadcast:', error);
        await ctx.answerCbQuery('❌ Error iniciando broadcast');
    }
});

// Botón: Confirmar Broadcast - VERSIÓN CORREGIDA
bot.action('confirm_broadcast', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ NO AUTORIZADO');
        return;
    }
    
    const broadcastMessage = ctx.session?.pendingBroadcast;
    if (!broadcastMessage) {
        await ctx.answerCbQuery('❌ NO HAY MENSAJE PARA ENVIAR');
        return;
    }
    
    try {
        // Obtener usuarios usando una función más simple
        let users = [];
        try {
            users = await db.getAllUsers();
            console.log(`📢 Usuarios obtenidos para broadcast: ${users.length}`);
            
            if (users.length === 0) {
                await ctx.editMessageText(
                    `❌ *NO HAY USUARIOS REGISTRADOS*\n\nNo se puede enviar broadcast sin usuarios.`,
                    { 
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [] }
                    }
                );
                return;
            }
        } catch (error) {
            console.error('❌ Error obteniendo usuarios:', error);
            await ctx.editMessageText(
                `❌ *ERROR OBTENIENDO USUARIOS*\n\n${error.message}`,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [] }
                }
            );
            return;
        }
        
        const totalUsers = users.length;
        
        await ctx.editMessageText(
            `📢 *ENVIANDO BROADCAST* 📤\n\n` +
            `Enviando mensaje a ${totalUsers} usuarios...\n` +
            `Por favor, espera. Esto puede tomar unos minutos.\n\n` +
            `⏳ *PROGRESO:* 0/${totalUsers}`,
            { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [] }
            }
        );
        
        let successCount = 0;
        let failCount = 0;
        const failedUsers = [];
        
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            
            try {
                // Verificar que tenga telegram_id
                if (!user.telegram_id) {
                    console.log(`⚠️ Usuario sin telegram_id, saltando...`);
                    failCount++;
                    continue;
                }
                
                await bot.telegram.sendMessage(
                    user.telegram_id,
                    `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${broadcastMessage}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte: @L0quen2_`,
                    { parse_mode: 'Markdown' }
                );
                successCount++;
                
                // Actualizar progreso cada 5 usuarios
                if ((i + 1) % 5 === 0 || i === users.length - 1) {
                    try {
                        await ctx.telegram.editMessageText(
                            ctx.chat.id,
                            ctx.callbackQuery.message.message_id,
                            null,
                            `📢 *ENVIANDO BROADCAST* 📤\n\n` +
                            `⏳ *PROGRESO:* ${i + 1}/${totalUsers}\n` +
                            `✅ Enviados: ${successCount}\n` +
                            `❌ Fallados: ${failCount}`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (editError) {
                        console.log('Error actualizando mensaje:', editError.message);
                    }
                }
                
                // Pequeña pausa para no saturar
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`❌ Error enviando a ${user.telegram_id || 'sin ID'}:`, error.message);
                failCount++;
                failedUsers.push({
                    id: user.telegram_id,
                    name: user.first_name || 'Sin nombre',
                    error: error.message
                });
            }
        }
        
        delete ctx.session.pendingBroadcast;
        
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, true);
        
        let resultMessage = `✅ *BROADCAST COMPLETADO* 📤\n\n`;
        resultMessage += `📊 *ESTADÍSTICAS:*\n`;
        resultMessage += `• Total de usuarios: ${totalUsers}\n`;
        resultMessage += `• Mensajes enviados: ${successCount}\n`;
        resultMessage += `• Mensajes fallados: ${failCount}\n`;
        
        if (totalUsers > 0) {
            resultMessage += `• Tasa de éxito: ${((successCount / totalUsers) * 100).toFixed(1)}%\n\n`;
        }
        
        if (failedUsers.length > 0) {
            resultMessage += `⚠️ *Usuarios con error (${failedUsers.length}):*\n`;
            failedUsers.slice(0, 5).forEach(u => {
                resultMessage += `• ${u.name} (${u.id}): ${u.error.substring(0, 30)}...\n`;
            });
            if (failedUsers.length > 5) {
                resultMessage += `• ... y ${failedUsers.length - 5} más\n`;
            }
            resultMessage += `\n`;
        }
        
        resultMessage += `*VPN CUBA - MENÚ PRINCIPAL* 🚀`;
        
        await ctx.editMessageText(
            resultMessage,
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
        
    } catch (error) {
        console.error('❌ Error en broadcast:', error);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, true);
        await ctx.editMessageText(
            `❌ *ERROR CRÍTICO EN BROADCAST*\n\n` +
            `Error: ${error.message}\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    }
});

// Manejar mensajes de texto para broadcast
bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const message = ctx.message.text;
    
    // Manejar mensaje de broadcast (mantener funcionalidad existente)
    if (isAdmin(userId) && ctx.session?.waitingForBroadcastMessage) {
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
                            { text: '❌ CANCELAR', callback_data: 'main_menu' }
                        ]
                    ]
                }
            }
        );
    }
});

// Comando para ver estado de prueba
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

// Comando /admin solo para admins
bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) {
        console.log(`❌ Usuario ${ctx.from.id} intentó usar /admin sin permisos`);
        return ctx.reply('❌ Solo el administrador puede usar este comando.');
    }

    console.log(`🔧 Admin ${ctx.from.id} usa /admin`);
    
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
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
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

// Comando /help actualizado
bot.command('help', async (ctx) => {
    console.log(`🆘 Usuario ${ctx.from.id} solicita ayuda`);
    
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
        `🆘 SOPORTE - Contactar con soporte técnico\n` +
        `${esAdmin ? '🔧 PANEL ADMIN - Panel de administración\n' : ''}` +
        `${esAdmin ? '📢 BROADCAST - Enviar mensaje a todos los usuarios\n' : ''}` +
        `\n¡Todo está disponible en los botones! 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /comprar
bot.command('comprar', async (ctx) => {
    console.log(`🛒 Usuario ${ctx.from.id} usa /comprar`);
    
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${ctx.from.id}`;
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
    
    await ctx.reply(
        `🛒 *PROCESO DE COMPRA*\n\n` +
        `Para realizar tu compra, haz clic en el botón "📋 VER PLANES" en el menú principal.\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /enviar simplificado para administrador
bot.command('enviar', async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) {
        return ctx.reply('❌ Solo el administrador puede usar este comando.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Uso: /enviar <ID de usuario>\nEjemplo: /enviar 123456789');
    }

    const telegramId = args[1];
    
    console.log(`📤 Admin ${ctx.from.id} prepara envío a ${telegramId}`);
    
    // Pedir archivo directamente
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
    
    // Guardar en sesión simple
    ctx.session = { waitingToSendTo: telegramId };
});

// Manejar archivos enviados por admin (configuraciones normales)
bot.on('document', async (ctx) => {
    const adminId = ctx.from.id.toString();
    
    if (!isAdmin(adminId)) return;
    
    // Para configuración normal
    if (ctx.session?.waitingToSendTo) {
        const telegramId = ctx.session.waitingToSendTo;
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name;

        console.log(`📁 Admin ${adminId} envía archivo ${fileName} a ${telegramId}`);

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
                    console.log(`👑 Usuario ${telegramId} marcado como VIP`);
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
    console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
    console.log(`📁 Uploads dir: ${UPLOADS_DIR}`);
    console.log(`🆘 Soporte: @L0quen2`);
    console.log(`📢 Broadcast: Disponible para admins`);
    console.log(`🎯 Prueba gratuita: Disponible solo desde webapp (1 hora)`);
    console.log(`📊 Estadísticas de trial: /api/trial-stats`);
    console.log(`📤 Envío de archivos de prueba: Desde web admin`);
    
    // Iniciar bot
    try {
        await bot.launch();
        console.log('🤖 Bot de Telegram iniciado');
        
        // Configurar comandos del bot
        const commands = [
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'help', description: 'Mostrar ayuda' },
            { command: 'admin', description: 'Panel de administración (solo admins)' },
            { command: 'trialstatus', description: 'Ver estado de prueba gratuita' },
            { command: 'comprar', description: 'Ver planes y comprar' }
        ];
        
        await bot.telegram.setMyCommands(commands);
        console.log('📝 Comandos del bot configurados');
        
    } catch (error) {
        console.error('❌ Error iniciando bot:', error);
    }

    // Iniciar keep-alive
    startKeepAlive();
});

// Manejar cierre
process.on('SIGINT', () => {
    console.log('\n👋 Cerrando aplicación...');
    bot.stop();
    process.exit(0);
});

// ==================== KEEP ALIVE ====================

// Función para hacer ping a la propia aplicación cada 5 minutos
function startKeepAlive() {
    const keepAliveInterval = 5 * 60 * 1000; // 5 minutos en milisegundos
    const healthCheckUrl = `http://localhost:${PORT}/api/health`;

    setInterval(async () => {
        try {
            const response = await fetch(healthCheckUrl);
            if (response.ok) {
                console.log(`✅ Keep-alive ping exitoso a las ${new Date().toLocaleTimeString()}`);
            } else {
                console.error(`❌ Keep-alive ping falló con estado ${response.status}`);
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
    ADMIN_IDS
};
